import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SetupPage from '../../src/pages/SetupPage';
import { createMockElectronAPI } from '../mocks/electron-api.mock';

const mockNavigate = vi.fn();
const mockClearError = vi.fn();
const mockCheckAuthStatus = vi.fn();
const mockEnableBiometric = vi.fn();
let mockBiometricAvailable = false;
let mockAuthError: string | null = null;

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({
    enableBiometric: mockEnableBiometric,
    biometricAvailable: mockBiometricAvailable,
    error: mockAuthError,
    clearError: mockClearError,
    checkAuthStatus: mockCheckAuthStatus,
  }),
}));

describe('SetupPage', () => {
  let mockAPI: ReturnType<typeof createMockElectronAPI>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBiometricAvailable = false;
    mockAuthError = null;
    mockAPI = createMockElectronAPI();
    window.electronAPI = mockAPI as unknown as Window['electronAPI'];
    mockAPI.auth.createMasterPassword.mockResolvedValue({
      success: true,
      recoveryKey: 'word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12',
    });
    mockAPI.credentials.offerSave.mockResolvedValue({ success: true, saved: false });
  });

  function renderSetupPage() {
    return render(
      <MemoryRouter>
        <SetupPage />
      </MemoryRouter>
    );
  }

  it('fills password fields when Generate strong password is clicked', () => {
    renderSetupPage();

    fireEvent.click(screen.getByRole('button', { name: /generate strong password/i }));

    const passwordInput = screen.getByLabelText('Master Password') as HTMLInputElement;
    const confirmInput = screen.getByLabelText('Confirm Password') as HTMLInputElement;

    expect(passwordInput.value.length).toBeGreaterThanOrEqual(20);
    expect(confirmInput.value).toBe(passwordInput.value);
    expect(passwordInput.type).toBe('text');
    expect(confirmInput.type).toBe('text');
  });

  it('advances to recovery key and triggers save dialog after successful account creation', async () => {
    renderSetupPage();

    fireEvent.change(screen.getByLabelText('Master Password'), {
      target: { value: 'MySecurePass123!' },
    });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'MySecurePass123!' },
    });

    fireEvent.click(screen.getByRole('button', { name: /create password/i }));

    await waitFor(() => {
      expect(mockAPI.auth.createMasterPassword).toHaveBeenCalledWith('MySecurePass123!');
    });

    await waitFor(() => {
      expect(screen.getByText('Save Your Recovery Key')).toBeInTheDocument();
    });

    expect(mockAPI.credentials.offerSave).toHaveBeenCalledWith('MySecurePass123!');
    expect(screen.queryByText('Creating...')).not.toBeInTheDocument();
    expect(screen.queryByText('Create Master Password')).not.toBeInTheDocument();
  });

  it('does not block the UI on the save dialog promise', async () => {
    let offerSaveResolved = false;
    mockAPI.credentials.offerSave.mockImplementation(() => {
      return new Promise((resolve) => {
        setTimeout(() => {
          offerSaveResolved = true;
          resolve({ success: true, saved: false });
        }, 100);
      });
    });

    renderSetupPage();

    fireEvent.change(screen.getByLabelText('Master Password'), {
      target: { value: 'AnotherPass123!' },
    });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'AnotherPass123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create password/i }));

    await waitFor(() => {
      expect(screen.getByText('Save Your Recovery Key')).toBeInTheDocument();
    });

    expect(offerSaveResolved).toBe(false);
    expect(screen.queryByText('Creating...')).not.toBeInTheDocument();
  });

  it('shows validation error when passwords do not match', async () => {
    renderSetupPage();

    fireEvent.change(screen.getByLabelText('Master Password'), {
      target: { value: 'password-one' },
    });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'password-two' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create password/i }));

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
    expect(mockAPI.auth.createMasterPassword).not.toHaveBeenCalled();
    expect(mockAPI.credentials.offerSave).not.toHaveBeenCalled();
  });

  it('shows minimum length validation before IPC call', async () => {
    renderSetupPage();
    fireEvent.change(screen.getByLabelText('Master Password'), {
      target: { value: 'short' },
    });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'short' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create password/i }));

    expect(await screen.findByText('Password must be at least 8 characters')).toBeInTheDocument();
    expect(mockAPI.auth.createMasterPassword).not.toHaveBeenCalled();
  });

  it('shows API and thrown errors from create password path', async () => {
    mockAPI.auth.createMasterPassword.mockResolvedValueOnce({ success: false, error: 'Create failed' });
    renderSetupPage();

    fireEvent.change(screen.getByLabelText('Master Password'), {
      target: { value: 'GoodEnough123!' },
    });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'GoodEnough123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create password/i }));
    expect(await screen.findByText('Create failed')).toBeInTheDocument();

    mockAPI.auth.createMasterPassword.mockRejectedValueOnce(new Error('IPC exploded'));
    fireEvent.click(screen.getByRole('button', { name: /create password/i }));
    expect(await screen.findByText('IPC exploded')).toBeInTheDocument();
  });

  it('completes recovery key confirmation and biometric flow', async () => {
    mockBiometricAvailable = true;
    renderSetupPage();

    fireEvent.change(screen.getByLabelText('Master Password'), {
      target: { value: 'BiometricPass123!' },
    });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'BiometricPass123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create password/i }));

    await waitFor(() => {
      expect(screen.getByText('Save Your Recovery Key')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText(/i have saved my recovery key in a safe place/i));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => {
      expect(mockAPI.auth.clearPendingRecoveryKey).toHaveBeenCalled();
      expect(screen.getByText('Enable Fingerprint Unlock')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /enable fingerprint/i }));
    await waitFor(() => {
      expect(mockEnableBiometric).toHaveBeenCalled();
      expect(mockCheckAuthStatus).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('skips biometric when user chooses skip for now', async () => {
    mockBiometricAvailable = true;
    renderSetupPage();
    fireEvent.change(screen.getByLabelText('Master Password'), {
      target: { value: 'SkipBiometric123!' },
    });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'SkipBiometric123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create password/i }));

    await waitFor(() => {
      expect(screen.getByText('Save Your Recovery Key')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText(/i have saved my recovery key in a safe place/i));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /skip for now/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /skip for now/i }));
    await waitFor(() => {
      expect(mockCheckAuthStatus).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
    });
  });
});
