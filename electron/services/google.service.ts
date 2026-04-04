import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { app, shell, safeStorage } from 'electron';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { URL } from 'url';
import { ScheduleData } from './scheduler.service';
import { format, parseISO } from 'date-fns';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const REDIRECT_PORT = 8089;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`;

export class GoogleService {
  private oauth2Client: OAuth2Client | null = null;
  private credentials: { clientId: string; clientSecret: string } | null = null;
  private tokens: { access_token?: string; refresh_token?: string } | null = null;
  private tokenPath: string;

  constructor() {
    const userDataPath = app.getPath('userData');
    this.tokenPath = path.join(userDataPath, 'google-tokens.enc');
    this.loadTokens();
  }

  private loadTokens(): void {
    try {
      if (fs.existsSync(this.tokenPath)) {
        if (safeStorage.isEncryptionAvailable()) {
          const encryptedData = fs.readFileSync(this.tokenPath);
          const decrypted = safeStorage.decryptString(encryptedData);
          this.tokens = JSON.parse(decrypted);
        } else {
          // Fallback: try to read old unencrypted format for migration
          const oldPath = this.tokenPath.replace('.enc', '.json');
          if (fs.existsSync(oldPath)) {
            const data = fs.readFileSync(oldPath, 'utf8');
            this.tokens = JSON.parse(data);
            // Migrate to encrypted format
            this.saveTokens();
            // Remove old unencrypted file
            fs.unlinkSync(oldPath);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load Google tokens:', error);
      this.tokens = null;
    }
  }

  private saveTokens(): void {
    if (this.tokens) {
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(JSON.stringify(this.tokens));
        fs.writeFileSync(this.tokenPath, encrypted);
      } else {
        console.warn('safeStorage not available - Google tokens will not be persisted');
      }
    }
  }

  setCredentials(clientId: string, clientSecret: string): void {
    this.credentials = { clientId, clientSecret };
    this.oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      REDIRECT_URI
    );

    if (this.tokens) {
      this.oauth2Client.setCredentials(this.tokens);
    }
  }

  isAuthenticated(): boolean {
    return this.oauth2Client !== null && this.tokens?.access_token !== undefined;
  }

  getAuthUrl(): string | null {
    if (!this.oauth2Client) {
      return null;
    }

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
    });
  }

  async startAuthFlow(): Promise<{ success: boolean; error?: string }> {
    const authUrl = this.getAuthUrl();
    if (!authUrl) {
      return { success: false, error: 'OAuth client not configured' };
    }

    return new Promise((resolve) => {
      const server = http.createServer(async (req, res) => {
        try {
          const url = new URL(req.url || '', `http://localhost:${REDIRECT_PORT}`);
          
          if (url.pathname === '/oauth2callback') {
            const code = url.searchParams.get('code');
            
            if (code && this.oauth2Client) {
              const { tokens } = await this.oauth2Client.getToken(code);
              this.oauth2Client.setCredentials(tokens);
              this.tokens = tokens as { access_token?: string; refresh_token?: string };
              this.saveTokens();
              
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(`
                <html>
                  <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
                    <div style="text-align: center;">
                      <h1 style="color: #16a34a;">Success!</h1>
                      <p>You can close this window and return to Budget Optimizer.</p>
                    </div>
                  </body>
                </html>
              `);
              
              server.close();
              resolve({ success: true });
            } else {
              res.writeHead(400, { 'Content-Type': 'text/html' });
              res.end('<html><body><h1>Error: No authorization code received</h1></body></html>');
              server.close();
              resolve({ success: false, error: 'No authorization code received' });
            }
          }
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>Authentication error</h1></body></html>');
          server.close();
          resolve({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Authentication failed' 
          });
        }
      });

      server.listen(REDIRECT_PORT, () => {
        shell.openExternal(authUrl);
      });

      setTimeout(() => {
        server.close();
        resolve({ success: false, error: 'Authentication timed out' });
      }, 120000);
    });
  }

  async handleAuthCallback(code: string): Promise<{ success: boolean; error?: string }> {
    if (!this.oauth2Client) {
      return { success: false, error: 'OAuth client not configured' };
    }

    try {
      const { tokens } = await this.oauth2Client.getToken(code);
      this.oauth2Client.setCredentials(tokens);
      this.tokens = tokens as { access_token?: string; refresh_token?: string };
      this.saveTokens();
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to exchange code for tokens' 
      };
    }
  }

  async exportToSheets(schedule: ScheduleData): Promise<{ success: boolean; url?: string; error?: string }> {
    if (!this.oauth2Client || !this.tokens) {
      return { success: false, error: 'Not authenticated with Google' };
    }

    try {
      const sheets = google.sheets({ version: 'v4', auth: this.oauth2Client });
      
      const spreadsheet = await sheets.spreadsheets.create({
        requestBody: {
          properties: {
            title: `Budget Report - ${format(parseISO(schedule.startDate), 'MMM yyyy')}`,
          },
          sheets: [
            { properties: { title: 'Summary' } },
            { properties: { title: 'Schedule' } },
          ],
        },
      });

      const spreadsheetId = spreadsheet.data.spreadsheetId!;

      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: [
            {
              range: 'Summary!A1',
              values: [
                ['Budget Report Summary'],
                [],
                ['Period', `${format(parseISO(schedule.startDate), 'MMM d, yyyy')} - ${format(parseISO(schedule.endDate), 'MMM d, yyyy')}`],
                [],
                ['Metric', 'Value'],
                ['Total Income', schedule.summary.totalIncome],
                ['Total Expenses', schedule.summary.totalExpenses],
                ['Net Balance', schedule.summary.netBalance],
                ['Shortfall Count', schedule.summary.shortfallCount],
                ['Average Balance', schedule.summary.averageBalance],
                ['Lowest Balance', schedule.summary.lowestBalance],
                ['Highest Balance', schedule.summary.highestBalance],
                [],
                ['Recommendations'],
                ...schedule.recommendations.map(r => [r]),
              ],
            },
            {
              range: 'Schedule!A1',
              values: [
                ['Date', 'Description', 'Type', 'Amount', 'Running Balance', 'Shortfall'],
                ...schedule.entries.map(entry => [
                  format(parseISO(entry.date), 'yyyy-MM-dd'),
                  entry.description,
                  entry.type,
                  entry.type === 'income' ? entry.amount : -entry.amount,
                  entry.runningBalance,
                  entry.isShortfall ? 'Yes' : '',
                ]),
              ],
            },
          ],
        },
      });

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId: 0,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: 2,
                },
                cell: {
                  userEnteredFormat: {
                    textFormat: { bold: true, fontSize: 14 },
                  },
                },
                fields: 'userEnteredFormat.textFormat',
              },
            },
            {
              repeatCell: {
                range: {
                  sheetId: 1,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: 6,
                },
                cell: {
                  userEnteredFormat: {
                    textFormat: { bold: true },
                    backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 },
                  },
                },
                fields: 'userEnteredFormat(textFormat,backgroundColor)',
              },
            },
            {
              autoResizeDimensions: {
                dimensions: {
                  sheetId: 0,
                  dimension: 'COLUMNS',
                  startIndex: 0,
                  endIndex: 2,
                },
              },
            },
            {
              autoResizeDimensions: {
                dimensions: {
                  sheetId: 1,
                  dimension: 'COLUMNS',
                  startIndex: 0,
                  endIndex: 6,
                },
              },
            },
          ],
        },
      });

      const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
      
      return { success: true, url };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to create spreadsheet' 
      };
    }
  }

  logout(): void {
    this.tokens = null;
    // Remove encrypted token file
    if (fs.existsSync(this.tokenPath)) {
      fs.unlinkSync(this.tokenPath);
    }
    // Also remove old unencrypted file if it exists
    const oldPath = this.tokenPath.replace('.enc', '.json');
    if (fs.existsSync(oldPath)) {
      fs.unlinkSync(oldPath);
    }
    if (this.oauth2Client) {
      this.oauth2Client.revokeCredentials();
    }
  }
}
