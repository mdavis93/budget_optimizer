import { format } from 'date-fns';
import { dayNumberOfDate, dayNumberOfIsoDate, eligiblePaycheckIndices } from '@shared/billEligibility';
import type {
  Bill,
  Debt,
  DebtPayment,
  DebtPlan,
  DebtPlanExcluded,
  DebtPlanVariant,
  GoalDeposit,
  PaycheckEntry,
  SavingsGoal,
} from '@shared/types';
import { allocateFromSnapshot, createCashFlowSnapshot } from '../cashFlowAllocator';
import { compareGoalsByPriority } from '@shared/goalPriority';
import { paycheckEntryId, isSavingsAndGoalsIncome } from '@shared/incomePurpose';
import { allBillsSkippedOrUnpayable, isPaycheckShortfall, isSavingsSqueezed } from '@shared/paycheckFlags';
import {
  cashMinForDate,
  cashTargetForDate,
  type CashOnHandByDate,
} from '../cashOnHandOverrides';
import { fromCents, roundCurrency, toCents } from '../money';
import { buildPaycheckEntries } from '../paychecks';
import {
  DEFAULT_MIN_CASH_ON_HAND,
  DEFAULT_MIN_SAVINGS_PER_PAYCHECK,
  DEFAULT_TARGET_CASH_ON_HAND,
  SAVINGS_TARGET_FALLBACK,
  billOccurrenceKey,
  type PaycheckAssignment,
  type ProjectedBill,
} from '../types';
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

function runDisabled(
  assignments: PaycheckAssignment[],
  startingBalance: number,
  maxBudgetRemaining: number,
  goals: SavingsGoal[],
  minCashOnHand: number,
  minSavingsPerPaycheck: number,
  cashOnHandByDate: CashOnHandByDate | undefined,
  horizonEndDate?: string
): PaycheckEntry[] {
  return buildPaycheckEntries(
    assignments,
    startingBalance,
    maxBudgetRemaining,
    goals,
    minCashOnHand,
    minSavingsPerPaycheck,
    cashOnHandByDate,
    horizonEndDate
  );
}

