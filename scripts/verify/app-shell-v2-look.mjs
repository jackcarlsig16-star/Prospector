// app-shell-v2 - a quick look (READ-ONLY, 0 writes, 0 Claude, 0 Apollo): a few page loads of the local build as the
// platform owner on the sales workspace, PNGs into .screenshots/app-shell-v2/look/. Declared: <= 10 loads, est. 60 s,
// cap 150 s. Usage: node scripts/verify/app-shell-v2-look.mjs [1440|390]
import fs from 'fs';
import path from 'path';
import { readOnlyBrowser } from './lib/readOnlyBrowser.mjs';
const h = await readOnlyBrowser({ port: 3995, capMs: 230000 });
const OUT = path.join(h.ROOT, '.screenshots', 'app-shell-v2', 'look');
fs.mkdirSync(OUT, { recursive: true });
const B = h.workspace.id;
const widths = process.argv[2] ? [Number(process.argv[2])] : [1440, 390];
const step = async (name, f) => { const t = Date.now(); try { await f(); console.log(`ok   ${name} ${Date.now() - t} ms`); } catch (e) { console.log(`FAIL ${name}: ${e.message.split('\n')[0]}`); } };
try {
  for (const width of widths) {
    const ctx = await h.context(width);
    const page = await ctx.newPage(); page.setDefaultTimeout(25000);
    const errs = [];
    page.on('pageerror', e => errs.push(e.message.split('\n')[0]));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 200)); });
    const shot = async name => { await page.waitForTimeout(900); await page.screenshot({ path: path.join(OUT, `${name}-${width}.png`), timeout: 8000 }); };
    await step('today', async () => { await page.goto(`${h.BASE}/?business=${B}&tab=actions`); await page.waitForSelector('[data-shell]'); await page.waitForSelector('[data-shell-search], [data-shell-centre]'); await page.waitForTimeout(5000); await shot('today'); });
    if (width === 1440) {
      await step('focus', async () => { await page.getByRole('combobox', { name: 'Search or ask Scout' }).click(); });
      await step('type', async () => { await page.keyboard.type('met', { delay: 60 }); });
      await step('wait rows', async () => { await page.waitForSelector('[data-shell-panel] [role=group] [role=option]'); await shot('search-met'); });
      console.log('rows:', await page.evaluate(() => [...document.querySelectorAll('[data-shell-panel] [role=option]')].map(n => n.innerText.replace(/\s+/g, ' ').slice(0, 50))).catch(e => e.message));
      await step('question', async () => { await page.keyboard.press('Meta+A'); await page.keyboard.type('who owns metlife', { delay: 20 }); await page.waitForTimeout(4000); await shot('search-question'); });
      await step('nomatch', async () => { await page.keyboard.press('Meta+A'); await page.keyboard.type('zzyx'); await page.waitForSelector('[data-no-match]'); await shot('search-nomatch'); });
      await step('esc', async () => { await page.keyboard.press('Escape'); });
      await step('account', async () => { await page.getByRole('button', { name: /^Account menu/ }).click(); await shot('account'); await page.keyboard.press('Escape'); });
      await step('connections', async () => { await page.locator('[data-nav-item=settings]').click(); await page.locator('[data-settings-item=connections]').click(); await page.waitForSelector('[data-connections=feeds]'); await shot('connections'); });
      await step('scout', async () => { await page.locator('[data-nav-item=scout]').click(); await page.waitForSelector('[data-scout-page]'); await shot('scout'); });
      await step('marketing', async () => { await page.locator('[data-nav-item=marketing]').click(); await page.waitForSelector('[data-shell-soon]'); await shot('marketing'); });
      await step('rail', async () => { await page.getByRole('button', { name: 'Collapse menu' }).click(); await shot('rail'); });
    } else {
      await step('more', async () => { await page.locator('[data-shell-morebtn]').click(); await shot('more'); await page.keyboard.press('Escape'); });
      await step('fullsearch', async () => { await page.locator('[data-shell-centre]').click(); await page.keyboard.type('met', { delay: 60 }); await page.waitForSelector('[data-shell-panel] [role=group] [role=option]'); await shot('fullsearch'); });
    }
    console.log(width, 'overflow px:', await page.evaluate(() => [document.documentElement.scrollWidth - window.innerWidth, (() => { const m = document.querySelector('.sh-main'); return m ? m.scrollWidth - m.clientWidth : null; })()]).catch(e => e.message), 'errors:', [...new Set(errs)].slice(0, 6));
    await ctx.close();
  }
  console.log('writes aborted in the browser:', [...new Set(h.blocked)]);
} finally { await h.close(); }
process.exit(0);
