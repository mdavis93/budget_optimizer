import { DollarSign } from 'lucide-react';

interface RegionalSectionProps {
  currency: string;
  onCurrencyChange: (value: string) => void;
  isLoading: boolean;
}

export default function RegionalSection({ currency, onCurrencyChange, isLoading }: RegionalSectionProps) {
  return (
    <div className="card">
      <div className="flex items-center gap-3 mb-4">
        <DollarSign className="w-5 h-5 text-primary-500" />
        <h3 className="font-semibold">Regional</h3>
      </div>
      
      <div className="space-y-4">
        <div>
          <label htmlFor="settings-currency" className="label">Currency</label>
          <select
            id="settings-currency"
            value={currency}
            onChange={(e) => onCurrencyChange(e.target.value)}
            className="input"
            disabled={isLoading}
          >
            <option value="USD">US Dollar ($)</option>
            <option value="EUR">Euro (€)</option>
            <option value="GBP">British Pound (£)</option>
            <option value="CAD">Canadian Dollar (C$)</option>
            <option value="AUD">Australian Dollar (A$)</option>
            <option value="JPY">Japanese Yen (¥)</option>
          </select>
        </div>
      </div>
    </div>
  );
}
