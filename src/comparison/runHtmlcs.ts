import fs from 'fs';
import path from 'path';
import { chromium, Page } from 'playwright';
import { runScenario } from '../core/scenarios';
import type { AppTarget } from '../core/types';
import { runHtmlcs, ToolFinding } from '../tools/htmlcs';

// Мы будем отслеживать только ошибки и предупреждения, 
// так как notice — это в основном ручные проверки, их будет слишком много.
const TRACK_TYPES = new Set(['error', 'warning']);

async function htmlcsKeys(page: Page): Promise<Set<string>> {
  // Запускаем ваш инструмент
  const findings = await runHtmlcs(page);
  const keys = new Set<string>();
  
  for (const f of findings) {
    if (TRACK_TYPES.has(f.type)) {
      // Формируем уникальный ключ, чтобы понимать, что это за проблема
      keys.add(`${f.type}|${f.code}|${f.target}`);
    }
  }
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
        app.storageState ? { storageState: app.storageState } : { bypassCSP: true } // bypassCSP нужен для HTMLCS!
      );
      await context.addInitScript("globalThis.__name = function(fn) { return fn; };");
      const page = await context.newPage();
      
      try {
        await page.goto(s.startUrl, { waitUntil: 'networkidle', timeout: 30000 });

        // 1. Снимаем базовый срез (до действий)
        const baseline = await htmlcsKeys(page);

        let after: Set<string> | null = null;
        
        // 2. Выполняем сценарий и снимаем срез после
        await runScenario(page, s, {
          afterAction: async (p) => {
            after = await htmlcsKeys(p);
          },
        });

        // 3. Вычисляем "дельту" — только новые проблемы
        const fresh = after ? [...(after as Set<string>)].filter((k) => !baseline.has(k)) : [];
        
        // Извлекаем коды правил (например, WCAG2AA.Principle1...)
        const freshRules = [...new Set(fresh.map((k) => k.split('|')[1]))];

        rows.push({
          app: app.id,
          pattern: s.pattern,
          scenarioId: s.id,
          hookCalled: after !== null,
          flaggedAll: freshRules.length > 0,
          newRules: freshRules,
        });
        
        console.log(`${app.id}/${s.id}: htmlcs новые правила →`, freshRules.length ? freshRules : '—');
        
      } catch (e) {
        rows.push({ app: app.id, pattern: s.pattern, scenarioId: s.id, error: String(e) });
        console.log(`${app.id}/${s.id}: error`, String(e).slice(0, 150));
      } finally {
        await context.close();
      }
    }
  }

  // Сохраняем в отдельный файл, чтобы не ломать axe.json
  const resultsPath = path.join('data/results', 'htmlcs.json');
  let previous: any[] = [];
  if (fs.existsSync(resultsPath)) previous = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  
  const key = (r: any) => `${r.app}|${r.scenarioId}`;
  const newKeys = new Set(rows.map(key));
  const merged = [...previous.filter((r) => !newKeys.has(key(r))), ...rows];

  fs.mkdirSync('data/results', { recursive: true });
  fs.writeFileSync(resultsPath, JSON.stringify(merged, null, 2));
  await browser.close();
})();