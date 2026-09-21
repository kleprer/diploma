import type { Page } from 'playwright';
import { getFocusSnapshot, waitForFocusToSettle } from '../core/focusState';
import { FOCUSABLE } from '../core/selectors';
import type { Hooks, ScenarioOutcome } from '../core/types';

export async function checkDynamicScenario(
    page: Page,
    startUrl: string,
    itemSelector: string,
    loadMoreSelector?: string,
    hooks?: Hooks
): Promise<ScenarioOutcome> {
    await page.goto(startUrl, { waitUntil: 'networkidle'});

    const countBefore = await page.locator(itemSelector).count();
    if (countBefore === 0) return { verdict: 'error', details: 'item_selector_not_found' };

    if (loadMoreSelector) {
        // кнопка "показать еще"
        const btn = page.locator(loadMoreSelector).first();
        if ((await btn.count()) === 0 ) return { verdict: 'error', details: 'load_more_not_found'};
        await btn.focus();
        await page.keyboard.press('Enter');
    } else {
        // infinite scroll
        await page.evaluate(
            ({ sel, focusable}) => {
                const items = document.querySelectorAll(sel);
                const last = items[items.length - 1] as HTMLElement;
                const f = last.matches(focusable)
                    ? last
                    : (last.querySelector(focusable) as HTMLElement | null);
                f?.focus();
                window.scrollTo(0, document.documentElement.scrollHeight);
            },
            {sel: itemSelector, focusable: FOCUSABLE}
        );
    }

    // ждем новых элементов, затем пока фокус успокоится
  await page
    .waitForFunction(
      ({ sel, n }) => document.querySelectorAll(sel).length > n,
      { sel: itemSelector, n: countBefore },
      { timeout: 4000 }
    )
    .catch(() => null);
  await waitForFocusToSettle(page);

  const countAfter = await page.locator(itemSelector).count();
  if (countAfter <= countBefore) return { verdict: 'not_applicable', details: 'nothing_loaded' };
  await hooks?.afterAction?.(page);

  const types: string[] = [];
  const snap = await getFocusSnapshot(page);

  // критерий 1: фокус не потерялся при подгрузке
  if (snap.isBody || !snap.isConnected) {
    types.push('focus_lost_after_load');
  } else {
    // критерий 2: порядок tab по элементам списка не прыгает назад
    const seq: number[] = [];
    const budget = (countAfter - countBefore) * 3 + 5;
    for (let i = 0; i < budget; i++) {
      await page.keyboard.press('Tab');
      const idx = await page.evaluate((sel) => {
        const items = Array.from(document.querySelectorAll(sel));
        const a = document.activeElement;
        return items.findIndex((it) => it === a || it.contains(a));
      }, itemSelector);
      if (idx !== -1) seq.push(idx);
    }
    for (let i = 1; i < seq.length; i++) {
      if (seq[i] < seq[i - 1]) {
        types.push('tab_order_not_monotonic');
        break;
      }
    }
  }

  return types.length
    ? { verdict: 'violation', violationTypes: types }
    : { verdict: 'ok' };
}