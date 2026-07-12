import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ScheduleSummaryCards from '../../src/components/schedule/ScheduleSummaryCards';
import ReconciliationBanner from '../../src/components/schedule/ReconciliationBanner';
import ScheduleRecommendations from '../../src/components/schedule/ScheduleRecommendations';

const baseSummary = {
  totalIncome: 4000,
  totalExpenses: 2500,
  netBalance: 1500,
  finalSavingsBalance: 800,
  shortfallCount: 0,
};

describe('ScheduleSummaryCards', () => {
  it('renders summary metrics and success styling when goals are healthy', () => {
    render(
      <ScheduleSummaryCards
        summary={baseSummary}
        totalGoalDeposits={300}
        hasAtRiskGoals={false}
      />
    );

    expect(screen.getByText('Total Income')).toBeInTheDocument();
    expect(screen.getByText('$4,000.00')).toBeInTheDocument();
    expect(screen.getByText('Total Expenses')).toBeInTheDocument();
    expect(screen.getByText('Net Balance')).toBeInTheDocument();
    expect(screen.getByText('Goals Total')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Goals at risk' })).not.toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('highlights at-risk goals, negative net, and shortfalls', () => {
    render(
      <ScheduleSummaryCards
        summary={{ ...baseSummary, netBalance: -120, shortfallCount: 2 }}
        totalGoalDeposits={50}
        hasAtRiskGoals
      />
    );

    expect(screen.getByRole('img', { name: 'Goals at risk' })).toBeInTheDocument();
    expect(screen.getByText('-$120.00')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});

describe('ReconciliationBanner', () => {
  it('pluralizes paycheck copy and omits fixes link when none exist', () => {
    render(
      <ReconciliationBanner
        shortfallCount={2}
        totalDeficit={150}
        hasProposedFixes={false}
        onViewSuggestedFixes={vi.fn()}
      />
    );

    expect(screen.getByText('Budget Has Unresolved Shortfalls')).toBeInTheDocument();
    expect(screen.getByText(/2 paychecks have/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View suggested fixes' })).not.toBeInTheDocument();
  });

  it('shows singular copy and invokes suggested-fixes handler', () => {
    const onViewSuggestedFixes = vi.fn();
    render(
      <ReconciliationBanner
        shortfallCount={1}
        totalDeficit={40}
        hasProposedFixes
        onViewSuggestedFixes={onViewSuggestedFixes}
      />
    );

    expect(screen.getByText(/1 paycheck have/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View suggested fixes' }));
    expect(onViewSuggestedFixes).toHaveBeenCalledTimes(1);
  });
});

describe('ScheduleRecommendations', () => {
  it('renders insights mode collapsed and expands on toggle', () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <ScheduleRecommendations
        recommendations={['Keep a buffer']}
        hasActionableRecommendations={false}
        expanded={false}
        onToggle={onToggle}
      />
    );

    expect(screen.getByRole('button', { name: /Budget Insights/i })).toBeInTheDocument();
    expect(screen.queryByText('Keep a buffer')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Budget Insights/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(
      <ScheduleRecommendations
        recommendations={['Keep a buffer']}
        hasActionableRecommendations={false}
        expanded
        onToggle={onToggle}
      />
    );
    expect(screen.getByText('Keep a buffer')).toBeInTheDocument();
  });

  it('renders actionable recommendations when expanded', () => {
    render(
      <ScheduleRecommendations
        recommendations={['Resolve shortfall on Jan 15']}
        hasActionableRecommendations
        expanded
        onToggle={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /Action Recommended/i })).toBeInTheDocument();
    expect(screen.getByText('Resolve shortfall on Jan 15')).toBeInTheDocument();
  });
});
