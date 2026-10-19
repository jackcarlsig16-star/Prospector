import { normName } from './intakeMatch.js';
import { isStalePartner, daysSinceTouch, PIPELINE_STATUSES } from '../../src/constants/partnerPipeline.js';
import { TEAM_LABEL } from '../../src/constants/ownership.js';
import { KIND_LABEL, KINDS } from '../../src/constants/tidy.js';

// call-notes-targets-v1 REV4 Stage 3 - Tidy rule set v1: pure functions over
// rows the route already loaded; the clock comes in as ctx.now. Nothing here
// reads or writes the database. Thresholds are REVISABLE (spec). An 'enrich'
// kind is reserved for partner-add-research Stage 3 - no rule here.
// "Follow up" covers the Sent stages only: a Replied / Meeting partner with
// no open to-do is always "Reply/prep task", so the two never double up.
export const RESEARCH_DAYS = 7;
export const NO_DATE_DAYS = 7;
export const FLAG_DAYS = 5;
export const TOUCH_WINDOW_DAYS = 7;
export { KIND_LABEL, KINDS };
// Days until the to-do Accept creates is due; null = Accept opens the records instead.
export const DUE_DAYS = { research_or_drop: 3, follow_up: 1, set_a_date: 1, duplicate: null, reply_task: 1, check_co_owner: 1, flag_cold: 1, nudge: 0 };
export const WAITING_LATE_DAYS = 2;

const DAY = 864e5;
const SENT = ['first_email_sent', 'in_sequence'];
const REPLIED = ['replied', 'meeting_set'];
const STATUS_LABEL = Object.fromEntries(PIPELINE_STATUSES.map(s => [s.id, s.label]));
const daysAgo = (iso, now) => Math.floor((now - Date.parse(iso)) / DAY);
const days = n => `${n} day${n === 1 ? '' : 's'}`;
const ago = n => (n === 0 ? 'today' : `${days(n)} ago`);
const isOpen = t => t.status === 'open';
const openLinked = (todos, type, id) => todos.some(t => isOpen(t) && t.link_type === type && t.link_id === id);

export function researchOrDrop({ targets, todos, now }) {
  return targets
    .filter(t => t.status === 'researching' && !(t.research_notes || '').trim() && daysAgo(t.created_at, now) >= RESEARCH_DAYS && !openLinked(todos, 'target', t.id))
    .map(t => ({ kind: 'research_or_drop', ref_type: 'target', ref_id: t.id, text: `Research ${t.name} or drop`, reason: `Researching for ${days(daysAgo(t.created_at, now))} with no research notes and no open to-do` }));
}

export function followUp({ partners, todos, now, today }) {
  return partners
    .filter(p => SENT.includes(p.pipeline_status) && isStalePartner(p, now, today) && !openLinked(todos, 'partner', p.id))
    .map(p => ({ kind: 'follow_up', ref_type: 'partner', ref_id: p.id, text: `Follow up ${p.name}`, reason: `${STATUS_LABEL[p.pipeline_status]} · last touch ${ago(daysSinceTouch(p, now))} · no open to-do` }));
}

// Flags are to-dos too; flagCold covers them, so they are left out here.
export function setADate({ todos, now }) {
  return todos
    .filter(t => isOpen(t) && !t.due_date && !t.prospect_contact_id && daysAgo(t.created_at, now) >= NO_DATE_DAYS)
    .map(t => ({ kind: 'set_a_date', ref_type: 'todo', ref_id: t.id, text: `Set a date or drop: ${t.text}`, reason: `Open for ${days(daysAgo(t.created_at, now))} with no due date` }));
}

