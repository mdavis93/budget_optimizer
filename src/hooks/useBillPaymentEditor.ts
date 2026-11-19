import { useCallback, useState } from 'react';
import { billPaymentEditorKey } from '../utils/billPaymentRaised';

export function useBillPaymentEditor(handlers: {
  onSave: (billId: string, billDate: string, amount: number) => Promise<void>;
  onClear: (billId: string, billDate: string) => Promise<void>;
}) {
  const [openPaymentKey, setOpenPaymentKey] = useState<string | null>(null);
  const { onSave, onClear } = handlers;

  const closePaymentEditor = useCallback(() => {
    setOpenPaymentKey(null);
  }, []);

  const openPaymentEditor = useCallback((billId: string, billDate: string) => {
    setOpenPaymentKey(billPaymentEditorKey(billId, billDate));
  }, []);

  const handleSavePaymentOverride = useCallback(
    async (billId: string, billDate: string, amount: number) => {
      setOpenPaymentKey(null);
      await onSave(billId, billDate, amount);
    },
    [onSave]
  );

  const handleClearPaymentOverride = useCallback(
    async (billId: string, billDate: string) => {
      setOpenPaymentKey(null);
      await onClear(billId, billDate);
    },
    [onClear]
  );

  return {
    openPaymentKey,
    openPaymentEditor,
    closePaymentEditor,
    handleSavePaymentOverride,
    handleClearPaymentOverride,
  };
}
