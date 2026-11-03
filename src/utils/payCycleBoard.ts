import { dayNumberOfIsoDate } from '@shared/billEligibility';
import { isOperatingPaycheck } from '@shared/incomePurpose';
import type { PaycheckBill, PaycheckEntry } from '@shared/types';

export type PayCycleChipCoverage = 'highlighted' | 'other';

export interface PayCycleChip {
  billId: string;
  creditorName: string;
  amount: number;
  billDate: string;
  paidByPaycheckDate: string;
  coverage: PayCycleChipCoverage;
  isUnpayable: boolean;
}

export interface PayCycleDay {
  isoDate: string;
  inPeriod: boolean;
  isPayday: boolean;
  depositAmount: number | null;
  bills: PayCycleChip[];
}

export interface PayCycleBoardModel {
  paydayIso: string;
  periodEndIso: string | null;
  periodEndAvailable: boolean;
  visibleStartIso: string;
  visibleEndIso: string;
  totalIncome: number;
  totalBills: number;
  totalGoalDeposits: number;
  savingsDeposit: number;
  budgetRemaining: number;
  isShortfall: boolean;
  days: PayCycleDay[];
  dueAfterPeriod: PayCycleChip[];
  dueEarlierThisPeriod: PayCycleChip[];
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function isoFromParts(year: number, monthIndex: number, day: number): string {
  const date = new Date(year, monthIndex, day);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function partsFromIso(isoDate: string): { year: number; monthIndex: number; day: number } {
  const [year, month, day] = isoDate.slice(0, 10).split('-').map(Number);
  return { year, monthIndex: month - 1, day };
}

function addCalendarDays(isoDate: string, deltaDays: number): string {
  const { year, monthIndex, day } = partsFromIso(isoDate);
  return isoFromParts(year, monthIndex, day + deltaDays);
}

function sundayOnOrBefore(isoDate: string): string {
  const { year, monthIndex, day } = partsFromIso(isoDate);
  const date = new Date(year, monthIndex, day);
  return isoFromParts(year, monthIndex, day - date.getDay());
}

function saturdayOnOrAfter(isoDate: string): string {
  const { year, monthIndex, day } = partsFromIso(isoDate);
  const date = new Date(year, monthIndex, day);
  return isoFromParts(year, monthIndex, day + (6 - date.getDay()));
}

function compareIso(left: string, right: string): number {
  return dayNumberOfIsoDate(left) - dayNumberOfIsoDate(right);
}

function eachIsoDay(startIso: string, endIso: string): string[] {
  const days: string[] = [];
  let cursor = startIso;
  while (compareIso(cursor, endIso) <= 0) {
    days.push(cursor);
    cursor = addCalendarDays(cursor, 1);
  }
  return days;
}

function toChip(
  bill: PaycheckBill,
  paidByPaycheckDate: string,
  highlightedPayday: string
): PayCycleChip {
  return {
    billId: bill.billId,
    creditorName: bill.creditorName,
    amount: bill.amount,
    billDate: bill.billDate,
    paidByPaycheckDate,
    coverage: paidByPaycheckDate === highlightedPayday ? 'highlighted' : 'other',
    isUnpayable: Boolean(bill.isUnpayable),
  };
}

function selectHighlightedPaycheck(
  operating: PaycheckEntry[],
  todayIso: string
): { paycheck: PaycheckEntry; periodEndIso: string | null } | null {
  for (let index = 0; index < operating.length; index += 1) {
    const paycheck = operating[index];
    const next = operating[index + 1];
    const periodEndIso = next ? addCalendarDays(next.date, -1) : null;
    const containsToday =
      compareIso(paycheck.date, todayIso) <= 0 &&
      (periodEndIso == null || compareIso(todayIso, periodEndIso) <= 0);

    if (containsToday) {
      return { paycheck, periodEndIso };
    }
  }

  const upcoming = operating.find((paycheck) => compareIso(paycheck.date, todayIso) >= 0);
  if (!upcoming) {
    return null;
  }

  const upcomingIndex = operating.findIndex((paycheck) => paycheck.date === upcoming.date);
  const next = operating[upcomingIndex + 1];
  return {
    paycheck: upcoming,
    periodEndIso: next ? addCalendarDays(next.date, -1) : null,
  };
}

export function buildPayCycleBoard(
  paychecks: readonly PaycheckEntry[],
  todayIso: string
): PayCycleBoardModel | null {
  const operating = paychecks.filter((paycheck) => isOperatingPaycheck(paycheck));
  const selected = selectHighlightedPaycheck(operating, todayIso);
  if (!selected) {
    return null;
  }

  const { paycheck, periodEndIso } = selected;
  const periodEndAvailable = periodEndIso != null;
  const visibleStartIso = sundayOnOrBefore(todayIso);
  const visibleEndIso = periodEndAvailable
    ? periodEndIso!
    : saturdayOnOrAfter(paycheck.date);

  const chipsByDueDate = new Map<string, PayCycleChip[]>();
  const dueAfterPeriod: PayCycleChip[] = [];
  const dueEarlierThisPeriod: PayCycleChip[] = [];

  for (const entry of operating) {
    for (const bill of entry.bills) {
      if (bill.isSkipped) {
        continue;
      }

      const chip = toChip(bill, entry.date, paycheck.date);
      const dueDate = bill.billDate;

      if (entry.date === paycheck.date) {
        if (periodEndAvailable && compareIso(dueDate, periodEndIso!) > 0) {
          dueAfterPeriod.push(chip);
          continue;
        }
        if (!periodEndAvailable && compareIso(dueDate, visibleEndIso) > 0) {
          dueAfterPeriod.push(chip);
          continue;
        }
        if (
          compareIso(dueDate, paycheck.date) >= 0 &&
          compareIso(dueDate, visibleStartIso) < 0 &&
          (periodEndIso == null || compareIso(dueDate, periodEndIso) <= 0)
        ) {
          dueEarlierThisPeriod.push(chip);
          continue;
        }
      }

      if (compareIso(dueDate, visibleStartIso) < 0 || compareIso(dueDate, visibleEndIso) > 0) {
        continue;
      }

      const existing = chipsByDueDate.get(dueDate) ?? [];
      existing.push(chip);
      chipsByDueDate.set(dueDate, existing);
    }
  }

  const periodStart = paycheck.date;
  const days: PayCycleDay[] = eachIsoDay(visibleStartIso, visibleEndIso).map((isoDate) => {
    const isPayday = isoDate === paycheck.date;
    const inPeriod =
      compareIso(isoDate, periodStart) >= 0 &&
      (periodEndAvailable
        ? compareIso(isoDate, periodEndIso!) <= 0
        : compareIso(isoDate, visibleEndIso) <= 0);
    return {
      isoDate,
      inPeriod,
      isPayday,
      depositAmount: isPayday ? paycheck.totalIncome : null,
      bills: chipsByDueDate.get(isoDate) ?? [],
    };
  });

  return {
    paydayIso: paycheck.date,
    periodEndIso,
    periodEndAvailable,
    visibleStartIso,
    visibleEndIso,
    totalIncome: paycheck.totalIncome,
    totalBills: paycheck.totalBills,
    totalGoalDeposits: paycheck.totalGoalDeposits,
    savingsDeposit: paycheck.savingsDeposit,
    budgetRemaining: paycheck.budgetRemaining,
    isShortfall: paycheck.isShortfall,
    days,
    dueAfterPeriod,
    dueEarlierThisPeriod,
  };
}
