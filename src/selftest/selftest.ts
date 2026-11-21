import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { checkRoutingScenario } from '../detectors/routingLoss';
import { checkModalScenario } from '../detectors/modalRestore';
import { checkDynamicScenario } from '../detectors/dynamicInsert';
import type { ScenarioOutcome } from '../core/types';

const doc = (body: string, script = '') =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>fixture</title></head><body>${body}${
    script ? `<script>${script}</script>` : ''
  }</body></html>`;

// ---------- роутинг ----------
const spa = (afterNav: string) =>
  doc(
    '<nav><a id="go" href="/about">About</a></nav><main id="view"><h1 id="h" tabindex="-1">Home</h1></main>',
    `document.getElementById('go').addEventListener('click',function(e){
      e.preventDefault();
      history.pushState({},'','/about');
      document.getElementById('view').innerHTML='<h1 id="h" tabindex="-1">About</h1>';
      ${afterNav}
    });`
  );

// SPA с объявлением через live-регион и сменой title.
// keepFocus=true  → фокус остаётся на триггере (нарушение), но объявление есть.
// keepFocus=false → фокус переносится в новый контент (ok).
const spaAnnounced = (keepFocus: boolean) =>
  doc(
    '<nav><a id="go" href="/about">About</a></nav>' +
      '<main id="view"><h1 id="h" tabindex="-1">Home</h1></main>' +
      '<div id="sr" aria-live="polite" style="position:absolute;left:-9999px"></div>',
    `document.getElementById('go').addEventListener('click',function(e){
      e.preventDefault();
      history.pushState({},'','/about');
      document.getElementById('view').innerHTML='<h1 id="h" tabindex="-1">About</h1>';
      document.getElementById('sr').textContent='Navigated to About';
      document.title='About';
      ${keepFocus ? '' : 'document.getElementById("h").focus();'}
    });`
  );

// Только смена title, без live-региона.
const spaTitleOnly = () =>
  doc(
    '<nav><a id="go" href="/about">About</a></nav><main id="view"><h1 id="h" tabindex="-1">Home</h1></main>',
    `document.getElementById('go').addEventListener('click',function(e){
      e.preventDefault();
      history.pushState({},'','/about');
      document.getElementById('view').innerHTML='<h1 id="h" tabindex="-1">About</h1>';
      document.title='About';
    });`
  );

// ---------- модальное окно ----------
function modalPage(o: { focusIn: boolean; trap: boolean; restore: boolean }) {
  const trap =
    "dlg.addEventListener('keydown',function(e){if(e.key!=='Tab')return;" +
    "var f=dlg.querySelectorAll('button'),first=f[0],last=f[f.length-1];" +
    'if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}' +
    'else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}});';
  const script = `
var open=document.getElementById('open'),dlg=null;
function closeDlg(){if(dlg){dlg.remove();dlg=null;}${o.restore ? 'open.focus();' : ''}}
open.addEventListener('click',function(){
  dlg=document.createElement('div');
  dlg.setAttribute('role','dialog');dlg.setAttribute('aria-modal','true');dlg.setAttribute('aria-label','Demo');
  dlg.innerHTML='<button id="a">First</button><button id="b">Second</button><button id="c">Close</button>';
  document.body.appendChild(dlg);
  dlg.querySelector('#c').addEventListener('click',closeDlg);
  ${o.focusIn ? "dlg.querySelector('#a').focus();" : ''}
  ${o.trap ? trap : ''}
});
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&dlg){closeDlg();}});`;
  return doc('<button id="open">Open dialog</button><p>Page content</p><a href="#x">Some link</a>', script);
}

// ---------- подгрузка списка ----------
const list = (removeButton: boolean) =>
  doc(
    '<ul id="list"><li><a href="#i1">Item 1</a></li><li><a href="#i2">Item 2</a></li></ul><button id="more">Load more</button>',
    `var n=2;
