import { format, parseISO } from 'date-fns';
import { ProposedFix, ShortfallDetail, UnfundableReason } from '../types';

export type { UnfundableReason };

export interface ReconciliationCopyVars {
  billName: string;
  billAmount: string;
  fromPaycheckDate: string;
  toPaycheckDate: string;
  shortfallPaycheckDate: string;
  deficitAmount: string;
  impactAmount: string;
}

export interface UnfundableReasonCopyEntry {
  label: string;
  explanation: string;
  poolHint: string;
}

export const UNFUNDABLE_REASON_COPY: Record<UnfundableReason, UnfundableReasonCopyEntry> = {
  insufficient_income_in_window: {
    label: 'Income Too Low',
    explanation:
      'No paycheck in the eligibility window for {billName} has enough income to fund it alongside other bills.',
    poolHint: 'This is a true income shortfall — not enough money in the schedule window for this obligation.',
  },
  no_eligible_paycheck_in_window: {
    label: 'No Eligible Paycheck',
    explanation:
      'No paycheck falls within the 14-day window on or before {billName}\'s due date.',
    poolHint: 'Add income near the due date or adjust the bill due date.',
  },
  all_movable_bills_locked: {
    label: 'Bills Locked',
    explanation:
      'Every movable bill on {fromPaycheckDate} is locked or tied to income, so nothing can shift to create room.',
    poolHint: 'Unlock a bill assignment or adjust manual locks to open up moves.',
  },
};

export interface FixCopyEntry {
  headline: string;
  counterfactual: string;
  detail: string;
  ariaMessage: string;
}

const FIX_COPY = {
  move_bill: {
    headline: 'Move "{billName}"',
    counterfactual:
      'Move {billName} ({billAmount}) to {toPaycheckDate} → clears {shortfallPaycheckDate} shortfall',
    detail: 'Frees {impactAmount} on {fromPaycheckDate} by paying {billName} from an earlier paycheck with surplus.',
    ariaMessage:
      'Move {billName}, {billAmount}, to {toPaycheckDate} paycheck to clear the {shortfallPaycheckDate} shortfall of {deficitAmount}.',
  },
} as const;

function formatMoney(amount: number): string {
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function formatPaycheckDate(dateStr: string): string {
  return format(parseISO(dateStr), 'MMM d');
}

function interpolate(template: string, vars: Record<string, string | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '');
}

function buildCopyVars(
  fix: ProposedFix,
  deficitAmount?: number
): ReconciliationCopyVars {
  return {
    billName: fix.billName,
    billAmount: formatMoney(fix.billAmount),
    fromPaycheckDate: formatPaycheckDate(fix.fromPaycheckDate),
    toPaycheckDate: fix.toPaycheckDate ? formatPaycheckDate(fix.toPaycheckDate) : '',
    shortfallPaycheckDate: formatPaycheckDate(fix.fromPaycheckDate),
    deficitAmount: formatMoney(deficitAmount ?? fix.impact),
    impactAmount: formatMoney(fix.impact),
  };
}

export function formatUnfundableReasonCopy(
  reason: UnfundableReason,
  vars: Pick<ReconciliationCopyVars, 'billName' | 'fromPaycheckDate'>
): UnfundableReasonCopyEntry & { ariaMessage: string } {
  const entry = UNFUNDABLE_REASON_COPY[reason];
  const merged = {
    billName: vars.billName,
    fromPaycheckDate: vars.fromPaycheckDate,
  };
  return {
    label: entry.label,
    explanation: interpolate(entry.explanation, merged),
    poolHint: entry.poolHint,
    ariaMessage: `${entry.label}. ${interpolate(entry.explanation, merged)} ${entry.poolHint}`,
  };
}

export function formatProposedFixCopy(
  fix: ProposedFix,
  options?: { deficitAmount?: number }
): FixCopyEntry {
  const vars = buildCopyVars(fix, options?.deficitAmount);
  const template = FIX_COPY[fix.type];
  const detail = interpolate(template.detail, { ...vars });

  return {
    headline: interpolate(template.headline, { ...vars }),
    counterfactual: interpolate(template.counterfactual, { ...vars }),
    detail,
    ariaMessage: interpolate(template.ariaMessage, { ...vars }),
  };
}

export function formatShortfallCopy(
  shortfall: ShortfallDetail,
  options?: { minCashOnHand?: number }
): {
  headline: string;
  explanation: string;
  ariaMessage: string;
} {
  const paycheckDate = formatPaycheckDate(shortfall.paycheckDate);
  const deficit = formatMoney(shortfall.deficit);
  const unfundableBills = shortfall.bills.filter((b) => b.isUnpayable && b.unfundableReason);
  const minCashOnHand = options?.minCashOnHand ?? 100;
  const cashOnHand = shortfall.budgetRemaining;

  if (unfundableBills.length > 0) {
    const dominant = unfundableBills[0]!;
    const reasonCopy = formatUnfundableReasonCopy(dominant.unfundableReason!, {
      billName: dominant.creditorName,
      fromPaycheckDate: paycheckDate,
    });
    return {
      headline: `${paycheckDate} shortfall: ${deficit}`,
      explanation: reasonCopy.explanation,
      ariaMessage: `${paycheckDate} paycheck short by ${deficit}. ${reasonCopy.ariaMessage}`,
    };
  }

  // Covered bills but ended below the min cash floor — not "income exceeded."
  if (cashOnHand >= 0) {
    const cashLabel = formatMoney(cashOnHand);
    const minLabel = formatMoney(minCashOnHand);
    return {
      headline: `${paycheckDate} shortfall: ${deficit}`,
      explanation: `Bills on ${paycheckDate} reduce cash on-hand to ${cashLabel}, which is below the ${minLabel} minimum.`,
      ariaMessage: `${paycheckDate} paycheck ends at ${cashLabel}, below the ${minLabel} minimum cash on hand.`,
    };
  }

  return {
    headline: `${paycheckDate} shortfall: ${deficit}`,
    explanation: `Bills on ${paycheckDate} exceed this paycheck's income after savings and petty cash reserves.`,
    ariaMessage: `${paycheckDate} paycheck short by ${deficit}. Bills exceed income after pool minimums.`,
  };
}

export function formatReconciliationSummary(report: {
  shortfalls: ShortfallDetail[];
  totalDeficit: number;
  canBeFullyResolved: boolean;
}): { headline: string; body: string; ariaMessage: string } {
  const count = report.shortfalls.length;
  const deficit = formatMoney(report.totalDeficit);
  const paycheckWord = count === 1 ? 'paycheck' : 'paychecks';

  if (report.canBeFullyResolved) {
    return {
      headline: 'We found fixes for your shortfalls',
      body: `${count} ${paycheckWord} run short by ${deficit} total. Select the moves below — each fix stays within its paycheck silo.`,
      ariaMessage: `${count} ${paycheckWord} run short by ${deficit} total. Proposed fixes can resolve the shortfalls without crossing paycheck boundaries.`,
    };
  }

  return {
    headline: 'Some shortfalls need manual changes',
    body: `${count} ${paycheckWord} run short by ${deficit} total. Applied fixes may not cover everything — review income, locked bills, or goal targets.`,
    ariaMessage: `${count} ${paycheckWord} run short by ${deficit} total. Automatic fixes may not fully resolve all shortfalls.`,
  };
}
