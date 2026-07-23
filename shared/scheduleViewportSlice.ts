import type {
  BreakGlassAdvisorReport,
  PaycheckEntry,
  ReconciliationReport,
} from './types';

export function rebuildReconciliationForViewport(
  reconciliation: ReconciliationReport | undefined,
  viewportPaychecks: PaycheckEntry[]
): ReconciliationReport | undefined {
  if (!reconciliation) {
    return reconciliation;
  }

  const viewportShortfallPaychecks = viewportPaychecks.filter((paycheck) => paycheck.isShortfall);
  const viewportShortfalls = viewportShortfallPaychecks.map((paycheck) => ({
    paycheckDate: paycheck.date,
    deficit: Math.abs(paycheck.budgetRemaining),
    budgetRemaining: paycheck.budgetRemaining,
    bills: [...paycheck.bills],
  }));
  const recalculatedTotalDeficit = viewportShortfalls.reduce(
    (sum, shortfall) => sum + shortfall.deficit,
    0
  );

  return {
    ...reconciliation,
    shortfalls: viewportShortfalls,
    needsReconciliation: viewportShortfalls.length > 0,
    totalDeficit: recalculatedTotalDeficit,
    proposedFixes: reconciliation.proposedFixes.filter((fix) => {
      const fixDate = fix.fromPaycheckDate ?? fix.toPaycheckDate;
      return fixDate
        ? viewportPaychecks.some((paycheck) => paycheck.date === fixDate)
        : true;
    }),
  };
}

/** Keep advisor plans whose target paycheck is visible in the current viewport. */
export function rebuildBreakGlassAdvisorForViewport(
  advisor: BreakGlassAdvisorReport | undefined,
  viewportPaychecks: PaycheckEntry[]
): BreakGlassAdvisorReport | undefined {
  if (!advisor) return advisor;
  const visible = new Set(viewportPaychecks.map((paycheck) => paycheck.date));
  return {
    plans: advisor.plans.filter((plan) => visible.has(plan.targetPaycheckDate)),
  };
}
