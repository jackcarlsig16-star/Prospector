import { STAGE_LABELS } from '../pipelineStages';
import { stageName } from './partners/activityTimeline';

// sales-ia-v1 Stage 2 - the pure pieces left from Today: the Actions title
// and the two the Dashboard's Goals section takes over in sales-ia-v2 Stage 6
// (newest finalized report, this week's pipeline moves).

export const dayTitle = (today, short = false) => new Date(`${today}T12:00:00Z`)
  .toLocaleDateString('en-US', { weekday: short ? 'short' : 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });

// reports: [{ week_start, report }] in any order -> the newest final one.
export function pickNewestFinal(reports) {
  return reports.filter(r => r.report?.status === 'final').sort((a, b) => (a.week_start < b.week_start ? 1 : -1))[0] || null;
}

// Pipeline moves this week: partner stage changes from partner events and
// employer stage moves (forward, back, lost) from the movement read, newest
// first. Newly added opportunities are not moves, so they stay out.
export function pipelineMoves({ events = [], partnersById = new Map(), movement = null }, n = 8) {
  const rows = [];
  for (const e of events) {
    if (!['status', 'touch', 'deprioritize'].includes(e.event) || !e.to_status || e.to_status === e.from_status) continue;
    const p = partnersById.get(e.goal_id);
    if (!p) continue;
    rows.push({ key: `p-${e.id}`, name: p.name, kind: 'Partner', to: stageName(e.to_status), at: e.at });
  }
  const bucket = (key, to) => (movement?.[key] || []).forEach(o => rows.push({ key: `o-${key}-${o.id}`, name: o.organization, kind: 'Employer', to: to || STAGE_LABELS[o.stage] || o.stage, at: o.updated_at || null }));
  bucket('moved_forward'); bucket('moved_back'); bucket('lost', 'Lost');
  return rows.sort((a, b) => (a.at && b.at ? (a.at < b.at ? 1 : a.at > b.at ? -1 : 0) : a.at ? -1 : b.at ? 1 : 0)).slice(0, n);
}

