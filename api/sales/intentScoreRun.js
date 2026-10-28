import { getSupabase } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { normName } from './intakeMatch.js';
import { scoreProspect } from './heatScore.js';
import { laDateString } from './laDate.js';
import { cleanText } from './scrubText.js';
import { DEFAULT_WEIGHTS, UPSIDE_TEAMS, scoreCompany, dedupeCompanies } from './intentScore.js';
import { VISITOR_ROLE } from './visitorPeopleMove.js';

// intent-score-v1 S2 - the inputs gatherer (ONE pass over the workspace with selectAllPages, no model, no Apollo), the
// recompute runner that writes sales_company_scores + today's sales_company_score_days row, and the trigger hook the
// other routes call after a change (visit pull, signal accept / undo, research done, source edit, heat sync, page load
// when the last recompute is older than STALE_HOURS, manual). Every row's components carry a `meta` block (name,
// owner, stage, size, visits, touch, research state) so the readers never join the record tables again.
export const STALE_HOURS = 24;
export const SNAPSHOT_KEEP_DAYS = 30; // REVISABLE
export const TRIGGERS = ['manual', 'visit_pull', 'signal', 'research', 'source', 'heat', 'pageload', 'test'];
export const TOUCH_WINDOWS = { bright: 7, faint: 30, needs: 14 }; // REVISABLE (S3 halo + "Needs a touch")
export const NEEDS_TOUCH_MIN = 40;
// visitor-people-follow-record-v1 V3 (REVISABLE, Jack: "partners no" = false): a partner's identified website visitors
// (partner_contacts marked VISITOR_ROLE) count toward its "people" points like an employer's or target's.
export const COUNT_PARTNER_VISITORS = true;
const DAY = 864e5;
const NAMED_FIELDS = ['co_owner_name', 'no_double_touch', 'source_person', 'source_set_by'];
const LINK_TYPE = { partner: 'partner', employer: 'opportunity', target: 'target' };
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const later = (a, b) => (!a ? b : !b ? a : a > b ? a : b);

export function mergeWeights(row) {
  if (!row || typeof row !== 'object') return DEFAULT_WEIGHTS;
  const out = { ...DEFAULT_WEIGHTS };
  for (const k of Object.keys(DEFAULT_WEIGHTS)) if (row[k] && typeof row[k] === 'object' && !Array.isArray(row[k])) out[k] = { ...DEFAULT_WEIGHTS[k], ...row[k] };
  return out;
}

// NAMED (planner, Oct 27): a referral a person attached to the record - a co-owner name, no-double-touch, a referring
// person, or a source set by a real user. The Oct 22 backfill set source_set_by NULL, so its rows stay LIST.
export const isNamedReferral = r => NAMED_FIELDS.some(k => (k === 'no_double_touch' ? r[k] === true : !!r[k]));

// touches: [{ at, who, channel }] -> the latest, or null.
export const latestTouch = touches => touches.reduce((best, t) => (t?.at && (!best || t.at > best.at) ? t : best), null);

