import { describe, expect, it } from 'vitest';
import { parseISO } from 'date-fns';
import { rebalancePaycheckAssignments } from '../../../electron/services/scheduler/rebalance';
import { PaycheckAssignment } from '../../../electron/services/scheduler/types';

function buildAssignments(
  specs: Array<{ date: string; income: number; bills: Array<{ id: string; amount: number; dueDate: string; priority?: 'low' | 'normal' | 'high' | 'critical'; isIncomeAttached?: boolean }> }>
): PaycheckAssignment[] {
  return specs.map((spec) => ({
    date: parseISO(spec.date),
    incomes: [{ sourceId: 'income-1', sourceName: 'Salary', amount: spec.income, date: parseISO(spec.date), cadence: 'weekly' as const }],
    bills: spec.bills.map((bill) => ({
      date: parseISO(bill.dueDate),
      billId: bill.id,
      creditorName: bill.id,
      amount: bill.amount,
      dueDay: parseISO(bill.dueDate).getDate(),
      priority: bill.priority ?? 'normal',
      isIncomeAttached: bill.isIncomeAttached,
    })),
  }));
}

const REBALANCE_OPTS = { targetCashOnHand: 250, minCashOnHand: 100 };

describe('rebalancePaycheckAssignments', () => {
  it('moves movable bills earlier when a later paycheck is over capacity', () => {
    const assignments = buildAssignments([
      { date: '2027-02-12', income: 1000, bills: [] },
      {
        date: '2027-02-19',
        income: 1000,
        bills: [{ id: 'bill-a', amount: 600, dueDate: '2027-02-19' }],
      },
      {
        date: '2027-02-26',
        income: 1000,
        bills: [
          { id: 'bill-b', amount: 700, dueDate: '2027-02-26' },
          { id: 'bill-c', amount: 400, dueDate: '2027-02-26', priority: 'low' },
        ],
      },
    ]);

    rebalancePaycheckAssignments(assignments, 0, REBALANCE_OPTS);

    const feb26Load = assignments[2].bills.reduce((sum, bill) => sum + bill.amount, 0);

    expect(feb26Load).toBeLessThanOrEqual(750);
    expect(
      assignments[0].bills.some((bill) => bill.billId === 'bill-b' || bill.billId === 'bill-c') ||
        assignments[1].bills.some((bill) => bill.billId === 'bill-b' || bill.billId === 'bill-c')
    ).toBe(true);
  });

  it('never moves per-paycheck income-attached bills', () => {
    const assignments = buildAssignments([
      { date: '2027-02-12', income: 1000, bills: [] },
      {
        date: '2027-02-19',
        income: 1000,
        bills: [{ id: 'bill-attached', amount: 200, dueDate: '2027-02-19', isIncomeAttached: true }],
      },
      {
        date: '2027-02-26',
        income: 1000,
        bills: [{ id: 'bill-heavy', amount: 400, dueDate: '2027-02-26' }],
      },
    ]);

    rebalancePaycheckAssignments(assignments, 0, REBALANCE_OPTS);

    expect(assignments[1].bills.some((bill) => bill.billId === 'bill-attached')).toBe(true);
    expect(assignments[0].bills.some((bill) => bill.billId === 'bill-attached')).toBe(false);
  });

  it('preserves minimum cash-on-hand by shifting bills off tight paychecks', () => {
    const assignments = buildAssignments([
      { date: '2027-02-12', income: 1000, bills: [] },
      {
        date: '2027-02-19',
        income: 1000,
        bills: [
          { id: 'bill-core', amount: 760, dueDate: '2027-02-19' },
          { id: 'bill-tight', amount: 200, dueDate: '2027-02-19', priority: 'low' },
        ],
      },
    ]);

    rebalancePaycheckAssignments(assignments, 0, REBALANCE_OPTS);

    const feb19Load = assignments[1].bills.reduce((sum, bill) => sum + bill.amount, 0);
    expect(feb19Load).toBeLessThanOrEqual(900);
    expect(assignments[0].bills.some((bill) => bill.billId === 'bill-tight')).toBe(true);
  });

  it('accepts break-glass cash-on-hand when target is infeasible but min is met', () => {
    const assignments = buildAssignments([
      { date: '2027-04-23', income: 1000, bills: [] },
      {
        date: '2027-04-30',
        income: 1000,
        bills: [
          { id: 'bill-fixed', amount: 800, dueDate: '2027-04-30' },
          { id: 'bill-movable', amount: 50, dueDate: '2027-04-30', priority: 'low' },
        ],
      },
    ]);

    rebalancePaycheckAssignments(assignments, 0, REBALANCE_OPTS);

    const apr30Load = assignments[1].bills.reduce((sum, bill) => sum + bill.amount, 0);
    expect(apr30Load).toBeLessThanOrEqual(900);
    expect(1000 - apr30Load).toBeGreaterThanOrEqual(100);
  });

  it('does not move locked bill occurrences', () => {
    const assignments = buildAssignments([
      { date: '2027-03-05', income: 1000, bills: [] },
      {
        date: '2027-03-12',
        income: 1000,
        bills: [
          { id: 'bill-locked', amount: 400, dueDate: '2027-03-12', priority: 'low' },
          { id: 'bill-heavy', amount: 700, dueDate: '2027-03-12' },
        ],
      },
    ]);

    rebalancePaycheckAssignments(assignments, 0, {
      ...REBALANCE_OPTS,
      lockedBillKeys: new Set(['bill-locked-2027-03-12']),
    });

    expect(assignments[1].bills.some((bill) => bill.billId === 'bill-locked')).toBe(true);
  });

  it('applies starting balance when relieving overloaded later paychecks', () => {
    const assignments = buildAssignments([
      { date: '2027-08-01', income: 1000, bills: [] },
      {
        date: '2027-08-08',
        income: 1000,
        bills: [{ id: 'bill-x', amount: 960, dueDate: '2027-08-08', priority: 'low' }],
      },
    ]);

    rebalancePaycheckAssignments(assignments, 500, REBALANCE_OPTS);

    expect(assignments[0].bills.some((bill) => bill.billId === 'bill-x')).toBe(true);
  });

  it('skips paychecks already within target cash-on-hand', () => {
    const assignments = buildAssignments([
      { date: '2027-09-01', income: 1000, bills: [{ id: 'bill-a', amount: 700, dueDate: '2027-09-01' }] },
    ]);
    const before = JSON.stringify(assignments);

    rebalancePaycheckAssignments(assignments, 0, REBALANCE_OPTS);

    expect(JSON.stringify(assignments)).toBe(before);
  });

  it('leaves break-glass paychecks unchanged when load is above target but below min floor', () => {
    const assignments = buildAssignments([
      { date: '2027-10-01', income: 1000, bills: [{ id: 'bill-a', amount: 800, dueDate: '2027-10-01' }] },
    ]);
    const beforeIds = assignments[0].bills.map((bill) => bill.billId);

    rebalancePaycheckAssignments(assignments, 0, REBALANCE_OPTS);

    expect(assignments[0].bills.map((bill) => bill.billId)).toEqual(beforeIds);
  });

  it('decongests break-glass paychecks using earlier target-tier surplus', () => {
    const assignments = buildAssignments([
      {
        date: '2026-07-03',
        income: 2650,
        bills: [{ id: 'bill-light', amount: 500, dueDate: '2026-07-03' }],
      },
      {
        date: '2026-07-10',
        income: 2650,
        bills: [
          { id: 'bill-heavy', amount: 2050, dueDate: '2026-07-10' },
          { id: 'bill-movable', amount: 400, dueDate: '2026-07-10', priority: 'low' },
        ],
      },
    ]);

    rebalancePaycheckAssignments(assignments, 0, REBALANCE_OPTS);

    expect(assignments[0].bills.some((bill) => bill.billId === 'bill-movable')).toBe(true);
    expect(assignments[1].bills.some((bill) => bill.billId === 'bill-movable')).toBe(false);
  });

  it('frees a near-enough earlier paycheck to place a break-glass bill (gap vs total spare)', () => {
    // Dec 18 has target spare 795 for an $800 bill — historically freeCapacity early-
    // returned because it was called with the $5 gap, not the $800 total needed.
    const assignments = buildAssignments([
      {
        date: '2026-12-18',
        income: 2650,
        bills: [
          { id: 'bill-dec-a', amount: 1200, dueDate: '2026-12-18' },
          { id: 'bill-dec-b', amount: 405, dueDate: '2026-12-18', priority: 'low' },
        ],
      },
      {
        date: '2026-12-25',
        income: 1000,
        bills: [{ id: 'bill-dec-light', amount: 200, dueDate: '2026-12-25' }],
      },
      {
        date: '2027-01-01',
        income: 2650,
        bills: [
          { id: 'bill-locked-ish', amount: 1745, dueDate: '2027-01-01' },
          { id: 'bill-movable-800', amount: 800, dueDate: '2027-01-01', priority: 'low' },
        ],
      },
    ]);

    rebalancePaycheckAssignments(assignments, 0, REBALANCE_OPTS);

    expect(assignments[2].bills.some((bill) => bill.billId === 'bill-movable-800')).toBe(false);
    expect(
      assignments[0].bills.some((bill) => bill.billId === 'bill-movable-800') ||
        assignments[1].bills.some((bill) => bill.billId === 'bill-movable-800')
    ).toBe(true);
  });

  it('decongests via forward dominos through healthy intermediate paychecks', () => {
    // Jul 3 has surplus; Jul 10 is healthy-but-full; Jul 17 carries a bill that can
    // only reach Jul 10 after Jul 10 sheds into Jul 3 — classic domino chain.
    const assignments = buildAssignments([
      {
        date: '2026-07-03',
        income: 2650,
        bills: [{ id: 'bill-jul3', amount: 400, dueDate: '2026-07-03' }],
      },
      {
        date: '2026-07-10',
        income: 1000,
        bills: [
          { id: 'bill-jul10-a', amount: 400, dueDate: '2026-07-10' },
          { id: 'bill-jul10-b', amount: 350, dueDate: '2026-07-10', priority: 'low' },
        ],
      },
      {
        date: '2026-07-17',
        income: 2650,
        bills: [
          { id: 'bill-jul17-core', amount: 2000, dueDate: '2026-07-17' },
          { id: 'bill-jul17-move', amount: 400, dueDate: '2026-07-17', priority: 'low' },
        ],
      },
    ]);

    rebalancePaycheckAssignments(assignments, 0, REBALANCE_OPTS);

    // Jul 10 sheds into Jul 3 surplus; Jul 17 then sheds earlier (Jul 3 or Jul 10).
    expect(assignments[0].bills.some((bill) => bill.billId === 'bill-jul10-b')).toBe(true);
    expect(assignments[2].bills.some((bill) => bill.billId === 'bill-jul17-move')).toBe(false);
    expect(
      assignments[0].bills.some((bill) => bill.billId === 'bill-jul17-move') ||
        assignments[1].bills.some((bill) => bill.billId === 'bill-jul17-move')
    ).toBe(true);
  });

  it('decongests via min-capacity spare when target spare is a few dollars short', () => {
    const assignments = buildAssignments([
      {
        date: '2026-12-18',
        income: 2650,
        // target spare = 2650-250-1605 = 795; min spare = 2650-100-1605 = 945
        bills: [{ id: 'bill-base', amount: 1605, dueDate: '2026-12-18' }],
      },
      {
        date: '2027-01-01',
        income: 2650,
        bills: [
          { id: 'bill-core', amount: 1745, dueDate: '2027-01-01' },
          { id: 'bill-move', amount: 800, dueDate: '2027-01-01', priority: 'low' },
        ],
      },
    ]);

    rebalancePaycheckAssignments(assignments, 0, REBALANCE_OPTS);

    expect(assignments[0].bills.some((bill) => bill.billId === 'bill-move')).toBe(true);
    expect(assignments[1].bills.some((bill) => bill.billId === 'bill-move')).toBe(false);
  });

  it('respects max cascade depth when nested relief is required', () => {
    const assignments = buildAssignments([
      { date: '2027-05-01', income: 1000, bills: [{ id: 'bill-a', amount: 700, dueDate: '2027-05-01' }] },
      { date: '2027-05-08', income: 1000, bills: [{ id: 'bill-b', amount: 700, dueDate: '2027-05-08' }] },
      {
        date: '2027-05-15',
        income: 1000,
        bills: [
          { id: 'bill-c', amount: 400, dueDate: '2027-05-15', priority: 'low' },
          { id: 'bill-d', amount: 500, dueDate: '2027-05-15' },
        ],
      },
    ]);

    const before = assignments[2].bills.reduce((sum, bill) => sum + bill.amount, 0);
    rebalancePaycheckAssignments(assignments, 0, { ...REBALANCE_OPTS, maxCascadeDepth: 0 });
    const after = assignments[2].bills.reduce((sum, bill) => sum + bill.amount, 0);

    expect(after).toBe(before);
  });

  it('funds unpayable bills in place when break-glass spare exists', () => {
    const assignments = buildAssignments([
      { date: '2027-07-01', income: 1000, bills: [] },
      {
        date: '2027-07-08',
        income: 1000,
        bills: [{ id: 'bill-heavy', amount: 800, dueDate: '2027-07-08' }],
      },
    ]);
    assignments[1].bills[0].isUnpayable = true;

    rebalancePaycheckAssignments(assignments, 0, REBALANCE_OPTS);

    // Break-glass spare on Jul 8 (min capacity 900) funds the $800 bill in place.
    expect(assignments[1].bills).toHaveLength(1);
    expect(assignments[1].bills[0].isUnpayable).toBe(false);
    expect(assignments[0].bills).toHaveLength(0);
  });

  it('funds unpayable in place when income covers it but remaining sits below min', () => {
    // Mirrors Aug 28: $2650 income, $2470 funded, $175 unpayable → $5 left if funded.
    // Min reserve ($100) blocks break-glass spare, but income still covers the bill.
    const assignments = buildAssignments([
      {
        date: '2026-08-28',
        income: 2650,
        bills: [
          { id: 'bill-pets', amount: 200, dueDate: '2026-08-28', priority: 'critical' },
          { id: 'bill-grocery', amount: 300, dueDate: '2026-08-28', priority: 'critical' },
          { id: 'bill-avast', amount: 820, dueDate: '2026-08-28', priority: 'high' },
          { id: 'bill-rav4', amount: 225, dueDate: '2026-08-28', priority: 'critical' },
          { id: 'bill-caps', amount: 25, dueDate: '2026-08-28' },
          { id: 'bill-jeep', amount: 425, dueDate: '2026-08-28', priority: 'critical' },
          { id: 'bill-apple', amount: 350, dueDate: '2026-08-30' },
          { id: 'bill-navy', amount: 175, dueDate: '2026-09-03', priority: 'low' },
          { id: 'bill-auto', amount: 125, dueDate: '2026-08-28' },
        ],
      },
    ]);
    assignments[0].bills[7].isUnpayable = true;
    assignments[0].bills[7].unfundableReason = 'insufficient_income_in_window';

    rebalancePaycheckAssignments(assignments, 0, REBALANCE_OPTS);

    const navy = assignments[0].bills.find((b) => b.billId === 'bill-navy');
    expect(navy?.isUnpayable).toBe(false);
    expect(assignments[0].bills.reduce((sum, b) => sum + (b.isUnpayable ? 0 : b.amount), 0)).toBe(
      2645
    );
  });

  it('rescues unpayable bills onto earlier paychecks using break-glass spare', () => {
    const assignments = buildAssignments([
      { date: '2027-02-12', income: 2650, bills: [] },
      {
        date: '2027-02-19',
        income: 1000,
        bills: [{ id: 'bill-light', amount: 650, dueDate: '2027-02-19' }],
      },
      {
        date: '2027-02-26',
        income: 2650,
        bills: [
          { id: 'bill-core', amount: 2515, dueDate: '2027-02-26' },
          { id: 'bill-navy', amount: 175, dueDate: '2027-03-03', priority: 'low' },
        ],
      },
    ]);
    assignments[2].bills[1].isUnpayable = true;

    rebalancePaycheckAssignments(assignments, 0, REBALANCE_OPTS);

    const navy = assignments.flatMap((a) => a.bills).find((b) => b.billId === 'bill-navy');
    expect(navy?.isUnpayable).toBe(false);
    expect(assignments[1].bills.some((b) => b.billId === 'bill-navy')).toBe(true);
    expect(assignments[2].bills.some((b) => b.billId === 'bill-navy')).toBe(false);
  });
});
