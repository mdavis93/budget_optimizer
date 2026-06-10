import { app, BrowserWindow, dialog, MessageBoxOptions, MessageBoxReturnValue } from 'electron';

/**
 * Prefer the renderer window that invoked IPC, falling back to any visible app window.
 * Skips detached DevTools windows when possible.
 */
export function resolveAppBrowserWindow(hint: BrowserWindow | null | undefined): BrowserWindow | null {
  if (hint && !hint.isDestroyed()) {
    const url = hint.webContents.getURL();
    if (!url.startsWith('devtools://')) {
      return hint;
    }
  }

  const visibleWindows = BrowserWindow.getAllWindows().filter(
    (window) => !window.isDestroyed() && window.isVisible()
  );

  const appWindow = visibleWindows.find((window) => {
    const url = window.webContents.getURL();
    return !url.startsWith('devtools://');
  });

  return appWindow ?? visibleWindows[0] ?? null;
}

function prepareWindowForDialog(window: BrowserWindow): void {
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.focus();
}

/**
 * Show a message box that is always reachable: focuses the app, uses an ephemeral
 * always-on-top host window so the native dialog appears above the app and DevTools.
 */
export async function showTopMessageBox(
  parentHint: BrowserWindow | null | undefined,
  options: MessageBoxOptions
): Promise<MessageBoxReturnValue> {
  const appWindow = resolveAppBrowserWindow(parentHint);

  if (appWindow) {
    prepareWindowForDialog(appWindow);
  }

  if (process.platform === 'darwin') {
    app.focus({ steal: true });
  }

  const alwaysOnTopLevel =
    process.platform === 'darwin' ? 'screen-saver' : 'pop-up-menu';

  // Ephemeral always-on-top host (no parent link) so the native dialog is not
  // trapped behind the app window or detached DevTools.
  const dialogHost = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
  });

  dialogHost.setAlwaysOnTop(true, alwaysOnTopLevel);

  try {
    return await dialog.showMessageBox(dialogHost, options);
  } finally {
    if (!dialogHost.isDestroyed()) {
      dialogHost.destroy();
    }
  }
}
