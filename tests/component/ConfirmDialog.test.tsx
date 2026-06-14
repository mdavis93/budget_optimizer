import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ConfirmDialog from '../../src/components/ConfirmDialog';

describe('ConfirmDialog', () => {
  describe('happy', () => {
    it('confirms and closes when confirm button is clicked', () => {
      const onConfirm = vi.fn();
      const onClose = vi.fn();

      render(
        <ConfirmDialog
          isOpen
          onClose={onClose}
          onConfirm={onConfirm}
          title="Delete item"
          message="Confirm deletion"
          confirmText="Delete"
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('sad', () => {
    it('closes without confirming on cancel', () => {
      const onConfirm = vi.fn();
      const onClose = vi.fn();

      render(
        <ConfirmDialog
          isOpen
          onClose={onClose}
          onConfirm={onConfirm}
          title="Leave page"
          message="Unsaved changes"
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onConfirm).not.toHaveBeenCalled();
    });
  });

  describe('hostile', () => {
    it('does not render when dialog is closed', () => {
      render(
        <ConfirmDialog
          isOpen={false}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          title="Hidden"
          message="Hidden"
        />
      );
      expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
    });
  });
});
