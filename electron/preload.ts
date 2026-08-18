import { contextBridge, ipcRenderer } from 'electron';
import type { ElectronAPI } from '@shared/electronApi';
import type { ScheduleComputeProgressMessage } from '@shared/scheduleComputeProtocol';

const api = {
  platform: () => ipcRenderer.invoke('app:get-platform'),
  checkBiometricAvailable: () => ipcRenderer.invoke('app:check-biometric-available'),
  showSaveDialog: (options) => ipcRenderer.invoke('app:show-save-dialog', options),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  onCloseRequested: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('app:close-requested', handler);
    return () => ipcRenderer.removeListener('app:close-requested', handler);
  },

  budget: {
    getAll: () => ipcRenderer.invoke('budget:get-all'),
    getAllWithStats: () => ipcRenderer.invoke('budget:get-all-with-stats'),
    getCurrent: () => ipcRenderer.invoke('budget:get-current'),
    getSnapshot: () => ipcRenderer.invoke('budget:get-snapshot'),
    getStats: (budgetId) => ipcRenderer.invoke('budget:get-stats', budgetId),
    create: (input) => ipcRenderer.invoke('budget:create', input),
    update: (id, input) => ipcRenderer.invoke('budget:update', id, input),
    delete: (id) => ipcRenderer.invoke('budget:delete', id),
    switch: (id) => ipcRenderer.invoke('budget:switch', id),
    startQuick: () => ipcRenderer.invoke('budget:start-quick'),
    endQuick: () => ipcRenderer.invoke('budget:end-quick'),
  },

  auth: {
    isFirstTimeSetup: () => ipcRenderer.invoke('auth:is-first-time-setup'),
    createMasterPassword: (password) =>
      ipcRenderer.invoke('auth:create-master-password', password),
    unlock: (password) => ipcRenderer.invoke('auth:unlock', password),
    unlockWithSavedCredentials: () => ipcRenderer.invoke('auth:unlock-with-saved-credentials'),
    unlockWithBiometric: () => ipcRenderer.invoke('auth:unlock-with-biometric'),
    lock: () => ipcRenderer.invoke('auth:lock'),
    isUnlocked: () => ipcRenderer.invoke('auth:is-unlocked'),
    enableBiometric: () => ipcRenderer.invoke('auth:enable-biometric'),
    isBiometricEnabled: () => ipcRenderer.invoke('auth:is-biometric-enabled'),
    changePassword: (oldPassword, newPassword) =>
      ipcRenderer.invoke('auth:change-password', oldPassword, newPassword),
    getPendingRecoveryKey: () => ipcRenderer.invoke('auth:get-pending-recovery-key'),
    clearPendingRecoveryKey: () => ipcRenderer.invoke('auth:clear-pending-recovery-key'),
    verifyRecoveryKey: (recoveryKey) =>
      ipcRenderer.invoke('auth:verify-recovery-key', recoveryKey),
    resetPasswordWithRecovery: (recoveryKey, newPassword) =>
      ipcRenderer.invoke('auth:reset-password-with-recovery', recoveryKey, newPassword),
    activityPing: () => ipcRenderer.invoke('auth:activity-ping'),
    onLocked: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('auth:locked', handler);
      return () => ipcRenderer.removeListener('auth:locked', handler);
    },
  },

  income: {
    getAll: () => ipcRenderer.invoke('income:get-all'),
    create: (income) => ipcRenderer.invoke('income:create', income),
    update: (id, income) => ipcRenderer.invoke('income:update', id, income),
    delete: (id) => ipcRenderer.invoke('income:delete', id),
  },

  bills: {
    getAll: () => ipcRenderer.invoke('bills:get-all'),
    create: (bill) => ipcRenderer.invoke('bills:create', bill),
    update: (id, bill) => ipcRenderer.invoke('bills:update', id, bill),
    delete: (id) => ipcRenderer.invoke('bills:delete', id),
  },

  skippedBills: {
    getAll: () => ipcRenderer.invoke('skipped-bills:get-all'),
    skip: (billId, skipDate) => ipcRenderer.invoke('skipped-bills:skip', billId, skipDate),
    unskip: (billId, skipDate) => ipcRenderer.invoke('skipped-bills:unskip', billId, skipDate),
    isSkipped: (billId, skipDate) => ipcRenderer.invoke('skipped-bills:is-skipped', billId, skipDate),
  },

  billAssignments: {
    getAll: () => ipcRenderer.invoke('bill-assignments:get-all'),
    assign: (billId, billDueDate, paycheckDate) =>
      ipcRenderer.invoke('bill-assignments:assign', billId, billDueDate, paycheckDate),
    remove: (billId, billDueDate) =>
      ipcRenderer.invoke('bill-assignments:remove', billId, billDueDate),
  },

  incomeOverrides: {
    getAll: () => ipcRenderer.invoke('income-overrides:get-all'),
    set: (incomeId, paycheckDate, amount) =>
      ipcRenderer.invoke('income-overrides:set', incomeId, paycheckDate, amount),
    remove: (incomeId, paycheckDate) =>
      ipcRenderer.invoke('income-overrides:remove', incomeId, paycheckDate),
  },

  goals: {
    getAll: () => ipcRenderer.invoke('goals:get-all'),
    create: (input) => ipcRenderer.invoke('goals:create', input),
    update: (id, input) => ipcRenderer.invoke('goals:update', id, input),
    delete: (id) => ipcRenderer.invoke('goals:delete', id),
    getProjections: (overlay) => ipcRenderer.invoke('goals:get-projections', overlay),
  },

  debts: {
    getAll: () => ipcRenderer.invoke('debts:get-all'),
    getByBill: (billId) => ipcRenderer.invoke('debts:get-by-bill', billId),
    create: (input) => ipcRenderer.invoke('debts:create', input),
    update: (id, input) => ipcRenderer.invoke('debts:update', id, input),
    delete: (id) => ipcRenderer.invoke('debts:delete', id),
    getAmortization: (debtId) => ipcRenderer.invoke('debts:get-amortization', debtId),
    getAllWithAmortization: (overlay) =>
      ipcRenderer.invoke('debts:get-all-with-amortization', overlay),
  },

  leaves: {
    getAll: () => ipcRenderer.invoke('leaves:get-all'),
    create: (input) => ipcRenderer.invoke('leaves:create', input),
    update: (id, input) => ipcRenderer.invoke('leaves:update', id, input),
    delete: (id) => ipcRenderer.invoke('leaves:delete', id),
  },

  schedule: {
    build: (startDate, months, startingBalance, overlay) =>
      ipcRenderer.invoke('schedule:build', startDate, months, startingBalance, overlay),
    onProgress: (callback) => {
      const handler = (_event: unknown, progress: ScheduleComputeProgressMessage) => callback(progress);
      ipcRenderer.on('schedule:progress', handler);
      return () => ipcRenderer.removeListener('schedule:progress', handler);
    },
  },

  export: {
    toPdf: (schedule, filePath) => ipcRenderer.invoke('export:to-pdf', schedule, filePath),
    toHtml: (schedule, filePath) => ipcRenderer.invoke('export:to-html', schedule, filePath),
    toSpreadsheet: (schedule, filePath) =>
      ipcRenderer.invoke('export:to-spreadsheet', schedule, filePath),
  },

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (settings) => ipcRenderer.invoke('settings:update', settings),
  },

  credentials: {
    delete: () => ipcRenderer.invoke('credentials:delete'),
    has: () => ipcRenderer.invoke('credentials:has'),
  },

  diagnostics: {
    report: (input) => ipcRenderer.invoke('diagnostics:report', input),
    getEvent: (eventId) => ipcRenderer.invoke('diagnostics:get-event', eventId),
    getBundle: (limit) => ipcRenderer.invoke('diagnostics:get-bundle', limit),
    export: (filePath, limit) => ipcRenderer.invoke('diagnostics:export', filePath, limit),
  },
} satisfies ElectronAPI;

contextBridge.exposeInMainWorld('electronAPI', api);
