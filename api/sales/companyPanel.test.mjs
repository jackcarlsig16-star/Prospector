// node --test api/sales/companyPanel.test.mjs  (react-scripts' Jest only runs src/)
// sales-ia-v2 Stage 3 (P4) - the company panel routes against the in-memory
// Supabase: the body for every row type, Add to pipeline from a visitor and
// an Apollo-only company, Add note / Add contact (L1: no email or phone),
// a target's step with the backward guard. 0 network, 0 Claude, 0 Apollo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { companyDetail, addToPipeline, addNote, addContact, updateTarget } from './companyPanel.js';

const B = randomUUID(), U = randomUUID(), U2 = randomUUID();
const ID = { partner: randomUUID(), employer: randomUUID(), target: randomUUID(), todo: randomUUID() };
const seed = () => fakeSupabase({
  business_members: [{ business_id: B, user_id: U, name: 'Jack Carlson' }, { business_id: B, user_id: U2, name: 'Cyrus Test' }],
  sales_goals: [{ id: ID.partner, business_id: B, goal_type: 'partnership', name: 'Gallagher', pipeline_status: 'replied', category: '4. Brokers', hot: true, owner_user_id: U, owner_team: 'upside', next_step: 'Send deck', channel: 'import', priority: 2, priority_set_by: U2, priority_set_at: '2026-10-20T10:00:00Z', notes: '(10/15) Terms: 20% rev share\nplain line' }],
  sales_opportunities: [{ id: ID.employer, business_id: B, organization: 'Solidcore', stage: 'contacted', org_type: 'employer', owner: 'Jack Carlson', owner_team: 'homelover', notes: 'old note', decision_makers: 'Pat Lee · VP People', champion: 'Sam', covered_lives: 1200, archived_at: null }],
  sales_targets: [{ id: ID.target, business_id: B, name: 'Zeta Labs', kind: 'employer', status: 'proposed', owner_team: null, evidence: 'Opened an office', research_notes: null, channel: 'scout' }],
  sales_sequenced_accounts: [{ business_id: B, account_id: 'acc-1', name: 'Fresh Co', first_sequenced_at: '2026-10-07T15:00:00Z', sequence_id: 'seq-1', employees: 400 }],
  web_visits: [
    { id: randomUUID(), business_id: B, company_key: 'acme widgets', company_name: 'Acme Widgets', domain: 'acme.example', pulled_on: '2026-10-20', last_visit: '2026-10-20', visits_7d: 6, top_paths: ['/pricing', '/employers'], priority: 'P1', priority_rule: 'US 500+', matched_type: null, matched_id: null },
    { id: randomUUID(), business_id: B, company_key: 'acme widgets', company_name: 'Acme Widgets', pulled_on: '2026-10-19', last_visit: '2026-10-19', visits_7d: 4, top_paths: [], priority: 'P2', matched_type: null, matched_id: null },
    { id: randomUUID(), business_id: B, company_key: 'gallagher', company_name: 'Gallagher', pulled_on: '2026-10-20', last_visit: '2026-10-20', visits_7d: 2, top_paths: ['/partners'], priority: 'P1', matched_type: 'partner', matched_id: ID.partner },
  ],
  sales_signals: [{ id: randomUUID(), business_id: B, source: 'scout', company_key: 'acme widgets', company_name: 'Acme Widgets', kind: 'employer', signal: 'Hiring 40 in Chicago', why_now: 'Growth', status: 'new', signal_week: '2026-10-19', created_at: '2026-10-19T00:00:00Z' }],
  sales_week_goals: [
    { id: ID.todo, business_id: B, kind: 'todo', status: 'open', text: 'Send Gallagher the deck', owner_user_id: U2, due_date: '2026-10-22', link_type: 'partner', link_id: ID.partner, week_start: '2026-10-19' },
    { id: randomUUID(), business_id: B, kind: 'waiting', status: 'open', text: 'Employer list', waiting_on: 'Dana', due_date: '2026-10-23', link_type: 'partner', link_id: ID.partner, week_start: '2026-10-19' },
    { id: randomUUID(), business_id: B, kind: 'todo', status: 'done', text: 'Intro call', completed_at: '2026-10-18T10:00:00Z', link_type: 'opportunity', link_id: ID.employer, week_start: '2026-10-12' },
  ],
  sales_partner_events: [
    { id: randomUUID(), business_id: B, goal_id: ID.partner, event: 'note', note: 'Decided: pilot in Q1', at: '2026-10-16T10:00:00Z', meta: { kind: 'decision' } },
    { id: randomUUID(), business_id: B, goal_id: ID.partner, event: 'touch', touch_type: 'call', contact_names: ['Pat'], at: '2026-10-17T10:00:00Z', meta: {} },
    { id: randomUUID(), business_id: B, goal_id: ID.partner, event: 'assign', at: '2026-10-18T10:00:00Z', meta: { to_owner: U } },
  ],
  sales_opportunity_events: [{ id: randomUUID(), business_id: B, opportunity_id: ID.employer, event_type: 'stage_change', from_stage: 'target', to_stage: 'contacted', changed_at: '2026-10-19T10:00:00Z' }],
  partner_contacts: [{ id: randomUUID(), business_id: B, goal_id: ID.partner, name: 'Pat Lee', title: 'VP', email: 'pat@example.com', linkedin_url: 'https://linkedin.com/in/pat', source: 'manual' }],
  partner_domains: [], research_runs: [], visit_priority_override: [],
}, { unique: { sales_targets: r => `${r.business_id}:${r.name.trim().toLowerCase()}`, sales_goals: r => (r.goal_type === 'partnership' ? `${r.business_id}:${r.name.toLowerCase()}` : null) } });

