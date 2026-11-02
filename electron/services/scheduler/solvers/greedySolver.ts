import {
  candidatesForBill,
  modelToObjectiveInput,
  remainingCentsForPlacement,
  type AssignmentModel,
} from '../model/assignmentModel';
import {
  TIER_COUNT,
  UNPAID_PLACEMENT,
  scoreObjective,
  type TierVector,
} from '../model/objective';
import type { AssignmentSolveResult, AssignmentSolver } from './types';

/** Named inspection cap. Entity-cap corpora stay under this. */
export const GREEDY_MAX_WORK = 2_000_000;

export class GreedyWorkLimitError extends Error {
  readonly workCount: number;

  constructor(workCount: number) {
    super(`greedy work cap ${GREEDY_MAX_WORK} exceeded`);
    this.name = 'GreedyWorkLimitError';
    this.workCount = workCount;
  }
}

function occurrenceKey(model: AssignmentModel, billIndex: number): string {
  return `${model.billIds[billIndex]}-${model.billDueIso[billIndex]}`;
}

function compareMovable(model: AssignmentModel, left: number, right: number): number {
  const priorityDelta = model.priorityTier[left] - model.priorityTier[right];
  if (priorityDelta !== 0) return priorityDelta;
  const dueDelta = model.dueDay[left] - model.dueDay[right];
  if (dueDelta !== 0) return dueDelta;
  const keyLeft = occurrenceKey(model, left);
  const keyRight = occurrenceKey(model, right);
  return keyLeft < keyRight ? -1 : keyLeft > keyRight ? 1 : 0;
}

function isFixed(model: AssignmentModel, billIndex: number): boolean {
  return model.fixedPaycheck[billIndex] >= 0;
}

function scorePlacement(model: AssignmentModel, placement: ArrayLike<number>): TierVector {
  return scoreObjective(modelToObjectiveInput(model, placement));
}

function comparePrefix(left: TierVector, right: TierVector, tiers: number): number {
  for (let index = 0; index < tiers; index++) {
    if (left[index] !== right[index]) {
      return left[index] < right[index] ? -1 : 1;
    }
  }
  return 0;
}

function canPay(remaining: ArrayLike<number>, paycheckIndex: number, amount: number): boolean {
  return remaining[paycheckIndex] >= amount;
}

function advisorTieBreak(
  model: AssignmentModel,
  placement: ArrayLike<number>
): { earlyMoves: number; moveCount: number } {
  const baseline = model.advisorBaseline;
  if (!baseline) return { earlyMoves: 0, moveCount: 0 };
  let earlyMoves = 0;
  let moveCount = 0;
  for (let billIndex = 0; billIndex < model.billCount; billIndex++) {
    const paycheckIndex = placement[billIndex];
    if (paycheckIndex !== baseline.placement[billIndex]) moveCount += 1;
    if (paycheckIndex === UNPAID_PLACEMENT) continue;
    const daysEarly = model.dueDay[billIndex] - model.paycheckDay[paycheckIndex];
    if (daysEarly > baseline.earlyDayCutoff) earlyMoves += 1;
  }
  return { earlyMoves, moveCount };
}

/**
 * Negative when `trial` is the better placement.
 * With `advisorBaseline`, T0–T6 stay the schedule objective, then moves more than
 * `earlyDayCutoff` days early, then move count, then dollar-days.
 */
function comparePlacements(
  model: AssignmentModel,
  trial: ArrayLike<number>,
  incumbent: ArrayLike<number>,
  throughTier: number
): number {
  const trialScore = scorePlacement(model, trial);
  const incumbentScore = scorePlacement(model, incumbent);
  const head = comparePrefix(trialScore, incumbentScore, throughTier);
  if (head !== 0 || !model.advisorBaseline) return head;
  const trialTie = advisorTieBreak(model, trial);
  const incumbentTie = advisorTieBreak(model, incumbent);
  if (trialTie.earlyMoves !== incumbentTie.earlyMoves) {
    return trialTie.earlyMoves < incumbentTie.earlyMoves ? -1 : 1;
  }
  if (trialTie.moveCount !== incumbentTie.moveCount) {
    return trialTie.moveCount < incumbentTie.moveCount ? -1 : 1;
  }
  return comparePrefix(trialScore, incumbentScore, TIER_COUNT);
}

export class GreedySolver implements AssignmentSolver {
  readonly name = 'greedy' as const;

  constructor(
    private readonly maxWork: number = GREEDY_MAX_WORK,
    private readonly improvementPasses: number = 1
  ) {}

