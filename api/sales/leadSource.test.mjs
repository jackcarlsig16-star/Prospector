// node --test api/sales/leadSource.test.mjs  (react-scripts' Jest only runs src/)
// lead-source-v1 Stage 2 - the D5 mapping (2026-10-22 rulings), manual-wins, promote inherits, one event per write,
// the backfill preview / apply, the report and the partner export (structured fields only, never an address or free
// text). In-memory Supabase; made-up companies; 0 network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { sourceDirectory, mapSheetSource, mapChannel, sheetLines, validateSource, cleanReferral, referralSource, isOpen } from './leadSource.js';
import { backfillPreview, backfillApply, editSource, getSource, referredBy, sourcesReport, sourcesExport } from './sourceRoutes.js';
import { promoteTarget } from './targetsRoutes.js';
import { insertCompanyRecord } from './companyPanel.js';

const B = randomUUID(), JACK = randomUUID();
const P = { upside: randomUUID(), hub: randomUUID(), kestrel: randomUUID() };
const NOW = new Date('2026-10-22T18:00:00Z');
const block = (id, lines) => `Older note\n\n— master sheet ${id} —\n${lines.join('\n')}`;
const partner = (id, name, extra = {}) => ({ id, business_id: B, goal_type: 'partnership', name, pipeline_status: 'not_started', archived_at: null, owner_team: null, co_owner_name: null, channel: 'manual', created_at: '2026-10-06T00:00:00Z', ...extra });
const opp = (name, extra = {}) => ({ id: randomUUID(), business_id: B, organization: name, org_type: 'employer', stage: 'contacted', archived_at: null, owner: 'Jack', owner_team: 'upside', co_owner_name: 'Brad Cillian', channel: 'import', covered_lives: 1000, created_at: '2026-10-15T00:00:00Z', ...extra });

function seed() {
  return fakeSupabase({
    business_members: [{ business_id: B, user_id: JACK, name: 'Jack Example', role: 'owner' }],
    sales_goals: [
      partner(P.upside, 'Upside', { owner_team: 'both' }),
      partner(P.hub, 'HUB International'),
      partner(P.kestrel, 'Kestrel Advisors', { notes: block('HLU-0001', ['Route in: HomeLover existing outreach', 'Source: HomeLover']) }),
    ],
    sales_opportunities: [
      opp('Brightmill Foods', { notes: block('HLU-0101', ['Route in: Brad already emailed', 'Source: Upside (Brad)']) }),
      opp('Cove Logistics', { notes: block('HLU-0102', ["Route in: Via broker: HUB International", 'Broker on account: HUB International', 'Source: Upside (Brad)']) }),
      opp('Dale Schools', { notes: block('HLU-0103', ['Route in: Call pat@dale.example first', 'Source: Upside (Brad)']) }),
      opp('Elm Health', { notes: block('HLU-0104', ['Source: Some Fair']), owner_team: 'homelover', co_owner_name: null }),
      opp('Fir Manual', { notes: block('HLU-0105', ['Source: Upside (Brad)']), source_kind: 'person_referral', source_person: 'Seif Example', source_set_by: JACK, source_set_at: '2026-10-20T00:00:00Z' }),
      opp('Glen Web', { channel: 'website_visit', notes: null }),
    ],
    sales_targets: [], sales_source_events: [], sales_outreach_campaigns: [], sales_partner_events: [], sales_week_goals: [], research_runs: [], web_visits: [], partner_domains: [], sales_sequenced_accounts: [], sales_call_notes: [],
  }, { now: () => NOW.getTime() });
}
const opps = s => Object.fromEntries(s.db.sales_opportunities.map(o => [o.organization, o]));

