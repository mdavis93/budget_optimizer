import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Wallet } from 'lucide-react';
import EmptyState from '../../src/components/EmptyState';

describe('EmptyState', () => {
  describe('happy', () => {
    it('renders message and action button', () => {
      const onClick = vi.fn();
      render(
        <EmptyState
          icon={Wallet}
          title="No data"
          description="Create your first item."
          action={{ label: 'Add Item', onClick }}
        />
      );

      expect(screen.getByText('No data')).toBeInTheDocument();
      expect(screen.getByText('Create your first item.')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Add Item' }));
      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('sad', () => {
    it('renders no action button when action is absent', () => {
      render(<EmptyState icon={Wallet} title="Nothing here" description="No records found." />);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });

  describe('hostile', () => {
    it('keeps rendering message under repeated interactions', () => {
      const onClick = vi.fn();
      render(
        <EmptyState
          icon={Wallet}
          title="No records"
          description="Still empty."
          action={{ label: 'Retry', onClick }}
        />
      );

      const button = screen.getByRole('button', { name: 'Retry' });
      fireEvent.click(button);
      fireEvent.click(button);
      expect(onClick).toHaveBeenCalledTimes(2);
      expect(screen.getByText('Still empty.')).toBeInTheDocument();
    });
  });
});
