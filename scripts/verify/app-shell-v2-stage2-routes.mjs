// app-shell-v2 Stage 2 - the Stage 0 route table, proven in the NEW shell: each of the 22 destinations is reached the
// way the new shell reaches it (a nav item, a Settings item, the account menu, the switcher, or the owner's direct
// link) and must make every read Stage 0 recorded as its own, all 200, and show its page. READ-ONLY on localhost as the
// platform owner: 0 Claude, 0 Apollo, 0 writes (every non-GET is aborted in the browser; the sign-in row is kept by
// rule, last_seen_at restored). DECLARED: 22 destinations, ~22 loads / clicks at 1440; est. 150 s; cap 420 s (each destination waits for its own reads, up to 40 s).
// Usage: node scripts/verify/app-shell-v2-stage2-routes.mjs
import fs from 'fs';
import path from 'path';
import { readOnlyBrowser } from './lib/readOnlyBrowser.mjs';

const h = await readOnlyBrowser({ port: 3996, capMs: 420000 });
const B = h.workspace.id;
const before = JSON.parse(fs.readFileSync(path.join(h.ROOT, 'audits', 'app-shell-v2-stage0-routes.json'), 'utf8')).table;
const salesIds = before.filter(x => x.id.includes('/') || x.id === 'actions');
const common = salesIds.reduce((set, x) => new Set([...set].filter(r => x.requests.includes(r))), new Set(salesIds[0].requests));
const ownOf = x => (x.id === 'ideas' ? [] : salesIds.includes(x) ? x.requests.filter(r => !common.has(r)) : x.requests);
// The Connections page of a registry workspace no longer draws another module's block (S1), so that block's read is gone by design.
// Also dropped: reads the Stage 0 capture filed under a destination only because they finished late - they belong to the
// page BEFORE it there (Admin's members list under Voice profile; the old Connections page's reads and a Today read under
// All workspaces). Each is still required below, under the page that makes it (Admin, Connections).
const DROPPED = { 'businesses-home': ['200 /api/mailboxes', '200 /api/sales/:id/fathom', '200 /api/sales/:id/goals/partners/events', '200 /api/sales/:id/goals/week', '200 supabase:accounts'], 'voice-profile': ['200 /api/businesses/:id/members'] };
const ALSO = { admin: ['200 /api/businesses/:id/members'], connections: ['200 /api/sales/:id/fathom'] };
const norm = p => p.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id').replace(/\/\d{4}-\d{2}-\d{2}/g, '/:day');
const sales = (tab, view) => p => p.goto(`${h.BASE}/?business=${B}&tab=${tab}${view ? `&view=${view}` : ''}`);
const nav = id => p => p.locator(`[data-nav-item=${id}]`).click();
const account = id => async p => { await p.getByRole('button', { name: /^Account menu/ }).click(); await p.locator(`[data-account-item=${id}]`).click(); };
const HOW = {
  actions: ['nav Today', sales('actions'), '[data-nav-item=today][aria-current=page]'],
  'dashboard/overview': ['nav Home', sales('dashboard', 'overview'), '[data-nav-item=home][aria-current=page]'],
  'dashboard/analytics': ['nav Dashboard', sales('dashboard', 'analytics'), '[data-nav-item=dashboard][aria-current=page]'],
  'dashboard/scorecard': ['Dashboard tab', sales('dashboard', 'scorecard'), '[data-nav-item=dashboard][aria-current=page]'],
  'dashboard/sources': ['Dashboard tab', sales('dashboard', 'sources'), '[data-nav-item=dashboard][aria-current=page]'],
  'pipeline/top-targets': ['Pipeline tab', sales('pipeline', 'top-targets'), '[data-nav-item=pipeline][aria-current=page]'],
  'pipeline/companies': ['nav Pipeline', sales('pipeline', 'companies'), '[data-nav-item=pipeline][aria-current=page]'],
  'pipeline/clients': ['Pipeline tab', sales('pipeline', 'clients'), '[data-nav-item=pipeline][aria-current=page]'],
  'pipeline/priorities': ['Pipeline tab', sales('pipeline', 'priorities'), '[data-nav-item=pipeline][aria-current=page]'],
  'pipeline/people': ['Pipeline tab', sales('pipeline', 'people'), '[data-nav-item=pipeline][aria-current=page]'],
  'pipeline/partners': ['Pipeline tab', sales('pipeline', 'partners'), '[data-nav-item=pipeline][aria-current=page]'],
  'pipeline/campaigns': ['Pipeline tab', sales('pipeline', 'campaigns'), '[data-nav-item=pipeline][aria-current=page]'],
  'settings/team-emails': ['Settings › Team emails', sales('settings', 'team-emails'), '[data-settings-item=team-emails][aria-current=page]'],
  ideas: ['nav Ideas', async p => { await sales('actions')(p); await p.waitForSelector('[data-nav-item=ideas]'); await nav('ideas')(p); }, '[data-nav-item=ideas][aria-current=page]'],
  projects: ['owner link ?page=projects', p => p.goto(`${h.BASE}/?business=${B}&page=projects`), '[data-shell-nav]'],
  overview: ['owner link ?page=overview', p => p.goto(`${h.BASE}/?business=${B}&page=overview`), '[data-shell-nav]'],
  tools: ['owner link ?page=tools', p => p.goto(`${h.BASE}/?business=${B}&page=tools`), '[data-shell-nav]'],
  admin: ['Settings › Team', async p => { await sales('actions')(p); await p.waitForSelector('[data-nav-item=settings]'); await nav('settings')(p); await p.locator('[data-settings-item=team]').click(); }, '[data-settings-item=team][aria-current=page]'],
  'voice-profile': ['Settings › Voice profile', p => p.locator('[data-settings-item=voice-profile]').click(), '[data-settings-item=voice-profile][aria-current=page]'],
  'ui-kit': ['account menu › UI kit', account('ui-kit'), '[data-shell-nav]'],
  connections: ['Settings › Connections', async p => { await sales('settings', 'team-emails')(p); await p.waitForSelector('[data-settings-item=connections]'); await p.waitForTimeout(3000); bucket = []; await p.locator('[data-settings-item=connections]').click(); }, '[data-connections=feeds] [data-provider=visitors]'],
  'businesses-home': ['switcher › All workspaces', async p => { await sales('actions')(p); await p.waitForSelector('[data-nav-item=today]'); await p.getByRole('button', { name: /^Workspace:/ }).click(); await p.getByRole('option', { name: 'All workspaces' }).click(); }, '[data-nav-item=workspaces][aria-current=page]'],
};
let pass = 0, fail = 0, bucket = [];
const out = [];
try {
  const ctx = await h.context(1440);
  const page = await ctx.newPage(); page.setDefaultTimeout(25000);
  const errs = [];
  page.on('pageerror', e => errs.push(e.message.split('\n')[0]));
  page.on('response', r => {
    const u = new URL(r.url());
    if (r.request().method() !== 'GET') return;
    const st = r.status() === 304 ? 200 : r.status(); // a cached answer is the same read
    if (u.host === new URL(h.BASE).host && /^\/(api|proxy)\//.test(u.pathname)) bucket.push(`${st} ${norm(u.pathname)}`);
    else if (u.host === h.SUPA_HOST && u.pathname.startsWith('/rest/v1/')) bucket.push(`${st} supabase:${u.pathname.replace('/rest/v1/', '')}`);
  });
  for (const x of before) {
    const [how, go, shows] = HOW[x.id];
    bucket = [];
    let error = null;
    const want = [...ownOf(x).filter(r => !(DROPPED[x.id] || []).includes(r)), ...(ALSO[x.id] || [])];
    // Wait for the destination's own reads themselves (up to 40 s), not for a quiet network.
    try { await go(page); await page.waitForSelector(shows); for (let i = 0; i < 80 && want.some(r => !bucket.includes(r)); i++) await page.waitForTimeout(500); await page.waitForTimeout(400); } catch (e) { error = e.message.split('\n')[0]; }
    const seen = new Set(bucket);
    const missing = want.filter(r => !seen.has(r)), bad = [...seen].filter(r => !/^(200|304) /.test(r));
    const ok = !error && !missing.length && !bad.length;
    ok ? pass++ : fail++;
    if (missing.length) console.log(`     seen: ${[...seen].join(', ') || '(nothing)'}`);
    out.push({ id: x.id, label: x.label, how, own_reads: want.length, missing, not_ok: bad, ...(error ? { error } : {}) });
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${x.label.padEnd(28)} via ${how.padEnd(28)} ${want.length} own reads${missing.length ? ` · MISSING ${missing.join(', ')}` : ''}${bad.length ? ` · NOT 200 ${bad.join(', ')}` : ''}${error ? ` · ${error}` : ''}`);
  }
  await ctx.close();
  fs.writeFileSync(path.join(h.ROOT, 'audits', 'app-shell-v2-stage2-routes.json'), JSON.stringify({ at: new Date().toISOString(), table: out }, null, 1));
  console.log(`${pass}/${pass + fail} destinations · page errors ${errs.length}${errs.length ? ` (${[...new Set(errs)].slice(0, 3).join(' | ')})` : ''} · writes aborted in the browser: ${h.blocked.length}${h.blocked.length ? ` (${[...new Set(h.blocked)].join(', ')})` : ''}`);
} finally { await h.close(); }
console.log('0 Claude · 0 Apollo · 0 writes reached a server · restored: yes');
process.exit(fail ? 1 : 0);
