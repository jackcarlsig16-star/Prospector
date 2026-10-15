import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { readInput, plan as importPlan } from './masterImport.js';
import { plan as signalPlan, applyPartnerSignal } from './partnerSignals.js';
import { readUpload, buildPreview, applyTicked, CHANGED_SINCE } from './sheetUpdate.js';
import { ImportRefused } from './masterImport.js';

const NOW = new Date('2026-10-15T18:00:00Z');

// In-memory stand-in for the few supabase-js chains these writes use.
function fakeDb(tables) {
  let seq = 0;
  const from = name => {
    const rows = (tables[name] ||= []);
    const filters = [];
    let op = 'select', payload = null, single = null;
    const match = r => filters.every(([k, v, kind]) => (kind === 'is' ? (r[k] ?? null) === v : r[k] === v));
    const run = () => {
      if (op === 'insert') {
        const list = (Array.isArray(payload) ? payload : [payload]).map(p => ({ id: `${name}-${++seq}`, ...p }));
        rows.push(...list);
        return list;
      }
      const hits = rows.filter(match);
      if (op === 'update') hits.forEach(r => Object.assign(r, payload));
      return hits.map(r => ({ ...r }));
    };
    const q = {
      select: () => q, eq: (k, v) => { filters.push([k, v]); return q; }, is: (k, v) => { filters.push([k, v, 'is']); return q; },
      update: p => { op = 'update'; payload = p; return q; }, insert: p => { op = 'insert'; payload = p; return q; },
      single: () => { single = 'single'; return q; }, maybeSingle: () => { single = 'maybe'; return q; },
      then: (ok, bad) => Promise.resolve().then(() => { const data = run(); return { data: single ? data[0] ?? null : data, error: null }; }).then(ok, bad),
    };
    return q;
  };
  return { from, tables };
}

const goalRow = over => ({ id: 'g1', business_id: 'b1', goal_type: 'partnership', name: 'Gallagher', pipeline_status: 'replied', last_touch_at: '2026-10-01T00:00:00.000Z', first_email_at: '2026-09-01', hot: false, ...over });

test('skipTouchStamp: default status moves still stamp last_touch_at; with it they do not', () => {
  const g = goalRow();
  assert.equal(signalPlan(g, { type: 'status', to: 'meeting_set' }, NOW).patch.last_touch_at, NOW.toISOString(), 'default unchanged');
  assert.deepEqual(signalPlan(g, { type: 'status', to: 'meeting_set' }, NOW, { skipTouchStamp: true }).patch, { pipeline_status: 'meeting_set' });
  assert.ok(!('last_touch_at' in signalPlan(goalRow({ pipeline_status: 'not_started', first_email_at: null }), { type: 'status', to: 'first_email_sent' }, NOW, { skipTouchStamp: true }).patch));
  const touch = signalPlan(g, { type: 'touch', touch_type: 'call', date: '2026-10-15' }, NOW, { skipTouchStamp: true });
  assert.equal(touch.patch.last_touch_at, NOW.toISOString(), 'only the status path reads the option');
});

test('applyPartnerSignal: skipTouchStamp leaves last_touch_at in the DB; default callers still stamp it', async () => {
  const db = fakeDb({ sales_goals: [goalRow(), goalRow({ id: 'g2', name: 'OneDigital' })], sales_partner_events: [] });
  await applyPartnerSignal(db, { businessId: 'b1', goalId: 'g1', signal: { type: 'status', to: 'meeting_set', expect: 'replied' }, now: NOW, meta: { source: 'sheet' }, skipTouchStamp: true });
  await applyPartnerSignal(db, { businessId: 'b1', goalId: 'g2', signal: { type: 'status', to: 'meeting_set' }, now: NOW });
  const [g1, g2] = db.tables.sales_goals;
  assert.equal(g1.pipeline_status, 'meeting_set');
  assert.equal(g1.last_touch_at, '2026-10-01T00:00:00.000Z');
  assert.equal(g2.last_touch_at, NOW.toISOString());
  const ev = db.tables.sales_partner_events[0];
  assert.deepEqual([ev.event, ev.from_status, ev.to_status, ev.meta.source, ev.source], ['status', 'replied', 'meeting_set', 'sheet', 'manual']);
  assert.deepEqual(ev.meta.prev, { pipeline_status: 'replied' }, 'undo restores only the stage');
  await assert.rejects(applyPartnerSignal(db, { businessId: 'b1', goalId: 'g1', signal: { type: 'status', to: 'live', expect: 'replied' }, now: NOW, skipTouchStamp: true }), e => e.status === 409);
});

