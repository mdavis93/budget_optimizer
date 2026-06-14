import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, ReactNode } from 'react';
import { format, startOfMonth } from 'date-fns';
import { Income, IncomeInput, Bill, BillInput, ScheduleData } from '../types';
import { useAuth } from './AuthContext';
import { useBudget } from './BudgetContext';
import { useDraft } from './DraftContext';
import { applyScheduleViewport } from '../utils/scheduleViewport';

interface DataContextType {
  incomes: Income[];
  bills: Bill[];
  schedule: ScheduleData | null;
  isLoading: boolean;
  error: string | null;
  scheduleStartDate: string;
  scheduleMonths: number;
  scheduleStartingBalance: number;
  setScheduleStartDate: (date: string) => void;
  setScheduleMonths: (months: number) => void;
  setScheduleStartingBalance: (balance: number) => void;
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

function defaultScheduleStartDate(): string {
  return format(startOfMonth(new Date()), 'yyyy-MM-dd');
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { isUnlocked } = useAuth();
  const { isQuickBudget, hasBudgetSelected, currentBudget } = useBudget();
  const draft = useDraft();

  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scheduleMonths, setScheduleMonthsState] = useState(3);
  const [scheduleStartingBalance, setScheduleStartingBalance] = useState(0);
  const [quickBudgetStartDate, setQuickBudgetStartDate] = useState(defaultScheduleStartDate);

  const fullScheduleRef = useRef<ScheduleData | null>(null);

  const incomes = draft.incomes;
  const bills = draft.bills;

  const scheduleStartDate = isQuickBudget
    ? (currentBudget?.scheduleStartDate ?? quickBudgetStartDate)
    : (draft.budget?.scheduleStartDate ?? defaultScheduleStartDate());

  const refreshIncomes = useCallback(async () => {
    if (!isUnlocked) return;
    await draft.reloadSnapshot();
  }, [isUnlocked, draft]);

  const refreshBills = useCallback(async () => {
    if (!isUnlocked) return;
    await draft.reloadSnapshot();
  }, [isUnlocked, draft]);

  const refreshAllData = useCallback(async () => {
    if (!isUnlocked || !hasBudgetSelected) return;
    setIsLoading(true);
    try {
      await draft.reloadSnapshot();
    } finally {
      setIsLoading(false);
    }
  }, [isUnlocked, hasBudgetSelected, draft]);

  useEffect(() => {
    if (!isUnlocked || !hasBudgetSelected) {
      setSchedule(null);
      fullScheduleRef.current = null;
    }
  }, [isUnlocked, hasBudgetSelected]);

  useEffect(() => {
    if (draft.budget?.startingBalance !== undefined) {
      setScheduleStartingBalance(draft.budget.startingBalance);
    } else if (currentBudget?.startingBalance !== undefined) {
      setScheduleStartingBalance(currentBudget.startingBalance);
    }
  }, [draft.budget?.startingBalance, currentBudget?.startingBalance]);

  const createIncomeQuick = useCallback(async (income: IncomeInput): Promise<boolean> => {
    try {
      const result = await window.electronAPI.income.create(income);
      if (result.success) {
        await draft.reloadSnapshot();
        return true;
      }
      setError(result.error || 'Failed to create income');
      return false;
    } catch {
      setError('Failed to create income');
      return false;
    }
  }, [draft]);

  const createIncome = useCallback(async (income: IncomeInput): Promise<boolean> => {
    if (isQuickBudget) return createIncomeQuick(income);
    if (draft.isDraftMode) {
      return draft.createIncome(income);
    }
    return false;
  }, [isQuickBudget, draft, createIncomeQuick]);

  const updateIncomeQuick = useCallback(async (id: string, income: IncomeInput): Promise<boolean> => {
    try {
      const result = await window.electronAPI.income.update(id, income);
      if (result.success) {
        await draft.reloadSnapshot();
        return true;
      }
      setError(result.error || 'Failed to update income');
      return false;
    } catch {
      setError('Failed to update income');
      return false;
    }
  }, [draft]);

  const updateIncome = useCallback(async (id: string, income: IncomeInput): Promise<boolean> => {
    if (isQuickBudget) return updateIncomeQuick(id, income);
    if (draft.isDraftMode) {
      return draft.updateIncome(id, income);
    }
    return false;
  }, [isQuickBudget, draft, updateIncomeQuick]);

