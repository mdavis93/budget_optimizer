import { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';
import { Budget, BudgetWithStats } from '../types';

interface BudgetContextValue {
  budgets: BudgetWithStats[];
  currentBudget: Budget | null;
  isQuickBudget: boolean;
  isLoading: boolean;
  hasBudgetSelected: boolean;
  
  loadBudgets: () => Promise<void>;
  createBudget: (name: string, startingBalance?: number, targetCashOnHand?: number, minCashOnHand?: number) => Promise<Budget>;
  updateBudget: (id: string, updates: { name?: string; startingBalance?: number; targetCashOnHand?: number; minCashOnHand?: number; minSavingsPerPaycheck?: number }) => Promise<void>;
  deleteBudget: (id: string) => Promise<boolean>;
  switchBudget: (id: string) => Promise<void>;
  startQuickBudget: () => Promise<void>;
  endQuickBudget: () => Promise<void>;
  refreshCurrentBudget: () => Promise<void>;
}

const BudgetContext = createContext<BudgetContextValue | null>(null);

export function BudgetProvider({ children }: { children: ReactNode }) {
  const [budgets, setBudgets] = useState<BudgetWithStats[]>([]);
  const [currentBudget, setCurrentBudget] = useState<Budget | null>(null);
  const [isQuickBudget, setIsQuickBudget] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const loadBudgets = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await window.electronAPI.budget.getAllWithStats();
      if (result.success && result.data) {
        setBudgets(result.data);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refreshCurrentBudget = useCallback(async () => {
    const result = await window.electronAPI.budget.getCurrent();
    if (result.success && result.data) {
      setCurrentBudget(result.data.budget);
      setIsQuickBudget(result.data.isQuickBudget);
    }
  }, []);

  const createBudget = useCallback(async (name: string, startingBalance?: number, targetCashOnHand?: number, minCashOnHand?: number): Promise<Budget> => {
    const result = await window.electronAPI.budget.create({ name, startingBalance, targetCashOnHand, minCashOnHand });
    if (!result.success || !result.data) {
      throw new Error(result.error || 'Failed to create budget');
    }
    await loadBudgets();
    return result.data;
  }, [loadBudgets]);

  const updateBudget = useCallback(async (id: string, updates: { name?: string; startingBalance?: number; targetCashOnHand?: number; minCashOnHand?: number; minSavingsPerPaycheck?: number }) => {
    const result = await window.electronAPI.budget.update(id, updates);
    if (!result.success) {
      throw new Error(result.error || 'Failed to update budget');
    }
    await loadBudgets();
    if (currentBudget?.id === id && result.data) {
      setCurrentBudget(result.data);
    }
  }, [loadBudgets, currentBudget]);

  const deleteBudget = useCallback(async (id: string): Promise<boolean> => {
    const result = await window.electronAPI.budget.delete(id);
    if (result.success) {
      await loadBudgets();
      return true;
    }
    return false;
  }, [loadBudgets]);

  const switchBudget = useCallback(async (id: string) => {
    const result = await window.electronAPI.budget.switch(id);
    if (result.success && result.data) {
      setCurrentBudget(result.data);
      setIsQuickBudget(false);
      
      // Save as last used budget
      await window.electronAPI.settings.update({ lastBudgetId: id });
    }
  }, []);

  const startQuickBudget = useCallback(async () => {
    const result = await window.electronAPI.budget.startQuick();
    if (result.success) {
      setCurrentBudget(null);
      setIsQuickBudget(true);
    }
  }, []);

  const endQuickBudget = useCallback(async () => {
    const result = await window.electronAPI.budget.endQuick();
    if (result.success) {
      setIsQuickBudget(false);
    }
  }, []);

  const hasBudgetSelected = currentBudget !== null || isQuickBudget;

  const value = useMemo(() => ({
    budgets,
    currentBudget,
    isQuickBudget,
    isLoading,
    hasBudgetSelected,
    loadBudgets,
    createBudget,
    updateBudget,
    deleteBudget,
    switchBudget,
    startQuickBudget,
    endQuickBudget,
    refreshCurrentBudget,
  }), [
    budgets,
    currentBudget,
    isQuickBudget,
    isLoading,
    hasBudgetSelected,
    loadBudgets,
    createBudget,
    updateBudget,
    deleteBudget,
    switchBudget,
    startQuickBudget,
    endQuickBudget,
    refreshCurrentBudget,
  ]);

  return (
    <BudgetContext.Provider value={value}>
      {children}
    </BudgetContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useBudget() {
  const context = useContext(BudgetContext);
  if (!context) {
    throw new Error('useBudget must be used within a BudgetProvider');
  }
  return context;
}
