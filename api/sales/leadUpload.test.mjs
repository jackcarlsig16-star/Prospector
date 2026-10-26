// node --test api/sales/leadUpload.test.mjs  (react-scripts' Jest only runs src/)
// lead-upload-v1 Stage 2 - the lead-list read, the cross-check and File against the in-memory Supabase.
// SYNTHETIC fixtures (invented names); 0 network, 0 Claude (the model call is a stub), 0 Apollo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { toLeads, crossCheck, loadLeadContext, MAX_PEOPLE } from './leadUploadMatch.js';
import { extractLeadsRoute, fileLeadsRoute } from './leadUploadRoutes.js';
import { doubleTouchWarning } from '../../src/constants/ownership.js';

const NOW = new Date('2026-10-26T18:00:00Z'); // Mon Oct 26, 11am LA
const B = randomUUID(), U = randomUUID(), REF = randomUUID();
const ID = { upsideEmp: randomUUID(), bothEmp: randomUUID(), ndtTarget: randomUUID(), sourced: randomUUID(), partner: randomUUID() };
const ADDRESS = /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i;
const PHONE = /\+?\d[\d\s().-]{7,}\d/;

const seed = () => fakeSupabase({
  business_members: [{ business_id: B, user_id: U, name: 'Sam Rivera', role: 'owner' }],
  sales_goals: [
    { id: ID.partner, business_id: B, goal_type: 'partnership', name: 'Northwind Benefits Group', pipeline_status: 'replied', category: '4. Brokers', owner_team: 'homelover', source_kind: 'partner_referral' },
    { id: REF, business_id: B, goal_type: 'partnership', name: 'Referral Partners LLC', pipeline_status: 'not_started', category: '4. Brokers', owner_team: 'homelover' },
  ],
  sales_opportunities: [
    { id: ID.upsideEmp, business_id: B, organization: 'Bluefin Retail', stage: 'contacted', org_type: 'employer', owner_team: 'upside', co_owner_name: 'Rob Example', no_double_touch: false, notes: null },
    { id: ID.bothEmp, business_id: B, organization: 'Copperleaf Foods', stage: 'target', org_type: 'employer', owner_team: 'both', no_double_touch: false, notes: null },
    { id: ID.sourced, business_id: B, organization: 'Dunmore Mills', stage: 'contacted', org_type: 'employer', owner_team: 'homelover', notes: '(10/1) older line',
      source_kind: 'partner_referral', source_partner_id: REF, source_person: 'Rob Example', source_set_by: U },
  ],
  sales_targets: [{ id: ID.ndtTarget, business_id: B, name: 'Eastgate Hospital Partners', kind: 'employer', status: 'researching', owner_team: 'upside', co_owner_name: 'Rob Example', no_double_touch: true, research_notes: null }],
  sales_sequenced_accounts: [{ business_id: B, account_id: 'a-ent', name: 'Enterprise', employees: 90000 }], partner_domains: [], partner_contacts: [], sales_people: [], sales_lead_uploads: [], sales_source_events: [], sales_partner_events: [],
}, { now: () => NOW.getTime(), unique: { sales_people: r => `${r.company_type}:${r.opportunity_id || r.target_id}:${r.name.toLowerCase()}` } });

const person = (name, company, extra = {}) => ({ name, company, title: 'VP Human Resources', location: 'Chicago, IL', linkedin_url: null, why: 'Recently changed roles', ...extra });
const call = reply => { const seen = []; const fn = async args => { seen.push(args); return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(reply) }], usage: { input_tokens: 100, output_tokens: 50 } }; }; fn.seen = seen; return fn; };
const reqOf = body => ({ params: { businessId: B }, auth: { user: { id: U } }, body });
const resOf = () => { const r = { code: 200, body: null }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; return r; };

