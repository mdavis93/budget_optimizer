import type { LegacyHighs, HighsSolution } from 'highs';
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

export const HIGHS_TIME_LIMIT_SECONDS = 30;
export const HIGHS_MIP_MAX_NODES = 50_000;
export const HIGHS_SIMPLEX_ITERATION_LIMIT = 100_000;
export const HIGHS_TIER_HOLD_SLACK = 0.5;

export const HIGHS_SOLVE_OPTIONS = {
  output_flag: false,
  threads: 1,
  random_seed: 0,
  mip_rel_gap: 0,
  mip_max_nodes: HIGHS_MIP_MAX_NODES,
  simplex_iteration_limit: HIGHS_SIMPLEX_ITERATION_LIMIT,
  time_limit: HIGHS_TIME_LIMIT_SECONDS,
} as const;

const LIMIT_STATUSES = new Set([
  'Time limit reached',
  'Iteration limit reached',
  'Bound on objective reached',
  'Target for objective reached',
]);

export interface HighsLpBuild {
  text: string;
  variableNames: readonly string[];
}

function variableName(index: number): string {
  return `v${index}`;
}

function dollarsOf(amountCents: number): number {
  return Math.round(amountCents / 100);
}

/**
 * Latest-feasible greedy used as a HiGHS warm start. The full greedy solver
 * with improvement passes lands in 2b.
 */
export function greedyWarmStart(model: AssignmentModel): Int32Array {
  const placement = new Int32Array(model.billCount);
  placement.fill(UNPAID_PLACEMENT);
  const remaining = Int32Array.from(model.incomeCents);
  const order = Array.from({ length: model.billCount }, (_, index) => index);
  order.sort((left, right) => {
    const pinnedDelta = model.isPinned[right] - model.isPinned[left];
    if (pinnedDelta !== 0) return pinnedDelta;
    const priorityDelta = model.priorityTier[left] - model.priorityTier[right];
    if (priorityDelta !== 0) return priorityDelta;
    const dueDelta = model.dueDay[left] - model.dueDay[right];
    if (dueDelta !== 0) return dueDelta;
    return left - right;
  });

  let workCount = 0;
  for (const billIndex of order) {
    const amount = model.amountCents[billIndex];
    const candidates = candidatesForBill(model, billIndex);
    let chosen = UNPAID_PLACEMENT;
    for (let cursor = candidates.length - 1; cursor >= 0; cursor--) {
      workCount += 1;
      const paycheckIndex = candidates[cursor];
      if (remaining[paycheckIndex] >= amount) {
        chosen = paycheckIndex;
        break;
      }
    }
    placement[billIndex] = chosen;
    if (chosen !== UNPAID_PLACEMENT) {
      remaining[chosen] -= amount;
    }
  }
  void workCount;
  return placement;
}

export function scoreModel(model: AssignmentModel, placement: ArrayLike<number>): TierVector {
  return scoreObjective(modelToObjectiveInput(model, placement));
}

