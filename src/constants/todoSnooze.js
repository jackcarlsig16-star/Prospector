// todo-events-v1 T6 - the ONE rule for a snoozed to-do, imported by the server's open-to-dos read and by every
// list on screen: hidden while snooze_until is after today (LA), back on that day. Distinct from due_date.
export const isSnoozed = (todo, today) => !!todo?.snooze_until && String(todo.snooze_until).slice(0, 10) > today;
export const splitSnoozed = (todos, today) => ({ shown: todos.filter(t => !isSnoozed(t, today)), snoozed: todos.filter(t => isSnoozed(t, today)) });