test('a broker / consultant is guessed as a partner; two people at one company are grouped under it', async () => {
  const leads = toLeads({
    companies: [{ name: 'Harbor Benefits Consulting', kind_guess: 'partner', category: '4. Brokers' }, { name: 'Acme Widgets', kind_guess: 'employer', employees: '12,500' }],
    people: [person('Alex Doe', 'Harbor Benefits Consulting'), person('Pat Roe', 'Acme Widgets'), person('Lee Moe', 'Acme Widgets, Inc.'), person('Pat Roe', 'Acme Widgets')],
  }, ['4. Brokers']);
  assert.equal(leads.people_count, 3);
  const [harbor, acme] = crossCheck(leads, await loadLeadContext(seed(), B));
  assert.equal(harbor.kind, 'partner'); assert.equal(harbor.category, '4. Brokers'); assert.equal(harbor.action, 'create');
  assert.deepEqual(acme.people.map(p => p.name), ['Pat Roe', 'Lee Moe']);
  assert.equal(acme.employees, 12500); assert.equal(acme.kind, 'employer');
});

test('FIX dupe-generic-words: "Hewlett Packard Enterprise" next to a stored Apollo-only "Enterprise" reviews as New -> Create, no reason', async () => {
  const [hpe] = crossCheck(toLeads({ companies: [{ name: 'Hewlett Packard Enterprise', kind_guess: 'employer' }], people: [person('Val Lee', 'Hewlett Packard Enterprise')] }), await loadLeadContext(seed(), B));
  assert.equal(hpe.status, 'new'); assert.equal(hpe.action, 'create'); assert.equal(hpe.reason, null); assert.deepEqual(hpe.possible, []);
});

test("ownership: owner_team 'upside' (no_double_touch false) -> chip + default Skip; 'both' -> chip + Add people; no_double_touch -> the exact warning", async () => {
  const ctx = await loadLeadContext(seed(), B);
  const [upside, both, ndt] = crossCheck(toLeads({ companies: [{ name: 'Bluefin Retail' }, { name: 'Copperleaf Foods' }, { name: 'Eastgate Hospital Partners' }],
    people: [person('Ann One', 'Bluefin Retail'), person('Ben Two', 'Copperleaf Foods'), person('Cy Three', 'Eastgate Hospital Partners')] }), ctx);
  assert.equal(upside.status, 'employer'); assert.equal(upside.action, 'skip');
  assert.equal(upside.chip.text, 'Upside owns this (Rob Example)'); assert.equal(upside.reason, upside.chip.text);
  assert.equal(both.chip.text, 'Shared with Upside'); assert.equal(both.action, 'add_people');
  assert.equal(ndt.chip.tone, 'bad'); assert.equal(ndt.chip.text, doubleTouchWarning(ctx.targets[0])); assert.equal(ndt.action, 'skip');
});

test('input: "VP HR @Acme" survives, an address and a phone are replaced before the model call', async () => {
  const fn = call({ companies: [{ name: 'Acme Widgets', kind_guess: 'employer' }], people: [person('Pat Roe', 'Acme Widgets', { title: 'VP HR @Acme Widgets' })] });
  const res = resOf();
  await extractLeadsRoute(reqOf({ text: 'Pat Roe\nVP HR @Acme Widgets\npat.roe@acme.example 312-555-0100', source: { pick: 'apollo' } }), res, { call: fn, supabase: seed() });
  assert.equal(res.code, 200, JSON.stringify(res.body));
  const sent = fn.seen[0].messages[0].content;
  assert.match(sent, /VP HR @Acme Widgets/);
  assert.match(sent, /\[email removed\]/); assert.doesNotMatch(sent, ADDRESS); assert.doesNotMatch(sent, PHONE);
  assert.equal(fn.seen[0].callType, 'lead_upload');
  assert.equal(res.body.companies[0].people[0].title, 'VP HR @Acme Widgets');
  assert.equal(res.body.source.source_kind, 'apollo');
});

