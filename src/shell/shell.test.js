import { render, screen, fireEvent, within, act, waitFor } from '@testing-library/react';
import AppShell, { SettingsFrame, ComingSoon } from './AppShell';
import ShellSearch, { readRecent, markOf, RECENT_KEY, FOCUS_FIELD } from './ShellSearch';
import ShellNav from './ShellNav';
import { createShellRegistry, settingsFor, canAdd } from './shellRegistry';
import { SHELL_RAIL_KEY, SHELL_CSS } from './shellStyles';
import { SALES_SHELL } from '../components/salesAnalytics/shellEntry';

// app-shell-v2 Stage 2 - the shell per state: the nav from a registry entry (active item, badge, groups, rail memory,
// the switcher), the one field (combobox ARIA, keyboard, the five panel states), the header for an owner and for a
// viewer, Settings' two groups, the phone's tabs. Invented companies and people; nothing here names a workspace
// other than the stand-ins below.
const entry = createShellRegistry([SALES_SHELL]).entryFor({ features: { goals_sales: true } });
const navOf = (active, badge = 59) => ({ items: entry.items.map(i => ({ ...i, badge: i.badge === 'today' ? badge : 0 })), footer: [{ id: 'settings', label: 'Settings', icon: 'settings', to: entry.settings.workspace[0].to }], active, phoneTabs: entry.phone });
const WS = [{ id: 'w1', name: 'Northwind', color: '#E2418A' }, { id: 'w2', name: 'Second Space', color: '#3DD68C' }];
const menu = [{ id: 'voice-profile', label: 'Voice profile', onClick: jest.fn() }, 'sep', { id: 'sign-out', label: 'Sign out', onClick: jest.fn() }];
const GROUPS = [
  { key: 'companies', label: 'Companies', count: 5, items: [
    { id: 'partner-1', title: 'Metro Life', sub: 'Partner · Replied', pill: { label: 'P1', value: 68 }, owner: { id: 'u1', name: 'Ana' }, open: { page: 'sales', params: { open: 'partner-1' } } },
    { id: 'target-2', title: 'Metric Labs', sub: 'Target', pill: null, owner: null, open: { page: 'sales', params: { open: 'target-2' } } }] },
  { key: 'people', label: 'People', count: 1, items: [{ id: 'prospect:9', title: 'Dana Mayer', sub: 'People Lead · Metro Life', pill: { label: 'Warm', value: 12 }, owner: null, open: { page: 'sales', params: { open: 'person:prospect:9' } } }] },
  { key: 'todos', label: 'To-dos', count: 1, items: [{ id: 'todo:7', title: 'Reply to the intro thread', sub: 'Metro Life · Ana', pill: null, owner: { id: 'u1', name: 'Ana' }, due: '2026-11-19', open: { page: 'sales', params: { open: 'todo:7' } } }] },
];
const field = () => screen.getByRole('combobox', { name: 'Search or ask Scout' });
const options = () => screen.queryAllByRole('option');
const selected = () => options().find(o => o.getAttribute('aria-selected') === 'true');
const type = async v => { fireEvent.change(field(), { target: { value: v } }); await act(async () => { jest.advanceTimersByTime(200); }); await act(async () => {}); };
function search(props = {}) {
  const p = { userId: 'u1', onSearch: jest.fn(async q => (q.startsWith('zz') ? [] : GROUPS)), onAsk: jest.fn(async () => ({ summary: 'Metro Life is Ana’s.', row: GROUPS[0].items[0], reads: 'companies · to-dos' })), onOpen: jest.fn(), onOpenScout: jest.fn(), tryAsking: ['who visited this week', 'my overdue to-dos', 'my top targets'], today: '2026-11-19', ...props };
  render(<><button type="button">elsewhere</button><ShellSearch {...p} /></>);
  return p;
}
beforeEach(() => { jest.useFakeTimers(); localStorage.clear(); });
afterEach(() => { jest.useRealTimers(); });

