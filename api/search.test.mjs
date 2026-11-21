// node --test api/search.test.mjs
// app-shell-v2 Stage 1: GET /api/search over the registry (the sales module's quick reader on fakeSupabase), the
// question test on 12 inputs, the panel-answer rule, the shell registry entry, and a scan proving the core files name
// no workspace. Invented companies and people; 0 Claude, 0 Apollo, no writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fakeSupabase } from './sales/testing/fakeSupabase.mjs';
import { createRegistry } from './scout/registry.js';
import { search, MIN_CHARS } from './search.js';
import { quickSearch, PER_GROUP } from './sales/quickSearch.js';
import { isQuestion, staysInPanel, QUESTION_WORDS, SCOUT_VERBS } from '../src/shell/askRules.js';
import { createShellRegistry, validateEntry, settingsFor, canAdd } from '../src/shell/shellRegistry.js';
import { SALES_SHELL } from '../src/components/salesAnalytics/shellEntry.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const A = 'aaaaaaaa-0000-4000-8000-000000000001', B = 'bbbbbbbb-0000-4000-8000-000000000002', C = 'cccccccc-0000-4000-8000-000000000003';
const u = n => `${n}0000000-0000-4000-8000-000000000000`;
const id = n => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const AT = String.fromCharCode(64);
const TODAY = '2026-11-19', NOW = Date.parse('2026-11-19T16:00:00Z');
const member = { user: { id: u('c') }, isPlatformOwner: false, roles: new Map([[A, 'member']]) };
const viewer = { user: { id: u('e') }, isPlatformOwner: false, roles: new Map([[A, 'viewer']]) };
const owner = { user: { id: u('a') }, isPlatformOwner: true, roles: new Map() };
const todo = (n, business_id, text, extra = {}) => ({ id: id(900 + n), business_id, kind: 'todo', status: 'open', prospect_contact_id: null, text, due_date: null, owner_user_id: u('a'), link_type: null, link_id: null, snooze_until: null, created_at: `2026-11-1${n}T10:00:00Z`, ...extra });
const seed = () => fakeSupabase({
  businesses: [{ id: A, name: 'Alpha', features: { goals_sales: true } }, { id: B, name: 'Beta', features: { goals_sales: true } }, { id: C, name: 'Gamma', features: { second_module: true } }],
  business_members: [{ business_id: A, user_id: u('a'), role: 'owner', created_at: '2026-09-01T00:00:00Z' }, { business_id: A, user_id: u('c'), role: 'member', created_at: '2026-09-02T00:00:00Z' }],
  profiles: [{ id: u('a'), display_name: 'Ana Owner' }, { id: u('c'), display_name: 'Cy Member' }],
  sales_goals: [
    { id: id(1), business_id: A, goal_type: 'partnership', name: 'Metro Life', pipeline_status: 'first_email_sent', owner_user_id: u('a'), archived_at: null },
    { id: id(2), business_id: A, goal_type: 'partnership', name: 'Summit Metals', pipeline_status: 'replied', owner_user_id: u('c'), archived_at: null },
    { id: id(3), business_id: A, goal_type: 'partnership', name: 'Metro Old', pipeline_status: 'live', owner_user_id: u('a'), archived_at: '2026-10-01T00:00:00Z' },
    { id: id(4), business_id: B, goal_type: 'partnership', name: 'Metro Beta Only', pipeline_status: 'live', owner_user_id: null, archived_at: null },
  ],
  sales_opportunities: [
    { id: id(11), business_id: A, organization: 'Metropolis Works', stage: 'qualified', owner_user_id: u('c'), archived_at: null },
    { id: id(12), business_id: A, organization: 'Gourmet Foods', stage: 'target', owner_user_id: null, archived_at: null },
  ],
  sales_targets: [
    { id: id(21), business_id: A, name: 'Metric Labs', status: 'new', owner_user_id: null, employer_id: null },
    { id: id(22), business_id: A, name: 'Metropolis Works', status: 'promoted', owner_user_id: null, employer_id: id(11) },
  ],
  sales_company_scores: [
    { business_id: A, company_type: 'partner', company_id: id(1), score: 68, band: 'P1' },
    { business_id: A, company_type: 'employer', company_id: id(11), score: 41, band: 'P3' },
  ],
  sales_prospect_state: [
    { business_id: A, contact_id: 'ap-1', name: 'Dana Mayer', title: 'People Lead', company: 'Metro Life' },
    { business_id: A, contact_id: 'ap-2', name: 'Metta Stone', title: 'Benefits Manager', company: 'Acme' },
    { business_id: A, contact_id: 'ap-3', name: `lee${AT}metro.test`, title: null, company: 'Metro Life' },
    { business_id: B, contact_id: 'ap-9', name: 'Metta Beta', title: 'CEO', company: 'Metro Beta Only' },
  ],
  partner_contacts: [{ id: id(31), business_id: A, name: 'Dana Mayer', title: null, goal_id: id(1), apollo_contact_id: 'ap-1' }],
  sales_people: [{ id: id(41), business_id: A, name: 'Rae Metcalf', title: 'HR Director', company_name: 'Summit Metals', archived_at: null }],
  sales_person_activity: [{ business_id: A, person_key: 'prospect:ap-1', heat: 12, heat_band: 'warm' }, { business_id: A, person_key: 'prospect:ap-2', heat: 0, heat_band: 'cold' }],
  sales_week_goals: [
    todo(1, A, 'Reply to the Metro intro thread', { due_date: TODAY, link_type: 'partner', link_id: id(1) }),
    todo(2, A, 'Send the one-pager', { link_type: 'partner', link_id: id(1), owner_user_id: u('c') }),
    todo(3, A, 'Call the metro office', { due_date: '2026-11-25', snooze_until: '2026-11-30' }),
    todo(4, A, 'Metro follow-up, done by steps'),
    todo(5, A, 'Metro closed', { status: 'done' }),
    todo(6, A, 'Metro flag', { prospect_contact_id: 'ap-1' }),
    todo(7, B, 'Metro in the other workspace'),
  ],
  sales_week_goal_steps: [{ id: 1, business_id: A, goal_id: id(904), done: true }],
});
const registry = () => { const r = createRegistry(); r.register('sales', { appliesTo: b => !!b.features?.goals_sales, quick: quickSearch, shell: SALES_SHELL }); r.register('second', { appliesTo: b => !!b.features?.second_module }); return r; };
const run = (sb, auth, q, business = A) => search(sb, registry(), { auth, q, business, now: NOW });
const group = (body, key) => body.groups.find(g => g.key === key);

