import { useCallback, useState, useEffect } from 'react';
import { useDraftOptional } from '../context/DraftContext';
import UnsavedChangesModal from '../components/UnsavedChangesModal';

interface PendingAction {
  label: string;
  action: () => void | Promise<void>;
}

interface UseUnsavedChangesGuardOptions {
  listenForWindowClose?: boolean;
}

export function useUnsavedChangesGuard(options?: UseUnsavedChangesGuardOptions) {
  const draft = useDraftOptional();
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const guardAction = useCallback(
    (action: () => void | Promise<void>, label = 'continue') => {
      if (draft?.hasUnsavedChanges) {
        setPendingAction({ label, action });
        return false;
      }
      void action();
      return true;
    },
    [draft?.hasUnsavedChanges]
  );

  useEffect(() => {
    if (!options?.listenForWindowClose || !window.electronAPI?.onCloseRequested) {
      return;
    }

    return window.electronAPI.onCloseRequested(() => {
      guardAction(() => window.electronAPI.quitApp(), 'close the app');
    });
  }, [guardAction, options?.listenForWindowClose]);

  const handleSaveAndContinue = useCallback(async () => {
    if (!pendingAction || !draft) return;
    const success = await draft.saveAll();
    if (success) {
      await pendingAction.action();
      setPendingAction(null);
    }
  }, [pendingAction, draft]);

  const handleDiscardAndContinue = useCallback(async () => {
    if (!pendingAction || !draft) return;
    draft.discardAll();
    await pendingAction.action();
    setPendingAction(null);
  }, [pendingAction, draft]);

  const unsavedDialog = (
    <UnsavedChangesModal
      isOpen={pendingAction !== null}
      onClose={() => setPendingAction(null)}
      onSaveAll={() => void handleSaveAndContinue()}
      onDiscardAll={() => void handleDiscardAndContinue()}
      actionLabel={pendingAction?.label}
      isSaving={draft?.isSaving}
    />
  );

  return { guardAction, unsavedDialog };
}