test('D5 mapping (rulings): Upside (Brad) -> Upside + the rep\'s full name; HomeLover; route_in kept; unknown; brokers; channel', () => {
  const dir = sourceDirectory([{ id: P.upside, name: 'Upside' }, { id: P.hub, name: 'HUB International' }], [{ owner_team: 'upside', co_owner_name: 'Brad Cillian' }]);
  const up = mapSheetSource({ source: 'Upside (Brad)', route_in: "Brad's admin contact" }, dir);
  assert.deepEqual(up.source, { source_kind: 'partner_referral', source_partner_id: P.upside, source_person: 'Brad Cillian', route_in: "Brad's admin contact" });
  assert.equal(up.key, 'Source: Upside (Brad)');
  assert.equal(mapSheetSource({ source: 'HomeLover', route_in: 'HomeLover existing outreach' }, dir).source.source_kind, 'homelover_outreach');
  assert.deepEqual([mapSheetSource({ source: 'Brad' }, dir).source.source_kind, mapSheetSource({ source: 'Brad' }, dir).source.source_partner_id], ['partner_referral', P.upside]);
  assert.equal(mapSheetSource({ source: 'Some Fair' }, dir).source.source_kind, 'unknown');
  const broker = mapSheetSource({ source: '', broker: 'HUB International', route_in: 'Via broker: HUB International' }, dir);
  assert.deepEqual([broker.key, broker.source.source_partner_id, broker.source.route_in], ['Broker on account: HUB International', P.hub, 'Via broker: HUB International']);
  assert.equal(mapSheetSource({ source: 'Upside (Brad)', route_in: 'call pat@x.example' }, dir).source.route_in, 'call [email removed]', 'an address never lands in route_in');
  assert.equal(mapSheetSource({ source: 'brad@upside.example' }, dir).value, '(withheld)');
  assert.deepEqual(['website_visit', 'scout', 'apollo_outbound', 'call_note'].map(c => mapChannel(c).source.source_kind), ['website', 'scout', 'homelover_outreach', 'unknown']);
  assert.deepEqual(sheetLines(block('X', ['Segment: a', 'Source: HomeLover', 'Route in: Y', '', 'Source: later'])), { source: 'HomeLover', route_in: 'Y' });
  assert.equal(sheetLines('no block here'), null);
});

test('validate: kinds, ids, lengths, no address or phone; referral proposals resolve the partner', () => {
  assert.match(validateSource({ source_kind: 'friend' }).error, /source_kind must be one of/);
  assert.match(validateSource({ source_kind: 'event', source_person: 'call 415-555-0100' }).error, /email address or phone/);
  assert.match(validateSource({ source_kind: 'event', source_partner_id: 'nope' }).error, /must be an id/);
  assert.match(validateSource({ source_kind: 'event', colour: 'x' }).error, /unknown field/);
  assert.deepEqual(validateSource({ source_kind: 'event', source_office: '  Chicago ' }).source.source_office, 'Chicago');
  const parts = [{ id: P.upside, name: 'Upside' }];
  assert.deepEqual(cleanReferral({ partner: 'upside', person: 'Brad', office: 'Chicago' }, parts), { partner: 'Upside', partner_id: P.upside, person: 'Brad', office: 'Chicago' });
  assert.equal(cleanReferral({ partner: null, person: null }, parts), null);
  assert.deepEqual(referralSource(cleanReferral({ person: 'Seif' }, parts)), { source_kind: 'person_referral', source_person: 'Seif', source_office: null });
  assert.match(referralSource(cleanReferral({ partner: 'Lockton' }, parts)).source_note, /Lockton \(not in Pipeline yet\)/);
  assert.equal(isOpen({ source_kind: 'unknown', source_set_by: null }), true);
  assert.equal(isOpen({ source_kind: 'unknown', source_set_by: JACK }), false);
});

