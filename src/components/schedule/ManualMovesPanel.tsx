import { useMemo, useState } from 'react';
import { List, RotateCcw } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import clsx from 'clsx';
import type { Bill, BillAssignment } from '../../types';
import ConfirmDialog from '../ConfirmDialog';
import Modal from '../Modal';

interface ManualMovesPanelProps {
  assignments: BillAssignment[];
  bills: Bill[];
  /** Full-horizon paycheck dates (not just the visible viewport). */
  paycheckDates: string[];
  onRestoreBill: (billId: string, billDueDate: string) => void;
  onRestoreAll: () => void;
  onClearStale: (validPaycheckDates: ReadonlySet<string>) => void;
  restoringBill: string | null;
  isRestoringAll: boolean;
  isClearingStale: boolean;
}

function formatDateLabel(date: string): string {
  return format(parseISO(date), 'MMM d, yyyy');
}

function billLabel(billNameById: Map<string, string>, billId: string): string {
  return billNameById.get(billId) ?? 'Deleted bill';
}

export default function ManualMovesPanel({
  assignments,
  bills,
  paycheckDates,
  onRestoreBill,
  onRestoreAll,
  onClearStale,
  restoringBill,
  isRestoringAll,
  isClearingStale,
}: ManualMovesPanelProps) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [confirmRestoreAll, setConfirmRestoreAll] = useState(false);
  const [confirmClearStale, setConfirmClearStale] = useState(false);

  const billNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const bill of bills) {
      map.set(bill.id, bill.creditorName);
    }
    return map;
  }, [bills]);

  const paycheckDateSet = useMemo(() => new Set(paycheckDates), [paycheckDates]);

  const { activeCount, staleCount, sortedAssignments, uniqueBillCount } = useMemo(() => {
    let stale = 0;
    const sorted = [...assignments].sort((a, b) => {
      const nameA = billLabel(billNameById, a.billId);
      const nameB = billLabel(billNameById, b.billId);
      const nameCmp = nameA.localeCompare(nameB);
      if (nameCmp !== 0) return nameCmp;
      return a.billDueDate.localeCompare(b.billDueDate);
    });
    const billIds = new Set<string>();
    for (const assignment of assignments) {
      billIds.add(assignment.billId);
      if (!paycheckDateSet.has(assignment.paycheckDate)) stale += 1;
    }
    return {
      activeCount: assignments.length - stale,
      staleCount: stale,
      sortedAssignments: sorted,
      uniqueBillCount: billIds.size,
    };
  }, [assignments, billNameById, paycheckDateSet]);

  if (assignments.length === 0) return null;

  const busy = isRestoringAll || isClearingStale || restoringBill !== null;
  const summaryParts = [
    `${assignments.length} lock${assignments.length === 1 ? '' : 's'}`,
    `across ${uniqueBillCount} bill${uniqueBillCount === 1 ? '' : 's'}`,
  ];
  if (staleCount > 0) {
    summaryParts.push(`${staleCount} outside the schedule`);
  }

  return (
    <>
      <div
        className="card border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-500/10"
        data-testid="manual-moves-panel"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3 className="font-semibold text-primary-700 dark:text-primary-400">
              Manual Moves
            </h3>
            <p className="mt-0.5 text-sm text-primary-700 dark:text-primary-300" data-testid="manual-moves-summary">
              {summaryParts.join(' · ')}. The scheduler will not re-place locked bills.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {staleCount > 0 && (
              <button
                type="button"
                onClick={() => setConfirmClearStale(true)}
                disabled={busy}
                className="btn-secondary text-sm"
                data-testid="manual-moves-clear-stale"
              >
                {isClearingStale ? 'Clearing…' : `Clear stale (${staleCount})`}
              </button>
            )}
            <button
              type="button"
              onClick={() => setReviewOpen(true)}
              disabled={busy}
              className="btn-secondary text-sm"
              data-testid="manual-moves-review"
            >
              <List className="w-4 h-4 mr-1.5" />
              Review
            </button>
            <button
              type="button"
              onClick={() => setConfirmRestoreAll(true)}
              disabled={busy}
              className="btn-primary text-sm"
              data-testid="manual-moves-restore-all"
            >
              <RotateCcw className={clsx('w-4 h-4 mr-1.5', isRestoringAll && 'animate-spin')} />
              {isRestoringAll ? 'Restoring…' : 'Restore all'}
            </button>
          </div>
        </div>
        {activeCount > 0 && staleCount > 0 && (
          <p className="mt-2 text-xs text-primary-600 dark:text-primary-400">
            {activeCount} active lock{activeCount === 1 ? '' : 's'} still force paycheck placement.
          </p>
        )}
      </div>

      <Modal
        isOpen={reviewOpen}
        onClose={() => setReviewOpen(false)}
        title={`Manual Moves (${assignments.length})`}
        size="lg"
      >
        <div className="space-y-4" data-testid="manual-moves-review-modal">
          <p className="text-sm text-(--color-text-secondary)">
            Restore a lock to let the scheduler place that bill again. Locks outside the current
            schedule are marked stale.
          </p>
          <ul
            className="max-h-[min(24rem,50vh)] overflow-y-auto divide-y divide-(--color-border) border border-(--color-border) rounded-lg"
            data-testid="manual-moves-list"
          >
            {sortedAssignments.map((assignment) => {
              const key = `${assignment.billId}-${assignment.billDueDate}`;
              const isRestoring = restoringBill === key;
              const isStale = !paycheckDateSet.has(assignment.paycheckDate);
              const name = billLabel(billNameById, assignment.billId);

              return (
                <li
                  key={key}
                  className="flex items-center justify-between gap-3 px-3 py-2.5"
                  data-testid={`manual-move-${key}`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-(--color-text-primary) truncate">{name}</span>
                      {isStale && (
                        <span
                          className="text-xs px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100"
                          data-testid={`manual-move-stale-${key}`}
                        >
                          Stale
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-(--color-text-secondary)">
                      Due {formatDateLabel(assignment.billDueDate)}
                      {' · '}
                      Locked to {formatDateLabel(assignment.paycheckDate)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRestoreBill(assignment.billId, assignment.billDueDate)}
                    disabled={busy}
                    className="text-xs font-medium px-2 py-1 rounded-sm bg-primary-500 text-white hover:bg-primary-600 dark:bg-primary-600 dark:hover:bg-primary-500 flex items-center gap-1 shadow-xs shrink-0 disabled:opacity-50"
                    title="Restore to original paycheck"
                    data-testid={`manual-move-restore-${key}`}
                  >
                    <RotateCcw className={clsx('w-3 h-3', isRestoring && 'animate-spin')} />
                    {isRestoring ? 'Restoring…' : 'Restore'}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex justify-end gap-2 pt-1">
            {staleCount > 0 && (
              <button
                type="button"
                onClick={() => setConfirmClearStale(true)}
                disabled={busy}
                className="btn-secondary"
              >
                Clear stale ({staleCount})
              </button>
            )}
            <button
              type="button"
              onClick={() => setConfirmRestoreAll(true)}
              disabled={busy}
              className="btn-primary"
            >
              Restore all
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={confirmRestoreAll}
        onClose={() => setConfirmRestoreAll(false)}
        onConfirm={onRestoreAll}
        title="Restore all manual moves?"
        message={`Remove ${assignments.length} manual lock${assignments.length === 1 ? '' : 's'} so the scheduler can place these bills again.`}
        confirmText="Restore all"
        variant="default"
      />

      <ConfirmDialog
        isOpen={confirmClearStale}
        onClose={() => setConfirmClearStale(false)}
        onConfirm={() => onClearStale(paycheckDateSet)}
        title="Clear stale locks?"
        message={`Remove ${staleCount} lock${staleCount === 1 ? '' : 's'} aimed at paychecks that are not in the current schedule. Active locks stay in place.`}
        confirmText="Clear stale"
        variant="default"
      />
    </>
  );
}
