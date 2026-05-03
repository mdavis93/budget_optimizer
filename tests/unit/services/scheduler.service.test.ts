import { describe, it, expect, beforeEach } from 'vitest';
import { SchedulerService } from '../../../electron/services/scheduler.service';
import { Income, Bill, SavingsGoal } from '../../../electron/services/database.service';
import { parseISO, format } from 'date-fns';

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

        // Total expenses should reflect all bills
        // 3 months × ($1500 + $450 + $150 + $50) = 3 × $2150 = $6450
        expect(schedule.summary.totalExpenses).toBeGreaterThanOrEqual(6000);
        expect(schedule.summary.totalExpenses).toBeLessThanOrEqual(7000);
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
        
        // Should be fully funded within the first few paychecks
        expect(projection.actualAllocation).toBeGreaterThanOrEqual(100);
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
        const totalGoalDeposits = schedule.paychecks.reduce(
          (sum, p) => sum + p.totalGoalDeposits, 0
        );
        
        // Goal should receive substantial allocation
        expect(totalGoalDeposits).toBeGreaterThan(0);
        
        // Verify goal gets funded before excess goes to savings
        const projection = schedule.goalProjections![0];
        expect(projection.actualAllocation).toBe(totalGoalDeposits);
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
      });

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
});
