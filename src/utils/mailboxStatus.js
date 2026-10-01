// sales-mailbox-stale-error-v1 - Apollo leaves unlink_error_code /
// inactive_reason / unlink_error_message set after a mailbox is
// reconnected (seen live 2026-10-01: jack@ kept auth_token_expired after a
// reconnect; cyrus@ has carried "immediately deactivated after oauth" since
// Aug 27 while sending normally). Those fields are history, not state.
// Shared by the alerts row, Mailbox Health, and trend rule R5.

export const MAILBOX_SYNC_STALE_HOURS = 24;

// m: a mailbox from GET /entities. Returns null when healthy, otherwise a
// short reason. Snapshots taken before the adapter kept last_synced_at /
// revoked_at / created_at simply skip those checks.
export function mailboxConnectionProblem(m) {
  if (m.active === false) return 'Inactive';
  if (m.needs_reauth_at) return 'Needs re-auth';
  // Apollo has no "connected at" field; created_at is the closest real
  // timestamp. A revoke 1ms before creation (cyrus@) is not a revoke.
  if (m.revoked_at && (!m.created_at || new Date(m.revoked_at) > new Date(m.created_at))) return 'Access revoked';
  // Measured against when our snapshot was taken, not now - syncs are
  // manual, so "now" would flag every mailbox whenever nobody has synced.
  if (m.last_synced_at && m.snapshot_at
      && (new Date(m.snapshot_at) - new Date(m.last_synced_at)) / 3600000 > MAILBOX_SYNC_STALE_HOURS) {
    return `Not synced in ${MAILBOX_SYNC_STALE_HOURS}h+`;
  }
  return null;
}

export function mailboxErrorNote(m) {
  return m.unlink_error_message || m.inactive_reason || null;
}
