import { addDays, isDate } from './goalsShared.js';
import { laDateString } from './laDate.js';
import { applyPartnerSignal, SignalError } from './partnerSignals.js';
import { cleanText } from './scrubText.js';
import { touchDedupe } from './touchDedupe.js';
import { MAX_ITEMS, ROLES, FACT_FIELDS, PARTNER_FACT_COLUMN, EMPLOYER_FACT_COLUMN, SINGLE_VALUED, matchOwner } from './intakeMatch.js';
import { OWNER_TEAMS } from '../../src/constants/ownership.js';
import { TOUCH_TYPE_IDS, PIPELINE_STATUS_IDS } from '../../src/constants/partnerPipeline.js';
import { findOpportunity } from './opportunityMatch.js';
import { parseDeal, queueDealFields, writeDeal, emptyDealOut } from './intakeDeal.js';
import { cleanReferral, referralSource, sourceColumns, logSource } from './leadSource.js';

// call-notes-targets-v1 REV3 - Accept: everything ticked in the review, in
// one request. There is no transaction across these tables, so writes run
// in a fixed order and each one pushes its own undo: targets -> people ->
// intel + ownership (+ employers created from Apollo-only accounts) -> note
// events -> touches -> to-dos -> decisions + waiting-on (REV5; terms and the
// next meeting ride the intel column queue). Any failure up to there runs the undos and
// the request fails as a whole. Stage moves run LAST and are reported per
// row - a refused move (the partner moved since the review) never rolls
// back the rest; Undo on the partner exists for a wrong one.

export const COMPANY_ACTIONS = ['note', 'pipeline', 'target_partner', 'target_employer', 'never'];
const RESEARCH_DUE_DAYS = 3; // REVISABLE
const slash = d => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const appendLine = (old, line) => (old ? `${old}\n${line}` : line);
const err = (status, error) => Object.assign(new Error(error), { status });

export function researchPrompt(name, kind, business) {
  return [
    `Research ${name} as a possible ${kind === 'partner' ? 'channel partner (they reach many employers or renters)' : 'employer customer (their own employees get the benefit)'} for ${business}.`,
    'Answer in short labeled lines, each with its source link:',
    '1. Website, and what they do in one line.',
    '2. Size: employees, locations, who they serve.',
    '3. The 3 best job titles to contact first.',
    `4. The angle: why ${business} would matter to them.`,
    '5. Watch-outs: anything that makes this a poor fit or a slow one.',
    "6. Anyone we likely know there or a warm path in. Never include personal email addresses or phone numbers.",
  ].join('\n');
}

const arr = (body, k) => {
  const v = body[k] ?? [];
  if (!Array.isArray(v) || v.length > MAX_ITEMS) throw err(400, `${k} must be a list of up to ${MAX_ITEMS}`);
  return v.filter(x => x && typeof x === 'object');
};

// Checks every id the browser sent back against this workspace and puts the
// matching row next to it; a row that isn't here (or a rejected target) is
// a 400, never a silent write somewhere else.
function lookup(ctx, match) {
  if (!match || typeof match !== 'object') return null;
  const row = match.type === 'partner' ? ctx.partners.find(p => p.id === match.id)
    : match.type === 'opportunity' ? ctx.opportunities.find(o => o.id === match.id)
    : match.type === 'account' ? ctx.companies.find(c => c.account_id === match.id)
    : match.type === 'target' ? ctx.targets.find(t => t.id === match.id && t.status !== 'rejected') : null;
  if (!row) throw err(400, `${match.type || 'record'} ${match.id} not found in this workspace`);
  return { type: match.type, id: match.id, row, name: row.name || row.organization };
}

