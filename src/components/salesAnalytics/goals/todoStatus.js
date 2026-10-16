// Status computes itself from the steps (REV4): all ticked = done, some =
// in progress, none = not started. A to-do marked done/dropped by hand
// keeps that.
export function todoStatus(t) {
  if (t.status === 'dropped') return 'dropped';
  const done = t.steps.filter(s => s.done).length;
  if (t.status === 'done' || (t.steps.length && done === t.steps.length)) return 'done';
  return done > 0 ? 'prog' : 'not';
}
