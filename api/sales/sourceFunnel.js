import { normName } from './intakeMatch.js';
import { laDateString } from './laDate.js';

// brad-attribution-v1 Stage 1 (F1 / F2) - the per-company funnel as five dates (plus lost), computed from the rows
// intentScoreRun.gatherInputs already gathers (dated), never stored. Rulings (Stage 0): Referred = partner_referral /
// person_referral only - a backfilled source (source_set_by null) dates it at the record's created_at, a user-set one at
// source_set_at; every date is an LA day; a later stage without an earlier one is legal; counts are cumulative.
// Lost keeps the earlier dates (drop-off is shown, never erased). Stage dates come from, in this order of
// precedence per stage: the earliest of every dated source, with a hand-set sales_stage_marks row as one more source.
export const STAGES = ['referred', 'visited', 'replied', 'meeting', 'pilot'];
export const ALL_STAGES = [...STAGES, 'lost'];
export const REFERRAL_KINDS = ['partner_referral', 'person_referral'];
export const YELLOW = { partner: ['meeting_set', 'proposal_pilot'], employer: ['meeting', 'proposal_pilot'] };
export const GREEN = { partner: ['live'], employer: ['verbal', 'contract', 'launched'] };
export const LOST = { partner: ['paused'], employer: ['lost', 'nurture', 'on_hold'], target: ['rejected'] };
// Observed Oct 27: willing_to_meet, follow_up_question, person_referral (positive); already_left_company_or_not_right_person (negative).
export const NEGATIVE_REPLY = new Set(['already_left_company_or_not_right_person', 'not_interested', 'unsubscribe', 'out_of_office', 'wrong_person', 'bounce', 'no_longer_at_company']);
export const RATE_MIN = 10; // "n of m" only below this; a percentage needs m >= 10
export const RATES = [['visited_of_referred', 'visited', 'referred'], ['replied_of_visited', 'replied', 'visited'], ['meeting_of_replied', 'meeting', 'replied'], ['pilot_of_meeting', 'pilot', 'meeting']];
const day = v => (!v ? null : /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : laDateString(new Date(v)));
const first = (cur, next) => (!next ? cur : !cur || next < cur ? next : cur);

// Every dated source indexed once: { visits by key / name, replies by company key, partner events by goal, employer events, done to-dos, marks, signals }.
export function indexDated(dated = {}) {
  const visitsByRecord = new Map(), visitsByName = new Map();
  for (const v of dated.visits || []) {
    const d = day(v.seen_from || v.pulled_on);
    if (!d) continue;
    if (v.matched_type && v.matched_id) { const k = `${v.matched_type === 'opportunity' ? 'employer' : v.matched_type}:${v.matched_id}`; visitsByRecord.set(k, first(visitsByRecord.get(k), d)); }
    const n = normName(v.company_name); if (n) visitsByName.set(n, first(visitsByName.get(n), d));
  }
  const contactCompany = new Map();
  for (const p of dated.prospects || []) { if (p.opportunity_id) contactCompany.set(p.contact_id, `employer:${p.opportunity_id}`); else if (p.goal_id) contactCompany.set(p.contact_id, `partner:${p.goal_id}`); }
  const replies = new Map();
  for (const m of dated.messages || []) {
    if (!m.replied || NEGATIVE_REPLY.has(m.reply_class || '')) continue;
    const k = contactCompany.get(m.contact_id); if (!k) continue;
    replies.set(k, first(replies.get(k), day(m.replied_at || m.delivered_at)));
  }
  const partnerEvents = new Map();
  for (const e of dated.partnerEvents || []) { const k = `partner:${e.goal_id}`; if (!partnerEvents.has(k)) partnerEvents.set(k, []); partnerEvents.get(k).push(e); }
  const oppEvents = new Map();
  for (const e of dated.oppEvents || []) { const k = `employer:${e.opportunity_id}`; if (!oppEvents.has(k)) oppEvents.set(k, []); oppEvents.get(k).push(e); }
  const meetingTodos = new Map();
  for (const t of dated.doneTodos || []) { if (!t.completed_at || !/meeting/i.test(t.text || '')) continue; const type = t.link_type === 'opportunity' ? 'employer' : t.link_type; if (!type || !t.link_id) continue; const k = `${type}:${t.link_id}`; meetingTodos.set(k, first(meetingTodos.get(k), day(t.completed_at))); }
  const marks = new Map();
  for (const m of dated.marks || []) { const k = `${m.record_type}:${m.record_id}`; if (!marks.has(k)) marks.set(k, {}); marks.get(k)[m.stage] = first(marks.get(k)[m.stage], day(m.at)); }
  const inboundAccepted = new Map();
  for (const s of dated.signals || []) { if (s.source !== 'inbound' || !s.target_id) continue; const k = `target:${s.target_id}`; inboundAccepted.set(k, first(inboundAccepted.get(k), day(s.decided_at))); }
  const targetLost = new Map();
  for (const t of dated.targets || []) if (t.status === 'rejected' && t.decided_at) targetLost.set(`target:${t.id}`, day(t.decided_at));
  return { visitsByRecord, visitsByName, replies, partnerEvents, oppEvents, meetingTodos, marks, inboundAccepted, targetLost };
}

