import { Page } from 'playwright';
import { waitForFocusToSettle } from '../core/focusState';
import { DIALOG, FOCUSABLE } from '../core/selectors';
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

/**
 * Проверка модального окна по трём критериям (источники: ARIA APG «Dialog (Modal)», техника WCAG F85):
 *  1) после открытия фокус внутри диалога;
 *  2) Tab/Shift+Tab не выводят фокус на СОДЕРЖИМОЕ СТРАНИЦЫ за диалогом
 *     (уход фокуса в интерфейс браузера, т.е. на body, утечкой не считается);
 *  3) после закрытия фокус вернулся на триггер.
 * Если триггер ведёт на другую страницу (MPA), результат not_applicable.
 */
export async function checkModalScenario(
  page: Page,
  startUrl: string,
  triggerSelector: string,
  hooks?: Hooks
): Promise<ScenarioOutcome> {
  try {
    return await runModalScenario(page, startUrl, triggerSelector, hooks);
  } catch (e) {
    if (isNavigationError(e)) return fullNavigation();
    throw e;
  }
}

async function runModalScenario(
  page: Page,
  startUrl: string,
  triggerSelector: string,
  hooks?: Hooks
): Promise<ScenarioOutcome> {
  await page.goto(startUrl, { waitUntil: 'load', timeout: 15000 });
  const isDeadApp = await page.evaluate(() => {
    return document.body.textContent?.includes('You need to enable JavaScript') ?? false;
  });
  
  if (isDeadApp) {
    return { verdict: 'error', details: 'app_failed_to_mount' };
  }
  const trigger = page.locator(triggerSelector).first();
  try {
    await trigger.waitFor({ state: 'visible', timeout: 10000 });
  } catch {
    return { verdict: 'error', details: 'selector_not_found' };
  }

  await trigger.evaluate((el) => el.setAttribute('data-kbd-trigger', '1'));
  await markDocument(page);
  await trigger.focus();

  const urlBefore = page.url();
  await page.keyboard.press('Enter');
  await waitForPossibleNavigation(page, urlBefore);
  await waitForFocusToSettle(page);

  // триггер был обычной ссылкой на другую страницу, а не модалкой
  if (!(await isSameDocument(page))) return fullNavigation();

  const dialog = page.locator(DIALOG).first();
  if ((await dialog.count()) === 0) return { verdict: 'not_applicable', details: 'no_dialog_opened' };
  await hooks?.afterAction?.(page);

  const types: string[] = [];
  const focusIsInside = () => dialog.evaluate((d) => d.contains(document.activeElement));

  // критерий 1: фокус ушёл внутрь диалога
  if (!(await focusIsInside())) types.push('focus_not_moved_into_modal');

  // критерий 2: фокус не утекает на содержимое страницы за диалогом
  const focusableCount = await dialog.evaluate((d, sel) => d.querySelectorAll(sel).length, FOCUSABLE);
  let leaked = false;
  for (let i = 0; i < focusableCount * 2 + 4 && !leaked; i++) {
    await page.keyboard.press('Tab');
    leaked = await dialog.evaluate((d) => {
      const a = document.activeElement;
      return !!a && a !== document.body && !d.contains(a);
    });
  }
  if (leaked) types.push('focus_leaks_out_of_modal');

  // возвращаем фокус внутрь, чтобы Escape-обработчик сработал
  await dialog.evaluate((d, sel) => {
    const f = (d.querySelector(sel) as HTMLElement | null) ?? (d as HTMLElement);
    f.focus();
  }, FOCUSABLE);

  await page.keyboard.press('Escape');
  await waitForFocusToSettle(page);

  const stillOpen = (await page.locator(DIALOG).count()) > 0;
  if (stillOpen) {
    const note = { note: 'not_closable_by_escape_restore_not_checked' };
    return types.length
      ? { verdict: 'violation', violationTypes: types, details: note }
      : { verdict: 'ok', details: note };
  }

  // критерий 3: фокус вернулся на триггер
  const restored = await page.evaluate(() => {
    const t = document.querySelector('[data-kbd-trigger]');
    return !!t && t === document.activeElement;
  });
  if (!restored) types.push('focus_not_restored');

  return types.length ? { verdict: 'violation', violationTypes: types } : { verdict: 'ok' };
}