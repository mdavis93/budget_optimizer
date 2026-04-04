import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { Income, IncomeInput, Bill, BillInput, ScheduleData } from '../types';
import { useAuth } from './AuthContext';
import { useBudget } from './BudgetContext';

interface DataContextType {
  incomes: Income[];
  bills: Bill[];
  schedule: ScheduleData | null;
  isLoading: boolean;
  error: string | null;
  refreshIncomes: () => Promise<void>;
  refreshBills: () => Promise<void>;
  refreshAllData: () => Promise<void>;
  createIncome: (income: IncomeInput) => Promise<boolean>;
  updateIncome: (id: string, income: IncomeInput) => Promise<boolean>;
  deleteIncome: (id: string) => Promise<boolean>;
  createBill: (bill: BillInput) => Promise<boolean>;
  updateBill: (id: string, bill: BillInput) => Promise<boolean>;
  deleteBill: (id: string) => Promise<boolean>;
  generateSchedule: (startDate: string, months: number, startingBalance: number) => Promise<ScheduleData | null>;
  clearError: () => void;
}

const DataContext = createContext<DataContextType | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const { isUnlocked } = useAuth();
  const { currentBudget, isQuickBudget, hasBudgetSelected } = useBudget();
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshIncomes = useCallback(async () => {
    if (!isUnlocked) return;
    try {
      const result = await window.electronAPI.income.getAll();
      if (result.success && result.data) {
        setIncomes(result.data);
      } else {
        setError(result.error || 'Failed to load incomes');
      }
    } catch (err) {
      setError('Failed to load incomes');
    }
  }, [isUnlocked]);

  const refreshBills = useCallback(async () => {
    if (!isUnlocked) return;
    try {
      const result = await window.electronAPI.bills.getAll();
      if (result.success && result.data) {
        setBills(result.data);
      } else {
        setError(result.error || 'Failed to load bills');
      }
    } catch (err) {
      setError('Failed to load bills');
    }
  }, [isUnlocked]);

  const refreshAllData = useCallback(async () => {
    if (!isUnlocked || !hasBudgetSelected) return;
    setIsLoading(true);
    try {
      await Promise.all([refreshIncomes(), refreshBills()]);
    } finally {
      setIsLoading(false);
    }
  }, [isUnlocked, hasBudgetSelected, refreshIncomes, refreshBills]);

  // Reload data when budget changes
  useEffect(() => {
    if (isUnlocked && hasBudgetSelected) {
      setIsLoading(true);
      Promise.all([refreshIncomes(), refreshBills()]).finally(() => {
        setIsLoading(false);
      });
    } else {
      setIncomes([]);
      setBills([]);
      setSchedule(null);
    }
  }, [isUnlocked, hasBudgetSelected, currentBudget?.id, isQuickBudget, refreshIncomes, refreshBills]);

  const createIncome = useCallback(async (income: IncomeInput): Promise<boolean> => {
    try {
      const result = await window.electronAPI.income.create(income);
      if (result.success) {
        await refreshIncomes();
        return true;
      }
      setError(result.error || 'Failed to create income');
      return false;
    } catch {
      setError('Failed to create income');
      return false;
    }
  }, [refreshIncomes]);

  const updateIncome = useCallback(async (id: string, income: IncomeInput): Promise<boolean> => {
    try {
      const result = await window.electronAPI.income.update(id, income);
      if (result.success) {
        await refreshIncomes();
        return true;
      }
      setError(result.error || 'Failed to update income');
      return false;
    } catch {
      setError('Failed to update income');
      return false;
    }
  }, [refreshIncomes]);

  const deleteIncome = useCallback(async (id: string): Promise<boolean> => {
    try {
      const result = await window.electronAPI.income.delete(id);
      if (result.success) {
        await refreshIncomes();
        return true;
      }
      setError(result.error || 'Failed to delete income');
      return false;
    } catch {
      setError('Failed to delete income');
      return false;
    }
  }, [refreshIncomes]);

  const createBill = useCallback(async (bill: BillInput): Promise<boolean> => {
    try {
      const result = await window.electronAPI.bills.create(bill);
      if (result.success) {
        await refreshBills();
        return true;
      }
      setError(result.error || 'Failed to create bill');
      return false;
    } catch {
      setError('Failed to create bill');
      return false;
    }
  }, [refreshBills]);

  const updateBill = useCallback(async (id: string, bill: BillInput): Promise<boolean> => {
    try {
      const result = await window.electronAPI.bills.update(id, bill);
      if (result.success) {
        await refreshBills();
        return true;
      }
      setError(result.error || 'Failed to update bill');
      return false;
    } catch {
      setError('Failed to update bill');
      return false;
    }
  }, [refreshBills]);

  const deleteBill = useCallback(async (id: string): Promise<boolean> => {
    try {
      const result = await window.electronAPI.bills.delete(id);
      if (result.success) {
        await refreshBills();
        return true;
      }
      setError(result.error || 'Failed to delete bill');
      return false;
    } catch {
      setError('Failed to delete bill');
      return false;
    }
  }, [refreshBills]);

  const generateSchedule = useCallback(async (
    startDate: string, 
    months: number, 
    startingBalance: number
  ): Promise<ScheduleData | null> => {
    setIsLoading(true);
    try {
      const result = await window.electronAPI.schedule.optimize(startDate, months, startingBalance);
      if (result.success && result.data) {
        setSchedule(result.data);
        return result.data;
      }
      setError(result.error || 'Failed to generate schedule');
      return null;
    } catch {
      setError('Failed to generate schedule');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return (
    <DataContext.Provider
      value={{
        incomes,
        bills,
        schedule,
        isLoading,
        error,
        refreshIncomes,
        refreshBills,
        refreshAllData,
        createIncome,
        updateIncome,
        deleteIncome,
        createBill,
        updateBill,
        deleteBill,
        generateSchedule,
        clearError,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const context = useContext(DataContext);
  if (!context) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
}
