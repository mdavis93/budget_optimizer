import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import clsx from 'clsx';
import type { PayCycleBoardModel, PayCycleChip, PayCycleDay } from '../../utils/payCycleBoard';

interface PayCycleBoardProps {
  board: PayCycleBoardModel;
  todayIso: string;
  formatCurrency: (amount: number) => string;
}

function localDateFromIso(isoDate: string): Date {
  const [year, month, day] = isoDate.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatWeekdayMonthDay(isoDate: string): string {
  return localDateFromIso(isoDate).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatMonthDay(isoDate: string): string {
  return localDateFromIso(isoDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function dayNumberLabel(isoDate: string): string {
  return String(localDateFromIso(isoDate).getDate());
}

function Figure({
  label,
  value,
  valueClassName,
  testId,
  shortfall,
}: {
  label: string;
  value: string;
  valueClassName?: string;
  testId?: string;
  shortfall?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-(--color-text-muted) mb-0.5">{label}</p>
      <p
        data-testid={testId}
        data-shortfall={shortfall == null ? undefined : shortfall ? 'true' : 'false'}
        className={clsx('text-sm font-semibold', valueClassName)}
      >
        {value}
      </p>
    </div>
  );
}

function BillChip({
  chip,
  formatCurrency,
}: {
  chip: PayCycleChip;
  formatCurrency: (amount: number) => string;
}) {
  return (
    <div
      data-coverage={chip.coverage}
      title={chip.creditorName}
      className={clsx(
        'text-xs px-1.5 py-0.5 rounded-sm flex items-center gap-1 min-w-0',
        chip.coverage === 'highlighted' &&
          'bg-primary-100 text-primary-800 dark:bg-primary-500/20 dark:text-primary-200',
        chip.coverage === 'other' &&
          'border border-(--color-border) text-(--color-text-secondary) bg-transparent',
        chip.isUnpayable && 'border border-dashed border-(--color-border) opacity-80'
      )}
    >
      <span className={clsx('truncate min-w-0', chip.isUnpayable && 'line-through')}>
        {chip.creditorName}
      </span>
      {chip.isUnpayable ? (
        <span className="shrink-0 text-(--color-text-muted)">Unpayable</span>
      ) : null}
      {chip.coverage === 'other' ? (
        <span className="shrink-0 text-(--color-text-muted)">{formatMonthDay(chip.paidByPaycheckDate)}</span>
      ) : null}
      <span className="font-mono text-xs shrink-0 ml-auto">{formatCurrency(chip.amount)}</span>
    </div>
  );
}

function DayCell({
  day,
  todayIso,
  formatCurrency,
}: {
  day: PayCycleDay;
  todayIso: string;
  formatCurrency: (amount: number) => string;
}) {
  const isToday = day.isoDate === todayIso;

  return (
    <div
      data-testid={`pay-cycle-day-${day.isoDate}`}
      data-in-period={day.inPeriod ? 'true' : 'false'}
      data-today={isToday ? 'true' : 'false'}
      className={clsx(
        'p-2 min-h-[88px]',
        day.inPeriod
          ? 'bg-primary-50/60 dark:bg-primary-500/10'
          : 'bg-(--color-bg-primary)',
        isToday && 'ring-2 ring-inset ring-primary-500'
      )}
    >
      <p
        className={clsx(
          'text-xs font-semibold mb-1',
          isToday && 'text-primary-500'
        )}
      >
        {dayNumberLabel(day.isoDate)}
      </p>
      {day.isPayday && day.depositAmount != null ? (
        <div className="text-xs font-semibold px-1.5 py-0.5 rounded-sm mb-1 bg-success-100 text-success-700 dark:bg-success-500/20 dark:text-success-400 truncate">
          +{formatCurrency(day.depositAmount)}
        </div>
      ) : null}
      <div className="space-y-1">
        {day.bills.map((chip) => (
          <BillChip
            key={`${chip.billId}-${chip.billDate}-${chip.paidByPaycheckDate}`}
            chip={chip}
            formatCurrency={formatCurrency}
          />
        ))}
      </div>
    </div>
  );
}

function OffGridList({
  heading,
  chips,
  formatCurrency,
}: {
  heading: string;
  chips: PayCycleChip[];
  formatCurrency: (amount: number) => string;
}) {
  if (chips.length === 0) {
    return null;
  }

  return (
    <div className="mt-4">
      <h4 className="text-sm font-medium text-(--color-text-secondary) mb-2">{heading}</h4>
      <ul className="space-y-1.5">
        {chips.map((chip) => (
          <li
            key={`${chip.billId}-${chip.billDate}`}
            className="text-sm flex items-center justify-between gap-2"
          >
            <span className="min-w-0 truncate">
              <span className="font-medium">{chip.creditorName}</span>
              <span className="text-(--color-text-muted)"> · due {formatMonthDay(chip.billDate)}</span>
            </span>
            <span className="font-mono text-sm text-(--color-text-secondary) shrink-0">
              {formatCurrency(chip.amount)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function PayCycleBoard({ board, todayIso, formatCurrency }: PayCycleBoardProps) {
  const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h3 className="font-semibold">Upcoming pay cycle</h3>
          <p className="text-sm text-(--color-text-secondary) mt-0.5">
            {formatWeekdayMonthDay(board.paydayIso)}
          </p>
        </div>
        <Link
          to="/schedule"
          className="text-sm text-primary-500 hover:text-primary-600 flex items-center gap-1 shrink-0"
        >
          View month <ArrowRight className="w-4 h-4" />
        </Link>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-3 mb-3">
        <Figure label="Income" value={formatCurrency(board.totalIncome)} />
        <Figure label="Bills" value={formatCurrency(board.totalBills)} />
        {board.totalGoalDeposits > 0 ? (
          <Figure label="Goals" value={formatCurrency(board.totalGoalDeposits)} />
        ) : null}
        {board.savingsDeposit > 0 ? (
          <Figure label="Savings" value={formatCurrency(board.savingsDeposit)} />
        ) : null}
        <Figure
          label="Left"
          value={formatCurrency(board.budgetRemaining)}
          testId="pay-cycle-remainder"
          shortfall={board.isShortfall}
          valueClassName={board.isShortfall ? 'text-danger-500' : undefined}
        />
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-(--color-text-muted) mb-4">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block w-3 h-3 rounded-sm bg-primary-100 dark:bg-primary-500/30"
          />
          Paid by this paycheck
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block w-3 h-3 rounded-sm border border-(--color-border) bg-transparent"
          />
          Paid by another paycheck
        </span>
      </div>

      <div className="grid grid-cols-7 gap-px bg-(--color-border) rounded-lg overflow-hidden border border-(--color-border)">
        {weekdayLabels.map((label) => (
          <div
            key={label}
            className="bg-(--color-bg-tertiary) px-2 py-1.5 text-center text-xs font-medium uppercase tracking-wide text-(--color-text-muted)"
          >
            {label}
          </div>
        ))}
        {board.days.map((day) => (
          <DayCell
            key={day.isoDate}
            day={day}
            todayIso={todayIso}
            formatCurrency={formatCurrency}
          />
        ))}
      </div>

      <OffGridList
        heading={`Also paid by ${formatMonthDay(board.paydayIso)}${
          board.periodEndIso ? `, due after ${formatMonthDay(board.periodEndIso)}` : ''
        }`}
        chips={board.dueAfterPeriod}
        formatCurrency={formatCurrency}
      />

      <OffGridList
        heading="Due earlier this pay period"
        chips={board.dueEarlierThisPeriod}
        formatCurrency={formatCurrency}
      />
    </div>
  );
}
