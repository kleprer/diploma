import { chromium } from 'playwright';
import { runHtmlcs } from './htmlcs';
import * as fs from 'node:fs';
import * as path from 'node:path';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ bypassCSP: true });
  const page = await context.newPage();

  await page.setContent(
    '<!doctype html><html lang="en"><head><title>t</title></head><body><img src="x.png"><a href="#">click</a></body></html>'
  );

  const findings = await runHtmlcs(page);
  const byType = { error: 0, warning: 0, notice: 0 };
  for (const f of findings) byType[f.type]++;
  console.log('findings:', findings.length, byType);
  for (const f of findings.filter((x) => x.type === 'error').slice(0, 5)) {
    console.log(`  [${f.criterion ?? '?'}] ${f.target}  ${f.code}`);
  }

  const ok = findings.some((f) => f.type === 'error' && f.criterion === '1.1.1');
  console.log(ok ? 'SMOKE OK: found missing alt (1.1.1)' : 'SMOKE FAIL: expected an error for 1.1.1');
  await browser.close();
  process.exitCode = ok ? 0 : 1;


  const reportDir = path.join(process.cwd(), 'reports');
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir);
  }

  const reportPath = path.join(reportDir, `htmlcs-${new Date().toISOString().replace(/:/g, '-')}.json`);
  const reportData = {
    pageUrl: page.url(), // URL или 'about:blank' для setContent
    timestamp: new Date().toISOString(),
    summary: { error: byType.error, warning: byType.warning, notice: byType.notice },
    findings: findings,
  };

  fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
  console.log(`Report saved to ${reportPath}`);
}

main();