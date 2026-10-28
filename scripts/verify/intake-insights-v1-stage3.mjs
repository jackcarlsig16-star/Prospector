// intake-insights-v1 Stage 3 live check - localhost against the build, as Jack (ownerSession) on HomeLover. DECLARED: exactly
// 1 Claude call - Quick capture > Note > inbox/call-note-test.txt > Read notes (the extract), its reply saved to
// .screenshots/intake-insights-v1/extract-reply.json; every later read (the 390 pass, --replay) is fulfilled from that
// file, 0 calls. Then Cancel - Accept is never sent, nothing is kept. 1440 (section, N2, contrast, axe) + 390; Dashboard
// Overview "Track & improve" + Sources "Channel links" (contrast, axe); a Viewer pass by intercepting /api/me. Every other
// non-GET aborted; 0 Apollo. "restored" THROWS unless every count is identical except business_anthropic_usage, which
// must move by exactly the calls made. ~3 min, cap 280 s. Run npm run build first. Usage: [--replay]
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { ownerSession } from './lib/ownerSession.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const AXE = fs.readFileSync(path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const { measureScript, summarize } = require(ROOT + '/scripts/verify/lib/contrastMeasure.cjs');
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const OUT = path.join(ROOT, '.screenshots', 'intake-insights-v1');
const PORT = 3999, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const SALES = 'cadence_plan call_notes collateral company_score_days company_scores email_activity email_backfill_weeks email_daily_counts email_messages events goals huddles infra_items insight_dismissals insights channel_links lead_uploads mailbox_owners metric_targets metrics_daily month_goals opportunities opportunity_events outreach_campaigns outreach_contacts outreach_events outreach_steps outreach_tracks partner_events people prospect_events prospect_state raw_snapshots sequence_tags sequenced_accounts settings signals source_events stage_marks suggestions sync_runs targets tidy_runs visit_skip week_goal_steps week_goals week_notes week_plans week_report week_report_sections'.split(' ').map(t => `sales_${t}`);
const TABLES = [...SALES, 'web_visits', 'business_anthropic_usage'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const biz = (await svc.from('businesses').select('id, name').ilike('name', '%homelover%')).data;
if (biz?.length !== 1) throw new Error('expected one HomeLover business');
const HL = biz[0].id;
const scoped = new Map();
async function count(t) {
  if (scoped.get(t) !== false) {
    const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL);
    if (!r.error && typeof r.count === 'number') { scoped.set(t, true); return r.count; }
    if (scoped.get(t) === true) throw new Error(`count ${t}: ${r.error?.message || 'no count'}`);
    scoped.set(t, false);
  }
  const r = await svc.from(t).select('*', { count: 'exact', head: true });
  if (r.error || typeof r.count !== 'number') throw new Error(`count ${t}: ${r.error?.message || `no count (HTTP ${r.status})`}`);
  return `${r.count} (whole table)`;
}
const snapshot = async () => { const o = {}; for (const t of TABLES) o[t] = await count(t); return o; };
const marksLeft = async () => { const r = await svc.from('sales_stage_marks').select('id, record_type, record_id, stage, at').eq('business_id', HL); if (r.error) throw new Error(`marks: ${r.error.message}`); return r.data; };
const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
let srv, browser, owner;
const blocked = [], realCalls = [], writes = [];
const REPLAY = process.argv.includes('--replay');
const SAVED = path.join(OUT, 'extract-reply.json');
const CLAUDE_CAP = REPLAY ? 0 : 1;
let extractCalls = 0;
const results = { checks: [], errors: [], axe: {}, contrast: {}, n2: {}, numbers: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 280000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
log('before', JSON.stringify(before));


const NOTES = fs.readFileSync(path.join(ROOT, 'inbox', 'call-note-test.txt'), 'utf8');
if (REPLAY && !fs.existsSync(SAVED)) throw new Error(`--replay needs ${SAVED} from a live run`);
const usageBefore = before.business_anthropic_usage;
try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  async function open(width, { viewer = false, sub = null } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 1000 }, hasTouch: width < 900 });
    await ctx.addInitScript(([k, v, bz, d]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      localStorage.setItem('prospector_goals_owner', 'team');
      for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${bz}`, d);
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HL, today]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (/anthropic\.com$|apollo\.io$/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      if (isLocal && req.method() === 'POST' && /\/goals\/call-notes\/extract$/.test(u.pathname)) {
        // The one declared Claude call: live once (saved), every other time the saved reply.
        if (!REPLAY && extractCalls < CLAUDE_CAP) {
          extractCalls++;
          const r = await route.fetch({ timeout: 120000 });
          const body = await r.text();
          fs.writeFileSync(SAVED, body);
          return route.fulfill({ response: r, body });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: fs.readFileSync(SAVED, 'utf8') });
      }
      const apiWrite = isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname);
      if (apiWrite) writes.push(`${req.method()} ${u.pathname.replace(/[0-9a-f-]{36}/g, ':id')}`);
      const deny = apiWrite || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.pathname}`); return route.abort(); }
      if (viewer && isLocal && u.pathname === '/api/me') {
        const r = await route.fetch(); const j = await r.json();
        j.profile = { ...j.profile, is_platform_owner: false };
        j.memberships = (j.memberships || []).map(m => (m.business_id === HL ? { ...m, role: 'viewer' } : m));
        return route.fulfill({ response: r, json: j });
      }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(30000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    await page.goto(`${BASE}/`);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 30000 }); await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    if (sub) {
      await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: /^Dashboard/ }).first().dispatchEvent('click'); await page.waitForTimeout(1200);
      await page.locator('[data-sales-subviews]').getByRole('button', { name: sub, exact: true }).dispatchEvent('click'); await page.waitForTimeout(2000);
    }
    return { ctx, page, errors };
  }
  const shot = (page, nme) => page.screenshot({ path: `${OUT}/${nme}.png`, animations: 'disabled', caret: 'hide', fullPage: false });
  const measure = async (page, key, scope) => {
    const m = await page.evaluate(measureScript({ scope }));
    if (m.error) { ok(`contrast ${key}`, false, m.error); return; }
    const s = summarize(m); results.contrast[key] = s;
    ok(`contrast ${key}: 0 text < 4.5:1 and 0 controls < 3:1 (text ${s.textFails}/${s.texts}, controls ${s.controlFails}/${s.controls})`, s.textFails === 0 && s.controlFails === 0, s.worst.slice(0, 6).map(w => `${w.ratio} ${w.kind === 'text' ? `T ${w.fg} on ${w.bg}` : `C via ${w.via}`} ${w.sel} "${w.text}"`).join(' | '));
  };
  const axeOn = async (page, key, sel) => {
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async s => { const r = await window.axe.run(document.querySelector(s), { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map(n => n.target.join(' ')) })); }, sel);
    results.axe[key] = v;
    ok(`axe ${key}: ${v.length} violations`, v.length === 0, JSON.stringify(v).slice(0, 300));
  };
  const readNotes = async page => {
    await page.getByRole('button', { name: 'Quick capture' }).click(); await page.waitForTimeout(300);
    await page.getByRole('menuitem', { name: /^Note/ }).click(); await page.waitForTimeout(500);
    await page.getByRole('textbox', { name: 'Call title' }).fill('intake-insights Stage 3 live check');
    await page.getByRole('textbox', { name: 'Call notes', exact: true }).fill(NOTES);
    await page.getByRole('button', { name: 'Read notes' }).click();
    return page.getByRole('region', { name: 'From these notes' });
  };
  // The review's own panel is the scroll box - the section's offset inside it, scroll added back.
  const pageY = loc => loc.evaluate(el => { const p = el.parentElement; return el.getBoundingClientRect().top - p.getBoundingClientRect().top + p.scrollTop; });

  // ---- 1440: the one extract, the section, Cancel.
  {
    const { ctx, page, errors } = await open(1440);
    const sec = await readNotes(page);
    await sec.waitFor({ timeout: 150000 });
    const reply = JSON.parse(fs.readFileSync(SAVED, 'utf8'));
    const ins = reply.insights || {};
    const hide = e => (e.kind === 'person' ? '<person>' : e.name);
    results.numbers.proposed = {
      track: (ins.track || []).map(t => `${t.what}${t.already_field ? ` [already tracked: ${t.already_field}]` : ' [not tracked yet]'}`),
      optimize: (ins.optimize || []).map(o => o.text),
      channel_links: (ins.channel_links || []).map(l => `${hide(l.from)} (${l.from.kind}) -> ${l.relation} -> ${hide(l.to)} (${l.to.kind})${l.date ? ` ${l.date}` : ''}${l.from.match || l.to.match ? ' [matched]' : ''}${l.already_recorded ? ' [already recorded]' : ''}`),
    };
    log('PROPOSED', JSON.stringify(results.numbers.proposed, null, 1));
    const groups = await sec.locator('[data-insight-group]').allTextContents();
    const want = [['Track', ins.track], ['Optimize', ins.optimize], ['Channel links', ins.channel_links]].filter(([, l]) => (l || []).length).map(([k, l]) => `${k} · ${l.length}`);
    ok(`1440 the extract (${REPLAY ? 'replayed' : 'live, 1 Claude call'}) -> "From these notes" ${groups.join(' / ')} = the reply's lists; no "@" in the reply`, JSON.stringify(groups) === JSON.stringify(want) && !JSON.stringify(ins).includes('@'));
    await sec.scrollIntoViewIfNeeded();
    await shot(page, 'from-these-notes-1440');
    const top0 = await pageY(sec);
    const box = sec.locator('[role="checkbox"], input[type="checkbox"], button[aria-pressed]').first();
    if (await box.count()) { await box.click(); await page.waitForTimeout(200); await box.click(); await page.waitForTimeout(200); }
    const top1 = await pageY(sec);
    results.n2.section = Math.abs(top1 - top0);
    ok(`N2 1440: toggling a Keep box moves nothing above the section (${results.n2.section} px)`, results.n2.section === 0);
    await measure(page, 'from-these-notes@1440', '[aria-label="From these notes"]');
    await axeOn(page, 'from-these-notes@1440', '[aria-label="From these notes"]');
    await page.getByRole('button', { name: 'Cancel' }).first().click(); await page.waitForTimeout(800);
    ok(`Cancel closes the review; Accept never sent (${writes.filter(w => /call-notes$/.test(w)).length}); 0 page errors`, (await page.getByRole('region', { name: 'From these notes' }).count()) === 0 && !writes.some(w => /call-notes$/.test(w)) && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- 390: the saved reply (no second call), the section on a phone.
  {
    const { ctx, page, errors } = await open(390);
    const sec = await readNotes(page);
    await sec.waitFor({ timeout: 60000 });
    await shot(page, 'from-these-notes-390');
    ok(`390 the section renders from the saved reply (Claude calls so far ${extractCalls}); no sideways page scroll; 0 page errors`, extractCalls <= CLAUDE_CAP && (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)) && !errors.length, errors.join(' | '));
    await measure(page, 'from-these-notes@390', '[aria-label="From these notes"]');
    await ctx.close();
  }
  // ---- Dashboard: Track & improve (Overview), Channel links (Sources); Viewer.
  {
    const { ctx, page, errors } = await open(1440, { sub: 'Overview' });
    const card = page.getByRole('region', { name: 'Track & improve' });
    await card.waitFor({ timeout: 30000 }); await page.waitForTimeout(800);
    const before = await page.locator('[data-track-improve]').evaluate(el => el.previousElementSibling ? 'after a sibling' : 'first');
    await card.scrollIntoViewIfNeeded(); await shot(page, 'track-improve-1440');
    ok(`Overview: Track & improve renders (${await card.innerText().then(t => t.split('\n').slice(0, 3).join(' | '))}) ${before}`, true);
    await measure(page, 'track-improve@1440', '[data-track-improve]');
    await axeOn(page, 'track-improve@1440', '[data-track-improve]');
    await ctx.close();
    const s = await open(1440, { sub: 'Sources' });
    const links = s.page.getByRole('region', { name: 'Channel links' });
    await links.waitFor({ timeout: 60000 }); await s.page.waitForTimeout(800);
    await links.scrollIntoViewIfNeeded(); await shot(s.page, 'channel-links-1440');
    ok(`Sources: Channel links renders (${(await links.innerText()).split('\n')[0]}); 0 page errors`, !s.errors.length && !errors.length, [...errors, ...s.errors].join(' | '));
    await measure(s.page, 'channel-links@1440', '[data-channel-links]');
    await axeOn(s.page, 'channel-links@1440', '[data-channel-links]');
    await s.ctx.close();
    const v = await open(1440, { viewer: true, sub: 'Overview' });
    const vc = v.page.getByRole('region', { name: 'Track & improve' });
    await vc.waitFor({ timeout: 30000 });
    ok(`Viewer: Track & improve reads, no status picker (${await vc.getByRole('combobox').count()}); 0 page errors`, (await vc.getByRole('combobox').count()) === 0 && !v.errors.length, v.errors.join(' | '));
    await v.ctx.close();
  }
  ok(`Claude calls ${extractCalls} <= declared ${CLAUDE_CAP}; 0 Apollo; every other non-GET aborted (${[...new Set(writes)].join(', ') || 'none attempted'})`, extractCalls <= CLAUDE_CAP && !realCalls.length && writes.every(w => blocked.some(b => b.startsWith(w.split(' ')[0]))));
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try {
    const after = await snapshot();
    const usageDelta = (Number(after.business_anthropic_usage) || 0) - (Number(usageBefore) || 0);
    const moved = TABLES.filter(t => t !== 'business_anthropic_usage' && before[t] !== after[t]).map(t => `${t} ${before[t]} -> ${after[t]}`);
    if (moved.length) throw new Error(`counts moved: ${moved.join(', ')}`);
    if (usageDelta !== extractCalls) throw new Error(`business_anthropic_usage moved ${usageDelta}, declared ${extractCalls}`);
    restored = true; line = `yes (${TABLES.length - 1} table counts identical; business_anthropic_usage +${usageDelta} = the ${extractCalls} declared call; nothing kept; sign-in row kept by rule, profile last_seen_at restored)`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'stage3-report.json'), JSON.stringify({ ...results, extractCalls, replay: REPLAY, restored, when: new Date().toISOString() }, null, 2));
  console.log(`\nintake-insights-v1 Stage 3 live check: ${passed}/${results.checks.length} passed · Claude ${extractCalls} (cap ${CLAUDE_CAP}${REPLAY ? ', replay' : ''}) · Apollo 0 · writes 0 (Accept never sent)\nrestored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
