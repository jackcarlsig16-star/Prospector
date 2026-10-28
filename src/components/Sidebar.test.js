import { render, screen, fireEvent } from '@testing-library/react';
import Sidebar from './Sidebar';

// visual-nav-cleanup-v1 C3 - the account rows (Workspaces · Admin · Connections · Profile · Sign out) and one Help row
// holding Daily digest · Week ahead · Report a bug · Voice Profile · UI kit (flag).
const base = { page: 'businesses-home', setPage: jest.fn(), activeInitials: 'JC', activeUser: { id: 'u1', name: 'Jack Carlson' }, teamUsers: [], businesses: [], onOpenProfile: jest.fn(), onOpenDigest: jest.fn(), onOpenBugReport: jest.fn(), onGoToBusinesses: jest.fn(), onSelectBusiness: jest.fn(), setBusinessPage: jest.fn(), setViewAs: jest.fn() };

test('Help ▸ opens Daily digest · Week ahead · Report a bug · Voice Profile (+ UI kit behind its flag); each opens its thing', () => {
  const p = { ...base, onOpenDigest: jest.fn(), onOpenBugReport: jest.fn(), setPage: jest.fn() };
  const { rerender } = render(<Sidebar {...p} showUiKit={false} />);
  expect(screen.queryByRole('button', { name: /Daily digest/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Help ▸/ }));
  const rows = ['Daily digest', 'Week ahead', 'Report a bug', 'Voice Profile'];
  for (const r of rows) expect(screen.getByRole('button', { name: new RegExp(r) })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /UI kit/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Week ahead/ }));
  expect(p.onOpenDigest).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /Report a bug/ }));
  expect(p.onOpenBugReport).toHaveBeenCalled();
  rerender(<Sidebar {...p} showUiKit />);
  fireEvent.click(screen.getByRole('button', { name: /Voice Profile/ }));
  expect(p.setPage).toHaveBeenCalledWith('voice-profile');
});

test('the profile menu holds Connections · Profile & badges · Sign out (Voice Profile and UI kit moved to Help)', () => {
  render(<Sidebar {...base} showUiKit />);
  fireEvent.click(screen.getByRole('button', { name: /My profile/ }));
  const menu = document.getElementById('user-menu');
  expect([...menu.querySelectorAll('button')].map(b => b.textContent.replace(/^\W+/, '').trim())).toEqual(['Connections', 'Profile & badges', 'Sign out']);
});
