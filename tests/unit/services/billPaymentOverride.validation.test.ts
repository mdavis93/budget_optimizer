import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { CryptoService } from '../../../electron/services/crypto.service';
import { DatabaseService } from '../../../electron/services/database.service';
import {
  validateBillPaymentOverride,
  validateDraftOverlay,
} from '../../../electron/services/validation.service';
import { MAX_BILL_BUDGETED_AMOUNT } from '@shared/limits';

vi.mock('../../../electron/services/logger.service', () => ({
  databaseLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../electron/services/diagnostics.service', () => ({
  diagnostics: { report: vi.fn() },
}));

let tempRoot = '';
const mockGetPath = vi.fn((name: string) => {
  if (name === 'userData') return tempRoot;
  return tempRoot;
});

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => mockGetPath(name),
  },
}));

async function createCrypto(): Promise<CryptoService> {
  const crypto = new CryptoService();
  const salt = crypto.generateSalt();
  crypto.setEncryptionKey(await crypto.deriveKey('test-password', salt));
  return crypto;
}

describe('bill payment override validation and persistence', () => {
  let db: DatabaseService;

  beforeEach(async () => {
    tempRoot = path.join(
      os.tmpdir(),
      `budget-optimizer-bpo-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    fs.mkdirSync(tempRoot, { recursive: true });
    db = new DatabaseService(await createCrypto(), path.join(tempRoot, 'test.db'));
    db.initialize();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('rejects invalid amounts, ids, and dates', () => {
    expect(
      validateBillPaymentOverride({
        billId: 'bad',
        billDate: '2026-01-15',
        amount: 10,
      }).valid
    ).toBe(false);
    expect(
      validateBillPaymentOverride({
        billId: 'bill-12345678',
        billDate: '01/15/2026',
        amount: 10,
      }).valid
    ).toBe(false);
    expect(
      validateBillPaymentOverride({
        billId: 'bill-12345678',
        billDate: '2026-01-15',
        amount: 0,
      }).valid
    ).toBe(false);
    expect(
      validateBillPaymentOverride({
        billId: 'bill-12345678',
        billDate: '2026-01-15',
        amount: -1,
      }).valid
    ).toBe(false);
    expect(
      validateBillPaymentOverride({
        billId: 'bill-12345678',
        billDate: '2026-01-15',
        amount: MAX_BILL_BUDGETED_AMOUNT + 1,
      }).valid
    ).toBe(false);
    expect(
      validateBillPaymentOverride({
        billId: 'bill-12345678',
        billDate: '2026-01-15',
        amount: Number.NaN,
      }).valid
    ).toBe(false);

    expect(
      validateDraftOverlay({
        billPaymentOverrides: [
          { billId: 'bad', billDate: 'nope', amount: -5 },
          {
            billId: 'bill-12345678',
            billDate: '2026-01-15',
            amount: MAX_BILL_BUDGETED_AMOUNT + 1,
          },
        ],
      }).valid
    ).toBe(false);
  });

  it('stores encrypted payloads, upserts by key, rejects unknown bills, deletes with bill', () => {
    const budget = db.createBudget({ name: 'Bill Payment Override Budget' });
    const bill = db.createBillEntry(budget.id, {
      creditorName: 'Rent',
      budgetedAmount: 1400,
      dueDay: 1,
      isRecurring: true,
      priority: 'critical',
    });

    expect(() =>
      db.setBillPaymentOverride(budget.id, 'missing-bill-id', '2026-01-15', 200)
    ).toThrow(/does not exist/i);

    const first = db.setBillPaymentOverride(budget.id, bill.id, '2026-01-15', 200);
    const second = db.setBillPaymentOverride(budget.id, bill.id, '2026-01-15', 250);
    expect(second.id).not.toBe(first.id);
    expect(db.getBillPaymentOverrides(budget.id)).toHaveLength(1);
    expect(db.getBillPaymentOverrides(budget.id)[0].amount).toBe(250);

    const rawDb = (db as unknown as { db: { prepare: (sql: string) => { get: (id: string) => { data: string } } } }).db;
    const row = rawDb.prepare('SELECT data FROM bill_payment_overrides WHERE budget_id = ?').get(budget.id);
    expect(row.data.includes('250')).toBe(false);
    expect(row.data.includes('"amount"')).toBe(false);

    expect(db.deleteBillEntry(bill.id, budget.id)).toBe(true);
    expect(db.getBillPaymentOverrides(budget.id)).toHaveLength(0);
  });
});
