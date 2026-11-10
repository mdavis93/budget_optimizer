import { describe, expect, it } from 'vitest';
import { isBreakGlassBand, isLabeledBreakGlassPaycheck } from '@shared/breakGlassBand';
import { billOccurrenceKey, billOccurrenceKeyFromIso } from '@shared/billOccurrence';
import { IPC } from '@shared/ipcChannels';
import { MAX_SAVINGS_GOALS } from '@shared/goalPriority';
import { monthsCoveringDate } from '@shared/monthsCoveringDate';
import { allBillsSkippedOrUnpayable, isPaycheckShortfall, isSavingsSqueezed } from '@shared/paycheckFlags';
import { extraMonthlyDollars } from '../../../electron/services/scheduler/debt/debtSimulator';

describe('single-source helpers', () => {
  it('keeps break-glass inside the band and excludes the edges outside it', () => {
    expect(isBreakGlassBand(100, 250, 100)).toBe(true);
    expect(isBreakGlassBand(249, 250, 100)).toBe(true);
    expect(isBreakGlassBand(250, 250, 100)).toBe(false);
    expect(isBreakGlassBand(99, 250, 100)).toBe(false);
  });

  it('labels break-glass only when the paycheck is not a shortfall', () => {
    const inBand = { budgetRemaining: 150, targetCashOnHand: 250, minCashOnHand: 100 };
    expect(isLabeledBreakGlassPaycheck({ ...inBand, isShortfall: true }, 250, 100)).toBe(false);
    expect(isLabeledBreakGlassPaycheck({ ...inBand, isShortfall: false }, 250, 100)).toBe(true);
    expect(isLabeledBreakGlassPaycheck(inBand, 250, 100)).toBe(true);
    expect(isLabeledBreakGlassPaycheck({ budgetRemaining: 50, isShortfall: false }, 250, 100)).toBe(false);
  });

  it('marks a paycheck shortfall from remaining cash below the floor', () => {
    expect(allBillsSkippedOrUnpayable([])).toBe(false);
    expect(allBillsSkippedOrUnpayable([{ isSkipped: true }, { isUnpayable: true }])).toBe(true);
    expect(allBillsSkippedOrUnpayable([{ isSkipped: false, isUnpayable: false }])).toBe(false);

    const base = {
      isReserved: false,
      budgetRemaining: 50,
      effectiveMin: 100,
    };
    expect(isPaycheckShortfall({ ...base, isReserved: true, budgetRemaining: 0 })).toBe(false);
    expect(isPaycheckShortfall(base)).toBe(true);
    expect(isPaycheckShortfall({ ...base, budgetRemaining: 100 })).toBe(false);
  });

  it('squeezes savings only when goals took cash below the fallback', () => {
    expect(isSavingsSqueezed(40, 20, 100)).toBe(true);
    expect(isSavingsSqueezed(0, 20, 100)).toBe(false);
    expect(isSavingsSqueezed(40, 100, 100)).toBe(false);
  });

  it('rounds months up until the window covers the target date', () => {
    const start = new Date(2026, 0, 15);
    expect(monthsCoveringDate(start, new Date(2026, 0, 15))).toBe(0);
    expect(monthsCoveringDate(start, new Date(2026, 2, 15))).toBe(2);
    expect(monthsCoveringDate(start, new Date(2026, 2, 16))).toBe(3);
  });

  it('builds the bill occurrence key from an iso date', () => {
    expect(billOccurrenceKeyFromIso('bill-1', '2026-01-15')).toBe('bill-1-2026-01-15');
    expect(billOccurrenceKey('bill-1', new Date(2026, 0, 15))).toBe('bill-1-2026-01-15');
  });

  it('floors extra monthly debt dollars at zero', () => {
    expect(extraMonthlyDollars(200, 50)).toBe(150);
    expect(extraMonthlyDollars(50, 200)).toBe(0);
  });

  it('keeps five savings-goal priority slots', () => {
    expect(MAX_SAVINGS_GOALS).toBe(5);
  });

  it('uses a unique string for every IPC channel', () => {
    const channels = Object.values(IPC);
    expect(new Set(channels).size).toBe(channels.length);
    expect(channels).toContain('schedule:progress');
    expect(channels).toContain('auth:locked');
    expect(channels).toContain('app:close-requested');
  });
});
