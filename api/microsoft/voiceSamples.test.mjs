import test from 'node:test';
import assert from 'node:assert/strict';
import { extractOutlookSample, externalSamples, fetchOutlookSentMessages, SENT_SAMPLES_PATH, MAX_SAMPLES, BODY_CHARS } from './voiceSamples.js';
import { ownership } from './graphSync.js';

const own = ownership(['jack@homelover.ai']);
const to = (...a) => a.map(address => ({ emailAddress: { address, name: address } }));
const msg = (over = {}) => ({ id: 'm', subject: 'Intro', sentDateTime: '2026-10-01T10:00:00Z', toRecipients: to('amy@acme.com'), body: { contentType: 'text', content: 'Hey Amy, quick one on the pilot - can we grab 15 minutes this week?\n\nJack' }, ...over });

test('sample = lowercase addresses, subject, date, trimmed body capped at 800', () => {
  const s = extractOutlookSample(msg({ toRecipients: to('Amy@Acme.com', ' bob@beta.io '), body: { content: 'x'.repeat(2000) } }));
  assert.deepEqual(s.to, ['amy@acme.com', 'bob@beta.io']);
  assert.equal(s.subject, 'Intro');
  assert.equal(s.date, '2026-10-01T10:00:00Z');
  assert.equal(s.body.length, BODY_CHARS);
});

test('quoted history is cut: Gmail "On ... wrote:", Outlook "From:/Sent:" and "Original Message", "> " lines', () => {
  const mine = 'Thanks Amy - Tuesday works.\n\nJack';
  for (const tail of [
    '\n\nOn Mon, Sep 29, 2026 at 9:00 AM Amy <amy@acme.com> wrote:\n> old stuff\n> more',
    '\n\nFrom: Amy Adams <amy@acme.com>\nSent: Monday, September 29, 2026 9:00 AM\nTo: Jack\nSubject: RE: Intro\n\nold stuff',
    '\n\n-----Original Message-----\nFrom: Amy\nold stuff',
    '\n\n> old stuff\n> more',
  ]) assert.equal(extractOutlookSample(msg({ body: { content: mine + tail } })).body, mine, tail.slice(0, 20));
});

test('external only: any own-domain / owner-address / noreply recipient drops the mail; short bodies and no recipients drop too; cap 25', () => {
  const keep = msg();
  const rows = [
    keep,
    msg({ toRecipients: to('amy@acme.com', 'cyrus@homelover.ai') }),
    msg({ toRecipients: to('team@homelover.io') }),
    msg({ toRecipients: to('noreply@vendor.com') }),
    msg({ toRecipients: to('no-reply@vendor.com') }),
    msg({ toRecipients: [] }),
    msg({ body: { content: 'ok thanks' } }),
    msg({ body: { content: '> all quoted\n> nothing mine' } }),
  ];
  const out = externalSamples(rows, own.isOwn);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].to, ['amy@acme.com']);
  assert.equal(externalSamples(Array.from({ length: 40 }, () => keep), own.isOwn).length, MAX_SAMPLES);
});

test('fetch: one GET to Sent Items with a body $select and the text-body Prefer header; Graph errors surface', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ value: [msg()] }) }; };
  const rows = await fetchOutlookSentMessages('tok', fetchImpl);
  assert.equal(rows.length, 1);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith(SENT_SAMPLES_PATH) && SENT_SAMPLES_PATH.includes('$select=subject,sentDateTime,toRecipients,body'), calls[0].url);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
  assert.equal(calls[0].init.headers.Prefer, 'outlook.body-content-type="text"');
  await assert.rejects(() => fetchOutlookSentMessages('tok', async () => ({ ok: false, status: 403, json: async () => ({ error: { code: 'ErrorAccessDenied' } }) })), /Microsoft Graph 403: ErrorAccessDenied/);
});
