import { app, BrowserWindow, ipcMain, systemPreferences, dialog } from 'electron';
import path from 'path';
import { AuthService } from './services/auth.service';
import { CryptoService } from './services/crypto.service';
import { DatabaseService } from './services/database.service';
import { SchedulerService } from './services/scheduler.service';
import { PdfService } from './services/pdf.service';
import { SpreadsheetService } from './services/spreadsheet.service';
import { BudgetManager } from './services/budget-manager.service';
import { DebtService } from './services/debt.service';
import { registerIpcHandlers } from './ipc/handlers';
import { logger } from './services/logger.service';

// Global error handlers
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  dialog.showErrorBox('Application Error', `An unexpected error occurred: ${error.message}`);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

let mainWindow: BrowserWindow | null = null;

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    center: true,
    titleBarStyle: 'default',
    backgroundColor: '#0f172a',
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

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    logger.error('Failed to load:', errorCode, errorDescription);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    // Page loaded
  });

  const indexPath = VITE_DEV_SERVER_URL 
    ? VITE_DEV_SERVER_URL 
    : path.join(__dirname, '../dist/index.html');

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
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
  pdf: PdfService;
  spreadsheet: SpreadsheetService;
  debt: DebtService;
};

app.whenReady().then(async () => {
  // Initialize services after app is ready
  services = {
    auth: new AuthService(),
    crypto: new CryptoService(),
    database: null,
    budgetManager: null,
    scheduler: new SchedulerService(),
    pdf: new PdfService(),
    spreadsheet: new SpreadsheetService(),
    debt: new DebtService(),
  };

  createWindow();
  
  registerIpcHandlers(ipcMain, services);

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

app.on('before-quit', () => {
  // Close database connection gracefully
  if (services?.database) {
    services.database.close();
  }
});

ipcMain.handle('app:quit', () => {
  // Close database and quit app gracefully
  if (services?.database) {
    services.database.close();
  }
  app.quit();
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
  return dialog.showSaveDialog(mainWindow, options);
});

ipcMain.handle('app:show-open-dialog', async (_, options) => {
  if (!mainWindow) return { canceled: true };
  return dialog.showOpenDialog(mainWindow, options);
});

export { mainWindow };
