import { useState, useEffect, useMemo } from 'react';
import { useDraftData, useSchedule } from '../context/DraftContext';
import { format, parseISO, differenceInDays } from 'date-fns';
import { CategoryPieChart, ChartSuspense, IncomeExpensesChart, SavingsAreaChart } from '../components/charts/lazyCharts';
import clsx from 'clsx';
import { formatCurrency } from '../utils/formatCurrency';
import { SCHEDULE_VIEWPORT_MONTHS, type ScheduleViewportMonths } from '@shared/scheduleViewportMonths';
import type { DebtPlan } from '@shared/types';
import { clampSavingsApy, DEFAULT_SAVINGS_APY } from '@shared/settingsDefaults';
import { billCategoryChartColor } from '../types';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function displayIsoDate(value: string | null | undefined): string {
  if (!value) return '—';
  if (!ISO_DAY.test(value)) return value;
  return format(parseISO(value), 'MMM d, yyyy');
}

export default function SummaryPage() {
  const { incomes, bills } = useDraftData();
  const {
    generateSchedule,
    scheduleStartDate,
    scheduleMonths,
    isViewportReady,
    scheduleStartingBalance,
    scheduleInputHash,
    setScheduleMonths,
  } = useSchedule();
  const [scheduleData, setScheduleData] = useState<{
    paychecks: Array<{
      date: string;
      totalIncome: number;
      totalBills: number;
      budgetRemaining: number;
      savingsDeposit: number;
      totalSavings: number;
      bills: Array<{ category?: string; amount: number }>;
    }>;
    summary: {
      totalIncome: number;
      totalExpenses: number;
      totalSavingsDeposits: number;
      finalSavingsBalance: number;
    };
    debtPlan?: DebtPlan;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [savingsAPY, setSavingsAPY] = useState(DEFAULT_SAVINGS_APY);

  useEffect(() => {
    let isMounted = true;
    
    const loadSettings = async () => {
      try {
        const result = await window.electronAPI.settings.get();
        if (isMounted && result.success && result.data) {
          setSavingsAPY(result.data.savingsAPY ?? DEFAULT_SAVINGS_APY);
        }
      } catch {
        // Use default
      }
    };
    loadSettings();
    
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    let isMounted = true;
    
    const loadScheduleData = async () => {
      if (!isViewportReady || (incomes.length === 0 && bills.length === 0)) return;
      
      setIsLoading(true);
      try {
        const result = await generateSchedule(scheduleStartDate, scheduleMonths, scheduleStartingBalance);
        if (isMounted && result) {
          setScheduleData({
            paychecks: result.paychecks,
            summary: result.summary,
            debtPlan: result.debtPlan,
          });
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };
    
    loadScheduleData();
    
    return () => { isMounted = false; };
  }, [incomes, bills, scheduleMonths, isViewportReady, generateSchedule, scheduleStartDate, scheduleStartingBalance, scheduleInputHash]);

  const handleAPYChange = async (newAPY: number) => {
    const clampedAPY = clampSavingsApy(newAPY);
    setSavingsAPY(clampedAPY);
    try {
      await window.electronAPI.settings.update({ savingsAPY: clampedAPY });
    } catch {
      // Silently fail
    }
  };

  const formatWholeCurrency = (amount: number) => formatCurrency(amount, { fractionDigits: 0 });

  const savingsProjectionData = useMemo(() => {
    if (!scheduleData?.paychecks) return [];
    
    const dailyRate = savingsAPY / 100 / 365;
    let accumulatedSavings = 0;
    let projectedWithInterest = 0;
    let lastDate: Date | null = null;
    
    const dataByMonth = new Map<string, { savings: number; projected: number }>();
    
    for (const paycheck of scheduleData.paychecks) {
      const date = parseISO(paycheck.date);
      const monthKey = format(date, 'MMM yyyy');
      
      if (lastDate && savingsAPY > 0) {
        const daysSinceLast = differenceInDays(date, lastDate);
        projectedWithInterest = projectedWithInterest * Math.pow(1 + dailyRate, daysSinceLast);
      }
      
      accumulatedSavings += paycheck.savingsDeposit;
      projectedWithInterest += paycheck.savingsDeposit;
      lastDate = date;
      
      dataByMonth.set(monthKey, {
        savings: accumulatedSavings,
        projected: projectedWithInterest,
      });
    }
    
    return Array.from(dataByMonth.entries()).map(([month, data]) => ({
      month,
      total: Math.round(data.projected),
      principal: Math.round(data.savings),
      interest: Math.round(data.projected - data.savings),
    }));
  }, [scheduleData, savingsAPY]);

  const incomeVsExpensesData = useMemo(() => {
    if (!scheduleData?.paychecks) return [];
    
    const monthlyData = new Map<string, { income: number; expenses: number }>();
    
    for (const paycheck of scheduleData.paychecks) {
      const date = parseISO(paycheck.date);
      const monthKey = format(date, 'MMM');
      
      const existing = monthlyData.get(monthKey) || { income: 0, expenses: 0 };
      monthlyData.set(monthKey, {
        income: existing.income + paycheck.totalIncome,
        expenses: existing.expenses + paycheck.totalBills,
      });
    }
    
    return Array.from(monthlyData.entries()).map(([month, data]) => ({
      month,
      income: Math.round(data.income),
      expenses: Math.round(data.expenses),
    }));
  }, [scheduleData]);

  const categoryData = useMemo(() => {
    if (!scheduleData?.paychecks) return [];
    
    const categoryTotals = new Map<string, number>();
    
    for (const paycheck of scheduleData.paychecks) {
      for (const bill of paycheck.bills) {
        const category = bill.category || 'Other';
        const existing = categoryTotals.get(category) || 0;
        categoryTotals.set(category, existing + bill.amount);
      }
    }
    
    return Array.from(categoryTotals.entries())
      .map(([name, value]) => ({
        name,
        value: Math.round(value),
        color: billCategoryChartColor(name),
      }))
      .sort((a, b) => b.value - a.value);
  }, [scheduleData]);

  const hasData = incomes.length > 0 || bills.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Summary</h2>
          <p className="text-(--color-text-secondary)">
            Budget trends and projections
          </p>
        </div>
        
        <div className="flex items-center gap-1 bg-(--color-bg-tertiary) rounded-lg p-1">
          {(SCHEDULE_VIEWPORT_MONTHS as readonly ScheduleViewportMonths[]).map((period) => (
            <button
              key={period}
              onClick={() => setScheduleMonths(period)}
              className={clsx(
                'px-4 py-2 rounded-md text-sm font-medium transition-colors',
                scheduleMonths === period
                  ? 'bg-primary-500 text-white'
                  : 'text-(--color-text-secondary) hover:text-(--color-text-primary)'
              )}
            >
              {period} Months
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="text-center py-8 text-(--color-text-muted)">
          Loading trends...
        </div>
      )}

      {!hasData && !isLoading && (
        <div className="text-center py-16 text-(--color-text-muted)">
          Add income and bills to see your budget trends
        </div>
      )}

      {hasData && !isLoading && (
        <div className="space-y-6">
          {scheduleData?.debtPlan?.enabled && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="card p-4">
                <p className="text-sm text-(--color-text-muted)">Debt-free date</p>
                <p className="text-xl font-semibold">{displayIsoDate(scheduleData.debtPlan.debtFreeDate)}</p>
              </div>
              <div className="card p-4">
                <p className="text-sm text-(--color-text-muted)">Interest saved</p>
                <p className="text-xl font-semibold">{formatCurrency(scheduleData.debtPlan.totalInterestSaved)}</p>
              </div>
              <div className="card p-4">
                <p className="text-sm text-(--color-text-muted)">Freed monthly cash</p>
                <p className="text-xl font-semibold">{formatCurrency(scheduleData.debtPlan.freedMonthlyCash)}</p>
              </div>
            </div>
          )}
          {/* Top Row: Income vs Expenses + Category Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Income vs Expenses */}
            <div className="card">
              <h3 className="font-semibold mb-4">Income vs Expenses</h3>
              {incomeVsExpensesData.length > 0 ? (
                <div className="h-64">
                  <ChartSuspense>
                    <IncomeExpensesChart data={incomeVsExpensesData} formatCurrency={formatWholeCurrency} />
                  </ChartSuspense>
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center text-(--color-text-muted)">
                  No data available
                </div>
              )}
            </div>

            {/* Category Breakdown */}
            <div className="card">
              <h3 className="font-semibold mb-4">Expense Categories</h3>
              {categoryData.length > 0 ? (
                <div className="h-64 flex">
                  <div className="flex-1">
                    <ChartSuspense>
                      <CategoryPieChart data={categoryData} formatCurrency={formatWholeCurrency} />
                    </ChartSuspense>
                  </div>
                  <div className="w-40 overflow-y-auto">
                    <div className="space-y-2">
                      {categoryData.slice(0, 8).map((cat) => (
                        <div key={cat.name} className="flex items-center gap-2 text-xs">
                          <div
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: cat.color }}
                          />
                          <span className="truncate flex-1">{cat.name}</span>
                          <span className="text-(--color-text-muted) font-mono">
                            {formatWholeCurrency(cat.value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center text-(--color-text-muted)">
                  No expense data available
                </div>
              )}
            </div>
          </div>

          {/* Bottom Row: Savings Projection (full width) */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold">Savings Projection</h3>
                <p className="text-xs text-(--color-text-muted)">
                  Daily accrual with monthly compounding
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="summary-apy" className="text-xs text-(--color-text-muted)">APY:</label>
                <input
                  id="summary-apy"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={savingsAPY}
                  onChange={(e) => handleAPYChange(parseFloat(e.target.value) || 0)}
                  className="input w-20 text-sm py-1"
                />
                <span className="text-xs text-(--color-text-muted)">%</span>
              </div>
            </div>
            {savingsProjectionData.length > 0 ? (
              <div className="h-80">
                <ChartSuspense heightClass="h-80">
                  <SavingsAreaChart data={savingsProjectionData} formatCurrency={formatWholeCurrency} />
                </ChartSuspense>
              </div>
            ) : (
              <div className="h-80 flex items-center justify-center text-(--color-text-muted)">
                No savings data available
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
