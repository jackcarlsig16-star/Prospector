// node --test api/sales/intakeInsights.test.mjs  (react-scripts' Jest only runs src/)
// intake-insights-v1 Stage 2 (server) on SYNTHETIC notes - 0 real Claude calls: the model's reply is a made-up object.
// I1 parser (caps, evidence required, no address / phone), I2 registry + matcher ("Already tracked" / keep) and link
// matching ("Already recorded"), I3 / I4 accept writes with seen_count on repeats and the undo, the Dashboard reads, the
// status PATCH, and a Viewer refused on writes by the gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { toInsights, enrichInsights, parseInsights, writeInsights, listInsights, setInsightStatus, listChannelLinks, INSIGHT_RULES, INSIGHT_JSON, MAX_TRACK, MAX_LINKS } from './intakeInsights.js';
import { trackedMatch, TRACKED_FIELDS } from './trackedFields.js';
import { salesGate } from '../lib/requireAuth.js';

const B = randomUUID(), U = randomUUID(), NOTE = randomUUID();
const UPSIDE = randomUUID(), ACME = randomUUID(), PERSON = randomUUID();
const ctx = {
  partners: [{ id: UPSIDE, name: 'Upside', owner_team: null }],
  opportunities: [{ id: ACME, organization: 'Zz Acme Foods', owner_team: 'upside', co_owner_name: 'Brad', source_partner_id: UPSIDE, source_person: 'Brad', source_office: 'Chicago' }],
  targets: [], companies: [],
};
const reply = {
  track: [
    { what: 'Referring office on every Upside referral', why: 'Brad said the Chicago office sends most of them', where: 'referral', example: 'most of these come from Chicago', evidence: 'most of these come from Chicago' },
    { what: 'Which employers ask about pets in rentals', why: 'Two HR leads asked', where: 'company', example: 'asked if pets are covered', evidence: 'asked if pets are covered' },
    { what: 'Track deal size', why: 'good practice', where: 'deal', example: '', evidence: '' },
    { what: 'Email ann@zz-example.com every week', why: 'x', where: 'person', example: 'x', evidence: 'x' },
  ],
  optimize: [{ text: 'Two partners asked for the same one-pager this week; make it a shared asset', why: 'saves a day', evidence: 'both asked for the one-pager' }, { text: 'Call 312 555 0100 first', why: 'x', evidence: 'x' }],
  channel_links: [
    { from: { kind: 'partner', name: 'Upside' }, to: { kind: 'company', name: 'Zz Acme Foods' }, relation: 'referred', date: '2026-10-20', evidence: 'Upside sent us Acme' },
    { from: { kind: 'office', name: 'Upside Chicago office' }, to: { kind: 'person', name: 'Rita Example' }, relation: 'introduced', date: null, evidence: 'Chicago office introduced Rita' },
    { from: { kind: 'person', name: 'Brad' }, to: { kind: 'company', name: 'Zz Acme Foods' }, relation: 'owns', date: null, evidence: 'Brad owns Acme' },
    { from: { kind: 'company', name: 'Zz Acme Foods' }, to: { kind: 'company', name: 'zz acme foods' }, relation: 'other', date: null, evidence: 'self' },
    { from: { kind: 'partner', name: 'Upside' }, to: { kind: 'company', name: 'Zz Beta Co' }, relation: 'dances_with', date: '2099-01-01', evidence: 'Upside and Beta' },
  ],
};

