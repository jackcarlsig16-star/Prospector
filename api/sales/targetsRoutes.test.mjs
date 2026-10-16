// node --test api/sales/targetsRoutes.test.mjs  (react-scripts' Jest only runs src/)
// call-notes-targets-v1 REV4 Stage 2 - promote / reject / copy-bundle against an
// in-memory Supabase: 0 network, 0 Claude, 0 Apollo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { promoteTarget, rejectTarget, copyBundle, listProspectTargets, hasPii, validatePromote } from './targetsRoutes.js';
import { toIntake } from './intakeMatch.js';


const B = randomUUID(), U = randomUUID(), N1 = randomUUID();
const T = { fundrise: randomUUID(), gallagherInc: randomUUID(), solidcore: randomUUID(), deloitte: randomUUID(), done: randomUUID() };
const G = { gallagher: randomUUID() };
const W = { research: randomUUID(), doneOne: randomUUID(), deloitteTodo: randomUUID() };
const WEEK = '2026-10-12';
const target = (id, name, kind, extra) => ({ id, business_id: B, name, kind, status: 'researching', suggested_category: null, owner_team: null, co_owner_name: null, no_double_touch: false, evidence: null, research_notes: null, research_prompt: 'x', promoted_goal_id: null, source_note_id: N1, created_by: U, decided_at: null, created_at: '2026-10-13T00:00:00Z', updated_at: '2026-10-13T00:00:00Z', ...extra });
const seed = () => fakeSupabase({
  sales_call_notes: [{ id: N1, business_id: B, title: 'Seif call', call_date: '2026-10-12', source_label: 'Seif weekly', text: 'never read here' }],
  sales_targets: [
    target(T.fundrise, 'Fundrise', 'partner', { suggested_category: '3. Renter Platforms', owner_team: 'upside', co_owner_name: 'Brad', no_double_touch: true, evidence: 'renter-investing platforms are worth approaching', research_notes: 'Person: Ana Example — CEO (champion)\n(10/12) angle: reaches 400k renters' }),
    target(T.gallagherInc, 'Gallagher Inc', 'partner'),
    target(T.solidcore, 'Solidcore', 'employer', { evidence: 'Crystal replied Oct 13' }),
    target(T.deloitte, 'Deloitte', 'employer', { evidence: 'runs a large benefits program', owner_team: 'homelover' }),
    target(T.done, 'Already Promoted Co', 'partner', { status: 'accepted', decided_at: '2026-10-13T00:00:00Z' }),
  ],
  sales_goals: [{ id: G.gallagher, business_id: B, goal_type: 'partnership', name: 'Gallagher', pipeline_status: 'replied', category: '4. Mid-Market Benefits Brokers', tier: '2', hot: true, owner_user_id: U, owner_team: 'upside', co_owner_name: 'Brad', no_double_touch: false, champion: 'Pat Example', angle: 'Call Pat at 415-555-0100 or pat@gallagher.com about the broker pilot', watch_outs: null, next_step: 'Send the one-pager', archived_at: null }],
  sales_opportunities: [{ id: randomUUID(), business_id: B, organization: '[solidcore]', org_type: 'employer', stage: 'contacted', source: 'manual', archived_at: null, notes: 'Crystal: crystal@solidcore.co', owner_team: null, co_owner_name: null, no_double_touch: false }],
  sales_sequenced_accounts: [{ business_id: B, account_id: 'acc-marriott', name: 'Marriott International' }],
  sales_week_goals: [
    { id: W.research, business_id: B, kind: 'todo', text: 'Research Fundrise', status: 'open', week_start: WEEK, link_type: 'target', link_id: T.fundrise, owner_user_id: U, due_date: '2026-10-16' },
    { id: W.doneOne, business_id: B, kind: 'todo', text: 'Read the Fundrise S-1', status: 'done', week_start: WEEK, link_type: 'target', link_id: T.fundrise, owner_user_id: U, due_date: null },
    { id: W.deloitteTodo, business_id: B, kind: 'todo', text: 'Research Deloitte', status: 'open', week_start: WEEK, link_type: 'target', link_id: T.deloitte, owner_user_id: U, due_date: null },
    { id: randomUUID(), business_id: B, kind: 'todo', text: 'Send Gallagher the one-pager', status: 'open', week_start: WEEK, link_type: 'partner', link_id: G.gallagher, owner_user_id: U, due_date: '2026-10-17' },
  ],
  sales_week_report: [],
  sales_partner_events: [{ id: randomUUID(), business_id: B, goal_id: G.gallagher, event: 'touch', touch_type: 'email', contact_names: ['Pat Example'], source: 'outlook', by_user: U, at: '2026-10-12T19:00:00Z', recorded_at: '2026-10-12T19:00:00Z', meta: { direction: 'sent' } }],
  partner_contacts: [{ id: randomUUID(), business_id: B, goal_id: G.gallagher, name: 'Pat Example', title: 'VP Benefits', role_in_notes: 'champion', email: 'pat@gallagher.com', source: 'manual' }],
  sales_opportunity_events: [],
  business_members: [{ business_id: B, user_id: U, name: 'Jack Zz', role: 'owner' }],
});