test('partner body: to-dos, waiting, matched visits, decisions, terms, people without emails, last notes/touches (no assign rows), research status', async () => {
  const sb = seed();
  const r = await companyDetail(sb, { businessId: B, type: 'partner', id: ID.partner });
  assert.equal(r.status, 200);
  const d = r.body;
  assert.equal(d.record.name, 'Gallagher'); assert.equal(d.record.stage, 'replied'); assert.equal(d.record.owner, 'Jack Carlson'); assert.equal(d.record.priority_set_by, 'Cyrus Test'); assert.equal(d.record.top, true);
  assert.equal('notes' in d.record, false);
  assert.deepEqual(d.todos.map(t => [t.text, t.owner, t.due_date]), [['Send Gallagher the deck', 'Cyrus Test', '2026-10-22']]);
  assert.deepEqual(d.waiting.map(w => [w.waiting_on, w.text]), [['Dana', 'Employer list']]);
  assert.deepEqual(d.visits.map(v => [v.last_visit, v.visits_7d, v.top_paths, v.priority]), [['2026-10-20', 2, ['/partners'], 'P1']]);
  assert.deepEqual(d.decisions.map(x => x.text), ['Decided: pilot in Q1']);
  assert.deepEqual(d.terms, ['(10/15) Terms: 20% rev share']);
  assert.deepEqual(d.people, [{ id: d.people[0].id, name: 'Pat Lee', title: 'VP', linkedin_url: 'https://linkedin.com/in/pat', source: 'manual' }]);
  assert.deepEqual(d.recent.map(e => e.event), ['touch', 'note']);
  assert.deepEqual(d.research, { runs: [], today: 0, cap: 5 });
  assert.equal(JSON.stringify(d).includes('@'), false);
});

test('employer body: stage history + done to-dos as recent, decision makers and champion as people, notes; target body: evidence, no research notes; apollo + visitor bodies', async () => {
  const sb = seed();
  const e = (await companyDetail(sb, { businessId: B, type: 'employer', id: ID.employer })).body;
  assert.deepEqual(e.recent.map(x => x.text), ['target → contacted', 'Done: Intro call']);
  assert.deepEqual(e.people.map(p => [p.name, p.title]), [['Sam', 'Champion'], ['Pat Lee · VP People', null]]);
  assert.equal(e.record.notes, 'old note'); assert.equal(e.record.covered_lives, 1200); assert.equal(e.record.owner, 'Jack Carlson');
  const t = (await companyDetail(sb, { businessId: B, type: 'target', id: ID.target })).body;
  assert.equal(t.record.evidence, 'Opened an office'); assert.equal(t.record.research_notes, null); assert.equal(t.record.stage, 'proposed'); assert.ok(t.research);
  const a = (await companyDetail(sb, { businessId: B, type: 'apollo', id: 'acc-1' })).body;
  assert.equal(a.record.name, 'Fresh Co'); assert.equal(a.record.employees, 400); assert.equal(a.research, null); assert.deepEqual(a.todos, []);
  const v = (await companyDetail(sb, { businessId: B, type: 'visitor', id: 'acme widgets' })).body;
  assert.equal(v.record.name, 'Acme Widgets'); assert.equal(v.record.channel, 'website_visit');
  assert.deepEqual(v.visits.map(x => [x.pulled_on, x.visits_7d]), [['2026-10-20', 6], ['2026-10-19', 4]]);
  assert.deepEqual(v.signals.map(s => [s.signal, s.why_now, s.status]), [['Hiring 40 in Chicago', 'Growth', 'new']]);
  assert.equal((await companyDetail(sb, { businessId: B, type: 'visitor', id: 'nobody' })).status, 404);
  assert.equal((await companyDetail(sb, { businessId: B, type: 'thing', id: 'x' })).status, 400);
  assert.equal((await companyDetail(sb, { businessId: B, type: 'partner', id: 'not-a-uuid' })).status, 400);
});

