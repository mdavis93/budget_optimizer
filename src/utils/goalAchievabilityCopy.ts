export type GoalComfortTier =
  | 'complete'
  | 'easily_achievable'
  | 'achievable'
  | 'achievable_tight'
  | 'aggressive'
  | 'partial'
  | 'projected'
  | 'projected_funded'
  | 'not_achievable';

export interface GoalCopyVars {
  goalName: string;
  targetAmount: string;
  alreadySaved: string;
  remainingAmount: string;
  allocatedAmount: string;
  achievableAmount: string;
  achievabilityPercent: number;
  targetDate: string;
  completionDate: string;
  paycheckCount: number;
  weeksEarly?: number;
  weeksLate?: number;
  weeksTiming: string;
  tightPaycheckCount: number;
  shortfallCount: number;
  savingsTotal: string;
  scheduleMonths: number;
}

export interface GoalCopyEntry {
  headline: string;
  body: string;
  marginFact: string;
  badge: string;
  cta?: string;
  showSuggestions: boolean | 'if_any' | 'if_partial';
  ariaMessage: string;
}

export const GOAL_COPY: Record<GoalComfortTier, GoalCopyEntry> = {
  complete: {
    headline: 'Goal Complete',
    body: 'You have already saved {targetAmount} for {goalName}. No further funding is needed.',
    marginFact: '',
    badge: 'Complete',
    showSuggestions: false,
    ariaMessage:
      'Goal Complete. You have already saved {targetAmount} for {goalName}. No further funding is needed.',
  },
  easily_achievable: {
    headline: 'On Track With Room To Spare',
    body:
      "Your {targetAmount} goal for {goalName} is fully funded. You'll reach it by {completionDate} — {weeksTiming} — with {paycheckCount} paychecks to go.",
    marginFact:
      'Your budget keeps about {savingsTotal} in savings headroom after bills and this goal.',
    badge: 'Comfortable',
    showSuggestions: false,
    ariaMessage:
      "On Track With Room To Spare. Your {targetAmount} goal for {goalName} is fully funded. You'll reach it by {completionDate}, {weeksTiming}, with {paycheckCount} paychecks to go. Your budget keeps about {savingsTotal} in savings headroom after bills and this goal.",
  },
  achievable: {
    headline: 'On Track To Hit Your Target',
    body:
      "You'll fund the full {targetAmount} for {goalName} by {completionDate}, about {paycheckCount} paychecks from now. That meets your {targetDate} deadline.",
    marginFact: "Most paychecks still leave some room beyond this goal's share.",
    badge: 'On Track',
    showSuggestions: false,
    ariaMessage:
      "On Track To Hit Your Target. You'll fund the full {targetAmount} for {goalName} by {completionDate}, about {paycheckCount} paychecks from now. That meets your {targetDate} deadline. Most paychecks still leave some room beyond this goal's share.",
  },
  achievable_tight: {
    headline: "Funded, But It's Tight",
    body:
      'Your budget can fund the full {targetAmount} for {goalName} by {completionDate}. You\'ll hit your {targetDate} deadline — but {tightPaycheckCount} paychecks will run at 90% or more of your income.',
    marginFact: 'This goal uses most of your surplus. A surprise bill could squeeze other plans.',
    badge: 'Tight',
    cta: 'Want breathing room? See ways to ease the pressure below.',
    showSuggestions: 'if_any',
    ariaMessage:
      "Funded, But It's Tight. Your budget can fund the full {targetAmount} for {goalName} by {completionDate}. You'll hit your {targetDate} deadline, but {tightPaycheckCount} paychecks will run at 90 percent or more of your income. This goal uses most of your surplus. A surprise bill could squeeze other plans.",
  },
  aggressive: {
    headline: 'Possible, With Almost No Slack',
    body:
      'You can reach {targetAmount} for {goalName} by {completionDate}. Nearly every spare dollar goes here until then.',
    marginFact:
      '{tightPaycheckCount} tight paychecks and little savings buffer remain. One change could throw off the plan.',
    badge: 'Aggressive',
    cta: 'This plan works on paper. See options if you want more cushion.',
    showSuggestions: true,
    ariaMessage:
      'Possible, With Almost No Slack. You can reach {targetAmount} for {goalName} by {completionDate}. Nearly every spare dollar goes here until then. {tightPaycheckCount} tight paychecks and little savings buffer remain. One change could throw off the plan.',
  },
  partial: {
    headline: 'Partially Funded On Current Path',
    body:
      "At today's pace, you'll save about {allocatedAmount} toward your {targetAmount} goal for {goalName} by {targetDate}. That's {achievabilityPercent}% of your target.",
    marginFact: "You're on track to fall {weeksLate} weeks short of full funding at current rates.",
    badge: 'Partial',
    cta: 'See suggestions to close the gap.',
    showSuggestions: true,
    ariaMessage:
      "Partially Funded On Current Path. At today's pace, you'll save about {allocatedAmount} toward your {targetAmount} goal for {goalName} by {targetDate}. That's {achievabilityPercent} percent of your target. You're on track to fall {weeksLate} weeks short of full funding at current rates.",
  },
  projected: {
    headline: 'Long-Term Estimate Only',
    body:
      'Your {targetDate} deadline is beyond the next {scheduleMonths} months. Based on your current savings rate, you could reach about {achievableAmount} of {targetAmount} for {goalName} by then — {achievabilityPercent}% funded.',
    marginFact:
      'This estimate uses your average allocation beyond the detailed schedule. Actual results may shift as bills change.',
    badge: 'Projected',
    cta: 'See suggestions if you want a clearer path to 100%.',
    showSuggestions: 'if_partial',
    ariaMessage:
      'Long-Term Estimate Only. Your {targetDate} deadline is beyond the next {scheduleMonths} months. Based on your current savings rate, you could reach about {achievableAmount} of {targetAmount} for {goalName} by then, {achievabilityPercent} percent funded. This estimate uses your average allocation beyond the detailed schedule.',
  },
  projected_funded: {
    headline: 'Projected To Reach Your Target',
    body:
      'Your {targetDate} deadline is beyond the next {scheduleMonths} months. At your current rate, you\'re projected to fully fund {targetAmount} for {goalName}.',
    marginFact:
      'This estimate uses your average allocation beyond the detailed schedule. Actual results may shift as bills change.',
    badge: 'Projected · On Track',
    showSuggestions: false,
    ariaMessage:
      'Projected To Reach Your Target. Your {targetDate} deadline is beyond the next {scheduleMonths} months. At your current rate, you are projected to fully fund {targetAmount} for {goalName}.',
  },
  not_achievable: {
    headline: 'No Room In This Budget',
    body:
      "Your schedule doesn't leave surplus for {goalName} right now. You still need {remainingAmount} by {targetDate}.",
    marginFact:
      '{marginFactShortfall}',
    badge: 'Not Funded',
    cta: 'Adjust your plan below — raise priority, extend the date, or lower the target.',
    showSuggestions: true,
    ariaMessage:
      "No Room In This Budget. Your schedule doesn't leave surplus for {goalName} right now. You still need {remainingAmount} by {targetDate}. {marginFactShortfall}",
  },
};

