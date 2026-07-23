import { format } from 'date-fns';
import type { Leave } from '../database.service';
import type { ProjectedIncome } from './types';

function isOnUnpaidLeave(leave: Leave, sourceId: string, payDate: string): boolean {
  return (
    leave.type === 'unpaid' &&
    leave.incomeId === sourceId &&
    leave.startDate <= payDate &&
    payDate <= leave.endDate
  );
}

/**
 * Apply unpaid leave omission, then explicit income overrides (override wins).
 * Mutates `projected` in place: unpaid-leave events are removed so they do not
 * create empty paycheck slots that distort bill assignment. An override with a
 * positive amount re-inserts/keeps that paycheck during leave.
 */
export function applyProjectedIncomeAdjustments(
  projected: ProjectedIncome[],
  leaves: Leave[] = [],
  overrides: Map<string, number> = new Map()
): void {
  const unpaidLeaves = leaves.filter((leave) => leave.type === 'unpaid');
  const kept: ProjectedIncome[] = [];

  for (const event of projected) {
    const payDate = format(event.date, 'yyyy-MM-dd');
    const onUnpaidLeave = unpaidLeaves.some((leave) =>
      isOnUnpaidLeave(leave, event.sourceId, payDate)
    );
    const key = `${event.sourceId}-${payDate}`;

    if (overrides.has(key)) {
      event.amount = overrides.get(key)!;
      // Zero override during leave still means no paycheck for this source.
      if (onUnpaidLeave && event.amount === 0) {
        continue;
      }
      kept.push(event);
      continue;
    }

    if (onUnpaidLeave) {
      continue;
    }

    kept.push(event);
  }

  projected.length = 0;
  projected.push(...kept);
}
