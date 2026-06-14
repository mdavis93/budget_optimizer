import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '../../src/context/AuthContext';
import { createMockElectronAPI } from '../mocks/electron-api.mock';

function AuthHarness() {
  const auth = useAuth();

  return (
    <div>
      <div data-testid="unlocked">{String(auth.isUnlocked)}</div>
      <div data-testid="first-time">{String(auth.isFirstTime)}</div>
      <div data-testid="loading">{String(auth.isLoading)}</div>
      <div data-testid="error">{auth.error ?? ''}</div>
      <div data-testid="bio-enabled">{String(auth.biometricEnabled)}</div>
      <button onClick={() => void auth.checkAuthStatus()}>check</button>
      <button onClick={() => void auth.createPassword('StrongPass123!')}>create</button>
      <button onClick={() => void auth.unlock('StrongPass123!')}>unlock</button>
      <button onClick={() => void auth.lock()}>lock</button>
      <button onClick={() => void auth.enableBiometric()}>enable-bio</button>
      <button onClick={() => void auth.unlockWithBiometric()}>unlock-bio</button>
      <button onClick={() => auth.clearError()}>clear-error</button>
    </div>
  );
}

describe('AuthContext', () => {
  let mockAPI: ReturnType<typeof createMockElectronAPI>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAPI = createMockElectronAPI();
    window.electronAPI = mockAPI as unknown as Window['electronAPI'];
  });

  function renderProvider() {
    return render(
      <AuthProvider>
        <AuthHarness />
      </AuthProvider>
    );
  }

  describe('happy', () => {
    it('checks auth status and updates context values', async () => {
      mockAPI.auth.isFirstTimeSetup.mockResolvedValue(false);
      mockAPI.checkBiometricAvailable.mockResolvedValue(true);
      mockAPI.auth.isBiometricEnabled.mockResolvedValue(true);
      mockAPI.auth.isUnlocked.mockResolvedValue(true);

      renderProvider();
      fireEvent.click(screen.getByText('check'));

      await waitFor(() => {
        expect(screen.getByTestId('unlocked')).toHaveTextContent('true');
      });
      expect(screen.getByTestId('first-time')).toHaveTextContent('false');
      expect(screen.getByTestId('bio-enabled')).toHaveTextContent('true');
      expect(mockAPI.auth.isBiometricEnabled).toHaveBeenCalledTimes(1);
    });

    it('creates password, unlocks, and locks', async () => {
      mockAPI.auth.createMasterPassword.mockResolvedValue({ success: true, recoveryKey: 'rk' });
      mockAPI.auth.unlock.mockResolvedValue({ success: true });

      renderProvider();

      fireEvent.click(screen.getByText('create'));
      await waitFor(() => {
        expect(screen.getByTestId('unlocked')).toHaveTextContent('true');
      });
      expect(screen.getByTestId('first-time')).toHaveTextContent('false');

      fireEvent.click(screen.getByText('lock'));
      await waitFor(() => {
        expect(screen.getByTestId('unlocked')).toHaveTextContent('false');
      });

      fireEvent.click(screen.getByText('unlock'));
      await waitFor(() => {
        expect(screen.getByTestId('unlocked')).toHaveTextContent('true');
      });
    });
  });

  describe('sad', () => {
    it('sets error when createPassword fails', async () => {
      mockAPI.auth.createMasterPassword.mockResolvedValue({ success: false, error: 'Nope' });

      renderProvider();
      fireEvent.click(screen.getByText('create'));

      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent('Nope');
      });
    });

    it('sets error when unlock returns unsuccessful result', async () => {
      mockAPI.auth.unlock.mockResolvedValue({ success: false, error: 'Bad password' });

      renderProvider();
      fireEvent.click(screen.getByText('unlock'));

      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent('Bad password');
      });
    });
  });

  describe('hostile', () => {
    it('falls back to first-time setup when checkAuthStatus throws', async () => {
      mockAPI.auth.isFirstTimeSetup.mockRejectedValue(new Error('IPC unavailable'));

      renderProvider();
      fireEvent.click(screen.getByText('check'));

      await waitFor(() => {
        expect(screen.getByTestId('first-time')).toHaveTextContent('true');
      });
      expect(screen.getByTestId('unlocked')).toHaveTextContent('false');
      expect(screen.getByTestId('error')).toHaveTextContent('Failed to initialize application');
    });

    it('handles unexpected unlock exception', async () => {
      mockAPI.auth.unlock.mockRejectedValue(new Error('boom'));

      renderProvider();
      fireEvent.click(screen.getByText('unlock'));

      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent('An unexpected error occurred');
      });
    });

    it('handles biometric unlock success and failure paths', async () => {
      mockAPI.auth.unlockWithBiometric.mockResolvedValueOnce({ success: true });
      renderProvider();
      fireEvent.click(screen.getByText('unlock-bio'));
      await waitFor(() => {
        expect(screen.getByTestId('unlocked')).toHaveTextContent('true');
      });

      mockAPI.auth.unlockWithBiometric.mockResolvedValueOnce({ success: false, error: 'No match' });
      fireEvent.click(screen.getByText('unlock-bio'));
      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent('No match');
      });
    });

    it('handles enableBiometric failure and clearError', async () => {
      mockAPI.auth.enableBiometric.mockResolvedValue({ success: false });
      renderProvider();
      fireEvent.click(screen.getByText('enable-bio'));
      await waitFor(() => {
        expect(screen.getByTestId('bio-enabled')).toHaveTextContent('false');
      });

      mockAPI.auth.unlock.mockResolvedValue({ success: false, error: 'Bad password' });
      fireEvent.click(screen.getByText('unlock'));
      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent('Bad password');
      });
      fireEvent.click(screen.getByText('clear-error'));
      expect(screen.getByTestId('error')).toHaveTextContent('');
    });

    it('throws when useAuth is used outside provider', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(() => render(<AuthHarness />)).toThrow('useAuth must be used within an AuthProvider');
      consoleError.mockRestore();
    });
  });
});