// The board's export columns (pipelineBoard.js SHEET_COLUMNS).
const EXPORT = ['Top', 'Account', 'Type', 'Status', 'Stage', 'Owner Team', 'Owner', 'Priority Tier', 'Next Step', 'Next Step Due', 'Last Touch', 'Record ID', 'Prospector ID'];
const cell = v => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const csv = (rows, headers = EXPORT) => [headers.join(','), ...rows.map(r => headers.map(h => cell(r[h] ?? '')).join(','))].join('\r\n');

const P = (id, name, status, extra = {}) => ({ id, name, record_id: null, tier: '2', category: '3. Brokers', owner_user_id: 'u-jack', owner_team: 'homelover', co_owner_name: null, next_step: null, notes: 'mine', company_domain: null, pipeline_status: status, last_touch_at: '2026-10-01T00:00:00Z', ...extra });
const O = (id, organization, stage, extra = {}) => ({ id, organization, stage, record_id: null, tier: null, cohort: null, next_action: null, next_action_date: null, owner: 'Jack', owner_team: 'upside', co_owner_name: null, org_type: 'employer', notes: null, decision_makers: null, apollo_account_id: null, ...extra });
const state = () => ({
  partners: [P('p1', 'Gallagher', 'replied'), P('p2', 'OneDigital', 'first_email_sent'), P('p3', 'Lockton', 'not_started'), P('p4', 'Aon', 'proposal_pilot', { record_id: 'HLU-0009' }), P('p5', 'Brown & Brown', 'replied')],
  domains: [], opps: [O('o1', 'Solidcore', 'contacted'), O('o2', 'Marriott', 'responded', { org_type: 'membership' })],
  targets: [], contacts: [], todos: [], sequenced: [],
  members: [{ id: 'u-jack', name: 'Jack', display_name: 'Jack Carlson' }], categories: ['3. Brokers'],
});
const exportRow = (type, r, stage, extra = {}) => ({ Account: r.name || r.organization, Type: type, Status: 'Talking', Stage: stage, 'Owner Team': type === 'Partner' ? 'HomeLover' : 'Upside',
  Owner: type === 'Partner' ? 'Jack Carlson' : 'Jack', 'Priority Tier': r.tier || '', 'Record ID': r.record_id || '', 'Prospector ID': `${type.toLowerCase()}:${r.id}`, 'Last Touch': '2026-10-01', ...extra });

// The spec's 10-row file: 3 forward partner moves, 1 backward, 2 employer moves,
// 1 new employer, 1 new target, 1 unmatched, 1 ignored column (+ 1 unchanged row).
function tenRows(s) {
  const [gal, one, lock, aon, brown] = s.partners;
  const [solid, mar] = s.opps;
  return [
    exportRow('Partner', gal, 'Meeting set'),
    exportRow('Partner', one, 'replied'),
    exportRow('Partner', lock, 'Ignored-col', { Stage: '', 'Funnel Stage': '3 - Engaged' }),
    exportRow('Partner', aon, 'Replied'),
    exportRow('Employer', solid, 'Meeting'),
    exportRow('Employer', mar, 'Proposal/Pilot'),
    { Account: 'Fresh Employer', Type: 'Employer', Stage: 'Contacted', 'Owner Team': 'Upside', 'Priority Tier': '2' },
    { Account: 'Burnham Benefits', Type: 'Target', 'Owner Team': 'Upside' },
    { Account: 'Gone Co', Type: 'Partner', Stage: 'Live', 'Prospector ID': 'partner:p-deleted' },
    exportRow('Partner', brown, 'Replied', { Notes2: 'not a sheet column' }),
  ];
}

