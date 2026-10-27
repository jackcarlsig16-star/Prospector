// node --test api/sales/composeLint.test.mjs  (react-scripts' Jest only runs src/)
// intent-score-v1 S7 - the hard rules on a draft: a claim that does not trace to a Brief line, a number not in the
// Brief or the proof points, a banned phrase, pricing, an em / en dash, a wrong sign-off, length, an address.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lintDraft, mergeRules, DEFAULT_COMPOSE_RULES } from './composeLint.js';
import { composeSystem, parseDraft } from './composeRoutes.js';

const REFS = [{ ref: 'B1', text: 'Quarry Labs · target · stage researching · 800 employees' }, { ref: 'B2', text: 'Visited 6 times in 7 d · pages /pricing' }, { ref: 'B3', text: 'Why HomeLover: Big relocation program' }];
const GOOD = { subject: 'Quick idea for your relocation program', body: 'Hi there,\n\nSaw a few visits from Quarry Labs to our site this week, so I looked you up - the relocation program stood out.\n\nHomeLover gives relocating employees a home-search concierge, which tends to land well with a program like yours.\n\nWorth 15 minutes next week? [Tue 10am] [Thu 2pm]\n\nJack', claims: [{ claim: 'visits this week', brief_ref: 'B2' }, { claim: 'relocation program', brief_ref: 'B3' }] };
const rules = m => lintDraft({ ...GOOD, refs: REFS, signOff: 'Jack', ...m }).issues.map(i => i.rule);

test('a clean draft passes every rule', () => {
  const r = lintDraft({ ...GOOD, refs: REFS, signOff: 'Jack' });
  assert.deepEqual([r.ok, r.issues], [true, []]);
  assert.ok(r.words > 20 && r.words < 150);
});

test('a claim that does not trace to a Brief line fails (missing ref, unknown ref)', () => {
  assert.deepEqual(rules({ claims: [{ claim: 'they raised a round', brief_ref: 'B9' }] }), ['claim_unmatched']);
  assert.deepEqual(rules({ claims: [{ claim: 'they raised a round' }] }), ['claim_unmatched']);
});

test('a number not in the Brief or the proof points fails; the ask minutes and Brief numbers are fine; proof points allow their numbers', () => {
  assert.deepEqual(rules({ body: GOOD.body.replace('a few visits', '12 visits') }), ['number_unverified']);
  assert.deepEqual(rules({ body: GOOD.body.replace('a few visits', '6 visits') }), []);
  assert.deepEqual(rules({ body: GOOD.body.replace('a few visits', '40% of employees relocate and we saw 6 visits') }), ['number_unverified']);
  assert.deepEqual(rules({ body: GOOD.body.replace('a few visits', '40% of employees relocate and we saw 6 visits'), rules: mergeRules({ proof_points: ['40% of relocating employees use the concierge'] }) }), []);
});

test('a dash (em or en) fails; a hyphen is fine', () => {
  assert.deepEqual(rules({ body: GOOD.body.replace(' - the', ' — the') }), ['dash']);
  assert.deepEqual(rules({ subject: 'Quick idea – relocation' }), ['dash']);
  assert.deepEqual(rules({}), []);
});

test('pricing fails: a dollar amount, "per employee", the word pricing', () => {
  assert.deepEqual(rules({ body: GOOD.body.replace('Worth 15 minutes', 'It is $5 per employee. Worth 15 minutes') }), ['number_unverified', 'pricing']);
  assert.deepEqual(rules({ body: GOOD.body.replace('Worth 15 minutes', 'Happy to share pricing. Worth 15 minutes') }), ['pricing']);
});

test('a banned phrase fails, case-insensitively; the rules row can replace the list', () => {
  assert.deepEqual(rules({ body: GOOD.body.replace('tends to land well', 'is Best In Class') }), ['banned_claim']);
  assert.deepEqual(rules({ body: GOOD.body.replace('tends to land well', 'is best in class'), rules: mergeRules({ banned_claims: ['synergy'] }) }), []);
  assert.deepEqual(rules({ body: GOOD.body.replace('tends to land well', 'brings synergy'), rules: mergeRules({ banned_claims: ['synergy'] }) }), ['banned_claim']);
});

test('the last line must be the first name alone; no sign-off rule without a name', () => {
  assert.deepEqual(rules({ body: GOOD.body.replace(/Jack$/, 'Best,\nJack Carlson') }), ['sign_off']);
  assert.deepEqual(rules({ body: GOOD.body.replace(/Jack$/, 'Jack,') }), []);
  assert.deepEqual(rules({ body: GOOD.body.replace(/Jack$/, 'Cheers'), signOff: null }), []);
});

test('length over the cap fails; a custom cap applies', () => {
  const long = { body: `${'word '.repeat(160)}\nJack` };
  assert.deepEqual(rules(long), ['length']);
  assert.deepEqual(rules({ ...long, rules: mergeRules({ max_words: 200 }) }), []);
  assert.deepEqual(rules({ rules: mergeRules({ max_words: 10 }) }), ['length']);
});

test('an email address or phone number in the draft fails; a missing subject or body fails', () => {
  assert.deepEqual(rules({ body: GOOD.body.replace('Hi there,', 'Hi there, reach me at jack@homelover.example') }), ['address']);
  assert.deepEqual(rules({ body: GOOD.body.replace('Hi there,', 'Hi there, call 312-555-0100') }), ['number_unverified', 'number_unverified', 'number_unverified', 'address']);
  assert.deepEqual(rules({ subject: '' }), ['subject_missing']);
  assert.deepEqual(rules({ body: '' }), ['body_missing', 'sign_off']);
});

test('mergeRules: defaults for NULL and bad values, overrides for good ones', () => {
  assert.deepEqual(mergeRules(null), DEFAULT_COMPOSE_RULES);
  assert.deepEqual(mergeRules({ max_words: -5, ask_minutes: 'x', proof_points: 'no', banned_claims: null }), DEFAULT_COMPOSE_RULES);
  assert.equal(mergeRules({ max_words: 120 }).max_words, 120);
});

test('composeSystem carries the hard rules and the sign-off; parseDraft reads the JSON block and scrubs an address', () => {
  const sys = composeSystem({ prompt: 'VOICE', rules: DEFAULT_COMPOSE_RULES, signOff: 'Jack' });
  assert.ok(sys.startsWith('VOICE') && sys.includes('"Jack"') && sys.includes('No pricing') && sys.includes('brief_ref'));
  const d = parseDraft('Here you go:\n{"subject":"Hi","body":"Line one\\nJack","why_this_company":"visits","claims":[{"claim":"visits","brief_ref":"B2"},{"bad":1}]}');
  assert.deepEqual([d.subject, d.body, d.why, d.claims.length, d.claims[1].brief_ref], ['Hi', 'Line one\nJack', 'visits', 2, null]);
  assert.ok(!parseDraft('{"subject":"mail me@x.example","body":"ok"}').subject.includes('@'));
  assert.throws(() => parseDraft('no json here'), e => e.status === 502);
});
