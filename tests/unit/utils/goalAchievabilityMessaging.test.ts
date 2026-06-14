import { describe, it, expect } from 'vitest';
import { deriveComfortTier, buildGoalAchievabilityMessaging } from '../../../src/utils/goalAchievabilityMessaging';
import { GoalProjection, SavingsGoal } from '../../../src/types';

const baseGoal: SavingsGoal = {
  id: 'goal-1',
  name: 'Emergency Fund',
  targetAmount: 11000,
  targetDate: '2027-05-30',
  alreadySaved: 0,
  priority: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function makeProjection(overrides: Partial<GoalProjection> = {}): GoalProjection {
  return {
    goalId: 'goal-1',
    goalName: 'Emergency Fund',
    targetAmount: 11000,
    alreadySaved: 0,
    remainingAmount: 11000,
    targetDate: '2027-05-30',
    paycheckCount: 52,
    requiredPerPaycheck: 211.54,
    adjustedRequiredPerPaycheck: 211.54,
    availablePerPaycheck: 220,
    actualAllocation: 11000,
    achievableAmount: 11000,
    achievabilityPercent: 100,
    status: 'achievable',
    suggestions: [],
    isProjected: false,
    avgAllocationPerPaycheck: 220,
    marginPerPaycheck: 8.46,
    paychecksToFullyFund: 50,
    estimatedFundedDate: '2027-04-15',
    beatsDeadlineByPaychecks: 6,
    missesDeadlineByPaychecks: null,
    scheduleHealth: {
      tightPaycheckCount: 8,
      shortfallCount: 0,
      savingsTotal: 848,
    },
    ...overrides,
  };
}

describe('deriveComfortTier', () => {
  it('returns complete when already saved meets target', () => {
    const tier = deriveComfortTier(
      { ...baseGoal, alreadySaved: 11000 },
      makeProjection({ remainingAmount: 0, status: 'achievable' })
    );
    expect(tier).toBe('complete');
  });

  it('returns easily_achievable when margin ratio is high', () => {
    const tier = deriveComfortTier(baseGoal, makeProjection({ marginPerPaycheck: 100, requiredPerPaycheck: 200 }));
    expect(tier).toBe('easily_achievable');
  });

  it('returns achievable_tight when margin ratio is low but positive', () => {
    const tier = deriveComfortTier(baseGoal, makeProjection({ marginPerPaycheck: 20, requiredPerPaycheck: 211.54 }));
    expect(tier).toBe('achievable_tight');
  });

  it('returns aggressive when margin is zero or negative', () => {
    const tier = deriveComfortTier(baseGoal, makeProjection({ marginPerPaycheck: -5, requiredPerPaycheck: 200 }));
    expect(tier).toBe('aggressive');
  });

  it('returns partial for partial status', () => {
    const tier = deriveComfortTier(
      baseGoal,
      makeProjection({ status: 'partial', achievabilityPercent: 60, actualAllocation: 6600 })
    );
    expect(tier).toBe('partial');
  });

  it('returns not_achievable for impossible status', () => {
    const tier = deriveComfortTier(
      baseGoal,
      makeProjection({ status: 'impossible', achievabilityPercent: 0, actualAllocation: 0 })
    );
    expect(tier).toBe('not_achievable');
  });

  it('returns projected when isProjected and underfunded', () => {
    const tier = deriveComfortTier(
      baseGoal,
      makeProjection({ isProjected: true, achievabilityPercent: 70, status: 'partial' })
    );
    expect(tier).toBe('projected');
  });
});

describe('buildGoalAchievabilityMessaging', () => {
  it('produces tight messaging for low-margin fully funded goal', () => {
    const messaging = buildGoalAchievabilityMessaging(baseGoal, makeProjection());
    expect(messaging.comfortTier).toBe('achievable_tight');
    expect(messaging.headline).toBe("Funded, But It's Tight");
    expect(messaging.body).toContain('8 paycheck');
    expect(messaging.marginFact).toContain('surplus');
  });

  it('includes timeline when funded date is known', () => {
    const messaging = buildGoalAchievabilityMessaging(baseGoal, makeProjection());
    expect(messaging.timeline?.paychecksToFund).toBe(50);
    expect(messaging.timeline?.estimatedFundedDate).toBe('2027-04-15');
    expect(messaging.timeline?.relativeToDeadline).toBe('beats');
  });

  it('includes schedule link for funded goals', () => {
    const messaging = buildGoalAchievabilityMessaging(baseGoal, makeProjection());
    expect(messaging.scheduleLink?.goalId).toBe('goal-1');
    expect(messaging.scheduleLink?.highlightPaycheckDate).toBe('2027-04-15');
  });
});
