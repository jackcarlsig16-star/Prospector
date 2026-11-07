// scout-v2 REV2 Stage 1 - the sales module's Scout readers on fakeSupabase: every entity's search (names, titles and
// text only - never an address), the openers (D2), the Outlook gate, the glossary's words from the data (D7), and the
// intents routed to the existing reads through the salesReads seam. 0 Claude, 0 Apollo, no writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { createRegistry } from '../scout/registry.js';
import { buildContext } from '../scout/retrieve.js';
import { ENTITIES, VOCABULARY, register } from './scoutEntities.js';
import { salesReads, findCompany } from './scoutIntents.js';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const u = n => `${n}0000000-0000-4000-8000-000000000000`;
const auth = { user: { id: u('a'), name: 'Ana' }, isPlatformOwner: false, roles: new Map([[A, 'member']]) };
const seed = () => fakeSupabase({
  businesses: [{ id: A, name: 'Alpha', features: { goals_sales: true } }],
  business_members: [{ business_id: A, user_id: u('a'), name: 'Ana Member', role: 'member', created_at: '2026-10-01T00:00:00Z' }],
  sales_settings: [{ business_id: A, buyer_titles: ['Head of People', 'VP Benefits'], score_weights: null }],
  sales_goals: [{ id: u('1'), business_id: A, goal_type: 'partnership', name: 'Hilton Partners', company_domain: 'hilton.example', notes: 'Met Brad; call ana@example.com next', category: 'Hospitality', pipeline_status: 'in_sequence', owner_user_id: u('a'), archived_at: null, updated_at: '2026-11-05T00:00:00Z' },
    { id: u('2'), business_id: A, goal_type: 'partnership', name: 'Archived Co', company_domain: null, notes: 'hilton', category: null, pipeline_status: 'paused', archived_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }],
  sales_opportunities: [{ id: u('3'), business_id: A, organization: 'Hilton', stage: 'contacted', cohort: 'Hotels', notes: null, owner: 'Cyrus', client_status: null, domain: 'hilton.com', archived_at: null, updated_at: '2026-11-04T00:00:00Z' },
    { id: u('4'), business_id: A, organization: 'Equifax', stage: 'launched', cohort: 'Finance', notes: 'signed', owner: 'Jack', client_status: 'launched', covered_lives: 1200, launch_date: '2026-10-15', domain: 'equifax.com', archived_at: null, updated_at: '2026-11-01T00:00:00Z' }],
  sales_targets: [{ id: u('5'), business_id: A, name: 'Mission Lane', status: 'candidate', kind: 'company', evidence: 'Visited pricing twice', research_notes: null, co_owner_name: 'Brad Pitt', owner_team: 'upside', updated_at: '2026-11-03T00:00:00Z' }],
  sales_week_goals: [{ id: u('6'), business_id: A, kind: 'todo', text: 'Call Hilton about the pilot', status: 'open', due_date: '2026-11-07', owner_user_id: u('a'), week_start: '2026-11-02', updated_at: '2026-11-05T00:00:00Z', created_at: '2026-11-05T00:00:00Z' },
    { id: u('7'), business_id: A, kind: 'todo', text: 'Send Equifax the deck', status: 'done', due_date: null, owner_user_id: u('b'), week_start: '2026-10-26', updated_at: '2026-10-28T00:00:00Z', created_at: '2026-10-27T00:00:00Z' }],
  sales_week_goal_steps: [],
  sales_call_notes: [{ id: u('8'), business_id: A, title: 'Equifax kickoff', call_date: '2026-10-28', text: 'They want a pilot in Q1. Reach Sam at 312-555-0100.' }, { id: u('9'), business_id: A, title: 'Hilton intro', call_date: '2026-11-04', text: 'Hilton wants wellness perks.' }],
  sales_insights: [{ id: u('c'), business_id: A, kind: 'track', text: 'Track pilot start dates', why: 'Hilton asked twice', status: 'open', created_at: '2026-11-01T00:00:00Z' }],
  business_intel_entries: [{ id: u('d'), business_id: A, source: 'call_log', content: 'Hilton prefers quarterly reviews', created_at: '2026-10-30T00:00:00Z' }],
  accounts: [{ id: u('e'), business_id: A, data: { name: 'Hilton Grand', web: 'hiltongrand.example', notes: 'legacy account' }, updated_at: '2026-09-01T00:00:00Z' }],
  sales_prospect_state: [{ business_id: A, contact_id: 'c1', name: 'Pat Hilton', title: 'Head of People', company: 'Marriott', email: 'pat@example.com' }],
  sales_people: [{ id: u('f'), business_id: A, name: 'Sam Visitor', title: 'VP Benefits', company_name: 'Hilton', source_kind: 'web_visit', archived_at: null }],
  partner_contacts: [{ id: u('b'), business_id: A, name: 'Lee Partner', title: 'Director', email: 'lee@example.com' }],
  microsoft_messages: [{ business_id: A, graph_id: 'g1', subject: 'Hilton pilot pricing follow up', direction: 'received', occurred_at: '2026-11-03T15:00:00Z', external_domains: ['hilton.com'], mailbox_email: 'me@example.com' }],
  microsoft_events: [{ business_id: A, graph_id: 'e1', subject: 'Hilton pilot kickoff call', start_at: '2026-11-10T17:00:00Z', external_domains: ['hilton.com'] }],
  sales_company_scores: [], business_anthropic_usage: [],
});
const by = entity => ENTITIES.find(e => e.entity === entity);
const ctx = (sb, q, limit = 8) => ({ businessId: A, q, words: q.toLowerCase().split(/\s+/), limit, today: '2026-11-06' });

