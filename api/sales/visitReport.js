import ExcelJS from 'exceljs';
import { getSupabase, addDays } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { laDateString } from './laDate.js';
import { normName } from './intakeMatch.js';
import { cleanText } from './scrubText.js';
import { hasPii } from './targetsRoutes.js';
import { PRIORITY_LABEL } from './visitRules.js';
import { loadOverrides, effectiveVisit } from './visitPriority.js';

// signals-v1 REV4 Stage 5 (D12) - the daily "Website visitors" report, built
// only from what the visit pull stored (web_visits) plus records Prospector
// already holds. Read-only except the skip list. No emails, phone numbers or
// people's names leave here: rows carry company fields only, sequence names
// are scrubbed of member names, and the Brad file is re-read cell by cell
// and refused if anything looks like an email or phone number.
export const REPORT_DAYS = 7;
export const UPSIDE_TEAMS = ['upside', 'both'];
const RANK = { P1: 0, P2: 1, P3: 2, P4: 3 };
const MATCH_LABEL = { partner: 'Partner', opportunity: 'Employer', target: 'Target' };
const SKIPPED = { priority: 'P4', priority_rule: 'On the skip list', noise_reason: 'On the skip list' };
const VISIT_COLS = 'id, company_key, company_name, domain, us_500, first_visit, last_visit, visits_7d, unique_visitors_7d, top_paths, priority, priority_rule, noise_reason, maybe_user, matched_type, matched_id, pulled_on';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };

const typeOf = (v, rec) => {
  if (v.matched_type === 'partner') return `Partner · ${String(rec?.category || 'uncategorized').replace(/^\d+\.\s*/, '')}`;
  if (v.matched_type === 'opportunity') return 'Employer';
  if (v.matched_type === 'target') return `Target (${rec?.kind || 'unknown kind'})`;
  return 'New';
};

function nextAction(v, signal) {
  if (v.priority === 'P4') return `None - ${v.noise_reason || 'noise'}`;
  if (v.priority === 'P3') return 'Watch';
  if (signal?.status === 'accepted') return 'To-do created from Signals';
  if (signal?.status === 'dismissed') return 'Dismissed in Signals';
  if (signal?.status === 'new') return `Review in Signals (${PRIORITY_LABEL[v.priority]})`;
  return v.priority === 'P1' ? 'Reach out today' : 'Reach out this week';
}

