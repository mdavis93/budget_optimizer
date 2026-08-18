import { IpcMainInvokeEvent } from 'electron';
import type { ApiFailure, ApiResult, ApiSuccess } from '@shared/types';
import { AuthService } from '../services/auth.service';
import { BudgetManager } from '../services/budget-manager.service';
import { DatabaseService } from '../services/database.service';
import { diagnostics } from '../services/diagnostics.service';
import { ipcLogger } from '../services/logger.service';
import { ValidationError } from '../services/validation.service';

export type { ApiFailure, ApiResult, ApiSuccess };

export interface GuardedServices {
  auth: AuthService;
  database: DatabaseService | null;
  budgetManager: BudgetManager | null;
}

export type GuardError = ApiFailure;

type MainWindowLike = {
  webContents: unknown;
  isDestroyed: () => boolean;
} | null;

let getMainWindow: () => MainWindowLike = () => null;

export function setMainWindowGetter(fn: () => MainWindowLike): void {
  getMainWindow = fn;
}

export function assertAppSender(event: IpcMainInvokeEvent): GuardError | null {
  const main = getMainWindow();
  if (!main || main.isDestroyed() || event.sender !== main.webContents) {
    return { success: false, error: 'Invalid sender' };
  }
  return null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/** Safe user-facing + log message; ValidationError omits embedded values. */
export function getSafeErrorMessage(error: unknown): string {
  if (error instanceof ValidationError) {
    return error.field ? `Invalid ${error.field}` : 'Validation failed';
  }
  return getErrorMessage(error);
}

export function reportIpcFailure(
  channel: string,
  error: unknown
): string | undefined {
  const isValidation = error instanceof ValidationError;
  const reported = diagnostics.report({
    source: `ipc:${channel}`,
    message: getSafeErrorMessage(error),
    stack: error instanceof Error ? error.stack ?? null : null,
    errorCode: isValidation ? 'validation' : null,
    diagnostics: {
      channel,
      ...(isValidation && error.field ? { field: error.field } : {}),
    },
  });
  return reported.success ? reported.id : undefined;
}

export function requireUnlocked(services: GuardedServices): GuardError | null {
  if (!services.auth.getIsUnlocked()) {
    return { success: false, error: 'App is locked' };
  }
  return null;
}

export function requireBudgetReady(services: GuardedServices): GuardError | null {
  const unlockError = requireUnlocked(services);
  if (unlockError) {
    return unlockError;
  }
  if (!services.budgetManager || !services.database) {
    return { success: false, error: 'Not initialized' };
  }
  return null;
}

export interface ReadyServices extends GuardedServices {
  database: DatabaseService;
  budgetManager: BudgetManager;
}

export function asReadyServices(services: GuardedServices): ReadyServices {
  return services as ReadyServices;
}

type GuardedHandler<TArgs extends unknown[], TResult> = (
  event: IpcMainInvokeEvent,
  ...args: TArgs
) => TResult | Promise<TResult>;

export function withUnlockGuard<TArgs extends unknown[], TResult>(
  services: GuardedServices,
  handler: GuardedHandler<TArgs, TResult>
): GuardedHandler<TArgs, TResult | GuardError> {
  return async (event, ...args) => {
    const senderError = assertAppSender(event);
    if (senderError) {
      return senderError;
    }
    const guardError = requireUnlocked(services);
    if (guardError) {
      return guardError;
    }
    return handler(event, ...args);
  };
}

export function withBudgetGuard<TArgs extends unknown[], TResult>(
  services: GuardedServices,
  handler: GuardedHandler<TArgs, TResult>
): GuardedHandler<TArgs, TResult | GuardError> {
  return async (event, ...args) => {
    const senderError = assertAppSender(event);
    if (senderError) {
      return senderError;
    }
    const guardError = requireBudgetReady(services);
    if (guardError) {
      return guardError;
    }
    return handler(event, ...args);
  };
}

export async function ipcData<T>(
  channel: string,
  fn: () => T | Promise<T>
): Promise<ApiResult<T>> {
  try {
    return { success: true, data: await fn() };
  } catch (error) {
    ipcLogger.error(`${channel} failed:`, error);
    const diagnosticId = reportIpcFailure(channel, error);
    return {
      success: false,
      error: getErrorMessage(error),
      ...(diagnosticId ? { diagnosticId } : {}),
    };
  }
}

export async function ipcVoid(
  channel: string,
  fn: () => void | Promise<void>
): Promise<{ success: true } | ApiFailure> {
  try {
    await fn();
    return { success: true };
  } catch (error) {
    ipcLogger.error(`${channel} failed:`, error);
    const diagnosticId = reportIpcFailure(channel, error);
    return {
      success: false,
      error: getErrorMessage(error),
      ...(diagnosticId ? { diagnosticId } : {}),
    };
  }
}
