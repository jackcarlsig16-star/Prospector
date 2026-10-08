import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyMessage, classifyEvent, ownership, isConsumerDomain, domainOf, startUrl, syncFolder, CAPS, PAGE_SIZE, BACKFILL_DAYS } from './graphSync.js';

const own = ownership(['jack@homelover.ai', 'cyrus@homelover.ai']);
const addr = a => ({ emailAddress: { address: a } });
const msg = (over = {}) => ({ id: 'm1', internetMessageId: '<im1@x>', conversationId: 'c1', subject: 'Hello', sentDateTime: '2026-10-01T10:00:00Z', receivedDateTime: '2026-10-01T10:00:05Z',
  from: addr('jack@homelover.ai'), toRecipients: [addr('amy@acme.com')], ccRecipients: [], isDraft: false, body: { content: 'NEVER STORED' }, ...over });

test('own = every owner address + homelover.ai/.io, any case', () => {
  for (const e of ['Jack@HomeLover.ai', 'hello@homelover.io', 'cyrus@homelover.ai', 'x@homelover.ai']) assert.ok(own.isOwn(e), e);
  assert.ok(!own.isOwn('amy@acme.com'));
  assert.ok(ownership(['jack@newco.com']).isOwn('anyone@newco.com'));
});

test('consumer domains: the listed ones plus yahoo.* and hotmail.*', () => {
  for (const d of ['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'outlook.com', 'hotmail.com', 'hotmail.fr', 'live.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com']) assert.ok(isConsumerDomain(d), d);
  assert.ok(!isConsumerDomain('acme.com') && !isConsumerDomain('outlook.acme.com'));
  assert.equal(domainOf('Amy@Acme.COM'), 'acme.com');
  assert.equal(domainOf('junk'), '');
});

test('message: kept with external side only, direction from the folder, no body field', () => {
  const sent = classifyMessage(msg({ ccRecipients: [addr('cyrus@homelover.ai'), addr('bob@acme.com')] }), { folder: 'sentitems', own });
  assert.deepEqual(sent.row.external_emails, ['amy@acme.com', 'bob@acme.com']);
  assert.deepEqual(sent.row.external_domains, ['acme.com']);
  assert.equal(sent.row.direction, 'sent');
  assert.equal(sent.row.occurred_at, '2026-10-01T10:00:00Z');
  assert.ok(!('body' in sent.row) && !('bodyPreview' in sent.row));
  const received = classifyMessage(msg({ from: addr('amy@acme.com'), toRecipients: [addr('jack@homelover.ai')] }), { folder: 'inbox', own });
  assert.equal(received.row.direction, 'received');
  assert.equal(received.row.occurred_at, '2026-10-01T10:00:05Z');
  assert.equal(classifyMessage(msg({ subject: 'x'.repeat(600) }), { folder: 'inbox', own }).row.subject.length, 500);
});

test('message skips: draft, internal-only, consumer-only; mixed consumer + company is kept', () => {
  assert.equal(classifyMessage(msg({ isDraft: true }), { folder: 'sentitems', own }).skip, 'draft');
  assert.equal(classifyMessage(msg({ toRecipients: [addr('cyrus@homelover.ai')] }), { folder: 'sentitems', own }).skip, 'internal');
  assert.equal(classifyMessage(msg({ toRecipients: [addr('mom@gmail.com')], ccRecipients: [addr('dad@yahoo.com')] }), { folder: 'sentitems', own }).skip, 'personal');
  const mixed = classifyMessage(msg({ toRecipients: [addr('mom@gmail.com'), addr('amy@acme.com')] }), { folder: 'sentitems', own });
  assert.deepEqual(mixed.row.external_domains, ['gmail.com', 'acme.com']);
});

test('event: UTC times, organizer kept, internal / personal skipped', () => {
  const ev = { id: 'e1', iCalUId: 'ical-1', subject: 'Intro', start: { dateTime: '2026-10-09T17:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-10-09T17:30:00.0000000', timeZone: 'UTC' },
    organizer: addr('amy@acme.com'), attendees: [addr('jack@homelover.ai')], isCancelled: false, body: { content: 'NEVER' } };
  const r = classifyEvent(ev, { own }).row;
  assert.equal(r.start_at, '2026-10-09T17:00:00.000Z');
  assert.equal(r.end_at, '2026-10-09T17:30:00.000Z');
  assert.equal(r.organizer_email, 'amy@acme.com');
  assert.deepEqual(r.external_domains, ['acme.com']);
  assert.ok(!('body' in r));
  assert.equal(classifyEvent({ ...ev, organizer: addr('jack@homelover.ai'), attendees: [addr('cyrus@homelover.ai')] }, { own }).skip, 'internal');
  assert.equal(classifyEvent({ ...ev, organizer: addr('a@gmail.com'), attendees: [] }, { own }).skip, 'personal');
});

test('start urls: 90-day filter on mail with a body-free $select, 30 back / 60 forward on calendar', () => {
  const now = new Date('2026-10-08T12:00:00Z');
  const u = new URL(startUrl('inbox', now));
  assert.equal(u.pathname, '/v1.0/me/mailFolders/inbox/messages/delta');
  assert.ok(!/body/i.test(u.searchParams.get('$select')));
  assert.equal(u.searchParams.get('$top'), String(PAGE_SIZE));
  assert.equal(u.searchParams.get('$filter'), `receivedDateTime ge ${new Date(now.getTime() - BACKFILL_DAYS * 864e5).toISOString()}`);
  const c = new URL(startUrl('calendar', now));
  assert.equal(c.pathname, '/v1.0/me/calendarView/delta');
  assert.equal(c.searchParams.get('startDateTime'), '2026-09-08T12:00:00.000Z');
  assert.equal(c.searchParams.get('endDateTime'), '2026-12-07T12:00:00.000Z');
});

// A fake supabase + fake Graph: enough to prove the loop's cap, resume link,
// dry run and run-row counts without a network.
function fakeDb() {
  const tables = { microsoft_sync_runs: [], microsoft_sync_state: [], microsoft_messages: [], microsoft_events: [] };
  const from = name => {
    const rows = tables[name];
    const q = { _f: [] };
    q.select = () => q; q.eq = (k, v) => { q._f.push([k, v]); return q; }; q.order = () => q; q.limit = () => q;
    q.maybeSingle = async () => ({ data: rows.find(r => q._f.every(([k, v]) => r[k] === v)) || null });
    q.single = async () => ({ data: q._last, error: null });
    q.insert = r => { const row = { id: `${name}-${rows.length + 1}`, ...r }; rows.push(row); q._last = row; return q; };
    q.update = patch => ({ eq: async (k, v) => { for (const r of rows) if (r[k] === v) Object.assign(r, patch); return { error: null }; } });
    q.upsert = async (list, { onConflict }) => { const keys = onConflict.split(','); for (const r of [].concat(list)) { const i = rows.findIndex(x => keys.every(k => x[k] === r[k])); if (i >= 0) rows[i] = { ...rows[i], ...r }; else rows.push({ ...r }); } return { error: null }; };
    return q;
  };
  return { from, tables };
}
function fakeGraph(items, pageSize = PAGE_SIZE) {
  const calls = [];
  return { calls, fetch: async (url, init) => {
    calls.push({ url, method: init?.method || 'GET', headers: init.headers });
    const u = new URL(url);
    const skip = Number(u.searchParams.get('$skiptoken') || 0);
    const page = items.slice(skip, skip + pageSize);
    const body = { value: page };
    if (skip + pageSize < items.length) body['@odata.nextLink'] = `${u.origin}${u.pathname}?$skiptoken=${skip + pageSize}`;
    else body['@odata.deltaLink'] = `${u.origin}${u.pathname}?$deltatoken=done`;
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => body };
  } };
}
const base = { userId: 'u1', businessId: 'b1', mailbox: 'jack@homelover.ai', token: 't', own, trigger: 'manual', now: new Date('2026-10-08T12:00:00Z') };

test('syncFolder: counts, kept rows, state link, dry run stores nothing but the run row', async () => {
  const items = [msg({ id: 'a' }), msg({ id: 'b', isDraft: true }), msg({ id: 'c', toRecipients: [addr('cyrus@homelover.ai')] }), msg({ id: 'd', toRecipients: [addr('x@gmail.com')] }), { '@removed': { reason: 'deleted' }, id: 'gone' }];
  const dry = fakeDb(), g1 = fakeGraph(items);
  const r = await syncFolder({ ...base, supabase: dry, folder: 'sentitems', dryRun: true, trigger: 'dry_run', fetchImpl: g1.fetch });
  assert.deepEqual([r.seen, r.stored, r.skipped_draft, r.skipped_internal, r.skipped_personal, r.capped, r.error], [5, 0, 1, 1, 1, false, null]);
  assert.equal(dry.tables.microsoft_messages.length, 0);
  assert.equal(dry.tables.microsoft_sync_state.length, 0);
  assert.equal(dry.tables.microsoft_sync_runs.length, 1);
  assert.equal(dry.tables.microsoft_sync_runs[0].dry_run, true);
  const db = fakeDb(), g2 = fakeGraph(items);
  const real = await syncFolder({ ...base, supabase: db, folder: 'sentitems', fetchImpl: g2.fetch });
  assert.equal(real.stored, 1);
  const row = db.tables.microsoft_messages[0];
  assert.equal(row.graph_id, 'a'); assert.equal(row.mailbox_email, 'jack@homelover.ai'); assert.ok(!('body' in row));
  assert.match(db.tables.microsoft_sync_state[0].delta_link, /deltatoken=done/);
  assert.ok(g2.calls.every(c => c.method === 'GET'));
  assert.match(g2.calls[0].headers.Prefer, /outlook\.timezone="UTC"/);
  assert.ok(!/body/i.test(g2.calls[0].url));
});

test('syncFolder: cap stops the run with the nextLink kept; the next run resumes from it and dedupes', async () => {
  const items = Array.from({ length: CAPS.inbox + 20 }, (_, i) => msg({ id: `m${i}`, from: addr(`p${i}@acme.com`), toRecipients: [addr('jack@homelover.ai')] }));
  const db = fakeDb(), g = fakeGraph(items);
  const first = await syncFolder({ ...base, supabase: db, folder: 'inbox', fetchImpl: g.fetch });
  assert.equal(first.capped, true); assert.equal(first.seen, CAPS.inbox); assert.equal(first.pages, CAPS.inbox / PAGE_SIZE);
  assert.match(db.tables.microsoft_sync_state[0].delta_link, /skiptoken=500/);
  const second = await syncFolder({ ...base, supabase: db, folder: 'inbox', fetchImpl: g.fetch });
  assert.equal(second.capped, false); assert.equal(second.seen, 20);
  assert.match(g.calls[g.calls.length - 1].url, /skiptoken=500/);
  assert.equal(db.tables.microsoft_messages.length, CAPS.inbox + 20);
  assert.match(db.tables.microsoft_sync_state[0].delta_link, /deltatoken/);
  // A different account on the same user restarts from the 90-day filter.
  const g3 = fakeGraph(items.slice(0, 2));
  await syncFolder({ ...base, supabase: db, folder: 'inbox', mailbox: 'jack@homelover.io', fetchImpl: g3.fetch });
  assert.match(g3.calls[0].url, /receivedDateTime/);
});

test('syncFolder: a Graph error lands on the run row, nothing else written', async () => {
  const db = fakeDb();
  const r = await syncFolder({ ...base, supabase: db, folder: 'calendar', fetchImpl: async () => ({ ok: false, status: 403, headers: { get: () => null }, json: async () => ({ error: { code: 'ErrorAccessDenied' } }) }) });
  assert.match(r.error, /Graph 403: ErrorAccessDenied/);
  assert.equal(db.tables.microsoft_sync_runs[0].error, r.error);
  assert.equal(db.tables.microsoft_sync_state.length, 0);
});
