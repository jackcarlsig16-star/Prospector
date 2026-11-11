import { getSupabase, laStartOfDayMs, isDate } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { listTodoEvents } from './todoWrite.js';
import { cleanText } from './scrubText.js';
import { todoEventWords } from '../../src/constants/todoEventWords.js';

// todo-events-v1 T8 (ruling R8) - the readers of sales_todo_events: the week's lines ("Pipeline moves this week"),
// one to-do's history ("edited ... by ..." on an Actions row) and a record's to-do activity (the company window).
// An event holds no text; each line carries its to-do's text (scrubbed, cut) and link from the row as it is now.
// by_user is a user id - the screen resolves the name from the members it already has.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINK_TYPES = ['partner', 'opportunity', 'target'];
export const EVENTS_MAX = 200;
const IN_CHUNK = 100;
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };

// -> [{ id, todo_id, kind, words, at, by_user, origin, batch_id, undone_at, undo_of, before, after, todo: { text, status, link_type, link_id } }]
export async function todoEventLines(supabase, businessId, { from = null, to = null, todoId = null, link = null, limit = EVENTS_MAX } = {}) {
  let todoIds = todoId ? [todoId] : null;
  if (link) {
    const rows = await selectAllPages(() => supabase.from('sales_week_goals').select('id').eq('business_id', businessId).eq('kind', 'todo').eq('link_type', link.type).eq('link_id', link.id).order('id'));
    todoIds = rows.map(r => r.id).slice(0, IN_CHUNK);
    if (!todoIds.length) return [];
  }
  const events = await listTodoEvents(supabase, businessId, { todoIds, from: from ? new Date(laStartOfDayMs(from)).toISOString() : null, to: to ? new Date(laStartOfDayMs(to)).toISOString() : null, limit });
  const ids = [...new Set(events.map(e => e.todo_id))];
  const todos = new Map();
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    for (const t of must(await supabase.from('sales_week_goals').select('id, text, status, link_type, link_id').eq('business_id', businessId).in('id', ids.slice(i, i + IN_CHUNK)))) todos.set(t.id, t);
  }
  return events.map(e => {
    const t = todos.get(e.todo_id);
    return { id: e.id, todo_id: e.todo_id, kind: e.kind, words: todoEventWords(e), at: e.at, by_user: e.actor_user_id, origin: e.origin, batch_id: e.batch_id, undone_at: e.undone_at, undo_of: e.undo_of, before: e.before, after: e.after,
      todo: t ? { text: cleanText(t.text, 160), status: t.status, link_type: t.link_type, link_id: t.link_id } : null };
  });
}

// GET goals/week/events?from=YYYY-MM-DD&to=YYYY-MM-DD (LA days, to exclusive) | ?todo_id= | ?link_type=&link_id= -> { events }
export async function listTodoEventsRoute(req, res) {
  const { from, to, todo_id, link_type, link_id } = req.query;
  if ((from && !isDate(from)) || (to && !isDate(to))) return res.status(400).json({ error: 'from and to must be YYYY-MM-DD' });
  if (todo_id && !UUID.test(todo_id)) return res.status(400).json({ error: 'todo_id must be a uuid' });
  if ((link_type || link_id) && !(LINK_TYPES.includes(link_type) && UUID.test(link_id || ''))) return res.status(400).json({ error: `link_type must be one of ${LINK_TYPES.join('|')} with a link_id` });
  try {
    res.json({ events: await todoEventLines(getSupabase(), req.params.businessId, { from, to, todoId: todo_id || null, link: link_type ? { type: link_type, id: link_id } : null }) });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}
