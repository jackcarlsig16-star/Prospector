import { render, screen, fireEvent } from '@testing-library/react';
import LinkedTasks, { linkedTo, isOpenTask, tasksSummary } from './LinkedTasks';
import { OPEN_TASKS } from '../goals/goalsApi';

const todo = (id, extra = {}) => ({ id, text: `Task ${id}`, status: 'open', steps: [], owner_user_id: 'u1', link_type: 'commitment', link_id: 'c1', ...extra });
const todos = [
  todo('a'),
  todo('b', { status: 'done' }),
  todo('c', { steps: [{ id: 's', done: true }] }), // done by its steps
  todo('d', { status: 'dropped' }),
  todo('e', { link_id: 'c2' }),
  todo('f', { link_type: 'partner' }),
];
const lookup = () => ({ first: 'Jack', color: '#6F8CF0' });

test('counts only to-dos linked to that one thing, dropped left out', () => {
  const linked = linkedTo(todos, 'commitment', 'c1');
  expect(linked.map(t => t.id)).toEqual(['a', 'b', 'c']);
  expect(tasksSummary(linked)).toBe('3 tasks · 2 done');
  expect(linked.filter(isOpenTask).map(t => t.id)).toEqual(['a']);
  expect(tasksSummary(linkedTo(todos, 'commitment', 'c2'))).toBe('1 task · 0 done');
});

test('expands to the list and opens the drawer filtered to the link', () => {
  const heard = [];
  const on = e => heard.push(e.detail);
  window.addEventListener(OPEN_TASKS, on);
  render(<LinkedTasks tasks={linkedTo(todos, 'commitment', 'c1')} lookup={lookup} label="Send 40 emails" link={{ type: 'commitment', id: 'c1' }} />);
  fireEvent.click(screen.getByRole('button', { name: '3 tasks · 2 done linked to Send 40 emails' }));
  expect(screen.getByRole('list', { name: 'Tasks linked to Send 40 emails' }).textContent).toContain('Task a');
  fireEvent.click(screen.getByRole('button', { name: 'Open in Tasks →' }));
  expect(heard).toEqual([{ link: { type: 'commitment', id: 'c1' }, filter: 'team' }]);
  window.removeEventListener(OPEN_TASKS, on);
});

test('nothing linked renders nothing; no link = no drawer button', () => {
  const { container } = render(<LinkedTasks tasks={[]} lookup={lookup} label="x" link={null} />);
  expect(container.innerHTML).toBe('');
  render(<LinkedTasks tasks={[todo('a')]} lookup={lookup} label="Past" link={null} />);
  fireEvent.click(screen.getByRole('button', { name: /linked to Past/ }));
  expect(screen.queryByRole('button', { name: 'Open in Tasks →' })).toBeNull();
});