test('backfill: preview groups by value with counts; apply writes only confirmed groups, one event each, never a manual source; re-run writes 0', async () => {
  const s = seed();
  const pre = await backfillPreview(s, { businessId: B });
  assert.equal(pre.status, 200, JSON.stringify(pre.body));
  const g = Object.fromEntries(pre.body.groups.map(x => [x.key, x]));
  assert.deepEqual([g['Source: Upside (Brad)'].count, g['Source: Upside (Brad)'].proposed], [3, { source_kind: 'partner_referral', source_partner_id: P.upside, partner_name: 'Upside', source_person: 'Brad Cillian' }]);
  assert.equal(g['Source: HomeLover'].count, 1);
  assert.equal(g['Source: Some Fair'].proposed.source_kind, 'unknown');
  assert.equal(g['Channel: website_visit'].proposed.source_kind, 'website');
  assert.equal(pre.body.kept, 1, 'the manual one is kept out');
  assert.ok(!JSON.stringify(pre.body).includes('@'));
  const mappings = { 'Source: Upside (Brad)': g['Source: Upside (Brad)'].proposed, 'Source: HomeLover': { source_kind: 'homelover_outreach' } };
  const r = await backfillApply(s, { businessId: B, userId: JACK, body: { mappings }, now: NOW });
  assert.deepEqual(r.body, { written: 4, skipped: 0, groups: 2 });
  const o = opps(s);
  assert.deepEqual([o['Brightmill Foods'].source_kind, o['Brightmill Foods'].source_partner_id, o['Brightmill Foods'].source_person, o['Brightmill Foods'].route_in, o['Brightmill Foods'].source_set_by], ['partner_referral', P.upside, 'Brad Cillian', 'Brad already emailed', null]);
  assert.equal(o['Cove Logistics'].route_in, 'Via broker: HUB International', 'brokers stay in route_in');
  assert.equal(o['Dale Schools'].route_in, 'Call [email removed] first', 'an address in Route in is scrubbed out');
  assert.deepEqual([o['Fir Manual'].source_kind, o['Fir Manual'].source_person], ['person_referral', 'Seif Example'], 'manual wins');
  assert.equal(o['Elm Health'].source_kind, undefined, 'an unconfirmed group is not written');
  assert.equal(s.db.sales_goals.find(p => p.id === P.kestrel).source_kind, 'homelover_outreach');
  assert.equal(s.db.sales_source_events.filter(e => e.reason === 'backfill').length, 4);
  assert.ok(s.db.sales_source_events.every(e => e.from_source === null));
  const again = await backfillApply(s, { businessId: B, userId: JACK, body: { mappings: { 'Source: Some Fair': { source_kind: 'unknown' } } }, now: NOW });
  assert.equal(again.body.written, 1);
  assert.equal((await backfillApply(s, { businessId: B, userId: JACK, body: { mappings }, now: NOW })).status, 409, 'groups already written are gone from the preview');
  assert.equal((await backfillApply(s, { businessId: B, userId: JACK, body: { mappings: { 'Channel: website_visit': { source_kind: 'friend' } } } })).status, 400);
});

test('edit: a person\'s pick, logged with from / to, stale screen refused; the backfill then leaves it alone', async () => {
  const s = seed();
  const elm = opps(s)['Elm Health'];
  const r = await editSource(s, { businessId: B, type: 'employer', id: elm.id, userId: JACK, body: { source_kind: 'partner_referral', source_partner_id: P.hub, source_person: 'Pat Rep', source_office: 'Chicago', expect_set_at: null }, now: NOW });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.source.partner_name, r.body.source.manual], ['HUB International', true]);
  assert.equal((await editSource(s, { businessId: B, type: 'employer', id: elm.id, userId: JACK, body: { source_kind: 'event', expect_set_at: null } })).status, 409);
  assert.equal((await editSource(s, { businessId: B, type: 'partner', id: P.hub, userId: JACK, body: { source_kind: 'partner_referral', source_partner_id: P.hub } })).status, 400);
  assert.equal((await editSource(s, { businessId: B, type: 'employer', id: elm.id, userId: JACK, body: { source_kind: 'partner_referral', source_partner_id: randomUUID() } })).status, 400);
  const got = await getSource(s, { businessId: B, type: 'employer', id: elm.id });
  assert.deepEqual([got.body.history.length, got.body.history[0].reason, got.body.history[0].by, got.body.source.set_by], [1, 'edit', 'Jack', 'Jack']);
  const pre = await backfillPreview(s, { businessId: B });
  assert.ok(!pre.body.groups.some(g => g.key === 'Source: Some Fair'), 'Elm is manual now');
});

test('edit: Undo of a first pick clears back to never set (not manual), logged; an empty body is still refused', async () => {
  const s = seed();
  const elm = opps(s)['Elm Health'];
  const r = await editSource(s, { businessId: B, type: 'employer', id: elm.id, userId: JACK, body: { source_kind: 'event', expect_set_at: null }, now: NOW });
  assert.equal(r.status, 200);
  assert.equal((await editSource(s, { businessId: B, type: 'employer', id: elm.id, userId: JACK, body: {} })).status, 400);
  const u = await editSource(s, { businessId: B, type: 'employer', id: elm.id, userId: JACK, body: { source_kind: null, expect_set_at: r.body.source.set_at } });
  assert.equal(u.status, 200, JSON.stringify(u.body));
  const row = s.db.sales_opportunities.find(x => x.id === elm.id);
  assert.deepEqual([row.source_kind, row.source_set_by, row.source_set_at, u.body.source.manual], [null, null, null, false]);
  const got = await getSource(s, { businessId: B, type: 'employer', id: elm.id });
  assert.equal(got.body.history.length, 2);
});

