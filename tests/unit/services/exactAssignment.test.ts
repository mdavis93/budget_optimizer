import { describe, it, expect } from 'vitest';
import { format, parseISO } from 'date-fns';
import { assignBillsExact } from '../../../electron/services/scheduler/exactAssignment';
import { buildPaycheckEntries } from '../../../electron/services/scheduler/paychecks';
import { ProjectedBill, ProjectedIncome } from '../../../electron/services/scheduler/types';

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

  it('buildPaycheckEntries zeros surplus when bills are unpayable', () => {
    const paycheckDates = [parseISO('2026-09-04')];
    const allIncomes = [income('2026-09-04', 500)];
    const allBills = [projectedBill('2026-09-05', 'rent', 800)];

    const assignments = assignBillsExact(paycheckDates, allIncomes, allBills, 0);
    const paychecks = buildPaycheckEntries(assignments, 0);

    expect(paychecks[0].hasUnpayableBills).toBe(true);
    expect(paychecks[0].savingsDeposit).toBe(0);
    expect(paychecks[0].totalGoalDeposits).toBe(0);
    expect(paychecks[0].budgetRemaining).toBeLessThan(0);
  });
});
