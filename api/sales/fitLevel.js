import { addDays, laMonday } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { FIT_AXIS_IDS, DEFAULT_FIT_THRESHOLDS, HAND_FIT_LEVELS } from '../../src/constants/fitLevels.js';

// homelover-flow-v1 F2 - the Fit level (Strong · Good · Low · Deprioritized) and Due (Today · This week · Later), pure
// over rows the callers already hold. Fit = the fit score's band unless a person set a level by hand (wins until
// cleared); Deprioritized is only ever a person's choice with a reason (F4) and beats everything. Due reads the
// record's open to-dos and, for an employer, next_action_date (ruling F-c) - never a priority word.

export function fitSettings(row) {
  const s = row && typeof row === 'object' ? row : {};
  const thresholds = { ...DEFAULT_FIT_THRESHOLDS, ...(s.thresholds && typeof s.thresholds === 'object' ? s.thresholds : {}) };
  const weights = Object.fromEntries(FIT_AXIS_IDS.map(k => [k, Number.isFinite(Number(s.weights?.[k])) && Number(s.weights[k]) >= 0 ? Number(s.weights[k]) : 1]));
  return { thresholds, weights };
}

export function levelFor(score, thresholds = DEFAULT_FIT_THRESHOLDS) {
  if (score == null || !Number.isFinite(Number(score))) return null;
  return score >= thresholds.strong ? 'strong' : score >= thresholds.good ? 'good' : 'low';
}

// record: { fit_level, deprioritized_reason, deprioritized_note } (the columns), score: the fit score or null.
// -> { level, source: 'deprioritized' | 'hand' | 'computed' | null, reason, note }
export function effectiveFit(record, score, thresholds = DEFAULT_FIT_THRESHOLDS) {
  const r = record || {};
  if (r.fit_level === 'deprioritized') return { level: 'deprioritized', source: 'deprioritized', reason: r.deprioritized_reason || 'other', note: r.deprioritized_note || null };
  if (HAND_FIT_LEVELS.includes(r.fit_level)) return { level: r.fit_level, source: 'hand', reason: null, note: null };
  const level = levelFor(score, thresholds);
  return { level, source: level ? 'computed' : null, reason: null, note: null };
}

// The default Map filter (F4 / F5): Strong + Good; Deprioritized never shows by default.
export const DEFAULT_FIT_FILTER = ['strong', 'good'];
export const inFitFilter = (level, filter = []) => (filter.length ? filter.includes(level) : level !== 'deprioritized');

// dates: every open to-do due date on the record plus next_action_date; the earliest decides. -> { due, date } | null.
// "This week" = up to the Sunday of today's LA week.
export function dueFor(dates, today) {
  const list = (dates || []).filter(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)).map(d => d.slice(0, 10)).sort();
  if (!list.length) return null;
  const date = list[0];
  const weekEnd = addDays(laMonday(today), 6);
  return { due: date <= today ? 'today' : date <= weekEnd ? 'week' : 'later', date };
}

const LINK_TYPE = { partner: 'partner', opportunity: 'employer', target: 'target' };

// One pass for a list: Map '<type>:<id>' -> { due, date } over the workspace's open to-dos with a due date and every
// live employer's next_action_date. Deprioritized records are left to the caller (they never sit on a Due list).
export async function dueMap(supabase, businessId, { today }) {
  const [todos, employers] = await Promise.all([
    selectAllPages(() => supabase.from('sales_week_goals').select('link_type, link_id, due_date').eq('business_id', businessId).eq('kind', 'todo').eq('status', 'open').not('link_id', 'is', null).order('id')),
    selectAllPages(() => supabase.from('sales_opportunities').select('id, next_action_date').eq('business_id', businessId).is('archived_at', null).not('next_action_date', 'is', null).order('id')),
  ]);
  const dates = new Map();
  const add = (key, d) => { if (!d) return; if (!dates.has(key)) dates.set(key, []); dates.get(key).push(d); };
  for (const t of todos) if (LINK_TYPE[t.link_type] && t.due_date) add(`${LINK_TYPE[t.link_type]}:${t.link_id}`, t.due_date);
  for (const e of employers) add(`employer:${e.id}`, e.next_action_date);
  return new Map([...dates].map(([k, list]) => [k, dueFor(list, today)]));
}
