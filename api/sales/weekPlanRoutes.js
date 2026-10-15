import { getSupabase, isDate, isMonday, laStartOfDayMs, weekIsFinal, FINAL_ERROR, fail } from './goalsShared.js';
import { LINKABLE_METRICS, checkLink } from './goalsRoutes.js';
import { laDateString } from './laDate.js';
import { callAnthropic } from '../businesses/shared.js';
import { buildPlanContext } from './weekPlanContext.js';
import { MODELS, estimateCostUsd } from '../../src/config/models.js';
import { cleanText as clean } from './scrubText.js';

// weekly-plan-v1 - "Plan this week": the seller's prompt + what Prospector
// already knows -> a ranked list -> the kept ones saved as this week's
// commitments (Focus 5) and supporting to-dos. Propose writes nothing but the
// AI usage row. Planned rows are ordinary sales_week_goals with plan_id /
// plan_rank / plan_reason, so scorecard, report and carry-over don't change.
//
// A commitment never carries link_type/link_id: checkLink refuses a link on
// anything but a to-do (and would then refuse every later PATCH of that
// commitment). The proposal's link stays in the plan row's proposals.

export const FOCUS_CAP = 5;
export const PROPOSE_MAX = 10;
// REVISABLE: propose calls per user per LA day.
export const DAILY_PROPOSE_CAP = 10;
const PROMPT_MAX = 4000;
const SAVED_JSON_MAX = 200000;
const CALL_TYPE = 'week_plan';
const SOURCES = ['prompt', 'todo', 'reply', 'partner', 'flag', 'last_week', 'target'];
const LINK_TYPES = ['partner', 'company', 'commitment', 'metric'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Swapped in tests.
export const planDeps = { getSupabase, callAnthropic, buildPlanContext };

const normText = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const SYSTEM = `You plan one seller's week. Rank what matters most for revenue this week. Warm before cold, owed reciprocity before new asks, replies waiting before outreach, meetings this week before next week, overdue before undated.

Return JSON only, no prose: { "proposals": [ { "rank": 1, "text": "", "reason": "", "kind": "commitment", "source": "prompt", "link_type": null, "link_id": null, "existing_todo_id": null, "due_date": null, "effort_min": 30 } ] }, at most ${PROPOSE_MAX}.
- text: at most 120 characters, imperative, one concrete outcome.
- reason: at most 160 characters and must cite a fact from the context (a date, a count, a reply, a stage).
- kind: "commitment" for the top items and "todo" for supporting steps.
- source: one of ${SOURCES.join('|')}.
- link_type/link_id only from ids in the context: "partner:<id>" -> link_type "partner", "company:<id>" -> "company", "commitment:<id>" -> "commitment". Otherwise null.
- existing_todo_id: when the item IS an open to-do or flag already listed ("todo:<id>"), give that id instead of restating it as new work.
- due_date: YYYY-MM-DD or null. effort_min: whole minutes or null.
- Never invent companies, people, or dates.`;

// Everything the model returns is checked against the context it was given;
// a proposal pointing at an id that isn't there is dropped, not trusted.
export function toPlanProposals(raw, ids) {
  const seen = new Set();
  const out = [];
  const list = (Array.isArray(raw?.proposals) ? raw.proposals : []).slice()
    .sort((a, b) => (Number(a?.rank) || 99) - (Number(b?.rank) || 99));
  for (const p of list) {
    const text = clean(p?.text, 120);
    if (!text || seen.has(normText(text))) continue;
    let link_type = null, link_id = null;
    if (p.link_type != null || p.link_id != null) {
      const id = typeof p.link_id === 'string' ? p.link_id.replace(/^(partner|company|commitment|metric):/, '') : null;
      const ok = LINK_TYPES.includes(p.link_type) && id && (p.link_type === 'metric' ? LINKABLE_METRICS.includes(id) : ids[p.link_type]?.has(id));
      if (!ok) continue;
      link_type = p.link_type; link_id = id;
    }
    let existing_todo_id = null;
    if (p.existing_todo_id != null) {
      const id = typeof p.existing_todo_id === 'string' ? p.existing_todo_id.replace(/^todo:/, '') : null;
      if (!id || !ids.todo.has(id)) continue;
      existing_todo_id = id;
    }
    seen.add(normText(text));
    out.push({
      rank: out.length + 1, text, reason: clean(p.reason, 160),
      kind: p.kind === 'todo' ? 'todo' : 'commitment',
      source: SOURCES.includes(p.source) ? p.source : 'prompt',
      link_type, link_id, existing_todo_id,
      due_date: isDate(p.due_date) ? p.due_date : null,
      effort_min: Number.isInteger(p.effort_min) && p.effort_min > 0 && p.effort_min <= 600 ? p.effort_min : null,
    });
    if (out.length === PROPOSE_MAX) break;
  }
  return out;
}

// Display names for the drawer and the Huddle Focus strip, taken from the
// context (never the model). Saved inside the plan's proposals, which is the
// only place a planned commitment's link lives.
export function nameProposals(proposals, sections) {
  const names = new Map();
  for (const p of sections.partners) names.set(`partner:${p.id}`, p.name);
  for (const r of sections.replies_waiting) if (r.company_id && r.company) names.set(`company:${r.company_id}`, r.company);
  for (const t of sections.todos) if (t.link_type === 'company' && t.link) names.set(`company:${t.link_id}`, t.link.replace(/^company /, ''));
  for (const c of sections.this_week_commitments) names.set(`commitment:${c.id}`, c.text);
  const existing = new Map([...sections.todos.map(t => [t.id, t.text]), ...sections.flags.map(f => [f.id, [f.person, f.company].filter(Boolean).join(' · ') || f.note])]);
  return proposals.map(p => ({
    ...p,
    link_name: p.link_type === 'metric' ? p.link_id.replace(/_/g, ' ') : p.link_type ? names.get(`${p.link_type}:${p.link_id}`) || null : null,
    existing_text: p.existing_todo_id ? existing.get(p.existing_todo_id) || null : null,
  }));
}

async function isMember(supabase, businessId, userId) {
  const { data, error } = await supabase.from('business_members').select('id').eq('business_id', businessId).eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}

async function proposeCountToday(supabase, userId) {
  const since = new Date(laStartOfDayMs(laDateString())).toISOString();
  const { count, error } = await supabase.from('business_anthropic_usage').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('call_type', CALL_TYPE).gte('created_at', since);
  if (error) throw new Error(error.message);
  return count || 0;
}

// POST /goals/week/plan/propose { week_start, owner_user_id?, prompt }
export async function proposeWeekPlanRoute(req, res) {
  const { week_start, owner_user_id, prompt = '' } = req.body || {};
  if (!isMonday(week_start)) return res.status(400).json({ error: 'week_start must be a Monday (YYYY-MM-DD)' });
  if (typeof prompt !== 'string') return res.status(400).json({ error: 'prompt must be text' });
  if (prompt.length > PROMPT_MAX) return res.status(413).json({ error: `prompt is too long (${prompt.length} characters, max ${PROMPT_MAX})` });
  if (owner_user_id != null && !UUID.test(owner_user_id)) return res.status(400).json({ error: 'owner_user_id must be a member id' });
  const businessId = req.params.businessId;
  const userId = req.auth.user.id;
  const ownerId = owner_user_id || userId;
  const supabase = planDeps.getSupabase();
  try {
    if (!(await isMember(supabase, businessId, ownerId))) return res.status(400).json({ error: 'owner_user_id is not a member of this workspace' });
    if (await proposeCountToday(supabase, userId) >= DAILY_PROPOSE_CAP) return res.status(429).json({ error: 'Daily plan limit reached - tomorrow' });
    const ctx = await planDeps.buildPlanContext(supabase, businessId, ownerId, week_start);
    const model = MODELS.STANDARD;
    const data = await planDeps.callAnthropic({
      system: SYSTEM, model, max_tokens: 4096, thinking: false, timeoutMs: 90000,
      messages: [{ role: 'user', content: `<what_needs_to_happen>\n${clean(prompt, PROMPT_MAX) || '(no prompt - plan from the context)'}\n</what_needs_to_happen>\n\n<context>\n${ctx.text}\n</context>` }],
      supabase, businessId, userId, callType: CALL_TYPE,
    });
    const usage = { model, input_tokens: data.usage?.input_tokens ?? null, output_tokens: data.usage?.output_tokens ?? null, cost_usd: estimateCostUsd(model, data.usage) };
    if (data.stop_reason === 'max_tokens') return res.status(502).json({ error: 'The plan ran past the reply limit - try a shorter prompt', usage });
    const out = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    let raw;
    try { raw = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)); } catch { raw = null; }
    const proposals = nameProposals(toPlanProposals(raw, ctx.ids), ctx.inputs.sections);
    if (!proposals.length) return res.status(502).json({ error: 'Nothing usable came back - try a more specific prompt', usage });
    res.json({
      week_start, owner_user_id: ownerId, prompt,
      inputs: ctx.inputs,
      inputs_summary: { ...ctx.inputs.counts, trimmed: ctx.inputs.trimmed },
      proposals, usage,
    });
  } catch (e) {
    console.error('[week-plan/propose]', e.message);
    res.status(500).json({ error: e.message });
  }
}

