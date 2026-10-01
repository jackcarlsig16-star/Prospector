import { createClient } from '@supabase/supabase-js';
import { isAllowlistedBusiness } from './allowlist.js';

// sales-email-trend-v1 REV2 - server-only access, same posture as every
// other sales_* table (RLS enabled, zero policies). Zero Apollo calls:
// these routes only read what the sync / backfill already stored.
function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function checkAllowlist(req, res) {
  if (!isAllowlistedBusiness(req.params.businessId)) {
    res.status(403).json({ error: 'business is not allowlisted for sales analytics' });
    return false;
  }
  return true;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EVENT_CATEGORIES = ['deliverability', 'mailbox', 'sequence', 'list', 'other'];
const COUNT_FIELDS = ['delivered', 'hard_bounced', 'spam_blocked', 'opened', 'clicked', 'replied'];
const PAGE = 1000; // PostgREST's default max-rows

// GET /email-counts?from=YYYY-MM-DD - daily counts summed to day x mailbox
// (the chart doesn't split by sequence/step), plus how fresh the backfill is.
export async function emailCountsRoute(req, res) {
  if (!checkAllowlist(req, res)) return;
  const { from } = req.query;
  if (from && !DATE_RE.test(from)) return res.status(400).json({ error: 'from must be YYYY-MM-DD' });
  const supabase = getSupabase();
  const businessId = req.params.businessId;

  const raw = [];
  for (let offset = 0; ; offset += PAGE) {
    let q = supabase.from('sales_email_daily_counts').select(['day', 'mailbox', ...COUNT_FIELDS].join(','))
      .eq('business_id', businessId).order('day').order('mailbox').order('sequence_id').order('step')
      .range(offset, offset + PAGE - 1);
    if (from) q = q.gte('day', from);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    raw.push(...data);
    if (data.length < PAGE) break;
  }

  const byKey = new Map();
  for (const r of raw) {
    const key = `${r.day}|${r.mailbox}`;
    if (!byKey.has(key)) byKey.set(key, { day: r.day, mailbox: r.mailbox, ...Object.fromEntries(COUNT_FIELDS.map(f => [f, 0])) });
    const agg = byKey.get(key);
    for (const f of COUNT_FIELDS) agg[f] += r[f];
  }

  const { data: weeks, error: wErr } = await supabase.from('sales_email_backfill_weeks')
    .select('week_start,fetched_at,complete').eq('business_id', businessId).order('week_start');
  if (wErr) return res.status(500).json({ error: wErr.message });

  res.status(200).json({
    rows: [...byKey.values()],
    first_week: weeks.length ? weeks[0].week_start : null,
    last_fetched_at: weeks.reduce((max, w) => (w.fetched_at > max ? w.fetched_at : max), '') || null,
    incomplete_weeks: weeks.filter(w => !w.complete).map(w => w.week_start),
  });
}

export async function listEventsRoute(req, res) {
  if (!checkAllowlist(req, res)) return;
  const { data, error } = await getSupabase().from('sales_events')
    .select('id,event_date,label,category,created_by,created_at').eq('business_id', req.params.businessId).order('event_date');
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json({ events: data });
}

export async function createEventRoute(req, res) {
  if (!checkAllowlist(req, res)) return;
  const { event_date, label, category = 'other', created_by = null, ...rest } = req.body || {};
  if (Object.keys(rest).length) return res.status(400).json({ error: `unknown field: ${Object.keys(rest)[0]}` });
  if (typeof event_date !== 'string' || !DATE_RE.test(event_date)) return res.status(400).json({ error: 'event_date must be YYYY-MM-DD' });
  if (typeof label !== 'string' || !label.trim() || label.length > 120) return res.status(400).json({ error: 'label must be 1-120 characters' });
  if (!EVENT_CATEGORIES.includes(category)) return res.status(400).json({ error: `category must be one of ${EVENT_CATEGORIES.join('|')}` });
  if (created_by !== null && typeof created_by !== 'string') return res.status(400).json({ error: 'created_by must be a string' });
  const { data, error } = await getSupabase().from('sales_events')
    .insert({ business_id: req.params.businessId, event_date, label: label.trim(), category, created_by })
    .select('id,event_date,label,category,created_by,created_at').single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ event: data });
}
