import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsPage from '../../src/pages/SettingsPage';
import { renderWithRouter } from '../helpers/renderWithProviders';
import { createMockElectronAPI } from '../mocks/electron-api.mock';

const mockUseTheme = vi.fn();
const mockUseAuth = vi.fn();
const mockUseBudget = vi.fn();
const mockUseDraft = vi.fn();

vi.mock('../../src/context/ThemeContext', () => ({
  useTheme: () => mockUseTheme(),
}));
vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));
vi.mock('../../src/context/BudgetContext', () => ({
  useBudget: () => mockUseBudget(),
}));
vi.mock('../../src/context/DraftContext', () => ({
  useDraft: () => mockUseDraft(),
}));

describe('SettingsPage', () => {
  const mockAPI = createMockElectronAPI();
  const setTheme = vi.fn();
  const enableBiometric = vi.fn();
  const updateBudget = vi.fn();
  const updateBudgetFields = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseTheme.mockReturnValue({ theme: 'system', setTheme });
    mockUseAuth.mockReturnValue({
      biometricAvailable: true,
      biometricEnabled: false,
      enableBiometric,
    });
    mockUseBudget.mockReturnValue({
      currentBudget: {
        id: 'budget-1',
        name: 'Main Budget',
        targetCashOnHand: 500,
        minCashOnHand: 100,
        minSavingsPerPaycheck: 50,
      },
      updateBudget,
    });
    mockUseDraft.mockReturnValue({
      isDraftMode: false,
      budgetFields: null,
      updateBudgetFields,
    });
  });

  describe('happy', () => {
    it('renders core sections and allows theme change', async () => {
      const user = userEvent.setup();
      renderWithRouter(<SettingsPage />, { mockAPI });

      expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Security' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Savings' })).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /Dark/i }));
      expect(setTheme).toHaveBeenCalledWith('dark');
      await user.click(screen.getByRole('button', { name: /Light/i }));
      await user.click(screen.getByRole('button', { name: /System/i }));

      await user.selectOptions(screen.getByLabelText('Auto-Lock'), '15');
      await waitFor(() => {
        expect(mockAPI.settings.update).toHaveBeenCalledWith({ autoLockMinutes: 15 });
        expect(mockAPI.auth.setAutoLock).toHaveBeenCalledWith(15);
      });

      await user.selectOptions(screen.getByLabelText('Currency'), 'EUR');
      await waitFor(() => {
        expect(mockAPI.settings.update).toHaveBeenCalledWith({ currency: 'EUR' });
      });

      await user.click(screen.getByRole('button', { name: 'Enable' }));
      await waitFor(() => {
        expect(enableBiometric).toHaveBeenCalled();
      });
    });
  });

  describe('sad', () => {
    it('saves APY updates and clamps out-of-range values', async () => {
      const user = userEvent.setup();
      renderWithRouter(<SettingsPage />, { mockAPI });
      const apy = screen.getByLabelText('Savings Account APY', { selector: 'input' });

      fireEvent.change(apy, { target: { value: '200' } });

      await waitFor(() => {
        expect(mockAPI.settings.update).toHaveBeenCalledWith({ savingsAPY: 100 });
      });
    });
  });

  describe('hostile', () => {
    it('updates allocation fields and submits password-change flow', async () => {
      const user = userEvent.setup();
      renderWithRouter(<SettingsPage />, { mockAPI });

      const targetCash = screen.getByLabelText('Target Cash on Hand');
      await user.clear(targetCash);
      await user.type(targetCash, '650');

      const minCash = screen.getByLabelText('Minimum Cash on Hand');
      await user.clear(minCash);
      await user.type(minCash, '175');

      const minSavings = screen.getByLabelText('Minimum Savings per Paycheck');
      await user.clear(minSavings);
      await user.type(minSavings, '85');

      await waitFor(() => {
        expect(updateBudget).toHaveBeenCalledWith('budget-1', { targetCashOnHand: 650 });
        expect(updateBudget).toHaveBeenCalledWith('budget-1', { minCashOnHand: 175 });
        expect(updateBudget).toHaveBeenCalledWith('budget-1', { minSavingsPerPaycheck: 85 });
      });

      await user.click(screen.getByRole('button', { name: 'Change' }));
      await user.type(screen.getByLabelText('Current Password'), 'old-password');
      await user.type(screen.getByLabelText('New Password'), 'new-password-123');
      await user.type(screen.getByLabelText('Confirm New Password'), 'new-password-123');
      await user.click(screen.getByRole('button', { name: 'Change Password' }));

      await waitFor(() => {
        expect(mockAPI.auth.changePassword).toHaveBeenCalledWith('old-password', 'new-password-123');
      });

      await user.click(screen.getByRole('button', { name: 'Change' }));
      await user.click(screen.getByRole('button', { name: /Close dialog/i }));
    });
  });
});
