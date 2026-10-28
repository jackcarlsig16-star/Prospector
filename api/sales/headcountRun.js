import { apolloRequest, apolloBalance } from './apolloClient.js';
import { getSupabase } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { laDateString } from './laDate.js';
import { cleanText } from './scrubText.js';
import { hasRole } from '../lib/requireAuth.js';
import { monthSpend, MONTHLY_CREDIT_CAP, PAUSED } from './visitPull.js';
import { scheduleRecompute } from './intentScoreRun.js';
import { runFill, candidateOrder, nameSearchRequest, enrichRequest, fillLine, NAME_SEARCH_DAILY_CAP, PAGE_LOAD_LOOKUPS, ENRICH_PATH } from './headcountFill.js';
import { wholeNumber } from './companyFields.js';

// FIX headcount-auto-v1 REV2 Stage 2 - the runner behind headcountFill.js (H3-H7): gathers every company without a
// headcount, runs the free paths first (a name search finds the domain - 0 credits; Research's number fills), then the
// enrich lookup under today's N (sales_settings.headcount_daily_credits) and the SAME monthly ledger as the visitor pull
// (apollo_credit_spend: every run records its MEASURED delta, even 0; the 500 is one number across pull + headcount).
// Each enrich is followed by a balance read, so the first call whose delta is not 0 stops the run and the Needs
// attention line says so. Triggers: "Fill headcounts" (owner / admin, POST goals/headcount/fill), first sight of a
// company (scheduleFirstSight: H3 only, no lookup inside a create), the page-load recomputeIfStale hook (H3 + at most
// PAGE_LOAD_LOOKUPS). State lives under sales_settings.visitor_filters.headcount (jsonb; no migration).
export const STATE_KEY = 'headcount';
const TABLE = { partner: 'sales_goals', employer: 'sales_opportunities', target: 'sales_targets' };
const reply = (status, body) => ({ status, body });
const send = (res, r) => res.status(r.status).json(r.body);
const must = r => { if (r.error) throw Object.assign(new Error(r.error.message), { status: 500 }); return r.data; };
const inFlight = new Map();

export const stateOf = settings => ({ ...((settings?.visitor_filters || {})[STATE_KEY] || {}) });
async function loadSettings(supabase, businessId) {
  const { data, error } = await supabase.from('sales_settings').select('*').eq('business_id', businessId).maybeSingle();
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  return { headcount_daily_credits: 25, ...(data || {}) };
}
async function saveState(supabase, businessId, settings, patch) {
  const next = { ...(settings.visitor_filters || {}), [STATE_KEY]: { ...stateOf(settings), ...patch } };
  must(await supabase.from('sales_settings').upsert({ business_id: businessId, visitor_filters: next, updated_at: new Date().toISOString() }, { onConflict: 'business_id' }));
  settings.visitor_filters = next;
  return next[STATE_KEY];
}

// Every live company in the one shape the pure module reads: { key, type, id, name, domain, domain_source, employees,
// employees_source, created_at }. A partner's domain = company_domain or a confirmed partner_domains row.
export async function gatherCandidates(supabase, businessId, { only = null, since = null } = {}) {
  // sales_company_scores has a composite key (business, type, id) and no id column - it orders by company_id.
  const all = (t, cols, build = x => x, orderBy = 'id') => selectAllPages(() => build(supabase.from(t).select(cols).eq('business_id', businessId)).order(orderBy));
  const [partners, opps, targets, pdomains, scores, research] = await Promise.all([
    all('sales_goals', 'id, name, employees, employees_source, company_domain, created_at', x => x.eq('goal_type', 'partnership').is('archived_at', null)),
    all('sales_opportunities', 'id, organization, employees, employees_source, domain, domain_source, created_at', x => x.is('archived_at', null)),
    all('sales_targets', 'id, name, employees, employees_source, domain, domain_source, created_at, status', x => x.neq('status', 'rejected')),
    all('partner_domains', 'goal_id, domain, confirmed, is_primary'),
    all('sales_company_scores', 'company_type, company_id, band', x => x, 'company_id'),
    all('research_runs', 'entity_type, entity_id, result, created_at', x => x.eq('status', 'done')),
  ]);
  const confirmed = new Map();
  for (const d of pdomains.filter(d => d.confirmed).sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0))) if (!confirmed.has(d.goal_id)) confirmed.set(d.goal_id, d.domain);
  const latest = new Map();
  for (const r of [...research].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))) { const k = `${r.entity_type}-${r.entity_id}`; if (!latest.has(k)) latest.set(k, r.result || {}); }
  let records = [
    ...partners.map(p => ({ key: `partner-${p.id}`, type: 'partner', id: p.id, name: p.name, domain: p.company_domain || confirmed.get(p.id) || null, domain_source: p.company_domain ? 'manual' : confirmed.has(p.id) ? 'people' : null, employees: p.employees, employees_source: p.employees_source, created_at: p.created_at })),
    ...opps.map(o => ({ key: `employer-${o.id}`, type: 'employer', id: o.id, name: o.organization, domain: o.domain, domain_source: o.domain_source, employees: o.employees, employees_source: o.employees_source, created_at: o.created_at })),
    ...targets.map(t => ({ key: `target-${t.id}`, type: 'target', id: t.id, name: t.name, domain: t.domain, domain_source: t.domain_source, employees: t.employees, employees_source: t.employees_source, created_at: t.created_at })),
  ];
  if (only) records = records.filter(r => r.type === only.type && r.id === only.id);
  if (since) records = records.filter(r => String(r.created_at || '') > since);
  return { records, scores: new Map(scores.map(s => [`${s.company_type}-${s.company_id}`, { band: s.band }])), research: latest, partnerDomains: pdomains };
}

