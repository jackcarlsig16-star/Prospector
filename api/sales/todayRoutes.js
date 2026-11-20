import { getSupabase } from './goalsShared.js';
import { hasRole } from '../lib/requireAuth.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { laDateString } from './laDate.js';
import { cleanText } from './scrubText.js';
import { openTodosFor, laMonday } from './openTodos.js';
import { listScores } from './scoresRoutes.js';
import { peopleActivity } from './peopleActivityRoutes.js';
import { visitIndex } from './visitJoin.js';
import { linkFor, linkRecords } from './todoLink.js';
import { buildToday, badgeCount, SOURCES } from './todayRank.js';
import { work } from './todayWork.js';
import { dataKeysRan } from './dataKeysFlag.js';

// actions-v2 A1 / A4 - the routes behind Actions › Today.
//   GET  goals/today?owner=me|<user id>|unassigned&chips=overdue|undated|snoozed&source=&q=   the five groups (Viewer+)
//   GET  goals/today/fixes                                   Needs attention: at most five fixes, computed on open
//   POST goals/today/:key/work { verb?, tone?, person? }     the work panel (Member; todayWork.js)
// ONE read set feeds the list: the open to-dos, the stored scores, the People rows (their stored email summary and
// heat) and the latest visit row per company - no score, heat or visit count is computed here. No model call.
// Nothing in this file writes: every button a fix shows is one of Scout's verbs (plan -> card -> act -> undo).
export const FIXES_MAX = 5;
export const BATCH = 25; // Scout's card holds 25 rows; a fix says so when it has more
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
export const todayReads = { openTodosFor, listScores, peopleActivity, dataKeysRan };

export function parseTodayQuery(q = {}, meId = null) {
  const chips = String(q.chips || '').split(',').map(s => s.trim());
  return {
    owner: q.owner === 'me' ? meId : q.owner === 'unassigned' ? 'unassigned' : UUID.test(q.owner || '') ? q.owner : null,
    chip: chips.includes('overdue') ? 'overdue' : chips.includes('undated') ? 'undated' : null, snoozed: chips.includes('snoozed'),
    source: SOURCES.includes(q.source) ? q.source : null, q: String(q.q || '').trim().slice(0, 80),
  };
}

// fathom-notes-v1 F7: the stored call notes nobody has accepted (a Fathom recording waits here until a member's
// Accept; a pasted note is born accepted). Members only - a Viewer never sees a call's title.
export const waitingNotes = (supabase, businessId) => supabase.from('sales_call_notes').select('id, title, call_date, created_by, created_at, extract')
  .eq('business_id', businessId).is('accepted_at', null).order('call_date', { ascending: false }).limit(50).then(must);

// -> { view (buildToday), todos (the raw open rows), people, scores, visitOf, members }
// reviews: true adds the "Review call notes" rows (the Today screen and its fixes; Scout's reads leave them out).
export async function loadToday(supabase, businessId, { now = Date.now(), filter = {}, reviews = false } = {}) {
  const today = laDateString(new Date(now)), week = laMonday(today);
  const goals = build => selectAllPages(() => build(supabase.from('sales_week_goals').select('*').eq('business_id', businessId)).order('id'));
  const [open, scored, peopled, visits, waiting, five, memberRows, dataKeys, toReview] = await Promise.all([
    todayReads.openTodosFor(supabase, businessId, null, { today, snoozed: filter.snoozed ? 'only' : 'hide' }),
    todayReads.listScores(supabase, businessId, {}, { now }),
    todayReads.peopleActivity(supabase, businessId, { window: 'all', now, snoozed: 'all' }),
    selectAllPages(() => supabase.from('web_visits').select('id, company_key, company_name, matched_type, matched_id, visits_7d, last_visit, seen_to, top_paths, pulled_on').eq('business_id', businessId).order('id')),
    filter.snoozed ? [] : goals(x => x.eq('kind', 'waiting').eq('status', 'open')),
    goals(x => x.eq('kind', 'commitment').eq('week_start', week)),
    supabase.from('business_members').select('user_id, name, profile:profiles!business_members_user_id_fkey(display_name)').eq('business_id', businessId).not('user_id', 'is', null).then(must),
    todayReads.dataKeysRan(supabase, now),
    reviews && !filter.snoozed ? waitingNotes(supabase, businessId) : [],
  ]);
  const scores = scored.status === 200 ? [...scored.body.rows, ...(scored.body.live || [])] : [];
  const people = peopled.status === 200 ? peopled.body.rows : [];
  const members = memberRows.map(m => ({ id: m.user_id, name: cleanText((m.profile?.display_name || m.name || 'Member').trim(), 80) }));
  // the reply-owed rows of the Snoozed view would be every reply again: that view is the hidden to-dos only
  const view = buildToday({ todos: open.rows, waiting, five, scores, people: filter.snoozed ? people.map(p => ({ ...p, emails: { ...p.emails, replied: 0 } })) : people, visits, members, reviews: toReview, today, filter, snoozed: open.snoozed, flags: { data_keys: dataKeys } });
  return { view, todos: open.rows, people, scores, visitOf: visitIndex(visits), members };
}

