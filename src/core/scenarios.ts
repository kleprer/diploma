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
  switch (s.pattern) {
    case 'routing':
      return checkRoutingScenario(page, s.startUrl, s.selector!, hooks);
    case 'modal':
      return checkModalScenario(page, s.startUrl, s.selector!, hooks);
    case 'dynamic':
      return checkDynamicScenario(page, s.startUrl, s.itemSelector!, s.loadMoreSelector, hooks);
  }
}