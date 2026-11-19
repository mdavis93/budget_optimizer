import { PiggyBank, TrendingUp } from 'lucide-react';
import type { PaycheckEntry } from '../../types';

interface PaycheckSavingsTransferProps {
  paycheck: PaycheckEntry;
  formatCurrency: (amount: number) => string;
}

export default function PaycheckSavingsTransfer({
  paycheck,
  formatCurrency,
}: PaycheckSavingsTransferProps) {
  if (paycheck.savingsDeposit <= 0) return null;

  return (
    <div>
      <h4 className="text-sm font-medium text-(--color-text-secondary) mb-2 flex items-center gap-2">
        <PiggyBank className="w-4 h-4" />
        Savings Transfer
      </h4>
      <div className="flex items-center justify-between py-2 px-3 bg-primary-50 dark:bg-primary-500/10 rounded-lg">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary-500" />
          <span className="font-medium text-primary-700 dark:text-primary-300">Transfer to Savings</span>
        </div>
        <span className="font-mono font-semibold text-primary-600 dark:text-primary-400">
          {formatCurrency(paycheck.savingsDeposit)}
        </span>
      </div>
    </div>
  );
}
