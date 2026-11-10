// node --test api/sales/personActivity.test.mjs
// people-v2 Stage 1 - the per-person email summary: its score and band ARE the Huddle's (the same functions on the same
// rows), its human-open / scanner-click counts are huddle/live's, silent people get no row, the writer upserts and drops
// stale keys, a missing table reads as "migration pending". Invented people, no addresses anywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { summarizePerson, buildPersonActivity, writePersonActivity, isMigrationPending } from './personActivity.js';
import { scoreProspect, huddleSignals } from './heatScore.js';
import { buildLiveRows } from './huddleLive.js';
import { SCANNER_CLICK_WITHIN_SECONDS } from './nextBestAction.js';

const B = '00000000-0000-4000-8000-0000000000b1';
const NOW = Date.parse('2026-11-06T18:00:00Z');
const at = (d, h = 0) => new Date(Date.parse('2026-11-01T12:00:00Z') + d * 864e5 + h * 3600e3).toISOString();
const msg = (id, contact, extra = {}) => ({ business_id: B, apollo_message_id: id, contact_id: contact, sequence_id: 'seq1', step: 1, delivered_at: at(0), replied: false, reply_class: null, replied_seen_at: null, replied_at: null, ...extra });
const ev = (id, contact, mid, event, occurred_at, extra = {}) => ({ id, business_id: B, apollo_message_id: mid, contact_id: contact, step: 1, event, occurred_at, user_agent: 'Mozilla/5.0', tracking_service: null, ...extra });
// A: 2 sent, a reply (willing to meet), one scanner open (30 s), one human open, one scanner click (60 s), one human click.
const MESSAGES = [msg('m1', 'A'), msg('m2', 'A', { step: 2, delivered_at: at(2), replied: true, reply_class: 'willing_to_meet', replied_at: at(3) }), msg('m3', 'C', { delivered_at: at(1) })];
const EVENTS = [
  ev(1, 'A', 'm1', 'open', new Date(Date.parse(at(0)) + 30e3).toISOString()),
  ev(2, 'A', 'm1', 'open', at(1, 5)),
  ev(3, 'A', 'm1', 'click', new Date(Date.parse(at(0)) + 60e3).toISOString()),
  ev(4, 'A', 'm2', 'click', at(2, 6)),
  ev(5, 'C', 'm3', 'open', at(1, 2), { tracking_service: 'proofpoint' }),
];

test('summarizePerson: the counts = huddle/live\'s (human opens, scanner clicks out), the heat = scoreProspect, the band = huddleSignals, the dates', () => {
  const a = MESSAGES.filter(m => m.contact_id === 'A'), e = EVENTS.filter(x => x.contact_id === 'A');
  const s = summarizePerson(a, e, NOW);
  assert.deepEqual([s.sent, s.opened_h, s.bot_opens, s.clicked, s.replied, s.reply_class], [2, 1, 1, 1, 1, 'willing_to_meet']);
  assert.deepEqual([s.last_sent_at, s.last_open_at, s.last_click_at, s.last_reply_at], [at(2), at(1, 5), at(2, 6), at(3)]);
  const scored = scoreProspect(a, e, null, NOW);
  assert.equal(s.heat, scored.score);
  assert.equal(s.heat_band, huddleSignals(a, e, scored, NOW, SCANNER_CLICK_WITHIN_SECONDS).heat_band);
  assert.equal(s.last_signal_at, scored.last_signal_at);
  const live = buildLiveRows({ prospects: [{ contact_id: 'A', name: 'Zz Person', status: 'new' }], messages: a, events: e, flags: [], members: [], statusEvents: [], seqById: new Map(), oppById: new Map(), now: NOW })[0];
  assert.deepEqual([live.sent, live.real_opens, live.human_clicks, live.replied, live.bot_opens, live.scanner_clicks], [s.sent, s.opened_h, s.clicked, s.replied > 0, s.bot_opens, 1], 'huddle/live and the summary agree');
  // C: one tracking-service open only - a bot open, no human signal, cold.
  const c = summarizePerson(MESSAGES.filter(m => m.contact_id === 'C'), EVENTS.filter(x => x.contact_id === 'C'), NOW);
  assert.deepEqual([c.sent, c.opened_h, c.bot_opens, c.clicked, c.replied, c.heat, c.heat_band, c.last_open_at], [1, 0, 1, 0, 0, 0, 'cold', null]);
});

