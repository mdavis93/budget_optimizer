import { useState } from 'react';
import clsx from 'clsx';
import { Bill, DebtInput, DebtWithAmortization } from '../../types';

interface DebtFormProps {
  debt?: DebtWithAmortization;
  bills: Bill[];
  existingDebtBillIds: Set<string>;
  preselectedBill?: Bill;
  onSubmit: (data: DebtInput) => void;
  onCancel: () => void;
}

export default function DebtForm({ debt, bills, existingDebtBillIds, preselectedBill, onSubmit, onCancel }: DebtFormProps) {
  const [billId, setBillId] = useState(debt?.debt.billId ?? preselectedBill?.id ?? '');
  const [principalBalance, setPrincipalBalance] = useState(debt?.debt.principalBalance?.toString() ?? '');
  const [apr, setApr] = useState(debt?.debt.apr ? (debt.debt.apr * 100).toString() : '');
  const [monthlyPayment, setMonthlyPayment] = useState(() => {
    if (debt?.debt.monthlyPayment) return debt.debt.monthlyPayment.toString();
    if (preselectedBill) return preselectedBill.budgetedAmount.toString();
    return '';
  });

  const isPreselected = !!preselectedBill;
  const debtBills = bills.filter(b => 
    b.category === 'Debt' && 
    (b.id === debt?.debt.billId || b.id === preselectedBill?.id || !existingDebtBillIds.has(b.id))
  );

  // Get the selected bill to calculate extra payment
  const selectedBill = bills.find(b => b.id === billId);
  const extraPayment = selectedBill && monthlyPayment 
    ? Math.max(0, selectedBill.budgetedAmount - parseFloat(monthlyPayment || '0'))
    : 0;

  const handleBillChange = (newBillId: string) => {
    setBillId(newBillId);
    const newSelectedBill = bills.find(b => b.id === newBillId);
    if (newSelectedBill && !monthlyPayment) {
      setMonthlyPayment(newSelectedBill.budgetedAmount.toString());
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      billId,
      principalBalance: parseFloat(principalBalance),
      apr: parseFloat(apr) / 100,
      monthlyPayment: parseFloat(monthlyPayment),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="debt-bill" className="label">Linked Bill</label>
        <select
          id="debt-bill"
          value={billId}
          onChange={(e) => handleBillChange(e.target.value)}
          className="input"
          required
          disabled={!!debt || isPreselected}
        >
          <option value="">Select a debt bill...</option>
          {debtBills.map((bill) => (
            <option key={bill.id} value={bill.id}>
              {bill.creditorName} (${bill.budgetedAmount.toFixed(2)}/mo)
            </option>
          ))}
        </select>
        {debtBills.length === 0 && !isPreselected && (
          <p className="text-sm text-warning-500 mt-1">
            No debt bills available. Create a bill with category "Debt" first.
          </p>
        )}
      </div>

      <div>
        <label htmlFor="debt-principal" className="label">Remaining Balance (Principal)</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-(--color-text-muted)">$</span>
          <input
            id="debt-principal"
            type="number"
            step="0.01"
            min="0"
            value={principalBalance}
            onChange={(e) => setPrincipalBalance(e.target.value)}
            className="input pl-7"
            placeholder="0.00"
            required
          />
        </div>
      </div>

      <div>
        <label htmlFor="debt-apr" className="label">Annual Percentage Rate (APR)</label>
        <div className="relative">
          <input
            id="debt-apr"
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={apr}
            onChange={(e) => setApr(e.target.value)}
            className="input pr-7"
            placeholder="0.00"
            required
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-(--color-text-muted)">%</span>
        </div>
      </div>

      <div>
        <label htmlFor="debt-monthly-payment" className="label">Monthly Payment</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-(--color-text-muted)">$</span>
          <input
            id="debt-monthly-payment"
            type="number"
            step="0.01"
            min="0"
            value={monthlyPayment}
            onChange={(e) => setMonthlyPayment(e.target.value)}
            className="input pl-7"
            placeholder="0.00"
            required
          />
        </div>
        <p className="text-xs text-(--color-text-muted) mt-1">
          The amount you pay each month toward this debt
        </p>
      </div>

      {selectedBill && monthlyPayment && (
        <div className="p-3 rounded-lg bg-(--color-bg-secondary) border border-(--color-border)">
          <p className="text-sm font-medium text-(--color-text-secondary)">Extra Payment (auto-calculated)</p>
          <p className={clsx(
            'text-lg font-semibold',
            extraPayment > 0 ? 'text-success-400' : 'text-(--color-text-muted)'
          )}>
            {extraPayment > 0 ? `+$${extraPayment.toFixed(2)}/mo` : 'None'}
          </p>
          <p className="text-xs text-(--color-text-muted) mt-1">
            Based on bill budget (${selectedBill.budgetedAmount.toFixed(2)}) minus minimum payment.
            To pay extra, increase the budgeted amount on the linked bill.
          </p>
        </div>
      )}

      <div className="flex justify-end gap-3 pt-4">
        <button type="button" onClick={onCancel} className="btn-secondary">
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={!billId || debtBills.length === 0}>
          {debt ? 'Update' : 'Add'} Debt
        </button>
      </div>
    </form>
  );
}
