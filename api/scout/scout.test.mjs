// scout-v2 REV2 Stage 1 - core Scout on fakeSupabase with a stub module (the registry names no workspace): scoping on
// both routes, the hasPii drop + count, the pack cap, ref resolution, the daily cap, the usage row through a mock
// Anthropic. 0 Claude, 0 Apollo, no writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeSupabase } from '../sales/testing/fakeSupabase.mjs';
import { createRegistry, scopedBusinesses } from './registry.js';
import { parseAsk, mergeVocab, buildContext, PACK_MAX } from './retrieve.js';
import { search, PER_GROUP, TOTAL } from './search.js';
import { ask, askDeps, resolveRefs, DAILY_CAP, MAX_TOKENS, CALL_TYPE, SYSTEM, LIST_MAX } from './ask.js';
import { MODELS } from '../../src/config/models.js';

const A = 'aaaaaaaa-0000-4000-8000-000000000001', B = 'bbbbbbbb-0000-4000-8000-000000000002', C = 'cccccccc-0000-4000-8000-000000000003';
const member = { user: { id: 'u-ana', name: 'Ana' }, isPlatformOwner: false, roles: new Map([[A, 'member']]) };
const owner = { user: { id: 'u-jack', name: 'Jack' }, isPlatformOwner: true, roles: new Map() };
const businesses = [{ id: A, name: 'Alpha', features: { goals_sales: true } }, { id: B, name: 'Beta', features: { goals_sales: true } }, { id: C, name: 'Gamma', features: { other_module: true } }];
// The [rN] label a context gave a record / the line in the prompt that carries a text.
const byRec = (ctx, ref) => [...ctx.items.values()].find(i => `${i.entity}:${i.id}` === ref);
const labelOf = (ctx, ref) => [...ctx.items.entries()].find(([, i]) => `${i.entity}:${i.id}` === ref)?.[0];
const labelIn = (content, text) => (new RegExp(`\\[(r\\d+)\\] ${text}`).exec(content) || [])[1];
const thing = (business_id, i, extra = {}) => ({ id: `t-${business_id.slice(0, 1)}-${i}`, business_id, name: `Thing ${i} of ${business_id.slice(0, 1)}`, note: `note ${i}`, updated_at: `2026-11-0${(i % 5) + 1}T10:00:00Z`, ...extra });

// A stub module: one entity over a `things` table, one intent that lists them when the ask names "things".
function stubModule(flag = 'goals_sales', entity = 'things') {
  return {
    appliesTo: b => !!b.features?.[flag],
    vocabulary: { entities: { [entity]: ['thing', 'things'] }, bands: { hot: 'P1' }, sources: { brad: 'upside' } },
    entities: [{ entity, label: 'Things', open: id => ({ page: 'sales', params: { tab: 'pipeline', open: `thing-${id}` } }),
      async search(sb, { businessId, q, limit }) { const { data } = await sb.from('things').select('id, name, note, updated_at').eq('business_id', businessId).or(`name.ilike.%${q}%,note.ilike.%${q}%`).limit(limit); return data.map(r => ({ id: r.id, title: r.name, subtitle: r.note, date: r.updated_at.slice(0, 10), text: `${r.name} · ${r.note}` })); } }],
    intents: [{ id: 'list', match: a => a.entity === entity, async run(sb, { businessId }) { const { data } = await sb.from('things').select('id, name, note').eq('business_id', businessId); return { read: 'things list', items: data.map(r => ({ entity, id: r.id, title: r.name, text: `${r.name} · ${r.note}` })) }; } }],
    standing: async () => ({ reads: ['standing'], items: [{ entity, id: 'standing-1', title: 'Standing item', text: 'Standing item · always here' }] }),
    glossary: async (sb, { business }) => ({ lines: [`Band words for ${business.name}`], vocabulary: { sources: { brad: 'upside' } } }),
  };
}
const registryWith = (...mods) => { const r = createRegistry(); mods.forEach(([n, m]) => r.register(n, m)); return r; };
const seed = (extra = {}) => fakeSupabase({ businesses, things: [...Array.from({ length: 5 }, (_, i) => thing(A, i)), ...Array.from({ length: 5 }, (_, i) => thing(B, i))], business_anthropic_usage: [], ...extra });

