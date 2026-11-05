// Final screen captures for the promo (dsf 4 -> 1560 x 3376 per phone screen).
import { open, login, go } from './lib.mjs';
import fs from 'node:fs';

const DSF = Number(process.env.DSF || 4);
const OUT = process.env.OUT || '../screens';
const only = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const meta = fs.existsSync(`${OUT}/meta.json`) ? JSON.parse(fs.readFileSync(`${OUT}/meta.json`)) : {};

async function session(user = 'rajesh') {
  const s = await open({ dsf: DSF });
  await login(s.page, user);
  return s;
}
const wait = (p, ms = 700) => p.waitForTimeout(ms);
async function shot(page, name, { tall = 0 } = {}) {
  if (tall) {
    await page.setViewportSize({ width: 390, height: tall });
    await wait(page, 900);
  }
  await page.evaluate(() => document.querySelectorAll('[role=status], .toast').forEach(() => {}));
  await page.screenshot({ path: `${OUT}/${name}.png` });
  // remember where key elements are, in CSS px, for zoom targets
  meta[name] = { tall: tall || 844 };
  if (tall) { await page.setViewportSize({ width: 390, height: 844 }); await wait(page, 600); }
  console.log('shot', name);
}
async function box(page, name, key, locator) {
  const b = await locator.boundingBox().catch(() => null);
  if (b) { meta[name] = meta[name] || {}; meta[name][key] = b; }
}
function tapper(page) {
  return async (text, nth = 0) => {
    const d = page.getByRole('dialog');
    const scope = (await d.count()) && (await d.last().isVisible()) ? d.last() : page;
    await scope.getByText(text, { exact: false }).filter({ visible: true }).nth(nth).click({ timeout: 5000 });
    await wait(page);
  };
}
const dismissToasts = async (page) => {
  for (const b of await page.getByRole('button', { name: /dismiss|close notification/i }).all()) await b.click().catch(() => {});
  await page.evaluate(() => { for (const el of document.querySelectorAll('div')) { if (/Welcome back/.test(el.textContent || '') && el.children.length < 6 && el.getBoundingClientRect().height < 120) el.style.display = 'none'; } });
};