test('buildPersonActivity: a row per prospect with messages or events (silent B skipped), a partner contact by its Apollo contact id, keys and computed_at', () => {
  const rows = buildPersonActivity({ prospects: [{ contact_id: 'A' }, { contact_id: 'B' }, { contact_id: 'C' }], partnerContacts: [{ id: 'pc1', apollo_contact_id: 'C' }, { id: 'pc2', apollo_contact_id: null }, { id: 'pc3', apollo_contact_id: 'Z' }], messages: MESSAGES, events: EVENTS, now: NOW });
  assert.deepEqual(rows.map(r => [r.person_key, r.source_table, r.contact_id, r.sent]), [['prospect:A', 'sales_prospect_state', 'A', 2], ['prospect:C', 'sales_prospect_state', 'C', 1], ['contact:pc1', 'partner_contacts', 'C', 1]]);
  assert.equal(rows[0].computed_at, new Date(NOW).toISOString());
  assert.ok(!/@/.test(JSON.stringify(rows)));
});

// heat-size-v1 Stage 1: the company's latest visit row joins by matched record or by name; an identified visitor with no
// email rows gets a person: row (contact_id null) while the signal lasts; a silent person at a quiet company still has none.
test('buildPersonActivity: a visit row joins a prospect by matched record and a partner contact by name, an identified visitor gets a person: row, the heat is the Huddle-era number when no visit exists', () => {
  const O = '00000000-0000-4000-8000-00000000e001', G = '00000000-0000-4000-8000-00000000e003', T = '00000000-0000-4000-8000-00000000e002';
  const visits = [
    { id: 'v1', company_key: 'acme health', matched_type: 'opportunity', matched_id: O, visits_7d: 3, unique_visitors_7d: 2, last_visit: '2026-11-05', seen_to: '2026-11-06', pulled_on: '2026-11-06' },
    { id: 'v2', company_key: 'harbor lane', matched_type: null, matched_id: null, visits_7d: 1, unique_visitors_7d: 1, last_visit: '2026-11-04', seen_to: '2026-11-06', pulled_on: '2026-11-06' },
    { id: 'v3', company_key: 'quarry labs', matched_type: 'target', matched_id: T, visits_7d: 4, unique_visitors_7d: 9, last_visit: '2026-10-20', seen_to: '2026-10-21', pulled_on: '2026-10-21' },
  ];
  const rows = buildPersonActivity({
    prospects: [{ contact_id: 'A', opportunity_id: O }, { contact_id: 'B', opportunity_id: null, goal_id: null, company: 'Nowhere Inc' }, { contact_id: 'C' }],
    partnerContacts: [{ id: 'pc1', apollo_contact_id: 'C', goal_id: G }],
    salesPeople: [
      { id: 'sp1', company_type: 'target', target_id: T, source_kind: 'web_visit', created_at: at(4), archived_at: null },
      { id: 'sp2', company_type: 'target', target_id: T, source_kind: 'web_visit', created_at: '2026-10-01T12:00:00Z', archived_at: null },
      { id: 'sp3', company_type: 'employer', opportunity_id: O, source_kind: null, created_at: '2026-10-01T12:00:00Z', archived_at: null },
      { id: 'sp4', company_type: 'employer', opportunity_id: O, source_kind: 'web_visit', created_at: at(4), archived_at: '2026-11-05T00:00:00Z' },
    ],
    opportunities: [{ id: O, organization: 'Acme Health' }], targets: [{ id: T, name: 'Quarry Labs' }], partners: [{ id: G, name: 'Harbor Lane' }],
    messages: MESSAGES, events: EVENTS, visits, now: NOW,
  });
  const by = Object.fromEntries(rows.map(r => [r.person_key, r]));
  assert.deepEqual(Object.keys(by).sort(), ['contact:pc1', 'person:sp1', 'person:sp3', 'prospect:A', 'prospect:C'].sort(), 'B silent + no visit, sp2 identified 36 d ago at a quiet company, sp4 archived: no row');
  const plainA = summarizePerson(MESSAGES.filter(m => m.contact_id === 'A'), EVENTS.filter(x => x.contact_id === 'A'), NOW);
  assert.equal(by['prospect:A'].heat, plainA.heat + 8 + 3 * 2, 'A: Acme visited (matched record) - 3 visits · 2 people = +14');
  assert.equal(by['prospect:C'].heat, summarizePerson(MESSAGES.filter(m => m.contact_id === 'C'), EVENTS.filter(x => x.contact_id === 'C'), NOW).heat, 'C as a prospect names no company: the Huddle-era number');
  assert.deepEqual([by['contact:pc1'].heat, by['contact:pc1'].heat_band], [8 + 3, 'hot'], 'pc1 at Harbor Lane (joined by name, 1 visit · 1 person) with a message sent: Hot (H2)');
  assert.deepEqual([by['person:sp3'].contact_id, by['person:sp3'].source_table, by['person:sp3'].sent, by['person:sp3'].heat, by['person:sp3'].heat_band], [null, 'sales_people', 0, 14, 'warm'], 'a hand-added employee at a visited company: browse-only, Warm at most');
  assert.deepEqual([by['person:sp1'].heat, by['person:sp1'].heat_band], [8 + 3, 'hot'], 'sp1 identified Nov 5 (1 d ago) at a quiet company: one visit by one person on created_at, Hot (they are the visit)');
  assert.ok(rows.every(r => !('why' in r)), 'the stored row has no why column');
  assert.ok(!/@/.test(JSON.stringify(rows)));
});

