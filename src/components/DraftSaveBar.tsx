import { Save, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { DraftDomain, DRAFT_DOMAIN_LABELS } from '../types/draft';
import { useDraftActions, useDraftData, useDraftStatus } from '../context/DraftContext';
import { getCrossDomainSaveWarning } from '../utils/draftPersist';
import ConfirmDialog from './ConfirmDialog';

const DEFAULT_TOAST_BOTTOM = '1rem';

interface DraftSaveBarProps {
  domain: DraftDomain;
}

export default function DraftSaveBar({ domain }: DraftSaveBarProps) {
  const { draft } = useDraftData();
  const { dirtyDomains, isDraftMode, isDomainDirty, isSaving } = useDraftStatus();
  const { saveDomains, discardDomain } = useDraftActions();
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [saveConfirm, setSaveConfirm] = useState<{ domains: DraftDomain[]; message: string } | null>(
    null
  );
  const footerRef = useRef<HTMLDivElement>(null);
  const isVisible = isDraftMode && isDomainDirty(domain);

  // Keep toasts above this layout footer so they never cover Save/Discard.
  useEffect(() => {
    const root = document.documentElement;
    if (!isVisible) {
      root.style.setProperty('--app-toast-bottom', DEFAULT_TOAST_BOTTOM);
      return;
    }

    const footer = footerRef.current;
    if (!footer) {
      return;
    }

    const syncToastOffset = () => {
      const height = footer.getBoundingClientRect().height;
      root.style.setProperty('--app-toast-bottom', `${Math.ceil(height) + 16}px`);
    };

    syncToastOffset();
    const observer = new ResizeObserver(syncToastOffset);
    observer.observe(footer);

    return () => {
      observer.disconnect();
      root.style.setProperty('--app-toast-bottom', DEFAULT_TOAST_BOTTOM);
    };
  }, [isVisible]);

  if (!isVisible) {
    return null;
  }

  const handleSaveClick = () => {
    const warning = getCrossDomainSaveWarning(domain, draft, dirtyDomains);
    if (warning) {
      setSaveConfirm(warning);
      return;
    }
    void saveDomains([domain]);
  };

  return (
    <>
      <footer
        ref={footerRef}
        data-testid="draft-save-footer"
        aria-label="Unsaved draft actions"
        className="shrink-0 border-t border-warning-200 dark:border-warning-800 bg-warning-50 dark:bg-warning-950 px-6 py-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-warning-800 dark:text-warning-200">
            Unsaved changes on {DRAFT_DOMAIN_LABELS[domain]}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowDiscardConfirm(true)}
              disabled={isSaving}
              className="btn-secondary inline-flex items-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Discard
            </button>
            <button
              type="button"
              onClick={handleSaveClick}
              disabled={isSaving}
              className="btn-primary inline-flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </footer>

      <ConfirmDialog
        isOpen={showDiscardConfirm}
        onClose={() => setShowDiscardConfirm(false)}
        onConfirm={() => discardDomain(domain)}
        title="Discard changes?"
        message={`This will revert unsaved ${DRAFT_DOMAIN_LABELS[domain].toLowerCase()} changes.`}
        confirmText="Discard"
        variant="warning"
      />

      <ConfirmDialog
        isOpen={saveConfirm !== null}
        onClose={() => setSaveConfirm(null)}
        onConfirm={() => {
          if (saveConfirm) {
            void saveDomains(saveConfirm.domains);
          }
          setSaveConfirm(null);
        }}
        title="Save related changes?"
        message={saveConfirm?.message ?? ''}
        confirmText="Save"
        variant="warning"
      />
    </>
  );
}
