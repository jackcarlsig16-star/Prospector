import { getSupabase } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { hasRole } from '../lib/requireAuth.js';
import { cleanText } from './scrubText.js';
import { toCsv } from '../../src/utils/csv.js';
import { boardStage, BOARD_COLORS } from '../../src/constants/pipelineBoard.js';
import { TEAM_LABEL } from '../../src/constants/ownership.js';
import {
  SOURCE_COLS, SOURCE_LABEL, RECORD_TYPES, RECORD_TABLE, validateSource, sourceColumns, sourceOf, isOpen, logSource,
  sourceDirectory, mapSheetSource, mapChannel, sheetLines,
} from './leadSource.js';

// lead-source-v1 Stage 2 - edit + history (B2/D4), a partner's referred
// companies (B3), the Sources report + Export for <partner> (B4) and the
// backfill preview / apply (B5). Reads use the service key; writes are
// Members (edit) or Admins (backfill apply). A partner export carries only
// structured fields - company, type, stage, owner, covered lives, the
// partner's own rep (source_person) and office - never route_in, notes or
// any other free text.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (status, error) => Object.assign(new Error(error), { status });
const must = r => { if (r.error) throw err(500, r.error.message); return r.data; };
const reply = (status, body) => ({ status, body });
const send = (res, r) => res.status(r.status).json(r.body);
const caught = (label, e) => {
  if (!e.status || e.status >= 500) console.error(`[sources/${label}]`, e.message);
  return reply(e.status || 500, { error: e.message });
};
const NAME_COL = { partner: 'name', employer: 'organization', target: 'name' };
const NOTES_COL = { partner: 'notes', employer: 'notes', target: 'research_notes' };
const COLS = {
  partner: `id, name, notes, pipeline_status, category, owner_user_id, owner_team, co_owner_name, last_touch_at, channel, created_at, ${SOURCE_COLS}`,
  employer: `id, organization, notes, stage, owner, owner_team, co_owner_name, covered_lives, channel, created_at, ${SOURCE_COLS}`,
  target: `id, name, research_notes, status, owner_team, co_owner_name, channel, created_at, ${SOURCE_COLS}`,
};
const BACKFILL_CHUNK = 10;

// Every live company: partners and employers not archived, targets still proposed / researching.
async function companies(supabase, businessId, { partnerId = null } = {}) {
  const page = (type, narrow) => selectAllPages(() => {
    let q = narrow(supabase.from(RECORD_TABLE[type]).select(COLS[type]).eq('business_id', businessId));
    if (partnerId) q = q.eq('source_partner_id', partnerId);
    return q.order('id');
  }).then(rows => rows.map(r => ({ ...r, type })));
  const [p, o, t] = await Promise.all([
    page('partner', q => q.eq('goal_type', 'partnership').is('archived_at', null)),
    page('employer', q => q.is('archived_at', null)),
    page('target', q => q.in('status', ['proposed', 'researching'])),
  ]);
  return [...p, ...o, ...t];
}
async function members(supabase, businessId) {
  return new Map(must(await supabase.from('business_members').select('user_id, name').eq('business_id', businessId).not('user_id', 'is', null)).map(m => [m.user_id, m.name || '']));
}
const ownerOf = (r, team) => (r.type === 'partner' ? (team.get(r.owner_user_id) || '').split(' ')[0] || TEAM_LABEL[r.owner_team] || null
  : r.type === 'employer' ? (r.owner || '').split(' ')[0] || TEAM_LABEL[r.owner_team] || null : TEAM_LABEL[r.owner_team] || null);
const nameOf = r => r[NAME_COL[r.type]];

async function recordOr404(supabase, businessId, type, id) {
  if (!RECORD_TYPES.includes(type)) throw err(400, `type must be one of ${RECORD_TYPES.join('|')}`);
  if (!UUID.test(id || '')) throw err(404, `${type} not found`);
  const row = must(await supabase.from(RECORD_TABLE[type]).select(`id, ${NAME_COL[type]}, ${SOURCE_COLS}`).eq('business_id', businessId).eq('id', id).maybeSingle());
  if (!row) throw err(404, `${type} not found`);
  return row;
}
async function namesFor(supabase, businessId, s) {
  const [p, c] = await Promise.all([
    s.source_partner_id ? supabase.from('sales_goals').select('id, name').eq('business_id', businessId).eq('id', s.source_partner_id).maybeSingle().then(must) : null,
    s.source_campaign_id ? supabase.from('sales_outreach_campaigns').select('id, name').eq('business_id', businessId).eq('id', s.source_campaign_id).maybeSingle().then(must) : null,
  ]);
  return { partner_name: p?.name || null, campaign_name: c?.name || null };
}