test('an address or phone in the model reply never reaches the review or the DB', async () => {
  const supabase = seed();
  const fn = call({ companies: [{ name: 'Fjord Logistics', kind_guess: 'employer' }], people: [person('Dana Poe', 'Fjord Logistics', { why: 'Reach her at dana@fjord.example or 773-555-0199' })] });
  const res = resOf();
  await extractLeadsRoute(reqOf({ text: 'Dana Poe - Fjord Logistics', source: { pick: 'apollo' } }), res, { call: fn, supabase });
  const row = res.body.companies[0];
  assert.doesNotMatch(JSON.stringify(res.body), ADDRESS); assert.doesNotMatch(row.people[0].why, PHONE);
  const filed = resOf();
  await fileLeadsRoute(reqOf({ text: 'Dana Poe - Fjord Logistics', source: { pick: 'apollo' }, companies: [{ ...row, people: [{ ...row.people[0], why: 'mail dana@fjord.example, 773-555-0199' }] }] }), filed, { supabase, now: NOW, kick: async () => {} });
  assert.equal(filed.code, 201, JSON.stringify(filed.body));
  const dbText = JSON.stringify(supabase.db);
  assert.doesNotMatch(dbText, ADDRESS); assert.doesNotMatch(dbText, /773-555-0199/);
});

test(`more than ${MAX_PEOPLE} people -> refused with "split the list"`, async () => {
  const people = Array.from({ length: MAX_PEOPLE + 1 }, (_, i) => person(`Person ${String.fromCharCode(65 + (i % 26))}${i}`, 'Acme Widgets'));
  const res = resOf();
  await extractLeadsRoute(reqOf({ text: 'a long list', source: { pick: 'apollo' } }), res, { call: call({ companies: [{ name: 'Acme Widgets' }], people }), supabase: seed() });
  assert.equal(res.code, 413); assert.match(res.body.error, /split the list/);
});

test('File: new employer created with source Apollo + people in sales_people; re-pasting shows "Already in"', async () => {
  const supabase = seed();
  const text = 'Pat Roe, VP HR @Acme Widgets\nLee Moe, Director HR @Acme Widgets';
  const first = resOf();
  await extractLeadsRoute(reqOf({ text, source: { pick: 'apollo', note: 'Apollo recommended' } }), first, { call: call({ companies: [{ name: 'Acme Widgets', kind_guess: 'employer', employees: 12500 }], people: [person('Pat Roe', 'Acme Widgets'), person('Lee Moe', 'Acme Widgets')] }), supabase });
  const filed = resOf();
  await fileLeadsRoute(reqOf({ text, source: { pick: 'apollo', note: 'Apollo recommended' }, companies: first.body.companies }), filed, { supabase, now: NOW, kick: async () => {} });
  assert.equal(filed.code, 201, JSON.stringify(filed.body));
  assert.equal(filed.body.created.length, 1); assert.equal(filed.body.people_added, 2);
  const opp = supabase.db.sales_opportunities.find(o => o.organization === 'Acme Widgets');
  assert.equal(opp.source_kind, 'apollo'); assert.equal(opp.channel, 'import'); assert.equal(opp.employees, 12500);
  assert.match(opp.notes, /^\(10\/26\) Apollo recommended Oct 26: VP Human Resources; 12,500 employees/);
  const ppl = supabase.db.sales_people.filter(p => p.opportunity_id === opp.id);
  assert.deepEqual(ppl.map(p => p.name).sort(), ['Lee Moe', 'Pat Roe']);
  assert.ok(ppl.every(p => p.note === 'Recently changed roles' && p.source_kind === 'apollo' && p.upload_id === filed.body.upload_id));
  const upload = supabase.db.sales_lead_uploads[0];
  assert.equal(upload.text_hash, first.body.text_hash); assert.equal(upload.counts.people_added, 2); assert.ok(!('text' in upload));

  const again = resOf();
  await extractLeadsRoute(reqOf({ text, source: { pick: 'apollo' } }), again, { call: call({ companies: [{ name: 'Acme Widgets' }], people: [person('Pat Roe', 'Acme Widgets'), person('Lee Moe', 'Acme Widgets')] }), supabase });
  const c = again.body.companies[0];
  assert.equal(c.status, 'employer'); assert.ok(c.people.every(p => p.already_in)); assert.equal(c.action, 'skip');
  assert.equal(again.body.earlier.id, upload.id);
});