export function parseIntake(body, ctx) {
  const companies = arr(body, 'companies').map((c, i) => {
    if (!COMPANY_ACTIONS.includes(c.action)) throw err(400, `company ${i + 1}: action must be one of ${COMPANY_ACTIONS.join('|')}`);
    const name = cleanText(c.name, 160);
    if (!name || typeof c.key !== 'string') throw err(400, `company ${i + 1}: key and name are required`);
    const m = lookup(ctx, c.match);
    if (c.action === 'note' && !['partner', 'opportunity', 'target'].includes(m?.type)) throw err(400, `company ${i + 1}: "note" needs a partner, employer or target`);
    if (c.action === 'pipeline' && m?.type !== 'account') throw err(400, `company ${i + 1}: "pipeline" needs an Apollo account`);
    if (c.action.startsWith('target_') && m) throw err(400, `company ${i + 1}: ${name} is already ${m.name}`);
    if (c.action === 'never' && m && m.type !== 'target') throw err(400, `company ${i + 1}: only a new name or a target can be "never again"`);
    const kind = c.action === 'target_partner' || (c.action === 'never' && c.kind === 'partner') ? 'partner' : 'employer';
    return { key: c.key, name, action: c.action, m, kind, evidence: cleanText(c.evidence, 200),
      category: kind === 'partner' && ctx.categories.includes(c.category) ? c.category : null,
      referred_by: cleanReferral(c.referred_by, ctx.partners) };
  });
  const byKey = new Map(companies.map(c => [c.key, c]));
  // Where a person / fact / ownership row lands: a matched record, or a
  // target this same request creates.
  const subject = (x, label) => {
    if (x.match) return lookup(ctx, x.match);
    const c = byKey.get(x.company_key);
    if (c?.action.startsWith('target_')) return { type: 'new_target', key: c.key, name: c.name };
    throw err(400, `${label}: its company isn't in this workspace or ticked as a target`);
  };
  const ownership = arr(body, 'ownership').map((o, i) => {
    const s = subject(o, `ownership ${i + 1}`);
    if (o.owner_team != null && !OWNER_TEAMS.includes(o.owner_team)) throw err(400, `ownership ${i + 1}: owner_team must be one of ${OWNER_TEAMS.join('|')}`);
    if (o.no_double_touch != null && typeof o.no_double_touch !== 'boolean') throw err(400, `ownership ${i + 1}: no_double_touch must be true or false`);
    return { s, owner_team: o.owner_team ?? null, co_owner_name: cleanText(o.co_owner_name, 120) || null, no_double_touch: o.no_double_touch ?? null, owner_name: cleanText(o.owner_name, 80) || null };
  });
  const people = arr(body, 'people').map((p, i) => {
    const name = cleanText(p.name, 120);
    if (!name) throw err(400, `person ${i + 1}: name is required`);
    const s = subject(p, `person ${i + 1}`);
    const movedFrom = p.moved_from_match ? lookup(ctx, p.moved_from_match) : null;
    if (movedFrom && movedFrom.type !== 'partner') throw err(400, `person ${i + 1}: moved_from_match must be a partner`);
    return { s, name, title: cleanText(p.title, 160) || null, role: ROLES.includes(p.role) ? p.role : 'other', moved_from: cleanText(p.moved_from, 160) || null, movedFrom };
  });
  const facts = arr(body, 'facts').map((f, i) => {
    if (!FACT_FIELDS.includes(f.field)) throw err(400, `fact ${i + 1}: field must be one of ${FACT_FIELDS.join('|')}`);
    const s = subject(f, `fact ${i + 1}`);
    const column = s.type === 'partner' ? PARTNER_FACT_COLUMN[f.field]
      : s.type === 'opportunity' || s.type === 'account' ? EMPLOYER_FACT_COLUMN[f.field]
      : 'research_notes';
    if (!column) throw err(400, `fact ${i + 1}: an employer has nowhere to keep ${f.field}`);
    let text = cleanText(f.text, 400);
    if (!text) throw err(400, `fact ${i + 1}: text is required`);
    if (f.field === 'their_words' && column === 'angle' && !text.startsWith('They said: ')) text = `They said: ${text}`;
    return { s, field: f.field, column, text, due_date: column === 'next_action' && isDate(f.due_date) ? f.due_date : null };
  });
  const touches = arr(body, 'touches').map((t, i) => {
    const s = lookup(ctx, t.match);
    if (s?.type !== 'partner') throw err(400, `touch ${i + 1}: only a partner's touch is written`);
    if (!TOUCH_TYPE_IDS.includes(t.touch_type)) throw err(400, `touch ${i + 1}: touch_type must be one of ${TOUCH_TYPE_IDS.join('|')}`);
    if (!isDate(t.date)) throw err(400, `touch ${i + 1}: date must be YYYY-MM-DD`);
    if (t.stage != null && !PIPELINE_STATUS_IDS.includes(t.stage)) throw err(400, `touch ${i + 1}: bad stage`);
    const people = (Array.isArray(t.people) ? t.people : []).map(n => cleanText(n, 80)).filter(Boolean).slice(0, 10);
    return { key: typeof t.key === 'string' ? t.key : `t${i}`, s, touch_type: t.touch_type, date: t.date, people, note: cleanText(t.evidence, 300) || null, stage: t.stage_on ? t.stage : null, expect: t.expect ?? s.row.pipeline_status ?? 'not_started' };
  });
  return { companies, ownership, people, facts, touches, ...parseDeal(body, ctx) };
}