export async function gatherInputs(supabase, businessId, { now = Date.now() } = {}) {
  const all = (t, cols, build = x => x) => selectAllPages(() => build(supabase.from(t).select(cols).eq('business_id', businessId)).order('id'));
  const [partners, opps, targets, visits, skip, research, people, settings, prospects, messages, events, partnerEvents, oppEvents, doneTodos, overrides, members, marks, acceptedSignals, partnerVisitors] = await Promise.all([
    all('sales_goals', 'id, name, pipeline_status, owner_user_id, owner_team, co_owner_name, no_double_touch, source_kind, source_partner_id, source_person, source_set_by, source_set_at, employees, category, last_touch_at, priority, priority_set_at, archived_at, updated_at, created_at', x => x.eq('goal_type', 'partnership')),
    all('sales_opportunities', 'id, organization, stage, owner_user_id, owner_team, co_owner_name, no_double_touch, source_kind, source_partner_id, source_person, source_set_by, source_set_at, employees, priority, priority_set_at, archived_at, updated_at, created_at, notes'),
    all('sales_targets', 'id, name, kind, status, owner_user_id, owner_team, co_owner_name, no_double_touch, source_kind, source_partner_id, source_person, source_set_by, source_set_at, employees, updated_at, created_at, decided_at, promoted_goal_id'),
    all('web_visits', 'id, company_key, company_name, matched_type, matched_id, priority, visits_7d, unique_visitors_7d, apollo_intent, intent_score, top_paths, maybe_user, us_500, last_visit, pulled_on, seen_from'),
    all('sales_visit_skip', 'company_key'),
    all('research_runs', 'entity_type, entity_id, status, result, created_at', x => x.eq('status', 'done')),
    all('sales_people', 'title, source_kind, opportunity_id, target_id, archived_at', x => x.eq('source_kind', 'web_visit').is('archived_at', null)),
    supabase.from('sales_settings').select('*').eq('business_id', businessId).maybeSingle().then(must),
    selectAllPages(() => supabase.from('sales_prospect_state').select('contact_id, company, opportunity_id, goal_id').eq('business_id', businessId).order('contact_id')),
    selectAllPages(() => supabase.from('sales_email_messages').select('contact_id, apollo_message_id, delivered_at, replied, replied_at, reply_class, num_opens, num_clicks, last_opened_at, last_clicked_at').eq('business_id', businessId).order('apollo_message_id')),
    selectAllPages(() => supabase.from('sales_email_activity').select('contact_id, apollo_message_id, event, occurred_at, user_agent, tracking_service').eq('business_id', businessId).order('id')),
    selectAllPages(() => supabase.from('sales_partner_events').select('goal_id, event, at, touch_type, source, by_user, to_status').eq('business_id', businessId).in('event', ['touch', 'note', 'status']).order('id')),
    // brad-attribution-v1: the created event carries to_stage (an imported employer's stage date); touches use stage_change only.
    selectAllPages(() => supabase.from('sales_opportunity_events').select('opportunity_id, event_type, from_stage, to_stage, changed_at').eq('business_id', businessId).in('event_type', ['created', 'stage_change']).order('id')),
    selectAllPages(() => supabase.from('sales_week_goals').select('link_type, link_id, completed_at, owner_user_id, text').eq('business_id', businessId).eq('kind', 'todo').eq('status', 'done').order('id')),
    selectAllPages(() => supabase.from('visit_priority_override').select('company_key, priority, not_a_fit, set_at').eq('business_id', businessId).order('company_key')),
    supabase.from('business_members').select('user_id, name, profile:profiles!business_members_user_id_fkey(display_name)').eq('business_id', businessId).not('user_id', 'is', null).then(r => r.data || []),
    // brad-attribution-v1 F3: hand-set stage dates (sales_stage_marks) - an empty list until that migration ran.
    selectAllPages(() => supabase.from('sales_stage_marks').select('record_type, record_id, stage, at, reason').eq('business_id', businessId).order('id')).catch(() => []),
    selectAllPages(() => supabase.from('sales_signals').select('source, status, decided_at, target_id, company_key').eq('business_id', businessId).eq('status', 'accepted').order('id')).catch(() => []),
    COUNT_PARTNER_VISITORS ? all('partner_contacts', 'goal_id, title', x => x.eq('role_in_notes', VISITOR_ROLE)) : [],
  ]);
  const names = new Map(members.map(m => [m.user_id, m.profile?.display_name || m.name || null]));
  const weights = mergeWeights(settings?.score_weights);
  const buyer = (settings?.buyer_titles || []).map(b => String(b).toLowerCase());
  const isBuyer = t => { const x = String(t || '').toLowerCase(); return !!x && buyer.some(b => x.includes(b) || b.includes(x)); };
  const upsideIds = new Set(partners.filter(p => /upside/i.test(p.name || '')).map(p => p.id));
  const partnerName = new Map(partners.map(p => [p.id, p.name]));

  // The latest visit row per company_key; a record's visit = the row matched to it, else the row keyed by its name.
  const latest = new Map();
  for (const v of [...visits].sort((a, b) => String(a.pulled_on).localeCompare(String(b.pulled_on)))) latest.set(v.company_key, v);
  const visitByRecord = new Map();
  // web_visits says 'opportunity' for an employer match (visitRules liveMatch); the score keys employers as 'employer'.
  for (const v of latest.values()) if (v.matched_type && v.matched_id) visitByRecord.set(`${v.matched_type === 'opportunity' ? 'employer' : v.matched_type}:${v.matched_id}`, v);
  const skipKeys = new Set(skip.map(s => s.company_key));
  const overrideByKey = new Map(overrides.map(o => [o.company_key, o]));
  const researchBy = new Map();
  for (const r of [...research].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) researchBy.set(`${r.entity_type}:${r.entity_id}`, r);
  const peopleBy = new Map();
  for (const p of people) {
    const k = p.opportunity_id ? `employer:${p.opportunity_id}` : p.target_id ? `target:${p.target_id}` : null;
    if (!k) continue;
    if (!peopleBy.has(k)) peopleBy.set(k, []);
    peopleBy.get(k).push({ title: p.title || null, is_buyer: isBuyer(p.title) });
  }
  for (const c of partnerVisitors) {
    const k = `partner:${c.goal_id}`;
    if (!peopleBy.has(k)) peopleBy.set(k, []);
    peopleBy.get(k).push({ title: c.title || null, is_buyer: isBuyer(c.title) });
  }
  // Heat + Apollo touches per prospect -> the hottest prospect per company (by link, else by company name).
  const msgsBy = new Map(), evsBy = new Map();
  for (const m of messages) { if (!msgsBy.has(m.contact_id)) msgsBy.set(m.contact_id, []); msgsBy.get(m.contact_id).push(m); }
  for (const e of events) { if (!evsBy.has(e.contact_id)) evsBy.set(e.contact_id, []); evsBy.get(e.contact_id).push(e); }
  const heatBy = new Map(), touchesBy = new Map();
  const addTouch = (k, t) => { if (!t?.at) return; if (!touchesBy.has(k)) touchesBy.set(k, []); touchesBy.get(k).push(t); };
  for (const p of prospects) {
    const ms = msgsBy.get(p.contact_id) || [], es = evsBy.get(p.contact_id) || [];
    if (!ms.length && !es.length) continue;
    const s = scoreProspect(ms, es);
    const h = { score: s.score, replied: ms.some(m => m.replied), opens: ms.reduce((n, m) => n + (m.num_opens || 0), 0), clicks: ms.reduce((n, m) => n + (m.num_clicks || 0), 0) };
    const sent = ms.map(m => m.delivered_at).filter(Boolean).sort().pop() || null;
    const keys = [p.opportunity_id && `employer:${p.opportunity_id}`, p.goal_id && `partner:${p.goal_id}`, p.company && `name:${normName(p.company)}`].filter(Boolean);
    for (const k of keys) {
      const prev = heatBy.get(k);
      if (!prev || h.score > prev.score) heatBy.set(k, h);
      if (sent) addTouch(k, { at: sent, who: null, channel: 'apollo email' });
      if (s.last_signal_at) addTouch(k, { at: s.last_signal_at, who: null, channel: h.replied ? 'apollo reply' : 'apollo activity' });
    }
  }
  for (const e of partnerEvents) addTouch(`partner:${e.goal_id}`, { at: e.at, who: names.get(e.by_user) || null, channel: e.event === 'touch' ? (e.touch_type || 'touch') : e.event === 'note' ? 'note' : 'stage' });
  for (const e of oppEvents) if (e.event_type === 'stage_change') addTouch(`employer:${e.opportunity_id}`, { at: e.changed_at, who: null, channel: 'stage' });
  for (const t of doneTodos) { const type = Object.keys(LINK_TYPE).find(k => LINK_TYPE[k] === t.link_type); if (type && t.completed_at) addTouch(`${type}:${t.link_id}`, { at: t.completed_at, who: names.get(t.owner_user_id) || null, channel: 'to-do done' }); }

  const companies = [
    ...partners.filter(p => !p.archived_at).map(p => ({ type: 'partner', id: p.id, name: p.name, stage: p.pipeline_status || 'not_started', row: p, created_at: p.updated_at })),
    ...opps.filter(o => !o.archived_at).map(o => ({ type: 'employer', id: o.id, name: o.organization, stage: o.stage || 'target', row: o, created_at: o.created_at })),
    // visitor-people-follow-record-v1 V2: an accepted target lives on as the record it was promoted to - not scored twice.
    ...targets.filter(t => t.status !== 'rejected' && t.status !== 'accepted').map(t => ({ type: 'target', id: t.id, name: t.name, stage: t.status || 'proposed', row: t, created_at: t.created_at })),
  ];
  const inputs = dedupeCompanies(companies).map(c => {
    const r = c.row, key = `${c.type}:${c.id}`, nameKey = normName(c.name);
    const visit = visitByRecord.get(key) || latest.get(nameKey) || null;
    const viaUpside = r.source_kind === 'partner_referral' && (upsideIds.has(r.source_partner_id) || UPSIDE_TEAMS.includes(r.owner_team || ''));
    const heat = heatBy.get(key) || heatBy.get(`name:${nameKey}`) || null;
    const touch = latestTouch([...(touchesBy.get(key) || []), ...(touchesBy.get(`name:${nameKey}`) || []), r.last_touch_at ? { at: r.last_touch_at, who: null, channel: 'touch' } : null]);
    const override = overrideByKey.get(nameKey) || (r.priority != null && r.priority_set_at ? { priority: Number(r.priority), not_a_fit: false, set_at: r.priority_set_at } : null);
    const research = researchBy.get(key) || null;
    return {
      type: c.type, id: c.id, name: c.name, stage: c.stage, owner_team: r.owner_team || null, employees: r.employees ?? null, category: r.category || null,
      last_touch_at: touch?.at || null, on_skip_list: skipKeys.has(nameKey), duplicate_of: c.duplicate_of || null,
      source: { kind: r.source_kind || 'unknown', via_upside: viaUpside, named: viaUpside && isNamedReferral(r), campaign_replied: !!heat?.replied, partner_id: r.source_partner_id || null, partner_name: partnerName.get(r.source_partner_id) || null },
      visit, people: peopleBy.get(key) || [], research, heat, override,
      meta: {
        name: c.name, owner_user_id: r.owner_user_id || null, owner: names.get(r.owner_user_id) || null, owner_team: r.owner_team || null,
        co_owner_name: r.co_owner_name || null, no_double_touch: r.no_double_touch === true, stage: c.stage, employees: r.employees ?? null, kind: r.kind || null,
        visits_7d: visit?.visits_7d ?? null, unique_visitors_7d: visit?.unique_visitors_7d ?? null, last_visit: visit?.last_visit || visit?.pulled_on || null,
        people: (peopleBy.get(key) || []).length, last_touch_at: touch?.at || null, last_touch_who: touch?.who || null, last_touch_channel: touch?.channel || null,
        researched: !research ? 'none' : (now - Date.parse(research.created_at)) / DAY > weights.research.fresh_days ? 'decayed' : 'fresh', research_at: research?.created_at || null,
        created_at: c.created_at || null,
      },
    };
  });
  // visitor-people-follow-record-v1 (Stage 2 ruling): an accepted target whose promoted record exists counts once, as that
  // record - a partner by promoted_goal_id, an employer by the "from target <id>" its notes carry (no link column).
  const fromTarget = new Set(opps.map(o => /from target ([0-9a-f-]{36})/i.exec(o.notes || '')?.[1]).filter(Boolean));
  const partnerIds = new Set(partners.map(p => p.id));
  const promotedOn = t => t.status === 'accepted' && ((t.promoted_goal_id && partnerIds.has(t.promoted_goal_id)) || fromTarget.has(t.id));
  // brad-attribution-v1 F2: the dated rows the funnel reads - the same single pass, nothing fetched twice.
  const src = r => ({ source_kind: r.source_kind || null, source_partner_id: r.source_partner_id || null, source_person: r.source_person || null, source_set_by: r.source_set_by || null, source_set_at: r.source_set_at || null, owner_team: r.owner_team || null, co_owner_name: r.co_owner_name || null, created_at: r.created_at || null });
  const dated = {
    companies: [
      ...partners.filter(p => !p.archived_at).map(p => ({ type: 'partner', id: p.id, name: p.name, stage: p.pipeline_status || 'not_started', ...src(p) })),
      ...opps.filter(o => !o.archived_at).map(o => ({ type: 'employer', id: o.id, name: o.organization, stage: o.stage || 'target', ...src(o) })),
      ...targets.filter(t => t.status !== 'rejected' && !promotedOn(t)).map(t => ({ type: 'target', id: t.id, name: t.name, stage: t.status || 'proposed', ...src(t) })),
    ],
    visits, prospects, messages, partnerEvents, oppEvents, doneTodos, marks, signals: acceptedSignals, targets: targets.map(t => ({ id: t.id, status: t.status, decided_at: t.decided_at || null })), partnerNames: partnerName,
  };
  return { inputs, weights, names, settings: settings || null, dated };
}

