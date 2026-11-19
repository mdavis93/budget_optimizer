import { describe, expect, it } from 'vitest';
import { billOccurrenceKeyFromIso } from '@shared/billOccurrence';
import { toCents } from '@shared/money';
import { resolveBillOccurrenceAmount } from '../../../electron/services/scheduler/billPaymentOverrides';
import {
  assignPreparedHorizon,
  prepareScheduleHorizon,
} from '../../../electron/services/scheduler/scheduleBuild';
import type { Bill, Debt, Income } from '../../../electron/services/database.service';
import { buildDebtPayoffsFromStart } from '../../../electron/services/scheduler/debt/debtPayoffs';
import { projectBills } from '../../../electron/services/scheduler/projection';
import { addMonths, parseISO } from 'date-fns';

const income: Income = {
  id: 'income-12345678',
  sourceName: 'Salary',
  amount: 3000,
  cadence: 'monthly',
  startDate: '2026-01-01',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function makeBill(overrides: Partial<Bill> & Pick<Bill, 'id' | 'creditorName' | 'budgetedAmount' | 'dueDay'>): Bill {
  return {
    category: 'Other',
    isRecurring: true,
    priority: 'normal',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildSchedule(options: {
  bills: Bill[];
  skipped?: Set<string>;
  assignments?: Map<string, string>;
  preferred?: Map<string, string>;
  paymentOverrides?: Map<string, number>;
  debts?: Debt[];
  accelerate?: boolean;
  startingBalance?: number;
}) {
  const debtPayoffs = buildDebtPayoffsFromStart(
    options.debts ?? [],
    options.bills,
    '2026-01-01'
  );
  const prepared = prepareScheduleHorizon({
    incomes: [income],
    bills: options.bills,
    startDateStr: '2026-01-01',
    startingBalance: options.startingBalance ?? 0,
    skippedBills: options.skipped ?? new Set(),
    manualAssignments: options.assignments ?? new Map(),
    debtPayoffs,
    billPaymentOverrides: options.paymentOverrides ?? new Map(),
    debts: options.debts ?? [],
    accelerateDebtPayoff: options.accelerate === true,
    maxBudgetRemaining: 100,
    minCashOnHand: 0,
    minSavingsPerPaycheck: 0,
  });
  return assignPreparedHorizon(prepared, options.preferred ?? new Map());
}

function findOccurrence(
  paychecks: ReturnType<typeof buildSchedule>,
  billId: string,
  billDate: string
) {
  for (const paycheck of paychecks) {
    const bill = paycheck.bills.find((row) => row.billId === billId && row.billDate === billDate);
    if (bill) {
      return { paycheck, bill };
    }
  }
  return null;
}

describe('resolveBillOccurrenceAmount', () => {
  it('returns override only when strictly above series amount', () => {
    const key = billOccurrenceKeyFromIso('bill-1', '2026-04-15');
    const overrides = new Map([[key, 125.5]]);
    expect(resolveBillOccurrenceAmount('bill-1', '2026-04-15', 100, overrides)).toBe(125.5);
    expect(resolveBillOccurrenceAmount('bill-1', '2026-04-15', 125.5, overrides)).toBe(125.5);
    expect(resolveBillOccurrenceAmount('bill-1', '2026-04-15', 200, overrides)).toBe(200);
    expect(resolveBillOccurrenceAmount('other', '2026-04-15', 100, overrides)).toBe(100);
    expect(resolveBillOccurrenceAmount('bill-1', '2026-04-15', 100, undefined)).toBe(100);
  });

  it('rounds through cents and ignores non-finite overrides', () => {
    const key = billOccurrenceKeyFromIso('bill-1', '2026-04-15');
    expect(
      resolveBillOccurrenceAmount('bill-1', '2026-04-15', 10, new Map([[key, 10.006]]))
    ).toBe(10.01);
    expect(
      resolveBillOccurrenceAmount('bill-1', '2026-04-15', 10, new Map([[key, Number.NaN]]))
    ).toBe(10);
  });

  it('projectBills uses finalPaymentAmount as series floor on payoff month only', () => {
    const debtBill = makeBill({
      id: 'bill-debt-0001',
      creditorName: 'Card',
      budgetedAmount: 200,
      dueDay: 15,
      category: 'Debt',
      priority: 'high',
    });
    const projected = projectBills(
      debtBill,
      parseISO('2026-01-01'),
      addMonths(parseISO('2026-01-01'), 3),
      {
        billId: debtBill.id,
        payoffDate: parseISO('2026-02-15'),
        finalPaymentAmount: 150,
      },
      new Map([[billOccurrenceKeyFromIso(debtBill.id, '2026-02-15'), 180]])
    );
    const jan = projected.find((row) => row.date.getMonth() === 0);
    const feb = projected.find((row) => row.date.getMonth() === 1);
    expect(jan?.amount).toBe(200);
    expect(jan?.seriesAmount).toBe(200);
    expect(feb?.seriesAmount).toBe(150);
    expect(feb?.amount).toBe(180);
  });
});

describe('bill payment override scheduler sequences', () => {
  const rent = makeBill({
    id: 'bill-rent-0001',
    creditorName: 'Rent',
    budgetedAmount: 1000,
    dueDay: 15,
  });

  it.each([
    {
      name: 'raise then skip: skipped display keeps raised amount; funded totals exclude it',
      run: () => {
        const key = billOccurrenceKeyFromIso(rent.id, '2026-01-15');
        const raised = buildSchedule({
          bills: [rent],
          paymentOverrides: new Map([[key, 1200]]),
          skipped: new Set([key]),
        });
        const found = findOccurrence(raised, rent.id, '2026-01-15');
        expect(found?.bill.amount).toBe(1200);
        expect(found?.bill.seriesAmount).toBe(1000);
        expect(found?.bill.isSkipped).toBe(true);
        expect(found?.paycheck.totalBills).toBe(0);

        const unskipped = buildSchedule({
          bills: [rent],
          paymentOverrides: new Map([[key, 1200]]),
        });
        const funded = findOccurrence(unskipped, rent.id, '2026-01-15');
        expect(funded?.bill.amount).toBe(1200);
        expect(funded?.paycheck.totalBills).toBe(1200);
      },
    },
    {
      name: 'raise then move: destination has raised amount; restore keeps override',
      run: () => {
        const key = billOccurrenceKeyFromIso(rent.id, '2026-01-15');
        const moved = buildSchedule({
          bills: [rent],
          paymentOverrides: new Map([[key, 1200]]),
          assignments: new Map([[key, '2026-02-01']]),
        });
        const onFeb = findOccurrence(moved, rent.id, '2026-01-15');
        expect(onFeb?.paycheck.date).toBe('2026-02-01');
        expect(onFeb?.bill.amount).toBe(1200);
        const jan = moved.find((paycheck) => paycheck.date === '2026-01-01' || paycheck.date === '2026-01-15');
        expect(jan?.bills.some((bill) => bill.billId === rent.id && bill.billDate === '2026-01-15')).toBe(false);

        const restored = buildSchedule({
          bills: [rent],
          paymentOverrides: new Map([[key, 1200]]),
        });
        const afterRestore = findOccurrence(restored, rent.id, '2026-01-15');
        expect(afterRestore?.bill.amount).toBe(1200);
      },
    },
    {
      name: 'move then raise from destination; clear returns series with placement kept',
      run: () => {
        const key = billOccurrenceKeyFromIso(rent.id, '2026-01-15');
        const raisedOnMove = buildSchedule({
          bills: [rent],
          assignments: new Map([[key, '2026-02-01']]),
          paymentOverrides: new Map([[key, 1300]]),
        });
        expect(findOccurrence(raisedOnMove, rent.id, '2026-01-15')?.bill.amount).toBe(1300);
        expect(findOccurrence(raisedOnMove, rent.id, '2026-01-15')?.paycheck.date).toBe('2026-02-01');

        const cleared = buildSchedule({
          bills: [rent],
          assignments: new Map([[key, '2026-02-01']]),
        });
        const clearedRow = findOccurrence(cleared, rent.id, '2026-01-15');
        expect(clearedRow?.bill.amount).toBe(1000);
        expect(clearedRow?.paycheck.date).toBe('2026-02-01');
      },
    },
    {
      name: 'raise then move then skip; unskip funds raised on moved paycheck',
      run: () => {
        const key = billOccurrenceKeyFromIso(rent.id, '2026-01-15');
        const skipped = buildSchedule({
          bills: [rent],
          paymentOverrides: new Map([[key, 1200]]),
          assignments: new Map([[key, '2026-02-01']]),
          skipped: new Set([key]),
        });
        const skippedRow = findOccurrence(skipped, rent.id, '2026-01-15');
        expect(skippedRow?.bill.isSkipped).toBe(true);
        expect(skippedRow?.bill.amount).toBe(1200);
        expect(skippedRow?.paycheck.totalBills).toBe(0);

        const unskipped = buildSchedule({
          bills: [rent],
          paymentOverrides: new Map([[key, 1200]]),
          assignments: new Map([[key, '2026-02-01']]),
        });
        const funded = findOccurrence(unskipped, rent.id, '2026-01-15');
        expect(funded?.paycheck.date).toBe('2026-02-01');
        expect(funded?.bill.amount).toBe(1200);
        expect(funded?.bill.isSkipped).toBeFalsy();
        expect(funded?.paycheck.bills.some((bill) => bill.billId === rent.id && bill.billDate === '2026-01-15' && !bill.isSkipped)).toBe(true);
      },
    },
    {
      name: 'raise then skip then move while skipped; unskip lands on target',
      run: () => {
        const key = billOccurrenceKeyFromIso(rent.id, '2026-01-15');
        const whileSkipped = buildSchedule({
          bills: [rent],
          paymentOverrides: new Map([[key, 1200]]),
          skipped: new Set([key]),
          assignments: new Map([[key, '2026-02-01']]),
        });
        expect(findOccurrence(whileSkipped, rent.id, '2026-01-15')?.bill.amount).toBe(1200);

        const afterUnskip = buildSchedule({
          bills: [rent],
          paymentOverrides: new Map([[key, 1200]]),
          assignments: new Map([[key, '2026-02-01']]),
        });
        expect(findOccurrence(afterUnskip, rent.id, '2026-01-15')?.paycheck.date).toBe('2026-02-01');
        expect(findOccurrence(afterUnskip, rent.id, '2026-01-15')?.bill.amount).toBe(1200);
      },
    },
    {
      name: 'raise above what paycheck can fund becomes unpayable; sibling stays funded',
      run: () => {
        const tightIncome: Income = { ...income, amount: 1100 };
        const key = billOccurrenceKeyFromIso(rent.id, '2026-01-15');
        const prepared = prepareScheduleHorizon({
          incomes: [tightIncome],
          bills: [rent],
          startDateStr: '2026-01-01',
          startingBalance: 0,
          billPaymentOverrides: new Map([[key, 1500]]),
          maxBudgetRemaining: 0,
          minCashOnHand: 0,
          minSavingsPerPaycheck: 0,
        });
        const paychecks = assignPreparedHorizon(prepared);
        const jan = findOccurrence(paychecks, rent.id, '2026-01-15');
        const feb = findOccurrence(paychecks, rent.id, '2026-02-15');
        expect(jan?.bill.amount).toBe(1500);
        expect(jan?.bill.isUnpayable).toBe(true);
        expect(feb?.bill.amount).toBe(1000);
        expect(feb?.bill.isUnpayable).toBeFalsy();
      },
    },
    {
      name: 'already unpayable at series then raised stays unpayable with same seriesAmount',
      run: () => {
        const tiny: Income = { ...income, amount: 200 };
        const key = billOccurrenceKeyFromIso(rent.id, '2026-01-15');
        const prepared = prepareScheduleHorizon({
          incomes: [tiny],
          bills: [rent],
          startDateStr: '2026-01-01',
          startingBalance: 0,
          billPaymentOverrides: new Map([[key, 1500]]),
          maxBudgetRemaining: 0,
          minCashOnHand: 0,
          minSavingsPerPaycheck: 0,
        });
        const paychecks = assignPreparedHorizon(prepared);
        const jan = findOccurrence(paychecks, rent.id, '2026-01-15');
        expect(jan?.bill.isUnpayable).toBe(true);
        expect(jan?.bill.seriesAmount).toBe(1000);
        expect(jan?.bill.amount).toBe(1500);
      },
    },
    {
      name: 'soft preferred placement still charges override wherever occurrence lands',
      run: () => {
        const key = billOccurrenceKeyFromIso(rent.id, '2026-01-15');
        const paychecks = buildSchedule({
          bills: [rent],
          paymentOverrides: new Map([[key, 1200]]),
          preferred: new Map([[key, '2026-02-01']]),
        });
        const found = findOccurrence(paychecks, rent.id, '2026-01-15');
        expect(found?.bill.amount).toBe(1200);
        expect(found?.bill.seriesAmount).toBe(1000);
      },
    },
    {
      name: 'stale override at or below series is ignored including while skipped',
      run: () => {
        const key = billOccurrenceKeyFromIso(rent.id, '2026-01-15');
        const stale = new Map([[key, 900]]);
        const skipped = buildSchedule({
          bills: [rent],
          paymentOverrides: stale,
          skipped: new Set([key]),
        });
        expect(findOccurrence(skipped, rent.id, '2026-01-15')?.bill.amount).toBe(1000);

        const unskipped = buildSchedule({
          bills: [rent],
          paymentOverrides: stale,
        });
        expect(findOccurrence(unskipped, rent.id, '2026-01-15')?.bill.amount).toBe(1000);
      },
    },
    {
      name: 'two occurrences overridden independently',
      run: () => {
        const janKey = billOccurrenceKeyFromIso(rent.id, '2026-01-15');
        const febKey = billOccurrenceKeyFromIso(rent.id, '2026-02-15');
        const paychecks = buildSchedule({
          bills: [rent],
          paymentOverrides: new Map([
            [janKey, 1200],
            [febKey, 1400],
          ]),
          skipped: new Set([janKey]),
        });
        expect(findOccurrence(paychecks, rent.id, '2026-01-15')?.bill.amount).toBe(1200);
        expect(findOccurrence(paychecks, rent.id, '2026-02-15')?.bill.amount).toBe(1400);
        expect(findOccurrence(paychecks, rent.id, '2026-02-15')?.paycheck.totalBills).toBe(1400);
      },
    },
    {
      name: 'clear override while skipped; later unskip shows series',
      run: () => {
        const key = billOccurrenceKeyFromIso(rent.id, '2026-01-15');
        const afterClear = buildSchedule({
          bills: [rent],
          skipped: new Set([key]),
        });
        expect(findOccurrence(afterClear, rent.id, '2026-01-15')?.bill.amount).toBe(1000);
        const unskipped = buildSchedule({ bills: [rent] });
        expect(findOccurrence(unskipped, rent.id, '2026-01-15')?.bill.amount).toBe(1000);
      },
    },
  ] as const)('$name', ({ run }) => {
    run();
  });

  it('income-attached: raise one occurrence, skip omits it, next stays series', () => {
    const attached = makeBill({
      id: 'bill-attach-001',
      creditorName: 'Gym',
      budgetedAmount: 50,
      dueDay: 1,
      preferredIncomeSourceId: income.id,
      isIncomeAttached: true,
    });
    const janKey = billOccurrenceKeyFromIso(attached.id, '2026-01-01');
    const paychecks = buildSchedule({
      bills: [attached],
      paymentOverrides: new Map([[janKey, 80]]),
      skipped: new Set([janKey]),
      assignments: new Map([[janKey, '2026-02-01']]),
    });

    expect(findOccurrence(paychecks, attached.id, '2026-01-01')).toBeNull();
    const feb = findOccurrence(paychecks, attached.id, '2026-02-01');
    expect(feb?.bill.amount).toBe(50);
    expect(feb?.bill.seriesAmount).toBe(50);
    expect(feb?.bill.isUnpayable).toBeFalsy();
  });

  it('debt payoff month uses finalPaymentAmount as floor; acceleration uses seriesAmount', () => {
    const debtBill = makeBill({
      id: 'bill-debt-0001',
      creditorName: 'Card',
      budgetedAmount: 200,
      dueDay: 15,
      category: 'Debt',
      priority: 'high',
    });
    const debt: Debt = {
      id: 'debt-00000001',
      budgetId: 'budget-1',
      billId: debtBill.id,
      principalBalance: 2000,
      apr: 0,
      monthlyPayment: 200,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const janKey = billOccurrenceKeyFromIso(debtBill.id, '2026-01-15');
    const baseline = buildSchedule({
      bills: [debtBill],
      debts: [debt],
      accelerate: true,
      startingBalance: 5000,
    });
    const raised = buildSchedule({
      bills: [debtBill],
      debts: [debt],
      accelerate: true,
      paymentOverrides: new Map([[janKey, 400]]),
      startingBalance: 5000,
    });

    const raisedJan = findOccurrence(raised, debtBill.id, '2026-01-15');
    expect(raisedJan?.bill.amount).toBe(400);
    expect(raisedJan?.bill.seriesAmount).toBe(200);

    const raisedDates = raised
      .flatMap((paycheck) => paycheck.bills.filter((bill) => bill.billId === debtBill.id))
      .map((bill) => bill.billDate)
      .sort();
    const baselineDates = baseline
      .flatMap((paycheck) => paycheck.bills.filter((bill) => bill.billId === debtBill.id))
      .map((bill) => bill.billDate)
      .sort();
    expect(raisedDates).toEqual(baselineDates);
  });

  it('ignores override after budgetedAmount is raised past stored override', () => {
    const key = billOccurrenceKeyFromIso(rent.id, '2026-01-15');
    const raisedBill = { ...rent, budgetedAmount: 1500 };
    const paychecks = buildSchedule({
      bills: [raisedBill],
      paymentOverrides: new Map([[key, 1200]]),
    });
    const found = findOccurrence(paychecks, rent.id, '2026-01-15');
    expect(found?.bill.amount).toBe(1500);
    expect(toCents(found!.bill.amount)).toBe(toCents(found!.bill.seriesAmount ?? 0));
  });
});