test('scoping: a member of A sees 0 rows from B on search and ask; scope B is refused; the platform owner sees both with workspace tags', async () => {
  const sb = seed(), reg = registryWith(['stub', stubModule()]);
  const s = await search(sb, reg, { auth: member, q: 'thing', scope: 'all' });
  assert.equal(s.groups.length, 1);
  assert.ok(s.groups[0].items.every(i => i.workspace_id === A && i.workspace_name === 'Alpha'));
  assert.equal(s.groups[0].items.filter(i => i.id.startsWith('t-b')).length, 0);
  await assert.rejects(() => search(sb, reg, { auth: member, q: 'thing', scope: B }), /not in that workspace/);
  const c = await buildContext(sb, reg, { auth: member, scope: 'all', q: 'show me things' });
  assert.ok(c.lines.length === 5 && c.lines.every(l => / of a/.test(l)) && !c.pack.includes('workspace'));
  const o = await search(sb, reg, { auth: owner, q: 'thing', scope: 'all' });
  assert.deepEqual([...new Set(o.groups[0].items.map(i => i.workspace_name))].sort(), ['Alpha', 'Beta']);
  const oc = await buildContext(sb, reg, { auth: owner, scope: 'all', q: 'show me things' });
  assert.equal(oc.lines.length, 10);
  assert.ok(oc.lines.some(l => l.endsWith(' · workspace Alpha')) && oc.lines.some(l => l.endsWith(' · workspace Beta')));
  assert.deepEqual(oc.stats.workspaces, ['Alpha', 'Beta']);
  const scoped = await scopedBusinesses(sb, owner, 'all');
  assert.equal(scoped.length, 3);
  // The module applies by its own flag: a workspace on another module's flag gets no entities from a goals_sales module.
  assert.equal(reg.entitiesFor(scoped.find(b => b.id === C)).length, 0);
});

test('search: at most 8 per group and 40 in all, ordered by the registry, with openers; under 2 chars returns nothing', async () => {
  const groups = Array.from({ length: 6 }, (_, g) => [`m${g}`, stubModule('goals_sales', `kind${g}`)]);
  const sb = seed({ things: Array.from({ length: 50 }, (_, i) => thing(A, i)) });
  const s = await search(sb, registryWith(...groups), { auth: member, q: 'thing', scope: A });
  assert.equal(s.groups.length, 6);
  assert.ok(s.groups.every(g => g.items.length <= PER_GROUP));
  assert.equal(s.groups.reduce((n, g) => n + g.items.length, 0), TOTAL);
  assert.equal(s.groups[0].entity, 'kind0');
  assert.deepEqual(s.groups[0].items[0].open, { page: 'sales', params: { tab: 'pipeline', open: `thing-${s.groups[0].items[0].id}` } });
  assert.deepEqual((await search(sb, registryWith(...groups), { auth: member, q: 't', scope: A })).groups, []);
});

