import { describe, expect, it } from 'vitest';
import {
  leaveCashOverrideDates,
  resolvePaycheckCashOnHand,
} from '../../../electron/services/scheduler/cashOnHandOverrides';
import { createMockLeave } from '../../mocks/electron-api.mock';

describe('cashOnHandOverrides', () => {
  const dates = ['2026-01-15', '2026-01-29', '2026-02-12', '2026-02-26', '2026-03-12'];

  describe('leaveCashOverrideDates', () => {
    it('returns in-range paycheck dates when any exist', () => {
      const leave = createMockLeave({
        type: 'unpaid',
        startDate: '2026-02-01',
        endDate: '2026-02-28',
        targetCashOnHand: 100,
      });
      expect(leaveCashOverrideDates(dates, leave)).toEqual(['2026-02-12', '2026-02-26']);
    });

    it('returns bordering paychecks when the leave range has no paycheck dates', () => {
      const leave = createMockLeave({
        type: 'unpaid',
        startDate: '2026-02-13',
        endDate: '2026-02-25',
        targetCashOnHand: 100,
      });
      expect(leaveCashOverrideDates(dates, leave)).toEqual(['2026-02-12', '2026-02-26']);
    });
  });

  describe('resolvePaycheckCashOnHand', () => {
    it('uses budget defaults when no unpaid cash overrides apply', () => {
      const paid = createMockLeave({
        type: 'paid',
        startDate: '2026-02-01',
        endDate: '2026-02-28',
        targetCashOnHand: 50,
        minCashOnHand: 25,
      });
      const result = resolvePaycheckCashOnHand(dates, [paid], 250, 100);
      expect(result.targetByDate.get('2026-02-12')).toBe(250);
      expect(result.minByDate.get('2026-02-12')).toBe(100);
    });

    it('applies unpaid overrides in range and ignores paid overrides', () => {
      const unpaid = createMockLeave({
        type: 'unpaid',
        startDate: '2026-02-01',
        endDate: '2026-02-28',
        targetCashOnHand: 120,
        minCashOnHand: 40,
      });
      const result = resolvePaycheckCashOnHand(dates, [unpaid], 250, 100);
      expect(result.targetByDate.get('2026-01-29')).toBe(250);
      expect(result.targetByDate.get('2026-02-12')).toBe(120);
      expect(result.minByDate.get('2026-02-12')).toBe(40);
      expect(result.targetByDate.get('2026-03-12')).toBe(250);
    });

    it('applies gap borders when unpaid leave removes in-range pay dates', () => {
      const unpaid = createMockLeave({
        type: 'unpaid',
        startDate: '2026-02-13',
        endDate: '2026-02-25',
        targetCashOnHand: 80,
        minCashOnHand: 30,
      });
      const result = resolvePaycheckCashOnHand(dates, [unpaid], 250, 100);
      expect(result.targetByDate.get('2026-02-12')).toBe(80);
      expect(result.minByDate.get('2026-02-26')).toBe(30);
      expect(result.targetByDate.get('2026-02-12')).toBe(80);
    });

    it('takes the minimum among overlapping unpaid leave overrides', () => {
      const first = createMockLeave({
        id: 'leave-a',
        type: 'unpaid',
        startDate: '2026-02-01',
        endDate: '2026-02-28',
        targetCashOnHand: 150,
        minCashOnHand: 60,
      });
      const second = createMockLeave({
        id: 'leave-b',
        type: 'unpaid',
        startDate: '2026-02-01',
        endDate: '2026-02-28',
        targetCashOnHand: 90,
        minCashOnHand: 70,
      });
      const result = resolvePaycheckCashOnHand(dates, [first, second], 250, 100);
      expect(result.targetByDate.get('2026-02-12')).toBe(90);
      expect(result.minByDate.get('2026-02-12')).toBe(60);
    });

    it('clamps effective min to target when min would exceed target', () => {
      const unpaid = createMockLeave({
        type: 'unpaid',
        startDate: '2026-02-01',
        endDate: '2026-02-28',
        targetCashOnHand: 50,
        // only target overridden; budget min 100 would exceed target 50
      });
      const result = resolvePaycheckCashOnHand(dates, [unpaid], 250, 100);
      expect(result.targetByDate.get('2026-02-12')).toBe(50);
      expect(result.minByDate.get('2026-02-12')).toBe(50);
    });

    it('applies unpaid leave with only minCashOnHand and keeps budget target', () => {
      const unpaid = createMockLeave({
        type: 'unpaid',
        startDate: '2026-02-01',
        endDate: '2026-02-28',
        minCashOnHand: 35,
      });
      const result = resolvePaycheckCashOnHand(dates, [unpaid], 250, 100);
      expect(result.targetByDate.get('2026-02-12')).toBe(250);
      expect(result.minByDate.get('2026-02-12')).toBe(35);
      expect(result.minByDate.get('2026-01-29')).toBe(100);
    });
  });
});
