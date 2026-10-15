import test from 'node:test';
import assert from 'node:assert/strict';
import { readInput, plan, withBlock, companyDomain, ACCOUNT_HEADERS, ImportRefused } from './masterImport.js';

const csv = rows => [ACCOUNT_HEADERS.join(','), ...rows.map(r => ACCOUNT_HEADERS.map(h => r[h] ?? '').join(','))].join('\n');
const contactsCsv = rows => ['record_id,name,title,role', ...rows.map(r => [r.record_id, r.name, r.title || '', r.role || ''].join(','))].join('\n');

const state = () => ({
  partners: [
    { id: 'g-aon', name: 'Aon', record_id: null, tier: '2', category: 'Brokers', owner_user_id: 'u-jack', owner_team: null, co_owner_name: null, next_step: null, notes: 'Our own note', company_domain: null, pipeline_status: 'meeting_set', last_touch_at: '2026-10-01T00:00:00Z' },
    { id: 'g-adp', name: 'ADP TotalSource', record_id: null, tier: null, category: 'Platforms', owner_user_id: null, owner_team: null, co_owner_name: null, next_step: null, notes: null, company_domain: null, pipeline_status: 'not_started', last_touch_at: null },
    { id: 'g-roots', name: 'Roots', record_id: null, tier: null, category: 'Platforms', owner_user_id: null, owner_team: null, co_owner_name: null, next_step: null, notes: null, company_domain: null, pipeline_status: 'not_started', last_touch_at: null },
  ],
  domains: [{ id: 'd1', goal_id: 'g-adp', domain: 'adp.com' }],
  opps: [{ id: 'o-mar', organization: 'Marriott International', stage: 'responded', record_id: null, tier: null, cohort: null, next_action: null, next_action_date: null, owner: null, owner_team: null, co_owner_name: null, org_type: 'employer', notes: null, decision_makers: null, apollo_account_id: null }],
  targets: [{ id: 't-rej', name: 'Nope Inc', record_id: null, kind: 'partner', status: 'rejected', suggested_category: null, owner_team: null, co_owner_name: null, research_notes: null }],
  contacts: [{ id: 'c1', goal_id: 'g-aon', name: 'Pat Lee', title: 'VP', role_in_notes: null }],
  todos: [],
  sequenced: [{ account_id: 'ap-mar', name: 'Marriott International', domain: 'marriott.com' }],
  members: [{ id: 'u-jack', name: 'Jack Carlson' }, { id: 'u-cyrus', name: 'Cyrus Example' }],
  categories: ['Brokers', 'Platforms'],
});

const ACCOUNTS = [
  { record_id: 'HLU-0001', name: 'Aon', kind: 'partner', tier: '1', funnel_stage: 'Contacted', owner_team: 'upside', owner_name: 'Cyrus', co_owner_name: 'Brad', next_step: 'Send deck', next_step_due: '2026-10-20', notes: 'Joint account' },
  { record_id: 'HLU-0002', name: 'ADP', kind: 'employer', company_domain: 'www.adp.com', funnel_stage: 'Engaged', owner_team: 'both' },
  { record_id: 'HLU-0003', name: 'Burnham Benefits', kind: 'partner', category: 'Brokers', owner_team: 'upside', funnel_stage: 'Meeting held' },
  { record_id: 'HLU-0004', name: 'Invest with Roots', kind: 'partner', funnel_stage: 'Contacted' },
  { record_id: 'HLU-0005', name: 'Marriott International', kind: 'employer', company_domain: 'marriott.com', funnel_stage: 'Nurture', owner_team: 'upside', tier: '1', segment: 'Hospitality' },
  { record_id: 'HLU-0006', name: '24 Hour Fitness', kind: 'employer', funnel_stage: 'Meeting scheduled', owner_team: 'homelover', owner_name: 'Jack', tier: '2', partner_path: 'Direct' },
  { record_id: 'HLU-0007', name: 'Teachers Guild', kind: 'association', funnel_stage: 'Hold' },
  { record_id: 'HLU-0008', name: 'Nope Inc', kind: 'partner' },
  { record_id: 'HLU-0009', name: 'Bad Row', kind: 'vendor' },
];
const CONTACTS = [
  { record_id: 'HLU-0001', name: 'Pat Lee', title: 'SVP', role: 'champion' },
  { record_id: 'HLU-0001', name: 'Sam Roe', title: 'Director' },
  { record_id: 'HLU-0006', name: 'Jill Vaslow', title: 'Benefits lead', role: 'champion' },
];