test('nav: the entry\'s items in order with the Grow group, the active item marked, the Today badge, Marketing "Soon", Settings below', () => {
  const onGo = jest.fn();
  render(<ShellNav workspace={WS[0]} role="Owner" workspaces={WS} {...navOf('today')} rail={false} onRail={jest.fn()} onGo={onGo} onPickWorkspace={jest.fn()} onAllWorkspaces={jest.fn()} />);
  const nav = screen.getByRole('navigation', { name: 'Main' });
  expect([...nav.querySelectorAll('[data-nav-item]')].map(n => n.dataset.navItem)).toEqual(['home', 'today', 'pipeline', 'dashboard', 'scout', 'marketing', 'ideas', 'settings']);
  expect(within(nav).getByText('Grow')).toBeTruthy();
  const today = nav.querySelector('[data-nav-item=today]');
  expect(today.getAttribute('aria-current')).toBe('page');
  expect(within(today).getByLabelText('59 open').textContent).toBe('59');
  expect([...nav.querySelectorAll('[aria-current=page]')]).toHaveLength(1);
  expect(nav.querySelector('[data-nav-item=marketing]').textContent).toBe('MarketingSoon');
  fireEvent.click(nav.querySelector('[data-nav-item=pipeline]'));
  expect(onGo.mock.calls[0][0].to).toEqual({ page: 'sales-analytics', tab: 'pipeline' });
  expect(screen.getByRole('button', { name: 'Workspace: Northwind' }).textContent).toBe('NNorthwindOwner');
});

test('nav: no other workspace is named until the switcher is opened; it lists the member\'s workspaces and closes on Esc with focus back', () => {
  const onPick = jest.fn(), onAll = jest.fn();
  render(<ShellNav workspace={WS[0]} role="Owner" workspaces={WS} {...navOf('today')} rail={false} onRail={jest.fn()} onGo={jest.fn()} onPickWorkspace={onPick} onAllWorkspaces={onAll} />);
  expect(screen.queryByText('Second Space')).toBeNull();
  const btn = screen.getByRole('button', { name: 'Workspace: Northwind' });
  expect(btn.getAttribute('aria-haspopup')).toBe('listbox');
  fireEvent.click(btn);
  const list = screen.getByRole('listbox', { name: 'Switch workspace' });
  expect(within(list).getAllByRole('option').map(o => [o.textContent, o.getAttribute('aria-selected')])).toEqual([['NNorthwind', 'true'], ['SSecond Space', 'false'], ['All workspaces', 'false']]);
  fireEvent.keyDown(list, { key: 'Escape' });
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(document.activeElement).toBe(btn);
  fireEvent.click(btn);
  fireEvent.click(screen.getByRole('option', { name: /Second Space/ }));
  expect(onPick).toHaveBeenCalledWith(WS[1]);
});

test('shell: the rail is remembered per user (60 px, icons named by aria-label); the workspace hue is the only accent on the nav - no neon', () => {
  const props = { compact: false, userId: 'u1', workspace: WS[0], role: 'Owner', workspaces: WS, nav: navOf('pipeline'), search: null, attention: null, onAddTodo: jest.fn(), user: { name: 'Ana Owner', first: 'Ana', initials: 'AO', sub: 'Owner · Northwind' }, menu, onGo: jest.fn(), onPickWorkspace: jest.fn(), onAllWorkspaces: jest.fn() };
  const { unmount, container } = render(<AppShell {...props}><p>page</p></AppShell>);
  expect(container.querySelector('[data-shell-nav]').dataset.shellNav).toBe('wide');
  expect(container.querySelector('.sh-root').style.getPropertyValue('--sh-hue')).toBe('#E2418A');
  fireEvent.click(screen.getByRole('button', { name: 'Collapse menu' }));
  expect(container.querySelector('[data-shell-nav]').dataset.shellNav).toBe('rail');
  expect(JSON.parse(localStorage.getItem(SHELL_RAIL_KEY))).toEqual({ u1: 'rail' });
  expect(screen.getByRole('button', { name: 'Today, 59' }).getAttribute('title')).toBe('Today');
  expect(screen.getByRole('button', { name: 'Marketing, coming soon' })).toBeTruthy();
  unmount();
  const again = render(<AppShell {...props}><p>page</p></AppShell>);
  expect(again.container.querySelector('[data-shell-nav]').dataset.shellNav).toBe('rail');
  again.unmount();
  const other = render(<AppShell {...props} userId="u2"><p>page</p></AppShell>);
  expect(other.container.querySelector('[data-shell-nav]').dataset.shellNav).toBe('wide');
  // neon is the focused field's colour only: every rule that uses it is the field, its panel's ask row or its Scout label
  const neon = SHELL_CSS.split('\n').filter(l => /--sh-neon\)|57,255,20/.test(l) && !l.startsWith('.sh-root{'));
  expect(neon.length).toBeGreaterThan(0);
  for (const l of neon) expect(l).toMatch(/^\.sh-sf|^\.sh-row--ask/);
  expect(SHELL_CSS).not.toMatch(/\.sh-(ni|nav|tab|centre|hdr)[^{]*\{[^}]*(neon|57,255,20)/);
});

