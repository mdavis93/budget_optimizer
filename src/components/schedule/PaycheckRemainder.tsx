import clsx from 'clsx';
import type { PaycheckEntry } from '../../types';
import { paycheckSpendRemaining } from '@shared/incomePurpose';

interface PaycheckRemainderProps {
  paycheck: PaycheckEntry;
  formatCurrency: (amount: number) => string;
}

export default function PaycheckRemainder({
  paycheck,
  formatCurrency,
}: PaycheckRemainderProps) {
  const spendRemaining = paycheckSpendRemaining(paycheck);

  return (
    <>
      <div className="flex items-center justify-between py-3 px-4 bg-(--color-bg-secondary) rounded-lg border border-(--color-border)">
        <span className="font-semibold">Budget Remaining</span>
        <span className={clsx(
          'text-2xl font-mono font-bold',
          spendRemaining < 0 || paycheck.hasUnpayableBills
            ? 'text-danger-500'
            : paycheck.isShortfall
              ? 'text-warning-600 dark:text-warning-500'
              : 'text-success-500'
        )}>
          {formatCurrency(spendRemaining)}
        </span>
      </div>
      <p className="text-xs text-(--color-text-muted) text-center">
        Savings Balance: {formatCurrency(paycheck.totalSavings)}
      </p>
    </>
  );
}