function checkChosen(chosen) {
  if (!Array.isArray(chosen) || !chosen.length || chosen.length > PROPOSE_MAX) return { error: `chosen must be a list of 1-${PROPOSE_MAX}` };
  const items = [];
  for (const [i, c] of chosen.entries()) {
    const n = `chosen ${i + 1}`;
    if (!c || !['commitment', 'todo'].includes(c.as)) return { error: `${n}: as must be commitment|todo` };
    const text = clean(c.text, 200);
    if (!text) return { error: `${n}: text is required` };
    if (!Number.isInteger(c.rank) || c.rank < 1 || c.rank > PROPOSE_MAX) return { error: `${n}: rank must be 1-${PROPOSE_MAX}` };
    if (c.due_date != null && !isDate(c.due_date)) return { error: `${n}: due_date must be YYYY-MM-DD or null` };
    if (c.existing_todo_id != null && !UUID.test(c.existing_todo_id)) return { error: `${n}: existing_todo_id not found` };
    if ((c.link_type == null) !== (c.link_id == null)) return { error: `${n}: link_type and link_id go together` };
    items.push({
      rank: c.rank, text, reason: clean(c.reason, 300) || null, as: c.as,
      link_type: c.link_type ?? null, link_id: c.link_id ?? null, due_date: c.due_date ?? null,
      existing_todo_id: c.existing_todo_id ?? null, link_to_rank: c.link_to_rank ?? null,
    });
  }
  const commitRanks = new Set(items.filter(c => c.as === 'commitment').map(c => c.rank));
  if (commitRanks.size > FOCUS_CAP) return { error: `At most ${FOCUS_CAP} planned commitments a week (${commitRanks.size} chosen)` };
  if (commitRanks.size !== items.filter(c => c.as === 'commitment').length) return { error: 'two chosen commitments share a rank' };
  const bad = items.find(c => c.link_to_rank != null && (c.as !== 'todo' || !commitRanks.has(c.link_to_rank)));
  if (bad) return { error: `rank ${bad.rank}: link_to_rank must be the rank of a chosen commitment` };
  return { items };
}

