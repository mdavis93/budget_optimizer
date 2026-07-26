import { describe, it, expect } from 'vitest';
import { format, parseISO } from 'date-fns';
import { assignBillsExact } from '../../../electron/services/scheduler/exactAssignment';
import { buildPaycheckEntries } from '../../../electron/services/scheduler/paychecks';
import { ProjectedBill, ProjectedIncome } from '../../../electron/services/scheduler/types';
import type { Bill } from '../../../shared/types';

function income(dateStr: string, amount: number, id = 'job'): ProjectedIncome {
  const date = parseISO(dateStr);
  return { date, sourceId: id, sourceName: 'Job', amount };
}

function projectedBill(
  dueStr: string,
  id: string,
  amount: number,
  priority: 'low' | 'normal' | 'high' | 'critical' = 'normal'
): ProjectedBill {
  const date = parseISO(dueStr);
  return {
    date,
    billId: id,
    creditorName: id,
    amount,
    dueDay: date.getDate(),
    priority,
  };
}

describe('assignBillsExact', () => {
  it('defers a bill to a later paycheck when the earlier one is tight', () => {
    const paycheckDates = [parseISO('2026-08-14'), parseISO('2026-08-21')];
    const allIncomes = [
      income('2026-08-14', 415), // capacity above $250 target = $165 → amazon only
      income('2026-08-21', 1000),
    ];
    const allBills = [
      projectedBill('2026-08-15', 'amazon', 165),
      projectedBill('2026-08-25', 'water', 100),
    ];

    const assignments = assignBillsExact(
      paycheckDates,
      allIncomes,
      allBills,
      0
    );

    const amazonPc = assignments.find((a) =>
      a.bills.some((b) => b.billId === 'amazon')
    );
    const waterPc = assignments.find((a) =>
      a.bills.some((b) => b.billId === 'water')
    );

    expect(format(amazonPc!.date, 'yyyy-MM-dd')).toBe('2026-08-14');
    expect(format(waterPc!.date, 'yyyy-MM-dd')).toBe('2026-08-21');
    expect(waterPc!.bills.find((b) => b.billId === 'water')?.isUnpayable).toBeFalsy();
    expect(amazonPc!.bills.some((b) => b.billId === 'water')).toBe(false);
  });

  it('marks one bill unpayable when window income cannot cover both', () => {
    const paycheckDates = [parseISO('2026-09-04')];
    const allIncomes = [income('2026-09-04', 1000)];
    const allBills = [
      projectedBill('2026-09-05', 'a', 600),
      projectedBill('2026-09-05', 'b', 600),
    ];

    const assignments = assignBillsExact(paycheckDates, allIncomes, allBills, 0);
    const placed = assignments.flatMap((a) => a.bills);
    const unpayable = placed.filter((b) => b.isUnpayable);

    expect(unpayable).toHaveLength(1);
    expect(unpayable[0].unfundableReason).toBe('insufficient_income_in_window');
  });

  it('reduces solver capacity by pre-placed income-attached load', () => {
    const paycheckDates = [parseISO('2026-09-04')];
    const allIncomes = [income('2026-09-04', 500, 'job')];
    const attached: Bill = {
      id: 'pets',
      creditorName: 'Pets',
      budgetedAmount: 400,
      dueDay: 4,
      isRecurring: true,
      priority: 'critical',
      isIncomeAttached: true,
      preferredIncomeSourceId: 'job',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const unlocked = projectedBill('2026-09-05', 'cell', 200);

    const assignments = assignBillsExact(paycheckDates, allIncomes, [unlocked], 0, {
      incomeAttachedBillsRaw: [attached],
      targetCashOnHand: 0,
      minCashOnHand: 0,
    });

    const placed = assignments[0].bills;
    const pets = placed.find((b) => b.billId === 'pets');
    const cell = placed.find((b) => b.billId === 'cell');

    expect(pets?.isIncomeAttached).toBe(true);
    expect(pets?.isUnpayable).toBeFalsy();
    expect(cell?.isUnpayable).toBe(true);
    expect(cell?.unfundableReason).toBe('insufficient_income_in_window');

    const payableLoad = placed
      .filter((b) => !b.isUnpayable && !b.isSkipped)
      .reduce((sum, b) => sum + b.amount, 0);
    expect(payableLoad).toBeLessThanOrEqual(500);
  });

  it('reduces solver capacity by pre-placed manual assignment load', () => {
    const paycheckDates = [parseISO('2026-09-04'), parseISO('2026-09-11')];
    const allIncomes = [
      income('2026-09-04', 500),
      income('2026-09-11', 500),
    ];
    const locked = projectedBill('2026-09-10', 'rent', 400);
    const unlocked = projectedBill('2026-09-05', 'water', 200);
    const manualAssignments = new Map([['rent-2026-09-10', '2026-09-04']]);

    const assignments = assignBillsExact(paycheckDates, allIncomes, [locked, unlocked], 0, {
      manualAssignments,
      targetCashOnHand: 0,
      minCashOnHand: 0,
    });

    const sep4 = assignments.find((a) => format(a.date, 'yyyy-MM-dd') === '2026-09-04')!;
    const rent = sep4.bills.find((b) => b.billId === 'rent');
    const water = sep4.bills.find((b) => b.billId === 'water');

    expect(rent).toBeDefined();
    expect(rent?.isUnpayable).toBeFalsy();
    // Water cannot also sit on Sep 4 once rent consumed $400 of $500 income.
    if (water) {
      expect(water.isUnpayable).toBe(true);
    } else {
      const sep11 = assignments.find((a) => format(a.date, 'yyyy-MM-dd') === '2026-09-11')!;
      expect(sep11.bills.some((b) => b.billId === 'water' && !b.isUnpayable)).toBe(true);
    }

    const payableOnSep4 = sep4.bills
      .filter((b) => !b.isUnpayable && !b.isSkipped)
      .reduce((sum, b) => sum + b.amount, 0);
    expect(payableOnSep4).toBeLessThanOrEqual(500);
  });

  it('places preferred assignments without locking them from rebalance', () => {
    const paycheckDates = [parseISO('2026-08-07'), parseISO('2026-08-14'), parseISO('2026-08-21')];
    const allIncomes = [
      income('2026-08-07', 1000),
      income('2026-08-14', 1000),
      income('2026-08-21', 1000),
    ];
    const sw = projectedBill('2026-08-21', 'sw', 125);
    const preferredAssignments = new Map([['sw-2026-08-21', '2026-08-07']]);

    const assignments = assignBillsExact(paycheckDates, allIncomes, [sw], 0, {
      preferredAssignments,
      targetCashOnHand: 250,
      minCashOnHand: 100,
    });

    const aug7 = assignments.find((a) => format(a.date, 'yyyy-MM-dd') === '2026-08-07')!;
    // Preferred seeds the bill onto Aug 7 for this run.
    expect(aug7.bills.some((b) => b.billId === 'sw')).toBe(true);

    // A later regenerate without preferred may place freely — and with room on
    // later paychecks, rebalance is allowed to move unlocked preferred bills.
    const withoutPreferred = assignBillsExact(paycheckDates, allIncomes, [sw], 0, {
      targetCashOnHand: 250,
      minCashOnHand: 100,
    });
    const unlockedPlacement = withoutPreferred.flatMap((a) =>
      a.bills.filter((b) => b.billId === 'sw').map((b) => format(a.date, 'yyyy-MM-dd'))
    );
    expect(unlockedPlacement.length).toBe(1);
  });

  it('buildPaycheckEntries zeros surplus when bills are unpayable', () => {
    const paycheckDates = [parseISO('2026-09-04')];
    const allIncomes = [income('2026-09-04', 500)];
    const allBills = [projectedBill('2026-09-05', 'rent', 800)];

    const assignments = assignBillsExact(paycheckDates, allIncomes, allBills, 0);
    const paychecks = buildPaycheckEntries(assignments, 0);

    expect(paychecks[0].hasUnpayableBills).toBe(true);
    expect(paychecks[0].savingsDeposit).toBe(0);
    expect(paychecks[0].totalGoalDeposits).toBe(0);
    // Total Bills excludes unpayable; remaining is the obligation deficit.
    expect(paychecks[0].totalBills).toBe(0);
    expect(paychecks[0].budgetRemaining).toBe(-300);
  });
});
