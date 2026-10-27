// node --test api/hk/jobs/digest.test.mjs
// hkos-daily-check-v1 J4 - the digest payload and its Slack rendering on invented rows. The reply fixtures carry a
// from_email the builder must ignore; a summary holding an address makes the builder throw. 0 network, 0 DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDigest, renderSlack } from './digest.js';

const NOW = new Date('2026-10-27T13:00:00Z'); // 08:00 Chicago, Tuesday
const ago = (d, h = 0) => new Date(NOW.getTime() - d * 86400e3 - h * 3600e3).toISOString();
const SETTINGS = { timezone: 'America/Chicago', stats_confirmed_at: null };
const members = [{ user_id: 'u-jack', first_name: 'Jack' }, { user_id: 'u-pete', first_name: 'Pete' }];
const brands = [
  { id: 'b1', name: 'Zz Northwind Juice', domain: 'northwind.invalid', owner_user_id: 'u-jack', status: 'replied', updated_at: ago(2) },
  { id: 'b2', name: 'Zz Harbor Yoga', domain: null, owner_user_id: 'u-pete', status: 'sent', updated_at: ago(3) },
  { id: 'b3', name: 'Zz Oak Street Bakery', domain: 'oak.invalid', owner_user_id: 'u-jack', status: 'meeting', updated_at: ago(1) },
  { id: 'b4', name: 'Zz Granite Gym', domain: null, owner_user_id: null, status: 'bumped', updated_at: ago(5) },
];
const replies = [
  { id: 'r1', brand_id: 'b1', handled: false, urgent: true, label: 'pricing', summary: 'Asked what a challenge costs', received_at: ago(0, 3), from_email: 'ana@northwind.invalid', snoozed_until: null },
  { id: 'r2', brand_id: 'b2', handled: false, urgent: false, label: 'interested', summary: 'Wants to see the app', received_at: ago(1), from_email: 'pete@harbor.invalid', snoozed_until: null },
  { id: 'r3', brand_id: 'b3', handled: true, urgent: true, label: 'interested', summary: 'Booked', received_at: ago(2), from_email: 'x@oak.invalid', snoozed_until: null },
  { id: 'r4', brand_id: 'b4', handled: false, urgent: false, label: 'other', summary: 'Out of office', received_at: ago(1), from_email: 'y@granite.invalid', snoozed_until: ago(-3) },
  { id: 'r5', brand_id: 'b4', handled: false, urgent: true, label: 'interested', summary: 'Back and keen', received_at: ago(0, 1), from_email: 'y@granite.invalid', snoozed_until: null },
];
const touches = [
  { id: 't1', brand_id: 'b2', channel: 'email', kind: 'bump', state: 'drafted', subject: 'Re: HumanKind x Zz Harbor Yoga - mat time', created_by: 'system', sender_user_id: 'u-pete', drafted_at: ago(2) },
  { id: 't2', brand_id: 'b4', channel: 'email', kind: 'cold', state: 'drafted', subject: 'HumanKind x Zz Granite Gym - step streak', created_by: 'user', sender_user_id: 'u-jack', drafted_at: ago(0, 2) },
  { id: 't3', brand_id: 'b1', channel: 'email', kind: 'cold', state: 'sent', subject: 'x', created_by: 'user', sender_user_id: 'u-jack', drafted_at: ago(9), sent_at: ago(8) },
  { id: 't4', brand_id: 'b4', channel: 'ig_dm', kind: 'dm_text', state: 'drafted', created_by: 'system', sender_user_id: 'u-jack', drafted_at: ago(0, 1) },
];
const events = [
  { action: 'touch_sent', created_at: ago(1, 2) }, { action: 'touch_sent', created_at: ago(1, 5) }, { action: 'touch_sent', created_at: ago(3) },
  { action: 'reply_handled', created_at: ago(1, 1) }, { action: 'reply_handled', created_at: ago(0, 1) }, { action: 'brand.status', created_at: ago(1) },
];
const noDraft = [{ brand_id: 'b4', kind: 'bump', reason: 'no_contact' }, { brand_id: 'b2', kind: 'final', reason: 'lint', detail: '"synergies" is on the banned list.' }];
const dmReady = [{ brand_id: 'b4', touch_id: 't4' }];
const build = (over = {}) => buildDigest({ replies, touches, brands, members, noDraft, dmReady, warningsCount: 3, settings: SETTINGS, events, now: NOW, ...over });

