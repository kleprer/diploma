import { Page } from 'playwright';

export interface DynamicInsertViolation {
    reason: string;
    itemIndexBefore: number;
    itemIndexAfter: number;
}

export async function detectDynamicInsertionIssues(
    page: Page,
    itemSelector: string
): Promise<DynamicInsertViolation[]> {
    const violations: DynamicInsertViolation[] = [];

    const countBefore = await page.$$eval(itemSelector, (els) => els.length);

    // триггер подзагрузки контента
    for (let i = 0; i < 3; i++) {
        await page.keyboard.press('End');
        await page.waitForTimeout(1000);
    }

    const countAfter = await page.$$eval(itemSelector, (els) => els.length);

    if (countAfter <= countBefore) {
        // подзагрузки не произошло
        return violations;
    }

    // проверяем порядок фокуса, Tab через все элементы
    const tabOrder: number[] = [];
    await page.keyboard.press('Home');
    for (let i = 0; i < countAfter; i++) {
        await page.keyboard.press('Tab');
        const idx = await page.evaluate((sel) => {
            const items = Array.from(document.querySelectorAll(sel));
            return items.indexOf(document.activeElement as Element);
        }, itemSelector);
        if (idx !== -1) tabOrder.push(idx);
    }

    for (let i = 1; i < tabOrder.length; i++) {
        if (tabOrder[i] < tabOrder[i-1]) {
            violations.push({
                reason: 'tab_order_not_monotonic_after_dynamic_load',
                itemIndexBefore: tabOrder[i-1],
                itemIndexAfter: tabOrder[i]
            });
        }
    }

    return violations;
}