import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { ErrorBoundary } from '../../src/components/ErrorBoundary';
import { renderWithRouter } from '../helpers/renderWithProviders';
import { createMockElectronAPI } from '../mocks/electron-api.mock';

function Boom() {
  throw new Error('kaboom');
}

describe('ErrorBoundary', () => {
  const mockAPI = createMockElectronAPI();

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockAPI.diagnostics.report.mockResolvedValue({ success: true, data: { id: 'diag-boundary' } });
    mockAPI.diagnostics.getEvent.mockResolvedValue({
      success: true,
      data: {
        exportedAt: '2026-01-01T00:00:00.000Z',
        app: { version: '1', electron: '0', platform: 'darwin', arch: 'arm64' },
        session: { uptimeMs: 1, budgetUnlocked: false },
        errors: [{ id: 'diag-boundary', message: 'kaboom' }],
      },
    });
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  describe('happy', () => {
    it('renders children when no error is thrown', () => {
      renderWithRouter(
        <ErrorBoundary>
          <div>safe child</div>
        </ErrorBoundary>,
        { mockAPI }
      );
      expect(screen.getByText('safe child')).toBeInTheDocument();
    });

    it('shows Copy report only after diagnostic id resolves and copies bundle', async () => {
      renderWithRouter(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
        { mockAPI }
      );
      expect(screen.queryByRole('button', { name: /Copy report/i })).not.toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Copy report/i })).toBeInTheDocument();
      });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Copy report/i }));
      });

      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
          expect.stringContaining('diag-boundary')
        );
      });
    });
  });

  describe('sad', () => {
    it('catches render errors and displays fallback without Copy when report fails', async () => {
      mockAPI.diagnostics.report.mockResolvedValue({ success: false, error: 'rate limit' });
      renderWithRouter(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
        { mockAPI }
      );
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(screen.getByText('kaboom')).toBeInTheDocument();
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.queryByRole('button', { name: /Copy report/i })).not.toBeInTheDocument();
    });
  });

  describe('hostile', () => {
    it('shows error details section for debugging', () => {
      renderWithRouter(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
        { mockAPI }
      );
      fireEvent.click(screen.getByText('Show error details'));
      expect(screen.getByText(/at Boom/)).toBeInTheDocument();
    });
  });
});
