import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Page } from 'playwright';

export interface ToolFinding {
  tool: 'htmlcs';
  type: 'error' | 'warning' | 'notice';
  code: string; // например WCAG2AA.Principle1.Guideline1_1.1_1_1.H37
  criterion: string | null; // например "1.1.1"
  message: string;
  target: string; // tag#id
}

// запускать из корня репозитория
const HTMLCS_PATH = path.resolve(process.cwd(), 'node_modules/html_codesniffer/build/HTMLCS.js');
let source: string | null = null;

const TYPES: Record<number, ToolFinding['type']> = { 1: 'error', 2: 'warning', 3: 'notice' };

function criterionOf(code: string): string | null {
  const m = code.match(/\.(\d_\d_\d)(?:\.|$)/);
  return m ? m[1].replace(/_/g, '.') : null;
}

/**
 * Прогоняет HTML_CodeSniffer (WCAG2AA) по ТЕКУЩЕМУ состоянию страницы.
 * Если у контекста не включён bypassCSP, строгий CSP страницы может заблокировать внедрение скрипта.
 */
export async function runHtmlcs(page: Page): Promise<ToolFinding[]> {
  if (source === null) source = fs.readFileSync(HTMLCS_PATH, 'utf8');

  const injected = await page.evaluate(() => typeof (window as any).HTMLCS !== 'undefined');
  if (!injected) await page.addScriptTag({ content: source });

  const raw = await page.evaluate(
    () =>
      new Promise<{ type: number; code: string; msg: string; target: string }[]>((resolve) => {
        const H = (window as any).HTMLCS;
        H.process('WCAG2AA', document, () => {
          resolve(
            H.getMessages().map((m: any) => {
              const el = m.element as Element | null;
              const target = el && el.tagName ? el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') : '';
              return { type: m.type, code: String(m.code), msg: String(m.msg), target };
            })
          );
        });
      })
  );

  return raw.map((m) => ({
    tool: 'htmlcs' as const,
    type: TYPES[m.type] ?? 'notice',
    code: m.code,
    criterion: criterionOf(m.code),
    message: m.msg,
    target: m.target,
  }));
}