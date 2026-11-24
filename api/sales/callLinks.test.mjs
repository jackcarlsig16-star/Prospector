// node --test api/sales/callLinks.test.mjs
// fathom-notes-v1 REV 2 F11 - F13. Names only in the fixture; nothing address- or phone-shaped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeSupabase } from './testing/fakeSupabase.mjs';

const { proposeRecord, liveRecords, setCallRecord, linkStoredNote, applyAbout, parseAbout, listCalls, recordCallIds, recordCalls, aboutFor } = await import('./callLinks.js');
const { storeRecording } = await import('../fathom/extract.js');
const { salesIntents, callsAsk, callAsk } = await import('./scoutIntents.js');
const { undoFlow } = await import('./flowEvents.js');

const B = '11111111-1111-4111-8111-111111111111', OTHER = '99999999-9999-4999-8999-999999999999';
const JACK = '22222222-2222-4222-8222-222222222222', CYRUS = '33333333-3333-4333-8333-333333333333';
const id = n => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const AON = id(1), MERCER = id(2), HILTON = id(3), SHORT = id(4), METLIFE = id(5), METLIFE_T = id(6), AON_EMPLOYER = id(7);
const N1 = id(101), N2 = id(102), N3 = id(103);
const NOW = new Date('2026-11-24T18:00:00Z');

const seed = (over = {}) => ({
  sales_goals: [
    { id: AON, business_id: B, goal_type: 'partnership', name: 'Aon', company_domain: 'aon.test', archived_at: null },
    { id: MERCER, business_id: B, goal_type: 'partnership', name: 'Mercer', company_domain: null, archived_at: null },
    { id: METLIFE, business_id: B, goal_type: 'partnership', name: 'MetLife', company_domain: 'metlife.test', archived_at: null },
    { id: id(8), business_id: B, goal_type: 'partnership', name: 'Gone Broker', company_domain: 'gone.test', archived_at: '2026-10-01T00:00:00Z' },
    { id: id(9), business_id: OTHER, goal_type: 'partnership', name: 'Aon', company_domain: 'aon.test', archived_at: null },
  ],
  partner_domains: [{ id: id(20), business_id: B, goal_id: MERCER, domain: 'www.mercer.test', confirmed: true }, { id: id(21), business_id: B, goal_id: MERCER, domain: 'unconfirmed.test', confirmed: false }],
  sales_opportunities: [{ id: HILTON, business_id: B, organization: 'Hilton', domain: 'hilton.test', archived_at: null }],
  sales_targets: [
    { id: SHORT, business_id: B, name: 'Shortlister, Inc.', domain: null, promoted_goal_id: null, employer_id: null },
    { id: METLIFE_T, business_id: B, name: 'MetLife', domain: 'metlife.test', promoted_goal_id: METLIFE, employer_id: null },
  ],
  sales_call_notes: [
    { id: N1, business_id: B, title: 'Aon weekly', call_date: '2026-11-23', attendees: [{ name: 'Dana Reyes', is_external: true, domain: 'aon.test' }], record_type: null, record_id: null, created_by: JACK },
    { id: N2, business_id: B, title: 'Pasted notes', call_date: '2026-11-18', attendees: null, record_type: null, record_id: null, created_by: CYRUS },
    { id: N3, business_id: B, title: 'Old call', call_date: '2026-10-02', attendees: null, record_type: 'partner', record_id: AON, created_by: JACK },
  ],
  sales_flow_events: [],
  ...over,
});
const events = sb => sb.from('sales_flow_events').select('*').then(r => r.data);
const noteOf = async (sb, nid) => (await sb.from('sales_call_notes').select('*').eq('id', nid).maybeSingle()).data;

test('liveRecords: live partners with every confirmed domain, employers, un-promoted targets of this workspace only', async () => {
  const recs = await liveRecords(fakeSupabase(seed()), B);
  assert.deepEqual(recs.map(r => `${r.type}:${r.name}`).sort(), ['employer:Hilton', 'partner:Aon', 'partner:Mercer', 'partner:MetLife', 'target:Shortlister, Inc.']);
  assert.deepEqual(recs.find(r => r.name === 'Mercer').domains, ['mercer.test']);
});

