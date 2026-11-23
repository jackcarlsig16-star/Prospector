// FIX scout-company-lookup - the name index (S1), the Owner row (S2), the owner lead + the assign offer (S3), the
// "no record" state with the visits and "Did you mean" (S4) and the one-part owner ask (S5), on fakeSupabase with the
// real sales module and a mock model. The Stage 0 asks, one by one. 0 Claude, 0 Apollo. Names only - no '@'.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { createRegistry } from '../scout/registry.js';
import { parseAsk, splitAsk, mergeVocab, buildContext } from '../scout/retrieve.js';
import { ask, askDeps } from '../scout/ask.js';
import { plan, actDeps } from '../scout/actions.js';
import { VOCABULARY, register } from './scoutEntities.js';
import { salesReads, salesIntents } from './scoutIntents.js';
import { buildNameIndex, nameIndex, NAME_INDEX_TTL_MS } from './scoutNames.js';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const u = n => `${n}0000000-0000-4000-8000-000000000000`;
const ana = { user: { id: u('a'), name: 'Ana' }, isPlatformOwner: false, roles: new Map([[A, 'member']]) };
const TODAY = '2026-11-19', NOW = Date.parse('2026-11-19T20:00:00Z');
const visit = (id, name, pulled, extra = {}) => ({ id, business_id: A, company_key: `k-${name.toLowerCase().replace(/\W+/g, '-')}`, company_name: name, pulled_on: pulled, last_visit: `${pulled}T09:00:00Z`, matched_type: null, matched_id: null, ...extra });
const FIXTURE = {
  partners: [{ id: u('1'), business_id: A, goal_type: 'partnership', name: 'Hilton Partners', owner_user_id: u('a'), pipeline_status: 'in_sequence', fit_level: null, snoozed_until: null, archived_at: null }],
  employers: [
    { id: u('3'), business_id: A, organization: 'Cloudflare', owner_user_id: u('a'), owner: 'Ana', stage: 'contacted', fit_level: null, archived_at: null },
    { id: u('4'), business_id: A, organization: 'MetLife', owner_user_id: u('b'), owner: 'Bo', stage: 'target', fit_level: null, archived_at: null },
    { id: u('6'), business_id: A, organization: 'Northrop Grumman', owner_user_id: null, owner: null, stage: 'target', fit_level: null, archived_at: null },
  ],
  targets: [
    { id: u('5'), business_id: A, name: 'GreyOrange', owner_user_id: u('c'), status: 'researching', fit_level: null },
    { id: u('7'), business_id: A, name: 'Mission Lane', owner_user_id: null, status: 'researching', fit_level: null },
    { id: u('8'), business_id: A, name: 'Cyrus', owner_user_id: null, status: 'researching', fit_level: null },
  ],
  visits: [
    visit('v1', 'Acme Robotics', '2026-11-17'), visit('v2', 'Acme Robotics', '2026-11-18'), visit('v3', 'ACME Robotics, Inc.', '2026-11-18'),
    visit('v4', 'Grey Orange Robotics', '2026-11-19', { matched_type: 'target', matched_id: u('5') }),
    visit('v5', 'Summit', '2026-11-15'),
    visit('v6', 'Oldco', '2026-07-01'),
  ],
};
const seed = () => fakeSupabase({
  businesses: [{ id: A, name: 'Alpha', features: { goals_sales: true } }],
  business_members: [{ business_id: A, user_id: u('a'), name: 'Ana Member', role: 'member' }, { business_id: A, user_id: u('b'), name: 'Bo Member', role: 'member' }, { business_id: A, user_id: u('c'), name: 'Cyrus Vale', role: 'member' }],
  sales_settings: [{ business_id: A, buyer_titles: [], score_weights: null }],
  sales_goals: FIXTURE.partners, sales_opportunities: FIXTURE.employers, sales_targets: FIXTURE.targets, web_visits: FIXTURE.visits,
  sales_flow_events: [
    { id: 'f1', business_id: A, record_type: 'target', record_id: u('5'), kind: 'assign', meta: { to_owner: u('a') }, at: '2026-11-02T18:00:00Z', undone_at: null },
    { id: 'f2', business_id: A, record_type: 'target', record_id: u('5'), kind: 'assign', meta: { to_owner: u('c') }, at: '2026-11-14T02:30:00Z', undone_at: null },
  ],
  sales_prospect_state: [], sales_week_goals: [], sales_week_goal_steps: [], sales_partner_events: [], partner_contacts: [], sales_call_notes: [], sales_targets_notes: [], business_anthropic_usage: [], sales_company_scores: [], microsoft_messages: [],
  sales_people: [], sales_insights: [], business_intel_entries: [], accounts: [], microsoft_events: [],
});
const reg = async () => { const r = createRegistry(); await register(r); return r; };
const vocab = mergeVocab([VOCABULARY, { sources: {}, members: [{ id: u('a'), name: 'Ana Member' }, { id: u('b'), name: 'Bo Member' }, { id: u('c'), name: 'Cyrus Vale' }] }]);
const names = buildNameIndex(FIXTURE);
const P = q => parseAsk(q, vocab, { today: TODAY, names });
const intents = a => salesIntents.filter(i => i.match(a)).map(i => i.id);
const model = text => { const calls = []; askDeps.now = () => NOW; askDeps.callAnthropic = async a => { calls.push(a); return { content: [{ type: 'text', text }], usage: { input_tokens: 800, output_tokens: 50 } }; }; return calls; };
actDeps.now = () => NOW;
const briefOf = (type, id, name, ownerId = null, owner = null) => async () => ({ status: 200, body: { company: { type, id, name, owner_user_id: ownerId, owner }, score: { score: 61, band: 'P2' }, next_step: null, lines: [{ ref: 'B1', kind: 'company', text: `${name} · ${type} · stage researching` }, { ref: 'B2', kind: 'visit', text: '4 visits in 7 days' }] } });

