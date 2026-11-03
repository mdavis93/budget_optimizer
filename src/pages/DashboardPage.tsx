import { useEffect, useMemo } from 'react';
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Wallet,
  Receipt,
} from 'lucide-react';
import { useDraftData, useSchedule } from '../context/DraftContext';
import { ScheduleBuildProgress } from '../components/schedule';
import PayCycleBoard from '../components/dashboard/PayCycleBoard';
import { useCopyDiagnosticReport } from '../hooks/useCopyDiagnosticReport';
import clsx from 'clsx';
import { formatCurrency } from '../utils/formatCurrency';
import { getMonthlyBillEquivalent, getMonthlyOperatingIncomeTotal } from '../utils/cadence';
import { buildPayCycleBoard } from '../utils/payCycleBoard';

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
          <p className="text-sm text-(--color-text-secondary) mb-1">{label}</p>
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
            'text-(--color-text-muted)': trend === 'neutral',
          })}>
            {trend === 'up' ? 'Positive' : trend === 'down' ? 'Negative' : 'Neutral'} balance trend
          </span>
        </div>
      )}
    </div>
  );
}

function todayIsoLocal(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function DashboardPage() {
  const { incomes, bills } = useDraftData();
  const copyReport = useCopyDiagnosticReport();
  const {
    generateSchedule,
    schedule,
    scheduleStartDate,
    scheduleMonths,
    isViewportReady,
    scheduleStartingBalance,
    scheduleInputHash,
    setScheduleStartingBalance,
    isLoading,
    error,
    diagnosticId,
    progress,
    buildStartedAt,
    clearError,
  } = useSchedule();

  useEffect(() => {
    let isMounted = true;

    const loadSchedule = async () => {
      if (isMounted) {
        await generateSchedule(scheduleStartDate, scheduleMonths, scheduleStartingBalance);
      }
    };

    if (isViewportReady && (incomes.length > 0 || bills.length > 0)) {
      loadSchedule();
    }

    return () => { isMounted = false; };
  }, [incomes, bills, generateSchedule, scheduleStartDate, scheduleMonths, isViewportReady, scheduleStartingBalance, scheduleInputHash]);

  const totalMonthlyIncome = useMemo(() => {
    return getMonthlyOperatingIncomeTotal(incomes);
  }, [incomes]);

  const totalMonthlyBills = useMemo(() => {
    return bills.reduce((sum, bill) => sum + getMonthlyBillEquivalent(bill, incomes), 0);
  }, [bills, incomes]);

  const todayIso = todayIsoLocal();

  const payCycleBoard = useMemo(() => {
    if (!schedule?.paychecks?.length) return null;
    return buildPayCycleBoard(schedule.paychecks, todayIso);
  }, [schedule, todayIso]);

  const formatWholeCurrency = (amount: number) => formatCurrency(amount, { fractionDigits: 0 });

  const netMonthly = totalMonthlyIncome - totalMonthlyBills;
  const hasShortfalls = (schedule?.summary?.shortfallCount ?? 0) > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Dashboard</h2>
          <p className="text-(--color-text-secondary)">
            Overview of your budget for the next {scheduleMonths} months
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-(--color-text-secondary)">Starting Balance:</label>
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
          value={formatWholeCurrency(totalMonthlyIncome)}
          icon={Wallet}
          color="bg-success-100 dark:bg-success-900 text-success-700 dark:text-success-200"
        />
        <StatCard
          label="Monthly Bills"
          value={formatWholeCurrency(totalMonthlyBills)}
          icon={Receipt}
          color="bg-danger-100 dark:bg-danger-900 text-danger-700 dark:text-danger-200"
        />
        <StatCard
          label="Net Monthly"
          value={formatWholeCurrency(netMonthly)}
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
            : "bg-(--color-bg-tertiary) text-(--color-text-secondary)"
          }
        />
      </div>

      <div className="card">
        {isLoading ? (
          <div
            className="h-64 flex flex-col items-center justify-center px-4 text-(--color-text-secondary)"
            role="status"
            aria-live="polite"
          >
            <ScheduleBuildProgress
              heading="Building schedule for Upcoming pay cycle…"
              progress={progress}
              startedAt={buildStartedAt}
            />
          </div>
        ) : error ? (
          <div
            className="h-64 flex flex-col items-center justify-center gap-3 text-center px-4"
            role="alert"
          >
            <p className="font-medium">Could not build the upcoming pay cycle.</p>
            <p className="text-sm text-(--color-text-secondary)">{error}</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  clearError();
                  void generateSchedule(scheduleStartDate, scheduleMonths, scheduleStartingBalance, { force: true });
                }}
              >
                Try again
              </button>
              {diagnosticId ? (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    void copyReport(diagnosticId);
                  }}
                >
                  Copy report
                </button>
              ) : null}
            </div>
          </div>
        ) : payCycleBoard ? (
          <PayCycleBoard
            board={payCycleBoard}
            todayIso={todayIso}
            formatCurrency={formatWholeCurrency}
          />
        ) : (
          <div className="h-64 flex items-center justify-center text-(--color-text-muted)">
            Add income and bills to see your upcoming pay cycle
          </div>
        )}
      </div>
    </div>
  );
}
