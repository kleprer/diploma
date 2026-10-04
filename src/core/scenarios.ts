import type { Page } from 'playwright';
import { checkRoutingScenario } from '../detectors/routingLoss';
import { checkModalScenario } from '../detectors/modalRestore';
import { checkDynamicScenario } from '../detectors/dynamicInsert';
import type { Hooks, Scenario, ScenarioOutcome } from './types';

export async function runScenario(
  page: Page,
  s: Scenario,
  hooks?: Hooks
): Promise<ScenarioOutcome> {
  let result: ScenarioOutcome;
  switch (s.pattern) {
    case 'routing':
      result = await checkRoutingScenario(page, s.startUrl, s.selector!, hooks);
      break;
    case 'modal':
      result = await checkModalScenario(page, s.startUrl, s.selector!, hooks);
      break;
    case 'dynamic':
      result = await checkDynamicScenario(page, s.startUrl, s.itemSelector!, s.loadMoreSelector, hooks);
      break;
  }

  if (result.verdict === 'error') {
    try {
      const fs = await import('fs');
      fs.mkdirSync('data/debug', { recursive: true });
      await page.screenshot({ path: `data/debug/${s.id}.png` });
    } catch {
    }
  }

  return result;
}