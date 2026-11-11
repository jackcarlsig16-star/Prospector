import { laDateString } from '../salesAnalytics/periods';

// scout-v3 Stage 2 - the pure parts of Scout's actions: what reads as a command, the rows a command resolves against,
// each row's quick menu, the confirm card's words, the in-place row update after an act, and the countdown.
// Event: prospector:scout-capture { businessId, text, due_date, link } - the header's quick capture opens prefilled
// (ruling R4: Scout never writes a task; "Opened quick capture — save it there").
export const SCOUT_CAPTURE = 'prospector:scout-capture';
export const UNDO_SECONDS = 10;
export const PHONE_SHOWN = { people: 3, todos: 2 };

// The first word decides (the server's parseCommand has the final say: { command: false } falls back to an ask).
const COMMAND = /^(?:(?:please|scout|hey scout|ok|okay|can you|could you|go ahead and|now)[,\s]+)*(?:(?:re)?assign|unassign|mark|not a fit|deprioriti[sz]e|log|draft|write|snooze|add|create|make|new|\+ ?task|copy|send|email|reply|forward|delete|remove|erase|archive|move|advance|push|promote|change|put|enrol|enroll|sync|refresh)\b|\bfor claude\b/i;
export const looksLikeCommand = t => COMMAND.test(String(t || '').trim());

const COMPANY = ['partners', 'employers', 'targets'];
const KIND_WORD = { partner: 'Partner', employer: 'Employer', target: 'Target', person: 'Person' };
export const keyOf = it => `${it.entity}:${it.id}`;
// A person / task row needs its structured row (an older thread turn has none: it shows as a plain record).
export const rowKind = it => (it.row?.kind === 'person' ? 'person' : it.row?.kind === 'task' ? 'task' : COMPANY.includes(it.entity) ? 'company' : 'other');
export const sectionsOf = turn => (turn?.sections?.length ? turn.sections : [{ title: null, count: (turn?.items || []).length, total: (turn?.items || []).length, rule: null, read: null, rows: turn?.items || [], line: null, brief: null }]);
// What /plan resolves "those", "the first 3" or a name against: every row of the answer on screen, in order.
export function planRows(turn) {
  const seen = new Set(), out = [];
  for (const s of sectionsOf(turn)) for (const r of s.rows) {
    if (seen.has(keyOf(r))) continue;
    seen.add(keyOf(r));
    out.push({ entity: r.entity, id: r.id, title: r.title, company: r.row?.company ? { type: r.row.company.type, id: r.row.company.id, name: r.row.company.name } : null });
  }
  return out;
}

export const SNOOZE_CHOICES = [{ id: 'tomorrow', label: 'Tomorrow', days: 1 }, { id: 'week', label: 'In a week', days: 7 }, { id: 'two', label: 'In 2 weeks', days: 14 }, { id: 'month', label: 'In a month', days: 30 }];
export const dateIn = (days, now = new Date()) => laDateString(new Date(now.getTime() + days * 864e5));
// A row's ⋯ menu. People and companies act through Scout's verbs; a task's Done / Reassign / Snooze open the task
// where its own controls are (rulings R4-R5: no Scout write on a task).
const RECORD_MENU = [{ id: 'assign', label: 'Assign', sub: 'members' }, { id: 'add_task', label: 'Task' }, { id: 'contacted', label: 'Mark contacted' }, { id: 'not_fit', label: 'Not a fit' }, { id: 'draft', label: 'Draft email' }, { id: 'snooze', label: 'Snooze', sub: 'dates' }, { id: 'copy', label: 'Copy for Claude' }];
const PERSON_MENU = RECORD_MENU.flatMap(m => (m.id === 'draft' ? [m, { id: 'bundle', label: 'Copy draft bundle' }] : [m]));
const TASK_MENU = [{ id: 'task:done', label: 'Done', open: true }, { id: 'task:reassign', label: 'Reassign', open: true }, { id: 'task:snooze', label: 'Snooze', open: true }, { id: 'open', label: 'Open', open: true }];
export const menuFor = item => ({ person: PERSON_MENU, company: RECORD_MENU, task: TASK_MENU })[rowKind(item)] || [];

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const nounOf = rows => { const kinds = new Set(rows.map(r => r.kind)); return kinds.size === 1 && kinds.has('person') ? ['person', 'people'] : [...kinds].every(k => ['partner', 'employer', 'target'].includes(k)) ? ['company', 'companies'] : ['record', 'records']; };
const day = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '');
// "Assign 3 companies to Ana" · "Mark 2 people contacted" · "Snooze 1 person until Thu, Nov 12".
export function cardTitle(card) {
  const n = plural(card.rows.length, ...nounOf(card.rows));
  if (card.verb === 'assign') return `Assign ${n} to ${card.to}`;
  if (card.verb === 'contacted') return `Mark ${n} contacted`;
  if (card.verb === 'not_fit') return `Mark ${n} not a fit`;
  if (card.verb === 'snooze') return `Snooze ${n} until ${day(card.to)}`;
  return `${card.label} ${n}`;
}
export const cardFoot = card => (card.summary.skipped ? `${card.summary.will} will change · ${card.summary.skipped} skipped` : 'Nothing changes until you confirm.');
export const rowKindWord = r => KIND_WORD[r.kind] || '';

// After /act: each acted row of the answer carries what happened (a green "updated", a failure, a skip) - in place,
// no re-ask. Undo clears them.
export function withResults(turn, rows) {
  const by = new Map(rows.map(r => [r.key, r]));
  const mark = it => { const r = by.get(keyOf(it)); return r ? { ...it, result: r.ok ? { state: 'updated', text: r.to } : r.error ? { state: 'failed', text: r.error } : { state: 'skipped', text: r.skipped } } : it; };
  return { ...turn, items: (turn.items || []).map(mark), sections: turn.sections?.map(s => ({ ...s, rows: s.rows.map(mark) })) };
}
export const withoutResults = turn => { const clear = ({ result, ...it }) => it; return { ...turn, items: (turn.items || []).map(clear), sections: turn.sections?.map(s => ({ ...s, rows: s.rows.map(clear) })) }; };
// D11: an action is a sub-line of the answer it acted on.
export const withAction = (turn, line) => ({ ...turn, actions: [...(turn.actions || []), line].slice(-5) });
export const undoneAction = turn => ({ ...turn, actions: (turn.actions || []).map((a, i, all) => (i === all.length - 1 ? `${a} · undone` : a)) });

export const countPill = (s, noun) => `${s.count}${s.total > s.count ? ` of ${s.total}` : ''}${noun ? ` ${noun}` : ''}`;
export const sectionNoun = s => { const kinds = new Set(s.rows.map(rowKind)); return kinds.size !== 1 ? '' : kinds.has('person') ? (s.count === 1 ? 'person' : 'people') : kinds.has('task') ? 'open' : kinds.has('company') ? (s.count === 1 ? 'company' : 'companies') : ''; };
export const copiedLine = r => `✓ Copied · ${r.records} record${r.records === 1 ? '' : 's'} · ${Number(r.chars).toLocaleString('en-US')} chars`;
export const bundleLine = (name, chars) => `✓ Copied the draft bundle for ${name} · ${Number(chars).toLocaleString('en-US')} chars — paste it into Claude`;
// A task's menu opens the task where its own controls are; the line says what to do there.
export const TASK_LINE = { open: 'Opened the task in Actions', 'task:done': 'Opened the task in Actions — mark it done there', 'task:reassign': 'Opened the task in Actions — reassign it there', 'task:snooze': 'Opened the task in Actions — snooze it there' };
