import { Page } from 'playwright';
import { getFocusSnapshot, waitForFocusToSettle } from '../core/focusState';
import type { Hooks, ScenarioOutcome } from '../core/types';

/**
 * Проверка клиентской навигации.
 * Вердикт строится только по фокусу (перенос фокуса в новый контент).
 */
export async function checkRoutingScenario(
    page: Page,
    startUrl: string,
    linkSelector: string,
    hooks?: Hooks,
): Promise<ScenarioOutcome> {
    await page.goto(startUrl, { waitUntil: 'load', timeout: 15000 });

    const link = page.locator(linkSelector).first();
    try {
        await link.waitFor({ state: 'visible', timeout: 10000 });
    } catch {
        return { verdict: 'error', details: 'selector_not_found' };
    }

    // метки: «это триггер», «это тот же документ»
    await link.evaluate((el) => el.setAttribute('data-kbd-trigger', '1'));
    await page.evaluate(() => {
        const w = window as any;
        w.__kbd_marker = 1;
    });
    await link.focus();

    const urlBefore = page.url();
    await page.keyboard.press('Enter');

    // ждём смену URL (и для полной навигации, и для pushState/hash)
    await page.waitForURL((u) => u.toString() !== urlBefore, { timeout: 2000 }).catch(() => {});
    await page.waitForLoadState('load');

    if (page.url() === urlBefore) {
        return { verdict: 'not_applicable', details: 'url_did_not_change' };
    }

    // метка пропала: документ заменён целиком (многостраничный сайт)
    const sameDocument = await page.evaluate(() => (window as any).__kbd_marker === 1);
    if (!sameDocument) {
        return { verdict: 'not_applicable', details: 'full_page_navigation' };
    }
    
    // даём приложению время отреагировать: ждём, пока фокус уйдёт с триггера
    // или триггер исчезнет (до 2 с). Иначе экран, который грузится асинхронно,
    // даёт ложный результат (проверка идёт по старому экрану).
    await page.waitForFunction(() => {
        const t = document.querySelector('[data-kbd-trigger]');
        return !t || !t.isConnected || document.activeElement !== t;
    }, undefined, { timeout: 2000 }).catch(() => {});
    await waitForFocusToSettle(page);
    await hooks?.afterAction?.(page);

    const after = await getFocusSnapshot(page);
    const extra = await page.evaluate(() => {
        const a = document.activeElement;
        return {
            stayedOnTrigger: !!a && a.hasAttribute('data-kbd-trigger'),
        };
    });

    const types: string[] = [];
    if (after.isBody || !after.isConnected) types.push('focus_reset_to_body');
    else if (extra.stayedOnTrigger) types.push('focus_stayed_on_trigger');

    const details = {
        ...after,
    };

    return types.length
        ? { verdict: 'violation', violationTypes: types, details }
        : { verdict: 'ok', details };
}