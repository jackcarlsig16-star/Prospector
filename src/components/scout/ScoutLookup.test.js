import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import PersistentScout from '../PersistentScout';

// FIX scout-company-lookup - the screen states over invented replies (0 server, 0 model): the brief grid's Owner row,
// the owner lead with the Assign offer (each member opens the assign card; nothing is written until Confirm), the
// "no record" state with Did you mean and Add as target, and a Viewer (no offer, no Add). Company names only.
const mockAdd = jest.fn();
jest.mock('../../utils/useMediaQuery', () => () => false);
jest.mock('../salesAnalytics/goals/goalsApi', () => ({ goalsApi: {
  members: () => Promise.resolve([{ user_id: 'u1', name: 'Ana Member', color: '#6F8CF0' }, { user_id: 'u2', name: 'Bo Member', color: '#C97626' }]),
  addToPipeline: (...a) => mockAdd(...a),
} }));
jest.mock('../salesAnalytics/goals/priorities/ComposePanel', () => () => null);

const B1 = { id: 'b1', name: 'HomeLover', color: '#E2418A', features: { goals_sales: true } };
const member = { profile: { id: 'u1' }, memberships: [{ business_id: 'b1', role: 'member' }] };
const viewer = { profile: { id: 'u9' }, memberships: [{ business_id: 'b1', role: 'viewer' }] };
const record = (id, name) => ({ entity: 'targets', id, title: name, score: 61, workspace_id: 'b1', workspace_name: 'HomeLover', open: { page: 'sales', params: { tab: 'pipeline', view: 'companies', open: `target-${id}` } }, why: `${name} · target`, row: { kind: 'company', type: 'target', id, name, score: 61, band: 'P2' } });
const base = { usage: { input_tokens: 2000, output_tokens: 120, cost_usd: 0.009 }, withheld: false, ask: { sort: null, company: [] }, context_stats: { reads: ['goals/brief/target'], rows_by_entity: { targets: 1 } }, cap: { used: 1, max: 40 }, scope: 'b1' };
const brief = (row, owner, summary, extra = {}) => ({ ...base, answer_md: summary, summary, items: [row], ...extra,
  sections: [{ title: 'Brief', count: 1, total: 1, rule: 'Everything on file for the record named.', read: 'goals/brief/target', rows: [row], line: null, brief: { entity: 'targets', id: row.id, grid: [{ label: 'Record', value: 'target · stage researching' }, { label: 'Owner', value: owner }, { label: 'Visits', value: '4 visits in 7 days' }] } }] });
const GREY = record('t5', 'GreyOrange'), LANE = record('t7', 'Mission Lane');
const OWNED = brief(GREY, 'Cyrus', 'GreyOrange is owned by Cyrus · assigned 2026-11-13. It is a researching target with 4 visits this week.');
const UNOWNED = brief(LANE, 'Unassigned', 'Mission Lane has no owner — assign it? A researching target.', { offer: { verb: 'assign', key: 'targets:t7', label: 'Assign' } });
const none = cant => ({ answer_md: cant.reason, summary: cant.reason, sections: [], items: [], usage: null, withheld: false, scope: 'b1', cap: { used: 1, max: 40 }, cant });
const CARD = { plan_id: 'plan-a', verb: 'assign', label: 'Assign', to: 'Bo', when: null, rows: [{ key: 'targets:t7', kind: 'target', title: 'Mission Lane', from: 'Unassigned', to: 'Bo', skipped: null, note: null }], summary: { will: 1, skipped: 0 }, note: null, expires_at: '2026-11-19T20:02:00Z' };

let replies;
const json = (status, body) => Promise.resolve({ ok: status < 400, status, json: async () => body });
const calls = path => global.fetch.mock.calls.filter(c => c[0] === path).map(c => JSON.parse(c[1].body));
beforeEach(() => {
  localStorage.clear();
  mockAdd.mockImplementation(() => Promise.resolve({ created: { type: 'target', id: 't9', name: 'Acme Robotics' } }));
  replies = { ask: () => json(200, OWNED), plan: () => json(200, CARD) };
  global.fetch = jest.fn(url => { const k = String(url).split('/').pop().split('?')[0]; return replies[k] ? replies[k]() : json(200, { groups: [] }); });
});
const mount = (props = {}) => {
  const utils = render(<PersistentScout compact businesses={[B1]} activeBusiness={B1} me={member} onOpen={jest.fn()} {...props} />);
  return { ...utils, input: screen.getByRole('combobox', { name: 'Search or ask Scout' }) };
};
const enter = (input, v) => { fireEvent.focus(input); fireEvent.change(input, { target: { value: v } }); fireEvent.keyDown(input, { key: 'Enter' }); };
const $ = (c, sel) => c.querySelector(sel);

