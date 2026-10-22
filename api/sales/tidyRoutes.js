import { getSupabase, findRow, weekIsFinal, FINAL_ERROR, addDays, laMonday } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { laDateString } from './laDate.js';
import { openFlagRows } from './huddleFlags.js';
import { runRules, keyOf, DUE_DAYS, TOUCH_WINDOW_DAYS } from './tidyRules.js';
import { personSignals, INTEREST_DAYS } from './interestSignals.js';
import { nudgeText } from './waitingRoutes.js';
import { loadOverrides, effectiveVisit } from './visitPriority.js';
import { doneFlag, partnerDoneTouch, revertTouch, doneTouchEvent, undoDoneTouch } from './doneTouch.js';

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

export async function loadTidyContext(supabase, businessId, now = Date.now()) {
  // orderBy: the page key (sales_prospect_state and sales_email_messages have no id column - every run errored
  // from 1cf4b21 until FIX actions-done-button-v1 named it).
  const all = (table, cols, narrow = q => q, orderBy = 'id') => selectAllPages(() => narrow(supabase.from(table).select(cols).eq('business_id', businessId)).order(orderBy));
  const since = new Date(now - TOUCH_WINDOW_DAYS * DAY).toISOString();
  const interestSince = new Date(now - INTEREST_DAYS * DAY).toISOString();
  const [partners, targets, todos, waiting, events, domains, suggestions, rawVisits, overrides, opportunities, prospects, messages, emailEvents] = await Promise.all([
    all('sales_goals', 'id, name, pipeline_status, last_touch_at, snoozed_until, owner_team, co_owner_name, no_double_touch', q => q.eq('goal_type', 'partnership').is('archived_at', null)),
    all('sales_targets', 'id, name, status, research_notes, created_at'),
    all('sales_week_goals', 'id, text, status, due_date, link_type, link_id, created_at, prospect_contact_id, contacts, carried_from_id', q => q.eq('kind', 'todo')),
    all('sales_week_goals', 'id, text, status, due_date, link_type, link_id, waiting_on', q => q.eq('kind', 'waiting').eq('status', 'open')),
    all('sales_partner_events', 'id, goal_id, event, at', q => q.eq('event', 'touch').gte('at', since)),
    all('partner_domains', 'id, goal_id, domain', q => q.eq('confirmed', true)),
    all('sales_suggestions', 'id, kind, ref_type, ref_id, ref_id2, status, dismissed_until, decided_at'),
    all('web_visits', 'id, company_key, matched_id, last_visit, visits_7d, priority, pulled_on', q => q.eq('matched_type', 'partner').gte('pulled_on', addDays(laDateString(new Date(now)), -7))),
    loadOverrides(supabase, businessId),
    all('sales_opportunities', 'id, organization', q => q.is('archived_at', null)),
    // company-panel-v2 D7: linked people and their last 14 days of email events (never email or phone columns).
    all('sales_prospect_state', 'contact_id, name, goal_id, opportunity_id', q => q, 'contact_id'),
    all('sales_email_messages', 'apollo_message_id, contact_id, step, delivered_at, replied, replied_at, replied_seen_at', q => q, 'apollo_message_id'),
    all('sales_email_activity', 'id, apollo_message_id, contact_id, step, event, occurred_at, user_agent, tracking_service', q => q.in('event', ['open', 'click', 'reply']).gte('occurred_at', interestSince)),
  ]);
  const signals = personSignals({ messages, events: emailEvents, now });
  const interest = prospects.filter(p => p.goal_id || p.opportunity_id).flatMap(p => {
    const s = signals.get(p.contact_id)?.strongest;
    if (!s || !s.id) return [];
    const ref = p.goal_id ? ['partner', p.goal_id] : ['opportunity', p.opportunity_id];
    return [{ ref_type: ref[0], ref_id: ref[1], contact_id: p.contact_id, name: p.name, signal: s }];
  });
  // P1/P2 after a person's override (sales-ia-v2 P3), not the pull's own score.
  const hot = rawVisits.map(v => effectiveVisit(v, overrides.get(v.company_key))).filter(v => v.priority === 'P1' || v.priority === 'P2');
  return { now, today: laDateString(new Date(now)), partners, targets, todos, waiting, flags: openFlagRows(todos.filter(t => t.prospect_contact_id)), events, domains, suggestions, visits: hot, opportunities, interest };
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
  if (['partner', 'target', 'opportunity'].includes(s.ref_type)) link = [s.ref_type, s.ref_id];
  else if (s.ref_type === 'todo' || s.ref_type === 'flag') {
    const { data } = await supabase.from('sales_week_goals').select('link_type, link_id, text, waiting_on').eq('business_id', businessId).eq('id', s.ref_id).maybeSingle();
    if (data?.link_type) link = [data.link_type, data.link_id];
    // A nudge's to-do says what they owe, like the card's Nudge button.
    if (s.kind === 'nudge' && data) return { text: nudgeText(data.waiting_on || 'them', data.text), due_date: addDays(today, due), link_type: link?.[0] || null, link_id: link?.[1] || null };
  }
  return { text: s.text, due_date: addDays(today, due), link_type: link?.[0] || null, link_id: link?.[1] || null };
}