export async function linkableRecords(supabase, businessId) {
  const read = (table, cols, build = x => x) => selectAllPages(() => build(supabase.from(table).select(cols).eq('business_id', businessId)).order('id'));
  const [partners, opportunities, targets] = await Promise.all([read('sales_goals', 'id, name', x => x.eq('goal_type', 'partnership')), read('sales_opportunities', 'id, organization, archived_at'), read('sales_targets', 'id, name, status')]);
  return linkRecords({ partners, opportunities: opportunities.filter(o => !o.archived_at), targets });
}

const FEEDS = [['apollo', 'Apollo sync'], ['visitors', 'Site visitors']];
const todoRow = r => ({ entity: 'todos', id: r.id, title: r.text });
// A4 - worst first, never more than five. A healthy feed never counts toward the number on the button.
export function buildFixes({ team, mine, todos, records, feeds = [] }) {
  const rows = v => v.groups.flatMap(g => g.rows);
  const teamRows = rows(team), myRows = rows(mine);
  const replies = teamRows.filter(r => r.kind === 'reply');
  const unowned = teamRows.filter(r => r.kind === 'todo' && !r.owner_user_id);
  const unlinked = todos.filter(t => !t.link_type);
  const named = unlinked.map(t => ({ t, m: linkFor(t.text, records) })).filter(x => x.m);
  const one = named.filter(x => x.m.link);
  const undated = myRows.filter(r => r.kind === 'todo' && !r.due);
  const calls = teamRows.filter(r => r.kind === 'review');
  const more = list => (list.length > BATCH ? ` The card takes ${BATCH} at a time.` : '');
  const items = [
    ...feeds.filter(f => f.failed).map(f => ({ id: `feed:${f.id}`, n: 1, title: `${f.label} failed`, note: f.line, action: null })),
    calls.length && { id: 'reviews', n: calls.length, title: `${calls.length} call${calls.length === 1 ? '' : 's'} to review`, note: 'Recorded calls whose notes are stored and waiting: nothing reaches a record until a member accepts.',
      action: { label: 'Review', review: calls[0].note_id } },
    replies.length && { id: 'replies', n: replies.length, title: `${replies.length} repl${replies.length === 1 ? 'y has' : 'ies have'} no to-do`, note: 'People wrote back and nothing on the list answers them.',
      action: { label: `Add ${Math.min(replies.length, BATCH)} to-do${replies.length === 1 ? '' : 's'}`, verb: 'reply_todos', rows: replies.slice(0, BATCH).map(r => ({ entity: 'people', id: r.person.key, title: r.person.name, company: r.company?.id ? { type: r.company.type, id: r.company.id, name: r.company.name } : null })) } },
    unowned.length && { id: 'unowned', n: unowned.length, title: `${unowned.length} to-do${unowned.length === 1 ? ' has' : 's have'} no owner`, note: `They show under Team only, so nobody’s Today has them.${more(unowned)}`,
      action: { label: 'Assign with Scout', verb: 'assign_owner', rows: unowned.slice(0, BATCH).map(todoRow) } },
    unlinked.length && { id: 'unlinked', n: unlinked.length, title: `${unlinked.length} to-do${unlinked.length === 1 ? ' has' : 's have'} no company`, note: `They can’t be ranked by score or visits. ${named.length} name a company in their text${named.length > one.length ? ` (${named.length - one.length} name more than one)` : ''}.`,
      action: one.length ? { label: `Link ${Math.min(one.length, BATCH)}`, verb: 'link_named', rows: one.slice(0, BATCH).map(x => ({ entity: 'todos', id: x.t.id, title: cleanText(x.t.text, 200) })) } : null },
    undated.length && { id: 'undated', n: undated.length, title: `${undated.length} of your to-dos have no date`, note: `They sit in Everything else until dated.${more(undated)}`,
      action: { label: 'Date with Scout', verb: 'task_due', needs: 'date', rows: undated.slice(0, BATCH).map(todoRow) } },
  ].filter(Boolean).slice(0, FIXES_MAX);
  return { n: items.length, items, feeds };
}

