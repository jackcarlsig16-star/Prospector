import { getSupabase } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { cleanText, hasPii } from './scrubText.js';
import { normName, resolveCompany } from './intakeMatch.js';
import { trackedMatch } from './trackedFields.js';

// intake-insights-v1 Stage 2 (server) - the notes upload's same Claude call also proposes what to TRACK, what to OPTIMIZE
// and the CHANNEL LINKS the notes state (I1). The server checks them without a model (I2): a track item against the
// registry of what Prospector already records (trackedFields.js), each channel-link end against Pipeline records and
// people by name, plus "Already recorded" when the link is a referral / ownership the company already carries. Kept items
// land on Accept inside the intake's undo (I3/I4): sales_insights (track | optimize) and sales_channel_links, a repeat of
// a live row raising seen_count / last_seen_at instead of a second row. Never an address or a phone anywhere.
export const MAX_TRACK = 5, MAX_OPTIMIZE = 5, MAX_LINKS = 15;
export const WHERE = ['company', 'partner', 'person', 'referral', 'deal', 'activity'];
export const END_KINDS = ['partner', 'office', 'person', 'company'];
export const RELATIONS = ['referred', 'introduced', 'owns', 'co_sells', 'reports_to', 'works_with', 'other'];
export const STATUSES = ['open', 'planned', 'done', 'dismissed'];
const RECORD_TYPE = { partner: 'partner', opportunity: 'employer', target: 'target' };
const isDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T12:00:00Z`));
const err = (status, message) => Object.assign(new Error(message), { status });
const must = r => { if (r.error) throw err(500, r.error.message); return r.data; };
const reply = (status, body) => ({ status, body });
const send = (res, r) => res.status(r.status).json(r.body);
const list = (raw, k, max) => (Array.isArray(raw?.[k]) ? raw[k] : []).filter(x => x && typeof x === 'object').slice(0, max);
const text = (v, max) => (typeof v === 'string' && !hasPii(v) ? cleanText(v, max) : '');

// I1 - appended to the extract SYSTEM prompt; the reply JSON gains "track", "optimize" and "channel_links".
export const INSIGHT_RULES = `track - up to ${MAX_TRACK} data points the notes show matter that we may not record yet. Only from what the notes actually say; never generic CRM advice ("track deal size" with nothing in the notes behind it is NOT allowed): what (max 80 chars, e.g. "Referring office on every Upside referral"), why (max 200), where ("company" | "partner" | "person" | "referral" | "deal" | "activity"), example (the shortest phrase from the notes, max 20 words), evidence.
optimize - up to ${MAX_OPTIMIZE} concrete process or channel improvements the notes point to: text (max 200), why (max 200), evidence.
channel_links - up to ${MAX_LINKS} relationships the notes STATE (never inferred) between partners, offices, people and companies: from {kind: "partner" | "office" | "person" | "company", name as written}, to {kind, name}, relation ("referred" | "introduced" | "owns" | "co_sells" | "reports_to" | "works_with" | "other"), date (YYYY-MM-DD from NOTE DATE, or null), evidence.
- track / optimize / channel_links items carry evidence: the shortest phrase from the notes (max 20 words). No email address or phone number in any of them.`;
export const INSIGHT_JSON = `"track":[{"what":"","why":"","where":"","example":"","evidence":""}],"optimize":[{"text":"","why":"","evidence":""}],"channel_links":[{"from":{"kind":"","name":""},"to":{"kind":"","name":""},"relation":"","date":null,"evidence":""}]`;

// The model's lists -> clean items (no evidence = dropped: an idea with nothing in the notes behind it is not a finding).
export function toInsights(raw, { noteDate = null } = {}) {
  const track = list(raw, 'track', MAX_TRACK).map(t => ({ what: text(t.what, 80), why: text(t.why, 200) || null, where: WHERE.includes(t.where) ? t.where : null, example: text(t.example, 200) || null, evidence: text(t.evidence, 200) }))
    .filter(t => t.what && t.evidence);
  const optimize = list(raw, 'optimize', MAX_OPTIMIZE).map(o => ({ text: text(o.text, 200), why: text(o.why, 200) || null, evidence: text(o.evidence, 200) }))
    .filter(o => o.text && o.evidence);
  const end = e => (e && END_KINDS.includes(e.kind) && text(e.name, 120) ? { kind: e.kind, name: text(e.name, 120) } : null);
  const channel_links = list(raw, 'channel_links', MAX_LINKS).map(l => ({ from: end(l.from), to: end(l.to), relation: RELATIONS.includes(l.relation) ? l.relation : 'other', date: isDate(l.date) && (!noteDate || l.date <= noteDate) ? l.date : null, evidence: text(l.evidence, 200) }))
    .filter(l => l.from && l.to && l.evidence && !(l.from.kind === l.to.kind && normName(l.from.name) === normName(l.to.name)));
  return { track, optimize, channel_links };
}

// I2 - registry match for track items; record / person matches + "already recorded" for links. ctx = the intake context
// (partners, opportunities, targets with their source / ownership columns); people = [{ type, id, name, company }].
export function enrichInsights(ins, ctx, people = []) {
  const track = ins.track.map((t, i) => { const f = trackedMatch(`${t.what} ${t.where || ''}`); return { key: `k${i}`, ...t, already_field: f ? f.label : null, keep: !f }; });
  const optimize = ins.optimize.map((o, i) => ({ key: `o${i}`, ...o, keep: true }));
  const matchEnd = e => {
    if (e.kind === 'person') {
      const hits = people.filter(p => normName(p.name) === normName(e.name));
      return hits.length === 1 ? { record_type: hits[0].type, record_id: hits[0].id, name: hits[0].name } : null;
    }
    if (e.kind === 'office') return null;
    const m = resolveCompany(e.name, ctx);
    return m && RECORD_TYPE[m.type] && !m.partial ? { record_type: RECORD_TYPE[m.type], record_id: m.id, name: m.name, row: m.row } : null;
  };
  const channel_links = ins.channel_links.map((l, i) => {
    const from = matchEnd(l.from), to = matchEnd(l.to);
    return { key: `l${i}`, ...l, from: { ...l.from, match: from && { record_type: from.record_type, record_id: from.record_id, name: from.name } }, to: { ...l.to, match: to && { record_type: to.record_type, record_id: to.record_id, name: to.name } }, already_recorded: alreadyRecorded(l, from, to), keep: true };
  });
  return { track, optimize, channel_links };
}
// A referral / ownership the company already carries: referred -> its source names that partner / person / office;
// owns -> its owner team (Upside) or co-owner names the from end.
function alreadyRecorded(l, from, to) {
  const r = to?.row;
  if (!r || !['referred', 'owns'].includes(l.relation)) return false;
  const same = (a, b) => !!a && !!b && normName(a) === normName(b);
  if (l.relation === 'referred') return (from?.record_type === 'partner' && r.source_partner_id === from.record_id) || (l.from.kind === 'person' && same(r.source_person, l.from.name)) || (l.from.kind === 'office' && same(r.source_office, l.from.name));
  if (l.from.kind === 'person') return same(r.co_owner_name, l.from.name);
  return /upside/i.test(l.from.name) && ['upside', 'both'].includes(r.owner_team || '');
}

// The people links can point at (names only): partner contacts and live sales_people on a record.
export async function linkPeople(supabase, businessId) {
  const [pc, sp] = await Promise.all([
    selectAllPages(() => supabase.from('partner_contacts').select('id, name').eq('business_id', businessId).order('id')),
    selectAllPages(() => supabase.from('sales_people').select('id, name, company_type').eq('business_id', businessId).is('archived_at', null).neq('company_type', 'parked').order('id')),
  ]);
  return [...pc.map(p => ({ type: 'partner_contact', id: p.id, name: p.name })), ...sp.map(p => ({ type: 'sales_person', id: p.id, name: p.name }))];
}

// I3 - the kept items the review sends back with Accept: { insights: { track: [], optimize: [], channel_links: [] } }.
export function parseInsights(body) {
  const ins = body?.insights || {};
  if (typeof ins !== 'object' || Array.isArray(ins)) throw err(400, 'insights must be { track, optimize, channel_links }');
  for (const k of ['track', 'optimize', 'channel_links']) if (ins[k] != null && !Array.isArray(ins[k])) throw err(400, `insights.${k} must be a list`);
  const raw = { track: ins.track || [], optimize: ins.optimize || [], channel_links: ins.channel_links || [] };
  const clean = toInsights(raw);
  if (clean.track.length !== raw.track.length || clean.optimize.length !== raw.optimize.length || clean.channel_links.length !== raw.channel_links.length) throw err(400, 'an insight is missing its text or evidence, or holds an address / phone');
  const recordOf = m => (m && ['partner', 'employer', 'target', 'partner_contact', 'sales_person'].includes(m.record_type) && /^[0-9a-f-]{36}$/i.test(m.record_id || '') ? { record_type: m.record_type, record_id: m.record_id } : null);
  return {
    track: clean.track.map((t, i) => ({ ...t, already_field: text(raw.track[i].already_field, 60) || null })),
    optimize: clean.optimize,
    channel_links: clean.channel_links.map((l, i) => ({ ...l, from_match: recordOf(raw.channel_links[i].from?.match), to_match: recordOf(raw.channel_links[i].to?.match) })),
  };
}

// I4 - write the kept items on Accept; each write pushes its undo. A live row with the same key (insights: kind +
// lower(text) while open | planned; links: both ends + relation while not archived) is bumped, not duplicated.
export async function writeInsights(supabase, { businessId, userId, noteId, insights, undo, now = new Date() }) {
  const stamp = now.toISOString();
  const out = { insights_added: 0, insights_seen: 0, links_added: 0, links_seen: 0 };
  const live = await selectAllPages(() => supabase.from('sales_insights').select('id, kind, text, seen_count, last_seen_at').eq('business_id', businessId).in('status', ['open', 'planned']).order('id'));
  const items = [...insights.track.map(t => ({ kind: 'track', text: t.what, why: t.why, where_text: t.where, example: t.example, already_field: t.already_field })), ...insights.optimize.map(o => ({ kind: 'optimize', text: o.text, why: o.why }))];
  for (const it of items) {
    const hit = live.find(r => r.kind === it.kind && r.text.toLowerCase() === it.text.toLowerCase());
    if (hit) {
      const prev = { seen_count: hit.seen_count, last_seen_at: hit.last_seen_at };
      must(await supabase.from('sales_insights').update({ seen_count: prev.seen_count + 1, last_seen_at: stamp }).eq('id', hit.id));
      undo.push(() => supabase.from('sales_insights').update(prev).eq('id', hit.id));
      hit.seen_count += 1; hit.last_seen_at = stamp; out.insights_seen++;
      continue;
    }
    const row = must(await supabase.from('sales_insights').insert({ business_id: businessId, ...it, where_text: it.where_text || null, example: it.example || null, already_field: it.already_field || null, status: 'open', seen_count: 1, note_id: noteId, created_by: userId, last_seen_at: stamp }).select('id, kind, text, seen_count, last_seen_at').single());
    undo.push(() => supabase.from('sales_insights').delete().eq('id', row.id));
    live.push(row); out.insights_added++;
  }
  const links = await selectAllPages(() => supabase.from('sales_channel_links').select('id, from_kind, from_name, relation, to_kind, to_name, seen_count, last_seen_at').eq('business_id', businessId).is('archived_at', null).order('id'));
  const same = (r, l) => r.from_kind === l.from.kind && r.from_name.toLowerCase() === l.from.name.toLowerCase() && r.relation === l.relation && r.to_kind === l.to.kind && r.to_name.toLowerCase() === l.to.name.toLowerCase();
  for (const l of insights.channel_links) {
    const hit = links.find(r => same(r, l));
    if (hit) {
      const prev = { seen_count: hit.seen_count, last_seen_at: hit.last_seen_at };
      must(await supabase.from('sales_channel_links').update({ seen_count: prev.seen_count + 1, last_seen_at: stamp }).eq('id', hit.id));
      undo.push(() => supabase.from('sales_channel_links').update(prev).eq('id', hit.id));
      hit.seen_count += 1; hit.last_seen_at = stamp; out.links_seen++;
      continue;
    }
    const row = must(await supabase.from('sales_channel_links').insert({
      business_id: businessId, from_kind: l.from.kind, from_name: l.from.name, from_record_type: l.from_match?.record_type || null, from_record_id: l.from_match?.record_id || null,
      to_kind: l.to.kind, to_name: l.to.name, to_record_type: l.to_match?.record_type || null, to_record_id: l.to_match?.record_id || null,
      relation: l.relation, link_date: l.date, evidence: l.evidence, note_id: noteId, seen_count: 1, created_by: userId, last_seen_at: stamp,
    }).select('id, from_kind, from_name, relation, to_kind, to_name, seen_count, last_seen_at').single());
    undo.push(() => supabase.from('sales_channel_links').delete().eq('id', row.id));
    links.push(row); out.links_added++;
  }
  return out;
}

// Dashboard reads. GET /goals/insights?status=open|planned|done|dismissed|all -> { track, optimize } (newest seen first,
// the note title + date it came from).
export async function listInsights(supabase, { businessId, query = {} }) {
  const status = query.status || 'live';
  if (status !== 'live' && status !== 'all' && !STATUSES.includes(status)) return reply(400, { error: `status must be live | all | ${STATUSES.join(' | ')}` });
  const rows = await selectAllPages(() => {
    let q = supabase.from('sales_insights').select('id, kind, text, why, where_text, example, status, already_field, note_id, seen_count, last_seen_at, created_at, decided_at').eq('business_id', businessId);
    if (status === 'live') q = q.in('status', ['open', 'planned']); else if (status !== 'all') q = q.eq('status', status);
    return q.order('id');
  });
  const noteIds = [...new Set(rows.map(r => r.note_id).filter(Boolean))];
  const notes = new Map(noteIds.length ? must(await supabase.from('sales_call_notes').select('id, title, call_date').eq('business_id', businessId).in('id', noteIds)).map(n => [n.id, n]) : []);
  const shaped = rows.map(r => ({ ...r, note: notes.get(r.note_id) ? { title: notes.get(r.note_id).title, call_date: notes.get(r.note_id).call_date } : null }))
    .sort((a, b) => String(b.last_seen_at).localeCompare(String(a.last_seen_at)));
  return reply(200, { track: shaped.filter(r => r.kind === 'track'), optimize: shaped.filter(r => r.kind === 'optimize') });
}

// PATCH /goals/insights/:id { status, expect? } (Members; salesGate): open -> planned -> done, or dismissed (archive).
// expect = the status the screen showed (a teammate's change in between = 409).
export async function setInsightStatus(supabase, { businessId, userId, id, body = {}, now = new Date() }) {
  if (!/^[0-9a-f-]{36}$/i.test(id || '')) return reply(404, { error: 'insight not found' });
  if (!STATUSES.includes(body.status)) return reply(400, { error: `status must be ${STATUSES.join(' | ')}` });
  const row = must(await supabase.from('sales_insights').select('id, status').eq('business_id', businessId).eq('id', id).maybeSingle());
  if (!row) return reply(404, { error: 'insight not found' });
  if (body.expect != null && body.expect !== row.status) return reply(409, { error: 'That item changed since - reload' });
  const rows = must(await supabase.from('sales_insights').update({ status: body.status, decided_by: userId, decided_at: now.toISOString() }).eq('id', id).eq('status', row.status).select('id, status, decided_at'));
  if (!rows.length) return reply(409, { error: 'That item changed since - reload' });
  return reply(200, { insight: rows[0], before: row.status });
}

// GET /goals/channel-links?partner=<id>|record=<type>:<id> -> { links } (live rows; a partner / record filter keeps links
// with it on either end - the Sources table and the company window's "Linked in notes").
export async function listChannelLinks(supabase, { businessId, query = {} }) {
  if (query.partner && !/^[0-9a-f-]{36}$/i.test(query.partner)) return reply(400, { error: 'partner must be a partner id' });
  const rec = query.record ? /^(partner|employer|target):([0-9a-f-]{36})$/i.exec(query.record) : null;
  if (query.record && !rec) return reply(400, { error: 'record must be partner|employer|target:<id>' });
  const rows = await selectAllPages(() => supabase.from('sales_channel_links').select('id, from_kind, from_name, from_record_type, from_record_id, to_kind, to_name, to_record_type, to_record_id, relation, link_date, evidence, note_id, seen_count, last_seen_at, created_at').eq('business_id', businessId).is('archived_at', null).order('id'));
  const on = (type, id) => r => (r.from_record_type === type && r.from_record_id === id) || (r.to_record_type === type && r.to_record_id === id);
  const links = query.partner ? rows.filter(on('partner', query.partner)) : rec ? rows.filter(on(rec[1], rec[2])) : rows;
  return reply(200, { links: links.sort((a, b) => String(b.last_seen_at).localeCompare(String(a.last_seen_at))) });
}

const ctx = req => ({ businessId: req.params.businessId, userId: req.auth.user.id, id: req.params.id, body: req.body || {}, query: req.query || {} });
export async function listInsightsRoute(req, res) { try { send(res, await listInsights(getSupabase(), ctx(req))); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } }
export async function setInsightStatusRoute(req, res) { try { send(res, await setInsightStatus(getSupabase(), ctx(req))); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } }
export async function listChannelLinksRoute(req, res) { try { send(res, await listChannelLinks(getSupabase(), ctx(req))); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } }
