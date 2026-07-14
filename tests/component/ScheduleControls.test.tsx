import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ScheduleControls from '../../src/components/schedule/ScheduleControls';

describe('ScheduleControls', () => {
  describe('goal-anchored viewport options', () => {
    it('renders a per-goal "Through ..." option when a goal extends the horizon', () => {
      render(
        <ScheduleControls
          startDate="2026-01-01"
          months={12}
          startingBalance={0}
          calculationMonths={18}
          goals={[{ goalName: 'Car', targetDate: '2027-07-01' }]}
          onStartDateChange={vi.fn()}
          onMonthsChange={vi.fn()}
          onStartingBalanceChange={vi.fn()}
        />
      );

      const option = screen.getByRole('option', { name: 'Through "Car" (Jul 2027)' }) as HTMLOptionElement;
      expect(option.value).toBe('18');
    });

    it('falls back to 12 when the current selection is no longer a valid option', async () => {
      const onMonthsChange = vi.fn();
      render(
        <ScheduleControls
          startDate="2026-01-01"
          months={18} // stale: no goal/horizon supports 18 here
          startingBalance={0}
          calculationMonths={12}
          goals={[]}
          onStartDateChange={vi.fn()}
          onMonthsChange={onMonthsChange}
          onStartingBalanceChange={vi.fn()}
        />
      );

      await waitFor(() => expect(onMonthsChange).toHaveBeenCalledWith(12));
    });
  });

  describe('happy', () => {
    it('updates date, view, and balance', () => {
      const onStartDateChange = vi.fn();
      const onMonthsChange = vi.fn();
      const onStartingBalanceChange = vi.fn();

      render(
        <ScheduleControls
          startDate="2026-01-01"
          months={3}
          startingBalance={500}
          onStartDateChange={onStartDateChange}
          onMonthsChange={onMonthsChange}
          onStartingBalanceChange={onStartingBalanceChange}
        />
      );

      fireEvent.change(screen.getByLabelText('Start Date'), { target: { value: '2026-02-01' } });
      fireEvent.change(screen.getByLabelText('View'), { target: { value: '6' } });
      fireEvent.change(screen.getByLabelText('Starting checking balance'), { target: { value: '725.5' } });

      expect(onStartDateChange).toHaveBeenCalledWith('2026-02-01');
      expect(onMonthsChange).toHaveBeenCalledWith(6);
      expect(onStartingBalanceChange).toHaveBeenCalledWith(725.5);
      expect(screen.queryByRole('button', { name: 'Generate Schedule' })).not.toBeInTheDocument();
    });
  });

  describe('sad', () => {
    it('falls back to zero when balance is invalid', () => {
      const onStartingBalanceChange = vi.fn();

      render(
        <ScheduleControls
          startDate="2026-01-01"
          months={3}
          startingBalance={500}
          onStartDateChange={vi.fn()}
          onMonthsChange={vi.fn()}
          onStartingBalanceChange={onStartingBalanceChange}
        />
      );

      fireEvent.change(screen.getByLabelText('Starting checking balance'), { target: { value: '' } });
      expect(onStartingBalanceChange).toHaveBeenCalledWith(0);
    });
  });
});