test('context: a line that trips hasPii is dropped and counted; the pack stays under the cap and counts what it cut; items carry openers', async () => {
  const many = Array.from({ length: 200 }, (_, i) => thing(A, i, { note: `a long note ${'x'.repeat(90)} ${i}` }));
  many[3].note = 'DM @ana on Slack';
  many[4].note = 'ping @sam first';
  many[5].note = 'call ana at ana@example.com or 312-555-0100';
  const sb = seed({ things: many });
  const c = await buildContext(sb, registryWith(['stub', stubModule()]), { auth: member, scope: A, q: 'show me things' });
  assert.equal(c.stats.dropped_pii, 2);
  assert.ok(!c.pack.includes('@') && !c.pack.includes('312-555') && c.pack.includes('[email removed]') && c.pack.includes('[number removed]'));
  assert.ok(c.stats.chars <= PACK_MAX && c.pack.length <= PACK_MAX);
  assert.ok(c.stats.truncated > 0 && c.lines.length + c.stats.truncated + 2 === 200);
  assert.deepEqual(c.stats.rows_by_entity, { things: c.lines.length });
  assert.deepEqual(c.stats.reads, ['things list']);
  const first = byRec(c, 'things:t-a-0');
  assert.ok(c.lines.every(l => /^\[r\d+\] /.test(l)) && c.lines.every(l => !l.includes('t-a-')));
  assert.deepEqual(first.open, { page: 'sales', params: { tab: 'pipeline', open: 'thing-t-a-0' } });
  assert.equal(first.workspace_name, 'Alpha');
  // The fallback (no intent): the entity search + the standing context, both named in reads.
  const f = await buildContext(sb, registryWith(['stub', stubModule()]), { auth: member, scope: A, q: 'tell me about note 7' });
  assert.deepEqual(f.stats.reads, ['search things', 'standing']);
  assert.ok(f.lines.some(l => l.startsWith(`[${labelOf(f, 'things:standing-1')}] Standing item`)));
});

test('parse: "my open tasks", "notes from last week about Equifax", "hot targets Brad referred", "who visited yesterday" read as the spec says', async () => {
  const { VOCABULARY } = await import('../sales/scoutEntities.js');
  const vocab = mergeVocab([VOCABULARY, { sources: { brad: 'upside' } }]);
  const today = '2026-11-06';
  const a = parseAsk('show me my open tasks', vocab, { today });
  assert.equal(a.mine, true); assert.equal(a.entity, 'todos'); assert.equal(a.since, null);
  const b = parseAsk('notes from last week about Equifax', vocab, { today });
  assert.equal(b.entity, 'call_notes'); assert.equal(b.since, '2026-10-26'); assert.equal(b.until, '2026-11-01'); assert.deepEqual(b.company, ['Equifax']);
  const c = parseAsk('hot targets Brad referred, sorted by score', vocab, { today });
  assert.equal(c.entity, 'targets'); assert.equal(c.band, 'P1'); assert.equal(c.source, 'upside'); assert.equal(c.sort, 'score'); assert.deepEqual(c.company, []);
  const d = parseAsk('who visited yesterday and are they in Prospector', vocab, { today });
  assert.equal(d.flags.visitors, true); assert.equal(d.since, '2026-11-05'); assert.equal(d.until, '2026-11-05'); assert.equal(d.since_kind, 'yesterday');
  const e = parseAsk('which partners did I touch this week', vocab, { today });
  assert.equal(e.entity, 'partners'); assert.equal(e.mine, true); assert.equal(e.since, '2026-11-02');
  assert.equal(parseAsk('show me Mission Lane', vocab, { today }).mine, false);
  assert.deepEqual(parseAsk('what do my notes say about "Mission Lane"', vocab, { today }).company, ['Mission Lane']);
});

test('refs: [rN] labels map back to their records - [r12] is record 12, never [r1] - one item each; unknown labels dropped', () => {
  const items = new Map(Array.from({ length: 12 }, (_, i) => [`r${i + 1}`, { entity: 'things', id: `id-${i + 1}`, title: `Thing ${i + 1}` }]));
  const r = resolveRefs('First [r12], then [r1] and [r2], again [r12]; not [r99] or [r1x].', items);
  assert.equal(r.answer_md, 'First Thing 12, then Thing 1 and Thing 2, again Thing 12; not or [r1x].');
  assert.deepEqual(r.items.map(i => i.id), ['id-12', 'id-1', 'id-2']);
});

