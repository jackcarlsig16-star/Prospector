// hkos-sheet-import-v1 S1 / S5 / S6 - the import routes under /api/hk/:businessId (hkGate ran: viewer = GET, member =
// preview; commit and undo need the owner role, REVISABLE member). A preview parses the upload and writes ONE
// hk_import_runs row (status 'preview') whose plan jsonb is server-only: it is the only place an address lives outside
// hk_contacts, and it is wiped on commit or after 24 h. Commit writes the plan all-or-nothing and records every created
// id on the run (undo_set); undo deletes exactly those ids and refuses when any brand changed since. Nothing here
// returns an address: previewRow shows contact presence, runRow never carries the plan.
import { Readable } from 'node:stream';
import { getSupabase, HkError, fail, isOwner, me, logEvent, detailHasPii, liveBrands, legacyNames, normName } from './hkShared.js';
import { openUpload } from '../sales/sheetUpdate.js';
import { parseWorkbook } from './importParse.js';
import { buildPlan, previewRow } from './importPlan.js';

export const IMPORT_MAX_BYTES = 1024 * 1024; // REVISABLE
export const PLAN_MAX_BYTES = 2 * 1024 * 1024;
export const PREVIEW_TTL_MS = 24 * 3600e3;
const CHUNK = 100; // ids per PostgREST in() filter (URL length)
const RUN_FIELDS = ['id', 'source', 'status', 'rows_read', 'created_count', 'matched_count', 'flagged_count', 'started_by', 'created_at', 'finished_at', 'undone_at', 'summary'];
export const runRow = r => ({ ...Object.fromEntries(RUN_FIELDS.map(k => [k, r[k] ?? null])), can_undo: r.status === 'committed' && !!r.undo_set });
const previewOf = plan => ({ tabs: plan.tabs, brands: plan.brands.map(previewRow), duplicates: plan.duplicates, warnings: plan.warnings, totals: plan.totals });
const chicagoToday = now => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(now);
const chunks = (arr, n = CHUNK) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const must = r => { if (r.error) throw new Error(r.error.message); return r.data || []; };
// A plan date is a day; it lands at noon Chicago so it reads as that day on either side of midnight UTC.
const dayTs = d => (d ? `${d}T17:00:00.000Z` : null);

// The founders by first name: 'jack' / 'pete' -> profile id when that member has signed in. A hint on a brand resolves
// to an id here at plan time, or later on the member's first shell load (shell.js).
export const HINTS = ['jack', 'pete'];
export const hintOf = name => { const w = String(name || '').trim().split(/\s+/)[0]?.toLowerCase() || ''; return HINTS.find(h => w === h || w.startsWith(h)) || null; };
export async function hintMembers(supabase, businessId) {
  const { data, error } = await supabase.from('business_members').select('user_id,name,role,profile:profiles!business_members_user_id_fkey(display_name)').eq('business_id', businessId);
  if (error) throw new Error(error.message);
  const out = {};
  for (const m of data || []) { if (!m.user_id) continue; const h = hintOf(m.profile?.display_name) || hintOf(m.name); if (h && !out[h]) out[h] = m.user_id; }
  return out;
}

async function workbookOf(file) {
  if (!file || typeof file.data !== 'string') throw new HkError(400, 'pick a .xlsx or .csv file');
  if (Buffer.byteLength(file.data, 'base64') > IMPORT_MAX_BYTES) throw new HkError(413, `the file is over ${IMPORT_MAX_BYTES / 1024 / 1024} MB`);
  let opened;
  try { opened = await openUpload(file); } catch (e) { throw new HkError(400, e.message); }
  if (opened.workbook) return opened.workbook;
  // A .csv is one tab named after the file ("Pete Outreach.csv" -> the Pete Outreach rules).
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = await wb.csv.read(Readable.from([opened.csv]));
  ws.name = String(file.name).replace(/\.csv$/i, '').slice(0, 31) || 'Sheet1';
  return wb;
}
async function settingsOf(supabase, businessId) { const { data, error } = await supabase.from('hk_settings').select('bump_after_days, final_after_days').eq('business_id', businessId).maybeSingle(); if (error) throw new Error(error.message); return data || {}; }
async function runById(supabase, businessId, id) {
  const { data, error } = await supabase.from('hk_import_runs').select('*').eq('business_id', businessId).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new HkError(404, 'import not found');
  return data;
}

