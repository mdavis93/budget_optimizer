import { AlertTriangle, PiggyBank, Target } from 'lucide-react';
import clsx from 'clsx';
import { formatCurrency } from '../../utils/formatCurrency';
import IconTooltip from '../IconTooltip';

interface ScheduleSummaryCardsProps {
  summary: {
    totalIncome: number;
    totalExpenses: number;
    netBalance: number;
    finalSavingsBalance: number;
    shortfallCount: number;
  };
  totalGoalDeposits: number;
  hasAtRiskGoals: boolean;
}

const GOALS_AT_RISK_TOOLTIP =
  'One or more goals may not be funded by their deadline. Open the Goals page for details and suggestions.';

export default function ScheduleSummaryCards({
  summary,
  totalGoalDeposits,
  hasAtRiskGoals,
}: ScheduleSummaryCardsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      <div className="card">
        <p className="text-sm text-(--color-text-secondary) mb-1">Total Income</p>
        <p className="text-xl font-semibold text-success-500">{formatCurrency(summary.totalIncome)}</p>
      </div>
      <div className="card">
        <p className="text-sm text-(--color-text-secondary) mb-1">Total Expenses</p>
        <p className="text-xl font-semibold text-danger-500">{formatCurrency(summary.totalExpenses)}</p>
      </div>
      <div className="card">
        <p className="text-sm text-(--color-text-secondary) mb-1">Net Balance</p>
        <p className={clsx(
          'text-xl font-semibold',
          summary.netBalance >= 0 ? 'text-success-500' : 'text-danger-500'
        )}>
          {formatCurrency(summary.netBalance)}
        </p>
      </div>
      <div className="card bg-primary-50 dark:bg-primary-500/10 border-primary-200 dark:border-primary-800">
        <div className="flex items-center gap-2 mb-1">
          <PiggyBank className="w-4 h-4 text-primary-500" />
          <p className="text-sm text-primary-700 dark:text-primary-400">Total Saved</p>
        </div>
        <p className="text-xl font-semibold text-primary-600 dark:text-primary-400">
          {formatCurrency(summary.finalSavingsBalance)}
        </p>
      </div>
      <div className={clsx(
        'card',
        hasAtRiskGoals
          ? 'overflow-visible bg-warning-50 dark:bg-warning-500/10 border-warning-200 dark:border-warning-800'
          : 'bg-success-50 dark:bg-success-500/10 border-success-200 dark:border-success-800'
      )}>
        <div className="flex items-center gap-2 mb-1">
          <Target className={clsx('w-4 h-4', hasAtRiskGoals ? 'text-warning-500' : 'text-success-500')} />
          <p className={clsx(
            'text-sm',
            hasAtRiskGoals
              ? 'text-warning-700 dark:text-warning-400'
              : 'text-success-700 dark:text-success-400'
          )}>Goals Total</p>
          {hasAtRiskGoals && (
            <IconTooltip label={GOALS_AT_RISK_TOOLTIP} side="top">
              <AlertTriangle className="w-4 h-4 text-warning-500" aria-hidden="true" />
            </IconTooltip>
          )}
        </div>
        <p className={clsx(
          'text-xl font-semibold',
          hasAtRiskGoals
            ? 'text-warning-600 dark:text-warning-400'
            : 'text-success-600 dark:text-success-400'
        )}>
          {formatCurrency(totalGoalDeposits)}
        </p>
      </div>
      <div className="card">
        <p className="text-sm text-(--color-text-secondary) mb-1">Shortfalls</p>
        <p className={clsx(
          'text-xl font-semibold',
          summary.shortfallCount > 0 ? 'text-warning-500' : 'text-(--color-text-primary)'
        )}>
          {summary.shortfallCount}
        </p>
      </div>
    </div>
  );
}
