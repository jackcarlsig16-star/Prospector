// node --test api/sales/peopleActivityDetail.test.mjs
// people-v2 Stage 2 - the pinned detail (timeline from the person's own rows, the Huddle's automated flag, notes) and
// the People saved views (kind 'people' beside the Map's and the Explorer's). Invented people, no addresses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { timelineFor } from './personActivity.js';
import { personDetail, listPeopleViews, savePeopleView, deletePeopleView, cleanViewState } from './peopleActivityRoutes.js';

const B = '00000000-0000-4000-8000-0000000000b1';
const U = '00000000-0000-4000-8000-0000000000a1';
const at = (d, h = 0) => new Date(Date.parse('2026-11-01T12:00:00Z') + d * 864e5 + h * 3600e3).toISOString();
const msgs = [
  { business_id: B, apollo_message_id: 'm1', contact_id: 'A', sequence_id: 's', step: 1, delivered_at: at(0), replied: false, reply_class: null, replied_seen_at: null, replied_at: null, subject: 'Hello from HomeLover' },
  { business_id: B, apollo_message_id: 'm2', contact_id: 'A', sequence_id: 's', step: 2, delivered_at: at(2), replied: true, reply_class: 'follow_up_question', replied_seen_at: at(3), replied_at: null, subject: 'Re: Hello' },
];
const evs = [
  { id: 1, business_id: B, apollo_message_id: 'm1', contact_id: 'A', step: 1, event: 'open', occurred_at: new Date(Date.parse(at(0)) + 20e3).toISOString(), user_agent: 'Mozilla', tracking_service: null },
  { id: 2, business_id: B, apollo_message_id: 'm1', contact_id: 'A', step: null, event: 'click', occurred_at: at(1, 4), user_agent: 'Mozilla', tracking_service: null },
];

test('timelineFor: sent / open / click / reply rows newest first, steps filled from the message, the Huddle\'s automated flag, seen_at_sync for a reply with no exact time', () => {
  const t = timelineFor(msgs, evs);
  assert.deepEqual(t.map(x => `${x.kind}@${x.at.slice(0, 13)}${x.automated ? ' bot' : ''}`), ['reply@2026-11-04T12 ', 'sent@2026-11-03T12', 'click@2026-11-02T16', 'open@2026-11-01T12 bot', 'sent@2026-11-01T12'].map(s => s.trim()));
  assert.deepEqual([t[0].reply_class, t[0].seen_at_sync, t[0].step, t[2].step, t[1].subject], ['follow_up_question', true, 2, 1, 'Re: Hello']);
});

test('personDetail: a prospect reads its own rows + notes; a partner contact through its Apollo id; a visitor has an empty timeline and its note; a bad key 400, unknown 404; no address', async () => {
  const db = fakeSupabase({
    sales_prospect_state: [{ business_id: B, contact_id: 'A', notes: 'Met at the expo' }],
    partner_contacts: [{ id: 'pc1', business_id: B, apollo_contact_id: 'A', role_in_notes: 'Their broker lead' }, { id: 'pc2', business_id: B, apollo_contact_id: null, role_in_notes: null }],
    sales_people: [{ id: 'sp1', business_id: B, note: 'Identified visitor 2026-11-02' }],
    sales_email_messages: msgs, sales_email_activity: evs,
  });
  const p = await personDetail(db, B, { key: 'prospect:A' });
  assert.deepEqual([p.status, p.body.timeline.length, p.body.notes, p.body.key], [200, 5, 'Met at the expo', 'prospect:A']);
  const c = await personDetail(db, B, { key: 'contact:pc1' });
  assert.deepEqual([c.status, c.body.timeline.length, c.body.notes], [200, 5, 'Their broker lead']);
  const c2 = await personDetail(db, B, { key: 'contact:pc2' });
  assert.deepEqual([c2.status, c2.body.timeline.length], [200, 0]);
  const v = await personDetail(db, B, { key: 'person:sp1' });
  assert.deepEqual([v.status, v.body.timeline, v.body.notes], [200, [], 'Identified visitor 2026-11-02']);
  assert.equal((await personDetail(db, B, { key: 'nope' })).status, 400);
  assert.equal((await personDetail(db, B, { key: 'prospect:ZZ' })).status, 404);
  assert.ok(!/@/.test(JSON.stringify([p.body, c.body, v.body])));
});

