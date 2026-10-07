import { render, screen, fireEvent, within } from '@testing-library/react';
import ReportView from './ReportView';
import TodoList from './TodoList';
import PartnersView from './PartnersView';
import { memberLookup } from './goalsUi';

// goals-surface-v1 Stage 1: ring legends are buttons that filter the list
// they summarize, with a "Showing:" chip to clear; the report ring lists
// which sections are written.
// jsdom has no matchMedia; PartnersView reads it for its phone layout.
window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
const members = [{ user_id: 'u-jack', name: 'Jack Carlson' }, { user_id: 'u-cyrus', name: 'Cyrus Lee' }];
const lookup = memberLookup(members);
const step = (id, done) => ({ id, text: `step ${id}`, done });
const todo = (id, steps, extra = {}) => ({ id, text: `Todo ${id}`, category: 'Ops', owner_user_id: 'u-jack', contacts: [], steps, ...extra });

function renderTodos() {
  const todos = [todo('a', [step(1, true)]), todo('b', [step(2, true), step(3, false)]), todo('c', [step(4, false)]), todo('d', [step(5, false)])];
  render(<TodoList todos={todos} lookup={lookup} members={members} whoLabel="Team" canEdit={false} />);
}

test('to-do legend rows are buttons; picking one filters the list and shows a chip', () => {
  renderTodos();
  const notStarted = screen.getByRole('button', { name: /Not started/ });
  expect(notStarted.getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(notStarted);
  expect(notStarted.getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByText('Todo a')).toBeNull();
  expect(screen.queryByText('Todo b')).toBeNull();
  expect(screen.getByText('Todo c')).toBeTruthy();
  expect(screen.getByText('Todo d')).toBeTruthy();
  const chip = screen.getByRole('button', { name: 'Showing Not started (2). Clear filter' });
  fireEvent.click(chip);
  expect(screen.getByText('Todo a')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Clear filter/ })).toBeNull();
});

test('clicking the selected legend row again clears it; empty slices are disabled', () => {
  render(<TodoList todos={[todo('a', [step(1, true)])]} lookup={lookup} members={members} whoLabel="Team" canEdit={false} />);
  expect(screen.getByRole('button', { name: /In progress/ }).disabled).toBe(true);
  const done = screen.getByRole('button', { name: /^Done\s?\d/ });
  fireEvent.click(done);
  expect(screen.getByRole('button', { name: /Clear filter/ })).toBeTruthy();
  fireEvent.click(done);
  expect(screen.queryByRole('button', { name: /Clear filter/ })).toBeNull();
});

test('partner owner and status donuts filter the cards (P1s also show in Top priorities)', () => {
  const partners = [
    { id: 'p1', name: 'PerkSpot', priority: 1, owner_user_id: 'u-jack', pipeline_status: 'first_email_drafted' },
    { id: 'p2', name: 'BenefitHub', priority: 1, owner_user_id: 'u-cyrus', pipeline_status: 'first_email_drafted' },
    { id: 'p3', name: 'Corestream', priority: 2, owner_user_id: null, pipeline_status: 'not_started' },
  ];
  render(<PartnersView partners={partners} lookup={lookup} members={members} canEdit={false} onUpdate={jest.fn()} onCreate={jest.fn()} onSignal={jest.fn()} onUndo={jest.fn()} onReplace={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /^Cyrus/ }));
  expect(screen.queryAllByText('PerkSpot')).toHaveLength(0);
  expect(screen.getAllByText('BenefitHub').length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: 'Showing Owner Cyrus (1). Clear filter' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Showing Owner Cyrus (1). Clear filter' }));
  fireEvent.click(screen.getByRole('button', { name: /^Unassigned/ }));
  expect(screen.getAllByText('Corestream').length).toBeGreaterThan(0);
  expect(screen.queryAllByText('BenefitHub')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: /Clear filter/ }));
  fireEvent.click(screen.getByTitle('Show only Not started'));
  expect(screen.getAllByText('Corestream').length).toBeGreaterThan(0);
  expect(screen.queryAllByText('PerkSpot')).toHaveLength(0);
});

test('report ring lists exactly the written sections, and each is a jump link', () => {
  const sections = [
    { section_key: 's1', notes: 'Big week' },
    { section_key: 's3', notes: '  ' },
    { section_key: 's13', notes: 'Pricing objection' },
  ];
  render(<ReportView weekStart="2026-10-05" report={{ status: 'draft' }} sections={sections} infra={[]} commitments={[]} kpiRows={[]} autoChips={{}}
    canEdit={false} lookup={lookup} members={members} onOpen={jest.fn()} />);
  const ring = screen.getByRole('button', { name: /Report sections written: Written 2, To write 10/ });
  fireEvent.click(ring);
  const dialog = screen.getByRole('dialog', { name: 'Report sections' });
  const links = within(dialog).getAllByRole('button').map(b => b.textContent);
  const writtenEnd = links.findIndex(t => t.includes('Commitments'));
  expect(links.slice(0, writtenEnd)).toEqual(['§1Executive summary', '§13Problems & blockers']);
  expect(links).toHaveLength(12);
  const target = document.getElementById('goals-sec-s13');
  target.scrollIntoView = jest.fn();
  fireEvent.click(within(dialog).getByRole('button', { name: /Problems & blockers/ }));
  expect(target.scrollIntoView).toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
});
