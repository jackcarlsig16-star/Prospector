import { createHash } from 'crypto';
import { getSupabase, isDate, addDays } from './goalsShared.js';
import { LINKABLE_METRICS } from './goalsRoutes.js';
import { laDateString } from './laDate.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { callAnthropic } from '../businesses/shared.js';
import { MODELS, estimateCostUsd } from '../../src/config/models.js';

// call-notes-to-tasks-v1 - pasted internal call notes -> proposed Goals
// to-dos. Extract writes nothing but the AI usage row; the notes text is
// never logged.

const MAX_CHARS = 120000;
const MAX_TASKS = 30;
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

async function context(supabase, businessId, today) {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const week = addDays(today, -((dow + 6) % 7));
  const [members, partners, commitments, companies] = await Promise.all([
    supabase.from('business_members').select('user_id, name, profile:profiles!business_members_user_id_fkey(display_name)')
      .eq('business_id', businessId).not('user_id', 'is', null),
    supabase.from('sales_goals').select('id, name').eq('business_id', businessId).eq('goal_type', 'partnership').is('archived_at', null),
    supabase.from('sales_week_goals').select('id, text').eq('business_id', businessId).eq('kind', 'commitment').eq('week_start', week).neq('status', 'dropped'),
    selectAllPages(() => supabase.from('sales_sequenced_accounts').select('account_id, name').eq('business_id', businessId).order('account_id')),
  ]);
  for (const r of [members, partners, commitments]) if (r.error) throw new Error(r.error.message);
  return {
    members: members.data.map(m => ({ id: m.user_id, name: m.profile?.display_name || m.name })),
    partners: partners.data, commitments: commitments.data, companies: companies.filter(c => c.name),
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
      steps: (Array.isArray(t.steps) ? t.steps : []).map(s => clean(s, 200)).filter(Boolean).slice(0, 10),
      evidence: clean(t.evidence, 200),
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
      call_date: callDate, hash: noteHash(text), ...toProposals(raw, ctx),
      usage: { model, input_tokens: data.usage?.input_tokens ?? null, output_tokens: data.usage?.output_tokens ?? null, cost_usd: estimateCostUsd(model, data.usage) },
    });
  } catch (e) {
    console.error('[call-notes/extract]', e.message);
    res.status(500).json({ error: e.message });
  }
}
