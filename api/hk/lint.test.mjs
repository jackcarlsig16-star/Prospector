// node --test api/hk/lint.test.mjs
// hkos-data-foundation-v1 D3 - lintDraft against invented drafts. 0 network, 0 DB. Invented brand + first names only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lintDraft, lintRejects, subjectMatchesFormat } from './lint.js';

const SETTINGS = { banned_phrases: ['synergies', 'hope this finds you well'], subject_format: 'HumanKind x [Brand] - [descriptor]', members_stat: 1500, completions_stat: 6000 };
const GOOD_SUBJECT = 'HumanKind x Northwind Juice - a cold-pressed challenge';
const GOOD_BODY = `Hi Sam - hope the week is going well.

I'm Jack, co-founder of HumanKind - a free community wellness platform launched in Chicago in April. We're at 1,500+ members and 6,000+ verified challenge completions, with weekly challenges across sustainability, community and mindfulness.

You can check out the community here!

Northwind Juice is a natural fit: a "juice after the run" challenge - log a morning run, then pick a Northwind bottle that matches your goal - with a bottle, a discount or a raffle entry as the reward.

Every completion is verified, so you're driving real behavior, not clicks and impressions.

Worth a 15-minute call to see if it makes sense?

Thanks,
Jack`;
const rules = p => p.map(x => x.rule);

test('a clean cold email passes with no problems', () => {
  assert.deepEqual(lintDraft(GOOD_SUBJECT, GOOD_BODY, 'cold', SETTINGS), []);
});

test('em dash and en dash are rejected with the offending text quoted', () => {
  const em = lintDraft(GOOD_SUBJECT, GOOD_BODY.replace('a natural fit:', 'a natural fit —'), 'cold', SETTINGS);
  assert.deepEqual(rules(em), ['dash']); assert.ok(em[0].excerpt.includes('—')); assert.ok(em[0].excerpt.length <= 80);
  assert.deepEqual(rules(lintDraft(GOOD_SUBJECT, GOOD_BODY.replace('a bottle, a discount', 'a bottle – a discount'), 'cold', SETTINGS)), ['dash']);
  assert.deepEqual(rules(lintDraft(GOOD_SUBJECT.replace(' - ', ' – '), GOOD_BODY, 'cold', SETTINGS)), ['dash', 'subject_format'], 'an en dash in the subject also breaks the subject format');
});

test('settings banned phrases match case-insensitively; the seed words apply even when settings has none', () => {
  assert.deepEqual(rules(lintDraft(GOOD_SUBJECT, GOOD_BODY.replace('hope the week is going well', 'Hope This Finds You Well'), 'cold', SETTINGS)), ['banned_phrase']);
  const seedOnly = lintDraft(GOOD_SUBJECT, GOOD_BODY.replace('a natural fit', 'a chance to leverage synergies'), 'cold', { ...SETTINGS, banned_phrases: [] });
  assert.deepEqual(rules(seedOnly).sort(), ['banned_phrase', 'banned_phrase']);
  assert.deepEqual(seedOnly.map(p => p.message).sort(), ['"leverage" is on the banned list.', '"synergies" is on the banned list.']);
});

test('banned words match whole words only: "costume" is not "cost", "leveraged" is', () => {
  assert.deepEqual(lintDraft(GOOD_SUBJECT, GOOD_BODY.replace('a bottle', 'a costume'), 'cold', SETTINGS), []);
  assert.deepEqual(rules(lintDraft(GOOD_SUBJECT, GOOD_BODY.replace('a bottle', 'a leveraged bottle'), 'cold', SETTINGS)), []);
});

test('pricing is rejected: a $ amount, "pricing", "per month", "rate card"', () => {
  for (const s of ['sponsorships start at $250', 'happy to share pricing', 'about 99 per month', 'our rate card is attached']) {
    assert.deepEqual(rules(lintDraft(GOOD_SUBJECT, GOOD_BODY.replace('Every completion is verified', s + '. Every completion is verified'), 'cold', SETTINGS)), ['pricing'], s);
  }
});

