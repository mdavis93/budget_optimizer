import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import {
  PlatformExitGuardProvider,
  usePlatformExit,
} from '../../src/platform/PlatformExitGuard';
import { getPlatformExitCapabilities } from '../../src/platform/exitCapabilities';

const mockUseUnsavedChangesGuard = vi.fn();

vi.mock('../../src/hooks/useUnsavedChangesGuard', () => ({
  useUnsavedChangesGuard: (options?: { listenForWindowClose?: boolean }) =>
    mockUseUnsavedChangesGuard(options),
}));

describe('getPlatformExitCapabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports native close when onCloseRequested is available', () => {
    window.electronAPI = {
      ...window.electronAPI,
      onCloseRequested: vi.fn(() => () => {}),
    };
    expect(getPlatformExitCapabilities()).toEqual({ supportsNativeClose: true });
  });

  it('reports no native close when onCloseRequested is missing (mobile stub)', () => {
    const { onCloseRequested: _removed, ...rest } = window.electronAPI as typeof window.electronAPI & {
      onCloseRequested?: unknown;
    };
    window.electronAPI = rest as typeof window.electronAPI;
    delete (window.electronAPI as { onCloseRequested?: unknown }).onCloseRequested;
    expect(getPlatformExitCapabilities().supportsNativeClose).toBe(false);
  });
});

describe('PlatformExitGuardProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.electronAPI = {
      ...window.electronAPI,
      onCloseRequested: vi.fn(() => () => {}),
    };
    mockUseUnsavedChangesGuard.mockReturnValue({
      guardAction: vi.fn(),
      unsavedDialog: <div>exit-dialog</div>,
    });
  });

  it('wires listenForWindowClose when the platform supports native close', () => {
    function Consumer() {
      const { supportsNativeClose } = usePlatformExit();
      return <div data-testid="caps">{String(supportsNativeClose)}</div>;
    }

    render(
      <PlatformExitGuardProvider>
        <Consumer />
      </PlatformExitGuardProvider>
    );

    expect(mockUseUnsavedChangesGuard).toHaveBeenCalledWith({ listenForWindowClose: true });
    expect(screen.getByTestId('caps')).toHaveTextContent('true');
    expect(screen.getByText('exit-dialog')).toBeInTheDocument();
  });

  it('disables native close listening when capabilities say false', () => {
    delete (window.electronAPI as { onCloseRequested?: unknown }).onCloseRequested;
    mockUseUnsavedChangesGuard.mockReturnValue({
      guardAction: vi.fn(),
      unsavedDialog: null,
    });

    function Consumer() {
      const { supportsNativeClose } = usePlatformExit();
      return <div data-testid="caps">{String(supportsNativeClose)}</div>;
    }

    render(
      <PlatformExitGuardProvider>
        <Consumer />
      </PlatformExitGuardProvider>
    );

    expect(mockUseUnsavedChangesGuard).toHaveBeenCalledWith({ listenForWindowClose: false });
    expect(screen.getByTestId('caps')).toHaveTextContent('false');
  });

  it('throws when usePlatformExit is used outside the provider', () => {
    function Bad() {
      usePlatformExit();
      return null;
    }
    expect(() => render(<Bad />)).toThrow(
      'usePlatformExit must be used within a PlatformExitGuardProvider'
    );
  });
});