test('ask: one Claude call with the server prompt, STANDARD, 1200 tokens, thinking off, callType scout_ask -> the usage row; refs resolved; the glossary and filters ride along; 429 at the daily cap; an answer with an address is withheld', async () => {
  const sb = seed(), reg = registryWith(['stub', stubModule()]);
  const calls = [];
  askDeps.callAnthropic = async args => { calls.push(args); sb.db.business_anthropic_usage.push({ user_id: args.userId, business_id: args.businessId, call_type: args.callType, created_at: new Date().toISOString() }); return { content: [{ type: 'text', text: `Your things, newest first — [${labelIn(args.messages.at(-1).content, 'Thing 1 of a')}] then [${labelIn(args.messages.at(-1).content, 'Thing 0 of a')}] and [r999].` }], usage: { input_tokens: 900, output_tokens: 120 } }; };
  const r = await ask(sb, reg, { auth: member, body: { q: 'show me things', scope: A, thread: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }] } });
  assert.equal(r.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].callType, CALL_TYPE); assert.equal(calls[0].max_tokens, MAX_TOKENS); assert.equal(calls[0].thinking, false); assert.equal(calls[0].model, MODELS.STANDARD);
  assert.equal(calls[0].businessId, A); assert.equal(calls[0].userId, 'u-ana');
  assert.ok(calls[0].system.startsWith(SYSTEM) && calls[0].system.includes('Band words for Alpha'));
  assert.equal(calls[0].messages.length, 3);
  assert.ok(calls[0].messages[2].content.includes('CONTEXT (5 lines)') && /\[r\d+\] Thing 0 of a · note 0/.test(calls[0].messages[2].content) && !calls[0].messages[2].content.includes('t-a-0') && calls[0].system.includes('like [r3]'));
  assert.equal(sb.db.business_anthropic_usage.length, 1);
  assert.equal(sb.db.business_anthropic_usage[0].call_type, 'scout_ask');
  assert.equal(r.body.answer_md, 'Your things, newest first - Thing 1 of a then Thing 0 of a and .');
  assert.deepEqual(r.body.items.map(i => i.id), ['t-a-1', 't-a-0']);
  assert.equal(r.body.items[0].open.params.open, 'thing-t-a-1');
  assert.equal(r.body.usage.input_tokens, 900); assert.equal(typeof r.body.usage.cost_usd, 'number');
  assert.deepEqual(r.body.context_stats.reads, ['things list']);
  assert.equal(r.body.cap.used, 1);
  // Scope all for a member: a null businessId on the usage row, only A's rows in the context.
  const all = await ask(sb, reg, { auth: member, body: { q: 'show me things', scope: 'all' } });
  assert.equal(all.status, 200); assert.equal(calls[1].businessId, null); assert.ok(!calls[1].messages[0].content.includes(' of b'));
  // The cap.
  while (sb.db.business_anthropic_usage.length < DAILY_CAP) sb.db.business_anthropic_usage.push({ user_id: 'u-ana', call_type: 'scout_ask', created_at: new Date().toISOString() });
  const capped = await ask(sb, reg, { auth: member, body: { q: 'show me things', scope: A } });
  assert.equal(capped.status, 429); assert.equal(calls.length, 2); assert.match(capped.body.error, /40 questions/);
  // Another user is not capped; an answer carrying an address is withheld.
  askDeps.callAnthropic = async args => { calls.push(args); return { content: [{ type: 'text', text: 'Write to jack@example.com about [r1]' }], usage: { input_tokens: 10, output_tokens: 5 } }; };
  const w = await ask(sb, reg, { auth: owner, body: { q: 'show me things', scope: A } });
  assert.equal(w.status, 200); assert.equal(w.body.withheld, true); assert.ok(!/@/.test(w.body.answer_md)); assert.deepEqual(w.body.items, []);
  // Stage 3 finding: an answer citing records is NOT withheld (the check reads the shown text, labels resolved).
  askDeps.callAnthropic = async args => { calls.push(args); return { content: [{ type: 'text', text: `Two: [${labelIn(args.messages.at(-1).content, 'Thing 1 of a')}] and [r777].` }], usage: { input_tokens: 10, output_tokens: 5 } }; };
  const ids = await ask(sb, reg, { auth: owner, body: { q: 'show me things', scope: A } });
  assert.equal(ids.body.withheld, false); assert.equal(ids.body.answer_md, 'Two: Thing 1 of a and .'); assert.deepEqual(ids.body.items.map(i => i.id), ['t-a-1']);
  // Validation and a foreign scope.
  assert.equal((await ask(sb, reg, { auth: owner, body: { q: 'x' } })).status, 400);
  assert.equal((await ask(sb, reg, { auth: member, body: { q: 'show me things', scope: B } })).status, 403);
  assert.equal((await ask(sb, reg, { auth: member, body: { q: 'show me things', scope: A, thread: [{ role: 'system', content: 'x' }] } })).status, 400);
  askDeps.callAnthropic = null;
});

