import type { Page } from 'playwright';

/** Ставит метку на текущий документ. После полной навигации (MPA) метка исчезает. */
export async function markDocument(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as any).__kbd_marker = 1;
  });
}

/** true, если документ тот же. Если контекст уничтожен навигацией, возвращает false. */
export async function isSameDocument(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(() => (window as any).__kbd_marker === 1);
  } catch {
    return false;
  }
}

/** Ошибка Playwright, когда страница ушла на другую во время проверки. */
export function isNavigationError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /Execution context was destroyed|most likely because of a navigation|frame was detached/i.test(msg);
}

/** Ждёт возможную навигацию после действия (не дольше timeoutMs). */
export async function waitForPossibleNavigation(page: Page, urlBefore: string, timeoutMs = 300): Promise<void> {
  await page.waitForURL((u) => u.toString() !== urlBefore, { timeout: timeoutMs }).catch(() => {});
}