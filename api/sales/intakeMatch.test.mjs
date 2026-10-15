// node --test api/sales/intakeMatch.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { toIntake, findByName, resolveCompany, normName } from './intakeMatch.js';
import { parseIntake, researchPrompt } from './intakeAccept.js';

const ctx = {
  members: [{ id: 'u-jack', name: 'Jack Carlson' }, { id: 'u-cyrus', name: 'Cyrus Radjoo' }],
  partners: [
    { id: 'p-gal', name: 'Gallagher', pipeline_status: 'replied', owner_team: null, champion: null, angle: 'old angle', next_step: 'Old step' },
    { id: 'p-perk', name: 'PerkSpot', pipeline_status: 'first_email_drafted' },
    { id: 'p-core', name: 'Corestream', pipeline_status: 'not_started' },
    { id: 'p-all', name: 'Alliant Insurance Services', pipeline_status: 'first_email_sent', owner_team: 'upside', co_owner_name: 'Brad', no_double_touch: true },
    { id: 'p-up', name: 'Upside', pipeline_status: 'meeting_set' },
  ],
  opportunities: [{ id: 'o-24', organization: '24 Hour Fitness', owner_team: null, champion: null, objections: null, next_action: 'Call', notes: null, decision_makers: null }],
  companies: [{ account_id: 'a-24', name: '24 Hour Fitness' }, { account_id: 'a-sc', name: '[solidcore]' }, { account_id: 'a-mar', name: 'Marriott International' }, { account_id: 'a-hil', name: 'Hilton' }],
  targets: [{ id: 't-z', name: 'ZeroBounce', kind: 'employer', status: 'rejected' }, { id: 't-l', name: 'Lockton', kind: 'partner', status: 'researching' }],
  categories: ['4. Mid-Market Benefits Brokers', '6. Enterprise Benefits Consultants'],
};

test('names: case, punctuation, brackets, spacing ("Perk Spot") and suffixes all normalize', () => {
  assert.equal(normName('[solidcore]'), 'solidcore');
  assert.equal(normName('Gallagher (AJG), Inc.'), 'gallagher');
  assert.equal(findByName('Perk Spot', ctx.partners, 'name', false).id, 'p-perk');
  assert.equal(findByName('Core Stream', ctx.partners, 'name', false).id, 'p-core');
  assert.equal(findByName('Alliant', ctx.partners, 'name', true).id, 'p-all');
  assert.equal(findByName('Hilton Grand Vacations', ctx.companies, 'name', false), null);
});

test('matching order: partner, then pipeline employer, then Apollo-only account, then target; exact beats partial', () => {
  assert.equal(resolveCompany('24 Hour Fitness', ctx).type, 'opportunity');
  assert.equal(resolveCompany('Solidcore', ctx).type, 'account');
  assert.equal(resolveCompany('Marriott', ctx).id, 'a-mar');
  assert.equal(resolveCompany('Lockton', ctx).type, 'target');
  assert.equal(resolveCompany('Fundrise', ctx), null);
});

test('companies: existing -> note, Apollo-only -> not ticked, new partner/employer -> target, not_target/unclear unticked, rejected dropped', () => {
  const out = toIntake({ companies: [
    { name: 'Gallagher', kind: 'partner' }, { name: 'Solidcore', kind: 'employer' }, { name: 'Fundrise', kind: 'partner', category: '4. Mid-Market Benefits Brokers' },
    { name: 'Deloitte', kind: 'employer' }, { name: 'Plaid', kind: 'not_target' }, { name: "Brad's company", kind: 'unclear' }, { name: 'ZeroBounce', kind: 'not_target' },
    { name: 'Roofstock', kind: 'partner', category: 'Made-up category' },
  ] }, ctx, '2026-10-13', '2026-10-14');
  const by = n => out.companies.find(c => c.name === n);
  assert.deepEqual([by('Gallagher').action, by('Gallagher').on, by('Gallagher').match.type], ['note', true, 'partner']);
  assert.deepEqual([by('Solidcore').action, by('Solidcore').on], ['none', false]);
  assert.deepEqual([by('Fundrise').action, by('Fundrise').category], ['target_partner', '4. Mid-Market Benefits Brokers']);
  assert.equal(by('Deloitte').action, 'target_employer');
  assert.deepEqual([by('Plaid').action, by('Plaid').on], ['skip', false]);
  assert.deepEqual([by("Brad's company").action, by("Brad's company").on], ['skip', false]);
  assert.equal(by('ZeroBounce'), undefined);
  assert.deepEqual(out.rejected, ['ZeroBounce']);
  assert.equal(by('Roofstock').category, null);
});

