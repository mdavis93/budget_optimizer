import { format, parseISO } from 'date-fns';
import {
  Wallet,
  ChevronDown,
  ChevronUp,
  PiggyBank,
  Target,
  AlertTriangle,
  Landmark,
} from 'lucide-react';
import clsx from 'clsx';
import type { PaycheckBill, PaycheckEntry } from '../../types';
import { PaycheckBudgetCluster, PaycheckStatusBadges } from './paycheckStatus';

interface PaycheckCardHeaderProps {
  paycheck: PaycheckEntry;
  isReserved: boolean;
  isHardShortfall: boolean;
  isBelowMinimum: boolean;
  isBreakGlass: boolean;
  isExpanded: boolean;
  visibleBills: PaycheckBill[];
  hasUnpayableBills: boolean;
  unpayableCount: number;
  warningTooltip: string | null;
  formatCurrency: (amount: number) => string;
  onToggle: () => void;
}

export default function PaycheckCardHeader({
  paycheck,
  isReserved,
  isHardShortfall,
  isBelowMinimum,
  isBreakGlass,
  isExpanded,
  visibleBills,
  hasUnpayableBills,
  unpayableCount,
  warningTooltip,
  formatCurrency,
  onToggle,
}: PaycheckCardHeaderProps) {
  return (
    <button
      onClick={onToggle}
      aria-expanded={isExpanded}
      aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${isReserved ? 'savings deposit' : 'paycheck'} for ${format(parseISO(paycheck.date), 'MMMM d, yyyy')}`}
      className="w-full flex items-center justify-between p-0 text-left"
    >
      <div className="flex items-center gap-4">
        <div
          className={clsx(
            'p-3 rounded-lg',
            isReserved
              ? 'bg-cyan-100 dark:bg-cyan-500/20'
              : isHardShortfall
                ? 'bg-danger-100 dark:bg-danger-500/20'
                : isBelowMinimum || isBreakGlass
                  ? 'bg-warning-100 dark:bg-warning-500/20'
                  : 'bg-success-100 dark:bg-success-500/20'
          )}
        >
          {isReserved ? (
            <Landmark className="w-6 h-6 text-cyan-700 dark:text-cyan-400" />
          ) : (
            <Wallet
              className={clsx(
                'w-6 h-6',
                isHardShortfall
                  ? 'text-danger-600 dark:text-danger-500'
                  : isBelowMinimum || isBreakGlass
                    ? 'text-warning-600 dark:text-warning-500'
                    : 'text-success-600 dark:text-success-500'
              )}
            />
          )}
        </div>
        <div>
          <p className="font-semibold text-lg flex items-center gap-2 flex-wrap">
            {format(parseISO(paycheck.date), 'EEEE, MMMM d, yyyy')}
            <PaycheckStatusBadges
              paycheck={paycheck}
              isReserved={isReserved}
              isBreakGlass={isBreakGlass}
              isBelowMinimum={isBelowMinimum}
              formatCurrency={formatCurrency}
            />
          </p>
          <div className="flex items-center gap-4 text-sm text-(--color-text-secondary)">
            <span>{paycheck.incomeSources.map((s) => s.name).join(' + ')}</span>
            {!isReserved && (
              <>
                <span>•</span>
                <span>
                  {visibleBills.length} bill{visibleBills.length !== 1 ? 's' : ''}
                </span>
              </>
            )}
            {hasUnpayableBills && (
              <>
                <span>•</span>
                <span className="text-danger-600 dark:text-danger-400 font-semibold flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                  {unpayableCount} unpayable
                </span>
              </>
            )}
            {paycheck.goalDeposits && paycheck.goalDeposits.length > 0 && (
              <>
                <span>•</span>
                <span className="text-purple-500 flex items-center gap-1">
                  <Target className="w-3 h-3" />
                  {formatCurrency(paycheck.totalGoalDeposits)} to goals
                </span>
              </>
            )}
            {paycheck.savingsDeposit > 0 && (
              <>
                <span>•</span>
                <span className="text-primary-500 flex items-center gap-1">
                  <PiggyBank className="w-3 h-3" />
                  {formatCurrency(paycheck.savingsDeposit)} to savings
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-6">
        <PaycheckBudgetCluster
          paycheck={paycheck}
          isReserved={isReserved}
          isHardShortfall={isHardShortfall}
          isBelowMinimum={isBelowMinimum}
          isBreakGlass={isBreakGlass}
          warningTooltip={warningTooltip}
          formatCurrency={formatCurrency}
        />
        {isExpanded ? (
          <ChevronUp className="w-5 h-5 text-(--color-text-muted)" />
        ) : (
          <ChevronDown className="w-5 h-5 text-(--color-text-muted)" />
        )}
      </div>
    </button>
  );
}
