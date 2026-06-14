export class ValidationError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateBill(bill: {
  creditorName: string;
  budgetedAmount: number;
  dueDay: number;
  category?: string;
  isRecurring: boolean;
  priority: string;
}): ValidationResult {
  const errors: string[] = [];

  if (!bill.creditorName || bill.creditorName.trim().length === 0) {
    errors.push('Creditor name is required');
  }

  if (bill.creditorName && bill.creditorName.length > 100) {
    errors.push('Creditor name must be 100 characters or less');
  }

  if (typeof bill.budgetedAmount !== 'number' || isNaN(bill.budgetedAmount)) {
    errors.push('Budgeted amount must be a number');
  } else if (bill.budgetedAmount <= 0) {
    errors.push('Budgeted amount must be greater than 0');
  } else if (bill.budgetedAmount > 1000000) {
    errors.push('Budgeted amount cannot exceed 1,000,000');
  }

  if (typeof bill.dueDay !== 'number' || !Number.isInteger(bill.dueDay)) {
    errors.push('Due day must be an integer');
  } else if (bill.dueDay < 1 || bill.dueDay > 31) {
    errors.push('Due day must be between 1 and 31');
  }

  if (bill.category && bill.category.length > 50) {
    errors.push('Category must be 50 characters or less');
  }

  const validPriorities = ['critical', 'high', 'normal', 'low'];
  if (!validPriorities.includes(bill.priority)) {
    errors.push('Priority must be one of: critical, high, normal, low');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateIncome(income: {
  sourceName: string;
  amount: number;
  cadence: string;
  startDate: string;
  isActive: boolean;
}): ValidationResult {
  const errors: string[] = [];

  if (!income.sourceName || income.sourceName.trim().length === 0) {
    errors.push('Source name is required');
  }

  if (income.sourceName && income.sourceName.length > 100) {
    errors.push('Source name must be 100 characters or less');
  }

  if (typeof income.amount !== 'number' || isNaN(income.amount)) {
    errors.push('Amount must be a number');
  } else if (income.amount <= 0) {
    errors.push('Amount must be greater than 0');
  } else if (income.amount > 10000000) {
    errors.push('Amount cannot exceed 10,000,000');
  }

  const validCadences = ['weekly', 'biweekly', 'semimonthly', 'monthly'];
  if (!validCadences.includes(income.cadence)) {
    errors.push('Cadence must be one of: weekly, biweekly, semimonthly, monthly');
  }

  // Validate date format (YYYY-MM-DD)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(income.startDate)) {
    errors.push('Start date must be in YYYY-MM-DD format');
  } else {
    const date = new Date(income.startDate);
    if (isNaN(date.getTime())) {
      errors.push('Start date is not a valid date');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function assertValid(result: ValidationResult, context: string): void {
  if (!result.valid) {
    throw new ValidationError(`${context}: ${result.errors.join(', ')}`);
  }
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const ID_REGEX = /^[a-zA-Z0-9-]{8,64}$/;

export interface ReconciliationFixInput {
  id: string;
  type: 'move_bill' | 'skip_bill';
  billId: string;
  billDueDate: string;
  fromPaycheckDate: string;
  toPaycheckDate?: string;
}

export function validateReconciliationFix(fix: ReconciliationFixInput): ValidationResult {
  const errors: string[] = [];

  if (!fix.id || typeof fix.id !== 'string' || fix.id.length > 128) {
    errors.push('Fix id is required and must be 128 characters or less');
  }

  if (fix.type !== 'move_bill' && fix.type !== 'skip_bill') {
    errors.push('Fix type must be move_bill or skip_bill');
  }

  if (!ID_REGEX.test(fix.billId)) {
    errors.push('Invalid billId');
  }

  if (!DATE_REGEX.test(fix.billDueDate)) {
    errors.push('Invalid billDueDate');
  }

  if (!DATE_REGEX.test(fix.fromPaycheckDate)) {
    errors.push('Invalid fromPaycheckDate');
  }

  if (fix.type === 'move_bill') {
    if (!fix.toPaycheckDate || !DATE_REGEX.test(fix.toPaycheckDate)) {
      errors.push('move_bill requires a valid toPaycheckDate');
    }
  }

  if (fix.type === 'skip_bill' && fix.toPaycheckDate !== undefined && !DATE_REGEX.test(fix.toPaycheckDate)) {
    errors.push('Invalid toPaycheckDate');
  }

  return { valid: errors.length === 0, errors };
}

export function validateReconciliationFixes(fixes: ReconciliationFixInput[]): ValidationResult {
  const errors: string[] = [];

  if (!Array.isArray(fixes)) {
    return { valid: false, errors: ['Fixes must be an array'] };
  }

  if (fixes.length > 100) {
    errors.push('Too many fixes in one request');
  }

  fixes.forEach((fix, index) => {
    const result = validateReconciliationFix(fix);
    if (!result.valid) {
      errors.push(`Fix[${index}]: ${result.errors.join(', ')}`);
    }
  });

  return { valid: errors.length === 0, errors };
}

export function validateGoal(goal: {
  name: string;
  targetAmount: number;
  targetDate: string;
  alreadySaved?: number;
  priority?: number;
}): ValidationResult {
  const errors: string[] = [];

  if (!goal.name || goal.name.trim().length === 0) {
    errors.push('Goal name is required');
  } else if (goal.name.length > 100) {
    errors.push('Goal name must be 100 characters or less');
  }

  if (typeof goal.targetAmount !== 'number' || isNaN(goal.targetAmount) || goal.targetAmount <= 0) {
    errors.push('Target amount must be greater than 0');
  }

  if (!DATE_REGEX.test(goal.targetDate)) {
    errors.push('Target date must be in YYYY-MM-DD format');
  }

  if (goal.alreadySaved !== undefined && (typeof goal.alreadySaved !== 'number' || goal.alreadySaved < 0)) {
    errors.push('Already saved must be a non-negative number');
  }

  if (goal.priority !== undefined && (!Number.isInteger(goal.priority) || goal.priority < 1 || goal.priority > 5)) {
    errors.push('Priority must be an integer between 1 and 5');
  }

  return { valid: errors.length === 0, errors };
}

export function validateDebt(debt: {
  billId: string;
  principalBalance: number;
  apr: number;
  monthlyPayment: number;
}): ValidationResult {
  const errors: string[] = [];

  if (!debt.billId || !ID_REGEX.test(debt.billId)) {
    errors.push('Bill ID is invalid');
  }

  if (typeof debt.principalBalance !== 'number' || debt.principalBalance < 0) {
    errors.push('Principal balance must be a non-negative number');
  }

  if (typeof debt.apr !== 'number' || debt.apr < 0 || debt.apr > 100) {
    errors.push('APR must be between 0 and 100');
  }

  if (typeof debt.monthlyPayment !== 'number' || debt.monthlyPayment < 0) {
    errors.push('Monthly payment must be a non-negative number');
  }

  return { valid: errors.length === 0, errors };
}

export function validateBudget(budget: {
  name: string;
  startingBalance?: number;
  targetCashOnHand?: number;
  minCashOnHand?: number;
  minSavingsPerPaycheck?: number;
  scheduleStartDate?: string;
}): ValidationResult {
  const errors: string[] = [];

  if (!budget.name || budget.name.trim().length === 0) {
    errors.push('Budget name is required');
  } else if (budget.name.length > 100) {
    errors.push('Budget name must be 100 characters or less');
  }

  if (budget.scheduleStartDate !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(budget.scheduleStartDate)) {
      errors.push('scheduleStartDate must be in YYYY-MM-DD format');
    }
  }

  const numericFields: Array<[string, number | undefined]> = [
    ['startingBalance', budget.startingBalance],
    ['targetCashOnHand', budget.targetCashOnHand],
    ['minCashOnHand', budget.minCashOnHand],
    ['minSavingsPerPaycheck', budget.minSavingsPerPaycheck],
  ];

  for (const [field, value] of numericFields) {
    if (value !== undefined && (typeof value !== 'number' || isNaN(value) || value < 0)) {
      errors.push(`${field} must be a non-negative number`);
    }
  }

  return { valid: errors.length === 0, errors };
}

const ALLOWED_SETTINGS_KEYS = new Set([
  'theme',
  'autoLockMinutes',
  'currency',
  'defaultScheduleMonths',
  'savingsAPY',
  'lastBudgetId',
]);

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function validateSettings(settings: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  for (const key of Reflect.ownKeys(settings)) {
    if (typeof key !== 'string') {
      continue;
    }
    if (DANGEROUS_KEYS.has(key)) {
      errors.push(`Invalid settings key: ${key}`);
      continue;
    }
    if (!ALLOWED_SETTINGS_KEYS.has(key)) {
      errors.push(`Unknown settings key: ${key}`);
    }
  }

  if (settings.theme !== undefined && !['light', 'dark', 'system'].includes(String(settings.theme))) {
    errors.push('Theme must be light, dark, or system');
  }

  if (settings.autoLockMinutes !== undefined) {
    const minutes = Number(settings.autoLockMinutes);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) {
      errors.push('Auto-lock minutes must be an integer between 0 and 1440');
    }
  }

  if (settings.defaultScheduleMonths !== undefined) {
    const months = Number(settings.defaultScheduleMonths);
    if (!Number.isInteger(months) || months < 1 || months > 24) {
      errors.push('Default schedule months must be an integer between 1 and 24');
    }
  }

  if (settings.savingsAPY !== undefined) {
    const apy = Number(settings.savingsAPY);
    if (typeof apy !== 'number' || isNaN(apy) || apy < 0 || apy > 100) {
      errors.push('Savings APY must be between 0 and 100');
    }
  }

  if (settings.currency !== undefined && String(settings.currency).length > 10) {
    errors.push('Currency code must be 10 characters or less');
  }

  return { valid: errors.length === 0, errors };
}

export function validateDraftOverlay(overlay: {
  incomes?: Array<Parameters<typeof validateIncome>[0] & { id?: string }>;
  bills?: Array<Parameters<typeof validateBill>[0] & { id?: string }>;
  goals?: Array<Parameters<typeof validateGoal>[0] & { id?: string; budgetId?: string }>;
  debts?: Array<Parameters<typeof validateDebt>[0] & { id?: string; budgetId?: string }>;
  skippedBills?: Array<{ billId: string; skipDate: string }>;
  billAssignments?: Array<{ billId: string; billDueDate: string; paycheckDate: string }>;
  incomeOverrides?: Array<{ incomeId: string; paycheckDate: string; amount: number }>;
  startingBalance?: number;
  targetCashOnHand?: number;
  minCashOnHand?: number;
  minSavingsPerPaycheck?: number;
}): ValidationResult {
  const errors: string[] = [];

  overlay.incomes?.forEach((income, index) => {
    const result = validateIncome(income);
    if (!result.valid) {
      errors.push(`Income[${index}]: ${result.errors.join(', ')}`);
    }
  });

  overlay.bills?.forEach((bill, index) => {
    const result = validateBill(bill);
    if (!result.valid) {
      errors.push(`Bill[${index}]: ${result.errors.join(', ')}`);
    }
  });

  overlay.goals?.forEach((goal, index) => {
    const result = validateGoal(goal);
    if (!result.valid) {
      errors.push(`Goal[${index}]: ${result.errors.join(', ')}`);
    }
  });

  overlay.debts?.forEach((debt, index) => {
    const result = validateDebt(debt);
    if (!result.valid) {
      errors.push(`Debt[${index}]: ${result.errors.join(', ')}`);
    }
  });

  overlay.skippedBills?.forEach((skip, index) => {
    if (!ID_REGEX.test(skip.billId) || !DATE_REGEX.test(skip.skipDate)) {
      errors.push(`SkippedBill[${index}] has invalid identifiers or dates`);
    }
  });

  overlay.billAssignments?.forEach((assignment, index) => {
    if (
      !ID_REGEX.test(assignment.billId) ||
      !DATE_REGEX.test(assignment.billDueDate) ||
      !DATE_REGEX.test(assignment.paycheckDate)
    ) {
      errors.push(`BillAssignment[${index}] has invalid identifiers or dates`);
    }
  });

  overlay.incomeOverrides?.forEach((override, index) => {
    if (
      !ID_REGEX.test(override.incomeId) ||
      !DATE_REGEX.test(override.paycheckDate) ||
      typeof override.amount !== 'number' ||
      override.amount < 0
    ) {
      errors.push(`IncomeOverride[${index}] is invalid`);
    }
  });

  if (overlay.startingBalance !== undefined && (typeof overlay.startingBalance !== 'number' || isNaN(overlay.startingBalance))) {
    errors.push('Starting balance must be a number');
  }

  for (const [field, value] of [
    ['targetCashOnHand', overlay.targetCashOnHand],
    ['minCashOnHand', overlay.minCashOnHand],
    ['minSavingsPerPaycheck', overlay.minSavingsPerPaycheck],
  ] as const) {
    if (value !== undefined && (typeof value !== 'number' || isNaN(value) || value < 0)) {
      errors.push(`${field} must be a non-negative number`);
    }
  }

  return { valid: errors.length === 0, errors };
}