// Member names (whole words, 3+ letters) come out of sequence names, which
// people often name after themselves.
export function nameScrubber(members) {
  const words = [...new Set(members.flatMap(m => String(m || '').split(/[^A-Za-z'-]+/)).filter(w => w.length >= 3))];
  if (!words.length) return s => s;
  const re = new RegExp(`\\b(${words.map(w => w.replace(/[-']/g, '\\$&')).join('|')})\\b`, 'gi');
  const SEP = '(?:\\s*[-–—·|:/(),]\\s*)';
  return s => s.replace(re, ' ').replace(new RegExp(`${SEP}{2,}`, 'g'), ' - ').replace(new RegExp(`^${SEP}+|${SEP}+$`, 'g'), '').replace(/\s{2,}/g, ' ').trim();
}

// company_key -> sequence names, from Apollo data the sync already stored:
// prospects' company names -> their messages' sequence ids, plus each
// sequenced account's first sequence. Names come from the latest
// 'sequences' snapshot; an unnamed sequence is left out.
export function sequencesByCompany({ prospects, messages, sequencedAccounts, sequences, scrub }) {
  const nameOf = new Map(sequences.map(s => [s.id, s.name]));
  const keyOfContact = new Map(prospects.filter(p => p.company).map(p => [p.contact_id, normName(p.company)]));
  const out = new Map();
  const add = (key, seqId) => {
    const name = nameOf.get(seqId) && cleanText(scrub(String(nameOf.get(seqId))), 80);
    if (!key || !name) return;
    if (!out.has(key)) out.set(key, new Set());
    out.get(key).add(name);
  };
  for (const m of messages) add(keyOfContact.get(m.contact_id), m.sequence_id);
  for (const a of sequencedAccounts) add(normName(a.name || ''), a.sequence_id);
  return out;
}

// One row per company over the last 7 LA days: the latest pull's priority and
// counts, the earliest first visit and latest last visit across pulls. A
// person's override (sales-ia-v2 P3) beats both the pull and the skip list.
export function buildReport({ visits, skipKeys, records, signals, sources, today, overrides = new Map() }) {
  const byKey = new Map();
  for (const v of [...visits].sort((a, b) => a.pulled_on.localeCompare(b.pulled_on))) {
    const prior = byKey.get(v.company_key);
    const first = [prior?.first_visit, v.first_visit].filter(Boolean).sort()[0] || null;
    const last = [prior?.last_visit, v.last_visit].filter(Boolean).sort().pop() || null;
    byKey.set(v.company_key, { ...v, first_visit: first, last_visit: last });
  }
  const signalOf = new Map();
  for (const s of [...signals].sort((a, b) => a.created_at.localeCompare(b.created_at))) signalOf.set(s.company_key, s);
  const rows = [...byKey.values()].map(raw => {
    const v = effectiveVisit(skipKeys.has(raw.company_key) ? { ...raw, ...SKIPPED, maybe_user: false } : raw, overrides.get(raw.company_key));
    const rec = v.matched_id ? records.get(`${v.matched_type}:${v.matched_id}`) : null;
    const team = rec?.owner_team || null;
    return {
      company_key: v.company_key, company_name: v.company_name, domain: v.domain || null,
      priority: v.priority, priority_rule: v.priority_rule, maybe_user: !!v.maybe_user, skipped: skipKeys.has(v.company_key), override: v.override || null,
      type: typeOf(v, rec), size: v.us_500 ? 'US 500+' : 'size unknown',
      match: rec ? { type: v.matched_type, label: MATCH_LABEL[v.matched_type], id: v.matched_id, record_id: rec.record_id || null, owner_team: team, upside: UPSIDE_TEAMS.includes(team) } : null,
      visits_7d: v.visits_7d ?? 0, unique_visitors_apollo: v.unique_visitors_7d ?? 0,
      first_visit: v.first_visit, last_visit: v.last_visit, pulled_on: v.pulled_on,
      top_pages: (v.top_paths || []).map(p => p.path),
      sources: [...(sources.get(v.company_key) || [])].sort(),
      next_action: nextAction(v, signalOf.get(v.company_key)),
    };
  }).sort((a, b) => RANK[a.priority] - RANK[b.priority] || (b.match?.upside ? 1 : 0) - (a.match?.upside ? 1 : 0)
    || b.visits_7d - a.visits_7d || a.company_name.localeCompare(b.company_name));
  const counts = { companies: rows.length, P1: 0, P2: 0, P3: 0, P4: 0, on_brads_list: rows.filter(r => r.match?.upside).length };
  for (const r of rows) counts[r.priority]++;
  return { today, days: REPORT_DAYS, since: addDays(today, -(REPORT_DAYS - 1)), counts, rows };
}

export async function visitReport(supabase, businessId, now = Date.now()) {
  const today = laDateString(new Date(now));
  const since = addDays(today, -(REPORT_DAYS - 1));
  const visits = await selectAllPages(() => supabase.from('web_visits').select(VISIT_COLS)
    .eq('business_id', businessId).gte('pulled_on', since).order('id'));
  const ids = type => [...new Set(visits.filter(v => v.matched_type === type).map(v => v.matched_id))];
  const byIds = (table, cols, list) => (list.length
    ? selectAllPages(() => supabase.from(table).select(cols).eq('business_id', businessId).in('id', list).order('id')) : []);
  const [skip, partners, opps, targets, signals, prospects, messages, sequencedAccounts, snap, members, overrides] = await Promise.all([
    selectAllPages(() => supabase.from('sales_visit_skip').select('company_key').eq('business_id', businessId).order('id')),
    byIds('sales_goals', 'id, category, owner_team, record_id', ids('partner')),
    byIds('sales_opportunities', 'id, owner_team, record_id', ids('opportunity')),
    byIds('sales_targets', 'id, kind, owner_team, record_id', ids('target')),
    selectAllPages(() => supabase.from('sales_signals').select('id, company_key, status, created_at')
      .eq('business_id', businessId).eq('source', 'web_visit').gte('signal_week', addDays(since, -6)).order('id')),
    selectAllPages(() => supabase.from('sales_prospect_state').select('contact_id, company').eq('business_id', businessId).order('contact_id')),
    selectAllPages(() => supabase.from('sales_email_messages').select('apollo_message_id, contact_id, sequence_id').eq('business_id', businessId).not('sequence_id', 'is', null).order('apollo_message_id')),
    selectAllPages(() => supabase.from('sales_sequenced_accounts').select('account_id, name, sequence_id').eq('business_id', businessId).order('account_id')),
    supabase.from('sales_raw_snapshots').select('payload').eq('business_id', businessId).eq('entity', 'sequences').order('captured_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('business_members').select('name, profile:profiles!business_members_user_id_fkey(display_name)').eq('business_id', businessId),
    loadOverrides(supabase, businessId),
  ]);
  const records = new Map();
  for (const [type, list] of [['partner', partners], ['opportunity', opps], ['target', targets]]) for (const r of list) records.set(`${type}:${r.id}`, r);
  const scrub = nameScrubber(must(members).flatMap(m => [m.name, m.profile?.display_name]));
  const sequences = (must(snap)?.payload || []).filter(s => s && s.id);
  const sources = sequencesByCompany({ prospects, messages, sequencedAccounts, sequences, scrub });
  return buildReport({ visits, skipKeys: new Set(skip.map(s => s.company_key)), records, signals, sources, today, overrides });
}

// GET /goals/visits/report -> { today, since, counts, rows } (Viewer+)
export async function visitReportRoute(req, res) {
  try { res.json(await visitReport(getSupabase(), req.params.businessId)); }
  catch (e) { res.status(500).json({ error: e.message }); }
}

// Brad's file. Default (until the rules with Brad exist): P1-P3, Upside-owned
// and joint records first. ?all=true adds P4.
export const EXPORT_COLUMNS = [
  { header: 'Priority', width: 9, value: r => r.priority },
  { header: 'Company', width: 32, value: r => r.company_name },
  { header: 'Domain', width: 24, value: r => r.domain || '' },
  { header: 'Type', width: 26, value: r => r.type },
  { header: 'Size', width: 13, value: r => r.size },
  { header: 'Match', width: 18, value: r => (r.match ? `${r.match.label}${r.match.upside ? ` · ${r.match.owner_team === 'both' ? 'joint' : 'Upside-owned'}` : ''}` : '') },
  { header: 'Record ID', width: 12, value: r => r.match?.record_id || '' },
  { header: 'Visits (7 d)', width: 11, value: r => r.visits_7d },
  { header: 'Unique visitors (Apollo)', width: 14, value: r => r.unique_visitors_apollo },
  { header: 'First visit', width: 12, value: r => r.first_visit || '' },
  { header: 'Last visit', width: 12, value: r => r.last_visit || '' },
  { header: 'Top pages', width: 36, value: r => r.top_pages.join(', ') },
  { header: 'In sequence', width: 30, value: r => r.sources.join('; ') },
  { header: 'Why', width: 40, value: r => r.priority_rule || '' },
  { header: 'Next action', width: 30, value: r => r.next_action },
];

export const exportRows = (rows, all = false) => [...rows.filter(r => all || r.priority !== 'P4')]
  .sort((a, b) => (b.match?.upside ? 1 : 0) - (a.match?.upside ? 1 : 0) || RANK[a.priority] - RANK[b.priority]);

export async function buildVisitorSheet(report, all = false) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Website visitors', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = EXPORT_COLUMNS.map(c => ({ header: c.header, width: c.width }));
  ws.getRow(1).font = { bold: true };
  for (const r of exportRows(report.rows, all)) ws.addRow(EXPORT_COLUMNS.map(c => c.value(r)));
  ws.addRow([]);
  ws.addRow([`HomeLover website visitors ${report.since} to ${report.today} · Prospector draft`]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// Re-reads the built file: true when any cell looks like an email or phone.
export async function sheetHasPii(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  let found = false;
  wb.eachSheet(ws => ws.eachRow(row => row.eachCell(cell => { if (typeof cell.value === 'string' && hasPii(cell.value)) found = true; })));
  return found;
}

export async function visitExport(supabase, businessId, { all = false, now = Date.now() } = {}) {
  const report = await visitReport(supabase, businessId, now);
  const buf = await buildVisitorSheet(report, all);
  if (await sheetHasPii(buf)) return { status: 422, error: 'Export refused: a cell looks like an email address or phone number' };
  return { status: 200, buf, filename: `website-visitors-${report.today}.xlsx` };
}

// GET /goals/visits/export?all=true - Viewers too (the report is read-only).
export async function visitExportRoute(req, res) {
  try {
    const r = await visitExport(getSupabase(), req.params.businessId, { all: req.query.all === 'true' });
    if (r.error) return res.status(r.status).json({ error: r.error });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${r.filename}"`);
    res.send(r.buf);
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Skip list (D10): Members add and remove; a skipped company shows as P4 in
// the report at once and is scored P4 by the next pull.
export async function listSkip(supabase, businessId) {
  return selectAllPages(() => supabase.from('sales_visit_skip').select('id, company_key, reason, created_at')
    .eq('business_id', businessId).order('company_key').order('id'));
}
export async function listSkipRoute(req, res) {
  try { res.json({ skip: await listSkip(getSupabase(), req.params.businessId) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
}

export async function addSkip(supabase, { businessId, userId, body }) {
  const { name, company_key: key, reason } = body || {};
  const raw = typeof key === 'string' ? key : name;
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 160) return { status: 400, body: { error: 'Company name is required (up to 160 characters)' } };
  if (reason != null && (typeof reason !== 'string' || reason.length > 160)) return { status: 400, body: { error: 'reason must be up to 160 characters' } };
  if (hasPii(raw) || (reason && hasPii(reason))) return { status: 400, body: { error: 'No email addresses or phone numbers' } };
  const company_key = typeof key === 'string' ? key.trim() : normName(raw);
  if (!company_key) return { status: 400, body: { error: 'Company name is required (up to 160 characters)' } };
  const ins = await supabase.from('sales_visit_skip').insert({ business_id: businessId, company_key, reason: cleanText(reason || '', 160) || null, created_by: userId })
    .select('id, company_key, reason, created_at');
  if (ins.error?.code === '23505') return { status: 409, body: { error: 'Already on the skip list' } };
  if (ins.error) return { status: 500, body: { error: ins.error.message } };
  return { status: 201, body: ins.data[0] };
}
export async function addSkipRoute(req, res) {
  const r = await addSkip(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, body: req.body });
  res.status(r.status).json(r.body);
}

export async function removeSkip(supabase, businessId, id) {
  if (!UUID.test(String(id))) return { status: 404, body: { error: 'Not on the skip list' } };
  const del = await supabase.from('sales_visit_skip').delete().eq('business_id', businessId).eq('id', id).select('id');
  if (del.error) return { status: 500, body: { error: del.error.message } };
  return del.data.length ? { status: 200, body: { removed: id } } : { status: 404, body: { error: 'Not on the skip list' } };
}
export async function removeSkipRoute(req, res) {
  const r = await removeSkip(getSupabase(), req.params.businessId, req.params.id);
  res.status(r.status).json(r.body);
}
