import {
  SCHEDULE_COMPUTE_STAGES,
  type ScheduleComputeProgressReport,
  type ScheduleComputeStage,
} from '@shared/scheduleComputeProtocol';

/** Weights sum to 100. Unequal because dry-runs dominate wall time. */
const STAGE_WEIGHTS: Record<ScheduleComputeStage, number> = {
  assigning: 35,
  reconciling: 8,
  advising: 12,
  validating_plan: 37,
  finishing: 8,
};

const STAGE_LABELS: Record<ScheduleComputeStage, string> = {
  assigning: 'Assigning bills to paychecks…',
  reconciling: 'Checking for shortfalls…',
  advising: 'Looking for adjustments…',
  validating_plan: 'Validating adjustments…',
  finishing: 'Finishing schedule…',
};

export function scheduleProgressPercent(progress: ScheduleComputeProgressReport): number {
  const index = SCHEDULE_COMPUTE_STAGES.indexOf(progress.stage);
  if (index < 0) {
    return 0;
  }
  let before = 0;
  for (let i = 0; i < index; i++) {
    before += STAGE_WEIGHTS[SCHEDULE_COMPUTE_STAGES[i]];
  }
  const weight = STAGE_WEIGHTS[progress.stage];
  if (
    progress.stage === 'validating_plan' &&
    progress.total &&
    progress.total > 0 &&
    progress.current != null
  ) {
    const frac = Math.min(1, Math.max(0, progress.current / progress.total));
    return Math.round(before + weight * frac);
  }
  return before;
}

export function scheduleProgressLabel(progress: ScheduleComputeProgressReport): string {
  if (
    progress.stage === 'validating_plan' &&
    progress.current != null &&
    progress.total != null &&
    progress.total > 0
  ) {
    return `Validating adjustment ${progress.current} of ${progress.total}…`;
  }
  return STAGE_LABELS[progress.stage];
}
