import {
  DEFAULT_MIN_CASH_ON_HAND,
  DEFAULT_TARGET_CASH_ON_HAND,
} from '@shared/constants';
import {
  buildAssignmentModelFromPrepared,
  type AssignmentModel,
} from '../../electron/services/scheduler/model/assignmentModel';
import { prepareScheduleHorizon } from '../../electron/services/scheduler/scheduleBuild';
import type { ScheduleScenario } from './scheduleFixtures';

export function preferredMapFromScenario(
  scenario: ScheduleScenario
): Map<string, string> {
  return new Map(scenario.preferredAssignments ?? []);
}

export function modelFromScenario(scenario: ScheduleScenario): AssignmentModel {
  const prepared = prepareScheduleHorizon({
    incomes: scenario.incomes,
    bills: scenario.bills,
    startDateStr: scenario.startDate,
    startingBalance: scenario.startingBalance,
    maxBudgetRemaining: scenario.targetCashOnHand ?? DEFAULT_TARGET_CASH_ON_HAND,
    goals: scenario.goals ?? [],
    minCashOnHand: scenario.minCashOnHand ?? DEFAULT_MIN_CASH_ON_HAND,
    leaves: scenario.leaves ?? [],
    manualAssignments: new Map(scenario.manualAssignments ?? []),
  });
  return buildAssignmentModelFromPrepared(prepared, preferredMapFromScenario(scenario));
}
