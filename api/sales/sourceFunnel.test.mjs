// node --test api/sales/sourceFunnel.test.mjs  (react-scripts' Jest only runs src/)
// brad-attribution-v1 Stage 1 - the per-company funnel (F1 with the Stage 0 rulings), the grouped table with "n of m"
// rates, since-yesterday, the journey line, and GET goals/sources/funnel over the one gather on the in-memory Supabase.
// Invented companies on .example; message rows carry contact ids only; the reply never joins to an address. 0 network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { funnelOf, indexDated, funnelGroups, funnelTotals, sinceYesterday, journeyLine, rate, REFERRAL_KINDS, NEGATIVE_REPLY, ALL_STAGES } from './sourceFunnel.js';
import { sourcesFunnel } from './sourceRoutes.js';

const B = randomUUID(), JACK = randomUUID(), UPSIDE = randomUUID();
const ID = { adp: randomUUID(), hilton: randomUUID(), harbor: randomUUID(), lender: randomUUID(), web: randomUUID(), lost: randomUUID(), tgt: randomUUID() };
const co = (type, id, name, over = {}) => ({ type, id, name, stage: 'target', source_kind: 'partner_referral', source_partner_id: UPSIDE, source_person: 'Brad', source_set_by: null, source_set_at: '2026-10-26T20:00:00Z', created_at: '2026-10-15T17:00:00Z', owner_team: 'upside', ...over });
const dated = () => ({
  visits: [{ company_name: 'Zz ADP', matched_type: 'opportunity', matched_id: ID.adp, seen_from: '2026-10-13', pulled_on: '2026-10-20' }, { company_name: 'Zz ADP', matched_type: null, matched_id: null, seen_from: '2026-10-25', pulled_on: '2026-10-25' }, { company_name: 'Zz Hilton', matched_type: null, matched_id: null, seen_from: null, pulled_on: '2026-10-24' }],
  prospects: [{ contact_id: 'c1', opportunity_id: ID.adp, goal_id: null }, { contact_id: 'c2', opportunity_id: ID.hilton, goal_id: null }],
  messages: [{ contact_id: 'c1', replied: true, replied_at: '2026-10-27T15:00:00Z', delivered_at: '2026-10-26T15:00:00Z', reply_class: 'willing_to_meet' }, { contact_id: 'c2', replied: true, replied_at: '2026-10-27T15:00:00Z', delivered_at: null, reply_class: 'already_left_company_or_not_right_person' }],
  partnerEvents: [{ goal_id: ID.harbor, event: 'status', to_status: 'replied', at: '2026-10-20T18:00:00Z' }, { goal_id: ID.harbor, event: 'status', to_status: 'proposal_pilot', at: '2026-10-24T18:00:00Z' }, { goal_id: ID.harbor, event: 'touch', touch_type: 'meeting', at: '2026-10-22T18:00:00Z' }, { goal_id: ID.harbor, event: 'status', to_status: 'live', at: '2026-10-27T18:00:00Z' }],
  oppEvents: [{ opportunity_id: ID.lost, event_type: 'created', from_stage: null, to_stage: 'on_hold', changed_at: '2026-10-15T17:00:00Z' }, { opportunity_id: ID.adp, event_type: 'stage_change', from_stage: 'contacted', to_stage: 'meeting', changed_at: '2026-10-28T03:00:00Z' }],
  doneTodos: [{ link_type: 'partner', link_id: ID.lender, text: 'Prep the meeting deck', completed_at: '2026-10-21T18:00:00Z' }],
  marks: [{ record_type: 'partner', record_id: ID.lender, stage: 'meeting', at: '2026-10-19' }],
  signals: [{ source: 'inbound', status: 'accepted', decided_at: '2026-10-26T18:00:00Z', target_id: ID.tgt }],
  targets: [{ id: ID.tgt, status: 'researching', decided_at: null }],
  partnerNames: new Map([[UPSIDE, 'Upside']]),
});

test('funnelOf: Referred only for partner / person referral (backfilled -> created_at, user-set -> source_set_at); visited = earliest visit by match then name; replied = a positive email reply via the contact\'s company, a partner status, an inbound signal; meeting / pilot / lost from partner status, employer events incl. the created stage, a meeting touch / to-do, a hand mark; everything an LA day; a later stage without an earlier one is legal', () => {
  const idx = indexDated(dated());
  const adp = funnelOf(co('employer', ID.adp, 'Zz ADP'), idx);
  assert.deepEqual([adp.referred, adp.visited, adp.replied, adp.meeting, adp.pilot, adp.lost], ['2026-10-15', '2026-10-13', '2026-10-27', '2026-10-27', null, null], 'the stage change at 03:00 UTC Oct 28 is Oct 27 in LA');
  assert.deepEqual(adp.src, { referred: 'created_at (backfilled source)', visited: 'web_visits (matched)', replied: 'email reply', meeting: 'stage change meeting' });
  const userSet = funnelOf(co('employer', ID.adp, 'Zz ADP', { source_set_by: JACK }), idx);
  assert.deepEqual([userSet.referred, userSet.src.referred], ['2026-10-26', 'source_set_at']);
  const hilton = funnelOf(co('employer', ID.hilton, 'Zz Hilton', { source_kind: 'website' }), idx);
  assert.deepEqual([hilton.referred, hilton.visited, hilton.replied], [null, '2026-10-24', null], 'a website-sourced company has no Referred date; a negative reply class does not count');
  const harbor = funnelOf(co('partner', ID.harbor, 'Zz Harbor Lane', { source_kind: 'person_referral' }), idx);
  assert.deepEqual([harbor.replied, harbor.meeting, harbor.pilot, harbor.src.meeting], ['2026-10-20', '2026-10-22', '2026-10-27', 'partner touch (meeting)']);
  const lender = funnelOf(co('partner', ID.lender, 'Zz Lender', { source_kind: 'unknown' }), idx);
  assert.deepEqual([lender.referred, lender.meeting, lender.src.meeting], [null, '2026-10-19', 'marked by hand'], 'a hand mark earlier than the to-do wins; met without a logged visit or reply is legal');
  const lost = funnelOf(co('employer', ID.lost, 'Zz Parked Co'), idx);
  assert.deepEqual([lost.referred, lost.lost, lost.src.lost], ['2026-10-15', '2026-10-15', 'created at stage on_hold'], 'an employer imported at a parked stage dates Lost from its created event');
  const tgt = funnelOf(co('target', ID.tgt, 'Zz Inbound Co', { source_kind: 'inbound' }), idx);
  assert.deepEqual([tgt.referred, tgt.replied, tgt.src.replied], [null, '2026-10-26', 'inbound signal accepted']);
  assert.deepEqual(REFERRAL_KINDS, ['partner_referral', 'person_referral']);
  assert.ok(NEGATIVE_REPLY.has('already_left_company_or_not_right_person'));
  assert.deepEqual(ALL_STAGES, ['referred', 'visited', 'replied', 'meeting', 'pilot', 'lost']);
});

test('groups + totals: cumulative counts per stage, "n of m" with a percentage only from 10, sorted by Referred; by rep / partner / source kind; since yesterday counts today\'s stage dates; the journey line', () => {
  const idx = indexDated(dated());
  const rows = [co('employer', ID.adp, 'Zz ADP'), co('employer', ID.hilton, 'Zz Hilton'), co('partner', ID.harbor, 'Zz Harbor Lane', { source_kind: 'person_referral', source_person: 'Ann', source_partner_id: null }), co('employer', ID.lost, 'Zz Parked Co'), co('employer', ID.web, 'Zz Web Co', { source_kind: 'website', source_person: null, source_partner_id: null })].map(c => ({ ...c, funnel: funnelOf(c, idx) }));
  const t = funnelTotals(rows);
  assert.deepEqual([t.companies, t.referred, t.visited, t.replied, t.meeting, t.pilot, t.lost], [5, 4, 2, 2, 2, 1, 1]);
  assert.deepEqual(t.conversion.visited_of_referred, { n: 2, m: 4, pct: null });
  assert.deepEqual(rate(7, 10), { n: 7, m: 10, pct: 70 });
  const byRep = funnelGroups(rows, 'rep', { partnerNames: new Map([[UPSIDE, 'Upside']]) });
  assert.deepEqual(byRep.map(g => [g.label, g.partner, g.referred, g.visited, g.replied, g.meeting, g.pilot, g.lost, g.companies]), [['Brad · Upside', 'Upside', 3, 2, 1, 1, 0, 1, 3], ['Ann', null, 1, 0, 1, 1, 1, 0, 1]]);
  assert.deepEqual(funnelGroups(rows, 'partner', { partnerNames: new Map([[UPSIDE, 'Upside']]) }).map(g => [g.label, g.referred]), [['Upside', 3]]);
  assert.deepEqual(funnelGroups(rows, 'source').map(g => [g.key, g.companies]).sort(), [['partner_referral', 3], ['person_referral', 1], ['website', 1]].sort());
  assert.deepEqual(sinceYesterday(rows, '2026-10-27'), { referred: 0, visited: 0, replied: 1, meeting: 1, pilot: 1, lost: 0 });
  assert.equal(journeyLine(rows[0].funnel, { referredBy: 'Brad (Upside)' }), 'Referred by Brad (Upside) Oct 15 → Visited Oct 13 → Replied Oct 27 → Meeting Oct 27 → Pilot —');
  assert.equal(journeyLine(rows[3].funnel), 'Referred Oct 15 → Visited — → Replied — → Meeting — → Pilot — → Lost Oct 15');
});

test('GET goals/sources/funnel: one gather, companies with dates + journey + band, filters days / team / partner / rep / source, bad filters 400, no address in the reply', async () => {
  const base = { business_id: B, source_kind: 'partner_referral', source_partner_id: UPSIDE, source_person: 'Brad', source_set_by: null, source_set_at: '2026-10-26T20:00:00Z', created_at: '2026-10-15T17:00:00Z', owner_team: 'upside' };
  const sb = fakeSupabase({
    sales_goals: [{ id: UPSIDE, business_id: B, goal_type: 'partnership', name: 'Upside', archived_at: null, pipeline_status: 'live', source_kind: null, created_at: '2026-10-01T00:00:00Z' }, { id: ID.harbor, ...base, goal_type: 'partnership', name: 'Zz Harbor Lane', archived_at: null, pipeline_status: 'meeting_set', source_kind: 'person_referral', source_person: 'Ann', source_partner_id: null, owner_team: 'homelover' }],
    sales_opportunities: [{ id: ID.adp, ...base, organization: 'Zz ADP', stage: 'meeting', archived_at: null }, { id: ID.web, ...base, organization: 'Zz Web Co', stage: 'contacted', archived_at: null, source_kind: 'website', source_person: null, source_partner_id: null, owner_team: null, created_at: '2026-10-27T17:00:00Z' }],
    sales_targets: [], web_visits: [{ business_id: B, company_key: 'zz adp', company_name: 'Zz ADP', matched_type: 'opportunity', matched_id: ID.adp, seen_from: '2026-10-13', pulled_on: '2026-10-20', priority: 'P1' }],
    sales_visit_skip: [], research_runs: [], sales_people: [], sales_settings: [], sales_prospect_state: [{ business_id: B, contact_id: 'c1', opportunity_id: ID.adp, goal_id: null, company: 'Zz ADP' }],
    sales_email_messages: [{ business_id: B, contact_id: 'c1', apollo_message_id: 'm1', replied: true, replied_at: '2026-10-27T15:00:00Z', delivered_at: '2026-10-26T15:00:00Z', reply_class: 'willing_to_meet', num_opens: 1, num_clicks: 0 }],
    sales_email_activity: [], sales_partner_events: [{ business_id: B, goal_id: ID.harbor, event: 'status', to_status: 'meeting_set', at: '2026-10-22T18:00:00Z', touch_type: null, source: null, by_user: JACK }],
    sales_opportunity_events: [{ business_id: B, opportunity_id: ID.adp, event_type: 'stage_change', from_stage: 'contacted', to_stage: 'meeting', changed_at: '2026-10-24T18:00:00Z' }],
    sales_week_goals: [], visit_priority_override: [], business_members: [{ business_id: B, user_id: JACK, name: 'Jack Carlson' }], sales_signals: [],
  });
  const r = await sourcesFunnel(sb, { businessId: B, query: {}, now: Date.parse('2026-10-27T20:00:00Z') });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.today, '2026-10-27');
  assert.deepEqual([r.body.totals.companies, r.body.totals.referred, r.body.totals.visited, r.body.totals.replied, r.body.totals.meeting], [4, 2, 1, 1, 2]);
  const adp = r.body.companies.find(c => c.name === 'Zz ADP');
  assert.deepEqual([adp.type, adp.band, adp.source_label, adp.partner, adp.referred, adp.visited, adp.replied, adp.meeting, adp.upside], ['employer', 'yellow', 'Partner referral', 'Upside', '2026-10-15', '2026-10-13', '2026-10-27', '2026-10-24', true]);
  assert.equal(adp.journey, 'Referred by Brad (Upside) Oct 15 → Visited Oct 13 → Replied Oct 27 → Meeting Oct 24 → Pilot —');
  assert.deepEqual(r.body.by_rep.map(g => [g.label, g.referred, g.meeting]).sort(), [['Ann', 1, 1], ['Brad · Upside', 1, 1]]);
  assert.deepEqual(r.body.since_yesterday.replied, 1);
  assert.deepEqual(r.body.by_source_kind.map(g => g.label).sort(), ['Not set yet', 'Partner referral', 'Person referral', 'Website'], 'the Upside partner itself has no source');
  assert.deepEqual([adp.keys, adp.score_band, adp.score], [{ rep: `${UPSIDE}|Brad`, partner: UPSIDE, source: 'partner_referral' }, null, null]);
  assert.deepEqual((await sourcesFunnel(sb, { businessId: B, query: { rep: 'brad' } })).body.companies.map(c => c.name), ['Zz ADP']);
  assert.deepEqual((await sourcesFunnel(sb, { businessId: B, query: { source: 'website' } })).body.companies.map(c => c.name), ['Zz Web Co']);
  assert.deepEqual((await sourcesFunnel(sb, { businessId: B, query: { partner: UPSIDE } })).body.companies.map(c => c.name), ['Zz ADP']);
  assert.deepEqual((await sourcesFunnel(sb, { businessId: B, query: { team: 'homelover' } })).body.companies.map(c => c.name), ['Zz Harbor Lane']);
  assert.deepEqual((await sourcesFunnel(sb, { businessId: B, query: { days: 2 }, now: Date.parse('2026-10-28T12:00:00Z') })).body.companies.map(c => c.name), ['Zz Web Co']);
  for (const q of [{ days: 'x' }, { team: 'nobody' }, { partner: 'not-a-uuid' }, { source: 'carrier_pigeon' }]) assert.equal((await sourcesFunnel(sb, { businessId: B, query: q })).status, 400, JSON.stringify(q));
  assert.ok(!JSON.stringify(r.body).includes('@'), 'no address');
});