// POST /imports/preview { name, data (base64) } -> { run, preview }
export async function previewImportRoute(req, res, { supabase = getSupabase(), now = () => new Date() } = {}) {
  const businessId = req.params.businessId, body = req.body || {};
  try {
    const name = String(body.name || '').trim().slice(0, 200);
    if (!/\.(xlsx|csv)$/i.test(name)) throw new HkError(400, 'upload a .xlsx or .csv file');
    const wb = await workbookOf({ name, data: body.data });
    const parsed = parseWorkbook(wb);
    if (!parsed.tabs.some(t => t.kind !== 'skipped')) throw new HkError(400, 'no tab in that file matches the tracker (Pete Outreach, Jack Outreach, sponsors, Non-Profits, press, Podcasts)');
    const [brands, legacy, members, settings] = await Promise.all([liveBrands(supabase, businessId), legacyNames(supabase, businessId), hintMembers(supabase, businessId), settingsOf(supabase, businessId)]);
    const plan = buildPlan({ parsed, brands, legacy, members, settings, today: chicagoToday(now()) });
    if (JSON.stringify(plan).length > PLAN_MAX_BYTES) throw new HkError(413, 'that file is too large to preview in one import - split it by tab');
    const summary = { totals: plan.totals, tabs: plan.tabs.map(t => ({ name: t.name, kind: t.kind, rows: t.rows, create: t.create, match: t.match, warnings: t.warnings })) };
    const { data: run, error } = await supabase.from('hk_import_runs').insert({ business_id: businessId, source: name, status: 'preview', rows_read: plan.totals.rows_read, created_count: plan.totals.create, matched_count: plan.totals.match, flagged_count: plan.totals.warnings, started_by: me(req), plan, summary }).select().single();
    if (error) throw error;
    res.status(201).json({ run: runRow(run), preview: previewOf(plan) });
  } catch (e) { fail(res, e, 'imports/preview'); }
}

// GET /imports -> { runs } (newest first; a preview older than 24 h is expired here and its plan wiped)
export async function listImportsRoute(req, res, { supabase = getSupabase(), now = () => new Date() } = {}) {
  const businessId = req.params.businessId;
  try {
    const rows = must(await supabase.from('hk_import_runs').select('*').eq('business_id', businessId).order('created_at', { ascending: false }).limit(50));
    const cutoff = new Date(now().getTime() - PREVIEW_TTL_MS).toISOString();
    for (const r of rows) {
      if (r.status !== 'preview' || r.created_at >= cutoff) continue;
      r.status = 'failed'; r.summary = { ...(r.summary || {}), reason: 'preview expired' };
      must(await supabase.from('hk_import_runs').update({ status: 'failed', plan: null, summary: r.summary }).eq('id', r.id).select('id'));
    }
    res.json({ runs: rows.map(runRow) });
  } catch (e) { fail(res, e, 'imports/list'); }
}