async function applyWrites(supabase, businessId, item, record, partnerDomains, now) {
  const { domain, domain_source, domain_at, ...rest } = item.writes;
  const patch = { ...rest };
  if (record.type !== 'partner' && domain) Object.assign(patch, { domain, domain_source, domain_at });
  if (Object.keys(patch).length) must(await supabase.from(TABLE[record.type]).update({ ...patch, updated_at: now.toISOString() }).eq('business_id', businessId).eq('id', record.id));
  // H2: a partner found by the name search gets its domain as a partner_domains suggestion (confirmed false), as partner-360 does.
  if (record.type === 'partner' && domain && !partnerDomains.some(d => d.goal_id === record.id && d.domain === domain)) {
    must(await supabase.from('partner_domains').insert({ business_id: businessId, goal_id: record.id, domain, source: 'apollo', confirmed: false, is_primary: false }));
  }
}

// -> { ran: true, line, counts, calls, credits, balance_before, balance_after, filled: [{ name, employees, source, domain }], paused }
//    | { ran: false, reason } | an error reply. Never throws.
export async function runHeadcountFill(supabase, { businessId, userId = null, trigger = 'manual', maxLookups = null, maxNameSearches = null, only = null, onlyNew = false, now = Date.now() }) {
  const today = laDateString(new Date(now)), laMonth = today.slice(0, 7), at = new Date(now);
  let settings;
  try { settings = await loadSettings(supabase, businessId); } catch (e) { return reply(e.status || 500, { error: e.message }); }
  const state = stateOf(settings);
  if (trigger !== 'manual' && state.charged) return reply(200, { ran: false, reason: state.charged.message });
  const ctx = { callCounter: { count: 0, max: 0 }, endpointCounts: {} };
  let before = null, lastBalance = null, after = null, credits = 0;
  try {
    const monthSpent = await monthSpend(supabase, laMonth);
    const g = await gatherCandidates(supabase, businessId, { only, since: onlyNew ? state.last_at || null : null });
    const candidates = candidateOrder(g.records, g.scores);
    const todayState = state.today?.day === today ? state.today : { day: today, lookups: 0, name_searches: 0 };
    const dailyCap = Math.min(settings.headcount_daily_credits ?? 25, maxLookups ?? Infinity);
    const nameCap = Math.max(0, Math.min(NAME_SEARCH_DAILY_CAP - todayState.name_searches, maxNameSearches ?? Infinity));
    const lookupCap = Math.max(0, Math.min(dailyCap - todayState.lookups, MONTHLY_CREDIT_CAP - monthSpent));
    ctx.callCounter.max = 2 + nameCap + 2 * lookupCap;
    const byKey = new Map(g.records.map(r => [r.key, r]));
    const willCall = candidates.some(r => (!r.domain && nameCap > 0) || (r.domain && lookupCap > 0));
    if (willCall) { before = await apolloBalance(ctx); lastBalance = before; }
    const lookups = {
      nameSearch: async name => { const r = nameSearchRequest(name); const json = await apolloRequest({ method: r.method, path: r.path, body: r.body, ctx }); return [...(json?.organizations || []), ...(json?.accounts || [])]; },
      freeHeadcount: async r => { const n = wholeNumber(g.research.get(r.key)?.employees_count); return n ? { number: n, source: 'research' } : null; },
      enrich: async domain => {
        const r = enrichRequest(domain);
        const json = await apolloRequest({ method: r.method, path: r.path, query: r.query, ctx });
        const bal = await apolloBalance(ctx);
        const delta = lastBalance != null ? lastBalance - bal : 0;
        lastBalance = bal;
        return { org: json?.organization || null, credits: Math.max(0, delta) };
      },
    };
    const out = await runFill(candidates, { lookups, caps: { dailyCap, usedToday: todayState.lookups, monthSpent }, nameSearchesLeft: nameCap, now: at });
    const filled = [];
    for (const item of out.items) {
      if (!Object.keys(item.writes).length) continue;
      await applyWrites(supabase, businessId, item, byKey.get(item.key), g.partnerDomains, at);
      filled.push({ name: item.name, employees: item.writes.employees ?? null, source: item.writes.employees_source ?? null, domain: item.writes.domain ?? null });
    }
    if (before != null) {
      after = out.counts.name_searches && !out.counts.lookups ? await apolloBalance(ctx) : lastBalance;
      credits = before - after;
      must(await supabase.from('apollo_credit_spend').insert({ business_id: businessId, la_month: laMonth, endpoint: ENRICH_PATH, ref: `headcount:${today}:${trigger}`, credits, balance_before: before, balance_after: after }));
    }
    const line = fillLine(out.counts);
    await saveState(supabase, businessId, settings, {
      today: { day: today, lookups: todayState.lookups + out.counts.lookups, name_searches: todayState.name_searches + out.counts.name_searches },
      last_run_on: today, last_at: at.toISOString(), last_trigger: trigger, last_line: line, last_counts: out.counts, last_filled: filled.slice(0, 3),
      charged: out.counts.stopped ? { credits: out.counts.stopped.credits, at: at.toISOString(), message: out.counts.stopped.message } : (trigger === 'manual' ? null : state.charged || null),
    });
    if (filled.length) scheduleRecompute(supabase, businessId, 'headcount');
    return reply(200, { ran: true, trigger, line, counts: out.counts, calls: ctx.callCounter.count, credits, balance_before: before, balance_after: after, filled: filled.slice(0, 20), paused: monthSpent >= MONTHLY_CREDIT_CAP ? PAUSED : null, daily_cap: dailyCap, lookups_left: out.lookupsLeft });
  } catch (e) {
    const message = cleanText(String(e.message || 'failed'), 200);
    if (before != null) { try { after = await apolloBalance(ctx); credits = before - after; must(await supabase.from('apollo_credit_spend').insert({ business_id: businessId, la_month: laMonth, endpoint: ENRICH_PATH, ref: `headcount:${today}:${trigger}`, credits, balance_before: before, balance_after: after })); } catch (spendErr) { console.error('[headcount] spend not recorded', cleanText(String(spendErr.message || ''), 200)); } }
    try { await saveState(supabase, businessId, settings, { last_error: message, last_error_at: at.toISOString() }); } catch (stateErr) { console.error('[headcount] state not saved', stateErr.message); }
    console.error('[headcount]', message);
    return reply(502, { error: `Headcount fill failed: ${message}`, calls: ctx.callCounter.count });
  }
}

