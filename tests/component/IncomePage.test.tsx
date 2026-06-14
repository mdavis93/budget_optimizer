import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import IncomePage from '../../src/pages/IncomePage';
import { createMockIncome } from '../mocks/electron-api.mock';

const mockUseData = vi.fn();

vi.mock('../../src/context/DataContext', () => ({
  useData: () => mockUseData(),
}));

describe('IncomePage', () => {
  const createIncome = vi.fn(async () => true);
  const updateIncome = vi.fn(async () => true);
  const deleteIncome = vi.fn(async () => true);

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseData.mockReturnValue({
      incomes: [createMockIncome({ sourceName: 'Primary Job', amount: 2500, startDate: '2026-01-01' })],
      createIncome,
      updateIncome,
      deleteIncome,
    });
  });

  describe('happy', () => {
    it('renders income list details', () => {
      render(<IncomePage />);
      expect(screen.getByText('Primary Job')).toBeInTheDocument();
      expect(screen.getByText('$2,500.00')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Edit Primary Job/i })).toBeInTheDocument();
    });
  });

  describe('sad', () => {
    it('shows empty state when there are no income sources', () => {
      mockUseData.mockReturnValue({
        incomes: [],
        createIncome,
        updateIncome,
        deleteIncome,
      });

      render(<IncomePage />);
      expect(screen.getByText('No income sources')).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: /Add Income/i }).length).toBeGreaterThan(0);
    });
  });

  describe('hostile', () => {
    it('submits add, edit, and delete income actions', async () => {
      const user = userEvent.setup();
      render(<IncomePage />);
      await user.click(screen.getAllByRole('button', { name: /Add Income/i })[0]);

      fireEvent.change(screen.getByLabelText('Income Source Name'), { target: { value: 'Freelance' } });
      fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '900' } });
      fireEvent.change(screen.getByLabelText('Start Date (First Payment)'), { target: { value: '2026-03-15' } });
      await user.click(screen.getAllByRole('button', { name: 'Add Income' })[1]);

      await waitFor(() => {
        expect(createIncome).toHaveBeenCalledWith(
          expect.objectContaining({
            sourceName: 'Freelance',
            amount: 900,
            startDate: '2026-03-15',
          })
        );
      });

      await user.click(screen.getAllByRole('button', { name: /Add Income/i })[0]);
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      await user.click(screen.getByRole('button', { name: /Edit Primary Job/i }));
      const sourceInput = screen.getByLabelText('Income Source Name');
      await user.clear(sourceInput);
      await user.type(sourceInput, 'Primary Job Updated');
      await user.click(screen.getByRole('button', { name: 'Update Income' }));
      await waitFor(() => {
        expect(updateIncome).toHaveBeenCalledWith(
          'income-1',
          expect.objectContaining({ sourceName: 'Primary Job Updated' })
        );
      });

      await user.click(screen.getByRole('button', { name: /Delete Primary Job/i }));
      await user.click(screen.getByRole('button', { name: /^Delete$/i }));
      await waitFor(() => {
        expect(deleteIncome).toHaveBeenCalledWith('income-1');
      });
    });

    it('updates cadence and active status when editing income', async () => {
      const user = userEvent.setup();
      render(<IncomePage />);

      await user.click(screen.getByRole('button', { name: /Edit Primary Job/i }));
      await user.selectOptions(screen.getByLabelText('Payment Frequency'), 'monthly');
      await user.click(screen.getByText('Active Income Source').closest('div')!.querySelector('button')!);
      await user.click(screen.getByRole('button', { name: 'Update Income' }));

      await waitFor(() => {
        expect(updateIncome).toHaveBeenCalledWith(
          'income-1',
          expect.objectContaining({ cadence: 'monthly', isActive: false })
        );
      });
    });
  });
});
