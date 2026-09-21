import type { Page } from 'playwright';

export type Pattern = 'routing' | 'modal' | 'dynamic';
export type Verdict = 'violation' | 'ok' | 'not_applicable' | 'error';

export interface Scenario {
    id: string;
    pattern: Pattern;
    description: string;
    startUrl: string;
    selector?: string;
    itemSelector?: string;
    loadMoreSelector?: string;
}

export interface AppTarger {
    id: string;
    name: string;
    repo?: string;
    scenatios: Scenario[];
}

export interface ScenarioOutcome {
    verdict: Verdict;
    violationTypes?: string[];
    details?: unknown;
}

export interface ScenarioResult extends ScenarioOutcome {
    app: string;
    pattern: Pattern;
    scenarioId: string;
    stability: number;
    runs: number;
    durationMs: number;
}

export interface Hooks {
    afterAction?: (page: Page) => Promise<void>;
}