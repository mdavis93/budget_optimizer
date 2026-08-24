import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type { CryptoService } from '../services/crypto.service';

export const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'utf8');

const USER_TABLES = [
  'schema_version',
  'budgets',
  'incomes',
  'bills',
  'goals',
  'debts',
  'leaves',
  'skipped_bills',
  'bill_assignments',
  'income_overrides',
  'settings',
] as const;

export function isPlaintextSqliteFile(filePath: string): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  const fd = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(SQLITE_HEADER.length);
    const bytesRead = fs.readSync(fd, header, 0, SQLITE_HEADER.length, 0);
    return bytesRead === SQLITE_HEADER.length && header.equals(SQLITE_HEADER);
  } finally {
    fs.closeSync(fd);
  }
}

export function applySqlCipherKey(db: Database.Database, crypto: CryptoService): void {
  db.pragma("cipher = 'sqlcipher'");
  db.pragma('legacy = 4');
  db.pragma(`key = "${crypto.sqlCipherKeyPragma()}"`);
  db.prepare('SELECT count(*) AS n FROM sqlite_master').get();
}

function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Refusing to copy unsafe sqlite identifier: ${name}`);
  }
  return `"${name}"`;
}

function tableCounts(db: Database.Database): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const table of USER_TABLES) {
    const row = db
      .prepare(
        `SELECT COUNT(*) as count FROM sqlite_master WHERE type = 'table' AND name = ?`
      )
      .get(table) as { count: number };
    if (row.count === 0) {
      counts[table] = 0;
      continue;
    }
    const counted = db.prepare(`SELECT COUNT(*) as count FROM ${quoteIdent(table)}`).get() as {
      count: number;
    };
    counts[table] = counted.count;
  }
  return counts;
}

function integrityOk(db: Database.Database): boolean {
  const result = db.pragma('integrity_check', { simple: true });
  return result === 'ok';
}

function copySchemaAndRows(source: Database.Database, dest: Database.Database): void {
  const objects = source
    .prepare(
      `SELECT type, name, sql FROM sqlite_master
       WHERE sql IS NOT NULL
         AND name NOT LIKE 'sqlite_%'
         AND name NOT LIKE 'sqlite3_%'
       ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name`
    )
    .all() as Array<{ type: string; name: string; sql: string }>;

  dest.pragma('foreign_keys = OFF');
  dest.transaction(() => {
    for (const object of objects) {
      dest.exec(object.sql);
    }

    const tables = objects.filter((object) => object.type === 'table');
    for (const table of tables) {
      const rows = source.prepare(`SELECT * FROM ${quoteIdent(table.name)}`).all() as Array<
        Record<string, unknown>
      >;
      if (rows.length === 0) {
        continue;
      }
      const columns = Object.keys(rows[0]);
      const insert = dest.prepare(
        `INSERT INTO ${quoteIdent(table.name)} (${columns.map(quoteIdent).join(', ')})
         VALUES (${columns.map(() => '?').join(', ')})`
      );
      for (const row of rows) {
        insert.run(...columns.map((column) => row[column]));
      }
    }
  })();
  dest.pragma('foreign_keys = ON');
}

export function checkpointAndClose(db: Database.Database): void {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    // File may not be in WAL mode yet.
  }
  db.close();
}

export function openSqlCipherDatabase(
  filePath: string,
  crypto: CryptoService
): Database.Database {
  const db = new Database(filePath);
  applySqlCipherKey(db, crypto);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export function verifyEncryptedDatabase(
  filePath: string,
  crypto: CryptoService,
  expectedCounts: Record<string, number>
): void {
  const db = openSqlCipherDatabase(filePath, crypto);
  try {
    if (!integrityOk(db)) {
      throw new Error('Encrypted database failed integrity_check');
    }
    const actual = tableCounts(db);
    for (const table of USER_TABLES) {
      if (actual[table] !== expectedCounts[table]) {
        throw new Error(
          `Encrypted table ${table} count ${actual[table]} !== ${expectedCounts[table]}`
        );
      }
    }
  } finally {
    checkpointAndClose(db);
  }
}

function copyFileIfExists(fromPath: string, toPath: string): void {
  if (fs.existsSync(fromPath)) {
    fs.copyFileSync(fromPath, toPath);
    fs.chmodSync(toPath, 0o600);
  }
}

function removeSqliteSidecars(filePath: string): void {
  for (const suffix of ['-wal', '-shm'] as const) {
    const sidecar = `${filePath}${suffix}`;
    if (fs.existsSync(sidecar)) {
      fs.unlinkSync(sidecar);
    }
  }
}

export function backupPlaintextSqlite(dbPath: string, backupPath: string): void {
  copyFileIfExists(dbPath, backupPath);
  copyFileIfExists(`${dbPath}-wal`, `${backupPath}-wal`);
  copyFileIfExists(`${dbPath}-shm`, `${backupPath}-shm`);
}

export function restorePlaintextBackup(dbPath: string, backupPath: string): void {
  if (!fs.existsSync(backupPath)) {
    return;
  }
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
  removeSqliteSidecars(dbPath);
  fs.copyFileSync(backupPath, dbPath);
  fs.chmodSync(dbPath, 0o600);
  copyFileIfExists(`${backupPath}-wal`, `${dbPath}-wal`);
  copyFileIfExists(`${backupPath}-shm`, `${dbPath}-shm`);
}

export function migratePlaintextToSqlCipher(
  dbPath: string,
  crypto: CryptoService,
  logger: { warn: (message: string, extra?: unknown) => void }
): { migrated: boolean; backupPath: string | null } {
  const backupPath = `${dbPath}.pre-sqlcipher`;
  const newPath = `${dbPath}.new`;

  try {
    const plaintext = new Database(dbPath);
    try {
      plaintext.pragma('wal_checkpoint(TRUNCATE)');
    } catch (error) {
      logger.warn('WAL checkpoint before SQLCipher migrate failed:', error);
    }
    const expectedCounts = tableCounts(plaintext);
    checkpointAndClose(plaintext);

    backupPlaintextSqlite(dbPath, backupPath);

    if (fs.existsSync(newPath)) {
      fs.unlinkSync(newPath);
    }
    removeSqliteSidecars(newPath);

    const source = new Database(dbPath, { readonly: true });
    const dest = new Database(newPath);
    try {
      applySqlCipherKey(dest, crypto);
      dest.pragma('journal_mode = WAL');
      copySchemaAndRows(source, dest);
      if (!integrityOk(dest)) {
        throw new Error('Migrated database failed integrity_check');
      }
      const destCounts = tableCounts(dest);
      for (const table of USER_TABLES) {
        if (destCounts[table] !== expectedCounts[table]) {
          throw new Error(`Count mismatch for ${table} during SQLCipher migrate`);
        }
      }
    } finally {
      checkpointAndClose(source);
      try {
        checkpointAndClose(dest);
      } catch {
        try {
          dest.close();
        } catch {
          /* already closed */
        }
      }
    }

    verifyEncryptedDatabase(newPath, crypto, expectedCounts);

    const replacedPath = `${dbPath}.replaced-plaintext`;
    if (fs.existsSync(replacedPath)) {
      fs.unlinkSync(replacedPath);
    }
    fs.renameSync(dbPath, replacedPath);
    removeSqliteSidecars(dbPath);
    fs.renameSync(newPath, dbPath);
    removeSqliteSidecars(newPath);

    verifyEncryptedDatabase(dbPath, crypto, expectedCounts);

    try {
      fs.unlinkSync(replacedPath);
      removeSqliteSidecars(replacedPath);
    } catch (error) {
      logger.warn('Failed to remove replaced plaintext sqlite file:', error);
    }

    try {
      fs.unlinkSync(backupPath);
      removeSqliteSidecars(backupPath);
    } catch (error) {
      logger.warn('Failed to remove SQLCipher pre-migration backup:', error);
    }

    return { migrated: true, backupPath: null };
  } catch (error) {
    logger.warn('SQLCipher migration failed; leaving plaintext database in place:', error);
    try {
      if (fs.existsSync(newPath)) {
        fs.unlinkSync(newPath);
      }
      removeSqliteSidecars(newPath);
    } catch {
      /* ignore cleanup errors */
    }
    if (fs.existsSync(backupPath)) {
      restorePlaintextBackup(dbPath, backupPath);
    }
    return { migrated: false, backupPath: fs.existsSync(backupPath) ? backupPath : null };
  }
}

export function restoreFromPreSqlCipherBackup(
  dbPath: string,
  logger: { warn: (message: string, extra?: unknown) => void }
): boolean {
  const backupPath = `${dbPath}.pre-sqlcipher`;
  if (!fs.existsSync(backupPath)) {
    return false;
  }
  try {
    restorePlaintextBackup(dbPath, backupPath);
    return true;
  } catch (error) {
    logger.warn('Failed to restore plaintext sqlite backup:', error);
    return false;
  }
}

export function preSqlCipherBackupPath(dbPath: string): string {
  return `${dbPath}.pre-sqlcipher`;
}

export function sqlCipherNewPath(dbPath: string): string {
  return `${dbPath}.new`;
}

export function dirnameMode700(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}
