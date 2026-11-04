// node --test api/sales/clients.test.mjs  (react-scripts' Jest only runs src/)
// homelover-clients-v1 Stage 1 - Make client / Mark signed / Mark launched / Undo, the client list, client files, the
// partner Network card, the Sources tree and direct / via attribution, against the in-memory Supabase (its stage
// trigger and storage stand-ins). 0 network, 0 Claude, 0 Apollo. No email or phone anywhere in this seed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fakeSupabase, opportunityEventsTrigger } from './testing/fakeSupabase.mjs';
import { makeClient, markClient, undoClient, listClients, validateClient, SEND_AGREEMENT, CLIENT_COLS } from './clients.js';
import { uploadUrl, recordFile, listFiles, openFile, setArchived, BUCKET, OPEN_TTL_S } from './clientFiles.js';
import { referredBy, sourcesNetwork, sourcesFunnel } from './sourceRoutes.js';
import { networkOf, networkTree, clientAttribution } from './sourceNetwork.js';
import { validateSource, cleanSource } from './leadSource.js';
import { SOURCE_KINDS, SOURCE_LABEL } from '../../src/constants/leadSources.js';
import { CLIENT_FILE_MAX_BYTES } from '../../src/constants/clients.js';

const NOW = new Date('2026-11-03T22:00:00Z'); // Tue Nov 3, 2pm LA
const later = ms => new Date(NOW.getTime() + ms);
const B = randomUUID(), B2 = randomUUID(), U = randomUUID(), U2 = randomUUID();
const ID = { mom: randomUUID(), hub: randomUUID(), upside: randomUUID(), other: randomUUID(), camp: randomUUID(), c1: randomUUID(), c2: randomUUID(), c3: randomUUID(), foreign: randomUUID() };
const STAMP = '2026-11-02T18:00:00.000Z';

const seed = () => fakeSupabase({
  business_members: [{ business_id: B, user_id: U, name: 'Jack Carlson' }, { business_id: B, user_id: U2, name: 'Seif Test' }],
  sales_goals: [
    { id: ID.upside, business_id: B, goal_type: 'partnership', name: 'Upside', pipeline_status: 'live', owner_team: 'both', source_kind: 'unknown', source_partner_id: null },
    { id: ID.hub, business_id: B, goal_type: 'partnership', name: 'HUB International', pipeline_status: 'live', owner_user_id: U2, owner_team: 'homelover', co_owner_name: 'Rep Name', source_kind: 'partner_referral', source_partner_id: null },
  ],
  sales_opportunities: [
    { id: ID.mom, business_id: B, organization: 'Momentum', domain: 'momentum.example', stage: 'verbal', owner: 'Jack', owner_user_id: U, owner_team: null, covered_lives: 390, expected_close: '2026-11-20', expected_launch: '2027-01-01', channel: 'partner_referral', notes: 'old note', champion: null, archived_at: null, updated_at: STAMP, created_at: '2026-10-01T00:00:00Z', source_kind: null, source_partner_id: null },
    { id: ID.other, business_id: B, organization: 'Other Co', domain: 'other.example', stage: 'meeting', owner: 'Jack', owner_team: 'upside', covered_lives: null, archived_at: null, updated_at: STAMP, source_kind: 'partner_referral', source_partner_id: ID.upside },
    { id: ID.foreign, business_id: B2, organization: 'Elsewhere', domain: 'elsewhere.example', stage: 'meeting', archived_at: null, updated_at: STAMP },
  ],
  sales_targets: [],
  sales_outreach_campaigns: [{ id: ID.camp, business_id: B, name: 'Q4 employers', sender_user_id: U, owner_user_ids: [U], status: 'active' }],
  sales_outreach_contacts: [
    { id: ID.c1, business_id: B, campaign_id: ID.camp, name: 'Pat A', company: 'Momentum', status: 'active', current_step: 2, next_due_date: '2026-11-05', last_sent_at: '2026-10-30T15:00:00Z', replied_at: null, opportunity_id: ID.mom, updated_at: '2026-10-30T15:00:00Z' },
    { id: ID.c2, business_id: B, campaign_id: ID.camp, name: 'Lee B', company: 'Momentum', status: 'queued', current_step: 1, next_due_date: null, last_sent_at: null, replied_at: null, opportunity_id: ID.mom, updated_at: '2026-10-29T15:00:00Z' },
    { id: ID.c3, business_id: B, campaign_id: ID.camp, name: 'Kim C', company: 'Momentum', status: 'replied', current_step: 1, next_due_date: null, last_sent_at: null, replied_at: '2026-10-31T15:00:00Z', opportunity_id: ID.mom, updated_at: '2026-10-31T15:00:00Z' },
  ],
  sales_outreach_events: [], sales_outreach_tracks: [],
  sales_prospect_state: [
    { business_id: B, contact_id: 'ap-1', name: 'Dana Q', company: 'Momentum', status: 'contacted', owner: 'jack', opportunity_id: ID.mom },
    { business_id: B, contact_id: 'ap-2', name: 'Ray Z', company: 'Momentum', status: 'dead', owner: 'jack', opportunity_id: ID.mom },
  ],
  sales_people: [], web_visits: [], research_runs: [],
  sales_week_goals: [], sales_week_report: [], sales_source_events: [], sales_opportunity_events: [], sales_client_events: [], sales_client_files: [],
}, { triggers: { sales_opportunities: opportunityEventsTrigger }, now: () => NOW.getTime() });