const jobs = {
  async stock() {
    const { browser, page } = await session();
    const tap = tapper(page);
    await go(page, 'overview'); await wait(page, 4500); await dismissToasts(page);
    await shot(page, 'st_overview');
    await shot(page, 'st_overview_tall', { tall: 1900 });
    await page.getByText('Low stock').first().click(); await wait(page, 900);
    await shot(page, 'st_low');
    await page.getByText('Low stock').first().click(); await wait(page, 600);
    // menu
    await page.getByRole('button', { name: 'Open navigation menu' }).click(); await wait(page, 900);
    await shot(page, 'st_menu');
    await page.getByRole('button', { name: 'Close menu' }).click(); await wait(page, 700);
    // add stock filled
    await page.getByRole('button', { name: 'Add stock' }).first().click(); await wait(page, 900);
    await shot(page, 'st_add_empty');
    await page.getByRole('dialog').last().getByText('Choose an item...').click(); await wait(page, 700);
    await shot(page, 'st_add_choose');
    await page.getByPlaceholder('Search items...').filter({ visible: true }).last().fill('Golden'); await wait(page, 600);
    await page.getByText('Lace Roll – Golden').filter({ visible: true }).last().click(); await wait(page, 600);
    await page.getByRole('dialog').last().locator('input').last().fill('120'); await wait(page, 400);
    await shot(page, 'st_add_filled');
    await page.getByRole('dialog').last().getByRole('button', { name: 'Add stock' }).click(); await wait(page, 1500);
    await shot(page, 'st_add_done');
    await wait(page, 4000);
    // take out stock
    await page.getByRole('button', { name: 'Take out stock' }).first().click(); await wait(page, 900);
    await page.getByRole('dialog').last().getByText('Choose an item...').click(); await wait(page, 700);
    await page.getByPlaceholder('Search items...').filter({ visible: true }).last().fill('Saree'); await wait(page, 600);
    await page.getByText('Saree Fall – Cotton').filter({ visible: true }).last().click(); await wait(page, 600);
    await page.getByRole('dialog').last().locator('input').last().fill('25'); await wait(page, 400);
    await shot(page, 'st_take_filled');
    await page.getByRole('dialog').last().getByRole('button', { name: 'Save record' }).click(); await wait(page, 1500);
    await shot(page, 'st_take_done');
    await browser.close();
  },
  async stockpages() {
    const { browser, page } = await session();
    const tap = tapper(page);
    await go(page, 'logs'); await wait(page, 3000); await dismissToasts(page);
    await shot(page, 'st_logs'); await shot(page, 'st_logs_tall', { tall: 1700 });
    await go(page, 'stock-added'); await wait(page, 1500);
    await shot(page, 'st_added');
    await tap('Last 7 days'); await wait(page, 800);
    await shot(page, 'st_added_7', { tall: 1500 });
    await go(page, 'bills'); await wait(page, 2500);
    await shot(page, 'st_bills'); await shot(page, 'st_bills_tall', { tall: 1800 });
    await page.getByRole('button', { name: 'Add bill' }).first().click(); await wait(page, 1000);
    await shot(page, 'st_addbill');
    await page.keyboard.press('Escape'); await wait(page, 800);
    await page.getByText('Shree Ganesh Textiles').first().click(); await wait(page, 1200);
    await shot(page, 'st_bill_open');
    await page.keyboard.press('Escape'); await wait(page, 800);
    await page.getByText('Pay many').first().click().catch(() => {}); await wait(page, 1200);
    await shot(page, 'st_paymany');
    await page.keyboard.press('Escape'); await wait(page, 800);
    await go(page, 'payments'); await wait(page, 2500);
    await shot(page, 'st_payments'); await shot(page, 'st_payments_tall', { tall: 1800 });
    await go(page, 'analysis'); await wait(page, 2500);
    await shot(page, 'st_analysis'); await shot(page, 'st_analysis_tall', { tall: 1900 });
    await go(page, 'transport'); await wait(page, 2500);
    await shot(page, 'st_transport'); await shot(page, 'st_transport_tall', { tall: 1800 });
    await go(page, 'workers'); await wait(page, 2500);
    await shot(page, 'st_workers'); await shot(page, 'st_workers_tall', { tall: 1800 });
    await page.getByText('Give goods').first().click(); await wait(page, 1200);
    await shot(page, 'st_givegoods');
    await browser.close();
  },
  async sale() {
    const { browser, page } = await session();
    const tap = tapper(page);
    const pad = async (s) => { for (const ch of s) { await page.getByRole('button', { name: ch, exact: true }).last().click(); await wait(page, 150); } };
    await go(page, 'shop-new-sale'); await wait(page, 3000); await dismissToasts(page);
    await shot(page, 'sl_new_empty');
    await page.getByRole('button', { name: 'Add items' }).click(); await wait(page, 1100);
    await shot(page, 'sl_picker');
    const search = page.getByRole('dialog').last().locator('input[type=search]');
    await search.fill('लेस'); await wait(page, 800);
    await shot(page, 'sl_picker_hi');
    await search.fill(''); await wait(page, 600);
    await tap('300 mt Thread'); await tap('Golden Lace'); await tap('Cotton Fall');
    await shot(page, 'sl_picker_picked');
    await tap('Done'); await wait(page, 800);
    await shot(page, 'sl_new_items');
    await page.getByRole('button', { name: 'Qty' }).first().click(); await wait(page, 800);
    await shot(page, 'sl_pad_open');
    await pad('12'); await wait(page, 300);
    await shot(page, 'sl_pad_12');
    await page.getByRole('button', { name: 'Done' }).last().click(); await wait(page, 700);
    await page.getByRole('button', { name: 'Qty' }).nth(1).click(); await wait(page, 600);
    await pad('5'); await page.getByRole('button', { name: 'Done' }).last().click(); await wait(page, 700);
    await page.getByText('Change').first().click(); await wait(page, 900);
    await shot(page, 'sl_party_choose');
    await tap('Laxmi Tailors'); await wait(page, 700);
    await shot(page, 'sl_new_party');
    // discount 5 %
    await page.locator('button', { hasText: /^%$/ }).first().click(); await wait(page, 400);
    await page.getByRole('button', { name: 'Discount' }).click(); await wait(page, 600);
    await pad('5'); await page.getByRole('button', { name: 'Done' }).last().click(); await wait(page, 700);
    await page.mouse.wheel(0, 330); await wait(page, 700);
    await shot(page, 'sl_new_discount');
    // part paid
    await page.getByRole('button', { name: 'Amount received' }).click(); await wait(page, 600);
    await page.getByRole('button', { name: 'Clear' }).last().click().catch(() => {}); await wait(page, 200);
    await pad('300'); await page.getByRole('button', { name: 'Done' }).last().click(); await wait(page, 700);
    await page.mouse.wheel(0, 600); await wait(page, 700);
    await shot(page, 'sl_new_payment');
    await page.getByText('Save only').click(); await wait(page, 2000);
    await shot(page, 'sl_saved');
    await page.getByRole('button', { name: 'Preview' }).click(); await wait(page, 1800);
    await shot(page, 'sl_preview');
    // scroll inside preview to show QR fully
    await page.mouse.move(195, 500); await page.mouse.wheel(0, 500); await wait(page, 800);
    await shot(page, 'sl_preview2');
    await page.keyboard.press('Escape'); await wait(page, 600);
    const c = page.getByRole('button', { name: 'Close' }); if (await c.count()) await c.last().click().catch(() => {});
    await wait(page, 700);
    await page.getByRole('button', { name: 'Share' }).click(); await wait(page, 2500);
    await shot(page, 'sl_share');
    await browser.close();
  },
  async salepages() {
    const { browser, page } = await session();
    const tap = tapper(page);
    await go(page, 'shop-sales'); await wait(page, 3000); await dismissToasts(page);
    await shot(page, 'sl_bills'); await shot(page, 'sl_bills_tall', { tall: 1900 });
    await tap('Udhaar'); await wait(page, 1200);
    await shot(page, 'sl_udhaar'); await shot(page, 'sl_udhaar_tall', { tall: 1700 });
    await go(page, 'shop-sales'); await wait(page, 2000);
    await page.getByRole('button', { name: 'Open bill' }).first().click(); await wait(page, 1300);
    await shot(page, 'sl_bill_open');
    await tap('Receive payment'); await wait(page, 1100);
    await shot(page, 'sl_receive');
    await page.keyboard.press('Escape'); await wait(page, 700);
    await go(page, 'shop-parties'); await wait(page, 2000);
    await shot(page, 'sl_parties'); await shot(page, 'sl_parties_tall', { tall: 1800 });
    await go(page, 'shop-items'); await wait(page, 2000);
    await shot(page, 'sl_items'); await shot(page, 'sl_items_tall', { tall: 1900 });
    await go(page, 'shop-settings'); await wait(page, 2000);
    await shot(page, 'sl_settings'); await shot(page, 'sl_settings_tall', { tall: 2400 });
    await go(page, 'shop-sales'); await wait(page, 2000);
    await page.getByRole('button', { name: 'हिंदी' }).first().click(); await wait(page, 1500);
    await shot(page, 'sl_hindi');
    await go(page, 'shop-new-sale'); await wait(page, 2000);
    await shot(page, 'sl_hindi_new');
    await browser.close();
  },
  async staff() {
    const s = await open({ dsf: DSF });
    const { browser, page } = s;
    await shot(page, 'sf_login');
    const inputs = page.locator('input');
    await inputs.nth(0).fill('ayush'); await inputs.nth(1).fill('demo123'); await wait(page, 300);
    await shot(page, 'sf_login_filled');
    await page.keyboard.press('Enter'); await wait(page, 3500); await dismissToasts(page);
    await shot(page, 'sf_home');
    await page.getByRole('button', { name: 'Open navigation menu' }).click(); await wait(page, 900);
    await shot(page, 'sf_menu');
    await browser.close();
  },
  async offline() {
    const { browser, ctx, page } = await session();
    const tap = tapper(page);
    await go(page, 'shop-new-sale'); await wait(page, 6000); await dismissToasts(page);
    await ctx.setOffline(true); await wait(page, 800);
    await page.getByRole('button', { name: 'Add items' }).click(); await wait(page, 1100);
    await tap('800 mt Thread'); await tap('Silk Dori'); await tap('Done'); await wait(page, 800);
    await page.getByText('Save only').click(); await wait(page, 9000);
    await shot(page, 'sl_offline_saved');
    await page.getByRole('button', { name: 'Open navigation menu' }).click(); await wait(page, 900);
    await shot(page, 'sl_offline_menu');
    await ctx.setOffline(false);
    await Promise.race([browser.close(), wait(page, 5000)]);
  },
};

for (const [name, fn] of Object.entries(jobs)) {
  if (only.length && !only.includes(name)) continue;
  try { await fn(); } catch (e) { console.log('JOB FAILED', name, e.message.split('\n')[0]); }
  fs.writeFileSync(`${OUT}/meta.json`, JSON.stringify(meta, null, 1));
}
