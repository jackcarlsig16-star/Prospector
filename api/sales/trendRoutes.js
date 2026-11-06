import { createClient } from '@supabase/supabase-js';
import { computeInsights, loadInsightInput } from './insightRules.js';
import { mailboxLabels } from './explorerRoutes.js';

// sales-email-trend-v1 REV2 - server-only access, same posture as every
// other sales_* table (RLS enabled, zero policies). Zero Apollo calls:
// these routes only read what the sync / backfill already stored.
function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}


const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EVENT_CATEGORIES = ['deliverability', 'mailbox', 'sequence', 'list', 'other'];
const COUNT_FIELDS = ['delivered', 'hard_bounced', 'spam_blocked', 'opened', 'clicked', 'replied'];
const PAGE = 1000; // PostgREST's default max-rows

// GET /email-counts?from=YYYY-MM-DD - daily counts summed to day x mailbox
// (the chart doesn't split by sequence/step), plus how fresh the backfill is.
export async function emailCountsRoute(req, res) {
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
  const { data, error } = await getSupabase().from('sales_events')
    .select('id,event_date,label,category,created_by,created_at').eq('business_id', req.params.businessId).order('event_date');
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json({ events: data });
}

export async function createEventRoute(req, res) {
  const { event_date, label, category = 'other', ...rest } = req.body || {};
  if (Object.keys(rest).length) return res.status(400).json({ error: `unknown field: ${Object.keys(rest)[0]}` });
  if (typeof event_date !== 'string' || !DATE_RE.test(event_date)) return res.status(400).json({ error: 'event_date must be YYYY-MM-DD' });
  if (typeof label !== 'string' || !label.trim() || label.length > 120) return res.status(400).json({ error: 'label must be 1-120 characters' });
  if (!EVENT_CATEGORIES.includes(category)) return res.status(400).json({ error: `category must be one of ${EVENT_CATEGORIES.join('|')}` });
  const { data, error } = await getSupabase().from('sales_events')
    .insert({ business_id: req.params.businessId, event_date, label: label.trim(), category, created_by: req.auth.user.email })
    .select('id,event_date,label,category,created_by,created_at').single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ event: data });
}

const DISMISS_DAYS = 7;

// dashboard-v3 Stage 4: the rules name mailboxes by address (R2 / R5 / R6); the reply carries the owner's first name
// instead (mailboxLabels), in every text field and affected label. scope_key keeps the address: it is the dismissal's
// key and is never shown.
async function mailboxNames(supabase, businessId, emails) {
  const [{ data: owners }, { data: members }] = await Promise.all([
    supabase.from('sales_mailbox_owners').select('mailbox_email, user_id').eq('business_id', businessId),
    supabase.from('business_members').select('user_id, name, profile:profiles!business_members_user_id_fkey(display_name)').eq('business_id', businessId).not('user_id', 'is', null).order('created_at'),
  ]);
  const firsts = (members || []).map(m => ({ user_id: m.user_id, first: (m.profile?.display_name || m.name || '').trim().split(/\s+/)[0] || 'Member' }));
  const all = [...new Set([...emails, ...(owners || []).map(o => o.mailbox_email)])].filter(Boolean);
  return new Map(mailboxLabels(all, new Map((owners || []).map(o => [o.mailbox_email, o.user_id])), firsts).map(m => [m.email, m.label]));
}
export function nameMailboxes(insights, labels) {
  if (!labels.size) return insights;
  const swap = text => (typeof text === 'string' ? [...labels].reduce((t, [email, label]) => t.split(email).join(label), text) : text);
  return insights.map(i => ({ ...i, title: swap(i.title), evidence: swap(i.evidence), cause: swap(i.cause), action: swap(i.action), affected: (i.affected || []).map(a => ({ ...a, label: swap(a.label) })) }));
}

// GET /insights - rules run fresh on every request from stored data only.
// Active dismissals (insight id + scope) are filtered out and counted.
export async function insightsRoute(req, res) {
  const supabase = getSupabase();
  const businessId = req.params.businessId;
  try {
    const input = await loadInsightInput(supabase, businessId);
    const { fired, suppressed } = computeInsights(input);
    const { data: dismissals, error } = await supabase.from('sales_insight_dismissals')
      .select('insight_id,scope_key,dismissed_until,dismissed_by').eq('business_id', businessId).gt('dismissed_until', new Date().toISOString());
    if (error) throw new Error(error.message);
    const isDismissed = i => dismissals.some(d => d.insight_id === i.id && d.scope_key === i.scope_key);
    const named = nameMailboxes(fired, await mailboxNames(supabase, businessId, input.mailboxes.map(m => m.email)));
    res.status(200).json({
      insights: named.filter(i => !isDismissed(i)),
      dismissed: named.filter(isDismissed).map(i => ({ id: i.id, scope_key: i.scope_key, title: i.title })),
      not_enough_data: suppressed,
      computed_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /insights/dismiss { insight_id, scope_key } - who = the signed-in user
export async function dismissInsightRoute(req, res) {
  const { insight_id, scope_key = '', ...rest } = req.body || {};
  if (Object.keys(rest).length) return res.status(400).json({ error: `unknown field: ${Object.keys(rest)[0]}` });
  if (typeof insight_id !== 'string' || !/^R\d{1,2}$/.test(insight_id)) return res.status(400).json({ error: 'insight_id must look like R1..R10' });
  if (typeof scope_key !== 'string' || scope_key.length > 200) return res.status(400).json({ error: 'scope_key must be a string' });
  const dismissedUntil = new Date(Date.now() + DISMISS_DAYS * 864e5).toISOString();
  const { data, error } = await getSupabase().from('sales_insight_dismissals')
    .insert({ business_id: req.params.businessId, insight_id, scope_key, dismissed_until: dismissedUntil, dismissed_by: req.auth.user.email })
    .select('insight_id,scope_key,dismissed_until,dismissed_by').single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ dismissal: data });
}
