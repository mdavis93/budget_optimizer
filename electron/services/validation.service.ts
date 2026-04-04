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
