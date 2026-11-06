import { getSupabase } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { mailboxLabels } from './explorerRoutes.js';

// dashboard-v3 Stage 4 (M, A6) - GET goals/sequence-steps: per sequence, the lifetime per-step rows summed over every
// day of sales_email_daily_counts (mailbox × sequence × step), the sender named by the mailbox owner (never the
// address), and `own`: HomeLover's own sequence = every mailbox it sent from is one the workspace owns
// (sales_mailbox_owners); anything sent from another mailbox in the shared Apollo org (Brad's) is not own and the
// Sequences table leaves it out. A sequence with no stored sends is own (nothing says otherwise).
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const rate = (n, d) => (d ? n / d : null);
const FIELDS = ['delivered', 'hard_bounced', 'spam_blocked', 'opened', 'replied'];

export function buildSequenceSteps(rows, { owned = new Set(), labels = new Map() } = {}) {
  const bySeq = new Map();
  for (const r of rows) {
    if (!r.sequence_id) continue;
    if (!bySeq.has(r.sequence_id)) bySeq.set(r.sequence_id, { steps: new Map(), mailboxes: new Map() });
    const s = bySeq.get(r.sequence_id);
    const step = r.step == null ? 0 : r.step;
    if (!s.steps.has(step)) s.steps.set(step, Object.fromEntries(FIELDS.map(f => [f, 0])));
    const t = s.steps.get(step);
    for (const f of FIELDS) t[f] += r[f] || 0;
    s.mailboxes.set(r.mailbox, (s.mailboxes.get(r.mailbox) || 0) + (r.delivered || 0) + (r.hard_bounced || 0) + (r.spam_blocked || 0));
  }
  const sequences = {};
  const totals = { messages: 0, delivered: 0 };
  for (const [id, s] of bySeq) {
    const steps = [...s.steps].sort((a, b) => a[0] - b[0]).map(([step, t]) => {
      const messages = t.delivered + t.hard_bounced + t.spam_blocked;
      return { step, messages, ...t, open_rate: rate(t.opened, t.delivered), reply_rate: rate(t.replied, t.delivered), bounce_rate: rate(t.hard_bounced + t.spam_blocked, messages) };
    });
    const mailboxes = [...s.mailboxes].sort((a, b) => b[1] - a[1]).map(([email]) => email);
    const own = mailboxes.every(e => owned.has(e));
    const messages = steps.reduce((n, x) => n + x.messages, 0), delivered = steps.reduce((n, x) => n + x.delivered, 0);
    sequences[id] = { own, sender_label: mailboxes.length ? labels.get(mailboxes[0]) || 'Mailbox' : null, mailboxes: mailboxes.map(e => labels.get(e) || 'Mailbox'), messages, delivered, steps };
    if (own) { totals.messages += messages; totals.delivered += delivered; }
  }
  return { sequences, totals };
}

export async function sequenceStepsRoute(req, res) {
  const supabase = getSupabase();
  const businessId = req.params.businessId;
  try {
    const [rows, owners, members] = await Promise.all([
      selectAllPages(() => supabase.from('sales_email_daily_counts').select('day, mailbox, sequence_id, step, delivered, hard_bounced, spam_blocked, opened, replied')
        .eq('business_id', businessId).order('day').order('mailbox').order('sequence_id').order('step')),
      must(await supabase.from('sales_mailbox_owners').select('mailbox_email, user_id').eq('business_id', businessId)),
      supabase.from('business_members').select('user_id, name, profile:profiles!business_members_user_id_fkey(display_name)').eq('business_id', businessId).not('user_id', 'is', null).order('created_at').then(must),
    ]);
    const ownerOf = new Map(owners.map(o => [o.mailbox_email, o.user_id]));
    const firsts = members.map(m => ({ user_id: m.user_id, first: (m.profile?.display_name || m.name || '').trim().split(/\s+/)[0] || 'Member' }));
    const labels = new Map(mailboxLabels([...new Set(rows.map(r => r.mailbox))].filter(Boolean), ownerOf, firsts).map(m => [m.email, m.label]));
    res.json(buildSequenceSteps(rows, { owned: new Set(owners.map(o => o.mailbox_email)), labels }));
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}
