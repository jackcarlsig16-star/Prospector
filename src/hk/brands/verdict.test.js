import { verdictView, saveRule, fromDetail, VERDICTS } from './verdict';

// hkos-data-foundation-v1 Stage 3 - the Verdict banner's seven states and the Add brand save rules.
const members = [{ user_id: 'u-jack', first_name: 'Jack' }, { user_id: 'u-pete', first_name: 'Pete' }];
const view = v => verdictView(v, { members, brandName: 'Lakeview Bakery' });

test('seven states: tone, blocking and force rules', () => {
  const cases = {
    clear: { tone: 'green', blocks: false, needsForce: false },
    warm: { tone: 'blue', blocks: false, needsForce: false },
    sponsor: { tone: 'block', blocks: true, needsForce: false },
    do_not_contact: { tone: 'block', blocks: true, needsForce: false },
    owned_by: { tone: 'orange', blocks: false, needsForce: true },
    possible_duplicate: { tone: 'mustard', blocks: false, needsForce: true },
    niche_warning: { tone: 'mustard', blocks: false, needsForce: false },
  };
  expect(Object.keys(cases)).toEqual(VERDICTS);
  for (const [verdict, want] of Object.entries(cases)) {
    const v = view({ verdict, warnings: verdict === 'niche_warning' ? [{ code: 'niche_overlap', sponsor: 'Northwind Juice' }] : [] });
    expect([v.tone, v.blocks, v.needsForce]).toEqual([want.tone, want.blocks, want.needsForce]);
    expect(v.title).toBeTruthy(); expect(v.line).toBeTruthy();
    expect(`${v.title}${v.line}`).not.toMatch(/[–—]/);
  }
});

test('copy names people and matches from the inputs', () => {
  expect(view({ verdict: 'owned_by', owner_user_id: 'u-pete', match: { id: 'b1', name: 'Harbor Yoga' } }).title).toBe('Owned by Pete');
  expect(view({ verdict: 'warm', founder_user_id: 'u-jack', last_at: '2026-10-02T00:00:00Z' }).title).toBe('Warm with Jack');
  expect(view({ verdict: 'sponsor', match: { id: 'b2', name: 'Northwind Juice' } }).line).toMatch(/Northwind Juice is never cold-pitched/);
  const dup = view({ verdict: 'possible_duplicate', exact: false, matches: [{ id: 'b9', name: 'Bluefin Run Club' }], legacy: [{ name: 'Dunmore Mills', kind: 'business' }] });
  expect([dup.title, dup.line, dup.matchId]).toEqual(['Possible duplicate', 'Looks like Bluefin Run Club, Dunmore Mills (legacy business).', 'b9']);
  expect(view({ verdict: 'possible_duplicate', exact: false, matches: [], legacy: [{ name: 'Dunmore Mills', kind: 'business' }] }).matchId).toBeNull();
  expect(view({ verdict: 'possible_duplicate', exact: true, match: { id: 'b3', name: 'Bluefin Run Club' } }).title).toBe('Already in Brands');
  expect(view({ verdict: 'niche_warning', warnings: [{ code: 'niche_overlap', sponsor: 'Northwind Juice' }] }).title).toBe('Niche overlap with Northwind Juice');
  expect(view({ verdict: 'clear', warnings: [{ code: 'niche_overlap', sponsor: 'Northwind Juice' }] }).note).toBe('Niche overlaps with sponsor Northwind Juice.');
});

test('save rules: blocked on sponsor / DNC, Save anyway on owned_by / duplicate, open otherwise and before any check', () => {
  expect(saveRule(null)).toEqual({ canSave: true, label: 'Save' });
  expect(saveRule(view({ verdict: 'clear' })).canSave).toBe(true);
  expect(saveRule(view({ verdict: 'niche_warning', warnings: [] })).canSave).toBe(true);
  expect(saveRule(view({ verdict: 'sponsor' }))).toEqual({ canSave: false, label: 'Save', why: 'Already a sponsor or founding partner' });
  expect(saveRule(view({ verdict: 'do_not_contact' })).canSave).toBe(false);
  expect(saveRule(view({ verdict: 'possible_duplicate' })).canSave).toBe(false);
  expect(saveRule(view({ verdict: 'possible_duplicate' }), { force: true })).toEqual({ canSave: true, label: 'Save anyway' });
  expect(saveRule(view({ verdict: 'owned_by', owner_user_id: 'u-pete' }), { force: true }).canSave).toBe(true);
});

test('brand-detail verdicts map onto the banner, including the three server-only reasons', () => {
  expect(fromDetail({ ok: true, warnings: [] })).toEqual({ verdict: 'clear', warnings: [] });
  expect(fromDetail({ ok: true, warnings: [{ code: 'niche_overlap', sponsor: 'X' }] }).verdict).toBe('niche_warning');
  expect(view(fromDetail({ ok: false, reason: 'max_touches', sent: 3, max: 3 })).title).toBe('Email touches used up (3 of 3)');
  expect(view(fromDetail({ ok: false, reason: 'passed' })).blocks).toBe(true);
  expect(view(fromDetail({ ok: false, reason: 'owner_unclear' })).tone).toBe('orange');
  expect(view(fromDetail({ ok: false, reason: 'owned_by', owner_user_id: 'u-pete' })).title).toBe('Owned by Pete');
});