test('proposeRecord: domain one / many / none, then the first company by name key - never past one record', async () => {
  const recs = await liveRecords(fakeSupabase(seed({ sales_opportunities: [{ id: HILTON, business_id: B, organization: 'Hilton', domain: 'hilton.test', archived_at: null }, { id: AON_EMPLOYER, business_id: B, organization: 'Aon Hewitt', domain: 'aon.test', archived_at: null }] })), B);
  const ext = d => [{ name: 'Someone', is_external: true, domain: d }];
  const one = proposeRecord({ attendees: ext('hilton.test') }, recs);
  assert.deepEqual([one.by, one.record.type, one.record.name], ['domain', 'employer', 'Hilton']);
  const many = proposeRecord({ attendees: ext('aon.test') }, recs);
  assert.equal(many.record, null);
  assert.deepEqual(many.candidates.map(c => c.name).sort(), ['Aon', 'Aon Hewitt']);
  assert.deepEqual(proposeRecord({ attendees: ext('nowhere.test') }, recs), { record: null, by: null, candidates: [] });
  // an internal attendee's domain is never a match
  assert.equal(proposeRecord({ attendees: [{ name: 'Jack', is_external: false, domain: 'hilton.test' }] }, recs).record, null);
  // several by domain, one by name: the name decides and the candidates still ride along
  const named = proposeRecord({ attendees: ext('aon.test'), extract: { companies: [{ name: 'AON' }, { name: 'Hilton' }] } }, recs);
  assert.deepEqual([named.by, named.record.name, named.candidates.length], ['name', 'Aon', 2]);
  // suffixes fold (the one name key); a promoted target is not a second MetLife
  assert.equal(proposeRecord({ extract: { companies: [{ name: 'Shortlister' }] } }, recs).record.type, 'target');
  assert.deepEqual(proposeRecord({ extract: { companies: [{ name: 'MetLife Inc' }] } }, recs).record, { type: 'partner', id: METLIFE, name: 'MetLife' });
  // a partial name is not a match
  assert.equal(proposeRecord({ extract: { companies: [{ name: 'Hilton Hotels' }] } }, recs).record, null);
});

test('setCallRecord: the pick writes the link and one Activity line; a change unlinks the old record; none clears', async () => {
  const sb = fakeSupabase(seed());
  const a = await setCallRecord(sb, { businessId: B, noteId: N2, record: { type: 'employer', id: HILTON }, byUser: JACK, now: NOW });
  assert.deepEqual(a, { changed: true, record: { type: 'employer', id: HILTON, name: 'Hilton' } });
  assert.deepEqual([(await noteOf(sb, N2)).record_type, (await noteOf(sb, N2)).record_id], ['employer', HILTON]);
  let ev = await events(sb);
  assert.deepEqual(ev.map(e => [e.kind, e.record_type, e.record_id, e.by_user, e.text, e.meta.note_id]), [['call_link', 'employer', HILTON, JACK, 'Call linked: Pasted notes · Nov 18', N2]]);
  // the same pick again: nothing written
  assert.equal((await setCallRecord(sb, { businessId: B, noteId: N2, record: { type: 'employer', id: HILTON }, byUser: JACK })).changed, false);
  assert.equal((await events(sb)).length, 1);
  await setCallRecord(sb, { businessId: B, noteId: N2, record: { type: 'partner', id: AON }, byUser: CYRUS, now: NOW });
  ev = await events(sb);
  assert.deepEqual(ev.slice(1).map(e => [e.kind, e.record_id]), [['call_unlink', HILTON], ['call_link', AON]]);
  await setCallRecord(sb, { businessId: B, noteId: N2, record: null, byUser: JACK, now: NOW });
  assert.equal((await noteOf(sb, N2)).record_id, null);
  assert.equal((await events(sb)).at(-1).kind, 'call_unlink');
  // a call link is not undone from its Activity line
  const r = await undoFlow(sb, { businessId: B, eventId: ev[0].id, byUser: JACK, now: NOW });
  assert.equal(r.status, 409);
});

