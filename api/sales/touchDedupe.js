import { laDateString } from './laDate.js';
import { addDays } from './goalsShared.js';

// One touch = one partner + one person + one LA day, a day either side
// (Jack, 2026-10-08: a mail sent Oct 6 and logged by hand Oct 7 is one
// touch). Outlook and Intake both ask here, so a pasted "I emailed X" and
// the recorded send never count twice. A touch that names nobody can only
// be told apart by its type: partner + touch_type, same window.
const dateOf = iso => laDateString(new Date(iso));
const norm = s => String(s || '').trim().toLowerCase();

export function touchDedupe(partnerEvents) {
  const byName = new Map(), byType = new Map();
  for (const e of partnerEvents) {
    if (e.event !== 'touch' || !e.at) continue;
    const hit = { source: e.source || 'manual', date: dateOf(e.at) };
    for (const c of e.contact_names || []) byName.set(`${e.goal_id}|${norm(c)}|${hit.date}`, hit);
    if (e.touch_type) byType.set(`${e.goal_id}|${e.touch_type}|${hit.date}`, hit);
  }
  const window = date => [date, addDays(date, -1), addDays(date, 1)];
  return {
    prior(goalId, contact, email, date) {
      for (const d of window(date)) {
        const hit = byName.get(`${goalId}|${norm(contact)}|${d}`) || (email && byName.get(`${goalId}|${norm(email)}|${d}`));
        if (hit) return hit;
      }
      return null;
    },
    priorOfType(goalId, touchType, date) {
      for (const d of window(date)) { const hit = byType.get(`${goalId}|${touchType}|${d}`); if (hit) return hit; }
      return null;
    },
  };
}
