import { describe, it, expect } from 'vitest';
import { formatGoalCopy } from '../../../src/utils/goalAchievabilityCopy';

const baseVars = {
  goalName: 'Emergency Fund',
  targetAmount: '$11,000.00',
  alreadySaved: '$0.00',
  remainingAmount: '$11,000.00',
  allocatedAmount: '$11,000.00',
  achievableAmount: '$11,000.00',
  achievabilityPercent: 100,
  targetDate: 'May 2027',
  completionDate: 'Apr 15, 2027',
  paycheckCount: 50,
  weeksEarly: 6,
  weeksTiming: '6 weeks before your deadline',
  tightPaycheckCount: 8,
  shortfallCount: 0,
  savingsTotal: '$848.00',
  scheduleMonths: 12,
};

describe('formatGoalCopy', () => {
  it('substitutes placeholders in achievable_tight copy', () => {
    const result = formatGoalCopy('achievable_tight', baseVars);
    expect(result.headline).toBe("Funded, But It's Tight");
    expect(result.body).toContain('$11,000.00');
    expect(result.body).toContain('8 paycheck');
    expect(result.badge).toBe('Tight');
  });

  it('shows CTA for aggressive tier', () => {
    const result = formatGoalCopy('aggressive', baseVars);
    expect(result.cta).toBeDefined();
    expect(result.showSuggestions).toBe(true);
  });

  it('hides CTA for easily_achievable tier', () => {
    const result = formatGoalCopy('easily_achievable', baseVars);
    expect(result.cta).toBeUndefined();
    expect(result.showSuggestions).toBe(false);
  });

  it('uses shortfall margin fact for not_achievable', () => {
    const result = formatGoalCopy('not_achievable', { ...baseVars, shortfallCount: 3 }, {
      marginFactShortfall: '3 paychecks already run short, leaving nothing extra for goals.',
    });
    expect(result.marginFact).toContain('3 paychecks');
    expect(result.ariaMessage).toContain('No Room In This Budget');
  });

  it('overrides margin fact for partial tier when shortfalls exist', () => {
    const result = formatGoalCopy('partial', { ...baseVars, shortfallCount: 4, achievabilityPercent: 72 });
    expect(result.marginFact).toContain('4 paychecks already show shortfalls');
  });

  it('shows suggestions for partial tier when underfunded', () => {
    const underfunded = formatGoalCopy('partial', { ...baseVars, achievabilityPercent: 80 });
    expect(underfunded.showSuggestions).toBe(true);
  });

  it('uses if_partial suggestion rule for projected tier', () => {
    const underfunded = formatGoalCopy('projected', { ...baseVars, achievabilityPercent: 70 });
    const funded = formatGoalCopy('projected', { ...baseVars, achievabilityPercent: 100 });
    expect(underfunded.showSuggestions).toBe(true);
    expect(funded.showSuggestions).toBe(false);
  });

  it('uses if_any suggestion rule for tight tier', () => {
    const result = formatGoalCopy('achievable_tight', baseVars);
    expect(result.showSuggestions).toBe(false);
  });
});
