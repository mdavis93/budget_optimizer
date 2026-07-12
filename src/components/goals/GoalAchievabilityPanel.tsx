import { memo, useId, useState } from 'react';
import {
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  Gauge,
  Lightbulb,
  PieChart,
  TrendingUp,
  XCircle,
  Zap,
} from 'lucide-react';
import clsx from 'clsx';
import { format, parseISO } from 'date-fns';
import { GoalProjection, GoalSuggestion, SavingsGoal } from '../../types';
import {
  GoalAchievabilityMessaging,
  GoalComfortTier,
} from '../../utils/goalAchievabilityMessaging';
import { formatCurrency } from '../../utils/formatCurrency';

export interface GoalAchievabilityPanelProps {
  goal: Pick<SavingsGoal, 'id' | 'name' | 'targetAmount' | 'targetDate' | 'alreadySaved' | 'priority'>;
  projection: GoalProjection | null;
  messaging: GoalAchievabilityMessaging | null;
  minCashOnHand?: number;
  isLoading?: boolean;
  error?: boolean;
  onViewSchedule?: (link: NonNullable<GoalAchievabilityMessaging['scheduleLink']>) => void;
  onEditGoal?: (goalId: string) => void;
}

const TIER_STYLES: Record<
  GoalComfortTier,
  { border: string; bg: string; text: string; icon: typeof Check }
> = {
  complete: {
    border: 'border-success-300/50 dark:border-success-700/50',
    bg: 'bg-success-50 dark:bg-success-900/20',
    text: 'text-success-700 dark:text-success-400',
    icon: CheckCircle2,
  },
  easily_achievable: {
    border: 'border-success-300/50 dark:border-success-700/50',
    bg: 'bg-success-50 dark:bg-success-900/20',
    text: 'text-success-700 dark:text-success-400',
    icon: CheckCircle2,
  },
  achievable: {
    border: 'border-success-300/40 dark:border-success-700/40',
    bg: 'bg-success-50/70 dark:bg-success-900/15',
    text: 'text-success-700 dark:text-success-400',
    icon: Check,
  },
  achievable_tight: {
    border: 'border-warning-300/50 dark:border-warning-700/50',
    bg: 'bg-warning-50 dark:bg-warning-900/20',
    text: 'text-warning-800 dark:text-warning-300',
    icon: Gauge,
  },
  aggressive: {
    border: 'border-orange-300/50 dark:border-orange-700/50',
    bg: 'bg-orange-50 dark:bg-orange-900/20',
    text: 'text-orange-800 dark:text-orange-300',
    icon: Zap,
  },
  partial: {
    border: 'border-warning-300/50 dark:border-warning-700/50',
    bg: 'bg-warning-50 dark:bg-warning-900/20',
    text: 'text-warning-800 dark:text-warning-300',
    icon: PieChart,
  },
  projected: {
    border: 'border-sky-300/50 dark:border-sky-700/50',
    bg: 'bg-sky-50 dark:bg-sky-900/20',
    text: 'text-sky-800 dark:text-sky-300',
    icon: TrendingUp,
  },
  projected_funded: {
    border: 'border-sky-300/50 dark:border-sky-700/50',
    bg: 'bg-sky-50 dark:bg-sky-900/20',
    text: 'text-sky-800 dark:text-sky-300',
    icon: TrendingUp,
  },
  not_achievable: {
    border: 'border-danger-300/50 dark:border-danger-700/50',
    bg: 'bg-danger-50 dark:bg-danger-900/20',
    text: 'text-danger-800 dark:text-danger-300',
    icon: XCircle,
  },
};

function formatSignedCurrency(amount: number): string {
  const formatted = formatCurrency(Math.abs(amount));
  if (amount > 0) return `+${formatted}`;
  if (amount < 0) return `−${formatted}`;
  return formatted;
}

