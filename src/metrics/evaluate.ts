import fs from 'fs';
import { parse } from 'csv-parse/sync';

interface GtRow {
  app: string;
  pattern: string;
  scenario_id: string;
  is_violation: string;
  violation_type?: string;
  notes?: string;
  set?: string; // 'real' (реальные приложения) | 'fixture' (собственные стенды)
  annotator?: string;
  annotated_before_detector?: string; // 'yes' | 'no'
}
type Pred = 'pos' | 'neg' | 'excluded';

const key = (app: string, pattern: string, id: string) => `${app}|${pattern}|${id}`;

// ---------- Ground truth ----------
const gt: GtRow[] = parse(fs.readFileSync('data/ground-truth.csv', 'utf8'), {
  columns: true,
  skip_empty_lines: true,
  trim: true,
});

// ---------- Предсказания каждого инструмента ----------
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

// ---------- Статистика ----------
interface Counts { tp: number; fp: number; fn: number; tn: number; excluded: number; }
const empty = (): Counts => ({ tp: 0, fp: 0, fn: 0, tn: 0, excluded: 0 });

/** Доверительный интервал Уилсона (95%) для доли k/n. */
function wilson(k: number, n: number, z = 1.96): [number, number] | null {
  if (n === 0) return null;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

const f2 = (x: number) => x.toFixed(2);
/** Доля с интервалом: '0.50 [0.21–0.79]' или 'n/a', если знаменатель 0. */
function ratio(k: number, n: number) {
  const ci = wilson(k, n);
  return {
    value: n === 0 ? null : k / n,
    lo: ci ? ci[0] : null,
    hi: ci ? ci[1] : null,
    text: n === 0 ? 'n/a' : `${f2(k / n)} [${f2(ci![0])}–${f2(ci![1])}]`,
  };
}

function metrics(c: Counts) {
  const precision = ratio(c.tp, c.tp + c.fp);
  const recall = ratio(c.tp, c.tp + c.fn);
  const f1 =
    precision.value !== null && recall.value !== null && precision.value + recall.value > 0
      ? (2 * precision.value * recall.value) / (precision.value + recall.value)
      : null;
  return { precision, recall, f1 };
}

// ---------- Подсчёт ----------
const patterns = ['routing', 'modal', 'dynamic', 'ALL'];
const table: Record<string, Counts> = {}; // ключ: set|tool|pattern
const missing: string[] = [];
const noSet: string[] = [];
const errors: string[] = ['set,tool,app,pattern,scenario_id,kind,gt_type,notes'];
const seenSets = new Set<string>();
let annotatedAfter = 0;
let totalLabeled = 0;
const annotators = new Set<string>();

for (const row of gt) {
  if (row.is_violation !== 'yes' && row.is_violation !== 'no') continue; // n/a пропускаем
  const truth = row.is_violation === 'yes';
  const k = key(row.app, row.pattern, row.scenario_id);
  const set = row.set && row.set !== '' ? row.set : 'unknown';
  if (set === 'unknown') noSet.push(k);
  seenSets.add(set);
  totalLabeled++;
  if (row.annotated_before_detector === 'no') annotatedAfter++;
  if (row.annotator) annotators.add(row.annotator);

  for (const [tool, preds] of Object.entries(tools)) {
    const pred = preds.get(k);
    if (pred === undefined) {
      missing.push(`${tool}: нет результата для ${k}`);
      continue;
    }
    for (const pat of [row.pattern, 'ALL']) {
      const bucket = (table[`${set}|${tool}|${pat}`] ??= empty());
      if (pred === 'excluded') { bucket.excluded++; continue; }
      if (truth && pred === 'pos') bucket.tp++;
      else if (!truth && pred === 'pos') bucket.fp++;
      else if (truth && pred === 'neg') bucket.fn++;
      else bucket.tn++;
    }
    if (pred !== 'excluded' && ((truth && pred === 'neg') || (!truth && pred === 'pos'))) {
      errors.push(
        [set, tool, row.app, row.pattern, row.scenario_id, truth ? 'FN' : 'FP', row.violation_type ?? '', `"${row.notes ?? ''}"`].join(',')
      );
    }
  }
}

// ---------- Вывод ----------
const orderedSets = [...seenSets].sort((a, b) => (a === 'real' ? -1 : b === 'real' ? 1 : a.localeCompare(b)));
const jsonOut: Record<string, unknown>[] = [];

for (const set of orderedSets) {
  const label =
    set === 'real' ? 'РЕАЛЬНЫЕ ПРИЛОЖЕНИЯ (основной результат)'
    : set === 'fixture' ? 'СОБСТВЕННЫЕ СТЕНДЫ (проверка инструмента, не основной результат)'
    : `НАБОР "${set}"`;
  console.log(`\n=== ${label} ===`);

  const rows: Record<string, unknown>[] = [];
  for (const tool of Object.keys(tools)) {
    for (const pat of patterns) {
      const c = table[`${set}|${tool}|${pat}`];
      if (!c) continue;
      const m = metrics(c);
      rows.push({
        tool, pattern: pat,
        TP: c.tp, FP: c.fp, FN: c.fn, TN: c.tn, excl: c.excluded,
        precision: m.precision.text, recall: m.recall.text, F1: m.f1 === null ? 'n/a' : f2(m.f1),
      });
      jsonOut.push({
        set, tool, pattern: pat, TP: c.tp, FP: c.fp, FN: c.fn, TN: c.tn, excluded: c.excluded,
        precision: m.precision.value, precision_ci: [m.precision.lo, m.precision.hi],
        recall: m.recall.value, recall_ci: [m.recall.lo, m.recall.hi], f1: m.f1,
      });
    }
  }
  console.table(rows);

  const all = table[`${set}|detector|ALL`];
  if (all) {
    const positives = all.tp + all.fn;
    const negatives = all.tn + all.fp;
    console.log(`Размер набора: сценариев с нарушением = ${positives}, без нарушения = ${negatives}.`);
    if (positives < 35 || negatives < 35) {
      console.log(
        '⚠ Для интервала ±0.10 при ожидаемой доле ≈0.9 нужно около 35 сценариев каждого класса. ' +
        'Пока меньше: цифры предварительные, смотрите на интервалы в скобках.'
      );
    }
  }
}

console.log('\nФормат ячейки: значение [95% интервал Уилсона]. n/a = знаменатель 0 (считать не из чего), это не 0%.');
console.log(
  `Разметка: сценариев ${totalLabeled}, разметчиков: ${annotators.size || 'не указано'}, ` +
  `размечено ПОСЛЕ просмотра результата детектора: ${annotatedAfter} (укажите это в угрозах валидности).`
);
if (noSet.length) console.warn(`\nВНИМАНИЕ: у ${noSet.length} строк нет значения set (real/fixture): ${noSet.join(', ')}`);
if (missing.length) console.warn('\nВНИМАНИЕ, не найдено соответствий:\n' + missing.join('\n'));

fs.mkdirSync('data/results', { recursive: true });
fs.writeFileSync('data/results/metrics.json', JSON.stringify(jsonOut, null, 2));
fs.writeFileSync('data/results/errors.csv', errors.join('\n'));
console.log('\nСохранено: data/results/metrics.json и errors.csv');