test('header: an owner has Needs attention, + To-do and the account menu (Keyboard shortcuts above Sign out); a viewer has no + To-do', () => {
  const onAddTodo = jest.fn();
  const props = { compact: false, userId: 'u1', workspace: WS[0], role: 'Owner', workspaces: WS, nav: navOf('today'), search: () => <span data-testid="field" />, attention: () => <button type="button" aria-label="Needs attention, 4">Needs attention 4</button>, onAddTodo, user: { name: 'Ana Owner', first: 'Ana', initials: 'AO', sub: 'Owner · Northwind' }, menu, onGo: jest.fn(), onPickWorkspace: jest.fn(), onAllWorkspaces: jest.fn() };
  const { rerender } = render(<AppShell {...props}><p>page</p></AppShell>);
  const header = document.querySelector('[data-shell-header]');
  expect(within(header).getByRole('button', { name: 'Needs attention, 4' })).toBeTruthy();
  fireEvent.click(within(header).getByRole('button', { name: 'To-do' }));
  expect(onAddTodo).toHaveBeenCalledTimes(1);
  const account = screen.getByRole('button', { name: 'Account menu: Ana' });
  expect(account.getAttribute('aria-haspopup')).toBe('menu');
  fireEvent.click(account);
  expect(within(screen.getByRole('menu', { name: 'Account' })).getAllByRole('menuitem').map(m => m.textContent)).toEqual(['Voice profile', 'Keyboard shortcuts', 'Sign out']);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Keyboard shortcuts' }));
  expect(within(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).getByText('Ask Scout')).toBeTruthy();
  rerender(<AppShell {...props} onAddTodo={null} role="Viewer"><p>page</p></AppShell>);
  expect(screen.queryByRole('button', { name: 'To-do' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Needs attention, 4' })).toBeTruthy();
});

test('Settings: WORKSPACE for everyone; ADMIN for the owner (the platform page absent), all five for the platform owner, none for a viewer', () => {
  const frame = who => { const s = settingsFor(entry, who); return [{ label: 'Workspace', items: s.workspace }, { label: 'Admin', tag: 'Owner', items: s.admin }]; };
  const onGo = jest.fn();
  const { rerender } = render(<SettingsFrame groups={frame({ role: 'owner' })} active="connections" onGo={onGo}><p>the page</p></SettingsFrame>);
  const items = g => [...document.querySelectorAll(`[data-settings-group="${g}"] [data-settings-item]`)].map(n => n.textContent);
  expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy();
  expect(items('Workspace')).toEqual(['Team emails', 'Voice profile']);
  expect(items('Admin')).toEqual(['Team', 'Connections', 'Recompute', 'Send logs']);
  expect(screen.getByRole('button', { name: 'Connections' }).getAttribute('aria-current')).toBe('page');
  fireEvent.click(screen.getByRole('button', { name: 'Team' }));
  expect(onGo.mock.calls[0][0].to).toEqual({ page: 'admin', section: 'users' });
  rerender(<SettingsFrame groups={frame({ role: 'member', isPlatformOwner: true })} active={null} onGo={onGo}><p>the page</p></SettingsFrame>);
  expect(items('Admin')).toEqual(['Team', 'Connections', 'Switches', 'Recompute', 'Send logs']);
  for (const role of ['viewer', 'member', 'admin']) {
    rerender(<SettingsFrame groups={frame({ role })} active="team-emails" onGo={onGo}><p>the page</p></SettingsFrame>);
    expect(document.querySelector('[data-settings-group="Admin"]')).toBeNull();
    expect(items('Workspace')).toEqual(['Team emails', 'Voice profile']);
  }
  expect([canAdd({ role: 'viewer' }), canAdd({ role: 'member' })]).toEqual([false, true]);
});

test('field: combobox ARIA; focused and empty shows Recent and three Try asking chips; "/" and Ctrl+K focus it; Esc returns focus', async () => {
  const p = search();
  const input = field();
  expect(input.getAttribute('aria-expanded')).toBe('false');
  expect(input.getAttribute('aria-autocomplete')).toBe('list');
  expect(input.getAttribute('aria-haspopup')).toBe('listbox');
  const elsewhere = screen.getByRole('button', { name: 'elsewhere' });
  elsewhere.focus();
  fireEvent.keyDown(elsewhere, { key: '/' });
  expect(document.activeElement).toBe(input);
  expect(screen.getByText('Try asking')).toBeTruthy();
  expect(['who visited this week', 'my overdue to-dos', 'my top targets'].every(t => screen.getByRole('button', { name: t }))).toBe(true);
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(document.querySelector('[data-shell-panel]')).toBeNull();
  expect(document.activeElement).toBe(elsewhere);
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  expect(document.activeElement).toBe(input);
  // "/" typed inside another text field is just a character
  fireEvent.keyDown(input, { key: 'Escape' });
  const other = document.createElement('input'); document.body.appendChild(other); other.focus();
  fireEvent.keyDown(other, { key: '/' });
  expect(document.activeElement).toBe(other);
  other.remove();
  expect(p.onSearch).not.toHaveBeenCalled();
});

test('field: a search - groups with their counts, the match marked, pills and owner, Ask Scout last; arrows move, Tab jumps a group, Enter opens and the row lands in Recent', async () => {
  const p = search();
  fireEvent.focus(field());
  await type('met');
  expect(p.onSearch).toHaveBeenCalledWith('met', expect.anything());
  const input = field();
  expect(input.getAttribute('aria-expanded')).toBe('true');
  const list = screen.getByRole('listbox', { name: 'Results' });
  expect(input.getAttribute('aria-controls')).toBe(list.id);
  expect(within(list).getAllByRole('group').map(g => document.getElementById(g.getAttribute('aria-labelledby')).textContent)).toEqual(['Companies', 'People', 'To-dos']);
  expect(within(list).getAllByRole('group')[0].textContent).toContain('5');
  expect(options().map(o => o.querySelector('.sh-ttl').textContent)).toEqual(['Metro Life', 'Metric Labs', 'Dana Mayer', 'Reply to the intro thread', 'Ask Scout “met”']);
  expect(options()[0].querySelector('mark').textContent).toBe('Met');
  expect(options()[0].textContent).toContain('P168');
  expect(options()[0].textContent).toContain('Ana');
  expect(options()[3].textContent).toContain('Today');
  expect(selected()).toBe(options()[0]);
  expect(input.getAttribute('aria-activedescendant')).toBe(options()[0].id);
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(selected()).toBe(options()[1]);
  fireEvent.keyDown(input, { key: 'Tab' });
  expect(selected()).toBe(options()[2]);
  fireEvent.keyDown(input, { key: 'Tab' });
  expect(selected()).toBe(options()[3]);
  fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
  expect(selected()).toBe(options()[2]);
  fireEvent.keyDown(input, { key: 'ArrowUp' }); fireEvent.keyDown(input, { key: 'ArrowUp' }); fireEvent.keyDown(input, { key: 'ArrowUp' });
  expect(selected()).toBe(options()[4]);
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(p.onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'partner-1', open: { page: 'sales', params: { open: 'partner-1' } } }));
  expect(p.onAsk).not.toHaveBeenCalled();
  expect(document.querySelector('[data-shell-panel]')).toBeNull();
  expect(readRecent('u1').map(r => r.title)).toEqual(['Metro Life']);
  expect(JSON.stringify(JSON.parse(localStorage.getItem(RECENT_KEY)))).not.toMatch(/@/);
  fireEvent.focus(field());
  expect(options().map(o => o.querySelector('.sh-ttl').textContent)).toEqual(['Metro Life']);
  expect(markOf('MetLife', 'met')).toEqual(['', 'Met', 'Life']);
});

test('field: a question puts Ask Scout first so Enter asks; a short answer stays in the panel with Open and Keep asking; Ctrl+Enter asks from a search', async () => {
  const p = search();
  fireEvent.focus(field());
  await type('who owns metro life');
  expect(options()[0].hasAttribute('data-ask-row')).toBe(true);
  expect(selected()).toBe(options()[0]);
  expect(screen.getAllByText('Mentioned').length).toBe(3);
  await act(async () => { fireEvent.keyDown(field(), { key: 'Enter' }); });
  expect(p.onAsk).toHaveBeenCalledWith('who owns metro life');
  const answer = document.querySelector('[data-shell-answer]');
  expect(answer.getAttribute('role')).toBe('status');
  expect(answer.textContent).toContain('Metro Life is Ana’s.');
  expect(screen.getByText('Read: companies · to-dos')).toBeTruthy();
  expect(field().getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: 'Open Metro Life' }));
  expect(p.onOpen).toHaveBeenCalledWith(GROUPS[0].items[0]);
  expect(readRecent('u1')[0]).toEqual(expect.objectContaining({ kind: 'ask', q: 'who owns metro life' }));
  fireEvent.focus(field());
  await type('met');
  await act(async () => { fireEvent.keyDown(field(), { key: 'Enter', ctrlKey: true }); });
  expect(p.onAsk).toHaveBeenLastCalledWith('met');
  fireEvent.click(screen.getByRole('button', { name: 'Keep asking in Scout' }));
  expect(p.onOpenScout).toHaveBeenCalledTimes(1);
});

