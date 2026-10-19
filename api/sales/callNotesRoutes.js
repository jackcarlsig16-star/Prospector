import { createHash } from 'crypto';
import { getSupabase, isDate, addDays, validate, fail, weekIsFinal, FINAL_ERROR } from './goalsShared.js';
import { LINKABLE_METRICS, WEEK_FIELDS, checkLink } from './goalsRoutes.js';
import { hasRole } from '../lib/requireAuth.js';
import { laDateString } from './laDate.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { callAnthropic } from '../businesses/shared.js';
import { MODELS, estimateCostUsd } from '../../src/config/models.js';
import { cleanText as clean } from './scrubText.js';
import { toIntake, enrichIntake, matchOwner, MAX_ITEMS } from './intakeMatch.js';
import { acceptIntake, parseIntake } from './intakeAccept.js';
import { scrubExtract, signExtract, extractIfSigned, recentAccepts } from './intakeDeal.js';

// call-notes-to-tasks-v1 - pasted internal call notes -> proposed Goals
// to-dos -> the ones the person kept, created this week with a back-link to
// the stored note. Extract writes nothing but the AI usage row; the notes
// text is never logged. call-notes-targets-v1 REV3 ("Intake"): any source,
// and the same one call also lists the companies, people, past touches and
// lasting facts in the notes (intakeMatch.js / intakeAccept.js). REV5: and
// the deal side - decisions, what they owe us, terms, the next meeting
// (intakeDeal.js); the model's scrubbed reply is stored on the note.

const MAX_CHARS = 120000;
const MAX_TASKS = 30;
const MAX_STEPS = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TASK_FIELDS = Object.fromEntries(['text', 'owner_user_id', 'due_date', 'link_type', 'link_id'].map(k => [k, WEEK_FIELDS[k]]));
const SIMILAR_WEEKS = 4;

export const SOURCE_TYPES = ['call', 'partner_update', 'email_thread', 'doc', 'other'];
export const noteHash = text => createHash('sha256').update(text.replace(/\s+/g, ' ').trim().toLowerCase()).digest('hex');

