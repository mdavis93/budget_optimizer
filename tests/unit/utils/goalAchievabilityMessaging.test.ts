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

  it('returns achievable when margin ratio is moderate', () => {
    const tier = deriveComfortTier(baseGoal, makeProjection({ marginPerPaycheck: 40, requiredPerPaycheck: 200 }));
    expect(tier).toBe('achievable');
  });

  it('returns achievable when required per paycheck is zero', () => {
    const tier = deriveComfortTier(
      baseGoal,
      makeProjection({ requiredPerPaycheck: 0, marginPerPaycheck: 0, status: 'achievable', achievabilityPercent: 100 })
    );
    expect(tier).toBe('achievable');
  });

  it('returns partial when achievability percent is positive but status is not partial', () => {
    const tier = deriveComfortTier(
      baseGoal,
      makeProjection({ status: 'achievable', achievabilityPercent: 40, actualAllocation: 4400 })
    );
    expect(tier).toBe('partial');
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

  it('uses unknown timeline for impossible goals with no allocation', () => {
    const messaging = buildGoalAchievabilityMessaging(
      baseGoal,
      makeProjection({
        status: 'impossible',
        achievabilityPercent: 0,
        actualAllocation: 0,
        estimatedFundedDate: null,
        paychecksToFullyFund: null,
      })
    );
    expect(messaging.timeline?.relativeToDeadline).toBe('unknown');
    expect(messaging.margin).toBeNull();
  });

  it('does not show suggestions when there are none for tight goals', () => {
    const messaging = buildGoalAchievabilityMessaging(
      baseGoal,
      makeProjection({
        status: 'achievable',
        achievabilityPercent: 100,
        marginPerPaycheck: 1,
        requiredPerPaycheck: 200,
        suggestions: [],
      })
    );
    expect(messaging.comfortTier).toBe('achievable_tight');
    expect(messaging.showSuggestions).toBe(false);
  });

  it('adds projected modifier when projection is complete but marked projected', () => {
    const messaging = buildGoalAchievabilityMessaging(
      { ...baseGoal, alreadySaved: 11000 },
      makeProjection({
        isProjected: true,
        status: 'achievable',
        achievabilityPercent: 100,
        remainingAmount: 0,
      })
    );
    expect(messaging.comfortTier).toBe('complete');
    expect(messaging.modifiers).toEqual(['projected']);
  });

  it('marks timeline as misses when funded date is after deadline', () => {
    const messaging = buildGoalAchievabilityMessaging(
      baseGoal,
      makeProjection({
        estimatedFundedDate: '2027-06-30',
        beatsDeadlineByPaychecks: null,
        missesDeadlineByPaychecks: 3,
        status: 'partial',
        achievabilityPercent: 85,
      })
    );
    expect(messaging.timeline?.relativeToDeadline).toBe('misses');
    expect(messaging.timeline?.paycheckDeltaFromDeadline).toBe(-3);
  });

  it('keeps timeline unknown when impossible without funded date', () => {
    const messaging = buildGoalAchievabilityMessaging(
      baseGoal,
      makeProjection({
        status: 'impossible',
        actualAllocation: 0,
        achievabilityPercent: 0,
        estimatedFundedDate: null,
        paychecksToFullyFund: null,
      })
    );
    expect(messaging.timeline?.estimatedFundedDate).toBeNull();
    expect(messaging.timeline?.relativeToDeadline).toBe('unknown');
  });

  it('shows suggestions for tight goals when suggestions exist', () => {
    const messaging = buildGoalAchievabilityMessaging(
      baseGoal,
      makeProjection({
        status: 'achievable',
        achievabilityPercent: 100,
        marginPerPaycheck: 1,
        requiredPerPaycheck: 200,
        suggestions: [
          {
            id: 'suggestion-1',
            type: 'adjust_target_date',
            title: 'Move deadline',
            description: 'Push by one month',
            impactAmount: 50,
          },
        ],
      })
    );
    expect(messaging.comfortTier).toBe('achievable_tight');
    expect(messaging.showSuggestions).toBe(true);
  });

  it('uses shortfall margin fact when schedule has shortfalls', () => {
    const messaging = buildGoalAchievabilityMessaging(
      baseGoal,
      makeProjection({
        status: 'impossible',
        achievabilityPercent: 0,
        actualAllocation: 0,
        scheduleHealth: { tightPaycheckCount: 2, shortfallCount: 3, savingsTotal: 0 },
      })
    );
    expect(messaging.marginFact).toContain('3 paychecks already run short');
  });

  it('marks timeline as meets when funded on deadline', () => {
    const messaging = buildGoalAchievabilityMessaging(
      baseGoal,
      makeProjection({
        estimatedFundedDate: '2027-05-30',
        beatsDeadlineByPaychecks: 0,
        missesDeadlineByPaychecks: 0,
        status: 'achievable',
        achievabilityPercent: 100,
      })
    );
    expect(messaging.timeline?.relativeToDeadline).toBe('meets');
  });
});
