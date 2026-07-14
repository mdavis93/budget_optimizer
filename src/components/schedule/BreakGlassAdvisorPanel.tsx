import { AlertTriangle, ArrowRight, Check, Loader2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import type { BreakGlassPlan, BreakGlassPlanStep } from '../../types';
import { formatCurrency } from '../../utils/formatCurrency';

interface BreakGlassAdvisorPanelProps {
  plans: BreakGlassPlan[];
  onAccept: (plan: BreakGlassPlan) => Promise<void> | void;
  onDecline: (planId: string) => void;
  isApplying: boolean;
}

function formatPaycheckLabel(date: string): string {
  // Include year — schedule horizon spans calendar years; MMM d alone made
  // Jan 2027 look like it belonged under a Jul 2026 Break-Glass plan.
  return format(parseISO(date), 'MMM d, yyyy');
}

/** Names that appear with more than one distinct due date on this card. */
function billNamesNeedingDueDate(steps: BreakGlassPlanStep[]): Set<string> {
  const duesByName = new Map<string, Set<string>>();
  for (const step of steps) {
    const dues = duesByName.get(step.billName) ?? new Set<string>();
    dues.add(step.billDueDate);
    duesByName.set(step.billName, dues);
  }
  const ambiguous = new Set<string>();
  for (const [name, dues] of duesByName) {
    if (dues.size > 1) ambiguous.add(name);
  }
  return ambiguous;
}

export default function BreakGlassAdvisorPanel({
  plans,
  onAccept,
  onDecline,
  isApplying,
}: BreakGlassAdvisorPanelProps) {
  if (plans.length === 0 && !isApplying) return null;

  return (
    <div className="space-y-4" data-testid="break-glass-advisor">
      {isApplying && (
        <div
          className="rounded-xl border border-warning-300 dark:border-warning-700 bg-warning-50 dark:bg-warning-900/30 p-5 flex items-center gap-3"
          role="status"
          aria-live="polite"
          data-testid="break-glass-applying"
        >
          <Loader2 className="w-5 h-5 text-warning-600 dark:text-warning-400 animate-spin shrink-0" />
          <div>
            <p className="font-medium text-warning-900 dark:text-warning-100">
              Applying Break-Glass adjustments…
            </p>
            <p className="text-sm text-warning-800 dark:text-warning-200">
              Rebuilding the schedule. This can take a few seconds.
            </p>
          </div>
        </div>
      )}

      {plans.map((plan) => {
        const showDueFor = billNamesNeedingDueDate(plan.steps);
        return (
          <div
            key={plan.id}
            className="rounded-xl border border-warning-300 dark:border-warning-700 bg-warning-50 dark:bg-warning-900/30 p-5"
            data-testid={`break-glass-plan-${plan.id}`}
          >
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-full bg-warning-100 dark:bg-warning-800">
                <AlertTriangle className="w-5 h-5 text-warning-600 dark:text-warning-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-warning-900 dark:text-warning-100">
                  {plan.headline}
                </h3>
                <p className="mt-1 text-sm text-warning-800 dark:text-warning-200">
                  You can avoid Break-Glass on {formatPaycheckLabel(plan.targetPaycheckDate)} by
                  making these adjustments:
                </p>

                <ul className="mt-3 space-y-2">
                  {plan.steps.map((step, stepIndex) => (
                    <li
                      key={`${step.billId}-${step.billDueDate}-${step.fromPaycheckDate}-${step.toPaycheckDate}-${stepIndex}`}
                      className="flex flex-wrap items-center gap-2 text-sm text-(--color-text-primary)"
                    >
                      <span className="font-medium">{step.billName}</span>
                      <span className="text-(--color-text-secondary)">
                        ({formatCurrency(step.billAmount)}
                        {showDueFor.has(step.billName)
                          ? ` · due ${formatPaycheckLabel(step.billDueDate)}`
                          : ''}
                        )
                      </span>
                      <span className="inline-flex items-center gap-1 text-(--color-text-secondary)">
                        {formatPaycheckLabel(step.fromPaycheckDate)}
                        <ArrowRight className="w-3.5 h-3.5" />
                        {formatPaycheckLabel(step.toPaycheckDate)}
                      </span>
                      <span className="text-(--color-text-secondary)">
                        · {step.daysEarly} day{step.daysEarly === 1 ? '' : 's'} early
                        {step.requiresConfirmation ? ' (needs confirmation)' : ''}
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={isApplying}
                    onClick={() => void onAccept(plan)}
                  >
                    <Check className="w-4 h-4 mr-1.5" />
                    Accept adjustments
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={isApplying}
                    onClick={() => onDecline(plan.id)}
                  >
                    Decline
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
