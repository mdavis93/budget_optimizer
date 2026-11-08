import { memo } from 'react';
import { format, parseISO } from 'date-fns';
import { CreditCard, Pencil, Trash2, TrendingDown, Calendar, DollarSign, Percent } from 'lucide-react';
import { DebtAmortizationChart, ChartSuspense } from '../charts/lazyCharts';
import { CHART_COLORS } from '../charts/chartTheme';
import { DebtPlanDebt, DebtWithAmortization } from '../../types';
import { extraMonthlyDollars } from '@electron/services/scheduler/debt/debtSimulator';
import { formatCurrency } from '../../utils/formatCurrency';
import type { TimePeriod } from './debtSorting';
import {
  AVOIDED_BAR_OPACITY,
  acceleratedFooterFigures,
  buildPayoffChartPortions,
  interestSavedTextClass,
  isAccelerationPositive,
} from './accelerationChart';

interface DebtCardProps {
  debtData: DebtWithAmortization;
  timePeriod: TimePeriod;
  planDebt?: DebtPlanDebt;
  excludedReason?: string;
  onEdit: () => void;
  onDelete: () => void;
}

const DebtCard = memo(function DebtCard({
  debtData,
  timePeriod,
  planDebt,
  excludedReason,
  onEdit,
  onDelete,
}: DebtCardProps) {
  const { debt, bill, amortization } = debtData;
  
  if (!bill || !amortization) {
    return null;
  }

  // Calculate extra payment from bill budget vs minimum payment
  const extraPayment = extraMonthlyDollars(bill.budgetedAmount, debt.monthlyPayment);
  const accelerationPositive = isAccelerationPositive(planDebt);
  const acceleratedPayoffDate = accelerationPositive
    ? planDebt?.acceleratedPayoffDate
    : undefined;

  const monthsToShow = timePeriod === 'max' ? amortization.monthsToPayoff : Math.min(timePeriod, amortization.monthsToPayoff);
  const paymentsToShow = amortization.payments.slice(0, monthsToShow);
  const chartData = buildPayoffChartPortions({
    payments: amortization.payments,
    acceleratedPayoffDate,
    principalBalance: debt.principalBalance,
    acceleratedInterest: planDebt?.acceleratedInterest ?? 0,
  })
    .slice(0, monthsToShow)
    .map((portion) => ({
      name: format(parseISO(portion.date), 'MMM yy'),
      principal: portion.principal,
      interest: portion.interest,
      payment: portion.payment,
      avoidedPrincipal: portion.avoidedPrincipal,
      avoidedInterest: portion.avoidedInterest,
      avoided: portion.avoided,
    }));
  const hasAvoidedBars = chartData.some(
    (row) => row.avoided || row.avoidedPrincipal > 0 || row.avoidedInterest > 0
  );

  const displayedInterest = paymentsToShow.reduce((sum, p) => sum + p.interest, 0);
  const displayedPrincipal = paymentsToShow.reduce((sum, p) => sum + p.principal, 0);
  const baselineAmountOverPrincipal = amortization.totalPayments - amortization.totalPrincipal;
  const acceleratedFooter =
    accelerationPositive && planDebt
      ? acceleratedFooterFigures({
          principalBalance: debt.principalBalance,
          baselineInterest: planDebt.baselineInterest,
          acceleratedInterest: planDebt.acceleratedInterest,
          acceleratedPayoffDate: planDebt.acceleratedPayoffDate,
          baselinePayments: amortization.payments,
        })
      : null;

  return (
    <div className="card p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-danger-500/10 flex items-center justify-center">
            <CreditCard className="w-5 h-5 text-danger-400" />
          </div>
          <div>
            <h3 className="font-semibold text-lg">{bill.creditorName}</h3>
            <p className="text-sm text-(--color-text-muted)">
              {formatCurrency(debt.monthlyPayment)}/mo min payment
              {extraPayment > 0 && (
                <span className="text-success-400">
                  {' '}+ {formatCurrency(extraPayment)} extra
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onEdit}
            className="p-2 rounded-lg hover:bg-(--color-bg-tertiary) transition-colors"
            aria-label="Edit debt"
          >
            <Pencil className="w-4 h-4 text-(--color-text-muted)" />
          </button>
          <button
            onClick={onDelete}
            className="p-2 rounded-lg hover:bg-danger-500/10 transition-colors"
            aria-label="Delete debt"
          >
            <Trash2 className="w-4 h-4 text-danger-400" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-(--color-text-muted)">
            <DollarSign className="w-4 h-4" />
            <span className="text-xs">Balance</span>
          </div>
          <p className="text-lg font-semibold">{formatCurrency(debt.principalBalance)}</p>
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-(--color-text-muted)">
            <Percent className="w-4 h-4" />
            <span className="text-xs">APR</span>
          </div>
          <p className="text-lg font-semibold">{(debt.apr * 100).toFixed(2)}%</p>
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-(--color-text-muted)">
            <Calendar className="w-4 h-4" />
            <span className="text-xs">Payoff Date</span>
          </div>
          <p className="text-lg font-semibold">
            {amortization.monthsToPayoff > 0 
              ? format(parseISO(amortization.payoffDate), 'MMM yyyy')
              : 'Never'}
          </p>
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-(--color-text-muted)">
            <TrendingDown className="w-4 h-4" />
            <span className="text-xs">Total Interest</span>
          </div>
          <p className="text-lg font-semibold text-danger-400">
            {formatCurrency(amortization.totalInterest)}
          </p>
        </div>
      </div>

      {excludedReason && (
        <p className="text-sm text-warning-400">Excluded: {excludedReason}</p>
      )}

      {accelerationPositive && planDebt && (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-(--color-text-muted)">Baseline payoff</p>
            <p className="font-medium">
              {planDebt.baselinePayoffDate
                ? format(parseISO(planDebt.baselinePayoffDate), 'MMM yyyy')
                : '—'}
            </p>
            <p className="text-(--color-text-muted)">Baseline interest {formatCurrency(planDebt.baselineInterest)}</p>
          </div>
          <div>
            <p className="text-(--color-text-muted)">Accelerated payoff</p>
            <p className="font-medium">
              {planDebt.acceleratedPayoffDate
                ? format(parseISO(planDebt.acceleratedPayoffDate), 'MMM yyyy')
                : '—'}
            </p>
            <p className="text-(--color-text-muted)">Accelerated interest {formatCurrency(planDebt.acceleratedInterest)}</p>
          </div>
        </div>
      )}

      <div className="pt-4 border-t border-(--color-border)">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h4 className="font-medium">Payment Breakdown</h4>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: CHART_COLORS.principal }} />
              <span>Principal: {formatCurrency(displayedPrincipal)}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: CHART_COLORS.interest }} />
              <span>Interest: {formatCurrency(displayedInterest)}</span>
            </div>
            {hasAvoidedBars && (
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-sm"
                  style={{
                    backgroundColor: CHART_COLORS.principal,
                    opacity: AVOIDED_BAR_OPACITY,
                  }}
                />
                <span>Avoided</span>
              </div>
            )}
          </div>
        </div>
        {hasAvoidedBars && (
          <p className="text-xs text-(--color-text-muted) mb-3">
            Faded bars are baseline payments acceleration removes.
          </p>
        )}
        
        <div className="h-48">
          <ChartSuspense heightClass="h-48">
            <DebtAmortizationChart data={chartData} />
          </ChartSuspense>
        </div>

        <div className="mt-4 p-3 rounded-lg bg-(--color-bg-tertiary) text-sm space-y-2">
          {acceleratedFooter ? (
            <>
              <div className="flex justify-between gap-3">
                <span className="text-(--color-text-muted)">
                  Baseline total payments ({amortization.monthsToPayoff} months)
                </span>
                <span className="font-medium">{formatCurrency(amortization.totalPayments)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-(--color-text-muted)">Baseline amount over principal</span>
                <span className="font-medium text-danger-400">
                  +{formatCurrency(baselineAmountOverPrincipal)}
                </span>
              </div>
              <div className="flex justify-between gap-3 pt-1 border-t border-(--color-border)">
                <span className="text-(--color-text-muted)">
                  Accelerated total payments
                  {acceleratedFooter.monthsToPayoff != null
                    ? ` (${acceleratedFooter.monthsToPayoff} months)`
                    : ''}
                </span>
                <span className="font-medium">{formatCurrency(acceleratedFooter.totalPayments)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-(--color-text-muted)">Interest Saved</span>
                <span className={`font-medium ${interestSavedTextClass(acceleratedFooter.interestSaved)}`}>
                  {formatCurrency(acceleratedFooter.interestSaved)}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="flex justify-between">
                <span className="text-(--color-text-muted)">
                  Total Payments ({amortization.monthsToPayoff} months)
                </span>
                <span className="font-medium">{formatCurrency(amortization.totalPayments)}</span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-(--color-text-muted)">Amount Over Principal</span>
                <span className="font-medium text-danger-400">
                  +{formatCurrency(baselineAmountOverPrincipal)}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
});

export default DebtCard;
