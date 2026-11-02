import fs from 'fs';
import os from 'os';
import path from 'path';
import ExcelJS from 'exceljs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpreadsheetService } from '../../../electron/services/spreadsheet.service';
import { createMockSchedule, createMockPaycheck } from '../../mocks/electron-api.mock';

describe('SpreadsheetService', () => {
  const createdFiles: string[] = [];

  afterEach(() => {
    for (const file of createdFiles) {
      fs.rmSync(file, { force: true });
    }
    createdFiles.length = 0;
  });

  describe('happy', () => {
    it('generates xlsx workbook from schedule fixture', async () => {
      const service = new SpreadsheetService();
      const schedule = createMockSchedule({
        paychecks: [
          createMockPaycheck(),
          createMockPaycheck({
            date: '2026-02-15',
            isShortfall: true,
            totalIncome: 1800,
            incomeSources: [
              { id: 'income-1', name: 'Salary', amount: 1500 },
              { id: 'income-2', name: 'Side', amount: 300 },
            ],
            bills: [{
              billId: 'bill-2',
              creditorName: 'Utilities',
              amount: 200,
              dueDay: 15,
              priority: 'normal' as const,
              category: 'utilities',
              billDate: '2026-02-15',
            }],
          }),
        ],
        recommendations: ['Great job saving', 'Watch shortfalls'],
      });
      const outputPath = path.join(os.tmpdir(), `budget-optimizer-spreadsheet-${Date.now()}.xlsx`);
      createdFiles.push(outputPath);

      const result = await service.generateXlsx(schedule as never, outputPath);
      expect(result.success).toBe(true);
      expect(fs.existsSync(outputPath)).toBe(true);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(outputPath);
      expect(workbook.getWorksheet('Summary')).toBeDefined();
      expect(workbook.getWorksheet('By Paycheck')).toBeDefined();
      expect(workbook.getWorksheet('Schedule')).toBeDefined();
    });

    it('writes income, bill, goal, and savings rows with shortfall highlighting', async () => {
      const service = new SpreadsheetService();
      const schedule = createMockSchedule({
        recommendations: [],
        paychecks: [
          createMockPaycheck({
            bills: [
              {
                billId: 'bill-1',
                creditorName: 'Rent',
                amount: 1500,
                dueDay: 1,
                priority: 'critical' as const,
                category: 'housing',
                billDate: '2026-01-01',
                isIncomeAttached: false,
                isUnpayable: false,
              },
              {
                billId: 'bill-2',
                creditorName: 'Phone',
                amount: 80,
                dueDay: 15,
                priority: 'normal' as const,
                category: 'utilities',
                billDate: '2026-01-15',
                isIncomeAttached: true,
                isUnpayable: false,
              },
            ],
            goalDeposits: [{ goalId: 'goal-1', goalName: 'Emergency', amount: 100 }],
            savingsDeposit: 75,
          }),
          createMockPaycheck({
            date: '2026-02-15',
            isShortfall: true,
            totalIncome: 1800,
            totalBills: 1900,
            budgetRemaining: -100,
            savingsDeposit: 0,
            incomeSources: [{ id: 'income-1', name: 'Salary', amount: 1800 }],
            bills: [{
              billId: 'bill-3',
              creditorName: 'Utilities',
              amount: 1900,
              dueDay: 15,
              priority: 'high' as const,
              category: 'utilities',
              billDate: '2026-02-15',
              isIncomeAttached: false,
              isUnpayable: false,
            }],
            goalDeposits: [],
            totalGoalDeposits: 0,
          }),
        ],
      });
      const outputPath = path.join(os.tmpdir(), `budget-optimizer-spreadsheet-rich-${Date.now()}.xlsx`);
      createdFiles.push(outputPath);

      const result = await service.generateXlsx(schedule as never, outputPath);
      expect(result.success).toBe(true);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(outputPath);
      const scheduleSheet = workbook.getWorksheet('Schedule');
      const paycheckSheet = workbook.getWorksheet('By Paycheck');
      expect(scheduleSheet).toBeDefined();
      expect(paycheckSheet).toBeDefined();
      expect(scheduleSheet!.rowCount).toBeGreaterThan(4);
      // Incidental: Debt Paydown was inserted before Shortfall, so Shortfall moved from column 9 to 10.
      expect(paycheckSheet!.getRow(2).getCell(10).value).toBe('');
      expect(paycheckSheet!.getRow(3).getCell(10).value).toBe('Yes');
    });
  });

  describe('sad', () => {
    it('appends .xlsx extension when omitted', async () => {
      const service = new SpreadsheetService();
      const outputBase = path.join(os.tmpdir(), `budget-optimizer-spreadsheet-noext-${Date.now()}`);
      const outputPath = `${outputBase}.xlsx`;
      createdFiles.push(outputPath);

      const result = await service.generateXlsx(createMockSchedule() as never, outputBase);
      expect(result.success).toBe(true);
      expect(fs.existsSync(outputPath)).toBe(true);
    });
  });

  describe('hostile', () => {
    it('writes a creditor name that starts with = as text, not an Excel formula', async () => {
      const service = new SpreadsheetService();
      const outputPath = path.join(os.tmpdir(), `budget-optimizer-spreadsheet-formula-${Date.now()}.xlsx`);
      createdFiles.push(outputPath);
      const schedule = createMockSchedule({
        paychecks: [{
          date: '2026-01-15',
          incomeSources: [{ id: 'income-1', name: 'Salary', amount: 2000 }],
          totalIncome: 2000,
          bills: [{
            billId: 'bill-1',
            creditorName: '=HYPERLINK("http://evil")',
            amount: 100,
            dueDay: 1,
            priority: 'normal' as const,
            category: 'debt',
            billDate: '2026-01-15',
            isIncomeAttached: false,
            isUnpayable: false,
          }],
          totalBills: 100,
          goalDeposits: [],
          totalGoalDeposits: 0,
          budgetRemaining: 250,
          savingsDeposit: 0,
          totalSavings: 0,
          isShortfall: false,
        }],
      });

      const result = await service.generateXlsx(schedule as never, outputPath);
      expect(result.success).toBe(true);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(outputPath);
      const sheet = workbook.getWorksheet('Schedule')!;
      let description: ExcelJS.CellValue | undefined;
      sheet.eachRow((row) => {
        const value = row.getCell(3).value;
        const text = typeof value === 'string'
          ? value
          : value && typeof value === 'object' && 'richText' in value
            ? value.richText.map((part) => part.text).join('')
            : '';
        if (text.startsWith('=')) description = value;
      });
      expect(description).toEqual({ richText: [{ text: '=HYPERLINK("http://evil")' }] });
      expect(JSON.stringify(description)).not.toContain('"formula"');
    });

    it('returns failure object for invalid output path', async () => {
      const service = new SpreadsheetService();
      const invalidPath = path.join('/definitely-not-real', 'subdir', 'report.xlsx');
      const result = await service.generateXlsx(createMockSchedule() as never, invalidPath);

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('returns failure object when file write fails after workbook is built', async () => {
      const service = new SpreadsheetService();
      const outputPath = path.join(os.tmpdir(), `budget-optimizer-spreadsheet-writefail-${Date.now()}.xlsx`);
      const writeError = new Error('disk full');
      const writeSpy = vi.spyOn(fs.promises, 'writeFile').mockRejectedValueOnce(writeError);

      const result = await service.generateXlsx(createMockSchedule() as never, outputPath);

      expect(result).toEqual({ success: false, error: 'disk full' });
      expect(writeSpy).toHaveBeenCalledOnce();
      writeSpy.mockRestore();
    });
  });
});
