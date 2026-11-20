// node --test api/fathom/fathom.test.mjs
// The fixture is hand-written: names only. Where a test needs something address- or phone-shaped to prove it is
// dropped, it is assembled at run time so this file itself holds neither.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fakeSupabase } from '../sales/testing/fakeSupabase.mjs';

process.env.FATHOM_TOKEN_KEY = crypto.randomBytes(32).toString('base64');
const { toNote, extractSource, TRANSCRIPT_MAX } = await import('./toNote.js');
const { sealer, verifySignature, fathomDeps } = await import('./client.js');
const { receive } = await import('./webhook.js');
const { FATHOM_CALL_TYPE, laDayStart } = await import('./extract.js');
const routes = await import('./routes.js');
const notes = await import('../sales/callNotesRoutes.js');
const { goalsDeps } = await import('../sales/goalsShared.js');

const AT = String.fromCharCode(64);
const address = who => `${who}${AT}example.test`;
const PHONE = ['415', '555', '0100'].join(' ');
const B = '11111111-1111-4111-8111-111111111111', JACK = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'T'.repeat(43);
const SECRET = `whsec_${crypto.randomBytes(24).toString('base64')}`;
const NOW = new Date('2026-11-20T18:00:00Z');

const meeting = (id = 9001, over = {}) => ({
  title: 'Dana / Jack', meeting_title: 'Northwind weekly', meeting_type: null, recording_id: id,
  url: `https://fathom.video/calls/${id}`, share_url: `https://fathom.video/share/abc${id}`,
  created_at: '2026-11-20T17:40:00Z', scheduled_start_time: '2026-11-20T17:00:00Z', scheduled_end_time: '2026-11-20T17:30:00Z',
  recording_start_time: '2026-11-20T17:01:00Z', recording_end_time: '2026-11-20T17:31:00Z',
  calendar_invitees_domains_type: 'one_or_more_external', shared_with: 'no_teams', transcript_language: 'en',
  transcript: [
    { speaker: { display_name: 'Jack Carlson', matched_calendar_invitee_email: address('jack') }, text: 'Thanks for joining.', timestamp: '00:00:05' },
    { speaker: { display_name: 'Dana Reyes', matched_calendar_invitee_email: address('dana') }, text: `Call me on ${PHONE} after lunch.`, timestamp: '01:05:32' },
    { speaker: { display_name: address('guest'), matched_calendar_invitee_email: null }, text: `Write to ${address('dana')} with the list.`, timestamp: '01:06:00' },
  ],
  default_summary: { template_name: 'general', markdown_formatted: [
    '## Decisions',
    `- Northwind will pilot in January ([watch](https://fathom.video/calls/${id}?timestamp=123456789.5))`,
    `- Dana's direct line is ${PHONE}`,
    `- Send the list to ${address('dana')}`,
  ].join('\n') },
  action_items: [
    { description: 'Send the pilot one-pager', user_generated: false, completed: false, recording_timestamp: '00:10:00', recording_playback_url: `https://fathom.video/calls/${id}?timestamp=600`, assignee: { name: 'Jack Carlson', email: address('jack'), team: null } },
    { description: 'Share the employer list', user_generated: false, completed: true, recording_timestamp: '00:12:00', recording_playback_url: `https://fathom.video/calls/${id}?timestamp=720`, assignee: { name: null, email: null, team: null } },
  ],
  calendar_invitees: [
    { name: 'Jack Carlson', matched_speaker_display_name: 'Jack Carlson', email: address('jack'), email_domain: 'homelover.test', is_external: false },
    { name: 'Dana Reyes', matched_speaker_display_name: 'Dana Reyes', email: address('dana'), email_domain: 'northwind.test', is_external: true },
    { name: address('guest'), matched_speaker_display_name: null, email: address('guest'), email_domain: 'northwind.test', is_external: true },
  ],
  recorded_by: { name: 'Jack Carlson', email: address('jack'), email_domain: 'homelover.test', team: null },
  crm_matches: null,
  ...over,
});

const strings = v => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []);
const noAt = (v, label) => assert.ok(!strings(v).some(s => s.includes(AT)), `${label}: an "${AT}" was stored`);

