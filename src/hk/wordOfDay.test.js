import { WORDS, wordFor, chicagoDay, checkInWith, NUDGE_DAYS } from './wordOfDay';

// visual-nav-cleanup-v1 W1 - the curated word of the day (no model call) and the check-in nudge.
test('a curated list of 120 distinct words, each with a definition and an example, no addresses', () => {
  expect(WORDS).toHaveLength(120);
  expect(new Set(WORDS.map(w => w[0])).size).toBe(120);
  for (const [word, def, ex] of WORDS) { expect(word && def && ex).toBeTruthy(); expect(`${word}${def}${ex}`).not.toMatch(/@|\d{3}[ -.]\d{3}/); }
});

test('one word per Chicago day, the same for two viewers anywhere; the next Chicago day moves on', () => {
  const a = wordFor(new Date('2026-10-28T05:30:00Z')); // 00:30 Chicago, Oct 28
  const b = wordFor(new Date('2026-10-29T03:00:00Z')); // 22:00 Chicago, still Oct 28
  expect(chicagoDay(new Date('2026-10-29T03:00:00Z'))).toBe('2026-10-28');
  expect(b).toEqual(a);
  expect(wordFor(new Date('2026-10-29T06:00:00Z')).word).not.toBe(a.word);
  expect(wordFor(new Date('2026-01-01T18:00:00Z')).word).toBe(WORDS[0][0]);
});

test('the nudge names the other founder only after 3 days without a Grow load; unknown last-seen never nudges', () => {
  const now = Date.parse('2026-10-28T18:00:00Z');
  const me = { user_id: 'jack' };
  const pete = (days) => ({ user_id: 'pete', first_name: 'Pete', signed_up: true, last_seen_at: days == null ? null : new Date(now - days * 864e5).toISOString() });
  expect(checkInWith(me, [{ user_id: 'jack', first_name: 'Jack', signed_up: true, last_seen_at: null }, pete(NUDGE_DAYS)], now)).toBe('Pete');
  expect(checkInWith(me, [pete(2.9)], now)).toBeNull();
  expect(checkInWith(me, [pete(null)], now)).toBeNull();
  expect(checkInWith(me, [{ ...pete(10), signed_up: false }], now)).toBeNull();
});
