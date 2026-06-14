import { IpcMainInvokeEvent } from 'electron';
import { AuthService } from '../services/auth.service';
import { BudgetManager } from '../services/budget-manager.service';
import { DatabaseService } from '../services/database.service';
import { ipcLogger } from '../services/logger.service';

export interface GuardedServices {
  auth: AuthService;
  database: DatabaseService | null;
  budgetManager: BudgetManager | null;
}

export type GuardError = { success: false; error: string };

export type ApiSuccess<T> = { success: true; data: T };
export type ApiFailure = { success: false; error: string };
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
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
    return { success: false, error: getErrorMessage(error) };
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
    return { success: false, error: getErrorMessage(error) };
  }
}
