import { Page } from 'playwright';
import { getFocusSnapshot, waitForFocusToSettle } from '../core/focusState';
import type { Hooks, ScenarioOutcome } from '../core/types';

export async function checkRoutingScenario(
    page: Page,
    startUrl: string,
    linkSelector: string,
    hooks?: Hooks,
): Promise<ScenarioOutcome> {
    await page.goto(startUrl, { waitUntil: 'networkidle' });

    const link = page.locator(linkSelector).first();
    if ((await link.count()) === 0) return { verdict: 'error', details: 'selector_not_found' };

    await link.evaluate((el) => el.setAttribute('data-kbd-trigger', '1'));
    await link.focus();

    const urlBefore = page.url();
    await page.keyboard.press('Enter');
    await waitForFocusToSettle(page);

    if (page.url() === urlBefore) {
        return { verdict: 'not_applicable', details: 'url_did_not_change' };
    }

    await hooks?.afterAction?.(page);

    const after = await getFocusSnapshot(page);
    const stayedOnTrigger = await page.evaluate(
        () => document.activeElement?.hasAttribute('data-kbd-trigger') ?? false
    );

    const types: string[] = [];
    if (after.isBody || !after.isConnected) types.push('focus_reset_to_body');
    else if (stayedOnTrigger) types.push('focus_stayed_on_trigger');

    return types.length
    ? { verdict: 'violation', violationTypes: types, details: after}
    : { verdict: 'ok', details: after}
}