function interpolate(template: string, vars: GoalCopyVars & { marginFactShortfall?: string }): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = vars[key as keyof typeof vars];
    if (value === undefined || value === null) return '';
    return String(value);
  });
}

export function formatGoalCopy(
  tier: GoalComfortTier,
  vars: GoalCopyVars,
  options?: { marginFactShortfall?: string }
): {
  headline: string;
  body: string;
  marginFact: string;
  badge: string;
  cta?: string;
  showSuggestions: boolean;
  ariaMessage: string;
} {
  const entry = GOAL_COPY[tier];
  const merged = { ...vars, marginFactShortfall: options?.marginFactShortfall ?? '' };
  let marginFact = interpolate(entry.marginFact, merged);

  if (tier === 'partial' && vars.shortfallCount > 0) {
    marginFact = `${vars.shortfallCount} paychecks already show shortfalls, which limits how much you can put toward this goal.`;
  }

  const showSuggestions =
    entry.showSuggestions === true
      ? true
      : entry.showSuggestions === 'if_any'
        ? false
        : entry.showSuggestions === 'if_partial'
          ? vars.achievabilityPercent < 100
          : false;

  return {
    headline: interpolate(entry.headline, merged),
    body: interpolate(entry.body, merged),
    marginFact,
    badge: entry.badge,
    cta: entry.cta ? interpolate(entry.cta, merged) : undefined,
    showSuggestions,
    ariaMessage: interpolate(entry.ariaMessage, merged),
  };
}
