import { differenceInDays, differenceInWeeks, format, parseISO } from 'date-fns';
import { GoalProjection, GoalSuggestion, SavingsGoal } from '../types';
import {
  formatGoalCopy,
  GoalComfortTier,
  GoalCopyVars,
} from './goalAchievabilityCopy';

export type { GoalComfortTier };

export interface GoalAchievabilityTimeline {
  paychecksToFund: number | null;
  estimatedFundedDate: string | null;
  deadlineDate: string;
  relativeToDeadline: 'beats' | 'meets' | 'misses' | 'unknown';
  paycheckDeltaFromDeadline: number | null;
}

export interface GoalAchievabilityMargin {
  perPaycheckDelta: number;
  requiredPerPaycheck: number;
  averageAllocatedPerPaycheck: number;
}

export interface GoalAchievabilityMessaging {
  comfortTier: GoalComfortTier;
  modifiers: Array<'projected'>;
  headline: string;
  body: string;
  marginFact: string;
  badge: string;
  cta?: string;
  showSuggestions: boolean;
  ariaMessage: string;
  timeline: GoalAchievabilityTimeline | null;
  margin: GoalAchievabilityMargin | null;
  footnote: string;
  suggestions: GoalSuggestion[];
  scheduleLink: {
    goalId: string;
    highlightPaycheckDate?: string;
  } | null;
}

const SCHEDULE_MONTHS = 12;

