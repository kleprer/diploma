import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const TARGETS: Record<string, { loginUrl: string; user: string; pass: string }> = {
  'react-admin': {
    loginUrl: 'https://marmelab.com/react-admin-demo/#/login',
    user: 'demo',
    pass: 'demo',
  },
};

(async () => {
  const appId = process.argv[2];
  const cfg = TARGETS[appId];
  if (!cfg) {
    console.error('Неизвестный app id. Добавьте его в TARGETS.');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(cfg.loginUrl, { waitUntil: 'load' });

  await page.getByRole('textbox', { name: 'Username' }).fill(cfg.user);
  await page.getByRole('textbox', { name: 'Password' }).fill(cfg.pass);
  await page.getByRole('textbox', { name: 'Password' }).press('Enter');

  // Ждём, что логин прошёл: страница логина исчезла
  await page.waitForURL((url) => !url.toString().includes('/login'), { timeout: 10000 });

  fs.mkdirSync('data/auth', { recursive: true });
  const outPath = path.join('data/auth', `${appId}.json`);
  await page.context().storageState({ path: outPath });
  console.log(`Сохранено: ${outPath}`);

  await browser.close();
})();