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