test('File into an existing company: its source is never overwritten - an import event is added instead', async () => {
  const supabase = seed();
  const before = { ...supabase.db.sales_opportunities.find(o => o.id === ID.sourced) };
  const rows = crossCheck(toLeads({ companies: [{ name: 'Dunmore Mills' }], people: [person('Gail Hoe', 'Dunmore Mills')] }), await loadLeadContext(supabase, B));
  assert.equal(rows[0].existing_source, 'Partner referral · Referral Partners LLC · Rob Example');
  const res = resOf();
  await fileLeadsRoute(reqOf({ text: 'Gail Hoe @Dunmore Mills', source: { pick: 'apollo' }, companies: rows }), res, { supabase, now: NOW, kick: async () => {} });
  assert.equal(res.code, 201, JSON.stringify(res.body));
  const after = supabase.db.sales_opportunities.find(o => o.id === ID.sourced);
  for (const k of ['source_kind', 'source_partner_id', 'source_person', 'source_set_by']) assert.equal(after[k], before[k], k);
  assert.match(after.notes, /^\(10\/1\) older line\n\(10\/26\) Apollo recommended Oct 26/);
  const ev = supabase.db.sales_source_events.filter(e => e.record_id === ID.sourced);
  assert.equal(ev.length, 1); assert.equal(ev[0].reason, 'import');
  assert.equal(ev[0].from_source.source_kind, 'partner_referral'); assert.equal(ev[0].to_source.source_kind, 'apollo');
});

test('File: a Skip default overridden is recorded on the upload row; a failure part-way undoes everything', async () => {
  const supabase = seed();
  const rows = crossCheck(toLeads({ companies: [{ name: 'Bluefin Retail' }], people: [person('Ann One', 'Bluefin Retail')] }), await loadLeadContext(supabase, B));
  const res = resOf();
  await fileLeadsRoute(reqOf({ text: 'Ann One @Bluefin Retail', source: { pick: 'apollo' }, companies: [{ ...rows[0], action: 'add_people' }] }), res, { supabase, now: NOW, kick: async () => {} });
  assert.equal(res.code, 201, JSON.stringify(res.body));
  assert.deepEqual(supabase.db.sales_lead_uploads[0].counts.overrides, ['Bluefin Retail']);

  const s2 = seed();
  const made = crossCheck(toLeads({ companies: [{ name: 'Gamma Tools', kind_guess: 'employer' }, { name: 'Bluefin Retail' }], people: [person('Kim Lo', 'Gamma Tools'), person('Ann One', 'Bluefin Retail')] }), await loadLeadContext(s2, B));
  const counts = () => Object.fromEntries(['sales_opportunities', 'sales_people', 'sales_lead_uploads', 'sales_source_events'].map(t => [t, s2.db[t].length]));
  const start = counts();
  const bad = resOf();
  // The second row says "create" for a company that is already in Pipeline -> 409 before anything is written.
  await fileLeadsRoute(reqOf({ text: 'x', source: { pick: 'apollo' }, companies: [made[0], { ...made[1], action: 'create' }] }), bad, { supabase: s2, now: NOW, kick: async () => {} });
  assert.equal(bad.code, 409); assert.deepEqual(counts(), start);
  // A write that fails mid-way (the people insert) rolls back the employer and the upload row.
  const orig = s2.from;
  s2.from = t => (t === 'sales_people' ? { insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'boom' } }) }) }) } : orig(t));
  const mid = resOf();
  await fileLeadsRoute(reqOf({ text: 'y', source: { pick: 'apollo' }, companies: [made[0]] }), mid, { supabase: s2, now: NOW, kick: async () => {} });
  assert.equal(mid.code, 500); s2.from = orig; assert.deepEqual(counts(), start);
});

