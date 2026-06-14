import fs from 'fs';
import os from 'os';
import path from 'path';
import ExcelJS from 'exceljs';
import { afterEach, describe, expect, it } from 'vitest';
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
      expect(paycheckSheet!.getRow(2).getCell(9).value).toBe('');
      expect(paycheckSheet!.getRow(3).getCell(9).value).toBe('Yes');
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
    it('returns failure object for invalid output path', async () => {
      const service = new SpreadsheetService();
      const invalidPath = path.join('/definitely-not-real', 'subdir', 'report.xlsx');
      const result = await service.generateXlsx(createMockSchedule() as never, invalidPath);

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });
});
