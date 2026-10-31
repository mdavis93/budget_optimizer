import { describe, expect, it } from 'vitest';
import { DEFAULT_TARGET_CASH_ON_HAND } from '@shared/constants';
import type { ScheduleData } from '@shared/types';
import { scoreSchedule } from '../../../electron/services/scheduler/model/objective';
import { schedulerCorpus, scenarioById } from '../../fixtures/scheduler/corpus';
import {
  makeBill,
  makeIncome,
  runScenario,
  type ScheduleScenario,
} from '../../helpers/scheduleFixtures';

const surplusScenario: ScheduleScenario = {
  id: 'surplus',
  description: 'Income comfortably above bills and the petty-cash target.',
  incomes: [
    makeIncome({
      id: 'income-1',
      sourceName: 'Salary',
      amount: 5000,
      cadence: 'biweekly',
      startDate: '2026-01-02',
    }),
  ],
  bills: [
    makeBill({
      id: 'internet',
      creditorName: 'Internet',
      budgetedAmount: 80,
      dueDay: 15,
      priority: 'normal',
    }),
  ],
  startDate: '2026-01-01',
  months: 12,
  startingBalance: 0,
};

function assertNoBillPaidLate(schedule: ScheduleData): void {
  let paidCount = 0;
  for (const paycheck of schedule.fullPaychecks) {
    for (const bill of paycheck.bills) {
      if (bill.isUnpayable || bill.isSkipped) continue;
      paidCount += 1;
      expect(paycheck.date <= bill.billDate).toBe(true);
    }
  }
  expect(paidCount).toBeGreaterThan(0);
}

function billIdAndDueDate(occurrenceKey: string): [string, string] {
  return [occurrenceKey.slice(0, -11), occurrenceKey.slice(-10)];
}

function paycheckDatesForBill(schedule: ScheduleData, billId: string, dueDate: string): string[] {
  const dates: string[] = [];
  for (const paycheck of schedule.fullPaychecks) {
    const present = paycheck.bills.some(
      (bill) => bill.billId === billId && bill.billDate === dueDate
    );
    if (present) dates.push(paycheck.date);
  }
  return dates;
}

describe('scheduler characterization', () => {
  it('keeps budgetRemaining at the target when there is surplus', () => {
    const schedule = runScenario(surplusScenario);
    const operating = schedule.fullPaychecks.filter((paycheck) => paycheck.purpose !== 'savingsAndGoals');
    expect(operating.length).toBeGreaterThan(0);
    for (const paycheck of operating) {
      expect(paycheck.budgetRemaining).toBe(DEFAULT_TARGET_CASH_ON_HAND);
    }
    expect(operating.some((paycheck) => paycheck.savingsDeposit > 0)).toBe(true);
    expect(scoreSchedule(schedule.fullPaychecks).slice(0, 7)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    assertNoBillPaidLate(schedule);
  });

  it('keeps income-attached bills on their income and manual locks on their paycheck', () => {
    const scenario = scenarioById('locks-attached-preferred');
    const schedule = runScenario(scenario);

    for (const bill of scenario.bills.filter((item) => item.isIncomeAttached)) {
      expect(bill.preferredIncomeSourceId).toBeTruthy();
      let occurrences = 0;
      for (const paycheck of schedule.fullPaychecks) {
        const present = paycheck.bills.some((item) => item.billId === bill.id);
        if (!present) continue;
        occurrences += 1;
        expect(
          paycheck.incomeSources.some((source) => source.id === bill.preferredIncomeSourceId)
        ).toBe(true);
      }
      expect(occurrences).toBeGreaterThan(0);
    }

    const unlocked = runScenario({ ...scenario, manualAssignments: [] });
    expect(scenario.manualAssignments?.length).toBeGreaterThan(0);
    for (const [occurrenceKey, paycheckDate] of scenario.manualAssignments ?? []) {
      const [billId, dueDate] = billIdAndDueDate(occurrenceKey);
      expect(paycheckDatesForBill(schedule, billId, dueDate)).toEqual([paycheckDate]);
      expect(paycheckDatesForBill(unlocked, billId, dueDate)).not.toContain(paycheckDate);
    }

    const lockedKeys = new Set((scenario.manualAssignments ?? []).map(([key]) => key));
    expect(scoreSchedule(schedule.fullPaychecks, lockedKeys)[0]).toBe(0);
    assertNoBillPaidLate(schedule);
  });

  it('keeps reserved income off operating paychecks and bills off reserved paychecks', () => {
    const scenario = scenarioById('reserved-income');
    const schedule = runScenario(scenario);
    const reservedIds = scenario.incomes
      .filter((income) => income.purpose === 'savingsAndGoals')
      .map((income) => income.id);
    expect(reservedIds.length).toBeGreaterThan(0);

    const reservedPaychecks = schedule.fullPaychecks.filter(
      (paycheck) => paycheck.purpose === 'savingsAndGoals'
    );
    expect(reservedPaychecks.length).toBeGreaterThan(0);
    for (const paycheck of reservedPaychecks) {
      expect(paycheck.bills).toEqual([]);
      expect(paycheck.incomeSources.every((source) => reservedIds.includes(source.id))).toBe(true);
    }
    for (const paycheck of schedule.fullPaychecks) {
      if (paycheck.purpose === 'savingsAndGoals') continue;
      expect(paycheck.incomeSources.some((source) => reservedIds.includes(source.id))).toBe(false);
    }
    assertNoBillPaidLate(schedule);
  });

});

const RUN_TWICE_TIMEOUT_MS = 30_000;
const unitScenarios = [surplusScenario, ...schedulerCorpus.filter((scenario) => !scenario.isStress)];

describe.each(unitScenarios.map((scenario) => [scenario.id, scenario] as const))(
  'scheduler characterization corpus: %s',
  (_id, scenario) => {
    it('pays no bill late and returns identical JSON from two identical runs', () => {
      const first = runScenario(scenario);
      const second = runScenario(scenario);
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
      assertNoBillPaidLate(first);
    }, RUN_TWICE_TIMEOUT_MS);
  }
);