const momentumBody = (over = {}) => ({
  opportunity_id: ID.mom, status: 'verbal_yes', eligible_now: 390, eligible_added: 250, eligible_added_note: 'acquisition, expected April 2027',
  expected_signing_date: '2026-11-20', launch_date: '2027-01-01', source: { source_kind: 'partner_referral', source_partner_id: ID.hub }, ...over,
});
const row = (sb, id = ID.mom) => sb.db.sales_opportunities.find(r => r.id === id);

test('validateClient: no email or phone in any text field, ids and numbers checked, unknown keys refused', () => {
  for (const k of ['eligible_added_note', 'primary_contact_name', 'primary_contact_title', 'hq_city', 'hq_state', 'notes', 'organization']) {
    for (const bad of ['pat@momentum.example', 'call 312-555-0199']) {
      const r = validateClient({ ...momentumBody(), [k]: bad });
      assert.match(r.error, /email address or phone/, `${k} accepted ${bad}`);
    }
  }
  assert.match(validateClient({ ...momentumBody(), source: { source_kind: 'partner_referral', source_person: 'x@y.example' } }).error, /email address or phone/);
  assert.match(validateClient({ ...momentumBody(), eligible_now: -1 }).error, /whole number/);
  assert.match(validateClient({ ...momentumBody(), apollo_deal_id: 'a b' }).error, /Apollo id/);
  assert.match(validateClient({ ...momentumBody(), status: 'won' }).error, /status must be/);
  assert.match(validateClient({ ...momentumBody(), phone: '1' }).error, /unknown field: phone/);
  assert.match(validateClient({ status: 'verbal_yes' }).error, /give organization/);
  assert.equal(validateClient({ status: 'verbal_yes', organization: 'X' }).error, undefined, 'a known company can be named without its domain');
});

test('Make client: client fields set, stage via the PATCH path (stage_change written), campaign contacts stopped, Apollo warning, Send agreement once', async () => {
  const sb = seed();
  sb.db.sales_opportunities.find(r => r.id === ID.mom).stage = 'meeting';
  const r = await makeClient(sb, { businessId: B, userId: U, body: momentumBody(), now: NOW });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const m = row(sb);
  assert.deepEqual({ s: m.client_status, since: m.client_since, now: m.eligible_now, add: m.eligible_added, note: m.eligible_added_note, sign: m.expected_signing_date, launch: m.expected_launch, lives: m.covered_lives, stage: m.stage },
    { s: 'verbal_yes', since: '2026-11-03', now: 390, add: 250, note: 'acquisition, expected April 2027', sign: '2026-11-20', launch: '2027-01-01', lives: 390, stage: 'verbal' });
  assert.equal(m.source_kind, 'partner_referral'); assert.equal(m.source_partner_id, ID.hub);
  assert.deepEqual(sb.db.sales_opportunity_events.map(e => [e.event_type, e.from_stage, e.to_stage]), [['stage_change', 'meeting', 'verbal']]);
  assert.equal(sb.db.sales_source_events.length, 1);
  assert.equal(r.body.contacts_stopped, 2);
  assert.deepEqual(sb.db.sales_outreach_contacts.map(c => c.status), ['done', 'done', 'replied']);
  assert.deepEqual(r.body.warnings, ['1 person is in Apollo sequences - stop them in Apollo']);
  const todos = sb.db.sales_week_goals.filter(t => t.text === SEND_AGREEMENT);
  assert.equal(todos.length, 1); assert.equal(todos[0].link_id, ID.mom); assert.equal(r.body.todo_id, todos[0].id);
  assert.equal(sb.db.sales_client_events[0].kind, 'made_client');
  const again = await makeClient(sb, { businessId: B, userId: U, body: momentumBody(), now: later(1000) });
  assert.equal(again.status, 200);
  assert.equal(again.body.todo_id, null);
  assert.equal(sb.db.sales_week_goals.filter(t => t.text === SEND_AGREEMENT).length, 1);
  assert.equal(again.body.contacts_stopped, 0);
  assert.equal(again.body.unchanged, true, 'the same call again changes nothing');
  assert.equal(again.body.event_id, null);
  assert.equal(sb.db.sales_client_events.length, 1);
  const changed = await makeClient(sb, { businessId: B, userId: U, body: momentumBody({ status: 'agreement_sent' }), now: later(2000) });
  assert.equal(sb.db.sales_client_events.at(-1).kind, 'status'); assert.ok(changed.body.event_id);
});

