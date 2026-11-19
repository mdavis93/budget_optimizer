import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { format, parseISO } from 'date-fns';
import { fromCents, toCents } from '@shared/money';

interface BillPaymentPopoverProps {
  billDate: string;
  seriesAmount: number;
  currentAmount: number;
  anchorRect: DOMRect;
  formatCurrency: (amount: number) => string;
  onSave: (amount: number) => void;
  onClear: () => void;
  onDismiss: () => void;
}

export default function BillPaymentPopover({
  billDate,
  seriesAmount,
  currentAmount,
  anchorRect,
  formatCurrency,
  onSave,
  onClear,
  onDismiss,
}: BillPaymentPopoverProps) {
  const inputId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(String(currentAmount));
  const [floorError, setFloorError] = useState(false);
  const seriesCents = toCents(seriesAmount);
  const isRaised = toCents(currentAmount) > seriesCents;
  const label = `${format(parseISO(billDate), 'MMM d')} only`;

  useEffect(() => {
    const input = panelRef.current?.querySelector('input');
    input?.focus();
    input?.select();
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (panelRef.current?.contains(event.target as Node)) return;
      onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onDismiss();
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [onDismiss]);

  const trySave = () => {
    const parsed = Number.parseFloat(draft);
    if (!Number.isFinite(parsed)) return;
    const cents = toCents(parsed);
    if (cents < seriesCents) {
      setFloorError(true);
      return;
    }
    setFloorError(false);
    if (cents === seriesCents) {
      onClear();
      return;
    }
    onSave(fromCents(cents));
  };

  const top = Math.min(anchorRect.bottom + 8, window.innerHeight - 12);
  const left = Math.min(Math.max(8, anchorRect.left), window.innerWidth - 280);

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`Raise payment for ${label}`}
      className="fixed z-50 w-[260px] rounded-lg border border-(--color-border) bg-(--color-bg-primary) p-3 shadow-lg"
      style={{ top, left }}
    >
      <p className="text-sm font-medium text-(--color-text-primary)">{label}</p>
      <p className="mt-0.5 text-xs text-(--color-text-muted)">
        Series is {formatCurrency(seriesAmount)}
      </p>
      <label htmlFor={inputId} className="mt-2 block text-xs text-(--color-text-muted)">
        Amount
      </label>
      <input
        id={inputId}
        type="number"
        min={0}
        step="0.01"
        className="input mt-0.5 w-full"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setFloorError(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            trySave();
          }
        }}
      />
      {floorError && (
        <p className="mt-1 text-xs text-danger-600 dark:text-danger-400">
          Must be at least {formatCurrency(seriesAmount)}
        </p>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        {isRaised ? (
          <button
            type="button"
            className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
            onClick={onClear}
          >
            Reset
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="btn-primary text-sm" onClick={trySave}>
          Save
        </button>
      </div>
    </div>,
    document.body
  );
}
