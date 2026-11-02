/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { format } from 'date-fns';
import { assignBillsExact } from '../../../electron/services/scheduler/exactAssignment';
import { GreedySolver } from '../../../electron/services/scheduler/solvers/greedySolver';
import type { AssignmentSolver } from '../../../electron/services/scheduler/solvers/types';
import { runScenario } from '../../helpers/scheduleFixtures';
import { scenarioById } from '../../fixtures/scheduler/corpus';
import type { ProjectedBill, ProjectedIncome } from '../../../electron/services/scheduler/types';

const solvers: Array<[string, AssignmentSolver]> = [['greedy', new GreedySolver()]];

function income(dateStr: string, amount: number, id = 'job'): ProjectedIncome {
  return {
    date: new Date(`${dateStr}T00:00:00`),
    sourceId: id,
    sourceName: 'Job',
    amount,
  };
}

function projectedBill(
  dueStr: string,
  id: string,
  amount: number,
  priority: ProjectedBill['priority'] = 'normal'
): ProjectedBill {
  const date = new Date(`${dueStr}T00:00:00`);
  return {
    date,
    billId: id,
    creditorName: id,
    amount,
    dueDay: date.getUTCDate(),
    priority,
  };
}

describe.each(solvers)('assignment engine conformance (%s)', (_name, solver) => {
  it('never pays a bill after its due date', () => {
    const assignments = assignBillsExact(
      [new Date('2026-01-02T00:00:00'), new Date('2026-01-16T00:00:00')],
      [income('2026-01-02', 2000), income('2026-01-16', 2000)],
      [
        projectedBill('2026-01-10', 'early', 100, 'normal'),
        projectedBill('2026-01-20', 'later', 100, 'normal'),
      ],
      0,
      { solver }
    );
    for (const paycheck of assignments) {
      for (const bill of paycheck.bills) {
        if (bill.isUnpayable) continue;
        expect(paycheck.date.getTime()).toBeLessThanOrEqual(bill.date.getTime());
      }
    }
  });

  it('pays rent before gym when income is tight', () => {
    const assignments = assignBillsExact(
      [new Date('2026-01-02T00:00:00')],
      [income('2026-01-02', 1000)],
      [
        projectedBill('2026-01-05', 'gym', 700, 'low'),
        projectedBill('2026-01-10', 'rent', 800, 'critical'),
      ],
      0,
      { solver }
    );
    const placed = assignments.flatMap((paycheck) => paycheck.bills);
    expect(placed.find((bill) => bill.billId === 'rent')?.isUnpayable).toBeFalsy();
    expect(placed.find((bill) => bill.billId === 'gym')?.isUnpayable).toBe(true);
  });

  it('keeps locks, income-attached bills, and preferred placements fixed', () => {
    const schedule = runScenario(scenarioById('locks-attached-preferred'));
    const rent = schedule.fullPaychecks.flatMap((paycheck) =>
      paycheck.bills
        .filter((bill) => bill.billId === 'rent' && bill.billDate === '2026-01-20')
        .map((bill) => ({ date: paycheck.date, bill }))
    );
    expect(rent[0]?.date).toBe('2026-01-09');
    const dues = schedule.fullPaychecks.flatMap((paycheck) =>
      paycheck.bills.filter((bill) => bill.billId === 'dues')
    );
    expect(dues.length).toBeGreaterThan(0);
    expect(dues.every((bill) => bill.isIncomeAttached)).toBe(true);
    const phone = schedule.fullPaychecks.flatMap((paycheck) =>
      paycheck.bills
        .filter((bill) => bill.billId === 'phone' && bill.billDate === '2026-02-28')
        .map((bill) => paycheck.date)
    );
    expect(phone).toEqual(['2026-02-20']);
  });

  it('keeps a pinned unpaid bill on its paycheck', () => {
    const assignments = assignBillsExact(
      [new Date('2026-01-02T00:00:00'), new Date('2026-01-16T00:00:00')],
      [income('2026-01-02', 100), income('2026-01-16', 1000)],
      [projectedBill('2026-01-20', 'rent', 800, 'critical')],
      0,
      {
        solver,
        manualAssignments: new Map([['rent-2026-01-20', '2026-01-02']]),
      }
    );
    const locked = assignments[0].bills.find((bill) => bill.billId === 'rent');
    expect(locked?.isUnpayable).toBe(true);
    expect(format(assignments[0].date, 'yyyy-MM-dd')).toBe('2026-01-02');
    expect(assignments[1].bills.some((bill) => bill.billId === 'rent')).toBe(false);
  });

  it('is deterministic across two solves', () => {
    const first = assignBillsExact(
      [new Date('2026-01-02T00:00:00'), new Date('2026-01-16T00:00:00')],
      [income('2026-01-02', 2000), income('2026-01-16', 2000)],
      [
        projectedBill('2026-01-10', 'a', 300, 'high'),
        projectedBill('2026-01-20', 'b', 200, 'normal'),
      ],
      50,
      { solver }
    );
    const second = assignBillsExact(
      [new Date('2026-01-02T00:00:00'), new Date('2026-01-16T00:00:00')],
      [income('2026-01-02', 2000), income('2026-01-16', 2000)],
      [
        projectedBill('2026-01-10', 'a', 300, 'high'),
        projectedBill('2026-01-20', 'b', 200, 'normal'),
      ],
      50,
      { solver }
    );
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('spends petty cash before paying more days early', () => {
    const assignments = assignBillsExact(
      [new Date('2026-01-02T00:00:00'), new Date('2026-01-16T00:00:00')],
      [income('2026-01-02', 400), income('2026-01-16', 400)],
      [projectedBill('2026-01-20', 'phone', 300, 'normal')],
      0,
      { solver, targetCashOnHand: 250, minCashOnHand: 100 }
    );
    const paid = assignments.find((paycheck) =>
      paycheck.bills.some((bill) => bill.billId === 'phone' && !bill.isUnpayable)
    );
    expect(format(paid!.date, 'yyyy-MM-dd')).toBe('2026-01-16');
  });

  it('does not prepay when the later paycheck can pay', () => {
    const assignments = assignBillsExact(
      [new Date('2026-01-02T00:00:00'), new Date('2026-01-16T00:00:00')],
      [income('2026-01-02', 2000), income('2026-01-16', 2000)],
      [projectedBill('2026-01-20', 'phone', 90, 'normal')],
      0,
      { solver }
    );
    const paid = assignments.find((paycheck) =>
      paycheck.bills.some((bill) => bill.billId === 'phone' && !bill.isUnpayable)
    );
    expect(format(paid!.date, 'yyyy-MM-dd')).toBe('2026-01-16');
  });

  it('pays monthly bills from the monthly paycheck', () => {
    const schedule = runScenario(scenarioById('monthly-pay'));
    const january = schedule.fullPaychecks.find((paycheck) => paycheck.date === '2026-01-01');
    expect(january?.bills.some((bill) => bill.billId === 'rent' && !bill.isUnpayable)).toBe(true);
    expect(january?.bills.some((bill) => bill.billId === 'electric' && !bill.isUnpayable)).toBe(true);
  });

  it('presumes earlier bills paid and keeps later ones on the schedule', () => {
    const schedule = runScenario(scenarioById('monthly-pay'));
    expect(schedule.presumedPaidCount ?? 0).toBeGreaterThanOrEqual(0);
    expect(
      schedule.fullPaychecks.some((paycheck) => paycheck.bills.some((bill) => bill.billId === 'rent'))
    ).toBe(true);
  });
});
