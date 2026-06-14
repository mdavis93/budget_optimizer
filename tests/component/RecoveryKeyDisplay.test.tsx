import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import RecoveryKeyDisplay from '../../src/components/RecoveryKeyDisplay';
import { renderWithRouter } from '../helpers/renderWithProviders';
import { createMockElectronAPI } from '../mocks/electron-api.mock';

describe('RecoveryKeyDisplay', () => {
  const mockAPI = createMockElectronAPI();
  const onConfirm = vi.fn();
  const writeText = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, { clipboard: { writeText } });
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock');
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  describe('happy', () => {
    it('renders recovery key words and enables continue after confirmation', () => {
      renderWithRouter(
        <RecoveryKeyDisplay recoveryKey="one two three four five six seven eight nine ten eleven twelve" onConfirm={onConfirm} />,
        { mockAPI }
      );

      expect(screen.getByText('1.')).toBeInTheDocument();
      expect(screen.getByText('twelve')).toBeInTheDocument();
      const continueButton = screen.getByRole('button', { name: 'Continue' });
      expect(continueButton).toBeDisabled();
      fireEvent.click(screen.getByLabelText(/I have saved my recovery key/i));
      expect(continueButton).toBeEnabled();
    });
  });

  describe('sad', () => {
    it('copies key to clipboard and shows copied state', async () => {
      renderWithRouter(
        <RecoveryKeyDisplay recoveryKey="alpha beta gamma delta" onConfirm={onConfirm} />,
        { mockAPI }
      );
      fireEvent.click(screen.getByRole('button', { name: /Copy to Clipboard/i }));
      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith('alpha beta gamma delta');
      });
      expect(screen.getByText('Copied!')).toBeInTheDocument();
    });
  });

  describe('hostile', () => {
    it('triggers download flow and confirm callback', () => {
      renderWithRouter(
        <RecoveryKeyDisplay recoveryKey="k1 k2 k3 k4" onConfirm={onConfirm} />,
        { mockAPI }
      );
      fireEvent.click(screen.getByRole('button', { name: 'Download' }));
      expect(globalThis.URL.createObjectURL).toHaveBeenCalled();

      fireEvent.click(screen.getByLabelText(/I have saved my recovery key/i));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      expect(onConfirm).toHaveBeenCalled();
    });
  });
});
