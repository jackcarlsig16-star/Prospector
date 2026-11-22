import { renderHook, act } from '@testing-library/react';
import { useWorkspaceShell } from './useWorkspaceShell';
import { scoutApi } from './scout/scoutApi';
import { readThread } from './scout/scoutModel';
import { FOCUS_FIELD } from '../shell/ShellSearch';

// app-shell-v2 Stage 3 (W1 / W2) - where an ask from the header's one field goes: a short answer stays in the panel, a
// list or a command opens the Scout WINDOW over the page (no navigation), and on the Scout page every ask is that
// page's own (the field is its composer). Invented names; 0 server.
jest.mock('./scout/scoutApi', () => ({ scoutApi: { quick: jest.fn(), ask: jest.fn() } }));
jest.mock('./salesAnalytics/goals/goalsApi', () => ({ TODOS_CHANGED: 'test:todos', PAGE_LOAD_FAILURES: 'test:failures', goalsApi: { today: () => Promise.resolve({ badge: 0 }), members: () => Promise.resolve([]) } }));
jest.mock('./salesAnalytics/goals/AttentionDrawer', () => () => null);
jest.mock('../utils/authSession', () => ({ signOut: jest.fn() }));

const B1 = { id: 'b1', name: 'Northwind', color: '#E2418A', features: { goals_sales: true } };
const me = { profile: { id: 'u1' }, memberships: [{ business_id: 'b1', role: 'member' }] };
const row = i => ({ entity: 'todos', id: `t${i}`, title: `To-do ${i}`, open: { page: 'sales', params: { open: `todo:t${i}` } } });
const reply = rows => ({ answer_md: 'Said.', summary: 'Said.', sections: [{ title: 'Rows', rows }], items: rows, usage: null, cap: { used: 1, max: 40 }, context_stats: { reads: [], rows_by_entity: { todos: rows.length } } });
const mount = (over = {}) => {
  const nav = { setPage: jest.fn(), setBusinessPage: jest.fn() };
  const props = { me, activeUser: { name: 'Ana Member' }, page: 'business-detail', businessPage: 'sales-analytics', activeBusiness: B1, businesses: [B1], compact: false, showAdmin: false, showUiKit: false, ideasBadge: 0, openScoutItem: jest.fn(), onSelectBusiness: jest.fn(), onAllWorkspaces: jest.fn(), onOpenDigest: jest.fn(), onOpenBugReport: jest.fn(), onOpenProfile: jest.fn(), legacyScout: null, ...nav, ...over };
  const hook = renderHook(p => useWorkspaceShell(p), { initialProps: props });
  const field = () => hook.result.current.shell.search({}).props;
  return { ...hook, props, nav, field };
};
beforeEach(() => { localStorage.clear(); scoutApi.ask.mockReset(); });

test('a short answer stays in the panel; a list opens the Scout window on the thread; a command is planned in the window - none of them changes the page', async () => {
  const h = mount();
  await act(async () => {});
  expect(h.result.current.scout).toEqual(expect.objectContaining({ open: false, seed: null, pageSeed: null }));
  scoutApi.ask.mockResolvedValueOnce(reply([row(1)]));
  let out;
  await act(async () => { out = await h.field().onAsk('who owns metro life'); });
  expect(out).toEqual(expect.objectContaining({ summary: 'Said.', row: expect.objectContaining({ id: 't1' }) }));
  expect(h.result.current.scout.open).toBe(false);
  scoutApi.ask.mockResolvedValueOnce(reply([row(1), row(2), row(3)]));
  await act(async () => { out = await h.field().onAsk('my overdue to-dos'); });
  expect(out).toEqual({ page: true });
  expect(h.result.current.scout).toEqual(expect.objectContaining({ open: true, seed: expect.objectContaining({ openLast: true }), pageSeed: null }));
  expect(readThread('u1').map(t => t.q)).toEqual(['who owns metro life', 'my overdue to-dos']);
  const heard = jest.fn();
  window.addEventListener(FOCUS_FIELD, heard);
  jest.useFakeTimers();
  act(() => { h.result.current.scout.close(true); jest.runAllTimers(); });
  jest.useRealTimers();
  expect(h.result.current.scout.open).toBe(false);
  expect(h.result.current.scout.seed).toBeTruthy();
  expect(heard).toHaveBeenCalledTimes(1);
  act(() => { h.result.current.scout.close(false); });
  expect(heard).toHaveBeenCalledTimes(1);
  window.removeEventListener(FOCUS_FIELD, heard);
  await act(async () => { out = await h.field().onAsk('assign metro life to ana'); });
  expect(out).toEqual({ page: true });
  expect(scoutApi.ask).toHaveBeenCalledTimes(2);
  expect(h.result.current.scout).toEqual(expect.objectContaining({ open: true, seed: expect.objectContaining({ q: 'assign metro life to ana' }) }));
  act(() => { h.field().onOpenScout(); });
  expect(h.result.current.scout.seed).toEqual(expect.objectContaining({ openLast: true }));
  expect(h.nav.setPage).not.toHaveBeenCalled();
  expect(h.nav.setBusinessPage).not.toHaveBeenCalled();
});

test('on the Scout page the field is the page\'s composer: the window shuts, every ask is handed to the page unasked here, and leaving the page drops the line', async () => {
  const h = mount();
  scoutApi.ask.mockResolvedValueOnce(reply([row(1), row(2)]));
  await act(async () => { await h.field().onAsk('my overdue to-dos'); });
  expect(h.result.current.scout.open).toBe(true);
  h.rerender({ ...h.props, businessPage: 'scout' });
  expect(h.result.current.scout.open).toBe(false);
  let out;
  await act(async () => { out = await h.field().onAsk('who owns metro life'); });
  expect(out).toEqual({ page: true });
  expect(scoutApi.ask).toHaveBeenCalledTimes(1);
  expect(h.result.current.scout).toEqual(expect.objectContaining({ open: false, pageSeed: expect.objectContaining({ q: 'who owns metro life' }) }));
  h.rerender({ ...h.props, businessPage: 'sales-analytics' });
  expect(h.result.current.scout.pageSeed).toBeNull();
  h.rerender({ ...h.props, activeBusiness: { ...B1, id: 'b2' }, businesses: [{ ...B1, id: 'b2' }] });
  expect(h.result.current.scout).toEqual(expect.objectContaining({ open: false, seed: null }));
});