test('setCallRecord: a record of another workspace or an unknown note is refused; a failed Activity line leaves the old link', async () => {
  const sb = fakeSupabase(seed());
  await assert.rejects(setCallRecord(sb, { businessId: B, noteId: N2, record: { type: 'partner', id: id(9) }, byUser: JACK }), { status: 400 });
  await assert.rejects(setCallRecord(sb, { businessId: OTHER, noteId: N2, record: null, byUser: JACK }), { status: 404 });
  await assert.rejects(setCallRecord(sb, { businessId: B, noteId: 'nope', record: null }), { status: 404 });
  assert.equal((await noteOf(sb, N2)).record_id, null);
  const refusing = fakeSupabase(seed({ sales_flow_events: [{ id: id(50), business_id: B, kind: 'pin' }] }), { unique: { sales_flow_events: () => 'one' } });
  await assert.rejects(setCallRecord(refusing, { businessId: B, noteId: N3, record: { type: 'employer', id: HILTON }, byUser: JACK }));
  assert.deepEqual([(await noteOf(refusing, N3)).record_type, (await noteOf(refusing, N3)).record_id], ['partner', AON]);
});

test('linkStoredNote: one domain match -> "linked by domain", automatic; a link already there is left alone', async () => {
  const sb = fakeSupabase(seed());
  const p = await linkStoredNote(sb, { businessId: B, noteId: N1 });
  assert.equal(p.by, 'domain');
  assert.deepEqual([(await noteOf(sb, N1)).record_type, (await noteOf(sb, N1)).record_id], ['partner', AON]);
  const [e] = await events(sb);
  assert.deepEqual([e.kind, e.by_user, e.text, e.meta.by], ['call_link', null, 'Call linked by domain: Aon weekly · Nov 23', 'domain']);
  // the extract names another company later: the link stays
  assert.equal(await linkStoredNote(sb, { businessId: B, noteId: N1, extract: { companies: [{ name: 'Hilton' }] } }), null);
  assert.equal((await noteOf(sb, N1)).record_id, AON);
  // no domain, the extract's first company is one record -> linked by name
  await linkStoredNote(sb, { businessId: B, noteId: N2, extract: { companies: [{ name: 'Mercer' }, { name: 'Aon' }] } });
  assert.equal((await noteOf(sb, N2)).record_id, MERCER);
  assert.equal((await events(sb)).at(-1).text, 'Call linked by name: Pasted notes · Nov 18');
});

test('storeRecording keeps the recording times and links by domain at store time', async () => {
  const sb = fakeSupabase(seed({ sales_call_notes: [] }));
  const meeting = { recording_id: 7001, meeting_title: 'Hilton intro', recording_start_time: '2026-11-24T17:00:00Z', recording_end_time: '2026-11-24T17:32:00Z', share_url: 'https://fathom.test/share/x',
    default_summary: { markdown_formatted: 'We met Hilton.' }, calendar_invitees: [{ name: 'Pat Lee', is_external: true, email_domain: 'hilton.test' }, { name: 'Jack', is_external: false, email_domain: 'homelover.test' }] };
  const { note } = await storeRecording(sb, { businessId: B, userId: JACK, meeting });
  const row = await noteOf(sb, note.id);
  assert.deepEqual([row.recording_start, row.recording_end, row.record_type, row.record_id], ['2026-11-24T17:00:00.000Z', '2026-11-24T17:32:00.000Z', 'employer', HILTON]);
  assert.match((await events(sb))[0].text, /^Call linked by domain: Hilton intro/);
});

