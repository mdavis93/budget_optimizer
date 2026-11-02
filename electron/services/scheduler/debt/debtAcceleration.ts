import { format } from 'date-fns';
import { dayNumberOfDate, dayNumberOfIsoDate, eligiblePaycheckIndices } from '@shared/billEligibility';
import type {
  Bill,
  Debt,
  DebtPayment,
  DebtPlan,
  DebtPlanExcluded,
  DebtPlanVariant,
  PaycheckEntry,
  SavingsGoal,
} from '@shared/types';
import { allocateGoalsAndSavings } from '../cashFlowAllocator';
import {
  cashMinForDate,
  cashTargetForDate,
  type CashOnHandByDate,
} from '../cashOnHandOverrides';
import { fromCents, toCents } from '../money';
import { buildPaycheckEntries } from '../paychecks';
import {
  DEFAULT_MIN_CASH_ON_HAND,
  DEFAULT_TARGET_CASH_ON_HAND,
  SAVINGS_TARGET_FALLBACK,
  billOccurrenceKey,
  type PaycheckAssignment,
  type ProjectedBill,
} from '../types';
import { isSavingsAndGoalsIncome } from '@shared/incomePurpose';
import {
  DebtAccount,
  DebtWorkCounter,
  dollarsToPrincipalCents,
  extraPaymentCents,
  simulateMonthlyAmortization,
} from './debtSimulator';

const PRIORITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export interface EligibleDebt {
  debt: Debt;
  bill: Bill;
  principalCents: number;
}

export function classifyDebts(
  debts: readonly Debt[],
  bills: readonly Bill[]
): { eligible: EligibleDebt[]; excluded: DebtPlanExcluded[] } {
  const eligible: EligibleDebt[] = [];
  const excluded: DebtPlanExcluded[] = [];
  const billsById = new Map(bills.map((bill) => [bill.id, bill]));
  const billOwners = new Map<string, string>();

  for (const debt of debts) {
    const principalCents = dollarsToPrincipalCents(debt.principalBalance);
    if (principalCents === null || !Number.isFinite(debt.apr)) {
      continue;
    }
    if (debt.apr > 1) {
      excluded.push({ debtId: debt.id, reason: 'apr_above_one' });
      continue;
    }
    const bill = billsById.get(debt.billId);
    if (!bill) {
      excluded.push({ debtId: debt.id, reason: 'missing_bill' });
      continue;
    }
    const previous = billOwners.get(debt.billId);
    if (previous) {
      excluded.push({ debtId: debt.id, reason: 'duplicate_bill' });
      const already = eligible.findIndex((item) => item.debt.billId === debt.billId);
      if (already >= 0) {
        excluded.push({ debtId: eligible[already].debt.id, reason: 'duplicate_bill' });
        eligible.splice(already, 1);
      }
      continue;
    }
    billOwners.set(debt.billId, debt.id);
    eligible.push({ debt, bill, principalCents });
  }

  eligible.sort((a, b) => b.debt.apr - a.debt.apr || a.debt.id.localeCompare(b.debt.id));
  return { eligible, excluded };
}

function cloneAssignments(assignments: PaycheckAssignment[]): PaycheckAssignment[] {
  return assignments.map((assignment) => ({
    ...assignment,
    incomes: assignment.incomes.slice(),
    bills: assignment.bills.map((bill) => ({ ...bill })),
  }));
}