test('C2 mapping: each status lands on its stage, never backward; a side lane moves; a hand stage move keeps client fields', async () => {
  const cases = [['verbal_yes', 'meeting', 'verbal'], ['agreement_sent', 'verbal', 'contract'], ['signed', 'verbal', 'contract'], ['launched', 'contract', 'launched'], ['verbal_yes', 'launched', 'launched'], ['verbal_yes', 'nurture', 'verbal']];
  for (const [status, from, to] of cases) {
    const sb = seed();
    row(sb).stage = from;
    const r = await makeClient(sb, { businessId: B, userId: U, body: momentumBody({ status }), now: NOW });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(row(sb).stage, to, `${status} from ${from}`);
    assert.equal(sb.db.sales_opportunity_events.filter(e => e.event_type === 'stage_change').length, from === to ? 0 : 1);
    if (status === 'signed') assert.equal(row(sb).signed_date, '2026-11-03');
  }
  const sb = seed();
  await makeClient(sb, { businessId: B, userId: U, body: momentumBody(), now: NOW });
  const { updateOpportunity } = await import('./pipelineRoutes.js');
  const moved = await updateOpportunity(sb, { businessId: B, id: ID.mom, userId: U, body: { stage: 'meeting', allow_backward: true } });
  assert.equal(moved.status, 200);
  assert.equal(row(sb).client_status, 'verbal_yes'); assert.equal(row(sb).eligible_now, 390);
});

test('source: required, Partner referral needs a partner, the partner must be in this workspace', async () => {
  const sb = seed();
  let r = await makeClient(sb, { businessId: B, userId: U, body: momentumBody({ source: undefined }), now: NOW });
  assert.equal(r.status, 400); assert.match(r.body.error, /pick a source/);
  r = await makeClient(sb, { businessId: B, userId: U, body: momentumBody({ source: { source_kind: 'partner_referral' } }), now: NOW });
  assert.equal(r.status, 400); assert.match(r.body.error, /needs the partner/);
  r = await makeClient(sb, { businessId: B, userId: U, body: momentumBody({ source: { source_kind: 'partner_referral', source_partner_id: randomUUID() } }), now: NOW });
  assert.equal(r.status, 400); assert.match(r.body.error, /partner in this workspace/);
  assert.equal(row(sb).client_status, undefined);
});

test('Undo restores the exact prior row (values + updated_at), the stopped contacts exactly, drops the to-do, keeps every Activity row', async () => {
  const sb = seed();
  const before = { ...row(sb) };
  const contactsBefore = sb.db.sales_outreach_contacts.map(c => ({ ...c }));
  const r = await makeClient(sb, { businessId: B, userId: U, body: momentumBody({ primary_contact_name: 'Pat A', primary_contact_title: 'CHRO', hq_city: 'Chicago', hq_state: 'IL' }), now: NOW });
  assert.equal(r.status, 200);
  assert.equal(row(sb).champion, 'Pat A, CHRO'); assert.match(row(sb).notes, /HQ: Chicago, IL/);
  assert.equal((await undoClient(sb, { businessId: B, userId: U2, body: { event_id: r.body.event_id }, now: later(5000) })).status, 409);
  const u = await undoClient(sb, { businessId: B, userId: U, body: { event_id: r.body.event_id }, now: later(5000) });
  assert.equal(u.status, 200, JSON.stringify(u.body));
  const after = row(sb);
  for (const k of Object.keys(before)) assert.deepEqual(after[k] ?? null, before[k] ?? null, k);
  for (const k of CLIENT_COLS) assert.equal(after[k] ?? null, null, k);
  const contactsAfter = sb.db.sales_outreach_contacts;
  for (const c of contactsBefore) for (const k of ['status', 'current_step', 'next_due_date', 'last_sent_at', 'replied_at', 'updated_at']) assert.deepEqual(contactsAfter.find(x => x.id === c.id)[k], c[k], `${c.name} ${k}`);
  assert.equal(sb.db.sales_week_goals.find(t => t.text === SEND_AGREEMENT).status, 'dropped');
  assert.deepEqual(sb.db.sales_client_events.map(e => e.kind), ['made_client', 'undo']);
  assert.equal(sb.db.sales_source_events.map(e => e.reason).join(','), 'edit,undo');
  assert.equal((await undoClient(sb, { businessId: B, userId: U, body: { event_id: r.body.event_id }, now: later(6000) })).status, 409);
});

