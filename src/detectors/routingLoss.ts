import { Page } from 'playwright';
import { getFocusSnapshot, FocusSnapshot } from '../core/focusState';

export interface RoutingViolation {
    linkHref: string;
    before: FocusSnapshot;
    after: FocusSnapshot;
    reason: string;
}

export async function detectRoutingFocusLoss(page: Page, baseUrl: string): Promise<RoutingViolation[]> {
    const violations: RoutingViolation[] = [];

    // сбор внутренних ссылок
    const links = await page.$$eval('a[href]', (els, base) =>
        els
        .map((el) => (el as HTMLAnchorElement).href)
        .filter((href) => href.startsWith(base) && !href.includes('#')),
    baseUrl
    );

    for (const href of links.slice(0,20)) {
        await page.goto(baseUrl);
        await page.waitForLoadState('networkidle');

        const linkSelector = `a[href="${href}"]`;
        const linkExists = await page.$(linkSelector);
        if (!linkExists) continue;

        await page.click(linkSelector);
        await page.waitForTimeout(500); // на отрисовку react

        const after = await getFocusSnapshot(page);

        // проверка нарушения фокуса
        if (after.isBody || !after.isConnected) {
            violations.push({
                linkHref: href,
                before: { tag: 'A', role: null, text: null, isBody: false, isConnected: true, boundingBox: null},
                after,
                reason: after.isBody ? 'focus_reset_to_body' : ' focus_on_detached_element',
            });
        }

    }

    return violations;
}