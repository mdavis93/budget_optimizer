import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import ScheduleBuildProgress from '../../src/components/schedule/ScheduleBuildProgress';

describe('ScheduleBuildProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pulses until the first stage, then fills a determinate bar', () => {
    const { rerender } = render(
      <ScheduleBuildProgress heading="Building schedule…" progress={null} startedAt={Date.now()} />
    );

    const pending = screen.getByRole('progressbar', { name: 'Building schedule…' });
    expect(pending).not.toHaveAttribute('aria-valuenow');

    rerender(
      <ScheduleBuildProgress
        heading="Building schedule…"
        progress={{ stage: 'assigning' }}
        startedAt={Date.now()}
      />
    );

    expect(screen.getByRole('progressbar', { name: 'Assigning bills to paychecks…' })).toHaveAttribute(
      'aria-valuenow',
      '0'
    );
  });

  it('shows elapsed minutes and still-working copy after a long stage', () => {
    render(
      <ScheduleBuildProgress
        heading="Rebuilding schedule…"
        progress={{ stage: 'reconciling' }}
        startedAt={Date.now()}
      />
    );

    act(() => {
      vi.advanceTimersByTime(61_000);
    });

    expect(screen.getByText(/Elapsed 1:01/)).toBeInTheDocument();
    expect(screen.getByText(/Still working — long horizons take longer/)).toBeInTheDocument();
  });

  it('omits elapsed copy when the build start time is unknown', () => {
    render(
      <ScheduleBuildProgress heading="Building schedule…" progress={null} startedAt={null} />
    );

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(screen.queryByText(/Elapsed/)).not.toBeInTheDocument();
  });
});