test('I1 prompt: the three lists, their caps, "never generic CRM advice", stated-not-inferred links, and the reply keys', () => {
  assert.match(INSIGHT_RULES, /track - up to 5/);
  assert.match(INSIGHT_RULES, /never generic CRM advice/);
  assert.match(INSIGHT_RULES, /relationships the notes STATE \(never inferred\)/);
  assert.match(INSIGHT_JSON, /"track":\[\{"what"/);
  assert.match(INSIGHT_JSON, /"channel_links":\[\{"from":\{"kind":"","name":""\}/);
});

test('I1 parser: evidence required (generic advice dropped), addresses / phones dropped, caps, enums, self-links dropped, a future date cleared', () => {
  const out = toInsights(reply, { noteDate: '2026-10-28' });
  assert.deepEqual(out.track.map(t => t.what), ['Referring office on every Upside referral', 'Which employers ask about pets in rentals']);
  assert.deepEqual(out.optimize.map(o => o.text), ['Two partners asked for the same one-pager this week; make it a shared asset']);
  assert.equal(out.channel_links.length, 4, 'the self-link is dropped');
  assert.deepEqual(out.channel_links.map(l => [l.relation, l.date]), [['referred', '2026-10-20'], ['introduced', null], ['owns', null], ['other', null]]);
  assert.ok(!JSON.stringify(out).match(/@|555/));
  const many = toInsights({ track: Array.from({ length: 9 }, (_, i) => ({ what: `w${i}`, evidence: 'e' })), channel_links: Array.from({ length: 20 }, (_, i) => ({ from: { kind: 'person', name: `a${i}` }, to: { kind: 'company', name: `b${i}` }, relation: 'works_with', evidence: 'e' })) });
  assert.deepEqual([many.track.length, many.channel_links.length], [MAX_TRACK, MAX_LINKS]);
});

test('I2 registry: "Referring office on every Upside referral" is already tracked (Referring office, default Dismiss); a new one is Not tracked (default Keep)', () => {
  assert.equal(trackedMatch('Referring office on every Upside referral').id, 'source_office');
  assert.equal(trackedMatch('Headcount at each employer').id, 'employees');
  assert.equal(trackedMatch('Which employers ask about pets in rentals'), null);
  assert.ok(TRACKED_FIELDS.every(f => f.label && f.at && f.phrases.length));
  const e = enrichInsights(toInsights(reply, { noteDate: '2026-10-28' }), ctx, [{ type: 'sales_person', id: PERSON, name: 'Rita Example' }]);
  assert.deepEqual(e.track.map(t => [t.already_field, t.keep]), [['Referring office', false], [null, true]]);
  assert.deepEqual(e.optimize.map(o => o.keep), [true]);
});

test('I2 links: ends matched to Pipeline / people by name (an office stays a name); a referral / ownership the company already carries is "Already recorded"', () => {
  const e = enrichInsights(toInsights(reply, { noteDate: '2026-10-28' }), ctx, [{ type: 'sales_person', id: PERSON, name: 'Rita Example' }]);
  const [referred, introduced, owns, other] = e.channel_links;
  assert.deepEqual([referred.from.match.record_type, referred.from.match.record_id, referred.to.match.record_type, referred.to.match.record_id], ['partner', UPSIDE, 'employer', ACME]);
  assert.equal(referred.already_recorded, true, 'Acme already carries Upside as its source');
  assert.deepEqual([introduced.from.match, introduced.to.match.record_type, introduced.already_recorded], [null, 'sales_person', false]);
  assert.equal(owns.already_recorded, true, 'Brad is already the co-owner');
  assert.deepEqual([other.to.match, other.already_recorded], [null, false], 'an unknown company stays a name');
});

test('I3 accept body: kept items only, evidence still required, an address refused, record matches kept only when well-formed', () => {
  const kept = enrichInsights(toInsights(reply, { noteDate: '2026-10-28' }), ctx, []);
  const p = parseInsights({ insights: { track: [kept.track[1]], optimize: kept.optimize, channel_links: [kept.channel_links[0]] } });
  assert.deepEqual([p.track.length, p.optimize.length, p.channel_links.length], [1, 1, 1]);
  assert.deepEqual([p.channel_links[0].from_match, p.channel_links[0].to_match], [{ record_type: 'partner', record_id: UPSIDE }, { record_type: 'employer', record_id: ACME }]);
  assert.throws(() => parseInsights({ insights: { track: [{ what: 'call ann@zz-example.com', evidence: 'x' }] } }), /address/);
  assert.throws(() => parseInsights({ insights: { optimize: 'nope' } }), /must be a list/);
  assert.deepEqual(parseInsights({}), { track: [], optimize: [], channel_links: [] });
});

test('I4 writes: the same insight / link from a second note bumps seen_count + last_seen_at (one row), the undo puts every row back', async () => {
  const sb = fakeSupabase({ sales_insights: [], sales_channel_links: [] });
  const kept = enrichInsights(toInsights(reply, { noteDate: '2026-10-28' }), ctx, []);
  const insights = parseInsights({ insights: { track: [kept.track[1]], optimize: kept.optimize, channel_links: [kept.channel_links[0]] } });
  const first = await writeInsights(sb, { businessId: B, userId: U, noteId: NOTE, insights, undo: [], now: new Date('2026-10-28T12:00:00Z') });
  assert.deepEqual(first, { insights_added: 2, insights_seen: 0, links_added: 1, links_seen: 0 });
  const undo = [];
  const again = await writeInsights(sb, { businessId: B, userId: U, noteId: randomUUID(), insights, undo, now: new Date('2026-10-29T12:00:00Z') });
  assert.deepEqual(again, { insights_added: 0, insights_seen: 2, links_added: 0, links_seen: 1 });
  assert.deepEqual(sb.db.sales_insights.map(r => [r.kind, r.seen_count, r.last_seen_at]), [['track', 2, '2026-10-29T12:00:00.000Z'], ['optimize', 2, '2026-10-29T12:00:00.000Z']]);
  assert.deepEqual(sb.db.sales_channel_links.map(r => [r.from_record_type, r.to_record_id, r.relation, r.seen_count, r.link_date]), [['partner', ACME, 'referred', 2, '2026-10-20']]);
  for (const f of undo.reverse()) await f();
  assert.deepEqual(sb.db.sales_insights.map(r => [r.seen_count, r.last_seen_at]), [[1, '2026-10-28T12:00:00.000Z'], [1, '2026-10-28T12:00:00.000Z']], 'the undo restores the counts');
  assert.equal(sb.db.sales_channel_links[0].seen_count, 1);
  assert.ok(!JSON.stringify(sb.db).includes('@'));
});

test('Dashboard: live insights by kind with their note, the status PATCH (open -> planned, stale screen 409, bad status 400), channel links filtered by partner', async () => {
  const sb = fakeSupabase({ sales_insights: [], sales_channel_links: [], sales_call_notes: [{ id: NOTE, business_id: B, title: 'Upside check-in', call_date: '2026-10-28' }] });
  const kept = enrichInsights(toInsights(reply, { noteDate: '2026-10-28' }), ctx, []);
  await writeInsights(sb, { businessId: B, userId: U, noteId: NOTE, insights: parseInsights({ insights: { track: [kept.track[1]], optimize: kept.optimize, channel_links: kept.channel_links } }), undo: [] });
  const live = await listInsights(sb, { businessId: B, query: {} });
  assert.deepEqual([live.status, live.body.track.length, live.body.optimize.length, live.body.track[0].note], [200, 1, 1, { title: 'Upside check-in', call_date: '2026-10-28' }]);
  const id = live.body.track[0].id;
  assert.equal((await setInsightStatus(sb, { businessId: B, userId: U, id, body: { status: 'planned', expect: 'open' } })).body.insight.status, 'planned');
  assert.equal((await setInsightStatus(sb, { businessId: B, userId: U, id, body: { status: 'done', expect: 'open' } })).status, 409);
  assert.equal((await setInsightStatus(sb, { businessId: B, userId: U, id, body: { status: 'gone' } })).status, 400);
  assert.equal((await setInsightStatus(sb, { businessId: B, userId: U, id: randomUUID(), body: { status: 'done' } })).status, 404);
  assert.equal((await setInsightStatus(sb, { businessId: B, userId: U, id, body: { status: 'dismissed' } })).body.insight.status, 'dismissed');
  assert.equal((await listInsights(sb, { businessId: B, query: {} })).body.track.length, 0, 'dismissed leaves the live list (kept, never deleted)');
  assert.equal((await listInsights(sb, { businessId: B, query: { status: 'all' } })).body.track.length, 1);
  assert.equal((await listInsights(sb, { businessId: B, query: { status: 'nope' } })).status, 400);
  const links = await listChannelLinks(sb, { businessId: B, query: { partner: UPSIDE } });
  assert.deepEqual(links.body.links.map(l => l.relation).sort(), ['other', 'referred'], 'both links with Upside on an end');
  assert.equal((await listChannelLinks(sb, { businessId: B, query: {} })).body.links.length, 4);
  assert.equal((await listChannelLinks(sb, { businessId: B, query: { partner: 'x' } })).status, 400);
});

test('a Viewer passes the gate for the reads and is refused (403) on the status PATCH', () => {
  process.env.SALES_ANALYTICS_BUSINESS_IDS = B;
  const run = method => {
    const out = { code: 200, next: false };
    const res = { status(c) { out.code = c; return { json() {} }; } };
    salesGate({ method, params: { businessId: B }, auth: { isPlatformOwner: false, roles: new Map([[B, 'viewer']]) } }, res, () => { out.next = true; });
    return out;
  };
  assert.deepEqual(run('GET'), { code: 200, next: true });
  assert.deepEqual(run('PATCH'), { code: 403, next: false });
});
