import { selectAllPages } from '../lib/selectAllPages.js';
import { getSupabase } from './goalsShared.js';
import { mergePeople } from '../../src/constants/partnerPeople.js';
import { runSync } from './sync.js';

// partner-360-v1 Stage 1 - people at a partner. Mounted under
// /api/sales/:businessId (salesGate: GET = Viewer, writes = Member). The
// browser gets partner_contacts rows as they are (email included - it's
// shown as a mailto link); nothing here logs a row.

const NAME_MAX = 120, TITLE_MAX = 160, EMAIL_MAX = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LINKEDIN_RE = /^https?:\/\/([a-z0-9-]+\.)*linkedin\.com\//i;

async function partnerOr404(supabase, businessId, goalId, res) {
  const { data, error } = await supabase.from('sales_goals').select('id')
    .eq('business_id', businessId).eq('id', goalId).eq('goal_type', 'partnership').maybeSingle();
  if (error) { res.status(500).json({ error: error.message }); return null; }
  if (!data) { res.status(404).json({ error: 'partner not found' }); return null; }
  return data;
}

// GET /goals/partners/:id/people -> { people: partner_contacts rows }
export async function listPeopleRoute(req, res) {
  const supabase = getSupabase();
  if (!(await partnerOr404(supabase, req.params.businessId, req.params.id, res))) return;
  const { data, error } = await supabase.from('partner_contacts').select('*')
    .eq('business_id', req.params.businessId).eq('goal_id', req.params.id).order('name').order('id');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ people: data });
}

const text = (v, max, label) => {
  if (v == null || v === '') return { value: null };
  if (typeof v !== 'string') return { error: `${label} must be text` };
  const t = v.trim().replace(/\s+/g, ' ');
  if (t.length > max) return { error: `${label} must be at most ${max} characters` };
  return { value: t || null };
};

// POST /goals/partners/:id/people  body { name, title?, email?, linkedin_url? }
export async function addPersonRoute(req, res) {
  const supabase = getSupabase();
  if (!(await partnerOr404(supabase, req.params.businessId, req.params.id, res))) return;
  const b = req.body || {};
  const name = text(b.name, NAME_MAX, 'name'), title = text(b.title, TITLE_MAX, 'title'), email = text(b.email, EMAIL_MAX, 'email'), linkedin = text(b.linkedin_url, 500, 'linkedin_url');
  const bad = [name, title, email, linkedin].find(x => x.error);
  if (bad) return res.status(400).json({ error: bad.error });
  if (!name.value) return res.status(400).json({ error: 'name is required' });
  if (email.value && !EMAIL_RE.test(email.value)) return res.status(400).json({ error: 'email must look like name@company.com' });
  if (linkedin.value && !LINKEDIN_RE.test(linkedin.value)) return res.status(400).json({ error: 'linkedin_url must be a linkedin.com link' });
  const { data, error } = await supabase.from('partner_contacts').insert({
    business_id: req.params.businessId, goal_id: req.params.id, name: name.value, title: title.value,
    email: email.value ? email.value.toLowerCase() : null, linkedin_url: linkedin.value, source: 'manual', created_by: req.auth.user.id,
  }).select().single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'someone with that email is already listed on this partner' });
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json({ person: data });
}

// DELETE /goals/partners/:id/people/:personId - added people only; synced
// rows (Apollo / Outlook) would come back on the next sync.
export async function deletePersonRoute(req, res) {
  const supabase = getSupabase();
  if (!(await partnerOr404(supabase, req.params.businessId, req.params.id, res))) return;
  const { data: row, error: findErr } = await supabase.from('partner_contacts').select('id, source')
    .eq('business_id', req.params.businessId).eq('goal_id', req.params.id).eq('id', req.params.personId).maybeSingle();
  if (findErr) return res.status(500).json({ error: findErr.message });
  if (!row) return res.status(404).json({ error: 'person not found' });
  if (row.source !== 'manual') return res.status(400).json({ error: `this person came from ${row.source} - synced people can't be removed here` });
  const { error } = await supabase.from('partner_contacts').delete().eq('id', row.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}

// people_count for every partner in a list (the 👤 on the Workflow row):
// the same merge the drop-down shows, so the number matches the list.
export async function peopleCounts(supabase, businessId, goals) {
  const [contacts, events] = await Promise.all([
    selectAllPages(() => supabase.from('partner_contacts').select('id, goal_id, name, source').eq('business_id', businessId).order('id')),
    selectAllPages(() => supabase.from('sales_partner_events').select('id, goal_id, event, touch_type, contact_names, meta, at')
      .eq('business_id', businessId).in('event', ['touch', 'undo']).order('id')),
  ]);
  const group = rows => { const m = new Map(); for (const r of rows) { if (!m.has(r.goal_id)) m.set(r.goal_id, []); m.get(r.goal_id).push(r); } return m; };
  const cByGoal = group(contacts), eByGoal = group(events);
  return Object.fromEntries(goals.map(g => [g.id, mergePeople({ contacts: cByGoal.get(g.id) || [], events: eByGoal.get(g.id) || [], knownContacts: g.known_contacts }).length]));
}

// POST /goals/partners/refresh-people - a Sync now with the partner-people
// step forced on (it otherwise runs once per LA day). Same cooldown and
// daily max as Sync now, and every Apollo call lands on the run row.
export async function refreshPeopleRoute(req, res) {
  try {
    const result = await runSync({ businessId: req.params.businessId, trigger: 'manual', partnerPeople: 'force' });
    if (result.refused) return res.status(429).json({ error: result.reason });
    if (result.error) return res.status(500).json({ error: result.error });
    res.json({ run: result.run, partner_contacts: result.run?.counts?.partner_contacts || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
