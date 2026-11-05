import { getSupabase, addDays, laStartOfDayMs, isDate } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { laDateString } from './laDate.js';
import { cleanText } from './scrubText.js';
import { loadPartnerData, peopleFirstTouched } from './partnerMetrics.js';
import { memberColors } from './memberColors.js';
import { readAllViews, writeAllViews, SAVED_VIEWS_MAX } from './scoresRoutes.js';
import { LAYERS, LAYER_IDS, SPLITS, BY, MAX_DAYS, HOME_LAYERS, defaultRange, buildExplorer } from './explorerMath.js';

// dashboard-v3 Stage 3 - GET goals/explorer?layers=&by=week|day&split=team|person|mailbox|sequence|cohort&from=&to=
// (A1): the Explorer's one read, assembled from stored rows (0 Apollo, 0 Claude, nothing written), cached CACHE_MS per
// workspace + params. Mailboxes are labelled by their owner's first name (several: "Jack 1", "Jack 2"), never the
// address. Saved views live beside the Map's in sales_settings.saved_views, keyed kind: 'explorer' (Members; Viewers read).
export const CACHE_MS = 5 * 60e3;
const cache = new Map();
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };

export function parseExplorerQuery(q = {}, today = laDateString()) {
  const layers = String(q.layers || HOME_LAYERS.join(',')).split(',').map(s => s.trim()).filter(Boolean);
  const bad = layers.find(l => !LAYER_IDS.includes(l));
  if (bad) return { error: `unknown layer ${bad}` };
  if (!layers.length) return { error: 'layers is required' };
  const by = q.by || 'week', split = q.split || 'team';
  if (!BY.includes(by)) return { error: `by must be ${BY.join('|')}` };
  if (!SPLITS.includes(split)) return { error: `split must be ${SPLITS.join('|')}` };
  const def = defaultRange(today);
  const from = q.from || def.from, to = q.to || def.to;
  if (!isDate(from) || !isDate(to)) return { error: 'from / to must be YYYY-MM-DD' };
  if (from > to) return { error: 'from must not be after to' };
  if (to > today) return { error: 'to must not be after today' };
  if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5 > MAX_DAYS) return { error: `at most ${MAX_DAYS} days` };
  return { layers: [...new Set(layers)].sort((a, b) => LAYER_IDS.indexOf(a) - LAYER_IDS.indexOf(b)), by, split, from, to };
}

async function membersOf(supabase, businessId) {
  const rows = must(await supabase.from('business_members').select('user_id, name, created_at, profile:profiles!business_members_user_id_fkey(display_name)')
    .eq('business_id', businessId).not('user_id', 'is', null).order('created_at'));
  const colors = await memberColors(supabase, businessId);
  return rows.map(m => { const name = m.profile?.display_name || m.name || ''; return { user_id: m.user_id, first: name.trim().split(/\s+/)[0] || 'Member', color: colors.get(m.user_id) || '#6B7480' }; });
}

// Mailbox labels: owner's first name (+ 1, 2 when they own several), "Mailbox n" when nobody does.
export function mailboxLabels(mailboxes, owners, members) {
  const first = new Map(members.map(m => [m.user_id, m.first]));
  const byOwner = new Map();
  const out = [];
  let unowned = 0;
  for (const email of [...mailboxes].sort()) {
    const uid = owners.get(email);
    const name = uid && first.get(uid);
    if (!name) { unowned += 1; out.push({ email, label: `Mailbox ${unowned}` }); continue; }
    const n = (byOwner.get(uid) || 0) + 1; byOwner.set(uid, n);
    out.push({ email, label: name, n });
  }
  for (const m of out) if (m.n && (byOwner.get(owners.get(m.email)) || 0) > 1) m.label = `${m.label} ${m.n}`;
  return out.map(({ email, label }) => ({ email, label }));
}