test('source picker: a partner referral must name a partner in Pipeline; person referral needs a name', async () => {
  const res = resOf();
  await extractLeadsRoute(reqOf({ text: 'x', source: { pick: 'partner_referral', partner_id: randomUUID() } }), res, { call: call({}), supabase: seed() });
  assert.equal(res.code, 400); assert.match(res.body.error, /pick the partner/);
  const res2 = resOf();
  await extractLeadsRoute(reqOf({ text: 'x', source: { pick: 'person_referral' } }), res2, { call: call({}), supabase: seed() });
  assert.equal(res2.code, 400);
  const res3 = resOf();
  await extractLeadsRoute(reqOf({ text: 'x', source: { pick: 'partner_referral', partner_id: REF } }), res3, { call: call({ companies: [], people: [] }), supabase: seed() });
  assert.equal(res3.code, 200); assert.equal(res3.body.source.source_partner_id, REF);
});

test("File an unclear company as a target: sales_targets.source = 'manual' (signals-v1 enum), the dated line in research_notes, people in sales_people", async () => {
  const supabase = seed();
  const rows = crossCheck(toLeads({ companies: [{ name: 'Quill & Oak Studio', kind_guess: 'unclear' }], people: [person('Ira Noe', 'Quill & Oak Studio')] }), await loadLeadContext(supabase, B));
  assert.equal(rows[0].kind, 'target');
  const res = resOf();
  await fileLeadsRoute(reqOf({ text: 'Ira Noe @Quill & Oak Studio', source: { pick: 'event', note: 'HR Tech expo' }, companies: rows }), res, { supabase, now: NOW, kick: async () => {} });
  assert.equal(res.code, 201, JSON.stringify(res.body));
  const target = supabase.db.sales_targets.find(t => t.name === 'Quill & Oak Studio');
  assert.equal(target.source, 'manual'); assert.equal(target.source_kind, 'event'); assert.equal(target.channel, 'import');
  assert.match(target.research_notes, /^\(10\/26\) Lead list \(Event\) Oct 26: VP Human Resources$/);
  const ppl = supabase.db.sales_people.filter(p => p.target_id === target.id);
  assert.deepEqual(ppl.map(p => [p.company_type, p.name, p.source_note]), [['target', 'Ira Noe', 'HR Tech expo']]);
});

test('File a new partner: people go to partner_contacts, the why lines ride its note, owner = the uploader', async () => {
  const supabase = seed();
  const rows = crossCheck(toLeads({ companies: [{ name: 'Harbor Benefits Consulting', kind_guess: 'partner' }], people: [person('Alex Doe', 'Harbor Benefits Consulting')] }), await loadLeadContext(supabase, B));
  const res = resOf();
  await fileLeadsRoute(reqOf({ text: 'Alex Doe @Harbor Benefits Consulting', source: { pick: 'apollo' }, companies: rows }), res, { supabase, now: NOW, kick: async () => {} });
  assert.equal(res.code, 201, JSON.stringify(res.body));
  const goal = supabase.db.sales_goals.find(g => g.name === 'Harbor Benefits Consulting');
  assert.equal(goal.source_kind, 'apollo'); assert.equal(goal.channel, 'import');
  assert.deepEqual(supabase.db.partner_contacts.filter(c => c.goal_id === goal.id).map(c => c.name), ['Alex Doe']);
  const note = supabase.db.sales_partner_events.find(e => e.goal_id === goal.id && e.event === 'note');
  assert.match(note.note, /Apollo recommended Oct 26.*Alex Doe \(VP Human Resources\): Recently changed roles/);
  assert.equal(supabase.db.sales_people.length, 0);
});
