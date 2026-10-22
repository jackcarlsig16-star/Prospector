// node --test api/sales/signalsRoutes.test.mjs  (react-scripts' Jest only runs src/)
// signals-v1 Stage 2 - Scout import + Accept / Dismiss against the in-memory
// Supabase, with fixture workbooks shaped like the Signal Scout file (title
// rows, header on row 4, Rank-only footer, an Also Watch sheet) and invented
// companies. 0 network, 0 Claude, 0 Apollo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { readScout, scoutImport, kindOf } from './scoutImport.js';
import { acceptSignal, dismissSignal, undoSignal, listSignals, nextFriday } from './signalsRoutes.js';
import { salesGate } from '../lib/requireAuth.js';
import { FINAL_ERROR } from './goalsShared.js';

const NOW = new Date('2026-10-19T18:00:00Z'); // Mon Oct 19, 11:00 LA
const B = randomUUID(), U = randomUUID();
const P = { kestrel: randomUUID() };
const O = { brightmill: randomUUID() };
const T = { quarry: randomUUID() };
const HEADER = ['Rank', 'Name', 'Title', 'Company', 'Program', 'Signal(s)', 'Why now', 'Suggested first line', 'Route', 'Hand-off skill', 'Upside joint (cc Brad)', 'Score', 'Status', 'Notes'];
const ROWS = [
  [1, 'Avery Q.', 'VP People', 'Nimbus Freight', 'Employer', 'Hiring 40 drivers', 'New depot opening', 'Saw the depot news', 'Email', 'hk-sniper', '', 9, 'New', ''],
  [2, 'Jo R.', 'Head of Partnerships', 'Kestrel Pay', 'Channel (EWA)', 'Launched an employer portal', 'Portal is live', 'Congrats on the portal', 'Email', 'outreach', '', 8, 'New', ''],
  [3, 'Sam T.', 'CHRO', 'Brightmill Foods', 'Employer', 'Benefits RFP', 'Renewal in Q1', 'Heard about the RFP', 'Email', 'hk-sniper', 'Yes', 7, 'New', ''],
  [4, 'Lee M.', 'Benefits Lead', 'Quarry Labs', 'Employer', 'Open enrollment', 'Enrollment in Nov', 'Quick idea for enrollment', 'Email', 'hk-sniper', '', 6, 'New', ''],
  [5, 'Kai D.', 'COO', 'Orchard Table', 'Something else', 'Expansion', 'Two new sites', 'Saw the expansion', 'Email', 'hk-sniper', 'Yes', 5, 'New', ''],
];

