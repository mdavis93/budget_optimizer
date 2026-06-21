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
          isLoading={false}
          calculationMonths={18}
          goals={[{ goalName: 'Car', targetDate: '2027-07-01' }]}
          onStartDateChange={vi.fn()}
          onMonthsChange={vi.fn()}
          onStartingBalanceChange={vi.fn()}
          onGenerate={vi.fn()}
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
          isLoading={false}
          calculationMonths={12}
          goals={[]}
          onStartDateChange={vi.fn()}
          onMonthsChange={onMonthsChange}
          onStartingBalanceChange={vi.fn()}
          onGenerate={vi.fn()}
        />
      );

      await waitFor(() => expect(onMonthsChange).toHaveBeenCalledWith(12));
    });
  });

  describe('happy', () => {
    it('updates date, view, balance, and generates schedule', () => {
      const onStartDateChange = vi.fn();
      const onMonthsChange = vi.fn();
      const onStartingBalanceChange = vi.fn();
      const onGenerate = vi.fn();

      render(
        <ScheduleControls
          startDate="2026-01-01"
          months={3}
          startingBalance={500}
          isLoading={false}
          onStartDateChange={onStartDateChange}
          onMonthsChange={onMonthsChange}
          onStartingBalanceChange={onStartingBalanceChange}
          onGenerate={onGenerate}
        />
      );

      fireEvent.change(screen.getByLabelText('Start Date'), { target: { value: '2026-02-01' } });
      fireEvent.change(screen.getByLabelText('View'), { target: { value: '6' } });
      fireEvent.change(screen.getByLabelText('Starting checking balance'), { target: { value: '725.5' } });
      fireEvent.click(screen.getByRole('button', { name: 'Generate Schedule' }));

      expect(onStartDateChange).toHaveBeenCalledWith('2026-02-01');
      expect(onMonthsChange).toHaveBeenCalledWith(6);
      expect(onStartingBalanceChange).toHaveBeenCalledWith(725.5);
      expect(onGenerate).toHaveBeenCalledTimes(1);
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
          isLoading={false}
          onStartDateChange={vi.fn()}
          onMonthsChange={vi.fn()}
          onStartingBalanceChange={onStartingBalanceChange}
          onGenerate={vi.fn()}
        />
      );

      fireEvent.change(screen.getByLabelText('Starting checking balance'), { target: { value: '' } });
      expect(onStartingBalanceChange).toHaveBeenCalledWith(0);
    });
  });

  describe('hostile', () => {
    it('disables generate while loading', () => {
      const onGenerate = vi.fn();

      render(
        <ScheduleControls
          startDate="2026-01-01"
          months={3}
          startingBalance={500}
          isLoading
          onStartDateChange={vi.fn()}
          onMonthsChange={vi.fn()}
          onStartingBalanceChange={vi.fn()}
          onGenerate={onGenerate}
        />
      );

      const button = screen.getByRole('button', { name: 'Generate Schedule' });
      expect(button).toBeDisabled();
      fireEvent.click(button);
      expect(onGenerate).not.toHaveBeenCalled();
    });
  });
});