test('preview of the 10-row file: exactly the expected items, nothing else', () => {
  const s = state();
  const headers = [...EXPORT, 'Funnel Stage', 'Notes2'];
  const input = readInput(csv(tenRows(s), headers), { recordIdRequired: false });
  const { items, info } = buildPreview(importPlan(s, input), input, s);
  const view = items.map(i => `${i.key}|${i.tickable ? 'tick' : 'grey'}|${i.from || ''}>${i.to || ''}`).sort();
  assert.deepEqual(view, [
    'new:employer:fresh employer|tick|>contacted',
    'new:target:burnham benefits|tick|>proposed',
    'stage:employer:o1|tick|contacted>meeting',
    'stage:employer:o2|tick|responded>proposal_pilot',
    'stage:partner:p1|tick|replied>meeting_set',
    'stage:partner:p2|tick|first_email_sent>replied',
    'stage:partner:p3|tick|not_started>replied',
    'stage:partner:p4|grey|proposal_pilot>replied',
  ]);
  assert.equal(items.find(i => i.key === 'stage:partner:p4').note, 'Prospector is ahead');
  assert.deepEqual(info.ignored, ['Top', 'Status', 'Last Touch', 'Notes2'], 'Status and Top never read; unknown columns listed');
  assert.deepEqual(info.skipped.map(x => x.name), ['Gone Co'], 'a stale Prospector ID is not matched by name');
  assert.equal(info.differences.length, 0, `no differences: ${JSON.stringify(info.differences)}`);
});

test('"Stage" wins over "Funnel Stage"; a Stage of the wrong row type is reported, not guessed', () => {
  const s = state();
  const headers = [...EXPORT, 'Funnel Stage'];
  const input = readInput(csv([
    exportRow('Partner', s.partners[0], 'Live', { 'Funnel Stage': '4 - Meeting scheduled' }),
    exportRow('Partner', s.partners[1], 'Proposal/Pilot'),
    exportRow('Employer', s.opps[0], 'Meeting set'),
  ], headers), { recordIdRequired: false });
  const { items, info } = buildPreview(importPlan(s, input), input, s);
  assert.equal(items.find(i => i.key === 'stage:partner:p1').to, 'live');
  assert.equal(items.find(i => i.key === 'stage:partner:p2').to, 'proposal_pilot', 'labels ignore case/spaces/punctuation');
  assert.ok(!items.some(i => i.key === 'stage:employer:o1'));
  assert.deepEqual(info.stage_mismatches.map(m => [m.name, m.type]), [['Solidcore', 'employer']]);
});

test('an unchanged export re-uploaded = nothing to update (display names, Active tier, label stages, notes kept)', () => {
  const s = state();
  s.partners[3].tier = 'active';
  s.opps[0].next_action = 'Call  them'; s.opps[0].next_action_date = '2026-10-20';
  const rows = [
    ...s.partners.map(p => exportRow('Partner', p, { replied: 'Replied', first_email_sent: '1st email sent', not_started: 'Not started', proposal_pilot: 'Proposal / pilot' }[p.pipeline_status], { 'Priority Tier': p.tier === 'active' ? 'Active' : p.tier })),
    exportRow('Employer', s.opps[0], 'Contacted', { 'Next Step': 'Call them', 'Next Step Due': '10/20/2026' }),
    exportRow('Employer', s.opps[1], 'Responded'),
  ];
  const input = readInput(csv(rows), { recordIdRequired: false });
  const { items, info } = buildPreview(importPlan(s, input), input, s);
  assert.deepEqual(items, []);
  assert.deepEqual(info.invalid, []);
  assert.deepEqual(info.differences, []);
});

test('a file with an "@" anywhere is refused; a non-sheet file type is refused', async () => {
  assert.throws(() => readInput(csv([{ Account: 'X', Type: 'Partner', 'Next Step': 'email a@b.co' }]), { recordIdRequired: false }), ImportRefused);
  await assert.rejects(readUpload({ name: 'x.xls', data: Buffer.from('abc').toString('base64') }), ImportRefused);
  await assert.rejects(readUpload({ name: 'x.csv', data: Buffer.alloc(2 * 1024 * 1024 + 1, 65).toString('base64') }), /over 2 MB/);
});

