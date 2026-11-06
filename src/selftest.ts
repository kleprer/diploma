import { chromium } from 'playwright';
import { checkRoutingScenario } from './detectors/routingLoss';
import { checkModalScenario } from './detectors/modalRestore';
import { checkDynamicScenario } from './detectors/dynamicInsert';
import type { Page } from 'playwright';
import type { ScenarioOutcome } from './core/types';

// ---------- Эталонные страницы ----------
const routingPage = (good: boolean) => `<!doctype html><body>
<div id="app"><a id="go" href="/next">Go</a></div>
<script>
document.getElementById('go').addEventListener('click', function (e) {
  e.preventDefault();
  history.pushState({}, '', '/next');
  // Ссылка находится внутри #app и удаляется вместе с ним → без ручного focus() фокус уйдёт на body
  document.getElementById('app').innerHTML = '<h1 id="h">Next page</h1><p>Content</p>';
  ${good ? "var h = document.getElementById('h'); h.tabIndex = -1; h.focus();" : ''}
});
</script></body>`;

const modalPage = (good: boolean) => `<!doctype html><body>
<button id="open">Open</button>
<div id="dlg" role="dialog" aria-modal="true" hidden>
  <button id="ok">OK</button><button id="cancel">Cancel</button>
</div>
<button id="after">After</button>
<script>
var open = document.getElementById('open'), dlg = document.getElementById('dlg');
open.addEventListener('click', function () {
  dlg.hidden = false;
  ${good ? "document.getElementById('ok').focus();" : ''}
});
document.addEventListener('keydown', function (e) {
  if (dlg.hidden) return;
  if (e.key === 'Escape') {
    dlg.hidden = true;
    ${good ? 'open.focus();' : 'document.activeElement.blur();'}
  }
  ${
    good
      ? `if (e.key === 'Tab') {
    var f = Array.prototype.slice.call(dlg.querySelectorAll('button'));
    var i = f.indexOf(document.activeElement);
    e.preventDefault();
    f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus();
  }`
      : ''
  }
});
</script></body>`;

const dynamicPage = (good: boolean) => `<!doctype html><body>
<div id="wrap"><ul id="list"></ul><button id="more">Load more</button></div>
<script>
var n = 0;
function add(k) {
  for (var i = 0; i < k; i++) {
    n++;
    var li = document.createElement('li'); li.className = 'item';
    li.innerHTML = '<a href="#i' + n + '">Item ' + n + '</a>';
    document.getElementById('list').appendChild(li);
  }
}
add(5);
document.getElementById('more').addEventListener('click', function () {
  add(5);
  ${
    good
      ? ''
      : "var w = document.getElementById('wrap'); w.innerHTML = w.innerHTML; // «перерисовка» всего блока: кнопка пересоздаётся, фокус теряется"
  }
});
</script></body>`;

const pages: Record<string, string> = {
  '/routing-good': routingPage(true),
  '/routing-bad': routingPage(false),
  '/modal-good': modalPage(true),
  '/modal-bad': modalPage(false),
  '/dynamic-good': dynamicPage(true),
  '/dynamic-bad': dynamicPage(false),
  '/mpa-1': `<!doctype html><title>1</title><body><a id="go" href="/mpa-2">Go</a></body>`,
  '/mpa-2': `<!doctype html><title>2</title><body><h1>Page 2</h1></body>`,
};

// ---------- Ожидаемые вердикты ----------
const B = 'http://fixture.test';
const cases: {
  name: string;
  run: (p: Page) => Promise<ScenarioOutcome>;
  expect: 'ok' | 'violation' | 'not_applicable';
}[] = [
  { name: 'routing-good', expect: 'ok', run: (p) => checkRoutingScenario(p, `${B}/routing-good`, '#go') },
  { name: 'routing-bad', expect: 'violation', run: (p) => checkRoutingScenario(p, `${B}/routing-bad`, '#go') },
  { name: 'modal-good', expect: 'ok', run: (p) => checkModalScenario(p, `${B}/modal-good`, '#open') },
  { name: 'modal-bad', expect: 'violation', run: (p) => checkModalScenario(p, `${B}/modal-bad`, '#open') },
  { name: 'dynamic-good', expect: 'ok', run: (p) => checkDynamicScenario(p, `${B}/dynamic-good`, '.item', '#more') },
  { name: 'dynamic-bad', expect: 'violation', run: (p) => checkDynamicScenario(p, `${B}/dynamic-bad`, '.item', '#more') },
  { name: 'routing-mpa', expect: 'not_applicable', run: (p) => checkRoutingScenario(p, `${B}/mpa-1`, '#go') },
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  let passed = 0;

  for (const c of cases) {
    const context = await browser.newContext();
    await context.route('http://fixture.test/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      const html = pages[path];
      return html
        ? route.fulfill({ contentType: 'text/html', body: html })
        : route.fulfill({ status: 404, body: 'not found' });
    });
    const page = await context.newPage();
    const out = await c.run(page);
    const ok = out.verdict === c.expect;
    if (ok) passed++;
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${c.name}: ожидали ${c.expect}, получили ${out.verdict}`,
      out.violationTypes ?? '',
      ok && out.verdict !== 'not_applicable' ? '' : out.details ?? ''
    );
    await context.close();
  }

  console.log(`\n${passed}/${cases.length} PASS`);
  await browser.close();
  process.exit(passed === cases.length ? 0 : 1);
})();