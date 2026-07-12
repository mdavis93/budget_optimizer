import { Link } from 'react-router-dom';
import { Save, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useDraftStatus, useDraftActions } from '../context/DraftContext';
import { DOMAIN_ROUTES, DRAFT_DOMAIN_LABELS, DraftDomain } from '../types/draft';
import ConfirmDialog from './ConfirmDialog';

export default function GlobalDraftBanner() {
  const { isDraftMode, dirtyDomains, isSaving } = useDraftStatus();
  const { saveAll, discardAll } = useDraftActions();
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  if (!isDraftMode || dirtyDomains.size < 2) {
    return null;
  }

  const domains = Array.from(dirtyDomains) as DraftDomain[];

  return (
    <>
      <div className="mb-4 rounded-lg border border-warning-200 dark:border-warning-800 bg-warning-50 dark:bg-warning-900/20 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-warning-900 dark:text-warning-100">
              {domains.length} pages have unsaved changes
            </p>
            <div className="mt-1 flex flex-wrap gap-2">
              {domains.map((domain) => (
                <Link
                  key={domain}
                  to={DOMAIN_ROUTES[domain]}
                  className="text-xs text-warning-800 dark:text-warning-200 underline underline-offset-2 hover:text-warning-950 dark:hover:text-warning-50"
                >
                  {DRAFT_DOMAIN_LABELS[domain]}
                </Link>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowDiscardConfirm(true)}
              disabled={isSaving}
              className="btn-secondary inline-flex items-center gap-2 text-sm"
            >
              <RotateCcw className="w-4 h-4" />
              Discard All
            </button>
            <button
              type="button"
              onClick={() => saveAll()}
              disabled={isSaving}
              className="btn-primary inline-flex items-center gap-2 text-sm"
            >
              <Save className="w-4 h-4" />
              {isSaving ? 'Saving...' : 'Save All Changes'}
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={showDiscardConfirm}
        onClose={() => setShowDiscardConfirm(false)}
        onConfirm={() => discardAll()}
        title="Discard all changes?"
        message="This will revert all unsaved changes across every page."
        confirmText="Discard All"
        variant="warning"
      />
    </>
  );
}