// POST /imports/:id/commit -> { run, counts }. All or nothing: a failed write deletes what this commit created and the
// run reads 'failed'. Matched brands are left as they are (REVISABLE: append their periods / contacts).
export async function commitImportRoute(req, res, { supabase = getSupabase(), now = () => new Date() } = {}) {
  const businessId = req.params.businessId, uid = me(req);
  const created = { brands: [], contacts: [], touches: [], periods: [], events: [] };
  let run;
  try {
    if (!isOwner(req)) throw new HkError(403, 'only an owner-role member can commit an import');
    run = await runById(supabase, businessId, req.params.id);
    if (run.status !== 'preview' || !run.plan) throw new HkError(409, run.status === 'committed' ? 'that import is already committed' : 'that preview has expired - upload the file again');
    const plan = run.plan, members = await hintMembers(supabase, businessId), at = now().toISOString();
    const fresh = plan.brands.filter(b => !b.existing_id);
    const brandRows = fresh.map(b => ({ business_id: businessId, name: b.name, normalized_name: normName(b.name), domain: b.domain, aliases: [], segment: b.segment, category: b.category, is_local: !!b.is_local, status: b.status, owner_user_id: b.owner_user_id || (b.owner_hint && members[b.owner_hint]) || null, owner_hint: b.owner_hint, relationship: b.relationship, source: 'import', last_touch_at: dayTs(b.last_touch_at), next_due_at: b.next_due_at, notes: b.notes, challenge_idea: b.challenge_idea, origin_hook: b.origin_hook, import_ref: b.refs.join(', ').slice(0, 400), created_by: uid, updated_at: at }));
    const idByKey = new Map(), ownerByKey = new Map(brandRows.map(r => [r.normalized_name, r.owner_user_id]));
    for (const part of chunks(brandRows)) {
      const rows = must(await supabase.from('hk_brands').insert(part).select('id, normalized_name'));
      for (const r of rows) { created.brands.push(r.id); idByKey.set(r.normalized_name, r.id); }
    }
    const contacts = [], touches = [], periods = [], events = [], deferred = [];
    let unowned = 0;
    for (const b of fresh) {
      const brandId = idByKey.get(normName(b.name));
      if (!brandId) throw new Error(`no id came back for ${b.name}`);
      let primary = false;
      for (const c of b.contacts) { const isPrimary = !primary && !!c.email; if (isPrimary) primary = true; contacts.push({ business_id: businessId, brand_id: brandId, name: c.name, email: c.email, email_source: c.email ? 'import' : null, is_primary: isPrimary, created_by: uid }); }
      for (const t of b.touches) {
        const sender = t.sender === 'jack' ? members.jack : ownerByKey.get(normName(b.name));
        const row = { business_id: businessId, brand_id: brandId, channel: t.channel, kind: t.kind, state: t.state, drafted_at: dayTs(t.at) || at, sent_at: t.state === 'sent' ? dayTs(t.at) : null, created_by: 'system' };
        const hint = t.sender === 'jack' ? 'jack' : b.owner_hint;
        // No sender yet: a hinted touch waits for that member's first load; an unhinted one (press / podcast rows with no
        // owner column) has nobody to wait for and is counted, not written.
        if (sender) touches.push({ ...row, sender_user_id: sender }); else if (hint) deferred.push({ ...row, owner_hint: hint }); else unowned++;
      }
      for (const p of b.periods) periods.push({ business_id: businessId, brand_id: brandId, period: p.period, kind: p.kind, note: p.note });
      const detail = { name: b.name, domain: b.domain, source: 'import', run_id: run.id, import_ref: b.refs[0] };
      events.push({ business_id: businessId, actor_user_id: uid, actor_kind: 'user', entity_type: 'brand', entity_id: brandId, action: 'brand.created', detail: detailHasPii(detail) ? { source: 'import', run_id: run.id } : detail });
    }
    for (const [table, rows, key] of [['hk_contacts', contacts, 'contacts'], ['hk_touches', touches, 'touches'], ['hk_sponsor_periods', periods, 'periods'], ['hk_events', events, 'events']]) {
      for (const part of chunks(rows)) created[key].push(...must(await supabase.from(table).insert(part).select('id')).map(r => r.id));
    }
    const counts = { brands: created.brands.length, matched: plan.brands.length - fresh.length, contacts: contacts.length, touches: touches.length, touches_deferred: deferred.length, touches_unowned: unowned, periods: periods.length, possible_duplicates: plan.duplicates.length, warnings: plan.totals.warnings };
    const summary = { ...(run.summary || {}), counts, deferred_touches: deferred };
    const { data: done, error } = await supabase.from('hk_import_runs').update({ status: 'committed', finished_at: at, created_count: counts.brands, matched_count: counts.matched, undo_set: created, plan: null, summary }).eq('id', run.id).select().single();
    if (error) throw error;
    await logEvent(supabase, { businessId, actorUserId: uid, entityType: 'import', entityId: run.id, action: 'import.committed', detail: { run_id: run.id, source: run.source, counts } });
    res.json({ run: runRow(done), counts });
  } catch (e) {
    if (run && created.brands.length) {
      await deleteSet(supabase, businessId, created).catch(u => console.error('[hk/imports/commit] undo failed:', u.message));
      await supabase.from('hk_import_runs').update({ status: 'failed', plan: null, summary: { ...(run.summary || {}), reason: e.message.slice(0, 300) } }).eq('id', run.id);
    }
    fail(res, e, 'imports/commit');
  }
}