// POST /goals/week/plan/save { week_start, owner_user_id, prompt, inputs, proposals,
//   chosen: [{ rank, text, reason, as, link_type, link_id, due_date, existing_todo_id?, link_to_rank? }],
//   replace_open_planned }
export async function saveWeekPlanRoute(req, res) {
  const { week_start, owner_user_id, prompt = '', inputs, proposals, chosen, replace_open_planned = false } = req.body || {};
  if (!isMonday(week_start)) return res.status(400).json({ error: 'week_start must be a Monday (YYYY-MM-DD)' });
  if (!UUID.test(owner_user_id || '')) return res.status(400).json({ error: 'owner_user_id is required' });
  if (typeof prompt !== 'string' || prompt.length > PROMPT_MAX) return res.status(400).json({ error: `prompt must be text up to ${PROMPT_MAX} characters` });
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) return res.status(400).json({ error: 'inputs must be the object propose returned' });
  if (!Array.isArray(proposals) || proposals.length > PROPOSE_MAX) return res.status(400).json({ error: `proposals must be a list of up to ${PROPOSE_MAX}` });
  if (JSON.stringify({ inputs, proposals }).length > SAVED_JSON_MAX) return res.status(413).json({ error: 'plan is too large to save' });
  if (typeof replace_open_planned !== 'boolean') return res.status(400).json({ error: 'replace_open_planned must be true or false' });
  const v = checkChosen(chosen);
  if (v.error) return res.status(400).json({ error: v.error });
  const businessId = req.params.businessId;
  const userId = req.auth.user.id;
  const supabase = planDeps.getSupabase();
  try {
    if (!(await isMember(supabase, businessId, owner_user_id))) return res.status(400).json({ error: 'owner_user_id is not a member of this workspace' });
    if (await weekIsFinal(supabase, businessId, week_start)) return res.status(409).json({ error: FINAL_ERROR });

    const existingIds = [...new Set(v.items.map(c => c.existing_todo_id).filter(Boolean))];
    const existing = new Map();
    if (existingIds.length) {
      const { data, error } = await supabase.from('sales_week_goals').select('id, kind, status, link_type, link_id, week_start')
        .eq('business_id', businessId).in('id', existingIds);
      if (error) throw new Error(error.message);
      for (const r of data) if (r.kind === 'todo' && r.status === 'open') existing.set(r.id, r);
      const missing = existingIds.find(id => !existing.has(id));
      if (missing) return res.status(400).json({ error: `existing_todo_id ${missing} is not an open to-do in this workspace` });
      for (const r of existing.values()) if (await weekIsFinal(supabase, businessId, r.week_start)) return res.status(409).json({ error: FINAL_ERROR });
    }
    for (const c of v.items.filter(c => c.as === 'todo' && !c.existing_todo_id && c.link_to_rank == null && c.link_type)) {
      const linkErr = await checkLink(supabase, businessId, { kind: 'todo', link_type: c.link_type, link_id: c.link_id }, null);
      if (linkErr) return fail(res, { ...linkErr, error: `rank ${c.rank}: ${linkErr.error}` });
    }

    const { data: plan, error: planErr } = await supabase.from('sales_week_plans').insert({
      business_id: businessId, week_start, owner_user_id, prompt, inputs, proposals, chosen_count: 0, model: MODELS.STANDARD, created_by: userId,
    }).select('id, week_start, owner_user_id, created_at').single();
    if (planErr) throw new Error(planErr.message);

    // No transaction across these writes, so a failure puts back what this
    // call already changed and removes the plan row.
    const inserted = [], dropped = [], relinked = [];
    const undo = async () => {
      if (relinked.length) for (const r of relinked) await supabase.from('sales_week_goals').update(r.before).eq('id', r.id);
      if (inserted.length) await supabase.from('sales_week_goals').delete().in('id', inserted);
      for (const d of dropped) await supabase.from('sales_week_goals').update({ status: 'open', why_not_done: d.why_not_done }).eq('id', d.id);
      await supabase.from('sales_week_plans').delete().eq('id', plan.id);
    };
    const now = new Date().toISOString();
    try {
      if (replace_open_planned) {
        const { data: open, error: openErr } = await supabase.from('sales_week_goals').select('id, why_not_done')
          .eq('business_id', businessId).eq('week_start', week_start).eq('kind', 'commitment').eq('status', 'open')
          .eq('owner_user_id', owner_user_id).not('plan_id', 'is', null);
        if (openErr) throw new Error(openErr.message);
        if (open.length) {
          const { error } = await supabase.from('sales_week_goals')
            .update({ status: 'dropped', why_not_done: `replanned ${laDateString()}`, updated_at: now }).in('id', open.map(r => r.id));
          if (error) throw new Error(error.message);
          dropped.push(...open);
        }
      }
      const planned = c => ({ plan_id: plan.id, plan_rank: c.rank, plan_reason: c.reason });
      const commits = v.items.filter(c => c.as === 'commitment');
      let commitRows = [];
      if (commits.length) {
        const { data, error } = await supabase.from('sales_week_goals').insert(commits.map(c => ({
          business_id: businessId, week_start, kind: 'commitment', status: 'open', text: c.text, owner_user_id,
          sort_order: c.rank, created_by: userId, ...planned(c),
        }))).select();
        if (error) throw new Error(error.message);
        commitRows = data;
        inserted.push(...data.map(r => r.id));
      }
      const commitByRank = new Map(commitRows.map(r => [r.plan_rank, r]));

      const newTodos = v.items.filter(c => c.as === 'todo' && !c.existing_todo_id);
      let todoRows = [];
      if (newTodos.length) {
        const { data, error } = await supabase.from('sales_week_goals').insert(newTodos.map(c => {
          const link = c.link_to_rank != null ? { link_type: 'commitment', link_id: commitByRank.get(c.link_to_rank).id }
            : { link_type: c.link_type, link_id: c.link_id };
          return { business_id: businessId, week_start, kind: 'todo', status: 'open', text: c.text, owner_user_id, due_date: c.due_date,
            sort_order: c.rank, created_by: userId, ...link, ...planned(c) };
        })).select();
        if (error) throw new Error(error.message);
        todoRows = data;
        inserted.push(...data.map(r => r.id));
      }

      // An item that already is an open to-do isn't copied: the to-do gets the
      // plan marks, and a link to its commitment when it had no link.
      const updatedTodos = [];
      for (const c of v.items.filter(c => c.existing_todo_id)) {
        const row = existing.get(c.existing_todo_id);
        const target = c.as === 'commitment' ? commitByRank.get(c.rank) : c.link_to_rank != null ? commitByRank.get(c.link_to_rank) : null;
        const patch = c.as === 'todo' ? { ...planned(c) } : {};
        if (target && !row.link_type) Object.assign(patch, { link_type: 'commitment', link_id: target.id });
        if (!Object.keys(patch).length) continue;
        relinked.push({ id: row.id, before: Object.fromEntries(Object.keys(patch).map(k => [k, row[k] ?? null])) });
        const { data, error } = await supabase.from('sales_week_goals').update({ ...patch, updated_at: now }).eq('id', row.id).select().single();
        if (error) throw new Error(error.message);
        updatedTodos.push(data);
      }

      const chosenCount = v.items.length;
      const { error: countErr } = await supabase.from('sales_week_plans').update({ chosen_count: chosenCount }).eq('id', plan.id);
      if (countErr) throw new Error(countErr.message);
      res.status(201).json({ plan: { ...plan, chosen_count: chosenCount }, commitments: commitRows, todos: todoRows, linked_todos: updatedTodos, dropped: dropped.map(d => d.id) });
    } catch (e) { await undo(); throw e; }
  } catch (e) {
    console.error('[week-plan/save]', e.message);
    res.status(500).json({ error: e.message });
  }
}