test('S2 / S3 the brief grid carries an Owner row and the answer opens with the owner; an owned record offers no assign', async () => {
  const { container, input } = mount();
  enter(input, 'tell me about greyorange and who owns');
  await waitFor(() => expect($(container, '[data-scout-brief-grid]')).toBeTruthy());
  const grid = $(container, '[data-scout-brief-grid]');
  expect([...grid.querySelectorAll('dt')].map(x => x.textContent)).toEqual(['Record', 'Owner', 'Visits']);
  expect([...grid.querySelectorAll('dd')][1].textContent).toBe('Cyrus');
  expect($(container, '[data-scout-prose]').textContent).toMatch(/^GreyOrange is owned by Cyrus · assigned 2026-11-13\./);
  expect($(container, '[data-scout-offer]')).toBeNull();
  expect(calls('/api/scout/ask')[0]).toMatchObject({ q: 'tell me about greyorange and who owns', scope: 'b1' });
});

test('S3 nobody owns it: the members are offered, a pick shows the assign card for that row and nothing is acted until Confirm; a Viewer gets no offer', async () => {
  replies.ask = () => json(200, UNOWNED);
  const { container, input, unmount } = mount();
  enter(input, 'who owns mission lane');
  await waitFor(() => expect($(container, '[data-scout-offer]')).toBeTruthy());
  expect($(container, '[data-scout-prose]').textContent).toMatch(/^Mission Lane has no owner — assign it\?/);
  expect([...$(container, '[data-scout-brief-grid]').querySelectorAll('dd')][1].textContent).toBe('Unassigned');
  const offer = $(container, '[data-scout-offer]');
  expect(offer.getAttribute('aria-label')).toBe('Assign Mission Lane');
  expect(within(offer).getAllByRole('button').map(b => b.textContent)).toEqual(['Ana', 'Bo']);
  fireEvent.click(within(offer).getByRole('button', { name: 'Bo' }));
  await waitFor(() => expect(calls('/api/scout/plan')).toHaveLength(1));
  expect(calls('/api/scout/plan')[0]).toMatchObject({ verb: 'assign', keys: ['targets:t7'], args: { owner_user_id: 'u2' }, rows: [{ entity: 'targets', id: 't7', title: 'Mission Lane' }] });
  await waitFor(() => expect(screen.getByRole('button', { name: /Confirm/ })).toBeTruthy());
  expect(calls('/api/scout/act')).toHaveLength(0);
  unmount();
  const v = mount({ me: viewer });
  enter(v.input, 'who owns mission lane');
  await waitFor(() => expect($(v.container, '[data-scout-brief-grid]')).toBeTruthy());
  expect($(v.container, '[data-scout-offer]')).toBeNull();
});

test('S4 no record: the reason alone; a near name is a "Did you mean" button that asks about that record; a company the site has seen offers Add as target (Members only)', async () => {
  replies.ask = () => json(200, none({ reason: 'No record named nothingco in Prospector' }));
  const { container, input, unmount } = mount();
  enter(input, 'tell me about nothingco');
  await waitFor(() => expect($(container, '[data-scout-cant]')).toBeTruthy());
  expect($(container, '[data-scout-cant]').textContent).toBe('No record named nothingco in Prospector');
  expect($(container, '[data-scout-which]')).toBeNull(); expect($(container, '[data-scout-add-target]')).toBeNull();
  expect($(container, '[data-scout-answer]')).toBeNull(); // no turn, nothing spent

  replies.ask = () => json(200, none({ reason: 'No record named greyorang in Prospector', did_you_mean: true, candidates: [{ key: 'targets:t5', entity: 'targets', id: 't5', title: 'GreyOrange', ask: 'who owns "GreyOrange"' }] }));
  enter(input, 'who owns greyorang');
  await waitFor(() => expect($(container, '[data-scout-which]')).toBeTruthy());
  expect($(container, '[data-scout-cant]').getAttribute('data-scout-cant')).toBe('');
  expect($(container, '[data-scout-cant]').textContent).toBe('No record named greyorang in ProspectorDid you meanGreyOrange');
  replies.ask = () => json(200, OWNED);
  fireEvent.click(within($(container, '[data-scout-which]')).getByRole('button', { name: 'GreyOrange' }));
  await waitFor(() => expect($(container, '[data-scout-brief-grid]')).toBeTruthy());
  expect(calls('/api/scout/ask').at(-1)).toMatchObject({ q: 'who owns "GreyOrange"' });

  const SEEN = none({ reason: 'No record named Acme Robotics in Prospector · seen on the site on 2 days in the last 90, last 2026-11-18', add: { label: 'Add as target', type: 'visitor', id: 'k-acme', name: 'Acme Robotics' } });
  replies.ask = () => json(200, SEEN);
  enter(input, 'tell me about acme robotics');
  await waitFor(() => expect($(container, '[data-scout-add-target]')).toBeTruthy());
  expect(mockAdd).not.toHaveBeenCalled();
  fireEvent.click($(container, '[data-scout-add-target]'));
  await waitFor(() => expect($(container, '[data-scout-note="opened"]')?.textContent).toBe('Acme Robotics added as a target'));
  expect(mockAdd.mock.calls).toEqual([['b1', { type: 'visitor', id: 'k-acme', to: 'target' }]]);
  unmount();
  const v = mount({ me: viewer });
  enter(v.input, 'tell me about acme robotics');
  await waitFor(() => expect($(v.container, '[data-scout-cant]')).toBeTruthy());
  expect($(v.container, '[data-scout-cant]').textContent).toMatch(/seen on the site on 2 days/);
  expect($(v.container, '[data-scout-add-target]')).toBeNull();
});