// GET /goals/source/:type/:id -> { source (+ partner / campaign names, set by / at), history }
export async function getSource(supabase, { businessId, type, id }) {
  try {
    const row = await recordOr404(supabase, businessId, type, id);
    const [names, team, events] = await Promise.all([
      namesFor(supabase, businessId, row), members(supabase, businessId),
      supabase.from('sales_source_events').select('id, from_source, to_source, reason, by_user, at').eq('business_id', businessId).eq('record_type', type).eq('record_id', id).order('at', { ascending: false }).limit(50).then(must),
    ]);
    return reply(200, {
      source: { ...sourceOf(row), ...names, label: row.source_kind ? SOURCE_LABEL[row.source_kind] : null, set_by: row.source_set_by ? (team.get(row.source_set_by) || '').split(' ')[0] || null : null, manual: !!row.source_set_by, set_at: row.source_set_at },
      history: events.map(e => ({ ...e, by: e.by_user ? (team.get(e.by_user) || '').split(' ')[0] || null : null })),
    });
  } catch (e) { return caught('get', e); }
}

// PATCH /goals/source/:type/:id { source fields..., expect_set_at? } (Members) - a person's pick: logged, never
// overwritten by an import or the backfill. expect_set_at = the set_at the screen showed (stale-screen guard).
export async function editSource(supabase, { businessId, type, id, userId, body = {}, now = new Date() }) {
  try {
    const row = await recordOr404(supabase, businessId, type, id);
    const v = validateSource(body);
    if (v.error) return reply(400, { error: v.error });
    const s = v.source;
    if (!s.source_kind) return reply(400, { error: 'source_kind is required' });
    if (s.source_partner_id) {
      if (type === 'partner' && s.source_partner_id === id) return reply(400, { error: "a partner can't be its own source" });
      const p = must(await supabase.from('sales_goals').select('id').eq('business_id', businessId).eq('id', s.source_partner_id).eq('goal_type', 'partnership').maybeSingle());
      if (!p) return reply(400, { error: 'source_partner_id must be a partner in this workspace' });
    }
    if (s.source_campaign_id && !must(await supabase.from('sales_outreach_campaigns').select('id').eq('business_id', businessId).eq('id', s.source_campaign_id).maybeSingle())) {
      return reply(400, { error: 'source_campaign_id must be a campaign in this workspace' });
    }
    if ('expect_set_at' in body && (body.expect_set_at ?? null) !== (row.source_set_at ?? null)) return reply(409, { error: 'The source changed since - reload' });
    const q = supabase.from(RECORD_TABLE[type]).update({ ...sourceColumns(s, { userId, manual: true, now }), updated_at: now.toISOString() }).eq('id', id);
    const rows = must(await (row.source_set_at ? q.eq('source_set_at', row.source_set_at) : q.is('source_set_at', null)).select(`id, ${SOURCE_COLS}`));
    if (!rows.length) return reply(409, { error: 'The source changed since - reload' });
    await logSource(supabase, { businessId, type, id, from: row, to: rows[0], reason: 'edit', byUser: userId, at: now });
    return reply(200, { source: { ...sourceOf(rows[0]), ...(await namesFor(supabase, businessId, rows[0])), label: SOURCE_LABEL[rows[0].source_kind], manual: true, set_at: rows[0].source_set_at } });
  } catch (e) { return caught('edit', e); }
}

const publicRow = (r, team) => {
  const st = boardStage(r.type, r);
  return {
    type: r.type, id: r.id, name: nameOf(r), stage: st?.stage || null, stage_label: st?.stage_label || null, band: st?.color || null,
    owner: ownerOf(r, team), covered_lives: r.type === 'employer' ? r.covered_lives ?? null : null,
    source_person: r.source_person || null, source_office: r.source_office || null, last_touch_at: r.type === 'partner' ? r.last_touch_at || null : null,
  };
};

