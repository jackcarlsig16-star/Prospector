// intent-score-v1 REV2 Stage 4 live check - LIVE as Jack (ownerSession) on the REAL HomeLover workspace, through the
// real wiring on localhost against the build. Declared scope: ONE recompute of every HomeLover company (≈ 360 rows
// into sales_company_scores + today's sales_company_score_days, idempotent); ONE invented company (Zz Verify Loft, a
// Brad-named referral + a fake visit row + a fake research row) that is scored, briefed, assigned to Cyrus, written an
// email for, then DELETED BY ID with its visit, research and score rows; ONE saved view, deleted after; ONE declared
// Claude call (POST goals/compose - STANDARD, draft discarded, nothing sent, no address); 0 Apollo. The browser run
// (Share: PNG + CSV on the real book) allows GET + the saved-view POST + cdnjs for html2canvas, aborts every other
// non-GET. Oracle: scripts/verify/intent-score-v1-stage0.mjs (independent offline scorer, confirmed weights).
// Expected after: sales_company_scores and sales_company_score_days grew to the company count, business_anthropic_usage
// +1 (the declared call, kept as the cost record), everything else identical; a count() error THROWS.
// Runtime ~2-3 min, hard cap 300 s. Shots + files: .screenshots/intent-score-v1/ (not committed).
// Usage: npm run build && node scripts/verify/intent-score-v1-stage4.mjs
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn, execFileSync } from 'child_process';
import { ownerSession } from './lib/ownerSession.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const { normName } = await import('../../api/sales/intakeMatch.js');
const OUT = path.join(ROOT, '.screenshots', 'intent-score-v1');
const PORT = 3995, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const HL_TABLES = ['sales_goals', 'sales_opportunities', 'sales_targets', 'sales_people', 'sales_signals', 'web_visits', 'research_runs', 'sales_week_goals', 'sales_settings', 'sales_company_scores', 'sales_company_score_days', 'visit_priority_override', 'sales_visit_skip', 'sales_source_events', 'business_anthropic_usage'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const count = async (t, biz) => { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', biz); if (r.error || typeof r.count !== 'number') throw new Error(`count ${t}: ${r.error?.message || `no count (HTTP ${r.status})`}`); return r.count; };
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const biz = (await svc.from('businesses').select('id, name').ilike('name', '%homelover%')).data;
if (biz?.length !== 1) throw new Error('expected one HomeLover business');
const HL = biz[0].id;
const snapshot = async () => { const o = {}; for (const t of HL_TABLES) o[t] = await count(t, HL); return o; };
const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const NAME = 'Zz Verify Loft', KEY = normName(NAME);
let srv, browser, owner, targetId = null, visitId = null, researchId = null, viewId = null;
const blocked = [], realCalls = [], writes = [];
const results = { checks: [], errors: [], claude_calls: 0, cost_usd: null };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 400)}` : ''); };

async function removeInvented() {
  if (targetId) {
    for (const t of ['sales_company_scores', 'sales_company_score_days']) await svc.from(t).delete().eq('business_id', HL).eq('company_type', 'target').eq('company_id', targetId);
    await svc.from('sales_source_events').delete().eq('business_id', HL).eq('record_type', 'target').eq('record_id', targetId);
    await svc.from('sales_week_goals').delete().eq('business_id', HL).eq('link_type', 'target').eq('link_id', targetId);
  }
  if (researchId) await svc.from('research_runs').delete().eq('id', researchId);
  if (visitId) await svc.from('web_visits').delete().eq('id', visitId);
  await svc.from('visit_priority_override').delete().eq('business_id', HL).eq('company_key', KEY);
  await svc.from('sales_visit_skip').delete().eq('business_id', HL).eq('company_key', KEY);
  if (targetId) await svc.from('sales_targets').delete().eq('id', targetId);
  if (viewId) { const s = must(await svc.from('sales_settings').select('saved_views').eq('business_id', HL).maybeSingle()); if (Array.isArray(s?.saved_views) && s.saved_views.some(v => v.id === viewId)) await svc.from('sales_settings').update({ saved_views: s.saved_views.filter(v => v.id !== viewId) }).eq('business_id', HL); }
  targetId = visitId = researchId = viewId = null;
}
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; await removeInvented().catch(e => log('cleanup error', e.message)); if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 300000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
log('before', JSON.stringify(before));

try {
  const [upside, cyrus] = await Promise.all([
    svc.from('sales_goals').select('id, name').eq('business_id', HL).eq('goal_type', 'partnership').ilike('name', '%upside%').limit(1).then(must),
    svc.from('business_members').select('user_id, name').eq('business_id', HL).ilike('name', 'cyrus%').limit(1).then(must),
  ]);
  if (!upside[0]) throw new Error('no Upside partner on HomeLover');
  if (!cyrus[0]) throw new Error('no Cyrus member on HomeLover');
  const live = { partners: (await svc.from('sales_goals').select('id', { count: 'exact', head: true }).eq('business_id', HL).eq('goal_type', 'partnership').is('archived_at', null)).count, employers: (await svc.from('sales_opportunities').select('id', { count: 'exact', head: true }).eq('business_id', HL).is('archived_at', null)).count, targets: (await svc.from('sales_targets').select('id', { count: 'exact', head: true }).eq('business_id', HL).neq('status', 'rejected')).count };
  const expectedCompanies = live.partners + live.employers + live.targets;

  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const real = async (p, method = 'GET', body) => { const r = await fetch(`${BASE}/api/sales/${HL}/goals${p}`, { method, headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { j = { raw: text }; } return { code: r.status, body: j, text }; };

  // 1. Recompute all (owner) -> row count = companies.
  const rc = await real('/scores/recompute', 'POST', {});
  const scoresNow = await count('sales_company_scores', HL), daysNow = await count('sales_company_score_days', HL);
  ok(`recompute all through the real wiring -> ${rc.code}; ${rc.body?.counts?.companies} companies = ${live.partners} partners + ${live.employers} employers + ${live.targets} targets (${expectedCompanies}); ranked ${rc.body?.counts?.ranked}, live ${rc.body?.counts?.live}, duplicates ${rc.body?.counts?.duplicates}, closed ${rc.body?.counts?.closed}; sales_company_scores rows ${scoresNow}, today's snapshot rows ${daysNow}`, rc.code === 200 && rc.body.counts.companies === expectedCompanies && scoresNow === expectedCompanies && daysNow === expectedCompanies, JSON.stringify(rc.body?.counts));
  const rc2 = await real('/scores/recompute', 'POST', {});
  ok(`recompute again is idempotent (${await count('sales_company_scores', HL)} rows, ${await count('sales_company_score_days', HL)} snapshot rows, removed ${rc2.body?.counts?.removed})`, rc2.code === 200 && (await count('sales_company_scores', HL)) === expectedCompanies && (await count('sales_company_score_days', HL)) === expectedCompanies);

  // 2. The book: bands, top 10, the three top P1 names with their breakdown lines.
  const all = await real('/scores');
  const b = all.body;
  results.bands = { P1: b.counts.P1, P2: b.counts.P2, P3: b.counts.P3, P4: b.counts.P4, ranked: b.counts.ranked, live: b.counts.live, duplicates: b.counts.duplicates, closed: b.counts.closed, needs_touch: b.counts.needs_touch };
  results.top10 = b.rows.slice(0, 10).map(r => `${r.name} ${r.score} ${r.band} ${r.source_label}`);
  results.sources = b.sources;
  const top3 = [];
  for (const r of b.rows.filter(x => x.band === 'P1').slice(0, 3)) { const one = await real(`/scores/${r.type}/${r.id}`); top3.push({ name: r.name, type: r.type, score: r.score, lines: one.body?.lines || [] }); }
  results.top3 = top3;
  ok(`GET goals/scores: ${b.counts.ranked} ranked · P1 ${b.counts.P1} · P2 ${b.counts.P2} · P3 ${b.counts.P3} · P4 ${b.counts.P4} · live ${b.counts.live} · duplicates ${b.counts.duplicates} · needs a touch ${b.counts.needs_touch}; sources ${JSON.stringify(b.sources)}; stale false; no address`, all.code === 200 && b.counts.ranked + b.counts.live + b.counts.duplicates === expectedCompanies && b.stale === false && !all.text.includes('@'));
  log('TOP 10:', results.top10.join(' | '));
  for (const t of top3) log(`P1 ${t.name} (${t.type}) ${t.score}: ${t.lines.join(' · ')}`);

  // 3. Oracle: the Stage 0 offline scorer with the confirmed weights (read-only child process).
  let oracle = [];
  try {
    const out = execFileSync('node', ['scripts/verify/intent-score-v1-stage0.mjs'], { cwd: ROOT, env: process.env, timeout: 90000 }).toString();
    oracle = out.split('\n').slice(out.split('\n').findIndex(l => l.startsWith('TOP 10:')) + 1).slice(0, 10).map(l => l.trim().replace(/^\d+\s+P\d\s+\S+\s+/, '').split(' - ')[0].trim()).filter(Boolean);
    fs.writeFileSync(path.join(OUT, 'stage4-oracle.txt'), out);
  } catch (e) { log('oracle failed', e.message); }
  const apiTop = b.rows.slice(0, 10).map(r => r.name);
  const overlap = apiTop.filter(n => oracle.includes(n)).length;
  results.oracle = { oracle, api: apiTop, overlap };
  ok(`oracle: ${overlap}/10 of the API's top 10 are in Stage 0's offline top 10 (the oracle keys touches off last_touch_at / updated_at only, so recency can differ by 5-10 points)`, overlap >= 7, `oracle: ${oracle.join(' | ')}`);

  // 4. The invented company: a Brad-named referral + a fake visit + fresh research -> scores P1 and sits where expected.
  const t = must(await svc.from('sales_targets').insert({ business_id: HL, name: NAME, kind: 'employer', status: 'proposed', owner_team: 'both', co_owner_name: 'Brad', no_double_touch: false, source: 'manual', source_kind: 'partner_referral', source_partner_id: upside[0].id, source_note: 'intent-score-v1 Stage 4 verify row', employees: 5000, employees_source: 'manual', evidence: 'Stage 4 verify - delete by id' }).select('id').single());
  targetId = t.id;
  const v = must(await svc.from('web_visits').insert({ business_id: HL, company_key: KEY, company_name: NAME, domain: 'zzverifyloft.example', matched_type: 'target', matched_id: targetId, priority: 'P1', priority_rule: 'Stage 4 verify', visits_7d: 8, unique_visitors_7d: 4, visits_1d: 2, apollo_intent: 'high', intent_score: 80, top_paths: [{ path: '/pricing', visits: 5 }, { path: '/employer-partners', visits: 3 }], us_500: true, maybe_user: false, pulled_on: TODAY, last_visit: TODAY, first_visit: TODAY, seen_from: TODAY, seen_to: TODAY }).select('id').single());
  visitId = v.id;
  const rr = must(await svc.from('research_runs').insert({ business_id: HL, entity_type: 'target', entity_id: targetId, trigger: 'manual', status: 'done', model: 'stage4-verify', result: { why_homelover: 'Verify: a large relocation program', first_angle: 'Verify: benefits renewal', titles: 'VP People', housing_perk: 'no housing perk found' } }).select('id').single());
  researchId = rr.id;
  const one = await real('/scores/recompute', 'POST', { type: 'target', id: targetId });
  const after1 = await real('/scores');
  const mine = after1.body.rows.find(r => r.id === targetId);
  const expectedRank = after1.body.rows.filter(r => r.score > (mine?.score ?? 0)).length + 1;
  const lines = (await real(`/scores/target/${targetId}`)).body?.lines || [];
  results.invented = { score: mine?.score, band: mine?.band, rank: mine?.rank, lines };
  ok(`invented ${NAME}: one-company recompute -> ${one.code}, score ${mine?.score} ${mine?.band} (Brad-named +12, visits, pages, fit, research), rank ${mine?.rank} of ${after1.body.counts.ranked} = where its score sits (${expectedRank}); lines: ${lines.join(' · ')}`, one.code === 200 && mine && mine.band === 'P1' && mine.score >= 60 && mine.rank === expectedRank && mine.source_label === 'upside' && lines.some(l => /Brad referral \(named\)/.test(l)));
  const brief = await real(`/brief/target/${targetId}`);
  ok(`Brief for ${NAME} -> ${brief.code}: ${brief.body?.lines?.length} lines with refs, Upside-owned line, no address`, brief.code === 200 && brief.body.lines.length >= 6 && brief.body.lines.every((l, i) => l.ref === `B${i + 1}`) && brief.body.upside_owned === true && !brief.text.includes('@'));

  // 5. Legend Brad / Upside = the source filter.
  const up = await real('/scores?source=upside');
  ok(`legend Brad / Upside: ${up.body?.rows?.length} companies lit (= sources.upside ${after1.body.sources.upside}), every one source_label upside`, up.code === 200 && up.body.rows.length === after1.body.sources.upside && up.body.rows.every(r => r.source_label === 'upside'));

  // 6. Assign to Cyrus through the existing route (owner_user_id on a target).
  const as = await real(`/company/target/${targetId}/fields`, 'PATCH', { owner_user_id: cyrus[0].user_id });
  const ownerNow = must(await svc.from('sales_targets').select('owner_user_id').eq('id', targetId).maybeSingle())?.owner_user_id;
  ok(`Assign to ${cyrus[0].name} through PATCH goals/company/target/:id/fields -> ${as.code}; owner_user_id written`, as.code === 200 && ownerNow === cyrus[0].user_id);

  // 7. ONE declared Claude call: Write email on the invented company (draft discarded).
  const usageBefore = await count('business_anthropic_usage', HL);
  const ce = await real(`/compose/target/${targetId}`, 'POST', {});
  const usageAfter = await count('business_anthropic_usage', HL);
  results.claude_calls = usageAfter - usageBefore;
  results.cost_usd = ce.body?.cost_usd ?? null;
  results.compose = ce.code === 200 ? { subject: ce.body.draft.subject, words: ce.body.lint.words, lint_ok: ce.body.lint.ok, issues: ce.body.lint.issues.map(i => `${i.rule}: ${i.detail}`), cap: ce.body.cap, cost_usd: ce.body.cost_usd } : { error: ce.body?.error, code: ce.code };
  ok(`Write email on ${NAME} -> ${ce.code}: ONE Claude call (usage rows +${usageAfter - usageBefore}), cost $${ce.body?.cost_usd}, ${ce.body?.lint?.words} words, lint ${ce.body?.lint?.ok ? 'passes' : `${ce.body?.lint?.issues?.length} issue(s): ${ce.body?.lint?.issues?.map(i => i.rule).join(', ')}`}, cap ${ce.body?.cap?.used}/${ce.body?.cap?.max}, subject "${ce.body?.draft?.subject}", no address; draft discarded`, ce.code === 200 && usageAfter - usageBefore === 1 && typeof ce.body.cost_usd === 'number' && ce.body.draft.subject && ce.body.draft.body && !ce.text.includes('@'));
  const st = await real('/compose/status');
  ok(`compose status after the call: used ${st.body?.used}, observed mean $${st.body?.cost_estimate_usd} (no constant), research cost ${st.body?.research_cost_usd ?? 'n/a yet'}`, st.code === 200 && st.body.used >= 1 && typeof st.body.cost_estimate_usd === 'number');

  // 8. Share on the real book in the browser: PNG download + CSV, the saved view; then the CSV through the wiring.
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(([k, v, b2, d]) => {
    if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
    localStorage.setItem('prospector_goals_owner', 'team');
    for (const n of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${n}_ran_${b2}`, d);
    localStorage.setItem('prospector_auto_assay_disabled', '1');
  }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HL, TODAY]);
  await ctx.route('**/*', async route => {
    const req = route.request(); const u = new URL(req.url());
    if (/anthropic\.com$|apollo\.io$/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
    const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host), isCdn = u.host === 'cdnjs.cloudflare.com';
    const allowedWrite = isLocal && req.method() === 'POST' && u.pathname === `/api/sales/${HL}/goals/scores/views`;
    if (isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname) && !allowedWrite) writes.push(`${req.method()} ${u.pathname}`);
    const deny = (isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname) && !allowedWrite) || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont && !isCdn);
    if (deny) { blocked.push(`${req.method()} ${u.pathname}`); return route.abort(); }
    return route.continue();
  });
  const page = await ctx.newPage(); page.setDefaultTimeout(25000);
  const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
  await page.goto(`${BASE}/?tab=pipeline&view=priorities`);
  await page.getByLabel('Workspace').waitFor({ timeout: 20000 }); await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
  await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
  await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: /^Pipeline/ }).first().dispatchEvent('click'); await page.waitForTimeout(1200);
  await page.locator('[data-sales-subviews]').getByRole('button', { name: 'Priorities', exact: true }).dispatchEvent('click'); await page.waitForTimeout(1500);
  const view = page.locator('[data-priorities]');
  await view.locator('[data-dot]').first().waitFor({ timeout: 25000 }); await page.waitForTimeout(1200);
  const dotsOnPage = await view.locator('[data-dot]').count();
  const firstLabel = await view.locator('[data-dot]').first().getAttribute('aria-label');
  ok(`browser: the real book renders - ${dotsOnPage} dots on page 1 (= min(40, ${after1.body.counts.ranked})), first dot "${firstLabel}" = the API's #1 (${after1.body.rows[0].name}); no "@" on screen`, dotsOnPage === Math.min(40, after1.body.counts.ranked) && firstLabel.startsWith(after1.body.rows[0].name) && !(await view.innerText()).includes('@'), errors.join(' | '));
  await page.screenshot({ path: `${OUT}/stage4-priorities-1440.png`, animations: 'disabled', caret: 'hide', fullPage: true });
  await view.locator('[data-legend-source="upside"]').click(); await page.waitForTimeout(600);
  const litDots = await view.locator('[data-dot][data-source="upside"]:not([data-dimmed])').count();
  ok(`browser legend Brad / Upside: ${litDots} dots lit on page 1, the rest dimmed, none removed (${await view.locator('[data-dot]').count()} still drawn)`, litDots >= 1 && (await view.locator('[data-dot]').count()) === dotsOnPage);
  await page.screenshot({ path: `${OUT}/stage4-legend-upside-1440.png`, animations: 'disabled', caret: 'hide', fullPage: true });
  await page.getByRole('button', { name: 'Share' }).dispatchEvent('click'); await page.waitForTimeout(400);
  await page.getByRole('textbox', { name: 'View name' }).fill('Zz Stage 4 check');
  const popup = ctx.waitForEvent('page', { timeout: 20000 }).catch(() => null);
  const download = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
  await page.getByRole('button', { name: 'Save view + PNG + CSV' }).click();
  const dl = await download;
  let pngBytes = 0;
  if (dl) { const p = path.join(OUT, 'stage4-share.png'); await dl.saveAs(p); pngBytes = fs.statSync(p).size; }
  const pop = await popup; if (pop) await pop.close().catch(() => {});
  const views = (await real('/scores/views')).body?.views || [];
  const saved = views.find(x => x.name === 'Zz Stage 4 check'); viewId = saved?.id || null;
  const csv = await real('/scores/export.csv');
  fs.writeFileSync(path.join(OUT, 'stage4-priorities.csv'), csv.text);
  const csvLines = csv.text.trim().split('\n');
  ok(`Share: saved view "${saved?.name}" (filters ${JSON.stringify(saved?.filters)}, source upside lit), PNG downloaded (${pngBytes} bytes), CSV through the wiring: ${csvLines.length - 1} rows (= ranked ${after1.body.counts.ranked} + live ${after1.body.counts.live}), header ok, no "@"; files in .screenshots/intent-score-v1/ (not committed)`, !!saved && saved.filters?.source?.includes('upside') && pngBytes > 10000 && csv.code === 200 && csvLines[0].startsWith('Company,Type,Score,Band,Status,Source') && csvLines.length - 1 === after1.body.counts.ranked + after1.body.counts.live && !csv.text.includes('@'), errors.join(' | '));
  if (viewId) { const del = await real(`/scores/views/${viewId}`, 'DELETE'); ok(`saved view deleted through the wiring -> ${del.code}`, del.code === 200); if (del.code === 200) viewId = null; }
  ok(`browser reached 0 Claude / Apollo hosts; every non-GET except the saved-view POST was aborted (${[...new Set(writes)].join(', ') || 'none attempted'}); 0 page errors`, !realCalls.length && writes.every(w => blocked.includes(w)) && !errors.length, errors.join(' | '));
  await ctx.close();

  // 9. Remove the invented rows by id, recompute so nothing stale remains.
  await removeInvented();
  const rc3 = await real('/scores/recompute', 'POST', {});
  const gone = (await real('/scores')).body.rows.some(r => r.name === NAME);
  ok(`invented rows deleted by id; final recompute -> ${rc3.code}, ${rc3.body?.counts?.companies} companies, ${NAME} gone from the ranking`, rc3.code === 200 && rc3.body.counts.companies === expectedCompanies && !gone);
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let line, restored = false;
  try {
    const after = await snapshot();
    const diff = Object.fromEntries(HL_TABLES.filter(t => after[t] !== before[t]).map(t => [t, `${before[t]} -> ${after[t]}`]));
    const expectedKeys = ['sales_company_scores', 'sales_company_score_days', 'business_anthropic_usage'];
    restored = Object.keys(diff).every(k => expectedKeys.includes(k)) && after.business_anthropic_usage - before.business_anthropic_usage === results.claude_calls && after.sales_targets === before.sales_targets && after.web_visits === before.web_visits && after.research_runs === before.research_runs;
    line = restored ? `yes (only the declared growth: ${JSON.stringify(diff)}; every other HomeLover count identical; Jack sign-in row kept by rule, last_seen_at restored)` : `NO - diff ${JSON.stringify(diff)}`;
    results.diff = diff;
  } catch (e) { line = `NO (check failed: ${e.message})`; }
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'stage4-report.json'), JSON.stringify({ ...results, restored, when: new Date().toISOString() }, null, 2));
  console.log(`\nintent-score-v1 Stage 4 live check: ${passed}/${results.checks.length} passed · Claude calls ${results.claude_calls} ($${results.cost_usd}) · Apollo 0\nbands: ${JSON.stringify(results.bands)}\ntop 10: ${(results.top10 || []).join(' | ')}\nrestored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  process.exit(passed === results.checks.length && restored && !results.errors.length ? 0 : 1);
}