// One company's score row as the table stores it.
export function scoreRow(inp, weights, { businessId, now }) {
  const s = scoreCompany(inp, weights, { now });
  return {
    business_id: businessId, company_type: inp.type, company_id: inp.id, score: s.score, band: s.band,
    components: { ...s.components, meta: inp.meta },
    source_kind: s.source_kind, source_label: s.source_label, source_partner_id: inp.source?.partner_id || null,
    closed: s.closed, flagged_out: s.flagged_out, duplicate_of: s.duplicate_of, override: s.override, computed_at: new Date(now).toISOString(),
  };
}

const inFlight = new Map();
// The runner: idempotent (upsert by PK, stale rows for archived records deleted), one row per company per LA day in
// sales_company_score_days (older than SNAPSHOT_KEEP_DAYS dropped), only = { type, id } limits the write to one company.
export async function recomputeScores(supabase, { businessId, trigger = 'manual', now = Date.now(), only = null } = {}) {
  if (!TRIGGERS.includes(trigger)) throw Object.assign(new Error(`trigger must be one of ${TRIGGERS.join('|')}`), { status: 400 });
  const { inputs, weights } = await gatherInputs(supabase, businessId, { now });
  const chosen = only ? inputs.filter(i => i.type === only.type && i.id === only.id) : inputs;
  if (only && !chosen.length) throw Object.assign(new Error(`${only.type} not found`), { status: 404 });
  const rows = chosen.map(i => scoreRow(i, weights, { businessId, now }));
  const today = laDateString(new Date(now));
  for (let i = 0; i < rows.length; i += 200) must(await supabase.from('sales_company_scores').upsert(rows.slice(i, i + 200), { onConflict: 'business_id,company_type,company_id' }).select('company_id'));
  const days = rows.map(r => ({ business_id: businessId, company_type: r.company_type, company_id: r.company_id, day: today, score: r.score, band: r.band }));
  for (let i = 0; i < days.length; i += 200) must(await supabase.from('sales_company_score_days').upsert(days.slice(i, i + 200), { onConflict: 'business_id,company_type,company_id,day' }).select('company_id'));
  let removed = 0;
  if (!only) {
    const keep = new Set(rows.map(r => `${r.company_type}:${r.company_id}`));
    const existing = await selectAllPages(() => supabase.from('sales_company_scores').select('company_type, company_id').eq('business_id', businessId).order('company_id'));
    for (const e of existing.filter(x => !keep.has(`${x.company_type}:${x.company_id}`))) {
      must(await supabase.from('sales_company_scores').delete().eq('business_id', businessId).eq('company_type', e.company_type).eq('company_id', e.company_id));
      removed += 1;
    }
    must(await supabase.from('sales_company_score_days').delete().eq('business_id', businessId).lt('day', laDateString(new Date(now - SNAPSHOT_KEEP_DAYS * DAY))));
  }
  const ranked = rows.filter(r => !r.flagged_out && !r.duplicate_of);
  const counts = { companies: rows.length, ranked: ranked.length, removed, closed: rows.filter(r => r.closed).length, live: rows.filter(r => r.flagged_out).length, duplicates: rows.filter(r => r.duplicate_of).length };
  for (const b of ['P1', 'P2', 'P3', 'P4']) counts[b] = ranked.filter(r => r.band === b).length;
  return { ran: true, trigger, computed_at: new Date(now).toISOString(), counts, rows };
}