// GET /goals/week/plan?week_start&owner_user_id - the latest plan (no inputs)
// and this owner's planned commitments that week, for the nudge and the ✦ marks.
export async function getWeekPlanRoute(req, res) {
  const { week_start, owner_user_id } = req.query;
  if (!isMonday(week_start)) return res.status(400).json({ error: 'week_start must be a Monday (YYYY-MM-DD)' });
  if (!UUID.test(owner_user_id || '')) return res.status(400).json({ error: 'owner_user_id is required' });
  const supabase = planDeps.getSupabase();
  const businessId = req.params.businessId;
  const [plan, planned] = await Promise.all([
    supabase.from('sales_week_plans').select('id, week_start, owner_user_id, prompt, proposals, chosen_count, model, created_by, created_at')
      .eq('business_id', businessId).eq('week_start', week_start).eq('owner_user_id', owner_user_id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('sales_week_goals').select('id').eq('business_id', businessId).eq('week_start', week_start)
      .eq('kind', 'commitment').eq('owner_user_id', owner_user_id).not('plan_id', 'is', null).neq('status', 'dropped'),
  ]);
  for (const r of [plan, planned]) if (r.error) return res.status(500).json({ error: r.error.message });
  res.json({ plan: plan.data, planned_commitment_ids: planned.data.map(r => r.id) });
}

// GET /goals/week/plans?owner_user_id&limit=12 - plan history, newest first,
// with proposals (the drawer's read-only view and the Focus strip's link chips).
export async function listWeekPlansRoute(req, res) {
  const { owner_user_id } = req.query;
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 12, 1), 52);
  if (owner_user_id != null && !UUID.test(owner_user_id)) return res.status(400).json({ error: 'owner_user_id must be a member id' });
  let q = planDeps.getSupabase().from('sales_week_plans').select('id, week_start, owner_user_id, prompt, proposals, chosen_count, created_at')
    .eq('business_id', req.params.businessId);
  if (owner_user_id) q = q.eq('owner_user_id', owner_user_id);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(limit);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ plans: data });
}
