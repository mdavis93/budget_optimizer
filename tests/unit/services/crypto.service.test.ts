import { describe, expect, it, beforeEach } from 'vitest';
import { CryptoService } from '../../../electron/services/crypto.service';

describe('CryptoService', () => {
  let crypto: CryptoService;

  beforeEach(() => {
    crypto = new CryptoService();
  });

  it('derives keys, encrypts, and decrypts objects', () => {
    const salt = crypto.generateSalt();
    const key = crypto.deriveKey('test-password', salt);
    crypto.setEncryptionKey(key);

    const payload = { name: 'Budget', amount: 42 };
    const encrypted = crypto.encryptObject(payload);
    expect(crypto.decryptObject<typeof payload>(encrypted)).toEqual(payload);
  });

  it('round-trips encryptWithKey and decryptWithKey', () => {
    const salt = crypto.generateSalt();
    const key = crypto.deriveKey('another-password', salt);
    const ciphertext = crypto.encryptWithKey('secret-data', key);
    expect(crypto.decryptWithKey(ciphertext, key)).toBe('secret-data');
  });

  it('generates recovery keys and derives recovery encryption keys', () => {
    const recoveryKey = crypto.generateRecoveryKey();
    expect(recoveryKey.split(' ')).toHaveLength(12);

    const salt = crypto.generateSalt();
    const derived = crypto.deriveKeyFromRecovery(recoveryKey, salt);
    expect(derived).toHaveLength(32);
  });

  it('rejects invalid recovery salt and ciphertext formats', () => {
    expect(() => crypto.deriveKeyFromRecovery('abandon ability able', '')).toThrow(
      'Recovery salt is required'
    );
    expect(() => crypto.deriveKeyFromRecovery('abandon ability able', 'not-hex')).toThrow(
      'Recovery salt is required'
    );

    const salt = crypto.generateSalt();
    const key = crypto.deriveKey('pw', salt);
    expect(() => crypto.decryptWithKey('bad-format', key)).toThrow('Invalid ciphertext format');

    crypto.setEncryptionKey(key);
    expect(() => crypto.decrypt('also-bad')).toThrow('Invalid ciphertext format');
  });

  it('requires a set encryption key for encrypt and decrypt', () => {
    expect(() => crypto.encrypt('plain')).toThrow('Encryption key not set');
    expect(() => crypto.decrypt('iv:tag:data')).toThrow('Encryption key not set');
    expect(crypto.isKeySet()).toBe(false);
  });

  it('tracks master password hash and clears keys safely', () => {
    const salt = crypto.generateSalt();
    crypto.setEncryptionKey(crypto.deriveKey('pw', salt));
    crypto.setMasterPasswordHash('hash-value');

    expect(crypto.isKeySet()).toBe(true);
    expect(crypto.getMasterPasswordHash()).toBe('hash-value');

    crypto.clearKey();
    expect(crypto.isKeySet()).toBe(false);
    expect(crypto.getMasterPasswordHash()).toBeNull();
  });

  it('compares secrets in constant time', () => {
    expect(crypto.secureCompare('abc', 'abc')).toBe(true);
    expect(crypto.secureCompare('abc', 'abd')).toBe(false);
    expect(crypto.secureCompare('short', 'longer')).toBe(false);
  });

  it('hashes passwords and generates ids', () => {
    const salt = crypto.generateSalt();
    const hash = crypto.hashPassword('pw', salt);
    expect(hash).toHaveLength(128);
    expect(crypto.generateId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });
});
