import { CreditCard, Plus } from 'lucide-react';
import { Bill } from '../../types';

interface UnsetupDebtCardProps {
  bill: Bill;
  onClick: () => void;
}

export default function UnsetupDebtCard({ bill, onClick }: UnsetupDebtCardProps) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left p-4 rounded-lg border-2 border-dashed border-(--color-border) hover:border-primary-500/50 hover:bg-(--color-bg-tertiary) transition-all group"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-(--color-bg-tertiary) flex items-center justify-center opacity-60 group-hover:opacity-100 transition-opacity">
          <CreditCard className="w-5 h-5 text-(--color-text-muted)" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-4">
            <h3 className="font-medium text-(--color-text-secondary) group-hover:text-(--color-text-primary) truncate transition-colors">
              {bill.creditorName}
            </h3>
            <span className="text-sm text-(--color-text-muted) whitespace-nowrap">
              ${bill.budgetedAmount.toFixed(2)}/mo
            </span>
          </div>
          <p className="text-sm text-(--color-text-muted) mt-0.5">
            Click to add remaining balance and APR
          </p>
        </div>
        <div className="ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Plus className="w-5 h-5 text-primary-500" />
        </div>
      </div>
    </button>
  );
}
