import test from 'node:test';
import assert from 'node:assert/strict';
import { readInput, plan, withBlock, companyDomain, ImportRefused } from './masterImport.js';

// The sheet's own 32-column export shape, cells in the sheet's vocabulary.
const SHEET = ['Record ID', 'Account', 'Account Type', 'Segment', 'Priority Tier', 'Funnel Stage', 'Partner Path', 'Owner Team', 'Owner',
  'Co-owner Team', 'Next Step', 'Next Step Due', 'Last Touch Date', 'Last Touch By', 'Primary Contact', 'Primary Title', 'Primary Email Domain',
  'Email Status', 'Has Phone', 'Contacts Emailed (#)', 'Contacts Emailed Domains', 'Route In', 'Broker on Account', 'Brad Reached Out',
  'HomeLover Outreach', 'Both Teams Touched', 'On Brad Target List', 'Original Priority', 'Flags', 'Notes', 'Source', 'Confirmed with Brad'];
const cell = v => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const csv = (rows, headers = SHEET) => [headers.join(','), ...rows.map(r => headers.map(h => cell(r[h] ?? '')).join(','))].join('\r\n');

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
  { 'Record ID': 'HLU-0001', Account: 'Aon', 'Account Type': 'Partner', 'Priority Tier': '1 - Priority', 'Funnel Stage': '2 - Contacted', 'Owner Team': 'Upside', Owner: 'Cyrus', 'Next Step': 'Send deck', 'Next Step Due': '2026-10-20', Notes: 'Joint account', 'Primary Contact': 'Pat Lee', 'Primary Title': 'SVP', 'Last Touch Date': '2026-10-01', 'Has Phone': 'Yes' },
  { 'Record ID': 'HLU-0002', Account: 'ADP', 'Account Type': 'Employer', 'Primary Email Domain': 'www.adp.com; adp.net', 'Funnel Stage': '3 - Engaged', 'Owner Team': 'Both' },
  { 'Record ID': 'HLU-0003', Account: 'Burnham Benefits', 'Account Type': 'Partner', Segment: 'Broker', 'Owner Team': 'Upside', Owner: 'Brad Cillian', 'Funnel Stage': '5 - Meeting held', 'Primary Contact': 'Dana Fox; Lee Park' },
  { 'Record ID': 'HLU-0004', Account: 'Invest with Roots', 'Account Type': 'Partner', 'Funnel Stage': '2 - Contacted' },
  { 'Record ID': 'HLU-0005', Account: 'Marriott International', 'Account Type': 'Employer', 'Primary Email Domain': 'marriott.com', 'Funnel Stage': '8 - Nurture', 'Owner Team': 'Upside', 'Priority Tier': '1 - Priority', Segment: 'Hospitality' },
  { 'Record ID': 'HLU-0006', Account: '24 Hour Fitness', 'Account Type': 'Employer', 'Funnel Stage': '4 - Meeting scheduled', 'Owner Team': 'HomeLover', Owner: 'Jack', 'Priority Tier': '2 - Secondary', 'Partner Path': 'Direct', 'Primary Contact': 'Jill Vaslow', 'Primary Title': 'Benefits lead' },
  { 'Record ID': 'HLU-0007', Account: 'Teachers Guild', 'Account Type': 'Association', 'Funnel Stage': '9 - Hold / disqualified' },
  { 'Record ID': 'HLU-0008', Account: 'Nope Inc', 'Account Type': 'Partner' },
  { 'Record ID': 'HLU-0009', Account: 'Bad Row', 'Account Type': 'Vendor' },
];
const BASE = { 'Record ID': 'HLU-0001', Account: 'Aon', 'Account Type': 'Partner' };

test('refused only on a missing Record ID / Account column, any "@" or a phone number; dates are fine', () => {
  assert.throws(() => readInput(csv([{ ...BASE, Notes: 'ask pat at pat lee@aon.com' }])), ImportRefused);
  assert.throws(() => readInput(csv([{ ...BASE, 'Confirmed with Brad': 'call 312-555-0199' }])), ImportRefused, 'ignored columns are checked too');
  assert.throws(() => readInput(csv([BASE], SHEET.filter(h => h !== 'Account'))), /missing required column: Account/);
  assert.throws(() => readInput(csv([BASE], SHEET.filter(h => h !== 'Record ID'))), /missing required column: Record ID/);
  assert.doesNotThrow(() => readInput(csv([{ ...BASE, 'Next Step Due': '2026-10-20', 'Last Touch Date': '2026-10-01' }])));
});

test('header map: case/space-insensitive, unknown + ignored headers listed, optional headers may be missing, prefixes stripped', () => {
  const headers = ['record id', 'ACCOUNT', 'Account  Type', 'priority tier', 'Funnel Stage', 'Brand New Column'];
  const input = readInput(csv([{ 'record id': 'X1', ACCOUNT: 'Acme', 'Account  Type': 'Health plan', 'priority tier': '4 - Hold', 'Funnel Stage': '9 - Hold / disqualified', 'Brand New Column': 'z' }], headers));
  assert.deepEqual(input.ignored, ['Brand New Column']);
  assert.deepEqual([input.accounts[0].kind, input.accounts[0].tier, input.accounts[0].funnel_stage, input.accounts[0].owner_team], ['health_plan', '4', 'Hold', '']);
  const full = readInput(csv(ACCOUNTS));
  assert.deepEqual(full.ignored, ['Co-owner Team', 'Last Touch Date', 'Last Touch By', 'Email Status', 'Has Phone', 'Contacts Emailed (#)', 'Contacts Emailed Domains',
    'Brad Reached Out', 'HomeLover Outreach', 'Both Teams Touched', 'On Brad Target List', 'Original Priority', 'Confirmed with Brad']);
  const adp = full.accounts.find(a => a.record_id === 'HLU-0002');
  assert.deepEqual([adp.company_domain, adp.owner_team, adp.funnel_stage], ['adp.com', 'both', 'Engaged'], 'first domain only, owner team lowercased');
  const burnham = full.accounts.find(a => a.record_id === 'HLU-0003');
  assert.equal(burnham.co_owner_name, 'Brad Cillian', 'an Owner who is not Jack/Cyrus is the co-owner');
  assert.deepEqual(full.multiPerson, [{ record_id: 'HLU-0003', name: 'Burnham Benefits' }]);
  assert.ok(!full.contacts.has('HLU-0003'), 'a multi-person cell is reported, not split or imported');
});