test('writePersonActivity: upserts every row, drops keys with no activity left, a second run is idempotent; a missing table = pending (no throw)', async () => {
  const db = fakeSupabase({
    sales_prospect_state: [{ business_id: B, contact_id: 'A' }, { business_id: B, contact_id: 'B' }, { business_id: B, contact_id: 'C' }],
    partner_contacts: [{ id: 'pc1', business_id: B, apollo_contact_id: 'C' }],
    sales_email_messages: MESSAGES, sales_email_activity: EVENTS,
    sales_person_activity: [{ business_id: B, person_key: 'prospect:GONE', source_table: 'sales_prospect_state', contact_id: 'GONE', sent: 1 }, { business_id: '00000000-0000-4000-8000-0000000000b2', person_key: 'prospect:OTHER', source_table: 'sales_prospect_state', contact_id: 'OTHER', sent: 1 }],
  });
  const r = await writePersonActivity(db, B, { now: NOW });
  assert.deepEqual(r, { rows: 3, removed: 1 });
  const keys = db.db.sales_person_activity.map(x => `${x.business_id === B ? 'B' : 'other'}:${x.person_key}`).sort();
  assert.deepEqual(keys, ['B:contact:pc1', 'B:prospect:A', 'B:prospect:C', 'other:prospect:OTHER']);
  const a = db.db.sales_person_activity.find(x => x.person_key === 'prospect:A');
  assert.deepEqual([a.sent, a.opened_h, a.clicked, a.replied, a.heat_band], [2, 1, 1, 1, 'hot']);
  const again = await writePersonActivity(db, B, { now: NOW + 1000 });
  assert.deepEqual(again, { rows: 3, removed: 0 });
  assert.equal(db.db.sales_person_activity.filter(x => x.business_id === B).length, 3);
  // Pending: the table is not there yet.
  const pendingDb = fakeSupabase({ sales_prospect_state: [{ business_id: B, contact_id: 'A' }], partner_contacts: [], sales_email_messages: MESSAGES, sales_email_activity: EVENTS });
  const base = pendingDb.from.bind(pendingDb);
  pendingDb.from = t => (t === 'sales_person_activity' ? { select: () => ({ eq: () => ({ order: () => ({ range: async () => ({ data: null, error: { code: '42P01', message: 'relation "public.sales_person_activity" does not exist' } }) }) }) }) } : base(t));
  const p = await writePersonActivity(pendingDb, B, { now: NOW });
  assert.deepEqual(p, { pending: true, rows: 1, removed: 0 });
  assert.ok(isMigrationPending({ code: '42P01' }) && !isMigrationPending({ code: '23505', message: 'duplicate' }));
});