test('the file is refused on any "@" or phone number; a YYYY-MM-DD date is fine; headers must match', () => {
  assert.throws(() => readInput(csv([{ ...ACCOUNTS[0], notes: 'ask pat at pat lee@aon.com' }]), contactsCsv([])), ImportRefused);
  assert.throws(() => readInput(csv([{ ...ACCOUNTS[0], notes: 'call 312-555-0199' }]), contactsCsv([])), ImportRefused);
  assert.throws(() => readInput(csv([ACCOUNTS[0]]), 'record_id,name,email\n'), ImportRefused);
  assert.doesNotThrow(() => readInput(csv([ACCOUNTS[0]]), contactsCsv([])));
});

test('routes: partner update / employer-that-is-a-partner / target / possible / opp update + insert / rejected target / invalid', () => {
  const { actions, report } = plan(state(), readInput(csv(ACCOUNTS), contactsCsv(CONTACTS)), { today: '2026-10-15' });
  const by = Object.fromEntries(actions.map(a => [a.record_id, a]));
  assert.deepEqual(report.counts, { partner_update: 2, partner_to_target: 1, target_update: 0, opp_insert: 2, opp_update: 1, skipped: 2, invalid: 1 });

  const aon = by['HLU-0001'];
  assert.equal(aon.route, 'partner_update');
  assert.deepEqual(aon.assign, { owner_team: 'upside', co_owner_name: 'Brad' }, 'owner kept (Jack), Cyrus reported');
  assert.ok(report.differences.some(d => d.record_id === 'HLU-0001' && d.field === 'tier'));
  assert.ok(report.differences.some(d => d.record_id === 'HLU-0001' && d.field === 'owner'));
  assert.equal(aon.patch.notes, 'Our own note\n\n— master sheet HLU-0001 —\nNotes: Joint account');
  assert.ok(!('pipeline_status' in aon.patch) && !('last_touch_at' in aon.patch), 'a partner is never stage-moved or touched');
  assert.deepEqual(report.partner_stages.find(s => s.record_id === 'HLU-0001'), { record_id: 'HLU-0001', name: 'Aon', prospector: 'meeting_set', sheet: 'Contacted', dir: 'behind' });
  assert.deepEqual(aon.contacts, [{ op: 'update', id: 'c1', name: 'Pat Lee', patch: { title: 'SVP', role_in_notes: 'champion' } }, { op: 'insert', name: 'Sam Roe', title: 'Director', role_in_notes: null }]);
  assert.deepEqual(aon.todo, { text: 'Send deck', due_date: '2026-10-20', owner_user_id: 'u-jack' });

  assert.equal(by['HLU-0002'].route, 'partner_update');
  assert.equal(by['HLU-0002'].goal_id, 'g-adp');
  assert.equal(report.kind_mismatches[0].record_id, 'HLU-0002');
  assert.deepEqual(report.partner_stages.find(s => s.record_id === 'HLU-0002').dir, 'ahead');

  assert.equal(by['HLU-0003'].route, 'partner_to_target');
  assert.equal(by['HLU-0003'].row.status, 'proposed');
  assert.equal(by['HLU-0003'].row.evidence, 'master sheet HLU-0003');
  assert.ok(!by['HLU-0004'], 'possible is not imported');
  assert.deepEqual(report.possibles, [{ record_id: 'HLU-0004', name: 'Invest with Roots', possible: 'partner Roots' }]);

  const mar = by['HLU-0005'];
  assert.equal(mar.route, 'opp_update');
  assert.ok(!('stage' in mar.patch), 'responded -> nurture refused');
  assert.equal(report.opp_stage_refused[0].reason, "can't park responded as nurture");
  assert.equal(mar.patch.apollo_account_id, 'ap-mar');
  assert.equal(mar.patch.owner_team, 'upside');

  const fit = by['HLU-0006'];
  assert.equal(fit.route, 'opp_insert');
  assert.deepEqual([fit.row.stage, fit.row.owner, fit.row.owner_team, fit.row.tier, fit.row.decision_makers, fit.row.record_id],
    ['meeting', 'Jack', 'homelover', '2', 'Jill Vaslow — Benefits lead (champion)', 'HLU-0006']);
  assert.deepEqual([by['HLU-0007'].row.org_type, by['HLU-0007'].row.stage], ['membership', 'on_hold']);
  assert.ok(report.skipped.some(s => s.record_id === 'HLU-0008' && /rejected/.test(s.reason)));
  assert.equal(report.invalid[0].record_id, 'HLU-0009');
});

