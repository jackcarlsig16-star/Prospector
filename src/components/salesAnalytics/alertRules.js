// sales-analytics-design-v1 Stage 2 - every alerts-row rule lives here, in
// one place, so thresholds can be tuned without touching render code
// (DECIDED). Starting thresholds are REVISABLE starting values per the
// SPEC, not tuned to match today's real data.
import { buildSequenceRows } from './sequenceRows';

const BOUNCE_ALERT_THRESHOLD = 0.05; // SPEC: "bounce > 5%"
const BOUNCE_ALERT_MIN_DELIVERED = 20; // SPEC: "≥20 delivered"
const STALE_SYNC_HOURS = 26; // SPEC starting value

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

export function computeAlerts({ allRows, entities, runs }) {
  const alerts = [];

  // Rule 1 - any active sequence with >=20 delivered and bounce > 5%,
  // worst first. The worst gets its own card; the rest (if any) are
  // grouped into a second card so the row stays within its 3-card budget
  // no matter how many sequences qualify.
  const bouncing = buildSequenceRows(allRows, entities)
    .filter(r => r.active !== false && r.delivered !== null && r.delivered >= BOUNCE_ALERT_MIN_DELIVERED && r.bounceRate !== null && r.bounceRate > BOUNCE_ALERT_THRESHOLD)
    .sort((a, b) => b.bounceRate - a.bounceRate);

  if (bouncing.length) {
    const worst = bouncing[0];
    alerts.push({
      key: 'bounce-worst',
      severity: 'bad',
      title: `${worst.cohort} sequence bouncing at ${(worst.bounceRate * 100).toFixed(1)}%`,
      action: 'Pause it and run the list through verification before resuming.',
    });
  }

  // Rule 2 - any mailbox with a connection error. Grouped into one card
  // when more than one mailbox has an error, for the same reason rule 1
  // groups its overflow - the row has a hard 3-card cap.
  const mailboxesWithErrors = (entities?.mailboxes || []).filter(m => m.unlink_error_code || m.inactive_reason);
  if (mailboxesWithErrors.length === 1) {
    alerts.push({
      key: 'mailbox-error',
      severity: 'bad',
      title: `${mailboxesWithErrors[0].email} reported a connection error`,
      action: 'As of last sync. Re-sync to confirm the reconnect took.',
    });
  } else if (mailboxesWithErrors.length > 1) {
    alerts.push({
      key: 'mailbox-error',
      severity: 'bad',
      title: `${mailboxesWithErrors.length} mailboxes reported connection errors`,
      action: `${mailboxesWithErrors.map(m => m.email).join(', ')} — as of last sync. Re-sync to confirm.`,
    });
  }

  // Rule 1 continued - the rest of the bouncing sequences.
  if (bouncing.length > 1) {
    const rest = bouncing.slice(1);
    alerts.push({
      key: 'bounce-rest',
      severity: 'warn',
      title: `${rest.map(r => `${r.cohort} ${(r.bounceRate * 100).toFixed(1)}%`).join(' · ')} bounce`,
      action: `${rest.length > 1 ? 'All' : 'It’s'} above the 5% line. Check list sources.`,
    });
  }

  // Rule 3 - staleness, cron-only (see CRON_FLOOR_ISO comment above).
  const lastCronSuccess = (runs || []).find(r => r.trigger === 'cron' && r.status === 'success') || null;
  const lastCronTime = lastCronSuccess ? new Date(lastCronSuccess.finished_at || lastCronSuccess.started_at).getTime() : -Infinity;
  const floorTime = new Date(CRON_FLOOR_ISO).getTime();
  const referenceTime = Math.max(lastCronTime, floorTime);
  const hoursSince = (Date.now() - referenceTime) / 3600000;
  if (hoursSince > STALE_SYNC_HOURS) {
    alerts.push({
      key: 'stale-sync',
      severity: 'warn',
      title: 'Daily sync missed',
      action: lastCronSuccess ? `Last successful cron sync ${Math.round(hoursSince)}h ago.` : 'No cron sync has completed yet.',
    });
  }

  // Priority order when more than 3 qualify, matching the mockup's own
  // displayed order (worst-bounce, mailbox-error, grouped-rest) with
  // staleness appended last - both "bad" cards rank ahead of the "warn"
  // ones. REVISABLE/flagged: not specified explicitly by the SPEC.
  const order = ['bounce-worst', 'mailbox-error', 'bounce-rest', 'stale-sync'];
  return alerts.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)).slice(0, 3);
}
