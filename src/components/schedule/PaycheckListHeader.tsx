interface PaycheckListHeaderProps {
  paycheckCount: number;
  formatCurrency: (amount: number) => string;
  maxBudgetRemaining: number;
  debtPlanEnabled: boolean;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}

export default function PaycheckListHeader({
  paycheckCount,
  formatCurrency,
  maxBudgetRemaining,
  debtPlanEnabled,
  onExpandAll,
  onCollapseAll,
}: PaycheckListHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h3 className="font-semibold">Paychecks ({paycheckCount})</h3>
        <p className="text-xs text-(--color-text-muted)">
          Target cash on hand: {formatCurrency(maxBudgetRemaining)} •{' '}
          {debtPlanEnabled
            ? 'Surplus above target funds goals, debt paydown, and savings'
            : 'Surplus above target funds goals and savings'}
        </p>
      </div>
      <div className="flex gap-2">
        <button onClick={onExpandAll} className="btn-ghost text-sm">
          Expand All
        </button>
        <button onClick={onCollapseAll} className="btn-ghost text-sm">
          Collapse All
        </button>
      </div>
    </div>
  );
}
