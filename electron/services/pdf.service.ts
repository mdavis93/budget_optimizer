import fs from 'fs';
import path from 'path';
import { ScheduleData } from './scheduler.service';
import { format, parseISO } from 'date-fns';

export class PdfService {
  async generatePdf(schedule: ScheduleData, outputPath: string): Promise<{ success: boolean; error?: string }> {
    try {
      const html = this.generateHtml(schedule);
      
      const htmlPath = outputPath.replace('.pdf', '.html');
      fs.writeFileSync(htmlPath, html);

      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to generate PDF' 
      };
    }
  }

  private generateHtml(schedule: ScheduleData): string {
    const { entries, summary, recommendations, startDate, endDate } = schedule;
    
    const incomeEntries = entries.filter(e => e.type === 'income');
    const expenseEntries = entries.filter(e => e.type === 'expense');

    const formatCurrency = (amount: number) => {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
      }).format(amount);
    };

    const formatDate = (dateStr: string) => {
      return format(parseISO(dateStr), 'MMM d, yyyy');
    };

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Budget Report - ${formatDate(startDate)} to ${formatDate(endDate)}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      line-height: 1.5;
      color: #1e293b;
      padding: 40px;
      max-width: 800px;
      margin: 0 auto;
    }
    
    .header {
      text-align: center;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 2px solid #e2e8f0;
    }
    
    .header h1 {
      font-size: 24px;
      font-weight: 600;
      color: #0f172a;
      margin-bottom: 5px;
    }
    
    .header .subtitle {
      color: #64748b;
      font-size: 14px;
    }
    
    .header .date-range {
      color: #3b82f6;
      font-weight: 500;
      margin-top: 5px;
    }
    
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 15px;
      margin-bottom: 30px;
    }
    
    .summary-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 15px;
      text-align: center;
    }
    
    .summary-card .label {
      font-size: 11px;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 5px;
    }
    
    .summary-card .value {
      font-size: 18px;
      font-weight: 600;
    }
    
    .summary-card .value.positive { color: #16a34a; }
    .summary-card .value.negative { color: #dc2626; }
    .summary-card .value.neutral { color: #0f172a; }
    
    section {
      margin-bottom: 30px;
    }
    
    section h2 {
      font-size: 16px;
      font-weight: 600;
      color: #0f172a;
      margin-bottom: 15px;
      padding-bottom: 8px;
      border-bottom: 1px solid #e2e8f0;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
    }
    
    th, td {
      padding: 10px 12px;
      text-align: left;
      border-bottom: 1px solid #e2e8f0;
    }
    
    th {
      background: #f8fafc;
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #64748b;
    }
    
    td {
      font-size: 12px;
    }
    
    .amount {
      font-family: 'SF Mono', Monaco, monospace;
      font-weight: 500;
    }
    
    .amount.income { color: #16a34a; }
    .amount.expense { color: #dc2626; }
    
    .balance {
      font-family: 'SF Mono', Monaco, monospace;
      font-weight: 500;
    }
    
    .balance.positive { color: #16a34a; }
    .balance.negative { color: #dc2626; }
    
    .shortfall {
      background: #fef2f2;
    }
    
    .recommendations {
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-radius: 8px;
      padding: 15px;
    }
    
    .recommendations h3 {
      font-size: 14px;
      font-weight: 600;
      color: #1e40af;
      margin-bottom: 10px;
    }
    
    .recommendations ul {
      list-style: none;
      padding: 0;
    }
    
    .recommendations li {
      padding: 8px 0;
      padding-left: 20px;
      position: relative;
      color: #1e3a8a;
    }
    
    .recommendations li::before {
      content: '→';
      position: absolute;
      left: 0;
      color: #3b82f6;
    }
    
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e2e8f0;
      text-align: center;
      color: #94a3b8;
      font-size: 11px;
    }
    
    @media print {
      body {
        padding: 20px;
      }
      
      .summary-grid {
        page-break-inside: avoid;
      }
      
      section {
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Budget Payment Schedule</h1>
    <div class="subtitle">Generated by Budget Optimizer</div>
    <div class="date-range">${formatDate(startDate)} — ${formatDate(endDate)}</div>
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
    <div class="summary-card">
      <div class="label">Shortfalls</div>
      <div class="value ${summary.shortfallCount > 0 ? 'negative' : 'neutral'}">${summary.shortfallCount}</div>
    </div>
  </div>
  
  ${recommendations.length > 0 ? `
  <div class="recommendations">
    <h3>Recommendations</h3>
    <ul>
      ${recommendations.map(r => `<li>${r}</li>`).join('')}
    </ul>
  </div>
  ` : ''}
  
  <section>
    <h2>Full Payment Schedule</h2>
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Description</th>
          <th>Type</th>
          <th style="text-align: right;">Amount</th>
          <th style="text-align: right;">Balance</th>
        </tr>
      </thead>
      <tbody>
        ${entries.map(entry => `
        <tr class="${entry.isShortfall ? 'shortfall' : ''}">
          <td>${formatDate(entry.date)}</td>
          <td>${entry.description}</td>
          <td>${entry.type === 'income' ? 'Income' : 'Expense'}</td>
          <td style="text-align: right;" class="amount ${entry.type}">${entry.type === 'income' ? '+' : '-'}${formatCurrency(entry.amount)}</td>
          <td style="text-align: right;" class="balance ${entry.runningBalance >= 0 ? 'positive' : 'negative'}">${formatCurrency(entry.runningBalance)}</td>
        </tr>
        `).join('')}
      </tbody>
    </table>
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
