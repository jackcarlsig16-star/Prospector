import { getSupabase } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { isAutoMessage } from './partnerOutlookTouches.js';
import { logFlow, latestFlow } from './flowEvents.js';
import { STAGE_ORDER } from './pipelineStages.js';

// homelover-flow-v1 F7 - a reply moves an EMPLOYER by its context; partners keep applyPartnerSignal (never touched here).
//   - Any reply from someone at an employer at Contacted (an Apollo message marked replied, or a received Outlook mail
//     from the employer's domain, never an auto-reply) -> Responded, automatically, through advanceStage with expect =
//     contacted. Activity "Reply from <company> → Replied", Undo 7 days (flowEvents AUTO_UNDO_WINDOW_MS).
//   - A calendar event (microsoft_events, ruling F-e: external_domains only - external_emails are never read) with an
//     attendee at the employer's domain -> Meeting, only forward, only from Contacted / Responded.
//   - Apollo reply_class only SUGGESTS (never moves): willing_to_meet -> Book the meeting; follow_up_question -> Answer
//     their question; person_referral / not the right person -> Follow the referral; not interested -> Mark lost?.
//     An Outlook reply with no class -> "They replied — what did they say?" (the They replied… sheet, below).
// Every automatic move carries meta.key (one per source message / event; the unique index refuses a repeat), so a
// re-run after an Undo never re-applies it. Reading reply bodies with Claude is NOT in v1.
export const REPLY_OUTCOMES = ['meeting_set', 'interested', 'question', 'not_now', 'not_right_person', 'no'];
export const OUTCOME_WORD = { meeting_set: 'Meeting set', interested: 'Interested', question: 'Question', not_now: 'Not now', not_right_person: 'Not the right person', no: 'No' };
// outcome -> the stage it means (forward only) and the suggestion it leaves on the panel / Due list.
export const OUTCOME_RULE = {
  meeting_set: { stage: 'meeting', suggestion: null },
  interested: { stage: 'responded', suggestion: 'Book the meeting' },
  question: { stage: 'responded', suggestion: 'Answer their question' },
  not_now: { stage: 'responded', suggestion: 'Not now - follow up later' },
  not_right_person: { stage: 'responded', suggestion: 'Follow the referral' },
  no: { stage: 'responded', suggestion: 'Mark lost?' },
};
const CLASS_SUGGESTION = {
  willing_to_meet: 'Book the meeting', follow_up_question: 'Answer their question', person_referral: 'Follow the referral',
  already_left_company_or_not_right_person: 'Follow the referral', not_right_person: 'Follow the referral', not_interested: 'Mark lost?', not_the_right_time: 'Not now - follow up later',
};
export const ASK_WHAT_THEY_SAID = 'They replied — what did they say?';
const FORWARD_FROM = { reply: ['contacted'], meeting: ['contacted', 'responded'] };
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const reply = (status, body) => ({ status, body });
const ahead = (from, to) => STAGE_ORDER.indexOf(from) >= 0 && STAGE_ORDER.indexOf(to) > STAGE_ORDER.indexOf(from);

// The suggestion line for an employer: a They replied… outcome a person chose wins; else Apollo's class on the newest
// reply; else an Outlook reply nobody classified asks what they said. -> { text, action, source } | null
export function replySuggestion({ outcome = null, replyClass = null, outlookReply = false } = {}) {
  if (outcome && OUTCOME_RULE[outcome]) return OUTCOME_RULE[outcome].suggestion ? { text: OUTCOME_RULE[outcome].suggestion, action: outcome === 'no' ? 'mark_lost' : outcome === 'interested' ? 'book_meeting' : 'follow_up', source: 'they_replied' } : null;
  if (replyClass && CLASS_SUGGESTION[replyClass]) return { text: CLASS_SUGGESTION[replyClass], action: replyClass === 'willing_to_meet' ? 'book_meeting' : replyClass === 'not_interested' ? 'mark_lost' : 'follow_up', source: 'apollo' };
  if (outlookReply || replyClass) return { text: ASK_WHAT_THEY_SAID, action: 'they_replied', source: 'outlook' };
  return null;
}