export async function acceptIntake(supabase, { businessId, userId, note, ctx, intake, taskRows, week, category }) {
  const undo = [];
  const now = new Date();
  const today = laDateString(now);
  const stamp = slash(note.call_date);
  const meta = { from_note_id: note.id };
  // A referral the person kept in the review is their pick (manual) for the record Accept creates.
  const referred = c => referralSource(c.referred_by);
  const out = { targets: [], opportunities_created: [], contacts: { added: 0, updated: 0 }, intel: 0, ownership: 0, notes_added: 0, touches: [], touches_skipped: [], stage_moves: [], goals: [], ...emptyDealOut() };
  const must = r => { if (r.error) throw err(500, r.error.message); return r.data; };
  // Pending column changes per record, written once each with the values
  // this request read as the guard (a teammate's edit in between = 409).
  const pending = new Map();
  const queue = (table, id, row, apply) => {
    const k = `${table}:${id}`;
    if (!pending.has(k)) pending.set(k, { table, id, row, patch: {} });
    const p = pending.get(k);
    apply(col => (col in p.patch ? p.patch[col] : row[col] ?? null), (col, v) => { p.patch[col] = v; });
  };
  const signal = async (goalId, s, extra = {}) => {
    const { event, goal } = await applyPartnerSignal(supabase, { businessId, goalId, signal: s, byUser: userId, now, meta: { ...meta, ...extra } });
    undo.push(async () => {
      const prev = event.meta?.prev || {};
      if (Object.keys(prev).length) await supabase.from('sales_goals').update(prev).eq('id', goalId);
      await supabase.from('sales_partner_events').delete().eq('id', event.id);
    });
    return { event, goal };
  };

  try {
    // 1. Targets (and the "never again" memory).
    const newTargets = new Map();
    const business = ctx.business_name || 'us';
    for (const c of intake.companies) {
      if (c.action === 'never' && c.m?.type === 'target') {
        must(await supabase.from('sales_targets').update({ status: 'rejected', decided_at: now.toISOString(), updated_at: now.toISOString() }).eq('id', c.m.id));
        undo.push(() => supabase.from('sales_targets').update({ status: c.m.row.status, decided_at: null }).eq('id', c.m.id));
        continue;
      }
      if (!c.action.startsWith('target_') && c.action !== 'never') continue;
      const never = c.action === 'never';
      const r = await supabase.from('sales_targets').insert({
        business_id: businessId, name: c.name, kind: c.kind, status: never ? 'rejected' : 'researching', source_note_id: note.id, channel: 'call_note',
        evidence: c.evidence || null, research_prompt: never ? null : researchPrompt(c.name, c.kind, business),
        suggested_category: c.category, created_by: userId, decided_at: never ? now.toISOString() : null,
        ...(referred(c) ? sourceColumns(referred(c), { userId, manual: true, now }) : {}),
      }).select().single();
      if (r.error?.code === '23505') throw err(409, `${c.name} is already a target - reload the review`);
      const t = must(r);
      undo.push(() => supabase.from('sales_targets').delete().eq('id', t.id));
      if (referred(c)) {
        await logSource(supabase, { businessId, type: 'target', id: t.id, to: referred(c), reason: 'create', byUser: userId, at: now });
        undo.push(() => supabase.from('sales_source_events').delete().eq('record_type', 'target').eq('record_id', t.id));
      }
      newTargets.set(c.key, t);
      out.targets.push({ id: t.id, name: t.name, kind: t.kind, status: t.status });
    }
    const targetOf = s => (s.type === 'new_target' ? newTargets.get(s.key) : s.row);

    // An employer that is only an Apollo account gets its pipeline row the
    // first time something here needs one (same row Huddle's "add to
    // pipeline" makes, at 'contacted').
    const opps = new Map();
    const ownerFor = s => intake.ownership.find(o => o.s.type === s.type && o.s.id === s.id)?.owner_name || null;
    const opportunityFor = async (s, ref = null) => {
      if (s.type === 'opportunity') return s.row;
      if (opps.has(s.id)) return opps.get(s.id);
      const existing = await findOpportunity(supabase, businessId, { name: s.name, apolloAccountId: s.type === 'account' ? s.id : null });
      if (existing) { opps.set(s.id, existing); return existing; }
      const named = ownerFor(s);
      const member = named && matchOwner(named, ctx.members);
      const owner = member ? ctx.members.find(m => m.id === member).name.split(' ')[0] : named;
      const row = must(await supabase.from('sales_opportunities').insert({ business_id: businessId, organization: s.name, org_type: 'employer', stage: 'contacted', source: 'manual', channel: 'call_note', owner,
        ...(ref ? sourceColumns(ref, { userId, manual: true, now }) : {}) }).select().single());
      undo.push(() => supabase.from('sales_opportunities').delete().eq('id', row.id));
      if (ref) {
        await logSource(supabase, { businessId, type: 'employer', id: row.id, to: ref, reason: 'create', byUser: userId, at: now });
        undo.push(() => supabase.from('sales_source_events').delete().eq('record_type', 'employer').eq('record_id', row.id));
      }
      opps.set(s.id, row);
      out.opportunities_created.push({ id: row.id, organization: row.organization, from_account: s.id });
      return row;
    };
    const queueOn = async (s, apply) => {
      if (s.type === 'partner') return queue('sales_goals', s.id, s.row, apply);
      if (s.type === 'opportunity' || s.type === 'account') { const o = await opportunityFor(s); return queue('sales_opportunities', o.id, o, apply); }
      const t = targetOf(s);
      return queue('sales_targets', t.id, t, apply);
    };

    for (const c of intake.companies) if (c.action === 'pipeline') await opportunityFor(c.m, referred(c));

    // 2. People.
    for (const p of intake.people) {
      const line = `${p.name}${p.title ? ` — ${p.title}` : ''} (${p.role})`;
      if (p.s.type === 'partner') {
        const { data: found, error } = await supabase.from('partner_contacts').select('id, name, title, role_in_notes').eq('business_id', businessId).eq('goal_id', p.s.id);
        if (error) throw err(500, error.message);
        const hit = found.find(c => c.name.trim().toLowerCase() === p.name.toLowerCase());
        if (hit) {
          const patch = { role_in_notes: p.role, ...(p.title ? { title: p.title } : {}), updated_at: now.toISOString() };
          must(await supabase.from('partner_contacts').update(patch).eq('id', hit.id));
          undo.push(() => supabase.from('partner_contacts').update({ title: hit.title, role_in_notes: hit.role_in_notes }).eq('id', hit.id));
          out.contacts.updated++;
        } else {
          const row = must(await supabase.from('partner_contacts').insert({ business_id: businessId, goal_id: p.s.id, name: p.name, title: p.title, role_in_notes: p.role, source: 'manual', created_by: userId }).select('id').single());
          undo.push(() => supabase.from('partner_contacts').delete().eq('id', row.id));
          out.contacts.added++;
        }
        if (p.movedFrom) { await signal(p.movedFrom.id, { type: 'note', note: `${p.name} moved to ${p.s.name} (note ${stamp})` }); out.notes_added++; }
        else if (p.moved_from) { await signal(p.s.id, { type: 'note', note: `${p.name} - previously at ${p.moved_from} (note ${stamp})` }); out.notes_added++; }
      } else {
        const column = p.s.type === 'new_target' || p.s.type === 'target' ? 'research_notes' : 'decision_makers';
        await queueOn(p.s, (get, set) => {
          const old = get(column) || '';
          if (!old.split('\n').some(l => l.replace(/^\(\d+\/\d+\) /, '').toLowerCase().startsWith(p.name.toLowerCase()))) set(column, appendLine(old, column === 'research_notes' ? `Person: ${line}` : line));
        });
      }
    }

    // 3. Intel + ownership.
    for (const f of intake.facts) {
      await queueOn(f.s, (get, set) => {
        const text = f.column === 'research_notes' ? `(${stamp}) ${f.field.replace(/_/g, ' ')}: ${f.text}` : SINGLE_VALUED.has(f.column) ? f.text : `(${stamp}) ${f.text}`;
        set(f.column, SINGLE_VALUED.has(f.column) ? text : appendLine(get(f.column), text));
        if (f.due_date) set('next_action_date', f.due_date);
      });
      out.intel++;
    }
    for (const o of intake.ownership) {
      const fields = Object.fromEntries(['owner_team', 'co_owner_name', 'no_double_touch'].filter(k => o[k] !== null).map(k => [k, o[k]]));
      if (!Object.keys(fields).length) continue;
      if (o.s.type === 'partner') {
        try { await signal(o.s.id, { type: 'assign', ...fields }); out.ownership++; }
        catch (e) { if (!(e instanceof SignalError && e.status === 409 && /already/.test(e.message))) throw e; }
        continue;
      }
      await queueOn(o.s, (get, set) => {
        for (const [k, v] of Object.entries(fields)) set(k, v);
        if (o.s.type === 'opportunity' || o.s.type === 'account') set('notes', appendLine(get('notes'), `(${stamp}) ownership from note ${note.id}`));
      });
      out.ownership++;
    }

    // 4. "Add this note to <X>".
    for (const c of intake.companies) {
      if (c.action !== 'note') continue;
      const line = `From note ${stamp}${note.title ? ` "${note.title}"` : ''}: ${c.evidence || 'mentioned'}`;
      if (c.m.type === 'partner') { await signal(c.m.id, { type: 'note', note: line }); out.notes_added++; continue; }
      await queueOn(c.m, (get, set) => set(c.m.type === 'target' ? 'research_notes' : 'notes', appendLine(get(c.m.type === 'target' ? 'research_notes' : 'notes'), `(${stamp}) ${line}`)));
      out.notes_added++;
    }

    queueDealFields(intake, (p, apply) => queue('sales_goals', p.id, p, apply), note.call_date, out);

    for (const p of pending.values()) {
      const cols = Object.keys(p.patch);
      if (!cols.length) continue;
      let q = supabase.from(p.table).update({ ...p.patch, updated_at: now.toISOString() }).eq('id', p.id);
      for (const c of cols) q = p.row[c] == null ? q.is(c, null) : q.eq(c, p.row[c]);
      const rows = must(await q.select('id'));
      if (!rows.length) throw err(409, `${p.row.name || p.row.organization} changed since the review - reload and accept again`);
      const back = Object.fromEntries(cols.map(c => [c, p.row[c] ?? null]));
      undo.push(() => supabase.from(p.table).update(back).eq('id', p.id));
    }

    // 5. Touches with no stage move (facts, deduped against what's recorded now).
    const goalIds = [...new Set(intake.touches.map(t => t.s.id))];
    const recorded = goalIds.length ? must(await supabase.from('sales_partner_events').select('goal_id, event, at, contact_names, touch_type, source').eq('business_id', businessId).eq('event', 'touch').in('goal_id', goalIds)) : [];
    const dedupe = touchDedupe(recorded);
    const staged = [];
    for (const t of intake.touches) {
      const hit = t.people.length ? t.people.map(n => dedupe.prior(t.s.id, n, null, t.date)).find(Boolean) : dedupe.priorOfType(t.s.id, t.touch_type, t.date);
      if (hit) { out.touches_skipped.push({ key: t.key, partner: t.s.name, reason: `already recorded ${hit.date}${hit.source !== 'manual' ? ` via ${hit.source}` : ''}` }); continue; }
      if (t.stage) { staged.push(t); continue; }
      const { event } = await signal(t.s.id, { type: 'touch', touch_type: t.touch_type, date: t.date, contacts: t.people, ...(t.note ? { note: t.note } : {}), move_to: 'none' });
      out.touches.push({ key: t.key, partner: t.s.name, event_id: event.id });
    }

    // 6. To-dos: the reviewed tasks, then one research to-do per new target.
    const research = out.targets.filter(t => t.status === 'researching').map(t => ({
      payload: { text: `Research ${t.name}`, owner_user_id: userId, due_date: addDays(today, RESEARCH_DUE_DAYS), link_type: 'target', link_id: t.id }, steps: [],
    }));
    const all = [...taskRows, ...research];
    if (all.length) {
      const goals = must(await supabase.from('sales_week_goals').insert(all.map((r, i) => ({
        business_id: businessId, week_start: week, kind: 'todo', status: 'open', ...r.payload,
        category, source_note_id: note.id, sort_order: i, created_by: userId,
      }))).select());
      undo.push(() => supabase.from('sales_week_goals').delete().in('id', goals.map(g => g.id)));
      goals.sort((a, b) => a.sort_order - b.sort_order);
      const steps = all.flatMap((r, i) => r.steps.map((s, n) => ({ business_id: businessId, goal_id: goals[i].id, text: s, sort_order: n })));
      if (steps.length) must(await supabase.from('sales_week_goal_steps').insert(steps));
      out.goals = goals;
    }

    // 7. Decisions (partner note events) and what they owe us (waiting rows).
    await writeDeal(supabase, intake, { businessId, userId, note, week, category, signal, undo, must, out });
  } catch (e) {
    for (const f of undo.reverse()) { try { await f(); } catch (u) { console.error('[call-notes/accept] undo failed:', u.message); } }
    throw e;
  }

  // 8. Stage moves, last. Each touch carries its own move (dated on the
  // touch, never backwards, expect = the stage the review showed).
  for (const t of intake.touches.filter(x => x.stage && !out.touches_skipped.some(s => s.key === x.key))) {
    try {
      const { event } = await applyPartnerSignal(supabase, { businessId, goalId: t.s.id, signal: { type: 'touch', touch_type: t.touch_type, date: t.date, contacts: t.people, ...(t.note ? { note: t.note } : {}), move_to: t.stage, expect: t.expect }, byUser: userId, now, meta });
      out.touches.push({ key: t.key, partner: t.s.name, event_id: event.id });
      out.stage_moves.push({ key: t.key, partner: t.s.name, to: event.to_status, ok: true });
    } catch (e) {
      // The touch still happened; only the move is refused.
      out.stage_moves.push({ key: t.key, partner: t.s.name, to: t.stage, ok: false, error: e.message });
      try {
        const { event } = await applyPartnerSignal(supabase, { businessId, goalId: t.s.id, signal: { type: 'touch', touch_type: t.touch_type, date: t.date, contacts: t.people, ...(t.note ? { note: t.note } : {}), move_to: 'none' }, byUser: userId, now, meta });
        out.touches.push({ key: t.key, partner: t.s.name, event_id: event.id });
      } catch (e2) { out.touches_skipped.push({ key: t.key, partner: t.s.name, reason: e2.message }); }
    }
  }
  return out;
}
