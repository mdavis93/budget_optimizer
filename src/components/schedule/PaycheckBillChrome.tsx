import { RotateCcw, SkipForward, Undo2 } from 'lucide-react';

export function PaycheckBillSkippedWatermark() {
  return (
    <>
      <span
        aria-hidden="true"
        className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg bg-slate-500 dark:bg-slate-400"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            'repeating-linear-gradient(-45deg, transparent, transparent 6px, currentColor 6px, currentColor 7px)',
          color: 'var(--color-text-muted)',
        }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex items-center justify-center select-none"
      >
        <span className="text-2xl font-black tracking-[0.2em] text-slate-600 dark:text-slate-300 opacity-35 -rotate-12">
          SKIPPED
        </span>
      </span>
    </>
  );
}

export function PaycheckBillActions({
  billId,
  billDate,
  isSkipped,
  isManuallyAssigned,
  isSkipping,
  isUnskipping,
  isRestoring,
  onSkipBill,
  onUnskipBill,
  onRestoreBill,
}: {
  billId: string;
  billDate: string;
  isSkipped: boolean;
  isManuallyAssigned: boolean;
  isSkipping: boolean;
  isUnskipping: boolean;
  isRestoring: boolean;
  onSkipBill: (billId: string, billDate: string) => void;
  onUnskipBill: (billId: string, billDate: string) => void;
  onRestoreBill: (billId: string, billDueDate: string) => void;
}) {
  return (
    <>
      {isManuallyAssigned && !isSkipped && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRestoreBill(billId, billDate);
          }}
          disabled={isRestoring}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-xs font-medium px-2 py-1 rounded-sm bg-primary-500 text-white hover:bg-primary-600 dark:bg-primary-600 dark:text-white dark:hover:bg-primary-500 flex items-center gap-1 shadow-xs"
          title="Restore to original paycheck"
        >
          <RotateCcw className="w-3 h-3" />
          {isRestoring ? 'Restoring...' : 'Restore'}
        </button>
      )}
      {isSkipped ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onUnskipBill(billId, billDate);
          }}
          disabled={isUnskipping}
          className="opacity-100 group-hover:opacity-100 transition-opacity text-xs font-medium px-2 py-1 rounded-sm bg-primary-500 text-white hover:bg-primary-600 dark:bg-primary-600 dark:text-white dark:hover:bg-primary-500 flex items-center gap-1 shadow-xs"
          title="Include this payment in the schedule again"
        >
          <Undo2 className="w-3 h-3" />
          {isUnskipping ? 'Unskipping...' : 'Unskip'}
        </button>
      ) : (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSkipBill(billId, billDate);
          }}
          disabled={isSkipping}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-xs font-medium px-2 py-1 rounded-sm bg-amber-500 text-white hover:bg-amber-600 dark:bg-amber-600 dark:text-white dark:hover:bg-amber-500 flex items-center gap-1 shadow-xs"
          title="Skip this payment (already paid or not due)"
        >
          <SkipForward className="w-3 h-3" />
          {isSkipping ? 'Skipping...' : 'Skip'}
        </button>
      )}
    </>
  );
}
