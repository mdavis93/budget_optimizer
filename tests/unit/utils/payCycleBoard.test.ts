import { describe, expect, it } from 'vitest';
import { buildPayCycleBoard } from '../../../src/utils/payCycleBoard';
import type { PaycheckEntry } from '@shared/types';

function bill(
  overrides: Partial<PaycheckEntry['bills'][number]> & Pick<PaycheckEntry['bills'][number], 'billId' | 'creditorName' | 'billDate' | 'amount'>
): PaycheckEntry['bills'][number] {
  return {
    dueDay: Number(overrides.billDate.slice(8, 10)),
    priority: 'normal',
    isIncomeAttached: false,
    isUnpayable: false,
    isSkipped: false,
    ...overrides,
  };
}

function operatingPaycheck(
  date: string,
  bills: PaycheckEntry['bills'],
  overrides: Partial<PaycheckEntry> = {}
): PaycheckEntry {
  return {
    date,
    purpose: 'operating',
    incomeSources: [{ id: 'inc-1', name: 'Salary', amount: 2400 }],
    totalIncome: 2400,
    bills,
    totalBills: bills.filter((item) => !item.isUnpayable && !item.isSkipped).reduce((sum, item) => sum + item.amount, 0),
    goalDeposits: [],
    totalGoalDeposits: 0,
    budgetRemaining: 540,
    savingsDeposit: 0,
    totalSavings: 0,
    isShortfall: false,
    ...overrides,
  };
}

