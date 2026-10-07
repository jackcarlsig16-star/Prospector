import { createHash } from 'crypto';
import { getSupabase, isDate, addDays, validate, fail, weekIsFinal, FINAL_ERROR } from './goalsShared.js';
import { LINKABLE_METRICS, WEEK_FIELDS, checkLink } from './goalsRoutes.js';
import { hasRole } from '../lib/requireAuth.js';
import { laDateString } from './laDate.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { callAnthropic } from '../businesses/shared.js';
import { MODELS, estimateCostUsd } from '../../src/config/models.js';

// call-notes-to-tasks-v1 - pasted internal call notes -> proposed Goals
// to-dos -> the ones the person kept, created this week with a back-link to
// the stored note. Extract writes nothing but the AI usage row; the notes
// text is never logged.

const MAX_CHARS = 120000;
const MAX_TASKS = 30;
const MAX_STEPS = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TASK_FIELDS = Object.fromEntries(['text', 'owner_user_id', 'due_date', 'link_type', 'link_id'].map(k => [k, WEEK_FIELDS[k]]));
const SIMILAR_WEEKS = 4;
const PHONE = /(?:\+?\d[\d\s().-]{7,}\d)/g;

const clean = (v, max) => (typeof v === 'string' ? v.replace(PHONE, '[number removed]').replace(/\s+/g, ' ').trim().slice(0, max) : '');
export const noteHash = text => createHash('sha256').update(text.replace(/\s+/g, ' ').trim().toLowerCase()).digest('hex');

const SYSTEM = `You turn an internal sales team call's notes (an AI meeting summary, a transcript, or typed notes) into to-dos for a shared task list.

Rules:
- One task per concrete action someone committed to or was asked to do. Skip discussion, opinions and status updates with no action. Merge duplicates. Related small actions under one topic become steps of one task.
- Task text: imperative, under 15 words, names the company/partner if there is one.
- owner: the name of the person the notes say will do it, exactly as written ("Seif", "Jack") - from "X will...", "X to...", an action-item list under X's name. Give the name even when that person is not in MEMBERS; never swap in a member for someone else. null when the notes don't say who, or only say "I"/"we". Never guess from who talks most.
- due_date: YYYY-MM-DD only when a deadline is stated ("by Friday", "next Tuesday", "Oct 12"); resolve relative days from CALL DATE. Otherwise null. Never invent one.
- link: at most one thing the task serves, only from the lists given: {"type":"partner","id":...} from PARTNERS, {"type":"commitment","id":...} from COMMITMENTS, {"type":"metric","id":...} from METRICS. If the task is about a prospect company not in those lists, set company_name to the company's name as written instead. Otherwise null.
- evidence: the shortest phrase from the notes that shows the action (max 20 words).
- Never include phone numbers.
- summary: exactly 3 short lines on what the call decided.

Reply with JSON only, no prose:
{"summary":["","",""],"tasks":[{"text":"","owner":null,"due_date":null,"link":null,"company_name":null,"steps":[],"evidence":""}]}`;

const weekOf = day => addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));
const md = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
export const callCategory = (callDate, title) => ['From calls', md(callDate), title].filter(Boolean).join(' · ');

async function context(supabase, businessId, today) {
  const week = weekOf(today);
  const [members, partners, commitments, recent, companies] = await Promise.all([
    supabase.from('business_members').select('user_id, name, profile:profiles!business_members_user_id_fkey(display_name)')
      .eq('business_id', businessId).not('user_id', 'is', null),
    supabase.from('sales_goals').select('id, name').eq('business_id', businessId).eq('goal_type', 'partnership').is('archived_at', null),
    supabase.from('sales_week_goals').select('id, text').eq('business_id', businessId).eq('kind', 'commitment').eq('week_start', week).neq('status', 'dropped'),
    supabase.from('sales_week_goals').select('id, text').eq('business_id', businessId).eq('kind', 'todo').not('source_note_id', 'is', null)
      .gte('week_start', addDays(week, -7 * SIMILAR_WEEKS)).neq('status', 'dropped').limit(500),
    selectAllPages(() => supabase.from('sales_sequenced_accounts').select('account_id, name').eq('business_id', businessId).order('account_id')),
  ]);
  for (const r of [members, partners, commitments, recent]) if (r.error) throw new Error(r.error.message);
  return {
    members: members.data.map(m => ({ id: m.user_id, name: m.profile?.display_name || m.name })),
    partners: partners.data, commitments: commitments.data, companies: companies.filter(c => c.name), recent: recent.data,
  };
}

