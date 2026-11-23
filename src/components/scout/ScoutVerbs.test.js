import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { Section } from './ScoutSections';
import { primaryVerb, copiedLine } from './scoutActions';
import CopyForClaude from '../salesAnalytics/CopyForClaude';
import { goalsApi } from '../salesAnalytics/goals/goalsApi';

// FIX claude-pack-dossier P6 + P2 - each Scout row's primary verb is a visible button (the ⋯ keeps the rest), the
// section copies for Claude from a button with a Full toggle, and the shared Copy for Claude button prints the real
// count. Invented rows; 0 server.
jest.mock('../salesAnalytics/goals/goalsApi', () => ({ goalsApi: { copyDossier: jest.fn() } }));

const CF = { entity: 'employers', type: 'employer', id: 'e1', name: 'Cloudflare', stage: 'contacted' };
const person = (i, name) => ({ entity: 'people', id: `prospect:p${i}`, title: name, open: { page: 'sales' }, row: { kind: 'person', key: `prospect:p${i}`, name, title: 'VP People', company: CF, heat: 48, heat_band: 'hot' } });
const company = { entity: 'employers', id: 'e1', title: 'Cloudflare', open: { page: 'sales' }, row: { kind: 'company', type: 'employer', id: 'e1', name: 'Cloudflare', score: 70, band: 'P1' } };
const task = { entity: 'todos', id: 't1', title: 'Send the joint note', open: { page: 'sales' }, row: { kind: 'task', id: 't1', text: 'Send the joint note', due: '2026-11-08', owner: 'mine' } };
const visitor = { entity: 'visitor', id: 'v1', title: 'Flowserve', open: { page: 'sales' }, row: { kind: 'visitor', company_key: 'flowserve' } };
const section = rows => ({ title: 'Rows', count: rows.length, total: rows.length, rule: 'The rule.', read: 'a read', rows, line: null, brief: null });
const show = (rows, props = {}) => {
  const onPick = jest.fn(), onCopy = jest.fn();
  render(<Section n={1} section={section(rows)} numbered={false} phone={false} scopeAll={false} colorOf={() => null} sorted={false} canAct onOpen={() => {}} menu={null} onMenu={() => {}} members={[]} onPick={onPick} onCopy={onCopy} {...props} />);
  return { onPick, onCopy };
};

test('P6: the primary verb per row kind - person and company Draft email, task Done, visitor Add as target', () => {
  expect([person(1, 'Dana Mayer'), company, task, visitor, { entity: 'notes', id: 'n1', title: 'A note' }].map(r => primaryVerb(r)?.id || null)).toEqual(['draft', 'draft', 'task_done', 'add_target', null]);
});

test('P6: every row shows its verb as a visible button beside Open and ⋯; a click picks that verb on that row', () => {
  const rows = [person(1, 'Dana Mayer'), person(2, 'Meagan Earl')];
  const { onPick } = show(rows);
  const first = document.querySelector('[data-scout-row="people:prospect:p1"]');
  const verb = within(first).getByRole('button', { name: 'Draft email: Dana Mayer' });
  expect(verb).toHaveAttribute('data-scout-verb', 'draft');
  expect(verb).toHaveClass('scout-verb');
  expect(verb).toHaveAttribute('aria-pressed', 'false');
  expect(within(first).getByRole('button', { name: 'Actions for Dana Mayer' })).toBeInTheDocument();
  fireEvent.click(verb);
  expect(onPick).toHaveBeenCalledWith(rows[0], 'draft');
});

test('P6: the open row reads filled; an acted row drops its button; a Viewer gets none', () => {
  show([person(1, 'Dana Mayer'), { ...person(2, 'Meagan Earl'), result: { state: 'updated', text: 'contacted' } }], { activeKey: 'people:prospect:p1' });
  expect(screen.getByRole('button', { name: 'Draft email: Dana Mayer' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('button', { name: 'Draft email: Meagan Earl' })).toBeNull();
  document.body.innerHTML = '';
  show([task, visitor], { canAct: false });
  expect(document.querySelector('[data-scout-verb]')).toBeNull();
});

test('P6: a task row says Done, a visitor row Add as target; on the phone the button sits in the card', () => {
  const { onPick } = show([task]);
  fireEvent.click(screen.getByRole('button', { name: 'Done: Send the joint note' }));
  expect(onPick).toHaveBeenCalledWith(task, 'task_done');
  document.body.innerHTML = '';
  const v = show([visitor], { phone: true });
  const card = document.querySelector('[data-scout-cards] .scout-card');
  fireEvent.click(within(card.querySelector('.scout-card__verb')).getByRole('button', { name: 'Add as target: Flowserve' }));
  expect(v.onPick).toHaveBeenCalledWith(visitor, 'add_target');
  expect(card.querySelectorAll('[data-scout-verb]')).toHaveLength(1);
});

test('P6 + P2: the section footer copies its people and companies for Claude from a button; Full lifts the cap', () => {
  const rows = [person(1, 'Dana Mayer'), company, task];
  const { onCopy } = show(rows);
  fireEvent.click(screen.getByRole('button', { name: 'Copy for Claude · 2 records' }));
  expect(onCopy).toHaveBeenLastCalledWith([rows[0], rows[1]], undefined, false);
  const full = screen.getByRole('button', { name: 'Full' });
  expect(full).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(full);
  fireEvent.click(screen.getByRole('button', { name: 'Copy for Claude · 2 records' }));
  expect(onCopy).toHaveBeenLastCalledWith([rows[0], rows[1]], undefined, true);
  document.body.innerHTML = '';
  show([task]);
  expect(document.querySelector('[data-scout-copyrow]')).toBeNull();
});

test('P2: the copied line carries the real count and what was cut', () => {
  expect(copiedLine({ records: 1, chars: 11873, cut: 0 })).toBe('✓ Copied · 1 record · 11,873 chars');
  expect(copiedLine({ records: 2, chars: 12000, cut: 14 })).toBe('✓ Copied · 2 records · 12,000 chars · 14 cut to fit - Full copies everything');
});

test('P2: Copy for Claude prints the real character count beside the button; the Full toggle asks for the uncut dossier', async () => {
  const written = [];
  Object.assign(navigator, { clipboard: { writeText: jest.fn(t => { written.push(t); return Promise.resolve(); }) } });
  goalsApi.copyDossier.mockResolvedValueOnce({ markdown: '# Flowserve — target\n\n## Ask\n', chars: 11873, cut: 6 }).mockResolvedValueOnce({ markdown: '# Flowserve — target (all of it)\n\n## Ask\n', chars: 23110, cut: 0 });
  render(<CopyForClaude businessId="b1" type="target" id="t1" />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy for Claude' }));
  await waitFor(() => expect(document.querySelector('[data-copy-chars]')).toHaveTextContent('11,873 chars · 6 cut to fit'));
  expect(goalsApi.copyDossier).toHaveBeenLastCalledWith('b1', 'target', 't1', { full: false });
  fireEvent.click(screen.getByRole('button', { name: 'Full' }));
  fireEvent.click(screen.getByRole('button', { name: 'Copy for Claude' }));
  await waitFor(() => expect(document.querySelector('[data-copy-chars]')).toHaveTextContent(/^23,110 chars$/));
  expect(goalsApi.copyDossier).toHaveBeenLastCalledWith('b1', 'target', 't1', { full: true });
  expect(written).toEqual(['# Flowserve — target\n\n## Ask\n', '# Flowserve — target (all of it)\n\n## Ask\n']);
});
