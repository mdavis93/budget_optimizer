import { app, BrowserWindow, ipcMain, systemPreferences, dialog, nativeImage } from 'electron';
import fs from 'fs';
import path from 'path';
import { AuthService } from './services/auth.service';
import { CryptoService } from './services/crypto.service';
import { DatabaseService } from './services/database.service';
import { SchedulerService } from './services/scheduler.service';
import { PdfService } from './services/pdf.service';
import { SpreadsheetService } from './services/spreadsheet.service';
import { BudgetManager } from './services/budget-manager.service';
import { DebtService } from './services/debt.service';
import { CredentialsService } from './services/credentials.service';
import { registerIpcHandlers } from './ipc/handlers';
import { ScheduleComputeHost, runScheduleWorkerSmoke } from './services/schedule-compute-host';
import { diagnostics } from './services/diagnostics.service';
import { logger } from './services/logger.service';
import { approveExportPath } from './utils/exportPaths';

// Global error handlers
process.on('uncaughtException', (error) => {
  try {
    logger.error('Uncaught Exception:', error);
    diagnostics.report({
      source: 'main:uncaughtException',
      error,
    });
  } catch {
    /* never recurse */
  }
  if (typeof dialog?.showErrorBox === 'function') {
    dialog.showErrorBox('Application Error', `An unexpected error occurred: ${error instanceof Error ? error.message : String(error)}`);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  try {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    diagnostics.report({
      source: 'main:unhandledRejection',
      error: reason,
    });
  } catch {
    /* never recurse */
  }
});

let mainWindow: BrowserWindow | null = null;
let allowWindowClose = false;

function shutdownApp() {
  if (services?.scheduleCompute) {
    services.scheduleCompute.dispose();
  }
  if (services?.database) {
    services.database.close();
  }
  allowWindowClose = true;
  app.quit();
}

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

function resolveWindowIcon() {
  const iconCandidates = [
    path.join(process.cwd(), 'build', 'icon.png'),
    path.join(__dirname, '..', 'build', 'icon.png'),
    path.join(__dirname, '..', 'dist', 'icon.png'),
  ];

  for (const iconPath of iconCandidates) {
    if (!fs.existsSync(iconPath)) {
      continue;
    }

    const image = nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) {
      return image;
    }
  }

  return undefined;
}

