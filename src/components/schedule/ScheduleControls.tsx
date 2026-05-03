interface ScheduleControlsProps {
  startDate: string;
  months: number;
  startingBalance: number;
  isLoading: boolean;
  onStartDateChange: (date: string) => void;
  onMonthsChange: (months: number) => void;
  onStartingBalanceChange: (balance: number) => void;
  onGenerate: () => void;
}

export default function ScheduleControls({
  startDate,
  months,
  startingBalance,
  isLoading,
  onStartDateChange,
  onMonthsChange,
  onStartingBalanceChange,
  onGenerate,
}: ScheduleControlsProps) {
  return (
    <div className="card">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <label htmlFor="schedule-start-date" className="label">Start Date</label>
          <input
            id="schedule-start-date"
            type="date"
            value={startDate}
            onChange={(e) => onStartDateChange(e.target.value)}
            className="input"
          />
        </div>
        
        <div>
          <label htmlFor="schedule-view" className="label">View</label>
          <select
            id="schedule-view"
            value={months}
            onChange={(e) => onMonthsChange(parseInt(e.target.value))}
            className="input"
          >
            <option value={1}>1 Month</option>
            <option value={3}>3 Months</option>
            <option value={6}>6 Months</option>
            <option value={12}>12 Months</option>
          </select>
        </div>
        
        <div>
          <label htmlFor="schedule-starting-balance" className="label">Starting checking balance</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]">$</span>
            <input
              id="schedule-starting-balance"
              type="number"
              value={startingBalance}
              onChange={(e) => onStartingBalanceChange(parseFloat(e.target.value) || 0)}
              className="input pl-7"
              placeholder="0.00"
            />
          </div>
        </div>
        
        <div className="flex items-end">
          <button
            onClick={onGenerate}
            disabled={isLoading}
            className="btn-primary w-full"
          >
            Generate Schedule
          </button>
        </div>
      </div>
    </div>
  );
}
