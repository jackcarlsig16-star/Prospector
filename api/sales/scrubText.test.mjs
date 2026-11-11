import test from 'node:test';
import assert from 'node:assert/strict';
import { hasPii, scrubPhones, cleanText } from './scrubText.js';

// FIX scout-action-feedback-v1 (ruling 1 of 2026-11-10): the phone shape is checked per line, never across a line
// break; the "@" check stays on the whole text.
test('hasPii: a date ending one line and "(11/10)" opening the next is not a phone; a phone on one line still is; "@" anywhere still is', () => {
  // the exact shape of the employer Notes field that refused Copy draft bundle on Nov 10 (words replaced)
  const notes = '- Notes: (11/08) Call booked a1b2c3d4-ef56-789a-b0cd-12e34f56ab78: Engagement signals: 3 (Opened plan overview · Visited pricing (twice)) · next 2026-11-10\n(11/10) Engagement signals: 5 (Opened plan overview · next step)';
  assert.equal(hasPii(notes), false);
  assert.equal(notes.split('\n').some(hasPii), false);
  assert.equal(hasPii('due 2026-11-10\n2026-11-12 follow up'), false);
  assert.equal(hasPii('line one\ncall 415 555 0134 today'), true);
  assert.equal(hasPii('line one\n+1 (415) 555-0134'), true);
  assert.equal(hasPii('2026-11-10 415 555 0134'), true, 'a date followed by a number on the same line is still caught');
  assert.equal(hasPii('clean line\nname at example dot com\nsomeone@example'), true, 'the "@" check covers the whole text');
  assert.equal(hasPii('Stage: contacted · Covered lives: 4400 · due 2026-11-10'), false);
});

test('the scrubbers are unchanged: a number is removed, a date is kept, saved text is one line', () => {
  assert.equal(scrubPhones('call 415 555 0134 by 2026-11-10'), 'call [number removed] by 2026-11-10');
  assert.equal(cleanText('a\nb  415-555-0134', 80), 'a b [number removed]');
});