test('S1 index: records by normName whatever the case, a matched visit is an alias of its record, a visitor-only company carries its days and last visit, older than 90 d is out', () => {
  assert.deepEqual([names.find('greyorange').type, names.find('GREYORANGE').id, names.find('Grey Orange').name], ['target', u('5'), 'GreyOrange']);
  assert.equal(names.find('grey orange robotics').id, u('5'), 'the visit matched to the target under another spelling');
  assert.deepEqual([names.find('hilton partners').type, names.find('metlife').name, names.find('northrop grumman').entity], ['partner', 'MetLife', 'employers']);
  const acme = names.find('acme robotics');
  assert.deepEqual({ type: acme.type, name: acme.name, seen: acme.seen, add: acme.add }, { type: 'visitor', name: 'Acme Robotics', seen: 'seen on the site on 2 days in the last 90, last 2026-11-18', add: { label: 'Add as target', type: 'visitor', id: 'k-acme-robotics' } });
  assert.equal(names.find('nothingco'), null);
  assert.deepEqual(names.near('greyorang').map(e => e.name), ['GreyOrange']);
  assert.deepEqual(names.near('mission').map(e => e.name), ['Mission Lane'], 'a prefix');
  assert.deepEqual(names.near('zzzzzz'), []);
  assert.ok(!JSON.stringify([...Object.values(FIXTURE)]).includes('@'));
});

