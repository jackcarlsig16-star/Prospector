// lead-upload-v1 Stage 3 live check - Sales > Intake > Lead list on localhost against the build.
// SCOPE (declared):
//  A. As Jack (ownerSession: magic-link session, no email sent; his sign-in rows are KEPT by rule, last_seen_at restored)
//     on the REAL HomeLover workspace: READ-ONLY except EXACTLY ONE Claude call = the browser's POST /goals/leads/extract
//     on inbox/2026-10-26-1130-apollo-leads-sample.txt with source Apollo (MODELS.STANDARD, ~8k max tokens; its cost is
//     read back from business_anthropic_usage, call_type lead_upload, and printed). The review is shown, then Cancel.
//     NOTHING is filed: POST /goals/leads is aborted in the browser if it is ever sent, every other non-GET to /api,
//     /proxy and Supabase REST is aborted, and every outside host except Supabase + Google Fonts is blocked (an attempt
//     at an Anthropic / Apollo / Gmail host from the browser fails the run). The 390 review re-uses the 1440 reply
//     (route.fulfill) - 0 extra calls. HomeLover sales_* counts are compared before / after (must be identical);
//     business_anthropic_usage is expected to grow by exactly 1.
//  B. Viewer pass: Jack's own session on HomeLover with GET /api/me answered by the real reply edited to
//     is_platform_owner false + the HomeLover membership role 'viewer' (route.fulfill) - the payload SalesAnalyticsTab,
//     QuickCapture and TaskDrawer read canEdit from. No temp workspace, no temp user, no prod writes at all
//     (FIX verify-no-temp-workspace-v1); the route 403 is a node test in api/sales/leadUpload.test.mjs. 0 Claude /
//     0 Apollo there.
//  The pasted list is never printed or stored; the report carries company names, counts, kinds, chips only.
//  restored = HomeLover sales_* counts identical before / after AND businesses named 'ZZ%' = 0 before and after. A
//  count() that errors or returns no number (a missing table is a 204 with count null, no error) THROWS: the line reads "restored: NO (check failed: ...)" and the exit code is 1 - a check
//  that cannot fail is not a check (the Oct 26 leftover workspace passed as "0 rows" that way).
//  Runtime ~2-3 min, hard cap 300 s. Shots + report: .screenshots/lead-upload-v1/. Run npm run build first.
//  --replay: the saved reply from an earlier real run (<outdir>/extract-reply.json) answers the extract in the
//  browser - 0 Claude calls; the usage check then expects +0. The saved file holds the model's companies and people;
//  the cross-check (match, owner chip, source, defaults) is recomputed here from live HomeLover rows through the
//  real leadUploadMatch code (service-key READS only), so a matcher change shows in the replayed review.
// Usage: node scripts/verify/lead-upload-v1-stage3.mjs [outdir] [--replay]
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { ownerSession } from './lib/ownerSession.mjs';
import { toLeads, crossCheck, loadLeadContext } from '../../api/sales/leadUploadMatch.js';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const { measureScript, summarize, formatWorst } = require(ROOT + '/scripts/verify/lib/contrastMeasure.cjs');
const OUT = process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(ROOT, '.screenshots', 'lead-upload-v1');
const REPLAY = process.argv.includes('--replay');
const REPLY_FILE = path.join(OUT, 'extract-reply.json');
const SAMPLE = path.join(ROOT, 'inbox', '2026-10-26-1130-apollo-leads-sample.txt');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3991, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const HL = ['sales_goals', 'sales_opportunities', 'sales_targets', 'sales_people', 'sales_lead_uploads', 'sales_source_events', 'sales_partner_events', 'partner_contacts', 'sales_week_goals', 'research_runs'];
const ADDRESS = /[^\s@<>()"']+@[^\s@<>()"']+\.[a-z]{2,}/i;
const PHONE = /\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/;
const DRAWER = 'aside[aria-labelledby="task-drawer-title"]';
const count = async (t, col, v, extra) => { let q = svc.from(t).select('*', { count: 'exact', head: true }).eq(col, v); if (extra) q = extra(q); const r = await q; if (r.error || typeof r.count !== 'number') throw new Error(`count ${t}: ${r.error?.message || `no count (HTTP ${r.status})`}`); return r.count; };
const hlCounts = async () => { const o = {}; for (const t of HL) o[t] = await count(t, 'business_id', HOMELOVER); return o; };
const zzCount = async (t = 'businesses') => { const r = await svc.from(t).select('*', { count: 'exact', head: true }).like('name', 'ZZ%'); if (r.error || typeof r.count !== 'number') throw new Error(`count ${t} 'ZZ%': ${r.error?.message || `no count (HTTP ${r.status})`}`); return r.count; };
const usageCount = () => count('business_anthropic_usage', 'business_id', HOMELOVER, q => q.eq('call_type', 'lead_upload'));
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);

