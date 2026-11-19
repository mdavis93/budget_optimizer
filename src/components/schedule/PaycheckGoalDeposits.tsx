import { Target } from 'lucide-react';
import type { PaycheckEntry } from '../../types';

interface PaycheckGoalDepositsProps {
  paycheck: PaycheckEntry;
  formatCurrency: (amount: number) => string;
}

export default function PaycheckGoalDeposits({
  paycheck,
  formatCurrency,
}: PaycheckGoalDepositsProps) {
  if (!paycheck.goalDeposits || paycheck.goalDeposits.length === 0) return null;

  return (
    <div>
      <h4 className="text-sm font-medium text-(--color-text-secondary) mb-2 flex items-center gap-2">
        <Target className="w-4 h-4" />
        Goal Deposits ({paycheck.goalDeposits.length})
      </h4>
      <div className="space-y-2">
        {paycheck.goalDeposits.map((deposit, idx) => (
          <div key={idx} className="flex items-center justify-between py-2 px-3 bg-purple-50 dark:bg-purple-500/10 rounded-lg">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-purple-500" />
              <span className="font-medium text-purple-700 dark:text-purple-300">Goal: {deposit.goalName}</span>
            </div>
            <span className="font-mono font-semibold text-purple-600 dark:text-purple-400">
              -{formatCurrency(deposit.amount)}
            </span>
          </div>
        ))}
        {paycheck.totalGoalDeposits > 0 && (
          <div className="flex items-center justify-between py-2 px-3 bg-(--color-bg-tertiary) rounded-lg font-semibold">
            <span>Total Goal Deposits</span>
            <span className="font-mono text-purple-600 dark:text-purple-500">
              -{formatCurrency(paycheck.totalGoalDeposits)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
