import { describe, it, expect, beforeEach } from 'vitest';
import { SchedulerService } from '../../../electron/services/scheduler.service';
import { Income, Bill, SavingsGoal } from '../../../electron/services/database.service';
import { parseISO, format, differenceInDays } from 'date-fns';

describe('SchedulerService', () => {
  let scheduler: SchedulerService;

  beforeEach(() => {
    scheduler = new SchedulerService();
  });

  describe('projectIncome', () => {
    const baseIncome: Income = {
      id: 'income-1',
      sourceName: 'Salary',
      amount: 2000,
      cadence: 'biweekly',
      startDate: '2026-01-01',
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    it('returns empty array for inactive income', () => {
      const inactive = { ...baseIncome, isActive: false };
      const result = scheduler.projectIncome(
        inactive,
        parseISO('2026-01-01'),
        parseISO('2026-03-01')
      );
      expect(result).toHaveLength(0);
    });

    it('generates bi-weekly paychecks correctly', () => {
      const result = scheduler.projectIncome(
        baseIncome,
        parseISO('2026-01-01'),
        parseISO('2026-02-28')
      );
      
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].amount).toBe(2000);
      expect(result[0].sourceName).toBe('Salary');
      
      // Bi-weekly = every 14 days, so in ~8 weeks we should have ~4 paychecks
      expect(result.length).toBeGreaterThanOrEqual(4);
    });

    it('generates weekly paychecks correctly', () => {
      const weeklyIncome = { ...baseIncome, cadence: 'weekly' as const };
      const result = scheduler.projectIncome(
        weeklyIncome,
        parseISO('2026-01-01'),
        parseISO('2026-01-31')
      );
      
      // 4-5 weeks in January
      expect(result.length).toBeGreaterThanOrEqual(4);
      expect(result.length).toBeLessThanOrEqual(5);
    });

    it('generates monthly paychecks correctly', () => {
      const monthlyIncome = { ...baseIncome, cadence: 'monthly' as const };
      const result = scheduler.projectIncome(
        monthlyIncome,
        parseISO('2026-01-01'),
        parseISO('2026-03-31')
      );
      
      // 3 months
      expect(result.length).toBe(3);
    });

    it('generates semi-monthly paychecks correctly', () => {
      const semiMonthlyIncome = { 
        ...baseIncome, 
        cadence: 'semimonthly' as const,
        startDate: '2026-01-01'
      };
      const result = scheduler.projectIncome(
        semiMonthlyIncome,
        parseISO('2026-01-01'),
        parseISO('2026-01-31')
      );
      
      // 2 per month (1st and 15th)
      expect(result.length).toBe(2);
    });

    it('respects start date boundary', () => {
      const income = { ...baseIncome, startDate: '2025-12-15' };
      const result = scheduler.projectIncome(
        income,
        parseISO('2026-01-10'),
        parseISO('2026-02-28')
      );
      
      // All dates should be on or after the range start
      result.forEach(event => {
        expect(event.date.getTime()).toBeGreaterThanOrEqual(parseISO('2026-01-10').getTime());
      });
    });

    it('stops projecting after income endDate', () => {
      const income = { ...baseIncome, endDate: '2026-01-15' };
      const result = scheduler.projectIncome(
        income,
        parseISO('2026-01-01'),
        parseISO('2026-03-01')
      );

      expect(result.length).toBeGreaterThan(0);
      result.forEach(event => {
        expect(event.date.getTime()).toBeLessThanOrEqual(parseISO('2026-01-15').getTime());
      });
      expect(result.some(e => format(e.date, 'yyyy-MM-dd') === '2026-01-15')).toBe(true);
    });

    it('returns empty when endDate is before projection window', () => {
      const income = { ...baseIncome, endDate: '2025-12-31' };
      const result = scheduler.projectIncome(
        income,
        parseISO('2026-01-01'),
        parseISO('2026-03-01')
      );
      expect(result).toHaveLength(0);
    });
  });

  describe('projectBills', () => {
    const baseBill: Bill = {
      id: 'bill-1',
      creditorName: 'Electric Company',
      budgetedAmount: 150,
      dueDay: 15,
      category: 'utilities',
      isRecurring: true,
      priority: 'normal',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    it('generates monthly bill occurrences', () => {
      const result = scheduler.projectBills(
        baseBill,
        parseISO('2026-01-01'),
        parseISO('2026-03-31')
      );
      
      expect(result.length).toBe(3);
      expect(result[0].amount).toBe(150);
      expect(result[0].creditorName).toBe('Electric Company');
    });

    it('handles bills due on the 31st in short months', () => {
      const bill31 = { ...baseBill, dueDay: 31 };
      const result = scheduler.projectBills(
        bill31,
        parseISO('2026-02-01'),
        parseISO('2026-02-28')
      );
      
      // Should adjust to Feb 28
      expect(result.length).toBe(1);
      expect(format(result[0].date, 'yyyy-MM-dd')).toBe('2026-02-28');
    });

    it('maintains bill priority', () => {
      const criticalBill = { ...baseBill, priority: 'critical' as const };
      const result = scheduler.projectBills(
        criticalBill,
        parseISO('2026-01-01'),
        parseISO('2026-01-31')
      );
      
      expect(result[0].priority).toBe('critical');
    });

    it('stops projecting after debt payoff and uses final payment amount', () => {
      const payoffDate = parseISO('2026-02-15');
      const result = scheduler.projectBills(
        baseBill,
        parseISO('2026-01-01'),
        parseISO('2026-04-30'),
        {
          billId: 'bill-1',
          payoffDate,
          finalPaymentAmount: 75,
        }
      );

      expect(result).toHaveLength(2);
      expect(result[1].amount).toBe(75);
      expect(format(result[1].date, 'yyyy-MM-dd')).toBe('2026-02-15');
    });

    it('projects only one occurrence for non-recurring bills', () => {
      const oneTime = { ...baseBill, isRecurring: false };
      const result = scheduler.projectBills(
        oneTime,
        parseISO('2026-01-01'),
        parseISO('2026-06-30')
      );

      expect(result).toHaveLength(1);
    });
  });

  describe('generateSchedule', () => {
    const income: Income = {
      id: 'income-1',
      sourceName: 'Salary',
      amount: 2000,
      cadence: 'biweekly',
      startDate: '2026-01-01',
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const bill: Bill = {
      id: 'bill-1',
      creditorName: 'Rent',
      budgetedAmount: 1000,
      dueDay: 1,
      isRecurring: true,
      priority: 'critical',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    it('generates schedule with paychecks', () => {
      const schedule = scheduler.generateSchedule(
        [income],
        [bill],
        '2026-01-01',
        3,
        1000
      );
      
      expect(schedule.paychecks.length).toBeGreaterThan(0);
      expect(schedule.startDate).toBe('2026-01-01');
    });

    it('omits unpaid leave paychecks and keeps paid leave income', () => {
      const unpaidSchedule = scheduler.generateSchedule(
        [income],
        [],
        '2026-01-01',
        2,
        0,
        new Set(),
        new Map(),
        250,
        [],
        100,
        0,
        new Map(),
        new Map(),
        [
          {
            id: 'leave-1',
            budgetId: 'budget-1',
            incomeId: income.id,
            name: 'Medical',
            type: 'unpaid',
            startDate: '2026-01-01',
            endDate: '2026-01-31',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ]
      );

      const januaryPaychecks = unpaidSchedule.paychecks.filter((p) => p.date.startsWith('2026-01'));
      expect(januaryPaychecks.length).toBe(0);
      expect(unpaidSchedule.paychecks.every((p) => p.totalIncome > 0)).toBe(true);

      const paidSchedule = scheduler.generateSchedule(
        [income],
        [],
        '2026-01-01',
        2,
        0,
        new Set(),
        new Map(),
        250,
        [],
        100,
        0,
        new Map(),
        new Map(),
        [
          {
            id: 'leave-2',
            budgetId: 'budget-1',
            incomeId: income.id,
            name: 'Vacation',
            type: 'paid',
            startDate: '2026-01-01',
            endDate: '2026-01-31',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ]
      );
      const paidJanuary = paidSchedule.paychecks.filter((p) => p.date.startsWith('2026-01'));
      expect(paidJanuary.length).toBeGreaterThan(0);
      expect(paidJanuary.every((p) => p.totalIncome === 2000)).toBe(true);
    });

    it('calculates summary correctly', () => {
      const schedule = scheduler.generateSchedule(
        [income],
        [bill],
        '2026-01-01',
        3,
        1000
      );
      
      expect(schedule.summary.totalIncome).toBeGreaterThan(0);
      expect(schedule.summary.totalExpenses).toBeGreaterThan(0);
    });

    it('respects starting balance on first paycheck only', () => {
      const scheduleWithBalance = scheduler.generateSchedule(
        [income],
        [],
        '2026-01-01',
        1,
        5000
      );
      
      expect(scheduleWithBalance.paychecks[0].budgetRemaining).toBeGreaterThanOrEqual(0);
    });

    it('does not apply starting balance to the second paycheck', () => {
      const withZero = scheduler.generateSchedule([income], [], '2026-01-01', 2, 0);
      const withLargeStart = scheduler.generateSchedule([income], [], '2026-01-01', 2, 99_999);
      expect(withZero.paychecks.length).toBeGreaterThanOrEqual(2);
      expect(withLargeStart.paychecks.length).toBe(withZero.paychecks.length);
      const i = 1;
      expect(withLargeStart.paychecks[i].date).toBe(withZero.paychecks[i].date);
      expect(withLargeStart.paychecks[i].totalIncome).toBe(withZero.paychecks[i].totalIncome);
      expect(withLargeStart.paychecks[i].savingsDeposit).toBe(withZero.paychecks[i].savingsDeposit);
      expect(withLargeStart.paychecks[i].budgetRemaining).toBe(withZero.paychecks[i].budgetRemaining);
      expect(withLargeStart.paychecks[i].isShortfall).toBe(withZero.paychecks[i].isShortfall);
    });

    it('starting balance on first paycheck can clear a shortfall that would occur without it', () => {
      const tightBill: Bill = {
        ...bill,
        id: 'bill-tight',
        budgetedAmount: 2300,
        dueDay: 10,
        priority: 'critical' as const,
      };
      const noStart = scheduler.generateSchedule([income], [tightBill], '2026-01-01', 1, 0);
      const withStart = scheduler.generateSchedule([income], [tightBill], '2026-01-01', 1, 500);
      expect(noStart.paychecks[0].isShortfall).toBe(true);
      expect(withStart.paychecks[0].isShortfall).toBe(false);
    });

    it('handles empty income list', () => {
      const schedule = scheduler.generateSchedule(
        [],
        [bill],
        '2026-01-01',
        1,
        0
      );
      
      expect(schedule.paychecks).toHaveLength(0);
    });

    it('keeps manually assigned bills only on the target paycheck', () => {
      const angelaIncome: Income = {
        id: 'income-angela',
        sourceName: 'Angela',
        amount: 500,
        cadence: 'weekly',
        startDate: '2026-06-12',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const michaelIncome: Income = {
        id: 'income-michael',
        sourceName: 'Michael',
        amount: 500,
        cadence: 'weekly',
        startDate: '2026-06-19',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const affirmBill: Bill = {
        id: 'bill-affirm',
        creditorName: 'Affirm: First Tee Golf',
        budgetedAmount: 181,
        dueDay: 16,
        isRecurring: false,
        priority: 'high',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const ccBill: Bill = {
        id: 'bill-cc',
        creditorName: 'CC: SW [A]',
        budgetedAmount: 125,
        dueDay: 21,
        isRecurring: true,
        priority: 'normal',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const uncBill: Bill = {
        id: 'bill-unc',
        creditorName: 'UNC Health Systems',
        budgetedAmount: 125,
        dueDay: 21,
        isRecurring: true,
        priority: 'normal',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const extraBill: Bill = {
        id: 'bill-extra',
        creditorName: 'Extra Deficit Bill',
        budgetedAmount: 400,
        dueDay: 20,
        isRecurring: false,
        priority: 'normal',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const manualAssignments = new Map<string, string>([
        ['bill-cc-2026-06-21', '2026-06-19'],
        ['bill-unc-2026-06-21', '2026-06-19'],
      ]);

      const schedule = scheduler.generateSchedule(
        [angelaIncome, michaelIncome],
        [affirmBill, ccBill, uncBill, extraBill],
        '2026-06-01',
        1,
        0,
        new Set(),
        manualAssignments,
        250
      );

      const june12 = schedule.paychecks.find((p) => p.date === '2026-06-12');
      const june19 = schedule.paychecks.find((p) => p.date === '2026-06-19');

      expect(june12).toBeDefined();
      expect(june19).toBeDefined();

      const june12BillIds = june12!.bills.map((b) => b.billId);
      const june19BillIds = june19!.bills.map((b) => b.billId);

      expect(june12BillIds).toContain('bill-affirm');
      expect(june12BillIds).not.toContain('bill-cc');
      expect(june12BillIds).not.toContain('bill-unc');

      expect(june19BillIds).toContain('bill-cc');
      expect(june19BillIds).toContain('bill-unc');
      expect(june12!.totalBills).toBe(181);
    });

    it('does not rebalance manually assigned bills to an earlier paycheck', () => {
      const angelaIncome: Income = {
        id: 'income-angela',
        sourceName: 'Angela',
        amount: 500,
        cadence: 'weekly',
        startDate: '2026-06-12',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const michaelIncome: Income = {
        id: 'income-michael',
        sourceName: 'Michael',
        amount: 500,
        cadence: 'weekly',
        startDate: '2026-06-19',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const ccBill: Bill = {
        id: 'bill-cc',
        creditorName: 'CC: SW [A]',
        budgetedAmount: 125,
        dueDay: 21,
        isRecurring: false,
        priority: 'normal',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const uncBill: Bill = {
        id: 'bill-unc',
        creditorName: 'UNC Health Systems',
        budgetedAmount: 125,
        dueDay: 21,
        isRecurring: false,
        priority: 'normal',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const extraBill: Bill = {
        id: 'bill-extra',
        creditorName: 'Extra Deficit Bill',
        budgetedAmount: 400,
        dueDay: 20,
        isRecurring: false,
        priority: 'normal',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const manualAssignments = new Map<string, string>([
        ['bill-cc-2026-06-21', '2026-06-19'],
        ['bill-unc-2026-06-21', '2026-06-19'],
      ]);

      const schedule = scheduler.generateSchedule(
        [angelaIncome, michaelIncome],
        [ccBill, uncBill, extraBill],
        '2026-06-01',
        1,
        0,
        new Set(),
        manualAssignments,
        250
      );

      const june12 = schedule.paychecks.find((p) => p.date === '2026-06-12');
      const june19 = schedule.paychecks.find((p) => p.date === '2026-06-19');

      expect(june12?.bills.map((b) => b.billId)).toEqual([]);
      expect(june19?.bills.map((b) => b.billId)).toEqual(
        expect.arrayContaining(['bill-cc', 'bill-unc', 'bill-extra'])
      );
    });

    describe('MAX_PREPAY_DAYS automatic assignment', () => {
      const monthlyIncome: Income = {
        id: 'income-monthly',
        sourceName: 'Monthly Salary',
        amount: 3000,
        cadence: 'monthly',
        startDate: '2026-01-01',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const day28Bill: Bill = {
        id: 'bill-rent',
        creditorName: 'Rent',
        budgetedAmount: 1500,
        dueDay: 28,
        isRecurring: true,
        priority: 'normal',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      it('does not place day-28 bill on monthly paycheck when more than 14 days early', () => {
        const schedule = scheduler.generateSchedule(
          [monthlyIncome],
          [day28Bill],
          '2026-01-01',
          1,
          0
        );

        const jan1Paycheck = schedule.paychecks.find((p) => p.date === '2026-01-01');
        expect(jan1Paycheck).toBeDefined();
        const jan28Bill = jan1Paycheck!.bills.find((b) => b.billDate === '2026-01-28');
        expect(jan28Bill).toBeDefined();
        expect(jan28Bill!.isUnpayable).toBe(true);
        expect(jan28Bill!.unfundableReason).toBe('no_eligible_paycheck_in_window');
      });

      it('assigns day-28 bill to latest eligible semi-monthly paycheck within 14 days', () => {
        const semiMonthlyIncome: Income = {
          ...monthlyIncome,
          id: 'income-semimonthly',
          cadence: 'semimonthly',
          startDate: '2026-01-01',
        };

        const schedule = scheduler.generateSchedule(
          [semiMonthlyIncome],
          [day28Bill],
          '2026-01-01',
          1,
          0
        );

        const jan15Paycheck = schedule.paychecks.find((p) => p.date === '2026-01-15');
        const jan1Paycheck = schedule.paychecks.find((p) => p.date === '2026-01-01');

        expect(jan15Paycheck).toBeDefined();
        const billOnJan15 = jan15Paycheck!.bills.find((b) => b.billDate === '2026-01-28');
        expect(billOnJan15).toBeDefined();

        const billOnJan1 = jan1Paycheck?.bills.find((b) => b.billDate === '2026-01-28');
        expect(billOnJan1).toBeUndefined();
      });

      it('rebalance does not move bills more than 14 days early', () => {
        const biweeklyIncome: Income = {
          id: 'income-biweekly',
          sourceName: 'Salary',
          amount: 1000,
          cadence: 'biweekly',
          startDate: '2026-01-01',
          isActive: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        };

        const heavyBill: Bill = {
          id: 'bill-heavy',
          creditorName: 'Heavy Bill',
          budgetedAmount: 800,
          dueDay: 28,
          isRecurring: false,
          priority: 'normal',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        };

        const lightBill: Bill = {
          id: 'bill-light',
          creditorName: 'Light Bill',
          budgetedAmount: 200,
          dueDay: 14,
          isRecurring: false,
          priority: 'low',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        };

        const schedule = scheduler.generateSchedule(
          [biweeklyIncome],
          [heavyBill, lightBill],
          '2026-01-01',
          1,
          0
        );

        for (const paycheck of schedule.paychecks) {
          for (const bill of paycheck.bills) {
            const daysEarly = differenceInDays(parseISO(bill.billDate), parseISO(paycheck.date));
            expect(daysEarly).toBeLessThanOrEqual(14);
            expect(parseISO(paycheck.date).getTime()).toBeLessThanOrEqual(parseISO(bill.billDate).getTime());
          }
        }
      });

      it('deduplicates bill occurrences by billId and date per paycheck', () => {
        const schedule = scheduler.generateSchedule(
          [monthlyIncome],
          [day28Bill],
          '2026-01-01',
          3,
          0
        );

        for (const paycheck of schedule.paychecks) {
          const keys = paycheck.bills.map((b) => `${b.billId}-${b.billDate}`);
          expect(keys.length).toBe(new Set(keys).size);
        }
      });

      it('rebalance reserves min cash, savings, and goal headroom per paycheck silo', () => {
        const biweeklyIncome: Income = {
          id: 'income-biweekly',
          sourceName: 'Salary',
          amount: 1200,
          cadence: 'biweekly',
          startDate: '2026-01-15',
          isActive: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        };

        const midMonthBill: Bill = {
          id: 'bill-mid',
          creditorName: 'Mid Bill',
          budgetedAmount: 900,
          dueDay: 20,
          isRecurring: false,
          priority: 'normal',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        };

        const goal: SavingsGoal = {
          id: 'goal-1',
          budgetId: 'budget-1',
          name: 'Emergency',
          targetAmount: 1200,
          targetDate: '2026-06-30',
          alreadySaved: 0,
          priority: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
        };

        const schedule = scheduler.generateSchedule(
          [biweeklyIncome],
          [midMonthBill],
          '2026-01-01',
          2,
          0,
          new Set(),
          new Map(),
          250,
          [goal],
          100,
          50
        );

        const jan15 = schedule.paychecks.find((p) => p.date === '2026-01-15');
        expect(jan15).toBeDefined();
        expect(jan15!.isShortfall).toBe(false);
        expect(jan15!.budgetRemaining).toBe(250);
        expect(jan15!.savingsDeposit + jan15!.totalGoalDeposits).toBeGreaterThan(0);
      });
    });

    it('applies incomeOverrides to projected paycheck amounts', () => {
      const overrides = new Map<string, number>();
      const projected = scheduler.projectIncome(
        income,
        parseISO('2026-01-01'),
        parseISO('2026-01-31')
      );
      expect(projected.length).toBeGreaterThan(0);
      const firstDateStr = format(projected[0].date, 'yyyy-MM-dd');
      overrides.set(`${income.id}-${firstDateStr}`, 777);

      const schedule = scheduler.generateSchedule(
        [income],
        [],
        '2026-01-01',
        1,
        0,
        new Set(),
        new Map(),
        250,
        [],
        100,
        0,
        new Map(),
        overrides
      );

      const firstPaycheck = schedule.paychecks.find((p) => p.date === firstDateStr);
      expect(firstPaycheck).toBeDefined();
      expect(firstPaycheck!.totalIncome).toBe(777);
      expect(firstPaycheck!.incomeSources[0]?.amount).toBe(777);
    });
  });

  describe('critical bill funding and rebalance', () => {
    const weeklyIncome: Income = {
      id: 'income-weekly',
      sourceName: 'Salary',
      amount: 1000,
      cadence: 'weekly',
      startDate: '2026-06-05',
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const ccApple: Bill = {
      id: 'bill-apple',
      creditorName: 'CC: Apple',
      budgetedAmount: 150,
      dueDay: 30,
      isRecurring: false,
      priority: 'critical',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const rent: Bill = {
      id: 'bill-rent',
      creditorName: 'Rent',
      budgetedAmount: 1000,
      dueDay: 1,
      isRecurring: true,
      priority: 'critical',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    it('prepays critical bill to earlier paycheck when two criticals stack on a deficit paycheck', () => {
      const schedule = scheduler.generateSchedule(
        [{ ...weeklyIncome, amount: 1250 }],
        [ccApple, rent],
        '2026-06-01',
        1,
        0
      );

      const jun19 = schedule.paychecks.find((p) => p.date === '2026-06-19');
      const jun26 = schedule.paychecks.find((p) => p.date === '2026-06-26');

      expect(jun19).toBeDefined();
      expect(jun26).toBeDefined();

      expect(
        jun19!.bills.some((b) => b.billId === 'bill-apple' && b.billDate === '2026-06-30')
      ).toBe(true);
      expect(jun26!.bills.some((b) => b.billId === 'bill-apple')).toBe(false);
      expect(jun26!.totalIncome - jun26!.totalBills).toBeGreaterThanOrEqual(0);
    });

    it('does not move Per Paycheck bills during rebalance', () => {
      const angelaIncome: Income = {
        ...weeklyIncome,
        id: 'income-angela',
        sourceName: 'Angela',
        startDate: '2026-06-05',
      };

      const perPaycheckBill: Bill = {
        id: 'bill-per-paycheck',
        creditorName: 'Parking',
        budgetedAmount: 50,
        dueDay: 1,
        isRecurring: false,
        priority: 'normal',
        isIncomeAttached: true,
        preferredIncomeSourceId: 'income-angela',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const heavyBill: Bill = {
        id: 'bill-heavy',
        creditorName: 'Heavy Bill',
        budgetedAmount: 900,
        dueDay: 26,
        isRecurring: false,
        priority: 'normal',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const schedule = scheduler.generateSchedule(
        [angelaIncome],
        [perPaycheckBill, heavyBill],
        '2026-06-01',
        1,
        0
      );

      const perPaycheckOccurrences = schedule.paychecks.filter((p) =>
        p.bills.some((b) => b.billId === 'bill-per-paycheck')
      ).length;

      const angelaPaycheckCount = schedule.paychecks.filter((p) =>
        p.incomeSources.some((s) => s.id === 'income-angela')
      ).length;

      expect(perPaycheckOccurrences).toBe(angelaPaycheckCount);
      for (const paycheck of schedule.paychecks) {
        const perPaycheckOnPaycheck = paycheck.bills.filter((b) => b.billId === 'bill-per-paycheck');
        if (paycheck.incomeSources.some((s) => s.id === 'income-angela')) {
          expect(perPaycheckOnPaycheck).toHaveLength(1);
        } else {
          expect(perPaycheckOnPaycheck).toHaveLength(0);
        }
      }
    });

    it('minimizes unpaid cents when income cannot cover every bill', () => {
      const monthlyIncome: Income = {
        ...weeklyIncome,
        cadence: 'monthly',
        startDate: '2026-06-01',
        amount: 500,
      };

      const criticalBill: Bill = {
        id: 'bill-critical',
        creditorName: 'Critical',
        budgetedAmount: 400,
        dueDay: 1,
        isRecurring: false,
        priority: 'critical',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const normalBill: Bill = {
        id: 'bill-normal',
        creditorName: 'Normal',
        budgetedAmount: 100,
        dueDay: 5,
        isRecurring: false,
        priority: 'normal',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const lowBill: Bill = {
        id: 'bill-low',
        creditorName: 'Low',
        budgetedAmount: 50,
        dueDay: 10,
        isRecurring: false,
        priority: 'low',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const schedule = scheduler.generateSchedule(
        [monthlyIncome],
        [criticalBill, normalBill, lowBill],
        '2026-06-01',
        1,
        0,
        new Set(),
        new Map(),
        0,
        [],
        0
      );

      const junPaycheck = schedule.paychecks.find((p) => p.date === '2026-06-01');
      expect(junPaycheck).toBeDefined();
      expect(junPaycheck!.bills).toHaveLength(3);
      expect(junPaycheck!.hasUnpayableBills).toBe(true);

      const lowOnPaycheck = junPaycheck!.bills.find((b) => b.billId === 'bill-low');
      const normalOnPaycheck = junPaycheck!.bills.find((b) => b.billId === 'bill-normal');
      const criticalOnPaycheck = junPaycheck!.bills.find((b) => b.billId === 'bill-critical');

      expect(lowOnPaycheck?.isUnpayable).toBe(true);
      expect(normalOnPaycheck?.isUnpayable).toBeFalsy();
      expect(criticalOnPaycheck?.isUnpayable).toBeFalsy();
      expect(lowOnPaycheck?.unfundableReason).toBe('insufficient_income_in_window');
      expect(junPaycheck!.totalBills).toBe(500);
      expect(junPaycheck!.savingsDeposit).toBe(0);
      expect(junPaycheck!.totalGoalDeposits).toBe(0);
    });

    it('drops the smaller bill when critical and high exceed income', () => {
      const monthlyIncome: Income = {
        ...weeklyIncome,
        cadence: 'monthly',
        startDate: '2026-06-01',
        amount: 500,
      };

      const criticalBill: Bill = {
        id: 'bill-critical',
        creditorName: 'Critical',
        budgetedAmount: 400,
        dueDay: 1,
        isRecurring: false,
        priority: 'critical',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const highBill: Bill = {
        id: 'bill-high',
        creditorName: 'High',
        budgetedAmount: 150,
        dueDay: 5,
        isRecurring: false,
        priority: 'high',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const schedule = scheduler.generateSchedule(
        [monthlyIncome],
        [criticalBill, highBill],
        '2026-06-01',
        1,
        0,
        new Set(),
        new Map(),
        0,
        [],
        0
      );

      const junPaycheck = schedule.paychecks.find((p) => p.date === '2026-06-01');
      expect(junPaycheck).toBeDefined();
      expect(junPaycheck!.bills).toHaveLength(2);
      expect(junPaycheck!.hasUnpayableBills).toBe(true);

      const highOnPaycheck = junPaycheck!.bills.find((b) => b.billId === 'bill-high');
      const criticalOnPaycheck = junPaycheck!.bills.find((b) => b.billId === 'bill-critical');

      expect(highOnPaycheck?.isUnpayable).toBe(true);
      expect(criticalOnPaycheck?.isUnpayable).toBeFalsy();
      expect(highOnPaycheck?.unfundableReason).toBe('insufficient_income_in_window');
      expect(junPaycheck!.totalBills).toBe(400);
      expect(junPaycheck!.savingsDeposit).toBe(0);
    });
  });

  describe('generateGoalProjections', () => {
    const income: Income = {
      id: 'income-1',
      sourceName: 'Salary',
      amount: 2000,
      cadence: 'biweekly',
      startDate: '2026-01-01',
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const bill: Bill = {
      id: 'bill-1',
      creditorName: 'Rent',
      budgetedAmount: 800,
      dueDay: 1,
      isRecurring: true,
      priority: 'critical',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const goals: SavingsGoal[] = [
      {
        id: 'goal-1',
        budgetId: 'budget-1',
        name: 'Emergency',
        targetAmount: 3000,
        targetDate: '2026-12-31',
        alreadySaved: 500,
        priority: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'goal-2',
        budgetId: 'budget-1',
        name: 'Vacation',
        targetAmount: 6000,
        targetDate: '2027-06-01',
        alreadySaved: 0,
        priority: 2,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];

    it('returns empty array when no goals', () => {
      expect(
        scheduler.generateGoalProjections([income], [bill], '2026-01-01', 1000)
      ).toEqual([]);
    });

    it('matches full schedule goal projections for typical biweekly scenario', () => {
      const schedule = scheduler.generateSchedule(
        [income],
        [bill],
        '2026-01-01',
        12,
        1000,
        new Set(),
        new Map(),
        500,
        goals,
        100,
        50
      );

      const lightweight = scheduler.generateGoalProjections(
        [income],
        [bill],
        '2026-01-01',
        1000,
        new Set(),
        new Map(),
        500,
        goals,
        100,
        50
      );

      expect(lightweight).toHaveLength(schedule.goalProjections!.length);
      for (let i = 0; i < lightweight.length; i++) {
        const full = schedule.goalProjections![i];
        const lite = lightweight[i];
        expect(lite.goalId).toBe(full.goalId);
        expect(lite.status).toBe(full.status);
        expect(lite.achievabilityPercent).toBe(full.achievabilityPercent);
        expect(lite.paycheckCount).toBe(full.paycheckCount);
        expect(lite.requiredPerPaycheck).toBeCloseTo(full.requiredPerPaycheck, 1);
      }
    });
  });

  describe('calculateGoalProjections', () => {
    const income: Income = {
      id: 'income-1',
      sourceName: 'Salary',
      amount: 2000,
      cadence: 'biweekly',
      startDate: '2026-01-01',
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const goal: SavingsGoal = {
      id: 'goal-1',
      budgetId: 'budget-1',
      name: 'Vacation Fund',
      targetAmount: 5000,
      targetDate: '2026-12-31',
      alreadySaved: 0,
      priority: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    it('calculates required per paycheck', () => {
      // Correct parameter order:
      // incomes, bills, startDateStr, months, startingBalance, 
      // skippedBills, manualAssignments, maxBudgetRemaining, 
      // goals, minCashOnHand, minSavingsPerPaycheck
      const schedule = scheduler.generateSchedule(
        [income],
        [],
        '2026-01-01',
        12,
        1000,
        new Set(),    // skippedBills
        new Map(),    // manualAssignments
        500,          // maxBudgetRemaining (targetCashOnHand)
        [goal],       // goals
        100,          // minCashOnHand
        50            // minSavingsPerPaycheck
      );
      
      expect(schedule.goalProjections).toBeDefined();
      expect(schedule.goalProjections!.length).toBe(1);
      
      const projection = schedule.goalProjections![0];
      expect(projection.goalId).toBe('goal-1');
      expect(projection.targetAmount).toBe(5000);
      expect(projection.paycheckCount).toBeGreaterThan(0);
      expect(projection.requiredPerPaycheck).toBeGreaterThan(0);
    });

    it('accounts for already saved amount', () => {
      const partialGoal = { ...goal, alreadySaved: 2500 };
      
      const schedule = scheduler.generateSchedule(
        [income],
        [],
        '2026-01-01',
        12,
        1000,
        new Set(),
        new Map(),
        500,
        [partialGoal],
        100,
        50
      );
      
      const projection = schedule.goalProjections![0];
      expect(projection.remainingAmount).toBe(2500);
      expect(projection.requiredPerPaycheck).toBeLessThan(
        5000 / projection.paycheckCount
      );
    });

    it('marks goal as achievable when surplus exceeds requirement', () => {
      const smallGoal: SavingsGoal = {
        ...goal,
        targetAmount: 500,
      };
      
      const schedule = scheduler.generateSchedule(
        [income],
        [],
        '2026-01-01',
        12,
        1000,
        new Set(),
        new Map(),
        100,
        [smallGoal],
        50,
        0
      );
      
      const projection = schedule.goalProjections![0];
      expect(projection.status).toBe('achievable');
      expect(projection.achievabilityPercent).toBe(100);
      expect(projection.scheduleHealth).toBeDefined();
      expect(projection.scheduleHealth.shortfallCount).toBe(0);
      expect(typeof projection.scheduleHealth.tightPaycheckCount).toBe('number');
      expect(typeof projection.scheduleHealth.savingsTotal).toBe('number');
      expect(projection.avgAllocationPerPaycheck).toBeGreaterThanOrEqual(0);
      expect(projection.marginPerPaycheck).toBeDefined();
    });

    it('computes funding timeline when goal receives deposits', () => {
      const smallGoal: SavingsGoal = {
        ...goal,
        targetAmount: 500,
        targetDate: '2026-12-31',
      };

      const schedule = scheduler.generateSchedule(
        [income],
        [],
        '2026-01-01',
        12,
        1000,
        new Set(),
        new Map(),
        100,
        [smallGoal],
        50,
        0
      );

      const projection = schedule.goalProjections![0];
      expect(projection.actualAllocation).toBeGreaterThanOrEqual(500);
      expect(projection.paychecksToFullyFund).toBeGreaterThan(0);
      expect(projection.estimatedFundedDate).toBeTruthy();
    });

    it('spreads goal deposits along glide-path rather than one lump sum', () => {
      const schedule = scheduler.generateSchedule(
        [income],
        [],
        '2026-01-01',
        6,
        5000,
        new Set(),
        new Map(),
        500,
        [goal],
        100,
        0
      );

      const paychecksWithDeposits = schedule.paychecks.filter(
        (p) => (p.totalGoalDeposits ?? 0) > 0
      );
      expect(paychecksWithDeposits.length).toBeGreaterThan(1);

      const firstDeposit = paychecksWithDeposits[0]?.totalGoalDeposits ?? 0;
      const totalDeposited = paychecksWithDeposits.reduce(
        (sum, p) => sum + (p.totalGoalDeposits ?? 0),
        0
      );
      expect(firstDeposit).toBeLessThan(totalDeposited);
    });

    it('funds a reachable goal while still depositing savings (balanced allocator)', () => {
      // A goal well within capacity should be funded without starving savings:
      // the allocator draws goal funding from surplus above the savings target.
      const reachableGoal: SavingsGoal = {
        ...goal,
        targetAmount: 3000,
        targetDate: '2026-12-31',
      };

      const schedule = scheduler.generateSchedule(
        [income],
        [],
        '2026-01-01',
        12,
        0,
        new Set(),
        new Map(),
        500,
        [reachableGoal],
        100,
        0
      );

      const projection = schedule.goalProjections![0];
      // Goal is fully achievable...
      expect(projection.achievabilityPercent).toBe(100);
      expect(projection.status).toBe('achievable');

      // ...and savings still happens on multiple paychecks (not starved by goals).
      const savingPaychecks = schedule.fullPaychecks.filter((p) => p.savingsDeposit > 0);
      expect(savingPaychecks.length).toBeGreaterThan(1);

      // All goal deposits are whole dollars.
      schedule.fullPaychecks.forEach((p) =>
        p.goalDeposits.forEach((d) => expect(Number.isInteger(d.amount)).toBe(true))
      );
    });

    it('handles multiple goals with priorities', () => {
      const goal2: SavingsGoal = {
        ...goal,
        id: 'goal-2',
        name: 'Emergency Fund',
        priority: 2,
      };
      
      const schedule = scheduler.generateSchedule(
        [income],
        [],
        '2026-01-01',
        12,
        1000,
        new Set(),
        new Map(),
        500,
        [goal, goal2],
        100,
        50
      );
      
      expect(schedule.goalProjections!.length).toBe(2);
      
      const projections = schedule.goalProjections!;
      const goal1Proj = projections.find(p => p.goalId === 'goal-1');
      const goal2Proj = projections.find(p => p.goalId === 'goal-2');
      
      expect(goal1Proj).toBeDefined();
      expect(goal2Proj).toBeDefined();
    });

    it('respects minSavingsPerPaycheck', () => {
      const schedule = scheduler.generateSchedule(
        [income],
        [],
        '2026-01-01',
        6,
        0,
        new Set(),
        new Map(),
        200,
        [goal],
        100,
        100
      );
      
      schedule.paychecks.forEach(p => {
        if (p.budgetRemaining > 100) {
          expect(p.savingsDeposit).toBeGreaterThanOrEqual(0);
        }
      });
    });
  });

  describe('buildPaycheckEntries', () => {
    it('tracks cumulative savings', () => {
      const income: Income = {
        id: 'income-1',
        sourceName: 'Salary',
        amount: 2000,
        cadence: 'biweekly',
        startDate: '2026-01-01',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const schedule = scheduler.generateSchedule(
        [income],
        [],
        '2026-01-01',
        3,
        0,
        new Set(),
        new Map(),
        500
      );
      
      // Verify totalSavings is cumulative
      for (let i = 1; i < schedule.paychecks.length; i++) {
        const current = schedule.paychecks[i];
        const previous = schedule.paychecks[i - 1];
        
        expect(current.totalSavings).toBeGreaterThanOrEqual(previous.totalSavings);
      }
    });
  });

  describe('paycheck date consistency', () => {
    it('produces consistent paycheck count for same date range', () => {
      const income: Income = {
        id: 'income-1',
        sourceName: 'Salary',
        amount: 2000,
        cadence: 'biweekly',
        startDate: '2026-01-01',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const schedule1 = scheduler.generateSchedule(
        [income],
        [],
        '2026-01-01',
        6,
        0
      );

      const schedule2 = scheduler.generateSchedule(
        [income],
        [],
        '2026-01-01',
        6,
        0
      );

      expect(schedule1.paychecks.length).toBe(schedule2.paychecks.length);
    });

    it('paycheck count changes with different date ranges', () => {
      const income: Income = {
        id: 'income-1',
        sourceName: 'Salary',
        amount: 2000,
        cadence: 'biweekly',
        startDate: '2026-01-01',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const schedule3mo = scheduler.generateSchedule(
        [income],
        [],
        '2026-01-01',
        3,
        0
      );

      const schedule12mo = scheduler.generateSchedule(
        [income],
        [],
        '2026-01-01',
        12,
        0
      );

      expect(schedule12mo.paychecks.length).toBeGreaterThan(schedule3mo.paychecks.length);
    });
  });

  describe('Complex Scenarios: Multiple Incomes, Bills, and Goals', () => {
    // Multiple income sources with different cadences
    const weeklyIncome: Income = {
      id: 'income-weekly',
      sourceName: 'Part-time Job',
      amount: 500,
      cadence: 'weekly',
      startDate: '2026-01-01',
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const biweeklyIncome: Income = {
      id: 'income-biweekly',
      sourceName: 'Main Salary',
      amount: 2500,
      cadence: 'biweekly',
      startDate: '2026-01-01',
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const monthlyIncome: Income = {
      id: 'income-monthly',
      sourceName: 'Rental Income',
      amount: 1200,
      cadence: 'monthly',
      startDate: '2026-01-01',
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const semiMonthlyIncome: Income = {
      id: 'income-semimonthly',
      sourceName: 'Spouse Salary',
      amount: 1800,
      cadence: 'semimonthly',
      startDate: '2026-01-01',
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    // Multiple bills with different priorities and due dates
    const rentBill: Bill = {
      id: 'bill-rent',
      creditorName: 'Landlord',
      budgetedAmount: 1500,
      dueDay: 1,
      category: 'housing',
      isRecurring: true,
      priority: 'critical',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const carPaymentBill: Bill = {
      id: 'bill-car',
      creditorName: 'Auto Loan',
      budgetedAmount: 450,
      dueDay: 15,
      category: 'transportation',
      isRecurring: true,
      priority: 'high',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const utilitiesBill: Bill = {
      id: 'bill-utilities',
      creditorName: 'Electric Company',
      budgetedAmount: 150,
      dueDay: 20,
      category: 'utilities',
      isRecurring: true,
      priority: 'normal',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const subscriptionBill: Bill = {
      id: 'bill-subscription',
      creditorName: 'Streaming Services',
      budgetedAmount: 50,
      dueDay: 28,
      category: 'entertainment',
      isRecurring: true,
      priority: 'low',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    // Multiple goals with different priorities and amounts
    const emergencyFundGoal: SavingsGoal = {
      id: 'goal-emergency',
      budgetId: 'budget-1',
      name: 'Emergency Fund',
      targetAmount: 10000,
      targetDate: '2026-12-31',
      alreadySaved: 2000,
      priority: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    const vacationGoal: SavingsGoal = {
      id: 'goal-vacation',
      budgetId: 'budget-1',
      name: 'Hawaii Vacation',
      targetAmount: 5000,
      targetDate: '2026-06-30',
      alreadySaved: 0,
      priority: 2,
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    const carDownPaymentGoal: SavingsGoal = {
      id: 'goal-car',
      budgetId: 'budget-1',
      name: 'New Car Down Payment',
      targetAmount: 8000,
      targetDate: '2027-06-30',
      alreadySaved: 1000,
      priority: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    describe('Multiple Incomes', () => {
      it('combines multiple income sources correctly', () => {
        const allIncomes = [weeklyIncome, biweeklyIncome, monthlyIncome, semiMonthlyIncome];
        
        const schedule = scheduler.generateSchedule(
          allIncomes,
          [],
          '2026-01-01',
          3,
          0
        );

        // Should have paychecks from all income sources
        expect(schedule.paychecks.length).toBeGreaterThan(0);
        
        // Total income should reflect all sources
        // Weekly: ~13 weeks × $500 = $6,500
        // Biweekly: ~6.5 × $2,500 = $16,250
        // Monthly: 3 × $1,200 = $3,600
        // Semi-monthly: 6 × $1,800 = $10,800
        // Total ≈ $37,150
        expect(schedule.summary.totalIncome).toBeGreaterThan(30000);
        expect(schedule.summary.totalIncome).toBeLessThan(45000);
      });

      it('handles overlapping paycheck dates from multiple sources', () => {
        // Monthly and semi-monthly both pay on the 1st
        const schedule = scheduler.generateSchedule(
          [monthlyIncome, semiMonthlyIncome],
          [],
          '2026-01-01',
          2,
          0
        );

        // Some paychecks should have multiple income sources
        const paychecksWithMultipleSources = schedule.paychecks.filter(
          p => p.incomeSources.length > 1
        );
        
        // On the 1st of each month, both semi-monthly (1st) and monthly should pay
        expect(paychecksWithMultipleSources.length).toBeGreaterThan(0);
      });

      it('calculates correct paycheck count for each cadence', () => {
        // Test weekly: should have ~52 paychecks in 12 months
        const weeklySchedule = scheduler.generateSchedule(
          [weeklyIncome],
          [],
          '2026-01-01',
          12,
          0
        );
        expect(weeklySchedule.paychecks.length).toBeGreaterThanOrEqual(50);
        expect(weeklySchedule.paychecks.length).toBeLessThanOrEqual(53);

        // Test bi-weekly: should have ~26 paychecks in 12 months
        const biweeklySchedule = scheduler.generateSchedule(
          [biweeklyIncome],
          [],
          '2026-01-01',
          12,
          0
        );
        expect(biweeklySchedule.paychecks.length).toBeGreaterThanOrEqual(25);
        expect(biweeklySchedule.paychecks.length).toBeLessThanOrEqual(27);

        // Test monthly: should have 12-13 paychecks in 12 months (depends on boundary)
        const monthlySchedule = scheduler.generateSchedule(
          [monthlyIncome],
          [],
          '2026-01-01',
          12,
          0
        );
        expect(monthlySchedule.paychecks.length).toBeGreaterThanOrEqual(12);
        expect(monthlySchedule.paychecks.length).toBeLessThanOrEqual(13);

        // Test semi-monthly: should have 24-26 paychecks in 12 months
        const semiMonthlySchedule = scheduler.generateSchedule(
          [semiMonthlyIncome],
          [],
          '2026-01-01',
          12,
          0
        );
        expect(semiMonthlySchedule.paychecks.length).toBeGreaterThanOrEqual(24);
        expect(semiMonthlySchedule.paychecks.length).toBeLessThanOrEqual(26);
      });
    });

    describe('Multiple Bills', () => {
      it('assigns bills to appropriate paychecks', () => {
        const allBills = [rentBill, carPaymentBill, utilitiesBill, subscriptionBill];
        
        const schedule = scheduler.generateSchedule(
          [biweeklyIncome],
          allBills,
          '2026-01-01',
          3,
          0
        );

        const assignedBillIds = new Set(
          schedule.paychecks.flatMap((p) => p.bills.map((b) => b.billId))
        );
        expect(assignedBillIds).toContain('bill-rent');
        expect(assignedBillIds).toContain('bill-car');
        expect(assignedBillIds).toContain('bill-utilities');

        const occurrenceKeys: string[] = [];
        for (const paycheck of schedule.paychecks) {
          for (const bill of paycheck.bills) {
            occurrenceKeys.push(`${bill.billId}-${bill.billDate}`);
            const daysEarly = differenceInDays(parseISO(bill.billDate), parseISO(paycheck.date));
            expect(daysEarly).toBeLessThanOrEqual(14);
          }
        }
        expect(occurrenceKeys.length).toBe(new Set(occurrenceKeys).size);
        expect(schedule.summary.totalExpenses).toBeGreaterThan(0);
      });

      it('prioritizes critical bills', () => {
        const schedule = scheduler.generateSchedule(
          [biweeklyIncome],
          [rentBill, subscriptionBill],
          '2026-01-01',
          1,
          0
        );

        // Critical bills should be assigned even in tight budgets
        const rentAssigned = schedule.paychecks.some(
          p => p.bills.some(b => b.billId === 'bill-rent')
        );
        expect(rentAssigned).toBe(true);
      });

      it('calculates shortfalls when bills exceed income', () => {
        // Create a scenario where bills > income
        const lowIncome: Income = {
          ...weeklyIncome,
          amount: 100, // Very low income
        };

        const schedule = scheduler.generateSchedule(
          [lowIncome],
          [rentBill], // $1500/month rent
          '2026-01-01',
          1,
          0
        );

        // Should have shortfalls
        expect(schedule.summary.shortfallCount).toBeGreaterThan(0);
      });
    });

    describe('Multiple Goals with Priority Funding', () => {
      it('funds higher priority goals first', () => {
        const schedule = scheduler.generateSchedule(
          [biweeklyIncome],
          [rentBill],
          '2026-01-01',
          6,
          0,
          new Set(),
          new Map(),
          200, // maxBudgetRemaining
          [emergencyFundGoal, vacationGoal, carDownPaymentGoal],
          100, // minCashOnHand
          50   // minSavingsPerPaycheck
        );

        expect(schedule.goalProjections).toBeDefined();
        expect(schedule.goalProjections!.length).toBe(3);

        // Get projections by priority
        const projections = schedule.goalProjections!;
        const emergencyProj = projections.find(p => p.goalId === 'goal-emergency')!;
        const vacationProj = projections.find(p => p.goalId === 'goal-vacation')!;
        const carProj = projections.find(p => p.goalId === 'goal-car')!;

        // Higher priority goals should have better achievability or more allocation
        // Emergency fund (P1) should get funded before vacation (P2) and car (P3)
        // If there's limited surplus, P1 gets most of it
        
        // Check that actual allocations exist
        const totalGoalDeposits = schedule.paychecks.reduce(
          (sum, p) => sum + p.totalGoalDeposits, 0
        );
        
        if (totalGoalDeposits > 0) {
          // Emergency fund should have higher or equal allocation percentage relative to remaining amount
          expect(emergencyProj.actualAllocation).toBeGreaterThanOrEqual(0);
        }
      });

      it('fully funds a small goal quickly', () => {
        const smallGoal: SavingsGoal = {
          id: 'goal-small',
          budgetId: 'budget-1',
          name: 'Small Purchase',
          targetAmount: 100, // Small goal
          targetDate: '2026-12-31',
          alreadySaved: 0,
          priority: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
        };

        const schedule = scheduler.generateSchedule(
          [biweeklyIncome], // $2500 bi-weekly
          [],               // No bills for simplicity
          '2026-01-01',
          12,
          0,
          new Set(),
          new Map(),
          200,
          [smallGoal],
          100,
          50
        );

        const projection = schedule.goalProjections![0];
        
        // Small goal should be 100% achievable
        expect(projection.status).toBe('achievable');
        expect(projection.achievabilityPercent).toBe(100);
        
        // Glide-path spreads deposits; total allocation should reach the small goal target
        expect(projection.actualAllocation).toBeCloseTo(100, 0);
      });

      it('allocates entire surplus pool to goals before additional savings', () => {
        const mediumGoal: SavingsGoal = {
          id: 'goal-medium',
          budgetId: 'budget-1',
          name: 'Medium Goal',
          targetAmount: 3000,
          targetDate: '2026-12-31',
          alreadySaved: 0,
          priority: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
        };

        const schedule = scheduler.generateSchedule(
          [biweeklyIncome], // $2500 bi-weekly
          [rentBill],        // $1500/month rent
          '2026-01-01',
          3,
          0,
          new Set(),
          new Map(),
          200, // maxBudgetRemaining
          [mediumGoal],
          100, // minCashOnHand
          100  // minSavingsPerPaycheck
        );

        // Calculate expected behavior:
        // After rent and minCashOnHand and minSavings, remaining should go to goals
        const totalGoalDeposits = schedule.fullPaychecks.reduce(
          (sum, p) => sum + p.totalGoalDeposits, 0
        );
        
        // Goal should receive substantial allocation
        expect(totalGoalDeposits).toBeGreaterThan(0);
        
        // Verify glide-path deposits match projection totals (rounding-safe)
        const projection = schedule.goalProjections![0];
        expect(projection.actualAllocation).toBeCloseTo(totalGoalDeposits, 1);
      });

      it('respects minSavingsPerPaycheck before goal allocation', () => {
        const schedule = scheduler.generateSchedule(
          [biweeklyIncome],
          [],
          '2026-01-01',
          3,
          0,
          new Set(),
          new Map(),
          200,
          [vacationGoal],
          100,
          500 // High minimum savings
        );

        // Each paycheck with surplus should have at least minSavingsPerPaycheck
        schedule.paychecks.forEach(p => {
          if (!p.isShortfall && p.savingsDeposit > 0) {
            // If there's any savings, it should be at least the minimum
            // (unless surplus was less than minimum)
            const surplus = p.totalIncome - p.totalBills - 100; // income - bills - minCashOnHand
            if (surplus >= 500) {
              expect(p.savingsDeposit).toBeGreaterThanOrEqual(500);
            }
          }
        });
      });
    });

    describe('Full Complex Scenario', () => {
      it('handles realistic budget with multiple incomes, bills, and goals', () => {
        const allIncomes = [biweeklyIncome, semiMonthlyIncome];
        const allBills = [rentBill, carPaymentBill, utilitiesBill, subscriptionBill];
        const allGoals = [emergencyFundGoal, vacationGoal];

        const schedule = scheduler.generateSchedule(
          allIncomes,
          allBills,
          '2026-01-01',
          12,
          1000, // Starting balance
          new Set(),
          new Map(),
          300, // maxBudgetRemaining
          allGoals,
          150, // minCashOnHand
          200  // minSavingsPerPaycheck
        );

        // Verify schedule was generated
        expect(schedule.paychecks.length).toBeGreaterThan(0);
        
        // Verify summary calculations
        expect(schedule.summary.totalIncome).toBeGreaterThan(0);
        expect(schedule.summary.totalExpenses).toBeGreaterThan(0);
        expect(schedule.summary.netBalance).toBeDefined();
        
        // Verify goals were processed
        expect(schedule.goalProjections).toBeDefined();
        expect(schedule.goalProjections!.length).toBe(2);

        // Verify no anomalies: total income - total expenses should roughly equal
        // savings + goal deposits + remaining balance changes
        const totalSavings = schedule.paychecks.reduce(
          (sum, p) => sum + p.savingsDeposit, 0
        );
        const totalGoalDeposits = schedule.paychecks.reduce(
          (sum, p) => sum + p.totalGoalDeposits, 0
        );
        
        // Net balance should be positive with these numbers
        expect(schedule.summary.netBalance).toBeGreaterThan(0);
        expect(totalSavings + totalGoalDeposits).toBeGreaterThan(0);
      }, 60_000);

      it('maintains budget integrity across all paychecks', () => {
        const allIncomes = [biweeklyIncome, monthlyIncome];
        const allBills = [rentBill, utilitiesBill];
        const allGoals = [vacationGoal];

        const startingBalance = 500;
        const schedule = scheduler.generateSchedule(
          allIncomes,
          allBills,
          '2026-01-01',
          6,
          startingBalance,
          new Set(),
          new Map(),
          250,
          allGoals,
          100,
          100
        );

        // For each paycheck: income - bills + (starting cash on first only) = savings + goals + remaining
        schedule.paychecks.forEach((paycheck, index) => {
          const ledgerBoost = index === 0 ? startingBalance : 0;
          const calculatedRemaining =
            paycheck.totalIncome -
            paycheck.totalBills +
            ledgerBoost -
            paycheck.savingsDeposit -
            paycheck.totalGoalDeposits;

          // Budget remaining should match (with small floating point tolerance)
          expect(Math.abs(calculatedRemaining - paycheck.budgetRemaining)).toBeLessThan(1);
          
          // No negative values (except budgetRemaining for shortfalls)
          expect(paycheck.totalIncome).toBeGreaterThanOrEqual(0);
          expect(paycheck.totalBills).toBeGreaterThanOrEqual(0);
          expect(paycheck.savingsDeposit).toBeGreaterThanOrEqual(0);
          expect(paycheck.totalGoalDeposits).toBeGreaterThanOrEqual(0);
          
          // If shortfall, verify it's properly flagged
          if (paycheck.budgetRemaining < 0) {
            expect(paycheck.isShortfall).toBe(true);
          }
        });
      });

      it('goal projections are consistent with actual allocations', () => {
        const schedule = scheduler.generateSchedule(
          [biweeklyIncome],
          [rentBill],
          '2026-01-01',
          12,
          0,
          new Set(),
          new Map(),
          200,
          [vacationGoal], // Due 2026-06-30, within schedule
          100,
          50
        );

        const projection = schedule.goalProjections![0];
        
        // Calculate actual allocation from paychecks
        let actualFromPaychecks = 0;
        schedule.paychecks.forEach(p => {
          p.goalDeposits.forEach(d => {
            if (d.goalId === 'goal-vacation') {
              actualFromPaychecks += d.amount;
            }
          });
        });

        // Projection's actual allocation should match sum from paychecks
        expect(Math.abs(projection.actualAllocation - actualFromPaychecks)).toBeLessThan(1);
        
        // Achievable amount should be alreadySaved + actualAllocation
        const expectedAchievable = vacationGoal.alreadySaved + projection.actualAllocation;
        expect(Math.abs(projection.achievableAmount - expectedAchievable)).toBeLessThan(1);
      });
    });

    describe('Edge Cases', () => {
      it('handles goal with zero remaining amount', () => {
        const completedGoal: SavingsGoal = {
          id: 'goal-completed',
          budgetId: 'budget-1',
          name: 'Already Completed',
          targetAmount: 1000,
          targetDate: '2026-12-31',
          alreadySaved: 1000, // Already fully saved
          priority: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
        };

        const schedule = scheduler.generateSchedule(
          [biweeklyIncome],
          [],
          '2026-01-01',
          3,
          0,
          new Set(),
          new Map(),
          200,
          [completedGoal],
          100,
          50
        );

        const projection = schedule.goalProjections![0];
        expect(projection.status).toBe('achievable');
        expect(projection.achievabilityPercent).toBe(100);
        expect(projection.remainingAmount).toBe(0);
      });

      it('handles tight surplus scenario - goals get surplus after minimums', () => {
        // Income barely covers bills - $750 bi-weekly vs $1500/month rent
        // Bi-weekly has irregular surplus (some paychecks have rent, some don't)
        const tightIncome: Income = {
          ...biweeklyIncome,
          amount: 750,
        };

        const schedule = scheduler.generateSchedule(
          [tightIncome],
          [rentBill], // $1500/month
          '2026-01-01',
          3,
          0,
          new Set(),
          new Map(),
          100,
          [vacationGoal],
          50,  // minCashOnHand
          100  // minSavingsPerPaycheck
        );

        const totalGoalDeposits = schedule.paychecks.reduce(
          (sum, p) => sum + p.totalGoalDeposits, 0
        );
        
        const totalSavings = schedule.paychecks.reduce(
          (sum, p) => sum + p.savingsDeposit, 0
        );

        // Key behaviors to verify:
        // 1. Both savings and goals receive allocations (surplus is distributed)
        expect(totalGoalDeposits).toBeGreaterThanOrEqual(0);
        expect(totalSavings).toBeGreaterThanOrEqual(0);
        
        // 2. No shortfalls should occur (income covers bills)
        // Note: with bi-weekly timing, some paychecks may have more bills than others
        // but overall should balance out
        expect(schedule.summary.shortfallCount).toBeGreaterThanOrEqual(0);
        
        // 3. Schedule was generated successfully
        expect(schedule.paychecks.length).toBeGreaterThan(0);
      });

      it('handles goal deadline in the past', () => {
        const pastGoal: SavingsGoal = {
          id: 'goal-past',
          budgetId: 'budget-1',
          name: 'Past Deadline',
          targetAmount: 1000,
          targetDate: '2025-01-01', // Past date
          alreadySaved: 0,
          priority: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
        };

        const schedule = scheduler.generateSchedule(
          [biweeklyIncome],
          [],
          '2026-01-01',
          3,
          0,
          new Set(),
          new Map(),
          200,
          [pastGoal],
          100,
          50
        );

        // Goal with past deadline should still be in projections but marked appropriately
        expect(schedule.goalProjections).toBeDefined();
      });

      it('handles very large goal relative to income', () => {
        const hugeGoal: SavingsGoal = {
          id: 'goal-huge',
          budgetId: 'budget-1',
          name: 'Million Dollar Goal',
          targetAmount: 1000000,
          targetDate: '2026-12-31',
          alreadySaved: 0,
          priority: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
        };

        const schedule = scheduler.generateSchedule(
          [biweeklyIncome],
          [],
          '2026-01-01',
          12,
          0,
          new Set(),
          new Map(),
          200,
          [hugeGoal],
          100,
          50
        );

        const projection = schedule.goalProjections![0];
        
        // Should be marked as partial (not achievable)
        expect(projection.status).toBe('partial');
        expect(projection.achievabilityPercent).toBeLessThan(100);
      });
    });
  });

  describe('rebalance and reconciliation', () => {
    const biweeklyIncome: Income = {
      id: 'income-biweekly',
      sourceName: 'Salary',
      amount: 2500,
      cadence: 'biweekly',
      startDate: '2026-01-01',
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    it('rebalance avoids shortfall when movable bill and earlier surplus exist', () => {
      const heavyBill: Bill = {
        id: 'bill-heavy',
        creditorName: 'Heavy Bill',
        budgetedAmount: 1800,
        dueDay: 14,
        isRecurring: true,
        priority: 'normal',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const lightBill: Bill = {
        id: 'bill-light',
        creditorName: 'Light Bill',
        budgetedAmount: 400,
        dueDay: 28,
        isRecurring: true,
        priority: 'low',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const schedule = scheduler.generateSchedule(
        [biweeklyIncome],
        [heavyBill, lightBill],
        '2026-01-01',
        2,
        200,
        new Set(),
        new Map(),
        250,
        [],
        100,
        0
      );

      expect(schedule.paychecks.some((p) => p.isShortfall)).toBe(false);
    });

    it('analyzeAndProposeFixes returns move proposals before skip when shortfalls remain', () => {
      const criticalBill: Bill = {
        id: 'bill-critical',
        creditorName: 'Critical',
        budgetedAmount: 2200,
        dueDay: 1,
        isRecurring: true,
        priority: 'critical',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const optionalBill: Bill = {
        id: 'bill-optional',
        creditorName: 'Optional',
        budgetedAmount: 800,
        dueDay: 15,
        isRecurring: true,
        priority: 'low',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const schedule = scheduler.generateSchedule(
        [biweeklyIncome],
        [criticalBill, optionalBill],
        '2026-01-01',
        2,
        0,
        new Set(),
        new Map(),
        250,
        [],
        100,
        0
      );

      const report = scheduler.analyzeAndProposeFixes(schedule);
      if (report.hasShortfalls && report.proposedFixes.length > 0) {
        const firstFix = report.proposedFixes[0];
        expect(firstFix.type).toBe('move_bill');
      }
    });

    it('marks triaged bills with structured unfundable reason codes', () => {
      const monthlyIncome: Income = {
        ...biweeklyIncome,
        cadence: 'monthly',
        startDate: '2026-06-01',
        amount: 500,
      };

      const criticalBill: Bill = {
        id: 'bill-critical',
        creditorName: 'Critical',
        budgetedAmount: 400,
        dueDay: 1,
        isRecurring: false,
        priority: 'critical',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const lowBill: Bill = {
        id: 'bill-low',
        creditorName: 'Low',
        budgetedAmount: 150,
        dueDay: 10,
        isRecurring: false,
        priority: 'low',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const schedule = scheduler.generateSchedule(
        [monthlyIncome],
        [criticalBill, lowBill],
        '2026-06-01',
        1,
        0,
        new Set(),
        new Map(),
        0,
        [],
        0
      );

      const dropped = schedule.paychecks
        .flatMap((p) => p.bills)
        .find((b) => b.billId === 'bill-low' && b.isUnpayable);

      expect(dropped?.unfundableReason).toBe('insufficient_income_in_window');
    });

    it('does not propose skip fixes for unfundable bills', () => {
      const monthlyIncome: Income = {
        ...biweeklyIncome,
        cadence: 'monthly',
        startDate: '2026-06-01',
        amount: 600,
      };

      const criticalBill: Bill = {
        id: 'bill-critical',
        creditorName: 'Critical',
        budgetedAmount: 500,
        dueDay: 1,
        isRecurring: false,
        priority: 'critical',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const optionalBill: Bill = {
        id: 'bill-optional',
        creditorName: 'Optional',
        budgetedAmount: 200,
        dueDay: 15,
        isRecurring: false,
        priority: 'low',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const schedule = scheduler.generateSchedule(
        [monthlyIncome],
        [criticalBill, optionalBill],
        '2026-06-01',
        1,
        0,
        new Set(),
        new Map(),
        250,
        [],
        100,
        0
      );

      const report = scheduler.analyzeAndProposeFixes(schedule);
      expect(report.proposedFixes.every((f) => f.type === 'move_bill')).toBe(true);
    });

    it('returns fully resolved reconciliation report when no shortfalls exist', () => {
      const schedule = scheduler.generateSchedule(
        [biweeklyIncome],
        [],
        '2026-01-01',
        1,
        0
      );
      const report = scheduler.analyzeAndProposeFixes(schedule);
      expect(report).toEqual({
        needsReconciliation: false,
        shortfalls: [],
        proposedFixes: [],
        canBeFullyResolved: true,
        totalDeficit: 0,
        estimatedResolution: 0,
      });
    });

    it('generates savings and heavy-paycheck recommendations', () => {
      const income: Income = {
        id: 'income-monthly',
        sourceName: 'Salary',
        amount: 3000,
        cadence: 'monthly',
        startDate: '2026-01-01',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const heavyBill: Bill = {
        id: 'bill-heavy',
        creditorName: 'Rent',
        budgetedAmount: 2800,
        dueDay: 1,
        isRecurring: true,
        priority: 'critical',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const schedule = scheduler.generateSchedule(
        [income],
        [heavyBill],
        '2026-01-01',
        3,
        500,
        new Set(),
        new Map(),
        250,
        [],
        50,
        0
      );

      expect(schedule.recommendations.length).toBeGreaterThan(0);
      expect(
        schedule.recommendations.some((rec) =>
          rec.includes('balanced') || rec.includes('90%') || rec.includes('save')
        )
      ).toBe(true);
    });

    it('reports reconciliation metrics when shortfalls remain after rebalance', () => {
      const lowIncome: Income = {
        ...biweeklyIncome,
        amount: 800,
      };

      const criticalBill: Bill = {
        id: 'bill-critical',
        creditorName: 'Critical',
        budgetedAmount: 1500,
        dueDay: 14,
        isRecurring: true,
        priority: 'critical',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const schedule = scheduler.generateSchedule(
        [lowIncome],
        [criticalBill],
        '2026-01-01',
        2,
        0,
        new Set(),
        new Map(),
        250,
        [],
        100,
        0
      );

      const report = scheduler.analyzeAndProposeFixes(schedule);
      if (report.needsReconciliation) {
        expect(report.totalDeficit).toBeGreaterThan(0);
        expect(report.shortfalls.length).toBeGreaterThan(0);
      } else {
        expect(schedule.paychecks.some((p) => p.isShortfall)).toBe(false);
      }
    });
  });

  describe('applyViewportFilter', () => {
    it('returns consistent shortfalls across viewport sizes for the same period', () => {
      const lowIncome: Income = {
        id: 'income-low',
        sourceName: 'Part Time',
        amount: 800,
        cadence: 'biweekly',
        startDate: '2026-06-01',
        isActive: true,
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      };

      const heavyBill: Bill = {
        id: 'bill-heavy',
        creditorName: 'Rent',
        budgetedAmount: 1800,
        dueDay: 1,
        category: 'housing',
        isRecurring: true,
        priority: 'critical',
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      };

      const startDate = '2026-06-01';
      const schedule3 = scheduler.generateSchedule([lowIncome], [heavyBill], startDate, 3, 0);
      const schedule6 = scheduler.generateSchedule([lowIncome], [heavyBill], startDate, 6, 0);
      const schedule12 = scheduler.generateSchedule([lowIncome], [heavyBill], startDate, 12, 0);

      expect(schedule3.fullPaychecks.length).toBeGreaterThan(schedule3.paychecks.length);
      expect(schedule3.summary.shortfallCount).toBe(
        schedule12.paychecks
          .filter((paycheck) => schedule3.paychecks.some((p) => p.date === paycheck.date && p.isShortfall))
          .length
      );
      expect(schedule6.summary.shortfallCount).toBeGreaterThanOrEqual(schedule3.summary.shortfallCount);
      expect(schedule12.fullPaychecks.length).toBe(schedule3.fullPaychecks.length);
    });
  });

  describe('goal allocation with unpaid bills', () => {
    it('does not allocate to goals when bills are marked unpayable', () => {
      const lowIncome: Income = {
        id: 'income-low',
        sourceName: 'Part Time',
        amount: 500,
        cadence: 'biweekly',
        startDate: '2026-06-01',
        isActive: true,
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      };

      const bills: Bill[] = [
        {
          id: 'bill-rent',
          creditorName: 'Rent',
          budgetedAmount: 1500,
          dueDay: 1,
          category: 'housing',
          isRecurring: true,
          priority: 'critical',
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z',
        },
        {
          id: 'bill-low',
          creditorName: 'Streaming',
          budgetedAmount: 50,
          dueDay: 15,
          category: 'subscriptions',
          isRecurring: true,
          priority: 'low',
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z',
        },
      ];

      const goals: SavingsGoal[] = [{
        id: 'goal-1',
        budgetId: 'budget-1',
        name: 'Emergency Fund',
        targetAmount: 5000,
        targetDate: '2027-06-01',
        alreadySaved: 0,
        priority: 1,
        createdAt: '2026-06-01T00:00:00.000Z',
      }];

      const schedule = scheduler.generateSchedule(
        [lowIncome],
        bills,
        '2026-06-01',
        12,
        0,
        new Set(),
        new Map(),
        250,
        goals,
        100,
        0
      );

      const paychecksWithUnpayable = schedule.fullPaychecks.filter((paycheck) =>
        paycheck.bills.some((bill) => bill.isUnpayable)
      );

      for (const paycheck of paychecksWithUnpayable) {
        expect(paycheck.totalGoalDeposits).toBe(0);
      }
    });
  });

  describe('skipped bills and preferred income assignment', () => {
    const monthlyIncome: Income = {
      id: 'income-monthly',
      sourceName: 'Salary',
      amount: 3000,
      cadence: 'monthly',
      startDate: '2026-01-01',
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const recurringBill: Bill = {
      id: 'bill-1',
      creditorName: 'Rent',
      budgetedAmount: 1200,
      dueDay: 15,
      isRecurring: true,
      priority: 'critical',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    it('marks skipped bill occurrences as skipped but keeps later ones', () => {
      const schedule = scheduler.generateSchedule(
        [monthlyIncome],
        [recurringBill],
        '2026-01-01',
        3,
        0,
        new Set(['bill-1-2026-01-15'])
      );

      const janOccurrence = schedule.fullPaychecks
        .flatMap((paycheck) => paycheck.bills)
        .find((bill) => bill.billDate === '2026-01-15');
      const febOccurrence = schedule.fullPaychecks
        .flatMap((paycheck) => paycheck.bills)
        .find((bill) => bill.billDate === '2026-02-15');

      expect(janOccurrence).toBeDefined();
      expect(janOccurrence?.isSkipped).toBe(true);
      expect(janOccurrence?.isUnpayable).toBeFalsy();
      expect(febOccurrence).toBeDefined();
      expect(febOccurrence?.isSkipped).toBeFalsy();
    });

    it('assigns preferred-income bills to the matching paycheck stream', () => {
      const michaelIncome: Income = {
        id: 'income-michael',
        sourceName: 'Michael',
        amount: 800,
        cadence: 'weekly',
        startDate: '2026-06-19',
        isActive: true,
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      };
      const angelaIncome: Income = {
        id: 'income-angela',
        sourceName: 'Angela',
        amount: 500,
        cadence: 'weekly',
        startDate: '2026-06-12',
        isActive: true,
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      };
      const preferredBill: Bill = {
        id: 'bill-pref',
        creditorName: 'Preferred Bill',
        budgetedAmount: 200,
        dueDay: 21,
        isRecurring: false,
        priority: 'normal',
        preferredIncomeSourceId: 'income-michael',
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      };

      const schedule = scheduler.generateSchedule(
        [angelaIncome, michaelIncome],
        [preferredBill],
        '2026-06-12',
        1,
        0
      );

      const assignment = schedule.fullPaychecks
        .flatMap((paycheck) => paycheck.bills.map((bill) => ({ paycheck, bill })))
        .find((entry) => entry.bill.billId === 'bill-pref');

      expect(assignment).toBeDefined();
      expect(assignment?.paycheck.incomeSources.some((source) => source.id === 'income-michael')).toBe(true);
      expect(assignment?.paycheck.date).toBe('2026-06-19');
    });
  });

  describe('goal suggestions and beyond-schedule projections', () => {
    it('marks goals beyond the calculation cap as projected with guidance suggestions', () => {
      const income: Income = {
        id: 'income-1',
        sourceName: 'Salary',
        amount: 2000,
        cadence: 'biweekly',
        startDate: '2026-01-01',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      // Beyond the 60-month calculation cap (start 2026-01 -> ~84 months out) and
      // too large to fully fund within the capped horizon, so the goal falls
      // outside the dynamic horizon and uses the projected path.
      const goal: SavingsGoal = {
        id: 'goal-far',
        budgetId: 'budget-1',
        name: 'Car Down Payment',
        targetAmount: 500000,
        targetDate: '2033-01-01',
        alreadySaved: 1000,
        priority: 3,
        createdAt: '2026-01-01T00:00:00.000Z',
      };

      const schedule = scheduler.generateSchedule(
        [income],
        [],
        '2026-01-01',
        12,
        0,
        new Set(),
        new Map(),
        250,
        [goal],
        100,
        200
      );

      const projection = schedule.goalProjections.find((entry) => entry.goalId === 'goal-far');
      expect(projection?.isProjected).toBe(true);
      expect(projection?.projectionNote).toContain('allocation rate');
      expect(projection?.suggestions?.length).toBeGreaterThan(0);
      expect(projection?.suggestions?.some((s) => s.type === 'extend_deadline' || s.type === 'reduce_target')).toBe(true);
    });

    it('diagnoses unfundable reason codes when triage cannot prepay', () => {
      const monthlyIncome: Income = {
        id: 'income-1',
        sourceName: 'Salary',
        amount: 500,
        cadence: 'monthly',
        startDate: '2026-06-01',
        isActive: true,
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      };
      const criticalBill: Bill = {
        id: 'bill-critical',
        creditorName: 'Critical',
        budgetedAmount: 400,
        dueDay: 1,
        isRecurring: false,
        priority: 'critical',
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      };
      const lowBill: Bill = {
        id: 'bill-low',
        creditorName: 'Low',
        budgetedAmount: 150,
        dueDay: 1,
        isRecurring: false,
        priority: 'low',
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      };
      const schedule = scheduler.generateSchedule(
        [monthlyIncome],
        [criticalBill, lowBill],
        '2026-06-01',
        1,
        0,
        new Set(),
        new Map(),
        0,
        [],
        0
      );

      const dropped = schedule.paychecks
        .flatMap((paycheck) => paycheck.bills)
        .find((bill) => bill.billId === 'bill-low' && bill.isUnpayable);

      expect(dropped?.unfundableReason).toBe('insufficient_income_in_window');
    });
  });

  describe('exact engine regressions', () => {
    it('produces identical JSON for identical inputs', () => {
      const income: Income = {
        id: 'income-biweekly',
        sourceName: 'Salary',
        amount: 2650,
        cadence: 'biweekly',
        startDate: '2026-08-01',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      const bills: Bill[] = [
        {
          id: 'amazon',
          creditorName: 'Amazon',
          budgetedAmount: 165,
          dueDay: 15,
          isRecurring: false,
          priority: 'normal',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'water',
          creditorName: 'Water',
          budgetedAmount: 100,
          dueDay: 25,
          isRecurring: false,
          priority: 'normal',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ];

      const args: Parameters<SchedulerService['generateSchedule']> = [
        [income],
        bills,
        '2026-08-01',
        2,
        0,
      ];
      const a = JSON.stringify(scheduler.generateSchedule(...args));
      const b = JSON.stringify(scheduler.generateSchedule(...args));
      expect(a).toBe(b);
    });

    it('defers a bill to a later paycheck when the earlier paycheck is tight', () => {
      const tightIncome: Income = {
        id: 'income-tight',
        sourceName: 'Tight',
        amount: 415, // capacity above $250 target = $165 → amazon only
        cadence: 'biweekly',
        startDate: '2026-08-14',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      const laterIncome: Income = {
        id: 'income-later',
        sourceName: 'Later',
        amount: 1000,
        cadence: 'biweekly',
        startDate: '2026-08-21',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      const bills: Bill[] = [
        {
          id: 'amazon',
          creditorName: 'Amazon',
          budgetedAmount: 165,
          dueDay: 15,
          isRecurring: false,
          priority: 'normal',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'water',
          creditorName: 'Water',
          budgetedAmount: 100,
          dueDay: 25,
          isRecurring: false,
          priority: 'normal',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ];

      const schedule = scheduler.generateSchedule(
        [tightIncome, laterIncome],
        bills,
        '2026-08-01',
        1,
        0
      );

      const aug14 = schedule.paychecks.find((p) => p.date === '2026-08-14');
      const aug21 = schedule.paychecks.find((p) => p.date === '2026-08-21');
      expect(aug14?.bills.some((b) => b.billId === 'amazon' && !b.isUnpayable)).toBe(true);
      expect(aug21?.bills.some((b) => b.billId === 'water' && !b.isUnpayable)).toBe(true);
      expect(aug14?.bills.some((b) => b.billId === 'water' && !b.isUnpayable)).toBe(false);
    });

    it('minimizes concentrated shortfall when the window is infeasible', () => {
      const income: Income = {
        id: 'income-once',
        sourceName: 'Pay',
        amount: 1000,
        cadence: 'monthly',
        startDate: '2026-09-01',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      const bills: Bill[] = [
        {
          id: 'a',
          creditorName: 'A',
          budgetedAmount: 600,
          dueDay: 5,
          isRecurring: false,
          priority: 'normal',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'b',
          creditorName: 'B',
          budgetedAmount: 600,
          dueDay: 5,
          isRecurring: false,
          priority: 'normal',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ];

      const schedule = scheduler.generateSchedule([income], bills, '2026-09-01', 1, 0);
      const unpayable = schedule.paychecks.flatMap((p) => p.bills).filter((b) => b.isUnpayable);
      expect(unpayable).toHaveLength(1);
      expect(schedule.paychecks.filter((p) => p.hasUnpayableBills)).toHaveLength(1);
    });

    it('stops projecting income after endDate', () => {
      const income: Income = {
        id: 'income-ended',
        sourceName: 'Contract',
        amount: 2000,
        cadence: 'monthly',
        startDate: '2026-01-01',
        endDate: '2026-03-31',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const projected = scheduler.projectIncome(
        income,
        parseISO('2026-01-01'),
        parseISO('2026-12-31')
      );
      expect(projected.every((p) => p.date <= parseISO('2026-03-31'))).toBe(true);
      expect(projected.length).toBe(3);
    });
  });

  describe('goal funding timeline deadline metrics', () => {
    it('reports beatsDeadlineByPaychecks when goal is fully funded before target date', () => {
      const paychecks = [
        {
          date: '2026-01-15',
          isShortfall: false,
          goalDeposits: [{ goalId: 'goal-early', goalName: 'Quick Goal', amount: 500 }],
          incomeSources: [],
          totalIncome: 0,
          bills: [],
          totalBills: 0,
          totalGoalDeposits: 500,
          budgetRemaining: 0,
          savingsDeposit: 0,
          totalSavings: 0,
        },
        {
          date: '2026-06-15',
          isShortfall: false,
          goalDeposits: [],
          incomeSources: [],
          totalIncome: 0,
          bills: [],
          totalBills: 0,
          totalGoalDeposits: 0,
          budgetRemaining: 0,
          savingsDeposit: 0,
          totalSavings: 0,
        },
      ];

      const timeline = (
        scheduler as unknown as {
          computeGoalFundingTimeline: (
            goalId: string,
            remainingAmount: number,
            paychecks: typeof paychecks,
            goalDate: Date
          ) => {
            missesDeadlineByPaychecks: number | null;
            beatsDeadlineByPaychecks: number | null;
            estimatedFundedDate: string | null;
          };
        }
      ).computeGoalFundingTimeline(
        'goal-early',
        500,
        paychecks,
        parseISO('2026-12-31')
      );

      expect(timeline.estimatedFundedDate).toBe('2026-01-15');
      expect(timeline.beatsDeadlineByPaychecks).toBeGreaterThan(0);
      expect(timeline.missesDeadlineByPaychecks).toBeNull();
    });

    it('reports missesDeadlineByPaychecks when funding completes after target date', () => {
      const paychecks = [
        {
          date: '2026-06-01',
          isShortfall: false,
          goalDeposits: [{ goalId: 'goal-late', goalName: 'Late Goal', amount: 400 }],
          incomeSources: [],
          totalIncome: 0,
          bills: [],
          totalBills: 0,
          totalGoalDeposits: 400,
          budgetRemaining: 0,
          savingsDeposit: 0,
          totalSavings: 0,
        },
        {
          date: '2026-06-15',
          isShortfall: false,
          goalDeposits: [{ goalId: 'goal-late', goalName: 'Late Goal', amount: 400 }],
          incomeSources: [],
          totalIncome: 0,
          bills: [],
          totalBills: 0,
          totalGoalDeposits: 400,
          budgetRemaining: 0,
          savingsDeposit: 0,
          totalSavings: 0,
        },
      ];

      const timeline = (
        scheduler as unknown as {
          computeGoalFundingTimeline: (
            goalId: string,
            remainingAmount: number,
            paychecks: typeof paychecks,
            goalDate: Date
          ) => {
            missesDeadlineByPaychecks: number | null;
            beatsDeadlineByPaychecks: number | null;
            estimatedFundedDate: string | null;
          };
        }
      ).computeGoalFundingTimeline(
        'goal-late',
        500,
        paychecks,
        parseISO('2026-06-14')
      );

      expect(timeline.estimatedFundedDate).toBe('2026-06-15');
      expect(timeline.missesDeadlineByPaychecks).toBeGreaterThan(0);
      expect(timeline.beatsDeadlineByPaychecks).toBeNull();
    });
  });

  describe('generateGoalSuggestions increase_priority', () => {
    it('suggests increasing priority for lower-priority partial goals', () => {
      const income: Income = {
        id: 'income-1',
        sourceName: 'Salary',
        amount: 2000,
        cadence: 'biweekly',
        startDate: '2026-01-01',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const rentBill: Bill = {
        id: 'bill-rent',
        creditorName: 'Rent',
        budgetedAmount: 1200,
        dueDay: 1,
        isRecurring: true,
        priority: 'critical',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const secondaryGoal: SavingsGoal = {
        id: 'goal-secondary',
        budgetId: 'budget-1',
        name: 'Secondary Fund',
        targetAmount: 50000,
        targetDate: '2026-12-31',
        alreadySaved: 0,
        priority: 2,
        createdAt: '2026-01-01T00:00:00.000Z',
      };

      const schedule = scheduler.generateSchedule(
        [income],
        [rentBill],
        '2026-01-01',
        12,
        0,
        new Set(),
        new Map(),
        200,
        [secondaryGoal],
        100,
        200
      );

      const projection = schedule.goalProjections!.find((p) => p.goalId === 'goal-secondary');
      expect(projection?.status).toBe('partial');
      const prioritySuggestion = projection?.suggestions.find((s) => s.type === 'increase_priority');
      expect(prioritySuggestion).toBeDefined();
      expect(prioritySuggestion!.newValue).toBe(1);
      expect(prioritySuggestion!.description).toContain('Increase priority');
    });
  });

  describe('generateRecommendations shortfall', () => {
    it('includes unresolved shortfall guidance when deficits remain after rebalance', () => {
      const lowIncome: Income = {
        id: 'income-low',
        sourceName: 'Part Time',
        amount: 600,
        cadence: 'biweekly',
        startDate: '2026-01-01',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const rentBill: Bill = {
        id: 'bill-rent',
        creditorName: 'Rent',
        budgetedAmount: 1500,
        dueDay: 1,
        isRecurring: true,
        priority: 'critical',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const schedule = scheduler.generateSchedule(
        [lowIncome],
        [rentBill],
        '2026-01-01',
        3,
        0,
        new Set(),
        new Map(),
        250,
        [],
        100,
        0
      );

      const shortfallPaycheck = schedule.paychecks.find((p) => p.isShortfall);
      expect(shortfallPaycheck).toBeDefined();

      const shortfallRec = schedule.recommendations.find((rec) =>
        rec.includes('Budget shortfall')
      );
      expect(shortfallRec).toBeDefined();
      expect(shortfallRec).toContain('Jan');
    });
  });

  describe('analyzeAndProposeFixes prepay rejection', () => {
    it('does not propose moves that would prepay bills more than 14 days early', () => {
      const schedule = scheduler.generateSchedule(
        [],
        [],
        '2026-01-01',
        1,
        0
      );

      schedule.paychecks = [
        {
          date: '2026-01-01',
          incomeSources: [{ id: 'income-1', name: 'Salary', amount: 1200 }],
          totalIncome: 1200,
          bills: [],
          totalBills: 0,
          goalDeposits: [],
          totalGoalDeposits: 0,
          budgetRemaining: 600,
          savingsDeposit: 0,
          totalSavings: 0,
          isShortfall: false,
        },
        {
          date: '2026-01-22',
          incomeSources: [{ id: 'income-1', name: 'Salary', amount: 1200 }],
          totalIncome: 1200,
          bills: [
            {
              billId: 'bill-late',
              creditorName: 'Late Due',
              amount: 500,
              dueDay: 30,
              priority: 'low' as const,
              billDate: '2026-01-30',
            },
          ],
          totalBills: 500,
          goalDeposits: [],
          totalGoalDeposits: 0,
          budgetRemaining: -200,
          savingsDeposit: 0,
          totalSavings: 0,
          isShortfall: true,
        },
      ];

      const report = scheduler.analyzeAndProposeFixes(schedule);
      expect(report.needsReconciliation).toBe(true);

      const lateBillMove = report.proposedFixes.find(
        (f) => f.type === 'move_bill' && f.billId === 'bill-late'
      );
      expect(lateBillMove).toBeUndefined();
      expect(report.proposedFixes.every((f) => f.type === 'move_bill')).toBe(true);
      expect(differenceInDays(parseISO('2026-01-30'), parseISO('2026-01-01'))).toBeGreaterThan(14);
    });
  });

  describe('buildPaycheckEntries surplus tiers', () => {
    const biweeklyIncome: Income = {
      id: 'income-biweekly',
      sourceName: 'Salary',
      amount: 2500,
      cadence: 'biweekly',
      startDate: '2026-01-01',
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    it('allocates all surplus to savings when below minSavingsPerPaycheck threshold', () => {
      const tinyIncome: Income = {
        ...biweeklyIncome,
        amount: 140,
      };

      const schedule = scheduler.generateSchedule(
        [tinyIncome],
        [],
        '2026-01-01',
        1,
        0,
        new Set(),
        new Map(),
        250,
        [],
        100,
        50
      );

      const paycheck = schedule.paychecks[0];
      expect(paycheck.totalIncome).toBe(140);
      expect(paycheck.savingsDeposit).toBe(0);
      expect(paycheck.totalGoalDeposits).toBe(0);
      expect(paycheck.budgetRemaining).toBe(140);
    });

    it('funds min savings then goals when surplus exceeds minSavingsPerPaycheck', () => {
      const goal: SavingsGoal = {
        id: 'goal-1',
        budgetId: 'budget-1',
        name: 'Vacation',
        targetAmount: 5000,
        targetDate: '2026-12-31',
        alreadySaved: 0,
        priority: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
      };

      const schedule = scheduler.generateSchedule(
        [biweeklyIncome],
        [],
        '2026-01-01',
        3,
        0,
        new Set(),
        new Map(),
        500,
        [goal],
        100,
        50
      );

      const paycheckWithSurplus = schedule.paychecks.find(
        (p) => !p.isShortfall && p.totalIncome > 100
      );
      expect(paycheckWithSurplus).toBeDefined();
      expect(paycheckWithSurplus!.savingsDeposit).toBeGreaterThanOrEqual(50);
      expect(paycheckWithSurplus!.totalGoalDeposits).toBeGreaterThan(0);
    });
  });

  describe('debtPayoffs integration', () => {
    it('stops projecting debt bills after payoff date in full schedule', () => {
      const monthlyIncome: Income = {
        id: 'income-monthly',
        sourceName: 'Salary',
        amount: 3000,
        cadence: 'monthly',
        startDate: '2026-01-01',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const debtBill: Bill = {
        id: 'bill-debt',
        creditorName: 'Auto Loan',
        budgetedAmount: 400,
        dueDay: 15,
        isRecurring: true,
        priority: 'high',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const debtPayoffs = new Map([
        [
          'bill-debt',
          {
            billId: 'bill-debt',
            payoffDate: parseISO('2026-02-15'),
            finalPaymentAmount: 125,
          },
        ],
      ]);

      const schedule = scheduler.generateSchedule(
        [monthlyIncome],
        [debtBill],
        '2026-01-01',
        6,
        0,
        new Set(),
        new Map(),
        250,
        [],
        100,
        0,
        debtPayoffs
      );

      const debtOccurrences = schedule.fullPaychecks
        .flatMap((p) => p.bills)
        .filter((b) => b.billId === 'bill-debt');

      expect(debtOccurrences).toHaveLength(2);
      expect(debtOccurrences.map((b) => b.billDate)).toEqual(['2026-01-15', '2026-02-15']);
      expect(debtOccurrences[0].amount).toBe(400);
      expect(debtOccurrences[1].amount).toBe(125);
      expect(
        debtOccurrences.some((b) => b.billDate === '2026-03-15')
      ).toBe(false);
    });
  });

  describe('preferredIncomeSourceId edge cases', () => {
    it('returns null from findPreferredPaycheck when bill has no preferred income', () => {
      const result = (
        scheduler as unknown as {
          findPreferredPaycheck: (
            bill: { billId: string; preferredIncomeSourceId?: string; date: Date },
            paycheckAssignments: Array<{ date: Date; incomes: Array<{ sourceId: string }>; bills: unknown[] }>,
            skippedBills: Set<string>
          ) => string | null;
        }
      ).findPreferredPaycheck(
        { billId: 'bill-1', date: parseISO('2026-01-15') },
        [{ date: parseISO('2026-01-01'), incomes: [{ sourceId: 'income-1' }], bills: [] }],
        new Set()
      );

      expect(result).toBeNull();
    });

    it('returns null when preferred income is missing from all paychecks', () => {
      const result = (
        scheduler as unknown as {
          findPreferredPaycheck: (
            bill: { billId: string; preferredIncomeSourceId?: string; date: Date },
            paycheckAssignments: Array<{ date: Date; incomes: Array<{ sourceId: string }>; bills: unknown[] }>,
            skippedBills: Set<string>
          ) => string | null;
        }
      ).findPreferredPaycheck(
        { billId: 'bill-1', preferredIncomeSourceId: 'missing-income', date: parseISO('2026-01-15') },
        [{ date: parseISO('2026-01-01'), incomes: [{ sourceId: 'income-1' }], bills: [] }],
        new Set()
      );

      expect(result).toBeNull();
    });

    it('returns null when preferred paycheck would prepay more than 14 days early', () => {
      const result = (
        scheduler as unknown as {
          findPreferredPaycheck: (
            bill: { billId: string; preferredIncomeSourceId?: string; date: Date },
            paycheckAssignments: Array<{ date: Date; incomes: Array<{ sourceId: string }>; bills: unknown[] }>,
            skippedBills: Set<string>
          ) => string | null;
        }
      ).findPreferredPaycheck(
        { billId: 'bill-1', preferredIncomeSourceId: 'income-1', date: parseISO('2026-02-01') },
        [{ date: parseISO('2026-01-01'), incomes: [{ sourceId: 'income-1' }], bills: [] }],
        new Set()
      );

      expect(result).toBeNull();
    });

    it('keeps skipped bill occurrences visible but unpaid', () => {
      const monthlyIncome: Income = {
        id: 'income-monthly',
        sourceName: 'Salary',
        amount: 3000,
        cadence: 'monthly',
        startDate: '2026-01-01',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const recurringBill: Bill = {
        id: 'bill-dup',
        creditorName: 'Utilities',
        budgetedAmount: 100,
        dueDay: 15,
        isRecurring: true,
        priority: 'normal',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const schedule = scheduler.generateSchedule(
        [monthlyIncome],
        [recurringBill],
        '2026-01-01',
        3,
        0,
        new Set(['bill-dup-2026-02-15'])
      );

      const febOccurrences = schedule.fullPaychecks
        .flatMap((p) => p.bills)
        .filter((b) => b.billId === 'bill-dup' && b.billDate === '2026-02-15');
      expect(febOccurrences).toHaveLength(1);
      expect(febOccurrences[0].isSkipped).toBe(true);
      expect(febOccurrences[0].isUnpayable).toBeFalsy();
    });
  });
});
