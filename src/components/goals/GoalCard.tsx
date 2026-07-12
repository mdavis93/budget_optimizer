import { Pencil, Target, Trash2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import clsx from 'clsx';
import { GoalProjection, SavingsGoal } from '../../types';
import { buildGoalAchievabilityMessaging } from '../../utils/goalAchievabilityMessaging';
import { formatCurrency } from '../../utils/formatCurrency';
import GoalAchievabilityPanel from './GoalAchievabilityPanel';

interface GoalCardProps {
  goal: SavingsGoal;
  projection?: GoalProjection;
  minCashOnHand: number;
  onEdit: (goal: SavingsGoal) => void;
  onDelete: (goalId: string) => void;
  onViewSchedule: (link: { goalId: string; highlightPaycheckDate?: string }) => void;
}

export default function GoalCard({
  goal,
  projection,
  minCashOnHand,
  onEdit,
  onDelete,
  onViewSchedule,
}: GoalCardProps) {
  const remainingAmount = goal.targetAmount - goal.alreadySaved;
  const messaging = projection
    ? buildGoalAchievabilityMessaging(goal, projection, minCashOnHand)
    : null;
  const statusPercentColor =
    projection && projection.achievabilityPercent >= 100
      ? 'text-success-600 dark:text-success-400'
      : projection && projection.achievabilityPercent >= 50
        ? 'text-warning-600 dark:text-warning-400'
        : 'text-danger-600 dark:text-danger-400';

  return (
    <div className="card">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-(--color-surface-hover)">
            <Target className="w-5 h-5 text-(--color-text-muted)" />
          </div>
          <div>
            <h3 className="font-semibold">{goal.name}</h3>
            <p className="text-sm text-(--color-text-secondary)">
              Priority: {goal.priority}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onEdit(goal)}
            className="p-2 hover:bg-(--color-surface-hover) rounded-lg transition-colors"
            aria-label={`Edit ${goal.name}`}
          >
            <Pencil className="w-4 h-4 text-(--color-text-muted)" />
          </button>
          <button
            onClick={() => onDelete(goal.id)}
            className="p-2 hover:bg-danger-100 dark:hover:bg-danger-900/30 rounded-lg transition-colors"
            aria-label={`Delete ${goal.name}`}
          >
            <Trash2 className="w-4 h-4 text-danger-500" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div>
          <p className="text-xs text-(--color-text-muted) uppercase tracking-wide">Target</p>
          <p className="font-semibold">{formatCurrency(goal.targetAmount)}</p>
        </div>
        <div>
          <p className="text-xs text-(--color-text-muted) uppercase tracking-wide">Already Saved</p>
          <p className="font-semibold">{formatCurrency(goal.alreadySaved)}</p>
        </div>
        <div>
          <p className="text-xs text-(--color-text-muted) uppercase tracking-wide">Remaining</p>
          <p className="font-semibold">{formatCurrency(remainingAmount)}</p>
        </div>
        <div>
          <p className="text-xs text-(--color-text-muted) uppercase tracking-wide">Deadline</p>
          <p className="font-semibold">{format(parseISO(goal.targetDate), 'MMM yyyy')}</p>
        </div>
      </div>

      {projection ? (
        <>
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium">Achievability</span>
              <span className={clsx('text-sm font-semibold', statusPercentColor)}>
                {projection.achievabilityPercent}%
              </span>
            </div>
            <div className="relative w-full bg-(--color-surface-hover) rounded-full h-5">
              <div
                className="h-5 rounded-full transition-all bg-purple-500"
                style={{ width: `${Math.min(100, projection.achievabilityPercent)}%` }}
              />
              {projection.achievabilityPercent < 90 && (
                <span
                  className="absolute inset-0 flex items-center justify-center text-xs font-medium"
                  style={{
                    color: projection.achievabilityPercent > 30 ? 'white' : 'var(--color-text-secondary)',
                    textShadow: projection.achievabilityPercent > 30 ? '0 1px 2px rgba(0,0,0,0.3)' : 'none',
                  }}
                >
                  {formatCurrency(goal.alreadySaved + (projection.actualAllocation || 0))} allocated
                </span>
              )}
            </div>
          </div>

          <GoalAchievabilityPanel
            goal={goal}
            projection={projection}
            messaging={messaging}
            minCashOnHand={minCashOnHand}
            isLoading={false}
            onViewSchedule={onViewSchedule}
            onEditGoal={() => onEdit(goal)}
          />
        </>
      ) : (
        <GoalAchievabilityPanel
          goal={goal}
          projection={null}
          messaging={null}
          isLoading
        />
      )}
    </div>
  );
}