test('add to pipeline: a visitor becomes a target (channel website_visit, evidence from the visit, created_by) and its visits are matched; the same name again is "already"; an Apollo-only company becomes an employer carrying its account id', async () => {
  const sb = seed();
  const r = await addToPipeline(sb, { businessId: B, userId: U, body: { type: 'visitor', id: 'acme widgets' }, now: new Date('2026-10-20T20:00:00Z') });
  assert.equal(r.status, 201); assert.equal(r.body.created.type, 'target'); assert.equal(r.body.created.name, 'Acme Widgets');
  const t = sb.db.sales_targets.find(x => x.id === r.body.created.id);
  assert.equal(t.channel, 'website_visit'); assert.equal(t.status, 'researching'); assert.equal(t.kind, 'employer'); assert.equal(t.created_by, U);
  assert.match(t.evidence, /Visited the website: 6 visits in 7 days, last 2026-10-20 · \/pricing, \/employers/);
  assert.ok(sb.db.web_visits.filter(v => v.company_key === 'acme widgets').every(v => v.matched_type === 'target' && v.matched_id === t.id));
  const again = await addToPipeline(sb, { businessId: B, userId: U, body: { type: 'visitor', id: 'acme widgets', to: 'partner' } });
  assert.equal(again.status, 200); assert.deepEqual(again.body.already, { type: 'target', id: t.id, name: 'Acme Widgets' });
  const a = await addToPipeline(sb, { businessId: B, userId: U, body: { type: 'apollo', id: 'acc-1', to: 'employer' }, now: new Date('2026-10-20T20:00:00Z') });
  assert.equal(a.status, 201); assert.equal(a.body.created.type, 'employer');
  const o = sb.db.sales_opportunities.find(x => x.id === a.body.created.id);
  assert.equal(o.apollo_account_id, 'acc-1'); assert.equal(o.channel, 'apollo_outbound'); assert.equal(o.stage, 'target'); assert.match(o.notes, /^\(10\/20\) Sequenced in Apollo since 2026-10-07$/);
  const p = await addToPipeline(sb, { businessId: B, userId: U, body: { type: 'visitor', id: 'gallagher', to: 'partner' } });
  assert.equal(p.status, 200); assert.equal(p.body.already.type, 'partner');
  assert.equal((await addToPipeline(sb, { businessId: B, userId: U, body: { type: 'partner', id: ID.partner } })).status, 400);
  assert.equal((await addToPipeline(sb, { businessId: B, userId: U, body: { type: 'visitor', id: 'nobody' } })).status, 404);
});

test('add to pipeline as a partner: a sales_goals row at not_started with one note event holding the evidence', async () => {
  const sb = seed();
  sb.db.web_visits = sb.db.web_visits.filter(v => v.company_key !== 'gallagher');
  const r = await addToPipeline(sb, { businessId: B, userId: U, body: { type: 'visitor', id: 'acme widgets', to: 'partner' } });
  assert.equal(r.status, 201); assert.equal(r.body.created.type, 'partner');
  const g = sb.db.sales_goals.find(x => x.id === r.body.created.id);
  assert.equal(g.pipeline_status, 'not_started'); assert.equal(g.channel, 'website_visit'); assert.equal(g.goal_type, 'partnership');
  const ev = sb.db.sales_partner_events.filter(e => e.goal_id === g.id);
  assert.equal(ev.length, 1); assert.equal(ev[0].event, 'note'); assert.match(ev[0].note, /^Visited the website/); assert.equal(ev[0].meta.from_visit_key, 'acme widgets'); assert.equal(ev[0].by_user, U);
});

test('add note: a partner gets a note event; an employer a dated notes line; a target a dated research_notes line; empty / long / wrong type refused', async () => {
  const sb = seed();
  const now = new Date('2026-10-20T20:00:00Z');
  const p = await addNote(sb, { businessId: B, userId: U, type: 'partner', id: ID.partner, body: { note: ' Called, left voicemail ' }, now });
  assert.equal(p.status, 201); assert.ok(sb.db.sales_partner_events.find(e => e.id === p.body.event_id && e.note === 'Called, left voicemail'));
  const e = await addNote(sb, { businessId: B, userId: U, type: 'employer', id: ID.employer, body: { note: 'Met Pat at 555-123-4567' }, now });
  assert.equal(e.status, 201); assert.equal(sb.db.sales_opportunities[0].notes, 'old note\n(10/20) Met Pat at [number removed]');
  const t = await addNote(sb, { businessId: B, userId: U, type: 'target', id: ID.target, body: { note: 'Looks promising' }, now });
  assert.equal(t.status, 201); assert.equal(sb.db.sales_targets[0].research_notes, '(10/20) Looks promising');
  assert.equal((await addNote(sb, { businessId: B, userId: U, type: 'employer', id: ID.employer, body: { note: '   ' } })).status, 400);
  assert.equal((await addNote(sb, { businessId: B, userId: U, type: 'employer', id: ID.employer, body: { note: 'x'.repeat(2001) } })).status, 400);
  assert.equal((await addNote(sb, { businessId: B, userId: U, type: 'visitor', id: 'acme widgets', body: { note: 'x' } })).status, 400);
  assert.equal((await addNote(sb, { businessId: B, userId: U, type: 'employer', id: randomUUID(), body: { note: 'x' } })).status, 404);
});

