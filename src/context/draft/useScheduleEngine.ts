import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { format, startOfMonth } from 'date-fns';
import type { Budget, DraftBudgetFields, DraftOverlay, DraftState, ScheduleData } from '../../types';
import { reportError } from '../../utils/reportError';
import { applyScheduleViewport } from '../../utils/scheduleViewport';
import {
  buildScheduleCacheKey,
  SCHEDULE_DEBOUNCE_MS,
  type ScheduleCacheEntry,
} from '../../utils/scheduleCache';
import { buildScheduleInputHash } from '../../utils/scheduleInputHash';
import type { ScheduleComputeProgressReport } from '@shared/scheduleComputeProtocol';

const defaultScheduleStartDate = () => format(startOfMonth(new Date()), 'yyyy-MM-dd');

export interface ScheduleEngineValue {
  schedule: ScheduleData | null;
  isLoading: boolean;
  error: string | null;
  diagnosticId: string | null;
  progress: ScheduleComputeProgressReport | null;
  buildStartedAt: number | null;
  peekScheduleDiagnosticId: () => string | null;
  scheduleStartDate: string;
  scheduleMonths: number;
  scheduleStartingBalance: number;
  scheduleInputHash: string;
  setScheduleStartDate: (date: string) => void;
  setScheduleMonths: (months: number) => void;
  setScheduleStartingBalance: (balance: number) => void;
  generateSchedule: (
    startDate: string,
    months: number,
    startingBalance: number,
    options?: { force?: boolean; preferredAssignments?: Array<[string, string]> }
  ) => Promise<ScheduleData | null>;
  clearError: () => void;
}

interface UseScheduleEngineOptions {
  draft: DraftState;
  currentBudget: Budget | null;
  isUnlocked: boolean;
  hasBudgetSelected: boolean;
  buildDraftOverlay: () => DraftOverlay | undefined;
  updateBudgetFields: (updates: Partial<DraftBudgetFields>) => boolean;
  pendingPreferredAssignmentsRef: MutableRefObject<Array<[string, string]>>;
}

interface DebounceFlight {
  timer: ReturnType<typeof setTimeout> | null;
  resolve: ((value: ScheduleData | null) => void) | null;
}

