import {
  getPassword as keytarGetPassword,
  setPassword as keytarSetPassword,
  deletePassword as keytarDeletePassword,
} from 'keytar';
import { BrowserWindow } from 'electron';
import { ipcLogger } from './logger.service';
import { showTopMessageBox } from '../utils/dialog';

const SERVICE_NAME = 'Budget Optimizer';
const ACCOUNT_NAME = 'master';

export class CredentialsService {
  async savePassword(password: string): Promise<{ success: boolean; error?: string }> {
    try {
      await keytarSetPassword(SERVICE_NAME, ACCOUNT_NAME, password);
      return { success: true };
    } catch (error) {
      ipcLogger.error('credentials:save failed:', error);
      return { success: false, error: 'Failed to save password to system credential store' };
    }
  }

  async getPassword(): Promise<{ success: boolean; password?: string; error?: string }> {
    try {
      const password = await keytarGetPassword(SERVICE_NAME, ACCOUNT_NAME);
      if (!password) {
        return { success: false, error: 'No saved password found' };
      }
      return { success: true, password };
    } catch (error) {
      ipcLogger.error('credentials:get failed:', error);
      return { success: false, error: 'Failed to retrieve password from system credential store' };
    }
  }

  async deletePassword(): Promise<{ success: boolean; error?: string }> {
    try {
      await keytarDeletePassword(SERVICE_NAME, ACCOUNT_NAME);
      return { success: true };
    } catch (error) {
      ipcLogger.error('credentials:delete failed:', error);
      return { success: false, error: 'Failed to delete password from system credential store' };
    }
  }

  async hasPassword(): Promise<boolean> {
    try {
      const password = await keytarGetPassword(SERVICE_NAME, ACCOUNT_NAME);
      return password !== null;
    } catch {
      return false;
    }
  }

  async offerSave(
    password: string,
    parentWindow: BrowserWindow | null
  ): Promise<{ success: boolean; saved: boolean; error?: string }> {
    const platformLabel =
      process.platform === 'darwin'
        ? 'Keychain'
        : process.platform === 'win32'
          ? 'Credential Manager'
          : 'system password store';

    const messageOptions = {
      type: 'question' as const,
      buttons: ['Save', 'Not Now'],
      defaultId: 0,
      cancelId: 1,
      title: 'Save Password',
      message: `Save password to ${platformLabel}?`,
      detail:
        'Your master password can be saved securely so you can fill it on future logins. You can remove it from system credentials at any time.',
      noLink: true,
    };

    const result = await showTopMessageBox(parentWindow, messageOptions);

    if (result.response !== 0) {
      return { success: true, saved: false };
    }

    const saveResult = await this.savePassword(password);
    return { success: saveResult.success, saved: saveResult.success, error: saveResult.error };
  }
}
