import type {
  BreakGlassAdvisorReport,
  BreakGlassPlan,
  PaycheckEntry,
  ScheduleData,
} from './types';

function cashFloors(paycheck: PaycheckEntry, schedule: ScheduleData) {
  return {
    target: paycheck.targetCashOnHand ?? schedule.maxBudgetRemaining ?? 250,
    min: paycheck.minCashOnHand ?? schedule.minCashOnHand ?? 100,
  };
}

function isBreakGlassPaycheck(paycheck: PaycheckEntry, schedule: ScheduleData): boolean {
  const { target, min } = cashFloors(paycheck, schedule);
  return paycheck.budgetRemaining < target && paycheck.budgetRemaining >= min;
}

function isAtOrAboveTarget(paycheck: PaycheckEntry, schedule: ScheduleData): boolean {
  const { target } = cashFloors(paycheck, schedule);
  return paycheck.budgetRemaining >= target && !paycheck.isShortfall;
}

/**
 * True when applying `preferred` for a Clear-BG plan does not worsen shortfall /
 * unpayable pressure vs baseline, does not create Break-Glass on previously
 * healthy paychecks, and clears the target Break-Glass paycheck.
 */
export function isBreakGlassPlanDryRunSafe(
  baseline: ScheduleData,
  trial: ScheduleData,
  targetPaycheckDate: string,
  options?: { protectedPaycheckDates?: string[] }
): boolean {
  const base = metricsFromSchedule(baseline);
  const next = metricsFromSchedule(trial);

  if (next.shortfallCount > base.shortfallCount) return false;
  if (next.unpayableCount > base.unpayableCount) return false;
  if (next.unpayableCents > base.unpayableCents) return false;

  for (const paycheck of next.paychecks) {
    const before = base.paychecks.find((candidate) => candidate.date === paycheck.date);
    const wasClean =
      !before ||
      (!before.isShortfall && !(before.hasUnpayableBills ?? false));
    if (!wasClean) continue;
    if (paycheck.isShortfall || paycheck.hasUnpayableBills) {
      return false;
    }
  }

  for (const paycheck of next.paychecks) {
    if (paycheck.date === targetPaycheckDate) continue;
    const before = base.paychecks.find((candidate) => candidate.date === paycheck.date);
    if (before && isAtOrAboveTarget(before, baseline) && isBreakGlassPaycheck(paycheck, trial)) {
      return false;
    }
    if (before && isAtOrAboveTarget(before, baseline) && !isAtOrAboveTarget(paycheck, trial)) {
      return false;
    }
  }

  const protectedDates = options?.protectedPaycheckDates ?? [];
  for (const date of protectedDates) {
    const paycheck = next.paychecks.find((candidate) => candidate.date === date);
    if (!paycheck || !isAtOrAboveTarget(paycheck, trial)) {
      return false;
    }
  }

  const target = next.paychecks.find((paycheck) => paycheck.date === targetPaycheckDate);
  if (!target) return false;
  if (
    isBreakGlassPaycheck(target, trial) ||
    target.isShortfall ||
    target.hasUnpayableBills
  ) {
    return false;
  }

  return true;
}

function unpayableCents(paychecks: PaycheckEntry[]): number {
  let total = 0;
  for (const paycheck of paychecks) {
    for (const bill of paycheck.bills) {
      if (bill.isUnpayable && !bill.isSkipped) {
        total += Math.round(bill.amount * 100);
      }
    }
  }
  return total;
}

function unpayableCount(paychecks: PaycheckEntry[]): number {
  return paychecks.reduce((sum, paycheck) => sum + (paycheck.unpayableCount ?? 0), 0);
}

function shortfallCount(paychecks: PaycheckEntry[]): number {
  return paychecks.filter((paycheck) => paycheck.isShortfall).length;
}

function metricsFromSchedule(schedule: ScheduleData) {
  const paychecks = schedule.fullPaychecks?.length
    ? schedule.fullPaychecks
    : schedule.paychecks;
  return {
    paychecks,
    shortfallCount: shortfallCount(paychecks),
    unpayableCount: unpayableCount(paychecks),
    unpayableCents: unpayableCents(paychecks),
  };
}

export function preferredMapFromPlanSteps(
  steps: BreakGlassPlan['steps'],
  into: Map<string, string> = new Map()
): Map<string, string> {
  const next = new Map(into);
  for (const step of steps) {
    next.set(`${step.billId}-${step.billDueDate}`, step.toPaycheckDate);
  }
  return next;
}

/**
 * Keep only plans that survive a real assign+rebalance dry-run with unlocked
 * preferred seeds. Multi-plan stacking accumulates prior survivors as preferred.
 */
export function filterBreakGlassPlansByDryRun(
  report: BreakGlassAdvisorReport,
  baseline: ScheduleData,
  dryRun: (preferredAssignments: Map<string, string>) => ScheduleData
): BreakGlassAdvisorReport {
  const accumulated = new Map<string, string>();
  const plans: BreakGlassPlan[] = [];

  for (const plan of report.plans) {
    const preferred = preferredMapFromPlanSteps(plan.steps, accumulated);
    const trial = dryRun(preferred);
    if (
      !isBreakGlassPlanDryRunSafe(baseline, trial, plan.targetPaycheckDate, {
        protectedPaycheckDates: plans.map((kept) => kept.targetPaycheckDate),
      })
    ) {
      continue;
    }
    plans.push(plan);
    for (const [key, value] of preferred) {
      accumulated.set(key, value);
    }
  }

  return { plans };
}
