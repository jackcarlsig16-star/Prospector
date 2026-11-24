import { getSupabase, laMonday } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { logFlow } from './flowEvents.js';
import { cleanText } from './scrubText.js';
import { normName } from './normName.js';
import { laDateString } from './laDate.js';

// fathom-notes-v1 REV 2 F11 / F12 - the Calls log (one read: the view sales_calls_v) and the ONE primary record a call
// note is about (sales_call_notes.record_type + record_id). The link is set by a member's pick, by the attendees'
// external domains when exactly one record carries one, or by the extract's first company when exactly one record
// carries that name key - never by a model and never past one record. Every set and unset writes an Activity line on
// the company (sales_flow_events kind call_link / call_unlink).

export const CALL_RECORD_TYPES = ['partner', 'employer', 'target'];
const TABLE = { partner: ['sales_goals', 'name'], employer: ['sales_opportunities', 'organization'], target: ['sales_targets', 'name'] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (status, message) => Object.assign(new Error(message), { status });
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const dom = d => String(d || '').trim().toLowerCase().replace(/^www\./, '');
const md = d => new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const out = r => ({ type: r.type, id: r.id, name: cleanText(r.name, 160) });

// The records a call can be about: live partners and employers, and targets that have not been promoted (a promoted
// target IS the partner or employer it points at).
export async function liveRecords(supabase, businessId) {
  const page = (table, cols, f = q => q) => selectAllPages(() => f(supabase.from(table).select(cols).eq('business_id', businessId)).order('id'));
  const [partners, employers, targets, domains] = await Promise.all([
    page('sales_goals', 'id, name, company_domain', q => q.eq('goal_type', 'partnership').is('archived_at', null)),
    page('sales_opportunities', 'id, organization, domain', q => q.is('archived_at', null)),
    page('sales_targets', 'id, name, domain', q => q.is('promoted_goal_id', null).is('employer_id', null)),
    page('partner_domains', 'id, goal_id, domain', q => q.eq('confirmed', true)),
  ]);
  const extra = new Map();
  for (const d of domains) extra.set(d.goal_id, [...(extra.get(d.goal_id) || []), dom(d.domain)]);
  return [
    ...partners.map(p => ({ type: 'partner', id: p.id, name: p.name, domains: [dom(p.company_domain), ...(extra.get(p.id) || [])].filter(Boolean) })),
    ...employers.map(o => ({ type: 'employer', id: o.id, name: o.organization, domains: [dom(o.domain)].filter(Boolean) })),
    ...targets.map(t => ({ type: 'target', id: t.id, name: t.name, domains: [dom(t.domain)].filter(Boolean) })),
  ];
}

// Pure. -> { record, by: 'domain' | 'name' | null, candidates } - record only when a rule lands on exactly one.
export function proposeRecord({ attendees, extract }, records) {
  const external = new Set((Array.isArray(attendees) ? attendees : []).filter(a => a?.is_external && a.domain).map(a => dom(a.domain)));
  const byDomain = external.size ? records.filter(r => r.domains.some(d => external.has(d))) : [];
  if (byDomain.length === 1) return { record: out(byDomain[0]), by: 'domain', candidates: [] };
  const key = normName(Array.isArray(extract?.companies) ? extract.companies[0]?.name : '');
  const byName = key ? records.filter(r => normName(r.name) === key) : [];
  const candidates = [...byDomain, ...byName.filter(r => !byDomain.includes(r))].slice(0, 8).map(out);
  return byName.length === 1 ? { record: out(byName[0]), by: 'name', candidates } : { record: null, by: null, candidates };
}

export async function recordRow(supabase, businessId, type, id) {
  if (!CALL_RECORD_TYPES.includes(type) || !UUID.test(id || '')) return null;
  const [table, col] = TABLE[type];
  const row = must(await supabase.from(table).select(`id, ${col}`).eq('business_id', businessId).eq('id', id).maybeSingle());
  return row && { type, id: row.id, name: row[col] };
}

const WORDS = { pick: 'Call linked', domain: 'Call linked by domain', name: 'Call linked by name' };

// The one writer of a note's record link. record = { type, id } or null (none). by = 'pick' | 'domain' | 'name'.
// -> { changed, record }. The note keeps its old link when the Activity line cannot be written.
export async function setCallRecord(supabase, { businessId, noteId, record, byUser = null, by = 'pick', now = new Date() }) {
  if (!UUID.test(noteId || '')) throw err(404, 'note not found');
  const note = must(await supabase.from('sales_call_notes').select('id, title, call_date, record_type, record_id').eq('business_id', businessId).eq('id', noteId).maybeSingle());
  if (!note) throw err(404, 'note not found');
  const next = record ? await recordRow(supabase, businessId, record.type, record.id) : null;
  if (record && !next) throw err(400, 'record not found - pick a partner, an employer or a target of this workspace');
  if ((note.record_type || null) === (next?.type || null) && (note.record_id || null) === (next?.id || null)) return { changed: false, record: next && out(next) };
  const set = link => supabase.from('sales_call_notes').update({ record_type: link?.type || null, record_id: link?.id || null }).eq('business_id', businessId).eq('id', note.id).select('id');
  must(await set(next));
  const label = `${cleanText(note.title || 'Call notes', 120)} · ${md(note.call_date)}`;
  try {
    if (note.record_id) await logFlow(supabase, { businessId, recordType: note.record_type, recordId: note.record_id, kind: 'call_unlink', text: `Call unlinked: ${label}`, meta: { note_id: note.id }, byUser, now });
    if (next) await logFlow(supabase, { businessId, recordType: next.type, recordId: next.id, kind: 'call_link', text: `${WORDS[by] || WORDS.pick}: ${label}`, meta: { note_id: note.id, by }, byUser, now });
  } catch (e) {
    await set(note.record_id ? { type: note.record_type, id: note.record_id } : null);
    throw e;
  }
  return { changed: true, record: next && out(next) };
}

// A stored note with no link yet: set it when a rule lands on one record (a link a member or an earlier rule set is
// left alone). Never throws - storing a recording and reading it do not depend on the link.
export async function linkStoredNote(supabase, { businessId, noteId, extract = null }) {
  try {
    const note = must(await supabase.from('sales_call_notes').select('id, attendees, record_id').eq('business_id', businessId).eq('id', noteId).maybeSingle());
    if (!note || note.record_id) return null;
    const p = proposeRecord({ attendees: note.attendees, extract }, await liveRecords(supabase, businessId));
    if (!p.record) return null;
    await setCallRecord(supabase, { businessId, noteId: note.id, record: p.record, by: p.by });
    return p;
  } catch (e) { console.error('[calls/link]', e.message); return null; }
}

// What the review shows under "This call is about": the note's link when it has one, else what the rules propose.
export async function aboutFor(supabase, businessId, { note = null, attendees = null, extract = null }) {
  const records = await liveRecords(supabase, businessId);
  const p = proposeRecord({ attendees: note?.attendees ?? attendees, extract }, records);
  if (note?.record_id) {
    const linked = records.find(r => r.type === note.record_type && r.id === note.record_id) || await recordRow(supabase, businessId, note.record_type, note.record_id);
    if (linked) return { record: out(linked), by: 'linked', candidates: p.candidates };
  }
  return p;
}

// body.about of an Accept: undefined = not sent (the rules decide), null = "none", { type, id } = the member's pick.
export function parseAbout(body) {
  const a = body?.about;
  if (a === undefined) return undefined;
  if (a === null) return null;
  if (!CALL_RECORD_TYPES.includes(a?.type) || !UUID.test(a?.id || '')) throw err(400, 'about must be { type: partner|employer|target, id } or null');
  return { type: a.type, id: a.id };
}

// After an Accept: the pick wins; "none" clears; nothing sent leaves a link alone and otherwise lets the rules set it.
export async function applyAbout(supabase, { businessId, noteId, about, extract, byUser }) {
  if (about !== undefined) return setCallRecord(supabase, { businessId, noteId, record: about, byUser, by: 'pick' });
  const p = await linkStoredNote(supabase, { businessId, noteId, extract });
  return { changed: !!p, record: p?.record || null };
}

// The call notes that reach a record, the linked ones first: -> ids. extraIds = what the older rules found (a to-do
// the note made on the record, a partner event it wrote, a target's source note).
export async function recordCallIds(supabase, businessId, type, id, extraIds = []) {
  const linked = must(await supabase.from('sales_call_notes').select('id').eq('business_id', businessId).eq('record_type', type).eq('record_id', id).order('call_date', { ascending: false }).limit(200));
  return [...new Set([...linked.map(n => n.id), ...extraIds.filter(Boolean)])];
}

const STATUS_WORD = { reviewed: 'Reviewed', unreviewed: 'Unreviewed', no_proposal: 'No proposal' };
const sourceOf = r => (r.fathom_recording_id ? 'Fathom' : 'Pasted');
export const callRow = (r, names = new Map()) => {
  const people = (Array.isArray(r.attendees) ? r.attendees : []).filter(a => a && (a.name || a.domain));
  return {
    id: r.id, call_date: r.call_date, title: cleanText(r.title || r.source_label || 'Call notes', 200), source: sourceOf(r),
    member: r.created_by ? { id: r.created_by, name: names.get(r.created_by) || null } : null,
    attendees: { names: people.map(a => cleanText(a.name || '', 80)).filter(n => n && !n.includes('@')).slice(0, 8), total: people.length, external: people.filter(a => a.is_external).length },
    record: r.record_id && r.record_name ? { type: r.record_type, id: r.record_id, name: cleanText(r.record_name, 160) } : null,
    duration_seconds: r.duration_seconds ?? null,
    status: r.status, status_label: STATUS_WORD[r.status] || r.status, reviewed_at: r.accepted_at || null,
    fathom_url: typeof r.fathom_url === 'string' && /^https:\/\//.test(r.fathom_url) ? r.fathom_url : null,
  };
};

const VIEW_COLS = 'id, business_id, call_date, title, source_label, created_by, created_at, accepted_at, status, fathom_recording_id, fathom_url, attendees, duration_seconds, record_type, record_id, record_name';
// The calls linked to one record, newest first (the company window's Calls list, the Brief's "Last call").
export async function recordCalls(supabase, businessId, type, id, limit = 5) {
  const rows = must(await supabase.from('sales_calls_v').select(VIEW_COLS).eq('business_id', businessId).eq('record_type', type).eq('record_id', id).order('call_date', { ascending: false }).limit(limit));
  return rows.map(r => callRow(r));
}

// query: who = 'mine' | 'team', unreviewed / week / q, company = 'with' | 'none', record = '<type>:<id>', since / until.
export async function listCalls(supabase, { businessId, userId = null, query = {}, today = laDateString() }) {
  const rows = await selectAllPages(() => supabase.from('sales_calls_v').select(VIEW_COLS).eq('business_id', businessId).order('call_date', { ascending: false }).order('id'));
  const members = must(await supabase.from('business_members').select('user_id, name, profile:profiles!business_members_user_id_fkey(display_name)').eq('business_id', businessId).not('user_id', 'is', null));
  const names = new Map(members.map(m => [m.user_id, ((m.profile?.display_name || m.name || '').trim().split(/\s+/)[0]) || 'Member']));
  const q = String(query.q || '').trim().toLowerCase();
  const [recType, recId] = String(query.record || '').split(':');
  const since = query.week ? laMonday(today) : query.since || null;
  const kept = rows.map(r => callRow(r, names)).filter(r =>
    (query.who !== 'mine' || r.member?.id === userId)
    && (!query.unreviewed || r.status !== 'reviewed')
    && (!since || r.call_date >= since) && (!query.until || r.call_date <= query.until)
    && (query.company !== 'with' || r.record) && (query.company !== 'none' || !r.record)
    && (!recId || (r.record?.type === recType && r.record.id === recId))
    && (!q || r.title.toLowerCase().includes(q) || (r.record?.name || '').toLowerCase().includes(q)));
  return {
    calls: kept, total: rows.length, week_start: laMonday(today),
    counts: { calls: kept.length, unreviewed: kept.filter(r => r.status !== 'reviewed').length, no_company: kept.filter(r => !r.record).length },
  };
}

const flag = v => v === '1' || v === 'true';
// GET /goals/calls?who=&unreviewed=&week=&company=&q= (Viewer+: names, dates, status - never the notes' text).
export async function listCallsRoute(req, res) {
  const { who, unreviewed, week, company, q } = req.query || {};
  try {
    res.json(await listCalls(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id,
      query: { who: who === 'mine' ? 'mine' : 'team', unreviewed: flag(unreviewed), week: flag(week), company: ['with', 'none'].includes(company) ? company : null, q: typeof q === 'string' ? q.slice(0, 80) : '' } }));
  } catch (e) {
    console.error('[calls/list]', e.message);
    res.status(500).json({ error: e.message });
  }
}

// PUT /goals/call-notes/:id/record { type, id } | { type: null } - the member's pick from the Calls tab (Member+).
export async function setCallRecordRoute(req, res) {
  const { type = null, id = null } = req.body || {};
  if (type !== null && (!CALL_RECORD_TYPES.includes(type) || !UUID.test(id || ''))) return res.status(400).json({ error: 'type must be partner|employer|target with an id, or null' });
  try {
    res.json(await setCallRecord(getSupabase(), { businessId: req.params.businessId, noteId: req.params.id, record: type ? { type, id } : null, byUser: req.auth.user.id }));
  } catch (e) {
    if (e.status && e.status < 500) return res.status(e.status).json({ error: e.message });
    console.error('[calls/record]', e.message);
    res.status(500).json({ error: e.message });
  }
}