const SYSTEM = `You read internal sales notes (a call's AI summary or transcript, a partner's update, an email thread, a doc, or typed notes) and turn them into a shared task list plus what the CRM should learn from them.

Rules:
- One task per concrete action someone committed to or was asked to do. Skip discussion, opinions and status updates with no action. Merge duplicates. Related small actions under one topic become steps of one task.
- Task text: imperative, under 15 words, names the company/partner if there is one.
- Tasks are OUR work only. An action item whose actor is someone outside MEMBERS (the partner's people, "their team", "Equifax to...") is NEVER a task - it goes in waiting_on. The next meeting or a "reconvene" is NEVER a task - it goes in next_meeting.
- owner: the MEMBERS name the notes say will do it, exactly as written ("Jack") - from "X will...", "X to...", an action-item list under X's name; never swap in a member for someone else. null when the notes don't say who, or only say "I"/"we". Never guess from who talks most.
- due_date: YYYY-MM-DD only when a deadline is stated ("by Friday", "next Tuesday", "Oct 12"); resolve relative days from NOTE DATE. Otherwise null. Never invent one.
- link: at most one thing the task serves, only from the lists given: {"type":"partner","id":...} from PARTNERS, {"type":"commitment","id":...} from COMMITMENTS, {"type":"metric","id":...} from METRICS. If the task is about a prospect company not in those lists, set company_name to the company's name as written instead. Otherwise null.
- evidence: the shortest phrase from the notes that shows the action (max 20 words).
- Never include phone numbers.
- summary: exactly 3 short lines on what the notes decided.

companies - every company the notes name, once each, as written (keep "[solidcore]" style names as written). A company the notes point to without naming it ("Brad's company", "the bank Seif mentioned") is listed under that phrase with kind "unclear":
- kind: "partner" = a channel that reaches many employers or renters (benefits brokers and consultants, PEOs, perk / benefit platforms, HR / payroll marketplaces, rental and financial-wellness platforms, associations); "employer" = a company whose own employees would get the benefit; "not_target" = a tool, vendor or data source the team uses, or a company that is clearly not a prospect; "unclear" = can't tell.
- category: for a partner, the one entry of CATEGORIES that fits, exactly as written there; otherwise null.
- ownership: only when the notes say who owns or leads the account ("X owns", "Brad leads", "Upside should own", "one owner", "don't double-touch"): {"owner_team":"homelover"|"upside"|"both"|null,"owner_name":"the person named, as written","co_owner_name":"the other side's person, as written, or null","no_double_touch":true|false|null,"evidence":""}. Otherwise null. Never infer ownership from who talked about it.
people - people outside MEMBERS named in connection with a company: name, company, title as written or null, role ("champion" | "blocker" | "referrer" | "counterpart" | "other"), moved_from (the company they left, when the notes say they moved) or null.
touches - contact with a company that ALREADY happened (not plans), only when the notes say how it happened (emailed, called, met, they replied); a status line such as "X wants a one-pager" or "X is moving forward" is not a touch: company, touch_type ("email" | "call" | "linkedin" | "meeting" | "event" | "other"; a meeting that took place is "meeting"), people (names), date (YYYY-MM-DD resolved from NOTE DATE; null if not stated), direction ("out" = we reached them, "in" = they replied or reached us), stage ("replied" when they replied, "meeting_set" when a meeting is now booked, else null).
facts - lasting intel about a company worth keeping on its record: company, field ("champion" = who backs us there; "angle" = why they'd care; "watch_outs" = risks or objections; "next_step" = the single next move WE make - never a meeting, call or "reconvene" (that goes in next_meeting only); "do_not_say"; "target_titles" = roles to reach; "their_words" = a short quote of what they said), text (max 40 words), due_date (YYYY-MM-DD only for a next_step with a stated date, else null).
decisions - what the parties agreed in this conversation, in the notes' words: company, text (max 40 words), evidence.
waiting_on - anything someone outside MEMBERS owes us: their action items, pending confirmations, "X will send / check / draft / confirm": company, who (that person's name as written; the company's name when no person is named), text (what they owe, max 40 words), due_date (YYYY-MM-DD only when stated, resolved from NOTE DATE, else null), evidence.
terms - pricing, revenue share, economic structure, bundles, who pays: company, text (max 40 words), evidence.
next_meeting - the next meeting the notes set with a company: {company, date (YYYY-MM-DD resolved from NOTE DATE; "the week of X" = that week's Monday), text, evidence}, or null.
- One decisions / waiting_on / terms item per point the notes make (a bullet, a sentence): never join two decisions or two terms into one item.
- Product or integration ideas stay facts (angle).
- Every company / people / touches / facts / decisions / waiting_on / terms / next_meeting item carries evidence: the shortest phrase from the notes that shows it (max 20 words).
- Never include an email address or phone number in any field.

Reply with JSON only, no prose:
{"summary":["","",""],"tasks":[{"text":"","owner":null,"due_date":null,"link":null,"company_name":null,"steps":[],"evidence":""}],"companies":[{"name":"","kind":"","category":null,"ownership":null,"evidence":""}],"people":[{"name":"","company":"","title":null,"role":"","moved_from":null,"evidence":""}],"touches":[{"company":"","touch_type":"","people":[],"date":null,"direction":"","stage":null,"evidence":""}],"facts":[{"company":"","field":"","text":"","due_date":null,"evidence":""}],"decisions":[{"company":"","text":"","evidence":""}],"waiting_on":[{"company":"","who":"","text":"","due_date":null,"evidence":""}],"terms":[{"company":"","text":"","evidence":""}],"next_meeting":null}`;

const weekOf = day => addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));
const md = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
export const callCategory = (callDate, title) => ['From calls', md(callDate), title].filter(Boolean).join(' · ');

