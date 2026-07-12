export type PlatformExitCapabilities = {
  /** Electron exposes native window-close IPC; mobile stubs return false. */
  supportsNativeClose: boolean;
};

/**
 * Thin capability seam for exit UX. Desktop Electron reports native close;
 * future mobile platforms return false and rely on in-app Quit equivalents.
 */
export function getPlatformExitCapabilities(): PlatformExitCapabilities {
  return {
    supportsNativeClose: Boolean(window.electronAPI?.onCloseRequested),
  };
}
