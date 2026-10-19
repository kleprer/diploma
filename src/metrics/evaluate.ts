import fs from 'fs';
import { parse } from 'csv-parse/sync';

interface GtRow {
  app: string;
  pattern: string;
  scenario_id: string;
  is_violation: string;
  violation_type?: string;
  notes?: string;
}
type Pred = 'pos' | 'neg' | 'excluded';

const key = (app: string, pattern: string, id: string) => `${app}|${pattern}|${id}`;

// ---------- ground truth ----------
const gt: GtRow[] = parse(fs.readFileSync('data/ground-truth.csv', 'utf8'), {
  columns: true,
  skip_empty_lines: true,
  trim: true,
});

// ---------- предсказания каждого инструмента ----------
const detector = JSON.parse(fs.readFileSync('data/results/detector.json', 'utf8'));
const axe = JSON.parse(fs.readFileSync('data/results/axe.json', 'utf8'));

const tools: Record<string, Map<string, Pred>> = {
  detector: new Map(),
  axe_all: new Map(),
  axe_focus: new Map(),
};
for (const r of detector) {
  const p: Pred = r.verdict === 'error' ? 'excluded' : r.verdict === 'violation' ? 'pos' : 'neg';
  tools.detector.set(key(r.app, r.pattern, r.scenarioId), p);
}
for (const r of axe) {
  const k = key(r.app, r.pattern, r.scenarioId);
  if (r.error) {
    tools.axe_all.set(k, 'excluded');
    tools.axe_focus.set(k, 'excluded');
  } else {
    tools.axe_all.set(k, r.flaggedAll ? 'pos' : 'neg');
    tools.axe_focus.set(k, r.flaggedFocus ? 'pos' : 'neg');
  }
}

// ---------- подсчёт ----------
interface Counts { tp: number; fp: number; fn: number; tn: number; excluded: number; }
const empty = (): Counts => ({ tp: 0, fp: 0, fn: 0, tn: 0, excluded: 0 });
const div = (a: number, b: number) => (b === 0 ? null : a / b);

function metrics(c: Counts) {
  const precision = div(c.tp, c.tp + c.fp);
  const recall = div(c.tp, c.tp + c.fn);
  const f1 =
    precision !== null && recall !== null && precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : null;
  const accuracy = div(c.tp + c.tn, c.tp + c.tn + c.fp + c.fn);
  return { precision, recall, f1, accuracy };
}

const patterns = ['routing', 'modal', 'dynamic', 'ALL'];
const table: Record<string, Counts> = {};
const missing: string[] = [];
const errors: string[] = ['tool,app,pattern,scenario_id,kind,gt_type,notes'];

for (const row of gt) {
  if (row.is_violation !== 'yes' && row.is_violation !== 'no') continue; // n/a пропускаем
  const truth = row.is_violation === 'yes';
  const k = key(row.app, row.pattern, row.scenario_id);

  for (const [tool, preds] of Object.entries(tools)) {
    const pred = preds.get(k);
    if (pred === undefined) {
      missing.push(`${tool}: нет результата для ${k}`);
      continue;
    }
    for (const pat of [row.pattern, 'ALL']) {
      const bucket = (table[`${tool}|${pat}`] ??= empty());
      if (pred === 'excluded') { bucket.excluded++; continue; }
      if (truth && pred === 'pos') bucket.tp++;
      else if (!truth && pred === 'pos') bucket.fp++;
      else if (truth && pred === 'neg') bucket.fn++;
      else bucket.tn++;
    }
    if (pred !== 'excluded' && ((truth && pred === 'neg') || (!truth && pred === 'pos'))) {
      errors.push(
        [tool, row.app, row.pattern, row.scenario_id, truth ? 'FN' : 'FP', row.violation_type ?? '', `"${row.notes ?? ''}"`].join(',')
      );
    }
  }
}

// ---------- вывод ----------
const fmt = (x: number | null) => (x === null ? 'n/a' : x.toFixed(2));
const out: Record<string, unknown>[] = [];
for (const tool of Object.keys(tools)) {
  for (const pat of patterns) {
    const c = table[`${tool}|${pat}`];
    if (!c) continue;
    const m = metrics(c);
    out.push({
      tool, pattern: pat,
      TP: c.tp, FP: c.fp, FN: c.fn, TN: c.tn, excluded: c.excluded,
      precision: fmt(m.precision), recall: fmt(m.recall), F1: fmt(m.f1), accuracy: fmt(m.accuracy),
    });
  }
}
console.table(out);
if (missing.length) console.warn('\nВНИМАНИЕ, не найдено соответствий:\n' + missing.join('\n'));

fs.mkdirSync('data/results', { recursive: true });
fs.writeFileSync('data/results/metrics.json', JSON.stringify(out, null, 2));
fs.writeFileSync('data/results/errors.csv', errors.join('\n'));
console.log('\nСохранено: data/results/metrics.json и errors.csv');