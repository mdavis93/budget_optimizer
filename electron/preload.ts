import { contextBridge, ipcRenderer } from 'electron';
import type { ElectronAPI } from '@shared/electronApi';
import type { ScheduleComputeProgressMessage } from '@shared/scheduleComputeProtocol';
import { IPC } from '@shared/ipcChannels';

const api = {
  platform: () => ipcRenderer.invoke(IPC.appGetPlatform),
  checkBiometricAvailable: () => ipcRenderer.invoke(IPC.appCheckBiometricAvailable),
  showSaveDialog: (options) => ipcRenderer.invoke(IPC.appShowSaveDialog, options),
  quitApp: () => ipcRenderer.invoke(IPC.appQuit),
  onCloseRequested: (callback) => {
    const handler = () => callback();
    ipcRenderer.on(IPC.appCloseRequested, handler);
    return () => ipcRenderer.removeListener(IPC.appCloseRequested, handler);
  },

  budget: {
    getAll: () => ipcRenderer.invoke(IPC.budgetGetAll),
    getAllWithStats: () => ipcRenderer.invoke(IPC.budgetGetAllWithStats),
    getCurrent: () => ipcRenderer.invoke(IPC.budgetGetCurrent),
    getSnapshot: () => ipcRenderer.invoke(IPC.budgetGetSnapshot),
    getStats: (budgetId) => ipcRenderer.invoke(IPC.budgetGetStats, budgetId),
    create: (input) => ipcRenderer.invoke(IPC.budgetCreate, input),
    update: (id, input) => ipcRenderer.invoke(IPC.budgetUpdate, id, input),
    delete: (id) => ipcRenderer.invoke(IPC.budgetDelete, id),
    switch: (id) => ipcRenderer.invoke(IPC.budgetSwitch, id),
    startQuick: () => ipcRenderer.invoke(IPC.budgetStartQuick),
    endQuick: () => ipcRenderer.invoke(IPC.budgetEndQuick),
  },

  auth: {
    isFirstTimeSetup: () => ipcRenderer.invoke(IPC.authIsFirstTimeSetup),
    createMasterPassword: (password) =>
      ipcRenderer.invoke(IPC.authCreateMasterPassword, password),
    unlock: (password) => ipcRenderer.invoke(IPC.authUnlock, password),
    unlockWithSavedCredentials: () => ipcRenderer.invoke(IPC.authUnlockWithSavedCredentials),
    unlockWithBiometric: () => ipcRenderer.invoke(IPC.authUnlockWithBiometric),
    lock: () => ipcRenderer.invoke(IPC.authLock),
    isUnlocked: () => ipcRenderer.invoke(IPC.authIsUnlocked),
    enableBiometric: () => ipcRenderer.invoke(IPC.authEnableBiometric),
    isBiometricEnabled: () => ipcRenderer.invoke(IPC.authIsBiometricEnabled),
    changePassword: (oldPassword, newPassword) =>
      ipcRenderer.invoke(IPC.authChangePassword, oldPassword, newPassword),
    getPendingRecoveryKey: () => ipcRenderer.invoke(IPC.authGetPendingRecoveryKey),
    clearPendingRecoveryKey: () => ipcRenderer.invoke(IPC.authClearPendingRecoveryKey),
    verifyRecoveryKey: (recoveryKey) =>
      ipcRenderer.invoke(IPC.authVerifyRecoveryKey, recoveryKey),
    resetPasswordWithRecovery: (recoveryKey, newPassword) =>
      ipcRenderer.invoke(IPC.authResetPasswordWithRecovery, recoveryKey, newPassword),
    activityPing: () => ipcRenderer.invoke(IPC.authActivityPing),
    onLocked: (callback) => {
      const handler = () => callback();
      ipcRenderer.on(IPC.authLocked, handler);
      return () => ipcRenderer.removeListener(IPC.authLocked, handler);
    },
  },

  income: {
    getAll: () => ipcRenderer.invoke(IPC.incomeGetAll),
    create: (income) => ipcRenderer.invoke(IPC.incomeCreate, income),
    update: (id, income) => ipcRenderer.invoke(IPC.incomeUpdate, id, income),
    delete: (id) => ipcRenderer.invoke(IPC.incomeDelete, id),
  },

  bills: {
    getAll: () => ipcRenderer.invoke(IPC.billsGetAll),
    create: (bill) => ipcRenderer.invoke(IPC.billsCreate, bill),
    update: (id, bill) => ipcRenderer.invoke(IPC.billsUpdate, id, bill),
    delete: (id) => ipcRenderer.invoke(IPC.billsDelete, id),
  },

  skippedBills: {
    getAll: () => ipcRenderer.invoke(IPC.skippedBillsGetAll),
    skip: (billId, skipDate) => ipcRenderer.invoke(IPC.skippedBillsSkip, billId, skipDate),
    unskip: (billId, skipDate) => ipcRenderer.invoke(IPC.skippedBillsUnskip, billId, skipDate),
    isSkipped: (billId, skipDate) => ipcRenderer.invoke(IPC.skippedBillsIsSkipped, billId, skipDate),
  },

  billAssignments: {
    getAll: () => ipcRenderer.invoke(IPC.billAssignmentsGetAll),
    assign: (billId, billDueDate, paycheckDate) =>
      ipcRenderer.invoke(IPC.billAssignmentsAssign, billId, billDueDate, paycheckDate),
    remove: (billId, billDueDate) =>
      ipcRenderer.invoke(IPC.billAssignmentsRemove, billId, billDueDate),
  },

  incomeOverrides: {
    getAll: () => ipcRenderer.invoke(IPC.incomeOverridesGetAll),
    set: (incomeId, paycheckDate, amount) =>
      ipcRenderer.invoke(IPC.incomeOverridesSet, incomeId, paycheckDate, amount),
    remove: (incomeId, paycheckDate) =>
      ipcRenderer.invoke(IPC.incomeOverridesRemove, incomeId, paycheckDate),
  },

  goals: {
    getAll: () => ipcRenderer.invoke(IPC.goalsGetAll),
    create: (input) => ipcRenderer.invoke(IPC.goalsCreate, input),
    update: (id, input) => ipcRenderer.invoke(IPC.goalsUpdate, id, input),
    delete: (id) => ipcRenderer.invoke(IPC.goalsDelete, id),
  },

  debts: {
    getAll: () => ipcRenderer.invoke(IPC.debtsGetAll),
    getByBill: (billId) => ipcRenderer.invoke(IPC.debtsGetByBill, billId),
    create: (input) => ipcRenderer.invoke(IPC.debtsCreate, input),
    update: (id, input) => ipcRenderer.invoke(IPC.debtsUpdate, id, input),
    delete: (id) => ipcRenderer.invoke(IPC.debtsDelete, id),
    getAmortization: (debtId) => ipcRenderer.invoke(IPC.debtsGetAmortization, debtId),
    getAllWithAmortization: (overlay) =>
      ipcRenderer.invoke(IPC.debtsGetAllWithAmortization, overlay),
  },

  leaves: {
    getAll: () => ipcRenderer.invoke(IPC.leavesGetAll),
    create: (input) => ipcRenderer.invoke(IPC.leavesCreate, input),
    update: (id, input) => ipcRenderer.invoke(IPC.leavesUpdate, id, input),
    delete: (id) => ipcRenderer.invoke(IPC.leavesDelete, id),
  },

  schedule: {
    build: (startDate, months, startingBalance, overlay) =>
      ipcRenderer.invoke(IPC.scheduleBuild, startDate, months, startingBalance, overlay),
    onProgress: (callback) => {
      const handler = (_event: unknown, progress: ScheduleComputeProgressMessage) => callback(progress);
      ipcRenderer.on(IPC.scheduleProgress, handler);
      return () => ipcRenderer.removeListener(IPC.scheduleProgress, handler);
    },
  },

  export: {
    toPdf: (schedule, filePath) => ipcRenderer.invoke(IPC.exportToPdf, schedule, filePath),
    toHtml: (schedule, filePath) => ipcRenderer.invoke(IPC.exportToHtml, schedule, filePath),
    toSpreadsheet: (schedule, filePath) =>
      ipcRenderer.invoke(IPC.exportToSpreadsheet, schedule, filePath),
  },

  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (settings) => ipcRenderer.invoke(IPC.settingsUpdate, settings),
  },

  credentials: {
    delete: () => ipcRenderer.invoke(IPC.credentialsDelete),
    has: () => ipcRenderer.invoke(IPC.credentialsHas),
  },

  diagnostics: {
    report: (input) => ipcRenderer.invoke(IPC.diagnosticsReport, input),
    getEvent: (eventId) => ipcRenderer.invoke(IPC.diagnosticsGetEvent, eventId),
    getBundle: (limit) => ipcRenderer.invoke(IPC.diagnosticsGetBundle, limit),
    export: (filePath, limit) => ipcRenderer.invoke(IPC.diagnosticsExport, filePath, limit),
  },
} satisfies ElectronAPI;

contextBridge.exposeInMainWorld('electronAPI', api);
