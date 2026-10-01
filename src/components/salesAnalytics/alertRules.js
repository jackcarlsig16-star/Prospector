// sales-analytics-design-v1 Stage 2 - every alerts-row rule lives here, in
// one place, so thresholds can be tuned without touching render code
// (DECIDED). Starting thresholds are REVISABLE starting values per the
// SPEC, not tuned to match today's real data.

// Exported - the leaderboard's row-tint rule ("rows with bounce > 5% get
// a faint red tint", design-v1 Stage 3) is the SAME 5% line, not a
// separately-tuned copy.
export const BOUNCE_ALERT_THRESHOLD = 0.05; // SPEC: "bounce > 5%"
// Exported - the leaderboard's own "status-colored when delivered >= 20,
// otherwise faint" and "Low volume" health pill (design-v1 Stage 3) share
// this same floor.
export const BOUNCE_ALERT_MIN_DELIVERED = 20; // SPEC: "≥20 delivered"
const STALE_SYNC_HOURS = 26; // SPEC starting value
// Off by Jack's choice (2026-10-01): the app stays on Render Free, which
// sleeps, so the in-process 6am cron can't fire and syncs are manual.
// Flip back to true if the instance ever becomes always-on.
const STALE_SYNC_ALERT_ENABLED = false;

// Jack's correction after Stage 2 review: this rule's job is specifically
// to catch the 6am cron job not running, which a recent MANUAL sync would
// otherwise mask. Cron-only, with a fixed floor so the rule can't fire
// before the cron job has had its first real chance to run - the feature
// shipped today (2026-09-30), so the floor is this evening's job,
// 2026-09-30 06:00 America/Los_Angeles (PDT, UTC-7 in late September).
// reference = max(last successful cron run, that floor); fires when
// now - reference > 26h, so the earliest possible fire is the floor plus
// 26h (~2026-10-01 08:00 PT), and after that it fires whenever the 6am
// job actually misses a day.
const CRON_FLOOR_ISO = '2026-09-30T06:00:00-07:00';

export function computeAlerts({ runs, insights }) {
  const alerts = [];

  // sales-email-trend-v1 REV2 Stage 4 - the bounce and mailbox cards now
  // come from the insight rules (api/sales/insightRules.js: R1 hard bounce,
  // R2 spam block, R5 mailbox/volume ...), so there's one rules system,
  // not two. Top 3 by severity, same 3-card budget as before.
  for (const i of (insights?.insights || []).slice(0, 3)) {
    alerts.push({ key: `${i.id}:${i.scope_key}`, severity: i.severity, title: i.title, action: i.action });
  }

  // Rule 3 - staleness, cron-only (see CRON_FLOOR_ISO comment above).
  const lastCronSuccess = (runs || []).find(r => r.trigger === 'cron' && r.status === 'success') || null;
  const lastCronTime = lastCronSuccess ? new Date(lastCronSuccess.finished_at || lastCronSuccess.started_at).getTime() : -Infinity;
  const floorTime = new Date(CRON_FLOOR_ISO).getTime();
  const referenceTime = Math.max(lastCronTime, floorTime);
  const hoursSince = (Date.now() - referenceTime) / 3600000;
  if (STALE_SYNC_ALERT_ENABLED && hoursSince > STALE_SYNC_HOURS) {
    alerts.push({
      key: 'stale-sync',
      severity: 'warn',
      title: 'Daily sync missed',
      action: lastCronSuccess ? `Last successful cron sync ${Math.round(hoursSince)}h ago.` : 'No cron sync has completed yet.',
    });
  }

  // Insights arrive already sorted bad -> warn -> info; staleness goes last.
  return alerts.slice(0, 3);
}