async function scoutFile({ rows = ROWS, extra = null, name = 'scout.xlsx' } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Hit List');
  ws.getRow(1).values = ['Signal Scout - week of Oct 19'];
  ws.getRow(2).values = ['Names are masked'];
  ws.getRow(4).values = HEADER;
  rows.forEach((r, i) => { ws.getRow(5 + i).values = r; });
  ws.getRow(5 + rows.length + 1).values = ['Footer note'];
  ws.getRow(5 + rows.length + 2).values = ['Another footer'];
  const watch = wb.addWorksheet('Also Watch');
  watch.getRow(1).values = ['Name', 'Title', 'Company', 'Program', 'Note'];
  watch.getRow(2).values = ['Ana B.', 'CFO', 'Watch Co', 'Employer', 'later'];
  if (extra) wb.addWorksheet('Funnel & Gaps').getRow(1).values = extra;
  return { name, data: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64') };
}

const seed = () => ({
  sales_goals: [{ id: P.kestrel, business_id: B, goal_type: 'partnership', name: 'Kestrel Pay', archived_at: null, pipeline_status: 'replied', hot: false }],
  sales_opportunities: [{ id: O.brightmill, business_id: B, organization: 'Brightmill Foods', archived_at: null, notes: 'Met at expo' }],
  sales_sequenced_accounts: [],
  sales_targets: [{ id: T.quarry, business_id: B, name: 'Quarry Labs', kind: 'employer', status: 'researching' }],
  partner_domains: [],
  sales_signals: [],
  sales_week_goals: [],
  sales_partner_events: [],
  sales_week_report: [],
});
const unique = {
  sales_signals: r => [r.business_id, r.source, r.signal_week, r.company_key, r.who_key || ''].join('|'),
  sales_targets: r => `${r.business_id}|${r.name.trim().toLowerCase()}`,
};
const fresh = () => fakeSupabase(seed(), { unique });
const imp = async (sb, opts = {}) => scoutImport(sb, { businessId: B, userId: U, file: await scoutFile(opts), dryRun: false, now: NOW, ...opts });
const byCompany = (sb, name) => sb.db.sales_signals.find(s => s.company_name === name);
const accept = (sb, s, now = NOW) => acceptSignal(sb, { businessId: B, userId: U, id: s.id, now });

test('reader: header found on row 4, footer rows skipped, Also Watch counted not imported', async () => {
  const r = await readScout(await scoutFile());
  assert.equal(r.header_row, 4);
  assert.equal(r.rows.length, 5);
  assert.deepEqual(r.rows.map(x => x.company), ROWS.map(x => x[3]));
  assert.equal(r.also_watch, 1);
  assert.deepEqual(r.rows.map(x => x.upside), [false, false, true, false, true]);
});

test('Program -> kind (D5)', () => {
  assert.deepEqual(kindOf('Employer'), { kind: 'employer', kind_guessed: false });
  assert.deepEqual(kindOf('Channel (benefits platform)'), { kind: 'partner', kind_guessed: false });
  assert.deepEqual(kindOf('Something else'), { kind: 'partner', kind_guessed: true });
});

test('PII wall: an "@" or a phone anywhere refuses the whole file, without echoing the value', async () => {
  const at = ROWS.map(r => [...r]); at[2][7] = 'write to someone@example.test';
  await assert.rejects(readScout(await scoutFile({ rows: at })), e => /row 7, column 8 holds an "@"/.test(e.message) && !/example/.test(e.message));
  await assert.rejects(readScout(await scoutFile({ extra: ['Call 312 555 0100'] })), e => /Funnel & Gaps.*phone number/.test(e.message) && !/555/.test(e.message));
  const sb = fresh();
  await assert.rejects(scoutImport(sb, { businessId: B, userId: U, file: await scoutFile({ rows: at }), dryRun: false, now: NOW }));
  assert.equal(sb.db.sales_signals.length, 0);
});

test('dry run writes nothing and previews matches; apply proposes; apply again adds 0', async () => {
  const sb = fresh();
  const before = JSON.stringify(sb.db);
  const dry = await scoutImport(sb, { businessId: B, userId: U, file: await scoutFile(), dryRun: true, now: NOW });
  assert.equal(JSON.stringify(sb.db), before);
  assert.equal(dry.added, 0);
  assert.deepEqual(dry.counts, { propose: 5 });
  const m = Object.fromEntries(dry.rows.map(r => [r.company, r.match && `${r.match.type}${r.match.possible ? '?' : ''}`]));
  assert.deepEqual(m, { 'Nimbus Freight': null, 'Kestrel Pay': 'partner', 'Brightmill Foods': 'opportunity', 'Quarry Labs': 'target', 'Orchard Table': null });
  assert.equal(dry.rows.find(r => r.company === 'Orchard Table').kind_guessed, true);

  const first = await imp(sb);
  assert.equal(first.added, 5);
  assert.ok(sb.db.sales_signals.every(s => s.status === 'new' && s.signal_week === '2026-10-19' && s.source === 'scout'));
  assert.equal(byCompany(sb, 'Nimbus Freight').who, 'VP People · Avery Q.');
  assert.deepEqual([sb.db.sales_targets.length, sb.db.sales_week_goals.length, sb.db.sales_partner_events.length], [1, 0, 0]);
  const again = await imp(sb);
  assert.equal(again.added, 0);
  assert.deepEqual(again.counts, { 'already proposed': 5 });
  assert.equal(sb.db.sales_signals.length, 5);
});

test('accept, no match: 1 target (source scout) + 1 to-do due Friday, linked to it', async () => {
  const sb = fresh(); await imp(sb);
  const r = await accept(sb, byCompany(sb, 'Nimbus Freight'));
  assert.equal(r.status, 200, r.body.error);
  assert.equal(r.body.via, 'new_target');
  const t = sb.db.sales_targets.find(x => x.name === 'Nimbus Freight');
  assert.deepEqual([t.source, t.kind, t.status, t.signal_id, t.owner_team], ['scout', 'employer', 'researching', byCompany(sb, 'Nimbus Freight').id, null]);
  assert.equal(sb.db.sales_week_goals.length, 1);
  const todo = sb.db.sales_week_goals[0];
  assert.deepEqual([todo.text, todo.due_date, todo.week_start, todo.link_type, todo.link_id, todo.owner_user_id, todo.status],
    ['Reach out: Nimbus Freight — VP People · Avery Q.', '2026-10-23', '2026-10-19', 'target', t.id, U, 'open']);
  const s = byCompany(sb, 'Nimbus Freight');
  assert.deepEqual([s.status, s.target_id, s.todo_id, s.decided_by], ['accepted', t.id, todo.id, U]);
});

test('accept, partner match: 1 note event, 0 status signals, 1 to-do linked to the partner', async () => {
  const sb = fresh(); await imp(sb);
  const r = await accept(sb, byCompany(sb, 'Kestrel Pay'));
  assert.equal(r.status, 200, r.body.error);
  assert.deepEqual(sb.db.sales_partner_events.map(e => e.event), ['note']);
  assert.equal(sb.db.sales_goals[0].pipeline_status, 'replied');
  assert.match(sb.db.sales_partner_events[0].note, /^Signal Scout 10\/19: Launched an employer portal · Why now: Portal is live$/);
  assert.equal(sb.db.sales_targets.length, 1);
  assert.deepEqual([sb.db.sales_week_goals[0].link_type, sb.db.sales_week_goals[0].link_id], ['partner', P.kestrel]);
});

test('accept, employer match: a notes line + one to-do linked to the employer, naming the company; Upside joint -> (cc Brad); Undo takes both back', async () => {
  const sb = fresh(); await imp(sb);
  const r = await accept(sb, byCompany(sb, 'Brightmill Foods'));
  assert.equal(r.status, 200, r.body.error);
  assert.equal(sb.db.sales_opportunities[0].notes, 'Met at expo\n(10/19) Signal: Benefits RFP · Why now: Renewal in Q1');
  const todo = sb.db.sales_week_goals[0];
  assert.deepEqual([todo.link_type, todo.link_id], ['opportunity', sb.db.sales_opportunities[0].id], 'FIX loop-quickfixes Q1: the to-do carries the employer');
  assert.equal(todo.text, 'Reach out: Brightmill Foods — CHRO · Sam T. (cc Brad)');
  const u = await undo(sb, byCompany(sb, 'Brightmill Foods'));
  assert.equal(u.status, 200, u.body.error);
  assert.deepEqual([sb.db.sales_week_goals.length, sb.db.sales_opportunities[0].notes, byCompany(sb, 'Brightmill Foods').status], [0, 'Met at expo', 'new']);
});

test('accept, target match: reuses the target (no second one) + 1 to-do', async () => {
  const sb = fresh(); await imp(sb);
  const r = await accept(sb, byCompany(sb, 'Quarry Labs'));
  assert.equal(r.status, 200, r.body.error);
  assert.equal(sb.db.sales_targets.length, 1);
  assert.deepEqual([sb.db.sales_week_goals[0].link_type, sb.db.sales_week_goals[0].link_id], ['target', T.quarry]);
  assert.equal(byCompany(sb, 'Quarry Labs').target_id, T.quarry);
});

test('Upside joint, no match: target owner_team both + co-owner Brad, to-do ends (cc Brad)', async () => {
  const sb = fresh(); await imp(sb);
  const r = await accept(sb, byCompany(sb, 'Orchard Table'));
  assert.equal(r.status, 200, r.body.error);
  const t = sb.db.sales_targets.find(x => x.name === 'Orchard Table');
  assert.deepEqual([t.owner_team, t.co_owner_name, t.kind], ['both', 'Brad', 'partner']);
  assert.match(sb.db.sales_week_goals[0].text, /\(cc Brad\)$/);
});

test('a second accept is 409 and creates nothing more', async () => {
  const sb = fresh(); await imp(sb);
  const s = byCompany(sb, 'Nimbus Freight');
  assert.equal((await accept(sb, s)).status, 200);
  const r = await accept(sb, s);
  assert.equal(r.status, 409);
  assert.deepEqual([sb.db.sales_targets.length, sb.db.sales_week_goals.length], [2, 1]);
});

test("a signal from a finalized past week: the to-do lands in the Accept day's week, no 409", async () => {
  const sb = fresh();
  await scoutImport(sb, { businessId: B, userId: U, file: await scoutFile(), dryRun: false, now: new Date('2026-10-07T18:00:00Z') });
  sb.db.sales_week_report.push({ business_id: B, week_start: '2026-10-05', status: 'final' });
  const r = await accept(sb, byCompany(sb, 'Nimbus Freight'));
  assert.equal(r.status, 200, r.body.error);
  assert.deepEqual([sb.db.sales_week_goals[0].week_start, sb.db.sales_week_goals[0].due_date], ['2026-10-19', '2026-10-23']);
  sb.db.sales_week_report.push({ business_id: B, week_start: '2026-10-19', status: 'final' });
  const blocked = await accept(sb, byCompany(sb, 'Orchard Table'));
  assert.deepEqual([blocked.status, blocked.body.error], [409, FINAL_ERROR]);
});

test('next Friday: same day on Friday, next week on Sat/Sun', () => {
  assert.deepEqual(['2026-10-19', '2026-10-23', '2026-10-24', '2026-10-25'].map(nextFriday), ['2026-10-23', '2026-10-23', '2026-10-30', '2026-10-30']);
});

test('a failure after the target insert undoes it (no orphan target)', async () => {
  const sb = fresh(); await imp(sb);
  const from = sb.from;
  sb.from = t => (t === 'sales_week_goals' ? { insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'boom' } }) }) }) } : from(t));
  const r = await accept(sb, byCompany(sb, 'Nimbus Freight'));
  assert.equal(r.status, 500);
  assert.equal(sb.db.sales_targets.length, 1);
  assert.equal(byCompany(sb, 'Nimbus Freight').status, 'new');
});