  const deleteIncomeQuick = useCallback(async (id: string): Promise<boolean> => {
    try {
      const result = await window.electronAPI.income.delete(id);
      if (result.success) {
        await draft.reloadSnapshot();
        return true;
      }
      setError(result.error || 'Failed to delete income');
      return false;
    } catch {
      setError('Failed to delete income');
      return false;
    }
  }, [draft]);

  const deleteIncome = useCallback(async (id: string): Promise<boolean> => {
    if (isQuickBudget) return deleteIncomeQuick(id);
    if (draft.isDraftMode) {
      return draft.deleteIncome(id);
    }
    return false;
  }, [isQuickBudget, draft, deleteIncomeQuick]);

  const createBillQuick = useCallback(async (bill: BillInput): Promise<boolean> => {
    try {
      const result = await window.electronAPI.bills.create(bill);
      if (result.success) {
        await draft.reloadSnapshot();
        return true;
      }
      setError(result.error || 'Failed to create bill');
      return false;
    } catch {
      setError('Failed to create bill');
      return false;
    }
  }, [draft]);

  const createBill = useCallback(async (bill: BillInput): Promise<boolean> => {
    if (isQuickBudget) return createBillQuick(bill);
    if (draft.isDraftMode) {
      return draft.createBill(bill);
    }
    return false;
  }, [isQuickBudget, draft, createBillQuick]);

  const updateBillQuick = useCallback(async (id: string, bill: BillInput): Promise<boolean> => {
    try {
      const result = await window.electronAPI.bills.update(id, bill);
      if (result.success) {
        await draft.reloadSnapshot();
        return true;
      }
      setError(result.error || 'Failed to update bill');
      return false;
    } catch {
      setError('Failed to update bill');
      return false;
    }
  }, [draft]);

  const updateBill = useCallback(async (id: string, bill: BillInput): Promise<boolean> => {
    if (isQuickBudget) return updateBillQuick(id, bill);
    if (draft.isDraftMode) {
      return draft.updateBill(id, bill);
    }
    return false;
  }, [isQuickBudget, draft, updateBillQuick]);

  const deleteBillQuick = useCallback(async (id: string): Promise<boolean> => {
    try {
      const result = await window.electronAPI.bills.delete(id);
      if (result.success) {
        await draft.reloadSnapshot();
        return true;
      }
      setError(result.error || 'Failed to delete bill');
      return false;
    } catch {
      setError('Failed to delete bill');
      return false;
    }
  }, [draft]);

  const deleteBill = useCallback(async (id: string): Promise<boolean> => {
    if (isQuickBudget) return deleteBillQuick(id);
    if (draft.isDraftMode) {
      return draft.deleteBill(id);
    }
    return false;
  }, [isQuickBudget, draft, deleteBillQuick]);

  const setScheduleStartDate = useCallback((date: string) => {
    if (isQuickBudget) {
      setQuickBudgetStartDate(date);
      return;
    }
    draft.updateBudgetFields({ scheduleStartDate: date });
  }, [isQuickBudget, draft]);

  const setScheduleMonths = useCallback((months: number) => {
    setScheduleMonthsState(months);
    if (fullScheduleRef.current) {
      setSchedule(applyScheduleViewport(
        fullScheduleRef.current,
        months,
        bills,
        scheduleStartingBalance
      ));
    }
  }, [bills, scheduleStartingBalance]);

  const generateSchedule = useCallback(async (
    startDate: string,
    months: number,
    startingBalance: number
  ): Promise<ScheduleData | null> => {
    setIsLoading(true);
    try {
      const overlay = draft.buildDraftOverlay();
      const result = await window.electronAPI.schedule.build(
        startDate,
        months,
        startingBalance,
        overlay
      );
      if (result.success && result.data) {
        fullScheduleRef.current = {
          ...result.data,
          paychecks: result.data.fullPaychecks,
          viewportMonths: 12,
        };
        setSchedule(result.data);
        setScheduleMonthsState(result.data.viewportMonths);
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
  }, [draft]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const value = useMemo(() => ({
    incomes,
    bills,
    schedule,
    isLoading: isLoading || draft.isLoading,
    error,
    scheduleStartDate,
    scheduleMonths,
    scheduleStartingBalance,
    setScheduleStartDate,
    setScheduleMonths,
    setScheduleStartingBalance,
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
  }), [
    incomes,
    bills,
    schedule,
    isLoading,
    draft.isLoading,
    error,
    scheduleStartDate,
    scheduleMonths,
    scheduleStartingBalance,
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
  ]);

  return (
    <DataContext.Provider value={value}>
      {children}
    </DataContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useData() {
  const context = useContext(DataContext);
  if (!context) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
}
