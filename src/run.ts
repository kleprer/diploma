import fs from 'fs';
import path from 'path';
import { chromium, Browser } from 'playwright';
import { runScenario } from './core/scenarios';
import type { AppTarget, Scenario, ScenarioOutcome, ScenarioResult, Verdict } from './core/types';

const REPEATS = 3;
const targets: AppTarget[] = JSON.parse(fs.readFileSync('targets.json', 'utf8'));

const appFilter = process.argv.includes('--app')
    ? process.argv[process.argv.indexOf('--app') + 1]
    : null;

async function runOnce(browser: Browser, app: AppTarget, s: Scenario): Promise<ScenarioOutcome> {
  const context = await browser.newContext(
    app.storageState ? { storageState: app.storageState } : {}
  );
  const page = await context.newPage();
  try {
    return await runScenario(page, s);
  } catch (e) {
    return { verdict: 'error', details: String(e) };
  } finally {
    await context.close();
  }
}

function outcomeKey(o: ScenarioOutcome): string {
  const types = (o.violationTypes ?? []).slice().sort().join(',');
  return `${o.verdict}|${types}`;
}

function majority(outcomes: ScenarioOutcome[]) {
  const counts = new Map<string, number>();
  for (const o of outcomes) counts.set(outcomeKey(o), (counts.get(outcomeKey(o)) ?? 0) + 1);
  const [topKey, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    outcome: outcomes.find((o) => outcomeKey(o) === topKey)!,
    stability: topCount / outcomes.length,
  };
}

(async () => {
    const browser = await chromium.launch({ headless: true });
    const results: ScenarioResult[] = [];

    for (const app of targets) {
        if (appFilter && app.id !== appFilter) continue;
        for (const s of app.scenarios) {
            const t0 = Date.now();
            const outcomes: ScenarioOutcome[] = [];
            for (let i = 0; i < REPEATS; i++) {
                const o = await runOnce(browser, app, s);
                console.log(`  запуск ${i + 1}: ${o.verdict}`, o.violationTypes ?? '', o.details ?? '');
                outcomes.push(o);
            }
            
            const { outcome, stability } = majority(outcomes);

            results.push({
                app: app.id,
                pattern: s.pattern,
                scenarioId: s.id,
                ...outcome,
                stability,
                runs: REPEATS,
                durationMs: Date.now() - t0,
            });
            console.log(
                `${app.id}/${s.id}: ${outcome.verdict}`,
                outcome.violationTypes ?? '',
                stability < 1 ? `(нестабильно: ${stability.toFixed(2)})` : ''
            );
        }
    }
    const resultsPath = path.join('data/results', 'detector.json');
    let previous: ScenarioResult[] = [];
    if (fs.existsSync(resultsPath)) {
      previous = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
    }
    // убираем старые записи по тем же app+scenarioId, что мы сейчас перепрогнали
    const key = (r: ScenarioResult) => `${r.app}|${r.scenarioId}`;
    const newKeys = new Set(results.map(key));
    const merged = [...previous.filter((r) => !newKeys.has(key(r))), ...results];

    fs.mkdirSync('data/results', { recursive: true });
    fs.writeFileSync(resultsPath, JSON.stringify(merged, null, 2));
    await browser.close();
})();