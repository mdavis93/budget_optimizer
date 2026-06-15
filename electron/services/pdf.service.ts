import fs from 'fs';
import os from 'os';
import path from 'path';
import { BrowserWindow } from 'electron';
import type { ScheduleData, PaycheckEntry } from './scheduler.service';
import { format, parseISO, getMonth, getYear } from 'date-fns';
import { escapeHtml } from '../utils/escapeHtml';
import { formatCurrencyDisplay, PRIORITY_LABELS } from '../utils/constants';

export class PdfService {
  async generateHtmlFile(schedule: ScheduleData, outputPath: string): Promise<{ success: boolean; error?: string }> {
    try {
      const html = this.generateHtml(schedule);
      const htmlPath = outputPath.endsWith('.html') ? outputPath : outputPath.replace(/\.pdf$/, '.html');
      fs.writeFileSync(htmlPath, html);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate HTML',
      };
    }
  }

  async generatePdf(schedule: ScheduleData, outputPath: string): Promise<{ success: boolean; error?: string }> {
    const tempHtmlPath = path.join(
      os.tmpdir(),
      `budget-optimizer-${Date.now()}-${Math.random().toString(36).slice(2)}.html`
    );
    let win: BrowserWindow | null = null;

    try {
      const html = this.generateHtml(schedule);
      fs.writeFileSync(tempHtmlPath, html);

      win = new BrowserWindow({
        show: false,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          javascript: false,
        },
      });

      await win.loadFile(tempHtmlPath);

      const pdfBuffer = await win.webContents.printToPDF({
        printBackground: true,
        pageSize: 'Letter',
        margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
        preferCSSPageSize: true,
      });

      const finalPath = outputPath.endsWith('.pdf') ? outputPath : `${outputPath}.pdf`;
      fs.writeFileSync(finalPath, pdfBuffer);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate PDF',
      };
    } finally {
      if (win && !win.isDestroyed()) {
        win.destroy();
      }
      try {
        if (fs.existsSync(tempHtmlPath)) fs.unlinkSync(tempHtmlPath);
      } catch {
        // Best-effort cleanup; ignore errors
      }
    }
  }

  generateHtml(schedule: ScheduleData): string {
    const { paychecks, summary, recommendations, startDate, endDate } = schedule;

    const totalGoalDeposits = paychecks.reduce((sum, p) => sum + p.totalGoalDeposits, 0);
    const hasGoalDeposits = totalGoalDeposits > 0;

    const formatCurrency = formatCurrencyDisplay;

    const formatDate = (dateStr: string) => {
      return format(parseISO(dateStr), 'MMM d, yyyy');
    };

    const renderPaycheck = (paycheck: PaycheckEntry) => {
      const paycheckDate = parseISO(paycheck.date);
      const paycheckMonth = getMonth(paycheckDate);
      const paycheckYear = getYear(paycheckDate);

      const sortedBills = [...paycheck.bills].sort((a, b) => {
        const aDate = parseISO(a.billDate);
        const bDate = parseISO(b.billDate);
        const aMonthDiff = (getYear(aDate) - paycheckYear) * 12 + (getMonth(aDate) - paycheckMonth);
        const bMonthDiff = (getYear(bDate) - paycheckYear) * 12 + (getMonth(bDate) - paycheckMonth);
        if (aMonthDiff !== bMonthDiff) return aMonthDiff - bMonthDiff;
        return a.dueDay - b.dueDay;
      });

      const incomeSourceNames = paycheck.incomeSources.map(s => escapeHtml(s.name)).join(' + ');
      const budgetClass = paycheck.budgetRemaining >= 0 ? 'positive' : 'negative';

      const dueDaySuffix = (d: number) => d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th';

      return `
    <div class="paycheck ${paycheck.isShortfall ? 'paycheck-shortfall' : ''}">
      <div class="paycheck-overview">
        <div class="paycheck-overview-main">
          <div class="paycheck-date">${format(paycheckDate, 'EEEE, MMMM d, yyyy')}</div>
          <div class="paycheck-meta">
            <span>${incomeSourceNames}</span>
            <span class="dot">&bull;</span>
            <span>${paycheck.bills.length} bill${paycheck.bills.length !== 1 ? 's' : ''}</span>
            ${paycheck.totalGoalDeposits > 0 ? `
              <span class="dot">&bull;</span>
              <span class="meta-goals">${formatCurrency(paycheck.totalGoalDeposits)} to goals</span>
            ` : ''}
            ${paycheck.savingsDeposit > 0 ? `
              <span class="dot">&bull;</span>
              <span class="meta-savings">${formatCurrency(paycheck.savingsDeposit)} to savings</span>
            ` : ''}
          </div>
        </div>
        <div class="paycheck-overview-side">
          <div class="paycheck-side-label">Budget Remaining</div>
          <div class="paycheck-side-value ${budgetClass}">${formatCurrency(paycheck.budgetRemaining)}</div>
        </div>
      </div>

      <div class="paycheck-body">
        <div class="row-group">
          <div class="row-group-title">Income</div>
          ${paycheck.incomeSources.map(src => `
            <div class="row row-income">
              <span class="row-label">${escapeHtml(src.name)}</span>
              <span class="row-amount income">+${formatCurrency(src.amount)}</span>
            </div>
          `).join('')}
          <div class="row row-total">
            <span class="row-label">Total Income</span>
            <span class="row-amount income">+${formatCurrency(paycheck.totalIncome)}</span>
          </div>
        </div>

        ${paycheck.bills.length > 0 ? `
        <div class="row-group">
          <div class="row-group-title">Bills to Pay (${paycheck.bills.length})</div>
          ${sortedBills.map(bill => {
            const billDate = parseISO(bill.billDate);
            const isNextMonth = getMonth(billDate) !== paycheckMonth || getYear(billDate) !== paycheckYear;
            const monthPrefix = isNextMonth ? format(billDate, 'MMM') + ' ' : '';
            const dueLabel = bill.isIncomeAttached
              ? 'Per Paycheck'
              : `Due: ${monthPrefix}${bill.dueDay}${dueDaySuffix(bill.dueDay)}`;
            return `
              <div class="row row-bill">
                <div class="row-label">
                  <span class="bill-name">${escapeHtml(bill.creditorName)}</span>
                  <span class="badge badge-${bill.priority}">${PRIORITY_LABELS[bill.priority]}</span>
                  <span class="bill-due">${escapeHtml(dueLabel)}</span>
                </div>
                <span class="row-amount expense">-${formatCurrency(bill.amount)}</span>
              </div>
            `;
          }).join('')}
          <div class="row row-total">
            <span class="row-label">Total Bills</span>
            <span class="row-amount expense">-${formatCurrency(paycheck.totalBills)}</span>
          </div>
        </div>
        ` : ''}

        ${paycheck.goalDeposits && paycheck.goalDeposits.length > 0 ? `
        <div class="row-group">
          <div class="row-group-title">Goal Deposits (${paycheck.goalDeposits.length})</div>
          ${paycheck.goalDeposits.map(gd => `
            <div class="row row-goal">
              <span class="row-label">Goal: ${escapeHtml(gd.goalName)}</span>
              <span class="row-amount goal">-${formatCurrency(gd.amount)}</span>
            </div>
          `).join('')}
          ${paycheck.totalGoalDeposits > 0 ? `
            <div class="row row-total">
              <span class="row-label">Total Goal Deposits</span>
              <span class="row-amount goal">-${formatCurrency(paycheck.totalGoalDeposits)}</span>
            </div>
          ` : ''}
        </div>
        ` : ''}

        ${paycheck.savingsDeposit > 0 ? `
        <div class="row-group">
          <div class="row-group-title">Savings Transfer</div>
          <div class="row row-savings">
            <span class="row-label">Transfer to Savings</span>
            <span class="row-amount savings">${formatCurrency(paycheck.savingsDeposit)}</span>
          </div>
        </div>
        ` : ''}

        <div class="paycheck-footer">
          <div class="footer-remaining">
            <span>Budget Remaining</span>
            <span class="${budgetClass}">${formatCurrency(paycheck.budgetRemaining)}</span>
          </div>
          <div class="footer-savings-balance">Savings Balance: ${formatCurrency(paycheck.totalSavings)}</div>
        </div>
      </div>
    </div>
      `;
    };

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Budget Report - ${formatDate(startDate)} to ${formatDate(endDate)}</title>
  <style>
    @page {
      size: Letter;
      margin: 0.5in;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    html, body {
      background: #ffffff;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      line-height: 1.5;
      color: #1e293b;
      padding: 40px;
      max-width: 900px;
      margin: 0 auto;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    @media print {
      body {
        padding: 0;
        max-width: none;
      }
    }
    
    .header {
      text-align: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 2px solid #e2e8f0;
      break-inside: avoid;
      page-break-inside: avoid;
      break-after: avoid;
      page-break-after: avoid;
    }
    
    .header h1 {
      font-size: 22px;
      font-weight: 600;
      color: #0f172a;
      margin-bottom: 4px;
    }
    
    .header .subtitle {
      color: #64748b;
      font-size: 13px;
    }
    
    .header .date-range {
      color: #3b82f6;
      font-weight: 500;
      margin-top: 4px;
    }
    
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 12px;
      margin-bottom: 24px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    
    .summary-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px;
      text-align: center;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .summary-card.accent-savings {
      background: #eff6ff;
      border-color: #bfdbfe;
    }

    .summary-card.accent-goals {
      background: #f0fdf4;
      border-color: #bbf7d0;
    }
    
    .summary-card .label {
      font-size: 10px;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    
    .summary-card .value {
      font-size: 16px;
      font-weight: 600;
    }
    
    .summary-card .value.positive { color: #16a34a; }
    .summary-card .value.negative { color: #dc2626; }
    .summary-card .value.neutral { color: #0f172a; }
    .summary-card .value.savings { color: #2563eb; }
    .summary-card .value.goals { color: #15803d; }
    
    section {
      margin-bottom: 24px;
    }
    
    section h2 {
      font-size: 15px;
      font-weight: 600;
      color: #0f172a;
      margin-bottom: 12px;
      padding-bottom: 6px;
      border-bottom: 1px solid #e2e8f0;
      break-after: avoid;
      page-break-after: avoid;
    }

    .paycheck {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      margin-bottom: 14px;
      overflow: hidden;
      background: #ffffff;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .paycheck-shortfall {
      border-color: #fecaca;
      background: #fef2f2;
    }

    .paycheck-overview {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
      break-after: avoid;
      page-break-after: avoid;
    }

    .paycheck-shortfall .paycheck-overview {
      background: #fef2f2;
      border-bottom-color: #fecaca;
    }

    .paycheck-date {
      font-size: 13px;
      font-weight: 600;
      color: #0f172a;
      margin-bottom: 2px;
    }

    .paycheck-meta {
      font-size: 10.5px;
      color: #64748b;
    }

    .paycheck-meta .dot {
      margin: 0 5px;
      color: #cbd5e1;
    }

    .paycheck-meta .meta-goals { color: #a855f7; }
    .paycheck-meta .meta-savings { color: #2563eb; }

    .paycheck-overview-side {
      text-align: right;
    }

    .paycheck-side-label {
      font-size: 9.5px;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .paycheck-side-value {
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 16px;
      font-weight: 600;
    }

    .paycheck-side-value.positive { color: #16a34a; }
    .paycheck-side-value.negative { color: #dc2626; }

    .paycheck-body {
      padding: 12px 16px;
    }

    .row-group {
      margin-bottom: 12px;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .row-group:last-child {
      margin-bottom: 0;
    }

    .row-group-title {
      font-size: 10px;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 5px;
    }

    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 10px;
      border-radius: 6px;
      margin-bottom: 3px;
      font-size: 11.5px;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .row-income { background: #f0fdf4; }
    .row-bill { background: #fef2f2; }
    .row-goal { background: #faf5ff; }
    .row-savings { background: #eff6ff; }
    .row-total {
      background: #f1f5f9;
      font-weight: 600;
    }

    .row-label {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #1e293b;
    }

    .bill-name {
      font-weight: 500;
    }

    .bill-due {
      font-size: 10px;
      color: #94a3b8;
    }

    .badge {
      font-size: 9.5px;
      padding: 1px 7px;
      border-radius: 9999px;
      font-weight: 500;
    }

    .badge-critical { background: #fecaca; color: #991b1b; }
    .badge-high { background: #fde68a; color: #92400e; }
    .badge-normal { background: #bfdbfe; color: #1e40af; }
    .badge-low { background: #e5e7eb; color: #374151; }

    .row-amount {
      font-family: 'SF Mono', Monaco, monospace;
      font-weight: 500;
    }

    .row-amount.income { color: #16a34a; }
    .row-amount.expense { color: #dc2626; }
    .row-amount.goal { color: #9333ea; }
    .row-amount.savings { color: #2563eb; }

    .paycheck-footer {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #e2e8f0;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .footer-remaining {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: 600;
      font-size: 12px;
      padding: 6px 10px;
      background: #f1f5f9;
      border-radius: 6px;
    }

    .footer-remaining .positive { color: #16a34a; font-family: 'SF Mono', Monaco, monospace; font-size: 15px; }
    .footer-remaining .negative { color: #dc2626; font-family: 'SF Mono', Monaco, monospace; font-size: 15px; }

    .footer-savings-balance {
      text-align: center;
      font-size: 10px;
      color: #94a3b8;
      margin-top: 5px;
    }
    
    .recommendations {
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-radius: 8px;
      padding: 12px 15px;
      margin-bottom: 24px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    
    .recommendations h3 {
      font-size: 13px;
      font-weight: 600;
      color: #1e40af;
      margin-bottom: 8px;
    }
    
    .recommendations ul {
      list-style: none;
      padding: 0;
    }
    
    .recommendations li {
      padding: 6px 0;
      padding-left: 20px;
      position: relative;
      color: #1e3a8a;
    }
    
    .recommendations li::before {
      content: '\\2192';
      position: absolute;
      left: 0;
      color: #3b82f6;
    }
    
    .footer {
      margin-top: 30px;
      padding-top: 16px;
      border-top: 1px solid #e2e8f0;
      text-align: center;
      color: #94a3b8;
      font-size: 10.5px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Budget Payment Schedule</h1>
    <div class="subtitle">Generated by Budget Optimizer</div>
    <div class="date-range">${formatDate(startDate)} &mdash; ${formatDate(endDate)}</div>
  </div>
  
  <div class="summary-grid">
    <div class="summary-card">
      <div class="label">Total Income</div>
      <div class="value positive">${formatCurrency(summary.totalIncome)}</div>
    </div>
    <div class="summary-card">
      <div class="label">Total Expenses</div>
      <div class="value negative">${formatCurrency(summary.totalExpenses)}</div>
    </div>
    <div class="summary-card">
      <div class="label">Net Balance</div>
      <div class="value ${summary.netBalance >= 0 ? 'positive' : 'negative'}">${formatCurrency(summary.netBalance)}</div>
    </div>
    <div class="summary-card accent-savings">
      <div class="label">Total Saved</div>
      <div class="value savings">${formatCurrency(summary.finalSavingsBalance)}</div>
    </div>
    ${hasGoalDeposits ? `
    <div class="summary-card accent-goals">
      <div class="label">Goals Total</div>
      <div class="value goals">${formatCurrency(totalGoalDeposits)}</div>
    </div>
    ` : ''}
    <div class="summary-card">
      <div class="label">Shortfalls</div>
      <div class="value ${summary.shortfallCount > 0 ? 'negative' : 'neutral'}">${summary.shortfallCount}</div>
    </div>
  </div>
  
  ${recommendations.length > 0 ? `
  <div class="recommendations">
    <h3>Recommendations</h3>
    <ul>
      ${recommendations.map(r => `<li>${escapeHtml(r)}</li>`).join('')}
    </ul>
  </div>
  ` : ''}
  
  <section>
    <h2>Payment Schedule by Paycheck</h2>
    ${paychecks.length > 0
      ? paychecks.map(renderPaycheck).join('')
      : '<p style="color: #94a3b8; text-align: center; padding: 20px;">No paychecks in the selected period.</p>'
    }
  </section>
  
  <div class="footer">
    <p>Generated on ${format(new Date(), 'MMMM d, yyyy \'at\' h:mm a')}</p>
    <p>This report is for informational purposes only.</p>
  </div>
</body>
</html>
    `.trim();
  }
}