async function deleteSet(supabase, businessId, set) {
  const out = {};
  for (const [table, key] of [['hk_touches', 'touches'], ['hk_contacts', 'contacts'], ['hk_sponsor_periods', 'periods'], ['hk_events', 'events'], ['hk_brands', 'brands']]) {
    out[key] = 0;
    for (const part of chunks(set[key] || [])) out[key] += must(await supabase.from(table).delete().eq('business_id', businessId).in('id', part).select('id')).length;
  }
  return out;
}

// POST /imports/:id/undo -> { run, deleted }. Refuses when a created brand was edited, removed, or gained rows since.
export async function undoImportRoute(req, res, { supabase = getSupabase(), now = () => new Date() } = {}) {
  const businessId = req.params.businessId;
  try {
    if (!isOwner(req)) throw new HkError(403, 'only an owner-role member can undo an import');
    const run = await runById(supabase, businessId, req.params.id);
    if (run.status !== 'committed' || !run.undo_set) throw new HkError(409, run.status === 'undone' ? 'that import is already undone' : 'only a committed import can be undone');
    const set = run.undo_set;
    const brands = [];
    for (const part of chunks(set.brands)) brands.push(...must(await supabase.from('hk_brands').select('id, name, updated_at, archived_at').eq('business_id', businessId).in('id', part)));
    if (brands.length !== set.brands.length) throw new HkError(409, `${set.brands.length - brands.length} imported brands were removed since - nothing undone`);
    const edited = brands.filter(b => b.updated_at > run.finished_at || b.archived_at);
    if (edited.length) throw new HkError(409, `${edited.length} imported brands changed since the import (${edited.slice(0, 3).map(b => b.name).join(', ')}) - nothing undone`);
    for (const [table, key] of [['hk_contacts', 'contacts'], ['hk_touches', 'touches'], ['hk_sponsor_periods', 'periods']]) {
      const known = new Set(set[key] || []);
      let extra = 0;
      for (const part of chunks(set.brands)) extra += must(await supabase.from(table).select('id').eq('business_id', businessId).in('brand_id', part)).filter(r => !known.has(r.id)).length;
      if (extra) throw new HkError(409, `${extra} ${key} were added to imported brands since - nothing undone`);
    }
    const deleted = await deleteSet(supabase, businessId, set);
    const at = now().toISOString();
    const { data: done, error } = await supabase.from('hk_import_runs').update({ status: 'undone', undone_at: at }).eq('id', run.id).select().single();
    if (error) throw error;
    await logEvent(supabase, { businessId, actorUserId: me(req), entityType: 'import', entityId: run.id, action: 'import.undone', detail: { run_id: run.id, source: run.source, deleted } });
    res.json({ run: runRow(done), deleted });
  } catch (e) { fail(res, e, 'imports/undo'); }
}

// shell.js, a member's first load: brands hinted to them take their id, and the touches the commit could not write
// (no profile yet) are written now and join their run's undo set.
export async function assignOwnerHint(supabase, businessId, userId, displayName) {
  const hint = hintOf(displayName);
  if (!hint) return { hint: null, brands: 0, touches: 0 };
  const brands = must(await supabase.from('hk_brands').update({ owner_user_id: userId }).eq('business_id', businessId).eq('owner_hint', hint).is('owner_user_id', null).select('id'));
  let touches = 0;
  const runs = must(await supabase.from('hk_import_runs').select('id, summary, undo_set').eq('business_id', businessId).eq('status', 'committed'));
  for (const r of runs) {
    const all = r.summary?.deferred_touches || [];
    const mine = all.filter(t => t.owner_hint === hint);
    if (!mine.length) continue;
    const ids = must(await supabase.from('hk_touches').insert(mine.map(({ owner_hint, ...t }) => ({ ...t, sender_user_id: userId }))).select('id')).map(x => x.id);
    touches += ids.length;
    must(await supabase.from('hk_import_runs').update({ undo_set: { ...r.undo_set, touches: [...(r.undo_set?.touches || []), ...ids] }, summary: { ...r.summary, deferred_touches: all.filter(t => t.owner_hint !== hint) } }).eq('id', r.id).select('id'));
  }
  if (brands.length || touches) await logEvent(supabase, { businessId, actorUserId: userId, actorKind: 'system', entityType: 'import', entityId: null, action: 'import.owner_assigned', detail: { hint, brands: brands.length, touches } });
  return { hint, brands: brands.length, touches };
}