// POST /goals/suggestions/:id/accept { done? } -> { suggestion, todo, open, touch_event_id }. The to-do
// is the only other write: no status, stage, touch or done flag anywhere.
// A duplicate pair creates nothing; open = the two partner ids to show.
// FIX actions-done-button-v1 REV2: { done: true } = the to-do is born done, and
// a partner-linked to-do also logs ONE email touch on that partner (no stage
// move; doneTouch.js). A suggestion that makes no to-do refuses done.
export async function acceptSuggestion(supabase, { businessId, userId, id, now = Date.now(), done = false }) {
  try {
    const isDone = doneFlag(done);
    const { s, fail } = await proposedOrReply(supabase, businessId, id);
    if (fail) return fail;
    const today = laDateString(new Date(now));
    const spec = await todoFor(supabase, businessId, s, today);
    if (isDone && !spec) return reply(400, { error: 'nothing to mark done — use Accept' });
    let todo = null, touch = null;
    if (spec) {
      const week = laMonday(today);
      if (await weekIsFinal(supabase, businessId, week)) return reply(409, { error: FINAL_ERROR });
      if (isDone && spec.link_type === 'partner') {
        ({ event: touch } = await partnerDoneTouch(supabase, { businessId, goalId: spec.link_id, userId, now: new Date(now), today, note: spec.text, meta: { from_suggestion_id: s.id } }));
      }
      const ins = await supabase.from('sales_week_goals').insert({
        business_id: businessId, week_start: week, kind: 'todo', status: isDone ? 'done' : 'open', category: TIDY_CATEGORY, sort_order: 0,
        owner_user_id: userId, created_by: userId, ...spec, ...(isDone ? { completed_at: new Date(now).toISOString() } : {}),
      }).select().single();
      if (ins.error) { if (touch) await revertTouch(supabase, touch); throw err(500, ins.error.message); }
      todo = ins.data;
    }
    const rows = must(await supabase.from('sales_suggestions').update({ status: 'accepted', decided_at: new Date(now).toISOString(), decided_by: userId })
      .eq('id', s.id).eq('status', 'proposed').select());
    if (!rows.length) {
      if (todo) await supabase.from('sales_week_goals').delete().eq('id', todo.id);
      if (touch) await revertTouch(supabase, touch);
      return reply(409, { error: 'changed since - reload' });
    }
    return reply(200, { suggestion: rows[0], todo, open: s.ref_type === 'pair' ? [s.ref_id, s.ref_id2] : null, touch_event_id: touch?.id || null });
  } catch (e) {
    if (!e.status || e.status >= 500) console.error('[suggestions/accept]', e.message);
    return reply(e.status || 500, { error: e.message });
  }
}
export async function acceptSuggestionRoute(req, res) {
  send(res, await acceptSuggestion(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, id: req.params.id, done: req.body?.done }));
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

// POST /goals/suggestions/:id/undo { todo_id?, touch_event_id? } -> { suggestion }. Back to
// proposed (sales-ia-v2 A1: the Actions row's Undo); todo_id = the to-do that
// Accept returned, deleted only while it is still a Tidy to-do of the
// caller's (open, or done by a Done). A Done's partner touch comes off first,
// through undoPartnerSignal; its refusal is the answer. Refused after UNDO_WINDOW_MS.
export const UNDO_WINDOW_MS = 10 * 60e3;
export async function undoSuggestion(supabase, { businessId, userId, id, body, now = Date.now() }) {
  try {
    if (!UUID.test(id || '')) return reply(404, { error: 'suggestion not found' });
    const todoId = body?.todo_id ?? null;
    if (todoId !== null && !UUID.test(todoId)) return reply(400, { error: 'todo_id must be a uuid' });
    const { data: s, error } = await findRow(supabase, 'sales_suggestions', businessId, id);
    if (error) throw err(500, error.message);
    if (!s) return reply(404, { error: 'suggestion not found' });
    if (s.status === 'proposed') return reply(409, { error: 'still proposed - nothing to undo' });
    if (!s.decided_at || now - Date.parse(s.decided_at) > UNDO_WINDOW_MS) return reply(409, { error: 'decided too long ago to undo' });
    if (s.status === 'accepted') {
      const touch = await doneTouchEvent(supabase, businessId, body?.touch_event_id, e => e.meta?.from_suggestion_id === s.id);
      if (touch) { const refused = await undoDoneTouch(supabase, { businessId, touch, userId, now: new Date(now) }); if (refused) return refused; }
      if (todoId) must(await supabase.from('sales_week_goals').delete().eq('business_id', businessId).eq('id', todoId).eq('category', TIDY_CATEGORY).in('status', ['open', 'done']).eq('created_by', userId));
    }
    const rows = must(await supabase.from('sales_suggestions').update({ status: 'proposed', dismissed_until: null, decided_at: null, decided_by: null })
      .eq('id', s.id).eq('status', s.status).select());
    if (!rows.length) return reply(409, { error: 'changed since - reload' });
    return reply(200, { suggestion: rows[0] });
  } catch (e) {
    return reply(e.status || 500, { error: e.message });
  }
}
export async function undoSuggestionRoute(req, res) {
  send(res, await undoSuggestion(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, id: req.params.id, body: req.body }));
}