function formatMoney(amount: number): string {
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function formatMonthYear(dateStr: string): string {
  return format(parseISO(dateStr), 'MMM yyyy');
}

function formatDisplayDate(dateStr: string): string {
  return format(parseISO(dateStr), 'MMM d, yyyy');
}

function resolveWeeksTiming(
  completionDate: string | null,
  targetDate: string
): { weeksTiming: string; weeksEarly?: number; weeksLate?: number } {
  if (!completionDate) {
    return { weeksTiming: 'on your deadline' };
  }

  const completion = parseISO(completionDate);
  const target = parseISO(targetDate);
  const weeksEarly = differenceInWeeks(target, completion);
  const weeksLate = differenceInWeeks(completion, target);

  if (weeksEarly > 0) {
    return {
      weeksTiming: `${weeksEarly} week${weeksEarly === 1 ? '' : 's'} before your deadline`,
      weeksEarly,
    };
  }
  if (weeksLate > 0) {
    return {
      weeksTiming: `${weeksLate} week${weeksLate === 1 ? '' : 's'} after your deadline`,
      weeksLate,
    };
  }
  return { weeksTiming: 'right on your deadline' };
}

export function deriveComfortTier(
  goal: Pick<SavingsGoal, 'targetAmount' | 'alreadySaved'>,
  projection: GoalProjection
): GoalComfortTier {
  const remainingAmount = goal.targetAmount - goal.alreadySaved;

  if (remainingAmount <= 0) {
    return 'complete';
  }

  if (projection.status === 'impossible') {
    return 'not_achievable';
  }

  if (projection.isProjected && projection.achievabilityPercent >= 100) {
    return 'projected_funded';
  }

  if (projection.isProjected && projection.achievabilityPercent < 100) {
    return 'projected';
  }

  if (projection.status === 'partial') {
    return 'partial';
  }

  if (projection.status === 'achievable' && projection.achievabilityPercent >= 100) {
    const required = projection.requiredPerPaycheck;
    if (required <= 0) {
      return 'achievable';
    }
    const marginRatio = projection.marginPerPaycheck / required;
    if (marginRatio >= 0.35) return 'easily_achievable';
    if (marginRatio >= 0.15) return 'achievable';
    if (marginRatio > 0) return 'achievable_tight';
    return 'aggressive';
  }

  if (projection.achievabilityPercent > 0) {
    return 'partial';
  }

  return 'not_achievable';
}

function buildTimeline(
  projection: GoalProjection,
  goal: Pick<SavingsGoal, 'targetDate'>
): GoalAchievabilityTimeline | null {
  if (projection.remainingAmount <= 0) {
    return null;
  }

  const deadlineDate = goal.targetDate;
  let relativeToDeadline: GoalAchievabilityTimeline['relativeToDeadline'] = 'unknown';
  let paycheckDeltaFromDeadline: number | null = null;

  if (projection.estimatedFundedDate) {
    if (projection.beatsDeadlineByPaychecks != null && projection.beatsDeadlineByPaychecks > 0) {
      relativeToDeadline = 'beats';
      paycheckDeltaFromDeadline = projection.beatsDeadlineByPaychecks;
    } else if (projection.missesDeadlineByPaychecks != null && projection.missesDeadlineByPaychecks > 0) {
      relativeToDeadline = 'misses';
      paycheckDeltaFromDeadline = -projection.missesDeadlineByPaychecks;
    } else {
      const days = differenceInDays(
        parseISO(projection.estimatedFundedDate),
        parseISO(deadlineDate)
      );
      if (days < 0) relativeToDeadline = 'beats';
      else if (days > 0) relativeToDeadline = 'misses';
      else relativeToDeadline = 'meets';
    }
  } else if (projection.status === 'impossible' || projection.actualAllocation === 0) {
    return {
      paychecksToFund: null,
      estimatedFundedDate: null,
      deadlineDate,
      relativeToDeadline: 'unknown',
      paycheckDeltaFromDeadline: null,
    };
  }

  return {
    paychecksToFund: projection.paychecksToFullyFund,
    estimatedFundedDate: projection.estimatedFundedDate,
    deadlineDate,
    relativeToDeadline,
    paycheckDeltaFromDeadline,
  };
}

function buildCopyVars(
  goal: SavingsGoal,
  projection: GoalProjection
): GoalCopyVars {
  const completionDate = projection.estimatedFundedDate
    ? formatDisplayDate(projection.estimatedFundedDate)
    : formatMonthYear(goal.targetDate);
  const { weeksTiming, weeksEarly, weeksLate } = resolveWeeksTiming(
    projection.estimatedFundedDate,
    goal.targetDate
  );

  return {
    goalName: goal.name,
    targetAmount: formatMoney(goal.targetAmount),
    alreadySaved: formatMoney(goal.alreadySaved),
    remainingAmount: formatMoney(projection.remainingAmount),
    allocatedAmount: formatMoney(projection.actualAllocation),
    achievableAmount: formatMoney(projection.achievableAmount),
    achievabilityPercent: projection.achievabilityPercent,
    targetDate: formatMonthYear(goal.targetDate),
    completionDate,
    paycheckCount: projection.paychecksToFullyFund ?? projection.paycheckCount,
    weeksEarly,
    weeksLate: weeksLate ?? Math.max(1, differenceInWeeks(parseISO(goal.targetDate), new Date())),
    weeksTiming,
    tightPaycheckCount: projection.scheduleHealth.tightPaycheckCount,
    shortfallCount: projection.scheduleHealth.shortfallCount,
    savingsTotal: formatMoney(projection.scheduleHealth.savingsTotal),
    scheduleMonths: SCHEDULE_MONTHS,
  };
}

function shouldShowSuggestions(
  tier: GoalComfortTier,
  copyShowSuggestions: boolean,
  suggestions: GoalSuggestion[]
): boolean {
  if (suggestions.length === 0) return false;
  if (tier === 'achievable_tight') return copyShowSuggestions && suggestions.length > 0;
  return copyShowSuggestions;
}

export function buildGoalAchievabilityMessaging(
  goal: SavingsGoal,
  projection: GoalProjection,
  minCashOnHand = 100
): GoalAchievabilityMessaging {
  const comfortTier = deriveComfortTier(goal, projection);
  const copyTier =
    comfortTier === 'projected_funded' ? 'projected_funded' : comfortTier;
  const vars = buildCopyVars(goal, projection);

  const marginFactShortfall =
    projection.scheduleHealth.shortfallCount > 0
      ? `${projection.scheduleHealth.shortfallCount} paychecks already run short, leaving nothing extra for goals.`
      : 'Higher-priority bills and goals are using your surplus first.';

  const copy = formatGoalCopy(copyTier, vars, { marginFactShortfall });
  const modifiers: Array<'projected'> =
    projection.isProjected && comfortTier !== 'projected' && comfortTier !== 'projected_funded'
      ? ['projected']
      : [];

  const timeline = buildTimeline(projection, goal);
  const margin =
    projection.remainingAmount > 0 &&
    comfortTier !== 'not_achievable' &&
    comfortTier !== 'complete'
      ? {
          perPaycheckDelta: projection.marginPerPaycheck,
          requiredPerPaycheck: projection.requiredPerPaycheck,
          averageAllocatedPerPaycheck: projection.avgAllocationPerPaycheck,
        }
      : null;

  const showSuggestions = shouldShowSuggestions(
    comfortTier,
    copy.showSuggestions || comfortTier === 'achievable_tight',
    projection.suggestions
  );

  return {
    comfortTier,
    modifiers,
    headline: copy.headline,
    body: copy.body,
    marginFact: copy.marginFact,
    badge: copy.badge,
    cta: copy.cta,
    showSuggestions,
    ariaMessage: copy.ariaMessage,
    timeline,
    margin,
    footnote: `Assumes $${minCashOnHand} min cash each paycheck and goals funded from surplus after bills & savings.`,
    suggestions: projection.suggestions,
    scheduleLink: {
      goalId: goal.id,
      highlightPaycheckDate: projection.estimatedFundedDate ?? undefined,
    },
  };
}