test('--accept-possible imports the possible as new', () => {
  const { actions } = plan(state(), readInput(csv([ACCOUNTS[3]]), contactsCsv([])), { acceptPossible: ['HLU-0004'] });
  assert.equal(actions[0].route, 'partner_to_target');
});

test('employer stages move forward only; parking only from target/contacted', () => {
  const s = state();
  s.opps.push({ ...s.opps[0], id: 'o-c', organization: 'Contacted Co', stage: 'contacted', apollo_account_id: null });
  s.opps.push({ ...s.opps[0], id: 'o-m', organization: 'Meeting Co', stage: 'meeting', apollo_account_id: null });
  const rows = [
    { record_id: 'A', name: 'Contacted Co', kind: 'employer', funnel_stage: 'Hold' },
    { record_id: 'B', name: 'Meeting Co', kind: 'employer', funnel_stage: 'Contacted' },
  ];
  const { actions, report } = plan(s, readInput(csv(rows), contactsCsv([])));
  assert.equal(actions[0].patch.stage, 'on_hold');
  assert.ok(!('stage' in actions[1].patch));
  assert.equal(report.opp_stage_refused[0].reason, 'stage contacted is behind the current stage meeting');
});

test('a re-run against the applied state plans no writes', () => {
  const s = state();
  const input = readInput(csv(ACCOUNTS), contactsCsv(CONTACTS));
  const first = plan(s, input);
  for (const a of first.actions) {
    if (a.route === 'partner_update') {
      Object.assign(s.partners.find(p => p.id === a.goal_id), a.patch, a.assign);
      for (const c of a.contacts) c.op === 'insert' ? s.contacts.push({ id: `c-${c.name}`, goal_id: a.goal_id, name: c.name, title: c.title, role_in_notes: c.role_in_notes }) : Object.assign(s.contacts.find(x => x.id === c.id), c.patch);
      if (a.todo) s.todos.push({ id: 'td', text: a.todo.text, status: 'open', kind: 'todo' });
    }
    if (a.route === 'partner_to_target') s.targets.push({ id: `t-${a.record_id}`, ...a.row });
    if (a.route === 'opp_update') Object.assign(s.opps.find(o => o.id === a.opp_id), a.patch);
    if (a.route === 'opp_insert') s.opps.push({ id: `o-${a.record_id}`, apollo_account_id: null, cohort: null, next_action: null, next_action_date: null, owner: null, owner_team: null, co_owner_name: null, notes: null, decision_makers: null, tier: null, ...a.row });
  }
  const again = plan(s, input);
  for (const a of again.actions) {
    const writes = { ...(a.patch || {}), ...(a.assign || {}), ...(a.row && a.route.endsWith('insert') || a.route === 'partner_to_target' ? { insert: true } : {}) };
    assert.deepEqual(writes, {}, `${a.record_id} ${a.route}`);
    assert.deepEqual(a.contacts || [], []);
    assert.equal(a.todo ?? null, null);
  }
  assert.equal(again.report.counts.opp_insert, 0);
  assert.equal(again.report.counts.partner_to_target, 0);
  assert.equal(again.report.opp_stage_moves.length, 0);
});

test('the marker block is replaced, never duplicated, and the user\'s notes stay', () => {
  const once = withBlock('Mine\n\nMore of mine', 'HLU-1', ['Notes: a']);
  assert.equal(withBlock(once, 'HLU-1', ['Notes: b']), 'Mine\n\nMore of mine\n\n— master sheet HLU-1 —\nNotes: b');
  assert.equal(withBlock(withBlock(once, 'HLU-1', ['Notes: b']), 'HLU-1', ['Notes: b']), withBlock(once, 'HLU-1', ['Notes: b']));
  assert.equal(companyDomain('global.lockton.com'), 'lockton.com');
  assert.equal(companyDomain('x.co.uk'), 'x.co.uk');
});
