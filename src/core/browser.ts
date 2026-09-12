import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';

export async function launchPage(url: string): Promise<{ browser: Browser; page: Page }> {
    const browser = await chromium.launch({ headless: true});
    const page = await browser.newPage();
    await page.goto(url, {waitUntil: 'networkidle'});
    return { browser, page };
}