test('a quoted cell with line breaks stays one cell', () => {
  const input = readInput(csv([{ ...BASE, Notes: 'line one\nline two' }, { 'Record ID': 'HLU-0002', Account: 'ADP', 'Account Type': 'Employer' }]));
  assert.equal(input.accounts.length, 2);
  assert.equal(input.accounts[0].notes, 'line one line two');
});

test('routes: partner update / employer-that-is-a-partner / target / possible / opp update + insert / rejected target / invalid', () => {
  const { actions, report } = plan(state(), readInput(csv(ACCOUNTS)), { today: '2026-10-15' });
  const by = Object.fromEntries(actions.map(a => [a.record_id, a]));
  assert.deepEqual(report.counts, { partner_update: 2, partner_to_target: 1, target_update: 0, opp_insert: 2, opp_update: 1, skipped: 2, invalid: 1 });

  const aon = by['HLU-0001'];
  assert.equal(aon.route, 'partner_update');
  assert.deepEqual(aon.assign, { owner_team: 'upside' }, 'owner kept (Jack), Cyrus reported');
  assert.ok(report.differences.some(d => d.record_id === 'HLU-0001' && d.field === 'tier'));
  assert.ok(report.differences.some(d => d.record_id === 'HLU-0001' && d.field === 'owner'));
  assert.equal(aon.patch.notes, 'Our own note\n\n— master sheet HLU-0001 —\nNotes: Joint account');
  assert.ok(!('pipeline_status' in aon.patch) && !('last_touch_at' in aon.patch), 'a partner is never stage-moved or touched');
  assert.deepEqual(report.partner_stages.find(s => s.record_id === 'HLU-0001'), { record_id: 'HLU-0001', name: 'Aon', prospector: 'meeting_set', sheet: 'Contacted', dir: 'behind' });
  assert.deepEqual(aon.contacts, [{ op: 'update', id: 'c1', name: 'Pat Lee', patch: { title: 'SVP' } }]);
  assert.deepEqual(aon.todo, { text: 'Send deck', due_date: '2026-10-20', owner_user_id: 'u-jack' });

  assert.equal(by['HLU-0002'].route, 'partner_update');
  assert.equal(by['HLU-0002'].goal_id, 'g-adp');
  assert.equal(report.kind_mismatches[0].record_id, 'HLU-0002');
  assert.deepEqual(report.partner_stages.find(s => s.record_id === 'HLU-0002').dir, 'ahead');

  assert.equal(by['HLU-0003'].route, 'partner_to_target');
  assert.equal(by['HLU-0003'].row.status, 'proposed');
  assert.equal(by['HLU-0003'].row.evidence, 'master sheet HLU-0003');
  assert.equal(by['HLU-0003'].row.co_owner_name, 'Brad Cillian');
  assert.equal(by['HLU-0003'].row.research_notes, null, 'multi-person cell not imported');
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
    ['meeting', 'Jack', 'homelover', '2', 'Jill Vaslow — Benefits lead', 'HLU-0006']);
  assert.equal(by['HLU-0005'].patch.cohort, 'Hospitality');
  assert.ok(!/Segment/.test(by['HLU-0005'].patch.notes || ''), 'opps keep segment as cohort, not in notes');
  assert.deepEqual([by['HLU-0007'].row.org_type, by['HLU-0007'].row.stage], ['membership', 'on_hold']);
  assert.ok(report.skipped.some(s => s.record_id === 'HLU-0008' && /rejected/.test(s.reason)));
  assert.equal(report.invalid[0].record_id, 'HLU-0009');
});

test('--accept-possible imports the possible as new', () => {
  const { actions } = plan(state(), readInput(csv([ACCOUNTS[3]])), { acceptPossible: ['HLU-0004'] });
  assert.equal(actions[0].route, 'partner_to_target');
});

test('employer stages move forward only; parking only from target/contacted', () => {
  const s = state();
  s.opps.push({ ...s.opps[0], id: 'o-c', organization: 'Contacted Co', stage: 'contacted', apollo_account_id: null });
  s.opps.push({ ...s.opps[0], id: 'o-m', organization: 'Meeting Co', stage: 'meeting', apollo_account_id: null });
  const rows = [
    { 'Record ID': 'A', Account: 'Contacted Co', 'Account Type': 'Employer', 'Funnel Stage': '9 - Hold / disqualified' },
    { 'Record ID': 'B', Account: 'Meeting Co', 'Account Type': 'Employer', 'Funnel Stage': '2 - Contacted' },
  ];
  const { actions, report } = plan(s, readInput(csv(rows)));
  assert.equal(actions[0].patch.stage, 'on_hold');
  assert.ok(!('stage' in actions[1].patch));
  assert.equal(report.opp_stage_refused[0].reason, 'stage contacted is behind the current stage meeting');
});

test('a re-run against the applied state plans no writes', () => {
  const s = state();
  const input = readInput(csv(ACCOUNTS));
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