  solve(model: AssignmentModel): AssignmentSolveResult {
    const placement = new Int32Array(model.billCount);
    placement.fill(UNPAID_PLACEMENT);
    const remaining = Int32Array.from(model.incomeCents);
    let workCount = 0;

    const inspect = (): void => {
      workCount += 1;
      if (workCount > this.maxWork) {
        throw new GreedyWorkLimitError(workCount);
      }
    };

    try {
      if (
        model.advisorBaseline &&
        model.advisorBaseline.placement.length === model.billCount
      ) {
        placement.set(model.advisorBaseline.placement);
        this.improveOnce(model, placement, inspect);
        this.shiftLater(model, placement, inspect);
        return {
          placement,
          workCount,
          solver: 'greedy',
          optimal: true,
        };
      }

      const fixedOrder = Array.from({ length: model.billCount }, (_, index) => index).filter(
        (billIndex) => isFixed(model, billIndex)
      );
      fixedOrder.sort((left, right) => compareMovable(model, left, right));
      for (const billIndex of fixedOrder) {
        const paycheckIndex = model.fixedPaycheck[billIndex];
        inspect();
        if (canPay(remaining, paycheckIndex, model.amountCents[billIndex])) {
          placement[billIndex] = paycheckIndex;
          remaining[paycheckIndex] -= model.amountCents[billIndex];
        }
      }

      const movable = Array.from({ length: model.billCount }, (_, index) => index).filter(
        (billIndex) => !isFixed(model, billIndex)
      );
      movable.sort((left, right) => compareMovable(model, left, right));

      for (const billIndex of movable) {
        const amount = model.amountCents[billIndex];
        const candidates = candidatesForBill(model, billIndex);
        let chosen = UNPAID_PLACEMENT;
        for (let cursor = candidates.length - 1; cursor >= 0; cursor--) {
          inspect();
          const paycheckIndex = candidates[cursor];
          if (canPay(remaining, paycheckIndex, amount)) {
            chosen = paycheckIndex;
            break;
          }
        }
        if (chosen !== UNPAID_PLACEMENT) {
          placement[billIndex] = chosen;
          remaining[chosen] -= amount;
        }
      }

      this.improveOnce(model, placement, inspect);
      this.shiftLater(model, placement, inspect);
      for (let pass = 1; pass < this.improvementPasses; pass++) {
        const before = placement.join(',');
        this.improveOnce(model, placement, inspect);
        if (placement.join(',') === before) break;
      }

      return {
        placement,
        workCount,
        solver: 'greedy',
        optimal: true,
      };
    } catch (error) {
      if (error instanceof GreedyWorkLimitError) {
        return {
          placement,
          workCount,
          solver: 'greedy',
          optimal: false,
          fallbackReason: 'limit_hit',
        };
      }
      throw error;
    }
  }

  private improveOnce(
    model: AssignmentModel,
    placement: Int32Array,
    inspect: () => void
  ): void {
    let bestPlacement = Int32Array.from(placement);
    let improved = false;
    const tierDepth = model.advisorBaseline ? 7 : TIER_COUNT;

    for (let billIndex = 0; billIndex < model.billCount; billIndex++) {
      if (isFixed(model, billIndex)) continue;
      const current = placement[billIndex];
      const candidates = candidatesForBill(model, billIndex);
      for (const paycheckIndex of candidates) {
        inspect();
        if (paycheckIndex === current) continue;
        const trial = Int32Array.from(placement);
        trial[billIndex] = paycheckIndex;
        const remaining = remainingCentsForPlacement(model, trial);
        if (paycheckIndex !== UNPAID_PLACEMENT && remaining[paycheckIndex] < 0) {
          continue;
        }
        if (comparePlacements(model, trial, bestPlacement, tierDepth) < 0) {
          bestPlacement = trial;
          improved = true;
        }
      }
      inspect();
      if (current !== UNPAID_PLACEMENT) {
        const trial = Int32Array.from(placement);
        trial[billIndex] = UNPAID_PLACEMENT;
        if (comparePlacements(model, trial, bestPlacement, tierDepth) < 0) {
          bestPlacement = trial;
          improved = true;
        }
      }
    }

    if (improved) {
      placement.set(bestPlacement);
    }
  }

  private shiftLater(
    model: AssignmentModel,
    placement: Int32Array,
    inspect: () => void
  ): void {
    const order = Array.from({ length: model.billCount }, (_, index) => index);
    order.sort((left, right) => {
      const keyLeft = occurrenceKey(model, left);
      const keyRight = occurrenceKey(model, right);
      return keyLeft < keyRight ? -1 : keyLeft > keyRight ? 1 : 0;
    });

    for (const billIndex of order) {
      if (isFixed(model, billIndex)) continue;
      const current = placement[billIndex];
      if (current === UNPAID_PLACEMENT) continue;
      const amount = model.amountCents[billIndex];
      const candidates = candidatesForBill(model, billIndex);
      let chosen = current;
      for (let cursor = candidates.length - 1; cursor >= 0; cursor--) {
        inspect();
        const paycheckIndex = candidates[cursor];
        if (paycheckIndex <= current) continue;
        const trial = Int32Array.from(placement);
        trial[billIndex] = paycheckIndex;
        const remaining = remainingCentsForPlacement(model, trial);
        if (remaining[paycheckIndex] < 0) continue;
        if (comparePlacements(model, trial, placement, 7) <= 0) {
          chosen = paycheckIndex;
          break;
        }
      }
      if (chosen !== current && canPay(remainingCentsForPlacement(model, placement), chosen, amount)) {
        placement[billIndex] = chosen;
      }
    }
  }
}
