import { describe, it, expect } from 'vitest';
import {
  validateSettings,
  validateGoal,
  validateDebt,
  validateBudget,
  validateDraftOverlay,
} from '../../../electron/services/validation.service';

describe('validation.service', () => {
  it('rejects dangerous and unknown settings keys', () => {
    const result = validateSettings(
      JSON.parse('{"__proto__":{"polluted":true},"unknownKey":"value"}') as Record<string, unknown>
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some(error => error.includes('__proto__'))).toBe(true);
    expect(result.errors.some(error => error.includes('unknownKey'))).toBe(true);
  });

  it('validates goal, debt, and budget payloads', () => {
    expect(validateGoal({
      name: 'Emergency Fund',
      targetAmount: 1000,
      targetDate: '2026-12-31',
    }).valid).toBe(true);

    expect(validateDebt({
      billId: 'draft-12345678-abcd',
      principalBalance: 5000,
      apr: 12.5,
      monthlyPayment: 150,
    }).valid).toBe(true);

    expect(validateBudget({ name: 'Personal' }).valid).toBe(true);
  });

  it('rejects malformed draft overlay assignments', () => {
    const result = validateDraftOverlay({
      billAssignments: [{
        billId: 'bad',
        billDueDate: 'not-a-date',
        paycheckDate: '2026-01-01',
      }],
    });

    expect(result.valid).toBe(false);
  });
});
