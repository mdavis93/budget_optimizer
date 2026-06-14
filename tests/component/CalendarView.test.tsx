import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import CalendarView from '../../src/components/schedule/CalendarView';
import { createMockPaycheck } from '../mocks/electron-api.mock';

describe('CalendarView', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-10T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('happy', () => {
    it('renders paycheck markers for current month', () => {
      const paycheck = createMockPaycheck({
        date: '2026-01-15',
        bills: [{ billId: 'b1', creditorName: 'Rent', amount: 500, dueDay: 1, billDate: '2026-01-01', priority: 'critical', isIncomeAttached: false }],
        savingsDeposit: 100,
      });

      render(<CalendarView paychecks={[paycheck]} />);
      expect(screen.getByText('January 2026')).toBeInTheDocument();
      expect(screen.getByText('+$2,000')).toBeInTheDocument();
      expect(screen.getByText('1 bills')).toBeInTheDocument();
      expect(screen.getByText('$100')).toBeInTheDocument();
    });
  });

  describe('sad', () => {
    it('shows month grid even when no paychecks exist', () => {
      render(<CalendarView paychecks={[]} />);
      expect(screen.getByText('January 2026')).toBeInTheDocument();
      expect(screen.queryByText(/\+\$/)).not.toBeInTheDocument();
    });
  });

  describe('hostile', () => {
    it('navigates months forward and backward', () => {
      render(<CalendarView paychecks={[]} />);
      fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
      expect(screen.getByText('February 2026')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
      expect(screen.getByText('January 2026')).toBeInTheDocument();
    });
  });
});
