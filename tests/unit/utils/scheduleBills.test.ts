import { describe, it, expect } from 'vitest';
import {
  filterPaycheckBills,
  isBillMovedToPaycheck,
} from '../../../src/utils/scheduleBills';
import { BillAssignment, PaycheckBill } from '../../../src/types';

describe('scheduleBills', () => {
  const affirmBill: PaycheckBill = {
    billId: 'bill-affirm',
    creditorName: 'Affirm: First Tee Golf',
    amount: 181,
    dueDay: 16,
    priority: 'high',
    billDate: '2026-06-16',
  };

  const ccBill: PaycheckBill = {
    billId: 'bill-cc',
    creditorName: 'CC: SW [A]',
    amount: 125,
    dueDay: 21,
    priority: 'normal',
    billDate: '2026-06-21',
  };

  const uncBill: PaycheckBill = {
    billId: 'bill-unc',
    creditorName: 'UNC Health Systems',
    amount: 125,
    dueDay: 21,
    priority: 'normal',
    billDate: '2026-06-21',
  };

  const assignments: BillAssignment[] = [
    {
      id: 'assign-1',
      billId: 'bill-cc',
      billDueDate: '2026-06-21',
      paycheckDate: '2026-06-19',
      createdAt: '2026-06-09T00:00:00.000Z',
    },
    {
      id: 'assign-2',
      billId: 'bill-unc',
      billDueDate: '2026-06-21',
      paycheckDate: '2026-06-19',
      createdAt: '2026-06-09T00:00:00.000Z',
    },
  ];

  describe('filterPaycheckBills', () => {
    it('excludes bills manually assigned to a different paycheck', () => {
      // Simulates stale schedule data: moved bills still present on the source paycheck
      const june12PaycheckBills = [affirmBill, ccBill, uncBill];
      const june19PaycheckBills = [ccBill, uncBill];

      const june12Bills = filterPaycheckBills(june12PaycheckBills, assignments, '2026-06-12');
      const june19Bills = filterPaycheckBills(june19PaycheckBills, assignments, '2026-06-19');

      expect(june12Bills.map((b) => b.billId)).toEqual(['bill-affirm']);
      expect(june19Bills.map((b) => b.billId)).toEqual(['bill-cc', 'bill-unc']);
    });

    it('includes unassigned bills on their natural paycheck', () => {
      const bills = filterPaycheckBills([affirmBill], [], '2026-06-12');
      expect(bills).toHaveLength(1);
    });

    it('shows bills whose assignment targets a paycheck that no longer exists', () => {
      const staleAssignments: BillAssignment[] = [
        {
          id: 'assign-stale',
          billId: 'bill-rav4',
          billDueDate: '2026-09-01',
          paycheckDate: '2026-09-04', // leave-omitted paycheck
          createdAt: '2026-06-09T00:00:00.000Z',
        },
      ];
      const rav4: PaycheckBill = {
        billId: 'bill-rav4',
        creditorName: 'Car (RAV4)',
        amount: 225,
        dueDay: 1,
        priority: 'critical',
        billDate: '2026-09-01',
      };
      const visible = filterPaycheckBills(
        [rav4, affirmBill],
        staleAssignments,
        '2026-08-28',
        new Set(['2026-08-28', '2026-09-11'])
      );
      expect(visible.map((b) => b.billId)).toEqual(['bill-rav4', 'bill-affirm']);
    });
  });

  describe('isBillMovedToPaycheck', () => {
    it('returns true only on the target paycheck', () => {
      expect(
        isBillMovedToPaycheck(assignments, 'bill-cc', '2026-06-21', '2026-06-19')
      ).toBe(true);
      expect(
        isBillMovedToPaycheck(assignments, 'bill-cc', '2026-06-21', '2026-06-12')
      ).toBe(false);
    });
  });
});