test('.xlsx upload reads the first sheet: text, dates and rich text', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Joint pipeline');
  ws.addRow(['Account', 'Type', 'Stage', 'Next Step Due', 'Record ID']);
  ws.addRow(['Gallagher', 'Partner', { richText: [{ text: 'Meeting ' }, { text: 'set' }] }, new Date('2026-10-20T00:00:00Z'), '']);
  const data = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
  const table = await readUpload({ name: 'joint.XLSX', data });
  assert.deepEqual(table.rows, [{ Account: 'Gallagher', Type: 'Partner', Stage: 'Meeting set', 'Next Step Due': '2026-10-20', 'Record ID': '' }]);
  const input = readInput(table, { recordIdRequired: false });
  assert.equal(input.accounts[0].next_step_due, '2026-10-20');
});

test('apply: only ticked items; a stale partner fails "changed since the preview", the rest still apply; partner last_touch_at untouched', async () => {
  const s = state();
  const input = readInput(csv(tenRows(s), [...EXPORT, 'Funnel Stage']), { recordIdRequired: false });
  const preview = buildPreview(importPlan(s, input), input, s);
  const db = fakeDb({
    sales_goals: s.partners.map(p => ({ ...p, business_id: 'b1', goal_type: 'partnership' })),
    sales_opportunities: s.opps.map(o => ({ ...o, business_id: 'b1' })), sales_partner_events: [], sales_targets: [],
  });
  db.tables.sales_goals.find(g => g.id === 'p2').pipeline_status = 'meeting_set'; // a teammate's click after the preview
  const tick = preview.items.filter(i => i.tickable && i.key !== 'new:target:burnham benefits').map(i => ({ key: i.key, sig: i.sig }));
  const out = await applyTicked(db, 'b1', preview, [...tick, { key: 'stage:partner:p4', sig: 'x' }, { key: 'stage:employer:o1', sig: 'forged' }], { byUser: 'u-jack', now: NOW });
  assert.deepEqual(out.failed.map(f => [f.key, f.error]).sort(), [
    ['stage:employer:o1', CHANGED_SINCE], ['stage:partner:p2', CHANGED_SINCE], ['stage:partner:p4', CHANGED_SINCE],
  ]);
  assert.equal(out.applied, tick.length - 1);
  const g = id => db.tables.sales_goals.find(x => x.id === id);
  assert.deepEqual([g('p1').pipeline_status, g('p3').pipeline_status, g('p4').pipeline_status], ['meeting_set', 'replied', 'proposal_pilot']);
  assert.ok(['p1', 'p3'].every(id => g(id).last_touch_at === '2026-10-01T00:00:00Z'), 'sheet moves are not touches');
  assert.equal(db.tables.sales_opportunities.find(o => o.id === 'o2').stage, 'proposal_pilot');
  assert.equal(db.tables.sales_opportunities.find(o => o.organization === 'Fresh Employer').stage, 'contacted');
  assert.equal(db.tables.sales_targets.length, 0, 'unticked new target not written');
  assert.ok(db.tables.sales_partner_events.every(e => e.meta.source === 'sheet' && e.by_user === 'u-jack'));
});

test('id columns are not phone numbers (a uuid can hold a digit run); "@" is still refused there', () => {
  const ok = readInput(csv([{ Account: 'Gallagher', Type: 'Partner', 'Record ID': 'HLU-20261015-0001', 'Prospector ID': 'partner:41234567-8901-4abc-9def-000000000001' }]), { recordIdRequired: false });
  assert.equal(ok.accounts[0].pid.id, '41234567-8901-4abc-9def-000000000001');
  assert.throws(() => readInput(csv([{ Account: 'X', Type: 'Partner', 'Next Step': 'call 312-555-0100' }]), { recordIdRequired: false }), /phone number/);
  assert.throws(() => readInput(csv([{ Account: 'X', Type: 'Partner', 'Record ID': 'a@b' }]), { recordIdRequired: false }), /"@"/);
});