test('list cap: the prompt names at most 15 in the prose; "+ n more (in the table): [r16] …" keeps its words and puts every label in the items', () => {
  assert.equal(LIST_MAX, 15);
  assert.ok(SYSTEM.includes('List at most 15 records in the prose') && SYSTEM.includes('+ n more (in the table): '));
  const items = new Map(Array.from({ length: 20 }, (_, i) => [`r${i + 1}`, { entity: 'todos', id: `t${i + 1}`, title: `Task ${i + 1}` }]));
  const prose = Array.from({ length: 15 }, (_, i) => `- [r${i + 1}] due soon`).join('\n');
  const r = resolveRefs(`Your open tasks, by due date:\n${prose}\n+ 5 more (in the table): [r16] [r17] [r18] [r19] [r20] [r99]`, items);
  assert.equal(r.items.length, 20);
  assert.deepEqual(r.items.map(i => i.id).slice(14), ['t15', 't16', 't17', 't18', 't19', 't20']);
  assert.ok(r.answer_md.endsWith('- Task 15 due soon\n+ 5 more (in the table)'));
  assert.ok(!/Task 1[6-9]|Task 20/.test(r.answer_md));
});

// FIX scout-ask-routing-v1
test('A1 parse: apostrophes go, stems match by ending (visiting, hottest, fused "hottestperson"), "hotel" / "personal" match nothing; A3 bandKind is heat on a people ask and intent on a company ask', async () => {
  const { VOCABULARY } = await import('../sales/scoutEntities.js');
  const { stemHits } = await import('./retrieve.js');
  const vocab = mergeVocab([VOCABULARY, { sources: { brad: 'upside' } }]);
  const today = '2026-11-09';
  const stems = Object.keys(vocab.stems).sort((a, b) => b.length - a.length);
  assert.deepEqual(['visiting', 'visitors', 'hottest', 'hottestperson', 'website', 'persons', 'hotel', 'personal', 'webinar'].map(t => [...stemHits(t, stems)].sort().join('+')), ['visit', 'visit', 'hot', 'hot+person', 'website', 'person', '', '', '']);
  // "hottest" (a band stem in the superlative) ranks by heat; it is not the hot band alone (the live run showed 8 of 19).
  const a = parseAsk("who's our hottest person visiting the website", vocab, { today });
  assert.deepEqual([a.entity, a.flags.visitors, a.flags.site, a.band, a.bandKind, a.sort, a.flags.ranked, a.terms, a.mine], ['people', true, true, null, null, 'heat', true, [], false]);
  const b = parseAsk("who's our hottestperson visiting the website", vocab, { today });
  assert.deepEqual([b.entity, b.flags.visitors, b.band, b.sort, b.terms], ['people', true, null, 'heat', []]);
  const c = parseAsk('hottest people on the site this week', vocab, { today });
  assert.deepEqual([c.entity, c.flags.visitors, c.flags.site, c.band, c.sort, c.since], ['people', false, true, null, 'heat', '2026-11-09']);
  const w = parseAsk('warm people visiting the site', vocab, { today });
  assert.deepEqual([w.entity, w.band, w.bandKind, w.sort], ['people', 'P2', 'heat', null]);
  const d = parseAsk('hot targets Brad referred', vocab, { today });
  assert.deepEqual([d.entity, d.band, d.bandKind, d.source], ['targets', 'P1', 'intent', 'upside']);
  const e = parseAsk('whos replied', vocab, { today });
  assert.deepEqual([e.entity, e.flags.replied, e.terms, e.bandKind], [null, true, [], null]);
  const f = parseAsk("I've got a hotel question about personal plans", vocab, { today });
  assert.deepEqual([f.mine, f.band, f.entity], [true, null, null]);
  assert.deepEqual(parseAsk('who visited yesterday', vocab, { today }).entity, null, 'a visit verb is the flag, not the visitors entity');
});