test('cold and bump need a 15-minute call ask; dm_text and final do not', () => {
  const noAsk = GOOD_BODY.replace('Worth a 15-minute call to see if it makes sense?', 'Let me know what you think.');
  assert.deepEqual(rules(lintDraft(GOOD_SUBJECT, noAsk, 'cold', SETTINGS)), ['call_ask']);
  assert.deepEqual(rules(lintDraft('Re: ' + GOOD_SUBJECT, 'Bumping this up - still keen to hear your thoughts.\n\nThanks,\nJack', 'bump', SETTINGS)), ['call_ask']);
  assert.deepEqual(lintDraft('Re: ' + GOOD_SUBJECT, 'Bumping this - worth 15 min this week?\n\nThanks,\nJack', 'bump', SETTINGS), []);
  assert.deepEqual(lintDraft(null, 'Loved the latest post - HumanKind is a free Chicago wellness app and we work with creators; interested, and what are your rates?', 'dm_text', { ...SETTINGS, subject_format: null }), []);
});

test('a typed phone line is rejected anywhere; an ISO date is not a phone', () => {
  const r = lintDraft(GOOD_SUBJECT, GOOD_BODY + '\n(312) 555-0142', 'cold', SETTINGS);
  assert.deepEqual(rules(r), ['phone_number']); assert.equal(r[0].excerpt, '(312) 555-0142');
  assert.deepEqual(lintDraft(GOOD_SUBJECT, GOOD_BODY.replace('in April', 'on 2026-04-14'), 'cold', SETTINGS), []);
});

test('a title line after the sign-off is a signature block; a title in the intro is fine', () => {
  assert.deepEqual(rules(lintDraft(GOOD_SUBJECT, GOOD_BODY + '\nCo-founder, HumanKind', 'cold', SETTINGS)), ['signature_block']);
  assert.deepEqual(lintDraft(GOOD_SUBJECT, GOOD_BODY, 'cold', SETTINGS), []);
});

test('member / completion numbers that differ from settings are stale; 1,500+ equals 1500', () => {
  const stale = lintDraft(GOOD_SUBJECT, GOOD_BODY.replace('1,500+ members and 6,000+ verified challenge completions', '1,000+ members and 4,000+ verified challenge completions'), 'cold', SETTINGS);
  assert.deepEqual(rules(stale), ['stale_stat', 'stale_stat']);
  assert.match(stale[0].message, /members stat 1,000 differs from hk_settings \(1500\)/);
  assert.match(stale[1].message, /completions stat 4,000 differs from hk_settings \(6000\)/);
  assert.deepEqual(lintDraft(GOOD_SUBJECT, GOOD_BODY.replace('6,000+ verified challenge completions', '6000 completions'), 'cold', SETTINGS), []);
});

test('fake urgency and all five pillars are rejected (seed patterns with a mechanical check)', () => {
  assert.deepEqual(rules(lintDraft(GOOD_SUBJECT, GOOD_BODY.replace('You can check', 'Last chance to join before Friday. You can check'), 'cold', SETTINGS)), ['fake_urgency']);
  const five = lintDraft(GOOD_SUBJECT, GOOD_BODY.replace('sustainability, community and mindfulness', 'fitness, community, mindfulness, sustainability and learning'), 'cold', SETTINGS);
  assert.deepEqual(rules(five), ['all_five_pillars']);
});

test('subject format: a cold subject off the format is a warning, not a reject; bumps are not checked', () => {
  const r = lintDraft('Quick question', GOOD_BODY, 'cold', SETTINGS);
  assert.deepEqual(r.map(p => [p.rule, p.level]), [['subject_format', 'warn']]);
  assert.deepEqual(lintRejects(r), []);
  assert.deepEqual(lintDraft('Quick question', 'Bumping this - worth 15 min?\n\nThanks,\nJack', 'bump', SETTINGS), []);
  assert.equal(subjectMatchesFormat('HumanKind x Acme Yoga - a mat-time challenge', SETTINGS.subject_format), true);
  assert.equal(subjectMatchesFormat('HumanKind x Acme Yoga', SETTINGS.subject_format), false);
});

test('several problems report together, each with rule, message, excerpt and level', () => {
  const bad = lintDraft('Synergies!', 'Hope this finds you well — our pricing starts at $99 per month.\n\nThanks,\nJack\nFounder\n312-555-0142', 'cold', SETTINGS);
  const got = rules(bad);
  for (const want of ['dash', 'banned_phrase', 'pricing', 'call_ask', 'phone_number', 'signature_block', 'subject_format']) assert.ok(got.includes(want), want);
  for (const p of bad) { assert.ok(p.rule && p.message && typeof p.excerpt === 'string' && p.excerpt.length <= 80 && ['reject', 'warn'].includes(p.level), JSON.stringify(p)); }
});
