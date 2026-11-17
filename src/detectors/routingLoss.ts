import { Page } from 'playwright';
import { getFocusSnapshot, waitForFocusToSettle } from '../core/focusState';
import { isNavigationError } from '../core/navigation';
import type { Hooks, ScenarioOutcome } from '../core/types';

/**
 * Проверка клиентской навигации.
 * Вердикт строится только по фокусу (перенос фокуса в новый контент).
 * Дополнительно в details записываются признаки компенсирующего объявления:
 *  - titleChanged: сменился document.title;
 *  - liveRegionUpdated: изменился текст в aria-live / role=status|alert|log.
 * Эти признаки пока НЕ влияют на вердикт: политику обсуждаем с научным руководителем.
 *
 * not_applicable: URL не изменился; полная перезагрузка (MPA); переход по якорю внутри страницы.
 */
export async function checkRoutingScenario(
  page: Page,
  startUrl: string,
  linkSelector: string,
  hooks?: Hooks
): Promise<ScenarioOutcome> {
  try {
    return await runRoutingScenario(page, startUrl, linkSelector, hooks);
  } catch (e) {
    if (isNavigationError(e)) return { verdict: 'not_applicable', details: 'full_page_navigation' };
    throw e;
  }
}

/** '#sec' и '#' это якорь внутри страницы; '#/path' и '#!/path' это маршрут (HashRouter). */
function isInPageAnchor(before: string, after: string): boolean {
  const i = after.indexOf('#');
  if (i === -1) return false;
  if (before.split('#')[0] !== after.slice(0, i)) return false;
  const hash = after.slice(i + 1);
  return !/^!?\//.test(hash);
}

async function runRoutingScenario(
  page: Page,
  startUrl: string,
  linkSelector: string,
  hooks?: Hooks
): Promise<ScenarioOutcome> {
  await page.goto(startUrl, { waitUntil: 'load', timeout: 15000 });

  const link = page.locator(linkSelector).first();
  try {
    await link.waitFor({ state: 'visible', timeout: 10000 });
  } catch {
    return { verdict: 'error', details: 'selector_not_found' };
  }

  // метки: «это триггер», «это тот же документ», исходный title, журнал live-регионов
  await link.evaluate((el) => el.setAttribute('data-kbd-trigger', '1'));
  await page.evaluate(() => {
    const w = window as any;
    w.__kbd_marker = 1;
    w.__kbd_titleBefore = document.title;
    w.__kbd_live = [];
    const sel = '[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"]';
    new MutationObserver((muts) => {
      for (const m of muts) {
        const el = m.target instanceof Element ? m.target : m.target.parentElement;
        const region = el ? el.closest(sel) : null;
        if (region) w.__kbd_live.push((region.textContent || '').trim().slice(0, 80));
        for (const n of Array.from(m.addedNodes)) {
          if (n instanceof Element && (n.matches(sel) || n.querySelector(sel))) {
            w.__kbd_live.push((n.textContent || '').trim().slice(0, 80));
          }
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  });
  await link.focus();

  const urlBefore = page.url();
  await page.keyboard.press('Enter');

  // ждём смену URL (и для полной навигации, и для pushState/hash)
  await page.waitForURL((u) => u.toString() !== urlBefore, { timeout: 2000 }).catch(() => {});
  await page.waitForLoadState('load');

  const urlAfter = page.url();
  if (urlAfter === urlBefore) {
    return { verdict: 'not_applicable', details: 'url_did_not_change' };
  }

  // якорь внутри страницы: роутинга нет, браузер сам управляет позицией
  if (isInPageAnchor(urlBefore, urlAfter)) {
    return { verdict: 'not_applicable', details: 'in_page_anchor' };
  }

  // метка пропала: документ заменён целиком (многостраничный сайт)
  const sameDocument = await page.evaluate(() => (window as any).__kbd_marker === 1);
  if (!sameDocument) {
    return { verdict: 'not_applicable', details: 'full_page_navigation' };
  }

  // даём приложению время отреагировать: ждём, пока фокус уйдёт с триггера
  // или триггер исчезнет (до 2 с). Иначе экран, который грузится асинхронно,
  // даёт ложный результат (проверка идёт по старому экрану).
  await page
    .waitForFunction(
      () => {
        const t = document.querySelector('[data-kbd-trigger]');
        return !t || !t.isConnected || document.activeElement !== t;
      },
      undefined,
      { timeout: 2000 }
    )
    .catch(() => {});
  await waitForFocusToSettle(page);
  await hooks?.afterAction?.(page);

  const after = await getFocusSnapshot(page);
  const extra = await page.evaluate(() => {
    const w = window as any;
    const a = document.activeElement;
    return {
      stayedOnTrigger: !!a && a.hasAttribute('data-kbd-trigger'),
      titleChanged: document.title !== w.__kbd_titleBefore,
      liveRegionUpdated: Array.isArray(w.__kbd_live) && w.__kbd_live.length > 0,
    };
  });

  const types: string[] = [];
  if (after.isBody || !after.isConnected) types.push('focus_reset_to_body');
  else if (extra.stayedOnTrigger) types.push('focus_stayed_on_trigger');

  const details = {
    ...after,
    titleChanged: extra.titleChanged,
    liveRegionUpdated: extra.liveRegionUpdated,
  };

  return types.length ? { verdict: 'violation', violationTypes: types, details } : { verdict: 'ok', details };
}