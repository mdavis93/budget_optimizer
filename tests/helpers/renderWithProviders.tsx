import { ReactElement, ReactNode } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { createMockElectronAPI } from '../mocks/electron-api.mock';
import { TestMemoryRouter } from './router';

export interface ProviderOptions {
  route?: string;
  unlocked?: boolean;
  quickBudget?: boolean;
  mockAPI?: ReturnType<typeof createMockElectronAPI>;
}

function TestProviders({
  children,
  route = '/',
  unlocked = true,
  quickBudget = false,
  mockAPI,
}: {
  children: ReactNode;
  route?: string;
  unlocked?: boolean;
  quickBudget?: boolean;
  mockAPI?: ReturnType<typeof createMockElectronAPI>;
}) {
  const api = mockAPI ?? createMockElectronAPI();
  window.electronAPI = api as unknown as Window['electronAPI'];

  api.auth.isUnlocked.mockResolvedValue(unlocked);
  api.auth.isFirstTimeSetup.mockResolvedValue(false);
  api.budget.getCurrent.mockResolvedValue({
    success: true,
    data: {
      budget: quickBudget ? null : api.budget.getAllWithStats.mock.results[0]?.value?.data?.[0] ?? {
        id: 'budget-1',
        name: 'Test Budget',
        startingBalance: 1000,
        targetCashOnHand: 500,
        minCashOnHand: 100,
        minSavingsPerPaycheck: 50,
        scheduleStartDate: '2026-01-01',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      isQuickBudget: quickBudget,
    },
  });

  return (
    <TestMemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="*" element={children} />
      </Routes>
    </TestMemoryRouter>
  );
}

export function renderWithRouter(
  ui: ReactElement,
  options: ProviderOptions & Omit<RenderOptions, 'wrapper'> = {}
) {
  const { route, unlocked, quickBudget, mockAPI, ...renderOptions } = options;
  const api = mockAPI ?? createMockElectronAPI();
  window.electronAPI = api as unknown as Window['electronAPI'];

  return {
    ...render(ui, {
      wrapper: ({ children }) => (
        <TestProviders route={route} unlocked={unlocked} quickBudget={quickBudget} mockAPI={api}>
          {children}
        </TestProviders>
      ),
      ...renderOptions,
    }),
    mockAPI: api,
  };
}
