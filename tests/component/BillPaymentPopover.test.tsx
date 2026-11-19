import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BillPaymentPopover from '../../src/components/schedule/BillPaymentPopover';
import PaycheckBillRow from '../../src/components/schedule/PaycheckBillRow';
import type { PaycheckBill } from '../../src/types';

const formatCurrency = (amount: number) => `$${amount.toFixed(2)}`;

function anchorRect(): DOMRect {
  return {
    x: 40,
    y: 40,
    top: 40,
    left: 40,
    bottom: 60,
    right: 120,
    width: 80,
    height: 20,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('BillPaymentPopover', () => {
  it('renders occurrence label and series line; Enter saves raised amount', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onClear = vi.fn();
    const onDismiss = vi.fn();

    render(
      <BillPaymentPopover
        billDate="2026-04-15"
        seriesAmount={100}
        currentAmount={100}
        anchorRect={anchorRect()}
        formatCurrency={formatCurrency}
        onSave={onSave}
        onClear={onClear}
        onDismiss={onDismiss}
      />
    );

    expect(screen.getByText('Apr 15 only')).toBeInTheDocument();
    expect(screen.getByText('Series is $100.00')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();

    const input = screen.getByRole('spinbutton');
    await user.clear(input);
    await user.type(input, '125.5{Enter}');

    expect(onSave).toHaveBeenCalledWith(125.5);
    expect(onClear).not.toHaveBeenCalled();
  });

  it('shows Reset when raised and Reset clears', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(
      <BillPaymentPopover
        billDate="2026-04-15"
        seriesAmount={100}
        currentAmount={140}
        anchorRect={anchorRect()}
        formatCurrency={formatCurrency}
        onSave={vi.fn()}
        onClear={onClear}
        onDismiss={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onClear).toHaveBeenCalled();
  });

  it('saves an amount below series; equal series clears; zero and non-numeric do not save', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onClear = vi.fn();
    const onDismiss = vi.fn();
    render(
      <BillPaymentPopover
        billDate="2026-04-15"
        seriesAmount={100}
        currentAmount={100}
        anchorRect={anchorRect()}
        formatCurrency={formatCurrency}
        onSave={onSave}
        onClear={onClear}
        onDismiss={onDismiss}
      />
    );

    const input = screen.getByRole('spinbutton');
    await user.clear(input);
    await user.type(input, '90{Enter}');
    expect(onSave).toHaveBeenCalledWith(90);
    expect(onClear).not.toHaveBeenCalled();

    onSave.mockClear();
    await user.clear(input);
    await user.type(input, '0{Enter}');
    expect(onSave).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
    expect(screen.getByText('Must be greater than $0.00')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, '100{Enter}');
    expect(onClear).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();

    onClear.mockClear();
    await user.clear(input);
    await user.type(input, 'abc{Enter}');
    expect(onSave).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
  });

  it('Escape and outside click dismiss without saving', async () => {
    const onSave = vi.fn();
    const onDismiss = vi.fn();
    render(
      <BillPaymentPopover
        billDate="2026-04-15"
        seriesAmount={100}
        currentAmount={100}
        anchorRect={anchorRect()}
        formatCurrency={formatCurrency}
        onSave={onSave}
        onClear={vi.fn()}
        onDismiss={onDismiss}
      />
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();

    onDismiss.mockClear();
    fireEvent.pointerDown(document.body);
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe('PaycheckBillRow payment editor matrix', () => {
  const baseBill: PaycheckBill = {
    billId: 'bill-1',
    creditorName: 'Rent',
    amount: 900,
    seriesAmount: 900,
    dueDay: 1,
    priority: 'critical',
    billDate: '2026-04-15',
  };

  const cases = [
    {
      name: 'auto series',
      bill: baseBill,
      assignments: [],
      expectAmountButton: true,
      expectRestore: false,
      expectSkip: true,
      expectUnskip: false,
      expectDotted: false,
      expectDraggable: true,
    },
    {
      name: 'auto raised',
      bill: { ...baseBill, amount: 1100 },
      assignments: [],
      expectAmountButton: true,
      expectRestore: false,
      expectSkip: true,
      expectUnskip: false,
      expectDotted: true,
      expectDraggable: true,
    },
    {
      name: 'moved series',
      bill: baseBill,
      assignments: [
        {
          id: 'a1',
          billId: 'bill-1',
          billDueDate: '2026-04-15',
          paycheckDate: '2026-04-01',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      expectAmountButton: true,
      expectRestore: true,
      expectSkip: true,
      expectUnskip: false,
      expectDotted: false,
      expectDraggable: true,
    },
    {
      name: 'moved raised',
      bill: { ...baseBill, amount: 1100 },
      assignments: [
        {
          id: 'a1',
          billId: 'bill-1',
          billDueDate: '2026-04-15',
          paycheckDate: '2026-04-01',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      expectAmountButton: true,
      expectRestore: true,
      expectSkip: true,
      expectUnskip: false,
      expectDotted: true,
      expectDraggable: true,
    },
    {
      name: 'skipped series',
      bill: { ...baseBill, isSkipped: true },
      assignments: [],
      expectAmountButton: false,
      expectRestore: false,
      expectSkip: false,
      expectUnskip: true,
      expectDotted: false,
      expectDraggable: false,
    },
    {
      name: 'skipped raised',
      bill: { ...baseBill, amount: 1100, isSkipped: true },
      assignments: [
        {
          id: 'a1',
          billId: 'bill-1',
          billDueDate: '2026-04-15',
          paycheckDate: '2026-04-01',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      expectAmountButton: false,
      expectRestore: false,
      expectSkip: false,
      expectUnskip: true,
      expectDotted: true,
      expectDraggable: false,
    },
    {
      name: 'unpayable series',
      bill: { ...baseBill, isUnpayable: true },
      assignments: [],
      expectAmountButton: true,
      expectRestore: false,
      expectSkip: true,
      expectUnskip: false,
      expectDotted: false,
      expectDraggable: true,
    },
    {
      name: 'unpayable raised',
      bill: { ...baseBill, amount: 1100, isUnpayable: true },
      assignments: [],
      expectAmountButton: true,
      expectRestore: false,
      expectSkip: true,
      expectUnskip: false,
      expectDotted: true,
      expectDraggable: true,
    },
    {
      name: 'skipped wins over unpayable for amount button',
      bill: { ...baseBill, amount: 1100, isSkipped: true, isUnpayable: true },
      assignments: [],
      expectAmountButton: false,
      expectRestore: false,
      expectSkip: false,
      expectUnskip: true,
      expectDotted: true,
      expectDraggable: false,
    },
  ] as const;

  it.each(cases)('$name', (row) => {
    const onOpen = vi.fn();
    const onSave = vi.fn();
    const onClear = vi.fn();
    const onSkip = vi.fn();
    const onRestore = vi.fn();
    const { container } = render(
      <PaycheckBillRow
        bill={row.bill}
        paycheckDate="2026-04-01"
        formatCurrency={formatCurrency}
        onSkipBill={onSkip}
        onUnskipBill={vi.fn()}
        isSkipping={false}
        isUnskipping={false}
        onRestoreBill={onRestore}
        isRestoring={false}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
        draggedBill={null}
        billAssignments={[...row.assignments]}
        openPaymentKey={null}
        onOpenPaymentEditor={onOpen}
        onClosePaymentEditor={vi.fn()}
        onSavePaymentOverride={onSave}
        onClearPaymentOverride={onClear}
      />
    );

    const amountButton = screen.queryByTitle('Change this payment for this date only');
    expect(Boolean(amountButton)).toBe(row.expectAmountButton);
    expect(Boolean(screen.queryByRole('button', { name: /Restore/i }))).toBe(row.expectRestore);
    expect(Boolean(screen.queryByRole('button', { name: /^Skip$/i }))).toBe(row.expectSkip);
    expect(Boolean(screen.queryByRole('button', { name: /Unskip/i }))).toBe(row.expectUnskip);

    const amountNode = amountButton ?? screen.getByText(/-\$1,?100\.00|-\$900\.00/);
    expect(amountNode.className.includes('decoration-dotted')).toBe(row.expectDotted);

    const rowEl = container.firstElementChild as HTMLElement;
    expect(rowEl.getAttribute('draggable')).toBe(String(row.expectDraggable));

    if (amountButton) {
      fireEvent.click(amountButton);
      expect(onOpen).toHaveBeenCalledWith('bill-1', '2026-04-15');
      expect(onSkip).not.toHaveBeenCalled();
      expect(onRestore).not.toHaveBeenCalled();
    }
  });

  it('opens popover from amount and second open replaces first without auto-save', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onOpen = vi.fn((billId: string, billDate: string) => {
      openKey = `${billId}\0${billDate}`;
    });
    let openKey: string | null = null;

    const first = { ...baseBill, billId: 'bill-1', amount: 900 };
    const second = { ...baseBill, billId: 'bill-2', creditorName: 'Utils', amount: 50, seriesAmount: 50 };

    const view = render(
      <>
        <PaycheckBillRow
          bill={first}
          paycheckDate="2026-04-01"
          formatCurrency={formatCurrency}
          onSkipBill={vi.fn()}
          onUnskipBill={vi.fn()}
          isSkipping={false}
          isUnskipping={false}
          onRestoreBill={vi.fn()}
          isRestoring={false}
          onDragStart={vi.fn()}
          onDragEnd={vi.fn()}
          draggedBill={null}
          billAssignments={[]}
          openPaymentKey={openKey}
          onOpenPaymentEditor={onOpen}
          onClosePaymentEditor={() => {
            openKey = null;
          }}
          onSavePaymentOverride={onSave}
          onClearPaymentOverride={vi.fn()}
        />
        <PaycheckBillRow
          bill={second}
          paycheckDate="2026-04-01"
          formatCurrency={formatCurrency}
          onSkipBill={vi.fn()}
          onUnskipBill={vi.fn()}
          isSkipping={false}
          isUnskipping={false}
          onRestoreBill={vi.fn()}
          isRestoring={false}
          onDragStart={vi.fn()}
          onDragEnd={vi.fn()}
          draggedBill={null}
          billAssignments={[]}
          openPaymentKey={openKey}
          onOpenPaymentEditor={onOpen}
          onClosePaymentEditor={() => {
            openKey = null;
          }}
          onSavePaymentOverride={onSave}
          onClearPaymentOverride={vi.fn()}
        />
      </>
    );

    await user.click(screen.getAllByTitle('Change this payment for this date only')[0]);
    view.rerender(
      <>
        <PaycheckBillRow
          bill={first}
          paycheckDate="2026-04-01"
          formatCurrency={formatCurrency}
          onSkipBill={vi.fn()}
          onUnskipBill={vi.fn()}
          isSkipping={false}
          isUnskipping={false}
          onRestoreBill={vi.fn()}
          isRestoring={false}
          onDragStart={vi.fn()}
          onDragEnd={vi.fn()}
          draggedBill={null}
          billAssignments={[]}
          openPaymentKey={openKey}
          onOpenPaymentEditor={onOpen}
          onClosePaymentEditor={() => {
            openKey = null;
          }}
          onSavePaymentOverride={onSave}
          onClearPaymentOverride={vi.fn()}
        />
        <PaycheckBillRow
          bill={second}
          paycheckDate="2026-04-01"
          formatCurrency={formatCurrency}
          onSkipBill={vi.fn()}
          onUnskipBill={vi.fn()}
          isSkipping={false}
          isUnskipping={false}
          onRestoreBill={vi.fn()}
          isRestoring={false}
          onDragStart={vi.fn()}
          onDragEnd={vi.fn()}
          draggedBill={null}
          billAssignments={[]}
          openPaymentKey={openKey}
          onOpenPaymentEditor={onOpen}
          onClosePaymentEditor={() => {
            openKey = null;
          }}
          onSavePaymentOverride={onSave}
          onClearPaymentOverride={vi.fn()}
        />
      </>
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getAllByTitle('Change this payment for this date only')[1]);
    expect(onSave).not.toHaveBeenCalled();
  });
});
