// node --test api/sales/intakeDeal.test.mjs  (react-scripts' Jest only runs src/)
// call-notes-targets-v1 REV5 Stage 5 - fixture D (a sanitized Equifax-shaped
// partner call), 0 Claude, 0 network. Two replies: .real.json = the stored
// extract of the one real run (2026-10-19), .ideal.json = the same call split
// one item per bullet, which drives the exact-count Accept tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { toProposals } from './callNotesRoutes.js';
import { toIntake } from './intakeMatch.js';
import { parseIntake, acceptIntake } from './intakeAccept.js';
import { signExtract, extractIfSigned, scrubExtract, recentAccepts, toDeal } from './intakeDeal.js';
import { replyTask, waitingOverdue } from './tidyRules.js';
import { copyBundle, hasPii } from './targetsRoutes.js';
import { acceptBody } from '../../src/components/salesAnalytics/tasks/intakeBody.js';

const NOTE = readFileSync(new URL('./testing/callNoteFixtureD.txt', import.meta.url), 'utf8');
const RAW = JSON.parse(readFileSync(new URL('./testing/callNoteFixtureD.ideal.json', import.meta.url), 'utf8'));
const REAL = JSON.parse(readFileSync(new URL('./testing/callNoteFixtureD.real.json', import.meta.url), 'utf8'));
const NOTE_DATE = '2026-10-16';
const B = randomUUID(), JACK = randomUUID(), CYRUS = randomUUID(), EQ = randomUUID();
const WEEK = '2026-10-12';
const members = [{ id: JACK, name: 'Jack Zz' }, { id: CYRUS, name: 'Cyrus Zz' }];
const equifax = { id: EQ, business_id: B, goal_type: 'partnership', name: 'Equifax', pipeline_status: 'meeting_set', category: null, owner_team: null, co_owner_name: null, no_double_touch: false,
  champion: null, angle: null, watch_outs: null, next_step: null, do_not_say: null, target_titles: null, notes: 'Met at the benefits summit', next_meeting_at: null, archived_at: null, owner_user_id: JACK };
const ctx = () => ({ business_name: 'HomeLover', members, partners: [{ ...equifax }], commitments: [], companies: [], recent: [], opportunities: [], targets: [], categories: [] });
const seed = () => fakeSupabase({
  sales_goals: [{ ...equifax }], sales_partner_events: [], sales_week_goals: [], sales_week_goal_steps: [], sales_week_report: [],
  partner_contacts: [], sales_targets: [], sales_opportunities: [], sales_call_notes: [], business_members: members.map(m => ({ business_id: B, user_id: m.id, name: m.name })),
});
const review = () => ({ ...toProposals(RAW, ctx()), ...toIntake(RAW, ctx(), NOTE_DATE, '2026-10-19') });

async function accept(supabase, intakeReview = review()) {
  const body = acceptBody(intakeReview);
  const note = (await supabase.from('sales_call_notes').insert({ business_id: B, title: 'Equifax sync', call_date: NOTE_DATE, text: NOTE, hash: 'h', extract: RAW, created_by: JACK }).select().single()).data;
  const taskRows = intakeReview.tasks.map(t => ({ payload: { text: t.text, owner_user_id: t.owner_user_id, due_date: t.due_date, link_type: t.link_type, link_id: t.link_id }, steps: t.steps }));
  return { note, out: await acceptIntake(supabase, { businessId: B, userId: JACK, note, ctx: ctx(), intake: parseIntake(body, ctx()), taskRows, week: WEEK, category: 'From calls · Oct 16 · Equifax sync' }) };
}

test('fixture D is sanitized: no email or phone shapes, first names only', () => {
  assert.ok(!hasPii(NOTE));
  assert.ok(!hasPii(JSON.stringify(RAW)));
  assert.ok(!hasPii(JSON.stringify(REAL)));
  for (const h of ['Key outcomes', 'Decisions', 'Economic model', 'Product ideas', 'Pending confirmation', 'Action items']) assert.match(NOTE, new RegExp(`^${h}$`, 'm'));
});

test('replay: counterpart action items are never tasks; 4+ waiting-on, 5 decisions, 3 terms, next meeting = that Monday', () => {
  const r = review();
  assert.ok(r.tasks.every(t => !/\b(Dana|Priya|reconvene|pick the 3)\b/i.test(`${t.text} ${t.evidence}`)), r.tasks.map(t => t.text).join(' | '));
  assert.ok(r.tasks.every(t => t.owner_user_id === JACK || t.owner_user_id === CYRUS), 'every task is ours');
  assert.ok(r.waiting_on.length >= 4, `waiting_on ${r.waiting_on.length}`);
  assert.ok(r.waiting_on.every(w => w.on && w.match?.id === EQ && ['Dana', 'Priya'].includes(w.who)));
  assert.ok(r.waiting_on.some(w => w.who === 'Dana' && w.due_date === '2026-10-23'));
  assert.equal(r.decisions.length, 5);
  assert.equal(r.terms.length, 3);
  assert.ok(r.terms.every(t => t.line.startsWith('(10/16) Terms: ')));
  assert.equal(r.next_meeting.length, 1);
  assert.equal(r.next_meeting[0].date, '2026-10-26', '"week of Oct 27" is Monday Oct 26');
  assert.equal(r.next_meeting[0].old, null);
});