// One company -> { referred, visited, replied, meeting, pilot, lost, src: { stage: 'what dated it' } }. company = { type, id,
// name, source_kind, source_set_by, source_set_at, created_at }; idx = indexDated(dated).
export function funnelOf(company, idx) {
  const key = `${company.type}:${company.id}`;
  const out = { referred: null, visited: null, replied: null, meeting: null, pilot: null, lost: null, src: {} };
  const set = (stage, d, src) => { if (!d) return; if (!out[stage] || d < out[stage]) { out[stage] = d; out.src[stage] = src; } };
  if (REFERRAL_KINDS.includes(company.source_kind)) set('referred', day(company.source_set_by ? company.source_set_at : company.created_at), company.source_set_by ? 'source_set_at' : 'created_at (backfilled source)');
  set('visited', idx.visitsByRecord.get(key), 'web_visits (matched)');
  if (!out.visited) set('visited', idx.visitsByName.get(normName(company.name)), 'web_visits (name)');
  set('replied', idx.replies.get(key), 'email reply');
  set('replied', idx.inboundAccepted.get(key), 'inbound signal accepted');
  for (const e of idx.partnerEvents.get(key) || []) {
    const d = day(e.at);
    if (e.event === 'status' && e.to_status === 'replied') set('replied', d, 'partner status -> replied');
    if (e.event === 'status' && YELLOW.partner.includes(e.to_status)) set('meeting', d, `partner status -> ${e.to_status}`);
    if (e.event === 'status' && GREEN.partner.includes(e.to_status)) set('pilot', d, `partner status -> ${e.to_status}`);
    if (e.event === 'status' && LOST.partner.includes(e.to_status)) set('lost', d, `partner status -> ${e.to_status}`);
    if (e.event === 'touch' && e.touch_type === 'meeting') set('meeting', d, 'partner touch (meeting)');
  }
  for (const e of idx.oppEvents.get(key) || []) {
    const d = day(e.changed_at), how = e.event_type === 'created' ? 'created at stage' : 'stage change';
    if (YELLOW.employer.includes(e.to_stage)) set('meeting', d, `${how} ${e.to_stage}`);
    if (GREEN.employer.includes(e.to_stage)) set('pilot', d, `${how} ${e.to_stage}`);
    if (LOST.employer.includes(e.to_stage)) set('lost', d, `${how} ${e.to_stage}`);
  }
  set('meeting', idx.meetingTodos.get(key), 'to-do done (meeting)');
  set('lost', idx.targetLost.get(key), 'target rejected');
  for (const [stage, d] of Object.entries(idx.marks.get(key) || {})) if (ALL_STAGES.includes(stage)) set(stage, d, 'marked by hand');
  return out;
}

export const rate = (n, m) => ({ n, m, pct: m >= RATE_MIN ? Math.round((n / m) * 100) : null });
const counts = rows => Object.fromEntries(ALL_STAGES.map(s => [s, rows.filter(r => r.funnel[s]).length]));
const conversion = c => Object.fromEntries(RATES.map(([k, a, b]) => [k, rate(c[a], c[b])]));

// A grouped funnel table: rows = companies with their funnel; groupBy 'rep' (source_person · partner), 'partner', 'source'.
export function funnelGroups(rows, groupBy, { partnerNames = new Map() } = {}) {
  const keyOf = r => (groupBy === 'rep' ? (r.source_person ? `${r.source_partner_id || ''}|${r.source_person}` : null) : groupBy === 'partner' ? r.source_partner_id || null : r.source_kind || 'not_set');
  const labelOf = (k, r) => (groupBy === 'rep' ? `${r.source_person}${r.source_partner_id ? ` · ${partnerNames.get(r.source_partner_id) || ''}` : ''}`.trim() : groupBy === 'partner' ? partnerNames.get(k) || 'A removed partner' : k === 'not_set' ? 'Not set yet' : k);
  const m = new Map();
  for (const r of rows) { const k = keyOf(r); if (k == null) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return [...m].map(([k, rs]) => { const c = counts(rs); return { key: k, label: labelOf(k, rs[0]), partner: groupBy === 'rep' ? partnerNames.get(rs[0].source_partner_id) || null : null, ...c, conversion: conversion(c), companies: rs.length }; })
    .sort((a, b) => b.referred - a.referred || b.companies - a.companies || String(a.label).localeCompare(String(b.label)));
}
export const funnelTotals = rows => { const c = counts(rows); return { ...c, conversion: conversion(c), companies: rows.length }; };

// "Since yesterday": how many companies entered each stage today (their stage date = today).
export const sinceYesterday = (rows, today) => Object.fromEntries(ALL_STAGES.map(s => [s, rows.filter(r => r.funnel[s] === today).length]));

// The company panel's one-line journey: "Referred by Brad (Upside) Oct 22 → Visited Oct 24 → Replied Oct 26 → Meeting —".
const md = d => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—');
export function journeyLine(funnel, { referredBy = null } = {}) {
  const parts = STAGES.map(s => `${s === 'referred' && referredBy ? `Referred by ${referredBy}` : s[0].toUpperCase() + s.slice(1)} ${md(funnel[s])}`);
  if (funnel.lost) parts.push(`Lost ${md(funnel.lost)}`);
  return parts.join(' → ');
}
