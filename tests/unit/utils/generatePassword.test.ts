import { describe, it, expect } from 'vitest';
import { generateSecurePassword } from '../../../src/utils/generatePassword';

describe('generateSecurePassword', () => {
  it('returns default length of 20 characters', () => {
    const password = generateSecurePassword();
    expect(password.length).toBe(20);
  });

  it('respects custom length', () => {
    const password = generateSecurePassword(32);
    expect(password.length).toBe(32);
  });

  it('enforces minimum length of 8', () => {
    const password = generateSecurePassword(4);
    expect(password.length).toBe(8);
  });

  it('includes upper, lower, digit, and symbol characters', () => {
    const password = generateSecurePassword();
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/[0-9]/);
    expect(password).toMatch(/[!@#$%^&*\-_=+]/);
  });

  it('generates unique passwords across calls', () => {
    const passwords = new Set(
      Array.from({ length: 50 }, () => generateSecurePassword())
    );
    expect(passwords.size).toBeGreaterThan(45);
  });
});