test('Undo is refused after 2 minutes and when the row changed since', async () => {
  const sb = seed();
  const r = await makeClient(sb, { businessId: B, userId: U, body: momentumBody(), now: NOW });
  assert.match((await undoClient(sb, { businessId: B, userId: U, body: { event_id: r.body.event_id }, now: later(121e3) })).body.error, /too long ago/);
  row(sb).eligible_now = 400;
  assert.match((await undoClient(sb, { businessId: B, userId: U, body: { event_id: r.body.event_id }, now: later(1000) })).body.error, /changed since/);
});

test('Add › Client: idempotent on domain (then name); a new employer Undo deletes it; two matches on a domain refuse', async () => {
  const sb = seed();
  const body = { status: 'verbal_yes', organization: 'Momentum Innovative', domain: 'https://www.Momentum.example/about', source: { source_kind: 'homelover_outreach' } };
  const r1 = await makeClient(sb, { businessId: B, userId: U, body, now: NOW });
  assert.equal(r1.status, 200); assert.equal(r1.body.created, false); assert.equal(r1.body.client.id, ID.mom);
  const fresh = { status: 'agreement_sent', organization: 'Nova Health', domain: 'nova.example', source: { source_kind: 'person_referral', source_person: 'Sam Ref' } };
  const r2 = await makeClient(sb, { businessId: B, userId: U, body: fresh, now: NOW });
  assert.equal(r2.status, 201, JSON.stringify(r2.body)); assert.equal(r2.body.created, true);
  const nova = sb.db.sales_opportunities.find(o => o.organization === 'Nova Health');
  assert.equal(nova.stage, 'contract'); assert.equal(nova.domain, 'nova.example'); assert.equal(nova.owner, 'Jack');
  const r3 = await makeClient(sb, { businessId: B, userId: U, body: fresh, now: later(1000) });
  assert.equal(r3.status, 200); assert.equal(r3.body.updated, true); assert.equal(r3.body.unchanged, true);
  assert.equal(sb.db.sales_opportunities.filter(o => o.organization === 'Nova Health').length, 1);
  const byName = await makeClient(sb, { businessId: B, userId: U, body: { ...fresh, domain: undefined }, now: later(1500) });
  assert.equal(byName.status, 200); assert.equal(byName.body.client.id, r2.body.client.id, 'a known name without its domain finds the same employer');
  assert.match((await makeClient(sb, { businessId: B, userId: U, body: { status: 'verbal_yes', organization: 'Zz Unknown Co', source: { source_kind: 'inbound' } }, now: NOW })).body.error, /give its website domain/);
  const filled = await makeClient(sb, { businessId: B, userId: U, body: { ...momentumBody(), opportunity_id: undefined, organization: 'Momentum', domain: 'momentum-new.example' }, now: later(1600) });
  assert.equal(filled.status, 200); assert.equal(row(sb).domain, 'momentum.example', 'a domain is filled only when empty');
  const sb2 = seed();
  const n = await makeClient(sb2, { businessId: B, userId: U, body: fresh, now: NOW });
  const un = await undoClient(sb2, { businessId: B, userId: U, body: { event_id: n.body.event_id }, now: later(2000) });
  assert.equal(un.status, 200); assert.equal(un.body.deleted.type, 'employer');
  assert.equal(sb2.db.sales_opportunities.some(o => o.organization === 'Nova Health'), false);
  sb2.db.sales_opportunities.push({ id: randomUUID(), business_id: B, organization: 'Twin A', domain: 'twin.example', stage: 'target', archived_at: null }, { id: randomUUID(), business_id: B, organization: 'Twin B', domain: 'twin.example', stage: 'target', archived_at: null });
  const amb = await makeClient(sb2, { businessId: B, userId: U, body: { ...fresh, organization: 'Twin', domain: 'twin.example' }, now: NOW });
  assert.equal(amb.status, 409); assert.equal(amb.body.code, 'ambiguous_domain');
  const up = await makeClient(seed(), { businessId: B, userId: U, body: { opportunity_id: ID.other, status: 'verbal_yes' }, now: NOW });
  assert.ok(up.body.warnings.includes('Upside-owned account'));
});

