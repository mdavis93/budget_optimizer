import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { safeStorage, systemPreferences } from 'electron';
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
    vi.clearAllMocks();
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

describe('AuthService lock and password paths', () => {
  beforeEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe('happy', () => {
    it('locks and reports unlocked state transitions', async () => {
      const auth = new AuthService();
      await auth.createMasterPassword('testpassword123');
      expect(auth.getIsUnlocked()).toBe(true);

      auth.lock();
      expect(auth.getIsUnlocked()).toBe(false);

      const unlocked = await auth.unlock('testpassword123');
      expect(unlocked).toEqual({ success: true });
      expect(auth.getIsUnlocked()).toBe(true);
    });

    it('enables biometric and unlocks with stored biometric key', async () => {
      vi.mocked(systemPreferences.promptTouchID).mockResolvedValue(undefined);
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
      vi.mocked(safeStorage.encryptString).mockImplementation((value: string) => Buffer.from(`enc:${value}`));
      vi.mocked(safeStorage.decryptString).mockImplementation((buf: Buffer) => {
        const encoded = buf.toString('utf8');
        return encoded.startsWith('enc:') ? encoded.slice(4) : encoded;
      });

      const auth = new AuthService();
      await auth.createMasterPassword('testpassword123');

      const enable = await auth.enableBiometric();
      expect(enable).toEqual({ success: true });
      expect(auth.isBiometricEnabled()).toBe(true);

      auth.lock();
      expect(auth.getIsUnlocked()).toBe(false);

      const unlocked = await auth.unlockWithBiometric();
      expect(unlocked).toEqual({ success: true });
      expect(auth.getIsUnlocked()).toBe(true);
    });
  });

  describe('sad', () => {
    it('rejects master password creation when too short', async () => {
      const auth = new AuthService();
      const result = await auth.createMasterPassword('short');
      expect(result).toEqual({ success: false, error: 'Password must be at least 8 characters' });
    });

    it('rejects unlock with wrong password and keeps app locked', async () => {
      const auth = new AuthService();
      await auth.createMasterPassword('testpassword123');
      auth.lock();

      const result = await auth.unlock('wrong-password');
      expect(result).toEqual({ success: false, error: 'Invalid password' });
      expect(auth.getIsUnlocked()).toBe(false);
    });

    it('rejects unlock when no account is configured', async () => {
      const auth = new AuthService();
      const result = await auth.unlock('anything');
      expect(result).toEqual({ success: false, error: 'No master password set' });
    });

    it('rejects biometric unlock when biometric is disabled', async () => {
      const auth = new AuthService();
      await auth.createMasterPassword('testpassword123');
      auth.lock();

      const result = await auth.unlockWithBiometric();
      expect(result).toEqual({ success: false, error: 'Biometric not enabled' });
    });

    it('returns retrieve key error when biometric key is unavailable', async () => {
      vi.mocked(systemPreferences.promptTouchID).mockResolvedValue(undefined);
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);

      const auth = new AuthService();
      await auth.createMasterPassword('testpassword123');
      await auth.enableBiometric();
      auth.lock();

      const keyPath = path.join(tempRoot, 'biometric.key');
      if (fs.existsSync(keyPath)) {
        fs.unlinkSync(keyPath);
      }

      const result = await auth.unlockWithBiometric();
      expect(result).toEqual({ success: false, error: 'Failed to retrieve key' });
    });

    it('rejects biometric enable while locked', async () => {
      const auth = new AuthService();
      const result = await auth.enableBiometric();
      expect(result).toEqual({ success: false, error: 'App must be unlocked first' });
    });

    it('rejects verify/reset recovery key when account is missing', async () => {
      const auth = new AuthService();
      await expect(auth.verifyRecoveryKey('key')).resolves.toEqual({
        success: false,
        error: 'No account configured',
      });
      await expect(auth.resetPasswordWithRecoveryKey('key', 'newpassword456')).resolves.toEqual({
        success: false,
        error: 'No account configured',
      });
    });

    it('enforces unlock rate limit and recovers after lock window', async () => {
      vi.useFakeTimers();
      try {
        const auth = new AuthService();
        await auth.createMasterPassword('testpassword123');
        auth.lock();

        for (let i = 0; i < 5; i++) {
          await auth.unlock('wrong-password');
        }
        const limited = await auth.unlock('wrong-password');
        expect(limited.success).toBe(false);
        expect(limited.error).toMatch(/Too many attempts/);

        vi.setSystemTime(Date.now() + 31_000);
        const recovered = await auth.unlock('testpassword123');
        expect(recovered).toEqual({ success: true });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('hostile', () => {
    it('returns error when changing password without configured account', async () => {
      const auth = new AuthService();
      const result = await auth.changePassword('anything', 'newpassword456');
      expect(result).toEqual({ success: false, error: 'No master password set' });
    });

    it('rejects changePassword for wrong current password', async () => {
      const auth = new AuthService();
      await auth.createMasterPassword('testpassword123');

      const result = await auth.changePassword('bad-current', 'newpassword456');
      expect(result).toEqual({ success: false, error: 'Current password is incorrect' });
    });

    it('rejects changePassword when new password is too short', async () => {
      const auth = new AuthService();
      await auth.createMasterPassword('testpassword123');

      const result = await auth.changePassword('testpassword123', 'short');
      expect(result).toEqual({ success: false, error: 'New password must be at least 8 characters' });
    });

    it('rejects changePassword when app is locked (no encryption key)', async () => {
      const auth = new AuthService();
      await auth.createMasterPassword('testpassword123');
      auth.lock();

      const result = await auth.changePassword('testpassword123', 'newpassword456');
      expect(result).toEqual({ success: false, error: 'App must be unlocked first' });
    });

    it('rejects resetPasswordWithRecoveryKey with invalid recovery key', async () => {
      const auth = new AuthService();
      await auth.createMasterPassword('testpassword123');

      const result = await auth.resetPasswordWithRecoveryKey('not-the-key', 'newpassword456');
      expect(result).toEqual({ success: false, error: 'Invalid recovery key' });
    });

    it('rejects resetPasswordWithRecoveryKey with short new password', async () => {
      const auth = new AuthService();
      await auth.createMasterPassword('testpassword123');
      const recoveryKey = auth.getPendingRecoveryKey();
      expect(recoveryKey).toBeTruthy();

      const result = await auth.resetPasswordWithRecoveryKey(recoveryKey!, 'short');
      expect(result).toEqual({ success: false, error: 'New password must be at least 8 characters' });
    });

    it('clears pending recovery key and setup on rollback', async () => {
      const auth = new AuthService();
      await auth.createMasterPassword('testpassword123');
      expect(auth.getPendingRecoveryKey()).toBeTruthy();
      expect(auth.isFirstTimeSetup()).toBe(false);

      auth.clearPendingRecoveryKey();
      expect(auth.getPendingRecoveryKey()).toBeNull();

      auth.revertFirstTimeSetup();
      expect(auth.isFirstTimeSetup()).toBe(true);
      expect(auth.getIsUnlocked()).toBe(false);
    });

    it('fails biometric enable when secure storage is unavailable', async () => {
      vi.mocked(systemPreferences.promptTouchID).mockResolvedValue(undefined);
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);

      const auth = new AuthService();
      await auth.createMasterPassword('testpassword123');
      const result = await auth.enableBiometric();
      expect(result).toEqual({ success: false, error: 'Failed to store key securely' });
    });

    it('returns unsupported biometric errors on non-darwin platforms', async () => {
      const original = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux' });
      try {
        const auth = new AuthService();
        await auth.createMasterPassword('testpassword123');

        const enable = await auth.enableBiometric();
        expect(enable).toEqual({ success: false, error: 'Biometric not supported on this platform' });

        (auth as any).config.biometricEnabled = true;
        auth.lock();
        const unlock = await auth.unlockWithBiometric();
        expect(unlock).toEqual({ success: false, error: 'Biometric not supported on this platform' });
      } finally {
        Object.defineProperty(process, 'platform', { value: original });
      }
    });

    it('auto-locks after timeout and refreshes on activity', async () => {
      vi.useFakeTimers();
      try {
        const auth = new AuthService();
        await auth.createMasterPassword('testpassword123');
        auth.setAutoLock(1);

        vi.advanceTimersByTime(30_000);
        auth.recordActivity();
        vi.advanceTimersByTime(40_000);
        expect(auth.getIsUnlocked()).toBe(true);

        vi.advanceTimersByTime(21_000);
        expect(auth.getIsUnlocked()).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('changes password successfully and returns a new recovery key', async () => {
      const auth = new AuthService();
      await auth.createMasterPassword('testpassword123');

      const changed = await auth.changePassword('testpassword123', 'newpassword456');
      expect(changed.success).toBe(true);
      expect(changed.newRecoveryKey).toBeTruthy();

      auth.lock();
      await expect(auth.unlock('testpassword123')).resolves.toEqual({
        success: false,
        error: 'Invalid password',
      });
      await expect(auth.unlock('newpassword456')).resolves.toEqual({ success: true });
    });

    it('returns change-password failure when config persistence throws', async () => {
      const auth = new AuthService();
      await auth.createMasterPassword('testpassword123');
      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
        throw new Error('disk full');
      });
      try {
        const result = await auth.changePassword('testpassword123', 'newpassword456');
        expect(result).toEqual({ success: false, error: 'Failed to change password' });
      } finally {
        writeSpy.mockRestore();
      }
    });
  });
});
