import { apolloRequest, apolloBalance } from './apolloClient.js';
import { getSupabase } from './goalsShared.js';
import { laDateString } from './laDate.js';
import { cleanText } from './scrubText.js';
import { listsRequest, findListByName, contactsRequest, mapContacts, VISITOR_LIST_NAME, CONTACTS_PATH } from './peopleFind.js';
import { salesSettings, fileVisitedPeople } from './visitorRoutes.js';
import { scheduleRecompute } from './intentScoreRun.js';

// visitor-to-record-v1 V2a (Oct 27 ruling) - the people Jack adds by hand to the Apollo contacts list
// "Prospector · Website visitors (export)" (from Apollo's Website Visitors page; no workflow, no trigger on Apollo's side).
// One pull = balance, the list id (ONE GET /labels the first time, then the id cached in sales_settings), the list's
// contacts paged under MAX_PAGES (0 credits), balance again -> apollo_credit_spend (even 0) -> the same filer as the
// CSV upload (matched record by domain / name, else a new employer target; sales_people, never an address).
// Runs once per LA day in the BACKGROUND after the visit pull's page-load reply (schedulePeoplePull: fire-and-forget
// like scheduleRecompute, one in flight per workspace, never inside the request), or on "Pull visitor people now"
// (force, awaited). Its own visit_pull_runs row (kind 'people', one per LA day) is the ran-today guard once the V2a
// follow-up migration ran; before that it falls back to the settings state. State under sales_settings.visitor_filters
// .visitor_people (jsonb; no migration): { list_id, list_name, list_count, resolved_at, last_pull_on, last_at, last_counts, last_error }.
export const MAX_PAGES = 5; // REVISABLE - 500 contacts per pull at Apollo's 100 per page
export const STATE_KEY = 'visitor_people';
export const RUN_KIND = 'people';
const STALE_RUNNING_MS = 10 * 60e3;
const RUN_COLS = 'id, la_date, kind, status, calls, credits, error, created_at, updated_at';
const inFlight = new Map();
const reply = (status, body) => ({ status, body });
const send = (res, r) => res.status(r.status).json(r.body);
const must = r => { if (r.error) throw Object.assign(new Error(r.error.message), { status: 500 }); return r.data; };

export const peopleState = settings => ({ ...((settings?.visitor_filters || {})[STATE_KEY] || {}) });
async function saveState(supabase, businessId, settings, patch) {
  const prior = peopleState(settings);
  const next = { ...(settings.visitor_filters || {}), [STATE_KEY]: { ...prior, ...patch } };
  must(await supabase.from('sales_settings').upsert({ business_id: businessId, visitor_filters: next, updated_at: new Date().toISOString() }, { onConflict: 'business_id' }));
  settings.visitor_filters = next;
  return next[STATE_KEY];
}

// The run row (kind 'people', one per LA day): { run } to pull, { done } when today's is ok and not forced, { busy } when a
// fresh one is running, { unsupported: true } before the migration (the CHECK refuses 'people' -> settings guard).
async function claimRun(supabase, businessId, today, force, now) {
  const stamp = new Date(now).toISOString();
  const prior = await supabase.from('visit_pull_runs').select(RUN_COLS).eq('business_id', businessId).eq('la_date', today).eq('kind', RUN_KIND).maybeSingle();
  if (prior.error) return { unsupported: true };
  if (prior.data) {
    const p = prior.data;
    if (p.status === 'running' && now - Date.parse(p.updated_at) < STALE_RUNNING_MS) return { busy: true };
    if (p.status === 'ok' && !force) return { done: p };
    const rows = must(await supabase.from('visit_pull_runs').update({ status: 'running', calls: 0, credits: 0, error: null, updated_at: stamp }).eq('id', p.id).eq('status', p.status).select(RUN_COLS));
    return rows.length ? { run: rows[0] } : { busy: true };
  }
  const ins = await supabase.from('visit_pull_runs').insert({ business_id: businessId, la_date: today, kind: RUN_KIND, status: 'running', updated_at: stamp }).select(RUN_COLS);
  if (ins.error?.code === '23505') return { busy: true };
  if (ins.error) return { unsupported: true };
  return { run: ins.data[0] };
}

// Fire-and-forget after the visit pull's reply: one run in flight per workspace; errors logged, never thrown. The
// in-memory test Supabase never gets a background run unless force (a suite calls runVisitorPeoplePull itself).
export function schedulePeoplePull(supabase, { businessId, userId, log = console.error, force = false }) {
  if (supabase?.db && !force) return null;
  if (inFlight.has(businessId)) return inFlight.get(businessId);
  const p = (async () => {
    try { const r = await runVisitorPeoplePull(supabase, { businessId, userId }); if (r.status >= 400) log('[visits/people-pull background]', cleanText(String(r.body?.error || r.status), 200)); }
    catch (e) { log('[visits/people-pull background]', cleanText(String(e.message || e), 200)); }
    finally { inFlight.delete(businessId); }
  })();
  inFlight.set(businessId, p);
  return p;
}
export const peoplePullInFlight = () => inFlight.size;

