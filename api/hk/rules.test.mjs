// node --test api/hk/rules.test.mjs
// hkos-data-foundation-v1 D2 - canContact against invented fixtures. 0 network, 0 DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import { canContact, isOpenDraft, primaryOf } from './rules.js';

const JACK = 'u-jack', PETE = 'u-pete';
const brand = (over = {}) => ({ status: 'candidate', relationship: 'prospect', owner_user_id: null, owner_unclear: false, niche: null, ...over });
const sent = n => Array.from({ length: n }, () => ({ channel: 'email', state: 'sent' }));

test('clear: a prospect nobody owns, no threads, no touches', () => {
  assert.deepEqual(canContact({ brand: brand(), senderUserId: JACK, kind: 'cold' }), { ok: true, reason: null, warnings: [] });
});

test('sponsor and founding_partner block as sponsor; do_not_contact blocks as do_not_contact', () => {
  assert.equal(canContact({ brand: brand({ relationship: 'sponsor' }), senderUserId: JACK, kind: 'cold' }).reason, 'sponsor');
  assert.equal(canContact({ brand: brand({ relationship: 'founding_partner' }), senderUserId: JACK, kind: 'bump' }).reason, 'sponsor');
  assert.equal(canContact({ brand: brand({ relationship: 'do_not_contact', dnc_reason: 'asked us to stop' }), senderUserId: JACK, kind: 'cold' }).reason, 'do_not_contact');
});

test('passed status blocks', () => {
  assert.equal(canContact({ brand: brand({ status: 'passed' }), senderUserId: JACK, kind: 'cold' }).reason, 'passed');
});

test("owned by the other founder blocks with the owner's id; the owner themselves is clear", () => {
  const r = canContact({ brand: brand({ owner_user_id: PETE }), senderUserId: JACK, kind: 'cold' });
  assert.deepEqual([r.ok, r.reason, r.owner_user_id], [false, 'owned_by', PETE]);
  assert.equal(canContact({ brand: brand({ owner_user_id: JACK }), senderUserId: JACK, kind: 'cold' }).ok, true);
});

test('owner_unclear blocks', () => {
  assert.equal(canContact({ brand: brand({ owner_unclear: true }), senderUserId: JACK, kind: 'cold' }).reason, 'owner_unclear');
});

test('warm: a cold touch is blocked when any founder has a thread; the verdict carries founder + last date ONLY', () => {
  const r = canContact({ brand: brand(), senderUserId: JACK, kind: 'cold', threadsByFounder: [
    { founder_user_id: PETE, last_at: '2026-09-02T10:00:00Z', subject: 'should never leak', body: 'nor this' },
    { founder_user_id: JACK, last_at: '2026-08-01T10:00:00Z' },
  ] });
  assert.deepEqual(r, { ok: false, reason: 'warm', founder_user_id: PETE, last_at: '2026-09-02T10:00:00Z', warnings: [] });
  assert.ok(!('subject' in r) && !('body' in r));
});

test('warm applies to cold only: a bump on an existing thread is allowed', () => {
  assert.equal(canContact({ brand: brand({ owner_user_id: JACK }), senderUserId: JACK, kind: 'bump', threadsByFounder: [{ founder_user_id: JACK, last_at: '2026-10-01' }] }).ok, true);
});

test('max_touches: 3 sent email touches block cold / bump / final; drafted ones and DMs do not count; the cap is a setting', () => {
  const r = canContact({ brand: brand({ owner_user_id: JACK }), senderUserId: JACK, kind: 'final', touches: sent(3) });
  assert.deepEqual([r.reason, r.sent, r.max], ['max_touches', 3, 3]);
  assert.equal(canContact({ brand: brand({ owner_user_id: JACK }), senderUserId: JACK, kind: 'bump', touches: [...sent(2), { channel: 'email', state: 'drafted' }, { channel: 'ig_dm', state: 'sent' }] }).ok, true);
  assert.equal(canContact({ brand: brand({ owner_user_id: JACK }), senderUserId: JACK, kind: 'bump', touches: sent(3), maxEmailTouches: 4 }).ok, true);
  assert.equal(canContact({ brand: brand({ owner_user_id: JACK }), senderUserId: JACK, kind: 'dm_text', touches: sent(3) }).ok, true);
});

test('niche overlap warns (names the sponsor) but does not block; it rides along on a block too', () => {
  const sponsors = [{ name: 'Northwind Juice', niche: 'cold-pressed juice' }];
  const r = canContact({ brand: brand({ niche: 'Cold-Pressed Juice' }), senderUserId: JACK, kind: 'cold', sponsorsNiches: sponsors });
  assert.deepEqual(r, { ok: true, reason: null, warnings: [{ code: 'niche_overlap', sponsor: 'Northwind Juice' }] });
  const b = canContact({ brand: brand({ niche: 'cold-pressed juice', relationship: 'do_not_contact' }), senderUserId: JACK, kind: 'cold', sponsorsNiches: sponsors });
  assert.deepEqual([b.reason, b.warnings.length], ['do_not_contact', 1]);
});

test('precedence: relationship beats owner beats warm beats max_touches', () => {
  const everything = { brand: brand({ relationship: 'sponsor', owner_user_id: PETE, owner_unclear: true, status: 'passed' }), senderUserId: JACK, kind: 'cold', threadsByFounder: [{ founder_user_id: PETE, last_at: '2026-09-02' }], touches: sent(5) };
  assert.equal(canContact(everything).reason, 'sponsor');
  assert.equal(canContact({ ...everything, brand: brand({ owner_user_id: PETE, status: 'passed' }) }).reason, 'passed');
  assert.equal(canContact({ ...everything, brand: brand({ owner_user_id: PETE }) }).reason, 'owned_by');
  assert.equal(canContact({ ...everything, brand: brand() }).reason, 'warm');
});

test('hk-imported-drafts-noise F1: isOpenDraft - an email needs its Gmail draft, a DM text stands alone, imported is never a draft; Open draft only for a real one', () => {
  assert.deepEqual([
    { state: 'drafted', channel: 'email', gmail_draft_id: 'd1' }, { state: 'drafted', channel: 'email', gmail_draft_id: null }, { state: 'drafted', channel: 'ig_dm' },
    { state: 'imported', channel: 'email', gmail_draft_id: 'd1' }, { state: 'imported', channel: 'ig_dm' }, { state: 'sent', channel: 'email', gmail_draft_id: 'd1' },
  ].map(isOpenDraft), [true, false, true, false, false, false]);
  const base = { brand: { owner_user_id: 'u-me' }, meId: 'u-me', researched: true, hasEmail: true, verdictOk: true };
  assert.equal(primaryOf({ ...base, touches: [{ state: 'drafted', channel: 'email', gmail_draft_id: null, sender_user_id: 'u-me' }] }).kind, 'pitch');
  assert.equal(primaryOf({ ...base, touches: [{ state: 'drafted', channel: 'email', gmail_draft_id: 'd1', sender_user_id: 'u-me' }] }).kind, 'open_draft');
});
