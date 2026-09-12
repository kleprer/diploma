import { launchPage } from './core/browser';
import { getFocusSnapshot } from './core/focusState';

(async () => {
  const { browser, page } = await launchPage('https://google.com');
  await page.keyboard.press('Tab');
  const snap = await getFocusSnapshot(page);
  console.log(snap);
  await browser.close();
})();