test('S1 / S3 / S5 the Stage 0 asks through the parser: lower case, mixed case, two words, quoted, the owner phrasings, a member is never a company', () => {
  const co = q => P(q).company;
  assert.deepEqual(co('tell me about greyorange'), ['GreyOrange']);
  assert.deepEqual([co('greyorange'), P('greyorange').flags.brief], [['GreyOrange'], true]);
  assert.deepEqual([co('who owns greyorange'), P('who owns greyorange').flags.owner], [['GreyOrange'], true]);
  assert.deepEqual([co('GreyOrange owner'), P('GreyOrange owner').flags.owner], [['GreyOrange'], true]);
  assert.deepEqual([co("what's up with metlife"), P("what's up with metlife").flags.brief, intents(P("what's up with metlife"))], [['MetLife'], true, ['brief']]);
  assert.deepEqual(co('tell me about grey orange'), ['GreyOrange'], 'two words find the one-word name');
  assert.deepEqual(co('what do we know about "mission lane"'), ['Mission Lane'], 'a quoted name takes the record\'s spelling');
  assert.deepEqual(co('pull the intel on northrop grumman'), ['Northrop Grumman'], 'the longest run wins');
  assert.deepEqual(co('tell me about acme robotics'), ['Acme Robotics'], 'a visitor-only company, when the question is about it');
  assert.deepEqual(co('what should we do at the summit today'), [], 'a visitor called like an everyday word never hijacks another question');
  // a member's first name is a member token, even with a record called the same
  for (const q of ["cyrus's targets", 'cyrus targets', "Cyrus's targets"]) assert.deepEqual(co(q), [], q);
  assert.deepEqual(intents(P("Cyrus's targets")), ['ranked']);
  // a vocabulary or stop word alone is never looked up; other asks keep their route
  assert.deepEqual([co('show me my open tasks'), intents(P('show me my open tasks'))], [[], ['todos']]);
  assert.deepEqual([co('who visited yesterday'), intents(P('who visited yesterday'))], [[], ['visitors']]);
  assert.deepEqual(intents(P('my tasks for metlife')), ['brief', 'todos']);
  // the owner flag
  for (const q of ['who owns greyorange', 'whose is metlife', 'owner of Cloudflare', 'metlife owner', 'metlife owner?']) assert.equal(P(q).flags.owner, true, q);
  for (const q of ['tell me about greyorange', 'tasks with no owner', 'which targets have no owner']) assert.equal(P(q).flags.owner, false, q);
  // S4: a name nothing recognised is kept apart
  assert.deepEqual([co('tell me about nothingco'), P('tell me about nothingco').guess], [[], 'nothingco']);
  assert.equal(P('who owns nothingco').guess, 'nothingco');
  assert.equal(P('tell me about greyorange and who owns').guess, null);
  for (const q of ['what do we know', 'who owns it', 'tell me about my tasks', 'what is the weather']) assert.equal(P(q).guess, null, q);
  // S5: one part
  const signature = a => { const ids = intents(a); return ids.length ? `${ids.join('+')}|${a.entity || ''}` : ''; };
  for (const q of ['tell me about greyorange and who owns', 'tell me about Cloudflare and who owns it', 'tell me about greyorange and who owns it please'])
    assert.equal(splitAsk(q, vocab, { today: TODAY, signature, names }).parts.length, 1, q);
  assert.equal(splitAsk('pull the intel on northrop grumman and show my open tasks', vocab, { today: TODAY, signature, names }).parts.length, 2, 'a real second part still splits');
  const a = P('tell me about greyorange and who owns');
  assert.deepEqual([a.company, a.flags.owner, a.flags.brief], [['GreyOrange'], true, true]);
});

test('S2 / S3 the exact Nov 19 ask: one part, the brief of the record with an Owner row, the answer leads with the owner and the Pacific day it was assigned, one model call', async () => {
  const sb = seed(), registry = await reg();
  salesReads.companyBrief = briefOf('target', u('5'), 'GreyOrange', u('c'), 'Cyrus Vale');
  salesReads.peopleActivity = async () => ({ status: 200, body: { rows: [] } });
  const calls = model('It is a researching target with 4 visits this week.');
  const r = await ask(sb, registry, { auth: ana, body: { q: 'tell me about greyorange and who owns', scope: A } });
  assert.equal(r.status, 200); assert.equal(calls.length, 1);
  assert.equal(r.body.context_stats.intent, 'brief');
  assert.ok(r.body.summary.startsWith('GreyOrange is owned by Cyrus · assigned 2026-11-13. '), r.body.summary);
  assert.equal(r.body.offer, undefined, 'an owned record offers no assign');
  assert.deepEqual(r.body.sections[0].brief.grid.slice(0, 2).map(g => [g.label, g.value]), [['Record', 'target · stage researching'], ['Owner', 'Cyrus']]);
  assert.equal(r.body.sections[0].brief.owner, undefined, 'the owner detail stays on the server');
  assert.deepEqual(r.body.items.map(i => [i.entity, i.id]), [['targets', u('5')]], 'the record rides as a row even when the model cited nothing');
  assert.match(calls[0].messages.at(-1).content, /The answer already opens with the owner/);
  assert.match(calls[0].messages.at(-1).content, /"company":\["GreyOrange"\]/);
  assert.ok(!/my open to-dos/.test(calls[0].messages.at(-1).content), 'no default reads');
  assert.ok(!JSON.stringify(r.body).includes('@'));
  // the model opened by restating the owner (seen live): it is said once, in the server's words
  model('GreyOrange is owned by Cyrus Vale, assigned 2026-11-13.\n\nHere is a full picture: a researching target.');
  const again = await ask(sb, registry, { auth: ana, body: { q: 'who owns greyorange', scope: A } });
  assert.equal(again.body.summary, 'GreyOrange is owned by Cyrus · assigned 2026-11-13. Here is a full picture: a researching target.');
  // the bare name and the lower-case brief reach the same record, with no owner lead
  model('It is a researching target.');
  const b = await ask(sb, registry, { auth: ana, body: { q: 'greyorange', scope: A } });
  assert.equal(b.body.context_stats.intent, 'brief'); assert.ok(!b.body.summary.startsWith('GreyOrange is owned'));
  assert.equal(b.body.sections[0].brief.id, u('5'));
});

