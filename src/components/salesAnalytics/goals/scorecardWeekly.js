import { LAYERS } from '../../../constants/explorerLayers';
import { fmt, pct } from './goalsUi';

// weekly-funnel-v1 Stage 2 - the Scorecard's weekly rows, pure: GET goals/weekly's digits in, the words and marks of
// one row out. Nothing is computed here but the sign of the route's delta and the three progress bands.
// One line color per group, from the Explorer's validated layer palette (never a member color).
export const GROUP_COLOR = { Outbound: LAYERS.sent.color, Site: LAYERS.visitors.color, Pipeline: LAYERS.first_touched.color, LinkedIn: LAYERS.reply_rate.color };
const GOAL_COLOR = '#A8B2C0';
export const md = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
export const isRate = m => m.unit === 'rate';
export const valueText = (m, v) => (isRate(m) ? pct(v) : fmt(v));
// Two rows are called "Replies" (Outbound and LinkedIn): a control's name carries the group where it has to.
export const fullName = m => (m.group === 'LinkedIn' ? `LinkedIn ${m.name.toLowerCase()}` : m.name);
export const statusOf = p => (p == null ? null : p >= 0.9 ? 'ok' : p >= 0.5 ? 'warn' : 'bad');

// The Change cell: the route's delta against the same point last week. The glyph follows the metric's direction
// (▲ = moved the good way, ▼ = the bad way) and always sits beside the signed amount and a word.
export function changeOf(m) {
  const d = m.this_week.delta;
  if (d == null) return { dir: 'none', glyph: '—', text: '', word: 'no comparison' };
  if (d === 0) return { dir: 'flat', glyph: '—', text: 'no change', word: 'no change' };
  const good = (d > 0) === (m.direction === 'up');
  const amount = isRate(m) ? `${Math.abs(d * 100).toFixed(1)} pts` : fmt(Math.abs(d));
  return { dir: good ? 'good' : 'bad', glyph: good ? '▲' : '▼', text: `${d > 0 ? '+' : '−'}${amount}`, word: good ? 'better' : 'worse' };
}
export const paceText = m => (m.this_week.pace == null ? null : `on pace for ~${fmt(m.this_week.pace)}`);
export const sparkLabel = m => `${fullName(m)}, last ${m.series.length} weeks: ${m.series.map(s => `${md(s.week_start)} ${valueText(m, s.value)}`).join(', ')}`;

// The expanded row = the Explorer chart's data shape: the metric's line (a count rides the count-line axis) and, when
// any week has one, the goals.
export function chartData(m) {
  const kind = m.unit, line = !isRate(m);
  const goals = m.series.map(s => s.goal ?? null);
  const pace = paceText(m);
  return {
    by: 'week', label: `${fullName(m)} by week, ${m.series.length} weeks`,
    labels: m.series.map(s => ({ key: s.week_start, label: md(s.week_start), ...(s.current ? { current: true } : {}) })),
    series: [
      { layer: m.key, split_key: 'team', label: m.name, kind, line, color: GROUP_COLOR[m.group], values: m.series.map(s => s.value), end_note: pace ? `to date · ${pace}` : 'to date' },
      ...(goals.some(g => g != null) ? [{ layer: 'goal', split_key: 'team', label: 'Goal', kind, line, goal: true, color: GOAL_COLOR, values: goals }] : []),
    ],
  };
}