// GET /goals/partners/:id/referred -> { partner, total, groups: [{ person, office, rows }] } (B3)
export async function referredBy(supabase, { businessId, id }) {
  try {
    if (!UUID.test(id || '')) return reply(404, { error: 'partner not found' });
    const partner = must(await supabase.from('sales_goals').select('id, name').eq('business_id', businessId).eq('id', id).eq('goal_type', 'partnership').maybeSingle());
    if (!partner) return reply(404, { error: 'partner not found' });
    const [rows, team] = await Promise.all([companies(supabase, businessId, { partnerId: id }), members(supabase, businessId)]);
    const groups = new Map();
    for (const r of rows.map(x => publicRow(x, team))) {
      const k = `${r.source_person || ''}|${r.source_office || ''}`;
      if (!groups.has(k)) groups.set(k, { person: r.source_person, office: r.source_office, rows: [] });
      groups.get(k).rows.push(r);
    }
    return reply(200, { partner, total: rows.length, groups: [...groups.values()].sort((a, b) => b.rows.length - a.rows.length || String(a.person || '~').localeCompare(String(b.person || '~'))) });
  } catch (e) { return caught('referred', e); }
}

// The report's numbers for one group of companies.
export function tally(rows) {
  const bands = Object.fromEntries(BOARD_COLORS.map(c => [c.id, 0]));
  let covered = 0;
  for (const r of rows) { if (r.band) bands[r.band]++; covered += r.covered_lives || 0; }
  return { companies: rows.length, bands, meetings: bands.yellow, pilot_live: bands.green, covered_lives: covered };
}

