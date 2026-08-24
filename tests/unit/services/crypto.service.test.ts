import { describe, expect, it, beforeEach } from 'vitest';
import { CryptoService } from '../../../electron/services/crypto.service';

describe('CryptoService', () => {
  let crypto: CryptoService;

  beforeEach(() => {
    crypto = new CryptoService();
  });

  it('derives keys, encrypts, and decrypts objects', async () => {
    const salt = crypto.generateSalt();
    const key = await crypto.deriveKey('test-password', salt);
    crypto.setEncryptionKey(key);

    const payload = { name: 'Budget', amount: 42 };
    const encrypted = crypto.encryptObject(payload);
    expect(crypto.decryptObject<typeof payload>(encrypted)).toEqual(payload);
  });

  it('round-trips encryptWithKey and decryptWithKey', async () => {
    const salt = crypto.generateSalt();
    const key = await crypto.deriveKey('another-password', salt);
    const ciphertext = crypto.encryptWithKey('secret-data', key);
    expect(crypto.decryptWithKey(ciphertext, key)).toBe('secret-data');
  });

  it('generates recovery keys and derives recovery encryption keys', async () => {
    const recoveryKey = crypto.generateRecoveryKey();
    expect(recoveryKey.split(' ')).toHaveLength(12);

    const salt = crypto.generateSalt();
    const derived = await crypto.deriveKeyFromRecovery(recoveryKey, salt);
    expect(derived).toHaveLength(32);
  });

  it('rejects invalid recovery salt and ciphertext formats', async () => {
    await expect(crypto.deriveKeyFromRecovery('abandon ability able', '')).rejects.toThrow(
      'Recovery salt is required'
    );
    await expect(crypto.deriveKeyFromRecovery('abandon ability able', 'not-hex')).rejects.toThrow(
      'Recovery salt is required'
    );

    const salt = crypto.generateSalt();
    const key = await crypto.deriveKey('pw', salt);
    expect(() => crypto.decryptWithKey('bad-format', key)).toThrow('Invalid ciphertext format');

    crypto.setEncryptionKey(key);
    expect(() => crypto.decrypt('also-bad')).toThrow('Invalid ciphertext format');
  });

  it('requires a set encryption key for encrypt and decrypt', () => {
    expect(() => crypto.encrypt('plain')).toThrow('Encryption key not set');
    expect(() => crypto.decrypt('iv:tag:data')).toThrow('Encryption key not set');
    expect(crypto.isKeySet()).toBe(false);
    expect(crypto.hasEncryptionKey()).toBe(false);
    expect(crypto.getEncryptionKeyHex()).toBeNull();
  });

  it('tracks master password hash and clears keys safely', async () => {
    const salt = crypto.generateSalt();
    crypto.setEncryptionKey(await crypto.deriveKey('pw', salt));
    crypto.setMasterPasswordHash('hash-value');

    expect(crypto.isKeySet()).toBe(true);
    expect(crypto.hasEncryptionKey()).toBe(true);
    expect(crypto.getEncryptionKeyHex()).toMatch(/^[0-9a-f]+$/i);
    expect(crypto.getMasterPasswordHash()).toBe('hash-value');

    crypto.clearKey();
    expect(crypto.isKeySet()).toBe(false);
    expect(crypto.hasEncryptionKey()).toBe(false);
    expect(crypto.getEncryptionKeyHex()).toBeNull();
    expect(crypto.getMasterPasswordHash()).toBeNull();
  });

  it('compares SHA-512 hex hashes in constant time', () => {
    const a = 'a'.repeat(128);
    const b = `${'a'.repeat(127)}b`;
    expect(crypto.secureCompare(a, a)).toBe(true);
    expect(crypto.secureCompare(a.toUpperCase(), a)).toBe(true);
    expect(crypto.secureCompare(a, b)).toBe(false);
    expect(crypto.secureCompare('abc', 'abc')).toBe(false);
    expect(crypto.secureCompare(a, 'not-hex')).toBe(false);
    expect(crypto.secureCompare('short', 'longer')).toBe(false);
  });

  it('derives a stable 32-byte SQLCipher raw key from the KEK', async () => {
    expect(() => crypto.deriveSqlCipherRawKey()).toThrow('Encryption key not set');

    const salt = crypto.generateSalt();
    crypto.setEncryptionKey(await crypto.deriveKey('pw', salt));
    const first = crypto.deriveSqlCipherRawKey();
    const second = crypto.deriveSqlCipherRawKey();
    expect(first).toHaveLength(32);
    expect(first.equals(second)).toBe(true);
    expect(crypto.sqlCipherKeyPragma()).toMatch(/^x'[0-9a-f]{64}'$/);
  });

  it('hashes passwords and generates ids', async () => {
    const salt = crypto.generateSalt();
    const hash = await crypto.hashPassword('pw', salt);
    expect(hash).toHaveLength(128);
    expect(crypto.generateId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });
});
