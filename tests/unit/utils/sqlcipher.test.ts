import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CryptoService } from '../../../electron/services/crypto.service';
import {
  applySqlCipherKey,
  backupPlaintextSqlite,
  checkpointAndClose,
  dirnameMode700,
  isPlaintextSqliteFile,
  migratePlaintextToSqlCipher,
  openSqlCipherDatabase,
  preSqlCipherBackupPath,
  restoreFromPreSqlCipherBackup,
  restorePlaintextBackup,
  sqlCipherNewPath,
  SQLITE_HEADER,
  verifyEncryptedDatabase,
} from '../../../electron/utils/sqlcipher';

const logger = { warn: vi.fn() };

async function createCrypto(): Promise<CryptoService> {
  const crypto = new CryptoService();
  const salt = crypto.generateSalt();
  crypto.setEncryptionKey(await crypto.deriveKey('test-password', salt));
  return crypto;
}

function writePlaintextVault(filePath: string, withRows = false): void {
  const db = new Database(filePath);
  db.exec(`
    CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
    CREATE TABLE budgets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE INDEX idx_budgets_name ON budgets(name);
  `);
  if (withRows) {
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(1);
    db.prepare('INSERT INTO budgets (id, name) VALUES (?, ?)').run('b1', 'Main');
  }
  db.close();
}