test('search: prefix above contains, three groups, at most 3 rows each with the true count, archived / promoted / done / snoozed rows out', async () => {
  const { status, body } = await run(seed(), member, 'met');
  assert.equal(status, 200);
  assert.deepEqual(body.groups.map(g => [g.key, g.label]), [['companies', 'Companies'], ['people', 'People'], ['todos', 'To-dos']]);
  const co = group(body, 'companies');
  assert.equal(co.count, 5);
  assert.equal(co.items.length, PER_GROUP);
  assert.deepEqual(co.items.map(i => i.title), ['Metro Life', 'Metropolis Works', 'Metric Labs']);
  assert.deepEqual(co.items[0], { id: `partner-${id(1)}`, title: 'Metro Life', sub: 'Partner · 1st email sent', pill: { label: 'P1', value: 68 }, owner: { id: u('a'), name: 'Ana' }, open: { page: 'sales', params: { tab: 'pipeline', view: 'companies', open: `partner-${id(1)}` } } });
  assert.deepEqual([co.items[1].sub, co.items[1].pill, co.items[1].owner?.name], ['Employer · Qualified', { label: 'P3', value: 41 }, 'Cy']);
  assert.deepEqual([co.items[2].sub, co.items[2].pill, co.items[2].owner], ['Target', null, null]);
  const all = await quickSearch(seed(), { businessId: A, q: 'met', today: TODAY });
  assert.ok(!JSON.stringify(all).includes('Metro Old') && !JSON.stringify(all).includes(id(22)));
  const pe = group(body, 'people');
  assert.deepEqual(pe.items.map(i => i.title), ['Metta Stone', 'Rae Metcalf', 'Dana Mayer']);
  assert.equal(pe.count, 3);
  assert.deepEqual(pe.items[2], { id: 'prospect:ap-1', title: 'Dana Mayer', sub: 'People Lead · Metro Life', pill: { label: 'Warm', value: 12 }, owner: null, open: { page: 'sales', params: { tab: 'pipeline', view: 'people', open: 'person:prospect:ap-1' } } });
  assert.equal(pe.items[0].pill, null);
  const td = group(body, 'todos');
  assert.deepEqual(td.items.map(i => [i.title, i.sub, i.due]), [['Reply to the Metro intro thread', 'Metro Life · Ana', TODAY], ['Send the one-pager', 'Metro Life · Cy', null]]);
  assert.equal(td.count, 2);
  assert.deepEqual(td.items[0].open, { page: 'sales', params: { tab: 'actions', open: `todo:${id(901)}` } });
});

