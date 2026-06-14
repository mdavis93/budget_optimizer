import { describe, it, expect } from 'vitest';
import {
  validateSettings,
  validateGoal,
  validateDebt,
  validateBudget,
  validateDraftOverlay,
  validateReconciliationFix,
  validateReconciliationFixes,
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

  it('validates reconciliation fix payloads', () => {
    expect(validateReconciliationFix({
      id: 'fix-1',
      type: 'move_bill',
      billId: 'draft-12345678-abcd',
      billDueDate: '2026-03-15',
      fromPaycheckDate: '2026-03-01',
      toPaycheckDate: '2026-02-15',
    }).valid).toBe(true);

    expect(validateReconciliationFix({
      id: 'fix-2',
      type: 'skip_bill',
      billId: 'draft-12345678-abcd',
      billDueDate: '2026-03-15',
      fromPaycheckDate: '2026-03-01',
    }).valid).toBe(true);

    expect(validateReconciliationFixes([{
      id: 'fix-bad',
      type: 'move_bill',
      billId: 'bad',
      billDueDate: '2026-03-15',
      fromPaycheckDate: '2026-03-01',
    }]).valid).toBe(false);
  });
});
