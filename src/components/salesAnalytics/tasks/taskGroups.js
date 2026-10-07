import { todoStatus } from '../goals/TodoList';

// task-drawer-v1 - the drawer's groups over this week's to-dos (the same rows
// Goals -> This week lists) plus open flags, which can sit in an earlier week
// when they weren't carried. A flag shows once, in the Flagged group.
// filter: 'me' | 'team' | 'unassigned' | a member's user id.
export function matchesFilter(filter, ownerId, meId) {
  if (filter === 'team') return true;
  if (filter === 'unassigned') return !ownerId;
  return ownerId === (filter === 'me' ? meId : filter);
}

export function buildTaskGroups({ todos, flags, filter, meId, today }) {
  const flagIds = new Set(flags.map(f => f.id));
  const mine = t => matchesFilter(filter, t.owner_user_id, meId);
  const rows = todos.filter(t => !flagIds.has(t.id) && mine(t)).map(t => ({ ...t, st: todoStatus(t) })).filter(t => t.st !== 'dropped');
  const open = rows.filter(t => t.st !== 'done');
  const overdue = open.filter(t => t.due_date && t.due_date < today);
  return [
    { id: 'flagged', label: filter === 'me' ? 'Flagged for me' : 'Flagged', items: flags.filter(mine).map(f => ({ ...f, st: todoStatus(f) })) },
    { id: 'overdue', label: 'Overdue', items: overdue },
    { id: 'week', label: 'This week', items: open.filter(t => !overdue.includes(t) && !t.source_note_id) },
    // call-notes-to-tasks-v1 - open to-dos made from pasted call notes.
    { id: 'calls', label: 'From calls', items: open.filter(t => !overdue.includes(t) && t.source_note_id) },
    { id: 'done', label: 'Done this week', items: rows.filter(t => t.st === 'done') },
  ];
}

// Badge: my open to-dos this week + open flags handed to me.
export function badgeCount({ todos, flags, meId }) {
  const ids = new Set(flags.filter(f => f.owner_user_id === meId).map(f => f.id));
  for (const t of todos) if (t.owner_user_id === meId && !['done', 'dropped'].includes(todoStatus(t))) ids.add(t.id);
  return ids.size;
}