// Pure: the moves the rules would make right now. employers: [{ id, organization, stage, domain }] (live, any stage -
// the rule picks); prospects: [{ contact_id, opportunity_id }]; messages: sales_email_messages [{ apollo_message_id,
// contact_id, replied, replied_at, delivered_at }]; received: microsoft_messages (direction received) [{ graph_id,
// internet_message_id, external_domains, subject, occurred_at }]; events: microsoft_events [{ graph_id, ical_uid,
// external_domains, is_cancelled, start_at }]; applied: Set of keys already in sales_flow_events.
export function employerMoves({ employers = [], prospects = [], messages = [], received = [], events = [], applied = new Set() } = {}) {
  const byId = new Map(employers.map(e => [e.id, e]));
  const byDomain = new Map();
  for (const e of employers) if (e.domain) { if (!byDomain.has(e.domain)) byDomain.set(e.domain, []); byDomain.get(e.domain).push(e); }
  const oppOfContact = new Map(prospects.filter(p => p.opportunity_id).map(p => [p.contact_id, p.opportunity_id]));
  const moves = [], skipped = { already: 0, not_contacted: 0, ambiguous: 0, unmatched: 0, auto: 0, cancelled: 0 };
  const seen = new Set();
  const push = (e, kind, key, at, source) => {
    if (applied.has(key)) { skipped.already++; return; }
    const from = e.stage;
    if (!FORWARD_FROM[kind].includes(from)) { skipped.not_contacted++; return; }
    if (seen.has(e.id)) return; // one move per employer per run; the next run sees the new stage
    seen.add(e.id);
    const to = kind === 'reply' ? 'responded' : 'meeting';
    moves.push({ employer_id: e.id, name: e.organization, from, to, kind: kind === 'reply' ? 'reply_move' : 'meeting_move', key, at, source });
  };
  for (const m of [...messages].filter(m => m.replied).sort((a, b) => String(a.replied_at || a.delivered_at || '').localeCompare(String(b.replied_at || b.delivered_at || '')))) {
    const e = byId.get(oppOfContact.get(m.contact_id));
    if (!e) { skipped.unmatched++; continue; }
    push(e, 'reply', `apollo:${m.apollo_message_id}`, m.replied_at || m.delivered_at || null, 'apollo');
  }
  const oneAtDomain = row => {
    const hits = [...new Set((row.external_domains || []).flatMap(d => byDomain.get(d) || []))];
    if (hits.length > 1) { skipped.ambiguous++; return null; }
    if (!hits.length) { skipped.unmatched++; return null; }
    return hits[0];
  };
  for (const r of [...received].sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)))) {
    if (r.direction && r.direction !== 'received') continue;
    if (isAutoMessage(r)) { skipped.auto++; continue; }
    const e = oneAtDomain(r);
    if (e) push(e, 'reply', `outlook:${r.internet_message_id || r.graph_id}`, r.occurred_at, 'outlook');
  }
  for (const ev of [...events].sort((a, b) => String(a.start_at).localeCompare(String(b.start_at)))) {
    if (ev.is_cancelled) { skipped.cancelled++; continue; }
    const e = oneAtDomain(ev);
    if (e) push(e, 'meeting', `event:${ev.ical_uid || ev.graph_id}`, ev.start_at, 'calendar');
  }
  return { moves, skipped };
}

