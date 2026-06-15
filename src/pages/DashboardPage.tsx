import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { 
  TrendingUp, 
  TrendingDown, 
  AlertTriangle,
  ArrowRight,
  Wallet,
  Receipt,
  Calendar
} from 'lucide-react';
import { useData } from '../context/DataContext';
import { format, parseISO, isWithinInterval, addDays } from 'date-fns';
import { BalanceProjectionChart, ChartSuspense } from '../components/charts/lazyCharts';
import clsx from 'clsx';
import { getMonthlyBillEquivalent, getMonthlyIncomeEquivalent } from '../utils/cadence';

interface StatCardProps {
  label: string;
  value: string;
  trend?: 'up' | 'down' | 'neutral';
  icon: React.ElementType;
  color: string;
}

function StatCard({ label, value, trend, icon: Icon, color }: StatCardProps) {
  return (
    <div className="card">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-[var(--color-text-secondary)] mb-1">{label}</p>
          <p className="text-2xl font-semibold">{value}</p>
        </div>
        <div className={clsx('p-2 rounded-lg', color)}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      {trend && (
        <div className="mt-3 flex items-center gap-1 text-sm">
          {trend === 'up' && <TrendingUp className="w-4 h-4 text-success-500" />}
          {trend === 'down' && <TrendingDown className="w-4 h-4 text-danger-500" />}
          <span className={clsx({
            'text-success-500': trend === 'up',
            'text-danger-500': trend === 'down',
            'text-[var(--color-text-muted)]': trend === 'neutral',
          })}>
            {trend === 'up' ? 'Positive' : trend === 'down' ? 'Negative' : 'Neutral'} balance trend
          </span>
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const {
    incomes,
    bills,
    generateSchedule,
    schedule,
    scheduleStartDate,
    scheduleStartingBalance,
    setScheduleStartingBalance,
  } = useData();

  useEffect(() => {
    let isMounted = true;
    
    const loadSchedule = async () => {
      if (isMounted) {
        await generateSchedule(scheduleStartDate, 3, scheduleStartingBalance);
      }
    };
    
    if (incomes.length > 0 || bills.length > 0) {
      loadSchedule();
    }
    
    return () => { isMounted = false; };
  }, [incomes, bills, generateSchedule, scheduleStartDate, scheduleStartingBalance]);

  const totalMonthlyIncome = useMemo(() => {
    return incomes
      .filter(i => i.isActive)
      .reduce((sum, income) => sum + getMonthlyIncomeEquivalent(income), 0);
  }, [incomes]);

  const totalMonthlyBills = useMemo(() => {
    return bills.reduce((sum, bill) => sum + getMonthlyBillEquivalent(bill, incomes), 0);
  }, [bills, incomes]);

  const upcomingPayments = useMemo(() => {
    if (!schedule?.entries) return [];
    
    const now = new Date();
    const nextWeek = addDays(now, 7);
    
    return schedule.entries
      .filter(entry => {
        const entryDate = parseISO(entry.date);
        return isWithinInterval(entryDate, { start: now, end: nextWeek });
      })
      .slice(0, 5);
  }, [schedule]);

  const chartData = useMemo(() => {
    if (!schedule?.entries) return [];
    
    const dataPoints: { date: string; balance: number }[] = [];
    
    for (const entry of schedule.entries.slice(0, 30)) {
      dataPoints.push({
        date: format(parseISO(entry.date), 'MMM d'),
        balance: entry.runningBalance,
      });
    }
    
    return dataPoints;
  }, [schedule]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const netMonthly = totalMonthlyIncome - totalMonthlyBills;
  const hasShortfalls = schedule?.summary?.shortfallCount ?? 0 > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Dashboard</h2>
          <p className="text-[var(--color-text-secondary)]">
            Overview of your budget for the next 3 months
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-[var(--color-text-secondary)]">Starting Balance:</label>
          <input
            type="number"
            value={scheduleStartingBalance}
            onChange={(e) => setScheduleStartingBalance(parseFloat(e.target.value) || 0)}
            className="input w-32"
            placeholder="$0"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Monthly Income"
          value={formatCurrency(totalMonthlyIncome)}
          icon={Wallet}
          color="bg-success-100 dark:bg-success-900 text-success-700 dark:text-success-200"
        />
        <StatCard
          label="Monthly Bills"
          value={formatCurrency(totalMonthlyBills)}
          icon={Receipt}
          color="bg-danger-100 dark:bg-danger-900 text-danger-700 dark:text-danger-200"
        />
        <StatCard
          label="Net Monthly"
          value={formatCurrency(netMonthly)}
          trend={netMonthly > 0 ? 'up' : netMonthly < 0 ? 'down' : 'neutral'}
          icon={TrendingUp}
          color="bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-200"
        />
        <StatCard
          label="Projected Shortfalls"
          value={String(schedule?.summary?.shortfallCount ?? 0)}
          icon={AlertTriangle}
          color={hasShortfalls 
            ? "bg-warning-100 dark:bg-warning-900 text-warning-800 dark:text-warning-200"
            : "bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]"
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Balance Projection</h3>
            <Link to="/schedule" className="text-sm text-primary-500 hover:text-primary-600 flex items-center gap-1">
              View full schedule <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          
          {chartData.length > 0 ? (
            <div className="h-64">
              <ChartSuspense>
                <BalanceProjectionChart data={chartData} formatCurrency={formatCurrency} />
              </ChartSuspense>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-[var(--color-text-muted)]">
              Add income and bills to see your balance projection
            </div>
          )}
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Next 7 Days</h3>
            <Calendar className="w-5 h-5 text-[var(--color-text-muted)]" />
          </div>
          
          {upcomingPayments.length > 0 ? (
            <div className="space-y-3">
              {upcomingPayments.map((entry, index) => (
                <div 
                  key={index}
                  className={clsx(
                    'flex items-center justify-between p-3 rounded-lg',
                    entry.isShortfall ? 'bg-danger-50 dark:bg-danger-500/10' : 'bg-[var(--color-bg-tertiary)]'
                  )}
                >
                  <div>
                    <p className="font-medium text-sm">{entry.description}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {format(parseISO(entry.date), 'EEE, MMM d')}
                    </p>
                  </div>
                  <span className={clsx(
                    'font-mono font-medium',
                    entry.type === 'income' ? 'text-success-500' : 'text-danger-500'
                  )}>
                    {entry.type === 'income' ? '+' : '-'}{formatCurrency(entry.amount)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-[var(--color-text-muted)]">
              No upcoming payments this week
            </div>
          )}
        </div>
      </div>

      {schedule?.recommendations && schedule.recommendations.length > 0 && (
        <div className="card border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-500/10">
          <h3 className="font-semibold mb-3 text-primary-700 dark:text-primary-400">Recommendations</h3>
          <ul className="space-y-2">
            {schedule.recommendations.map((rec, index) => (
              <li key={index} className="flex items-start gap-2 text-sm text-primary-700 dark:text-primary-300">
                <span className="text-primary-500 mt-0.5">→</span>
                {rec}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