function PanelSkeleton() {
  return (
    <div className="rounded-lg border border-[var(--color-border)] p-3 mt-3 min-h-[5.5rem] animate-pulse space-y-2">
      <div className="h-5 w-32 bg-[var(--color-surface-hover)] rounded-full" />
      <div className="h-4 w-full bg-[var(--color-surface-hover)] rounded" />
      <div className="h-4 w-3/4 bg-[var(--color-surface-hover)] rounded" />
    </div>
  );
}

const GoalAchievabilityPanel = memo(function GoalAchievabilityPanel({
  goal,
  projection,
  messaging,
  isLoading,
  error,
  onViewSchedule,
  onEditGoal,
}: GoalAchievabilityPanelProps) {
  const headlineId = useId();
  const [suggestionsExpanded, setSuggestionsExpanded] = useState(false);

  if (isLoading || (!projection && !error)) {
    return <PanelSkeleton />;
  }

  if (error || !messaging || !projection) {
    return (
      <div className="rounded-lg border border-warning-300/50 dark:border-warning-700/50 bg-warning-50 dark:bg-warning-900/20 p-3 mt-3">
        <p className="text-sm text-warning-800 dark:text-warning-300">
          Couldn&apos;t load funding outlook. Check Schedule for details.
        </p>
      </div>
    );
  }

  const tierStyle = TIER_STYLES[messaging.comfortTier];
  const TierIcon = tierStyle.icon;
  const showTimeline =
    messaging.timeline &&
    messaging.comfortTier !== 'complete' &&
    messaging.comfortTier !== 'not_achievable' &&
    (messaging.timeline.paychecksToFund != null || messaging.timeline.estimatedFundedDate != null);

  const timelinePrimary = showTimeline && messaging.timeline?.paychecksToFund != null
    ? `Funded in ~${messaging.timeline.paychecksToFund} paycheck${messaging.timeline.paychecksToFund === 1 ? '' : 's'}`
    : showTimeline && messaging.timeline?.estimatedFundedDate
      ? `Est. ${format(parseISO(messaging.timeline.estimatedFundedDate), 'MMM d, yyyy')}`
      : null;

  const timelineSecondary = (() => {
    if (!messaging.timeline) return null;
    const { relativeToDeadline, paycheckDeltaFromDeadline } = messaging.timeline;
    if (relativeToDeadline === 'beats' && paycheckDeltaFromDeadline != null) {
      return `${paycheckDeltaFromDeadline} paycheck${paycheckDeltaFromDeadline === 1 ? '' : 's'} before your deadline`;
    }
    if (relativeToDeadline === 'misses' && paycheckDeltaFromDeadline != null) {
      return `misses deadline by ~${Math.abs(paycheckDeltaFromDeadline)} paycheck${Math.abs(paycheckDeltaFromDeadline) === 1 ? '' : 's'}`;
    }
    if (relativeToDeadline === 'meets') return 'right on your deadline';
    if (messaging.comfortTier === 'not_achievable') {
      return 'No paychecks allocate to this goal in the current schedule.';
    }
    return null;
  })();

  const showViewSchedule =
    messaging.scheduleLink &&
    messaging.comfortTier !== 'complete' &&
    onViewSchedule;

  const showEditCta =
    messaging.comfortTier === 'not_achievable' && onEditGoal;

  return (
    <div
      role="region"
      aria-labelledby={headlineId}
      aria-live="polite"
      className={clsx(
        'rounded-lg border p-3 mt-3',
        tierStyle.border,
        tierStyle.bg,
        showTimeline ? 'min-h-[7rem]' : 'min-h-[5.5rem]'
      )}
    >
      <p className="sr-only">{messaging.ariaMessage}</p>

      <div className="flex flex-wrap gap-1.5 mb-2">
        <span
          className={clsx(
            'inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full',
            tierStyle.bg,
            tierStyle.text,
            'border',
            tierStyle.border
          )}
        >
          <TierIcon className="w-3 h-3" aria-hidden />
          {messaging.badge}
        </span>
        {messaging.modifiers.includes('projected') && (
          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border border-dashed border-sky-400/60 text-sky-700 dark:text-sky-300 bg-sky-50/50 dark:bg-sky-900/20">
            <TrendingUp className="w-3 h-3" aria-hidden />
            Projected
          </span>
        )}
      </div>

      <h4 id={headlineId} className={clsx('text-sm font-semibold line-clamp-1', tierStyle.text)}>
        {messaging.headline}
      </h4>
      <p className={clsx('text-sm mt-1 line-clamp-2', tierStyle.text, 'opacity-90')}>
        {messaging.body}
      </p>

      {showTimeline && timelinePrimary && (
        <div className={clsx('mt-2 text-sm flex flex-col md:flex-row md:items-center gap-1 md:gap-2', tierStyle.text)}>
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock className="w-4 h-4 shrink-0 opacity-80" aria-hidden />
            <span>{timelinePrimary}</span>
            {messaging.timeline?.estimatedFundedDate && messaging.timeline.paychecksToFund != null && (
              <span className="hidden md:inline">
                · est. {format(parseISO(messaging.timeline.estimatedFundedDate), 'MMM d, yyyy')}
              </span>
            )}
          </span>
          {timelineSecondary && (
            <span className="text-xs opacity-80 md:before:content-['·'] md:before:mr-2">
              {timelineSecondary}
            </span>
          )}
        </div>
      )}

      {messaging.margin && (
        <p className={clsx('mt-2 text-xs font-mono tabular-nums truncate', tierStyle.text, 'opacity-80')}>
          Margin {formatSignedCurrency(messaging.margin.perPaycheckDelta)}/paycheck vs needed (
          {formatCurrency(messaging.margin.requiredPerPaycheck)} req ·{' '}
          {formatCurrency(messaging.margin.averageAllocatedPerPaycheck)} avg)
        </p>
      )}
      {messaging.marginFact && (
        <p className={clsx('mt-1 text-xs', tierStyle.text, 'opacity-80')}>
          {messaging.marginFact}
        </p>
      )}

      {messaging.footnote && (
        <p className="text-xs text-[var(--color-text-muted)] mt-2 italic">{messaging.footnote}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {showViewSchedule && messaging.scheduleLink && (
          <button
            type="button"
            onClick={() => onViewSchedule(messaging.scheduleLink!)}
            className={clsx('text-sm font-medium underline hover:no-underline', tierStyle.text)}
          >
            View funding on Schedule →
          </button>
        )}
        {showEditCta && (
          <button
            type="button"
            onClick={() => onEditGoal(goal.id)}
            className={clsx('text-sm font-medium underline hover:no-underline', tierStyle.text)}
          >
            Adjust priority or deadline →
          </button>
        )}
      </div>

      {messaging.cta && (
        <p className={clsx('text-xs mt-2', tierStyle.text, 'opacity-80')}>{messaging.cta}</p>
      )}

      {messaging.showSuggestions && messaging.suggestions.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            aria-expanded={suggestionsExpanded}
            onClick={() => setSuggestionsExpanded(!suggestionsExpanded)}
            className={clsx(
              'flex items-center gap-1 text-sm font-medium',
              tierStyle.text
            )}
          >
            <Lightbulb className="w-4 h-4" />
            {suggestionsExpanded ? 'Hide suggestions' : 'Show suggestions'}
            <ChevronDown
              className={clsx('w-4 h-4 transition-transform', suggestionsExpanded && 'rotate-180')}
            />
          </button>
          {suggestionsExpanded && (
            <ul className="mt-2 space-y-1 pl-1">
              {messaging.suggestions.map((suggestion: GoalSuggestion, idx: number) => (
                <li key={idx} className={clsx('text-sm', tierStyle.text, 'opacity-90')}>
                  → {suggestion.description}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
});

export default GoalAchievabilityPanel;
