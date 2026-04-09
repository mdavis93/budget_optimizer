import { Income, Bill, SkippedBill, BillAssignment, SavingsGoal, SavingsGoalInput } from './database.service';
import { validateBill, validateIncome, assertValid } from './validation.service';
import { v4 as uuidv4 } from 'uuid';

export class QuickBudgetService {
  private incomes: Income[] = [];
  private bills: Bill[] = [];
  private skippedBills: SkippedBill[] = [];
  private billAssignments: BillAssignment[] = [];
  private goals: SavingsGoal[] = [];
  private startingBalance: number = 0;
  private targetCashOnHand: number = 250;
  private minCashOnHand: number = 100;
  private minSavingsPerPaycheck: number = 0;

  private generateId(): string {
    return uuidv4();
  }

  clear(): void {
    this.incomes = [];
    this.bills = [];
    this.skippedBills = [];
    this.billAssignments = [];
    this.goals = [];
    this.startingBalance = 0;
    this.targetCashOnHand = 250;
    this.minCashOnHand = 100;
    this.minSavingsPerPaycheck = 0;
  }

  getStartingBalance(): number {
    return this.startingBalance;
  }

  setStartingBalance(balance: number): void {
    this.startingBalance = balance;
  }

  getTargetCashOnHand(): number {
    return this.targetCashOnHand;
  }

  setTargetCashOnHand(amount: number): void {
    this.targetCashOnHand = amount;
  }

  getMinCashOnHand(): number {
    return this.minCashOnHand;
  }

  setMinCashOnHand(amount: number): void {
    this.minCashOnHand = amount;
  }

  getMinSavingsPerPaycheck(): number {
    return this.minSavingsPerPaycheck;
  }

  setMinSavingsPerPaycheck(amount: number): void {
    this.minSavingsPerPaycheck = amount;
  }

  // Income Management
  getAllIncomes(): Income[] {
    return [...this.incomes];
  }

  getIncomeById(id: string): Income | null {
    return this.incomes.find(i => i.id === id) || null;
  }

  createIncome(income: Omit<Income, 'id' | 'createdAt' | 'updatedAt'>): Income {
    const validation = validateIncome(income);
    assertValid(validation, 'Invalid income data');

    const now = new Date().toISOString();
    const newIncome: Income = {
      id: this.generateId(),
      ...income,
      createdAt: now,
      updatedAt: now,
    };
    this.incomes.push(newIncome);
    return newIncome;
  }

