// sales-analytics-design-v1 Stage 2 - every alerts-row rule lives here, in
// one place, so thresholds can be tuned without touching render code
// (DECIDED). Starting thresholds are REVISABLE starting values per the
// SPEC, not tuned to match today's real data.
import { buildSequenceRows } from './sequenceRows';

const BOUNCE_ALERT_THRESHOLD = 0.05; // SPEC: "bounce > 5%"
const BOUNCE_ALERT_MIN_DELIVERED = 20; // SPEC: "≥20 delivered"
const STALE_SYNC_HOURS = 26; // SPEC starting value

// design-v1 Stage 2 interpretation, flagged: "last scheduled cron sync"
// is read the same way the header's own existing "Synced <time>" chip
// already reads it - the latest non-test run of ANY trigger (cron or
// manual), not a cron-only cutoff. A cron-only reading would make this
// rule fire constantly in the real-today state (zero cron-triggered runs
// have ever completed yet - confirmed in an earlier read-only check),
// which would be noise rather than the real signal Seif needs ("am I
// getting fresh data at all"). Flag back if a stricter cron-only check
// was actually intended.
export function computeAlerts({ allRows, entities, lastRun }) {
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

  // Rule 3 - staleness.
  const referenceTime = lastRun ? new Date(lastRun.finished_at || lastRun.started_at).getTime() : null;
  const hoursSince = referenceTime ? (Date.now() - referenceTime) / 3600000 : Infinity;
  if (hoursSince > STALE_SYNC_HOURS) {
    alerts.push({
      key: 'stale-sync',
      severity: 'warn',
      title: 'Daily sync missed',
      action: lastRun ? `Last synced ${Math.round(hoursSince)}h ago.` : 'No sync has run yet.',
    });
  }

  // Priority order when more than 3 qualify, matching the mockup's own
  // displayed order (worst-bounce, mailbox-error, grouped-rest) with
  // staleness appended last - both "bad" cards rank ahead of the "warn"
  // ones. REVISABLE/flagged: not specified explicitly by the SPEC.
  const order = ['bounce-worst', 'mailbox-error', 'bounce-rest', 'stale-sync'];
  return alerts.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)).slice(0, 3);
}
