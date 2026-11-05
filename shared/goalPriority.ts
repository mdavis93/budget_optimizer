export const MIN_GOAL_PRIORITY = 1;
export const MAX_GOAL_PRIORITY = 5;
export const MAX_SAVINGS_GOALS = MAX_GOAL_PRIORITY - MIN_GOAL_PRIORITY + 1;
/** Stored priority for a goal with no due date. It always sorts after dated goals. */
export const OPEN_ENDED_GOAL_PRIORITY = 0;

export const GOAL_PRIORITY_LABELS: Record<number, string> = {
  1: '1 - Highest',
  2: '2 - High',
  3: '3 - Medium',
  4: '4 - Low',
  5: '5 - Lowest',
};

type GoalPriorityFields = {
  id: string;
  priority: number;
  openEnded?: boolean;
};

export function isOpenEndedGoal(goal: { openEnded?: boolean } | null | undefined): boolean {
  return goal?.openEnded === true;
}

export function nextAvailableGoalPriority(
  goals: ReadonlyArray<Pick<GoalPriorityFields, 'priority' | 'openEnded'>>
): number {
  const used = new Set(
    goals.filter((goal) => !isOpenEndedGoal(goal)).map((goal) => goal.priority)
  );
  for (let priority = MIN_GOAL_PRIORITY; priority <= MAX_GOAL_PRIORITY; priority++) {
    if (!used.has(priority)) {
      return priority;
    }
  }
  return MAX_GOAL_PRIORITY;
}

/** Dated goals first, then open-ended. Equal ranks keep a stable createdAt/id order. */
export function compareGoalsByPriority<
  T extends { id?: string; priority: number; openEnded?: boolean; createdAt?: string }
>(left: T, right: T): number {
  const leftOpen = isOpenEndedGoal(left) ? 1 : 0;
  const rightOpen = isOpenEndedGoal(right) ? 1 : 0;
  if (leftOpen !== rightOpen) return leftOpen - rightOpen;
  if (left.priority !== right.priority) return left.priority - right.priority;
  if (left.createdAt && right.createdAt && left.createdAt !== right.createdAt) {
    return left.createdAt.localeCompare(right.createdAt);
  }
  if (left.id && right.id && left.id !== right.id) return left.id.localeCompare(right.id);
  return 0;
}

export function goalsWithPrioritySwap<T extends GoalPriorityFields>(
  goals: readonly T[],
  options: { movingId: string; fromPriority: number; toPriority: number }
): T[] {
  const { movingId, fromPriority, toPriority } = options;
  if (fromPriority === toPriority) {
    return goals.map((goal) => goal);
  }

  const occupant = goals.find(
    (goal) => goal.id !== movingId && !isOpenEndedGoal(goal) && goal.priority === toPriority
  );
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

/** Reassign remaining dated goals to 1..n in current priority order so no rank is skipped. */
export function compactGoalPriorities<T extends GoalPriorityFields>(goals: readonly T[]): T[] {
  const ranked = goals
    .filter((goal) => !isOpenEndedGoal(goal))
    .sort((a, b) => a.priority - b.priority);
  const nextPriority = new Map(ranked.map((goal, index) => [goal.id, index + MIN_GOAL_PRIORITY]));
  return goals.map((goal) => {
    if (isOpenEndedGoal(goal)) {
      return goal.priority === OPEN_ENDED_GOAL_PRIORITY
        ? goal
        : { ...goal, priority: OPEN_ENDED_GOAL_PRIORITY };
    }
    const priority = nextPriority.get(goal.id);
    if (priority === undefined || priority === goal.priority) {
      return goal;
    }
    return { ...goal, priority };
  });
}

/**
 * Give a former open-ended goal a dated rank. An occupant of that rank moves to the
 * next free rank, because an open-ended goal was not holding one to swap back.
 */
export function assignPriorityFromOpenEnded<T extends GoalPriorityFields>(
  goals: readonly T[],
  goalId: string,
  toPriority: number
): T[] {
  const occupant = goals.find(
    (goal) => goal.id !== goalId && !isOpenEndedGoal(goal) && goal.priority === toPriority
  );
  if (!occupant) {
    return goals.map((goal) =>
      goal.id === goalId ? { ...goal, openEnded: false, priority: toPriority } : goal
    );
  }

  const used = new Set<number>([toPriority]);
  for (const goal of goals) {
    if (goal.id === goalId || goal.id === occupant.id || isOpenEndedGoal(goal)) continue;
    used.add(goal.priority);
  }
  let displaced = MIN_GOAL_PRIORITY;
  while (used.has(displaced) && displaced <= MAX_GOAL_PRIORITY) displaced += 1;

  return goals.map((goal) => {
    if (goal.id === goalId) return { ...goal, openEnded: false, priority: toPriority };
    if (goal.id === occupant.id) return { ...goal, priority: displaced };
    return goal;
  });
}