test('entities: every search hits by name / title / text, skips archived rows, never carries an address, and opens the right place', async () => {
  const sb = seed();
  const partners = await by('partners').search(sb, ctx(sb, 'hilt'));
  assert.deepEqual(partners.map(p => p.title), ['Hilton Partners']);
  assert.ok(!/@/.test(JSON.stringify(partners)));
  assert.deepEqual(by('partners').open(u('1')), { page: 'sales', params: { tab: 'pipeline', view: 'companies', open: `partner-${u('1')}` } });
  const employers = await by('employers').search(sb, ctx(sb, 'hotels'));
  assert.deepEqual(employers.map(e => e.title), ['Hilton']);
  assert.deepEqual(by('employers').open(u('3')).params.open, `employer-${u('3')}`);
  assert.deepEqual((await by('targets').search(sb, ctx(sb, 'pricing'))).map(t => t.title), ['Mission Lane']);
  const clients = await by('clients').search(sb, ctx(sb, 'equi'));
  assert.equal(clients[0].subtitle, 'client · launched');
  assert.deepEqual(by('clients').open(u('4')).params, { tab: 'pipeline', view: 'clients', open: `employer-${u('4')}` });
  const people = await by('people').search(sb, ctx(sb, 'hilton'));
  assert.deepEqual(people.map(p => p.id).sort(), ['person:' + u('f'), 'prospect:c1'].sort());
  assert.ok(!/@/.test(JSON.stringify(people)));
  assert.deepEqual(by('people').open('prospect:c1').params, { tab: 'pipeline', view: 'people', open: 'person:prospect:c1' });
  const todos = await by('todos').search(sb, ctx(sb, 'equifax'));
  assert.equal(todos[0].subtitle, 'done');
  assert.deepEqual(by('todos').open(u('7')).params, { tab: 'actions', open: `todo:${u('7')}` });
  const notes = await by('call_notes').search(sb, ctx(sb, 'pilot'));
  assert.equal(notes[0].title, 'Equifax kickoff');
  assert.ok(!/312-555/.test(JSON.stringify(notes)) && by('call_notes').open(u('8')).inline === true);
  assert.equal((await by('insights').search(sb, ctx(sb, 'asked twice')))[0].subtitle, 'track · open');
  assert.equal((await by('intel').search(sb, ctx(sb, 'quarterly')))[0].subtitle, 'call_log');
  assert.deepEqual((await by('accounts').search(sb, ctx(sb, 'grand'))).map(a => a.title), ['Hilton Grand']);
  assert.deepEqual(by('accounts').open(u('e')), { page: 'accounts', params: { account: u('e') } });
  // Outlook: subject + date + domain only, and only on 3+ words.
  const outlook = by('outlook');
  assert.equal(outlook.gate({ words: ['hilton', 'pilot'] }), false);
  assert.equal(outlook.gate({ words: ['hilton', 'pilot', 'pricing'] }), true);
  const mail = await outlook.search(sb, ctx(sb, 'hilton pilot'));
  assert.deepEqual(mail.map(m => m.subtitle), ['email received · 2026-11-03 · hilton.com', 'meeting · 2026-11-10 · hilton.com']);
  assert.ok(!/me@/.test(JSON.stringify(mail)));
});

