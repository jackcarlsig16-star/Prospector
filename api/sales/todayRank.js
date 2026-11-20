import { addDays } from './goalsShared.js';
import { cleanText } from './scrubText.js';
import { visitIndex } from './visitJoin.js';
import { NBA_RULES } from './nextBestAction.js';

// actions-v2 A1 - "Today": one ranked list of the open to-dos, pure. A row lands in the FIRST group it fits:
//   due      due today or overdue                    top      its company is pinned or in the top band (P1)
//   visited  its company was on the site in 7 days   reply    a reply is owed (virtual rows, Q6) or we wait on one (Q2)
//   rest     everything else
// Inside a group: earliest due, then company score, then newest. Nothing here computes a score, a heat or a visit
// count - they are read off the rows listScores, peopleActivity and visitIndex already return.
export const OVERDUE_FOLD = 3; // REVISABLE (Q1): the overdue rows shown before "Show all n overdue"
export const VISIT_DAYS = 7;
export const FIVE = 5;
export const STALE_DAYS = 30; // REVISABLE (Q5): an Everything-else row untouched this long can be dropped in bulk
export const GROUPS = [
  ['due', 'Due and overdue', 'due today or earlier, earliest first'],
  ['top', 'Pinned or P1 company', 'the company is pinned or in the top band'],
  ['visited', 'Visited this week', 'the company was on the site in the last 7 days'],
  ['reply', 'Waiting on a reply', 'they wrote back and nobody has answered, or we are waiting on them'],
  ['rest', 'Everything else', 'no date, no ranked company · newest first'],
];
export const RULE_TEXT = '1 due today or overdue · 2 at a pinned or P1 company · 3 the company visited in the last 7 days · 4 a reply is owed · 5 everything else. Inside a group: earliest due, then company score, then newest. A to-do appears once, in the first group it fits. This week’s five sit above the list.';
export const VERBS = { draft_reply: 'Draft reply', prep_call: 'Prep call', draft_email: 'Draft email', find_people: 'Find people', next_steps: 'Next steps' };
export const VERB_IDS = Object.keys(VERBS);
// The nine sources a row can come from (Q4): a to-do's stored origin, plus the two kinds that are not to-dos.
export const SOURCES = ['manual', 'scout', 'call_notes', 'signal', 'tidy', 'panel', 'plan', 'reply', 'waiting'];
const SOURCE_OF = { nudge: 'signal', carry_over: 'manual', import: 'manual', system: 'manual' };
export const sourceOf = origin => (SOURCES.includes(origin) ? origin : SOURCE_OF[origin] || 'manual');
const CALL_WORDS = /\b(call|calls|meeting|meet|demo|zoom)\b/i;
const RECORD_TYPES = ['partner', 'employer', 'target'];

// D31 - never blank. A draft or a brief needs a company RECORD (the Brief is the only intel a draft may use), so a
// row with a person and no record, or with nothing linked, gets Next steps.
export function pickVerb({ replyOwed = false, text = '', person = null, company = null, companyPeople = 0 }) {
  const record = !!company?.id;
  if (replyOwed && record) return 'draft_reply';
  if (record && CALL_WORDS.test(text)) return 'prep_call';
  if (person && record) return 'draft_email';
  if (record) return companyPeople > 0 ? 'draft_email' : 'find_people';
  return 'next_steps';
}

// The grounds engine for a person (Q9): NBA_RULES over the stored email summary of a People row.
export function nbaOf(person) {
  const e = person?.emails;
  if (!e || !(e.sent || e.opened || e.clicked || e.replied)) return null;
  const signals = { replied: e.replied > 0, replyClasses: e.replied > 0 ? [person.last_email?.reply_class || 'none_of_the_above'] : [], opens: e.opened, possibleBotOpen: false, humanClicks: e.clicked };
  const rule = NBA_RULES.find(r => r.when(signals));
  return { id: rule.id, label: rule.label, reason: rule.reason(signals) };
}

const lateDays = (due, today) => Math.round((Date.parse(today) - Date.parse(due)) / 864e5);
const order = (a, b) => ((a.due == null) - (b.due == null)) || (a.due && b.due ? a.due.localeCompare(b.due) : 0)
  || ((b.company?.score ?? -1) - (a.company?.score ?? -1)) || String(b.created_at || '').localeCompare(String(a.created_at || ''));

