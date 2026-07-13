import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { ToastProvider, useToast } from '../../src/components/Toast';
import { renderWithRouter } from '../helpers/renderWithProviders';
import { createMockElectronAPI } from '../mocks/electron-api.mock';

function ToastHarness() {
  const { showToast } = useToast();
  return (
    <div>
      <button onClick={() => showToast('success', 'Saved successfully', 1000)}>show-success</button>
      <button onClick={() => showToast('error', 'Danger alert', 0)}>show-error-persist</button>
    </div>
  );
}

describe('Toast', () => {
  const mockAPI = createMockElectronAPI();

  beforeEach(() => {
    vi.useFakeTimers();
  });

  describe('happy', () => {
    it('shows a toast and auto-dismisses by duration', () => {
      renderWithRouter(
        <ToastProvider>
          <ToastHarness />
        </ToastProvider>,
        { mockAPI }
      );
      fireEvent.click(screen.getByRole('button', { name: 'show-success' }));
      expect(screen.getByText('Saved successfully')).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(1200);
      });
      expect(screen.queryByText('Saved successfully')).not.toBeInTheDocument();
    });
  });

  describe('sad', () => {
    it('dismisses a persistent toast manually', () => {
      renderWithRouter(
        <ToastProvider>
          <ToastHarness />
        </ToastProvider>,
        { mockAPI }
      );
      fireEvent.click(screen.getByRole('button', { name: 'show-error-persist' }));
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
      expect(screen.queryByText('Danger alert')).not.toBeInTheDocument();
    });
  });

  describe('hostile', () => {
    it('renders alert role for accessibility', () => {
      renderWithRouter(
        <ToastProvider>
          <ToastHarness />
        </ToastProvider>,
        { mockAPI }
      );
      fireEvent.click(screen.getByRole('button', { name: 'show-success' }));
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('anchors the toast viewport to --app-toast-bottom', () => {
      renderWithRouter(
        <ToastProvider>
          <ToastHarness />
        </ToastProvider>,
        { mockAPI }
      );
      const viewport = screen.getByTestId('toast-viewport');
      expect(viewport).toHaveStyle({ bottom: 'var(--app-toast-bottom, 1rem)' });
    });
  });
});
