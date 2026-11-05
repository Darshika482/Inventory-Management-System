import { chromium } from 'playwright';
const times = process.argv.slice(2).map(Number);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
await page.goto('file://' + process.cwd() + '/index.html');
await page.evaluate(() => document.fonts.ready);
for (const t of times) {
  const r = await page.evaluate((t) => window.renderAt(t), t);
  await page.waitForTimeout(50);
  await page.screenshot({ path: `check/t_${t.toFixed(2)}.jpg`, type: 'jpeg', quality: 85 });
  console.log(t, JSON.stringify(r));
}
await browser.close();
