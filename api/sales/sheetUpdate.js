import ExcelJS from 'exceljs';
import { readInput, loadState, plan, applyPlan, ImportRefused } from './masterImport.js';
import { applyPartnerSignal, SignalError } from './partnerSignals.js';
import { getSupabase } from './goalsShared.js';
import { normName } from './intakeMatch.js';
import { PIPELINE_STATUSES } from '../../src/constants/partnerPipeline.js';
import { STAGE_LABELS } from '../../src/components/salesAnalytics/pipelineStages.js';
import { TEAM_LABEL } from '../../src/constants/ownership.js';

// pipeline-board-v1 Stage 4 - "Update from sheet". The joint sheet (the
// board's own export, or the master sheet) goes through the master import's
// reader + plan (masterImport.js), so both share one header map and one set
// of rules. A preview writes nothing; Apply re-reads the same file, re-plans,
// and writes only the ticked items whose preview still holds. Partner stage
// moves are the one thing the import never does: here they go forward only,
// through applyPartnerSignal with skipTouchStamp (a sheet edit isn't a touch).

export const UPLOAD_MAX_BYTES = 2 * 1024 * 1024; // REVISABLE
export const UPLOAD_MAX_ROWS = 2000; // REVISABLE
export const CHANGED_SINCE = 'changed since the preview';

const PARTNER_LABEL = Object.fromEntries(PIPELINE_STATUSES.map(s => [s.id, s.label]));
const TARGET_LABEL = { proposed: 'Proposed', researching: 'Researching', accepted: 'Accepted', rejected: 'Rejected' };
const FIELD_LABEL = {
  record_id: 'Record ID', tier: 'Tier', next_step: 'Next step', next_action: 'Next step', next_action_date: 'Next step due',
  company_domain: 'Domain', category: 'Category', suggested_category: 'Category', notes: 'Sheet notes', cohort: 'Segment',
  owner: 'Owner', owner_user_id: 'Owner', owner_team: 'Owner team', co_owner_name: 'Co-owner', apollo_account_id: 'Apollo company link',
  decision_makers: 'Decision makers', research_notes: 'Research notes',
};

const cellText = v => {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join('');
    if ('result' in v) return cellText(v.result);
    if ('text' in v) return cellText(v.text);
    return '';
  }
  return String(v);
};

// { name, data (base64) } -> CSV text or { headers, rows } for readInput.
export async function readUpload(file) {
  if (!file || typeof file.name !== 'string' || typeof file.data !== 'string') throw new ImportRefused('pick a .csv or .xlsx file');
  const buf = Buffer.from(file.data, 'base64');
  if (!buf.length) throw new ImportRefused('the file is empty');
  if (buf.length > UPLOAD_MAX_BYTES) throw new ImportRefused(`the file is over ${UPLOAD_MAX_BYTES / 1024 / 1024} MB`);
  const ext = file.name.toLowerCase().split('.').pop();
  if (ext === 'csv') return buf.toString('utf8');
  if (ext !== 'xlsx') throw new ImportRefused('upload a .csv or .xlsx file');
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf); } catch { throw new ImportRefused("that .xlsx file couldn't be opened"); }
  const ws = wb.worksheets[0];
  if (!ws) throw new ImportRefused('the workbook has no sheet');
  const headers = (ws.getRow(1).values || []).slice(1).map(v => cellText(v).trim());
  const rows = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const r = {};
    headers.forEach((h, i) => { if (h) r[h] = cellText(row.getCell(i + 1).value).trim(); });
    if (Object.values(r).some(Boolean)) rows.push(r);
  });
  return { headers, rows };
}

const stageLabel = (type, id) => (type === 'partner' ? PARTNER_LABEL[id || 'not_started'] : type === 'target' ? TARGET_LABEL[id] : STAGE_LABELS[id]) || id;
const shown = (field, v) => {
  if (field === 'owner_team') return TEAM_LABEL[v] || v;
  if (field === 'notes' || field === 'decision_makers' || field === 'research_notes') return 'updated';
  return v == null ? '' : String(v);
};
const changesOf = patch => Object.entries(patch).map(([field, value]) => ({ field, label: FIELD_LABEL[field] || field, value: shown(field, value) }));