test('A5 fallback: no intent matched -> stats.intent "none", the first context line names the standing reads and three example phrasings (the suggest ones first); a matched ask carries its intent id; both ride on the ask body and the model sees the line', async () => {
  const mod = stubModule();
  mod.intents = [
    { id: 'list', example: 'list the things', match: a => a.entity === 'things', async run() { return { read: 'things list', items: [{ entity: 'things', id: 'x', title: 'X', text: 'X · thing' }] }; } },
    { id: 'two', example: 'second phrasing', suggest: true, match: () => false, async run() { return { read: '', items: [] }; } },
    { id: 'three', example: 'third phrasing', match: () => false, async run() { return { read: '', items: [] }; } },
    { id: 'four', example: 'fourth phrasing', match: () => false, async run() { return { read: '', items: [] }; } },
  ];
  const reg = registryWith(['stub', mod]);
  const db = seed();
  const none = await buildContext(db, reg, { auth: member, scope: A, q: 'what is the weather' });
  assert.equal(none.stats.intent, 'none');
  assert.equal(none.lines[0], "No specific read matched this question; the context below is the standing summary (standing). Try: 'second phrasing' · 'list the things' · 'third phrasing'");
  assert.ok(none.lines.length > 1 && !none.lines[0].startsWith('['), 'the line is not a record');
  const hit = await buildContext(db, reg, { auth: member, scope: A, q: 'show me the things' });
  assert.equal(hit.stats.intent, 'list'); assert.ok(!hit.lines.some(l => l.startsWith('No specific read')));
  let seen = null;
  askDeps.callAnthropic = async ({ messages }) => { seen = messages.at(-1).content; return { content: [{ type: 'text', text: 'Nothing in those lists answers this.' }], usage: { input_tokens: 10, output_tokens: 5 } }; };
  const r = await ask(db, reg, { auth: member, body: { q: 'what is the weather', scope: A } });
  assert.equal(r.status, 200); assert.equal(r.body.context_stats.intent, 'none'); assert.ok(seen.includes('No specific read matched this question'));
  assert.ok(SYSTEM.includes('Never direct the user to a screen'));
  askDeps.callAnthropic = null;
});

test('A4: no Scout file says "Huddle"', async () => {
  const fs = await import('fs'); const path = await import('path');
  const root = new URL('../../', import.meta.url).pathname;
  const dirs = ['api/scout', 'src/components/scout'].flatMap(d => fs.readdirSync(path.join(root, d)).filter(f => f.endsWith('.js')).map(f => `${d}/${f}`));
  const files = [...dirs, 'api/sales/scoutEntities.js', 'api/sales/scoutIntents.js', 'api/sales/scoutImport.js', 'src/components/ScoutCommandBar.js', 'src/components/PersistentScout.js', 'src/utils/scoutLayers.js', 'src/utils/buildScoutContext.js', 'src/components/ledger/ScoutModal.js', 'src/components/salesAnalytics/tasks/ScoutUpload.js'];
  const hits = files.filter(f => /Huddle/.test(fs.readFileSync(path.join(root, f), 'utf8')));
  assert.deepEqual(hits, [], 'the Huddle was deleted by people-v2; Scout must not name it');
  assert.ok(files.length >= 15);
});
