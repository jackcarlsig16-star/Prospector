// node --test api/sales/companyPanel.test.mjs  (react-scripts' Jest only runs src/)
// sales-ia-v2 Stage 3 (P4) - the company panel routes against the in-memory
// Supabase: the body for every row type, Add to pipeline from a visitor and
// an Apollo-only company, Add note / Add contact (L1: no email or phone),
// a target's step with the backward guard. 0 network, 0 Claude, 0 Apollo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { companyDetail, addToPipeline, addNote, addContact, updateTarget, bookMeeting, markContacted, notNow, notNowPatch, createTarget } from './companyPanel.js';

const NOW = new Date('2026-10-20T20:00:00Z'); // Tue Oct 20, 1pm LA

const B = randomUUID(), U = randomUUID(), U2 = randomUUID();
const ID = { partner: randomUUID(), employer: randomUUID(), target: randomUUID(), todo: randomUUID(), click: randomUUID(), reply: randomUUID(), open2: randomUUID() };
const seed = () => fakeSupabase({
  business_members: [{ business_id: B, user_id: U, name: 'Jack Carlson' }, { business_id: B, user_id: U2, name: 'Cyrus Test' }],
  sales_goals: [{ id: ID.partner, business_id: B, goal_type: 'partnership', name: 'Gallagher', pipeline_status: 'replied', category: '4. Brokers', hot: true, owner_user_id: U, owner_team: 'upside', next_step: 'Send deck', next_meeting_at: '2026-11-02', channel: 'import', priority: 2, priority_set_by: U2, priority_set_at: '2026-10-20T10:00:00Z', notes: '(10/15) Terms: 20% rev share\nplain line' }],
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
  partner_contacts: [{ id: randomUUID(), business_id: B, goal_id: ID.partner, name: 'Pat Lee', title: 'VP', email: null, linkedin_url: 'https://linkedin.com/in/pat', source: 'manual' }],
  partner_domains: [{ id: randomUUID(), business_id: B, goal_id: ID.partner, domain: 'gallagher.example', confirmed: true, is_primary: true }], research_runs: [], visit_priority_override: [],
  // company-panel-v2: linked people (D1) and their email rows. No email or phone columns anywhere in this seed.
  sales_prospect_state: [
    { business_id: B, contact_id: 'c-pat', name: 'Pat Lee', title: 'VP Partnerships', company: 'Gallagher', linkedin_url: null, status: 'new', owner: 'jack', goal_id: ID.partner, goal_link_via: 'name', opportunity_id: null, opportunity_link_via: null, snooze_until: null },
    { business_id: B, contact_id: 'c-bot', name: 'Robin Scanner', title: 'IT', company: 'Gallagher', linkedin_url: null, status: 'new', owner: 'cyrus', goal_id: ID.partner, goal_link_via: 'name', opportunity_id: null, opportunity_link_via: null, snooze_until: null },
    { business_id: B, contact_id: 'c-dana', name: 'Dana Q', title: 'CHRO', company: 'Solidcore', linkedin_url: 'https://linkedin.com/in/danaq', status: 'contacted', owner: 'jack', goal_id: null, goal_link_via: null, opportunity_id: ID.employer, opportunity_link_via: 'name', snooze_until: null },
    { business_id: B, contact_id: 'c-fresh', name: 'Fran Fresh', title: 'Benefits Lead', company: 'Fresh Co', linkedin_url: null, status: 'new', owner: 'unassigned', goal_id: null, goal_link_via: null, opportunity_id: null, opportunity_link_via: null, snooze_until: null },
  ],
  sales_email_messages: [
    { business_id: B, apollo_message_id: 'm-pat', contact_id: 'c-pat', step: 1, delivered_at: '2026-10-15T10:00:00Z', replied: false },
    { business_id: B, apollo_message_id: 'm-bot', contact_id: 'c-bot', step: 1, delivered_at: '2026-10-15T10:00:00Z', replied: false },
    { business_id: B, apollo_message_id: 'm-dana', contact_id: 'c-dana', step: 2, delivered_at: '2026-10-16T10:00:00Z', replied: true, replied_at: '2026-10-18T09:00:00Z', reply_class: 'willing_to_meet' },
    { business_id: B, apollo_message_id: 'm-fresh', contact_id: 'c-fresh', step: 1, delivered_at: '2026-10-17T10:00:00Z', replied: false },
  ],
  sales_email_activity: [
    { id: ID.click, business_id: B, apollo_message_id: 'm-pat', contact_id: 'c-pat', step: 1, event: 'click', occurred_at: '2026-10-19T12:00:00Z', user_agent: null, tracking_service: null },
    { id: randomUUID(), business_id: B, apollo_message_id: 'm-pat', contact_id: 'c-pat', step: 1, event: 'open', occurred_at: '2026-10-19T11:00:00Z', user_agent: null, tracking_service: null },
    { id: randomUUID(), business_id: B, apollo_message_id: 'm-bot', contact_id: 'c-bot', step: 1, event: 'open', occurred_at: '2026-10-15T10:00:20Z', user_agent: null, tracking_service: null },
    { id: randomUUID(), business_id: B, apollo_message_id: 'm-bot', contact_id: 'c-bot', step: 1, event: 'open', occurred_at: '2026-10-16T10:00:00Z', user_agent: null, tracking_service: 'proofpoint' },
    { id: randomUUID(), business_id: B, apollo_message_id: 'm-bot', contact_id: 'c-bot', step: 1, event: 'click', occurred_at: '2026-10-15T10:00:40Z', user_agent: null, tracking_service: null },
    { id: ID.reply, business_id: B, apollo_message_id: 'm-dana', contact_id: 'c-dana', step: 2, event: 'reply', occurred_at: '2026-10-18T09:00:00Z', user_agent: null, tracking_service: null },
    { id: randomUUID(), business_id: B, apollo_message_id: 'm-fresh', contact_id: 'c-fresh', step: 1, event: 'open', occurred_at: '2026-10-18T15:00:00Z', user_agent: null, tracking_service: null },
    { id: ID.open2, business_id: B, apollo_message_id: 'm-fresh', contact_id: 'c-fresh', step: 1, event: 'open', occurred_at: '2026-10-19T15:00:00Z', user_agent: null, tracking_service: null },
  ],
  sales_suggestions: [], sales_week_report: [],
  // lead-upload-v1: people filed from a lead list. "Dana Q" is already linked above, so only Kit Vale is new.
  sales_people: [
    { id: randomUUID(), business_id: B, company_type: 'employer', opportunity_id: ID.employer, target_id: null, name: 'Kit Vale', title: 'VP Total Rewards', linkedin_url: 'https://www.linkedin.com/in/kitvale', note: 'Recently changed roles', source_kind: 'apollo' },
    { id: randomUUID(), business_id: B, company_type: 'employer', opportunity_id: ID.employer, target_id: null, name: 'dana q', title: 'CHRO', linkedin_url: null, note: null, source_kind: 'apollo' },
    { id: randomUUID(), business_id: B, company_type: 'target', opportunity_id: null, target_id: ID.target, name: 'Mo Reyes', title: 'HR Director', linkedin_url: null, note: 'Hiring signal', source_kind: 'event' },
  ],
}, { unique: { sales_targets: r => `${r.business_id}:${r.name.trim().toLowerCase()}`, sales_goals: r => (r.goal_type === 'partnership' ? `${r.business_id}:${r.name.toLowerCase()}` : null) } });