// -> { ran: false, reason } | { ran: true, list, calls, credits, counts, companies, sample } | an error reply (never throws)
export async function runVisitorPeoplePull(supabase, { businessId, userId, force = false, now = Date.now(), listName = null }) {
  const today = laDateString(new Date(now)), laMonth = today.slice(0, 7);
  let settings;
  try { settings = await salesSettings(supabase, businessId); } catch (e) { return reply(e.status || 500, { error: e.message }); }
  const state = peopleState(settings);
  const wanted = String(listName || state.list_name || VISITOR_LIST_NAME);
  let claim;
  try { claim = await claimRun(supabase, businessId, today, force, now); } catch (e) { return reply(e.status || 500, { error: e.message }); }
  if (claim.busy) return reply(409, { error: 'A visitor people pull is running - try again in a minute' });
  if (claim.done) return reply(200, { ran: false, reason: 'Visitor people already pulled today', last: { on: claim.done.la_date, counts: state.last_counts || null, list: state.list_name || null } });
  if (claim.unsupported) {
    if (!force && state.last_pull_on === today) return reply(200, { ran: false, reason: 'Visitor people already pulled today', last: { on: state.last_pull_on, counts: state.last_counts || null, list: state.list_name || null } });
    // A failed page-load try (no list yet, Apollo down) is not retried until tomorrow or "Pull visitor people now".
    if (!force && state.last_error_at && laDateString(new Date(state.last_error_at)) === today) return reply(200, { ran: false, reason: `Visitor people pull failed earlier today: ${state.last_error}`, error: state.last_error });
  }
  const run = claim.run || null;
  const ctx = { callCounter: { count: 0, max: 3 + MAX_PAGES }, endpointCounts: {} };
  const finish = patch => (run ? supabase.from('visit_pull_runs').update({ ...patch, calls: ctx.callCounter.count, updated_at: new Date().toISOString() }).eq('id', run.id) : Promise.resolve({ error: null }));
  let before = null, after = null, credits = 0, list = null;
  const recordSpend = () => supabase.from('apollo_credit_spend').insert({ business_id: businessId, la_month: laMonth, endpoint: CONTACTS_PATH, ref: `people_pull:${today}`, credits, balance_before: before, balance_after: after });
  try {
    before = await apolloBalance(ctx);
    if (state.list_id && state.list_name === wanted) list = { id: state.list_id, name: state.list_name, count: state.list_count ?? null, cached: true };
    else {
      const r = listsRequest();
      list = findListByName(await apolloRequest({ method: r.method, path: r.path, ctx }), wanted);
      if (!list) throw Object.assign(new Error(`Apollo has no contacts list named "${wanted}" - create it in Apollo (Lists) and add the visitors to it`), { status: 404 });
      await saveState(supabase, businessId, settings, { list_id: list.id, list_name: list.name, list_count: list.count, resolved_at: new Date(now).toISOString() });
    }
    const contacts = [];
    let pages = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const r = contactsRequest({ listId: list.id, page });
      const json = await apolloRequest({ method: r.method, path: r.path, body: r.body, ctx });
      pages++;
      contacts.push(...(Array.isArray(json?.contacts) ? json.contacts : []));
      if (!json?.pagination || page >= json.pagination.total_pages) break;
    }
    after = await apolloBalance(ctx);
    credits = before - after;
    must(await recordSpend());
    const parsed = mapContacts(contacts, { seenOn: today });
    const filed = await fileVisitedPeople(supabase, { businessId, userId, parsed, sourceNote: `Apollo list ${list.name}`, now: new Date(now) });
    const counts = { contacts: contacts.length, pages, capped: pages >= MAX_PAGES && contacts.length >= pages * 100, with_email: parsed.with_email, skipped: parsed.skipped, ...filed.counts };
    await saveState(supabase, businessId, settings, { last_pull_on: today, last_at: new Date(now).toISOString(), last_counts: counts, last_error: filed.migration_pending || null, list_count: list.count ?? state.list_count ?? null });
    must(await finish({ status: 'ok', credits, error: filed.migration_pending ? cleanText(filed.migration_pending, 300) : null }));
    if (counts.created || counts.people_added || counts.employees_filled) scheduleRecompute(supabase, businessId, 'visit_pull');
    const out = { ran: true, list: { name: list.name, count: list.count, cached: !!list.cached }, calls: ctx.callCounter.count, credits, counts, companies: filed.companies, sample: filed.sample, migration_pending: filed.migration_pending };
    if (/[^\s@<>()"',;=&#]+@[^\s@<>()"',;=&#]+\.[a-z]{2,}/i.test(JSON.stringify(out))) return reply(500, { error: 'refused: an address reached the reply' });
    return reply(200, out);
  } catch (e) {
    if (before != null && after == null) {
      try { after = await apolloBalance(ctx); credits = before - after; must(await recordSpend()); } catch (spendErr) { console.error('[visits/people-pull] spend not recorded', cleanText(String(spendErr.message || ''), 200)); }
    }
    const message = cleanText(String(e.message || 'failed'), 200);
    try { await saveState(supabase, businessId, settings, { last_error: message, last_error_at: new Date(now).toISOString() }); } catch (stateErr) { console.error('[visits/people-pull] state not saved', stateErr.message); }
    const closed = await finish({ status: 'error', credits, error: message });
    if (closed.error) console.error('[visits/people-pull] could not close the run row', closed.error.message);
    console.error('[visits/people-pull]', message);
    return reply(e.status === 404 ? 404 : 502, { error: `Visitor people pull failed: ${message}`, calls: ctx.callCounter.count });
  }
}

// POST /goals/visits/people-pull { force? } (Member)
export async function runVisitorPeoplePullRoute(req, res) {
  const force = req.body?.force === true;
  send(res, await runVisitorPeoplePull(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, force }));
}
