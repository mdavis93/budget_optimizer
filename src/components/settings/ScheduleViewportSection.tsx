import { CalendarDays } from 'lucide-react';
import {
  SCHEDULE_VIEWPORT_MONTHS,
  type ScheduleViewportMonths,
} from '@shared/scheduleViewportMonths';

interface ScheduleViewportSectionProps {
  defaultScheduleMonths: ScheduleViewportMonths;
  onDefaultScheduleMonthsChange: (value: ScheduleViewportMonths) => void;
  isLoading: boolean;
}

export default function ScheduleViewportSection({
  defaultScheduleMonths,
  onDefaultScheduleMonthsChange,
  isLoading,
}: ScheduleViewportSectionProps) {
  return (
    <div className="card">
      <div className="flex items-center gap-3 mb-4">
        <CalendarDays className="w-5 h-5 text-primary-500" />
        <h3 className="font-semibold">Schedule window</h3>
      </div>

      <div className="space-y-4">
        <div>
          <label htmlFor="settings-schedule-viewport" className="label">
            Default schedule window
          </label>
          <select
            id="settings-schedule-viewport"
            value={defaultScheduleMonths}
            onChange={(e) =>
              onDefaultScheduleMonthsChange(Number(e.target.value) as ScheduleViewportMonths)
            }
            className="input"
            disabled={isLoading}
          >
            {SCHEDULE_VIEWPORT_MONTHS.map((months) => (
              <option key={months} value={months}>
                {months} Months
              </option>
            ))}
          </select>
          <p className="text-sm text-(--color-text-muted) mt-1">
            Dashboard, Schedule, Summary, and Export open on this window. The solver still funds
            twelve months and reserves the following month&apos;s bills in the last funded month.
          </p>
        </div>
      </div>
    </div>
  );
}