test('toNote: every address dropped, a phone line withheld, links unwrapped, action items kept as text', () => {
  const n = toNote(meeting());
  noAt(n, 'note');
  assert.ok(!JSON.stringify(n).includes(PHONE));
  assert.equal(n.fathom_recording_id, 9001);
  assert.equal(n.title, 'Northwind weekly');
  assert.equal(n.source_label, 'Fathom · Northwind weekly');
  assert.equal(n.call_date, '2026-11-20');
  assert.equal(n.fathom_url, 'https://fathom.video/share/abc9001');
  const lines = n.text.split('\n');
  assert.equal(lines[1], '- Northwind will pilot in January (watch)');
  assert.equal(lines[2], '[line withheld]');
  assert.equal(lines[3], '- Send the list to [email removed]');
  assert.ok(n.text.endsWith('Action items (Fathom)\n- Send the pilot one-pager — Jack Carlson\n- Share the employer list — unassigned [done]'));
  assert.deepEqual(n.attendees, [
    { name: 'Jack Carlson', is_external: false, domain: 'homelover.test' },
    { name: 'Dana Reyes', is_external: true, domain: 'northwind.test' },
    { name: null, is_external: true, domain: 'northwind.test' },
  ]);
});

test('toNote: transcript lines are "<name> [mm:ss]: <text>", cut at the cap with the full length noted', () => {
  const t = toNote(meeting()).transcript.split('\n');
  assert.equal(t[0], 'Jack Carlson [00:05]: Thanks for joining.');
  assert.equal(t[1], 'Dana Reyes [65:32]: [line withheld]');
  assert.equal(t[2], 'Speaker [66:00]: Write to [email removed] with the list.');
  const long = toNote(meeting(1, { transcript: Array.from({ length: 4000 }, (_, i) => ({ speaker: { display_name: 'Dana Reyes' }, text: 'word '.repeat(12), timestamp: '00:00:01' })) }));
  assert.equal(long.transcript.length, TRANSCRIPT_MAX);
  assert.match(long.transcript, /\n… transcript truncated \(full length \d+ characters\)$/);
});

test('toNote: no summary -> the transcript is what gets extracted; no recording id -> nothing; the hash is per recording', () => {
  const bare = toNote(meeting(7, { default_summary: null, action_items: null }));
  assert.equal(bare.has_summary, false);
  assert.equal(extractSource(bare), bare.transcript);
  assert.equal(extractSource(toNote(meeting())), toNote(meeting()).text);
  assert.equal(toNote({ title: 'x' }), null);
  assert.notEqual(toNote(meeting(7, { default_summary: null, action_items: null })).hash, toNote(meeting(8, { default_summary: null, action_items: null })).hash);
});

const sign = (id, ts, body, secret = SECRET) => `v1,${crypto.createHmac('sha256', Buffer.from(secret.slice(6), 'base64')).update(`${id}.${ts}.${body}`).digest('base64')}`;

test('signature: the right secret passes; a changed body, another secret and a stale timestamp do not', () => {
  const ts = String(Math.floor(NOW.getTime() / 1000));
  const ok = { secret: SECRET, id: 'msg_1', timestamp: ts, signature: sign('msg_1', ts, '{"a":1}'), rawBody: '{"a":1}', now: NOW.getTime() };
  assert.equal(verifySignature(ok), true);
  assert.equal(verifySignature({ ...ok, signature: `v1,AAAA ${ok.signature}` }), true);
  assert.equal(verifySignature({ ...ok, rawBody: '{"a":2}' }), false);
  assert.equal(verifySignature({ ...ok, secret: `whsec_${crypto.randomBytes(24).toString('base64')}` }), false);
  assert.equal(verifySignature({ ...ok, now: NOW.getTime() + 301e3 }), false);
  assert.equal(verifySignature({ ...ok, signature: undefined }), false);
});