test('promote inherits the target\'s source (manual stays manual) with a promote event; a new company record gets its create source', async () => {
  const s = seed();
  const T = randomUUID();
  s.db.sales_targets.push({ id: T, business_id: B, name: 'Hart Labs', kind: 'employer', status: 'researching', channel: 'call_note', owner_team: null, co_owner_name: null, no_double_touch: false, evidence: 'x', research_notes: null, source_note_id: null, source_kind: 'partner_referral', source_partner_id: P.upside, source_person: 'Brad Cillian', source_set_by: JACK, source_set_at: '2026-10-21T00:00:00Z' });
  const r = await promoteTarget(s, { businessId: B, userId: JACK, targetId: T, body: { to: 'employer' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const o = s.db.sales_opportunities.find(x => x.organization === 'Hart Labs');
  assert.deepEqual([o.source_kind, o.source_partner_id, o.source_person, o.source_set_by], ['partner_referral', P.upside, 'Brad Cillian', JACK]);
  assert.ok(s.db.sales_source_events.some(e => e.record_id === o.id && e.reason === 'promote'));
  const made = await insertCompanyRecord(s, { businessId: B, userId: JACK, name: 'Isle Visit Co', to: 'target', channel: 'website_visit', evidence: 'visited', source: { source_kind: 'website' }, now: NOW });
  const t = s.db.sales_targets.find(x => x.id === made.created.id);
  assert.deepEqual([t.source_kind, t.source_set_by], ['website', null]);
  assert.ok(s.db.sales_source_events.some(e => e.record_id === t.id && e.reason === 'create'));
  const again = await insertCompanyRecord(s, { businessId: B, userId: JACK, name: 'Brightmill Foods', to: 'employer', channel: 'website_visit', evidence: 'x', source: { source_kind: 'website' }, now: NOW });
  assert.ok(again.already, 'an existing company keeps its own source (first touch)');
});

test('referred-by + report + Export for <partner>: only that partner\'s companies, structured fields only, never route_in / notes / an address', async () => {
  const s = seed();
  const pre = await backfillPreview(s, { businessId: B });
  const up = pre.body.groups.find(g => g.key === 'Source: Upside (Brad)');
  await backfillApply(s, { businessId: B, userId: JACK, body: { mappings: { [up.key]: up.proposed } }, now: NOW });
  const ref = await referredBy(s, { businessId: B, id: P.upside });
  assert.deepEqual([ref.body.total, ref.body.groups[0].person, ref.body.groups[0].rows.length], [3, 'Brad Cillian', 3]);
  const rep = await sourcesReport(s, { businessId: B, query: {} });
  const byKind = Object.fromEntries(rep.body.by_kind.map(k => [k.key, k.companies]));
  assert.deepEqual([byKind.partner_referral, rep.body.by_partner[0].label, rep.body.by_partner[0].covered_lives], [3, 'Upside', 3000]);
  assert.equal(rep.body.by_person[0].label, 'Brad Cillian · Upside');
  const ex = await sourcesExport(s, { businessId: B, query: { partner: P.upside, format: 'csv' } });
  assert.equal(ex.status, 200, JSON.stringify(ex.body));
  assert.deepEqual(ex.body.rows.map(r => r.name), ['Brightmill Foods', 'Cove Logistics', 'Dale Schools']);
  assert.deepEqual(Object.keys(ex.body.rows[0]), ['name', 'type_label', 'stage_label', 'owner', 'covered_lives', 'source_person', 'source_office']);
  const all = JSON.stringify(ex.body);
  for (const bad of ['@', 'Route in', 'Brad already emailed', 'Via broker', 'Older note', 'master sheet']) assert.ok(!all.includes(bad), `export carried "${bad}"`);
  assert.match(ex.body.csv, /^Company,Type,Stage,Owner,Covered lives,Referred by,Office\r\nBrightmill Foods,Employer,/);
  assert.equal((await sourcesExport(s, { businessId: B, query: { partner: P.hub } })).body.rows.length, 0);
  assert.equal((await sourcesExport(s, { businessId: B, query: { partner: 'x' } })).status, 400);
});
