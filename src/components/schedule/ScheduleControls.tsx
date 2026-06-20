import { useEffect, useMemo } from 'react';
import {
  buildViewportOptions,
  type GoalViewportSource,
} from '../../utils/scheduleViewportOptions';

const DEFAULT_VIEWPORT_MONTHS = 12;

interface ScheduleControlsProps {
  startDate: string;
  months: number;
  startingBalance: number;
  isLoading: boolean;
  calculationMonths?: number;
  goals?: ReadonlyArray<GoalViewportSource>;
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
  calculationMonths = DEFAULT_VIEWPORT_MONTHS,
  goals = [],
  onStartDateChange,
  onMonthsChange,
  onStartingBalanceChange,
  onGenerate,
}: ScheduleControlsProps) {
  const viewportOptions = useMemo(
    () => buildViewportOptions(calculationMonths, startDate, goals),
    [calculationMonths, startDate, goals]
  );

  // If the current selection no longer maps to an option (e.g. a goal was
  // deleted or renamed away), fall back to the 12-month default.
  const selectionIsValid = viewportOptions.some((option) => option.value === months);
  useEffect(() => {
    if (!selectionIsValid && months !== DEFAULT_VIEWPORT_MONTHS) {
      onMonthsChange(DEFAULT_VIEWPORT_MONTHS);
    }
  }, [selectionIsValid, months, onMonthsChange]);

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
            value={selectionIsValid ? months : DEFAULT_VIEWPORT_MONTHS}
            onChange={(e) => onMonthsChange(parseInt(e.target.value))}
            className="input"
          >
            {viewportOptions.map((option) => (
              <option key={`${option.value}-${option.label}`} value={option.value}>
                {option.label}
              </option>
            ))}
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
