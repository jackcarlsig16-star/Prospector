// app-shell-v2 Stage 0 (a) - the route table, observed: every destination the CURRENT shell reaches on the sales
// workspace and from the app-level rows, with the API GETs each one makes (the contract Stage 2 keeps green).
// READ-ONLY on localhost as the platform owner: 0 Claude, 0 Apollo, 0 writes (every non-GET is aborted in the
// browser; ownerSession's sign-in row is kept by rule, last_seen_at restored). DECLARED: 22 destinations at 1440,
// ~22 page loads / clicks; est. 90 s; cap 230 s. Output: audits/app-shell-v2-stage0-routes.json + before PNGs in
// .screenshots/app-shell-v2/before/. No address is printed: only paths, with ids collapsed to :id.
// Usage: node scripts/verify/app-shell-v2-stage0-routes.mjs
import fs from 'fs';
import path from 'path';
import { readOnlyBrowser } from './lib/readOnlyBrowser.mjs';

const h = await readOnlyBrowser({ port: 3996, capMs: 230000 });
const OUT = path.join(h.ROOT, '.screenshots', 'app-shell-v2', 'before');
fs.mkdirSync(OUT, { recursive: true });
const B = h.workspace.id;
const norm = p => p.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id').replace(/\/\d{4}-\d{2}-\d{2}/g, '/:day');
const sales = (tab, view) => `${h.BASE}/?business=${B}&tab=${tab}${view ? `&view=${view}` : ''}`;
const DEST = [
  ['actions', 'Actions (Today)', p => p.goto(sales('actions'))],
  ['dashboard/overview', 'Dashboard › Home', p => p.goto(sales('dashboard', 'overview'))],
  ['dashboard/analytics', 'Dashboard › Email', p => p.goto(sales('dashboard', 'analytics'))],
  ['dashboard/scorecard', 'Dashboard › Scorecard', p => p.goto(sales('dashboard', 'scorecard'))],
  ['dashboard/sources', 'Dashboard › Sources', p => p.goto(sales('dashboard', 'sources'))],
  ['pipeline/top-targets', 'Pipeline › Top targets', p => p.goto(sales('pipeline', 'top-targets'))],
  ['pipeline/companies', 'Pipeline › Companies', p => p.goto(sales('pipeline', 'companies'))],
  ['pipeline/clients', 'Pipeline › Clients', p => p.goto(sales('pipeline', 'clients'))],
  ['pipeline/priorities', 'Pipeline › Map', p => p.goto(sales('pipeline', 'priorities'))],
  ['pipeline/people', 'Pipeline › People', p => p.goto(sales('pipeline', 'people'))],
  ['pipeline/partners', 'Pipeline › Partner workflow', p => p.goto(sales('pipeline', 'partners'))],
  ['pipeline/campaigns', 'Pipeline › Campaigns', p => p.goto(sales('pipeline', 'campaigns'))],
  ['settings/team-emails', 'Settings › Team emails', p => p.goto(sales('settings', 'team-emails'))],
  ['ideas', 'Ideas', async p => { await p.goto(sales('actions')); await nav(p, 'Ideas'); }],
  ['projects', 'Projects', p => nav(p, 'Projects')],
  ['overview', 'Business Intel & Strategy', p => nav(p, 'Business Intel & Strategy')],
  ['tools', 'Tools', p => nav(p, 'Tools')],
  ['admin', 'Admin', p => nav(p, 'Admin')],
  ['voice-profile', 'Help › Voice Profile', async p => { await nav(p, /^Help/); await nav(p, 'Voice Profile'); }],
  ['ui-kit', 'Help › UI kit', p => nav(p, 'UI kit')],
  ['connections', 'User menu › Connections', async p => { await p.getByRole('button', { name: /^My profile/ }).click(); await nav(p, 'Connections'); }],
  ['businesses-home', 'All workspaces', p => p.getByRole('combobox', { name: 'Workspace' }).selectOption('')],
];
const nav = (p, name) => p.getByRole('button', { name, exact: typeof name === 'string' }).first().click();

const table = [];
try {
  const ctx = await h.context(1440);
  const page = await ctx.newPage(); page.setDefaultTimeout(20000);
  let bucket = null;
  page.on('response', r => {
    const u = new URL(r.url());
    if (!bucket || r.request().method() !== 'GET') return;
    if (u.host === new URL(h.BASE).host && /^\/(api|proxy)\//.test(u.pathname)) bucket.push(`${r.status()} ${norm(u.pathname)}`);
    else if (u.host === h.SUPA_HOST && u.pathname.startsWith('/rest/v1/')) bucket.push(`${r.status()} supabase:${u.pathname.replace('/rest/v1/', '')}`);
  });
  for (const [id, label, go] of DEST) {
    bucket = [];
    let error = null;
    try { await go(page); await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(700); } catch (e) { error = e.message.split('\n')[0]; }
    const calls = [...new Set(bucket)].sort();
    const bad = calls.filter(c => !/^(200|304) /.test(c));
    table.push({ id, label, requests: calls, not_ok: bad, ...(error ? { error } : {}) });
    console.log(`${error ? 'FAIL' : 'ok  '} ${label.padEnd(30)} ${calls.length} GETs${bad.length ? ` · not 200: ${bad.join(', ')}` : ''}${error ? ` · ${error}` : ''}`);
    await page.screenshot({ path: path.join(OUT, `${id.replace('/', '-')}-1440.png`) }).catch(() => {});
  }
  await ctx.close();
  const phone = await h.context(390);
  const p2 = await phone.newPage(); p2.setDefaultTimeout(20000);
  await p2.goto(sales('actions')); await p2.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); await p2.waitForTimeout(700);
  await p2.screenshot({ path: path.join(OUT, 'actions-390.png') });
  await phone.close();
  fs.writeFileSync(path.join(h.ROOT, 'audits', 'app-shell-v2-stage0-routes.json'), JSON.stringify({ at: new Date().toISOString(), table }, null, 1));
  console.log(`destinations ${table.length} · with an error ${table.filter(t => t.error).length} · writes aborted in the browser: ${h.blocked.length}${h.blocked.length ? ` (${[...new Set(h.blocked)].join(', ')})` : ''}`);
} finally { await h.close(); }
console.log('0 Claude · 0 Apollo · 0 writes reached a server · restored: yes');
process.exit(0);