// Plan -> the preview. Every item has a key (what to tick) and a sig (what it
// said), so Apply can tell when the row changed between preview and apply.
export function buildPreview({ actions, report }, input, state) {
  const items = [];
  const work = new Map();
  const add = (item, run) => {
    const out = { ...item, sig: JSON.stringify([item.from, item.to, item.changes]) };
    items.push(out);
    if (run) work.set(out.key, run);
  };
  const memberName = id => state.members.find(m => m.id === id)?.display_name || state.members.find(m => m.id === id)?.name || id;

  for (const s of report.partner_stages) {
    const ahead = s.dir === 'ahead';
    add({ key: `stage:partner:${s.goal_id}`, group: 'stage', type: 'partner', name: s.name, record_id: s.record_id, from: s.prospector, to: s.to,
      from_label: stageLabel('partner', s.prospector), to_label: stageLabel('partner', s.to), tickable: ahead,
      note: ahead ? null : s.dir === 'behind' ? 'Prospector is ahead' : 'Pause and un-pause on the Partners view' },
    ahead && { kind: 'partner_stage', goal_id: s.goal_id, from: s.prospector, to: s.to, record_id: s.record_id });
  }
  for (const s of report.opp_stage_moves) {
    add({ key: `stage:employer:${s.opp_id}`, group: 'stage', type: 'employer', name: s.name, record_id: s.record_id, from: s.from, to: s.to,
      from_label: stageLabel('employer', s.from), to_label: stageLabel('employer', s.to), tickable: true, note: null },
    { kind: 'opp_stage', opp_id: s.opp_id, from: s.from, to: s.to });
  }
  for (const s of report.opp_stage_refused) {
    add({ key: `stage:employer:${s.opp_id}`, group: 'stage', type: 'employer', name: s.name, record_id: s.record_id, from: s.prospector, to: s.sheet,
      from_label: stageLabel('employer', s.prospector), to_label: stageLabel('employer', s.sheet), tickable: false,
      note: /is behind/.test(s.reason) ? 'Prospector is ahead' : s.reason });
  }
  for (const s of report.target_stages) {
    add({ key: `stage:target:${s.target_id}`, group: 'stage', type: 'target', name: s.name, record_id: s.record_id, from: s.prospector, to: s.to,
      from_label: stageLabel('target', s.prospector), to_label: stageLabel('target', s.to), tickable: false, note: 'Targets move on the Targets list' });
  }

  for (const a of actions) {
    if (a.route === 'partner_update') {
      const changes = [...changesOf(a.patch), ...changesOf(Object.fromEntries(Object.entries(a.assign).map(([k, v]) => [k, k === 'owner_user_id' ? memberName(v) : v])))];
      if (a.contacts.length) changes.push({ field: 'contacts', label: 'Contacts', value: a.contacts.map(c => c.name).join(', ') });
      if (a.todo) changes.push({ field: 'todo', label: 'To-do', value: `${a.todo.text} · due ${a.todo.due_date}` });
      if (changes.length) add({ key: `fill:partner:${a.goal_id}`, group: 'fill', type: 'partner', name: a.name, record_id: a.record_id, changes, tickable: true }, { kind: 'plan', action: a });
    } else if (a.route === 'opp_update') {
      const { stage, ...rest } = a.patch;
      if (Object.keys(rest).length) add({ key: `fill:employer:${a.opp_id}`, group: 'fill', type: 'employer', name: a.name, record_id: a.record_id, changes: changesOf(rest), tickable: true },
        { kind: 'plan', action: { ...a, patch: rest } });
    } else if (a.route === 'target_update') {
      if (Object.keys(a.patch).length) add({ key: `fill:target:${a.target_id}`, group: 'fill', type: 'target', name: a.name, record_id: a.record_id, changes: changesOf(a.patch), tickable: true }, { kind: 'plan', action: a });
    } else if (a.route === 'opp_insert' || a.route === 'partner_to_target') {
      const type = a.route === 'opp_insert' ? 'employer' : 'target';
      const stage = a.route === 'opp_insert' ? a.row.stage : 'proposed';
      add({ key: `new:${type}:${a.record_id || normName(a.name)}`, group: 'new', type, name: a.name, record_id: a.record_id, to: stage, to_label: stageLabel(type, stage),
        changes: changesOf(Object.fromEntries(['owner_team', 'tier', 'next_action', 'next_action_date'].filter(k => a.row[k]).map(k => [k, a.row[k]]))), tickable: true },
      { kind: 'plan', action: a });
    }
  }

  const info = {
    differences: report.differences, skipped: report.skipped, invalid: report.invalid, ignored: input.ignored,
    stage_mismatches: report.stage_mismatches, kind_mismatches: report.kind_mismatches, multi_person: input.multiPerson,
  };
  return { items, info, rows: input.accounts.length + input.invalid.length, work };
}