test('parseAbout / applyAbout: the pick wins, "none" clears, nothing sent lets the rules decide', async () => {
  assert.equal(parseAbout({}), undefined);
  assert.equal(parseAbout({ about: null }), null);
  assert.deepEqual(parseAbout({ about: { type: 'target', id: SHORT, name: 'x' } }), { type: 'target', id: SHORT });
  assert.throws(() => parseAbout({ about: { type: 'company', id: SHORT } }), { status: 400 });
  const sb = fakeSupabase(seed());
  assert.equal((await applyAbout(sb, { businessId: B, noteId: N1, about: undefined, extract: null, byUser: JACK })).record.name, 'Aon');
  await applyAbout(sb, { businessId: B, noteId: N1, about: { type: 'target', id: SHORT }, byUser: JACK });
  assert.equal((await noteOf(sb, N1)).record_id, SHORT);
  await applyAbout(sb, { businessId: B, noteId: N1, about: null, byUser: JACK });
  assert.equal((await noteOf(sb, N1)).record_id, null);
});

test('aboutFor: the stored link first, else the proposal with its candidates', async () => {
  const sb = fakeSupabase(seed());
  const linked = await aboutFor(sb, B, { note: await noteOf(sb, N3), extract: null });
  assert.deepEqual([linked.by, linked.record.name], ['linked', 'Aon']);
  const fresh = await aboutFor(sb, B, { extract: { companies: [{ name: 'Hilton' }] } });
  assert.deepEqual([fresh.by, fresh.record.type], ['name', 'employer']);
});

const view = [
  { id: N1, business_id: B, call_date: '2026-11-23', title: 'Aon weekly', source_label: 'Fathom · Aon weekly', created_by: JACK, accepted_at: null, status: 'unreviewed', fathom_recording_id: 1, fathom_url: 'https://fathom.test/share/a',
    attendees: [{ name: 'Dana Reyes', is_external: true, domain: 'aon.test' }, { name: 'Jack', is_external: false, domain: 'homelover.test' }], duration_seconds: 1920, record_type: 'partner', record_id: AON, record_name: 'Aon' },
  { id: N2, business_id: B, call_date: '2026-11-18', title: 'Pasted notes', source_label: null, created_by: CYRUS, accepted_at: '2026-11-18T20:00:00Z', status: 'reviewed', fathom_recording_id: null, fathom_url: null, attendees: null, duration_seconds: null, record_type: null, record_id: null, record_name: null },
  { id: N3, business_id: B, call_date: '2026-10-02', title: 'Old call', source_label: null, created_by: JACK, accepted_at: null, status: 'no_proposal', fathom_recording_id: 2, fathom_url: 'javascript:void(0)', attendees: [], duration_seconds: null, record_type: 'employer', record_id: HILTON, record_name: 'Hilton' },
  { id: id(104), business_id: OTHER, call_date: '2026-11-23', title: 'Elsewhere', created_by: JACK, accepted_at: null, status: 'unreviewed', attendees: null },
];
const members = [{ business_id: B, user_id: JACK, name: 'Jack Carlson' }, { business_id: B, user_id: CYRUS, name: 'Cyrus Example' }];
const logSb = () => fakeSupabase({ ...seed(), sales_calls_v: view, business_members: members });

test('listCalls: one row per note of this workspace, newest first, with the count line and every chip', async () => {
  const sb = logSb();
  const all = await listCalls(sb, { businessId: B, userId: JACK, today: '2026-11-24' });
  assert.deepEqual(all.calls.map(c => c.id), [N1, N2, N3]);
  assert.deepEqual(all.counts, { calls: 3, unreviewed: 2, no_company: 1 });
  const first = all.calls[0];
  assert.deepEqual([first.source, first.member.name, first.attendees, first.record.name, first.duration_seconds, first.status_label],
    ['Fathom', 'Jack', { names: ['Dana Reyes', 'Jack'], total: 2, external: 1 }, 'Aon', 1920, 'Unreviewed']);
  assert.equal(all.calls[1].source, 'Pasted');
  assert.equal(all.calls[2].fathom_url, null); // only an https link is passed on
  const ids = async query => (await listCalls(sb, { businessId: B, userId: JACK, today: '2026-11-24', query })).calls.map(c => c.id);
  assert.deepEqual(await ids({ who: 'mine' }), [N1, N3]);
  assert.deepEqual(await ids({ unreviewed: true }), [N1, N3]);
  assert.deepEqual(await ids({ week: true }), [N1]);
  assert.deepEqual(await ids({ company: 'with' }), [N1, N3]);
  assert.deepEqual(await ids({ company: 'none' }), [N2]);
  assert.deepEqual(await ids({ q: 'hilton' }), [N3]);
  assert.deepEqual(await ids({ q: 'weekly' }), [N1]);
  assert.deepEqual(await ids({ record: `partner:${AON}` }), [N1]);
  assert.ok(!JSON.stringify(all).includes('@'));
  assert.ok(!('text' in first) && !('transcript' in first) && !('extract' in first));
});

