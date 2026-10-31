import {
  annualOperatingIncome,
  makeBill,
  makeGoal,
  makeIncome,
  makeLeave,
  monthlyAmountsForLoad,
  type ScheduleScenario,
} from '../../helpers/scheduleFixtures';

const SCHEDULE_START = '2026-01-01';
const PRIORITY_CYCLE = ['critical', 'high', 'normal', 'low'] as const;

/** Same bill mix as the load probe that measured the two-income slowdown. */
const LOAD_BILL_COUNT = 25;
const LOAD_STARTING_BALANCE = 500;
const loadWeights = Array.from({ length: LOAD_BILL_COUNT }, (_, index) => 50 + ((index * 137) % 900));

function billsAtLoad(incomes: ScheduleScenario['incomes'], load: number) {
  const amounts = monthlyAmountsForLoad(annualOperatingIncome(incomes), load, loadWeights);
  return amounts.map((budgetedAmount, index) =>
    makeBill({
      id: `bill-${index}`,
      creditorName: `Bill ${index}`,
      budgetedAmount,
      dueDay: 1 + ((index * 7) % 28),
      priority: PRIORITY_CYCLE[index % PRIORITY_CYCLE.length],
    })
  );
}

function loadScenario(
  id: string,
  description: string,
  incomes: ScheduleScenario['incomes'],
  load: number,
  isStress = false
): ScheduleScenario {
  return {
    id,
    description,
    incomes,
    bills: billsAtLoad(incomes, load),
    startDate: SCHEDULE_START,
    months: 12,
    startingBalance: LOAD_STARTING_BALANCE,
    load,
    isStress,
  };
}

function biweeklyIncome(id: string, sourceName: string, amount: number, startDate: string) {
  return makeIncome({ id, sourceName, amount, cadence: 'biweekly', startDate });
}

const oneIncome = [biweeklyIncome('income-1', 'Salary', 3000, '2026-01-02')];

/** Mixed cadences: 78 paydays a year. */
const twoIncomes = [
  biweeklyIncome('income-a', 'Primary job', 2100, '2026-01-02'),
  makeIncome({
    id: 'income-b',
    sourceName: 'Second job',
    amount: 900,
    cadence: 'weekly',
    startDate: '2026-01-05',
  }),
];

