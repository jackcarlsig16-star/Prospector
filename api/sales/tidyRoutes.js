import { getSupabase, findRow, weekIsFinal, FINAL_ERROR, addDays } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { laDateString } from './laDate.js';
import { openFlagRows } from './huddleFlags.js';
import { runRules, keyOf, DUE_DAYS, TOUCH_WINDOW_DAYS } from './tidyRules.js';
import { nudgeText } from './waitingRoutes.js';

// call-notes-targets-v1 REV4 Stage 3 - Tidy: a daily propose-only pass. A run
// writes sales_suggestions rows and one sales_tidy_runs row, nothing else.
// It is kicked by a Member's first Goals & Sales load of the LA day or by
// "Tidy now" (body.force) - crons never fire on prod, so nothing here waits
// on a timer. Accept creates ONE open to-do; Dismiss / Snooze park the row
// for 7 days (the partial unique index only covers proposed rows, so a
// parked key is skipped here, not by the database).
export const SNOOZE_DAYS = 7;
export const ACCEPTED_QUIET_DAYS = 7;
export const TIDY_CATEGORY = 'Tidy';
export const TRIGGERS = ['pageload', 'manual', 'test'];
const RUN_LOOKBACK_MS = 36 * 3600e3; // mirrors partnerContactsSync ranToday
const DAY = 864e5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (status, error) => Object.assign(new Error(error), { status });
const must = r => { if (r.error) throw err(500, r.error.message); return r.data; };
const reply = (status, body) => ({ status, body });
const send = (res, r) => res.status(r.status).json(r.body);
const cut = (s, max = 400) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const laMonday = today => addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));

export async function loadTidyContext(supabase, businessId, now = Date.now()) {
  const all = (table, cols, narrow = q => q) => selectAllPages(() => narrow(supabase.from(table).select(cols).eq('business_id', businessId)).order('id'));
  const since = new Date(now - TOUCH_WINDOW_DAYS * DAY).toISOString();
  const [partners, targets, todos, waiting, events, domains, suggestions, visits] = await Promise.all([
    all('sales_goals', 'id, name, pipeline_status, last_touch_at, snoozed_until, owner_team, co_owner_name, no_double_touch', q => q.eq('goal_type', 'partnership').is('archived_at', null)),
    all('sales_targets', 'id, name, status, research_notes, created_at'),
    all('sales_week_goals', 'id, text, status, due_date, link_type, link_id, created_at, prospect_contact_id, contacts, carried_from_id', q => q.eq('kind', 'todo')),
    all('sales_week_goals', 'id, text, status, due_date, link_type, link_id, waiting_on', q => q.eq('kind', 'waiting').eq('status', 'open')),
    all('sales_partner_events', 'id, goal_id, event, at', q => q.eq('event', 'touch').gte('at', since)),
    all('partner_domains', 'id, goal_id, domain', q => q.eq('confirmed', true)),
    all('sales_suggestions', 'id, kind, ref_type, ref_id, ref_id2, status, dismissed_until, decided_at'),
    all('web_visits', 'id, matched_id, last_visit, visits_7d, pulled_on', q => q.eq('matched_type', 'partner').in('priority', ['P1', 'P2']).gte('pulled_on', addDays(laDateString(new Date(now)), -7))),
  ]);
  return { now, today: laDateString(new Date(now)), partners, targets, todos, waiting, flags: openFlagRows(todos.filter(t => t.prospect_contact_id)), events, domains, suggestions, visits };
}

// Keys a run must not propose again: still proposed, parked, or accepted recently.
export function skipKeys(existing, now = Date.now()) {
  const keys = new Set();
  for (const s of existing) {
    const parked = s.status === 'dismissed' && s.dismissed_until && Date.parse(s.dismissed_until) > now;
    const quiet = s.status === 'accepted' && s.decided_at && now - Date.parse(s.decided_at) < ACCEPTED_QUIET_DAYS * DAY;
    if (s.status === 'proposed' || parked || quiet) keys.add(keyOf(s));
  }
  return keys;
}