test('Mark signed / Mark launched: expect guard, dates, stage, Undo', async () => {
  const sb = seed();
  await makeClient(sb, { businessId: B, userId: U, body: momentumBody(), now: NOW });
  assert.equal((await markClient(sb, { businessId: B, userId: U, id: ID.mom, to: 'signed', body: { expect_status: 'agreement_sent' }, now: NOW })).body.code, 'stale_status');
  const s = await markClient(sb, { businessId: B, userId: U, id: ID.mom, to: 'signed', body: { expect_status: 'verbal_yes', signed_date: '2026-11-18' }, now: NOW });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.deepEqual([row(sb).client_status, row(sb).signed_date, row(sb).stage], ['signed', '2026-11-18', 'contract']);
  const l = await markClient(sb, { businessId: B, userId: U, id: ID.mom, to: 'launched', body: { expect_status: 'signed' }, now: later(1000) });
  assert.deepEqual([row(sb).client_status, row(sb).expected_launch, row(sb).stage], ['launched', '2026-11-03', 'launched']);
  const u = await undoClient(sb, { businessId: B, userId: U, body: { event_id: l.body.event_id }, now: later(2000) });
  assert.equal(u.status, 200);
  assert.deepEqual([row(sb).client_status, row(sb).expected_launch, row(sb).stage], ['signed', '2027-01-01', 'contract']);
  assert.equal((await markClient(sb, { businessId: B, userId: U, id: ID.foreign, to: 'signed', body: { expect_status: 'verbal_yes' }, now: NOW })).status, 404);
});

test('Clients list: rows, referred by, files count, totals by status, sorted by status then launch', async () => {
  const sb = seed();
  await makeClient(sb, { businessId: B, userId: U, body: momentumBody({ status: 'signed' }), now: NOW });
  await makeClient(sb, { businessId: B, userId: U, body: { opportunity_id: ID.other, status: 'verbal_yes', eligible_now: 100, launch_date: '2027-03-01' }, now: NOW });
  sb.db.sales_client_files.push({ id: randomUUID(), business_id: B, opportunity_id: ID.mom, archived_at: null }, { id: randomUUID(), business_id: B, opportunity_id: ID.mom, archived_at: '2026-11-01T00:00:00Z' });
  const r = await listClients(sb, { businessId: B });
  assert.deepEqual(r.body.clients.map(c => [c.name, c.client_status, c.referred_by?.name, c.files]), [['Other Co', 'verbal_yes', 'Upside', 0], ['Momentum', 'signed', 'HUB International', 1]]);
  assert.deepEqual(r.body.totals, { clients: 2, by_status: { verbal_yes: 1, agreement_sent: 0, signed: 1, launched: 0 }, eligible_now: 490, eligible_added: 250 });
});

test('files: upload url checks the workspace, kind, type and size; record needs the real object; open = 60s url; archive keeps row and object', async () => {
  const sb = seed();
  assert.equal((await uploadUrl(sb, { businessId: B, id: ID.foreign, body: { kind: 'agreement', title: 'MSA', mime: 'application/pdf', size_bytes: 1000 } })).status, 404);
  assert.match((await uploadUrl(sb, { businessId: B, id: ID.mom, body: { kind: 'agreement', title: 'MSA', mime: 'application/zip', size_bytes: 1000 } })).body.error, /only PDF/);
  assert.match((await uploadUrl(sb, { businessId: B, id: ID.mom, body: { kind: 'agreement', title: 'MSA', mime: 'application/pdf', size_bytes: CLIENT_FILE_MAX_BYTES + 1 } })).body.error, /20 MB/);
  assert.match((await uploadUrl(sb, { businessId: B, id: ID.mom, body: { kind: 'contract', title: 'MSA', mime: 'application/pdf', size_bytes: 1 } })).body.error, /kind must be/);
  assert.match((await uploadUrl(sb, { businessId: B, id: ID.mom, body: { kind: 'agreement', title: 'MSA for pat@momentum.example', mime: 'application/pdf', size_bytes: 1 } })).body.error, /email address or phone/);
  const u = await uploadUrl(sb, { businessId: B, id: ID.mom, body: { kind: 'agreement', title: 'Momentum MSA', mime: 'application/pdf', size_bytes: 52000 } });
  assert.equal(u.status, 200);
  assert.equal(u.body.path, `${B}/${ID.mom}/${u.body.file_id}`);
  assert.equal((await recordFile(sb, { businessId: B, userId: U, id: ID.mom, body: { file_id: u.body.file_id, kind: 'agreement', title: 'Momentum MSA' }, now: NOW })).status, 409);
  sb.put(BUCKET, u.body.path, { size: CLIENT_FILE_MAX_BYTES + 5, mimetype: 'application/pdf' });
  assert.match((await recordFile(sb, { businessId: B, userId: U, id: ID.mom, body: { file_id: u.body.file_id, kind: 'agreement', title: 'Momentum MSA' }, now: NOW })).body.error, /20 MB/);
  sb.put(BUCKET, u.body.path, { size: 52000, mimetype: 'text/html' });
  assert.match((await recordFile(sb, { businessId: B, userId: U, id: ID.mom, body: { file_id: u.body.file_id, kind: 'agreement', title: 'Momentum MSA' }, now: NOW })).body.error, /only PDF/);
  sb.put(BUCKET, u.body.path, { size: 52000, mimetype: 'application/pdf' });
  const rec = await recordFile(sb, { businessId: B, userId: U, id: ID.mom, body: { file_id: u.body.file_id, kind: 'agreement', title: 'Momentum MSA' }, now: NOW });
  assert.equal(rec.status, 201, JSON.stringify(rec.body));
  assert.equal(rec.body.file.size_bytes, 52000);
  assert.equal((await recordFile(sb, { businessId: B, userId: U, id: ID.mom, body: { file_id: u.body.file_id, kind: 'agreement', title: 'Momentum MSA' }, now: NOW })).status, 200, 'recording twice is one row');
  assert.equal(sb.db.sales_client_files.length, 1);
  const o = await openFile(sb, { businessId: B, id: rec.body.file.id });
  assert.equal(o.body.expires_in, OPEN_TTL_S); assert.equal(OPEN_TTL_S, 60); assert.match(o.body.url, /expires=60$/);
  assert.equal((await openFile(sb, { businessId: B2, id: rec.body.file.id })).status, 404);
  const a = await setArchived(sb, { businessId: B, userId: U, id: rec.body.file.id, archived: true, now: NOW });
  assert.ok(a.body.file.archived_at);
  assert.equal(sb.db.sales_client_files.length, 1); assert.equal(sb.objects.size, 1);
  assert.equal((await listFiles(sb, { businessId: B, id: ID.mom })).body.files.length, 0);
  assert.equal((await listFiles(sb, { businessId: B, id: ID.mom, query: { archived: '1' } })).body.files.length, 1);
  assert.equal((await setArchived(sb, { businessId: B, userId: U, id: rec.body.file.id, archived: false, now: NOW })).body.file.archived_at, null);
  assert.deepEqual(sb.db.sales_client_events.map(e => e.kind), ['file_added', 'file_archived']);
});