test('add contact (L1): name, title, LinkedIn only - an email or phone field, or one inside the text, is 400; partner -> partner_contacts (manual); employer -> decision_makers line; target -> research_notes People line', async () => {
  const sb = seed();
  const bad = [
    await addContact(sb, { businessId: B, userId: U, type: 'partner', id: ID.partner, body: { name: 'Sam', email: 'sam@example.com' } }),
    await addContact(sb, { businessId: B, userId: U, type: 'partner', id: ID.partner, body: { name: 'Sam', phone: '555-1234' } }),
    await addContact(sb, { businessId: B, userId: U, type: 'partner', id: ID.partner, body: { name: 'Sam sam@example.com' } }),
    await addContact(sb, { businessId: B, userId: U, type: 'partner', id: ID.partner, body: { name: 'Sam', title: 'call 555-123-4567' } }),
    await addContact(sb, { businessId: B, userId: U, type: 'partner', id: ID.partner, body: { name: 'Sam', linkedin_url: 'https://example.com/sam' } }),
    await addContact(sb, { businessId: B, userId: U, type: 'partner', id: ID.partner, body: { title: 'VP' } }),
  ];
  assert.deepEqual(bad.map(r => r.status), [400, 400, 400, 400, 400, 400]);
  assert.equal(sb.db.partner_contacts.length, 1);
  const p = await addContact(sb, { businessId: B, userId: U, type: 'partner', id: ID.partner, body: { name: ' Sam  Rivera ', title: 'Head of Benefits', linkedin_url: 'https://www.linkedin.com/in/samr' } });
  assert.equal(p.status, 201); assert.deepEqual([p.body.person.name, p.body.person.title, p.body.person.source], ['Sam Rivera', 'Head of Benefits', 'manual']);
  const row = sb.db.partner_contacts.find(c => c.name === 'Sam Rivera');
  assert.equal(row.email, undefined); assert.equal(row.created_by, U);
  const e = await addContact(sb, { businessId: B, userId: U, type: 'employer', id: ID.employer, body: { name: 'Dana Q', title: 'CHRO' }, now: new Date('2026-10-20T20:00:00Z') });
  assert.equal(e.status, 201); assert.equal(sb.db.sales_opportunities[0].decision_makers, 'Pat Lee · VP People\nDana Q · CHRO');
  const t = await addContact(sb, { businessId: B, userId: U, type: 'target', id: ID.target, body: { name: 'Lee', linkedin_url: 'https://linkedin.com/in/lee' } });
  assert.equal(t.status, 201); assert.equal(sb.db.sales_targets[0].research_notes, 'People: Lee · https://linkedin.com/in/lee');
});

test('target step: proposed -> researching; back to proposed is 409 without allow_backward and 200 with it; owner_team changes; bad values 400; a stale status 409', async () => {
  const sb = seed();
  const fwd = await updateTarget(sb, { businessId: B, id: ID.target, body: { status: 'researching' } });
  assert.equal(fwd.status, 200); assert.equal(fwd.body.target.status, 'researching');
  const back = await updateTarget(sb, { businessId: B, id: ID.target, body: { status: 'proposed' } });
  assert.equal(back.status, 409); assert.equal(back.body.code, 'backward_stage');
  const ok = await updateTarget(sb, { businessId: B, id: ID.target, body: { status: 'proposed', allow_backward: true, owner_team: 'both' } });
  assert.equal(ok.status, 200); assert.equal(ok.body.target.status, 'proposed'); assert.equal(ok.body.target.owner_team, 'both');
  assert.equal((await updateTarget(sb, { businessId: B, id: ID.target, body: { owner_team: 'nope' } })).status, 400);
  assert.equal((await updateTarget(sb, { businessId: B, id: ID.target, body: { status: 'accepted' } })).status, 400);
  assert.equal((await updateTarget(sb, { businessId: B, id: ID.target, body: { name: 'x' } })).status, 400);
  sb.db.sales_targets[0].status = 'accepted';
  assert.equal((await updateTarget(sb, { businessId: B, id: ID.target, body: { status: 'researching' } })).status, 409);
});