const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(inc|llc|ltd|corp|co|the)\b/g, '').trim();
function matchCompany(name, companies) {
  const n = norm(name || '');
  if (n.length < 3) return null;
  const exact = companies.filter(c => norm(c.name) === n);
  if (exact.length === 1) return exact[0];
  const partial = companies.filter(c => { const cn = norm(c.name); return cn.length >= 3 && (cn.includes(n) || n.includes(cn)); });
  return partial.length === 1 ? partial[0] : null;
}

// Same action from an earlier call: most words in common, counted against
// the longer of the two so a short task can't match a long one by subset.
const STOP = new Set(['a', 'an', 'and', 'to', 'of', 'for', 'with', 'on', 'in', 'at', 'by', 'about', 'from', 'up']);
const taskWords = s => new Set(norm(s).split(' ').filter(w => w.length > 1 && !STOP.has(w)));
export function similarTask(text, existing) {
  const a = taskWords(text);
  let best = null, score = 0;
  for (const t of existing) {
    const b = taskWords(t.text);
    const s = [...a].filter(w => b.has(w)).length / Math.max(a.size, b.size, 1);
    if (s > score) { best = t; score = s; }
  }
  return score >= 0.6 ? { id: best.id, text: best.text } : null;
}

// The model names the owner; the server picks the member. Every word of the
// name must be in exactly one member's name, starting with their first name,
// so someone outside the workspace (Seif) comes back Unassigned instead of
// landing on the nearest member.
const nameWords = s => (typeof s === 'string' ? s.toLowerCase().replace(/[^a-z\s'-]/g, ' ').split(/\s+/).filter(Boolean) : []);
export function matchOwner(name, members) {
  const w = nameWords(name);
  if (!w.length) return null;
  const hits = members.filter(m => { const mw = nameWords(m.name); return mw[0] === w[0] && w.every(x => mw.includes(x)); });
  return hits.length === 1 ? hits[0].id : null;
}

// Everything the model returns is checked against this workspace; anything
// that doesn't resolve is dropped to blank rather than trusted.
export function toProposals(raw, ctx) {
  const ids = { partner: new Set(ctx.partners.map(p => p.id)), commitment: new Set(ctx.commitments.map(c => c.id)), metric: new Set(LINKABLE_METRICS) };
  const tasks = (Array.isArray(raw?.tasks) ? raw.tasks : []).slice(0, MAX_TASKS).map(t => {
    const text = clean(t?.text, 300);
    if (!text) return null;
    let link = null;
    if (t.link && ids[t.link.type]?.has(t.link.id)) link = { type: t.link.type, id: t.link.id };
    else if (t.company_name) { const c = matchCompany(t.company_name, ctx.companies); if (c) link = { type: 'company', id: c.account_id }; }
    return {
      text,
      owner_user_id: matchOwner(t.owner, ctx.members),
      due_date: isDate(t.due_date) ? t.due_date : null,
      link_type: link?.type || null, link_id: link?.id || null,
      company_name: link ? null : clean(t.company_name, 120) || null,
      steps: (Array.isArray(t.steps) ? t.steps : []).map(s => clean(s, 200)).filter(Boolean).slice(0, MAX_STEPS),
      evidence: clean(t.evidence, 200),
      similar_to: similarTask(text, ctx.recent || []),
    };
  }).filter(Boolean);
  const summary = (Array.isArray(raw?.summary) ? raw.summary : []).map(s => clean(s, 240)).filter(Boolean).slice(0, 3);
  return { summary, tasks };
}

// POST /goals/call-notes/extract { text, call_date?, title? } -> proposals.
export async function extractCallNotesRoute(req, res) {
  const { text, call_date, title } = req.body || {};
  if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'text is required' });
  if (text.length > MAX_CHARS) return res.status(413).json({ error: `notes are too long (${text.length} characters, max ${MAX_CHARS})` });
  if (call_date != null && !isDate(call_date)) return res.status(400).json({ error: 'call_date must be YYYY-MM-DD' });
  const businessId = req.params.businessId;
  const callDate = call_date || laDateString();
  const supabase = getSupabase();
  try {
    const hash = noteHash(text);
    const earlier = await findNote(supabase, businessId, hash);
    if (earlier) return res.json({ duplicate: earlier });
    const ctx = await context(supabase, businessId, laDateString());
    const lists = [
      `CALL DATE: ${callDate}`, title ? `CALL TITLE: ${clean(title, 200)}` : '',
      `MEMBERS: ${JSON.stringify(ctx.members.map(m => m.name))}`,
      `PARTNERS: ${JSON.stringify(ctx.partners.map(p => ({ id: p.id, name: p.name })))}`,
      `COMMITMENTS: ${JSON.stringify(ctx.commitments)}`,
      `METRICS: ${JSON.stringify(LINKABLE_METRICS)}`,
    ].filter(Boolean).join('\n');
    const model = MODELS.STANDARD;
    const data = await callAnthropic({
      system: SYSTEM, model, max_tokens: 4096, thinking: false, timeoutMs: 90000,
      messages: [{ role: 'user', content: `${lists}\n\n<notes>\n${text}\n</notes>` }],
      supabase, businessId, userId: req.auth.user.id, callType: 'call_tasks',
    });
    if (data.stop_reason === 'max_tokens') return res.status(502).json({ error: 'The notes produced more tasks than fit in one pass - split them and try again' });
    const out = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const json = out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1);
    let raw;
    try { raw = JSON.parse(json); } catch { return res.status(502).json({ error: 'Could not read the AI reply - try again' }); }
    res.json({
      call_date: callDate, hash, ...toProposals(raw, ctx),
      usage: { model, input_tokens: data.usage?.input_tokens ?? null, output_tokens: data.usage?.output_tokens ?? null, cost_usd: estimateCostUsd(model, data.usage) },
    });
  } catch (e) {
    console.error('[call-notes/extract]', e.message);
    res.status(500).json({ error: e.message });
  }
}

