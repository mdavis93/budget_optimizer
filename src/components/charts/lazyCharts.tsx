import { Suspense, type ReactNode } from 'react';

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

export { default as BalanceProjectionChart } from './BalanceProjectionChart';
export { default as DebtAmortizationChart } from './DebtAmortizationChart';
export { IncomeExpensesChart, CategoryPieChart, SavingsAreaChart } from './SummaryCharts';