test('partner body: to-dos, waiting, matched visits, decisions, terms, people without emails, last notes/touches (no assign rows), research status', async () => {
  const sb = seed();
  const r = await companyDetail(sb, { businessId: B, type: 'partner', id: ID.partner, now: NOW });
  // company-workflow-v1 W1: the guided steps ride on the detail, one next.
  assert.deepEqual(r.body.steps.steps.map(x => x.id), ['research', 'site', 'size', 'owner', 'add', 'touch']);
  assert.equal(r.body.steps.steps.filter(x => x.status === 'next').length <= 1, true);
  assert.equal(r.status, 200);
  const d = r.body;
  assert.equal(d.record.name, 'Gallagher'); assert.equal(d.record.stage, 'replied'); assert.equal(d.record.owner, 'Jack Carlson'); assert.equal(d.record.priority_set_by, 'Cyrus Test'); assert.equal(d.record.top, true);
  assert.equal('notes' in d.record, false);
  assert.deepEqual(d.todos.map(t => [t.text, t.owner, t.due_date]), [['Send Gallagher the deck', 'Cyrus Test', '2026-10-22']]);
  assert.deepEqual(d.waiting.map(w => [w.waiting_on, w.text]), [['Dana', 'Employer list']]);
  assert.deepEqual(d.visits.map(v => [v.last_visit, v.visits_7d, v.top_paths, v.priority]), [['2026-10-20', 2, ['/partners'], 'P1']]);
  assert.deepEqual(d.decisions.map(x => x.text), ['Decided: pilot in Q1']);
  assert.deepEqual(d.terms, ['(10/15) Terms: 20% rev share']);
  // D4: the manual contact and the linked prospect of the same name are one row (contact id, prospect's contact_id + signal); the bot-only person follows.
  assert.deepEqual(d.people.map(p => [p.name, p.title, p.linkedin_url, p.source, p.contact_id, p.signal?.text ?? null]), [['Pat Lee', 'VP', 'https://linkedin.com/in/pat', 'manual', 'c-pat', 'clicked Step 1'], ['Robin Scanner', 'IT', null, 'apollo', 'c-bot', null]]);
  assert.deepEqual(d.recent.map(e => e.event), ['touch', 'note']);
  assert.equal(d.record.last_touch, null);
  assert.deepEqual(d.record.site, { domain: 'gallagher.example', confirmed: true });
  assert.deepEqual(d.research, { runs: [], today: 0, cap: 5 });
  assert.equal(JSON.stringify(d).includes('@'), false);
});

