import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Modal from '../../src/components/Modal';

describe('Modal', () => {
  it('renders children when open', () => {
    render(
      <Modal isOpen={true} onClose={() => {}} title="Test Modal">
        <p>Modal content</p>
      </Modal>
    );
    
    expect(screen.getByText('Modal content')).toBeInTheDocument();
    expect(screen.getByText('Test Modal')).toBeInTheDocument();
  });

  it('does not render children when closed', () => {
    render(
      <Modal isOpen={false} onClose={() => {}} title="Test Modal">
        <p>Modal content</p>
      </Modal>
    );
    
    expect(screen.queryByText('Modal content')).not.toBeInTheDocument();
  });

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={onClose} title="Test Modal">
        <p>Modal content</p>
      </Modal>
    );
    
    const closeButton = screen.getByLabelText('Close dialog');
    fireEvent.click(closeButton);
    
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when escape key pressed', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={onClose} title="Test Modal">
        <p>Modal content</p>
      </Modal>
    );
    
    fireEvent.keyDown(document, { key: 'Escape' });
    
    expect(onClose).toHaveBeenCalled();
  });

  it('displays the title', () => {
    render(
      <Modal isOpen={true} onClose={() => {}} title="My Custom Title">
        <p>Content</p>
      </Modal>
    );
    
    expect(screen.getByText('My Custom Title')).toBeInTheDocument();
  });

  it('renders size variants', () => {
    const { rerender } = render(
      <Modal isOpen={true} onClose={() => {}} title="Small" size="sm">
        <p>Content</p>
      </Modal>
    );
    expect(screen.getByRole('dialog').className).toContain('max-w-sm');

    rerender(
      <Modal isOpen={true} onClose={() => {}} title="Large" size="lg">
        <p>Content</p>
      </Modal>
    );
    expect(screen.getByRole('dialog').className).toContain('max-w-lg');
  });

  it('handles Tab key for focus trapping', () => {
    render(
      <Modal isOpen={true} onClose={() => {}} title="Focus Trap">
        <button type="button">First</button>
        <button type="button">Second</button>
      </Modal>
    );

    screen.getByRole('button', { name: 'First' }).focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders default md size when size prop is omitted', () => {
    render(
      <Modal isOpen={true} onClose={() => {}} title="Medium">
        <p>Content</p>
      </Modal>
    );
    expect(screen.getByRole('dialog').className).toContain('max-w-md');
  });

  it('closes when clicking the overlay but not the dialog body', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={onClose} title="Overlay">
        <button type="button">Inside</button>
      </Modal>
    );

    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    fireEvent.mouseDown(screen.getByRole('dialog'));
    fireEvent.click(screen.getByText('Inside'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
