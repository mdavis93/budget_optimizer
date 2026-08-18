import { BrowserWindow } from 'electron';
import { BudgetManager } from '../services/budget-manager.service';
import { DatabaseService } from '../services/database.service';
import { clearApprovedExportPaths } from '../utils/exportPaths';

export interface LockSideEffectServices {
  budgetManager: BudgetManager | null;
  database: DatabaseService | null;
}

export function notifyRendererLocked(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) {
      continue;
    }
    window.webContents.send('auth:locked');
  }
}

export function applyLockSideEffects(services: LockSideEffectServices): void {
  clearApprovedExportPaths();
  if (services.budgetManager) {
    services.budgetManager.endQuickBudget();
    services.budgetManager = null;
  }
  if (services.database) {
    services.database.close();
    services.database = null;
  }
  notifyRendererLocked();
}
