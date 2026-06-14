import fs from 'fs';
import os from 'os';
import path from 'path';
import { CryptoService } from '../../electron/services/crypto.service';
import { DatabaseService } from '../../electron/services/database.service';

export function createTestDatabase(): {
  db: DatabaseService;
  crypto: CryptoService;
  tempRoot: string;
  cleanup: () => void;
} {
  const tempRoot = path.join(
    os.tmpdir(),
    `budget-optimizer-db-test-${process.pid}-${Date.now()}`
  );
  fs.mkdirSync(tempRoot, { recursive: true, mode: 0o700 });

  const crypto = new CryptoService();
  const db = new DatabaseService(crypto);
  db.initialize();

  return {
    db,
    crypto,
    tempRoot,
    cleanup: () => {
      db.close?.();
      fs.rmSync(tempRoot, { recursive: true, force: true });
    },
  };
}
