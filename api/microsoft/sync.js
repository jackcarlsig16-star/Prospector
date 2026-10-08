import { getServiceSupabase } from '../lib/authUser.js';
import { hasRole } from '../lib/requireAuth.js';
import { isAllowlistedBusiness } from '../sales/allowlist.js';
import { resolveMailbox, runOutlookSync } from './graphSync.js';

// Both routes act on the caller's own mailbox only. The workspace comes from
// the mailbox owner map; it must have sales analytics on (the data feeds the
// Goals / Partners module) and the caller needs minRole there (summary =
// viewer, sync = member, like every sales route).
export async function gate(req, res, minRole = 'member') {
  const target = await resolveMailbox(getServiceSupabase(), req.auth.user.id);
  if (target.refused === 'needs_microsoft') { res.status(409).json({ error: target.message, needs_microsoft: true }); return null; }
  if (target.refused) { res.status(409).json({ error: target.message, refused: target.refused }); return null; }
  if (!isAllowlistedBusiness(target.businessId)) { res.status(403).json({ error: 'Sales analytics is not enabled for this workspace' }); return null; }
  if (!hasRole(req, target.businessId, minRole)) { res.status(403).json({ error: `You need ${minRole} access to this workspace` }); return null; }
  return target;
}

// POST /api/microsoft/sync[?dry_run=1] - read the caller's Outlook into the
// Stage 2 tables. dry_run counts what a real run would keep and stores nothing
// but the run row.
export default async function handler(req, res) {
  const target = await gate(req, res);
  if (!target) return;
  const dryRun = ['1', 'true'].includes(String(req.query.dry_run || req.body?.dry_run || ''));
  try {
    const result = await runOutlookSync({ userId: req.auth.user.id, businessId: target.businessId, trigger: 'manual', dryRun });
    if (result.refused) return res.status(409).json({ error: result.message, refused: result.refused });
    res.json(result);
  } catch (err) {
    if (err.constructor?.name === 'NeedsMicrosoft') return res.status(409).json({ error: err.message, needs_microsoft: true });
    console.error('[microsoft/sync]', err.message);
    res.status(500).json({ error: err.message });
  }
}