export async function fixes(supabase, { businessId, userId, now = Date.now(), reviews = false }) {
  const { attention } = await import('./attentionRoutes.js');
  const [t, records, att, note] = await Promise.all([
    loadToday(supabase, businessId, { now, reviews }),
    linkableRecords(supabase, businessId),
    attention(supabase, { businessId, userId, now }).catch(e => ({ sources: [], error: e.message })),
    supabase.from('sales_call_notes').select('id, call_date').eq('business_id', businessId).order('call_date', { ascending: false }).limit(1).then(must),
  ]);
  const made = note[0] ? must(await supabase.from('sales_week_goals').select('id').eq('business_id', businessId).eq('source_note_id', note[0].id)).length : 0;
  const feeds = [
    ...FEEDS.map(([id, label]) => { const s = att.sources.find(x => x.id === id); return s ? { id, label, status: s.status, failed: s.status === 'failed', line: s.error ? cleanText(String(s.error), 160) : s.last_at ? `Last ran ${s.last_at}` : 'No run yet', last_at: s.last_at || null } : { id, label, status: 'unknown', failed: false, line: att.error ? 'Could not be read' : 'No run yet', last_at: null }; }),
    { id: 'call_notes', label: 'Call-note intake', status: note[0] ? 'ok' : 'none', failed: false, line: note[0] ? `Last note ${note[0].call_date} · ${made} to-do${made === 1 ? '' : 's'} made` : 'No call notes yet', last_at: note[0]?.call_date || null },
  ];
  const mine = buildFiltered(t, { owner: userId });
  return { ...buildFixes({ team: t.view, mine, todos: t.todos, records, feeds }), today: t.view.today };
}
// The same material under another filter (no second read).
function buildFiltered(t, filter) {
  const rows = t.view.groups.flatMap(g => g.rows).filter(r => (filter.owner ? r.owner_user_id === filter.owner : true));
  return { groups: [{ rows }] };
}

const fail = (res, label, e) => { console.error(`[${label}]`, e.message); res.status(e.status || 500).json({ error: e.message }); };
export async function todayRoute(req, res) {
  try {
    const { view, members } = await loadToday(getSupabase(), req.params.businessId, { filter: parseTodayQuery(req.query, req.auth?.user?.id || null), reviews: hasRole(req, req.params.businessId, 'member') });
    res.json({ ...view, badge: badgeCount(view), members });
  } catch (e) { fail(res, 'goals/today', e); }
}
export async function todayFixesRoute(req, res) {
  try { res.json(await fixes(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, reviews: hasRole(req, req.params.businessId, 'member') })); }
  catch (e) { fail(res, 'goals/today/fixes', e); }
}
export async function todayWorkRoute(req, res) {
  try { const r = await work(getSupabase(), { businessId: req.params.businessId, auth: req.auth, key: String(req.params.key || ''), body: req.body || {} }); res.status(r.status).json(r.body); }
  catch (e) { fail(res, 'goals/today/:key/work', e); }
}
