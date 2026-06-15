import { isBefore, isAfter, isEqual, parseISO } from 'date-fns';
import { SavingsGoal } from '../database.service';
import { PaycheckAssignment } from './types';

export function calculateGoalRequirementsPerPaycheck(
  goals: SavingsGoal[],
  assignments: PaycheckAssignment[]
): Map<string, number> {
  const requirements = new Map<string, number>();

  for (const goal of goals) {
    const goalDate = parseISO(goal.targetDate);
    const remainingAmount = goal.targetAmount - goal.alreadySaved;

    if (remainingAmount <= 0) {
      requirements.set(goal.id, 0);
      continue;
    }

    // Count paychecks before or on the goal date
    const relevantPaychecks = assignments.filter(a =>
      isBefore(a.date, goalDate) || isEqual(a.date, goalDate)
    );

    if (relevantPaychecks.length === 0) {
      requirements.set(goal.id, 0);
      continue;
    }

    const requiredPerPaycheck = remainingAmount / relevantPaychecks.length;
    requirements.set(goal.id, Math.round(requiredPerPaycheck * 100) / 100);
  }

  return requirements;
}

export function buildGoalReservePerPaycheck(
  assignments: PaycheckAssignment[],
  goals: SavingsGoal[]
): number[] {
  const reserves = new Array(assignments.length).fill(0);
  if (goals.length === 0) {
    return reserves;
  }

  const requirements = calculateGoalRequirementsPerPaycheck(goals, assignments);

  for (let i = 0; i < assignments.length; i++) {
    const paycheckDate = assignments[i].date;
    for (const goal of goals) {
      if (goal.targetAmount - goal.alreadySaved <= 0) {
        continue;
      }
      const goalDate = parseISO(goal.targetDate);
      if (isAfter(paycheckDate, goalDate)) {
        continue;
      }
      reserves[i] += requirements.get(goal.id) ?? 0;
    }
  }

  return reserves;
}
