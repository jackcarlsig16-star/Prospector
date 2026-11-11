import { useEffect, useState } from 'react';
import { SA } from '../theme';
import { goalsApi } from './goalsApi';

// todo-events-v1 T8 - "edited <when> by <name>" on a to-do's row detail, from its newest event (read when the
// detail opens, not with the list). nameOf = the screen's member lookup; an event holds a user id, never a name.
const when = at => new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export default function TodoLastChange({ businessId, todoId, nameOf }) {
  const [state, setState] = useState(null); // null loading · { event } · { error }
  useEffect(() => {
    let live = true;
    goalsApi.todoEvents(businessId, { todo_id: todoId }).then(ev => { if (live) setState({ event: ev[0] || null }); }).catch(e => { if (live) setState({ error: e.message }); });
    return () => { live = false; };
  }, [businessId, todoId]);
  if (!state) return <span style={{ color: SA.muted }}>Loading…</span>;
  if (state.error) return <span style={{ color: SA.muted }}>Couldn't load the history: {state.error}</span>;
  const e = state.event;
  if (!e) return <span style={{ color: SA.muted }}>No change recorded since Nov 11, 2026</span>;
  return <span data-todo-last-change>{e.words} · {when(e.at)}{e.by_user ? ` by ${nameOf(e.by_user)}` : ''}</span>;
}
