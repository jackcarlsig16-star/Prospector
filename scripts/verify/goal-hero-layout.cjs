// FIX goal-hero-layout check - Goals hero cards on real HomeLover, READ ONLY (1 temp Member, deleted). Screenshots at 1440 / 1280 / 390, team + one person, dark + prefers-color-scheme light; measures pill-vs-ring overlap, title wrapping, and that each card part sits at the same height across the row. 0 writes besides the temp user, 0 AI / 0 Apollo. ~1.5 min, cap 4 min. Serves build/ - run npm run build first. Usage: node <this> <outdir> <prefix>
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const [OUT, PREFIX = 'hero'] = process.argv.slice(2); fs.mkdirSync(OUT, { recursive: true });
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const HL = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0].trim(), PORT = 3959, tag = 'ghl-' + Date.now();
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const WATCH = ['sales_metric_targets', 'sales_week_goals', 'sales_month_goals', 'business_members'];
const made = [];
let srv, browser, log = '', pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
const snap = async () => { const o = {}; for (const t of WATCH) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL)).count; return o; };
const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('ABORT (4 min cap)'); cleanup().then(() => process.exit(2)); }, 240000);
async function cleanup() {
  if (browser) await browser.close().catch(() => {});
  if (srv) srv.kill();
  for (const u of made) { await svc.from('business_members').delete().eq('user_id', u); await svc.from('auth_events').delete().eq('user_id', u); await svc.from('auth_events').delete().eq('actor_id', u); await svc.auth.admin.deleteUser(u); }
}
// Per card: rects of its parts, relative to the card top.
const measure = page => page.evaluate(() => [...document.querySelectorAll('section[data-hero-card]')].map(c => {
  const top = c.getBoundingClientRect().top;
  const r = sel => { const e = c.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top - top), left: b.left, right: b.right, bottom: b.bottom - top, h: b.height }; };
  return { name: c.getAttribute('aria-label'), title: r('[data-part="title"]'), pill: r('[data-part="pill"]'), ring: r('[data-part="ring"]'), number: r('[data-part="number"]'), goal: r('[data-part="goal"]'), spark: r('[data-part="spark"]'), delta: r('[data-part="delta"]'), footer: r('[data-part="footer"]'), titleLine: (() => { const e = c.querySelector('[data-part="title-text"]'); if (!e) return null; const lh = parseFloat(getComputedStyle(e).lineHeight) || 14; return Math.round(e.getBoundingClientRect().height / lh); })() };
}));
const overlap = (a, b) => a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
(async () => {
  const before = await snap();
  try {
    const email = `${tag}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
    const { data: u } = await svc.auth.admin.createUser({ email, password, email_confirm: true }); made.push(u.user.id);
    await svc.from('profiles').update({ display_name: 'Mara Test', welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
    await svc.from('business_members').insert({ business_id: HL, email, name: 'Mara Test', user_id: u.user.id, role: 'member' });
    const c = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data: s } = await c.auth.signInWithPassword({ email, password });
    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
    for (let i = 0; i < 50 && !log.includes(`port ${PORT}`); i++) await wait(200);
    browser = await chromium.launch();
    const hlName = (await svc.from('businesses').select('name').eq('id', HL).single()).data.name;
    const errs = [];
    for (const [w, h] of [[1440, 1000], [1280, 900], [390, 844]]) {
      for (const scheme of ['dark', 'light']) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme });
        const page = await ctx.newPage(); page.setDefaultTimeout(12000);
        page.on('console', m => { if (m.type() === 'error') errs.push(`${w}${scheme}: ${m.text().slice(0, 140)}`); }); page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 140)));
        await page.addInitScript(([k, v]) => { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, JSON.stringify(s.session)]);
        await page.goto(`http://localhost:${PORT}/`); await page.waitForTimeout(3000);
        const compact = w < 900;
        if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
        await page.getByLabel('Workspace').selectOption({ label: hlName }); await page.waitForTimeout(1500);
        if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
        await page.locator('#root').getByRole('button', { name: 'Goals & Sales', exact: true }).click();
        await page.getByRole('region', { name: 'Audience reached' }).waitFor({ timeout: 20000 }); await page.waitForTimeout(1200);
        for (const who of ['team', 'jack']) {
          if (who === 'jack') { await page.getByRole('group', { name: 'Filter by person' }).getByRole('button', { name: /^Jack/ }).first().click(); await page.waitForTimeout(2500); }
          else { await page.getByRole('group', { name: 'Filter by person' }).getByRole('button', { name: 'Team', exact: true }).first().click(); await page.waitForTimeout(2000); }
          const grid = page.getByRole('region', { name: 'Audience reached' }).locator('xpath=..');
          await grid.scrollIntoViewIfNeeded();
          await grid.screenshot({ path: `${OUT}/${PREFIX}-${w}-${scheme}-${who}.png` });
          if (scheme !== 'dark') continue;
          const cards = await measure(page);
          if (!cards.length) { ok(`${w} ${who}: cards tagged for measuring`, false, 'no data-hero-card (before-fix build)'); continue; }
          const tag2 = `${w} ${who}`;
          ok(`${tag2}: no pill overlaps a ring`, cards.every(k => !overlap(k.pill, k.ring)), cards.filter(k => overlap(k.pill, k.ring)).map(k => k.name).join(', '));
          ok(`${tag2}: no title wraps to one word per line (≤ 2 lines)`, cards.every(k => k.titleLine <= 2), cards.map(k => `${k.name}:${k.titleLine}`).join(' '));
          // Same row = same card top; parts must line up within 2px across cards in a row.
          
          const tops = await page.evaluate(() => [...document.querySelectorAll('section[data-hero-card]')].map(c => Math.round(c.getBoundingClientRect().top)));
          const byRow = new Map(); cards.forEach((k, i) => { const t = tops[i]; byRow.set(t, [...(byRow.get(t) || []), k]); });
          const misaligned = [];
          for (const [, row] of byRow) for (const part of ['number', 'goal', 'spark', 'delta', 'footer']) { const ys = row.map(k => k[part]?.top).filter(v => v != null); if (ys.length > 1 && Math.max(...ys) - Math.min(...ys) > 2) misaligned.push(`${part} ${ys.join('/')}`); }
          ok(`${tag2}: number / of goal / sparkline / delta / footer at the same height across each row`, !misaligned.length, misaligned.join('; '));
          if (w === 390) ok('390: no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= 391));
        }
        await ctx.close();
      }
    }
    ok('0 console errors', !errs.length, errs.join(' | '));
  } catch (e) { ok('run without exceptions', false, e.stack); }
  await cleanup();
  const after = await snap();
  const moved = WATCH.filter(t => before[t] !== after[t]);
  ok('HomeLover goal tables unchanged', !moved.length, moved.map(t => `${t} ${before[t]}->${after[t]}`).join(', '));
  console.log(`\n${pass}/${total} passed`);
  console.log(moved.length ? `restored: NO - moved: ${moved.join(', ')} (check who wrote it)` : 'restored: yes');
  process.exit(pass === total ? 0 : 1);
})();
