import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import UnsavedChangesModal from '../../src/components/UnsavedChangesModal';

describe('UnsavedChangesModal', () => {
  describe('happy', () => {
    it('renders action label and invokes callbacks', () => {
      const onClose = vi.fn();
      const onSaveAll = vi.fn();
      const onDiscardAll = vi.fn();

      render(
        <UnsavedChangesModal
          isOpen
          onClose={onClose}
          onSaveAll={onSaveAll}
          onDiscardAll={onDiscardAll}
          actionLabel="leave this page"
        />
      );

      expect(screen.getByText(/before you leave this page/i)).toBeInTheDocument();
      fireEvent.click(screen.getByText('Cancel'));
      fireEvent.click(screen.getByText('Discard All'));
      fireEvent.click(screen.getByText('Save All Changes'));

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onDiscardAll).toHaveBeenCalledTimes(1);
      expect(onSaveAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('sad', () => {
    it('disables actions and shows saving label while isSaving', () => {
      render(
        <UnsavedChangesModal
          isOpen
          onClose={vi.fn()}
          onSaveAll={vi.fn()}
          onDiscardAll={vi.fn()}
          isSaving
        />
      );

      expect(screen.getByText('Saving...')).toBeInTheDocument();
      expect(screen.getByText('Cancel')).toBeDisabled();
      expect(screen.getByText('Discard All')).toBeDisabled();
      expect(screen.getByText('Saving...')).toBeDisabled();
    });
  });
});
