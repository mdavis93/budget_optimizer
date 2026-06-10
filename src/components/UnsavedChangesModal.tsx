import Modal from './Modal';

interface UnsavedChangesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveAll: () => void;
  onDiscardAll: () => void;
  actionLabel?: string;
  isSaving?: boolean;
}

export default function UnsavedChangesModal({
  isOpen,
  onClose,
  onSaveAll,
  onDiscardAll,
  actionLabel = 'continue',
  isSaving = false,
}: UnsavedChangesModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Unsaved changes" size="sm">
      <div className="space-y-6">
        <p className="text-[var(--color-text-secondary)]">
          You have unsaved budget changes. Save them before you {actionLabel}, or discard to proceed without saving.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button onClick={onClose} className="btn-secondary" disabled={isSaving}>
            Cancel
          </button>
          <button onClick={onDiscardAll} className="btn-secondary" disabled={isSaving}>
            Discard All
          </button>
          <button onClick={onSaveAll} className="btn-primary" disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save All Changes'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
