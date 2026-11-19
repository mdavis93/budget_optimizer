import { Landmark } from 'lucide-react';
import type { PaycheckEntry } from '../../types';

interface PaycheckDebtPaydownProps {
  paycheck: PaycheckEntry;
  formatCurrency: (amount: number) => string;
}

export default function PaycheckDebtPaydown({
  paycheck,
  formatCurrency,
}: PaycheckDebtPaydownProps) {
  if (!paycheck.debtPayments || paycheck.debtPayments.length === 0) return null;

  return (
    <div>
      <h4 className="text-sm font-medium text-(--color-text-secondary) mb-2 flex items-center gap-2">
        <Landmark className="w-4 h-4" />
        Debt paydown ({paycheck.debtPayments.length})
      </h4>
      <div className="space-y-2">
        {paycheck.debtPayments.map((payment) => (
          <div key={payment.debtId} className="flex items-center justify-between py-2 px-3 bg-danger-50 dark:bg-danger-500/10 rounded-lg">
            <div className="flex items-center gap-2">
              <Landmark className="w-4 h-4 text-danger-500" />
              <span className="font-medium text-danger-700 dark:text-danger-300">Debt: {payment.creditorName}</span>
            </div>
            <span className="font-mono font-semibold text-danger-600 dark:text-danger-400">
              -{formatCurrency(payment.amount)}
            </span>
          </div>
        ))}
        {(paycheck.totalDebtPayments ?? 0) > 0 && (
          <div className="flex items-center justify-between py-2 px-3 bg-(--color-bg-tertiary) rounded-lg font-semibold">
            <span>Total Debt Paydown</span>
            <span className="font-mono text-danger-600 dark:text-danger-500">
              -{formatCurrency(paycheck.totalDebtPayments ?? 0)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
