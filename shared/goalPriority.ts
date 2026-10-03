export const MIN_GOAL_PRIORITY = 1;
export const MAX_GOAL_PRIORITY = 5;
export const MAX_SAVINGS_GOALS = 5;

type GoalPriorityFields = {
  id: string;
  priority: number;
};

export function nextAvailableGoalPriority(goals: ReadonlyArray<Pick<GoalPriorityFields, 'priority'>>): number {
  const used = new Set(goals.map((goal) => goal.priority));
  for (let priority = MIN_GOAL_PRIORITY; priority <= MAX_GOAL_PRIORITY; priority++) {
    if (!used.has(priority)) {
      return priority;
    }
  }
  return MAX_GOAL_PRIORITY;
}

export function goalsWithPrioritySwap<T extends GoalPriorityFields>(
  goals: readonly T[],
  options: { movingId: string; fromPriority: number; toPriority: number }
): T[] {
  const { movingId, fromPriority, toPriority } = options;
  if (fromPriority === toPriority) {
    return goals.map((goal) => goal);
  }

  const occupant = goals.find((goal) => goal.id !== movingId && goal.priority === toPriority);
  return goals.map((goal) => {
    if (goal.id === movingId) {
      return { ...goal, priority: toPriority };
    }
    if (occupant && goal.id === occupant.id) {
      return { ...goal, priority: fromPriority };
    }
    return goal;
  });
}

/** Reassign remaining goals to 1..n in current priority order so no rank is skipped. */
export function compactGoalPriorities<T extends GoalPriorityFields>(goals: readonly T[]): T[] {
  const ranked = [...goals].sort((a, b) => a.priority - b.priority);
  const nextPriority = new Map(ranked.map((goal, index) => [goal.id, index + MIN_GOAL_PRIORITY]));
  return goals.map((goal) => {
    const priority = nextPriority.get(goal.id);
    if (priority === undefined || priority === goal.priority) {
      return goal;
    }
    return { ...goal, priority };
  });
}
