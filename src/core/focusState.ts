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