test('S3 nobody owns it: "… has no owner — assign it?" with the assign verb offered on that row, and the offer plans a card that writes nothing; a person leads with their owner', async () => {
  const sb = seed(), registry = await reg();
  salesReads.companyBrief = briefOf('target', u('7'), 'Mission Lane');
  salesReads.peopleActivity = async () => ({ status: 200, body: { rows: [] } });
  model('A researching target.');
  const r = await ask(sb, registry, { auth: ana, body: { q: 'who owns mission lane', scope: A } });
  assert.ok(r.body.summary.startsWith('Mission Lane has no owner — assign it? '), r.body.summary);
  assert.deepEqual(r.body.offer, { verb: 'assign', key: `targets:${u('7')}`, label: 'Assign' });
  assert.equal(r.body.sections[0].brief.grid[1].value, 'Unassigned');
  const before = JSON.stringify(sb.tables?.sales_targets || FIXTURE.targets);
  const card = await plan(sb, registry, { auth: ana, body: { scope: A, verb: 'assign', keys: [r.body.offer.key], args: { owner_user_id: u('b') }, rows: r.body.items } });
  assert.equal(card.status, 200);
  assert.deepEqual(card.body.rows.map(x => [x.title, x.from, x.to]), [['Mission Lane', 'Unassigned', 'Bo']]);
  assert.equal(JSON.stringify(sb.tables?.sales_targets || FIXTURE.targets), before, 'the card is shown, nothing is written');
  // a person: their own owner
  salesReads.peopleActivity = async () => ({ status: 200, body: { rows: [{ key: 'prospect:p1', name: 'Dana Mayer', title: 'VP People', owner_user_id: u('b'), company: { type: 'employer', id: u('3'), name: 'Cloudflare', stage: 'contacted' }, source: 'Apollo sequence', emails: { sent: 1, opened: 1, clicked: 0, replied: 0 }, last_email: null, heat: 40, heat_band: 'warm', visits: null, identified_at: null, buyer: false }] } });
  salesReads.personDetail = async () => ({ status: 200, body: { timeline: [], notes: null } });
  const p = await ask(sb, registry, { auth: ana, body: { q: 'who owns Dana Mayer', scope: A } });
  assert.ok(p.body.summary.startsWith('Dana Mayer is owned by Bo. '), p.body.summary);
  assert.deepEqual(p.body.sections[0].brief.grid[1], { label: 'Owner', value: 'Bo' });
});