test('list: evidence, research notes, promoted id and the source note label + date come back', async () => {
  const s = seed();
  const list = await listProspectTargets(s, B);
  const f = list.find(t => t.id === T.fundrise);
  assert.equal(f.evidence, 'renter-investing platforms are worth approaching');
  assert.match(f.research_notes, /Ana Example/);
  assert.equal(f.promoted_goal_id, null);
  assert.deepEqual(f.source, { label: 'Seif weekly', date: '2026-10-12' });
  assert.equal(list.length, 5, 'rejected and accepted rows stay in the list');
  assert.equal('research_prompt' in f, false);
});

test('promote -> partner: not_started, category + ownership, intake note event, to-dos relinked, target accepted', async () => {
  const s = seed();
  const r = await promoteTarget(s, { businessId: B, userId: U, targetId: T.fundrise, body: { to: 'partner' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.created.type, 'partner');
  const goal = s.db.sales_goals.find(g => g.name === 'Fundrise');
  assert.equal(goal.goal_type, 'partnership');
  assert.equal(goal.pipeline_status, 'not_started');
  assert.equal(goal.category, '3. Renter Platforms');
  assert.deepEqual([goal.owner_team, goal.co_owner_name, goal.no_double_touch], ['upside', 'Brad', true]);
  assert.equal(goal.owner_user_id ?? null, null, 'no person owner is picked - Assign does that');
  const events = s.db.sales_partner_events.filter(e => e.goal_id === goal.id);
  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'note');
  assert.match(events[0].note, /^From intake \(Seif weekly, 2026-10-12\): renter-investing platforms are worth approaching\nPerson: Ana Example — CEO \(champion\)/);
  assert.equal(events[0].meta.from_target_id, T.fundrise);
  assert.equal(events[0].meta.from_note_id, N1);
  const linked = s.db.sales_week_goals.filter(w => w.link_type === 'partner' && w.link_id === goal.id).map(w => w.id).sort();
  assert.deepEqual(linked, [W.research, W.doneOne].sort(), 'every to-do on the target follows the partner');
  assert.equal(r.body.relinked, 2);
  const t = s.db.sales_targets.find(x => x.id === T.fundrise);
  assert.equal(t.status, 'accepted');
  assert.equal(t.promoted_goal_id, goal.id);
  assert.ok(t.decided_at);
  // Promoting again is refused.
  const again = await promoteTarget(s, { businessId: B, userId: U, targetId: T.fundrise, body: { to: 'partner' } });
  assert.equal(again.status, 409);
});

test('promote -> partner: the confirm panel can change name, category and ownership', async () => {
  const s = seed();
  const r = await promoteTarget(s, { businessId: B, userId: U, targetId: T.fundrise, body: { to: 'partner', name: 'Fundrise, Inc.', category: '2. Perk Marketplaces & Benefit Platforms', owner_team: null, co_owner_name: null, no_double_touch: false } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const goal = s.db.sales_goals.find(g => g.name === 'Fundrise, Inc.');
  assert.equal(goal.category, '2. Perk Marketplaces & Benefit Platforms');
  assert.deepEqual([goal.owner_team, goal.co_owner_name, goal.no_double_touch], [null, null, false]);
  assert.equal(validatePromote({ to: 'sponsor' }, {}).error, 'to must be one of partner|employer');
  assert.equal(validatePromote({ to: 'partner', owner_team: 'acme' }, { name: 'X' }).error, 'owner_team must be one of homelover|upside|both or null');
  assert.equal(validatePromote({ to: 'partner', name: '  ' }, { name: 'X' }).error, 'name is required');
});

test('promote -> partner on a name that is already a partner: already, nothing created', async () => {
  const s = seed();
  const before = { goals: s.db.sales_goals.length, events: s.db.sales_partner_events.length };
  const r = await promoteTarget(s, { businessId: B, userId: U, targetId: T.gallagherInc, body: { to: 'partner' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.already, { type: 'partner', id: G.gallagher, name: 'Gallagher' });
  assert.equal(s.db.sales_goals.length, before.goals);
  assert.equal(s.db.sales_partner_events.length, before.events);
  assert.equal(s.db.sales_targets.find(t => t.id === T.gallagherInc).status, 'researching');
});

test('promote -> employer: opportunity at target with the evidence in notes, ownership carried, to-dos stay on the target', async () => {
  const s = seed();
  const r = await promoteTarget(s, { businessId: B, userId: U, targetId: T.deloitte, body: { to: 'employer' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.created.type, 'opportunity');
  const opp = s.db.sales_opportunities.find(o => o.organization === 'Deloitte');
  assert.equal(opp.stage, 'target');
  assert.equal(opp.source, 'manual');
  assert.equal(opp.org_type, 'employer');
  assert.equal(opp.owner_team, 'homelover');
  assert.match(opp.notes, new RegExp(`^\\(\\d+/\\d+\\) from target ${T.deloitte}: runs a large benefits program$`));
  assert.equal(s.db.sales_opportunity_events.length, 0, 'the DB trigger writes the created event, not the route');
  const t = s.db.sales_targets.find(x => x.id === T.deloitte);
  assert.equal(t.status, 'accepted');
  assert.equal(t.promoted_goal_id, null, 'no employer link column');
  const todo = s.db.sales_week_goals.find(w => w.id === W.deloitteTodo);
  assert.deepEqual([todo.link_type, todo.link_id], ['target', T.deloitte], 'REV4 T3 option a');
  assert.equal(r.body.relinked, 0);
});

test('promote -> employer on a name already in the pipeline (opportunityMatch): already, nothing created', async () => {
  const s = seed();
  const before = s.db.sales_opportunities.length;
  const r = await promoteTarget(s, { businessId: B, userId: U, targetId: T.solidcore, body: { to: 'employer' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.already.type, 'opportunity');
  assert.equal(r.body.already.name, '[solidcore]');
  assert.equal(s.db.sales_opportunities.length, before);
  assert.equal(s.db.sales_targets.find(t => t.id === T.solidcore).status, 'researching');
});

test('promote: unknown target 404; a target from another workspace 404', async () => {
  const s = seed();
  assert.equal((await promoteTarget(s, { businessId: B, userId: U, targetId: randomUUID(), body: { to: 'partner' } })).status, 404);
  assert.equal((await promoteTarget(s, { businessId: randomUUID(), userId: U, targetId: T.fundrise, body: { to: 'partner' } })).status, 404);
  assert.equal((await promoteTarget(s, { businessId: B, userId: U, targetId: 'not-a-uuid', body: { to: 'partner' } })).status, 404);
});

test('reject: rejected + decided_at, open to-dos dropped (done ones untouched), intakeMatch drops the name; undo restores both', async () => {
  const s = seed();
  const r = await rejectTarget(s, { businessId: B, targetId: T.fundrise, body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const t = s.db.sales_targets.find(x => x.id === T.fundrise);
  assert.equal(t.status, 'rejected');
  assert.ok(t.decided_at);
  assert.deepEqual(r.body.dropped, [W.research]);
  assert.equal(s.db.sales_week_goals.find(w => w.id === W.research).status, 'dropped');
  assert.equal(s.db.sales_week_goals.find(w => w.id === W.doneOne).status, 'done', 'never marked done, never deleted');
  assert.equal(s.db.sales_week_goals.length, 4);
  // The next extract that names it: not proposed again.
  const ctx = { partners: [], opportunities: [], companies: [], targets: s.db.sales_targets, members: [], categories: [] };
  const intake = toIntake({ companies: [{ name: 'Fundrise', kind: 'partner', evidence: 'x' }, { name: 'Lockton', kind: 'partner', evidence: 'y' }] }, ctx, '2026-10-14', '2026-10-14');
  assert.deepEqual(intake.rejected, ['Fundrise']);
  assert.deepEqual(intake.companies.map(c => c.name), ['Lockton']);
  // Twice is a 409; undo puts it back to researching and reopens the dropped to-do.
  assert.equal((await rejectTarget(s, { businessId: B, targetId: T.fundrise, body: {} })).status, 409);
  const u = await rejectTarget(s, { businessId: B, targetId: T.fundrise, body: { undo: true, reopen: r.body.dropped } });
  assert.equal(u.status, 200, JSON.stringify(u.body));
  assert.equal(s.db.sales_targets.find(x => x.id === T.fundrise).status, 'researching');
  assert.equal(s.db.sales_targets.find(x => x.id === T.fundrise).decided_at, null);
  assert.deepEqual(u.body.reopened, [W.research]);
  assert.equal(s.db.sales_week_goals.find(w => w.id === W.research).status, 'open');
  // Undo only reopens to-dos that belong to this target.
  const stray = await rejectTarget(s, { businessId: B, targetId: T.solidcore, body: {} });
  const u2 = await rejectTarget(s, { businessId: B, targetId: T.solidcore, body: { undo: true, reopen: [W.research, ...stray.body.dropped] } });
  assert.deepEqual(u2.body.reopened, []);
});

test('reject refuses a promoted target and a finalized week keeps its to-dos', async () => {
  const s = seed();
  assert.equal((await rejectTarget(s, { businessId: B, targetId: T.done, body: {} })).status, 409);
  s.db.sales_week_report.push({ business_id: B, week_start: WEEK, status: 'final' });
  const r = await rejectTarget(s, { businessId: B, targetId: T.deloitte, body: {} });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.dropped, []);
  assert.equal(s.db.sales_week_goals.find(w => w.id === W.deloitteTodo).status, 'open');
});

test('copy bundle (partner): intel, people, touches, open to-dos - no "@", no phone, ends with What I need', async () => {
  const s = seed();
  const r = await copyBundle(s, { businessId: B, type: 'partner', id: G.gallagher });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const md = r.body.markdown;
  assert.match(md, /^# Gallagher — partner\n/);
  assert.match(md, /Owner team: Upside · Co-owner: Brad/);
  assert.match(md, /Stage: Replied · Category: 4\. Mid-Market Benefits Brokers · Tier: 2 · Hot · Owner: Jack/);
  assert.match(md, /- Angle: Call Pat at \[number removed\] or \[email removed\] about the broker pilot/);
  assert.match(md, /## People \(1\)\n- Pat Example · VP Benefits · champion/);
  assert.match(md, /## Last touches \(1\)\n- Oct 12, 2026 · email · out · Pat Example · by Jack/);
  assert.match(md, /## Open to-dos\n- Send Gallagher the one-pager · Jack · due Oct 17, 2026/);
  assert.ok(md.endsWith('## What I need:\n\n'));
  assert.equal(md.includes('@'), false);
  assert.equal(md.includes('555'), false, 'the contact email and the phone in the DB never reach the bundle');
  assert.equal(hasPii(md), false);
});

test('copy bundle (employer + target): scrubbed, source note named, 404 / 400 on bad input', async () => {
  const s = seed();
  const e = await copyBundle(s, { businessId: B, type: 'employer', id: s.db.sales_opportunities[0].id });
  assert.equal(e.status, 200, JSON.stringify(e.body));
  assert.match(e.body.markdown, /^# \[solidcore\] — employer\n/);
  assert.match(e.body.markdown, /- Notes: Crystal: \[email removed\]/);
  assert.match(e.body.markdown, /Stage: contacted · Type: employer/);
  assert.equal(e.body.markdown.includes('@'), false);
  const t = await copyBundle(s, { businessId: B, type: 'target', id: T.fundrise });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  assert.match(t.body.markdown, /^# Fundrise — target \(partner\)\n/);
  assert.match(t.body.markdown, /Source: Seif weekly, Oct 12, 2026/);
  assert.match(t.body.markdown, /## Evidence\nrenter-investing platforms are worth approaching/);
  assert.match(t.body.markdown, /## Research notes\nPerson: Ana Example — CEO \(champion\)\n\(10\/12\) angle: reaches 400k renters/);
  assert.match(t.body.markdown, /## Open to-dos\n- Research Fundrise · Jack · due Oct 16, 2026/);
  assert.equal((await copyBundle(s, { businessId: B, type: 'partner', id: randomUUID() })).status, 404);
  assert.equal((await copyBundle(s, { businessId: B, type: 'sponsor', id: G.gallagher })).status, 400);
  assert.equal((await copyBundle(s, { businessId: B, type: 'partner', id: 'nope' })).status, 400);
  assert.equal((await copyBundle(s, { businessId: randomUUID(), type: 'partner', id: G.gallagher })).status, 404, 'workspace-bound');
});

test('hasPii: the route-level assertion catches emails and phone shapes but not dates', () => {
  assert.equal(hasPii('mail ana@example.com'), true);
  assert.equal(hasPii('call +1 (415) 555-0100'), true);
  assert.equal(hasPii('call 415-555-0100 today'), true);
  assert.equal(hasPii('due 2026-10-16 · Oct 12, 2026 · 12,000 lives · Tier 2'), false);
  assert.equal(hasPii('- Oct 12, 2026 · email · out'), false);
});