export async function lastComputedAt(supabase, businessId) {
  const rows = must(await supabase.from('sales_company_scores').select('computed_at').eq('business_id', businessId).order('computed_at', { ascending: false }).limit(1));
  return rows[0]?.computed_at || null;
}
export const isStale = (computedAt, now = Date.now(), hours = STALE_HOURS) => !computedAt || now - Date.parse(computedAt) > hours * 3600e3;

// Page load (S2 nightly consistency): recompute only when the newest row is older than STALE_HOURS.
export async function recomputeIfStale(supabase, businessId, { now = Date.now() } = {}) {
  const at = await lastComputedAt(supabase, businessId);
  if (!isStale(at, now)) return { ran: false, reason: 'fresh', computed_at: at };
  const out = await recomputeScores(supabase, { businessId, trigger: 'pageload', now });
  // FIX headcount-auto-v1 REV2 H5 (3): the same 24 h hook runs the free headcount paths for new companies + at most
  // PAGE_LOAD_LOOKUPS enrich lookups, in the background (never on the in-memory test Supabase).
  const { schedulePageLoadFill } = await import('./headcountRun.js');
  schedulePageLoadFill(supabase, businessId);
  return out;
}

// The hook the other routes call after a change: never awaited by them, one run in flight per workspace (a second
// call while one runs is folded into a follow-up run so the change it saw is scored), errors logged, never thrown.
// The in-memory test Supabase (testing/fakeSupabase.mjs, the one with a .db) never gets a background run - a suite
// that wants one calls recomputeScores itself, or passes force - so other routes' tests see only their own writes.
export function scheduleRecompute(supabase, businessId, trigger, { log = console.error, force = false } = {}) {
  if (supabase?.db && !force) return null;
  const key = businessId;
  const cur = inFlight.get(key);
  if (cur) { cur.again = trigger; return cur.promise; }
  const state = { again: null };
  state.promise = (async () => {
    try { await recomputeScores(supabase || getSupabase(), { businessId, trigger }); }
    catch (e) { log(`[scores/recompute ${trigger}]`, cleanText(String(e.message || e), 200)); }
    finally {
      inFlight.delete(key);
      if (state.again) scheduleRecompute(supabase, businessId, state.again, { log });
    }
  })();
  inFlight.set(key, state);
  return state.promise;
}
export const recomputeInFlight = () => inFlight.size;
