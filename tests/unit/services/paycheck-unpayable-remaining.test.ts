import { describe, it, expect } from 'vitest';
import { parseISO } from 'date-fns';
import { buildPaycheckEntries } from '../../../electron/services/scheduler/paychecks';
import type { PaycheckAssignment } from '../../../electron/services/scheduler/types';

describe('buildPaycheckEntries unpayable remaining', () => {
  it('shows obligation deficit when a bill is unpayable (not payable-only surplus)', () => {
    const date = parseISO('2026-08-07');
    const assignments: PaycheckAssignment[] = [
      {
        date,
        incomes: [{ date, sourceId: 'angela', sourceName: 'Angela', amount: 1000 }],
        bills: [
          {
            date,
            billId: 'rav4',
            creditorName: 'Car (RAV4)',
            amount: 225,
            dueDay: 7,
            priority: 'critical',
            isUnpayable: false,
          },
          {
            date,
            billId: 'jeep',
            creditorName: 'Car (Jeep)',
            amount: 425,
            dueDay: 7,
            priority: 'critical',
            isUnpayable: true,
          },
          {
            date,
            billId: 'amazon',
            creditorName: 'CC: Amazon',
            amount: 165,
            dueDay: 7,
            priority: 'normal',
            isUnpayable: false,
          },
          {
            date,
            billId: 'kohls',
            creditorName: "CC: Kohl's",
            amount: 100,
            dueDay: 7,
            priority: 'normal',
            isUnpayable: false,
          },
          {
            date,
            billId: 'capa',
            creditorName: 'CC: Cap A',
            amount: 100,
            dueDay: 7,
            priority: 'normal',
            isUnpayable: false,
          },
          {
            date,
            billId: 'sw',
            creditorName: 'CC: SW [A]',
            amount: 125,
            dueDay: 7,
            priority: 'normal',
            isUnpayable: false,
          },
        ],
      },
    ];

    const [pc] = buildPaycheckEntries(assignments, 0, 250, [], 100, 0);

    expect(pc.totalBills).toBe(715);
    expect(pc.hasUnpayableBills).toBe(true);
    expect(pc.budgetRemaining).toBe(-140);
  });
});