document.getElementById('more').addEventListener('click',function(e){
  var btn=e.currentTarget;
  setTimeout(function(){
    var ul=document.getElementById('list');
    for(var i=0;i<2;i++){n++;var li=document.createElement('li');li.innerHTML='<a href="#i'+n+'">Item '+n+'</a>';ul.appendChild(li);}
    ${removeButton ? 'btn.remove();' : ''}
  },50);
});`
  );

const items = (n: number) =>
  '<ul id="list">' + Array.from({ length: n }, (_, i) => `<li><a href="#i${i + 1}">Item ${i + 1}</a></li>`).join('') + '</ul>';

const PAGES: Record<string, string> = {
  '/routing/spa-ok.html': spa("document.getElementById('h').focus();"),
  '/routing/spa-reset-body.html': spa('document.activeElement.blur();'),
  '/routing/spa-stays.html': spa(''),
  '/routing/spa-announced-ok.html': spaAnnounced(false),
  '/routing/spa-announced-stays.html': spaAnnounced(true),
  '/routing/spa-title-only.html': spaTitleOnly(),
  '/routing/hash-route.html': doc(
    '<nav><a id="go" href="#/about">About</a></nav><main id="view"><h1>Home</h1></main>',
    "window.addEventListener('hashchange',function(){document.getElementById('view').innerHTML='<h1>About</h1>';});"
  ),
  '/routing/anchor.html': doc('<a id="go" href="#sec">Jump</a><div style="height:2000px"></div><h2 id="sec">Section</h2>'),
  '/routing/mpa-a.html': doc('<a id="go" href="/routing/mpa-b.html">Next page</a>'),
  '/routing/mpa-b.html': doc('<h1>Page B</h1>'),

  '/modal/ok.html': modalPage({ focusIn: true, trap: true, restore: true }),
  '/modal/no-focus-move.html': modalPage({ focusIn: false, trap: false, restore: true }),
  '/modal/no-restore.html': modalPage({ focusIn: true, trap: true, restore: false }),
  '/modal/mpa-link.html': doc('<a id="open" href="/modal/login.html">Log in</a>'),
  '/modal/login.html': doc('<h1>Login page</h1>'),

  '/dynamic/list-ok.html': list(false),
  '/dynamic/focus-lost.html': list(true),
  '/dynamic/mpa-1.html': doc(items(2) + '<a id="more" href="/dynamic/mpa-2.html">Load more</a>'),
  '/dynamic/mpa-2.html': doc(items(4) + '<a id="more" href="/dynamic/mpa-3.html">Load more</a>'),
};

interface Case {
  name: string;
  path: string;
  run: (page: Page, url: string) => Promise<ScenarioOutcome>;
  verdict: string;
  types?: string[]; // должны быть среди violationTypes
  details?: string; // для not_applicable
  // проверка метаданных из details (titleChanged / liveRegionUpdated)
  metadata?: { titleChanged?: boolean; liveRegionUpdated?: boolean };
}

const routing = (sel = '#go') => (p: Page, u: string) => checkRoutingScenario(p, u, sel);
const modal = (sel = '#open') => (p: Page, u: string) => checkModalScenario(p, u, sel);
const dynamic = (p: Page, u: string) => checkDynamicScenario(p, u, 'li', '#more');

const CASES: Case[] = [
  { name: 'routing/spa-ok', path: '/routing/spa-ok.html', run: routing(), verdict: 'ok' },
  { name: 'routing/spa-reset-body', path: '/routing/spa-reset-body.html', run: routing(), verdict: 'violation', types: ['focus_reset_to_body'] },
  { name: 'routing/spa-stays', path: '/routing/spa-stays.html', run: routing(), verdict: 'violation', types: ['focus_stayed_on_trigger'] },
  { name: 'routing/spa-announced-ok', path: '/routing/spa-announced-ok.html', run: routing(), verdict: 'ok', metadata: { titleChanged: true, liveRegionUpdated: true } },
  { name: 'routing/spa-announced-stays', path: '/routing/spa-announced-stays.html', run: routing(), verdict: 'violation', types: ['focus_stayed_on_trigger'], metadata: { titleChanged: true, liveRegionUpdated: true } },
  { name: 'routing/spa-title-only', path: '/routing/spa-title-only.html', run: routing(), verdict: 'violation', types: ['focus_stayed_on_trigger'], metadata: { titleChanged: true, liveRegionUpdated: false } },
  { name: 'routing/hash-route', path: '/routing/hash-route.html', run: routing(), verdict: 'violation', types: ['focus_stayed_on_trigger'] },
  { name: 'routing/anchor', path: '/routing/anchor.html', run: routing(), verdict: 'not_applicable', details: 'in_page_anchor' },
  { name: 'routing/mpa', path: '/routing/mpa-a.html', run: routing(), verdict: 'not_applicable', details: 'full_page_navigation' },

  { name: 'modal/ok', path: '/modal/ok.html', run: modal(), verdict: 'ok' },
  { name: 'modal/no-focus-move', path: '/modal/no-focus-move.html', run: modal(), verdict: 'violation', types: ['focus_not_moved_into_modal'] },
  { name: 'modal/no-restore', path: '/modal/no-restore.html', run: modal(), verdict: 'violation', types: ['focus_not_restored'] },
  { name: 'modal/mpa-link', path: '/modal/mpa-link.html', run: modal(), verdict: 'not_applicable', details: 'full_page_navigation' },

  { name: 'dynamic/list-ok', path: '/dynamic/list-ok.html', run: dynamic, verdict: 'ok' },
  { name: 'dynamic/focus-lost', path: '/dynamic/focus-lost.html', run: dynamic, verdict: 'violation', types: ['focus_lost_after_load'] },
  { name: 'dynamic/mpa-pagination', path: '/dynamic/mpa-1.html', run: dynamic, verdict: 'not_applicable', details: 'full_page_navigation' },
];

async function main() {
  const server = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0].split('#')[0];
    const html = PAGES[path];
    if (!html) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const browser = await chromium.launch({ headless: true });
  let passed = 0;

  for (const c of CASES) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript("globalThis.__name = function(fn) { return fn; };");
    let out: { verdict: string; violationTypes?: string[]; details?: any }; // details: any чтобы читать metadata
    try {
      out = (await c.run(page, base + c.path)) as typeof out;
    } catch (e) {
      out = { verdict: 'error', details: e instanceof Error ? e.message.split('\n')[0] : String(e) };
    }
    await context.close();

    const got = out.violationTypes ?? [];
    const okVerdict = out.verdict === c.verdict;
    const okTypes = !c.types || c.types.every((t) => got.includes(t));
    const okDetails = !c.details || out.details === c.details;
    
    // проверяем поля метаданных из details
    const okMetadata = !c.metadata || Object.entries(c.metadata).every(
      ([k, v]) => (out.details as any)?.[k] === v
    );
    
    const pass = okVerdict && okTypes && okDetails && okMetadata;
    if (pass) passed++;

    const shown =
      out.verdict === 'violation'
        ? `violation [${got.join(', ')}]`
        : out.verdict === 'not_applicable' || out.verdict === 'error'
          ? `${out.verdict} (${String(out.details)})`
          : out.verdict;
          
    const meta =
      out.details && typeof out.details === 'object'
        ? ` title=${(out.details as any).titleChanged} live=${(out.details as any).liveRegionUpdated}`
        : '';

    console.log(`${pass ? 'PASS' : 'FAIL'}  ${c.name.padEnd(26)} ${shown}${meta}`);
  }

  await browser.close();
  server.close();
  console.log(`\n${passed}/${CASES.length} passed`);
  process.exitCode = passed === CASES.length ? 0 : 1;
}

main();