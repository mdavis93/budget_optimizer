import { Target, Wallet } from 'lucide-react';

interface BudgetAllocationSectionProps {
  budgetName: string;
  targetCashOnHand: number;
  minCashOnHand: number;
  minSavingsPerPaycheck: number;
  onTargetCashOnHandChange: (value: number) => void;
  onMinCashOnHandChange: (value: number) => void;
  onMinSavingsPerPaycheckChange: (value: number) => void;
}

export default function BudgetAllocationSection({
  budgetName,
  targetCashOnHand,
  minCashOnHand,
  minSavingsPerPaycheck,
  onTargetCashOnHandChange,
  onMinCashOnHandChange,
  onMinSavingsPerPaycheckChange,
}: BudgetAllocationSectionProps) {
  return (
    <div className="card">
      <div className="flex items-center gap-3 mb-4">
        <Target className="w-5 h-5 text-primary-500" />
        <h3 className="font-semibold">Budget Allocation</h3>
      </div>
      <p className="text-sm text-(--color-text-secondary) mb-4">
        Configure how surplus funds are allocated between cash reserves, savings, and goals for {budgetName}.
      </p>
      
      <div className="space-y-4">
        <div>
          <label htmlFor="settings-target-cash" className="label">Target Cash on Hand</label>
          <div className="flex items-center gap-2">
            <span className="text-(--color-text-secondary)">$</span>
            <input
              id="settings-target-cash"
              type="number"
              min="0"
              step="10"
              value={targetCashOnHand}
              onChange={(e) => onTargetCashOnHandChange(parseFloat(e.target.value) || 0)}
              className="input w-32"
            />
          </div>
          <p className="text-sm text-(--color-text-muted) mt-1">
            Surplus above this amount funds goals and savings
          </p>
        </div>

        <div>
          <label htmlFor="settings-min-cash" className="label">Minimum Cash on Hand</label>
          <div className="flex items-center gap-2">
            <span className="text-(--color-text-secondary)">$</span>
            <input
              id="settings-min-cash"
              type="number"
              min="0"
              step="10"
              value={minCashOnHand}
              onChange={(e) => onMinCashOnHandChange(parseFloat(e.target.value) || 0)}
              className="input w-32"
            />
          </div>
          <p className="text-sm text-(--color-text-muted) mt-1">
            Floor balance - goals cannot reduce cash below this
          </p>
        </div>

        <div className="pt-2 border-t border-(--color-border)">
          <label htmlFor="settings-min-savings" className="label flex items-center gap-2">
            <Wallet className="w-4 h-4" />
            Minimum Savings per Paycheck
          </label>
          <div className="flex items-center gap-2">
            <span className="text-(--color-text-secondary)">$</span>
            <input
              id="settings-min-savings"
              type="number"
              min="0"
              step="10"
              value={minSavingsPerPaycheck}
              onChange={(e) => onMinSavingsPerPaycheckChange(parseFloat(e.target.value) || 0)}
              className="input w-32"
            />
          </div>
          <p className="text-sm text-(--color-text-muted) mt-1">
            This amount goes to savings first, before allocating to goals. 
            Set to 0 to let goals take priority over savings.
          </p>
        </div>
      </div>
    </div>
  );
}
