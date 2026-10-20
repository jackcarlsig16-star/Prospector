// partner-add-research-v1 REV3 Stage 2 bar 4 - research on create + the card, against a real server, real DB and REAL Claude.
// TEMP data only: 1 workspace, 2 temp users (owner, viewer), 3 partners created through POST goals/land (the form path), which
// kicks 3 REAL Claude calls with web_search (max 3 searches each) - the only AI spend in this script. 0 Apollo (no sync, no
// contacts). Then: no "@" / phone in any stored result, usage rows with user_id + cost, Viewer read-only, Confirm site for #1
// (domain + company_domain), Wrong site for #2 (nothing written), Use on #1 (stamped append), screenshots 1440 / 390 of the card.
// HomeLover never touched (counts before/after). Teardown via tempGuard incl. the 3 usage rows. ~3-4 min, cap 360 s.
// Serves build/ (run npm run build first).
// Usage: node scripts/verify/partner-add-research-v1-stage2.mjs <outdir> [--fixture]
//   --fixture: 0 Claude - partners + one done research_runs row are seeded with the service key (same shape the real run
//   stored on 2026-10-16), then the Viewer / Confirm / Wrong / Use / browser checks run as usual.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const FIXTURE = process.argv.includes('--fixture');
const OUT = process.argv.find((a, i) => i >= 2 && !a.startsWith('--')) || path.join(ROOT, 'build', 'verify-shots');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3975;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const NAME = 'ZZ Research Temp';
const PARTNERS = ['Brown & Brown', 'Lockton', 'Marsh McLennan Agency'];
const WATCH = ['businesses', 'business_members', 'profiles', 'sales_goals', 'partner_domains', 'research_runs', 'business_anthropic_usage'];
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const counts = async biz => { const o = {}; for (const t of WATCH) { let q = svc.from(t).select('*', { count: 'exact', head: true }); if (biz && t !== 'profiles' && t !== 'businesses') q = q.eq('business_id', biz); o[t] = (await q).count; } return o; };
let srv, browser, B, users = [], pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  if (B) {
    for (const t of ['research_runs', 'business_anthropic_usage', 'partner_domains', 'sales_partner_events', 'sales_goals', 'auth_events', 'business_members']) await svc.from(t).delete().eq('business_id', B);
    await svc.from('businesses').delete().eq('id', B); B = null;
  }
  for (const u of users) { await svc.from('auth_events').delete().eq('user_id', u.id); await svc.from('auth_events').delete().eq('actor_id', u.id); await svc.auth.admin.deleteUser(u.id); }
  users = [];
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 360000 });
const { scrubPhones } = await import(ROOT + '/api/sales/scrubText.js');
const { stampDate } = { stampDate: d => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` };
const { laDateString } = await import(ROOT + '/api/sales/laDate.js');

const before = await counts(); const hlBefore = await counts(HOMELOVER);
console.log('counts before', JSON.stringify(before)); console.log('HomeLover before', JSON.stringify(hlBefore));
fs.mkdirSync(OUT, { recursive: true });
try {
  const tag = 'res2-' + Date.now();
  B = ins(await svc.from('businesses').insert({ name: NAME, website_url: 'https://homelover.com', tagline: 'housing as an employee benefit: down payment awards, closing credits, a loan officer', color: '#6F8CF0', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
  const mk = async (name, role) => {
    const email = `${tag}-${name}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
    const { data: u, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(error.message);
    await svc.from('profiles').update({ display_name: `${name} Test`, welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
    ins(await svc.from('business_members').insert({ business_id: B, email, name: `${name} Test`, user_id: u.user.id, role }).select());
    const anon = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data: s, error: sErr } = await anon.auth.signInWithPassword({ email, password });
    if (sErr) throw new Error(sErr.message);
    const u2 = { id: u.user.id, token: s.session.access_token, session: s.session }; users.push(u2); return u2;
  };
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const owner = await mk('Owner', 'owner'), viewer = await mk('Viewer', 'viewer');
  const api = async (u, method, p, body) => {
    const r = await fetch(`http://localhost:${PORT}/api/sales/${B}/goals${p}`, { method, headers: { cookie: `prospector_at=${u.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  // 1. Create through the form path -> research starts on its own (trigger create).
  const t0 = Date.now();
  const made = [];
  const runs = {};
  if (FIXTURE) {
    const FIX = { website: 'https://www.bbinsurance.com/', domain: 'bbinsurance.com', website_confidence: 'high', source_urls: ['https://www.bbinsurance.com/careers/'], summary: 'Brown & Brown (NYSE: BRO) is one of the world\'s largest insurance brokerages, offering risk management, property-casualty insurance and employee benefits to businesses.', mission: '"We are built on a culture of teammates who care."', positioning: null, size: '17,000+ teammates (est., careers page)', hq_city: 'Daytona Beach, FL', recent_news: 'none found', housing_perk: 'no housing perk found', suggested_category: null, why_homelover: 'Their benefits consultants sell differentiation to employers.', first_angle: 'A benefit their competitors cannot quote yet.', watch_outs: 'Large brokerage, long procurement.', titles: 'EVP Employee Benefits, VP Voluntary Benefits', web_searches: 2 };
    for (const [i, name] of PARTNERS.entries()) {
      const g = ins(await svc.from('sales_goals').insert({ business_id: B, goal_type: 'partnership', name, priority: 1, pipeline_status: 'not_started' }).select().single());
      made.push(g);
      const run = ins(await svc.from('research_runs').insert({ business_id: B, entity_type: 'partner', entity_id: g.id, trigger: 'create', status: 'done', model: 'claude-sonnet-4-6', created_by: owner.id, input_tokens: 17765, output_tokens: 741, cost_usd: 0.08441, result: i === 0 ? FIX : { ...FIX, domain: ['lockton.com', 'marshmma.com'][i - 1], website: null, summary: `${name} fixture` } }).select().single());
      runs[g.id] = run;
    }
    console.log('FIXTURE mode: 0 Claude calls, 3 seeded done runs');
  } else for (const name of PARTNERS) { const r = await api(owner, 'POST', '/land', { goal_type: 'partnership', name, priority: 1 }); if (r.status !== 201) throw new Error(`create ${name}: ${r.status} ${JSON.stringify(r.body)}`); made.push(r.body.goal); }
  if (!FIXTURE) { await new Promise(r => setTimeout(r, 800));
  const { data: started } = await svc.from('research_runs').select('entity_id, trigger, status, created_by, model').eq('business_id', B);
  ok('3 partners created -> 3 research_runs rows (trigger create, created_by = creator, running or done), save not blocked', started?.length === 3 && started.every(r => r.trigger === 'create' && r.created_by === owner.id && ['running', 'done'].includes(r.status)), JSON.stringify(started));

  // 2. Wait for the three real runs.
  for (let i = 0; i < 48 && Object.keys(runs).length < 3; i++) {
    for (const g of made) { if (runs[g.id]) continue; const r = await api(owner, 'GET', `/partners/${g.id}/research`); const latest = r.body.runs?.[0]; if (latest && latest.status !== 'running') runs[g.id] = latest; }
    if (Object.keys(runs).length < 3) await new Promise(r => setTimeout(r, 5000));
  }
  console.log(`research wall time: ${Math.round((Date.now() - t0) / 1000)} s`); }
  let totalCost = 0;
  for (const g of made) {
    const run = runs[g.id];
    if (!run) { ok(`${g.name}: finished within 240 s`, false, 'still running'); continue; }
    const r = run.result || {};
    totalCost += run.cost_usd || 0;
    console.log(`  ${g.name}: ${run.status} · ${r.domain || 'no domain'} (${r.website_confidence}) · source ${r.source_urls?.[0] || '-'} · $${run.cost_usd} · ${run.input_tokens}+${run.output_tokens} tokens · ${r.web_searches} searches`);
    console.log(`    summary: ${(r.summary || run.error || '').slice(0, 140)}`);
    console.log(`    category: ${r.suggested_category} · housing perk: ${r.housing_perk} · titles: ${r.titles}`);
    ok(`${g.name}: done with a domain, cost and tokens`, run.status === 'done' && !!r.domain && run.cost_usd > 0 && run.input_tokens > 0, run.error || '');
    const text = JSON.stringify(r);
    ok(`${g.name}: no "@" and no phone number in the stored result`, !/@/.test(text) && Object.values(r).filter(v => typeof v === 'string').every(v => scrubPhones(v) === v));
  }
  console.log(`total research cost: $${totalCost.toFixed(4)} · per run avg $${(totalCost / 3).toFixed(4)}`);
  const { data: usage } = await svc.from('business_anthropic_usage').select('call_type, user_id, cost_usd, model').eq('business_id', B);
  if (!FIXTURE) ok('3 usage rows (partner_research) with user_id + cost_usd', usage?.length === 3 && usage.every(u => u.call_type === 'partner_research' && u.user_id === owner.id && u.cost_usd > 0), JSON.stringify(usage));
  const goals = ins(await svc.from('sales_goals').select('id, name, angle, watch_outs, first_email, target_titles, category, company_domain').eq('business_id', B));
  ok('the research wrote NOTHING to the partners', goals.every(g => !g.angle && !g.watch_outs && !g.first_email && !g.target_titles && !g.category && !g.company_domain), JSON.stringify(goals));

  // 3. Viewer: read yes, run no.
  const [p1, p2] = made;
  let r = await api(viewer, 'GET', `/partners/${p1.id}/research`);
  ok('viewer can read the research (200, result present)', r.status === 200 && r.body.runs?.[0]?.status === 'done', `status ${r.status}`);
  r = await api(viewer, 'POST', `/partners/${p1.id}/research`);
  ok('viewer cannot run research (403)', r.status === 403, `status ${r.status}`);

  // 4. Confirm site on #1 (exactly the card's two calls); Wrong site on #2 = no call at all.
  const d1 = runs[p1.id]?.result?.domain;
  if (d1) {
    r = await api(owner, 'POST', `/partners/${p1.id}/domains`, { domain: d1 });
    const r2 = await api(owner, 'PATCH', `/land/${p1.id}`, { company_domain: d1 });
    const { data: doms } = await svc.from('partner_domains').select('domain, confirmed, is_primary, source').eq('business_id', B).eq('goal_id', p1.id);
    ok(`Confirm site (${p1.name}) -> one confirmed primary manual domain + company_domain filled`, r.status === 201 && r2.status === 200 && doms?.length === 1 && doms[0].domain === d1 && doms[0].confirmed && doms[0].is_primary && doms[0].source === 'manual' && r2.body.goal.company_domain === d1, JSON.stringify(doms));
  } else ok(`Confirm site (${p1.name})`, false, 'no domain to confirm');
  const { data: doms2 } = await svc.from('partner_domains').select('id').eq('business_id', B).eq('goal_id', p2.id);
  ok(`Wrong site (${p2.name}) -> no partner_domains row, company_domain still empty`, doms2?.length === 0 && goals.find(g => g.id === p2.id).company_domain === null);

  // 5. Use on #1: the card appends a stamped line to the mapped field.
  const summary = runs[p1.id]?.result?.summary;
  if (summary) {
    const stamp = `(${stampDate(laDateString())}) AI: ${summary}`;
    r = await api(owner, 'PATCH', `/land/${p1.id}`, { angle: stamp });
    ok(`Use summary (${p1.name}) -> angle = "(M/D) AI: …"`, r.status === 200 && r.body.goal.angle === stamp && /^\(\d{1,2}\/\d{1,2}\) AI: /.test(r.body.goal.angle), r.body.goal?.angle?.slice(0, 60));
  }

  // 6. Browser: the card in the row drop-down at 1440 and 390; viewer sees no buttons.
  browser = await chromium.launch();
  async function newPage(u, { width = 1440, height = 900 } = {}) {
    const errs = [];
    const page = await (await browser.newContext({ viewport: { width, height } })).newPage(); page.setDefaultTimeout(12000);
    page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
    await page.addInitScript(([k, v]) => { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, JSON.stringify(u.session)]);
    await page.route(/\/api\/sales\/[^/]+\/(sync|apollo)/, route => route.abort());
    await page.goto(`http://localhost:${PORT}/?tab=pipeline&view=partners`);
    await page.locator('#main-content').getByText(NAME).first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(1000);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').selectOption({ label: NAME }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    await page.locator('#workspace-header-tabs').getByRole('button', { name: /^Pipeline/ }).first().click(); await page.waitForTimeout(1500);
    await page.locator('.ui-seg').getByRole('button', { name: 'Partner workflow', exact: true }).first().click(); await page.waitForTimeout(1800);
    return { page, errs };
  }
  // A P1 partner is in Top priorities AND its category group; everything is scoped to Top priorities.
  const top = page => page.getByRole('region', { name: 'Top priorities' });
  const card = page => top(page).getByRole('region', { name: `Research on ${p1.name}` });
  for (const [label, vp] of [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]]) {
    const { page, errs } = await newPage(owner, vp);
    await top(page).locator('button[title="Show research, intel and history"]', { hasText: p1.name }).first().click();
    await card(page).waitFor({ timeout: 10000 });
    await card(page).scrollIntoViewIfNeeded(); await page.waitForTimeout(600);
    const txt = (await card(page).innerText()).replace(/\s+/g, ' ');
    const hasButtons = (await card(page).getByRole('button', { name: 'Confirm site' }).count()) + (await card(page).getByRole('button', { name: /^Use / }).count());
    ok(`${label}: card shows the site, the domain confirmed, fields with Use, Re-run`, txt.includes(d1) && txt.includes('confirmed') && hasButtons > 0 && (await card(page).getByRole('button', { name: 'Re-run' }).count()) === 1 && !errs.length, `${txt.slice(0, 160)} | errs ${errs.join(' | ')}`);
    ok(`${label}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: `${OUT}/research-card-${label}.png`, fullPage: false, animations: 'disabled', caret: 'hide' });
    await page.context().close();
  }
  { const { page } = await newPage(viewer);
    await top(page).locator('button[title="Show research, intel and history"]', { hasText: p1.name }).first().click();
    await card(page).waitFor({ timeout: 10000 });
    await card(page).getByText(d1).first().waitFor({ timeout: 10000 });
    { const vt = (await card(page).innerText()).replace(/\s+/g, ' '); const vb = await card(page).getByRole('button').allInnerTexts();
      ok('viewer: card visible with the result, zero buttons', vt.includes(d1) && vb.length === 0, `buttons=${JSON.stringify(vb)} text=${vt.slice(0, 200)}`); }
    await page.context().close();
  }
} catch (e) {
  console.log('ERROR', e.message);
} finally {
  await cleanup();
  const after = await counts(); const hlAfter = await counts(HOMELOVER);
  const same = JSON.stringify(before) === JSON.stringify(after), hlSame = JSON.stringify(hlBefore) === JSON.stringify(hlAfter);
  console.log('counts after ', JSON.stringify(after));
  console.log(`${pass}/${total} passed · temp rows removed: ${same ? 'yes' : 'NO - ' + JSON.stringify(after)} · HomeLover unchanged: ${hlSame ? 'yes' : 'NO'}`);
  console.log(`restored: ${same && hlSame ? 'yes' : 'NO'}`);
  process.exit(pass === total && same && hlSame ? 0 : 1);
}
