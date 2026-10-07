import { useState } from 'react';
import { SA } from '../theme';
import { SEMANTIC } from '../palette';
import { todoStatus } from '../goals/TodoList';
import { OPEN_TASKS } from '../goals/goalsApi';
import { chipStyle } from './LinkPicker';
import { linkBtn } from './TaskRow';

export const openTasks = detail => window.dispatchEvent(new CustomEvent(OPEN_TASKS, { detail }));

// To-dos linked to one thing, dropped ones left out. A linked to-do never
// changes metric math - this is only the work shown next to the goal.
export const linkedTo = (todos, type, id) => todos.filter(t => t.link_type === type && t.link_id === id && todoStatus(t) !== 'dropped');
export const isOpenTask = t => todoStatus(t) !== 'done' && todoStatus(t) !== 'dropped';

export function tasksSummary(tasks) {
  const done = tasks.filter(t => todoStatus(t) === 'done').length;
  return `${tasks.length} task${tasks.length === 1 ? '' : 's'} · ${done} done`;
}

// A chip that opens the drawer filtered to `link` (company rows).
export function TasksChip({ tasks, link, label }) {
  if (!tasks.length) return null;
  return (
    <button type="button" onClick={() => openTasks({ link, filter: 'team' })} aria-label={`${tasksSummary(tasks)} for ${label} - open in Tasks`}
      style={{ ...chipStyle, height: 22, fontSize: 11 }}>✓ {tasksSummary(tasks)}</button>
  );
}

// "3 tasks · 1 done", expandable to the list. `link` set = the drawer can
// show the same tasks (it only holds the current week).
export default function LinkedTasks({ tasks, lookup, link, label }) {
  const [open, setOpen] = useState(false);
  if (!tasks.length) return null;
  return (
    <div className="no-print" style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)} aria-label={`${tasksSummary(tasks)} linked to ${label}`}
        style={{ ...linkBtn, fontSize: 12, color: SA.soft, minHeight: 24 }}>
        {open ? '▾' : '▸'} {tasksSummary(tasks)}
      </button>
      {open && (
        <ul aria-label={`Tasks linked to ${label}`} style={{ listStyle: 'none', margin: 0, padding: '0 0 0 14px', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          {tasks.map(t => {
            const done = todoStatus(t) === 'done';
            const owner = lookup(t.owner_user_id);
            return (
              <li key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, flex: 'none', background: done ? SEMANTIC.healthy : SA.neutral }} />
                <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', color: done ? SA.muted : SA.text, textDecoration: done ? 'line-through' : 'none' }}>{t.text}</span>
                <span style={{ color: SA.muted, fontSize: 12 }}>{owner.first}</span>
              </li>
            );
          })}
          {link && <li><button type="button" style={{ ...linkBtn, fontSize: 12 }} onClick={() => openTasks({ link, filter: 'team' })}>Open in Tasks →</button></li>}
        </ul>
      )}
    </div>
  );
}
