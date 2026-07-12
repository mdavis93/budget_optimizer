import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';

interface ScheduleRecommendationsProps {
  recommendations: string[];
  hasActionableRecommendations: boolean;
  expanded: boolean;
  onToggle: () => void;
}

export default function ScheduleRecommendations({
  recommendations,
  hasActionableRecommendations,
  expanded,
  onToggle,
}: ScheduleRecommendationsProps) {
  return (
    <div className={clsx(
      'card',
      hasActionableRecommendations
        ? 'border-warning-300 dark:border-warning-700 bg-warning-50 dark:bg-warning-900/30'
        : 'border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-500/10'
    )}>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between text-left"
      >
        <h3 className={clsx(
          'font-semibold',
          hasActionableRecommendations
            ? 'text-warning-700 dark:text-warning-400'
            : 'text-primary-700 dark:text-primary-400'
        )}>
          {hasActionableRecommendations ? 'Action Recommended' : 'Budget Insights'}
        </h3>
        <ChevronDown className={clsx(
          'w-5 h-5 transition-transform',
          hasActionableRecommendations
            ? 'text-warning-600 dark:text-warning-400'
            : 'text-primary-600 dark:text-primary-400',
          expanded && 'rotate-180'
        )} />
      </button>
      {expanded && (
        <ul className="space-y-2 mt-3">
          {recommendations.map((recommendation, index) => (
            <li key={index} className={clsx(
              'flex items-start gap-2 text-sm',
              hasActionableRecommendations
                ? 'text-warning-700 dark:text-warning-300'
                : 'text-primary-700 dark:text-primary-300'
            )}>
              <span className={clsx(
                'mt-0.5',
                hasActionableRecommendations ? 'text-warning-500' : 'text-primary-500'
              )}>→</span>
              {recommendation}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
