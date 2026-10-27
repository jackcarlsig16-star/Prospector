// node --test api/hk/replyLabel.test.mjs
// hkos-gmail-connect-v1 Stage 1 - the reply labeler: prompt shape, JSON parse, fallbacks, cap, urgency. The model call
// is a stub; 0 network, 0 Claude.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, parseLabel, labelReply, isUrgent, capReached, LABELS, DAILY_CAP, CALL_TYPE } from './replyLabel.js';
import { MODELS } from '../../src/config/models.js';

test('prompt: FAST-sized, carries brand + subject + a scrubbed <= 200-char snippet, lists the eight labels, never an address or phone', () => {
  const p = buildPrompt({ brandName: 'Harbor Yoga', subject: 'Re: HumanKind x Harbor Yoga', snippet: 'Sounds great, call me at 312-555-0142 or mail ana@brand.invalid. ' + 'x'.repeat(300) });
  assert.match(p.system, /interested\|pricing\|referral\|decline\|auto_reply\|prefers_email\|new_thread\|other/);
  assert.ok(!p.messages[0].content.includes('@') && !/312-555/.test(p.messages[0].content));
  assert.ok(p.messages[0].content.length < 320);
  assert.match(p.messages[0].content, /^Brand: Harbor Yoga\nSubject: Re: HumanKind x Harbor Yoga\nSnippet: Sounds great/);
});

test('parse: valid JSON -> label + summary (capped 140, scrubbed); unknown label -> other; garbage -> other + snippet', () => {
  assert.deepEqual(parseLabel('{"label":"pricing","summary":"Asks what a sponsorship costs"}'), { label: 'pricing', summary: 'Asks what a sponsorship costs' });
  assert.deepEqual(parseLabel('Sure! {"label":"interested","summary":"Wants a call next week"} thanks', 'snip'), { label: 'interested', summary: 'Wants a call next week' });
  assert.equal(parseLabel('{"label":"enthusiastic","summary":"x"}').label, 'other');
  assert.deepEqual(parseLabel('not json at all', 'Out of office until Monday'), { label: 'other', summary: 'Out of office until Monday' });
  assert.equal(parseLabel(`{"label":"decline","summary":"${'y'.repeat(300)}"}`).summary.length, 140);
  assert.equal(parseLabel('{"label":"decline","summary":"ping me at ana@brand.invalid"}').summary, 'ping me at [email removed]');
});

test('labelReply: calls the model once with FAST / 200 tokens / thinking off / hk_reply_label; urgent for pricing + interested', async () => {
  const seen = [];
  const call = async args => { seen.push(args); return { content: [{ type: 'text', text: '{"label":"pricing","summary":"Asks for a rate"}' }] }; };
  const r = await labelReply({ call, supabase: {}, businessId: 'b', userId: 'u', brandName: 'Harbor Yoga', subject: 'Re: x', snippet: 'How much is it?' });
  assert.deepEqual(r, { label: 'pricing', summary: 'Asks for a rate', urgent: true, labeled: true });
  assert.deepEqual([seen[0].model, seen[0].max_tokens, seen[0].thinking, seen[0].callType, seen[0].businessId, seen[0].userId], [MODELS.FAST, 200, false, CALL_TYPE, 'b', 'u']);
  assert.ok(seen[0].system.length > 100 && seen[0].messages.length === 1);
  assert.deepEqual(LABELS.map(isUrgent), [true, true, false, false, false, false, false, false]);
});

test('cap: at 60 labels today the call is skipped, the row is stored as other with the snippet and labeled=false', async () => {
  let called = 0;
  const call = async () => { called++; return { content: [] }; };
  const r = await labelReply({ call, brandName: 'X', subject: 's', snippet: 'Thanks, not now.', labelsToday: DAILY_CAP });
  assert.deepEqual([r.label, r.summary, r.labeled, called], ['other', 'Thanks, not now.', false, 0]);
  assert.equal(capReached(59), false); assert.equal(capReached(60), true); assert.equal(capReached(3, 3), true);
  const empty = await labelReply({ call, brandName: 'X', subject: 's', snippet: 'Hmm', labelsToday: 0 });
  assert.deepEqual([empty.label, empty.summary, empty.labeled], ['other', 'Hmm', true], 'an empty reply from the model falls back');
});
