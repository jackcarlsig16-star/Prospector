import fs from 'fs';
import path from 'path';
import { render, waitFor } from '@testing-library/react';
import { BUSINESS_NAV } from '../constants/businessNav';
import DailyDigest from './DailyDigest';
import PersistentScout from './PersistentScout';

jest.mock('./ScoutCommandBar', () => function ScoutCommandBar(props) { return <div data-scout-bar={props.compact ? 'compact' : 'full'} />; });

// visual-nav-cleanup-v1 Stage 1 - C1 no Claude call without a click, C2 one Scout bar, C6 Grow.
test('C1: App.js has no eager brief / week-ahead call; the digest mounted closed calls the Claude proxy never', async () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');
  expect(app).not.toMatch(/generateBrief\(|buildWeekAhead\(/);
  const spy = jest.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve({ ok: true, json: async () => ({}), text: async () => '' }));
  render(<DailyDigest open={false} setOpen={() => {}} hideTrigger accounts={[]} tasks={[]} firstName="Jack" />);
  await waitFor(() => {});
  expect(spy.mock.calls.map(c => String(c[0])).filter(u => u.includes('/proxy/anthropic'))).toEqual([]);
  spy.mockRestore();
});

test('C2: one Scout bar per page - compact in a workspace header, full elsewhere; never both', () => {
  const props = { businesses: [], territoryAccounts: [], activeUser: { id: 'u1', name: 'Jack' }, onNav: () => {}, onCreateTask: () => {} };
  const { unmount } = render(<PersistentScout {...props} compact isBusinessContext={false} />);
  expect([...document.querySelectorAll('[data-scout-bar]')].map(b => b.dataset.scoutBar)).toEqual(['compact']);
  unmount();
  render(<PersistentScout {...props} isBusinessContext={false} />);
  expect([...document.querySelectorAll('[data-scout-bar]')].map(b => b.dataset.scoutBar)).toEqual(['full']);
});

test('C6: HumanKind\'s nav item reads Grow (flag id, route and icon unchanged)', () => {
  expect(BUSINESS_NAV.find(n => n.feature === 'hk_sales')).toMatchObject({ id: 'hk-sales', ic: '✿', lb: 'Grow' });
  const src = ['HkChrome.js', 'HkShell.js'].map(f => fs.readFileSync(path.join(__dirname, '..', 'hk', f), 'utf8')).join('\n');
  const visible = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  expect(visible).not.toMatch(/Sales OS/);
});
