import type { ElectronApplication } from '@playwright/test';

/** Trigger the native window close path (red X / OS close), not fixture quitApp. */
export async function requestNativeWindowClose(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.close();
  });
}