test('dismiss parks 7 days; a re-import that week proposes nothing for it; list filters by status', async () => {
  const sb = fresh(); await imp(sb);
  const r = await dismissSignal(sb, { businessId: B, userId: U, id: byCompany(sb, 'Orchard Table').id, now: NOW });
  assert.equal(r.status, 200);
  assert.equal(r.body.signal.dismissed_until, '2026-10-26');
  const again = await imp(sb);
  assert.equal(again.rows.find(x => x.company === 'Orchard Table').would, 'dismissed');
  assert.equal((await listSignals(sb, B)).length, 4);
  assert.equal((await listSignals(sb, B, 'all')).length, 5);
  assert.equal((await listSignals(sb, B))[0].company_name, 'Nimbus Freight');
  assert.equal((await dismissSignal(sb, { businessId: B, userId: U, id: byCompany(sb, 'Orchard Table').id, now: NOW })).status, 409);
  // Next week's file: the other four are new signals; the parked company still isn't.
  const nextWeek = await imp(sb, { now: new Date('2026-10-26T18:00:00Z') });
  assert.equal(nextWeek.added, 4);
  assert.equal(nextWeek.rows.find(x => x.company === 'Orchard Table').would, 'dismissed');
});

// FIX actions-done-button-v1 REV2 - Done = Accept with { done: true }.
const done = (sb, s, now = NOW) => acceptSignal(sb, { businessId: B, userId: U, id: s.id, now, done: true });
const undo = (sb, s, body = {}, now = new Date(NOW.getTime() + 60e3)) => undoSignal(sb, { businessId: B, userId: U, id: s.id, body, now });