test('search: contains matches when no name starts with it; under 2 characters reads nothing; no address shape leaves the route', async () => {
  const sb = seed();
  assert.deepEqual(group((await run(sb, member, 'tals')).body, 'companies').items.map(i => i.title), ['Summit Metals']);
  assert.deepEqual(group((await run(sb, member, 'gourmet')).body, 'companies').items.map(i => i.title), ['Gourmet Foods']);
  assert.equal(MIN_CHARS, 2);
  assert.deepEqual((await run(sb, member, 'm')).body.groups, []);
  assert.deepEqual((await run(sb, member, '  ')).body.groups, []);
  for (const q of ['met', 'metro', 'lee', 'life']) assert.ok(!JSON.stringify((await run(sb, member, q)).body).includes(AT), q);
  assert.equal(group((await run(sb, member, 'zzyx')).body, 'companies').count, 0);
});

test('search: a Viewer reads (200); a member of one workspace never gets another workspace\'s rows; the platform owner may read any; a workspace without the reader returns no group', async () => {
  const sb = seed();
  const v = await run(sb, viewer, 'met');
  assert.equal(v.status, 200);
  assert.equal(group(v.body, 'companies').count, 5);
  const mine = JSON.stringify((await run(sb, member, 'metro')).body);
  assert.ok(!mine.includes('Beta Only') && !mine.includes('Metta Beta') && !mine.includes('other workspace') && !mine.includes(id(4)));
  assert.equal((await run(sb, member, 'metro', B)).status, 403);
  assert.equal((await run(sb, viewer, 'metro', B)).status, 403);
  const o = await run(sb, owner, 'metro', B);
  assert.equal(o.status, 200);
  assert.deepEqual(group(o.body, 'companies').items.map(i => i.title), ['Metro Beta Only']);
  assert.ok(!JSON.stringify(o.body).includes('Metro Life'));
  assert.deepEqual((await run(sb, owner, 'metro', C)).body.groups, []);
  assert.equal((await run(sb, member, 'metro', 'not-an-id')).status, 400);
  assert.equal((await run(sb, owner, 'metro', 'dddddddd-0000-4000-8000-000000000004')).status, 404);
});

test('Q6: the question test on 12 inputs', () => {
  const cases = [
    ['met', false], ['MetLife', false], ['dana mayer', false], ['northrop grumman corporation', false],
    ['who owns metlife', true], ['my overdue to-dos?', true], ['assign metlife to Cyrus', true], ['What’s due this week', true],
    ['draft a note', true], ['is hilton hot', true], ['companies that visited the site yesterday', true], ['  ', false],
  ];
  assert.equal(cases.length, 12);
  for (const [input, want] of cases) assert.equal(isQuestion(input), want, JSON.stringify(input));
  assert.equal(QUESTION_WORDS.length, 15);
  assert.equal(SCOUT_VERBS.length, 12);
  for (const w of [...QUESTION_WORDS, ...SCOUT_VERBS]) assert.equal(isQuestion(`${w} x`), true, w);
  assert.equal(isQuestion('showroom'), false);
});

test('Q7: an answer stays in the panel with 0 sections or 1 section of at most 1 row; a list, an offer or a follow-up opens Scout', () => {
  const row = { entity: 'partners', id: '1', title: 'Metro Life' };
  assert.equal(staysInPanel({ summary: 'Metro Life is Ana’s.', sections: [] }), true);
  assert.equal(staysInPanel({ summary: 'x', sections: [{ title: 'Brief', rows: [row] }] }), true);
  assert.equal(staysInPanel({ summary: 'x', sections: [{ title: 'Brief', rows: [] }] }), true);
  assert.equal(staysInPanel({ summary: 'x', sections: [{ title: 'Top', rows: [row, row] }] }), false);
  assert.equal(staysInPanel({ summary: 'x', sections: [{ rows: [row] }, { rows: [] }] }), false);
  assert.equal(staysInPanel({ summary: 'x', sections: [], offer: { verb: 'assign' } }), false);
  assert.equal(staysInPanel({ summary: 'x', sections: [], resolved: { phrase: 'them' } }), false);
  assert.equal(staysInPanel({ summary: 'no', sections: [], cant: { reason: 'no' } }), true);
  assert.equal(staysInPanel(null), false);
});