export async function loadReplyRuleInputs(supabase, businessId) {
  const page = (table, cols, build = q => q) => selectAllPages(() => build(supabase.from(table).select(cols).eq('business_id', businessId)).order(cols.split(',')[0].trim()));
  const employers = await page('sales_opportunities', 'id, organization, stage, domain', q => q.is('archived_at', null).in('stage', ['contacted', 'responded']));
  if (!employers.length) return { employers, prospects: [], messages: [], received: [], events: [], applied: new Set() };
  const prospects = await page('sales_prospect_state', 'contact_id, opportunity_id', q => q.in('opportunity_id', employers.map(e => e.id)));
  const contactIds = prospects.map(p => p.contact_id);
  const [messages, received, events, flows] = await Promise.all([
    contactIds.length ? page('sales_email_messages', 'apollo_message_id, contact_id, replied, replied_at, delivered_at', q => q.in('contact_id', contactIds).eq('replied', true)) : [],
    page('microsoft_messages', 'graph_id, internet_message_id, direction, external_domains, subject, occurred_at', q => q.eq('direction', 'received')),
    page('microsoft_events', 'graph_id, ical_uid, external_domains, is_cancelled, start_at'),
    page('sales_flow_events', 'id, meta, kind', q => q.in('kind', ['reply_move', 'meeting_move'])),
  ]);
  return { employers, prospects, messages, received, events, applied: new Set(flows.map(f => f.meta?.key).filter(Boolean)) };
}

// The runner (after every Outlook sync and every Apollo activity sync; also POST goals/reply-rules/run): applies each
// move through advanceStage with expect = the stage the rule saw (a teammate's move in between = refused, next run
// looks again), logs the flow event with the source key. by_user null = automatic in Activity.
export async function runEmployerReplyRules(supabase, businessId, { now = new Date() } = {}) {
  const { advanceStage } = await import('./companyPanel.js');
  const inputs = await loadReplyRuleInputs(supabase, businessId);
  const { moves, skipped } = employerMoves(inputs);
  const applied = [], refused = [];
  for (const m of moves) {
    const r = await advanceStage(supabase, { businessId, userId: null, type: 'employer', id: m.employer_id, body: { expect: m.from, to: m.to }, now });
    if (r.status !== 200) { refused.push({ employer_id: m.employer_id, key: m.key, reason: r.body?.error || `HTTP ${r.status}` }); continue; }
    try {
      const text = m.kind === 'reply_move' ? `Reply from ${m.name} → Replied` : `Meeting with ${m.name} → Meeting`;
      const ev = await logFlow(supabase, { businessId, recordType: 'employer', recordId: m.employer_id, kind: m.kind, text, prev: { stage: m.from }, set: { stage: m.to }, meta: { key: m.key, source: m.source, at: m.at, name: m.name }, byUser: null, now });
      applied.push({ ...m, event_id: ev.id });
    } catch (e) {
      // The key was already logged (a race with another run): put the stage back so state and history stay in step.
      await supabase.from('sales_opportunities').update({ stage: m.from, updated_at: now.toISOString() }).eq('business_id', businessId).eq('id', m.employer_id).eq('stage', m.to);
      refused.push({ employer_id: m.employer_id, key: m.key, reason: e.message });
    }
  }
  return { applied, refused, skipped, counts: { employers: inputs.employers.length, moves: moves.length, applied: applied.length, refused: refused.length } };
}

// POST goals/reply-rules/run (Member) -> the runner's counts; the names it moved, never an address.
export async function runReplyRulesRoute(req, res) {
  try { res.json(await runEmployerReplyRules(getSupabase(), req.params.businessId)); }
  catch (e) { res.status(500).json({ error: e.message }); }
}

