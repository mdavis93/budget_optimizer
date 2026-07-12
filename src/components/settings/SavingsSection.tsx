import { PiggyBank } from 'lucide-react';

interface SavingsSectionProps {
  savingsAPY: number;
  onSavingsAPYChange: (value: number) => void;
  isLoading: boolean;
}

export default function SavingsSection({ savingsAPY, onSavingsAPYChange, isLoading }: SavingsSectionProps) {
  return (
    <div className="card">
      <div className="flex items-center gap-3 mb-4">
        <PiggyBank className="w-5 h-5 text-primary-500" />
        <h3 className="font-semibold">Savings</h3>
      </div>
      
      <div className="space-y-4">
        <div>
          <label htmlFor="settings-savings-apy" className="label">Savings Account APY</label>
          <div className="flex items-center gap-2">
            <input
              id="settings-savings-apy"
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={savingsAPY}
              onChange={(e) => onSavingsAPYChange(parseFloat(e.target.value) || 0)}
              className="input w-24"
              disabled={isLoading}
            />
            <span className="text-(--color-text-secondary)">%</span>
          </div>
          <p className="text-sm text-(--color-text-muted) mt-1">
            Annual Percentage Yield for savings projections in the Summary view
          </p>
        </div>
      </div>
    </div>
  );
}
