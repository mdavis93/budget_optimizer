import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import BreakGlassAdvisorPanel from '../../src/components/schedule/BreakGlassAdvisorPanel';
import type { BreakGlassPlan } from '../../src/types';

const plan: BreakGlassPlan = {
  id: 'break-glass-1',
  targetPaycheckDate: '2026-07-31',
  headline: 'Clear Break-Glass on Jul 31',
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

    expect(screen.getByText(/You can avoid Break-Glass on Jul 31/i)).toBeInTheDocument();
    expect(screen.getByText('Rent')).toBeInTheDocument();
    expect(screen.getByText(/15 days early/i)).toBeInTheDocument();
    expect(screen.getByText(/needs confirmation/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Accept adjustments/i }));
    expect(onAccept).toHaveBeenCalledWith(plan);
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
});