const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
if (!fs.existsSync(SAMPLE)) { console.log('ABORT: the Apollo sample is not in inbox/'); process.exit(1); }
const sampleText = fs.readFileSync(SAMPLE, 'utf8');

let srv, browser, owner, meEdits = 0;
const blocked = [], realCalls = [], leadPosts = { extract: 0, file: 0 };
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  if (owner) { log(await owner.release()); owner = null; }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 300000 });
const laToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
fs.mkdirSync(OUT, { recursive: true });
const hlBefore = await hlCounts();
const zzBefore = await zzCount();
const usageBefore = await usageCount();
log('HomeLover before', JSON.stringify(hlBefore), `lead_upload usage rows ${usageBefore}`, `'ZZ%' businesses ${zzBefore}`);
const results = { screens: {}, checks: [], errors: [], review: null, calls: null };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${detail}` : ''); };
const MEASURE = measureScript({ scope: DRAWER });
const BOXES = `(() => Object.fromEntries(['data-workspace-header', 'data-sales-tabrow', 'data-sales-subviews', 'data-sales-frame'].map(a => {
  const el = document.querySelector('[' + a + ']'); if (!el) return [a, null];
  const r = el.getBoundingClientRect(); return [a, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }];
})))()`;
const maxMove = (a, b, keys) => Math.max(...keys.map(k => (a[k] && b[k] ? Math.max(Math.abs(a[k].x - b[k].x), Math.abs(a[k].y - b[k].y), Math.abs(a[k].h - b[k].h)) : 0)));
let extractReply = null;
if (REPLAY) {
  if (!fs.existsSync(REPLY_FILE)) { console.log(`ABORT: --replay needs ${REPLY_FILE} from a real run`); process.exit(1); }
  const saved = JSON.parse(fs.readFileSync(REPLY_FILE, 'utf8'));
  const ctx = await loadLeadContext(svc, HOMELOVER);
  const categories = [...new Set(ctx.partners.map(p => p.category).filter(Boolean))].sort();
  const leads = toLeads({
    companies: saved.companies.map(({ name, domain, employees, hq, kind_guess, category, evidence }) => ({ name, domain, employees, hq, kind_guess, category, evidence })),
    people: saved.companies.flatMap(c => c.people.map(({ name, title, location, linkedin_url, why }) => ({ name, title, location, linkedin_url, why, company: c.name }))),
  }, categories);
  extractReply = JSON.stringify({ ...saved, companies: crossCheck(leads, ctx), people_count: leads.people_count, earlier: null });
  log('REPLAY: the saved model reply + a live cross-check answer the extract, 0 Claude calls');
}

try {
  const { data: hlRow } = await svc.from('businesses').select('name').eq('id', HOMELOVER).single();
  const HL_NAME = hlRow.name;
  owner = await ownerSession(svc);

  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  const today = laToday();

  // One context per pass. who = { session, name }; wsName = the workspace to open; real = the one extract may pass;
  // viewer = GET /api/me is answered as a plain viewer of bizId (the real reply, edited in flight).
  async function newPage(who, wsName, bizId, { width = 1440, height = 900, real = false, viewer = false } = {}) {
    const errs = [];
    const ctx = await browser.newContext({ viewport: { width, height } });
    await ctx.addInitScript(([k, v, b, d]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      for (const n of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${n}_ran_${b}`, d);
      localStorage.setItem('prospector_auto_assay_disabled', '1'); localStorage.setItem('prospector_goals_owner', 'team');
    }, [`sb-${REF}-auth-token`, JSON.stringify(who.session), bizId, today]);
    const BLOCK = /\/proxy\/(anthropic|gmail|gcal)|\/api\/(gmail|google|microsoft)\b|\/api\/sales\/[^/]+\/(sync|apollo)|\/apollo-check|\/visits\/pull|\/tidy\/run|\/research/;
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (/anthropic\.com$|apollo\.io$|gmail\.googleapis\.com$/.test(u.host) || (u.host === 'www.googleapis.com' && u.pathname.startsWith('/gmail'))) realCalls.push(`${req.method()} ${u.host}${u.pathname}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      if (viewer && isLocal && req.method() === 'GET' && u.pathname === '/api/me') {
        const r = await route.fetch(); const me = await r.json();
        me.profile.is_platform_owner = false;
        me.memberships = me.memberships.map(m => m.business_id === bizId ? { ...m, role: 'viewer' } : m);
        meEdits++;
        return route.fulfill({ response: r, body: JSON.stringify(me) });
      }
      if (isLocal && req.method() === 'POST' && /\/goals\/leads\/extract$/.test(u.pathname)) {
        // The real-call guard: the ONE declared extract passes (as Jack, 1440); a repeat is answered from its reply.
        if (real && !REPLAY && leadPosts.extract === 0) { leadPosts.extract++; return route.continue(); }
        if (extractReply) return route.fulfill({ status: 200, contentType: 'application/json', body: extractReply });
        blocked.push(`${req.method()} ${u.pathname}`); return route.abort();
      }
      if (isLocal && req.method() === 'POST' && /\/goals\/leads$/.test(u.pathname)) { leadPosts.file++; blocked.push(`${req.method()} ${u.pathname}`); return route.abort(); }
      const deny = (isLocal && (BLOCK.test(u.pathname) || (req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname) && !/^\/api\/me\b/.test(u.pathname))))
        || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/'))
        || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.host}${u.pathname}`); return route.abort(); }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', e => errs.push(`PAGE ${who.name}@${width}: ${e.message.slice(0, 160)}`));
    page.on('response', async r => { if (real && r.request().method() === 'POST' && /\/goals\/leads\/extract$/.test(r.url()) && r.status() === 200) extractReply = await r.text(); });
    await page.goto(`${BASE}/`);
    await page.locator('#main-content').getByText(wsName).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').selectOption({ label: wsName }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    const api = (bb, p, opts) => page.evaluate(async ([b2, pp, o]) => { const r = await fetch(`/api/sales/${b2}/goals${pp}`, o ? { method: o.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o.body || {}) } : undefined); const t = await r.text(); let body; try { body = JSON.parse(t); } catch { body = t; } return { status: r.status, body }; }, [bb, p, opts || null]);
    return { page, errs, api, ctx };
  }
  const tab = async (page, label) => { await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: new RegExp(`^${label}`) }).first().dispatchEvent('click'); await page.waitForTimeout(1200); };
  const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide', fullPage: false });
  const measure = async (page, key) => {
    const m = await page.evaluate(MEASURE);
    if (m.error) { results.errors.push(`${key}: ${m.error}`); return null; }
    const s = summarize(m); results.screens[key] = { ...s, scrollW: m.scrollW, vw: m.vw };
    log(key, `text ${s.textFails}/${s.texts}`, `controls ${s.controlFails}/${s.controls}`, `scroll ${m.scrollW}/${m.vw}`);
    if (s.textFails || s.controlFails) log(formatWorst(key, s));
    return s;
  };
  const openDrawer = async page => {
    await tab(page, 'Actions');
    await page.getByRole('button', { name: /^(Open tasks|Tasks)/ }).first().click();
    const drawer = page.locator(DRAWER); await drawer.waitFor(); await page.waitForTimeout(600);
    return drawer;
  };
  // Paste notes -> Lead list -> paste + Apollo + note -> Read list; resolves when the review shows.
  const runReview = async (page, drawer) => {
    await drawer.getByRole('button', { name: '📝 Paste notes' }).click(); await page.waitForTimeout(400);
    await drawer.getByRole('button', { name: 'Lead list' }).click(); await page.waitForTimeout(300);
    await drawer.getByRole('textbox', { name: 'Lead list' }).fill(sampleText);
    await drawer.getByLabel('Where did these leads come from?').selectOption('apollo');
    await drawer.getByLabel('Upload note').fill('Apollo recommended, Oct 26');
    await drawer.getByRole('button', { name: 'Read list' }).click();
    await drawer.getByText('Review · nothing is saved until File leads').waitFor({ timeout: 120000 });
    await page.waitForTimeout(600);
  };

  // ---- A. Jack, 1440, real HomeLover: the one real read.
  const J = await newPage(owner, HL_NAME, HOMELOVER, { real: true });
  const box0 = await J.page.evaluate(BOXES);
  const drawer = await openDrawer(J.page);
  await drawer.getByRole('button', { name: '📝 Paste notes' }).click(); await J.page.waitForTimeout(400);
  ok('S1: the switch "Call notes | Lead list" shows above the notes dropdown, Call notes pressed', (await drawer.getByRole('button', { name: 'Call notes' }).getAttribute('aria-pressed')) === 'true' && (await drawer.getByLabel('What these notes are').count()) === 1);
  await drawer.getByRole('button', { name: 'Lead list' }).click(); await J.page.waitForTimeout(300);
  ok('S1: Lead list swaps the dropdown for the required source picker; Read list is off until a source is picked; .vtt hidden', (await drawer.getByLabel('What these notes are').count()) === 0 && (await drawer.getByLabel('Where did these leads come from?').getAttribute('required')) !== null && (await drawer.getByRole('button', { name: 'Read list' }).isDisabled()) && (await drawer.getByLabel('Upload lead list file').getAttribute('accept')) === '.txt,.md,.docx');
  await drawer.getByRole('textbox', { name: 'Lead list' }).fill(sampleText);
  await drawer.getByLabel('Where did these leads come from?').selectOption('apollo');
  await drawer.getByLabel('Upload note').fill('Apollo recommended, Oct 26');
  await measure(J.page, 'lead-form@1440'); await shot(J.page, 'lu3-form-1440');
  const t1 = Date.now();
  await drawer.getByRole('button', { name: 'Read list' }).click();
  await drawer.getByText('Review · nothing is saved until File leads').waitFor({ timeout: 120000 });
  await J.page.waitForTimeout(800);
  log(`review shown after ${Math.round((Date.now() - t1) / 1000)}s`);
  ok(REPLAY ? 'replay: the saved reply filled the review (0 calls)' : 'the ONE real read reached the server and the review is shown', (REPLAY ? leadPosts.extract === 0 : leadPosts.extract === 1) && !!extractReply);
  if (!REPLAY && extractReply) fs.writeFileSync(REPLY_FILE, extractReply);
  const reply = JSON.parse(extractReply || '{}');
  const groups = (reply.companies || []).map(c => ({ name: c.name, people: c.people.length, kind: c.kind, kind_guess: c.kind_guess, status: c.status, action: c.action, chip: c.chip?.text || null, existing_source: c.existing_source || null, already_in: c.people.filter(p => p.already_in).length, employees: c.employees }));
  results.review = { companies: groups.length, people: reply.people_count, groups, usage: reply.usage, earlier: reply.earlier ? { created_at: reply.earlier.created_at, counts: reply.earlier.counts } : null };
  log('REVIEW', JSON.stringify(results.review));
  ok(`review: 7 companies / 10 people grouped (got ${groups.length} / ${reply.people_count})`, groups.length === 7 && reply.people_count === 10);
  const gal = groups.find(g => /gallagher/i.test(g.name));
  ok('Gallagher is suggested as a partner (broker)', !!gal && (gal.kind === 'partner'), JSON.stringify(gal));
  ok('TJX and American Family each have 2 people under one company row', groups.filter(g => /tjx|american family/i.test(g.name) && g.people === 2).length === 2, groups.filter(g => g.people > 1).map(g => `${g.name}:${g.people}`).join(', '));
  const upside = groups.filter(g => /upside/i.test(g.chip || ''));
  ok(`ownership chips: ${upside.length} Upside-owned / shared (default Skip on owned); every chip text comes from ownershipChip`, upside.every(g => (/^Upside owns this/.test(g.chip) ? g.action === 'skip' : true)), upside.map(g => `${g.name}: ${g.chip} -> ${g.action}`).join('; ') || 'none');
  const existing = groups.filter(g => g.status !== 'new');
  log('existing matches:', existing.map(g => `${g.name} = ${g.status}${g.existing_source ? ` (source ${g.existing_source})` : ''}${g.already_in ? ` already_in ${g.already_in}` : ''}`).join('; ') || 'none');
  // Rows on screen match the reply; the drawer text carries no address and no phone number.
  const rowCount = await drawer.locator('[data-lead-company]').count();
  ok(`S4: one review row per company (${rowCount})`, rowCount === groups.length);
  const drawerText = await drawer.innerText();
  ok('no email address or phone number anywhere in the review (titles like "VP HR @Company" allowed)', !ADDRESS.test(drawerText) && !PHONE.test(drawerText));
  const status = await drawer.getByRole('status').innerText();
  ok(`footer counts: "${status.trim()}"`, /^Create \d+ compan(y|ies) · add \d+ (person|people) · skip \d+$/.test(status.trim()));
  // FIX dupe-generic-words-v1: HPE is no longer "Looks like Enterprise"; the rest of the review is unchanged.
  const hpe = groups.find(g => /hewlett packard/i.test(g.name));
  ok('FIX dupe-generic-words: Hewlett Packard Enterprise = New -> Create, no reason', !!hpe && hpe.status === 'new' && hpe.action === 'create' && (await drawer.locator('[data-lead-company="Hewlett Packard Enterprise"]').getByText(/^Skipped:/).count()) === 0, JSON.stringify(hpe));
  const byName = re => groups.find(g => re.test(g.name)) || {};
  ok('unchanged: Gallagher Skip (Upside chip), American Family + Apple Add people; footer "Create 4 companies · add 8 people · skip 1"', byName(/gallagher/i).action === 'skip' && /^Upside owns this/.test(byName(/gallagher/i).chip || '') && byName(/american family/i).action === 'add_people' && byName(/^apple$/i).action === 'add_people' && status.trim() === 'Create 4 companies · add 8 people · skip 1', status.trim());
  const dc = await J.api(HOMELOVER, '/partners/dupe-check?name=Hewlett%20Packard%20Enterprise');
  ok('dupe-check route on HomeLover: Hewlett Packard Enterprise -> exact [] partial []', dc.status === 200 && Array.isArray(dc.body.exact) && !dc.body.exact.length && Array.isArray(dc.body.partial) && !dc.body.partial.length, JSON.stringify(dc.body).slice(0, 200));
  ok('S4: a Create row shows kind, Owner (Me) and Research now; a matched row offers Add people / Skip only', (await drawer.locator('[data-lead-company] select[aria-label^="Kind of"]').count()) === groups.filter(g => g.action === 'create').length && (await drawer.getByRole('button', { name: 'Create' }).count()) === groups.filter(g => !g.status.match(/^(partner|employer|target)$/)).length);
  const box1 = await J.page.evaluate(BOXES);
  const mv = maxMove(box0, box1, ['data-workspace-header', 'data-sales-tabrow', 'data-sales-subviews', 'data-sales-frame']);
  ok(`N2 1440: header, tab row, sub-views and frame don't move with the drawer + review open (max ${mv} px)`, mv <= 1);
  await measure(J.page, 'lead-review@1440'); await shot(J.page, 'lu3-review-1440');
  // Cancel: nothing filed.
  await drawer.getByRole('button', { name: 'Cancel' }).click(); await J.page.waitForTimeout(600);
  ok('Cancel: back to the tasks list, no File request was ever sent', (await drawer.getByRole('button', { name: '📝 Paste notes' }).count()) === 1 && leadPosts.file === 0);
  await J.ctx.close();

  // ---- A2. Jack, 390: the same review from the cached reply (0 calls).
  const P = await newPage(owner, HL_NAME, HOMELOVER, { width: 390, height: 844 });
  const pd = await openDrawer(P.page);
  await runReview(P.page, pd);
  await measure(P.page, 'lead-review@390'); await shot(P.page, 'lu3-review-390');
  ok('390: the review renders without sideways scroll', (await P.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)) && (await pd.locator('[data-lead-company]').count()) === groups.length);
  await pd.getByRole('button', { name: 'Cancel' }).click(); await P.page.waitForTimeout(300);
  await P.ctx.close();

  // ---- B. Viewer: Jack's session, /api/me answered as a HomeLover viewer; no upload control anywhere.
  const V = await newPage(owner, HL_NAME, HOMELOVER, { viewer: true });
  try {
    await tab(V.page, 'Actions');
    await V.page.getByRole('button', { name: /^(Open tasks|Tasks)/ }).first().click();
    const vd = V.page.locator(DRAWER); await vd.waitFor(); await V.page.waitForTimeout(500);
    ok(`Viewer (edited /api/me, ${meEdits} replies): the drawer opens read-only - no Paste notes button, no Quick capture "+"`, meEdits > 0 && (await vd.getByRole('button', { name: '📝 Paste notes' }).count()) === 0 && (await V.page.locator('[data-capture-button]').count()) === 0);
    await measure(V.page, 'viewer-drawer@1440');
  } catch (e) { results.errors.push(`viewer: ${e.message}`); ok('Viewer pass ran', false, e.message.slice(0, 120)); }
  await V.ctx.close();

  const fails = Object.entries(results.screens).filter(([, s]) => s.textFails || s.controlFails);
  ok(`ui-clarity measure: 0 failures on ${Object.keys(results.screens).length} screens`, !fails.length, JSON.stringify(fails.map(([k, s]) => [k, s.textFails, s.controlFails])));
  const errs = [...J.errs, ...P.errs, ...V.errs];
  ok('No page errors', !errs.length, JSON.stringify(errs.slice(0, 5)));
  const usageAfter = await usageCount();
  const { data: usageRow } = await svc.from('business_anthropic_usage').select('model, input_tokens, output_tokens, cost_usd, created_at').eq('business_id', HOMELOVER).eq('call_type', 'lead_upload').order('created_at', { ascending: false }).limit(1);
  results.calls = { claude: usageAfter - usageBefore, usage: REPLAY ? null : usageRow?.[0] || null, apollo: 0, blocked: blocked.length, real_hosts: realCalls.length, lead_posts: leadPosts };
  const want = REPLAY ? 0 : 1;
  ok(`real-call guard: exactly ${want} Claude call${want === 1 ? '' : 's'} (usage rows +${usageAfter - usageBefore}${want ? `, $${usageRow?.[0]?.cost_usd ?? '?'}` : ''}), 0 File posts, 0 requests to Anthropic / Apollo / Gmail hosts from the browser`, usageAfter - usageBefore === want && leadPosts.file === 0 && !realCalls.length, JSON.stringify(results.calls));
} catch (e) {
  results.errors.push(e.stack || e.message);
  log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try {
    const hlAfter = await hlCounts();
    const zzAfter = await zzCount();
    restored = JSON.stringify(hlBefore) === JSON.stringify(hlAfter) && zzBefore === 0 && zzAfter === 0;
    line = restored
      ? `yes (HomeLover sales_* counts identical; 'ZZ%' businesses ${zzBefore} -> ${zzAfter}; business_anthropic_usage +${results.calls?.claude ?? '?'} declared; Jack sign-in rows kept by rule)`
      : `NO - HomeLover ${JSON.stringify(hlBefore)} -> ${JSON.stringify(hlAfter)}; 'ZZ%' businesses ${zzBefore} -> ${zzAfter}`;
  } catch (e) { line = `NO (check failed: ${e.message})`; }
  results.restored = restored;
  const pass = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'lead-upload-v1-stage3.json'), JSON.stringify(results, null, 2));
  console.log(`\n${pass}/${results.checks.length} checks passed${results.errors.length ? ` · ${results.errors.length} errors` : ''} · Claude ${results.calls?.claude ?? '?'} ($${results.calls?.usage?.cost_usd ?? '?'})`);
  for (const e of results.errors) console.log('ERROR:', e.split('\n').slice(0, 3).join(' | '));
  console.log(`restored: ${line}`);
  process.exit(restored ? 0 : 1);
}
