import { ScheduleData } from '../types';
import { DraftOverlay } from '../types/draft';
import { buildScheduleInputHash } from './scheduleInputHash';

export const SCHEDULE_DEBOUNCE_MS = 400;

export function buildScheduleCacheKey(
  overlay: DraftOverlay | undefined,
  startDate: string,
  months: number,
  startingBalance: number
): string {
  const overlayHash = overlay
    ? buildScheduleInputHash({
        incomes: overlay.incomes ?? [],
        bills: overlay.bills ?? [],
        skippedBills: overlay.skippedBills ?? [],
        billAssignments: overlay.billAssignments ?? [],
        incomeOverrides: overlay.incomeOverrides ?? [],
        leaves: overlay.leaves ?? [],
        budgetFields: {
          name: '',
          startingBalance: overlay.startingBalance ?? 0,
          targetCashOnHand: overlay.targetCashOnHand ?? 0,
          minCashOnHand: overlay.minCashOnHand ?? 0,
          minSavingsPerPaycheck: overlay.minSavingsPerPaycheck ?? 0,
          scheduleStartDate: overlay.scheduleStartDate ?? '',
        },
      })
    : 'none';
  const preferred = (overlay?.preferredAssignments ?? [])
    .map(([billKey, paycheck]) => `${billKey}->${paycheck}`)
    .sort()
    .join('|');
  const goals = (overlay?.goals ?? [])
    .map((goal) => `${goal.id}-${goal.targetAmount}-${goal.targetDate}-${goal.alreadySaved ?? 0}`)
    .sort()
    .join('|');
  const debts = (overlay?.debts ?? [])
    .map((debt) => `${debt.id}-${debt.billId}-${debt.principalBalance}-${debt.apr}-${debt.monthlyPayment}`)
    .sort()
    .join('|');
  return [overlayHash, preferred, goals, debts, startDate, String(months), String(startingBalance)].join('::');
}

export interface ScheduleCacheEntry {
  hash: string;
  data: ScheduleData;
}
