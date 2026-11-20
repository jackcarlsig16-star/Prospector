// Ruling K1 (2026-11-10): the employer word is "employer" everywhere, on disk too (data-keys-v1 Stage 1 rewrote
// web_visits.matched_type and sales_week_goals.link_type). readType is the ONE alias left: a browser tab opened before
// that release still sends 'opportunity' as a to-do's link type. Each use is counted; the count reads 0 once no such
// tab is left, and the alias goes then (data-cleanup-v1).
let fired = 0;
export const readType = t => {
  if (t !== 'opportunity') return t;
  fired += 1;
  console.warn(`[readType] 'opportunity' read as 'employer' (${fired} since this process started)`);
  return 'employer';
};
export const aliasCount = () => fired;
