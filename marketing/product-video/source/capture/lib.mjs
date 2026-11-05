import { chromium } from 'playwright';
export async function open({ dsf = 1, section = null, lang = 'en' } = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: dsf, isMobile: true, hasTouch: true, timezoneId: 'Asia/Kolkata', locale: 'en-IN' });
  await ctx.addInitScript(() => {
    const fix = (root) => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n; while ((n = w.nextNode())) if (n.nodeValue.includes('Akshay Traders')) n.nodeValue = n.nodeValue.replaceAll('Akshay Traders', 'Aapki Dukaan');
    };
    new MutationObserver(() => document.body && fix(document.body)).observe(document, { subtree: true, childList: true, characterData: true });
    document.title = 'Stock';
    try { localStorage.setItem('shop_printer', JSON.stringify({ method: 'none', deviceId: '', deviceName: '', cutter: false, qrStyle: 'picture', hindi: false, billFont: 'printer', showUpiQr: true, billName: 'Aapki Dukaan', billSubtitle: 'Wholesale & Retail', version: 9 })); } catch {}
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(process.env.BASE || 'http://127.0.0.1:3000/');
  await page.waitForTimeout(1200);
  return { browser, ctx, page };
}
export async function login(page, user = 'rajesh') {
  const inputs = page.locator('input');
  await inputs.nth(0).fill(user);
  await inputs.nth(1).fill('demo123');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
}
export async function go(page, sec) {
  await page.evaluate((s) => localStorage.setItem('ims_active_section', s), sec);
  await page.reload();
  await page.waitForTimeout(1800);
}