test('S3 "who owns the second one" points at the row on screen and leads with its owner', async () => {
  const sb = seed(), registry = await reg();
  salesReads.companyBrief = briefOf('employer', u('4'), 'MetLife', u('b'), 'Bo Member');
  salesReads.peopleActivity = async () => ({ status: 200, body: { rows: [] } });
  const calls = model('An employer at the target stage.');
  const rows = [{ entity: 'employers', id: u('3'), title: 'Cloudflare' }, { entity: 'employers', id: u('4'), title: 'MetLife' }];
  const r = await ask(sb, registry, { auth: ana, body: { q: 'who owns the second one', scope: A, rows } });
  assert.equal(calls.length, 1);
  assert.ok(r.body.summary.startsWith('MetLife is owned by Bo. the second one → MetLife. '), r.body.summary);
  const none = await ask(sb, registry, { auth: ana, body: { q: 'who owns the second one', scope: A } });
  assert.ok(none.body.cant && !none.body.usage, 'nothing on screen to point at: said plainly, no call');
});

test('S4 a name nothing carries: no default reads, no model call, no ask counted - with the visits and Add as target for a visitor-only company, and "Did you mean" for a near name', async () => {
  const sb = seed(), registry = await reg();
  salesReads.peopleActivity = async () => ({ status: 200, body: { rows: [] } });
  let standing = 0;
  // FIX scout-generative G2: the standing context is the agenda's read set (Today, Top targets, goals/weekly)
  const real = { loadToday: salesReads.loadToday, topTargets: salesReads.topTargets, loadWeekly: salesReads.loadWeekly };
  salesReads.loadToday = async () => { standing += 1; return ({ view: { groups: [], strip: [], counts: { overdue: 0 } } }); };
  salesReads.topTargets = async () => ({ status: 200, body: { rows: [] } });
  salesReads.loadWeekly = async () => ({ status: 200, body: { week_start: '2026-11-16', metrics: [] } });
  const calls = model('should never be asked');
  const r = await ask(sb, registry, { auth: ana, body: { q: 'tell me about nothingco', scope: A } });
  assert.equal(r.status, 200); assert.equal(calls.length, 0); assert.equal(standing, 0);
  assert.deepEqual(r.body.cant, { reason: 'No record named nothingco in Prospector' });
  assert.deepEqual([r.body.usage, r.body.cap.used, r.body.sections.length], [null, 0, 0]);
  const cap = await ask(sb, registry, { auth: ana, body: { q: 'who owns Nothing Co', scope: A } });
  assert.deepEqual(cap.body.cant, { reason: 'No record named Nothing Co in Prospector' }, 'a capitalised name with no record or person');
  const v = await ask(sb, registry, { auth: ana, body: { q: 'tell me about acme robotics', scope: A } });
  assert.deepEqual(v.body.cant, { reason: 'No record named Acme Robotics in Prospector · seen on the site on 2 days in the last 90, last 2026-11-18', add: { label: 'Add as target', type: 'visitor', id: 'k-acme-robotics', name: 'Acme Robotics' } });
  const near = await ask(sb, registry, { auth: ana, body: { q: 'who owns greyorang', scope: A } });
  assert.deepEqual(near.body.cant, { reason: 'No record named greyorang in Prospector', did_you_mean: true, candidates: [{ key: `targets:${u('5')}`, entity: 'targets', id: u('5'), title: 'GreyOrange', ask: 'who owns "GreyOrange"' }] });
  assert.equal(calls.length, 0);
  assert.equal(P(near.body.cant.candidates[0].ask).company[0], 'GreyOrange', 'the offered question finds the record');
  // an ask with no name in it keeps its fallback reads
  const c = await buildContext(sb, registry, { auth: ana, scope: A, q: 'what is the weather', now: NOW });
  assert.equal(c.cant, undefined); assert.equal(c.stats.intent, 'none'); assert.ok(standing > 0);
  Object.assign(salesReads, real);
});

test('the index is read once per client and business for 5 minutes', async () => {
  const sb = seed();
  const a = await nameIndex(sb, { businessId: A, today: TODAY, now: NOW });
  assert.equal(await nameIndex(sb, { businessId: A, today: TODAY, now: NOW + NAME_INDEX_TTL_MS - 1 }), a);
  assert.notEqual(await nameIndex(sb, { businessId: A, today: TODAY, now: NOW + NAME_INDEX_TTL_MS }), a);
  assert.notEqual(await nameIndex(seed(), { businessId: A, today: TODAY, now: NOW }), a, 'another client reads its own');
  assert.equal(a.find('oldco'), null);
  assert.equal(a.find('summit').type, 'visitor');
});