test('registry: the sales entry is valid (items · feeds · admin pages), applies by its flag, and the Admin group follows the role', () => {
  assert.deepEqual(validateEntry(SALES_SHELL), []);
  const reg = createShellRegistry([SALES_SHELL]);
  assert.equal(reg.entryFor({ features: { goals_sales: true } }), SALES_SHELL);
  assert.equal(reg.entryFor({ features: {} }), null);
  assert.equal(reg.entryFor(null), null);
  assert.deepEqual(SALES_SHELL.items.map(i => i.label), ['Home', 'Today', 'Pipeline', 'Dashboard', 'Scout', 'Marketing', 'Ideas']);
  assert.deepEqual(SALES_SHELL.items.filter(i => i.group).map(i => [i.label, i.group]), [['Marketing', 'Grow'], ['Ideas', 'Grow']]);
  assert.deepEqual(SALES_SHELL.feeds.map(f => f.label), ['Microsoft', 'Fathom', 'Apollo', 'Site visitors']);
  assert.deepEqual(SALES_SHELL.settings.admin.map(p => p.label), ['Team', 'Connections', 'Switches', 'Recompute', 'Send logs']);
  assert.deepEqual(settingsFor(SALES_SHELL, { role: 'owner' }).admin.map(p => p.id), ['team', 'connections', 'recompute', 'send-logs']);
  assert.deepEqual(settingsFor(SALES_SHELL, { role: 'member', isPlatformOwner: true }).admin.map(p => p.id), ['team', 'connections', 'switches', 'recompute', 'send-logs']);
  for (const role of ['admin', 'member', 'viewer']) assert.deepEqual(settingsFor(SALES_SHELL, { role }).admin, [], role);
  assert.deepEqual(settingsFor(SALES_SHELL, { role: 'viewer' }).workspace.map(p => p.label), ['Team emails', 'Voice profile']);
  assert.deepEqual([canAdd({ role: 'viewer' }), canAdd({ role: 'member' }), canAdd({ role: 'viewer', isPlatformOwner: true })], [false, true, true]);
  assert.throws(() => createShellRegistry([{ id: 'x', appliesTo: () => true, items: [{ id: 'a', label: 'A', icon: 'home', to: {} }], home: 'b' }]), /home b is not an item/);
  assert.throws(() => createShellRegistry([{ ...SALES_SHELL, settings: { admin: [{ id: 'p', label: 'P', icon: 'x', to: {}, gate: 'anyone' }] } }]), /gate must be owner or platform/);
  assert.match(validateEntry({ id: 'x', appliesTo: () => true, items: [] }).join(), /at least one item/);
});

test('core names no workspace: the shell, the search route and core Scout hold no workspace name, no module folder of a single workspace and no feature-flag branch', () => {
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const moduleDirs = [...server.matchAll(/'api\/([a-z0-9_-]+)\/scoutEntities\.js'/g)].map(m => m[1]);
  assert.ok(moduleDirs.length >= 2);
  // The sales folder also holds the shared helpers core imports (scrubText, laDate); every other module folder is one
  // workspace's own tree and must not be referenced from core at all.
  const own = moduleDirs.filter(d => d !== 'sales');
  const dir = (...p) => fs.readdirSync(path.join(ROOT, ...p)).filter(f => /\.js$/.test(f) && !/\.test\./.test(f)).map(f => path.join(...p, f));
  const core = [...dir('src', 'shell'), ...dir('api', 'scout'), path.join('api', 'search.js')];
  assert.ok(core.length >= 9);
  const names = [...new Set(['homelover', ...server.match(/[A-Za-z]+(?=_SCHEDULER)/g).map(s => s.toLowerCase())])];
  for (const file of core) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const n of names) assert.ok(!new RegExp(n, 'i').test(text), `${file} names a workspace`);
    for (const d of own) assert.ok(!new RegExp(`\\b${d}\\b`, 'i').test(text), `${file} references a single workspace's module folder`);
    assert.ok(!/features\??\.[a-z_]+/.test(text), `${file} branches on a feature flag`);
  }
  // The entry itself lists nothing from another workspace's tree.
  const entry = fs.readFileSync(path.join(ROOT, 'src/components/salesAnalytics/shellEntry.js'), 'utf8');
  for (const d of own) assert.ok(!new RegExp(`\\b${d}\\b`, 'i').test(entry));
  for (const n of names.filter(x => x !== 'homelover')) assert.ok(!new RegExp(n, 'i').test(entry));
});
