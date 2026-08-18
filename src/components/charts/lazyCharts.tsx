import { Suspense, lazy, type ReactNode } from 'react';

export function ChartSuspense({ children, heightClass = 'h-64' }: { children: ReactNode; heightClass?: string }) {
  return (
    <Suspense
      fallback={
        <div className={`${heightClass} animate-pulse rounded-lg bg-(--color-bg-tertiary)`} aria-hidden="true" />
      }
    >
      {children}
    </Suspense>
  );
}

export const BalanceProjectionChart = lazy(() => import('./BalanceProjectionChart'));
export const DebtAmortizationChart = lazy(() => import('./DebtAmortizationChart'));
export const IncomeExpensesChart = lazy(() =>
  import('./SummaryCharts').then((mod) => ({ default: mod.IncomeExpensesChart }))
);
export const CategoryPieChart = lazy(() =>
  import('./SummaryCharts').then((mod) => ({ default: mod.CategoryPieChart }))
);
export const SavingsAreaChart = lazy(() =>
  import('./SummaryCharts').then((mod) => ({ default: mod.SavingsAreaChart }))
);