export async function ranToday(supabase, businessId, now = Date.now()) {
  const { data, error } = await supabase.from('sales_tidy_runs').select('id, started_at, finished_at, status, trigger, counts')
    .eq('business_id', businessId).gte('started_at', new Date(now - RUN_LOOKBACK_MS).toISOString()).order('started_at', { ascending: false });
  if (error) throw err(500, error.message);
  const today = laDateString(new Date(now));
  return (data || []).find(r => r.status !== 'error' && laDateString(new Date(r.started_at)) === today) || null;
}

// POST /goals/tidy/run { force?, trigger? } -> { ran: false, reason, last_run }
// when today's run exists and force is off, else { ran: true, run, created, skipped }.
export async function runTidy(supabase, { businessId, trigger = 'manual', force = false, now = Date.now() }) {
  try {
    if (!TRIGGERS.includes(trigger)) return reply(400, { error: `trigger must be one of ${TRIGGERS.join('|')}` });
    if (typeof force !== 'boolean') return reply(400, { error: 'force must be true or false' });
    const prior = await ranToday(supabase, businessId, now);
    if (prior && !force) return reply(200, { ran: false, reason: 'Tidy already ran today', last_run: prior });
    const startedAt = new Date(now).toISOString();
    const counts = { proposed: 0, skipped: 0, by_kind: {} };
    try {
      const ctx = await loadTidyContext(supabase, businessId, now);
      const skip = skipKeys(ctx.suggestions, now);
      for (const s of runRules(ctx)) {
        const key = keyOf(s);
        if (skip.has(key)) { counts.skipped++; continue; }
        skip.add(key);
        const ins = await supabase.from('sales_suggestions').insert({
          business_id: businessId, kind: s.kind, ref_type: s.ref_type, ref_id: s.ref_id, ref_id2: s.ref_id2 || null,
          text: cut(s.text), reason: s.reason ? cut(s.reason) : null, status: 'proposed',
        }).select('id');
        if (ins.error?.code === '23505') { counts.skipped++; continue; }
        must(ins);
        counts.proposed++;
        counts.by_kind[s.kind] = (counts.by_kind[s.kind] || 0) + 1;
      }
    } catch (e) {
      await supabase.from('sales_tidy_runs').insert({ business_id: businessId, started_at: startedAt, finished_at: new Date().toISOString(), status: 'error', counts: { ...counts, error: String(e.message).slice(0, 300) }, trigger });
      throw e;
    }
    const run = must(await supabase.from('sales_tidy_runs').insert({ business_id: businessId, started_at: startedAt, finished_at: new Date().toISOString(), status: 'ok', counts, trigger }).select().single());
    return reply(200, { ran: true, run, created: counts.proposed, skipped: counts.skipped });
  } catch (e) {
    if (!e.status || e.status >= 500) console.error('[tidy/run]', e.message);
    return reply(e.status || 500, { error: e.message });
  }
}
export async function runTidyRoute(req, res) {
  const { force = false, trigger = 'manual' } = req.body || {};
  send(res, await runTidy(getSupabase(), { businessId: req.params.businessId, trigger, force }));
}

