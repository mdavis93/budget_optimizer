import {
  test as base,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import path from 'path';
import os from 'os';
import fs from 'fs';

/**
 * Path to the built Electron entrypoint. The harness runs against the real
 * production bundle (`pnpm build:vite`), never the dev server.
 */
const MAIN_ENTRY = path.resolve(__dirname, '../../dist-electron/main.js');

/**
 * Build a clean string-only env for the Electron launch.
 *
 * Critically, this strips `ELECTRON_RUN_AS_NODE`. Editors/CIs that are
 * themselves Electron apps (e.g. VS Code / Cursor) export that variable to
 * child processes, which would make our Electron binary boot as plain Node —
 * no app window, and Playwright reports "Process failed to launch". Stripping
 * it keeps the harness reliable regardless of where it runs.
 */
function buildLaunchEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') {
      env[key] = value;
    }
  }
  // Marker so the app can keep keytar/native side effects test-safe if desired.
  env.BUDGET_OPTIMIZER_E2E = '1';
  return env;
}

export type HarnessFixtures = {
  /** Throwaway, per-test `userData` directory. Created on use, deleted on teardown. */
  userDataDir: string;
  /** The launched Electron application, isolated to its own `userDataDir`. */
  electronApp: ElectronApplication;
  /** The first (main) renderer window, ready at `domcontentloaded`. */
  window: Page;
};

/**
 * Test harness that launches the real Electron app against a disposable vault.
 *
 * Security note: there is no auth bypass. Each test starts from a pristine
 * `userData` directory, so the renderer boots into first-run setup and the
 * suite must create a master password through the real UI/IPC (see
 * `helpers/auth.ts`). The directory is destroyed on teardown, so no test
 * credentials or encrypted data ever outlive the test.
 */
export const test = base.extend<HarnessFixtures>({
  userDataDir: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-e2e-'));
    await use(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  },

  electronApp: async ({ userDataDir }, use) => {
    const args = [MAIN_ENTRY, `--user-data-dir=${userDataDir}`];
    // CI containers can't use Chromium's setuid sandbox; disable it there only.
    if (process.env.CI) args.push('--no-sandbox');

    const app = await electron.launch({
      args,
      env: buildLaunchEnv(),
    });

    // Native modal dialogs are not part of the DOM and would hang a headless
    // run. The app fires `credentials.offerSave()` (a Save/Not Now message box)
    // during master-password creation, and Export uses save/open dialogs. Stub
    // them to deterministic, non-blocking responses for the whole session.
    await app.evaluate(async ({ dialog }) => {
      dialog.showMessageBox = async () =>
        ({ response: 1, checkboxChecked: false }) as Awaited<
          ReturnType<typeof dialog.showMessageBox>
        >;
      dialog.showMessageBoxSync = () => 1;
      dialog.showSaveDialog = async () =>
        ({ canceled: true, filePath: undefined }) as Awaited<
          ReturnType<typeof dialog.showSaveDialog>
        >;
      dialog.showOpenDialog = async () =>
        ({ canceled: true, filePaths: [] }) as Awaited<
          ReturnType<typeof dialog.showOpenDialog>
        >;
      dialog.showErrorBox = () => undefined;
    });

    await use(app);

    await app.close();
  },

  window: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await use(window);
  },
});

export { expect } from '@playwright/test';