test('ownership, people, touches and facts land where REV3 says; members are never people', () => {
  const out = toIntake({
    companies: [
      { name: 'Alliant', kind: 'partner', ownership: { owner_team: 'upside', owner_name: 'Brad', co_owner_name: null, no_double_touch: null } },
      { name: 'Marriott', kind: 'employer', ownership: { owner_team: 'upside', owner_name: 'Brad' } },
      { name: 'Lockton', kind: 'partner' }, { name: 'Marsh McLennan Agency', kind: 'partner' },
    ],
    people: [
      { name: 'Rachel McCarter', company: 'Alliant', title: 'VP Employee Benefits', role: 'champion', moved_from: 'Mercer' },
      { name: 'Jill Vaslow', company: 'Marriott', title: 'Managing VP Benefits', role: 'champion' },
      { name: 'Jack', company: 'Alliant', role: 'other' },
      { name: 'Pat Nobody', company: 'Unknown Co', role: 'other' },
    ],
    touches: [
      { company: 'Alliant', touch_type: 'email', people: ['Rachel McCarter'], date: '2026-10-13', direction: 'in', stage: 'replied' },
      { company: 'Solidcore', touch_type: 'email', people: ['Crystal Pringle'], date: '2026-10-13', direction: 'in' },
      { company: 'Gallagher', touch_type: 'meeting', people: [], date: '2026-10-20', direction: 'out', stage: 'meeting_set' },
      { company: 'Corestream', touch_type: 'call', people: ['Kim'], date: '2026-10-13', direction: 'out' },
    ],
    facts: [
      { company: 'Gallagher', field: 'their_words', text: 'We love renters' },
      { company: 'Gallagher', field: 'next_step', text: 'Send the deck' },
      { company: 'Marriott', field: 'watch_outs', text: 'Pause Cyrus sequence' },
      { company: 'Marriott', field: 'angle', text: 'Hourly staff' },
    ],
  }, ctx, '2026-10-13', '2026-10-14');
  const [all, mar] = out.ownership;
  assert.deepEqual([all.match.type, all.owner_team, all.old.owner_team, all.dest], ['partner', 'upside', 'upside', 'partner']);
  assert.deepEqual([mar.match.type, mar.creates_opportunity], ['account', true]);
  assert.deepEqual(out.people.map(p => [p.name, p.dest]), [['Rachel McCarter', 'partner_contacts'], ['Jill Vaslow', 'decision_makers'], ['Pat Nobody', null]]);
  assert.equal(out.people[0].moved_from, 'Mercer');
  assert.equal(out.people[2].on, false);
  const [rep, sc, meet, quiet] = out.touches;
  assert.equal(quiet.stage, null, 'no stated stage, no move - not even the auto Sent for a not-started partner');
  assert.deepEqual([rep.stage, rep.stage_on, rep.on], ['replied', true, true]);
  assert.match(rep.warning, /Upside owns this \(Brad\) - don't double-touch/);
  assert.deepEqual([sc.kept_with_note, sc.on], [true, false]);
  assert.equal(meet.date, '2026-10-13', 'a future date falls back to the note date');
  assert.equal(meet.stage, 'meeting_set', 'a booked meeting moves a replied partner forward');
  const back = toIntake({ touches: [{ company: 'Gallagher', touch_type: 'email', people: ['X'], date: '2026-10-13', stage: 'replied' }] }, { ...ctx, partners: [{ ...ctx.partners[0], pipeline_status: 'meeting_set' }] }, '2026-10-13', '2026-10-14');
  assert.equal(back.touches[0].stage, null, 'never backwards: replied is behind meeting_set');
  const [words, step, watch, angle] = out.facts;
  assert.deepEqual([words.column, words.text], ['angle', 'They said: We love renters']);
  assert.deepEqual([step.column, step.single, step.old], ['next_step', true, 'Old step']);
  assert.deepEqual([watch.column, watch.creates_opportunity], ['objections', true]);
  assert.deepEqual([angle.column, angle.on], [null, false]);
});

test('no email address or phone number survives into any list', () => {
  const out = toIntake({
    companies: [{ name: 'Fundrise', kind: 'partner', evidence: 'mail ana@fundrise.example or +1 (415) 555-0100' }],
    people: [{ name: 'Ana Zz', company: 'Fundrise', title: 'ana@fundrise.example', role: 'champion' }],
  }, ctx, '2026-10-13', '2026-10-14');
  assert.doesNotMatch(JSON.stringify(out), /@|555-0100/);
});

test('accept validation: ids must be in this workspace, rejected targets and bad actions refused', () => {
  const ok = parseIntake({ companies: [{ key: 'c0', name: 'Fundrise', action: 'target_partner', category: '4. Mid-Market Benefits Brokers' }],
    facts: [{ company_key: 'c0', field: 'angle', text: 'Renters' }], people: [{ company_key: 'c0', name: 'Ana Zz', role: 'champion' }] }, ctx);
  assert.equal(ok.facts[0].column, 'research_notes');
  assert.equal(ok.companies[0].kind, 'partner');
  assert.throws(() => parseIntake({ companies: [{ key: 'c0', name: 'X', action: 'note', match: { type: 'partner', id: 'nope' } }] }, ctx), /not found in this workspace/);
  assert.throws(() => parseIntake({ companies: [{ key: 'c0', name: 'ZeroBounce', action: 'note', match: { type: 'target', id: 't-z' } }] }, ctx), /not found/);
  assert.throws(() => parseIntake({ companies: [{ key: 'c0', name: 'X', action: 'delete' }] }, ctx), /action must be/);
  assert.throws(() => parseIntake({ facts: [{ company_key: 'cX', field: 'angle', text: 'x' }] }, ctx), /isn't in this workspace or ticked/);
  assert.throws(() => parseIntake({ touches: [{ match: { type: 'account', id: 'a-sc' }, touch_type: 'email', date: '2026-10-13' }] }, ctx), /only a partner/);
  assert.throws(() => parseIntake({ facts: [{ match: { type: 'opportunity', id: 'o-24' }, field: 'angle', text: 'x' }] }, ctx), /nowhere to keep/);
});

test('the research prompt is plain text with no address in it', () => {
  const p = researchPrompt('Fundrise', 'partner', 'HomeLover');
  assert.match(p, /Research Fundrise as a possible channel partner/);
  assert.doesNotMatch(p, /@/);
});