test('field: a longer answer hands over to the Scout window (the panel closes); no match shows one line and Ask Scout alone; a viewer-only search has no ask row', async () => {
  const p = search({ onAsk: jest.fn(async () => ({ page: true })) });
  fireEvent.focus(field());
  await type('my top 5 companies this week');
  await act(async () => { fireEvent.keyDown(field(), { key: 'Enter' }); });
  expect(p.onAsk).toHaveBeenCalledWith('my top 5 companies this week');
  expect(document.querySelector('[data-shell-panel]')).toBeNull();
  fireEvent.focus(field());
  await type('zzyx');
  expect(document.querySelector('[data-no-match]').textContent).toBe('No company, person or to-do matches “zzyx”.');
  expect(options()).toHaveLength(1);
  expect(options()[0].hasAttribute('data-ask-row')).toBe(true);
  expect(selected()).toBe(options()[0]);
});

test('field (D24, D25, W1): Esc clears what was typed, then closes and returns focus; the result count is announced politely; the star opens the Scout window', async () => {
  const p = search();
  const elsewhere = screen.getByRole('button', { name: 'elsewhere' });
  elsewhere.focus();
  fireEvent.keyDown(elsewhere, { key: '/' });
  const count = document.querySelector('[data-shell-count]');
  expect([count.getAttribute('role'), count.getAttribute('aria-live'), count.textContent]).toEqual(['status', 'polite', '']);
  await type('met');
  expect(count.textContent).toBe('4 results');
  fireEvent.keyDown(field(), { key: 'Escape' });
  expect(field().value).toBe('');
  expect(document.activeElement).toBe(field());
  expect(document.querySelector('[data-shell-panel]')).toBeTruthy();
  fireEvent.keyDown(field(), { key: 'Escape' });
  expect(document.querySelector('[data-shell-panel]')).toBeNull();
  expect(document.activeElement).toBe(elsewhere);
  fireEvent.focus(field());
  await type('zzyx');
  expect(count.textContent).toBe('No results');
  const star = screen.getByRole('button', { name: 'Open Scout' });
  fireEvent.mouseDown(star); fireEvent.click(star);
  expect(p.onOpenScout).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[data-shell-panel]')).toBeNull();
  expect(p.onAsk).not.toHaveBeenCalled();
  // the Scout window closing: focus comes back to the field with its ring, the panel (and its dimmer) stays shut
  act(() => { window.dispatchEvent(new Event(FOCUS_FIELD)); });
  expect(document.activeElement).toBe(field());
  expect(document.querySelector('.sh-sf').className).toContain('is-focus');
  expect(document.querySelector('[data-shell-panel]')).toBeNull();
  expect(document.querySelector('.sh-scrim')).toBeNull();
  fireEvent.keyDown(field(), { key: 'ArrowDown' });
  expect(document.querySelector('[data-shell-panel]')).toBeTruthy();
});

