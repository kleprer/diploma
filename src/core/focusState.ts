import { Page } from 'playwright';

export interface FocusSnapshot {
    tag: string;
    role: string | null;
    text: string | null;
    isBody: boolean;
    isConnected: boolean;
    boundingBox: { x: number, y: number } | null;
}

export async function getFocusSnapshot(page: Page): Promise<FocusSnapshot> {
    return page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) {
            return { tag: 'NONE', role: null, text: null, isBody: true, isConnected: false, boundingBox: null };    
        }
        const rect = el.getBoundingClientRect();
        return {
            tag: el.tagName,
            role: el.getAttribute('role'),
            text: el.textContent?.trim().slice(0,50) || null,
            isBody: el === document.body,
            isConnected: el.isConnected,
            boundingBox: { x: rect.x, y: rect.y },
        };
    });
}

export async function waitForFocusToSettle(
  page: Page,
  quietMs = 300,
  timeoutMs = 3000
): Promise<void> {
  await page.evaluate(
    ({ quietMs, timeoutMs }) =>
      new Promise<void>((resolve) => {
        let last = document.activeElement;
        const start = performance.now();
        let lastChange = start;
        const timer = setInterval(() => {
          const now = performance.now();
          if (document.activeElement !== last) {
            last = document.activeElement;
            lastChange = now;
          }
          if (now - lastChange >= quietMs || now - start >= timeoutMs) {
            clearInterval(timer);
            resolve();
          }
        }, 50);
      }),
    { quietMs, timeoutMs }
  );
}