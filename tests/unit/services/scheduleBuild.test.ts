import { addMonths, format, parseISO } from 'date-fns';
import { describe, expect, it } from 'vitest';
import type { Bill, Income } from '@shared/types';
import {
  assembleAssignedSchedule,
  assignPreparedHorizon,
  prepareScheduleHorizon,
} from '../../../electron/services/scheduler/scheduleBuild';
import { SchedulerService } from '../../../electron/services/scheduler.service';

const income: Income = {
  id: 'inc-1',
  sourceName: 'Job',
  amount: 2000,
  cadence: 'biweekly',
  startDate: '2026-01-02',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function rent(overrides: Partial<Bill> = {}): Bill {
  return {
    id: 'bill-1',
    creditorName: 'Rent',
    budgetedAmount: 800,
    dueDay: 5,
    isRecurring: true,
    priority: 'critical',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('scheduleBuild', () => {
  it('dedupes occurrences, records skipped bills, and can assemble without presentation', () => {
    const prepared = prepareScheduleHorizon({
      incomes: [income],
      bills: [rent(), rent()],
      startDateStr: '2026-01-01',
      startingBalance: 1000,
      skippedBills: new Set(['bill-1-2026-01-05']),
    });

    expect(prepared.skippedForDisplay.length).toBeGreaterThan(0);
    expect(
      prepared.uniqueBills.some((bill) => format(bill.date, 'yyyy-MM-dd') === '2026-01-05')
    ).toBe(false);

    const paychecks = assignPreparedHorizon(prepared);
    const dryRun = assembleAssignedSchedule(prepared, paychecks, {
      includePresentation: false,
    });
    expect(dryRun.entries).toEqual([]);
    expect(dryRun.recommendations).toEqual([]);
    expect(dryRun.goalProjections).toBeUndefined();
  });

  describe('happy', () => {
    it('assigns across 14 months then keeps only naturally placed early-January bills', () => {
      const earlyJanuary: Bill = {
        id: 'bill-early',
        creditorName: 'HOA',
        budgetedAmount: 350,
        dueDay: 5,
        isRecurring: true,
        priority: 'normal',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      const lateJanuary: Bill = {
        id: 'bill-late-jan',
        creditorName: 'Storage',
        budgetedAmount: 200,
        dueDay: 25,
        isRecurring: true,
        priority: 'normal',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      const february: Bill = {
        id: 'bill-feb',
        creditorName: 'Gym',
        budgetedAmount: 80,
        dueDay: 20,
        isRecurring: true,
        priority: 'low',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      const prepared = prepareScheduleHorizon({
        incomes: [{ ...income, amount: 4000 }],
        bills: [earlyJanuary, lateJanuary, february],
        startDateStr: '2026-01-01',
        startingBalance: 2000,
      });
      const fundingEnd = format(addMonths(parseISO('2026-01-01'), 12), 'yyyy-MM-dd');

      expect(prepared.calcMonths).toBe(12);
      expect(
        prepared.uniqueBills.some((item) => format(item.date, 'yyyy-MM-dd') === '2027-01-05')
      ).toBe(true);
      expect(
        prepared.uniqueBills.some((item) => format(item.date, 'yyyy-MM-dd') === '2027-01-25')
      ).toBe(true);
      expect(
        prepared.uniqueBills.some((item) => format(item.date, 'yyyy-MM-dd') === '2027-02-20')
      ).toBe(true);

      const paychecks = assignPreparedHorizon(prepared);
      expect(paychecks.every((paycheck) => paycheck.date <= fundingEnd)).toBe(true);
      expect(paychecks.some((paycheck) =>
        paycheck.bills.some((item) => item.billId === earlyJanuary.id && item.billDate === '2027-01-05')
      )).toBe(true);
      expect(
        paychecks.some((paycheck) => paycheck.bills.some((item) => item.billDate === '2027-01-25'))
      ).toBe(false);
      expect(
        paychecks.some((paycheck) => paycheck.bills.some((item) => item.billDate === '2027-02-20'))
      ).toBe(false);

      const withoutLookaheadBills = prepareScheduleHorizon({
        incomes: [{ ...income, amount: 4000 }],
        bills: [],
        startDateStr: '2026-01-01',
        startingBalance: 2000,
      });
      const baseline = assignPreparedHorizon(withoutLookaheadBills);
      const lastWithBills = paychecks.at(-1);
      const lastBaseline = baseline.at(-1);
      expect(lastWithBills?.date).toBe(lastBaseline?.date);
      expect(lastWithBills?.savingsDeposit ?? 0).toBeLessThan(lastBaseline?.savingsDeposit ?? 0);
    });

    it('keeps the same in-window assignments across 3-month and 12-month viewports', () => {
      const scheduler = new SchedulerService();
      const lateFee: Bill = {
        id: 'bill-late',
        creditorName: 'Storage',
        budgetedAmount: 200,
        dueDay: 25,
        isRecurring: true,
        priority: 'normal',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      const three = scheduler.generateSchedule(
        [{ ...income, amount: 4000 }],
        [lateFee],
        '2026-01-01',
        3,
        2000
      );
      const twelve = scheduler.generateSchedule(
        [{ ...income, amount: 4000 }],
        [lateFee],
        '2026-01-01',
        12,
        2000
      );

      expect(three.calculationMonths).toBe(12);
      expect(twelve.calculationMonths).toBe(12);
      expect(twelve.paychecks.length).toBe(twelve.fullPaychecks.length);
      const sharedDates = three.paychecks.map((paycheck) => paycheck.date);
      const twelveWindow = twelve.paychecks.filter((paycheck) => sharedDates.includes(paycheck.date));
      expect(twelveWindow.map((paycheck) => paycheck.date)).toEqual(sharedDates);
      expect(twelveWindow.map((paycheck) => paycheck.totalBills)).toEqual(
        three.paychecks.map((paycheck) => paycheck.totalBills)
      );
    });
  });

  describe('sad', () => {
    it('does not add a debt that is already paid off before the horizon edge', () => {
      const loan: Bill = {
        id: 'bill-loan',
        creditorName: 'Loan',
        budgetedAmount: 400,
        dueDay: 25,
        isRecurring: true,
        priority: 'high',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      const prepared = prepareScheduleHorizon({
        incomes: [{ ...income, amount: 4000 }],
        bills: [loan],
        startDateStr: '2026-01-01',
        startingBalance: 2000,
        debtPayoffs: new Map([
          [
            loan.id,
            {
              billId: loan.id,
              payoffDate: parseISO('2026-06-15'),
              finalPaymentAmount: 150,
            },
          ],
        ]),
      });
      const fundingEnd = format(addMonths(parseISO('2026-01-01'), 12), 'yyyy-MM-dd');
      expect(
        prepared.uniqueBills.some((bill) => format(bill.date, 'yyyy-MM-dd') > '2026-06-30')
      ).toBe(false);

      const paychecks = assignPreparedHorizon(prepared);
      expect(paychecks.at(-1)?.bills.some((item) => item.billDate > fundingEnd)).toBe(false);
    });

    it('returns an empty paycheck list when there is no income', () => {
      const prepared = prepareScheduleHorizon({
        incomes: [],
        bills: [rent()],
        startDateStr: '2026-01-01',
        startingBalance: 0,
      });
      expect(assignPreparedHorizon(prepared)).toEqual([]);
    });
  });
});
