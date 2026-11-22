import { render } from '@testing-library/react';
import { Section } from './ScoutSections';

// app-shell-v2 C2 - a to-do list answer is its rows, so a to-do's steps are said on the row card: one line under the
// due line, only when the to-do has steps.
const todo = (id, text, steps) => ({ entity: 'todos', id, title: text, date: '2026-11-08', workspace_id: 'b1', row: { kind: 'task', id, text, due: '2026-11-08', overdue: true, owner: 'mine', owner_user_id: 'u1', link: null, verb: 'next_steps', steps } });
const SECTION = { title: 'Tasks', count: 2, total: 2, rule: null, read: null, rows: [todo('t1', 'Send the joint note', { done: 0, total: 2 }), todo('t2', 'Reply to the intro thread', null)] };

test('cards: "0/2 steps done" under the due line of the to-do that has steps, nothing on the one that has none; the table is unchanged', () => {
  const { container, rerender } = render(<Section n={1} section={SECTION} cards members={[]} onOpen={() => {}} onMenu={() => {}} onPick={() => {}} />);
  const cards = [...container.querySelectorAll('.scout-card')];
  expect(cards).toHaveLength(2);
  const line = cards[0].querySelector('[data-scout-steps]');
  expect(line).toHaveTextContent('0/2 steps done');
  expect(cards[0].querySelector('[data-scout-due]').compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(cards[1].querySelector('[data-scout-steps]')).toBeNull();
  rerender(<Section n={1} section={SECTION} members={[]} onOpen={() => {}} onMenu={() => {}} onPick={() => {}} />);
  expect(container.querySelector('table')).toBeTruthy();
  expect(container.querySelector('[data-scout-steps]')).toBeNull();
});
