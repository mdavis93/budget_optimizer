import fs from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { format, parseISO, getMonth, getYear } from 'date-fns';
import type { ScheduleData } from './scheduler.service';

const PRIORITY_LABELS: Record<'critical' | 'high' | 'normal' | 'low', string> = {
  critical: 'Critical',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

const CURRENCY_FORMAT = '"$"#,##0.00;[Red]-"$"#,##0.00';

export class SpreadsheetService {
  async generateXlsx(
    schedule: ScheduleData,
    outputPath: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Budget Optimizer';
      workbook.created = new Date();

      this.buildSummarySheet(workbook, schedule);
      this.buildPaycheckSheet(workbook, schedule);
      this.buildScheduleSheet(workbook, schedule);

      const finalPath = outputPath.endsWith('.xlsx') ? outputPath : `${outputPath}.xlsx`;
      const buffer = await workbook.xlsx.writeBuffer();
      await fs.writeFile(finalPath, buffer);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate spreadsheet',
      };
    }
  }

  private buildSummarySheet(workbook: ExcelJS.Workbook, schedule: ScheduleData): void {
    const sheet = workbook.addWorksheet('Summary');
    const { summary, paychecks, recommendations, startDate, endDate } = schedule;

    sheet.columns = [
      { key: 'label', width: 28 },
      { key: 'value', width: 24 },
    ];

    const title = sheet.addRow(['Budget Report Summary']);
    title.font = { bold: true, size: 16 };
    sheet.mergeCells(title.number, 1, title.number, 2);

    sheet.addRow([]);
    sheet.addRow([
      'Period',
      `${format(parseISO(startDate), 'MMM d, yyyy')} - ${format(parseISO(endDate), 'MMM d, yyyy')}`,
    ]);
    sheet.addRow(['Generated', format(new Date(), 'MMM d, yyyy h:mm a')]);
    sheet.addRow([]);

    const metricsHeader = sheet.addRow(['Metric', 'Value']);
    metricsHeader.font = { bold: true };
    metricsHeader.eachCell(cell => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE2E8F0' },
      };
    });

    const totalGoalDeposits = paychecks.reduce((sum, p) => sum + p.totalGoalDeposits, 0);

    const metrics: [string, number, boolean][] = [
      ['Total Income', summary.totalIncome, true],
      ['Total Expenses', summary.totalExpenses, true],
      ['Net Balance', summary.netBalance, true],
      ['Total Saved', summary.finalSavingsBalance, true],
      ['Goals Total', totalGoalDeposits, true],
      ['Shortfall Count', summary.shortfallCount, false],
      ['Average Balance', summary.averageBalance, true],
      ['Lowest Balance', summary.lowestBalance, true],
      ['Highest Balance', summary.highestBalance, true],
    ];

    metrics.forEach(([label, value, isCurrency]) => {
      const row = sheet.addRow([label, value]);
      if (isCurrency) {
        row.getCell(2).numFmt = CURRENCY_FORMAT;
      }
    });

    if (recommendations.length > 0) {
      sheet.addRow([]);
      const recHeader = sheet.addRow(['Recommendations']);
      recHeader.font = { bold: true };
      recommendations.forEach(rec => {
        const row = sheet.addRow([rec]);
        sheet.mergeCells(row.number, 1, row.number, 2);
        row.getCell(1).alignment = { wrapText: true, vertical: 'top' };
      });
    }
  }

  private buildPaycheckSheet(workbook: ExcelJS.Workbook, schedule: ScheduleData): void {
    const sheet = workbook.addWorksheet('By Paycheck');

    sheet.columns = [
      { key: 'date', width: 16 },
      { key: 'incomeSources', width: 28 },
      { key: 'totalIncome', width: 14 },
      { key: 'totalBills', width: 14 },
      { key: 'goalDeposits', width: 14 },
      { key: 'savingsDeposit', width: 14 },
      { key: 'budgetRemaining', width: 16 },
      { key: 'savingsBalance', width: 16 },
      { key: 'shortfall', width: 10 },
    ];

    const header = sheet.addRow([
      'Paycheck Date',
      'Income Sources',
      'Total Income',
      'Total Bills',
      'Goal Deposits',
      'Savings Transfer',
      'Budget Remaining',
      'Savings Balance',
      'Shortfall',
    ]);
    header.font = { bold: true };
    header.eachCell(cell => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE2E8F0' },
      };
    });

    schedule.paychecks.forEach(paycheck => {
      const row = sheet.addRow([
        format(parseISO(paycheck.date), 'yyyy-MM-dd'),
        paycheck.incomeSources.map(s => s.name).join(' + '),
        paycheck.totalIncome,
        paycheck.totalBills,
        paycheck.totalGoalDeposits,
        paycheck.savingsDeposit,
        paycheck.budgetRemaining,
        paycheck.totalSavings,
        paycheck.isShortfall ? 'Yes' : '',
      ]);

      [3, 4, 5, 6, 7, 8].forEach(col => {
        row.getCell(col).numFmt = CURRENCY_FORMAT;
      });

      if (paycheck.isShortfall) {
        row.eachCell(cell => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFEE2E2' },
          };
        });
      }
    });

    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }

  private buildScheduleSheet(workbook: ExcelJS.Workbook, schedule: ScheduleData): void {
    const sheet = workbook.addWorksheet('Schedule');

    sheet.columns = [
      { key: 'paycheckDate', width: 16 },
      { key: 'category', width: 14 },
      { key: 'description', width: 36 },
      { key: 'priority', width: 12 },
      { key: 'dueDate', width: 14 },
      { key: 'amount', width: 14 },
    ];

    const header = sheet.addRow([
      'Paycheck Date',
      'Category',
      'Description',
      'Priority',
      'Due Date',
      'Amount',
    ]);
    header.font = { bold: true };
    header.eachCell(cell => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE2E8F0' },
      };
    });

    schedule.paychecks.forEach(paycheck => {
      const paycheckDateStr = format(parseISO(paycheck.date), 'yyyy-MM-dd');
      const paycheckDate = parseISO(paycheck.date);
      const paycheckMonth = getMonth(paycheckDate);
      const paycheckYear = getYear(paycheckDate);

      paycheck.incomeSources.forEach(src => {
        const row = sheet.addRow([
          paycheckDateStr,
          'Income',
          src.name,
          '',
          '',
          src.amount,
        ]);
        row.getCell(6).numFmt = CURRENCY_FORMAT;
        row.getCell(6).font = { color: { argb: 'FF15803D' } };
      });

      const sortedBills = [...paycheck.bills].sort((a, b) => {
        const aDate = parseISO(a.billDate);
        const bDate = parseISO(b.billDate);
        const aDiff = (getYear(aDate) - paycheckYear) * 12 + (getMonth(aDate) - paycheckMonth);
        const bDiff = (getYear(bDate) - paycheckYear) * 12 + (getMonth(bDate) - paycheckMonth);
        if (aDiff !== bDiff) return aDiff - bDiff;
        return a.dueDay - b.dueDay;
      });

      sortedBills.forEach(bill => {
        const row = sheet.addRow([
          paycheckDateStr,
          'Bill',
          bill.creditorName,
          PRIORITY_LABELS[bill.priority],
          bill.isIncomeAttached ? 'Per Paycheck' : format(parseISO(bill.billDate), 'yyyy-MM-dd'),
          -bill.amount,
        ]);
        row.getCell(6).numFmt = CURRENCY_FORMAT;
        row.getCell(6).font = { color: { argb: 'FFDC2626' } };
      });

      paycheck.goalDeposits?.forEach(gd => {
        const row = sheet.addRow([
          paycheckDateStr,
          'Goal',
          `Goal: ${gd.goalName}`,
          '',
          '',
          -gd.amount,
        ]);
        row.getCell(6).numFmt = CURRENCY_FORMAT;
        row.getCell(6).font = { color: { argb: 'FF9333EA' } };
      });

      if (paycheck.savingsDeposit > 0) {
        const row = sheet.addRow([
          paycheckDateStr,
          'Savings',
          'Transfer to Savings',
          '',
          '',
          paycheck.savingsDeposit,
        ]);
        row.getCell(6).numFmt = CURRENCY_FORMAT;
        row.getCell(6).font = { color: { argb: 'FF2563EB' } };
      }
    });

    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: 6 },
    };
  }
}
