import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { CryptoService } from '../../../electron/services/crypto.service';

const tempRoot = path.join(os.tmpdir(), `budget-optimizer-auth-test-${process.pid}`);

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => tempRoot),
  },
  systemPreferences: {
    promptTouchID: vi.fn(),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
}));

vi.mock('../../../electron/services/logger.service', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { AuthService } from '../../../electron/services/auth.service';

function writeLegacyAuthConfig(crypto: CryptoService, password: string, recoveryKey: string) {
  const salt = crypto.generateSalt();
  const encryptionKey = crypto.deriveKey(password, salt);
  const recoverySalt = crypto.generateSalt();
  const recoveryDerivedKey = crypto.deriveKeyFromRecovery(recoveryKey, recoverySalt);
  const encryptedKeyBackup = crypto.encryptWithKey(
    encryptionKey.toString('hex'),
    recoveryDerivedKey
  );

  const config = {
    salt,
    passwordHash: crypto.hashPassword(password, salt),
    biometricEnabled: false,
    recoveryKeyHash: crypto.hashPassword(recoveryKey.toLowerCase().trim(), salt),
    encryptedKeyBackup,
    recoverySalt,
  };

  fs.mkdirSync(tempRoot, { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    path.join(tempRoot, 'auth.config'),
    JSON.stringify(config, null, 2),
    { mode: 0o600 }
  );

  return { salt, encryptionKey, config, recoveryKey };
}

describe('AuthService recovery salt', () => {
  beforeEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('stores per-user recoverySalt on new accounts', async () => {
    const auth = new AuthService();
    const created = await auth.createMasterPassword('testpassword123');

    expect(created.success).toBe(true);

    const saved = JSON.parse(
      fs.readFileSync(path.join(tempRoot, 'auth.config'), 'utf8')
    ) as { recoverySalt?: string };

    expect(saved.recoverySalt).toMatch(/^[0-9a-f]{64}$/);
  });

  it('requires recoverySalt when deriving recovery keys', () => {
    const crypto = new CryptoService();
    const recoveryKey = crypto.generateRecoveryKey();
    const recoverySalt = crypto.generateSalt();

    expect(() => crypto.deriveKeyFromRecovery(recoveryKey, '')).toThrow(
      'Recovery salt is required'
    );
    expect(crypto.deriveKeyFromRecovery(recoveryKey, recoverySalt)).toBeInstanceOf(Buffer);
  });

  it('rejects password reset for configs missing recoverySalt', async () => {
    const crypto = new CryptoService();
    const password = 'testpassword123';
    const recoveryKey = crypto.generateRecoveryKey();
    writeLegacyAuthConfig(crypto, password, recoveryKey);

    const configPath = path.join(tempRoot, 'auth.config');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    delete config.recoverySalt;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });

    const auth = new AuthService();
    const result = await auth.resetPasswordWithRecoveryKey(recoveryKey, 'newpassword456');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/recovery salt/i);
  });

  it('resets password when recoverySalt is present', async () => {
    const crypto = new CryptoService();
    const password = 'testpassword123';
    const recoveryKey = crypto.generateRecoveryKey();
    writeLegacyAuthConfig(crypto, password, recoveryKey);

    const auth = new AuthService();
    const result = await auth.resetPasswordWithRecoveryKey(recoveryKey, 'newpassword456');

    expect(result.success).toBe(true);
    expect(result.newRecoveryKey).toBeTruthy();

    const saved = JSON.parse(
      fs.readFileSync(path.join(tempRoot, 'auth.config'), 'utf8')
    ) as { recoverySalt?: string };

    expect(saved.recoverySalt).toMatch(/^[0-9a-f]{64}$/);
  });
});