export async function loadExplorer(supabase, businessId, p, now = new Date()) {
  const today = laDateString(now);
  const { layers, by, split, from, to } = p;
  const fromIso = new Date(laStartOfDayMs(from)).toISOString(), toIso = new Date(laStartOfDayMs(addDays(to, 1))).toISOString();
  const email = layers.some(l => LAYERS[l].group === 'email');
  const [counts, opens, events, visits, partnerData, members, owners, seqSnap, firstPullRows] = await Promise.all([
    email ? selectAllPages(() => supabase.from('sales_email_daily_counts').select('day, mailbox, sequence_id, delivered, hard_bounced, spam_blocked, opened, replied')
      .eq('business_id', businessId).gte('day', from).lte('day', to).order('day').order('mailbox').order('sequence_id').order('step')) : [],
    layers.includes('human_open_rate') ? selectAllPages(() => supabase.from('sales_email_activity').select('id, apollo_message_id, sender, sequence_id, occurred_at, user_agent, tracking_service')
      .eq('business_id', businessId).eq('event', 'open').gte('occurred_at', fromIso).lt('occurred_at', toIso).order('id')) : [],
    layers.includes('meetings') ? selectAllPages(() => supabase.from('microsoft_events').select('id, graph_id, ical_uid, user_id, external_domains, start_at, is_cancelled, created_at_graph').eq('business_id', businessId).order('start_at').order('id')) : [],
    layers.includes('visitors') ? selectAllPages(() => supabase.from('web_visits').select('id, pulled_on, company_key').eq('business_id', businessId).gte('pulled_on', from).lte('pulled_on', to).order('id')) : [],
    layers.includes('first_touched') ? loadPartnerData(supabase, businessId) : null,
    membersOf(supabase, businessId),
    email ? must(await supabase.from('sales_mailbox_owners').select('mailbox_email, user_id').eq('business_id', businessId)) : [],
    email ? supabase.from('sales_raw_snapshots').select('payload').eq('business_id', businessId).eq('entity', 'sequences').order('captured_at', { ascending: false }).limit(1).maybeSingle().then(must) : null,
    layers.includes('visitors') ? supabase.from('web_visits').select('pulled_on').eq('business_id', businessId).order('pulled_on').limit(1).then(must) : [],
  ]);
  const ids = [...new Set(opens.map(o => o.apollo_message_id))];
  const msgs = ids.length ? await selectAllPages(() => supabase.from('sales_email_messages').select('apollo_message_id, delivered_at').eq('business_id', businessId).in('apollo_message_id', ids).order('apollo_message_id')) : [];
  const ownerOf = new Map(owners.map(o => [o.mailbox_email, o.user_id]));
  const people = partnerData ? (() => { const ownerByGoal = new Map(partnerData.partners.map(x => [x.id, x.owner_user_id || null])); return peopleFirstTouched(partnerData, null).map(x => ({ ...x, owner_user_id: ownerByGoal.get(x.goal_id) || null })); })() : [];
  return buildExplorer({
    layers, by, split, from, to, today, counts, opens, deliveredAt: new Map(msgs.map(m => [m.apollo_message_id, m.delivered_at])), events, visits, people, members,
    mailboxOwner: ownerOf, mailboxes: mailboxLabels([...new Set(counts.map(r => r.mailbox))], ownerOf, members),
    sequences: (seqSnap?.payload || []).map(s => ({ id: String(s.id), name: s.name || 'Sequence', cohort: s.cohort || null })),
    firstPull: firstPullRows?.[0]?.pulled_on || null,
  });
}

export async function explorerRoute(req, res) {
  const p = parseExplorerQuery(req.query);
  if (p.error) return res.status(400).json({ error: p.error });
  const key = `${req.params.businessId}|${p.layers.join(',')}|${p.by}|${p.split}|${p.from}|${p.to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return res.json({ ...hit.body, cached_at: new Date(hit.at).toISOString() });
  try {
    const body = await loadExplorer(getSupabase(), req.params.businessId, p);
    cache.set(key, { at: Date.now(), body });
    res.json({ ...body, cached_at: null });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}
export const clearExplorerCache = () => cache.clear();

// Saved views: { id, kind: 'explorer', name, state: { layers, show, by, split, height }, created_by, created_at }.
const SHOWS = ['lines', 'columns', 'table'], HEIGHTS = ['compact', 'standard', 'tall'];
export function cleanState(s = {}) {
  const layers = (Array.isArray(s.layers) ? s.layers : []).map(String).filter(l => LAYER_IDS.includes(l));
  return {
    layers: layers.length ? [...new Set(layers)] : HOME_LAYERS,
    show: SHOWS.includes(s.show) ? s.show : 'lines', by: BY.includes(s.by) ? s.by : 'week', split: SPLITS.includes(s.split) ? s.split : 'team', height: HEIGHTS.includes(s.height) ? s.height : 'standard',
  };
}
export async function listExplorerViewsRoute(req, res) {
  try { res.json({ views: (await readAllViews(getSupabase(), req.params.businessId)).filter(v => v.kind === 'explorer') }); } catch (e) { res.status(500).json({ error: e.message }); }
}
export async function saveExplorerViewRoute(req, res) {
  const name = cleanText(String(req.body?.name || ''), 60);
  if (!name) return res.status(400).json({ error: 'name is required (up to 60 characters)' });
  try {
    const supabase = getSupabase();
    const all = await readAllViews(supabase, req.params.businessId);
    const mine = all.filter(v => v.kind === 'explorer');
    if (all.length >= SAVED_VIEWS_MAX && !mine.some(v => v.name === name)) return res.status(409).json({ error: `At most ${SAVED_VIEWS_MAX} saved views - delete one first` });
    const entry = { id: mine.find(v => v.name === name)?.id || `v_${Math.random().toString(36).slice(2, 10)}`, kind: 'explorer', name, state: cleanState(req.body?.state), created_by: req.auth.user.id, created_at: new Date().toISOString() };
    const views = [...all.filter(v => !(v.kind === 'explorer' && v.name === name)), entry];
    await writeAllViews(supabase, req.params.businessId, views);
    res.status(201).json({ view: entry, views: views.filter(v => v.kind === 'explorer') });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
export async function deleteExplorerViewRoute(req, res) {
  try {
    const supabase = getSupabase();
    const all = await readAllViews(supabase, req.params.businessId);
    if (!all.some(v => v.kind === 'explorer' && v.id === req.params.id)) return res.status(404).json({ error: 'view not found' });
    const views = all.filter(v => v.id !== req.params.id);
    await writeAllViews(supabase, req.params.businessId, views);
    res.json({ views: views.filter(v => v.kind === 'explorer') });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
