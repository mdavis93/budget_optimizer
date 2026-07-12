import { memo } from 'react';
import { format, parseISO } from 'date-fns';
import { CreditCard, Pencil, Trash2, TrendingDown, Calendar, DollarSign, Percent } from 'lucide-react';
import { DebtAmortizationChart, ChartSuspense } from '../charts/lazyCharts';
import { CHART_COLORS } from '../charts/chartTheme';
import { DebtWithAmortization } from '../../types';
import type { TimePeriod } from './debtSorting';

interface DebtCardProps {
  debtData: DebtWithAmortization;
  timePeriod: TimePeriod;
  onEdit: () => void;
  onDelete: () => void;
}

const DebtCard = memo(function DebtCard({ debtData, timePeriod, onEdit, onDelete }: DebtCardProps) {
  const { debt, bill, amortization } = debtData;
  
  if (!bill || !amortization) {
    return null;
  }

  // Calculate extra payment from bill budget vs minimum payment
  const extraPayment = Math.max(0, bill.budgetedAmount - debt.monthlyPayment);

  const monthsToShow = timePeriod === 'max' ? amortization.monthsToPayoff : Math.min(timePeriod, amortization.monthsToPayoff);
  const paymentsToShow = amortization.payments.slice(0, monthsToShow);
  
  const chartData = paymentsToShow.map((payment) => ({
    name: format(parseISO(payment.date), 'MMM yy'),
    principal: payment.principal,
    interest: payment.interest,
    payment: payment.payment,
  }));

  const displayedInterest = paymentsToShow.reduce((sum, p) => sum + p.interest, 0);
  const displayedPrincipal = paymentsToShow.reduce((sum, p) => sum + p.principal, 0);

  return (
    <div className="card p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-danger-500/10 flex items-center justify-center">
            <CreditCard className="w-5 h-5 text-danger-400" />
          </div>
          <div>
            <h3 className="font-semibold text-lg">{bill.creditorName}</h3>
            <p className="text-sm text-[var(--color-text-muted)]">
              ${debt.monthlyPayment.toFixed(2)}/mo min payment
              {extraPayment > 0 && (
                <span className="text-success-400">
                  {' '}+ ${extraPayment.toFixed(2)} extra
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onEdit}
            className="p-2 rounded-lg hover:bg-[var(--color-bg-tertiary)] transition-colors"
            aria-label="Edit debt"
          >
            <Pencil className="w-4 h-4 text-[var(--color-text-muted)]" />
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
          <div className="flex items-center gap-1.5 text-[var(--color-text-muted)]">
            <DollarSign className="w-4 h-4" />
            <span className="text-xs">Balance</span>
          </div>
          <p className="text-lg font-semibold">${debt.principalBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-[var(--color-text-muted)]">
            <Percent className="w-4 h-4" />
            <span className="text-xs">APR</span>
          </div>
          <p className="text-lg font-semibold">{(debt.apr * 100).toFixed(2)}%</p>
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-[var(--color-text-muted)]">
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
          <div className="flex items-center gap-1.5 text-[var(--color-text-muted)]">
            <TrendingDown className="w-4 h-4" />
            <span className="text-xs">Total Interest</span>
          </div>
          <p className="text-lg font-semibold text-danger-400">
            ${amortization.totalInterest.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      <div className="pt-4 border-t border-[var(--color-border)]">
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-medium">Payment Breakdown</h4>
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: CHART_COLORS.principal }} />
              <span>Principal: ${displayedPrincipal.toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: CHART_COLORS.interest }} />
              <span>Interest: ${displayedInterest.toFixed(2)}</span>
            </div>
          </div>
        </div>
        
        <div className="h-48">
          <ChartSuspense heightClass="h-48">
            <DebtAmortizationChart data={chartData} />
          </ChartSuspense>
        </div>

        <div className="mt-4 p-3 rounded-lg bg-[var(--color-bg-tertiary)] text-sm">
          <div className="flex justify-between">
            <span className="text-[var(--color-text-muted)]">Total Payments ({amortization.monthsToPayoff} months)</span>
            <span className="font-medium">${amortization.totalPayments.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[var(--color-text-muted)]">Amount Over Principal</span>
            <span className="font-medium text-danger-400">
              +${(amortization.totalPayments - amortization.totalPrincipal).toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
});

export default DebtCard;