export const schedulerCorpus: readonly ScheduleScenario[] = [
  loadScenario('one-income-70', 'One biweekly income at about 70% bill load.', oneIncome, 0.7),
  loadScenario('one-income-90', 'One biweekly income at about 90% bill load.', oneIncome, 0.9),
  loadScenario('two-incomes-60', 'Biweekly plus weekly income at about 60% bill load.', twoIncomes, 0.6),
  loadScenario('two-incomes-80', 'Biweekly plus weekly income at about 80% bill load.', twoIncomes, 0.8, true),
  loadScenario('two-incomes-90', 'Biweekly plus weekly income at about 90% bill load.', twoIncomes, 0.9, true),
  loadScenario('two-incomes-100', 'Biweekly plus weekly income at about 100% bill load.', twoIncomes, 1, true),
  {
    id: 'monthly-pay',
    description: 'One monthly paycheck with bills due later in the month.',
    incomes: [makeIncome({
      id: 'income-monthly',
      sourceName: 'Monthly salary',
      amount: 4200,
      cadence: 'monthly',
      startDate: SCHEDULE_START,
    })],
    bills: [
      makeBill({ id: 'rent', creditorName: 'Rent', budgetedAmount: 1600, dueDay: 10, priority: 'critical' }),
      makeBill({ id: 'electric', creditorName: 'Electric', budgetedAmount: 180, dueDay: 20, priority: 'high' }),
      makeBill({ id: 'phone', creditorName: 'Phone', budgetedAmount: 90, dueDay: 25, priority: 'normal' }),
    ],
    startDate: SCHEDULE_START,
    months: 12,
    startingBalance: 0,
  },
  {
    id: 'horizon-60',
    description: 'A goal deadline that extends the calculation horizon to 60 months.',
    incomes: [makeIncome({
      id: 'income-monthly',
      sourceName: 'Monthly salary',
      amount: 3000,
      cadence: 'monthly',
      startDate: SCHEDULE_START,
    })],
    bills: [
      makeBill({ id: 'rent', creditorName: 'Rent', budgetedAmount: 250, dueDay: 15, priority: 'critical' }),
    ],
    goals: [makeGoal({
      id: 'goal-horizon',
      name: 'Horizon',
      targetAmount: 5000,
      targetDate: '2031-01-01',
    })],
    startDate: SCHEDULE_START,
    months: 60,
    startingBalance: 0,
  },
  {
    id: 'leave',
    description: 'Unpaid leave removes operating paychecks inside the leave window.',
    incomes: [biweeklyIncome('income-1', 'Salary', 2000, '2026-01-02')],
    bills: [
      makeBill({ id: 'rent', creditorName: 'Rent', budgetedAmount: 400, dueDay: 15, priority: 'critical' }),
    ],
    leaves: [makeLeave({
      id: 'leave-1',
      incomeId: 'income-1',
      name: 'Unpaid leave',
      type: 'unpaid',
      startDate: '2026-03-01',
      endDate: '2026-03-31',
    })],
    startDate: SCHEDULE_START,
    months: 12,
    startingBalance: 0,
  },
  {
    id: 'reserved-income',
    description: 'Savings-and-goals income stays off the operating paycheck.',
    incomes: [
      biweeklyIncome('income-operating', 'Salary', 2000, '2026-01-02'),
      makeIncome({
        id: 'income-reserved',
        sourceName: 'Side deposit',
        amount: 500,
        cadence: 'monthly',
        startDate: SCHEDULE_START,
        purpose: 'savingsAndGoals',
      }),
    ],
    bills: [
      makeBill({ id: 'rent', creditorName: 'Rent', budgetedAmount: 400, dueDay: 15, priority: 'critical' }),
    ],
    startDate: SCHEDULE_START,
    months: 12,
    startingBalance: 0,
  },
  {
    id: 'locks-attached-preferred',
    description: 'A manual lock, an income-attached bill, and a preferred placement.',
    incomes: [
      biweeklyIncome('income-a', 'Primary job', 2000, '2026-01-02'),
      biweeklyIncome('income-b', 'Second job', 1500, '2026-01-09'),
    ],
    bills: [
      makeBill({ id: 'rent', creditorName: 'Rent', budgetedAmount: 800, dueDay: 20, priority: 'critical' }),
      makeBill({ id: 'electric', creditorName: 'Electric', budgetedAmount: 100, dueDay: 8, priority: 'high' }),
      makeBill({ id: 'phone', creditorName: 'Phone', budgetedAmount: 80, dueDay: 28, priority: 'normal' }),
      makeBill({
        id: 'dues',
        creditorName: 'Dues',
        budgetedAmount: 25,
        dueDay: 2,
        priority: 'high',
        preferredIncomeSourceId: 'income-a',
        isIncomeAttached: true,
      }),
    ],
    // 11 days early. Unlocked, rent lands on 2026-01-16, so this lock is observable.
    manualAssignments: [['rent-2026-01-20', '2026-01-09']],
    preferredAssignments: [['phone-2026-02-28', '2026-02-20']],
    startDate: SCHEDULE_START,
    months: 12,
    startingBalance: 0,
  },
];

const seenIds = new Set<string>();
for (const scenario of schedulerCorpus) {
  if (seenIds.has(scenario.id)) {
    throw new Error(`duplicate scheduler scenario ${scenario.id}`);
  }
  seenIds.add(scenario.id);
}

export function scenarioById(id: string): ScheduleScenario {
  const scenario = schedulerCorpus.find((item) => item.id === id);
  if (!scenario) {
    throw new Error(`unknown scheduler scenario ${id}`);
  }
  return scenario;
}