async function context(supabase, businessId, today) {
  const week = weekOf(today);
  const page = (table, cols, order) => selectAllPages(() => supabase.from(table).select(cols).eq('business_id', businessId).order(order));
  const [business, members, partners, commitments, recent, companies, opportunities, targets] = await Promise.all([
    supabase.from('businesses').select('name').eq('id', businessId).maybeSingle(),
    supabase.from('business_members').select('user_id, name, profile:profiles!business_members_user_id_fkey(display_name)')
      .eq('business_id', businessId).not('user_id', 'is', null),
    supabase.from('sales_goals').select('id, name, category, pipeline_status, owner_team, co_owner_name, no_double_touch, champion, angle, watch_outs, next_step, do_not_say, target_titles, notes, next_meeting_at')
      .eq('business_id', businessId).eq('goal_type', 'partnership').is('archived_at', null),
    supabase.from('sales_week_goals').select('id, text').eq('business_id', businessId).eq('kind', 'commitment').eq('week_start', week).neq('status', 'dropped'),
    supabase.from('sales_week_goals').select('id, text').eq('business_id', businessId).eq('kind', 'todo').not('source_note_id', 'is', null)
      .gte('week_start', addDays(week, -7 * SIMILAR_WEEKS)).neq('status', 'dropped').limit(500),
    page('sales_sequenced_accounts', 'account_id, name', 'account_id'),
    supabase.from('sales_opportunities').select('id, organization, owner, owner_team, co_owner_name, no_double_touch, champion, decision_makers, objections, next_action, next_action_date, notes')
      .eq('business_id', businessId).is('archived_at', null),
    page('sales_targets', 'id, name, kind, status, owner_team, co_owner_name, no_double_touch, research_notes', 'id'),
  ]);
  for (const r of [business, members, partners, commitments, recent, opportunities]) if (r.error) throw new Error(r.error.message);
  return {
    business_name: business.data?.name || null,
    members: members.data.map(m => ({ id: m.user_id, name: m.profile?.display_name || m.name })),
    partners: partners.data, commitments: commitments.data, companies: companies.filter(c => c.name), recent: recent.data,
    opportunities: opportunities.data, targets,
    categories: [...new Set(partners.data.map(p => p.category).filter(Boolean))].sort(),
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

// POST /goals/call-notes/extract { text, call_date?, title?, source_type?, source_label? } -> proposals.
export async function extractCallNotesRoute(req, res) {
  const { text, call_date, title, source_type = 'call', source_label } = req.body || {};
  if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'text is required' });
  if (text.length > MAX_CHARS) return res.status(413).json({ error: `notes are too long (${text.length} characters, max ${MAX_CHARS})` });
  if (call_date != null && !isDate(call_date)) return res.status(400).json({ error: 'call_date must be YYYY-MM-DD' });
  if (!SOURCE_TYPES.includes(source_type)) return res.status(400).json({ error: `source_type must be one of ${SOURCE_TYPES.join('|')}` });
  const businessId = req.params.businessId;
  const callDate = call_date || laDateString();
  const supabase = getSupabase();
  try {
    const hash = noteHash(text);
    const earlier = await findNote(supabase, businessId, hash);
    if (earlier) return res.json({ duplicate: earlier });
    const ctx = await context(supabase, businessId, laDateString());
    const lists = [
      `NOTE DATE: ${callDate}`, `SOURCE: ${source_type}${source_label ? ` - ${clean(source_label, 120)}` : ''}`, title ? `TITLE: ${clean(title, 200)}` : '',
      `MEMBERS: ${JSON.stringify(ctx.members.map(m => m.name))}`,
      `PARTNERS: ${JSON.stringify(ctx.partners.map(p => ({ id: p.id, name: p.name })))}`,
      `COMMITMENTS: ${JSON.stringify(ctx.commitments)}`,
      `METRICS: ${JSON.stringify(LINKABLE_METRICS)}`,
      `CATEGORIES: ${JSON.stringify(ctx.categories)}`,
    ].filter(Boolean).join('\n');
    const model = MODELS.STANDARD;
    const data = await callAnthropic({
      system: SYSTEM, model, max_tokens: 8192, thinking: false, timeoutMs: 90000,
      messages: [{ role: 'user', content: `${lists}\n\n<notes>\n${text}\n</notes>` }],
      supabase, businessId, userId: req.auth.user.id, callType: 'call_tasks',
    });
    if (data.stop_reason === 'max_tokens') return res.status(502).json({ error: `The notes hold more than fits in one pass (up to ${MAX_TASKS} tasks and ${MAX_ITEMS} each of companies, people, touches and facts) - split them and try again` });
    const out = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const json = out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1);
    let raw;
    try { raw = JSON.parse(json); } catch { return res.status(502).json({ error: 'Could not read the AI reply - try again' }); }
    const intake = await enrichIntake(supabase, businessId, toIntake(raw, ctx, callDate));
    const partnerIds = new Set(Object.values(intake).flat().map(x => x?.match?.type === 'partner' && x.match.id).filter(Boolean));
    const extract = scrubExtract(raw);
    res.json({
      call_date: callDate, hash, ...toProposals(raw, ctx), ...intake, categories: ctx.categories,
      recent_accepts: await recentAccepts(supabase, businessId, ctx.partners.filter(p => partnerIds.has(p.id))),
      extract, extract_sig: signExtract(extract, hash),
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

// POST /goals/call-notes { text, title?, call_date, source_type?, source_label?,
// tasks: [{ text, owner_user_id, due_date, link_type, link_id, steps: [text] }],
// companies, ownership, people, touches, facts, decisions, waiting_on, terms,
// next_meeting, extract + extract_sig (from the extract reply) } - Accept: stores the note and
// writes everything ticked in the review (intakeAccept.js). To-dos land in
// this week, category "From calls · <date> · <title>".
export async function createFromCallNotesRoute(req, res) {
  const { text, title, call_date, tasks = [], source_type = 'call', source_label, extract, extract_sig } = req.body || {};
  if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'text is required' });
  if (text.length > MAX_CHARS) return res.status(413).json({ error: `notes are too long (${text.length} characters, max ${MAX_CHARS})` });
  if (!isDate(call_date)) return res.status(400).json({ error: 'call_date must be YYYY-MM-DD' });
  if (title != null && typeof title !== 'string') return res.status(400).json({ error: 'title must be text' });
  if (!SOURCE_TYPES.includes(source_type)) return res.status(400).json({ error: `source_type must be one of ${SOURCE_TYPES.join('|')}` });
  if (source_label != null && typeof source_label !== 'string') return res.status(400).json({ error: 'source_label must be text' });
  if (!Array.isArray(tasks) || tasks.length > MAX_TASKS) return res.status(400).json({ error: `tasks must be a list of up to ${MAX_TASKS}` });
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
    const ctx = await context(supabase, businessId, laDateString());
    let intake;
    try { intake = parseIntake(req.body, ctx); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
    const picked = rows.length + Object.values(intake).reduce((n, l) => n + l.length, 0);
    if (!picked) return res.status(400).json({ error: 'nothing is ticked - tick at least one row' });
    const week = weekOf(laDateString());
    if (await weekIsFinal(supabase, businessId, week)) return res.status(409).json({ error: FINAL_ERROR });

    const hash = noteHash(text);
    const { data: note, error: noteErr } = await supabase.from('sales_call_notes')
      .insert({ business_id: businessId, title: title?.trim() || null, call_date, text, hash, source_type, source_label: clean(source_label, 120) || null, extract: extractIfSigned(extract, extract_sig, hash), created_by: userId })
      .select('id, title, call_date, source_type, source_label, created_at').single();
    if (noteErr?.code === '23505') return res.status(409).json({ error: 'These notes were already accepted', duplicate: await findNote(supabase, businessId, hash) });
    if (noteErr) throw new Error(noteErr.message);
    let result;
    try {
      result = await acceptIntake(supabase, { businessId, userId, note, ctx, intake, taskRows: rows, week, category: callCategory(call_date, note.title) });
    } catch (e) {
      // Everything acceptIntake wrote is already undone; the note goes too,
      // so pasting the same notes again works.
      await supabase.from('sales_call_notes').delete().eq('id', note.id);
      if (e.status && e.status < 500) return res.status(e.status).json({ error: e.message });
      throw e;
    }
    res.status(201).json({ note, ...result });
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