test('Network card: groups + real counts, 25 then "more", Came from with partner not set, rep grouping kept', async () => {
  const sb = seed();
  await makeClient(sb, { businessId: B, userId: U, body: momentumBody(), now: NOW });
  const r = await referredBy(sb, { businessId: B, id: ID.hub });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.network.header, { clients: 1, lives: 390, in_pipeline: 0, partners: 0, targets: 0 });
  assert.deepEqual(r.body.network.groups[0].rows.map(x => [x.name, x.status_label, x.lives]), [['Momentum', 'Verbal yes', 390]]);
  assert.deepEqual(r.body.network.came_from, { kind: 'partner_referral', label: 'Partner referral', partner_id: null, partner_name: null, person: null, partner_not_set: true });
  assert.equal(r.body.network.ownership.owner, 'Seif');
  assert.equal(r.body.total, 1); assert.equal(r.body.groups.length, 1);
  const many = Array.from({ length: 229 }, (_, i) => ({ type: 'employer', id: `e${i}`, name: `Co ${String(i).padStart(3, '0')}`, stage: i % 10 === 0 ? 'lost' : 'contacted', stage_label: 'Contacted' }));
  const n = networkOf(many, { partner: { source_kind: 'unknown' } });
  assert.equal(n.header.in_pipeline, 206);
  assert.deepEqual([n.groups[1].total, n.groups[1].rows.length, n.groups[1].more], [206, 25, 181]);
  assert.equal(n.came_from.partner_not_set, false);
});

