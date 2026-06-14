import { describe, it, expect } from 'vitest';
import {
  solvePaycheckDeficit,
  type MicroSolverBill,
  type MicroSolverPaycheck,
} from '../../../electron/utils/rebalanceMicroSolver';

const DAY = 24 * 60 * 60 * 1000;

function paycheck(index: number, dayOffset: number, surplus: number): MicroSolverPaycheck {
  const base = Date.parse('2026-01-01T00:00:00.000Z');
  return { index, dateMs: base + dayOffset * DAY, surplus };
}

function bill(key: string, amount: number, dueDayOffset: number): MicroSolverBill {
  const base = Date.parse('2026-01-01T00:00:00.000Z');
  return { key, amount, dueDateMs: base + dueDayOffset * DAY };
}

describe('solvePaycheckDeficit', () => {
  it('returns empty moves when there is no deficit', () => {
    const result = solvePaycheckDeficit(
      2,
      0,
      [paycheck(0, 0, 200), paycheck(1, 14, 200)],
      [bill('a', 100, 27)],
      14
    );

    expect(result).toEqual({ moves: [], totalDaysEarly: 0 });
  });

  it('assigns bills to distinct earlier paychecks when one target lacks capacity', () => {
    const paychecks = [paycheck(0, 13, 150), paycheck(1, 14, 150)];
    const bills = [bill('a', 150, 27), bill('b', 150, 27)];

    const result = solvePaycheckDeficit(2, 300, paychecks, bills, 14);

    expect(result).not.toBeNull();
    expect(result!.moves).toHaveLength(2);
    const targets = result!.moves.map((m) => m.toIndex).sort();
    expect(targets).toEqual([0, 1]);
    expect(result!.totalDaysEarly).toBe(14 + 13);
  });

  it('minimizes days-early when multiple targets are eligible', () => {
    const paychecks = [paycheck(0, 0, 200), paycheck(1, 10, 200)];
    const bills = [bill('a', 180, 20)];

    const result = solvePaycheckDeficit(2, 180, paychecks, bills, 14);

    expect(result).toEqual({
      moves: [{ billKey: 'a', toIndex: 1 }],
      totalDaysEarly: 10,
    });
  });

  it('returns null when deficit cannot be cleared within capacity', () => {
    const paychecks = [paycheck(0, 0, 100), paycheck(1, 14, 100)];
    const bills = [bill('a', 150, 27), bill('b', 150, 27)];

    const result = solvePaycheckDeficit(2, 300, paychecks, bills, 14);

    expect(result).toBeNull();
  });

  it('respects max prepay days when choosing targets', () => {
    const paychecks = [paycheck(0, 0, 300), paycheck(1, 20, 300)];
    const bills = [bill('a', 200, 25)];

    const result = solvePaycheckDeficit(2, 200, paychecks, bills, 14);

    expect(result).toEqual({
      moves: [{ billKey: 'a', toIndex: 1 }],
      totalDaysEarly: 5,
    });
  });

  it('considers at most maxBills movable bills', () => {
    const paychecks = [paycheck(0, 0, 1000)];
    const manyBills = Array.from({ length: 10 }, (_, i) =>
      bill(`bill-${i}`, 50, 20)
    );

    const result = solvePaycheckDeficit(1, 400, paychecks, manyBills, 14, 8);

    expect(result).toBeNull();
  });
});