test('recordCallIds / recordCalls: the linked notes first, then what the older rules found', async () => {
  const sb = logSb();
  assert.deepEqual(await recordCallIds(sb, B, 'partner', AON, [N2, null, N3]), [N3, N2]);
  assert.deepEqual((await recordCalls(sb, B, 'partner', AON)).map(c => c.title), ['Aon weekly']);
});

test('Scout: the call-log asks match the Calls intent only, and it lists names, dates, status and company', async () => {
  const ask = q => ({ q, company: [], terms: [], flags: {}, entity: null, since: null, until: null, mine: /\bmy\b/.test(q) });
  for (const q of ['calls this week', 'unreviewed calls', 'what calls did we have with Aon', 'last call with Hilton', 'show me our calls']) assert.equal(callsAsk(ask(q)), true, q);
  for (const q of ['review the Hilton call', 'what did we discuss with MetLife', 'ideas from calls this month', 'who visited this week', 'emails this week']) assert.equal(callsAsk(ask(q)), false, q);
  assert.equal(callAsk(ask('what did we discuss with MetLife')), 'agreed');
  const calls = salesIntents.find(i => i.id === 'calls');
  const sb = logSb();
  const ctx = a => ({ businessId: B, auth: { user: { id: JACK } }, ask: a, today: '2026-11-24' });
  const week = await calls.run(sb, ctx({ ...ask('calls this week'), since: '2026-11-23' }));
  assert.equal(week.total, 1);
  assert.match(week.read, /^goals\/calls since 2026-11-23 · 1 call · 1 unreviewed · 0 without a company$/);
  assert.match(week.items[0].text, /^Aon weekly · 2026-11-23 · about Aon \(partner\) · unreviewed · recorded by Jack · 2 invited \(1 external\) · 32 min · Fathom$/);
  const withAon = await calls.run(sb, ctx(ask('what calls did we have with Aon')));
  assert.deepEqual(withAon.items.map(i => i.id), [N1]);
  const last = await calls.run(sb, ctx(ask('last call with Hilton')));
  assert.deepEqual(last.items.map(i => i.id), [N3]);
  assert.match(last.items[0].text, /unreviewed, not read yet/);
  const unreviewed = await calls.run(sb, ctx(ask('unreviewed calls')));
  assert.deepEqual(unreviewed.items.map(i => i.id), [N1, N3]);
  assert.ok(!JSON.stringify([week, withAon, last, unreviewed]).includes('@'));
});

test('Scout: "what did we discuss with <company>" reads the linked notes before the text match', async () => {
  const review = salesIntents.find(i => i.id === 'call_review');
  const sb = fakeSupabase(seed({ sales_call_notes: [
    { id: N1, business_id: B, title: 'Weekly sync', call_date: '2026-11-10', text: 'Renewal timing.', accepted_at: null, extract: null, record_type: 'partner', record_id: AON },
    { id: N2, business_id: B, title: 'Aon mentioned', call_date: '2026-11-20', text: 'Aon came up in passing.', accepted_at: '2026-11-20T00:00:00Z', extract: null, record_type: null, record_id: null },
  ] }));
  const r = await review.run(sb, { businessId: B, ask: { q: 'what did we discuss with Aon', company: ['Aon'], terms: [], flags: {}, since: null, until: null } });
  assert.deepEqual([...new Set(r.items.map(i => i.id))], [N1, N2]);
});