describe('sqlcipher', () => {
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = path.join(
      os.tmpdir(),
      `budget-optimizer-sqlcipher-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    fs.mkdirSync(tempRoot, { recursive: true, mode: 0o700 });
    logger.warn.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  describe('happy', () => {
    it('detects plaintext sqlite headers and missing or short files', () => {
      const missing = path.join(tempRoot, 'missing.db');
      const shortPath = path.join(tempRoot, 'short.db');
      const otherPath = path.join(tempRoot, 'other.db');
      const plainPath = path.join(tempRoot, 'plain.db');
      fs.writeFileSync(shortPath, 'nope');
      fs.writeFileSync(otherPath, Buffer.alloc(16, 1));
      writePlaintextVault(plainPath);

      expect(isPlaintextSqliteFile(missing)).toBe(false);
      expect(isPlaintextSqliteFile(shortPath)).toBe(false);
      expect(isPlaintextSqliteFile(otherPath)).toBe(false);
      expect(isPlaintextSqliteFile(plainPath)).toBe(true);
      expect(SQLITE_HEADER.length).toBe(16);
    });

    it('creates the parent directory and reports helper paths', () => {
      const nested = path.join(tempRoot, 'nested', 'vault.db');
      dirnameMode700(nested);
      dirnameMode700(nested);
      expect(fs.existsSync(path.dirname(nested))).toBe(true);
      expect(preSqlCipherBackupPath(nested)).toBe(`${nested}.pre-sqlcipher`);
      expect(sqlCipherNewPath(nested)).toBe(`${nested}.new`);
    });

    it('opens a SQLCipher database and rejects a wrong key', async () => {
      const filePath = path.join(tempRoot, 'cipher.db');
      const crypto = await createCrypto();
      const db = openSqlCipherDatabase(filePath, crypto);
      db.exec('CREATE TABLE schema_version (version INTEGER PRIMARY KEY)');
      checkpointAndClose(db);

      expect(isPlaintextSqliteFile(filePath)).toBe(false);

      const wrong = await createCrypto();
      expect(() => openSqlCipherDatabase(filePath, wrong)).toThrow();
    });

    it('backs up and restores plaintext sqlite including wal/shm sidecars', () => {
      const dbPath = path.join(tempRoot, 'plain.db');
      const backupPath = `${dbPath}.bak`;
      writePlaintextVault(dbPath);
      fs.writeFileSync(`${dbPath}-wal`, 'wal');
      fs.writeFileSync(`${dbPath}-shm`, 'shm');

      backupPlaintextSqlite(dbPath, backupPath);
      expect(fs.readFileSync(`${backupPath}-wal`, 'utf8')).toBe('wal');
      expect(fs.readFileSync(`${backupPath}-shm`, 'utf8')).toBe('shm');

      fs.writeFileSync(dbPath, 'replaced');
      fs.writeFileSync(`${dbPath}-wal`, 'stale');
      restorePlaintextBackup(dbPath, backupPath);
      expect(isPlaintextSqliteFile(dbPath)).toBe(true);
      expect(fs.readFileSync(`${dbPath}-wal`, 'utf8')).toBe('wal');
      expect(fs.readFileSync(`${dbPath}-shm`, 'utf8')).toBe('shm');

      restorePlaintextBackup(dbPath, `${dbPath}.missing`);
    });

    it('migrates a populated plaintext vault and strips leftover new/replaced files', async () => {
      const dbPath = path.join(tempRoot, 'legacy.db');
      writePlaintextVault(dbPath, true);
      fs.writeFileSync(`${dbPath}.new`, 'stale-new');
      fs.writeFileSync(`${dbPath}.new-wal`, 'wal');
      fs.writeFileSync(`${dbPath}.replaced-plaintext`, 'old');

      const result = migratePlaintextToSqlCipher(dbPath, await createCrypto(), logger);
      expect(result).toEqual({ migrated: true, backupPath: null });
      expect(isPlaintextSqliteFile(dbPath)).toBe(false);
      expect(fs.existsSync(`${dbPath}.pre-sqlcipher`)).toBe(false);
      expect(fs.existsSync(`${dbPath}.replaced-plaintext`)).toBe(false);
    });

    it('restores a pre-sqlcipher backup when present', () => {
      const dbPath = path.join(tempRoot, 'live.db');
      const backupPath = `${dbPath}.pre-sqlcipher`;
      writePlaintextVault(backupPath);
      fs.writeFileSync(dbPath, 'encrypted-placeholder');

      expect(restoreFromPreSqlCipherBackup(dbPath, logger)).toBe(true);
      expect(isPlaintextSqliteFile(dbPath)).toBe(true);
      expect(restoreFromPreSqlCipherBackup(path.join(tempRoot, 'none.db'), logger)).toBe(false);
    });
  });

  describe('sad', () => {
    it('leaves plaintext in place when SQLCipher migrate cannot create the new file', async () => {
      const dbPath = path.join(tempRoot, 'sabotaged.db');
      writePlaintextVault(dbPath, true);
      fs.mkdirSync(`${dbPath}.new`);

      const result = migratePlaintextToSqlCipher(dbPath, await createCrypto(), logger);
      expect(result.migrated).toBe(false);
      expect(isPlaintextSqliteFile(dbPath)).toBe(true);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('rejects encrypted verification when table counts do not match', async () => {
      const filePath = path.join(tempRoot, 'counts.db');
      const crypto = await createCrypto();
      const db = openSqlCipherDatabase(filePath, crypto);
      applySqlCipherKey(db, crypto);
      db.exec('CREATE TABLE schema_version (version INTEGER PRIMARY KEY)');
      checkpointAndClose(db);

      const expected = {
        schema_version: 99,
        budgets: 0,
        incomes: 0,
        bills: 0,
        goals: 0,
        debts: 0,
        leaves: 0,
        skipped_bills: 0,
        bill_assignments: 0,
        income_overrides: 0,
        settings: 0,
      };
      expect(() => verifyEncryptedDatabase(filePath, crypto, expected)).toThrow(
        /Encrypted table schema_version count/
      );
    });

    it('swallows restore errors when the pre-sqlcipher backup is not a file', () => {
      const dbPath = path.join(tempRoot, 'live.db');
      fs.mkdirSync(`${dbPath}.pre-sqlcipher`);
      expect(restoreFromPreSqlCipherBackup(dbPath, logger)).toBe(false);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('restores a backup when the live sqlite file is already gone', () => {
      const dbPath = path.join(tempRoot, 'gone.db');
      const backupPath = `${dbPath}.bak`;
      writePlaintextVault(backupPath);
      restorePlaintextBackup(dbPath, backupPath);
      expect(isPlaintextSqliteFile(dbPath)).toBe(true);
    });

    it('ignores wal checkpoint failures when closing a stub database', () => {
      const stub = {
        pragma: () => {
          throw new Error('not in WAL');
        },
        close: vi.fn(),
      };
      checkpointAndClose(stub as unknown as Database.Database);
      expect(stub.close).toHaveBeenCalled();
    });

    it('fails migrate when a table name is not a safe sqlite identifier', async () => {
      const dbPath = path.join(tempRoot, 'unsafe.db');
      const db = new Database(dbPath);
      db.exec('CREATE TABLE "bad-name" (id INTEGER PRIMARY KEY)');
      db.close();

      const result = migratePlaintextToSqlCipher(dbPath, await createCrypto(), logger);
      expect(result.migrated).toBe(false);
      expect(logger.warn.mock.calls.some((call) => String(call[1]).includes('unsafe sqlite'))).toBe(
        true
      );
    });

    it('fails migrate when dest integrity_check is not ok', async () => {
      const dbPath = path.join(tempRoot, 'integrity.db');
      writePlaintextVault(dbPath, true);
      const originalPragma = Database.prototype.pragma;
      const pragmaSpy = vi.spyOn(Database.prototype, 'pragma').mockImplementation(function (
        this: Database.Database,
        source: string,
        options?: { simple?: boolean }
      ) {
        if (String(source).includes('integrity_check')) {
          return 'not ok';
        }
        return originalPragma.call(this, source, options);
      });

      try {
        const result = migratePlaintextToSqlCipher(dbPath, await createCrypto(), logger);
        expect(result.migrated).toBe(false);
        expect(logger.warn).toHaveBeenCalled();
      } finally {
        pragmaSpy.mockRestore();
      }
    });

    it('closes dest again if checkpointAndClose throws during migrate', async () => {
      const dbPath = path.join(tempRoot, 'double-close.db');
      writePlaintextVault(dbPath);
      const originalClose = Database.prototype.close;
      let closes = 0;
      const closeSpy = vi.spyOn(Database.prototype, 'close').mockImplementation(function (
        this: Database.Database
      ) {
        closes += 1;
        if (closes === 3 || closes === 4) {
          throw new Error('dest checkpoint close failed');
        }
        originalClose.call(this);
      });

      try {
        migratePlaintextToSqlCipher(dbPath, await createCrypto(), logger);
        expect(closes).toBeGreaterThanOrEqual(3);
      } finally {
        closeSpy.mockRestore();
      }
    });

    it('returns no backup path when migrate fails before a backup is written', async () => {
      const dbPath = path.join(tempRoot, 'not-sqlite.db');
      fs.writeFileSync(dbPath, 'not-a-sqlite-database');

      const result = migratePlaintextToSqlCipher(dbPath, await createCrypto(), logger);
      expect(result).toEqual({ migrated: false, backupPath: null });
      expect(fs.existsSync(`${dbPath}.new`)).toBe(false);
      expect(fs.existsSync(`${dbPath}.pre-sqlcipher`)).toBe(false);
    });

    it('warns when WAL checkpoint fails before migrate', async () => {
      const dbPath = path.join(tempRoot, 'wal-fail.db');
      writePlaintextVault(dbPath, true);
      const originalPragma = Database.prototype.pragma;
      let walCalls = 0;
      const pragmaSpy = vi.spyOn(Database.prototype, 'pragma').mockImplementation(function (
        this: Database.Database,
        source: string,
        options?: { simple?: boolean }
      ) {
        if (String(source).includes('wal_checkpoint')) {
          walCalls += 1;
          if (walCalls === 1) {
            throw new Error('checkpoint failed');
          }
        }
        return originalPragma.call(this, source, options);
      });

      try {
        const result = migratePlaintextToSqlCipher(dbPath, await createCrypto(), logger);
        expect(result.migrated).toBe(true);
        expect(logger.warn).toHaveBeenCalled();
      } finally {
        pragmaSpy.mockRestore();
      }
    });

    it('fails migrate when dest table counts differ from the source', async () => {
      const dbPath = path.join(tempRoot, 'counts-migrate.db');
      writePlaintextVault(dbPath, true);
      const originalPrepare = Database.prototype.prepare;
      const prepareSpy = vi.spyOn(Database.prototype, 'prepare').mockImplementation(function (
        this: Database.Database,
        sql: string
      ) {
        const stmt = originalPrepare.call(this, sql);
        if (
          this.name.endsWith('.new') &&
          String(sql).includes('SELECT COUNT(*) as count FROM') &&
          String(sql).includes('schema_version')
        ) {
          return { get: () => ({ count: 999 }) } as unknown as ReturnType<typeof originalPrepare>;
        }
        return stmt;
      });

      try {
        const result = migratePlaintextToSqlCipher(dbPath, await createCrypto(), logger);
        expect(result.migrated).toBe(false);
      } finally {
        prepareSpy.mockRestore();
      }
    });

    it('rejects encrypted verification when integrity_check fails', async () => {
      const filePath = path.join(tempRoot, 'verify-integrity.db');
      const crypto = await createCrypto();
      const db = openSqlCipherDatabase(filePath, crypto);
      db.exec('CREATE TABLE schema_version (version INTEGER PRIMARY KEY)');
      checkpointAndClose(db);

      const originalPragma = Database.prototype.pragma;
      const pragmaSpy = vi.spyOn(Database.prototype, 'pragma').mockImplementation(function (
        this: Database.Database,
        source: string,
        options?: { simple?: boolean }
      ) {
        if (String(source).includes('integrity_check')) {
          return 'not ok';
        }
        return originalPragma.call(this, source, options);
      });

      try {
        expect(() =>
          verifyEncryptedDatabase(filePath, crypto, {
            schema_version: 0,
            budgets: 0,
            incomes: 0,
            bills: 0,
            goals: 0,
            debts: 0,
            leaves: 0,
            skipped_bills: 0,
            bill_assignments: 0,
            income_overrides: 0,
            settings: 0,
          })
        ).toThrow(/integrity_check/);
      } finally {
        pragmaSpy.mockRestore();
      }
    });

    it('ignores cleanup errors after a failed migrate', async () => {
      const dbPath = path.join(tempRoot, 'cleanup.db');
      writePlaintextVault(dbPath);
      fs.mkdirSync(`${dbPath}.new`);
      const unlinkSync = fs.unlinkSync.bind(fs);
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation((target) => {
        if (String(target) === `${dbPath}.new`) {
          throw new Error('busy');
        }
        unlinkSync(target);
      });

      try {
        const result = migratePlaintextToSqlCipher(dbPath, await createCrypto(), logger);
        expect(result.migrated).toBe(false);
      } finally {
        unlinkSpy.mockRestore();
      }
    });

    it('warns when leftover plaintext files cannot be unlinked after a successful migrate', async () => {
      const dbPath = path.join(tempRoot, 'unlink.db');
      writePlaintextVault(dbPath);
      const unlinkSync = fs.unlinkSync.bind(fs);
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation((target) => {
        const asPath = String(target);
        if (asPath.endsWith('.replaced-plaintext') || asPath.endsWith('.pre-sqlcipher')) {
          throw new Error('busy');
        }
        unlinkSync(target);
      });

      try {
        const result = migratePlaintextToSqlCipher(dbPath, await createCrypto(), logger);
        expect(result.migrated).toBe(true);
        expect(logger.warn).toHaveBeenCalled();
      } finally {
        unlinkSpy.mockRestore();
      }
    });
  });
});