test('Done, no match: the same target + the to-do born done (completed_at = now), signal accepted, no touch', async () => {
  const sb = fresh(); await imp(sb);
  const r = await done(sb, byCompany(sb, 'Nimbus Freight'));
  assert.equal(r.status, 200, r.body.error);
  assert.deepEqual([r.body.via, r.body.touch_event_id], ['new_target', null]);
  const todo = sb.db.sales_week_goals[0];
  assert.deepEqual([todo.status, todo.completed_at, todo.due_date, todo.link_type, todo.owner_user_id], ['done', NOW.toISOString(), '2026-10-23', 'target', U]);
  assert.equal(sb.db.sales_targets.find(x => x.name === 'Nimbus Freight').status, 'researching');
  assert.deepEqual([byCompany(sb, 'Nimbus Freight').status, byCompany(sb, 'Nimbus Freight').todo_id, sb.db.sales_partner_events.length], ['accepted', todo.id, 0]);
});

test('Done, partner match: ONE email touch (no stage move, last_touch_at + first_email_at stamped, the signal note on it), no note event', async () => {
  const sb = fresh(); await imp(sb);
  const r = await done(sb, byCompany(sb, 'Kestrel Pay'));
  assert.equal(r.status, 200, r.body.error);
  const ev = sb.db.sales_partner_events;
  assert.deepEqual(ev.map(e => [e.event, e.touch_type, e.to_status, e.source, e.meta.from_signal_id]), [['touch', 'email', null, 'manual', byCompany(sb, 'Kestrel Pay').id]]);
  assert.match(ev[0].note, /^Signal Scout 10\/19: Launched an employer portal · Why now: Portal is live$/);
  assert.equal(r.body.touch_event_id, ev[0].id);
  const g = sb.db.sales_goals[0];
  assert.deepEqual([g.pipeline_status, g.last_touch_at, g.first_email_at], ['replied', NOW.toISOString(), '2026-10-19']);
  assert.deepEqual([sb.db.sales_week_goals[0].status, sb.db.sales_week_goals[0].link_id], ['done', P.kestrel]);
});