// The pair is ordered by id so the same two partners always make one key.
export function duplicates({ partners, domains }) {
  const domainsOf = new Map();
  for (const d of domains) domainsOf.set(d.goal_id, (domainsOf.get(d.goal_id) || new Set()).add(d.domain));
  const sorted = [...partners].sort((a, b) => (a.id < b.id ? -1 : 1));
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i], b = sorted[j];
      const na = normName(a.name), nb = normName(b.name);
      const sameName = na.length > 1 && (na === nb || na.replace(/ /g, '') === nb.replace(/ /g, ''));
      const shared = [...(domainsOf.get(a.id) || [])].find(d => domainsOf.get(b.id)?.has(d));
      if (!sameName && !shared) continue;
      const [first, second] = [a.name, b.name].sort((x, y) => x.localeCompare(y));
      out.push({ kind: 'duplicate', ref_type: 'pair', ref_id: a.id, ref_id2: b.id, text: `Possible duplicate: ${first} / ${second}`, reason: sameName ? 'The names match once suffixes and punctuation are removed' : `Both have the domain ${shared}` });
    }
  }
  return out;
}

// An open waiting row on the partner (they owe us the next move) counts as handled.
export function replyTask({ partners, todos, waiting = [] }) {
  return partners
    .filter(p => REPLIED.includes(p.pipeline_status) && !openLinked(todos, 'partner', p.id) && !openLinked(waiting, 'partner', p.id))
    .map(p => ({ kind: 'reply_task', ref_type: 'partner', ref_id: p.id, text: `Reply/prep task for ${p.name}`, reason: `${STATUS_LABEL[p.pipeline_status]} with no open to-do` }));
}

export function checkCoOwner({ partners, events, now }) {
  const lastTouch = new Map();
  for (const e of events) {
    if (e.event !== 'touch' || daysAgo(e.at, now) >= TOUCH_WINDOW_DAYS) continue;
    if (!lastTouch.has(e.goal_id) || e.at > lastTouch.get(e.goal_id)) lastTouch.set(e.goal_id, e.at);
  }
  return partners
    .filter(p => p.no_double_touch && p.owner_team && p.owner_team !== 'homelover' && lastTouch.has(p.id))
    .map(p => ({ kind: 'check_co_owner', ref_type: 'partner', ref_id: p.id, text: `Check with ${p.co_owner_name || TEAM_LABEL[p.owner_team]} about ${p.name}`, reason: `Touched ${ago(daysAgo(lastTouch.get(p.id), now))} · ${TEAM_LABEL[p.owner_team]} owns it · don't double-touch` }));
}

export function flagCold({ flags, now }) {
  return flags
    .filter(f => daysAgo(f.created_at, now) >= FLAG_DAYS)
    .map(f => ({ kind: 'flag_cold', ref_type: 'flag', ref_id: f.id, text: `Flag ${f.contacts?.[0] || f.text} is going cold`, reason: `Flagged ${days(daysAgo(f.created_at, now))} ago and still open` }));
}

// call-notes-targets-v1 REV5 - something they owe us, overdue by 2+ days.
export function waitingOverdue({ waiting = [], partners, today }) {
  const name = new Map(partners.map(p => [p.id, p.name]));
  return waiting
    .filter(w => isOpen(w) && w.due_date && Math.round((Date.parse(today) - Date.parse(w.due_date)) / DAY) >= WAITING_LATE_DAYS)
    .map(w => {
      const late = Math.round((Date.parse(today) - Date.parse(w.due_date)) / DAY);
      const at = w.link_type === 'partner' && name.get(w.link_id);
      return { kind: 'nudge', ref_type: 'todo', ref_id: w.id, text: `Nudge ${w.waiting_on || 'them'}${at ? ` at ${at}` : ''}`, reason: `Waiting on ${w.waiting_on || 'them'}: ${w.text.slice(0, 200)} · ${days(late)} late` };
    });
}

export const RULES = [researchOrDrop, followUp, setADate, duplicates, replyTask, checkCoOwner, flagCold, waitingOverdue];
export const runRules = ctx => RULES.flatMap(rule => rule(ctx));
// Mirrors the partial unique index: (kind, ref_type, ref_id, coalesce(ref_id2, ref_id)).
export const keyOf = s => [s.kind, s.ref_type, s.ref_id, s.ref_id2 || s.ref_id].join('|');