test('Network tree: roots, depth 4, each company once, cycle-safe, 25 + more, rollup over the whole sub-network', () => {
  const P = (id, src = null, kind = src ? 'partner_referral' : 'unknown') => ({ type: 'partner', id, name: id, source_partner_id: src, source_kind: kind });
  const E = (id, src, extra = {}) => ({ type: 'employer', id, name: id, stage: 'contacted', source_partner_id: src, source_kind: 'partner_referral', ...extra });
  const rows = [P('A'), P('B', 'A'), P('C', 'B'), P('D', 'C'), P('E', 'D'), E('deep', 'E', { client_status: 'signed', eligible_now: 10 }),
    E('m1', 'B', { client_status: 'verbal_yes', eligible_now: 390 }), P('X', 'Y'), P('Y', 'X'), E('xy', 'X'), P('H', null, 'partner_referral'), E('h1', 'H'), P('lonely')];
  const t = networkTree(rows);
  assert.deepEqual(t.roots.map(r => r.id), ['A', 'H', 'X']);
  const a = t.roots[0];
  assert.deepEqual(a.rollup, { clients: 2, lives: 400, in_pipeline: 0 });
  const d = a.children[0].children.find(c => c.id === 'C').children[0];
  assert.equal(d.depth, 4); assert.deepEqual(d.children, []); assert.equal(d.more, 1);
  assert.equal(t.roots[1].partner_not_set, true);
  const flat = []; const walk = n => { flat.push(`${n.type}:${n.id}${n.repeat ? '↻' : ''}`); (n.children || []).forEach(walk); }; t.roots.forEach(walk);
  assert.equal(new Set(flat.filter(k => !k.endsWith('↻'))).size, flat.filter(k => !k.endsWith('↻')).length, 'each company shown once');
  assert.ok(flat.includes('partner:X↻'), 'the X <-> Y ring ends in a see-above leaf');
  assert.equal(t.partners_with_none, 1);
  const wide = networkTree([P('W'), ...Array.from({ length: 30 }, (_, i) => E(`w${i}`, 'W'))]);
  assert.deepEqual([wide.roots[0].children.length, wide.roots[0].more, wide.roots[0].rollup.in_pipeline], [25, 5, 30]);
});

test('attribution: direct and via one level up; funnel by_partner carries both; the route serves the tree', async () => {
  const a = clientAttribution([
    { source_kind: 'partner_referral', source_partner_id: 'hub', eligible_now: 390 },
    { source_kind: 'partner_referral', source_partner_id: 'upside', eligible_now: null, covered_lives: 50 },
    { source_kind: 'person_referral', source_partner_id: null, eligible_now: 9 },
  ], new Map([['hub', 'upside'], ['upside', null]]));
  assert.deepEqual(a.get('hub'), { clients_direct: 1, lives_direct: 390, clients_via: 0, lives_via: 0 });
  assert.deepEqual(a.get('upside'), { clients_direct: 1, lives_direct: 50, clients_via: 1, lives_via: 390 });
  const sb = seed();
  sb.db.sales_goals.find(g => g.id === ID.hub).source_partner_id = ID.upside;
  await makeClient(sb, { businessId: B, userId: U, body: momentumBody(), now: NOW });
  const f = await sourcesFunnel(sb, { businessId: B, now: NOW.getTime() });
  assert.equal(f.status, 200, JSON.stringify(f.body));
  const up = f.body.by_partner.find(g => g.key === ID.upside), hub = f.body.by_partner.find(g => g.key === ID.hub);
  assert.deepEqual([up.clients_direct, up.clients_via, up.lives_via], [0, 1, 390]);
  assert.deepEqual([hub.clients_direct, hub.lives_direct], [1, 390]);
  const t = await sourcesNetwork(sb, { businessId: B });
  assert.equal(t.status, 200);
  assert.equal(t.body.roots[0].name, 'Upside');
  assert.deepEqual(t.body.roots[0].rollup, { clients: 1, lives: 390, in_pipeline: 1 });
});

test("lookalike is a source kind everywhere one is checked (constants, validation, funnel filter, every DB check)", async () => {
  assert.ok(SOURCE_KINDS.includes('lookalike')); assert.equal(SOURCE_LABEL.lookalike, 'Lookalike');
  assert.equal(validateSource({ source_kind: 'lookalike', source_note: 'Lookalike of Momentum' }).source.source_kind, 'lookalike');
  assert.equal(cleanSource({ source_kind: 'lookalike' }).source_kind, 'lookalike');
  assert.equal((await sourcesFunnel(seed(), { businessId: B, query: { source: 'lookalike' }, now: NOW.getTime() })).status, 200);
  const sql = readFileSync(new URL('../../supabase/migrations/20261103_homelover_clients_v1.sql', import.meta.url), 'utf8');
  const checks = sql.match(/source_kind (IS NULL OR source_kind )?IN \([^)]*\)/g);
  assert.equal(checks.length, 3, 'the record-table loop, lead uploads, people');
  for (const c of checks) for (const k of SOURCE_KINDS) assert.ok(c.includes(`'${k}'`), `${k} missing from ${c.slice(0, 60)}`);
  assert.match(sql, /'web_visit', 'lookalike'/);
  assert.match(sql, /INSERT INTO storage\.buckets[\s\S]*'client-files', 'client-files', false, 20971520/);
});

