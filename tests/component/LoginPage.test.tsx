import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginPage from '../../src/pages/LoginPage';
import { renderWithRouter } from '../helpers/renderWithProviders';
import { createMockElectronAPI } from '../mocks/electron-api.mock';

const mockNavigate = vi.fn();
const mockUseAuth = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

describe('LoginPage', () => {
  const mockAPI = createMockElectronAPI();
  const unlock = vi.fn();
  const unlockWithBiometric = vi.fn();
  const clearError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockReset();
    mockAPI.auth.verifyRecoveryKey.mockResolvedValue({ success: true });
    mockAPI.auth.resetPasswordWithRecovery.mockResolvedValue({ success: true, newRecoveryKey: 'fresh recovery key words' });
    mockAPI.auth.clearPendingRecoveryKey.mockResolvedValue(undefined);
    mockUseAuth.mockReturnValue({
      unlock,
      unlockWithBiometric,
      biometricAvailable: true,
      biometricEnabled: true,
      error: null,
      clearError,
    });
  });

  describe('happy', () => {
    it('unlocks with password and renders biometric action', async () => {
      const user = userEvent.setup();
      unlock.mockResolvedValue(true);
      renderWithRouter(<LoginPage />, { mockAPI });

      const passwordInput = screen.getByLabelText('Master Password') as HTMLInputElement;
      await user.type(passwordInput, 'secret-1234');
      await user.click(screen.getByRole('button', { name: 'Unlock' }));

      await waitFor(() => {
        expect(unlock).toHaveBeenCalledWith('secret-1234');
        expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
      });
      expect(screen.getByRole('button', { name: /Unlock with Fingerprint/i })).toBeInTheDocument();
    });
  });

  describe('sad', () => {
    it('shows verify error in recovery mode', async () => {
      const user = userEvent.setup();
      mockAPI.auth.verifyRecoveryKey.mockResolvedValueOnce({ success: false, error: 'Invalid key' });
      renderWithRouter(<LoginPage />, { mockAPI });

      await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
      await user.click(screen.getByRole('button', { name: /Back to Login/i }));
      await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
      await user.type(screen.getByLabelText('Recovery Key'), 'wrong words');
      await user.click(screen.getByRole('button', { name: 'Verify Recovery Key' }));

      expect(await screen.findByText('Invalid key')).toBeInTheDocument();
    });

    it('fills password from keychain helper', async () => {
      const user = userEvent.setup();
      mockAPI.credentials.get.mockResolvedValueOnce({ success: true, password: 'from-keychain-123' });
      renderWithRouter(<LoginPage />, { mockAPI });

      await user.click(screen.getByRole('button', { name: /Fill from Keychain/i }));
      expect(screen.getByLabelText('Master Password')).toHaveValue('from-keychain-123');
    });
  });

  describe('hostile', () => {
    it('walks through recovery reset flow and confirms new key screen', async () => {
      const user = userEvent.setup();
      renderWithRouter(<LoginPage />, { mockAPI });

      await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
      await user.type(screen.getByLabelText('Recovery Key'), 'word1 word2 word3 word4');
      await user.click(screen.getByRole('button', { name: 'Verify Recovery Key' }));

      expect(await screen.findByRole('heading', { name: 'Create New Password' })).toBeInTheDocument();
      await user.type(screen.getByLabelText('New Password'), 'new-password-123');
      await user.type(screen.getByLabelText('Confirm New Password'), 'new-password-123');
      await user.click(screen.getByRole('button', { name: 'Reset Password' }));

      await waitFor(() => {
        expect(mockAPI.auth.resetPasswordWithRecovery).toHaveBeenCalledWith('word1 word2 word3 word4', 'new-password-123');
      });
      expect(await screen.findByText('New Recovery Key Generated')).toBeInTheDocument();
    });

    it('unlocks via biometric flow', async () => {
      const user = userEvent.setup();
      unlockWithBiometric.mockResolvedValue(true);
      renderWithRouter(<LoginPage />, { mockAPI });
      await user.click(screen.getByRole('button', { name: /Unlock with Fingerprint/i }));

      await waitFor(() => {
        expect(unlockWithBiometric).toHaveBeenCalled();
        expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
      });
    });

    it('does not call unlock when password is whitespace only', () => {
      renderWithRouter(<LoginPage />, { mockAPI });
      const form = screen.getByLabelText('Master Password').closest('form')!;
      fireEvent.change(screen.getByLabelText('Master Password'), { target: { value: '   ' } });
      fireEvent.submit(form);
      expect(unlock).not.toHaveBeenCalled();
    });

    it('shows reset-password validation errors for short or mismatched passwords', async () => {
      const user = userEvent.setup();
      renderWithRouter(<LoginPage />, { mockAPI });

      await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
      await user.type(screen.getByLabelText('Recovery Key'), 'word1 word2 word3 word4');
      await user.click(screen.getByRole('button', { name: 'Verify Recovery Key' }));
      expect(await screen.findByRole('heading', { name: 'Create New Password' })).toBeInTheDocument();

      const form = screen.getByRole('button', { name: 'Reset Password' }).closest('form')!;
      fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'short' } });
      fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: 'short' } });
      fireEvent.submit(form);
      expect(await screen.findByText('Password must be at least 8 characters')).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'longenough1' } });
      fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: 'different1' } });
      fireEvent.submit(form);
      expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
      expect(mockAPI.auth.resetPasswordWithRecovery).not.toHaveBeenCalled();
    });

    it('shows auth error and toggles password visibility', async () => {
      const user = userEvent.setup();
      unlock.mockResolvedValue(false);
      mockUseAuth.mockReturnValue({
        unlock,
        unlockWithBiometric,
        biometricAvailable: false,
        biometricEnabled: false,
        error: 'Invalid password',
        clearError,
      });
      renderWithRouter(<LoginPage />, { mockAPI });

      expect(screen.getByText('Invalid password')).toBeInTheDocument();
      const passwordInput = screen.getByLabelText('Master Password') as HTMLInputElement;
      expect(passwordInput.type).toBe('password');
      const toggleButton = passwordInput.parentElement?.querySelector('button');
      expect(toggleButton).toBeTruthy();
      await user.click(toggleButton!);
      expect(passwordInput.type).toBe('text');
      await user.click(toggleButton!);
      expect(passwordInput.type).toBe('password');
    });
  });
});
