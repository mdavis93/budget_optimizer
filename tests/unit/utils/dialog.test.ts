import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BrowserWindow, MessageBoxOptions } from 'electron';

const electronMocks = vi.hoisted(() => {
  const dialogHost = {
    isDestroyed: vi.fn().mockReturnValue(false),
    destroy: vi.fn(),
    setAlwaysOnTop: vi.fn(),
  };

  return {
    dialogHost,
    showMessageBox: vi.fn().mockResolvedValue({ response: 0 }),
    browserWindowConstructor: vi.fn().mockImplementation(function () {
      return dialogHost;
    }),
    getAllWindows: vi.fn().mockReturnValue([]),
    appFocus: vi.fn(),
  };
});

vi.mock('electron', () => ({
  app: { focus: electronMocks.appFocus },
  dialog: { showMessageBox: electronMocks.showMessageBox },
  BrowserWindow: Object.assign(electronMocks.browserWindowConstructor, {
    getAllWindows: electronMocks.getAllWindows,
  }),
}));

import { resolveAppBrowserWindow, showTopMessageBox } from '../../../electron/utils/dialog';

function createMockWindow(url: string, visible = true): BrowserWindow {
  return {
    isDestroyed: () => false,
    isVisible: () => visible,
    isMinimized: () => false,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: { getURL: () => url },
  } as unknown as BrowserWindow;
}

describe('resolveAppBrowserWindow', () => {
  it('returns the hint window when it is not a DevTools window', () => {
    const appWindow = createMockWindow('http://localhost:5173/setup');
    expect(resolveAppBrowserWindow(appWindow)).toBe(appWindow);
  });

  it('skips a DevTools hint and falls back to a visible app window', () => {
    const devtoolsWindow = createMockWindow('devtools://devtools/bundled/devtools_app.html');
    const appWindow = createMockWindow('file:///app/index.html');
    electronMocks.getAllWindows.mockReturnValue([devtoolsWindow, appWindow]);

    expect(resolveAppBrowserWindow(devtoolsWindow)).toBe(appWindow);
  });

  it('returns null when no suitable window exists', () => {
    electronMocks.getAllWindows.mockReturnValue([]);
    expect(resolveAppBrowserWindow(null)).toBeNull();
  });
});

describe('showTopMessageBox', () => {
  const options: MessageBoxOptions = {
    type: 'question',
    buttons: ['Save', 'Not Now'],
    title: 'Save Password',
    message: 'Save password to Keychain?',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    electronMocks.dialogHost.isDestroyed.mockReturnValue(false);
    electronMocks.showMessageBox.mockResolvedValue({ response: 0 });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  });

  it('shows the message box through an ephemeral always-on-top host window', async () => {
    const appWindow = createMockWindow('http://localhost:5173/setup');
    const result = await showTopMessageBox(appWindow, options);

    expect(electronMocks.browserWindowConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        show: false,
        alwaysOnTop: true,
        skipTaskbar: true,
      })
    );
    expect(electronMocks.dialogHost.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver');
    expect(electronMocks.showMessageBox).toHaveBeenCalledWith(electronMocks.dialogHost, options);
    expect(electronMocks.dialogHost.destroy).toHaveBeenCalled();
    expect(result).toEqual({ response: 0 });
  });

  it('prepares the app window before showing the dialog', async () => {
    const appWindow = createMockWindow('http://localhost:5173/setup');
    appWindow.isMinimized = vi.fn().mockReturnValue(true);

    await showTopMessageBox(appWindow, options);

    expect(appWindow.restore).toHaveBeenCalled();
    expect(appWindow.show).toHaveBeenCalled();
    expect(appWindow.focus).toHaveBeenCalled();
    expect(electronMocks.appFocus).toHaveBeenCalledWith({ steal: true });
  });

  it('uses pop-up-menu always-on-top level on non-macOS platforms', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    await showTopMessageBox(null, options);

    expect(electronMocks.dialogHost.setAlwaysOnTop).toHaveBeenCalledWith(true, 'pop-up-menu');
    expect(electronMocks.appFocus).not.toHaveBeenCalled();
  });
});
