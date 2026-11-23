import type { Page } from 'playwright';
import { getFocusSnapshot, waitForFocusToSettle } from '../core/focusState';
import { FOCUSABLE } from '../core/selectors';
import {
  isNavigationError,
  isSameDocument,
  markDocument,
  waitForPossibleNavigation,
} from '../core/navigation';
import type { Hooks, ScenarioOutcome } from '../core/types';

const fullNavigation = (): ScenarioOutcome => ({
  verdict: 'not_applicable',
  details: 'full_page_navigation',
});

export async function checkDynamicScenario(
  page: Page,
  startUrl: string,
  itemSelector: string,
  loadMoreSelector?: string,
  hooks?: Hooks
): Promise<ScenarioOutcome> {
  try {
    return await runDynamicScenario(page, startUrl, itemSelector, loadMoreSelector, hooks);
  } catch (e) {
    if (isNavigationError(e)) return fullNavigation();
    throw e;
  }
}

async function runDynamicScenario(
  page: Page,
  startUrl: string,
  itemSelector: string,
  loadMoreSelector?: string,
  hooks?: Hooks
): Promise<ScenarioOutcome> {
  await page.goto(startUrl, { waitUntil: 'load', timeout: 15000 });
  const isDeadApp = await page.evaluate(() => {
    return document.body.textContent?.includes('You need to enable JavaScript') ?? false;
  });
  
  if (isDeadApp) {
    return { verdict: 'error', details: 'app_failed_to_mount' };
  }
  try {
    await page.locator(itemSelector).first().waitFor({ state: 'visible', timeout: 10000 });
  } catch {
    return { verdict: 'error', details: 'item_selector_not_found' };
  }

  // метка документа: если после действия её нет, это полная навигация (MPA)
  await markDocument(page);

  const countBefore = await page.locator(itemSelector).count();
  if (loadMoreSelector) {
    // кнопка "показать еще"
    const btn = page.locator(loadMoreSelector).first();
    if ((await btn.count()) === 0) return { verdict: 'error', details: 'load_more_not_found' };
    const urlBefore = page.url();
    await btn.focus();
    await page.keyboard.press('Enter');
    await waitForPossibleNavigation(page, urlBefore);
  } else {
    // infinite scroll
    await page.evaluate(
      ({ sel, focusable }) => {
        const items = document.querySelectorAll(sel);
        const last = items[items.length - 1] as HTMLElement;
        const f = last.matches(focusable) ? last : (last.querySelector(focusable) as HTMLElement | null);
        f?.focus();
        window.scrollTo(0, document.documentElement.scrollHeight);
      },
      { sel: itemSelector, focusable: FOCUSABLE }
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

  // новая страница вместо подгрузки в тот же документ: детектор неприменим
  if (!(await isSameDocument(page))) return fullNavigation();

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
    // идём от первого элемента и останавливаемся на последнем, иначе tab
    // зациклится на начало страницы и даст ложное нарушение
    const started = await page.evaluate(
      ({ sel, focusable }) => {
        const first = document.querySelector(sel) as HTMLElement | null;
        if (!first) return false;
        const f = first.matches(focusable) ? first : (first.querySelector(focusable) as HTMLElement | null);
        if (!f) return false;
        f.focus();
        f.setAttribute('data-kbd-seen', '1');
        return true;
      },
      { sel: itemSelector, focusable: FOCUSABLE }
    );

    if (started) {
      const seq: number[] = [0];
      const budget = await page.locator(FOCUSABLE).count();
      for (let i = 0; i < budget; i++) {
        await page.keyboard.press('Tab');
        const info = await page.evaluate((sel) => {
          const a = document.activeElement as HTMLElement | null;
          if (!a || a === document.body) return { idx: -1, repeat: false };
          const repeat = a.hasAttribute('data-kbd-seen');
          a.setAttribute('data-kbd-seen', '1');
          const items = Array.from(document.querySelectorAll(sel));
          return { idx: items.findIndex((it) => it === a || it.contains(a)), repeat };
        }, itemSelector);
        if (info.repeat) break; // tab пошёл по второму кругу
        if (info.idx !== -1) seq.push(info.idx);
        if (info.idx === countAfter - 1) break; // дошли до последнего элемента
      }
      for (let i = 1; i < seq.length; i++) {
        if (seq[i] < seq[i - 1]) {
          types.push('tab_order_not_monotonic');
          break;
        }
      }
    }
  }

  return types.length ? { verdict: 'violation', violationTypes: types } : { verdict: 'ok' };
}