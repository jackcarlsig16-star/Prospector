// node --test api/hk/gmailMime.test.mjs
// hkos-gmail-connect-v1 Stage 1 - the draft MIME: headers, thread headers, markdown -> HTML, signature, no dashes.
// Invented addresses on example.invalid; 0 network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDraftMime, markdownToHtml, draftUrl, replySubject, parseAddress, header } from './gmailMime.js';

const decode = raw => Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
const BODY = 'Hi Sam - quick one.\n\nHumanKind is a free community wellness platform. You can check out the community here: https://humankindcollective.app/community\n\nWorth a 15-minute call?\n\nThanks,\nJack';

test('To present when given, absent when omitted (the Stage 4 test draft); Subject and multipart/alternative always', () => {
  const withTo = buildDraftMime({ to: 'sam@example.invalid', subject: 'HumanKind x Harbor Yoga - a mat-time challenge', bodyMarkdown: BODY });
  const mime = decode(withTo.raw);
  assert.match(mime, /^To: sam@example\.invalid\r\nSubject: HumanKind x Harbor Yoga - a mat-time challenge\r\nMIME-Version: 1\.0\r\nContent-Type: multipart\/alternative; boundary="hk-/);
  assert.match(mime, /Content-Type: text\/plain; charset=utf-8/); assert.match(mime, /Content-Type: text\/html; charset=utf-8/);
  const noTo = decode(buildDraftMime({ subject: 'Test', bodyMarkdown: BODY }).raw);
  assert.ok(!/^To:/m.test(noTo), 'no recipient');
  assert.ok(!withTo.raw.includes('=') && !withTo.raw.includes('+') && !withTo.raw.includes('/'), 'base64url');
});

test('markdown: paragraphs, single line breaks, the one link hyperlinked exactly once, HTML escaped, hyphens untouched', () => {
  const html = markdownToHtml(BODY);
  assert.equal((html.match(/<a href=/g) || []).length, 1);
  assert.match(html, /<a href="https:\/\/humankindcollective\.app\/community">https:\/\/humankindcollective\.app\/community<\/a>/);
  assert.equal((html.match(/<p>/g) || []).length, 4);
  assert.match(html, /Thanks,<br>Jack/);
  assert.match(html, /Hi Sam - quick one\./);
  assert.equal(markdownToHtml('a <b> & "c"'), '<p>a &lt;b&gt; &amp; &quot;c&quot;</p>');
});

test('signature appended as plain lines in both parts; an em or en dash anywhere is refused (lint runs first)', () => {
  const d = buildDraftMime({ subject: 'S', bodyMarkdown: 'Body here.', signatureText: 'Jack\nCo-founder, HumanKind' });
  assert.equal(d.text, 'Body here.\n\nJack\nCo-founder, HumanKind');
  assert.match(d.html, /<p>Body here\.<\/p>\n<p>Jack<br>Co-founder, HumanKind<\/p>/);
  assert.throws(() => buildDraftMime({ subject: 'S', bodyMarkdown: 'a — b' }), /em or en dash/);
  assert.throws(() => buildDraftMime({ subject: 'S – T', bodyMarkdown: 'ok' }), /em or en dash/);
  assert.throws(() => buildDraftMime({ subject: 'S', bodyMarkdown: 'ok', signatureText: 'Jack — HK' }), /em or en dash/);
});

test('reply / bump headers: In-Reply-To + References from the original Message-ID; Re: added once; non-ASCII subject encoded', () => {
  const d = buildDraftMime({ to: 'sam@example.invalid', subject: replySubject('HumanKind x Harbor Yoga'), bodyMarkdown: 'Bumping this.', inReplyTo: '<abc@mail.gmail.com>' });
  assert.deepEqual(d.headers, { To: 'sam@example.invalid', Subject: 'Re: HumanKind x Harbor Yoga', 'In-Reply-To': '<abc@mail.gmail.com>', References: '<abc@mail.gmail.com>' });
  assert.equal(replySubject('Re: already'), 'Re: already');
  assert.match(decode(buildDraftMime({ subject: 'Café', bodyMarkdown: 'x' }).raw), /Subject: =\?UTF-8\?B\?/);
});

test('draft url opens the tethered mailbox; address parsing; header lookup', () => {
  assert.equal(draftUrl('verify.work@humankind.test', 'msg-1'), 'https://mail.google.com/mail/?authuser=verify.work%40humankind.test#drafts/msg-1');
  assert.deepEqual(parseAddress('Sam Example <Sam@Example.invalid>'), { name: 'Sam Example', email: 'sam@example.invalid', domain: 'example.invalid' });
  assert.deepEqual(parseAddress('"Ana" <ana@brand.invalid>'), { name: 'Ana', email: 'ana@brand.invalid', domain: 'brand.invalid' });
  assert.deepEqual(parseAddress('plain@brand.invalid'), { name: null, email: 'plain@brand.invalid', domain: 'brand.invalid' });
  assert.deepEqual(parseAddress('nonsense'), { name: null, email: null, domain: null });
  assert.equal(header({ payload: { headers: [{ name: 'Message-ID', value: '<x@y>' }] } }, 'message-id'), '<x@y>');
  assert.equal(header({}, 'From'), null);
});
