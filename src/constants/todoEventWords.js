// todo-events-v1 T8 - what a to-do event reads as in a line (Pipeline moves this week, the company window's
// activity, "edited ... by ..." on an Actions row). The same words on the server and on screen.
const day = d => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'no date');
export function todoEventWords(e) {
  const a = e.after || {};
  switch (e.kind) {
    case 'create': return a.status === 'done' ? 'added, done' : 'added';
    case 'done': return 'done';
    case 'undone': return 'reopened';
    case 'reassign': return a.owner_user_id ? 'reassigned' : 'unassigned';
    case 'due': return a.due_date ? `due ${day(a.due_date)}` : 'due date cleared';
    case 'drop': return 'dropped';
    case 'snooze': return `snoozed until ${day(a.snooze_until)}`;
    case 'unsnooze': return 'unsnoozed';
    case 'link': return a.link_type ? 'linked' : 'unlinked';
    case 'undo': return 'undone';
    default: return e.kind;
  }
}