// todos: open to-dos (openTodosFor) · waiting: open kind 'waiting' rows · five: this week's commitment rows ·
// scores: listScores rows · people: peopleActivity rows · visits: web_visits rows · members: [{ id, name }].
// filter: { owner: <user id> | 'unassigned' | null (team), chip: 'overdue' | 'undated' | null, source, q }.
export function buildToday({ todos = [], waiting = [], five = [], scores = [], people = [], visits = [], members = [], today, filter = {}, snoozed = 0, flags = {} }) {
  const scoreOf = new Map(scores.map(s => [`${s.type}:${s.id}`, s]));
  const personOf = new Map(people.map(p => [p.key, p]));
  const peopleAt = new Map();
  for (const p of people) if (p.company?.id) { const k = `${p.company.type}:${p.company.id}`; peopleAt.set(k, (peopleAt.get(k) || 0) + 1); }
  const visitOf = visitIndex(visits);
  const since = addDays(today, -(VISIT_DAYS - 1));
  const first = id => members.find(m => m.id === id)?.name.split(/\s+/)[0] || null;

  const companyOf = (linkType, linkId, person) => {
    const type = linkType;
    const ref = RECORD_TYPES.includes(type) && linkId ? { type, id: linkId } : person?.company?.id && RECORD_TYPES.includes(person.company.type) ? { type: person.company.type, id: person.company.id } : null;
    if (!ref) return person?.company?.name ? { type: null, id: null, key: null, name: cleanText(person.company.name, 160), score: null, band: null, pinned: false, visits_7d: 0 } : null;
    const s = scoreOf.get(`${ref.type}:${ref.id}`) || null;
    const name = s?.name || (person?.company?.id === ref.id ? person.company.name : null);
    const v = visitOf({ ...ref, name });
    const visited = !!v && Number(v.visits_7d) > 0 && String(v.seen_to || v.pulled_on || '') >= since;
    return { type: ref.type, id: ref.id, key: `${ref.type}-${ref.id}`, name: name ? cleanText(name, 160) : null, score: s?.score ?? null, band: s?.band ?? null, pinned: !!s?.pinned, owner_user_id: s?.owner_user_id || null, visits_7d: visited ? Number(v.visits_7d) : 0 };
  };
  const personRow = p => (p ? { key: p.key, name: p.name, title: p.title || null, heat: p.heat ?? null, heat_band: p.heat_band ?? null } : null);
  const finish = (row, { replyOwed = false, waitingOn = false } = {}) => {
    const c = row.company, overdue = !!row.due && row.due < today;
    const group = row.due && row.due <= today ? 'due' : c?.id && (c.pinned || c.band === 'P1') ? 'top' : c?.visits_7d > 0 ? 'visited' : replyOwed || waitingOn ? 'reply' : 'rest';
    return { ...row, overdue, late_days: overdue ? lateDays(row.due, today) : 0, group, owner: first(row.owner_user_id),
      verb: pickVerb({ replyOwed, text: row.text, person: row.person, company: c, companyPeople: c?.id ? peopleAt.get(`${c.type}:${c.id}`) || 0 : 0 }) };
  };

  const rows = [];
  const answered = new Set();
  for (const t of todos) {
    const p = t.person_key ? personOf.get(t.person_key) || null : null;
    if (t.person_key) answered.add(t.person_key);
    const replyOwed = !!p && p.emails?.replied > 0 && p.last_email?.what === 'replied';
    rows.push(finish({ key: `todo:${t.id}`, kind: 'todo', id: t.id, text: cleanText(t.text, 200), company: companyOf(t.link_type, t.link_id, p), person: personRow(p), owner_user_id: t.owner_user_id || null,
      due: t.due_date || null, source: sourceOf(t.origin), created_at: t.created_at || null, updated_at: t.updated_at || null, snooze_until: t.snooze_until || null, virtual: false }, { replyOwed }));
  }
  // Q6: a reply nobody has a to-do for is a VIRTUAL row - nothing is stored until "Add to-do".
  for (const p of people) {
    if (!(p.emails?.replied > 0) || answered.has(p.key)) continue;
    const c = companyOf(null, null, p);
    rows.push(finish({ key: `reply:${p.key}`, kind: 'reply', id: null, text: `Reply to ${p.name}`, company: c, person: personRow(p), owner_user_id: p.owner_user_id || c?.owner_user_id || null,
      due: null, source: 'reply', created_at: p.last_email?.at || null, updated_at: null, snooze_until: null, virtual: true, replied_at: p.last_email?.at || null, reply_class: p.last_email?.reply_class || null }, { replyOwed: true }));
  }
  for (const w of waiting) {
    rows.push(finish({ key: `waiting:${w.id}`, kind: 'waiting', id: w.id, text: cleanText(`Waiting on ${w.waiting_on || 'them'}: ${w.text}`, 200), company: companyOf(w.link_type, w.link_id, null), person: null, owner_user_id: w.owner_user_id || null,
      due: w.due_date || null, source: 'waiting', created_at: w.created_at || null, updated_at: w.updated_at || null, snooze_until: null, virtual: false }, { waitingOn: true }));
  }

  // This week's five sit above the list and out of the ranking (Q2): each slot is a commitment row of the week; a
  // slot made from a to-do links it (R2: link_type 'todo' + link_id) and takes the to-do out of the groups.
  const slots = five.filter(c => c.status !== 'dropped').sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.created_at || '').localeCompare(String(b.created_at || ''))).slice(0, FIVE);
  const todoOf = c => (c.link_type === 'todo' ? c.link_id : null);
  const inFive = new Set(slots.map(todoOf).filter(Boolean));
  const byId = new Map(rows.filter(r => r.kind === 'todo').map(r => [r.id, r]));
  const strip = slots.map((c, i) => { const r = todoOf(c) ? byId.get(todoOf(c)) || null : null; return { slot: i + 1, id: c.id, todo_id: todoOf(c), text: cleanText(r?.text || c.text, 200), company: r?.company?.name || null, due: r?.due || null, late_days: r?.late_days || 0, status: c.status, owner_user_id: c.owner_user_id || null, updated_at: c.updated_at || null }; });

  const ranked = rows.filter(r => !(r.kind === 'todo' && inFive.has(r.id)));
  const mine = r => (filter.owner === 'unassigned' ? !r.owner_user_id : filter.owner ? r.owner_user_id === filter.owner : true);
  const q = String(filter.q || '').trim().toLowerCase();
  const scoped = ranked.filter(mine);
  const shown = scoped.filter(r => (filter.chip === 'overdue' ? r.overdue : filter.chip === 'undated' ? !r.due && r.kind === 'todo' : true)
    && (!filter.source || r.source === filter.source) && (!q || `${r.text} ${r.company?.name || ''} ${r.person?.name || ''}`.toLowerCase().includes(q)));

  // P3: the number is the display order. `rank` counts the rows shown while the overdue fold is closed (a folded row
  // has none); `rank_open` counts them with the fold open, where the folded rows follow the shown rows of group 1.
  const staleBefore = addDays(today, -STALE_DAYS);
  let rank = 0, rankOpen = 0;
  const groups = GROUPS.map(([id, label, note]) => {
    let list = shown.filter(r => r.group === id).sort(id === 'rest' ? (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) : order);
    let fold = null;
    if (id === 'due') {
      // Q1: every row due today + the OVERDUE_FOLD most recent overdue; older overdue stay in the count, behind the fold.
      const late = list.filter(r => r.overdue);
      const keep = new Set(late.slice(-OVERDUE_FOLD).map(r => r.key));
      for (const r of late) r.folded = !keep.has(r.key);
      if (late.length > OVERDUE_FOLD) fold = { overdue: late.length, hidden: late.length - OVERDUE_FOLD, oldest_days: late[0].late_days };
      list = [...list.filter(r => !r.folded), ...list.filter(r => r.folded)];
    }
    if (id === 'rest') for (const r of list) r.stale = r.kind === 'todo' && String(r.updated_at || r.created_at || today).slice(0, 10) < staleBefore;
    return { id, label, note, n: list.length, collapsed: id === 'rest', fold, rows: list.map(r => ({ ...r, rank: r.folded ? null : ++rank, rank_open: ++rankOpen })) };
  });
  const todoRows = ranked.filter(r => r.kind === 'todo');
  return {
    groups, strip, five: { used: strip.length, max: FIVE, can_add: !!flags.data_keys }, rule: RULE_TEXT, today,
    counts: { shown: shown.length, mine: scoped.length, team: ranked.length, overdue: scoped.filter(r => r.overdue).length, undated: scoped.filter(r => !r.due && r.kind === 'todo').length, snoozed,
      open_todos: todoRows.length, sources: Object.fromEntries(SOURCES.map(s => [s, scoped.filter(r => r.source === s).length])) },
    verbs: Object.fromEntries(VERB_IDS.map(v => [v, shown.filter(r => r.verb === v).length])),
  };
}

// The Tasks badge (A7): the member's rows in groups 1 + 2.
export const badgeCount = today => today.groups.filter(g => g.id === 'due' || g.id === 'top').reduce((n, g) => n + g.n, 0);
