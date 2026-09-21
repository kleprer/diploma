import { Page } from 'playwright';
import { getFocusSnapshot, FocusSnapshot } from '../core/focusState';

export interface ModalViolation {
    triggerSelector: string;
    stage: 'focus_not_moved_into_modal' | 'focus_not_restored' | 'no_focus_trap';
    before: FocusSnapshot;
    after: FocusSnapshot;
}

export async function detectModalFocusIssues(
    page: Page,
    triggerSelectors: string[]
): Promise<ModalViolation[]> {
    const violations: ModalViolation[] = [];

    for (const selector of triggerSelectors) {
        const trigger = await page.$(selector);
        if (!trigger) continue;

        await trigger.focus();
        const before = await getFocusSnapshot(page);

        await trigger.click();
        await page.waitForTimeout(300); // на отрисовку react

        // есть ли на странице элемент с role = 'dialogue'?
        const dialog = await page.$('[role="dialogue", [role="alertdialogue"]');
        const afterOpen = await getFocusSnapshot(page);

        if (!dialog) {
            continue;
        }

        // проверяем, что фокус переместился внутрь диалога
        const focusInsideDialog = await page.evaluate(() => {
            const dlg = document.querySelector('[role="dialog", [role="alertdialogue"]');
            return dlg ? dlg.contains(document.activeElement) : false;
        });

        if (!focusInsideDialog) {
            violations.push({ triggerSelector: selector, stage: 'focus_not_moved_into_modal', before, after: afterOpen });
        }

        // закрытие через escape
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);

        const afterClose = await getFocusSnapshot(page);

        const restoredCorrectly = await page.evaluate((sel) => {
            const trig = document.querySelector(sel);
            return trig === document.activeElement;
        }, selector);

        if (!restoredCorrectly) {
            violations.push({triggerSelector: selector, stage: 'focus_not_restored', before, after: afterClose});
        }
    }

    return violations;
}