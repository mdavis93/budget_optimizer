import { memo, useState, useMemo } from 'react';
import { format, startOfMonth, isSameDay } from 'date-fns';
import { PiggyBank } from 'lucide-react';
import { PaycheckEntry } from '../../types';
import clsx from 'clsx';
import { formatCurrency } from '../../utils/formatCurrency';

interface CalendarViewProps {
  paychecks: PaycheckEntry[];
}

const CalendarView = memo(function CalendarView({ paychecks }: CalendarViewProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  
  const paychecksByDate = useMemo(() => {
    const map = new Map<string, PaycheckEntry>();
    for (const paycheck of paychecks) {
      map.set(paycheck.date, paycheck);
    }
    return map;
  }, [paychecks]);

  const calendarDays = useMemo(() => {
    const start = startOfMonth(currentMonth);
    const startDay = start.getDay();
    const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
    
    const days: (Date | null)[] = [];
    
    for (let i = 0; i < startDay; i++) {
      days.push(null);
    }
    
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), i));
    }
    
    return days;
  }, [currentMonth]);

  const formatWholeCurrency = (amount: number) => formatCurrency(amount, { fractionDigits: 0 });

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1))}
          className="btn-ghost"
          aria-label="Previous month"
        >
          ← Previous
        </button>
        <h3 className="font-semibold text-lg">
          {format(currentMonth, 'MMMM yyyy')}
        </h3>
        <button
          onClick={() => setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1))}
          className="btn-ghost"
          aria-label="Next month"
        >
          Next →
        </button>
      </div>
      
      <div className="grid grid-cols-7 gap-px bg-(--color-border) rounded-lg overflow-hidden">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
          <div key={day} className="bg-(--color-bg-tertiary) p-2 text-center text-sm font-medium">
            {day}
          </div>
        ))}
        
        {calendarDays.map((day, index) => {
          if (!day) {
            return <div key={index} className="bg-(--color-bg-primary) p-2 min-h-[100px]" />;
          }
          
          const dateKey = format(day, 'yyyy-MM-dd');
          const paycheck = paychecksByDate.get(dateKey);
          const isToday = isSameDay(day, new Date());
          
          return (
            <div
              key={index}
              className={clsx(
                'bg-(--color-bg-primary) p-2 min-h-[100px]',
                paycheck?.isShortfall && 'bg-danger-50 dark:bg-danger-500/10',
                isToday && 'ring-2 ring-inset ring-primary-500'
              )}
            >
              <p className={clsx(
                'text-sm font-medium mb-1',
                isToday && 'text-primary-500'
              )}>
                {format(day, 'd')}
              </p>
              {paycheck && (
                <div className="space-y-1">
                  <div className="text-xs px-1 py-0.5 rounded-sm bg-success-100 text-success-700 dark:bg-success-500/20 dark:text-success-400 truncate">
                    +{formatWholeCurrency(paycheck.totalIncome)}
                  </div>
                  {paycheck.bills.length > 0 && (
                    <div className="text-xs px-1 py-0.5 rounded-sm bg-danger-100 text-danger-700 dark:bg-danger-500/20 dark:text-danger-400 truncate">
                      {paycheck.bills.length} bills
                    </div>
                  )}
                  {paycheck.savingsDeposit > 0 && (
                    <div className="text-xs px-1 py-0.5 rounded-sm bg-primary-100 text-primary-700 dark:bg-primary-500/20 dark:text-primary-400 truncate flex items-center gap-0.5">
                      <PiggyBank className="w-3 h-3" />
                      {formatWholeCurrency(paycheck.savingsDeposit)}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

export default CalendarView;
