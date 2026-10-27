// node --test api/hk/followupText.test.mjs
// hkos-daily-check-v1 J3 - every template output passes lintDraft with the seeded hk_settings (1,500 / 6,000, the 11
// banned phrases, the subject format), with and without a first name or a concept, on every angle. 0 network, 0 DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';
import { lintDraft } from './lint.js';
import { bumpText, finalText, dmText, angleFor, ANGLES, followupSubject, greeting, statsLine } from './followupText.js';
const seed = createRequire(import.meta.url)('./lintSeed.json');

const SETTINGS = { banned_phrases: seed.banned_words, subject_format: 'HumanKind x [Brand] - [descriptor]', members_stat: 1500, completions_stat: 6000, bump_after_days: 5, final_after_days: 14 };
const SUBJECT = followupSubject('HumanKind x Zz Northwind Juice - a cold-pressed challenge');
const BRANDS = ['Zz Northwind Juice', 'Zz Harbor Yoga', 'Zz Oak Street Bakery'];
const IDS = ['b-1', 'b-2', 'b-3', 'b-4', 'b-5', 'b-6'];
const DASH = /[–—]/;

test('bump: every angle x first name or team x concept or none passes lint for kind bump with no problems at all', () => {
  let n = 0;
  for (const angle of ANGLES) for (const firstName of [null, 'Sam']) for (const concept of [null, 'juice after the run']) for (const [i, brandName] of BRANDS.entries()) {
    const { body } = bumpText({ brandName, brandId: IDS[i], firstName, concept, ownerFirstName: 'Pete', angle });
    assert.deepEqual(lintDraft(SUBJECT, body, 'bump', SETTINGS), [], `${angle} / ${firstName} / ${concept} / ${brandName}\n${body}`);
    assert.doesNotMatch(body, DASH);
    assert.ok(body.trim().endsWith('\n\nPete'), 'first-name sign-off, nothing after it');
    assert.ok(body.startsWith(firstName ? `Hi ${firstName},` : `Hi ${brandName} team,`));
    assert.match(body, /15[ -]minute|15 minutes/);
    n++;
  }
  assert.equal(n, 36);
});

test('bump angles rotate by brand id and are deterministic; all three appear across ids', () => {
  const seen = new Set(IDS.map(angleFor));
  assert.deepEqual([...seen].sort(), [...ANGLES].sort());
  assert.equal(angleFor('b-1'), angleFor('b-1'));
  assert.equal(bumpText({ brandName: 'Zz A', brandId: 'b-1' }).angle, angleFor('b-1'));
  const texts = ANGLES.map(angle => bumpText({ brandName: 'Zz A', brandId: 'b-1', angle }).body);
  assert.equal(new Set(texts).size, 3, 'three different bodies');
  assert.match(texts[0], /verified with a photo, receipt or check-in/);
  assert.match(texts[1], /Quick question/);
  assert.match(texts[2], /lighter way in/);
});

test('final: the off-ramp passes lint for kind final, offers a genuine out, keeps the ask, signs with the first name', () => {
  for (const [i, brandName] of BRANDS.entries()) for (const concept of [null, 'a "mat time" month']) {
    const { body } = finalText({ brandName, brandId: IDS[i], firstName: i ? null : 'Ana', concept, ownerFirstName: 'Jack' });
    assert.deepEqual(lintDraft(SUBJECT, body, 'final', SETTINGS), [], body);
    assert.match(body, /no worries at all if it is not a fit right now/);
    assert.match(body, /15 minutes/);
    assert.ok(body.trim().endsWith('\n\nJack'));
    assert.doesNotMatch(body, DASH);
    assert.ok(!body.includes('""'), 'quotes inside a concept are stripped');
  }
});

test('DM: stats come from hk_settings and match the lint; without stats the text carries no number; passes lint for dm_text', () => {
  const withStats = dmText({ brandName: 'Zz Harbor Yoga', ownerFirstName: 'Pete', settings: SETTINGS }).body;
  assert.deepEqual(lintDraft('', withStats, 'dm_text', SETTINGS), []);
  assert.match(withStats, /1,500\+ members and 6,000\+ verified challenge completions/);
  const noStats = dmText({ brandName: 'Zz Harbor Yoga', settings: {} }).body;
  assert.deepEqual(lintDraft('', noStats, 'dm_text', SETTINGS), []);
  assert.doesNotMatch(noStats, /\d/);
  assert.equal(statsLine({ members_stat: 1500 }), null, 'both numbers or nothing');
  assert.match(withStats, /^Hi Zz Harbor Yoga team!/);
  assert.doesNotMatch(withStats, /Open to a quick conversation|Want to chat|Worth exploring/i, 'the skill\'s banned closes');
});

test('a stale stat would be caught: the same DM against settings with other numbers fails lint (proves the check is live)', () => {
  const body = dmText({ brandName: 'Zz A', settings: SETTINGS }).body;
  const problems = lintDraft('', body, 'dm_text', { ...SETTINGS, members_stat: 2000 });
  assert.deepEqual(problems.map(p => p.rule), ['stale_stat']);
});

test('helpers: greeting, reply subject, no banned phrase anywhere in the templates', () => {
  assert.equal(greeting('Sam', 'Zz A'), 'Hi Sam,'); assert.equal(greeting(null, 'Zz A'), 'Hi Zz A team,');
  assert.equal(followupSubject('HumanKind x Zz A - idea'), 'Re: HumanKind x Zz A - idea');
  assert.equal(followupSubject('Re: HumanKind x Zz A - idea'), 'Re: HumanKind x Zz A - idea');
  assert.equal(followupSubject(null), 'Re: HumanKind');
  const all = [...ANGLES.map(angle => bumpText({ brandName: 'Zz A', brandId: 'x', angle }).body), finalText({ brandName: 'Zz A', brandId: 'x' }).body, dmText({ brandName: 'Zz A', settings: SETTINGS }).body].join('\n').toLowerCase();
  for (const w of seed.banned_words) assert.ok(!all.includes(w), w);
  assert.ok(!all.includes('@'));
});
