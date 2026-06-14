import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
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
  });

  describe('sad', () => {
    it('catches render errors and displays fallback', () => {
      renderWithRouter(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
        { mockAPI }
      );
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(screen.getByText('kaboom')).toBeInTheDocument();
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
