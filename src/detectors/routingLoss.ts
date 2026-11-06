import { Page } from 'playwright';
import { getFocusSnapshot, waitForFocusToSettle } from '../core/focusState';
import type { Hooks, ScenarioOutcome } from '../core/types';

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

    // две метки: «это триггер» и «это тот же документ»
    await link.evaluate((el) => el.setAttribute('data-kbd-trigger', '1'));
    await page.evaluate(() => { (window as any).__kbd_marker = 1; });
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

    await waitForFocusToSettle(page);
    await hooks?.afterAction?.(page);

    const after = await getFocusSnapshot(page);
    const stayedOnTrigger = await page.evaluate(
        () => document.activeElement?.hasAttribute('data-kbd-trigger') ?? false
    );

    const types: string[] = [];
    if (after.isBody || !after.isConnected) types.push('focus_reset_to_body');
    else if (stayedOnTrigger) types.push('focus_stayed_on_trigger');

    return types.length
        ? { verdict: 'violation', violationTypes: types, details: after }
        : { verdict: 'ok', details: after };
}