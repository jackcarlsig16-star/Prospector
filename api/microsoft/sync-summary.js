import { getServiceSupabase } from '../lib/authUser.js';
import { hasRole } from '../lib/requireAuth.js';
import { FOLDERS } from './graphSync.js';
import { gate } from './sync.js';

// GET /api/microsoft/sync-summary - what Stage 2 holds for the caller's own
// mailbox: counts, the earliest item, each folder's last run. Counts only.
export default async function handler(req, res) {
  const target = await gate(req, res, 'viewer');
  if (!target) return;
  const supabase = getServiceSupabase();
  const userId = req.auth.user.id;
  const count = (table, extra = q => q) => extra(supabase.from(table).select('id', { count: 'exact', head: true }).eq('user_id', userId)).then(r => r.count || 0);
  const earliest = (table, col) => supabase.from(table).select(col).eq('user_id', userId).order(col, { ascending: true }).limit(1).maybeSingle().then(r => r.data?.[col] || null);
  const [sent, received, events, firstMessage, firstEvent, states, runs] = await Promise.all([
    count('microsoft_messages', q => q.eq('direction', 'sent')),
    count('microsoft_messages', q => q.eq('direction', 'received')),
    count('microsoft_events'),
    earliest('microsoft_messages', 'occurred_at'),
    earliest('microsoft_events', 'start_at'),
    supabase.from('microsoft_sync_state').select('folder, last_synced_at, delta_link').eq('user_id', userId).then(r => r.data || []),
    supabase.from('microsoft_sync_runs').select('folder, trigger, dry_run, pages, seen, stored, skipped_draft, skipped_internal, skipped_personal, capped, error, started_at, finished_at')
      .eq('user_id', userId).order('started_at', { ascending: false }).limit(12).then(r => r.data || []),
  ]);
  const lastRun = Object.fromEntries(FOLDERS.map(f => [f, runs.find(r => r.folder === f) || null]));
  const synced = states.map(s => s.last_synced_at).filter(Boolean).sort();
  res.json({
    mailbox: target.mailbox, business_id: target.businessId, can_sync: hasRole(req, target.businessId, 'member'),
    sent, received, events, since: firstMessage, first_event: firstEvent,
    last_synced_at: synced.length ? synced[synced.length - 1] : null,
    pending: states.filter(s => s.delta_link && /skiptoken/i.test(s.delta_link)).map(s => s.folder),
    last_run: lastRun,
  });
}