  updateIncome(id: string, income: Omit<Income, 'id' | 'createdAt' | 'updatedAt'>): Income | null {
    const validation = validateIncome(income);
    assertValid(validation, 'Invalid income data');

    const index = this.incomes.findIndex(i => i.id === id);
    if (index === -1) return null;

    const existing = this.incomes[index];
    const updated: Income = {
      id,
      ...income,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.incomes[index] = updated;
    return updated;
  }

  deleteIncome(id: string): boolean {
    const index = this.incomes.findIndex(i => i.id === id);
    if (index === -1) return false;
    this.incomes.splice(index, 1);
    return true;
  }

  // Bill Management
  getAllBills(): Bill[] {
    return [...this.bills];
  }

  getBillById(id: string): Bill | null {
    return this.bills.find(b => b.id === id) || null;
  }

  createBill(bill: Omit<Bill, 'id' | 'createdAt' | 'updatedAt'>): Bill {
    const validation = validateBill(bill);
    assertValid(validation, 'Invalid bill data');

    const now = new Date().toISOString();
    const newBill: Bill = {
      id: this.generateId(),
      ...bill,
      createdAt: now,
      updatedAt: now,
    };
    this.bills.push(newBill);
    return newBill;
  }

  updateBill(id: string, bill: Omit<Bill, 'id' | 'createdAt' | 'updatedAt'>): Bill | null {
    const validation = validateBill(bill);
    assertValid(validation, 'Invalid bill data');

    const index = this.bills.findIndex(b => b.id === id);
    if (index === -1) return null;

    const existing = this.bills[index];
    const updated: Bill = {
      id,
      ...bill,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.bills[index] = updated;
    return updated;
  }

  deleteBill(id: string): boolean {
    const index = this.bills.findIndex(b => b.id === id);
    if (index === -1) return false;
    this.bills.splice(index, 1);
    
    // Also remove related skipped bills and assignments
    this.skippedBills = this.skippedBills.filter(sb => sb.billId !== id);
    this.billAssignments = this.billAssignments.filter(ba => ba.billId !== id);
    
    return true;
  }

  // Skipped Bills Management
  getSkippedBills(): SkippedBill[] {
    return [...this.skippedBills];
  }

  skipBill(billId: string, skipDate: string): SkippedBill {
    // Remove existing if present
    this.skippedBills = this.skippedBills.filter(
      sb => !(sb.billId === billId && sb.skipDate === skipDate)
    );

    const skipped: SkippedBill = {
      id: this.generateId(),
      billId,
      skipDate,
      createdAt: new Date().toISOString(),
    };
    this.skippedBills.push(skipped);
    return skipped;
  }

  unskipBill(billId: string, skipDate: string): boolean {
    const originalLength = this.skippedBills.length;
    this.skippedBills = this.skippedBills.filter(
      sb => !(sb.billId === billId && sb.skipDate === skipDate)
    );
    return this.skippedBills.length < originalLength;
  }

  isSkipped(billId: string, skipDate: string): boolean {
    return this.skippedBills.some(
      sb => sb.billId === billId && sb.skipDate === skipDate
    );
  }

  // Bill Assignments Management
  getBillAssignments(): BillAssignment[] {
    return [...this.billAssignments];
  }

  assignBillToPaycheck(billId: string, billDueDate: string, paycheckDate: string): BillAssignment {
    // Remove existing assignment for this bill occurrence
    this.billAssignments = this.billAssignments.filter(
      ba => !(ba.billId === billId && ba.billDueDate === billDueDate)
    );

    const assignment: BillAssignment = {
      id: this.generateId(),
      billId,
      billDueDate,
      paycheckDate,
      createdAt: new Date().toISOString(),
    };
    this.billAssignments.push(assignment);
    return assignment;
  }

  removeBillAssignment(billId: string, billDueDate: string): boolean {
    const originalLength = this.billAssignments.length;
    this.billAssignments = this.billAssignments.filter(
      ba => !(ba.billId === billId && ba.billDueDate === billDueDate)
    );
    return this.billAssignments.length < originalLength;
  }

  getBillAssignment(billId: string, billDueDate: string): BillAssignment | null {
    return this.billAssignments.find(
      ba => ba.billId === billId && ba.billDueDate === billDueDate
    ) || null;
  }

  // Savings Goals Management
  getAllGoals(): SavingsGoal[] {
    return [...this.goals].sort((a, b) => a.priority - b.priority);
  }

  getGoalById(id: string): SavingsGoal | null {
    return this.goals.find(g => g.id === id) || null;
  }

  createGoal(input: SavingsGoalInput): SavingsGoal {
    const now = new Date().toISOString();
    const newGoal: SavingsGoal = {
      id: this.generateId(),
      budgetId: 'quick-budget',
      name: input.name,
      targetAmount: input.targetAmount,
      targetDate: input.targetDate,
      alreadySaved: input.alreadySaved ?? 0,
      priority: input.priority ?? 1,
      createdAt: now,
    };
    this.goals.push(newGoal);
    return newGoal;
  }

  updateGoal(id: string, input: Partial<SavingsGoalInput>): SavingsGoal | null {
    const index = this.goals.findIndex(g => g.id === id);
    if (index === -1) return null;

    const existing = this.goals[index];
    const updated: SavingsGoal = {
      ...existing,
      name: input.name ?? existing.name,
      targetAmount: input.targetAmount ?? existing.targetAmount,
      targetDate: input.targetDate ?? existing.targetDate,
      alreadySaved: input.alreadySaved ?? existing.alreadySaved,
      priority: input.priority ?? existing.priority,
    };
    this.goals[index] = updated;
    return updated;
  }

  deleteGoal(id: string): boolean {
    const index = this.goals.findIndex(g => g.id === id);
    if (index === -1) return false;
    this.goals.splice(index, 1);
    return true;
  }
}
