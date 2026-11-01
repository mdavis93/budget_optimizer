import {
  candidatesForBill,
  modelToObjectiveInput,
  remainingCentsForPlacement,
  type AssignmentModel,
} from '../model/assignmentModel';
import {
  UNPAID_PLACEMENT,
  compareTierVectors,
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

export class GreedySolver implements AssignmentSolver {
  readonly name = 'greedy' as const;

  constructor(private readonly maxWork: number = GREEDY_MAX_WORK) {}

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
    let best = scorePlacement(model, placement);
    let bestBill = -1;
    let bestPaycheck = UNPAID_PLACEMENT;

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
        const vector = scorePlacement(model, trial);
        if (compareTierVectors(vector, best) < 0) {
          best = vector;
          bestBill = billIndex;
          bestPaycheck = paycheckIndex;
        }
      }
      inspect();
      if (current !== UNPAID_PLACEMENT) {
        const trial = Int32Array.from(placement);
        trial[billIndex] = UNPAID_PLACEMENT;
        const vector = scorePlacement(model, trial);
        if (compareTierVectors(vector, best) < 0) {
          best = vector;
          bestBill = billIndex;
          bestPaycheck = UNPAID_PLACEMENT;
        }
      }
    }

    if (bestBill >= 0) {
      placement[bestBill] = bestPaycheck;
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
      const baseline = scorePlacement(model, placement);
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
        const vector = scorePlacement(model, trial);
        if (comparePrefix(vector, baseline, 7) <= 0) {
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