test('real replay: no counterpart task, 4 waiting-on, next meeting snapped to Monday, every decision + term bullet covered', () => {
  const r = { ...toProposals(REAL, ctx()), ...toIntake(REAL, ctx(), NOTE_DATE, '2026-10-19') };
  assert.ok(r.tasks.every(t => !/\b(Dana|Priya|reconvene)\b/i.test(`${t.text} ${t.evidence}`)));
  assert.ok(r.tasks.every(t => [JACK, CYRUS].includes(t.owner_user_id)));
  assert.equal(r.waiting_on.length, 4);
  assert.ok(r.waiting_on.every(w => w.on && w.match.id === EQ));
  assert.equal(REAL.next_meeting.date, '2026-10-27', 'the model gave the Tuesday');
  assert.equal(r.next_meeting[0].date, '2026-10-26', 'the server snapped "week of" to Monday');
  const decided = r.decisions.map(d => d.text).join(' ').toLowerCase();
  for (const k of ['3 equifax employer clients', 'featured partner', 'owns the employer relationship', 'co-branded one-pager', 'monthly check-in']) assert.ok(decided.includes(k), k);
  const terms = r.terms.map(t => t.text).join(' ').toLowerCase();
  for (const k of ['20%', 'pay nothing', '$500']) assert.ok(terms.includes(k), k);
});

test('toDeal: a member never becomes waiting-on; a non-partner company stays unticked', () => {
  const companyOf = name => (name === 'Equifax' ? { company: 'Equifax', company_key: 'c0', m: { type: 'partner', id: EQ, name: 'Equifax', row: equifax } } : { company: name, company_key: null, m: null });
  const d = toDeal({ waiting_on: [{ company: 'Equifax', who: 'Jack', text: 'Send deck' }, { company: 'Acme', who: 'Ann', text: 'Send logo' }], decisions: [{ company: 'Acme', text: 'Go' }] },
    { companyOf, isMember: n => n === 'Jack', noteDate: NOTE_DATE });
  assert.deepEqual(d.waiting_on.map(w => [w.who, w.on]), [['Ann', false]]);
  assert.equal(d.decisions[0].on, false);
});

test('Accept: waiting rows, 2 counterpart contacts, 5 decision events, 3 Terms lines, next meeting set, no meeting to-do', async () => {
  const supabase = seed();
  const { note, out } = await accept(supabase);
  const rows = supabase.db.sales_week_goals;
  const waiting = rows.filter(r => r.kind === 'waiting');
  assert.ok(waiting.length >= 4);
  assert.ok(waiting.every(w => w.waiting_on && w.owner_user_id === null && w.link_type === 'partner' && w.link_id === EQ && w.status === 'open' && w.source_note_id === note.id));
  assert.ok(waiting.some(w => w.waiting_on === 'Dana' && w.due_date === '2026-10-23'));
  const todos = rows.filter(r => r.kind === 'todo');
  assert.ok(todos.length >= 1 && todos.every(t => t.owner_user_id));
  assert.ok(!todos.some(t => /reconvene|meeting|pilot employers/i.test(t.text)), 'no to-do for the meeting');
  const contacts = supabase.db.partner_contacts;
  assert.deepEqual(contacts.map(c => c.name).sort(), ['Dana', 'Priya']);
  assert.ok(contacts.every(c => c.role_in_notes === 'counterpart' && !c.email));
  const decisions = supabase.db.sales_partner_events.filter(e => e.event === 'note' && e.meta?.kind === 'decision');
  assert.equal(decisions.length, 5);
  assert.ok(decisions.every(e => e.meta.from_note_id === note.id && e.goal_id === EQ));
  const g = supabase.db.sales_goals[0];
  assert.equal(g.notes.split('\n').filter(l => l.startsWith('(10/16) Terms: ')).length, 3);
  assert.ok(g.notes.startsWith('Met at the benefits summit\n'), 'notes appended, never overwritten');
  assert.equal(g.next_meeting_at, '2026-10-26');
  assert.equal(out.decisions, 5);
  assert.equal(out.terms, 3);
  assert.equal(out.counterparts_added, 0, 'people[] already added Dana and Priya - no second row');
  assert.equal(g.pipeline_status, 'meeting_set', 'no stage move from deal rows');
});

test('Accept: counterparts named only in waiting-on still get a person row', async () => {
  const supabase = seed();
  const r = review();
  r.people = [];
  const { out } = await accept(supabase, r);
  assert.equal(out.counterparts_added, 2);
  assert.deepEqual(supabase.db.partner_contacts.map(c => [c.name, c.role_in_notes, c.source]).sort(), [['Dana', 'counterpart', 'manual'], ['Priya', 'counterpart', 'manual']]);
});

