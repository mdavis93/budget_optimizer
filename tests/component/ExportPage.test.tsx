import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExportPage from '../../src/pages/ExportPage';
import { renderWithRouter } from '../helpers/renderWithProviders';
import { createMockElectronAPI, createMockSchedule } from '../mocks/electron-api.mock';

const mockUseData = vi.fn();

vi.mock('../../src/context/DraftContext', () => ({
  useDraftData: () => {
    const data = mockUseData();
    return { incomes: data.incomes, bills: data.bills };
  },
  useSchedule: () => mockUseData(),
}));

describe('ExportPage', () => {
  const mockAPI = createMockElectronAPI();
  const generateSchedule = vi.fn(async () => null);
  const setScheduleStartDate = vi.fn();
  const setScheduleMonths = vi.fn();
  const setScheduleStartingBalance = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseData.mockReturnValue({
      schedule: createMockSchedule(),
      generateSchedule,
      incomes: [{ id: 'i1' }],
      bills: [{ id: 'b1' }],
      scheduleStartDate: '2026-01-01',
      scheduleMonths: 3,
      scheduleStartingBalance: 900,
      setScheduleStartDate,
      setScheduleMonths,
      setScheduleStartingBalance,
    });
  });

  describe('happy', () => {
    it('refreshes and runs all export flows', async () => {
      const user = userEvent.setup();
      renderWithRouter(<ExportPage />, { mockAPI });
      fireEvent.change(screen.getByLabelText('Start Date'), { target: { value: '2026-02-01' } });
      await user.selectOptions(screen.getByLabelText('Duration'), '6');
      await user.clear(screen.getByLabelText('Starting Balance'));
      await user.type(screen.getByLabelText('Starting Balance'), '1200');
      await user.click(screen.getByRole('button', { name: /Refresh Schedule/i }));

      await waitFor(() => {
        expect(setScheduleStartDate).toHaveBeenCalled();
        expect(setScheduleMonths).toHaveBeenCalledWith(6);
        expect(setScheduleStartingBalance).toHaveBeenCalled();
        expect(generateSchedule).toHaveBeenCalled();
      });
      expect(screen.getByText('Schedule refreshed')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /Export PDF/i }));
      await user.click(screen.getByRole('button', { name: /Export HTML/i }));
      await user.click(screen.getByRole('button', { name: /Export Spreadsheet/i }));

      await waitFor(() => {
        expect(mockAPI.showSaveDialog).toHaveBeenCalledTimes(3);
        expect(mockAPI.export.toPdf).toHaveBeenCalled();
        expect(mockAPI.export.toHtml).toHaveBeenCalled();
        expect(mockAPI.export.toSpreadsheet).toHaveBeenCalled();
      });
    });
  });

  describe('sad', () => {
    it('disables export actions when schedule is missing', () => {
      mockUseData.mockReturnValue({
        schedule: null,
        generateSchedule,
        incomes: [],
        bills: [],
        scheduleStartDate: '2026-01-01',
        scheduleMonths: 3,
        scheduleStartingBalance: 900,
        setScheduleStartDate,
        setScheduleMonths,
        setScheduleStartingBalance,
      });

      renderWithRouter(<ExportPage />, { mockAPI });
      expect(screen.getByRole('button', { name: /Export PDF/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /Export HTML/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /Export Spreadsheet/i })).toBeDisabled();
    });
  });

  describe('hostile', () => {
    it('auto-generates schedule and handles canceled save dialog', async () => {
      const user = userEvent.setup();
      mockUseData.mockReturnValue({
        schedule: null,
        generateSchedule,
        incomes: [{ id: 'i1' }],
        bills: [],
        scheduleStartDate: '2026-01-01',
        scheduleMonths: 3,
        scheduleStartingBalance: 900,
        setScheduleStartDate,
        setScheduleMonths,
        setScheduleStartingBalance,
      });
      mockAPI.showSaveDialog.mockResolvedValueOnce({ canceled: true });

      renderWithRouter(<ExportPage />, { mockAPI });
      await waitFor(() => {
        expect(generateSchedule).toHaveBeenCalledWith('2026-01-01', 3, 900);
      });

      await user.click(screen.getByRole('button', { name: /Export PDF/i }));
      await waitFor(() => {
        expect(mockAPI.export.toPdf).not.toHaveBeenCalled();
      });
    });
  });
});