test('field without asking (canAsk off): rows only, Enter opens, nothing is asked', async () => {
  const p = search({ canAsk: false });
  fireEvent.focus(field());
  await type('met');
  expect(options().some(o => o.hasAttribute('data-ask-row'))).toBe(false);
  await act(async () => { fireEvent.keyDown(field(), { key: 'Enter', ctrlKey: true }); });
  expect(p.onAsk).not.toHaveBeenCalled();
  expect(screen.queryByText('Try asking')).toBeNull();
});

test('phone: a top bar, three tabs + the centre search + More; More holds the rest of the nav, the workspace switch and the account; targets are 44 px', () => {
  const onGo = jest.fn();
  const props = { compact: true, userId: 'u1', workspace: WS[0], role: 'Owner', workspaces: WS, nav: navOf('today'), search: o => <ShellSearch userId="u1" onSearch={async () => GROUPS} onAsk={jest.fn()} onOpen={jest.fn()} onOpenScout={jest.fn()} today="2026-11-19" {...o} />, attention: o => <button type="button" aria-label="Needs attention, 4">{o.short ? '4' : 'Needs attention 4'}</button>, onAddTodo: jest.fn(), user: { name: 'Ana Owner', first: 'Ana', initials: 'AO' }, menu, onGo, onPickWorkspace: jest.fn(), onAllWorkspaces: jest.fn() };
  render(<AppShell {...props}><p>page</p></AppShell>);
  expect(document.querySelector('[data-shell]').dataset.shell).toBe('phone');
  expect(document.querySelector('[data-shell-nav]')).toBeNull();
  const tabs = document.querySelector('[data-shell-tabs]');
  expect([...tabs.querySelectorAll('button')].map(b => b.getAttribute('aria-label') || b.textContent.replace(/\d+$/, ''))).toEqual(['Today', 'Pipeline', 'Search or ask Scout', 'Dashboard', 'More']);
  expect(tabs.querySelector('[data-nav-item=today]').getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('button', { name: 'Needs attention, 4' }).textContent).toBe('4');
  expect(screen.getByRole('button', { name: 'Add a to-do' }).style.height).toBe('44px');
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  const sheet = screen.getByRole('dialog', { name: 'More' });
  expect([...sheet.querySelectorAll('[data-nav-item]')].map(n => n.dataset.navItem)).toEqual(['home', 'scout', 'marketing', 'ideas', 'settings']);
  expect(within(sheet).getByText('Owner · switch workspace')).toBeTruthy();
  expect(within(sheet).queryByText('Second Space')).toBeNull();
  fireEvent.click(sheet.querySelector('[data-nav-item=ideas]'));
  expect(onGo.mock.calls[0][0].id).toBe('ideas');
  expect(screen.queryByRole('dialog', { name: 'More' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Search or ask Scout' }));
  const full = screen.getByRole('dialog', { name: 'Search or ask Scout' });
  expect(within(full).getByRole('combobox', { name: 'Search or ask Scout' })).toBe(document.activeElement);
  fireEvent.click(within(full).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog', { name: 'Search or ask Scout' })).toBeNull();
  expect(SHELL_CSS).toMatch(/\.sh-tab\{[^}]*height:52px/);
});

test('Marketing: the centred card', () => {
  render(<ComingSoon title="Marketing" note="Coming soon. Campaigns, content and site work for Northwind will live here." />);
  expect(screen.getByRole('heading', { name: 'Marketing' })).toBeTruthy();
  expect(document.querySelector('[data-shell-soon]').textContent).toContain('Coming soon.');
});
