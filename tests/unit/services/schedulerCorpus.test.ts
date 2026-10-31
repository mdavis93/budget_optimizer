import { describe, expect, it } from 'vitest';
import { resolveCalculationMonths } from '../../../electron/services/scheduler/types';
import { schedulerCorpus, scenarioById } from '../../fixtures/scheduler/corpus';
import {
  approximateAnnualLoad,
  monthlyAmountsForLoad,
} from '../../helpers/scheduleFixtures';

const REQUIRED_IDS = [
  'one-income-70',
  'one-income-90',
  'two-incomes-60',
  'two-incomes-80',
  'two-incomes-90',
  'two-incomes-100',
  'monthly-pay',
  'horizon-60',
  'leave',
  'reserved-income',
  'locks-attached-preferred',
];

function operatingCount(id: string): number {
  return scenarioById(id).incomes.filter((income) => income.purpose !== 'savingsAndGoals').length;
}

describe('scheduler corpus', () => {
  it('includes the phase 0 scenarios once', () => {
    expect(schedulerCorpus.map((scenario) => scenario.id).sort()).toEqual([...REQUIRED_IDS].sort());
  });

  it('sizes load scenarios to their annual ratio', () => {
    expect(operatingCount('one-income-70')).toBe(1);
    expect(operatingCount('one-income-90')).toBe(1);
    expect(operatingCount('two-incomes-60')).toBe(2);
    expect(operatingCount('two-incomes-100')).toBe(2);
    for (const scenario of schedulerCorpus) {
      if (scenario.load === undefined) continue;
      expect(approximateAnnualLoad(scenario)).toBeCloseTo(scenario.load, 2);
    }
  });

  it('covers monthly pay, a 60-month horizon, leave, reserved income, and placements', () => {
    expect(scenarioById('monthly-pay').incomes.every((income) => income.cadence === 'monthly')).toBe(true);

    const horizon = scenarioById('horizon-60');
    expect(resolveCalculationMonths(horizon.startDate, horizon.goals ?? [])).toBe(60);

    expect(scenarioById('leave').leaves?.some((leave) => leave.type === 'unpaid')).toBe(true);
    expect(scenarioById('reserved-income').incomes.some((income) => income.purpose === 'savingsAndGoals')).toBe(true);

    const placements = scenarioById('locks-attached-preferred');
    expect(placements.manualAssignments?.length).toBeGreaterThan(0);
    expect(placements.preferredAssignments?.length).toBeGreaterThan(0);
    expect(placements.bills.some((bill) => bill.isIncomeAttached)).toBe(true);
  });

  it('rejects an unknown scenario id and empty load weights', () => {
    expect(() => scenarioById('missing')).toThrow(/unknown scheduler scenario/);
    expect(() => monthlyAmountsForLoad(1000, 0.5, [])).toThrow(/load weights/);
  });
});