// GET /goals/sources?days=&team=&partner= -> { totals, by_kind, by_partner, by_person, by_office } (B4)
export async function sourcesReport(supabase, { businessId, query = {}, now = Date.now() }) {
  try {
    const days = query.days ? Number(query.days) : null;
    if (days != null && !(Number.isInteger(days) && days > 0 && days <= 3650)) return reply(400, { error: 'days must be a whole number of days' });
    if (query.team && !['homelover', 'upside', 'both', 'unset'].includes(query.team)) return reply(400, { error: 'team must be homelover|upside|both|unset' });
    if (query.partner && !UUID.test(query.partner)) return reply(400, { error: 'partner must be a partner id' });
    const [all, team] = await Promise.all([companies(supabase, businessId, { partnerId: query.partner || null }), members(supabase, businessId)]);
    const since = days ? new Date(now - days * 864e5).toISOString() : null;
    const rows = all.filter(r => (!since || r.created_at >= since) && (!query.team || (query.team === 'unset' ? !r.owner_team : r.owner_team === query.team)))
      .map(r => ({ ...publicRow(r, team), kind: r.source_kind || null, partner_id: r.source_partner_id || null }));
    const named = query.partner ? must(await supabase.from('sales_goals').select('id, name').eq('business_id', businessId).eq('goal_type', 'partnership')) : all.filter(r => r.type === 'partner');
    const partnerNames = new Map(named.map(r => [r.id, r.name]));
    const group = (keyOf, labelOf) => {
      const m = new Map();
      for (const r of rows) { const k = keyOf(r); if (k == null) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
      return [...m].map(([k, rs]) => ({ key: k, label: labelOf(k, rs[0]), ...tally(rs) })).sort((a, b) => b.companies - a.companies);
    };
    return reply(200, {
      totals: tally(rows),
      by_kind: group(r => r.kind || 'not_set', k => (k === 'not_set' ? 'Not set yet' : SOURCE_LABEL[k])),
      by_partner: group(r => r.partner_id, k => partnerNames.get(k) || 'A removed partner'),
      by_person: group(r => (r.partner_id && r.source_person ? `${r.partner_id}|${r.source_person}` : null), (k, r) => `${r.source_person} · ${partnerNames.get(r.partner_id) || ''}`.trim()),
      by_office: group(r => (r.partner_id && r.source_office ? `${r.partner_id}|${r.source_office}` : null), (k, r) => `${r.source_office} · ${partnerNames.get(r.partner_id) || ''}`.trim()),
    });
  } catch (e) { return caught('report', e); }
}

export const EXPORT_COLUMNS = [
  { key: 'name', label: 'Company' }, { key: 'type_label', label: 'Type' }, { key: 'stage_label', label: 'Stage' }, { key: 'owner', label: 'Owner' },
  { key: 'covered_lives', label: 'Covered lives' }, { key: 'source_person', label: 'Referred by' }, { key: 'source_office', label: 'Office' },
];
const TYPE_LABEL = { partner: 'Partner', employer: 'Employer', target: 'Target' };
const scrub = v => (v == null ? null : typeof v === 'number' ? v : cleanText(String(v), 200) || null);

// GET /goals/sources/export?partner=<id>[&format=csv] -> that partner's referred companies, structured fields only.
export async function sourcesExport(supabase, { businessId, query = {} }) {
  try {
    if (!UUID.test(query.partner || '')) return reply(400, { error: 'partner must be a partner id' });
    const partner = must(await supabase.from('sales_goals').select('id, name').eq('business_id', businessId).eq('id', query.partner).eq('goal_type', 'partnership').maybeSingle());
    if (!partner) return reply(404, { error: 'partner not found' });
    const [rows, team] = await Promise.all([companies(supabase, businessId, { partnerId: partner.id }), members(supabase, businessId)]);
    const out = rows.map(r => publicRow(r, team)).map(r => Object.fromEntries(EXPORT_COLUMNS.map(c => [c.key, scrub(c.key === 'type_label' ? TYPE_LABEL[r.type] : r[c.key])])))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const totals = tally(rows.map(r => publicRow(r, team)));
    return reply(200, { partner: { id: partner.id, name: partner.name }, columns: EXPORT_COLUMNS.map(c => ({ key: c.key, label: c.label })), rows: out, totals, csv: query.format === 'csv' ? toCsv(out, EXPORT_COLUMNS) : undefined });
  } catch (e) { return caught('export', e); }
}

// ---- Backfill (B5): propose a source per record whose source is still open, grouped by the value it came from.
async function backfillPlan(supabase, businessId) {
  const all = await companies(supabase, businessId);
  const partners = all.filter(r => r.type === 'partner').map(r => ({ id: r.id, name: r.name }));
  const dir = sourceDirectory(partners, all);
  const groups = new Map();
  let kept = 0;
  for (const r of all) {
    if (!isOpen(r)) { kept++; continue; }
    const lines = sheetLines(r[NOTES_COL[r.type]]);
    const m = lines ? mapSheetSource({ source: lines.source, route_in: lines.route_in, broker: lines.broker }, dir) : mapChannel(r.channel);
    if (!groups.has(m.key)) groups.set(m.key, { key: m.key, value: m.value, rule: m.rule, proposed: { ...m.source, route_in: undefined }, records: [] });
    groups.get(m.key).records.push({ r, route_in: m.source.route_in || null });
  }
  return { groups, kept, total: all.length, partners };
}

// GET /goals/sources/backfill -> { total, kept, groups: [{ key, value, rule, count, by_type, proposed (+ partner name) }] }
export async function backfillPreview(supabase, { businessId }) {
  try {
    const { groups, kept, total, partners } = await backfillPlan(supabase, businessId);
    const pname = new Map(partners.map(p => [p.id, p.name]));
    return reply(200, {
      total, kept,
      groups: [...groups.values()].map(g => ({
        key: g.key, value: g.value, rule: g.rule, count: g.records.length,
        by_type: g.records.reduce((o, { r }) => ({ ...o, [r.type]: (o[r.type] || 0) + 1 }), {}),
        proposed: { source_kind: g.proposed.source_kind, source_partner_id: g.proposed.source_partner_id || null, partner_name: pname.get(g.proposed.source_partner_id) || null, source_person: g.proposed.source_person || null },
      })).sort((a, b) => b.count - a.count),
    });
  } catch (e) { return caught('backfill', e); }
}

// POST /goals/sources/backfill/apply { mappings: { [group key]: { source_kind, source_partner_id?, source_person?, source_office? } } }
// (Admins) - only the groups Jack confirmed. Each record keeps its own route_in; a record whose source was set in the
// meantime (manual, or no longer open) is skipped; one 'backfill' event per record written. Re-runnable.
export async function backfillApply(supabase, { businessId, userId, body = {}, now = new Date() }) {
  try {
    const mappings = body.mappings;
    if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings)) return reply(400, { error: 'mappings must be { group key: source }' });
    const confirmed = {};
    for (const [k, src] of Object.entries(mappings)) {
      const v = validateSource({ source_kind: src?.source_kind, source_partner_id: src?.source_partner_id ?? null, source_person: src?.source_person ?? null, source_office: src?.source_office ?? null });
      if (v.error || !v.source.source_kind) return reply(400, { error: `${k}: ${v.error || 'source_kind is required'}` });
      confirmed[k] = v.source;
    }
    const { groups } = await backfillPlan(supabase, businessId);
    const unknownKeys = Object.keys(confirmed).filter(k => !groups.has(k));
    if (unknownKeys.length) return reply(409, { error: `These groups aren't in the preview any more - preview again: ${unknownKeys.slice(0, 3).join(', ')}` });
    const partnerIds = new Set((await companies(supabase, businessId)).filter(r => r.type === 'partner').map(r => r.id));
    for (const [k, s] of Object.entries(confirmed)) if (s.source_partner_id && !partnerIds.has(s.source_partner_id)) return reply(400, { error: `${k}: source_partner_id must be a partner in this workspace` });
    const work = Object.entries(confirmed).flatMap(([k, s]) => groups.get(k).records.map(x => ({ ...x, s })));
    let written = 0, skipped = 0;
    for (let i = 0; i < work.length; i += BACKFILL_CHUNK) {
      await Promise.all(work.slice(i, i + BACKFILL_CHUNK).map(async ({ r, route_in, s }) => {
        if (r.type === 'partner' && s.source_partner_id === r.id) { skipped++; return; }
        const to = { ...s, route_in };
        const q = supabase.from(RECORD_TABLE[r.type]).update(sourceColumns(to, { now })).eq('id', r.id).is('source_set_by', null);
        const rows = must(await (r.source_kind ? q.eq('source_kind', r.source_kind) : q.is('source_kind', null)).select('id'));
        if (!rows.length) { skipped++; return; }
        await logSource(supabase, { businessId, type: r.type, id: r.id, from: r.source_kind ? r : null, to, reason: 'backfill', byUser: userId, at: now });
        written++;
      }));
    }
    return reply(200, { written, skipped, groups: Object.keys(confirmed).length });
  } catch (e) { return caught('backfill/apply', e); }
}

