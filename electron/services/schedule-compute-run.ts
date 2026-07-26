import type { Bill, Income, Leave, SavingsGoal } from '@shared/types';
import { SchedulerService } from './scheduler.service';
import type {
  ScheduleComputeRequest,
  ScheduleComputeSuccessMessage,
} from '@shared/scheduleComputeProtocol';
import { SCHEDULE_COMPUTE_PROTOCOL_VERSION } from '@shared/scheduleComputeProtocol';
import { deserializeScheduleComputeInput } from './schedule-compute-serialize';
import { filterBreakGlassPlansByDryRun } from './scheduler/breakGlassDryRun';

/**
 * Pure schedule/goal compute used by the utilityProcess worker and unit tests.
 * Must stay free of DB / filesystem / network side effects.
 */
export function runScheduleCompute(
  request: ScheduleComputeRequest
): ScheduleComputeSuccessMessage {
  const native = deserializeScheduleComputeInput(request.input);
  const scheduler = new SchedulerService();
  const now = new Date(native.nowIso);

  const incomes = native.incomes as Income[];
  const bills = native.bills as Bill[];
  const goals = native.goals as SavingsGoal[];
  const leaves = native.leaves as Leave[];

  if (request.op === 'goals') {
    const goalProjections = scheduler.generateGoalProjections(
      incomes,
      bills,
      native.startDate,
      native.startingBalance,
      native.skippedBills,
      native.manualAssignments,
      native.targetCashOnHand,
      goals,
      native.minCashOnHand,
      native.minSavingsPerPaycheck,
      native.debtPayoffs,
      native.incomeOverrides,
      leaves,
      now
    );

    return {
      type: 'result',
      protocolVersion: SCHEDULE_COMPUTE_PROTOCOL_VERSION,
      jobId: request.jobId,
      inputHash: request.inputHash,
      op: 'goals',
      goalProjections,
    };
  }

  const data = scheduler.generateSchedule(
    incomes,
    bills,
    native.startDate,
    native.months,
    native.startingBalance,
    native.skippedBills,
    native.manualAssignments,
    native.targetCashOnHand,
    goals,
    native.minCashOnHand,
    native.minSavingsPerPaycheck,
    native.debtPayoffs,
    native.incomeOverrides,
    leaves,
    native.preferredAssignments
  );

  const fullHorizon = {
    ...data,
    paychecks: data.fullPaychecks ?? data.paychecks,
  };
  data.reconciliation = scheduler.analyzeAndProposeFixes(fullHorizon);
  const proposed = scheduler.proposeBreakGlassPlans(fullHorizon, {
    scheduleStartDate: native.startDate,
    targetCashOnHand: native.targetCashOnHand,
    minCashOnHand: native.minCashOnHand,
    lockedBillKeys: new Set(native.manualAssignments.keys()),
  });
  data.breakGlassAdvisor = filterBreakGlassPlansByDryRun(
    proposed,
    fullHorizon,
    (preferredAssignments) => {
      const trial = scheduler.generateSchedule(
        incomes,
        bills,
        native.startDate,
        native.months,
        native.startingBalance,
        native.skippedBills,
        native.manualAssignments,
        native.targetCashOnHand,
        goals,
        native.minCashOnHand,
        native.minSavingsPerPaycheck,
        native.debtPayoffs,
        native.incomeOverrides,
        leaves,
        preferredAssignments
      );
      return {
        ...trial,
        paychecks: trial.fullPaychecks ?? trial.paychecks,
      };
    }
  );

  const viewported = scheduler.applyViewportFilter(
    data,
    native.months,
    bills,
    native.startingBalance
  );

  return {
    type: 'result',
    protocolVersion: SCHEDULE_COMPUTE_PROTOCOL_VERSION,
    jobId: request.jobId,
    inputHash: request.inputHash,
    op: 'schedule',
    schedule: {
      ...viewported,
      breakGlassAdvisor: data.breakGlassAdvisor,
      reconciliation: data.reconciliation,
    },
  };
}