test('Done, employer match: the notes line + a done to-do, 0 partner events; done: "yes" is 400 and writes nothing', async () => {
  const sb = fresh(); await imp(sb);
  const r = await done(sb, byCompany(sb, 'Brightmill Foods'));
  assert.equal(r.status, 200, r.body.error);
  assert.equal(sb.db.sales_opportunities[0].notes, 'Met at expo\n(10/19) Signal: Benefits RFP · Why now: Renewal in Q1');
  assert.deepEqual([sb.db.sales_week_goals[0].status, sb.db.sales_week_goals[0].link_type, sb.db.sales_week_goals[0].link_id, sb.db.sales_partner_events.length], ['done', 'opportunity', sb.db.sales_opportunities[0].id, 0]);
  const before = JSON.stringify(sb.db);
  const bad = await acceptSignal(sb, { businessId: B, userId: U, id: byCompany(sb, 'Kestrel Pay').id, now: NOW, done: 'yes' });
  assert.deepEqual([bad.status, bad.body.error], [400, 'done must be true']);
  assert.equal(JSON.stringify(sb.db), before);
});

test('Done on a partner whose stage moved between the read and the touch: 409, nothing written', async () => {
  const sb = fresh(); await imp(sb);
  const from = sb.from; let n = 0;
  // acceptMatch reads sales_goals first; the Done's own stage read is the second - make it stale.
  sb.from = t => (t === 'sales_goals' && n++ === 1 ? { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { pipeline_status: 'in_sequence' } }) }) }) }) } : from(t));
  const r = await done(sb, byCompany(sb, 'Kestrel Pay'));
  assert.equal(r.status, 409);
  assert.deepEqual([sb.db.sales_partner_events.length, sb.db.sales_week_goals.length, byCompany(sb, 'Kestrel Pay').status, sb.db.sales_goals[0].last_touch_at], [0, 0, 'new', undefined]);
});