test('glossary (D7): band thresholds, heat rule, stages, source labels, the rep from the data (Brad -> Upside), members and buyer titles', async () => {
  const g = await (await import('./scoutEntities.js')).glossary(seed(), { businessId: A });
  assert.match(g.lines[0], /P1 = Hot \(score ≥ 60\)/);
  assert.match(g.lines[1], /hot = score ≥ 40/);
  assert.match(g.lines[2], /Partner stages: Not started, Researching/);
  assert.match(g.lines[3], /upside = Brad \/ Upside/);
  assert.match(g.lines[3], /Reps: Brad refers through Upside/);
  assert.match(g.lines[4], /Members: Ana Member \(member/);
  assert.match(g.lines[5], /Buyer titles: Head of People, VP Benefits/);
  assert.equal(g.vocabulary.sources.brad, 'upside');
  assert.equal(g.vocabulary.sources.upside, 'upside');
  assert.equal(g.vocabulary.sources['partner referral'], 'partner_referral');
  assert.equal(g.vocabulary.sources.website, undefined);
});

test('intents route to the existing reads: tasks -> openTodos (mine), hot targets Brad referred -> goals/scores band P1 source upside, visitors yesterday -> the visitor loader, notes about Equifax -> the brief + the notes query; a company by name resolves exact first', async () => {
  const sb = seed();
  const calls = [];
  const stub = (name, out) => async (...a) => { calls.push([name, a]); return out; };
  salesReads.openTodosFor = stub('openTodosFor', { rows: [{ id: u('6'), text: 'Call Hilton about the pilot', due_date: '2026-11-07', owner_user_id: u('a'), created_at: '2026-11-05', steps: [] }], total: 1 });
  salesReads.listScores = stub('listScores', { status: 200, body: { rows: [{ type: 'target', id: u('5'), name: 'Mission Lane', score: 72, band: 'P1', rank: 1, source_label: 'upside', co_owner_name: 'Brad Pitt', stage: 'candidate', owner: null, last_touch_at: '2026-11-04T00:00:00Z' }], counts: { shown: 1 } } });
  salesReads.loadVisitorData = stub('loadVisitorData', [{ company: 'Hilton', type: 'employer', id: u('3'), visit_id: 'v1', score: 61, band: 'P1', visits: 7, visitors: 3, pages: 2, paths: ['/pricing'], people: 1, titles: ['VP Benefits'], is_new: false, stage: 'contacted', owner: 'Cyrus', last_touch: null }, { company: 'Newco', type: null, id: null, visit_id: 'v2', score: 12, band: 'P4', visits: 1, visitors: 1, pages: 1, paths: ['/'], people: 0, titles: [], is_new: true, stage: null, owner: 'Unassigned' }]);
  salesReads.companyBrief = stub('companyBrief', { status: 200, body: { company: { type: 'employer', id: u('4'), name: 'Equifax' }, score: { score: 55, band: 'P2' }, next_step: 'Send agreement', lines: [{ ref: 'B1', kind: 'company', text: 'Equifax · employer · stage launched' }, { ref: 'B2', kind: 'touch', text: 'Last touch: 3 days ago' }] } });
  const reg = createRegistry(); await register(reg);
  reg.modules[0].glossary = async () => ({ lines: [], vocabulary: { sources: { brad: 'upside' } } });
  const run = q => buildContext(sb, reg, { auth, scope: A, q, now: Date.parse('2026-11-06T20:00:00Z') });

  const t = await run('show me my open tasks');
  assert.deepEqual(calls.at(-1)[0], 'openTodosFor'); assert.equal(calls.at(-1)[1][2], u('a'));
  assert.ok(t.lines[0].startsWith(`[todos:${u('6')}] Call Hilton about the pilot · open to-do · due 2026-11-07 · mine`));
  assert.deepEqual(t.items.get(`todos:${u('6')}`).open.params, { tab: 'actions', open: `todo:${u('6')}` });

  const h = await run('hot targets Brad referred, sorted by score');
  assert.equal(calls.at(-1)[0], 'listScores');
  assert.deepEqual(calls.at(-1)[1][2], { segment: 'targets', band: 'P1', source: 'upside', owner: '', sort: 'rank' });
  assert.match(h.lines[0], /^\[targets:.*\] Mission Lane · target · score 72 P1 · rank 1 · source upside \(Brad Pitt\)/);
  // Stage 3 finding: "2026-11-04 (2 d)" read as one phone-shaped run and was blanked; the date must survive the scrub.
  assert.match(h.lines[0], /last touch 2026-11-04 · \d+ d ago/); assert.ok(!h.lines[0].includes('[number removed]'));
  assert.equal(h.items.get(`targets:${u('5')}`).score, 72);
  assert.deepEqual(h.stats.reads, [`goals/scores {"segment":"targets","band":"P1","source":"upside","owner":"","sort":"rank"} (1 shown)`]);

  const v = await run('who visited yesterday and are they in Prospector');
  assert.equal(calls.at(-1)[0], 'loadVisitorData');
  assert.deepEqual(calls.at(-1)[1][2].window.days, ['2026-11-05']);
  assert.match(v.lines[0], /^\[employers:.*\] Hilton · P1 score 61 · 7 visits · 3 visitors · 2 pages \(\/pricing\) · 1 named people \(VP Benefits\) · returning · in Prospector as employer · contacted · owner Cyrus/);
  assert.match(v.lines[1], /^\[visitor:v2\] Newco · .* · new to the site · not in Prospector yet/);

  const n = await run('notes from last week about Equifax');
  assert.equal(calls.at(-1)[0], 'companyBrief'); assert.deepEqual(calls.at(-1)[1][1], { businessId: A, type: 'employer', id: u('4') });
  assert.ok(n.lines.some(l => l === `[employers:${u('4')}] Equifax · employer · intent 55 P2 · next: Send agreement`));
  assert.ok(n.lines.some(l => l === `[employers:${u('4')}] Equifax · touch: Last touch: 3 days ago`));
  assert.ok(n.lines.some(l => l.startsWith(`[call_notes:${u('8')}] Equifax kickoff · 2026-10-28`)) && !n.pack.includes('312-555'));
  assert.ok(n.stats.reads.some(r => r.startsWith('goals/brief/employer/')) && n.stats.reads.some(r => /call notes since 2026-10-26/.test(r)));
  assert.equal((await findCompany(sb, A, 'hilton')).type, 'employer');
  assert.equal((await findCompany(sb, A, 'Hilton Partners')).type, 'partner');
  assert.equal(await findCompany(sb, A, 'Nobody Inc'), null);
});

test('scout-v2 Stage 3: intent-only rows (visitor / pulse / funnel / attention) still open their nearest list, inline', async () => {
  const reg = createRegistry();
  await register(reg);
  assert.deepEqual(reg.openerFor('visitor')('v1'), { page: 'sales', params: { tab: 'pipeline', view: 'companies', channel: 'website_visit' }, inline: true });
  assert.deepEqual(reg.openerFor('pulse')('x'), { page: 'sales', params: { tab: 'dashboard', view: 'analytics' }, inline: true });
  assert.deepEqual(reg.openerFor('funnel')('x'), { page: 'sales', params: { tab: 'dashboard', view: 'sources' }, inline: true });
  assert.deepEqual(reg.openerFor('attention')('x'), { page: 'sales', params: { tab: 'actions' }, inline: true });
  assert.equal(reg.openerFor('nothing'), null);
  assert.deepEqual(reg.openerFor('employers')('e1'), { page: 'sales', params: { tab: 'pipeline', view: 'companies', open: 'employer-e1' } });
});
