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
  insufficient_income_this_paycheck: {
    label: 'Income Too Low',
    explanation:
      '{fromPaycheckDate} brings in less than bills, savings minimum, and petty cash require on this paycheck.',
    poolHint: 'This is a true income shortfall — not enough money in this paycheck silo.',
  },
  no_eligible_earlier_paycheck: {
    label: 'No Earlier Paycheck',
    explanation:
      'No earlier paycheck falls within the 14-day prepay window with enough headroom for {billName}.',
    poolHint: 'Moving the bill earlier would pay it too early or still leave a deficit on that paycheck.',
  },
  all_movable_bills_locked: {
    label: 'Bills Locked',
    explanation:
      'Every movable bill on {fromPaycheckDate} is locked or tied to income, so nothing can shift to create room.',
    poolHint: 'Unlock a bill assignment or adjust manual locks to open up moves.',
  },
  goal_reserve_conflict: {
    label: 'Goal Reserve Conflict',
    explanation:
      'Savings goal reserves on {fromPaycheckDate} leave too little room for {billName} after bills and petty cash.',
    poolHint: 'The savings pool is competing with bills on this paycheck — lower a goal target or extend its deadline.',
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
  skip_bill: {
    headline: 'Skip "{billName}"',
    counterfactual:
      'Skip {billName} ({billAmount}) on {fromPaycheckDate} → frees {impactAmount} toward {shortfallPaycheckDate}',
    detail: 'Defers this bill for one cycle when no eligible move exists within prepay rules.',
    ariaMessage:
      'Skip {billName}, {billAmount}, on {fromPaycheckDate} to free {impactAmount} toward the {shortfallPaycheckDate} shortfall.',
  },
} as const;

const SKIP_REASON_DETAIL: Partial<Record<UnfundableReason, string>> = {
  insufficient_income_this_paycheck:
    'Income on {fromPaycheckDate} cannot fund {billName} after higher-priority bills and pool minimums.',
  no_eligible_earlier_paycheck:
    'No earlier paycheck can take {billName} within 14 days of its due date with enough silo headroom.',
  all_movable_bills_locked:
    '{billName} cannot move because other bills on this paycheck are locked or income-attached.',
  goal_reserve_conflict:
    'Goal savings reserves leave no room for {billName} on {fromPaycheckDate} or any eligible earlier paycheck.',
};

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
  let detail = interpolate(template.detail, { ...vars });

  if (fix.type === 'skip_bill' && fix.reasonCode) {
    const reasonDetail = SKIP_REASON_DETAIL[fix.reasonCode];
    if (reasonDetail) {
      detail = interpolate(reasonDetail, { ...vars });
    }
  }

  return {
    headline: interpolate(template.headline, { ...vars }),
    counterfactual: interpolate(template.counterfactual, { ...vars }),
    detail,
    ariaMessage: interpolate(template.ariaMessage, { ...vars }),
  };
}

export function formatShortfallCopy(shortfall: ShortfallDetail): {
  headline: string;
  explanation: string;
  ariaMessage: string;
} {
  const paycheckDate = formatPaycheckDate(shortfall.paycheckDate);
  const deficit = formatMoney(shortfall.deficit);
  const unfundableBills = shortfall.bills.filter((b) => b.isUnpayable && b.unfundableReason);

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
      body: `${count} ${paycheckWord} run short by ${deficit} total. Select the moves and skips below — each fix stays within its paycheck silo.`,
      ariaMessage: `${count} ${paycheckWord} run short by ${deficit} total. Proposed fixes can resolve the shortfalls without crossing paycheck boundaries.`,
    };
  }

  return {
    headline: 'Some shortfalls need manual changes',
    body: `${count} ${paycheckWord} run short by ${deficit} total. Applied fixes may not cover everything — review income, locked bills, or goal targets.`,
    ariaMessage: `${count} ${paycheckWord} run short by ${deficit} total. Automatic fixes may not fully resolve all shortfalls.`,
  };
}