function createWindow() {
  allowWindowClose = false;
  const windowIcon = resolveWindowIcon();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    center: true,
    titleBarStyle: 'default',
    backgroundColor: '#0f172a',
    ...(windowIcon ? { icon: windowIcon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    show: true,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  let showingDevServerRecovery = false;
  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      logger.error('Failed to load:', errorCode, errorDescription);
      diagnostics.report({
        source: 'main:did-fail-load',
        message: String(errorDescription),
        errorCode: String(errorCode),
        diagnostics: {
          errorCode,
          errorDescription: String(errorDescription),
          url: String(validatedURL ?? ''),
          isMainFrame: Boolean(isMainFrame),
        },
      });
      const devServerDown =
        errorCode === -102 || String(errorDescription).includes('CONNECTION_REFUSED');
      if (
        isMainFrame &&
        !showingDevServerRecovery &&
        VITE_DEV_SERVER_URL &&
        !app.isPackaged &&
        devServerDown
      ) {
        showingDevServerRecovery = true;
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Dev server unreachable</title>
<style>body{margin:0;font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}main{max-width:32rem}h1{font-size:1.25rem;margin:0 0 12px}p{line-height:1.5;color:#94a3b8}code{color:#93c5fd}</style></head>
<body><main><h1>Vite dev server is not reachable</h1>
<p>The app window is still open, but <code>localhost:5173</code> refused the connection (${String(errorDescription)}). Reloading cannot recover until the dev server is running again.</p>
<p>Quit this window and restart with <code>pnpm dev</code> or <code>pnpm electron:dev</code>. Your budget data is safe.</p>
</main></body></html>`;
        void mainWindow?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      }
    }
  );

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    diagnostics.report({
      source: 'main:render-process-gone',
      message: details.reason,
      errorCode: details.reason,
      diagnostics: {
        reason: details.reason,
        exitCode: details.exitCode,
      },
    });
  });

  mainWindow.webContents.on('did-finish-load', () => {
    // Page loaded
  });

  const indexPath = VITE_DEV_SERVER_URL 
    ? VITE_DEV_SERVER_URL 
    : path.join(__dirname, '../dist/index.html');

  if (VITE_DEV_SERVER_URL && !app.isPackaged) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('close', (event) => {
    if (allowWindowClose) {
      return;
    }

    event.preventDefault();
    mainWindow?.webContents.send('app:close-requested');
  });

  mainWindow.on('closed', () => {
    allowWindowClose = false;
    mainWindow = null;
  });
}

// Services must be initialized after app is ready (app.getPath requires it)
let services: {
  auth: AuthService;
  crypto: CryptoService;
  database: DatabaseService | null;
  budgetManager: BudgetManager | null;
  scheduler: SchedulerService;
  scheduleCompute: ScheduleComputeHost;
  pdf: PdfService;
  spreadsheet: SpreadsheetService;
  debt: DebtService;
  credentials: CredentialsService;
};

app.whenReady().then(async () => {
  // Keep userData path consistent between dev (`npm run dev` / vite) and packaged builds
  if (app.isPackaged) {
    app.setName('Budget Optimizer');
  } else {
    app.setName('budget-optimizer');
  }

  // Initialize services after app is ready
  services = {
    auth: new AuthService(),
    crypto: new CryptoService(),
    database: null,
    budgetManager: null,
    scheduler: new SchedulerService(),
    scheduleCompute: new ScheduleComputeHost(),
    pdf: new PdfService(),
    spreadsheet: new SpreadsheetService(),
    debt: new DebtService(),
    credentials: new CredentialsService(),
  };

  diagnostics.setSessionHooks({
    getBudgetUnlocked: () => services.auth.getIsUnlocked(),
    startedAtMs: Date.now(),
  });

  createWindow();
  
  registerIpcHandlers(ipcMain, services);

  app.on('child-process-gone', (_event, details) => {
    services.scheduleCompute.notifyChildProcessGone(details.name);
  });

  if (process.env.SCHEDULE_WORKER_SMOKE === '1') {
    void runScheduleWorkerSmoke().catch((error) => {
      logger.error('schedule worker smoke failed:', error);
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  // Native Quit (Cmd+Q / Dock) emits before-quit BEFORE window close.
  // If we dispose here while the unsaved-changes guard still cancels the
  // window close, the app stays open with a dead DB + disposed schedule host.
  if (!allowWindowClose) {
    event.preventDefault();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('app:close-requested');
    }
    return;
  }

  // Confirmed quit path — tear down compute + DB.
  if (services?.scheduleCompute) {
    services.scheduleCompute.dispose();
  }
  if (services?.database) {
    services.database.close();
  }
});

ipcMain.handle('app:quit', () => {
  shutdownApp();
});

ipcMain.handle('app:check-biometric-available', async () => {
  if (process.platform === 'darwin') {
    try {
      const canPrompt = systemPreferences.canPromptTouchID();
      // In dev mode (unsigned), canPromptTouchID may return false even on Touch ID Macs
      // Return true on macOS to allow user to try - actual prompt will fail gracefully if unavailable
      if (!canPrompt && process.env['VITE_DEV_SERVER_URL']) {
        return true;
      }
      return canPrompt;
    } catch (err) {
      logger.warn('Touch ID check failed:', err);
      return false;
    }
  }
  return false;
});

ipcMain.handle('app:get-platform', () => process.platform);

ipcMain.handle('app:show-save-dialog', async (_, options) => {
  if (!mainWindow) return { canceled: true };
  const result = await dialog.showSaveDialog(mainWindow, options);
  if (!result.canceled && result.filePath) {
    approveExportPath(result.filePath);
  }
  return result;
});

ipcMain.handle('app:show-open-dialog', async (_, options) => {
  if (!mainWindow) return { canceled: true };
  return dialog.showOpenDialog(mainWindow, options);
});

export { mainWindow };