test('employer body: stage history + done to-dos as recent, decision makers and champion as people, notes; target body: evidence, no research notes; apollo + visitor bodies', async () => {
  const sb = seed();
  const e = (await companyDetail(sb, { businessId: B, type: 'employer', id: ID.employer, now: NOW })).body;
  assert.deepEqual(e.recent.map(x => x.text), ['target → contacted', 'Done: Intro call']);
  assert.deepEqual(e.people.map(p => [p.name, p.title, p.signal?.text ?? null]), [['Dana Q', 'CHRO', 'replied Step 2'], ['Kit Vale', 'VP Total Rewards', null], ['Sam', 'Champion', null]]);
  // lead-upload-v1: the uploaded person carries the upload's source and the list's why line; the duplicate (by name) is not repeated.
  assert.deepEqual(e.people.filter(p => p.source === 'upload').map(p => [p.name, p.source_kind, p.note, p.linkedin_url]), [['Kit Vale', 'apollo', 'Recently changed roles', 'https://www.linkedin.com/in/kitvale']]);
  assert.deepEqual(e.decision_makers, ['Pat Lee · VP People']);
  assert.deepEqual(e.record.last_touch, { at: '2026-10-19T10:00:00Z', touch_type: 'stage' });
  // FIX loop-quickfixes Q4: a later archived / created event is not contact.
  sb.db.sales_opportunity_events.push({ id: randomUUID(), business_id: B, opportunity_id: ID.employer, event_type: 'archived', from_stage: 'contacted', to_stage: 'contacted', changed_at: '2026-10-20T10:00:00Z' });
  assert.deepEqual((await companyDetail(sb, { businessId: B, type: 'employer', id: ID.employer, now: NOW })).body.record.last_touch, { at: '2026-10-19T10:00:00Z', touch_type: 'stage' });
  sb.db.sales_opportunity_events.pop();
  assert.equal(e.record.notes, 'old note'); assert.equal(e.record.covered_lives, 1200); assert.equal(e.record.owner, 'Jack Carlson');
  sb.db.sales_targets[0].research_notes = '(10/19) Looks good\nPeople: Lee Park · Head of HR\nPerson: Ana Ruiz';
  const t = (await companyDetail(sb, { businessId: B, type: 'target', id: ID.target })).body;
  assert.equal(t.record.evidence, 'Opened an office'); assert.equal(t.record.stage, 'proposed'); assert.ok(t.research);
  assert.deepEqual(t.people.map(p => [p.name, p.source]), [['Lee Park · Head of HR', 'notes'], ['Ana Ruiz', 'notes'], ['Mo Reyes', 'upload']]);
  const a = (await companyDetail(sb, { businessId: B, type: 'apollo', id: 'acc-1', now: NOW })).body;
  assert.equal(a.record.name, 'Fresh Co'); assert.equal(a.record.employees, 400); assert.equal(a.research, null); assert.deepEqual(a.todos, []);
  // Apollo-only: people whose company is the account's name, matched at read time (nothing stored); 2 human opens = a signal.
  assert.deepEqual(a.people.map(p => [p.name, p.signal.text]), [['Fran Fresh', 'opened ×2 Step 1']]);
  assert.equal(a.interest.strongest.kind, 'opens'); assert.equal(a.interest.show, true);
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
  assert.equal(ev[0].event, 'note'); assert.match(ev[0].note, /^Visited the website/); assert.equal(ev[0].meta.from_visit_key, 'acme widgets'); assert.equal(ev[0].by_user, U);
  // company-workflow-v1 W3: no pick = the caller owns it, through the Assign signal (FIX-7).
  assert.deepEqual(ev.map(e => e.event), ['note', 'assign']);
  assert.equal(g.owner_user_id, U);
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
  assert.equal(t.status, 201); assert.equal(sb.db.sales_targets[0].research_notes, 'People: Lee · https://www.linkedin.com/in/lee');
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

// company-panel-v2 Stage 2 - the Interest band, the merged timeline, and the band's buttons.
test('interest: strongest first (reply > click > 2+ human opens > visits), bot opens and scanner clicks excluded; the timeline merges email events, visits and signals newest first; nothing carries an email', async () => {
  const sb = seed();
  const p = (await companyDetail(sb, { businessId: B, type: 'partner', id: ID.partner, now: NOW })).body;
  assert.deepEqual(p.interest.items.map(i => [i.kind, i.person?.name ?? null, i.text]), [['click', 'Pat Lee', 'Pat Lee clicked Step 1'], ['visit', null, '2 site visits this week · /partners']]);
  assert.equal(p.interest.newest_id, p.visits[0].id); assert.equal(p.interest.show, true); assert.equal(p.interest.dismissed, false);
  assert.deepEqual(p.timeline.map(x => [x.kind, x.at.slice(0, 10), x.text]), [
    ['visited', '2026-10-20', 'Visited · 2 in 7 days · /partners'],
    ['clicked', '2026-10-19', 'Pat Lee clicked Step 1'],
    ['opened', '2026-10-19', 'Pat Lee opened Step 1'],
  ]);
  const e = (await companyDetail(sb, { businessId: B, type: 'employer', id: ID.employer, now: NOW })).body;
  assert.deepEqual(e.interest.items.map(i => [i.kind, i.person.name, i.count]), [['reply', 'Dana Q', 1]]);
  assert.equal(e.interest.strongest.id, ID.reply);
  const v = (await companyDetail(sb, { businessId: B, type: 'visitor', id: 'acme widgets', now: NOW })).body;
  assert.deepEqual(v.interest.items.map(i => i.kind), ['visit']);
  assert.deepEqual(v.timeline.map(x => x.kind), ['visited', 'visited', 'signal']);
  for (const body of [p, e, v]) assert.equal(JSON.stringify(body).includes('@'), false);
  // 15 days on, the click is outside the window: no band.
  const later = (await companyDetail(sb, { businessId: B, type: 'partner', id: ID.partner, now: new Date('2026-11-05T20:00:00Z') })).body;
  assert.equal(later.interest.show, false); assert.deepEqual(later.interest.items, []);
});

test('book meeting: partner next_step set, next_meeting_at untouched, one open to-do due today on the record; employer next_action + date; before values for Undo; a person with an email is refused', async () => {
  const sb = seed();
  const r = await bookMeeting(sb, { businessId: B, userId: U, type: 'partner', id: ID.partner, body: { person: 'Pat Lee' }, now: NOW });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const g = sb.db.sales_goals.find(x => x.id === ID.partner);
  assert.equal(g.next_step, 'Book meeting with Pat Lee'); assert.equal(g.next_meeting_at, '2026-11-02');
  assert.deepEqual(r.body.before, { next_step: 'Send deck' });
  assert.deepEqual([r.body.todo.text, r.body.todo.status, r.body.todo.due_date, r.body.todo.week_start, r.body.todo.link_type, r.body.todo.link_id, r.body.todo.owner_user_id], ['Book meeting with Pat Lee', 'open', '2026-10-20', '2026-10-19', 'partner', ID.partner, U]);
  const e = await bookMeeting(sb, { businessId: B, userId: U, type: 'employer', id: ID.employer, body: {}, now: NOW });
  assert.equal(e.status, 201);
  const o = sb.db.sales_opportunities.find(x => x.id === ID.employer);
  assert.equal(o.next_action, 'Book meeting with Solidcore'); assert.equal(o.next_action_date, '2026-10-20');
  assert.deepEqual(e.body.before, { next_action: null, next_action_date: null });
  assert.equal(e.body.todo.link_type, 'opportunity');
  assert.equal((await bookMeeting(sb, { businessId: B, userId: U, type: 'partner', id: ID.partner, body: { person: 'pat@example.com' }, now: NOW })).status, 400);
  assert.equal((await bookMeeting(sb, { businessId: B, userId: U, type: 'visitor', id: 'acme widgets', body: {}, now: NOW })).status, 400);
});

test('mark contacted: partner = a touch with move_to none (stage stays, last touch moves, event names the person); the person goes to contacted; employer / target = ONE done to-do that becomes Last touch - never an opportunity event row', async () => {
  const sb = seed();
  const r = await markContacted(sb, { businessId: B, userId: U, byUser: 'tester', type: 'partner', id: ID.partner, body: { contact_id: 'c-pat' }, now: NOW });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const g = sb.db.sales_goals.find(x => x.id === ID.partner);
  assert.equal(g.pipeline_status, 'replied'); assert.equal(g.last_touch_at, NOW.toISOString());
  const ev = sb.db.sales_partner_events.find(x => x.id === r.body.event.id);
  assert.deepEqual([ev.event, ev.touch_type, ev.to_status, ev.contact_names], ['touch', 'email', null, ['Pat Lee']]);
  assert.deepEqual(sb.db.sales_prospect_state.find(x => x.contact_id === 'c-pat').status, 'contacted');
  assert.deepEqual(r.body.person, { contact_id: 'c-pat', before: { status: 'new' } });
  // A not-started partner: 'auto' would move it to first_email_sent; the panel's touch does not.
  const fresh = sb.db.sales_goals.find(x => x.id === ID.partner); fresh.pipeline_status = 'not_started';
  const r2 = await markContacted(sb, { businessId: B, userId: U, type: 'partner', id: ID.partner, body: { touch_type: 'call' }, now: NOW });
  assert.equal(r2.status, 200); assert.equal(fresh.pipeline_status, 'not_started');
  const eventsBefore = sb.db.sales_opportunity_events.length;
  const e = await markContacted(sb, { businessId: B, userId: U, type: 'employer', id: ID.employer, body: { person: 'Dana Q' }, now: NOW });
  assert.equal(e.status, 200, JSON.stringify(e.body));
  assert.deepEqual([e.body.todo.text, e.body.todo.status, e.body.todo.completed_at, e.body.todo.link_type, e.body.todo.link_id], ['Contacted Dana Q', 'done', NOW.toISOString(), 'opportunity', ID.employer]);
  assert.equal(sb.db.sales_opportunity_events.length, eventsBefore);
  const d = (await companyDetail(sb, { businessId: B, type: 'employer', id: ID.employer, now: NOW })).body;
  assert.deepEqual(d.record.last_touch, { at: NOW.toISOString(), touch_type: 'done' }); assert.equal(d.record.last_touch_at, NOW.toISOString());
  assert.equal(d.recent[0].text, 'Done: Contacted Dana Q');
  const t = await markContacted(sb, { businessId: B, userId: U, type: 'target', id: ID.target, body: {}, now: NOW });
  assert.equal(t.status, 200); assert.equal(t.body.todo.text, 'Contacted Zeta Labs'); assert.equal(t.body.todo.link_type, 'target');
  assert.equal((await markContacted(sb, { businessId: B, userId: U, type: 'partner', id: ID.partner, body: { touch_type: 'fax' }, now: NOW })).status, 400);
  assert.equal((await markContacted(sb, { businessId: B, userId: U, type: 'partner', id: ID.partner, body: { contact_id: 'nobody' }, now: NOW })).status, 404);
});

test('not now: a person is snoozed a week (today + 7); the company parks the band on its newest signal until a newer one arrives; no store for a visitor', async () => {
  const sb = seed();
  assert.deepEqual(notNowPatch('2026-10-20'), { status: 'not_now', snooze_until: '2026-10-27' });
  const p = await notNow(sb, { businessId: B, userId: U, byUser: 'tester', type: 'partner', id: ID.partner, body: { contact_id: 'c-pat' }, now: NOW });
  assert.equal(p.status, 200); assert.deepEqual(p.body.person, { contact_id: 'c-pat', status: 'not_now', snooze_until: '2026-10-27', before: { status: 'new', snooze_until: null } });
  assert.equal(sb.db.sales_prospect_state.find(x => x.contact_id === 'c-pat').snooze_until, '2026-10-27');
  const c = await notNow(sb, { businessId: B, userId: U, type: 'employer', id: ID.employer, body: {}, now: NOW });
  assert.equal(c.status, 200, JSON.stringify(c.body)); assert.equal(c.body.dismissed.signal_id, ID.reply);
  const row = sb.db.sales_suggestions[0];
  assert.deepEqual([row.kind, row.ref_type, row.ref_id, row.ref_id2, row.status, row.decided_by, row.text], ['interest_follow_up', 'opportunity', ID.employer, ID.reply, 'dismissed', U, 'Not now: Dana Q replied Step 2']);
  const hidden = (await companyDetail(sb, { businessId: B, type: 'employer', id: ID.employer, now: NOW })).body.interest;
  assert.equal(hidden.dismissed, true); assert.equal(hidden.show, false); assert.equal(hidden.items.length, 1);
  // A newer signal (a click the next day) brings the band back.
  sb.db.sales_email_activity.push({ id: randomUUID(), business_id: B, apollo_message_id: 'm-dana', contact_id: 'c-dana', step: 2, event: 'click', occurred_at: '2026-10-21T09:00:00Z', user_agent: null, tracking_service: null });
  const back = (await companyDetail(sb, { businessId: B, type: 'employer', id: ID.employer, now: new Date('2026-10-21T20:00:00Z') })).body.interest;
  assert.equal(back.show, true); assert.equal(back.dismissed, false); assert.equal(back.strongest.kind, 'reply');
  assert.equal((await notNow(sb, { businessId: B, userId: U, type: 'visitor', id: 'acme widgets', body: {}, now: NOW })).status, 400);
  assert.equal((await notNow(sb, { businessId: B, userId: U, type: 'target', id: ID.target, body: {}, now: NOW })).status, 400);
});

// company-workflow-v1 W3 - Add to pipeline takes an owner person: a Member pick wins, a stranger is refused.
test('add to pipeline with owner_user_id: an employer gets the person (and the owner text in step); a non-member pick is 400', async () => {
  const sb = seed();
  sb.db.web_visits = sb.db.web_visits.filter(v => v.company_key !== 'gallagher');
  const bad = await addToPipeline(sb, { businessId: B, userId: U, body: { type: 'visitor', id: 'acme widgets', to: 'employer', owner_user_id: randomUUID() } });
  assert.equal(bad.status, 400);
  const r = await addToPipeline(sb, { businessId: B, userId: U, body: { type: 'visitor', id: 'acme widgets', to: 'employer', owner_user_id: U2 } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const o = sb.db.sales_opportunities.find(x => x.id === r.body.created.id);
  assert.deepEqual([o.owner_user_id, o.owner], [U2, 'Cyrus']);
});

// FIX pipeline-quick-fixes-v1 A - POST goals/targets: a target by name with its kind, channel manual; a live match is "already".
test('createTarget: name + kind -> a researching target (channel manual, evidence dated); the same name again answers already; bad kind / no name / an address in the name -> 400', async () => {
  const sb = seed();
  const r = await createTarget(sb, { businessId: B, userId: U, body: { name: 'Zz Fresh Target', kind: 'partner', domain: 'zzfresh.example' }, now: new Date('2026-10-27T18:00:00Z') });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const t = sb.db.sales_targets.find(x => x.name === 'Zz Fresh Target');
  assert.deepEqual([r.body.created.type, t.kind, t.status, t.channel, t.evidence, t.created_by], ['target', 'partner', 'researching', 'manual', 'Added from Pipeline 2026-10-27', U]);
  const again = await createTarget(sb, { businessId: B, userId: U, body: { name: 'zz fresh target', kind: 'employer' } });
  assert.deepEqual([again.status, again.body.already.id], [200, t.id]);
  assert.equal((await createTarget(sb, { businessId: B, userId: U, body: { name: 'X', kind: 'visitor' } })).status, 400);
  assert.equal((await createTarget(sb, { businessId: B, userId: U, body: { kind: 'employer' } })).status, 400);
  assert.equal((await createTarget(sb, { businessId: B, userId: U, body: { name: 'mail me at x@zz.example', kind: 'employer' } })).status, 400);
});

test('FIX linkedin-url-normalize: the company window saves a link typed without https as one clean link; a non-LinkedIn link is 400 in plain words', async () => {
  const sb = seed();
  const p = await addContact(sb, { businessId: B, userId: U, type: 'partner', id: ID.partner, body: { name: 'Zz Test Person', title: 'VP', linkedin_url: 'linkedin.com/in/zz-test-handle/' } });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  assert.equal(sb.db.partner_contacts.find(c => c.name === 'Zz Test Person').linkedin_url, 'https://www.linkedin.com/in/zz-test-handle');
  const bad = await addContact(sb, { businessId: B, userId: U, type: 'partner', id: ID.partner, body: { name: 'Zz Other', linkedin_url: 'linkedin.com.evil.com/in/x' } });
  assert.deepEqual([bad.status, bad.body.error], [400, "That doesn't look like a LinkedIn link — paste it like linkedin.com/in/name."]);
});