function appendTierDefinition(
  lines: string[],
  model: AssignmentModel,
  tier: number
): void {
  const terms: string[] = [`t${tier}`];
  if (tier <= 4) {
    const wantPinned = tier === 0;
    for (let billIndex = 0; billIndex < model.billCount; billIndex++) {
      const pinned = model.isPinned[billIndex] === 1;
      if (wantPinned !== pinned) continue;
      if (!wantPinned && model.priorityTier[billIndex] !== tier) continue;
      const amount = model.amountCents[billIndex];
      const start = model.eligibilityOffsets[billIndex];
      const end = model.eligibilityOffsets[billIndex + 1];
      for (let cursor = start; cursor < end; cursor++) {
        terms.push(`+ ${amount} ${variableName(cursor)}`);
      }
    }
    const rhs = unpaidCapacity(model, tier);
    lines.push(` d${tier}: ${terms.join(' ')} = ${rhs}`);
    return;
  }

  if (tier === 5 || tier === 6) {
    const slackPrefix = tier === 5 ? 's5' : 's6';
    const slackNames: string[] = [];
    for (let paycheckIndex = 0; paycheckIndex < model.paycheckCount; paycheckIndex++) {
      if (model.countsTowardCashFloors[paycheckIndex] !== 1) continue;
      slackNames.push(`${slackPrefix}x${paycheckIndex}`);
    }
    if (slackNames.length === 0) {
      lines.push(` d${tier}: t${tier} = 0`);
      return;
    }
    lines.push(` d${tier}: t${tier} - ${slackNames.join(' - ')} = 0`);
    return;
  }

  const earlyTerms: string[] = [`t${tier}`];
  let hasEarly = false;
  for (let billIndex = 0; billIndex < model.billCount; billIndex++) {
    const start = model.eligibilityOffsets[billIndex];
    const end = model.eligibilityOffsets[billIndex + 1];
    const dollars = dollarsOf(model.amountCents[billIndex]);
    for (let cursor = start; cursor < end; cursor++) {
      const paycheckIndex = model.eligibilityIndices[cursor];
      const daysEarly = model.dueDay[billIndex] - model.paycheckDay[paycheckIndex];
      if (daysEarly <= 0) continue;
      hasEarly = true;
      earlyTerms.push(`- ${dollars * daysEarly} ${variableName(cursor)}`);
    }
  }
  lines.push(hasEarly ? ` d${tier}: ${earlyTerms.join(' ')} = 0` : ` d${tier}: t${tier} = 0`);
}

function unpaidCapacity(model: AssignmentModel, tier: number): number {
  let total = 0;
  for (let billIndex = 0; billIndex < model.billCount; billIndex++) {
    const pinned = model.isPinned[billIndex] === 1;
    if (tier === 0 && pinned) total += model.amountCents[billIndex];
    if (tier >= 1 && tier <= 4 && !pinned && model.priorityTier[billIndex] === tier) {
      total += model.amountCents[billIndex];
    }
  }
  return total;
}

function appendCashSlacks(lines: string[], model: AssignmentModel): void {
  for (let paycheckIndex = 0; paycheckIndex < model.paycheckCount; paycheckIndex++) {
    if (model.countsTowardCashFloors[paycheckIndex] !== 1) continue;
    const paidTerms: string[] = [];
    for (let billIndex = 0; billIndex < model.billCount; billIndex++) {
      const start = model.eligibilityOffsets[billIndex];
      const end = model.eligibilityOffsets[billIndex + 1];
      for (let cursor = start; cursor < end; cursor++) {
        if (model.eligibilityIndices[cursor] !== paycheckIndex) continue;
        paidTerms.push(`${model.amountCents[billIndex]} ${variableName(cursor)}`);
      }
    }
    const paidExpr =
      paidTerms.length > 0 ? paidTerms.map((term) => `- ${term}`).join(' ') : '- 0';
    const minRhs = model.minCashCents[paycheckIndex] - model.incomeCents[paycheckIndex];
    const targetRhs = model.targetCashCents[paycheckIndex] - model.incomeCents[paycheckIndex];
    lines.push(` f5x${paycheckIndex}: s5x${paycheckIndex} ${paidExpr} >= ${minRhs}`);
    lines.push(` f6x${paycheckIndex}: s6x${paycheckIndex} ${paidExpr} >= ${targetRhs}`);
  }
}

function holdsZeroThrough(holds: ReadonlyArray<{ tier: number; max: number }>, lastTier: number): boolean {
  for (let tier = 0; tier <= lastTier; tier++) {
    const hold = holds.find((item) => item.tier === tier);
    if (!hold || hold.max > 0) return false;
  }
  return true;
}

function assignmentEqualsOne(model: AssignmentModel, lines: string[]): void {
  for (let billIndex = 0; billIndex < model.billCount; billIndex++) {
    const start = model.eligibilityOffsets[billIndex];
    const end = model.eligibilityOffsets[billIndex + 1];
    if (start === end) continue;
    const names = [];
    for (let cursor = start; cursor < end; cursor++) {
      names.push(variableName(cursor));
    }
    lines.push(` a${billIndex}: ${names.join(' + ')} = 1`);
  }
}

