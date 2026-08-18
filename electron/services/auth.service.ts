import { systemPreferences, safeStorage } from 'electron';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { CryptoService } from './crypto.service';
import { logger } from './logger.service';

const MIN_PASSWORD_LENGTH = 12;

function zeroUtf8Copy(value: string): void {
  Buffer.from(value, 'utf8').fill(0);
}

interface AuthConfig {
  salt: string;
  passwordHash: string;
  biometricEnabled: boolean;
  recoveryKeyHash: string;
  encryptedKeyBackup: string;
  recoverySalt?: string; // Per-user salt for recovery key derivation (required for recovery)
}

export class AuthService {
  private crypto: CryptoService;
  private config: AuthConfig | null = null;
  private isUnlocked = false;
  private configPath: string;
  private autoLockTimer: NodeJS.Timeout | null = null;
  private autoLockMinutes = 0;
  private onLockListener: (() => void) | null = null;
  private pendingRecoveryKey: string | null = null;
  private failedAttempts = new Map<string, { count: number; lockedUntil: number }>();

  constructor() {
    this.crypto = new CryptoService();
    const userDataPath = app.getPath('userData');
    this.configPath = path.join(userDataPath, 'auth.config');
    this.loadConfig();
  }

  private loadConfig(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        this.config = JSON.parse(data);
      }
    } catch (error) {
      logger.warn('Failed to load auth config:', error);
      this.config = null;
    }
  }

  private saveConfig(): void {
    if (!this.config) return;
    
    const userDataPath = app.getPath('userData');
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true, mode: 0o700 });
    }
    
    // Write with restrictive permissions (owner read/write only)
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), { mode: 0o600 });
  }

  isFirstTimeSetup(): boolean {
    return this.config === null;
  }

  async createMasterPassword(password: string): Promise<{ 
    success: boolean; 
    recoveryKey?: string;
    error?: string 
  }> {
    if (password.length < MIN_PASSWORD_LENGTH) {
      return { success: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` };
    }

    try {
      const salt = this.crypto.generateSalt();
      const recoverySalt = this.crypto.generateSalt(); // Unique per-user recovery salt
      const passwordHash = await this.crypto.hashPassword(password, salt);
      const encryptionKey = await this.crypto.deriveKey(password, salt);
      
      const recoveryKey = this.crypto.generateRecoveryKey();
      const recoveryKeyHash = await this.crypto.hashPassword(
        recoveryKey.toLowerCase().trim(),
        recoverySalt
      );
      
      const recoveryDerivedKey = await this.crypto.deriveKeyFromRecovery(recoveryKey, recoverySalt);
      const keyHex = encryptionKey.toString('hex');
      const encryptedKeyBackup = this.crypto.encryptWithKey(keyHex, recoveryDerivedKey);
      zeroUtf8Copy(keyHex);
      
      this.config = {
        salt,
        passwordHash,
        biometricEnabled: false,
        recoveryKeyHash,
        encryptedKeyBackup,
        recoverySalt,
      };
      
      this.saveConfig();
      this.crypto.setEncryptionKey(encryptionKey);
      this.crypto.setMasterPasswordHash(passwordHash);
      this.isUnlocked = true;
      
      this.pendingRecoveryKey = recoveryKey;
      
      return { success: true, recoveryKey };
    } catch {
      return { success: false, error: 'Failed to create master password' };
    }
  }

  getPendingRecoveryKey(): string | null {
    return this.pendingRecoveryKey;
  }

  clearPendingRecoveryKey(): void {
    this.pendingRecoveryKey = null;
  }

  revertFirstTimeSetup(): void {
    this.config = null;
    this.isUnlocked = false;
    this.pendingRecoveryKey = null;
    this.crypto.clearKey();

    try {
      if (fs.existsSync(this.configPath)) {
        fs.unlinkSync(this.configPath);
      }
    } catch (error) {
      logger.warn('Failed to remove auth config during setup rollback:', error);
    }
  }

  private checkRateLimit(channel: string): { success: false; error: string } | null {
    const state = this.failedAttempts.get(channel);
    if (!state) {
      return null;
    }

    const now = Date.now();
    if (state.lockedUntil > now) {
      const seconds = Math.ceil((state.lockedUntil - now) / 1000);
      return { success: false, error: `Too many attempts. Try again in ${seconds} seconds.` };
    }

    if (state.lockedUntil > 0 && state.lockedUntil <= now) {
      this.failedAttempts.delete(channel);
    }

    return null;
  }

  private recordFailedAttempt(channel: string): void {
    const state = this.failedAttempts.get(channel) ?? { count: 0, lockedUntil: 0 };
    state.count += 1;

    if (state.count >= 15) {
      state.lockedUntil = Date.now() + 5 * 60 * 1000;
    } else if (state.count >= 5) {
      const delaySeconds = Math.min(30, 2 ** (state.count - 5));
      state.lockedUntil = Date.now() + delaySeconds * 1000;
    }

    this.failedAttempts.set(channel, state);
  }

  private clearFailedAttempts(channel?: string): void {
    if (channel) {
      this.failedAttempts.delete(channel);
      return;
    }
    this.failedAttempts.clear();
  }

  async unlock(password: string): Promise<{ success: boolean; error?: string }> {
    if (!this.config) {
      return { success: false, error: 'No master password set' };
    }

    const rateLimitError = this.checkRateLimit('unlock');
    if (rateLimitError) {
      return rateLimitError;
    }

    try {
      const passwordHash = await this.crypto.hashPassword(password, this.config.salt);
      
      if (!this.crypto.secureCompare(passwordHash, this.config.passwordHash)) {
        this.recordFailedAttempt('unlock');
        return { success: false, error: 'Invalid password' };
      }
      
      const encryptionKey = await this.crypto.deriveKey(password, this.config.salt);
      this.crypto.setEncryptionKey(encryptionKey);
      this.crypto.setMasterPasswordHash(passwordHash);
      this.isUnlocked = true;
      this.clearFailedAttempts('unlock');
      this.resetAutoLock(this.autoLockMinutes);
      
      return { success: true };
    } catch {
      return { success: false, error: 'Failed to unlock' };
    }
  }

  async verifyRecoveryKey(recoveryKey: string): Promise<{ success: boolean; error?: string }> {
    if (!this.config) {
      return { success: false, error: 'No account configured' };
    }

    const rateLimitError = this.checkRateLimit('verify-recovery');
    if (rateLimitError) {
      return rateLimitError;
    }

    try {
      const normalizedKey = recoveryKey.toLowerCase().trim();
      const matches = await this.recoveryKeyHashMatches(normalizedKey);
      
      if (!matches) {
        this.recordFailedAttempt('verify-recovery');
        return { success: false, error: 'Invalid recovery key' };
      }

      this.clearFailedAttempts('verify-recovery');
      
      return { success: true };
    } catch {
      return { success: false, error: 'Failed to verify recovery key' };
    }
  }

  private async recoveryKeyHashMatches(normalizedKey: string): Promise<boolean> {
    if (!this.config) {
      return false;
    }
    const salts: string[] = [];
    if (this.config.recoverySalt) {
      salts.push(this.config.recoverySalt);
    }
    if (!salts.includes(this.config.salt)) {
      salts.push(this.config.salt);
    }
    for (const salt of salts) {
      const hash = await this.crypto.hashPassword(normalizedKey, salt);
      if (this.crypto.secureCompare(hash, this.config.recoveryKeyHash)) {
        return true;
      }
    }
    return false;
  }

  async resetPasswordWithRecoveryKey(
    recoveryKey: string, 
    newPassword: string
  ): Promise<{ success: boolean; newRecoveryKey?: string; error?: string }> {
    if (!this.config) {
      return { success: false, error: 'No account configured' };
    }

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return { success: false, error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` };
    }

    const rateLimitError = this.checkRateLimit('reset-recovery');
    if (rateLimitError) {
      return rateLimitError;
    }

    try {
      const normalizedKey = recoveryKey.toLowerCase().trim();
      const matches = await this.recoveryKeyHashMatches(normalizedKey);
      
      if (!matches) {
        this.recordFailedAttempt('reset-recovery');
        return { success: false, error: 'Invalid recovery key' };
      }

      if (!this.config.recoverySalt) {
        return {
          success: false,
          error: 'This account is missing a recovery salt and cannot reset the password.',
        };
      }

      this.clearFailedAttempts('reset-recovery');
      
      const recoveryDerivedKey = await this.crypto.deriveKeyFromRecovery(
        normalizedKey,
        this.config.recoverySalt
      );
      const encryptionKeyHex = this.crypto.decryptWithKey(
        this.config.encryptedKeyBackup,
        recoveryDerivedKey
      );
      const encryptionKey = Buffer.from(encryptionKeyHex, 'hex');
      zeroUtf8Copy(encryptionKeyHex);
      
      const newSalt = this.crypto.generateSalt();
      const newRecoverySalt = this.crypto.generateSalt(); // New unique recovery salt
      const newPasswordHash = await this.crypto.hashPassword(newPassword, newSalt);
      
      const newRecoveryKey = this.crypto.generateRecoveryKey();
      const newRecoveryKeyHash = await this.crypto.hashPassword(
        newRecoveryKey.toLowerCase().trim(),
        newRecoverySalt
      );
      
      const newRecoveryDerivedKey = await this.crypto.deriveKeyFromRecovery(newRecoveryKey, newRecoverySalt);
      const keyHex = encryptionKey.toString('hex');
      const newEncryptedKeyBackup = this.crypto.encryptWithKey(keyHex, newRecoveryDerivedKey);
      zeroUtf8Copy(keyHex);
      
      this.config = {
        salt: newSalt,
        passwordHash: newPasswordHash,
        biometricEnabled: false,
        recoveryKeyHash: newRecoveryKeyHash,
        encryptedKeyBackup: newEncryptedKeyBackup,
        recoverySalt: newRecoverySalt,
      };
      
      this.saveConfig();
      this.crypto.setEncryptionKey(encryptionKey);
      this.crypto.setMasterPasswordHash(newPasswordHash);
      this.isUnlocked = true;
      
      const keyPath = path.join(app.getPath('userData'), 'biometric.key');
      if (fs.existsSync(keyPath)) {
        fs.unlinkSync(keyPath);
      }
      
      this.pendingRecoveryKey = newRecoveryKey;
      
      return { success: true, newRecoveryKey };
    } catch (error) {
      logger.error('Recovery failed:', error);
      return { success: false, error: 'Failed to reset password. Please check your recovery key.' };
    }
  }

  async unlockWithBiometric(): Promise<{ success: boolean; error?: string }> {
    if (!this.config?.biometricEnabled) {
      return { success: false, error: 'Biometric not enabled' };
    }

    try {
      if (process.platform === 'darwin') {
        await systemPreferences.promptTouchID('Unlock Budget Optimizer');
      } else {
        return { success: false, error: 'Biometric not supported on this platform' };
      }

      if (safeStorage.isEncryptionAvailable()) {
        const encryptedKey = this.loadBiometricKey();
        if (encryptedKey) {
          const keyBuffer = safeStorage.decryptString(Buffer.from(encryptedKey, 'base64'));
          this.crypto.setEncryptionKey(Buffer.from(keyBuffer, 'hex'));
          this.isUnlocked = true;
          this.resetAutoLock(this.autoLockMinutes);
          return { success: true };
        }
      }
      
      return { success: false, error: 'Failed to retrieve key' };
    } catch {
      return { success: false, error: 'Biometric authentication failed' };
    }
  }

  async enableBiometric(): Promise<{ success: boolean; error?: string }> {
    if (!this.isUnlocked || !this.config) {
      return { success: false, error: 'App must be unlocked first' };
    }

    try {
      if (process.platform === 'darwin') {
        // Try to prompt Touch ID directly - it will fail with a clear error if unavailable
        // This works better than canPromptTouchID() which may return false in dev/unsigned builds
        await systemPreferences.promptTouchID('Enable fingerprint unlock');
      } else {
        return { success: false, error: 'Biometric not supported on this platform' };
      }

      if (safeStorage.isEncryptionAvailable()) {
        const keyHex = this.crypto.getEncryptionKeyHex();
        if (keyHex) {
          const encrypted = safeStorage.encryptString(keyHex);
          zeroUtf8Copy(keyHex);
          this.saveBiometricKey(encrypted.toString('base64'));
          
          this.config.biometricEnabled = true;
          this.saveConfig();
          
          return { success: true };
        }
      }
      
      return { success: false, error: 'Failed to store key securely' };
    } catch {
      return { success: false, error: 'Failed to enable biometric' };
    }
  }

  private loadBiometricKey(): string | null {
    const keyPath = path.join(app.getPath('userData'), 'biometric.key');
    try {
      if (fs.existsSync(keyPath)) {
        return fs.readFileSync(keyPath, 'utf8');
      }
    } catch {
      // Ignore errors
    }
    return null;
  }

  private saveBiometricKey(encryptedKey: string): void {
    const keyPath = path.join(app.getPath('userData'), 'biometric.key');
    fs.writeFileSync(keyPath, encryptedKey, { mode: 0o600 });
  }

  lock(): void {
    const wasUnlocked = this.isUnlocked;
    this.crypto.clearKey();
    this.isUnlocked = false;
    this.clearFailedAttempts();
    if (this.autoLockTimer) {
      clearTimeout(this.autoLockTimer);
      this.autoLockTimer = null;
    }
    if (wasUnlocked) {
      this.onLockListener?.();
    }
  }

  setOnLock(listener: (() => void) | null): void {
    this.onLockListener = listener;
  }

  getIsUnlocked(): boolean {
    return this.isUnlocked;
  }

  isBiometricEnabled(): boolean {
    return this.config?.biometricEnabled ?? false;
  }

  getCryptoService(): CryptoService {
    return this.crypto;
  }

  async changePassword(
    oldPassword: string, 
    newPassword: string
  ): Promise<{ success: boolean; newRecoveryKey?: string; error?: string }> {
    if (!this.config) {
      return { success: false, error: 'No master password set' };
    }

    const oldHash = await this.crypto.hashPassword(oldPassword, this.config.salt);
    if (!this.crypto.secureCompare(oldHash, this.config.passwordHash)) {
      return { success: false, error: 'Current password is incorrect' };
    }

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return { success: false, error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` };
    }

    try {
      const keyHex = this.crypto.getEncryptionKeyHex();
      if (!keyHex || !this.crypto.hasEncryptionKey()) {
        return { success: false, error: 'App must be unlocked first' };
      }

      const newSalt = this.crypto.generateSalt();
      const newRecoverySalt = this.crypto.generateSalt(); // New unique recovery salt
      const newHash = await this.crypto.hashPassword(newPassword, newSalt);

      const newRecoveryKey = this.crypto.generateRecoveryKey();
      const newRecoveryKeyHash = await this.crypto.hashPassword(
        newRecoveryKey.toLowerCase().trim(),
        newRecoverySalt
      );
      
      const newRecoveryDerivedKey = await this.crypto.deriveKeyFromRecovery(newRecoveryKey, newRecoverySalt);
      const newEncryptedKeyBackup = this.crypto.encryptWithKey(keyHex, newRecoveryDerivedKey);
      zeroUtf8Copy(keyHex);

      this.config.salt = newSalt;
      this.config.passwordHash = newHash;
      this.config.biometricEnabled = false;
      this.config.recoveryKeyHash = newRecoveryKeyHash;
      this.config.encryptedKeyBackup = newEncryptedKeyBackup;
      this.config.recoverySalt = newRecoverySalt;
      
      this.saveConfig();
      
      const keyPath = path.join(app.getPath('userData'), 'biometric.key');
      if (fs.existsSync(keyPath)) {
        fs.unlinkSync(keyPath);
      }
      
      this.pendingRecoveryKey = newRecoveryKey;
      
      return { success: true, newRecoveryKey };
    } catch {
      return { success: false, error: 'Failed to change password' };
    }
  }

  setAutoLock(minutes: number): void {
    this.autoLockMinutes = minutes;
    this.resetAutoLock(minutes);
  }

  resetAutoLock(minutes?: number): void {
    const effectiveMinutes = minutes ?? this.autoLockMinutes;
    this.autoLockMinutes = effectiveMinutes;

    if (this.autoLockTimer) {
      clearTimeout(this.autoLockTimer);
      this.autoLockTimer = null;
    }

    if (this.isUnlocked && effectiveMinutes > 0) {
      this.autoLockTimer = setTimeout(() => {
        this.lock();
      }, effectiveMinutes * 60 * 1000);
    }
  }

  recordActivity(): void {
    if (this.isUnlocked) {
      this.resetAutoLock();
    }
  }
}
