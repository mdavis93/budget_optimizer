import type { ElectronApplication, Locator } from '@playwright/test';

/** Trigger the native window close path (red X / OS close), not fixture quitApp. */
export async function requestNativeWindowClose(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.close();
  });
}

function isTeardownError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Target page, context or browser has been closed/i.test(message);
}

/**
 * Click a control that quits the app, then assert process exit.
 *
 * Playwright's `locator.click()` waits for a CDP round-trip after the mouse
 * event. Discard/Save exit handlers call `quitApp()` immediately, so the
 * renderer often tears down mid-click and flakes with
 * "Target page, context or browser has been closed" even when quit succeeded.
 *
 * A DOM `el.click()` returns at the first `await quitApp()`, before the
 * window is gone — so the real assertion is `app` close, not click completion.
 */
export async function clickAndAwaitAppExit(
  locator: Locator,
  app: ElectronApplication
): Promise<void> {
  const closed = app.waitForEvent('close');
  try {
    await locator.evaluate((el: HTMLElement) => {
      el.click();
    });
  } catch (error) {
    if (!isTeardownError(error)) throw error;
  }
  await closed;
}