function capacityRows(model: AssignmentModel, lines: string[], reserveTarget: boolean): void {
  for (let paycheckIndex = 0; paycheckIndex < model.paycheckCount; paycheckIndex++) {
    const terms: string[] = [];
    for (let billIndex = 0; billIndex < model.billCount; billIndex++) {
      const start = model.eligibilityOffsets[billIndex];
      const end = model.eligibilityOffsets[billIndex + 1];
      for (let cursor = start; cursor < end; cursor++) {
        if (model.eligibilityIndices[cursor] !== paycheckIndex) continue;
        terms.push(`${model.amountCents[billIndex]} ${variableName(cursor)}`);
      }
    }
    if (terms.length === 0) continue;
    const reserve =
      reserveTarget && model.countsTowardCashFloors[paycheckIndex] === 1
        ? model.targetCashCents[paycheckIndex]
        : 0;
    lines.push(
      ` c${paycheckIndex}: ${terms.join(' + ')} <= ${Math.max(0, model.incomeCents[paycheckIndex] - reserve)}`
    );
  }
}

function binaryBounds(variableNames: readonly string[], lines: string[]): void {
  lines.push('Bounds');
  for (const name of variableNames) {
    lines.push(` 0 <= ${name} <= 1`);
  }
  if (variableNames.length > 0) {
    lines.push('Binary');
    lines.push(` ${variableNames.join(' ')}`);
  }
  lines.push('End');
}

function buildTightCashLp(
  model: AssignmentModel,
  tier: 5 | 6,
  holds: ReadonlyArray<{ tier: number; max: number }>
): HighsLpBuild {
  const variableNames = Array.from({ length: model.variableCount }, (_, index) =>
    variableName(index)
  );
  const slackPrefix = tier === 5 ? 's5' : 's6';
  const floor = tier === 5 ? model.minCashCents : model.targetCashCents;
  const slackNames: string[] = [];
  const lines: string[] = ['Minimize', ' obj: tCash', 'Subject To'];
  assignmentEqualsOne(model, lines);
  capacityRows(model, lines, false);

  const t5Hold = holds.find((item) => item.tier === 5);
  const t5Names: string[] = [];
  for (let paycheckIndex = 0; paycheckIndex < model.paycheckCount; paycheckIndex++) {
    if (model.countsTowardCashFloors[paycheckIndex] !== 1) continue;
    const paidTerms: string[] = [];
    for (let billIndex = 0; billIndex < model.billCount; billIndex++) {
      const start = model.eligibilityOffsets[billIndex];
      const end = model.eligibilityOffsets[billIndex + 1];
      for (let cursor = start; cursor < end; cursor++) {
        if (model.eligibilityIndices[cursor] !== paycheckIndex) continue;
        paidTerms.push(`${model.amountCents[billIndex]} ${variableName(cursor)}`);
      }
    }
    const paidExpr =
      paidTerms.length > 0 ? paidTerms.map((term) => `- ${term}`).join(' ') : '- 0';
    const slack = `${slackPrefix}x${paycheckIndex}`;
    slackNames.push(slack);
    lines.push(
      ` f${slack}: ${slack} ${paidExpr} >= ${floor[paycheckIndex] - model.incomeCents[paycheckIndex]}`
    );
    if (tier === 6 && t5Hold) {
      const minSlack = `s5x${paycheckIndex}`;
      t5Names.push(minSlack);
      lines.push(
        ` f${minSlack}: ${minSlack} ${paidExpr} >= ${model.minCashCents[paycheckIndex] - model.incomeCents[paycheckIndex]}`
      );
    }
  }
  lines.push(
    slackNames.length === 0 ? ' dCash: tCash = 0' : ` dCash: tCash - ${slackNames.join(' - ')} = 0`
  );
  if (tier === 6 && t5Hold) {
    if (t5Names.length === 0) {
      lines.push(' d5: t5 = 0');
    } else {
      lines.push(` d5: t5 - ${t5Names.join(' - ')} = 0`);
    }
    lines.push(` h5: t5 <= ${t5Hold.max}`);
  }
  lines.push('Bounds');
  lines.push(' tCash >= 0');
  if (tier === 6 && t5Hold) {
    lines.push(' t5 >= 0');
  }
  for (const slack of slackNames) {
    lines.push(` ${slack} >= 0`);
  }
  if (tier === 6 && t5Hold) {
    for (const slack of t5Names) {
      lines.push(` ${slack} >= 0`);
    }
  }
  for (const name of variableNames) {
    lines.push(` 0 <= ${name} <= 1`);
  }
  if (variableNames.length > 0) {
    lines.push('Binary');
    lines.push(` ${variableNames.join(' ')}`);
  }
  lines.push('End');
  return { text: lines.join('\n'), variableNames };
}