export function useScheduleEngine({
  draft,
  currentBudget,
  isUnlocked,
  hasBudgetSelected,
  buildDraftOverlay,
  updateBudgetFields,
  pendingPreferredAssignmentsRef,
}: UseScheduleEngineOptions): ScheduleEngineValue {
  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [isScheduleLoading, setIsScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleDiagnosticId, setScheduleDiagnosticId] = useState<string | null>(null);
  const [scheduleProgress, setScheduleProgress] = useState<ScheduleComputeProgressReport | null>(null);
  const [scheduleBuildStartedAt, setScheduleBuildStartedAt] = useState<number | null>(null);
  const [scheduleMonths, setScheduleMonthsState] = useState(3);
  const [scheduleStartingBalance, setScheduleStartingBalance] = useState(0);

  const fullScheduleRef = useRef<ScheduleData | null>(null);
  const scheduleCacheRef = useRef<ScheduleCacheEntry | null>(null);
  const debounceFlightRef = useRef<DebounceFlight>({ timer: null, resolve: null });
  const mountedRef = useRef(true);
  const scheduleRequestGenRef = useRef(0);
  const isScheduleLoadingRef = useRef(false);
  const scheduleDiagnosticIdRef = useRef<string | null>(null);

  const settleDebounce = useCallback((value: ScheduleData | null) => {
    const flight = debounceFlightRef.current;
    if (flight.timer) {
      clearTimeout(flight.timer);
      flight.timer = null;
    }
    const resolve = flight.resolve;
    flight.resolve = null;
    resolve?.(value);
  }, []);

  useEffect(() => {
    setSchedule(null);
    fullScheduleRef.current = null;
    scheduleCacheRef.current = null;
    settleDebounce(null);
  }, [isUnlocked, hasBudgetSelected, currentBudget?.id, settleDebounce]);

  useEffect(() => {
    if (draft.budget?.startingBalance !== undefined) {
      setScheduleStartingBalance(draft.budget.startingBalance);
    } else if (currentBudget?.startingBalance !== undefined) {
      setScheduleStartingBalance(currentBudget.startingBalance);
    }
  }, [draft.budget?.startingBalance, currentBudget?.startingBalance]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      settleDebounce(null);
    };
  }, [settleDebounce]);

  useEffect(() => {
    const subscribe = window.electronAPI?.schedule?.onProgress;
    if (!subscribe) {
      return undefined;
    }
    return subscribe((progress) => {
      if (!mountedRef.current || !isScheduleLoadingRef.current) {
        return;
      }
      setScheduleProgress({
        stage: progress.stage,
        current: progress.current,
        total: progress.total,
      });
    });
  }, []);

  const scheduleStartDate =
    draft.budget?.scheduleStartDate ?? currentBudget?.scheduleStartDate ?? defaultScheduleStartDate();

  const scheduleInputHash = useMemo(
    () =>
      buildScheduleInputHash({
        incomes: draft.incomes,
        bills: draft.bills,
        skippedBills: draft.skippedBills,
        billAssignments: draft.billAssignments,
        incomeOverrides: draft.incomeOverrides,
        leaves: draft.leaves,
        budgetFields: draft.budget,
      }),
    [draft]
  );

  const setScheduleStartDate = useCallback(
    (date: string) => {
      updateBudgetFields({ scheduleStartDate: date });
    },
    [updateBudgetFields]
  );

  const setScheduleMonths = useCallback(
    (months: number) => {
      setScheduleMonthsState(months);
      if (fullScheduleRef.current) {
        setSchedule(
          applyScheduleViewport(
            fullScheduleRef.current,
            months,
            draft.bills,
            scheduleStartingBalance
          )
        );
      }
    },
    [draft.bills, scheduleStartingBalance]
  );

  const applyScheduleResult = useCallback(
    (data: ScheduleData, requestedMonths: number) => {
      const fullHorizonMonths = data.calculationMonths ?? data.viewportMonths;
      const canonical: ScheduleData = {
        ...data,
        paychecks: data.fullPaychecks,
        calculationMonths: fullHorizonMonths,
        viewportMonths: requestedMonths,
      };
      fullScheduleRef.current = canonical;
      if (scheduleCacheRef.current) {
        scheduleCacheRef.current = { ...scheduleCacheRef.current, data: canonical };
      }
      const viewportSchedule = applyScheduleViewport(
        canonical,
        requestedMonths,
        draft.bills,
        scheduleStartingBalance
      );
      if (mountedRef.current) {
        setSchedule(viewportSchedule);
        setScheduleMonthsState(requestedMonths);
      }
      return viewportSchedule;
    },
    [draft.bills, scheduleStartingBalance]
  );

  const generateScheduleImmediate = useCallback(
    async (startDate: string, months: number, startingBalance: number): Promise<ScheduleData | null> => {
      if (!mountedRef.current) {
        return null;
      }

      const overlay = buildDraftOverlay();
      pendingPreferredAssignmentsRef.current = [];
      const cacheKey = buildScheduleCacheKey(overlay, startDate, months, startingBalance);
      if (scheduleCacheRef.current?.hash === cacheKey) {
        return applyScheduleResult(scheduleCacheRef.current.data, months);
      }

      const requestGen = ++scheduleRequestGenRef.current;
      isScheduleLoadingRef.current = true;
      setIsScheduleLoading(true);
      setScheduleError(null);
      setScheduleProgress(null);
      setScheduleBuildStartedAt(Date.now());
      try {
        const result = await window.electronAPI.schedule.build(startDate, months, startingBalance, overlay);
        if (!mountedRef.current) {
          return null;
        }
        if (requestGen !== scheduleRequestGenRef.current) {
          return null;
        }
        if (result.errorCode === 'superseded') {
          return null;
        }

        if (result.success && result.data) {
          const fullHorizonMonths = result.data.calculationMonths ?? result.data.viewportMonths;
          const canonical: ScheduleData = {
            ...result.data,
            paychecks: result.data.fullPaychecks,
            calculationMonths: fullHorizonMonths,
            viewportMonths: months,
          };
          scheduleCacheRef.current = { hash: cacheKey, data: canonical };
          fullScheduleRef.current = canonical;
          scheduleDiagnosticIdRef.current = null;
          setScheduleDiagnosticId(null);
          setScheduleError(null);
          return applyScheduleResult(canonical, months);
        }
        setScheduleError(result.error || 'Failed to generate schedule');
        scheduleDiagnosticIdRef.current = result.diagnosticId ?? null;
        setScheduleDiagnosticId(result.diagnosticId ?? null);
        return null;
      } catch (error) {
        const throwMsg = error instanceof Error ? error.message : String(error);
        if (mountedRef.current && requestGen === scheduleRequestGenRef.current) {
          setScheduleError(throwMsg || 'Failed to generate schedule');
          void reportError('renderer:useScheduleEngine.generateSchedule', error).then((id) => {
            if (mountedRef.current && requestGen === scheduleRequestGenRef.current) {
              scheduleDiagnosticIdRef.current = id ?? null;
              setScheduleDiagnosticId(id ?? null);
            }
          });
        }
        return null;
      } finally {
        if (mountedRef.current && requestGen === scheduleRequestGenRef.current) {
          isScheduleLoadingRef.current = false;
          setIsScheduleLoading(false);
          setScheduleProgress(null);
          setScheduleBuildStartedAt(null);
        }
      }
    },
    [applyScheduleResult, buildDraftOverlay, pendingPreferredAssignmentsRef]
  );

  const generateSchedule = useCallback(
    async (
      startDate: string,
      months: number,
      startingBalance: number,
      options?: { force?: boolean; preferredAssignments?: Array<[string, string]> }
    ): Promise<ScheduleData | null> => {
      if (options?.preferredAssignments?.length) {
        pendingPreferredAssignmentsRef.current = options.preferredAssignments;
      }
      if (options?.force) {
        settleDebounce(null);
        scheduleCacheRef.current = null;
        return generateScheduleImmediate(startDate, months, startingBalance);
      }

      return new Promise((resolve) => {
        settleDebounce(null);
        const flight = debounceFlightRef.current;
        flight.resolve = resolve;
        flight.timer = setTimeout(() => {
          flight.timer = null;
          const settle = flight.resolve;
          flight.resolve = null;
          void generateScheduleImmediate(startDate, months, startingBalance).then(settle);
        }, SCHEDULE_DEBOUNCE_MS);
      });
    },
    [generateScheduleImmediate, pendingPreferredAssignmentsRef, settleDebounce]
  );

  const clearError = useCallback(() => {
    setScheduleError(null);
    scheduleDiagnosticIdRef.current = null;
    setScheduleDiagnosticId(null);
  }, []);

  const peekScheduleDiagnosticId = useCallback(() => scheduleDiagnosticIdRef.current, []);

  return {
    schedule,
    isLoading: isScheduleLoading,
    error: scheduleError,
    diagnosticId: scheduleDiagnosticId,
    progress: scheduleProgress,
    buildStartedAt: scheduleBuildStartedAt,
    peekScheduleDiagnosticId,
    scheduleStartDate,
    scheduleMonths,
    scheduleStartingBalance,
    scheduleInputHash,
    setScheduleStartDate,
    setScheduleMonths,
    setScheduleStartingBalance,
    generateSchedule,
    clearError,
  };
}
