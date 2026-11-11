// Ruling K1 (2026-11-10): the employer word is "employer" everywhere. Two columns still say 'opportunity' on disk
// (web_visits.matched_type, sales_week_goals.link_type) until data-keys-v1 migrates them; this is the ONE place that
// knows. readType: disk -> the word every (type, id) pair carries; diskType: the word -> what those columns hold.
export const readType = t => (t === 'opportunity' ? 'employer' : t);
export const diskType = t => (t === 'employer' ? 'opportunity' : t);