// GET /goals/suggestions -> { suggestions (proposed, newest first), last_run }
export async function listSuggestions(supabase, businessId) {
  const [rows, runs] = await Promise.all([
    selectAllPages(() => supabase.from('sales_suggestions').select('*').eq('business_id', businessId).eq('status', 'proposed').order('created_at', { ascending: false }).order('id')),
    supabase.from('sales_tidy_runs').select('id, started_at, finished_at, status, trigger, counts').eq('business_id', businessId).order('started_at', { ascending: false }).limit(1),
  ]);
  if (runs.error) throw err(500, runs.error.message);
  return { suggestions: rows, last_run: runs.data?.[0] || null };
}
export async function listSuggestionsRoute(req, res) {
  try { res.json(await listSuggestions(getSupabase(), req.params.businessId)); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}

async function proposedOrReply(supabase, businessId, id) {
  if (!UUID.test(id || '')) return { fail: reply(404, { error: 'suggestion not found' }) };
  const { data, error } = await findRow(supabase, 'sales_suggestions', businessId, id);
  if (error) throw err(500, error.message);
  if (!data) return { fail: reply(404, { error: 'suggestion not found' }) };
  if (data.status !== 'proposed') return { fail: reply(409, { error: `already ${data.status}` }) };
  return { s: data };
}

// The to-do Accept creates: linked to the record the rule pointed at; a
// to-do or flag suggestion inherits that row's own link. Null for a pair.
export async function todoFor(supabase, businessId, s, today) {
  const due = DUE_DAYS[s.kind];
  if (due == null) return null;
  let link = null;
  if (s.ref_type === 'partner' || s.ref_type === 'target') link = [s.ref_type, s.ref_id];
  else if (s.ref_type === 'todo' || s.ref_type === 'flag') {
    const { data } = await supabase.from('sales_week_goals').select('link_type, link_id, text, waiting_on').eq('business_id', businessId).eq('id', s.ref_id).maybeSingle();
    if (data?.link_type) link = [data.link_type, data.link_id];
    // A nudge's to-do says what they owe, like the card's Nudge button.
    if (s.kind === 'nudge' && data) return { text: nudgeText(data.waiting_on || 'them', data.text), due_date: addDays(today, due), link_type: link?.[0] || null, link_id: link?.[1] || null };
  }
  return { text: s.text, due_date: addDays(today, due), link_type: link?.[0] || null, link_id: link?.[1] || null };
}

// POST /goals/suggestions/:id/accept -> { suggestion, todo, open }. The to-do
// is the only other write: no status, stage, touch or done flag anywhere.
// A duplicate pair creates nothing; open = the two partner ids to show.
export async function acceptSuggestion(supabase, { businessId, userId, id, now = Date.now() }) {
  try {
    const { s, fail } = await proposedOrReply(supabase, businessId, id);
    if (fail) return fail;
    const today = laDateString(new Date(now));
    const spec = await todoFor(supabase, businessId, s, today);
    let todo = null;
    if (spec) {
      const week = laMonday(today);
      if (await weekIsFinal(supabase, businessId, week)) return reply(409, { error: FINAL_ERROR });
      todo = must(await supabase.from('sales_week_goals').insert({
        business_id: businessId, week_start: week, kind: 'todo', status: 'open', category: TIDY_CATEGORY, sort_order: 0,
        owner_user_id: userId, created_by: userId, ...spec,
      }).select().single());
    }
    const rows = must(await supabase.from('sales_suggestions').update({ status: 'accepted', decided_at: new Date(now).toISOString(), decided_by: userId })
      .eq('id', s.id).eq('status', 'proposed').select());
    if (!rows.length) {
      if (todo) await supabase.from('sales_week_goals').delete().eq('id', todo.id);
      return reply(409, { error: 'changed since - reload' });
    }
    return reply(200, { suggestion: rows[0], todo, open: s.ref_type === 'pair' ? [s.ref_id, s.ref_id2] : null });
  } catch (e) {
    if (!e.status || e.status >= 500) console.error('[suggestions/accept]', e.message);
    return reply(e.status || 500, { error: e.message });
  }
}
export async function acceptSuggestionRoute(req, res) {
  send(res, await acceptSuggestion(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, id: req.params.id }));
}

// POST /goals/suggestions/:id/dismiss and .../snooze -> { suggestion }. Both
// park the row until +7 days; the next run skips the key until then.
export async function parkSuggestion(supabase, { businessId, userId, id, now = Date.now() }) {
  try {
    const { s, fail } = await proposedOrReply(supabase, businessId, id);
    if (fail) return fail;
    const rows = must(await supabase.from('sales_suggestions')
      .update({ status: 'dismissed', dismissed_until: new Date(now + SNOOZE_DAYS * DAY).toISOString(), decided_at: new Date(now).toISOString(), decided_by: userId })
      .eq('id', s.id).eq('status', 'proposed').select());
    if (!rows.length) return reply(409, { error: 'changed since - reload' });
    return reply(200, { suggestion: rows[0] });
  } catch (e) {
    return reply(e.status || 500, { error: e.message });
  }
}
export async function parkSuggestionRoute(req, res) {
  send(res, await parkSuggestion(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, id: req.params.id }));
}
