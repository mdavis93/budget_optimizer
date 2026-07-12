import { createContext, useContext, type ReactNode } from 'react';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import { getPlatformExitCapabilities } from './exitCapabilities';

interface PlatformExitContextValue {
  guardAction: (
    action: () => void | Promise<void>,
    label?: string
  ) => boolean;
  supportsNativeClose: boolean;
}

const PlatformExitContext = createContext<PlatformExitContextValue | null>(null);

/**
 * Single owner for app-exit unsaved-changes prompts (Quit + native window close).
 * Lock App is intentionally outside this seam — privacy lock preserves drafts.
 */
export function PlatformExitGuardProvider({ children }: { children: ReactNode }) {
  const { supportsNativeClose } = getPlatformExitCapabilities();
  const { guardAction, unsavedDialog } = useUnsavedChangesGuard({
    listenForWindowClose: supportsNativeClose,
  });

  return (
    <PlatformExitContext.Provider value={{ guardAction, supportsNativeClose }}>
      {unsavedDialog}
      {children}
    </PlatformExitContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePlatformExit(): PlatformExitContextValue {
  const context = useContext(PlatformExitContext);
  if (!context) {
    throw new Error('usePlatformExit must be used within a PlatformExitGuardProvider');
  }
  return context;
}
