import { Page } from 'playwright';
import { waitForFocusToSettle } from '../core/focusState';
import { DIALOG, FOCUSABLE } from '../core/selectors';
import type { Hooks, ScenarioOutcome } from '../core/types';
import { HookOptions } from 'node:test';

export async function checkModalScenario(
    page: Page,
    startUrl: string,
    triggerSelector: string,
    hooks?: Hooks
): Promise<ScenarioOutcome> {
    await page.goto(startUrl, { waitUntil: 'networkidle' });

    const trigger = page.locator(triggerSelector).first();
    if ((await trigger.count()) === 0) return { verdict: 'error', details: 'selector_not_found' };
    
    await trigger.evaluate((el) => el.setAttribute('data-kdb-trigger', '1'));
    await trigger.focus();
    await page.keyboard.press('Enter');
    await waitForFocusToSettle(page);

    const dialog = page.locator(DIALOG).first();
    if ((await dialog.count()) === 0) return { verdict: 'not_applicable', details: 'no_dialog_opened' };
    await hooks?.afterAction?.(page);

    const types: string[] = [];
    const focusIsInside = () => dialog.evaluate((d) => d.contains(document.activeElement));

    // критерий 1: фокус ушел внутрь диалога
    if (!(await focusIsInside())) types.push('focus_not_moved_into_modal');

    // критерий 2: tab не выводит за пределы диалога    
    const focusableCount = await dialog.evaluate(
        (d, sel) => d.querySelectorAll(sel).length,
        FOCUSABLE
    );
    let escaped = false;
    for (let i = 0; i < focusableCount + 2 && !escaped; i++) {
        await page.keyboard.press('Tab');
        if (!(await focusIsInside())) escaped = true;
    }
    if (escaped) types.push('no_focus_trap');

    // возвращение фокуса внутрь
    await dialog.evaluate((d,sel) => {
        const f = (d.querySelector(sel) as HTMLElement | null) ?? (d as HTMLElement);
        f.focus();
    }, FOCUSABLE);

    await page.keyboard.press('Escape');
    await waitForFocusToSettle(page);

    const stillOpen = (await page.locator(DIALOG).count()) > 0;
    if (stillOpen) {
        const note = {note: 'not_closable_by_escape_restore_not_checked' };
        return types.length
        ? { verdict: 'violation', violationTypes: types, details: note}
        : { verdict: 'ok', details: note};
    }
  
    // критерий 3: фокус вернулся на триггер
    const restored = await page.evaluate(() => {
        const t = document.querySelector('[data-kbd-trigger]');
        return !!t && t === document.activeElement;
    });
    if (!restored) types.push('focus_not_restored');

    return types.length ? { verdict: 'violation', violationTypes: types } : { verdict: 'ok' };
}