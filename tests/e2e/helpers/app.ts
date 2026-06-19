import { type Page } from '@playwright/test';
import { completeSetup } from './auth';
import { createBudgetViaPicker, type CreateBudgetOptions } from './budget';

/**
 * Boot a pristine vault all the way to the app shell inside a *named* budget
 * (which enables draft mode, where edits stage in an overlay until saved).
 * This is the common arrange step for domain journeys.
 */
export async function startInNamedBudget(
  window: Page,
  budget?: CreateBudgetOptions
): Promise<void> {
  await completeSetup(window);
  await createBudgetViaPicker(window, budget);
}