test('People views: save (state cleaned to the known chips / selects / window), list only kind people, replace by name, delete; the Map\'s and Explorer\'s views untouched', async () => {
  const db = fakeSupabase({ sales_settings: [{ business_id: B, saved_views: [{ id: 'map1', name: 'Map view', filters: {} }, { id: 'ex1', kind: 'explorer', name: 'Sent', state: {} }] }] });
  const s = await savePeopleView(db, { businessId: B, userId: U, body: { name: ' Hot buyers ', state: { chips: ['hot', 'buyer', 'junk'], source: 'Apollo sequence', stage: 'contacted', owner: '', window: '30', q: 'acme', sizes: ['5k', 'junk', '5k', 'unknown'] } }, now: Date.parse('2026-11-06T18:00:00Z') });
  assert.equal(s.status, 201);
  assert.deepEqual(s.body.view.state, { chips: ['hot', 'buyer'], source: 'Apollo sequence', stage: 'contacted', owner: '', window: '30', q: 'acme', sizes: ['5k', 'unknown'] });
  assert.deepEqual([s.body.view.kind, s.body.view.name, s.body.view.created_by], ['people', 'Hot buyers', U]);
  const list = await listPeopleViews(db, B);
  assert.deepEqual(list.body.views.map(v => v.name), ['Hot buyers']);
  const all = db.db.sales_settings[0].saved_views;
  assert.deepEqual(all.map(v => v.kind || 'map'), ['map', 'explorer', 'people'], 'the other screens\' views stay');
  const again = await savePeopleView(db, { businessId: B, userId: U, body: { name: 'Hot buyers', state: { chips: ['replied'], window: 'nope' } } });
  assert.deepEqual([again.body.view.id, again.body.view.state.chips, again.body.view.state.window, again.body.views.length], [s.body.view.id, ['replied'], 'all', 1]);
  assert.equal((await savePeopleView(db, { businessId: B, userId: U, body: { name: '  ' } })).status, 400);
  assert.equal((await deletePeopleView(db, { businessId: B, id: 'map1' })).status, 404, 'cannot delete another screen\'s view through this route');
  const d = await deletePeopleView(db, { businessId: B, id: s.body.view.id });
  assert.deepEqual([d.status, d.body.views], [200, []]);
  assert.deepEqual(db.db.sales_settings[0].saved_views.map(v => v.id), ['map1', 'ex1']);
  assert.deepEqual(cleanViewState(undefined), { chips: [], source: '', stage: '', owner: '', window: 'all', q: '', sizes: [] });
});

// heat-size-v1 Stage 2 (Stage 1 choice 1): the pinned card's heat is computed live by summarizePerson over the person's
// rows + their company's latest visit row (the table's join) + their identification date; null with no signal at all.
test('personDetail.heat: a prospect at a visited employer carries the visit why line; a visitor identified today at a quiet company is Hot on their own date; no rows + no visit = null', async () => {
  const O = '00000000-0000-4000-8000-00000000e001', T = '00000000-0000-4000-8000-00000000e002';
  const today = new Date().toISOString().slice(0, 10);
  const db = fakeSupabase({
    sales_prospect_state: [{ business_id: B, contact_id: 'A', notes: null, opportunity_id: O, goal_id: null, company: 'Acme Health' }, { business_id: B, contact_id: 'Q', notes: null, opportunity_id: null, goal_id: null, company: 'Nowhere Inc' }],
    sales_opportunities: [{ id: O, business_id: B, organization: 'Acme Health' }],
    sales_targets: [{ id: T, business_id: B, name: 'Quarry Labs' }],
    sales_people: [{ id: 'sp1', business_id: B, note: null, company_type: 'target', target_id: T, source_kind: 'web_visit', created_at: new Date().toISOString() }, { id: 'sp2', business_id: B, note: 'by hand', company_type: 'target', target_id: T, source_kind: null, created_at: '2026-10-01T00:00:00Z' }],
    web_visits: [{ id: 'v1', business_id: B, company_key: 'acme health', matched_type: 'opportunity', matched_id: O, visits_7d: 3, unique_visitors_7d: 2, last_visit: today, seen_to: today, pulled_on: today }],
    sales_email_messages: msgs, sales_email_activity: evs,
  });
  const p = await personDetail(db, B, { key: 'prospect:A' });
  assert.equal(p.status, 200);
  assert.ok(p.body.heat.why.includes('Company on the site · 3 visits · 2 people (7 d) +14'), JSON.stringify(p.body.heat));
  assert.ok(p.body.heat.why[0].startsWith('Replied (follow up question) +100'), 'the email lines come first');
  assert.ok(['hot', 'warm'].includes(p.body.heat.band) && p.body.heat.score >= 114);
  const q = await personDetail(db, B, { key: 'prospect:Q' });
  assert.equal(q.body.heat, null, 'no rows, no visit: nothing to say');
  const v = await personDetail(db, B, { key: 'person:sp1' });
  assert.deepEqual([v.body.heat.score, v.body.heat.band, v.body.heat.why], [11, 'hot', ['Identified on the site 0 d ago +11']]);
  const h = await personDetail(db, B, { key: 'person:sp2' });
  assert.equal(h.body.heat, null, 'a hand-added person at a quiet company');
  assert.ok(!/@/.test(JSON.stringify([p.body, v.body])));
});