describe('buildPayCycleBoard', () => {
  describe('happy', () => {
    it('builds the Nov 3 / Nov 6 / Nov 20 board with shade, due-date chips, and deposit', () => {
      const nov6 = operatingPaycheck('2026-11-06', [
        bill({ billId: 'car', creditorName: 'Car (Rav4)', billDate: '2026-11-08', amount: 400 }),
        bill({ billId: 'affirm', creditorName: 'Affirm: Amazon', billDate: '2026-11-08', amount: 42 }),
        bill({ billId: 'avant', creditorName: 'Avant', billDate: '2026-11-09', amount: 120 }),
        bill({ billId: 'cell', creditorName: 'Cell', billDate: '2026-11-09', amount: 80 }),
        bill({ billId: 'late', creditorName: 'Late Bill', billDate: '2026-11-22', amount: 50 }),
      ], {
        totalIncome: 2400,
        totalBills: 1860,
        totalGoalDeposits: 100,
        savingsDeposit: 50,
        budgetRemaining: 540,
      });

      const nov20 = operatingPaycheck('2026-11-20', [
        bill({ billId: 'rent', creditorName: 'Rent', billDate: '2026-11-18', amount: 1200 }),
      ]);

      const board = buildPayCycleBoard([nov6, nov20], '2026-11-03');

      expect(board).not.toBeNull();
      expect(board!.paydayIso).toBe('2026-11-06');
      expect(board!.periodEndIso).toBe('2026-11-19');
      expect(board!.visibleStartIso).toBe('2026-11-01');
      expect(board!.visibleEndIso).toBe('2026-11-19');
      expect(board!.totalIncome).toBe(2400);
      expect(board!.totalBills).toBe(1860);
      expect(board!.totalGoalDeposits).toBe(100);
      expect(board!.savingsDeposit).toBe(50);
      expect(board!.budgetRemaining).toBe(540);
      expect(board!.isShortfall).toBe(false);

      const shaded = board!.days.filter((day) => day.inPeriod).map((day) => day.isoDate);
      expect(shaded[0]).toBe('2026-11-06');
      expect(shaded[shaded.length - 1]).toBe('2026-11-19');
      expect(board!.days.find((day) => day.isoDate === '2026-11-05')?.inPeriod).toBe(false);

      const payday = board!.days.find((day) => day.isoDate === '2026-11-06');
      expect(payday?.isPayday).toBe(true);
      expect(payday?.depositAmount).toBe(2400);

      const nov8 = board!.days.find((day) => day.isoDate === '2026-11-08');
      expect(nov8?.bills.map((item) => item.creditorName)).toEqual(['Car (Rav4)', 'Affirm: Amazon']);
      expect(nov8?.bills.every((item) => item.coverage === 'highlighted')).toBe(true);

      const nov18 = board!.days.find((day) => day.isoDate === '2026-11-18');
      expect(nov18?.bills).toHaveLength(1);
      expect(nov18?.bills[0]).toMatchObject({
        creditorName: 'Rent',
        coverage: 'other',
        paidByPaycheckDate: '2026-11-20',
      });

      expect(board!.dueAfterPeriod).toEqual([
        expect.objectContaining({
          creditorName: 'Late Bill',
          billDate: '2026-11-22',
          coverage: 'highlighted',
        }),
      ]);
      expect(board!.dueEarlierThisPeriod).toEqual([]);
    });

    it('copies published header totals even when an unpayable chip is present', () => {
      const paycheck = operatingPaycheck('2026-11-06', [
        bill({ billId: 'rent', creditorName: 'Rent', billDate: '2026-11-08', amount: 1000 }),
        bill({
          billId: 'card',
          creditorName: 'Card',
          billDate: '2026-11-09',
          amount: 200,
          isUnpayable: true,
        }),
      ], {
        totalIncome: 2400,
        totalBills: 1000,
        totalGoalDeposits: 75,
        savingsDeposit: 25,
        budgetRemaining: 250,
        isShortfall: true,
      });
      const next = operatingPaycheck('2026-11-20', []);

      const board = buildPayCycleBoard([paycheck, next], '2026-11-03');

      expect(board!.totalIncome).toBe(2400);
      expect(board!.totalBills).toBe(1000);
      expect(board!.totalGoalDeposits).toBe(75);
      expect(board!.savingsDeposit).toBe(25);
      expect(board!.budgetRemaining).toBe(250);
      expect(board!.isShortfall).toBe(true);

      const nov9 = board!.days.find((day) => day.isoDate === '2026-11-09');
      expect(nov9?.bills).toEqual([
        expect.objectContaining({ creditorName: 'Card', isUnpayable: true, amount: 200 }),
      ]);
    });

    it('omits skipped bills and ignores savings-and-goals paychecks for the band', () => {
      const reserved = operatingPaycheck('2026-11-05', [], {
        purpose: 'savingsAndGoals',
        totalIncome: 400,
        totalBills: 0,
        budgetRemaining: 0,
        bills: [],
      });
      const payday = operatingPaycheck('2026-11-06', [
        bill({ billId: 'rent', creditorName: 'Rent', billDate: '2026-11-08', amount: 1000 }),
        bill({
          billId: 'skip',
          creditorName: 'Skipped Bill',
          billDate: '2026-11-08',
          amount: 50,
          isSkipped: true,
        }),
      ]);
      const next = operatingPaycheck('2026-11-20', []);

      const board = buildPayCycleBoard([reserved, payday, next], '2026-11-03');

      expect(board!.paydayIso).toBe('2026-11-06');
      expect(board!.periodEndIso).toBe('2026-11-19');
      const nov8 = board!.days.find((day) => day.isoDate === '2026-11-08');
      expect(nov8?.bills.map((item) => item.creditorName)).toEqual(['Rent']);
    });

    it('treats a paycheck with no purpose as operating', () => {
      const payday: PaycheckEntry = {
        ...operatingPaycheck('2026-11-06', [
          bill({ billId: 'rent', creditorName: 'Rent', billDate: '2026-11-08', amount: 1000 }),
        ]),
      };
      delete payday.purpose;
      const next = operatingPaycheck('2026-11-20', []);

      const board = buildPayCycleBoard([payday, next], '2026-11-03');
      expect(board!.paydayIso).toBe('2026-11-06');
    });

    it('starts at the current week when today is already inside the cycle', () => {
      const payday = operatingPaycheck('2026-11-06', [
        bill({ billId: 'early', creditorName: 'Early Bill', billDate: '2026-11-07', amount: 30 }),
        bill({ billId: 'visible', creditorName: 'Visible Bill', billDate: '2026-11-12', amount: 40 }),
      ]);
      const next = operatingPaycheck('2026-11-20', []);

      const board = buildPayCycleBoard([payday, next], '2026-11-10');

      expect(board!.visibleStartIso).toBe('2026-11-08');
      expect(board!.days[0]?.isoDate).toBe('2026-11-08');
      expect(board!.dueEarlierThisPeriod).toEqual([
        expect.objectContaining({
          creditorName: 'Early Bill',
          billDate: '2026-11-07',
          coverage: 'highlighted',
        }),
      ]);
      expect(board!.days.find((day) => day.isoDate === '2026-11-12')?.bills).toEqual([
        expect.objectContaining({ creditorName: 'Visible Bill' }),
      ]);
    });
  });

  describe('sad', () => {
    it('returns null when there is no upcoming operating paycheck', () => {
      expect(buildPayCycleBoard([], '2026-11-03')).toBeNull();
      expect(
        buildPayCycleBoard(
          [
            operatingPaycheck('2026-10-01', [], { purpose: 'savingsAndGoals' }),
          ],
          '2026-11-03'
        )
      ).toBeNull();
    });

    it('uses the payday week only when there is no following operating paycheck', () => {
      const payday = operatingPaycheck('2026-11-06', [
        bill({ billId: 'rent', creditorName: 'Rent', billDate: '2026-11-08', amount: 1000 }),
        bill({ billId: 'late', creditorName: 'Late Bill', billDate: '2026-11-22', amount: 50 }),
      ]);

      const board = buildPayCycleBoard([payday], '2026-11-03');

      expect(board!.periodEndIso).toBeNull();
      expect(board!.periodEndAvailable).toBe(false);
      expect(board!.visibleEndIso).toBe('2026-11-07');
      expect(board!.days[board!.days.length - 1]?.isoDate).toBe('2026-11-07');
      // Payday week ends Sat Nov 7; highlighted bills due after that land in the after list.
      expect(board!.dueAfterPeriod).toEqual([
        expect.objectContaining({ creditorName: 'Rent', billDate: '2026-11-08' }),
        expect.objectContaining({ creditorName: 'Late Bill', billDate: '2026-11-22' }),
      ]);
    });
  });

  describe('hostile', () => {
    it('keeps dueAfterPeriod and dueEarlierThisPeriod as separate lists', () => {
      const payday = operatingPaycheck('2026-11-06', [
        bill({ billId: 'early', creditorName: 'Early', billDate: '2026-11-07', amount: 10 }),
        bill({ billId: 'late', creditorName: 'Late', billDate: '2026-11-22', amount: 20 }),
      ]);
      const next = operatingPaycheck('2026-11-20', []);

      const board = buildPayCycleBoard([payday, next], '2026-11-10');

      expect(board!.dueEarlierThisPeriod.map((item) => item.creditorName)).toEqual(['Early']);
      expect(board!.dueAfterPeriod.map((item) => item.creditorName)).toEqual(['Late']);
      expect(board!.dueEarlierThisPeriod).not.toBe(board!.dueAfterPeriod);
    });
  });
});
