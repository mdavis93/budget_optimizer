/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { buildAssignmentModel } from '../../../electron/services/scheduler/model/assignmentModel';
import { UNPAID_PLACEMENT } from '../../../electron/services/scheduler/model/objective';
import { remainingCentsForPlacement } from '../../../electron/services/scheduler/model/assignmentModel';
import { GreedySolver } from '../../../electron/services/scheduler/solvers/greedySolver';
import { bruteForceOracle } from '../../helpers/bruteForceOracle';
import { mulberry32, randomInt } from '../../helpers/prng';
import type { ProjectedBill, ProjectedIncome } from '../../../electron/services/scheduler/types';

const PRIORITIES = ['critical', 'high', 'normal', 'low'] as const;
const CASE_COUNT = 300;

function income(date: Date, amount: number, sourceId: string): ProjectedIncome {
  return { date, sourceId, sourceName: sourceId, amount };
}

function projectedBill(
  date: Date,
  billId: string,
  amount: number,
  priority: (typeof PRIORITIES)[number]
): ProjectedBill {
  return {
    date,
    billId,
    creditorName: billId,
    amount,
    dueDay: date.getUTCDate(),
    priority,
  };
}

describe('assignment engine oracle', () => {
  it('keeps greedy feasible and priority-respecting on 300 seeded cases', () => {
    const solver = new GreedySolver();
    for (let seed = 0; seed < CASE_COUNT; seed++) {
      const prng = mulberry32(seed + 1);
      const paycheckCount = randomInt(prng, 2, 5);
      const billCount = randomInt(prng, 2, 7);
      const paycheckDates = Array.from({ length: paycheckCount }, (_, index) =>
        new Date(Date.UTC(2026, 0, 2 + index * 14))
      );
      const incomes = paycheckDates.map((date, index) =>
        income(date, 200 + randomInt(prng, 0, 8) * 50, `inc-${index}`)
      );
      const bills = Array.from({ length: billCount }, (_, index) => {
        const duePaycheck = randomInt(prng, 0, paycheckCount);
        const due = new Date(paycheckDates[duePaycheck].getTime() + randomInt(prng, 0, 10) * 86_400_000);
        return projectedBill(
          due,
          `bill-${index}`,
          50 + randomInt(prng, 0, 8) * 25,
          PRIORITIES[randomInt(prng, 0, PRIORITIES.length)]
        );
      });

      const model = buildAssignmentModel({
        paycheckDates,
        incomes,
        bills,
        startingBalance: randomInt(prng, 0, 5) * 50,
        minCashOnHand: 50,
        targetCashOnHand: 150,
      });
      const result = solver.solve(model);
      const remaining = remainingCentsForPlacement(model, result.placement);
      for (let paycheckIndex = 0; paycheckIndex < model.paycheckCount; paycheckIndex++) {
        expect(remaining[paycheckIndex]).toBeGreaterThanOrEqual(0);
      }
      for (let billIndex = 0; billIndex < model.billCount; billIndex++) {
        const paycheckIndex = result.placement[billIndex];
        if (paycheckIndex === UNPAID_PLACEMENT) continue;
        expect(model.paycheckDay[paycheckIndex]).toBeLessThanOrEqual(model.dueDay[billIndex]);
      }
      expect(result.workCount).toBeGreaterThan(0);

      if (model.billCount <= 8 && model.paycheckCount <= 4) {
        const oracle = bruteForceOracle({
          bills: Array.from({ length: model.billCount }, (_, billIndex) => ({
            amountCents: model.amountCents[billIndex],
            priority:
              model.priorityTier[billIndex] === 1
                ? 'critical'
                : model.priorityTier[billIndex] === 2
                  ? 'high'
                  : model.priorityTier[billIndex] === 3
                    ? 'normal'
                    : 'low',
            dueDay: model.dueDay[billIndex],
            eligiblePaycheckIndexes: Array.from(
              { length: model.eligibilityOffsets[billIndex + 1] - model.eligibilityOffsets[billIndex] },
              (_, offset) => model.eligibilityIndices[model.eligibilityOffsets[billIndex] + offset]
            ),
            ...(model.fixedPaycheck[billIndex] >= 0
              ? { fixedPaycheckIndex: model.fixedPaycheck[billIndex] }
              : {}),
            isPinned: model.isPinned[billIndex] === 1,
          })),
          paychecks: Array.from({ length: model.paycheckCount }, (_, paycheckIndex) => ({
            day: model.paycheckDay[paycheckIndex],
            capacityCents: model.incomeCents[paycheckIndex],
            minCashCents: model.minCashCents[paycheckIndex],
            targetCashCents: model.targetCashCents[paycheckIndex],
          })),
        });
        expect(oracle.placement.length).toBe(model.billCount);
      }
    }
  });
});