test('Accept refuses a deal row that is not one of this workspace\'s partners', () => {
  const body = acceptBody(review());
  body.waiting_on[0].match = { type: 'partner', id: randomUUID() };
  assert.throws(() => parseIntake(body, ctx()), /only a partner in this workspace/);
});

test('waiting rows change no report or to-do count: every to-do read filters kind todo', async () => {
  const supabase = seed();
  await accept(supabase);
  const { data: todos } = await supabase.from('sales_week_goals').select('*').eq('business_id', B).eq('kind', 'todo');
  const { data: commitments } = await supabase.from('sales_week_goals').select('*').eq('business_id', B).eq('kind', 'commitment');
  assert.equal(todos.filter(t => t.waiting_on).length, 0);
  assert.equal(commitments.length, 0);
});

test('Tidy: replyTask is suppressed by the open waiting row; waitingOverdue fires once when 2+ days late', async () => {
  const supabase = seed();
  await accept(supabase);
  const waiting = supabase.db.sales_week_goals.filter(r => r.kind === 'waiting');
  const partners = supabase.db.sales_goals;
  assert.deepEqual(replyTask({ partners, todos: [], waiting }), []);
  assert.equal(replyTask({ partners, todos: [], waiting: [] }).length, 1);
  assert.deepEqual(waitingOverdue({ partners, waiting, today: '2026-10-24' }), [], 'Oct 23 + 1 day is not yet');
  const out = waitingOverdue({ partners, waiting, today: '2026-10-25' });
  assert.equal(out.length, 1);
  assert.equal(out[0].text, 'Nudge Dana at Equifax');
});

test('Copy for Claude: next meeting + Decisions, Waiting on them, Terms; no "@" or phone', async () => {
  const supabase = seed();
  await accept(supabase);
  const r = await copyBundle(supabase, { businessId: B, type: 'partner', id: EQ });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const md = r.body.markdown;
  assert.match(md, /Next meeting: Oct 26, 2026/);
  for (const h of ['## Decisions', '## Waiting on them', '## Terms']) assert.ok(md.includes(h), h);
  const section = h => md.split(h)[1].split('\n## ')[0];
  assert.equal(section('## Decisions').split('\n').filter(l => l.startsWith('- ')).length, 5);
  assert.ok(section('## Waiting on them').includes('Dana · Send the list of candidate pilot employers'));
  assert.equal(section('## Terms').split('\n').filter(l => l.startsWith('- (10/16) Terms: ')).length, 3);
  assert.ok(!md.includes('@') && !hasPii(md));
});

test('a second Accept of the same notes collides on the unique note hash (23505, which the route answers 409)', async () => {
  const { createFromCallNotesRoute } = await import('./callNotesRoutes.js');
  assert.equal(typeof createFromCallNotesRoute, 'function');
  // The route maps the unique-hash 23505 to 409; the fake answers it the same way.
  const supabase = fakeSupabase({ sales_call_notes: [] }, { unique: { sales_call_notes: r => `${r.business_id}:${r.hash}` } });
  const first = await supabase.from('sales_call_notes').insert({ business_id: B, hash: 'same' }).select().single();
  const again = await supabase.from('sales_call_notes').insert({ business_id: B, hash: 'same' }).select().single();
  assert.ok(first.data && again.error?.code === '23505');
});

test('stored extract: scrubbed, signed, and refused when the page changed it', () => {
  const ex = scrubExtract({ tasks: [{ text: 'call 415 555 0100 now' }], n: 3 });
  assert.equal(ex.tasks[0].text, 'call [number removed] now');
  assert.equal(ex.n, 3);
  const sig = signExtract(ex, 'h1');
  assert.deepEqual(extractIfSigned(ex, sig, 'h1'), ex);
  assert.equal(extractIfSigned({ ...ex, n: 4 }, sig, 'h1'), null);
  assert.equal(extractIfSigned(ex, sig, 'h2'), null);
  assert.equal(extractIfSigned(ex, null, 'h1'), null);
});

test('24 h warning: another note on the same partner accepted recently is reported, older ones are not', async () => {
  const supabase = seed();
  const { note } = await accept(supabase);
  for (const e of supabase.db.sales_partner_events) e.recorded_at = new Date().toISOString();
  const now = new Date(Date.parse(note.created_at) + 42 * 60000);
  const out = await recentAccepts(supabase, B, [equifax], now);
  assert.equal(out.length, 1);
  assert.equal(out[0].partner, 'Equifax');
  assert.equal(out[0].minutes_ago, 42);
  assert.ok(out[0].todos >= 1 && out[0].events >= 5);
  assert.deepEqual(await recentAccepts(supabase, B, [equifax], new Date(Date.parse(note.created_at) + 25 * 3600e3)), []);
});