function buildTightDaysEarlyLp(model: AssignmentModel): HighsLpBuild {
  const variableNames = Array.from({ length: model.variableCount }, (_, index) =>
    variableName(index)
  );
  const objTerms: string[] = [];
  for (let billIndex = 0; billIndex < model.billCount; billIndex++) {
    const start = model.eligibilityOffsets[billIndex];
    const end = model.eligibilityOffsets[billIndex + 1];
    const dollars = dollarsOf(model.amountCents[billIndex]);
    for (let cursor = start; cursor < end; cursor++) {
      const paycheckIndex = model.eligibilityIndices[cursor];
      const daysEarly = model.dueDay[billIndex] - model.paycheckDay[paycheckIndex];
      if (daysEarly > 0) {
        objTerms.push(`${dollars * daysEarly} ${variableName(cursor)}`);
      }
    }
  }
  const lines: string[] = [
    'Minimize',
    ` obj: ${objTerms.length > 0 ? objTerms.join(' + ') : '0'}`,
    'Subject To',
  ];
  assignmentEqualsOne(model, lines);
  capacityRows(model, lines, true);
  binaryBounds(variableNames, lines);
  return { text: lines.join('\n'), variableNames };
}

export function buildLpText(
  model: AssignmentModel,
  options: {
    minimizeTier: number;
    holds: ReadonlyArray<{ tier: number; max: number }>;
  }
): HighsLpBuild {
  if (
    (options.minimizeTier === 5 || options.minimizeTier === 6) &&
    holdsZeroThrough(options.holds, 4)
  ) {
    return buildTightCashLp(model, options.minimizeTier, options.holds);
  }
  if (options.minimizeTier === 7 && holdsZeroThrough(options.holds, 6)) {
    return buildTightDaysEarlyLp(model);
  }

  const variableNames = Array.from({ length: model.variableCount }, (_, index) =>
    variableName(index)
  );
  const lines: string[] = ['Minimize', ` obj: t${options.minimizeTier}`, 'Subject To'];

  for (let billIndex = 0; billIndex < model.billCount; billIndex++) {
    const start = model.eligibilityOffsets[billIndex];
    const end = model.eligibilityOffsets[billIndex + 1];
    if (start === end) continue;
    const names = [];
    for (let cursor = start; cursor < end; cursor++) {
      names.push(variableName(cursor));
    }
    lines.push(` a${billIndex}: ${names.join(' + ')} <= 1`);
  }

  for (let paycheckIndex = 0; paycheckIndex < model.paycheckCount; paycheckIndex++) {
    const terms: string[] = [];
    for (let billIndex = 0; billIndex < model.billCount; billIndex++) {
      const start = model.eligibilityOffsets[billIndex];
      const end = model.eligibilityOffsets[billIndex + 1];
      for (let cursor = start; cursor < end; cursor++) {
        if (model.eligibilityIndices[cursor] !== paycheckIndex) continue;
        terms.push(`${model.amountCents[billIndex]} ${variableName(cursor)}`);
      }
    }
    if (terms.length === 0) continue;
    lines.push(` c${paycheckIndex}: ${terms.join(' + ')} <= ${model.incomeCents[paycheckIndex]}`);
  }

  for (let tier = 0; tier < TIER_COUNT; tier++) {
    appendTierDefinition(lines, model, tier);
  }
  appendCashSlacks(lines, model);

  for (const hold of options.holds) {
    lines.push(` h${hold.tier}: t${hold.tier} <= ${hold.max}`);
  }

  lines.push('Bounds');
  for (let tier = 0; tier < TIER_COUNT; tier++) {
    lines.push(` t${tier} >= 0`);
  }
  for (const name of variableNames) {
    lines.push(` 0 <= ${name} <= 1`);
  }
  for (let paycheckIndex = 0; paycheckIndex < model.paycheckCount; paycheckIndex++) {
    if (model.countsTowardCashFloors[paycheckIndex] !== 1) continue;
    lines.push(` s5x${paycheckIndex} >= 0`);
    lines.push(` s6x${paycheckIndex} >= 0`);
  }
  if (variableNames.length > 0) {
    lines.push('Binary');
    lines.push(` ${variableNames.join(' ')}`);
  }
  lines.push('End');
  return { text: lines.join('\n'), variableNames };
}

