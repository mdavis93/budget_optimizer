import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LoadingScreen from '../../src/components/LoadingScreen';

describe('LoadingScreen', () => {
  describe('happy', () => {
    it('renders loading message', () => {
      render(<LoadingScreen />);
      expect(screen.getByText('Loading...')).toBeInTheDocument();
    });
  });

  describe('sad', () => {
    it('renders spinner icon container', () => {
      const { container } = render(<LoadingScreen />);
      expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    });
  });

  describe('hostile', () => {
    it('keeps a single visible loading label', () => {
      render(<LoadingScreen />);
      expect(screen.getAllByText('Loading...')).toHaveLength(1);
    });
  });
});