function addGoalDeposit(deposits: GoalDeposit[], goalId: string, goalName: string, amount: number): void {
  if (amount <= 0) return;
  const existing = deposits.find((deposit) => deposit.goalId === goalId);
  if (existing) {
    existing.amount += amount;
    return;
  }
  deposits.push({ goalId, goalName, amount });
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
  work: DebtWorkCounter,
  horizonEndDate?: string
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
  const allocatedByGoal = new Map(goals.map((goal) => [goal.id, 0]));
  const paychecks: PaycheckEntry[] = [];
  let totalSavingsDollars = 0;
  let lastOperatingRemaining = startingBalance;
  const firstOperating = assignments.findIndex(
    (assignment) => !isSavingsAndGoalsIncome(assignment) && !assignment.unusable
  );
  const hardFloorCents = Math.max(0, toCents(minSavingsPerPaycheck));
  const fiftyCents = Math.max(hardFloorCents, toCents(50));
  const hundredCents = Math.max(hardFloorCents, toCents(SAVINGS_TARGET_FALLBACK));

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

  const nextDebt = () => accounts.find((account) => !account.paidOff);

  const recordPayment = (payments: DebtPayment[], account: DebtAccount, amountCents: number) => {
    if (amountCents <= 0) return;
    const amount = fromCents(amountCents);
    const existing = payments.find((payment) => payment.debtId === account.debtId);
    if (existing) {
      existing.amount = fromCents(toCents(existing.amount) + amountCents);
      return;
    }
    payments.push({
      debtId: account.debtId,
      billId: account.billId,
      creditorName: account.creditorName,
      amount,
    });
  };

  const regularPositionCents = (index: number, freed: number): number => {
    const assignment = assignments[index];
    const incomeCents = toCents(assignment.incomes.reduce((sum, income) => sum + income.amount, 0));
    const boost = index === firstOperating ? toCents(startingBalance) : 0;
    const funded = uniqueBills(assignment)
      .filter((bill) => !bill.isUnpayable && !bill.isSkipped)
      .reduce((sum, bill) => sum + toCents(bill.amount), 0);
    return incomeCents - funded + boost - freed;
  };

  for (let i = 0; i < assignments.length; i++) {
    work.tick();
    const assignment = assignments[i];
    const dateIso = format(assignment.date, 'yyyy-MM-dd');
    const isReserved = isSavingsAndGoalsIncome(assignment);
    const bills = isReserved ? [] : uniqueBills(assignment);
    const totalIncome = assignment.incomes.reduce((sum, income) => sum + income.amount, 0);
    const effectiveTarget = cashTargetForDate(cashOnHandByDate, dateIso, maxBudgetRemaining);
    const effectiveMin = cashMinForDate(cashOnHandByDate, dateIso, minCashOnHand);
    const purpose = isReserved ? ('savingsAndGoals' as const) : ('operating' as const);

    if (!isReserved && !assignment.unusable && applyExtras) {
      for (const account of accounts) account.accrueThrough(dateIso, work);
      for (const bill of bills) {
        if (bill.isSkipped || bill.isUnpayable) continue;
        const account = accountByBill.get(bill.billId);
        if (!account || account.paidOff) continue;
        account.applyPayment(toCents(bill.amount), dateIso);
        if (account.paidOff) removeLaterOccurrences(bill.billId, i);
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
      unpaid.sort((left, right) => {
        const rank = (PRIORITY_RANK[left.bill.priority] ?? 9) - (PRIORITY_RANK[right.bill.priority] ?? 9);
        if (rank !== 0) return rank;
        return format(left.bill.date, 'yyyy-MM-dd').localeCompare(format(right.bill.date, 'yyyy-MM-dd'));
      });
      for (const item of unpaid) {
        work.tick();
        const dueDay = dayNumberOfIsoDate(format(item.bill.date, 'yyyy-MM-dd'));
        const eligibleIdx = eligiblePaycheckIndices(dueDay, paycheckDays, (index) => {
          const slot = assignments[index];
          return !isSavingsAndGoalsIncome(slot) && !slot.unusable;
        });
        if (!eligibleIdx.includes(i)) continue;
        const key = billOccurrenceKey(item.bill.billId, item.bill.date);
        if (manualAssignments.has(key) && item.index !== i) continue;
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
      freedCents[i] = freed;
    }

    const currentBills = isReserved ? [] : uniqueBills(assignment);
    const fundedBills = currentBills.filter((bill) => !bill.isUnpayable && !bill.isSkipped);
    const unpayableBills = currentBills.filter((bill) => bill.isUnpayable && !bill.isSkipped);
    const hasUnpaid = unpayableBills.length > 0;
    const totalBillsAmount = fromCents(fundedBills.reduce((sum, bill) => sum + toCents(bill.amount), 0));
    const freedAfterRepair = freedCents[i];
    const positionBeforeTopUp = isReserved || assignment.unusable
      ? 0
      : regularPositionCents(i, freedAfterRepair) -
        (hasUnpaid ? unpayableBills.reduce((sum, bill) => sum + toCents(bill.amount), 0) : 0);
    const targetCents = toCents(effectiveTarget);
    const minCents = toCents(effectiveMin);
    let freed = freedAfterRepair;
    let appliedToRemaining = 0;
    if (applyExtras && !isReserved && !assignment.unusable) {
      if (positionBeforeTopUp < minCents) {
        const use = Math.min(freed, minCents - positionBeforeTopUp);
        freed -= use;
        appliedToRemaining += use;
      }
      const afterMin = positionBeforeTopUp + appliedToRemaining;
      if (afterMin < targetCents) {
        const use = Math.min(freed, targetCents - afterMin);
        freed -= use;
        appliedToRemaining += use;
      }
    }
    freedCents[i] = freed;

    const regularSurplusCents =
      isReserved || assignment.unusable || hasUnpaid
        ? 0
        : Math.max(0, positionBeforeTopUp - targetCents);
    const reservedSurplus = isReserved ? Math.max(0, totalIncome) : 0;

    const goalDeposits: GoalDeposit[] = [];
    const debtPayments: DebtPayment[] = [];
    let savingsCents = 0;

    if (!hasUnpaid && !assignment.unusable) {
      const suffix = [];
      for (let j = i; j < assignments.length; j++) {
        const slot = assignments[j];
        const slotIso = format(slot.date, 'yyyy-MM-dd');
        let surplus: number;
        if (j === i) {
          surplus = isReserved ? reservedSurplus : fromCents(regularSurplusCents);
        } else if (slot.unusable) {
          surplus = 0;
        } else if (isSavingsAndGoalsIncome(slot)) {
          surplus = Math.max(0, slot.incomes.reduce((sum, income) => sum + income.amount, 0));
        } else if (uniqueBills(slot).some((bill) => bill.isUnpayable && !bill.isSkipped)) {
          surplus = 0;
        } else {
          const slotTarget = toCents(cashTargetForDate(cashOnHandByDate, slotIso, maxBudgetRemaining));
          surplus = fromCents(Math.max(0, regularPositionCents(j, freedCents[j]) - slotTarget));
        }
        suffix.push({ date: slotIso, surplus });
      }
      const suffixGoals = goals.map((goal) => ({
        id: goal.id,
        name: goal.name,
        targetAmount: goal.targetAmount,
        alreadySaved: goal.alreadySaved + (allocatedByGoal.get(goal.id) ?? 0),
        priority: goal.priority,
        targetDate: goal.targetDate,
        openEnded: goal.openEnded === true,
      }));
      const allocation = allocateFromSnapshot(
        createCashFlowSnapshot(suffix, suffixGoals, { minSavingsPerPaycheck, horizonEndDate })
      );
      const thisAlloc = allocation.paychecks[0];
      for (const deposit of thisAlloc.goalDeposits) {
        addGoalDeposit(goalDeposits, deposit.goalId, deposit.goalName, deposit.amount);
        allocatedByGoal.set(deposit.goalId, (allocatedByGoal.get(deposit.goalId) ?? 0) + deposit.amount);
      }
      savingsCents = toCents(thisAlloc.savingsDeposit);

      if (applyExtras && !isReserved) {
        const account = nextDebt();
        let floor = variant === 'deep' ? fiftyCents : hundredCents;
        if (variant === 'standard' && account && account.principalCents > 0) {
          const drawToFifty = Math.max(0, savingsCents - fiftyCents);
          if (drawToFifty >= account.principalCents) floor = fiftyCents;
        }
        const draw = account ? Math.min(Math.max(0, savingsCents - floor), account.principalCents) : 0;
        if (account && draw > 0) {
          const applied = account.applyPayment(draw, dateIso);
          savingsCents -= applied;
          recordPayment(debtPayments, account, applied);
          if (account.paidOff) removeLaterOccurrences(account.billId, i);
        }

        const freedDebt = nextDebt();
        if (freedDebt && freed > 0) {
          const applied = freedDebt.applyPayment(Math.min(freed, freedDebt.principalCents), dateIso);
          freed -= applied;
          recordPayment(debtPayments, freedDebt, applied);
          if (freedDebt.paidOff) removeLaterOccurrences(freedDebt.billId, i);
        }
        const byPriority = [...goals].sort(compareGoalsByPriority);
        for (const goal of byPriority) {
          const remaining = Math.max(
            0,
            Math.round(goal.targetAmount - goal.alreadySaved - (allocatedByGoal.get(goal.id) ?? 0))
          );
          const take = Math.min(Math.floor(freed / 100), remaining);
          if (take <= 0) continue;
          addGoalDeposit(goalDeposits, goal.id, goal.name, take);
          allocatedByGoal.set(goal.id, (allocatedByGoal.get(goal.id) ?? 0) + take);
          freed -= take * 100;
        }
        savingsCents += freed;
        freedCents[i] = 0;
      }
    }

    const totalGoalDeposits = goalDeposits.reduce((sum, deposit) => sum + deposit.amount, 0);
    const savingsDeposit = fromCents(savingsCents);
    const totalDebtPayments = fromCents(debtPayments.reduce((sum, payment) => sum + toCents(payment.amount), 0));
    let budgetRemaining = fromCents(positionBeforeTopUp + appliedToRemaining);
    if (isReserved) {
      budgetRemaining = lastOperatingRemaining;
    } else if (!hasUnpaid && (regularSurplusCents > 0 || appliedToRemaining > 0 || positionBeforeTopUp >= targetCents)) {
      budgetRemaining = effectiveTarget;
    }
    if (!isReserved && !assignment.unusable) {
      totalSavingsDollars += savingsDeposit;
    } else if (isReserved) {
      totalSavingsDollars += savingsDeposit;
    }

    const allOperatingBillsUnpayable = allBillsSkippedOrUnpayable(currentBills);
    const isShortfall = isPaycheckShortfall({
      isReserved,
      unusable: assignment.unusable === true,
      allOperatingBillsUnpayable,
      budgetRemaining,
      effectiveMin,
    });

    paychecks.push({
      id: paycheckEntryId(purpose, dateIso),
      purpose,
      date: dateIso,
      incomeSources: assignment.incomes.map((income) => ({
        id: income.sourceId,
        name: income.sourceName,
        amount: income.amount,
      })),
      totalIncome,
      bills: currentBills.map((bill) => ({
        billId: bill.billId,
        creditorName: bill.creditorName,
        amount: bill.amount,
        dueDay: bill.dueDay,
        priority: bill.priority,
        category: bill.category,
        billDate: format(bill.date, 'yyyy-MM-dd'),
        isIncomeAttached: bill.isIncomeAttached,
        isUnpayable: bill.isUnpayable,
        isSkipped: bill.isSkipped,
        unfundableReason: bill.unfundableReason,
        preferredIncomeSourceId: bill.preferredIncomeSourceId,
      })),
      totalBills: totalBillsAmount,
      goalDeposits,
      totalGoalDeposits,
      budgetRemaining: fromCents(toCents(budgetRemaining)),
      savingsDeposit,
      totalSavings: fromCents(toCents(totalSavingsDollars)),
      isShortfall,
      targetCashOnHand: effectiveTarget,
      minCashOnHand: effectiveMin,
      savingsSqueezed: isSavingsSqueezed(
        totalGoalDeposits,
        savingsDeposit,
        fromCents(toCents(SAVINGS_TARGET_FALLBACK))
      ),
      unpayableCount: unpayableBills.length,
      hasUnpayableBills: hasUnpaid,
      debtPayments,
      totalDebtPayments,
    });

    if (!isReserved) lastOperatingRemaining = budgetRemaining;
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
  /** Funding horizon end (yyyy-MM-dd). Deadlines on or before this day are in horizon. */
  horizonEndDate?: string;
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
  const minSavings = input.minSavingsPerPaycheck ?? DEFAULT_MIN_SAVINGS_PER_PAYCHECK;
  const manuals = input.manualAssignments ?? new Map();
  const { eligible, excluded } = classifyDebts(input.debts, input.bills);

  const disabledPaychecks = runDisabled(
    input.assignments,
    input.startingBalance,
    maxBudgetRemaining,
    goals,
    minCashOnHand,
    minSavings,
    input.cashOnHandByDate,
    input.horizonEndDate
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
    work,
    input.horizonEndDate
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
    work,
    input.horizonEndDate
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
  const chosenAccounts = chosen.variant === 'disabled' ? [] : chosen.accounts;
  const baselineRows = eligible.map((item) => {
    const baseline = baselineInterestFor(item, input.startIso, work);
    const accelerated = chosenAccounts.find((account) => account.debtId === item.debt.id);
    return {
      debtId: item.debt.id,
      billId: item.bill.id,
      creditorName: item.bill.creditorName,
      baselinePayoffDate: baseline.payoffDate,
      acceleratedPayoffDate:
        chosen.variant === 'disabled' ? baseline.payoffDate : (accelerated?.payoffIso ?? null),
      baselineInterest: baseline.interest,
      acceleratedInterest:
        chosen.variant === 'disabled'
          ? baseline.interest
          : accelerated
            ? fromCents(accelerated.totalInterestCents)
            : baseline.interest,
    };
  });

  const totalInterestSaved =
    chosen.variant === 'disabled'
      ? 0
      : Math.max(
          0,
          baselineRows.reduce((sum, row) => sum + row.baselineInterest - row.acceleratedInterest, 0)
        );
  const payoffDates = baselineRows
    .map((row) => row.acceleratedPayoffDate)
    .filter((value): value is string => Boolean(value))
    .sort();
  const freedMonthlyCash =
    chosen.variant === 'disabled'
      ? 0
      : eligible.reduce((sum, item) => {
          const accelerated = chosenAccounts.find((account) => account.debtId === item.debt.id);
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
    totalInterestSaved: roundCurrency(totalInterestSaved),
    freedMonthlyCash: roundCurrency(freedMonthlyCash),
  };

  const paychecks = apply ? applied.paychecks : disabledPaychecks;

  return {
    paychecks,
    debtPlan,
    ignoredPins: apply ? applied.ignoredPins : 0,
  };
}
