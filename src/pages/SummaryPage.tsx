import { useState, useEffect, useMemo } from 'react';
import { useData } from '../context/DataContext';
import { format, parseISO, differenceInDays } from 'date-fns';
import { CategoryPieChart, ChartSuspense, IncomeExpensesChart, SavingsAreaChart } from '../components/charts/lazyCharts';
import { CHART_COLORS } from '../components/charts/chartTheme';
import clsx from 'clsx';

type TimePeriod = 3 | 6 | 12;

const CATEGORY_COLORS: Record<string, string> = {
  Housing: CHART_COLORS.primary,
  Utilities: CHART_COLORS.warning,
  Transportation: CHART_COLORS.purple,
  Insurance: CHART_COLORS.cyan,
  Debt: CHART_COLORS.danger,
  Subscriptions: CHART_COLORS.pink,
  Food: CHART_COLORS.success,
  Healthcare: CHART_COLORS.teal,
  Entertainment: CHART_COLORS.orange,
  Savings: CHART_COLORS.lime,
  Other: CHART_COLORS.indigo,
};

export default function SummaryPage() {
  const { incomes, bills, generateSchedule, scheduleStartDate, scheduleStartingBalance, scheduleInputHash } = useData();
  const [timePeriod, setTimePeriod] = useState<TimePeriod>(3);
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
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [savingsAPY, setSavingsAPY] = useState(0);

  useEffect(() => {
    let isMounted = true;
    
    const loadSettings = async () => {
      try {
        const result = await window.electronAPI.settings.get();
        if (isMounted && result.success && result.data) {
          setSavingsAPY(result.data.savingsAPY || 0);
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
      if (incomes.length === 0 && bills.length === 0) return;
      
      setIsLoading(true);
      try {
        const result = await generateSchedule(scheduleStartDate, timePeriod, scheduleStartingBalance);
        if (isMounted && result) {
          setScheduleData({
            paychecks: result.paychecks,
            summary: result.summary,
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
  }, [incomes, bills, timePeriod, generateSchedule, scheduleStartDate, scheduleStartingBalance, scheduleInputHash]);

  const handleAPYChange = async (newAPY: number) => {
    setSavingsAPY(newAPY);
    try {
      await window.electronAPI.settings.update({ savingsAPY: newAPY });
    } catch {
      // Silently fail
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

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
        color: CATEGORY_COLORS[name] || CHART_COLORS.indigo,
      }))
      .sort((a, b) => b.value - a.value);
  }, [scheduleData]);

  const hasData = incomes.length > 0 || bills.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Summary</h2>
          <p className="text-[var(--color-text-secondary)]">
            Budget trends and projections
          </p>
        </div>
        
        <div className="flex items-center gap-1 bg-[var(--color-bg-tertiary)] rounded-lg p-1">
          {([3, 6, 12] as TimePeriod[]).map((period) => (
            <button
              key={period}
              onClick={() => setTimePeriod(period)}
              className={clsx(
                'px-4 py-2 rounded-md text-sm font-medium transition-colors',
                timePeriod === period
                  ? 'bg-primary-500 text-white'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              )}
            >
              {period} Months
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="text-center py-8 text-[var(--color-text-muted)]">
          Loading trends...
        </div>
      )}

      {!hasData && !isLoading && (
        <div className="text-center py-16 text-[var(--color-text-muted)]">
          Add income and bills to see your budget trends
        </div>
      )}

      {hasData && !isLoading && (
        <div className="space-y-6">
          {/* Top Row: Income vs Expenses + Category Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Income vs Expenses */}
            <div className="card">
              <h3 className="font-semibold mb-4">Income vs Expenses</h3>
              {incomeVsExpensesData.length > 0 ? (
                <div className="h-64">
                  <ChartSuspense>
                    <IncomeExpensesChart data={incomeVsExpensesData} formatCurrency={formatCurrency} />
                  </ChartSuspense>
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center text-[var(--color-text-muted)]">
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
                      <CategoryPieChart data={categoryData} formatCurrency={formatCurrency} />
                    </ChartSuspense>
                  </div>
                  <div className="w-40 overflow-y-auto">
                    <div className="space-y-2">
                      {categoryData.slice(0, 8).map((cat) => (
                        <div key={cat.name} className="flex items-center gap-2 text-xs">
                          <div
                            className="w-3 h-3 rounded-full flex-shrink-0"
                            style={{ backgroundColor: cat.color }}
                          />
                          <span className="truncate flex-1">{cat.name}</span>
                          <span className="text-[var(--color-text-muted)] font-mono">
                            {formatCurrency(cat.value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center text-[var(--color-text-muted)]">
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
                <p className="text-xs text-[var(--color-text-muted)]">
                  Daily accrual with monthly compounding
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="summary-apy" className="text-xs text-[var(--color-text-muted)]">APY:</label>
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
                <span className="text-xs text-[var(--color-text-muted)]">%</span>
              </div>
            </div>
            {savingsProjectionData.length > 0 ? (
              <div className="h-80">
                <ChartSuspense heightClass="h-80">
                  <SavingsAreaChart data={savingsProjectionData} formatCurrency={formatCurrency} />
                </ChartSuspense>
              </div>
            ) : (
              <div className="h-80 flex items-center justify-center text-[var(--color-text-muted)]">
                No savings data available
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
