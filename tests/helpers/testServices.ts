import { SchedulerService } from '../../electron/services/scheduler.service';
import { PdfService } from '../../electron/services/pdf.service';
import { SpreadsheetService } from '../../electron/services/spreadsheet.service';
import { DebtService } from '../../electron/services/debt.service';
import { CredentialsService } from '../../electron/services/credentials.service';
import { AuthService } from '../../electron/services/auth.service';
import { CryptoService } from '../../electron/services/crypto.service';
import { BudgetManager } from '../../electron/services/budget-manager.service';
import { DatabaseService } from '../../electron/services/database.service';

export interface TestServices {
  auth: AuthService;
  crypto: CryptoService;
  database: DatabaseService | null;
  budgetManager: BudgetManager | null;
  scheduler: SchedulerService;
  pdf: PdfService;
  spreadsheet: SpreadsheetService;
  debt: DebtService;
  credentials: CredentialsService;
}

export function createTestServices(overrides: Partial<TestServices> = {}): TestServices {
  const crypto = overrides.crypto ?? new CryptoService();
  const auth = overrides.auth ?? new AuthService();
  const scheduler = overrides.scheduler ?? new SchedulerService();
  const pdf = overrides.pdf ?? new PdfService();
  const spreadsheet = overrides.spreadsheet ?? new SpreadsheetService();
  const debt = overrides.debt ?? new DebtService();
  const credentials = overrides.credentials ?? new CredentialsService();

  return {
    auth,
    crypto,
    database: overrides.database ?? null,
    budgetManager: overrides.budgetManager ?? null,
    scheduler,
    pdf,
    spreadsheet,
    debt,
    credentials,
    ...overrides,
  };
}