const reply = { summary: ['Pilot agreed', 'List owed', 'Next call set'], tasks: [{ text: 'Send Northwind the pilot one-pager', owner: 'Jack', due_date: null, link: null, company_name: 'Northwind', steps: [], evidence: 'Send the pilot one-pager' }],
  companies: [{ name: 'Northwind', kind: 'employer', category: null, ownership: null, referred_by: null, evidence: 'Northwind will pilot' }], people: [], touches: [], facts: [], decisions: [], waiting_on: [], terms: [], next_meeting: null,
  ideas: [{ text: 'A pilot dashboard the employer can open', kind: 'product', company: 'Northwind', evidence: 'could we see it live' }, { text: 'No evidence, dropped', kind: 'product', company: null, evidence: '' }, { text: 'Odd kind', kind: 'pricing', company: null, evidence: 'said so' }],
  track: [], optimize: [], channel_links: [] };

function world({ usage = 0, cap = 10 } = {}) {
  const supabase = fakeSupabase({
    businesses: [{ id: B, name: 'Workspace' }],
    business_members: [{ business_id: B, user_id: JACK, name: 'Jack Carlson', role: 'owner' }],
    sales_settings: [{ business_id: B, fathom_extract_cap: cap }],
    sales_fathom_connections: [{ id: 'c1', business_id: B, user_id: JACK, key_enc: sealer.encrypt('k'.repeat(40)), webhook_secret_enc: sealer.encrypt(SECRET), webhook_token: TOKEN, fathom_webhook_id: 'wh_123456', status: 'connected', backfill_after: null, backfill_cursor: null }],
    sales_fathom_events: [], sales_call_notes: [],
    business_anthropic_usage: Array.from({ length: usage }, () => ({ business_id: B, call_type: FATHOM_CALL_TYPE, created_at: new Date(NOW.getTime() - 60e3).toISOString() })),
  }, { now: () => NOW.getTime(), unique: { sales_fathom_events: r => r.webhook_id, sales_call_notes: [{ name: 'hash', key: r => `${r.business_id}:${r.hash}` }, { name: 'rec', key: r => (r.fathom_recording_id == null ? null : `${r.business_id}:${r.fathom_recording_id}`) }] } });
  let calls = 0;
  notes.extractDeps.call = async ({ supabase: sb, businessId, callType }) => {
    calls++;
    await sb.from('business_anthropic_usage').insert({ business_id: businessId, call_type: callType });
    return { content: [{ type: 'text', text: JSON.stringify(reply) }], usage: { input_tokens: 10, output_tokens: 10 } };
  };
  return { supabase, calls: () => calls };
}
const res = () => { const r = { code: 200, body: null, headersSent: false, status(c) { r.code = c; return r; }, json(b) { r.body = b; r.headersSent = true; return r; } }; return r; };
function hook(m, { id = 'msg_1', secret = SECRET, token = TOKEN } = {}) {
  const rawBody = JSON.stringify(m), ts = String(Math.floor(NOW.getTime() / 1000));
  return { params: { token }, headers: { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': sign(id, ts, rawBody, secret) }, rawBody, body: m };
}

test('webhook: a bad signature or an unknown token is 401 and nothing is stored', async () => {
  const w = world();
  for (const req of [hook(meeting(), { secret: `whsec_${crypto.randomBytes(24).toString('base64')}` }), hook(meeting(), { token: 'U'.repeat(43) }), { ...hook(meeting()), rawBody: '{}' }]) {
    const r = res();
    await receive(req, r, { supabase: w.supabase, now: NOW });
    assert.equal(r.code, 401);
  }
  assert.equal(w.supabase.db.sales_fathom_events.length, 0);
  assert.equal(w.supabase.db.sales_call_notes.length, 0);
  assert.equal(w.calls(), 0);
});

test('webhook: a recording becomes ONE note with a stored proposal - not accepted, no "@" anywhere, 1 model call', async () => {
  const w = world();
  const r = res();
  await receive(hook(meeting()), r, { supabase: w.supabase, now: NOW });
  assert.equal(r.code, 200);
  const [note] = w.supabase.db.sales_call_notes;
  assert.equal(w.supabase.db.sales_call_notes.length, 1);
  assert.equal(note.created_by, JACK);
  assert.equal(note.accepted_at ?? null, null);
  assert.equal(note.extract.tasks.length, 1);
  assert.equal(w.calls(), 1);
  assert.deepEqual(w.supabase.db.sales_fathom_events.map(e => [e.webhook_id, e.recording_id, e.status]), [['msg_1', 9001, 'extracted']]);
  for (const table of ['sales_call_notes', 'sales_fathom_events']) noAt(w.supabase.db[table], table);
  assert.ok(!JSON.stringify(w.supabase.db.sales_call_notes).includes(PHONE));
});

test('webhook: a replayed webhook-id does no work; the same recording under a new id does no work either', async () => {
  const w = world();
  await receive(hook(meeting()), res(), { supabase: w.supabase, now: NOW });
  const again = res();
  await receive(hook(meeting()), again, { supabase: w.supabase, now: NOW });
  assert.deepEqual([again.code, again.body.duplicate], [200, true]);
  await receive(hook(meeting(), { id: 'msg_2' }), res(), { supabase: w.supabase, now: NOW });
  assert.equal(w.supabase.db.sales_call_notes.length, 1);
  assert.equal(w.calls(), 1);
  assert.deepEqual(w.supabase.db.sales_fathom_events.map(e => e.status), ['extracted', 'duplicate']);
});

test('the daily cap stops the 11th extraction: the note is stored without a proposal and no model call is made', async () => {
  const w = world({ usage: 9 });
  await receive(hook(meeting(1), { id: 'a' }), res(), { supabase: w.supabase, now: NOW });
  await receive(hook(meeting(2), { id: 'b' }), res(), { supabase: w.supabase, now: NOW });
  assert.equal(w.calls(), 1);
  assert.deepEqual(w.supabase.db.sales_fathom_events.map(e => e.status), ['extracted', 'capped']);
  assert.deepEqual(w.supabase.db.sales_call_notes.map(n => !!n.extract), [true, false]);
  // Yesterday's calls do not count against today.
  assert.ok(laDayStart(NOW).toISOString() === '2026-11-20T08:00:00.000Z' && laDayStart(new Date('2026-07-01T18:00:00Z')).toISOString() === '2026-07-01T07:00:00.000Z');
});

const asJack = (extra = {}) => ({ params: { businessId: B }, body: {}, query: {}, auth: { user: { id: JACK }, isPlatformOwner: false, roles: new Map([[B, 'owner']]) }, protocol: 'https', get: h => (h === 'host' ? 'app.test' : undefined), ...extra });

test('pull: stops at 5 pages with "more", stores without extracting, and the next click continues from the cursor', async () => {
  const w = world();
  goalsDeps.supabase = w.supabase;
  const asked = [];
  fathomDeps.fetch = async url => {
    const u = new URL(url), c = Number(u.searchParams.get('cursor') || 0);
    asked.push({ c, key: null, summary: u.searchParams.get('include_summary'), after: u.searchParams.get('created_after') });
    return { ok: true, status: 200, json: async () => ({ limit: 2, items: [meeting(100 + c * 2), meeting(101 + c * 2)], next_cursor: c < 6 ? String(c + 1) : null }) };
  };
  const first = res();
  await routes.pullRoute(asJack(), first);
  assert.deepEqual({ ...first.body }, { stored: 10, already: 0, skipped: 0, pages: 5, page_size: 2, more: true, stopped: null });
  assert.equal(asked.length, 5);
  assert.ok(asked.every(a => a.summary === 'true' && a.after));
  assert.equal(w.calls(), 0);
  assert.ok(w.supabase.db.sales_call_notes.every(n => n.extract == null && n.accepted_at == null));
  const second = res();
  await routes.pullRoute(asJack(), second);
  assert.deepEqual([second.body.stored, second.body.pages, second.body.more], [4, 2, false]);
  assert.deepEqual(asked.map(a => a.c), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(new Set(asked.map(a => a.after)).size, 1);
  const third = res();
  await routes.pullRoute(asJack(), third);
  assert.equal(third.code, 409);
  assert.equal(asked.length, 7);
  noAt(w.supabase.db.sales_call_notes, 'pulled notes');
});

test('connection routes: the key and the secret never come back; register asks for my_recordings only; disconnect keeps the row', async () => {
  const w = world();
  w.supabase.db.sales_fathom_connections.length = 0;
  goalsDeps.supabase = w.supabase;
  const sent = [];
  fathomDeps.fetch = async (url, init) => {
    sent.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    if (init.method === 'POST') return { ok: true, status: 201, json: async () => ({ id: 'wh_abcd1234', secret: SECRET }) };
    if (init.method === 'DELETE') return { ok: true, status: 204 };
    return { ok: true, status: 200, json: async () => ({ limit: 10, items: [meeting()], next_cursor: null }) };
  };
  const key = 'k'.repeat(48);
  const made = res();
  await routes.connectRoute(asJack({ body: { key } }), made);
  assert.equal(made.code, 201);
  const tested = res();
  await routes.testRoute(asJack(), tested);
  assert.deepEqual(tested.body, { ok: true, last_recording: '2026-11-20' });
  assert.ok(!sent[0].url.includes('include_'));
  const reg = res();
  await routes.registerRoute(asJack(), reg);
  assert.equal(reg.code, 201);
  assert.deepEqual(sent[1].body.triggered_for, ['my_recordings']);
  assert.match(sent[1].body.destination_url, /^https:\/\/app\.test\/api\/fathom\/webhook\/[A-Za-z0-9_-]{43}$/);
  const local = res();
  await routes.registerRoute(asJack({ protocol: 'http' }), local);
  assert.equal(local.code, 409);
  const status = res();
  await routes.statusRoute(asJack(), status);
  assert.equal(status.body.webhook_id_tail, '1234');
  for (const r of [made, tested, reg, status]) assert.ok(!JSON.stringify(r.body).includes(key) && !JSON.stringify(r.body).includes(SECRET) && !/key_enc|secret|webhook_token/.test(JSON.stringify(r.body)));
  const [row] = w.supabase.db.sales_fathom_connections;
  assert.ok(row.key_enc !== key && sealer.decrypt(row.key_enc) === key && sealer.decrypt(row.webhook_secret_enc) === SECRET);
  const off = res();
  await routes.disconnectRoute(asJack(), off);
  assert.deepEqual([off.body.connected, off.body.webhook_deleted, sent[2].method], [false, true, 'DELETE']);
  assert.equal(w.supabase.db.sales_fathom_connections.length, 1);
  const viewer = res();
  await routes.connectRoute(asJack({ body: { key, user_id: '33333333-3333-4333-8333-333333333333' }, auth: { user: { id: JACK }, isPlatformOwner: false, roles: new Map([[B, 'member']]) } }), viewer);
  assert.equal(viewer.code, 403);
});

test('review of a stored note is rebuilt with no model call; ideas ride along, the unevidenced one dropped', async () => {
  const w = world();
  goalsDeps.supabase = w.supabase;
  await receive(hook(meeting()), res(), { supabase: w.supabase, now: NOW });
  const [note] = w.supabase.db.sales_call_notes;
  const r = res();
  await notes.reviewCallNoteRoute(asJack({ params: { businessId: B, id: note.id } }), r);
  assert.equal(r.code, 200);
  assert.equal(w.calls(), 1);
  assert.equal(r.body.tasks[0].text, 'Send Northwind the pilot one-pager');
  assert.equal(r.body.tasks[0].owner_user_id, JACK);
  assert.deepEqual(r.body.ideas.map(i => [i.text, i.kind]), [['A pilot dashboard the employer can open', 'product'], ['Odd kind', 'other']]);
  assert.ok(!('extract' in r.body.note) && !('text' in r.body.note));
  w.supabase.db.sales_call_notes[0].extract = null;
  const empty = res();
  await notes.reviewCallNoteRoute(asJack({ params: { businessId: B, id: note.id } }), empty);
  assert.equal(empty.body.needs_extract, true);
});

test('accept on a stored note never inserts and never deletes: a refused accept leaves it waiting, a second accept is 409', async () => {
  const w = world();
  goalsDeps.supabase = w.supabase;
  await receive(hook(meeting()), res(), { supabase: w.supabase, now: NOW });
  const [note] = w.supabase.db.sales_call_notes;
  const call = async body => { const r = res(); await notes.acceptCallNoteRoute(asJack({ params: { businessId: B, id: note.id }, body }), r); return r; };
  const nothing = await call({ tasks: [] });
  assert.equal(nothing.code, 400);
  assert.equal(w.supabase.db.sales_call_notes.length, 1);
  assert.equal(w.supabase.db.sales_call_notes[0].accepted_at ?? null, null);
  const ok = await call({ tasks: [{ text: 'Send Northwind the pilot one-pager', owner_user_id: JACK }] });
  assert.equal(ok.code, 200, JSON.stringify(ok.body));
  assert.equal(w.supabase.db.sales_call_notes.length, 1);
  assert.ok(w.supabase.db.sales_call_notes[0].accepted_at);
  assert.equal(w.supabase.db.sales_week_goals.filter(g => g.source_note_id === note.id).length, 1);
  assert.equal((await call({ tasks: [{ text: 'Again' }] })).code, 409);
  assert.equal(w.supabase.db.sales_week_goals.filter(g => g.source_note_id === note.id).length, 1);
});

test('both sign-in gates let the tokened webhook path through by prefix - POST only, nothing else under it', async () => {
  const require = createRequire(import.meta.url);
  const { basicAuth } = require('../basicAuth.js');
  const { sessionAuth } = await import('../lib/requireAuth.js');
  const was = { e: process.env.BASIC_AUTH_ENABLED, u: process.env.BASIC_AUTH_USER, p: process.env.BASIC_AUTH_PASS };
  Object.assign(process.env, { BASIC_AUTH_ENABLED: 'true', BASIC_AUTH_USER: 'u', BASIC_AUTH_PASS: 'p' });
  const through = async (mw, method, path) => { let passed = false; const r = res(); Object.assign(r, { set() {}, send() { return r; } }); await mw({ method, path, originalUrl: path, headers: {} }, r, () => { passed = true; }); return passed; };
  try {
    for (const mw of [basicAuth, sessionAuth]) {
      assert.equal(await through(mw, 'POST', `/api/fathom/webhook/${TOKEN}`), true);
      assert.equal(await through(mw, 'GET', `/api/fathom/webhook/${TOKEN}`), false);
      assert.equal(await through(mw, 'POST', '/api/fathom/webhook/short'), false);
      assert.equal(await through(mw, 'POST', `/api/fathom/webhook/${TOKEN}/more`), false);
    }
  } finally {
    for (const [k, v] of [['BASIC_AUTH_ENABLED', was.e], ['BASIC_AUTH_USER', was.u], ['BASIC_AUTH_PASS', was.p]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

// ---- Stage 2: the card's rows, the Today row, the paste warning, Scout's "unreviewed" ----
const today = await import('../sales/todayRank.js');
const { buildFixes } = await import('../sales/todayRoutes.js');
const scout = await import('../sales/scoutIntents.js');
const { ENTITIES } = await import('../sales/scoutEntities.js');
const CY = '33333333-3333-4333-8333-333333333333';
const intent = id => scout.salesIntents.find(i => i.id === id);
const ask = (q, over = {}) => ({ q, company: [], terms: [], flags: {}, since: null, until: null, entity: null, ...over });

test('status: one row per member who connected, names only; an Owner also gets the members without one', async () => {
  const w = world();
  goalsDeps.supabase = w.supabase;
  w.supabase.db.business_members.push({ business_id: B, user_id: CY, name: address('cyrus'), role: 'member' });
  await receive(hook(meeting()), res(), { supabase: w.supabase, now: NOW });
  const r = res();
  await routes.statusRoute(asJack(), r);
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.members.map(m => [m.name, m.connected, m.stored, m.last_recording, m.webhook]), [['Jack', true, 1, '2026-11-20', true]]);
  assert.deepEqual([r.body.me, r.body.owner, r.body.stored], [JACK, true, 1]);
  assert.deepEqual(r.body.others.map(o => o.user_id), [CY]);
  noAt(r.body, 'status');
  assert.ok(!/key_enc|secret|webhook_token/.test(JSON.stringify(r.body)));
  const member = res();
  await routes.statusRoute(asJack({ auth: { user: { id: CY }, isPlatformOwner: false, roles: new Map([[B, 'member']]) } }), member);
  assert.deepEqual([member.body.connected, member.body.owner, member.body.others, member.body.members.length], [false, false, [], 1]);
});

test('Today: an unaccepted note is ONE virtual row leading group 1 - Review with its counts, Extract when it holds no proposal; accepted, it is gone', async () => {
  const w = world();
  goalsDeps.supabase = w.supabase;
  await receive(hook(meeting()), res(), { supabase: w.supabase, now: NOW });
  await receive(hook(meeting(9002, { meeting_title: 'Pulled call' }), { id: 'msg_2' }), res(), { supabase: w.supabase, now: NOW });
  Object.assign(w.supabase.db.sales_call_notes[1], { extract: null, call_date: '2026-11-18' });
  const due = { id: 't1', text: 'Due thing', due_date: '2026-11-19', owner_user_id: JACK, created_at: '2026-11-01T00:00:00Z' };
  const view = reviews => today.buildToday({ todos: [due], reviews, members: [{ id: JACK, name: 'Jack Carlson' }], today: '2026-11-20', filter: {} });
  const v = view(w.supabase.db.sales_call_notes);
  assert.deepEqual(v.groups.map(g => g.id), ['due', 'top', 'visited', 'reply', 'rest']);
  const rows = v.groups[0].rows;
  assert.deepEqual(rows.map(r => [r.kind, r.verb, r.virtual]), [['review', 'review', true], ['review', 'extract', true], ['todo', 'next_steps', false]]);
  assert.equal(rows[0].text, 'Review call notes · Northwind weekly · 1 task · 1 company · 0 facts · Nov 20');
  assert.equal(rows[1].text, 'Call notes not read yet · Pulled call · Nov 18');
  assert.deepEqual([rows[0].key, rows[0].owner, rows[0].source, rows[0].rank], [`review:${w.supabase.db.sales_call_notes[0].id}`, 'Jack', 'call_notes', 1]);
  assert.equal(today.buildToday({ todos: [due], reviews: w.supabase.db.sales_call_notes, members: [], today: '2026-11-20', filter: { owner: CY } }).groups[0].n, 0);
  const fix = buildFixes({ team: v, mine: v, todos: [], records: [] }).items.find(i => i.id === 'reviews');
  assert.deepEqual([fix.title, fix.action.label, fix.action.review], ['2 calls to review', 'Review', rows[0].note_id]);
  assert.equal(view(w.supabase.db.sales_call_notes.filter(n => !n.accepted_at).slice(0, 0)).groups[0].rows.length, 1);
  assert.equal(buildFixes({ team: view([]), mine: view([]), todos: [], records: [] }).items.some(i => i.id === 'reviews'), false);
});

test('paste: the same text as a Fathom note (whole, or the summary alone) is answered with that note and NO model call; insisting reads it', async () => {
  const w = world();
  goalsDeps.supabase = w.supabase;
  await receive(hook(meeting()), res(), { supabase: w.supabase, now: NOW });
  const [note] = w.supabase.db.sales_call_notes;
  note.call_date = new Date().toISOString().slice(0, 10);
  const paste = async body => { const r = res(); await notes.extractCallNotesRoute(asJack({ body }), r); return r; };
  const whole = await paste({ text: `  ${note.text.toUpperCase()}  ` });
  assert.deepEqual(whole.body, { fathom_match: { id: note.id, title: 'Northwind weekly', call_date: note.call_date, accepted: false, fathom_url: 'https://fathom.video/share/abc9001' } });
  const summary = await paste({ text: note.text.split('\n\nAction items (Fathom)')[0] });
  assert.equal(summary.body.fathom_match.id, note.id);
  assert.equal(w.calls(), 1);
  const other = await paste({ text: 'Different notes: Dana will send the list.' });
  assert.ok(other.body.tasks && !other.body.fathom_match);
  const insisted = await paste({ text: note.text, insist: true });
  assert.ok(insisted.body.tasks && insisted.body.extract_sig);
  assert.equal(w.calls(), 3);
});

test('Scout: "review the <x> call" / "what did we agree with <x>" / "ideas from calls" read the note and its extract - "unreviewed" until accepted', async () => {
  assert.deepEqual(['review the Northwind call', 'Review my last call', 'what did we agree with Northwind yesterday', 'ideas from calls this month', 'notes about Northwind', 'review my tasks'].map(q => [scout.callAsk(ask(q)), scout.callTerm(ask(q))]),
    [['review', 'northwind'], ['review', null], ['agreed', 'northwind'], ['ideas', null], [null, null], [null, null]]);
  const picked = q => scout.salesIntents.filter(i => i.match(ask(q, q.includes('notes') ? { entity: 'call_notes' } : {}))).map(i => i.id);
  assert.deepEqual([picked('review the Northwind call'), picked('ideas from call notes'), picked('notes about Northwind')], [['call_review'], ['call_ideas'], ['notes']]);

  const w = world();
  goalsDeps.supabase = w.supabase;
  await receive(hook(meeting()), res(), { supabase: w.supabase, now: NOW });
  const [note] = w.supabase.db.sales_call_notes;
  note.extract = { ...note.extract, decisions: [{ company: 'Northwind', text: 'Pilot starts in January', evidence: 'will pilot' }], waiting_on: [{ company: 'Northwind', who: 'Dana Reyes', text: 'the employer list', due_date: '2026-11-27', evidence: 'share the list' }] };
  const ctx = q => ({ businessId: B, ask: ask(q), today: '2026-11-20' });
  const before = await intent('call_review').run(w.supabase, ctx('review the Northwind call'));
  assert.equal(before.read, 'call notes matching "northwind" · 1 · 1 unreviewed · 1 decisions · 1 waiting on them');
  assert.deepEqual(before.items.map(i => i.text.replace(/^Northwind weekly · 2026-11-20 · /, '').slice(0, 72)), ['unreviewed · ## Decisions - Northwind will pilot in January (watch) [lin', 'decision (unreviewed): Northwind: Pilot starts in January', 'waiting on Dana Reyes (unreviewed): the employer list · due 2026-11-27']);
  assert.ok(before.items.every(i => i.entity === 'call_notes' && i.id === note.id && i.subtitle === '2026-11-20 · unreviewed'));
  const ideasBefore = await intent('call_ideas').run(w.supabase, ctx('ideas from calls this month'));
  assert.equal(ideasBefore.read, 'ideas in call notes since 2026-10-21 · 3 in 1 of 1 notes · 1 unreviewed');
  assert.equal(ideasBefore.items[0].text, 'idea (product) (unreviewed): A pilot dashboard the employer can open · about Northwind · from Northwind weekly 2026-11-20');
  const [found] = await ENTITIES.find(e => e.entity === 'call_notes').search(w.supabase, { businessId: B, q: 'northwind', limit: 5 });
  assert.equal(found.subtitle, '2026-11-20 · unreviewed');
  const listed = await intent('notes').run(w.supabase, { businessId: B, ask: ask('notes about Northwind', { entity: 'call_notes', company: ['Northwind'] }) });
  assert.match(listed.read, / · 1 · 1 unreviewed$/);
  scout.salesReads.openTodosFor = async () => ({ rows: [], total: 0 });
  scout.salesReads.listScores = async () => ({ body: { rows: [] } });
  const standing = await scout.salesStanding(w.supabase, { businessId: B, auth: { user: { id: JACK } }, today: '2026-11-20', now: NOW.getTime() });
  assert.equal(standing.reads[1], 'notes since 2026-11-06 (1 · 1 unreviewed)');

  note.accepted_at = NOW.toISOString();
  const after = [await intent('call_review').run(w.supabase, ctx('what did we agree with Northwind')), await intent('call_ideas').run(w.supabase, ctx('ideas from calls')), await intent('notes').run(w.supabase, { businessId: B, ask: ask('notes', { entity: 'call_notes' }) }), await scout.salesStanding(w.supabase, { businessId: B, auth: { user: { id: JACK } }, today: '2026-11-20', now: NOW.getTime() })];
  assert.ok(!JSON.stringify(after).includes('unreviewed'));
  assert.equal(after[0].items[1].text, 'Northwind weekly · 2026-11-20 · decision: Northwind: Pilot starts in January');
  for (const x of [before, ideasBefore, ...after]) noAt(x, 'scout');
});
