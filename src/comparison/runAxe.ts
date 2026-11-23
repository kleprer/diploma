import fs from 'fs';
import path from 'path';
import { chromium, Page } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { runScenario } from '../core/scenarios';
import type { AppTarget } from '../core/types';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const FOCUS_RULES = new Set([
  'tabindex',
  'focus-order-semantics',
  'aria-hidden-focus',
  'scrollable-region-focusable',
  'nested-interactive',
]);

async function axeKeys(page: Page): Promise<Set<string>> {
  const r = await new AxeBuilder({ page })
    .withTags(TAGS)
    .options({ rules: { 'focus-order-semantics': { enabled: true } } })
    .analyze();
  const keys = new Set<string>();
  for (const v of r.violations) for (const n of v.nodes) keys.add(`${v.id}|${n.target.join(' ')}`);
  return keys;
}

const appFilter = process.argv.includes('--app')
  ? process.argv[process.argv.indexOf('--app') + 1]
  : null;

const targets: AppTarget[] = JSON.parse(fs.readFileSync('targets.json', 'utf8'));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const rows: any[] = [];

  for (const app of targets) {
    if (appFilter && app.id !== appFilter) continue;
    for (const s of app.scenarios) {
      const context = await browser.newContext(
        app.storageState ? { storageState: app.storageState } : {}
      );
      await context.addInitScript("globalThis.__name = function(fn) { return fn; };");
      const page = await context.newPage();
      try {
        await page.goto(s.startUrl, { waitUntil: 'networkidle', timeout: 30000 });

        const baseline = await axeKeys(page);

        let after: Set<string> | null = null;
        await runScenario(page, s, {
          afterAction: async (p) => {
            after = await axeKeys(p);
          },
        });

        const fresh = after ? [...(after as Set<string>)].filter((k) => !baseline.has(k)) : [];
        const freshRules = [...new Set(fresh.map((k) => k.split('|')[0]))];

        rows.push({
          app: app.id,
          pattern: s.pattern,
          scenarioId: s.id,
          hookCalled: after !== null,
          flaggedAll: freshRules.length > 0,
          flaggedFocus: freshRules.some((r) => FOCUS_RULES.has(r)),
          newRules: freshRules,
        });
        console.log(`${app.id}/${s.id}: axe новые правила →`, freshRules.length ? freshRules : '—');
      } catch (e) {
        rows.push({ app: app.id, pattern: s.pattern, scenarioId: s.id, error: String(e) });
        console.log(`${app.id}/${s.id}: error`, String(e).slice(0, 150));
      } finally {
        await context.close();
      }
    }
  }

  const resultsPath = path.join('data/results', 'axe.json');
  let previous: any[] = [];
  if (fs.existsSync(resultsPath)) previous = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  const key = (r: any) => `${r.app}|${r.scenarioId}`;
  const newKeys = new Set(rows.map(key));
  const merged = [...previous.filter((r) => !newKeys.has(key(r))), ...rows];

  fs.mkdirSync('data/results', { recursive: true });
  fs.writeFileSync(resultsPath, JSON.stringify(merged, null, 2));
  await browser.close();
})();