const ctx = req => ({ businessId: req.params.businessId, userId: req.auth.user.id, type: req.params.type, id: req.params.id, body: req.body || {}, query: req.query || {} });
export async function getSourceRoute(req, res) { send(res, await getSource(getSupabase(), ctx(req))); }
export async function editSourceRoute(req, res) { send(res, await editSource(getSupabase(), ctx(req))); }
export async function referredByRoute(req, res) { send(res, await referredBy(getSupabase(), ctx(req))); }
export async function sourcesReportRoute(req, res) { send(res, await sourcesReport(getSupabase(), ctx(req))); }
export async function sourcesExportRoute(req, res) {
  const r = await sourcesExport(getSupabase(), ctx(req));
  if (r.status === 200 && r.body.csv != null) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="referred-by-${(r.body.partner.name || 'partner').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv"`);
    return res.status(200).send(r.body.csv);
  }
  send(res, r);
}
export async function backfillPreviewRoute(req, res) {
  if (!hasRole(req, req.params.businessId, 'admin')) return res.status(403).json({ error: 'You need admin access to this workspace' });
  send(res, await backfillPreview(getSupabase(), ctx(req)));
}
export async function backfillApplyRoute(req, res) {
  if (!hasRole(req, req.params.businessId, 'admin')) return res.status(403).json({ error: 'You need admin access to this workspace' });
  send(res, await backfillApply(getSupabase(), ctx(req)));
}