function uniqueBills(assignment: PaycheckAssignment): ProjectedBill[] {
  const seen = new Set<string>();
  return assignment.bills.filter((bill) => {
    const key = billOccurrenceKey(bill.billId, bill.date);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function goalCompletionDates(paychecks: PaycheckEntry[], goals: readonly SavingsGoal[]): Map<string, string | null> {
  const remaining = new Map(goals.map((goal) => [goal.id, Math.max(0, goal.targetAmount - goal.alreadySaved)]));
  const dates = new Map<string, string | null>(goals.map((goal) => [goal.id, null]));
  for (const paycheck of paychecks) {
    for (const deposit of paycheck.goalDeposits) {
      const left = remaining.get(deposit.goalId);
      if (left === undefined || left <= 0) continue;
      const next = left - deposit.amount;
      remaining.set(deposit.goalId, next);
      if (next <= 0) dates.set(deposit.goalId, paycheck.date);
    }
  }
  return dates;
}

function anyGoalLater(candidate: Map<string, string | null>, baseline: Map<string, string | null>): boolean {
  for (const [goalId, baseDate] of baseline) {
    const cand = candidate.get(goalId) ?? null;
    if (baseDate && cand && cand > baseDate) return true;
    if (baseDate && !cand) return true;
  }
  return false;
}

function anyGoalEarlier(candidate: Map<string, string | null>, baseline: Map<string, string | null>): boolean {
  for (const [goalId, baseDate] of baseline) {
    const cand = candidate.get(goalId) ?? null;
    if (cand && (!baseDate || cand < baseDate)) return true;
  }
  return false;
}

function totalInterest(accounts: Iterable<DebtAccount>): number {
  let sum = 0;
  for (const account of accounts) sum += account.totalInterestCents;
  return fromCents(sum);
}

interface VariantRun {
  variant: DebtPlanVariant;
  paychecks: PaycheckEntry[];
  accounts: DebtAccount[];
  ignoredPins: number;
  accepted: boolean;
}

function savingsFloorCents(minSavingsPerPaycheck: number, variant: DebtPlanVariant, finishesThisMonth: boolean): number {
  const hard = toCents(minSavingsPerPaycheck);
  if (variant === 'deep') return Math.max(hard, toCents(50));
  if (finishesThisMonth) return Math.max(hard, toCents(50));
  return Math.max(hard, toCents(SAVINGS_TARGET_FALLBACK));
}

function runDisabled(
  assignments: PaycheckAssignment[],
  startingBalance: number,
  maxBudgetRemaining: number,
  goals: SavingsGoal[],
  minCashOnHand: number,
  minSavingsPerPaycheck: number,
  cashOnHandByDate: CashOnHandByDate | undefined
): PaycheckEntry[] {
  return buildPaycheckEntries(
    assignments,
    startingBalance,
    maxBudgetRemaining,
    goals,
    minCashOnHand,
    minSavingsPerPaycheck,
    cashOnHandByDate
  );
}

function runPayingVariant(
  variant: 'standard' | 'deep',
  source: PaycheckAssignment[],
  eligible: EligibleDebt[],
  startIso: string,
  startingBalance: number,
  maxBudgetRemaining: number,
  goals: SavingsGoal[],
  minCashOnHand: number,
  minSavingsPerPaycheck: number,
  cashOnHandByDate: CashOnHandByDate | undefined,
  manualAssignments: Map<string, string>,
  applyExtras: boolean,
  work: DebtWorkCounter
): { paychecks: PaycheckEntry[]; accounts: DebtAccount[]; ignoredPins: number } {
  const assignments = cloneAssignments(source);
  const accounts = eligible.map(
    (item) =>
      new DebtAccount(
        item.debt.id,
        item.bill.id,
        item.bill.creditorName,
        item.debt.apr,
        item.bill.dueDay,
        item.principalCents,
        startIso
      )
  );
  const accountByBill = new Map(accounts.map((account) => [account.billId, account]));
  const paycheckDays = assignments.map((assignment) => dayNumberOfDate(assignment.date));
  const freedCents = new Int32Array(assignments.length);
  let ignoredPins = 0;
  const extraByPaycheck: DebtPayment[][] = assignments.map(() => []);
  const allocatedByGoal = new Map(goals.map((goal) => [goal.id, 0]));

  const firstOperating = assignments.findIndex(
    (assignment) => !isSavingsAndGoalsIncome(assignment) && !assignment.unusable
  );

  const removeLaterOccurrences = (billId: string, afterIndex: number) => {
    for (let later = afterIndex + 1; later < assignments.length; later++) {
      work.tick();
      const keep: ProjectedBill[] = [];
      for (const bill of assignments[later].bills) {
        if (bill.billId !== billId || bill.isSkipped) {
          keep.push(bill);
          continue;
        }
        freedCents[later] += toCents(bill.amount);
        const key = billOccurrenceKey(bill.billId, bill.date);
        if (manualAssignments.has(key)) ignoredPins += 1;
      }
      assignments[later].bills = keep;
    }
  };

  for (let i = 0; i < assignments.length; i++) {
    work.tick();
    const assignment = assignments[i];
    const dateIso = format(assignment.date, 'yyyy-MM-dd');
    if (isSavingsAndGoalsIncome(assignment) || assignment.unusable) continue;

    for (const account of accounts) {
      account.accrueThrough(dateIso, work);
    }

    for (const bill of uniqueBills(assignment)) {
      if (bill.isSkipped || bill.isUnpayable) continue;
      const account = accountByBill.get(bill.billId);
      if (!account || account.paidOff) continue;
      account.applyPayment(toCents(bill.amount), dateIso);
      if (account.paidOff && applyExtras) removeLaterOccurrences(bill.billId, i);
    }

    let freed = freedCents[i];
    const unpaid = assignments.flatMap((item, index) =>
      uniqueBills(item)
        .filter(
          (bill) =>
            bill.isUnpayable &&
            !bill.isSkipped &&
            bill.unfundableReason === 'insufficient_income_in_window'
        )
        .map((bill) => ({ bill, index }))
    );
    unpaid.sort((a, b) => {
      const rank = (PRIORITY_RANK[a.bill.priority] ?? 9) - (PRIORITY_RANK[b.bill.priority] ?? 9);
      if (rank !== 0) return rank;
      return format(a.bill.date, 'yyyy-MM-dd').localeCompare(format(b.bill.date, 'yyyy-MM-dd'));
    });

    if (applyExtras) {
      for (const item of unpaid) {
        work.tick();
        const dueDay = dayNumberOfIsoDate(format(item.bill.date, 'yyyy-MM-dd'));
        const eligibleIdx = eligiblePaycheckIndices(dueDay, paycheckDays, (index) => {
          const slot = assignments[index];
          return !isSavingsAndGoalsIncome(slot) && !slot.unusable;
        });
        if (!eligibleIdx.includes(i)) continue;
        const key = billOccurrenceKey(item.bill.billId, item.bill.date);
        const pinned = manualAssignments.has(key);
        if (pinned && item.index !== i) continue;
        const cost = toCents(item.bill.amount);
        if (freed < cost) continue;
        freed -= cost;
        item.bill.isUnpayable = false;
        item.bill.unfundableReason = undefined;
        if (item.index !== i) {
          assignments[item.index].bills = assignments[item.index].bills.filter((bill) => bill !== item.bill);
          assignment.bills.push(item.bill);
        }
      }
    }

    const billsNow = uniqueBills(assignment);
    const hasUnpaid = billsNow.some((bill) => bill.isUnpayable && !bill.isSkipped);
    const totalIncome = assignment.incomes.reduce((sum, income) => sum + income.amount, 0);
    const fundedAmount = billsNow
      .filter((bill) => !bill.isUnpayable && !bill.isSkipped)
      .reduce((sum, bill) => sum + bill.amount, 0);
    const unpayableAmount = billsNow
      .filter((bill) => bill.isUnpayable && !bill.isSkipped)
      .reduce((sum, bill) => sum + bill.amount, 0);
    const ledgerBoost = i === firstOperating ? startingBalance : 0;
    const effectiveTarget = cashTargetForDate(cashOnHandByDate, dateIso, maxBudgetRemaining);
    const remainingAfterBills = totalIncome - fundedAmount - (hasUnpaid ? unpayableAmount : 0) + ledgerBoost;

    if (applyExtras && freed > 0) {
      const minCash = cashMinForDate(cashOnHandByDate, dateIso, minCashOnHand);
      const needMin = Math.max(0, toCents(minCash - remainingAfterBills));
      const usedMin = Math.min(freed, needMin);
      freed -= usedMin;
      const afterMin = remainingAfterBills + fromCents(usedMin);
      const needTarget = Math.max(0, toCents(effectiveTarget - afterMin));
      const usedTarget = Math.min(freed, needTarget);
      freed -= usedTarget;
    }

    if (hasUnpaid) {
      continue;
    }

    const suffixPaychecks = [];
    const suffixGoals = goals.map((goal) => ({
      ...goal,
      alreadySaved: goal.alreadySaved + (allocatedByGoal.get(goal.id) ?? 0),
    }));
    for (let j = i; j < assignments.length; j++) {
      const slot = assignments[j];
      const slotIso = format(slot.date, 'yyyy-MM-dd');
      const slotBills = uniqueBills(slot);
      const slotUnpaid = slotBills.some((bill) => bill.isUnpayable && !bill.isSkipped);
      const slotIncome = slot.incomes.reduce((sum, income) => sum + income.amount, 0);
      const slotFunded = slotBills
        .filter((bill) => !bill.isUnpayable && !bill.isSkipped)
        .reduce((sum, bill) => sum + bill.amount, 0);
      const slotBoost = j === firstOperating ? startingBalance : 0;
      const slotTarget = cashTargetForDate(cashOnHandByDate, slotIso, maxBudgetRemaining);
      const gross = slotIncome - slotFunded + slotBoost;
      const surplus =
        isSavingsAndGoalsIncome(slot) || slot.unusable
          ? 0
          : slotUnpaid
            ? 0
            : Math.max(0, gross - slotTarget);
      suffixPaychecks.push({ date: slotIso, surplus });
    }
    const allocation = allocateGoalsAndSavings(suffixPaychecks, suffixGoals, { minSavingsPerPaycheck });
    const thisAlloc = allocation.paychecks[0];
    for (const deposit of thisAlloc.goalDeposits) {
      allocatedByGoal.set(deposit.goalId, (allocatedByGoal.get(deposit.goalId) ?? 0) + deposit.amount);
    }

    let savingsCents = toCents(thisAlloc.savingsDeposit);
    if (!applyExtras) continue;

    const nextDebt = () => accounts.find((account) => !account.paidOff);
    const finishesWith = (account: DebtAccount, extraCents: number) => {
      return extraCents > 0 && extraCents >= account.principalCents;
    };

    const tryPayDebt = (budgetCents: number, floorCents: number): number => {
      const account = nextDebt();
      if (!account || budgetCents <= floorCents) return 0;
      let available = budgetCents - floorCents;
      if (available <= 0) return 0;
      if (finishesWith(account, available) === false && variant === 'standard') {
        const standardFloor = savingsFloorCents(minSavingsPerPaycheck, 'standard', false);
        available = Math.min(available, Math.max(0, budgetCents - standardFloor));
      }
      const applied = account.applyPayment(available, dateIso);
      if (applied > 0) {
        extraByPaycheck[i].push({
          debtId: account.debtId,
          billId: account.billId,
          creditorName: account.creditorName,
          amount: fromCents(applied),
        });
        if (account.paidOff) removeLaterOccurrences(account.billId, i);
      }
      return applied;
    };

    const finishFloor = savingsFloorCents(
      minSavingsPerPaycheck,
      variant,
      (() => {
        const account = nextDebt();
        return account ? finishesWith(account, Math.max(0, savingsCents - toCents(50))) : false;
      })()
    );
    const fromSavings = tryPayDebt(savingsCents, finishFloor);
    savingsCents -= fromSavings;

    if (freed > 0) {
      const fromFreed = tryPayDebt(savingsCents + freed, savingsCents);
      freed -= fromFreed;
    }
    if (freed > 0) {
      for (const goal of [...goals].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))) {
        const remaining = Math.max(0, goal.targetAmount - goal.alreadySaved - (allocatedByGoal.get(goal.id) ?? 0));
        const take = Math.min(Math.floor(fromCents(freed)), remaining);
        if (take <= 0) continue;
        allocatedByGoal.set(goal.id, (allocatedByGoal.get(goal.id) ?? 0) + take);
        freed -= toCents(take);
      }
    }
  }

  const paychecks = buildPaycheckEntries(
    assignments,
    startingBalance,
    maxBudgetRemaining,
    goals,
    minCashOnHand,
    minSavingsPerPaycheck,
    cashOnHandByDate
  );

  if (applyExtras) {
    for (let i = 0; i < paychecks.length; i++) {
      const extras = extraByPaycheck[i];
      if (!extras.length) continue;
      const extraTotal = extras.reduce((sum, item) => sum + item.amount, 0);
      const savings = Math.max(0, paychecks[i].savingsDeposit - extraTotal);
      paychecks[i] = {
        ...paychecks[i],
        savingsDeposit: Math.round(savings * 100) / 100,
        debtPayments: extras,
        totalDebtPayments: Math.round(extraTotal * 100) / 100,
      };
    }
  }

  return { paychecks, accounts, ignoredPins };
}

function baselineInterestFor(
  item: EligibleDebt,
  startIso: string,
  work: DebtWorkCounter
): { interest: number; payoffDate: string | null } {
  const extra = extraPaymentCents(item.bill.budgetedAmount, item.debt.monthlyPayment);
  const result = simulateMonthlyAmortization(
    {
      principalCents: item.principalCents,
      apr: item.debt.apr,
      monthlyPaymentCents: toCents(item.debt.monthlyPayment),
      extraCents: extra.extraCents,
      extraType: extra.extraType,
      startIso,
      dueDay: item.bill.dueDay,
    },
    work
  );
  return {
    interest: fromCents(result.totalInterestCents),
    payoffDate: result.monthsToPayoff > 0 ? result.payoffDate : null,
  };
}

export interface DebtAccelerationInput {
  assignments: PaycheckAssignment[];
  debts: readonly Debt[];
  bills: readonly Bill[];
  startIso: string;
  startingBalance: number;
  maxBudgetRemaining?: number;
  goals?: SavingsGoal[];
  minCashOnHand?: number;
  minSavingsPerPaycheck?: number;
  cashOnHandByDate?: CashOnHandByDate;
  manualAssignments?: Map<string, string>;
  accelerateDebtPayoff: boolean;
  forcedVariant?: DebtPlanVariant;
}

export interface DebtAccelerationResult {
  paychecks: PaycheckEntry[];
  debtPlan: DebtPlan;
  ignoredPins: number;
}

export function runDebtAcceleration(input: DebtAccelerationInput): DebtAccelerationResult {
  const work = new DebtWorkCounter();
  const goals = input.goals ?? [];
  const maxBudgetRemaining = input.maxBudgetRemaining ?? DEFAULT_TARGET_CASH_ON_HAND;
  const minCashOnHand = input.minCashOnHand ?? DEFAULT_MIN_CASH_ON_HAND;
  const minSavings = input.minSavingsPerPaycheck ?? 0;
  const manuals = input.manualAssignments ?? new Map();
  const { eligible, excluded } = classifyDebts(input.debts, input.bills);

  const disabledPaychecks = runDisabled(
    input.assignments,
    input.startingBalance,
    maxBudgetRemaining,
    goals,
    minCashOnHand,
    minSavings,
    input.cashOnHandByDate
  );
  const disabledDates = goalCompletionDates(disabledPaychecks, goals);

  const standard = runPayingVariant(
    'standard',
    input.assignments,
    eligible,
    input.startIso,
    input.startingBalance,
    maxBudgetRemaining,
    goals,
    minCashOnHand,
    minSavings,
    input.cashOnHandByDate,
    manuals,
    true,
    work
  );
  const deep = runPayingVariant(
    'deep',
    input.assignments,
    eligible,
    input.startIso,
    input.startingBalance,
    maxBudgetRemaining,
    goals,
    minCashOnHand,
    minSavings,
    input.cashOnHandByDate,
    manuals,
    true,
    work
  );

  const standardDates = goalCompletionDates(standard.paychecks, goals);
  const deepDates = goalCompletionDates(deep.paychecks, goals);
  const standardOk = !anyGoalLater(standardDates, disabledDates);
  const deepOk = !anyGoalLater(deepDates, disabledDates) && anyGoalEarlier(deepDates, disabledDates);

  const accepted: VariantRun[] = [
    {
      variant: 'disabled',
      paychecks: disabledPaychecks,
      accounts: [],
      ignoredPins: 0,
      accepted: true,
    },
  ];
  if (standardOk) {
    accepted.push({
      variant: 'standard',
      paychecks: standard.paychecks,
      accounts: standard.accounts,
      ignoredPins: standard.ignoredPins,
      accepted: true,
    });
  }
  if (deepOk) {
    accepted.push({
      variant: 'deep',
      paychecks: deep.paychecks,
      accounts: deep.accounts,
      ignoredPins: deep.ignoredPins,
      accepted: true,
    });
  }

  const interestOf = (run: VariantRun): number => {
    if (run.variant === 'disabled') {
      return eligible.reduce((sum, item) => sum + baselineInterestFor(item, input.startIso, work).interest, 0);
    }
    return totalInterest(run.accounts);
  };

  let chosen = accepted[0];
  let bestInterest = interestOf(chosen);
  for (const run of accepted.slice(1)) {
    const interest = interestOf(run);
    if (interest < bestInterest || (interest === bestInterest && run.variant === 'standard')) {
      chosen = run;
      bestInterest = interest;
    }
  }

  if (input.forcedVariant) {
    const forced = accepted.find((run) => run.variant === input.forcedVariant);
    if (forced) chosen = forced;
    else if (input.forcedVariant === 'standard') chosen = accepted.find((run) => run.variant === 'standard') ?? chosen;
    else if (input.forcedVariant === 'deep') chosen = accepted.find((run) => run.variant === 'deep') ?? chosen;
    else chosen = accepted[0];
  }

  const apply = input.accelerateDebtPayoff === true;
  const applied = apply ? chosen : accepted[0];
  const planAccounts = chosen.variant === 'disabled' ? standard.accounts : chosen.accounts;
  const baselineRows = eligible.map((item) => {
    const baseline = baselineInterestFor(item, input.startIso, work);
    const accelerated = planAccounts.find((account) => account.debtId === item.debt.id);
    return {
      debtId: item.debt.id,
      billId: item.bill.id,
      creditorName: item.bill.creditorName,
      baselinePayoffDate: baseline.payoffDate,
      acceleratedPayoffDate: accelerated?.payoffIso ?? baseline.payoffDate,
      baselineInterest: baseline.interest,
      acceleratedInterest: accelerated ? fromCents(accelerated.totalInterestCents) : baseline.interest,
    };
  });

  const totalInterestSaved = Math.max(
    0,
    baselineRows.reduce((sum, row) => sum + row.baselineInterest - row.acceleratedInterest, 0)
  );
  const payoffDates = baselineRows
    .map((row) => row.acceleratedPayoffDate)
    .filter((value): value is string => Boolean(value))
    .sort();
  const freedMonthlyCash = eligible.reduce((sum, item) => {
    const accelerated = planAccounts.find((account) => account.debtId === item.debt.id);
    if (accelerated?.paidOff) return sum + item.bill.budgetedAmount;
    return sum;
  }, 0);

  const debtPlan: DebtPlan = {
    enabled: apply,
    strategy: 'avalanche',
    variant: chosen.variant,
    debts: baselineRows,
    excluded,
    debtFreeDate: payoffDates.length === baselineRows.length && payoffDates.length > 0 ? payoffDates[payoffDates.length - 1] : null,
    totalInterestSaved: Math.round(totalInterestSaved * 100) / 100,
    freedMonthlyCash: Math.round(freedMonthlyCash * 100) / 100,
  };

  const paychecks = apply ? applied.paychecks : disabledPaychecks;

  return {
    paychecks,
    debtPlan,
    ignoredPins: apply ? applied.ignoredPins : 0,
  };
}