// POST goals/company/employer/:id/they-replied { outcome, expect } -> 200 { stage: { before, after }, suggestion, event }.
// Meeting set -> Meeting; everything else -> Responded (only forward; a record already past it keeps its stage) and the
// outcome's suggestion. Activity + Undo (the flow event restores the stage; the outcome row is undone with it).
export async function theyReplied(supabase, { businessId, userId, id, body, now = new Date() }) {
  const outcome = body?.outcome;
  if (!REPLY_OUTCOMES.includes(outcome)) return reply(400, { error: `outcome must be one of ${REPLY_OUTCOMES.join('|')}` });
  const expect = body?.expect;
  if (typeof expect !== 'string' || !expect) return reply(400, { error: 'expect (the stage on screen) is required' });
  try {
    const { advanceStage } = await import('./companyPanel.js');
    const row = must(await supabase.from('sales_opportunities').select('id, organization, stage').eq('business_id', businessId).eq('id', id).is('archived_at', null).maybeSingle());
    if (!row) return reply(404, { error: 'employer not found' });
    if (row.stage !== expect) return reply(409, { error: 'This changed elsewhere - refresh', code: 'stale_stage' });
    const rule = OUTCOME_RULE[outcome];
    let after = row.stage;
    if (ahead(row.stage, rule.stage)) {
      const r = await advanceStage(supabase, { businessId, userId, type: 'employer', id, body: { expect, to: rule.stage }, now });
      if (r.status !== 200) return r;
      after = rule.stage;
    }
    const suggestion = replySuggestion({ outcome });
    const ev = await logFlow(supabase, { businessId, recordType: 'employer', recordId: id, kind: 'they_replied', text: `They replied · ${OUTCOME_WORD[outcome]}${after !== row.stage ? ` → ${after}` : ''}`, prev: after !== row.stage ? { stage: row.stage } : {}, set: after !== row.stage ? { stage: after } : {}, meta: { outcome, suggestion: suggestion?.text || null, name: row.organization }, byUser: userId, now });
    return reply(200, { stage: { before: row.stage, after }, outcome, suggestion, event: { id: ev.id } });
  } catch (e) { return reply(e.status || 500, { error: e.message }); }
}
export async function theyRepliedRoute(req, res) {
  const r = await theyReplied(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, id: req.params.id, body: req.body });
  res.status(r.status).json(r.body);
}

// GET goals/company/employer/:id/reply-suggestion -> { suggestion, reply_class, outlook_reply, outcome } for the
// panel's Next step card and the Due list.
export async function replySuggestionFor(supabase, businessId, id) {
  const [outcomeEv, prospects, row] = await Promise.all([
    latestFlow(supabase, businessId, 'employer', id, ['they_replied']),
    selectAllPages(() => supabase.from('sales_prospect_state').select('contact_id').eq('business_id', businessId).eq('opportunity_id', id).order('contact_id')),
    supabase.from('sales_opportunities').select('id, domain').eq('business_id', businessId).eq('id', id).maybeSingle().then(must),
  ]);
  if (!row) return reply(404, { error: 'employer not found' });
  const ids = prospects.map(p => p.contact_id);
  const msgs = ids.length ? await selectAllPages(() => supabase.from('sales_email_messages').select('apollo_message_id, contact_id, replied, replied_at, reply_class').eq('business_id', businessId).in('contact_id', ids).eq('replied', true).order('apollo_message_id')) : [];
  const newest = msgs.sort((a, b) => String(b.replied_at || '').localeCompare(String(a.replied_at || '')))[0] || null;
  let outlookReply = false;
  if (row.domain) {
    const recent = must(await supabase.from('microsoft_messages').select('graph_id, subject, external_domains').eq('business_id', businessId).eq('direction', 'received').order('occurred_at', { ascending: false }).limit(500));
    outlookReply = recent.some(m => (m.external_domains || []).includes(row.domain) && !isAutoMessage(m));
  }
  return reply(200, { suggestion: replySuggestion({ outcome: outcomeEv?.meta?.outcome || null, replyClass: newest?.reply_class || null, outlookReply }), reply_class: newest?.reply_class || null, outlook_reply: outlookReply, outcome: outcomeEv?.meta?.outcome || null });
}
export async function replySuggestionRoute(req, res) {
  try { const r = await replySuggestionFor(getSupabase(), req.params.businessId, req.params.id); res.status(r.status).json(r.body); }
  catch (e) { res.status(500).json({ error: e.message }); }
}
