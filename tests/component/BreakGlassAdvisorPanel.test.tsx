import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import BreakGlassAdvisorPanel from '../../src/components/schedule/BreakGlassAdvisorPanel';
import type { BreakGlassPlan } from '../../src/types';

const plan: BreakGlassPlan = {
  id: 'break-glass-2026-07-31',
  targetPaycheckDate: '2026-07-31',
  headline: 'Clear Break-Glass on Jul 31, 2026',
  maxDaysEarly: 15,
  clearsBreakGlass: true,
  steps: [
    {
      billId: 'rent',
      billName: 'Rent',
      billAmount: 160,
      billDueDate: '2026-08-08',
      fromPaycheckDate: '2026-07-31',
      toPaycheckDate: '2026-07-24',
      daysEarly: 15,
      requiresConfirmation: true,
    },
  ],
};

const ambiguousCapPlan: BreakGlassPlan = {
  id: 'break-glass-2026-07-31-cap',
  targetPaycheckDate: '2026-07-31',
  headline: 'Clear Break-Glass on Jul 31, 2026',
  maxDaysEarly: 16,
  clearsBreakGlass: true,
  steps: [
    {
      billId: 'cap-a',
      billName: 'CC: Cap A',
      billAmount: 100,
      billDueDate: '2026-07-17',
      fromPaycheckDate: '2026-07-17',
      toPaycheckDate: '2026-07-03',
      daysEarly: 14,
      requiresConfirmation: false,
    },
    {
      billId: 'cap-a',
      billName: 'CC: Cap A',
      billAmount: 100,
      billDueDate: '2026-07-24',
      fromPaycheckDate: '2026-07-17',
      toPaycheckDate: '2026-07-10',
      daysEarly: 7,
      requiresConfirmation: false,
    },
  ],
};

describe('BreakGlassAdvisorPanel', () => {
  it('renders plan copy and accepts adjustments', async () => {
    const onAccept = vi.fn().mockResolvedValue(undefined);
    const onDecline = vi.fn();

    render(
      <BreakGlassAdvisorPanel
        plans={[plan]}
        onAccept={onAccept}
        onDecline={onDecline}
        isApplying={false}
      />
    );

    expect(screen.getByText(/You can avoid Break-Glass on Jul 31, 2026/i)).toBeInTheDocument();
    expect(screen.getByText('Rent')).toBeInTheDocument();
    expect(screen.queryByText(/due Aug 8, 2026/i)).not.toBeInTheDocument();
    expect(screen.getByText(/15 days early/i)).toBeInTheDocument();
    expect(screen.getByText(/needs confirmation/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Accept adjustments/i }));
    expect(onAccept).toHaveBeenCalledWith(plan);
  });

  it('shows due dates only when the same bill name has multiple due dates', () => {
    render(
      <BreakGlassAdvisorPanel
        plans={[ambiguousCapPlan]}
        onAccept={vi.fn()}
        onDecline={vi.fn()}
        isApplying={false}
      />
    );

    expect(screen.getByText(/due Jul 17, 2026/i)).toBeInTheDocument();
    expect(screen.getByText(/due Jul 24, 2026/i)).toBeInTheDocument();
  });

  it('returns null when there are no plans', () => {
    const { container } = render(
      <BreakGlassAdvisorPanel
        plans={[]}
        onAccept={vi.fn()}
        onDecline={vi.fn()}
        isApplying={false}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows applying status even when plans are empty', () => {
    render(
      <BreakGlassAdvisorPanel
        plans={[]}
        onAccept={vi.fn()}
        onDecline={vi.fn()}
        isApplying={true}
      />
    );
    expect(screen.getByTestId('break-glass-applying')).toBeInTheDocument();
    expect(screen.getByText(/Applying Break-Glass adjustments/i)).toBeInTheDocument();
  });
});