// Fire-and-forget: one run in flight per workspace; the in-memory test Supabase never gets one unless force.
export function scheduleHeadcountFill(supabase, businessId, opts = {}, { log = console.error, force = false } = {}) {
  if (supabase?.db && !force) return null;
  if (inFlight.has(businessId)) return inFlight.get(businessId);
  const p = (async () => {
    try { const r = await runHeadcountFill(supabase, { businessId, ...opts }); if (r.status >= 400) log('[headcount background]', cleanText(String(r.body?.error || r.status), 200)); }
    catch (e) { log('[headcount background]', cleanText(String(e.message || e), 200)); }
    finally { inFlight.delete(businessId); }
  })();
  inFlight.set(businessId, p);
  return p;
}
// H5 (2) first sight: the free paths only for that one company (a name search is 0 credits; never an enrich inside a create).
export const scheduleFirstSight = (supabase, { businessId, type, id }, opts = {}) => scheduleHeadcountFill(supabase, businessId, { trigger: 'first_sight', only: { type, id }, maxLookups: 0 }, opts);
// H5 (3) page load: companies created since the last run, free paths, then at most PAGE_LOAD_LOOKUPS lookups.
export const schedulePageLoadFill = (supabase, businessId, opts = {}) => scheduleHeadcountFill(supabase, businessId, { trigger: 'pageload', onlyNew: true, maxLookups: PAGE_LOAD_LOOKUPS }, opts);

// POST /goals/headcount/fill { max_lookups?, max_name_searches? } (owner / admin)
export async function fillHeadcountsRoute(req, res) {
  if (!hasRole(req, req.params.businessId, 'admin')) return send(res, reply(403, { error: 'Only an owner or admin can fill headcounts' }));
  const b = req.body || {};
  const cap = (v, label) => { if (v == null) return null; const n = wholeNumber(v); if (n == null) throw Object.assign(new Error(`${label} must be a whole number`), { status: 400 }); return n; };
  try { send(res, await runHeadcountFill(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, trigger: 'manual', maxLookups: cap(b.max_lookups, 'max_lookups'), maxNameSearches: cap(b.max_name_searches, 'max_name_searches') })); }
  catch (e) { send(res, reply(e.status || 500, { error: e.message })); }
}
// GET /goals/headcount/status (Viewer+) -> { state, month_spend, cap, daily_cap }
export async function headcountStatusRoute(req, res) {
  try {
    const supabase = getSupabase();
    const settings = await loadSettings(supabase, req.params.businessId);
    const month = laDateString(new Date()).slice(0, 7);
    res.json({ state: stateOf(settings), month_spend: await monthSpend(supabase, month), cap: MONTHLY_CREDIT_CAP, daily_cap: settings.headcount_daily_credits ?? 25 });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}