function readPlacement(model: AssignmentModel, solution: HighsSolution): Int32Array {
  const placement = new Int32Array(model.billCount);
  placement.fill(UNPAID_PLACEMENT);
  const columns = 'Columns' in solution ? solution.Columns : undefined;
  if (!columns) return placement;

  for (let billIndex = 0; billIndex < model.billCount; billIndex++) {
    const start = model.eligibilityOffsets[billIndex];
    const end = model.eligibilityOffsets[billIndex + 1];
    let bestVar = -1;
    let bestValue = 0.5;
    for (let cursor = start; cursor < end; cursor++) {
      const column = columns[variableName(cursor)];
      const value = column && 'Primal' in column ? column.Primal : 0;
      if (value > bestValue) {
        bestValue = value;
        bestVar = cursor;
      }
    }
    if (bestVar !== -1) {
      placement[billIndex] = model.eligibilityIndices[bestVar];
    }
  }
  return placement;
}

export function isHighsOptimal(status: string): boolean {
  return status === 'Optimal';
}

export function isHighsLimitStatus(status: string): boolean {
  return LIMIT_STATUSES.has(status);
}

export class HighsSolver implements AssignmentSolver {
  readonly name = 'highs' as const;

  constructor(private readonly highs: LegacyHighs) {}

  solve(model: AssignmentModel): AssignmentSolveResult {
    const warm = greedyWarmStart(model);
    const warmVector = scoreModel(model, warm);
    const holds: Array<{ tier: number; max: number }> = [];
    let placement = warm;
    let workCount = model.variableCount;
    let lastStatus = 'Optimal';

    for (let tier = 0; tier < TIER_COUNT; tier++) {
      if (warmVector[tier] === 0) {
        holds.push({ tier, max: 0 });
        continue;
      }
      const lp = buildLpText(model, { minimizeTier: tier, holds });
      const result = this.highs.solve(lp.text, HIGHS_SOLVE_OPTIONS);
      workCount += 1;
      lastStatus = result.Status;
      if (!isHighsOptimal(result.Status)) {
        return {
          placement: warm,
          workCount,
          solver: 'highs',
          optimal: false,
          fallbackReason: isHighsLimitStatus(result.Status) ? 'limit_hit' : 'non_optimal',
          highsStatus: result.Status,
        };
      }
      placement = readPlacement(model, result);
      holds.push({
        tier,
        max: result.ObjectiveValue + HIGHS_TIER_HOLD_SLACK,
      });
    }

    if (placement.length === model.billCount) {
      const remaining = remainingCentsForPlacement(model, placement);
      for (let paycheckIndex = 0; paycheckIndex < model.paycheckCount; paycheckIndex++) {
        if (remaining[paycheckIndex] < 0) {
          return {
            placement: warm,
            workCount,
            solver: 'highs',
            optimal: false,
            fallbackReason: 'non_optimal',
            highsStatus: lastStatus,
          };
        }
      }
    }

    return {
      placement,
      workCount,
      solver: 'highs',
      optimal: true,
      highsStatus: lastStatus,
    };
  }
}

export function createHighsSolver(highs: LegacyHighs): AssignmentSolver {
  return new HighsSolver(highs);
}