// The same notes pasted again (by hash) -> the earlier note and how many
// to-dos came from it, instead of a second AI call or a second set of tasks.
async function findNote(supabase, businessId, hash) {
  const { data, error } = await supabase.from('sales_call_notes').select('id, title, call_date, created_at')
    .eq('business_id', businessId).eq('hash', hash).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const { count, error: countErr } = await supabase.from('sales_week_goals').select('id', { count: 'exact', head: true })
    .eq('business_id', businessId).eq('source_note_id', data.id);
  if (countErr) throw new Error(countErr.message);
  return { ...data, task_count: count };
}

// POST /goals/call-notes { text, title?, call_date, tasks: [{ text, owner_user_id,
// due_date, link_type, link_id, steps: [text] }] } - stores the note and creates
// the reviewed to-dos in this week, category "From calls · <date> · <title>".
export async function createFromCallNotesRoute(req, res) {
  const { text, title, call_date, tasks } = req.body || {};
  if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'text is required' });
  if (text.length > MAX_CHARS) return res.status(413).json({ error: `notes are too long (${text.length} characters, max ${MAX_CHARS})` });
  if (!isDate(call_date)) return res.status(400).json({ error: 'call_date must be YYYY-MM-DD' });
  if (title != null && typeof title !== 'string') return res.status(400).json({ error: 'title must be text' });
  if (!Array.isArray(tasks) || !tasks.length || tasks.length > MAX_TASKS) return res.status(400).json({ error: `tasks must be a list of 1-${MAX_TASKS}` });
  const businessId = req.params.businessId;
  const userId = req.auth.user.id;
  const supabase = getSupabase();
  try {
    const rows = [];
    for (const [i, t] of tasks.entries()) {
      const { steps = [], ...fields } = t || {};
      if (!Array.isArray(steps) || steps.length > MAX_STEPS || !steps.every(s => typeof s === 'string' && s.trim())) {
        return res.status(400).json({ error: `task ${i + 1}: steps must be up to ${MAX_STEPS} non-empty lines` });
      }
      const v = await validate(supabase, businessId, TASK_FIELDS, fields);
      if (v.error) return fail(res, { ...v, error: `task ${i + 1}: ${v.error}` });
      if (!v.payload.text) return res.status(400).json({ error: `task ${i + 1}: text is required` });
      const linkErr = await checkLink(supabase, businessId, { kind: 'todo', ...v.payload }, null);
      if (linkErr) return fail(res, { ...linkErr, error: `task ${i + 1}: ${linkErr.error}` });
      rows.push({ payload: v.payload, steps: steps.map(s => s.trim()) });
    }
    const week = weekOf(laDateString());
    if (await weekIsFinal(supabase, businessId, week)) return res.status(409).json({ error: FINAL_ERROR });

    const hash = noteHash(text);
    const { data: note, error: noteErr } = await supabase.from('sales_call_notes')
      .insert({ business_id: businessId, title: title?.trim() || null, call_date, text, hash, created_by: userId })
      .select('id, title, call_date, created_at').single();
    if (noteErr?.code === '23505') return res.status(409).json({ error: 'These notes were already turned into tasks', duplicate: await findNote(supabase, businessId, hash) });
    if (noteErr) throw new Error(noteErr.message);

    // No transaction across the three inserts, so a failure removes what this
    // call already wrote - re-pasting the notes must then work.
    const undo = async goalIds => {
      if (goalIds?.length) await supabase.from('sales_week_goals').delete().in('id', goalIds);
      await supabase.from('sales_call_notes').delete().eq('id', note.id);
    };
    const category = callCategory(call_date, note.title);
    const { data: goals, error: goalErr } = await supabase.from('sales_week_goals').insert(rows.map((r, i) => ({
      business_id: businessId, week_start: week, kind: 'todo', status: 'open', ...r.payload,
      category, source_note_id: note.id, sort_order: i, created_by: userId,
    }))).select();
    if (goalErr) { await undo(); throw new Error(goalErr.message); }
    goals.sort((a, b) => a.sort_order - b.sort_order);
    const steps = rows.flatMap((r, i) => r.steps.map((s, n) => ({ business_id: businessId, goal_id: goals[i].id, text: s, sort_order: n })));
    if (steps.length) {
      const { error: stepErr } = await supabase.from('sales_week_goal_steps').insert(steps);
      if (stepErr) { await undo(goals.map(g => g.id)); throw new Error(stepErr.message); }
    }
    res.status(201).json({ note, goals });
  } catch (e) {
    console.error('[call-notes/create]', e.message);
    res.status(500).json({ error: e.message });
  }
}

// GET /goals/call-notes/:id - the source note behind a to-do. Members only:
// a Viewer sees the to-do but not the call text.
export async function getCallNoteRoute(req, res) {
  const businessId = req.params.businessId;
  if (!hasRole(req, businessId, 'member')) return res.status(403).json({ error: 'Call notes are visible to members only' });
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'note not found' });
  const { data, error } = await getSupabase().from('sales_call_notes').select('id, title, call_date, text, created_by, created_at')
    .eq('business_id', businessId).eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'note not found' });
  res.json({ note: data });
}