test('sections in the design order with the right rows: urgent (unhandled urgent, newest first), replies waiting (not snoozed), drafts (oldest first, with age), no draft, DM ready', () => {
  const p = build();
  assert.deepEqual(Object.keys(p.sections), ['urgent', 'replies', 'drafts', 'no_draft', 'dm_ready']);
  assert.deepEqual(p.sections.urgent.map(e => [e.brand_name, e.owner, e.label_text, e.pricing]), [['Zz Granite Gym', null, 'interested', false], ['Zz Northwind Juice', 'Jack', 'asked about pricing', true]]);
  assert.deepEqual(p.sections.replies.map(e => [e.brand_name, e.owner, e.summary]), [['Zz Harbor Yoga', 'Pete', 'Wants to see the app']], 'handled and snoozed replies are out');
  assert.deepEqual(p.sections.drafts.map(e => [e.brand_name, e.kind_text, e.created_by, e.sender, e.age_days]), [['Zz Harbor Yoga', 'bump', 'system', 'Pete', 2], ['Zz Granite Gym', 'cold pitch', 'user', 'Jack', 0]]);
  assert.deepEqual(p.sections.no_draft.map(e => [e.brand_name, e.kind_text, e.reason_text, e.detail]), [['Zz Granite Gym', 'bump', 'no contact with an email yet', null], ['Zz Harbor Yoga', 'final nudge', 'the draft failed the outreach rules', '"synergies" is on the banned list.']]);
  assert.deepEqual(p.sections.dm_ready.map(e => [e.brand_name, e.touch_id]), [['Zz Granite Gym', 't4']]);
  assert.deepEqual(p.counts, { urgent: 2, replies: 1, drafts: 2, no_draft: 2, dm_ready: 1, data_warnings: 3 });
  assert.equal(p.day, '2026-10-27'); assert.equal(p.empty, false); assert.equal(p.test, false);
});

test('stats stale line, data warnings count, and "done yesterday" from events + brands (Chicago day)', () => {
  const p = build();
  assert.equal(p.stats_stale, true);
  assert.equal(build({ settings: { ...SETTINGS, stats_confirmed_at: ago(2) } }).stats_stale, false);
  assert.deepEqual(p.done_yesterday, { sent: 2, replies_handled: 1, meetings: 1 });
  assert.equal(p.data_warnings, 3);
});

test('no address anywhere in the payload even though the reply rows carry from_email; a summary holding one makes the builder throw', () => {
  assert.ok(!JSON.stringify(build()).includes('@'));
  assert.throws(() => build({ replies: [{ ...replies[1], summary: 'write to ana@harbor.invalid' }] }), /address or phone/);
});

test('an empty morning: empty true, counts 0, no sections', () => {
  const p = buildDigest({ brands, members, settings: { ...SETTINGS, stats_confirmed_at: ago(1) }, now: NOW });
  assert.equal(p.empty, true);
  assert.deepEqual(Object.values(p.counts), [0, 0, 0, 0, 0, 0]);
  const s = renderSlack(p);
  assert.ok(s.blocks.some(b => b.text?.text === 'Nothing needs you right now.'));
  assert.equal(s.text, 'HumanKind morning check - 2026-10-27: nothing needs you');
});

test('Slack: header, one section per non-empty list with bullets and owner first names, the pricing strip, extras, the footer context; TEST marked', () => {
  const s = renderSlack(build({ test: true }));
  assert.equal(s.blocks[0].type, 'header'); assert.match(s.blocks[0].text.text, /^HumanKind morning check \(TEST\) - 2026-10-27$/);
  const sections = s.blocks.filter(b => b.type === 'section').map(b => b.text.text);
  assert.match(sections[0], /^\*Urgent \(2\)\*\n• \*Zz Granite Gym\* - interested: Back and keen\n• \*Zz Northwind Juice\* \(Jack\) - asked about pricing: Asked what a challenge costs - do not quote pricing in the reply$/);
  assert.match(sections[1], /^\*Replies waiting \(1\)\*\n• \*Zz Harbor Yoga\* \(Pete\) - interested: Wants to see the app$/);
  assert.match(sections[2], /\*Drafts to review \(2\)\*\n• \*Zz Harbor Yoga\* \(Pete\) - bump waiting in Gmail, 2 d\n• \*Zz Granite Gym\* - cold pitch waiting in Gmail$/);
  assert.match(sections[3], /Follow-ups with no draft \(2\)/); assert.match(sections[4], /DM text ready \(1\)/);
  assert.match(sections[5], /Data warnings: 3 \(Review\)\nStats need a fresh confirmation/);
  const ctx = s.blocks.find(b => b.type === 'context');
  assert.equal(ctx.elements[0].text, 'Done yesterday: 2 sent · 1 replies handled · 1 meetings');
  assert.equal(s.text, 'HumanKind morning check - 2026-10-27: Urgent: 2, Replies waiting: 1, Drafts to review: 2, Follow-ups with no draft: 2, DM text ready: 1');
  assert.ok(!JSON.stringify(s).includes('@'));
  assert.doesNotMatch(JSON.stringify(s), /[–—]/);
});

test('Slack: a long section is cut at 15 lines with "and n more"', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ id: `rr${i}`, brand_id: 'b2', handled: false, urgent: false, label: 'other', summary: `note ${i}`, received_at: ago(i), snoozed_until: null }));
  const s = renderSlack(buildDigest({ replies: many, brands, members, settings: SETTINGS, now: NOW }));
  const sec = s.blocks.find(b => b.type === 'section' && /Replies waiting \(20\)/.test(b.text.text)).text.text;
  assert.equal(sec.split('\n').length - 1, 16); assert.match(sec, /• and 5 more$/);
});
