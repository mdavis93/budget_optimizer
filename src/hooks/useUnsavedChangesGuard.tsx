import { useCallback, useState, MouseEvent } from 'react';
import { useDraftOptional } from '../context/DraftContext';
import UnsavedChangesModal from '../components/UnsavedChangesModal';

interface PendingAction {
  label: string;
  action: () => void | Promise<void>;
}

export function useUnsavedChangesGuard() {
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

  const guardNavigate = useCallback(
    (
      event: MouseEvent<HTMLAnchorElement>,
      navigate: () => void,
      label = 'leave this page'
    ) => {
      if (!draft?.hasUnsavedChanges) {
        return;
      }
      event.preventDefault();
      guardAction(navigate, label);
    },
    [draft?.hasUnsavedChanges, guardAction]
  );

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

  return { guardAction, guardNavigate, unsavedDialog };
}