export async function previewSheet(supabase, businessId, file) {
  const input = readInput(await readUpload(file), { recordIdRequired: false });
  const rows = input.accounts.length + input.invalid.length;
  if (rows > UPLOAD_MAX_ROWS) throw new ImportRefused(`the file has ${rows} rows - the limit is ${UPLOAD_MAX_ROWS}`);
  const state = await loadState(supabase, businessId);
  return buildPreview(plan(state, input), input, state);
}

// ticked: [{ key, sig }] from the preview. Each item applies on its own: a
// stale one fails with CHANGED_SINCE and the rest still go.
export async function applyTicked(supabase, businessId, preview, ticked, { byUser = null, now = new Date() } = {}) {
  const byKey = new Map(preview.items.map(i => [i.key, i]));
  const applied = [], failed = [];
  for (const t of ticked) {
    const item = byKey.get(t.key);
    const run = preview.work.get(t.key);
    const fail = error => failed.push({ key: t.key, name: item?.name || t.key, error });
    if (!item || !run || item.sig !== t.sig) { fail(CHANGED_SINCE); continue; }
    try {
      if (run.kind === 'partner_stage') {
        await applyPartnerSignal(supabase, { businessId, goalId: run.goal_id, signal: { type: 'status', to: run.to, expect: run.from },
          byUser, now, meta: { source: 'sheet', record_id: run.record_id || null }, skipTouchStamp: true });
      } else if (run.kind === 'opp_stage') {
        const { data, error } = await supabase.from('sales_opportunities').update({ stage: run.to, updated_at: now.toISOString() })
          .eq('business_id', businessId).eq('id', run.opp_id).eq('stage', run.from).select('id');
        if (error) throw new Error(error.message);
        if (!data.length) { fail(CHANGED_SINCE); continue; }
      } else {
        const done = await applyPlan(supabase, businessId, { actions: [run.action] }, { now, byUser });
        if (done.errors.length) { fail(done.errors[0].error); continue; }
      }
      applied.push(t.key);
    } catch (e) {
      fail(e instanceof SignalError && e.status === 409 ? CHANGED_SINCE : e.message);
    }
  }
  return { applied: applied.length, failed };
}

// POST /goals/pipeline-board/update  { file: { name, data: base64 }, apply?: [{ key, sig }] }
// Member+ (salesGate refuses Viewers on non-GET). Without apply: the preview,
// nothing written. With apply: re-plans from the same file and writes the ticked items.
export async function pipelineBoardUpdateRoute(req, res) {
  const { businessId } = req.params;
  const { file, apply } = req.body || {};
  if (apply !== undefined && (!Array.isArray(apply) || !apply.every(t => t && typeof t.key === 'string' && typeof t.sig === 'string'))) {
    return res.status(400).json({ error: 'apply must be a list of { key, sig }' });
  }
  const supabase = getSupabase();
  try {
    const preview = await previewSheet(supabase, businessId, file);
    if (!apply) {
      const { work, ...out } = preview;
      return res.json(out);
    }
    res.json(await applyTicked(supabase, businessId, preview, apply, { byUser: req.auth.user.id }));
  } catch (e) {
    if (e instanceof ImportRefused) return res.status(400).json({ error: `File refused: ${e.message}`, refused: true });
    res.status(500).json({ error: e.message });
  }
}