test('ruling 2: re-running Make client never adds a second HQ line (a new HQ replaces it); champion kept once set', async () => {
  const sb = seed();
  const body = momentumBody({ primary_contact_name: 'Pat A', primary_contact_title: 'CHRO', hq_city: 'Chicago', hq_state: 'IL' });
  await makeClient(sb, { businessId: B, userId: U, body, now: NOW });
  await makeClient(sb, { businessId: B, userId: U, body, now: later(1000) });
  assert.equal(row(sb).notes, 'old note\nHQ: Chicago, IL');
  const moved = await makeClient(sb, { businessId: B, userId: U, body: { ...body, hq_city: 'Austin', hq_state: 'TX', primary_contact_name: 'Lee B' }, now: later(2000) });
  assert.equal(row(sb).notes, 'old note\nHQ: Austin, TX');
  assert.equal((row(sb).notes.match(/^HQ: /gm) || []).length, 1);
  assert.equal(row(sb).champion, 'Pat A, CHRO');
  assert.ok(moved.body.warnings.includes('a champion is already set - kept'));
});

test('ruling 3: Undo deletes the employer only when this call created it, inside the window, with nothing linked; otherwise archives it', async () => {
  const fresh = { status: 'verbal_yes', organization: 'Nova Health', domain: 'nova.example', source: { source_kind: 'homelover_outreach' } };
  // created + nothing linked -> deleted (its source events with it), the Send agreement to-do doesn't count as a link
  let sb = seed();
  let r = await makeClient(sb, { businessId: B, userId: U, body: fresh, now: NOW });
  assert.ok(r.body.todo_id);
  let u = await undoClient(sb, { businessId: B, userId: U, body: { event_id: r.body.event_id }, now: later(5000) });
  assert.equal(u.status, 200); assert.equal(u.body.deleted.type, 'employer');
  assert.equal(sb.db.sales_opportunities.some(o => o.organization === 'Nova Health'), false);
  // created, then a person filed on it -> archived, client fields back to empty, the person kept
  sb = seed();
  r = await makeClient(sb, { businessId: B, userId: U, body: fresh, now: NOW });
  const novaId = r.body.client.id;
  sb.db.sales_people.push({ id: randomUUID(), business_id: B, company_type: 'employer', opportunity_id: novaId, name: 'Sam N' });
  u = await undoClient(sb, { businessId: B, userId: U, body: { event_id: r.body.event_id }, now: later(5000) });
  assert.equal(u.status, 200, JSON.stringify(u.body)); assert.equal(u.body.archived.id, novaId);
  const nova = row(sb, novaId);
  assert.ok(nova.archived_at); assert.equal(nova.client_status, null); assert.equal(nova.stage, 'target');
  assert.equal(sb.db.sales_people.filter(p => p.opportunity_id === novaId).length, 1);
  assert.deepEqual(sb.db.sales_client_events.filter(e => e.opportunity_id === novaId).map(e => e.kind), ['made_client', 'undo']);
  assert.equal(sb.db.sales_opportunity_events.filter(e => e.opportunity_id === novaId).at(-1).event_type, 'archived');
  // created, but an older employer (outside the window) -> archived, not deleted
  sb = seed();
  r = await makeClient(sb, { businessId: B, userId: U, body: fresh, now: NOW });
  row(sb, r.body.client.id).created_at = new Date(NOW.getTime() - 10 * 60e3).toISOString();
  u = await undoClient(sb, { businessId: B, userId: U, body: { event_id: r.body.event_id }, now: later(5000) });
  assert.ok(u.body.archived); assert.ok(row(sb, r.body.client.id));
  // an existing employer is never deleted or archived by Undo
  sb = seed();
  r = await makeClient(sb, { businessId: B, userId: U, body: momentumBody(), now: NOW });
  u = await undoClient(sb, { businessId: B, userId: U, body: { event_id: r.body.event_id }, now: later(5000) });
  assert.equal(u.body.deleted, undefined); assert.equal(u.body.archived, undefined); assert.equal(row(sb).archived_at, null);
});

test("ruling 1: client changes show in the employer's Notes & touches feed, never as stage moves", async () => {
  const { companyDetail, clientEventText } = await import('./companyPanel.js');
  const sb = seed();
  const r = await makeClient(sb, { businessId: B, userId: U, body: momentumBody(), now: NOW });
  await markClient(sb, { businessId: B, userId: U, id: ID.mom, to: 'signed', body: { expect_status: 'verbal_yes' }, now: later(1000) });
  const d = await companyDetail(sb, { businessId: B, type: 'employer', id: ID.mom, now: later(2000) });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  const client = d.body.recent.filter(e => e.event === 'client').map(e => e.text);
  assert.deepEqual(client.sort(), ['Made a client · Verbal yes', 'Marked signed']);
  assert.ok(d.body.recent.some(e => e.event === 'stage' && e.text === 'verbal → contract'));
  assert.equal(clientEventText({ kind: 'made_client', to_status: 'verbal_yes', via: 'connector' }), 'Made a client · Verbal yes (via connector)');
  assert.ok(r.body.event_id);
});
