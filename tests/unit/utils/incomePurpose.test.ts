import { describe, expect, it } from 'vitest';
import {
  isOperatingIncome,
  isSavingsAndGoalsIncome,
  isOperatingPaycheck,
  paycheckEntryId,
  paycheckKey,
  stripBillLinkToIncome,
  isIncomePurpose,
} from '../../../shared/incomePurpose';

describe('incomePurpose', () => {
  describe('happy', () => {
    it('treats missing purpose as operating', () => {
      expect(isOperatingIncome({ })).toBe(true);
      expect(isOperatingIncome({ purpose: 'operating' })).toBe(true);
      expect(isOperatingIncome(null)).toBe(true);
      expect(isSavingsAndGoalsIncome({ purpose: 'operating' })).toBe(false);
    });

    it('identifies savings-and-goals income and paycheck ids', () => {
      expect(isSavingsAndGoalsIncome({ purpose: 'savingsAndGoals' })).toBe(true);
      expect(isOperatingIncome({ purpose: 'savingsAndGoals' })).toBe(false);
      expect(isOperatingPaycheck({ purpose: 'savingsAndGoals' })).toBe(false);
      expect(paycheckEntryId('operating', '2026-01-15')).toBe('op:2026-01-15');
      expect(paycheckEntryId('savingsAndGoals', '2026-01-15')).toBe('sg:2026-01-15');
      expect(paycheckKey({ date: '2026-01-15' })).toBe('op:2026-01-15');
      expect(paycheckKey({ id: 'custom', date: '2026-01-15' })).toBe('custom');
    });
  });

  describe('sad', () => {
    it('rejects unknown purpose tokens', () => {
      expect(isIncomePurpose('bonus')).toBe(false);
      expect(isIncomePurpose('operating')).toBe(true);
    });
  });

  describe('hostile', () => {
    it('clears bill links aimed at a reserved source', () => {
      const stripped = stripBillLinkToIncome(
        { preferredIncomeSourceId: 'inc-1', isIncomeAttached: true, creditorName: '<script>' },
        'inc-1'
      );
      expect(stripped.preferredIncomeSourceId).toBeUndefined();
      expect(stripped.isIncomeAttached).toBe(false);
      expect(stripped.creditorName).toBe('<script>');
    });
  });
});
