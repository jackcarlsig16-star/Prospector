import { apolloRequest } from '../apolloClient.js';

export const name = 'mailboxes';

const DELIVERABILITY_FIELDS = {
  sum_sent_count: 'mailbox_sent',
  sum_delivered_count: 'mailbox_delivered',
  sum_opened_count: 'mailbox_opened',
  sum_replied_count: 'mailbox_replied',
};

function isNumeric(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// dashboard-v2 Stage 2 - real error/connection fields (F9) can be long raw
// provider text (a live example ran ~600 chars of Azure AD error detail) -
// trimmed to 300 chars per the SPEC, never stored in full. Never keep
// anything token/credential-shaped (sendgrid_api_key_v3, nylas_api_version,
// etc. stay dropped).
function trim300(s) {
  return typeof s === 'string' ? s.slice(0, 300) : (s ?? null);
}

// GET /email_accounts has no pagination (confirmed live in the audit - 2
// real mailboxes, no per_page param). Response shape defensively unwrapped
// since it wasn't pinned down to one exact envelope in the audit.
export async function fetchRecords(ctx) {
  const json = await apolloRequest({ method: 'GET', path: '/email_accounts', ctx });
  const list = Array.isArray(json) ? json : (json.email_accounts || json.data || []);

  return list.map(m => {
    const score = m.deliverability_score || {};
    return {
      id: m.id,
      email: m.email,
      active: !!m.active,
      sum_sent_count: score.sum_sent_count,
      sum_delivered_count: score.sum_delivered_count,
      sum_opened_count: score.sum_opened_count,
      sum_replied_count: score.sum_replied_count,
      deliverability_score: {
        deliverability_score: score.deliverability_score ?? null,
        date_from: score.date_from || null,
        date_to: score.date_to || null,
        avg_open_rate: score.avg_open_rate ?? null,
        avg_reply_rate: score.avg_reply_rate ?? null,
        avg_hard_bounce_rate: score.avg_hard_bounce_rate ?? null,
        avg_spam_block_rate: score.avg_spam_block_rate ?? null,
      },
      email_daily_threshold: typeof m.email_daily_threshold === 'number' ? m.email_daily_threshold : null,
      unlink_error_code: m.unlink_error_code || null,
      inactive_reason: trim300(m.inactive_reason),
      unlink_error_message: trim300(m.unlink_error_message),
      needs_reauth_at: m.needs_reauth_at || null,
      // sales-mailbox-stale-error-v1 - the real connection-state signals;
      // the error fields above stay set after a reconnect.
      last_synced_at: m.last_synced_at || null,
      revoked_at: m.revoked_at || null,
      created_at: m.created_at || null,
    };
  });
}

export function toMetrics(records) {
  const rows = [];
  const missing = [];
  for (const mailbox of records) {
    for (const [field, metricKey] of Object.entries(DELIVERABILITY_FIELDS)) {
      const value = mailbox[field];
      if (!isNumeric(value)) {
        missing.push(`mailbox ${mailbox.id}: ${field} = ${JSON.stringify(value)}`);
        continue;
      }
      rows.push({ metric_key: metricKey, dim_type: 'mailbox', dim_value: mailbox.id, value });
    }
  }
  return { rows, missing };
}