test('Undo a partner Done: the touch comes off first (undo event, stamps restored), then the done to-do, signal back to new', async () => {
  const sb = fresh(); await imp(sb);
  const s = byCompany(sb, 'Kestrel Pay');
  const r = await done(sb, s);
  const u = await undo(sb, s, { touch_event_id: r.body.touch_event_id });
  assert.equal(u.status, 200, u.body.error);
  assert.deepEqual(sb.db.sales_partner_events.map(e => e.event), ['touch', 'undo']);
  assert.equal(sb.db.sales_partner_events[1].meta.undid, r.body.touch_event_id);
  const g = sb.db.sales_goals[0];
  assert.deepEqual([g.pipeline_status, g.last_touch_at, g.first_email_at], ['replied', null, null]);
  assert.deepEqual([sb.db.sales_week_goals.length, byCompany(sb, 'Kestrel Pay').status, byCompany(sb, 'Kestrel Pay').todo_id], [0, 'new', null]);
  // Without the id the undo still finds its touch by the signal id in meta.
  const r2 = await done(sb, byCompany(sb, 'Kestrel Pay'));
  assert.equal(r2.status, 200, r2.body.error);
  assert.equal((await undo(sb, byCompany(sb, 'Kestrel Pay'))).status, 200);
  assert.deepEqual(sb.db.sales_partner_events.map(e => e.event), ['touch', 'undo', 'touch', 'undo']);
});

test('Undo a partner Done after a later change on the partner: 409 from undoPartnerSignal and nothing changes', async () => {
  const sb = fresh(); await imp(sb);
  const s = byCompany(sb, 'Kestrel Pay');
  const r = await done(sb, s);
  // recorded_at is the real clock in the fake (like the DB default), so "later" is later than the touch just written.
  sb.db.sales_partner_events.push({ id: randomUUID(), business_id: B, goal_id: P.kestrel, event: 'note', note: 'later', source: 'manual', meta: {}, recorded_at: new Date(Date.now() + 60e3).toISOString() });
  const before = JSON.stringify(sb.db);
  const u = await undo(sb, s, { touch_event_id: r.body.touch_event_id });
  assert.deepEqual([u.status, u.body.error], [409, 'only the latest change on this partner can be undone']);
  assert.equal(JSON.stringify(sb.db), before);
  assert.equal((await undo(sb, s, { touch_event_id: 'nope' })).status, 400);
});

test('Undo an Accept (no Done) still deletes its open to-do and note; Undo a no-match Done removes the done to-do and the target', async () => {
  const sb = fresh(); await imp(sb);
  assert.equal((await accept(sb, byCompany(sb, 'Kestrel Pay'))).status, 200);
  assert.equal((await undo(sb, byCompany(sb, 'Kestrel Pay'))).status, 200);
  assert.deepEqual([sb.db.sales_partner_events.length, sb.db.sales_week_goals.length, byCompany(sb, 'Kestrel Pay').status], [0, 0, 'new']);
  assert.equal((await done(sb, byCompany(sb, 'Nimbus Freight'))).status, 200);
  assert.equal((await undo(sb, byCompany(sb, 'Nimbus Freight'))).status, 200);
  assert.deepEqual([sb.db.sales_week_goals.length, sb.db.sales_targets.length, byCompany(sb, 'Nimbus Freight').status], [0, 1, 'new']);
});

test('Done in a finalized week is the same 409 as Accept', async () => {
  const sb = fresh(); await imp(sb);
  sb.db.sales_week_report.push({ business_id: B, week_start: '2026-10-19', status: 'final' });
  const r = await done(sb, byCompany(sb, 'Orchard Table'));
  assert.deepEqual([r.status, r.body.error, sb.db.sales_week_goals.length], [409, FINAL_ERROR, 0]);
});

test('Viewer: GET passes the gate, the upload and accept are 403', () => {
  process.env.SALES_ANALYTICS_BUSINESS_IDS = B;
  const run = method => {
    const out = { code: 200, next: false };
    const res = { status(c) { out.code = c; return { json() {} }; } };
    salesGate({ method, params: { businessId: B }, auth: { isPlatformOwner: false, roles: new Map([[B, 'viewer']]) } }, res, () => { out.next = true; });
    return out;
  };
  assert.deepEqual(run('GET'), { code: 200, next: true });
  assert.deepEqual(run('POST'), { code: 403, next: false });
});
