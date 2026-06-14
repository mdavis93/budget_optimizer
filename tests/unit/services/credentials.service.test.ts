import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BrowserWindow } from 'electron';

const mocks = vi.hoisted(() => ({
  showTopMessageBox: vi.fn(),
  getPassword: vi.fn(),
  setPassword: vi.fn(),
  deletePassword: vi.fn(),
}));

vi.mock('../../../electron/utils/dialog', () => ({
  showTopMessageBox: mocks.showTopMessageBox,
}));

vi.mock('keytar', () => ({
  getPassword: mocks.getPassword,
  setPassword: mocks.setPassword,
  deletePassword: mocks.deletePassword,
}));

vi.mock('../../../electron/services/logger.service', () => ({
  ipcLogger: { error: vi.fn() },
}));

import { CredentialsService } from '../../../electron/services/credentials.service';

describe('CredentialsService', () => {
  let service: CredentialsService;
  const parentWindow = { id: 1 } as BrowserWindow;

  beforeEach(() => {
    service = new CredentialsService();
    vi.clearAllMocks();
    mocks.getPassword.mockResolvedValue(null);
    mocks.setPassword.mockResolvedValue(undefined);
    mocks.deletePassword.mockResolvedValue(true);
    mocks.showTopMessageBox.mockResolvedValue({ response: 0 });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  });

  describe('savePassword', () => {
    it('stores the password in the system credential store', async () => {
      const result = await service.savePassword('secret-password');

      expect(mocks.setPassword).toHaveBeenCalledWith(
        'Budget Optimizer',
        'master',
        'secret-password'
      );
      expect(result).toEqual({ success: true });
    });

    it('returns an error when keytar fails', async () => {
      mocks.setPassword.mockRejectedValue(new Error('keychain denied'));

      const result = await service.savePassword('secret-password');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to save password to system credential store');
    });
  });

  describe('getPassword', () => {
    it('returns the stored password when present', async () => {
      mocks.getPassword.mockResolvedValue('stored-password');

      const result = await service.getPassword();

      expect(result).toEqual({ success: true, password: 'stored-password' });
    });

    it('returns an error when no password is stored', async () => {
      const result = await service.getPassword();

      expect(result.success).toBe(false);
      expect(result.error).toBe('No saved password found');
    });
  });

  describe('hasPassword', () => {
    it('returns true when a password exists', async () => {
      mocks.getPassword.mockResolvedValue('stored-password');
      expect(await service.hasPassword()).toBe(true);
    });

    it('returns false when no password exists', async () => {
      expect(await service.hasPassword()).toBe(false);
    });
  });

  describe('deletePassword', () => {
    it('removes the password from the system credential store', async () => {
      const result = await service.deletePassword();

      expect(mocks.deletePassword).toHaveBeenCalledWith('Budget Optimizer', 'master');
      expect(result).toEqual({ success: true });
    });

    it('returns an error when keytar delete fails', async () => {
      mocks.deletePassword.mockRejectedValue(new Error('keychain denied'));

      const result = await service.deletePassword();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to delete password from system credential store');
    });
  });

  describe('getPassword error paths', () => {
    it('returns an error when keytar get fails', async () => {
      mocks.getPassword.mockRejectedValue(new Error('keychain unavailable'));

      const result = await service.getPassword();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to retrieve password from system credential store');
    });
  });

  describe('hasPassword error paths', () => {
    it('returns false when keytar get throws', async () => {
      mocks.getPassword.mockRejectedValue(new Error('keychain unavailable'));
      expect(await service.hasPassword()).toBe(false);
    });
  });

  describe('offerSave', () => {
    it('shows the save dialog with Keychain messaging on macOS', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

      await service.offerSave('new-password', parentWindow);

      expect(mocks.showTopMessageBox).toHaveBeenCalledWith(
        parentWindow,
        expect.objectContaining({
          type: 'question',
          buttons: ['Save', 'Not Now'],
          defaultId: 0,
          cancelId: 1,
          title: 'Save Password',
          message: 'Save password to Keychain?',
          detail: expect.stringContaining('fill it on future logins'),
        })
      );
    });

    it('shows generic system password store messaging on Linux', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

      await service.offerSave('new-password', parentWindow);

      expect(mocks.showTopMessageBox).toHaveBeenCalledWith(
        parentWindow,
        expect.objectContaining({
          message: 'Save password to system password store?',
        })
      );
    });

    it('shows Credential Manager messaging on Windows', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

      await service.offerSave('new-password', parentWindow);

      expect(mocks.showTopMessageBox).toHaveBeenCalledWith(
        parentWindow,
        expect.objectContaining({
          message: 'Save password to Credential Manager?',
        })
      );
    });

    it('saves the password when the user chooses Save', async () => {
      const result = await service.offerSave('new-password', parentWindow);

      expect(mocks.setPassword).toHaveBeenCalledWith(
        'Budget Optimizer',
        'master',
        'new-password'
      );
      expect(result).toEqual({ success: true, saved: true });
    });

    it('does not save when the user chooses Not Now', async () => {
      mocks.showTopMessageBox.mockResolvedValue({ response: 1 });

      const result = await service.offerSave('new-password', parentWindow);

      expect(mocks.setPassword).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true, saved: false });
    });

    it('returns an error when save fails after the user confirms', async () => {
      mocks.setPassword.mockRejectedValue(new Error('keychain denied'));

      const result = await service.offerSave('new-password', parentWindow);

      expect(result).toEqual({
        success: false,
        saved: false,
        error: 'Failed to save password to system credential store',
      });
    });
  });
});
