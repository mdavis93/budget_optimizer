import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeDirtyDomains,
  persistScheduleDomain,
} from '../../../src/utils/draftPersist';
import { createEmptyDraftState } from '../../../src/types/draft';
import { createMockBill, createMockElectronAPI, createMockIncome } from '../../mocks/electron-api.mock';
import { buildScheduleInputHash } from '../../../src/utils/scheduleInputHash';

function makeDraftState(
  overrides: Partial<ReturnType<typeof createEmptyDraftState>> = {}
) {
  return {
    ...createEmptyDraftState(),
    incomes: [createMockIncome()],
    bills: [createMockBill()],
    budget: {
      name: 'Personal',
      startingBalance: 1000,
      targetCashOnHand: 250,
      minCashOnHand: 100,
      minSavingsPerPaycheck: 50,
      accelerateDebtPayoff: false,
      scheduleStartDate: '2026-01-01',
    },
    ...overrides,
  };
}

describe('bill payment override persist independence', () => {
  beforeEach(() => {
    window.electronAPI = createMockElectronAPI();
  });

  it('persists override/skip/assignment independently and remaps draft bill ids', async () => {
    const occurrence = {
      billId: 'draft-bill-1',
      billDate: '2026-01-15',
    };
    const committed = makeDraftState();
    const draft = makeDraftState({
      skippedBills: [
        {
          id: 'skip-1',
          billId: occurrence.billId,
          skipDate: occurrence.billDate,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      billAssignments: [
        {
          id: 'asg-1',
          billId: occurrence.billId,
          billDueDate: occurrence.billDate,
          paycheckDate: '2026-01-01',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      billPaymentOverrides: [
        {
          id: 'bpo-1',
          billId: occurrence.billId,
          billDate: occurrence.billDate,
          amount: 200,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    const saved = await persistScheduleDomain(committed, draft, {
      income: new Map(),
      bill: new Map([['draft-bill-1', 'bill-real-1']]),
    });
    expect(saved.success).toBe(true);
    expect(window.electronAPI.billPaymentOverrides.set).toHaveBeenCalledWith(
      'bill-real-1',
      '2026-01-15',
      200
    );
    expect(window.electronAPI.skippedBills.skip).toHaveBeenCalledWith('bill-real-1', '2026-01-15');
    expect(window.electronAPI.billAssignments.assign).toHaveBeenCalledWith(
      'bill-real-1',
      '2026-01-15',
      '2026-01-01'
    );

    const withoutOverride = makeDraftState({
      skippedBills: draft.skippedBills.map((row) => ({ ...row, billId: 'bill-real-1' })),
      billAssignments: draft.billAssignments.map((row) => ({ ...row, billId: 'bill-real-1' })),
      billPaymentOverrides: [],
    });
    const committedWithAll = makeDraftState({
      skippedBills: withoutOverride.skippedBills,
      billAssignments: withoutOverride.billAssignments,
      billPaymentOverrides: [
        {
          id: 'bpo-1',
          billId: 'bill-real-1',
          billDate: '2026-01-15',
          amount: 200,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    vi.mocked(window.electronAPI.billPaymentOverrides.remove).mockClear();
    vi.mocked(window.electronAPI.skippedBills.unskip).mockClear();
    vi.mocked(window.electronAPI.billAssignments.remove).mockClear();

    const removeOverride = await persistScheduleDomain(committedWithAll, withoutOverride, {
      income: new Map(),
      bill: new Map(),
    });
    expect(removeOverride.success).toBe(true);
    expect(window.electronAPI.billPaymentOverrides.remove).toHaveBeenCalledWith(
      'bill-real-1',
      '2026-01-15'
    );
    expect(window.electronAPI.skippedBills.unskip).not.toHaveBeenCalled();
    expect(window.electronAPI.billAssignments.remove).not.toHaveBeenCalled();

    const withoutSkip = makeDraftState({
      skippedBills: [],
      billAssignments: withoutOverride.billAssignments,
      billPaymentOverrides: committedWithAll.billPaymentOverrides,
    });
    const removeSkip = await persistScheduleDomain(committedWithAll, withoutSkip, {
      income: new Map(),
      bill: new Map(),
    });
    expect(removeSkip.success).toBe(true);
    expect(window.electronAPI.skippedBills.unskip).toHaveBeenCalledWith('bill-real-1', '2026-01-15');
    expect(window.electronAPI.billPaymentOverrides.remove).toHaveBeenCalledTimes(1);

    const withoutAssignment = makeDraftState({
      skippedBills: withoutOverride.skippedBills,
      billAssignments: [],
      billPaymentOverrides: committedWithAll.billPaymentOverrides,
    });
    vi.mocked(window.electronAPI.billPaymentOverrides.remove).mockClear();
    const removeAssignment = await persistScheduleDomain(committedWithAll, withoutAssignment, {
      income: new Map(),
      bill: new Map(),
    });
    expect(removeAssignment.success).toBe(true);
    expect(window.electronAPI.billAssignments.remove).toHaveBeenCalledWith(
      'bill-real-1',
      '2026-01-15'
    );
    expect(window.electronAPI.billPaymentOverrides.remove).not.toHaveBeenCalled();
  });

  it('marks schedule dirty for payment overrides and changes schedule input hash', () => {
    const committed = makeDraftState();
    const draft = makeDraftState({
      billPaymentOverrides: [
        {
          id: 'bpo-1',
          billId: 'bill-1',
          billDate: '2026-01-15',
          amount: 200,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    expect(computeDirtyDomains(committed, draft).has('schedule')).toBe(true);

    const before = buildScheduleInputHash({
      incomes: committed.incomes,
      bills: committed.bills,
      skippedBills: [],
      billAssignments: [],
      incomeOverrides: [],
      billPaymentOverrides: [],
      budgetFields: committed.budget,
      now: new Date(0),
    });
    const after = buildScheduleInputHash({
      incomes: draft.incomes,
      bills: draft.bills,
      skippedBills: [],
      billAssignments: [],
      incomeOverrides: [],
      billPaymentOverrides: draft.billPaymentOverrides,
      budgetFields: draft.budget,
      now: new Date(0),
    });
    expect(before).not.toBe(after);
    expect(
      buildScheduleInputHash({
        incomes: draft.incomes,
        bills: draft.bills,
        skippedBills: [],
        billAssignments: [],
        incomeOverrides: [],
        billPaymentOverrides: draft.billPaymentOverrides,
        budgetFields: draft.budget,
        now: new Date(0),
      })
    ).toBe(after);
  });
});
