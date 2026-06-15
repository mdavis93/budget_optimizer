import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, useTheme } from '../../src/context/ThemeContext';
import { renderWithRouter } from '../helpers/renderWithProviders';
import { createMockElectronAPI } from '../mocks/electron-api.mock';
import { suppressExpectedConsoleErrors } from '../helpers/suppressExpectedConsoleErrors';

function ThemeHarness() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div>
      <div data-testid="theme">{theme}</div>
      <div data-testid="resolved">{resolvedTheme}</div>
      <button onClick={() => setTheme('dark')}>set-dark</button>
      <button onClick={() => setTheme('light')}>set-light</button>
    </div>
  );
}

describe('ThemeContext', () => {
  const mockAPI = createMockElectronAPI();
  const mediaHandlers: Array<(event: MediaQueryListEvent) => void> = [];

  beforeEach(() => {
    localStorage.clear();
    mediaHandlers.length = 0;
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn((_type: string, handler: (event: MediaQueryListEvent) => void) => {
          mediaHandlers.push(handler);
        }),
        removeEventListener: vi.fn(),
      })),
    });
    document.documentElement.className = '';
  });

  describe('happy', () => {
    it('toggles theme and updates root class', () => {
      renderWithRouter(
        <ThemeProvider>
          <ThemeHarness />
        </ThemeProvider>,
        { mockAPI }
      );

      fireEvent.click(screen.getByRole('button', { name: 'set-dark' }));
      expect(screen.getByTestId('theme')).toHaveTextContent('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });
  });

  describe('sad', () => {
    it('defaults to system theme when no stored preference exists', () => {
      renderWithRouter(
        <ThemeProvider>
          <ThemeHarness />
        </ThemeProvider>,
        { mockAPI }
      );
      expect(screen.getByTestId('theme')).toHaveTextContent('system');
    });

    it('restores stored explicit theme on mount', () => {
      localStorage.setItem('theme', 'light');
      renderWithRouter(
        <ThemeProvider>
          <ThemeHarness />
        </ThemeProvider>,
        { mockAPI }
      );
      expect(screen.getByTestId('theme')).toHaveTextContent('light');
      expect(screen.getByTestId('resolved')).toHaveTextContent('light');
      expect(document.documentElement.classList.contains('light')).toBe(true);
    });
  });

  describe('hostile', () => {
    it('persists explicit theme in localStorage', () => {
      renderWithRouter(
        <ThemeProvider>
          <ThemeHarness />
        </ThemeProvider>,
        { mockAPI }
      );
      fireEvent.click(screen.getByRole('button', { name: 'set-light' }));
      expect(localStorage.getItem('theme')).toBe('light');
    });

    it('responds to system theme changes in system mode', async () => {
      renderWithRouter(
        <ThemeProvider>
          <ThemeHarness />
        </ThemeProvider>,
        { mockAPI }
      );

      expect(screen.getByTestId('theme')).toHaveTextContent('system');
      expect(mediaHandlers.length).toBeGreaterThan(0);

      act(() => {
        mediaHandlers[0]({ matches: true } as MediaQueryListEvent);
      });
      await waitFor(() => {
        expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
      });
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('resolves dark system preference on initial load', () => {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockImplementation(() => ({
          matches: true,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })),
      });

      renderWithRouter(
        <ThemeProvider>
          <ThemeHarness />
        </ThemeProvider>,
        { mockAPI }
      );
      expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    });

    it('throws when useTheme is used outside provider', () => {
      function BadConsumer() {
        useTheme();
        return null;
      }
      suppressExpectedConsoleErrors(() => {
        expect(() => renderWithRouter(<BadConsumer />, { mockAPI })).toThrow(
          'useTheme must be used within a ThemeProvider'
        );
      });
    });
  });
});
