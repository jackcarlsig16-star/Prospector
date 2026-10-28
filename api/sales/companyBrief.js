import { getSupabase } from './goalsShared.js';
import { cleanText } from './scrubText.js';
import { companyDetail } from './companyPanel.js';
import { breakdownLines, SOURCE_ORDER } from './intentScore.js';
import { recomputeScores } from './intentScoreRun.js';
import { recordFunnel } from './stageMarks.js';
import { ALL_STAGES } from './sourceFunnel.js';
import { SOURCE_LABEL } from '../../src/constants/leadSources.js';

// intent-score-v1 S3 Brief - ONE server-built block per company: score + breakdown, source + referrer, visits + pages,
// people (names + titles only), research findings, open tasks, last touches, the suggested next step. Every line has
// a ref (B1, B2, ...) so a Write email draft (S7) can trace each claim to a line; no address or phone ever passes
// (companyDetail scrubs, and every line passes cleanText again). Scout and the HK connector call the same route.
export const BRIEF_TYPES = ['partner', 'employer', 'target'];
const TABLE = { partner: 'sales_goals', employer: 'sales_opportunities', target: 'sales_targets' };
const STEP_LABEL = { research: 'Run research', site: 'Confirm the site', size: 'Add the headcount', owner: 'Pick an owner', add: 'Add to the pipeline', touch: 'Make the first touch' };
const SOURCE_WORD = { upside: 'Brad / Upside', partner_referral: 'Partner referral', person_referral: 'Person referral', campaign: 'Campaign', website: 'Website', inbound: 'Inbound', homelover_outreach: 'HomeLover outreach', scout: 'Scout', other: 'Other' };
const RESEARCH_LINES = [['why_homelover', 'Why HomeLover'], ['first_angle', 'First angle'], ['housing_perk', 'Housing perk'], ['titles', 'Titles to reach'], ['sells_to', 'Sells to'], ['watch_outs', 'Watch out'], ['recent_news', 'Recent news'], ['summary', 'Summary']];
const PEOPLE_MAX = 8, TASKS_MAX = 5, TOUCHES_MAX = 3;
const DAY = 864e5;
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const reply = (status, body) => ({ status, body });
const md = d => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : null);
export const sourceLabelOf = label => SOURCE_WORD[label] || SOURCE_LABEL[label] || label;

// Pure: the lines from the pieces the route loaded. Exported for the compose lint's tests.
export function briefLines({ type, name, score, meta = {}, sourceRow = {}, sourcePartner = null, journey = null, detail = {}, now = Date.now() }) {
  const lines = [];
  const push = (kind, text) => { const t = cleanText(String(text || ''), 400); if (t) lines.push({ ref: `B${lines.length + 1}`, kind, text: t }); return lines[lines.length - 1]; };
  push('company', `${name} · ${type}${meta.stage ? ` · stage ${String(meta.stage).replace(/_/g, ' ')}` : ''}${meta.owner ? ` · owner ${meta.owner}` : ' · unassigned'}${meta.employees != null ? ` · ${Number(meta.employees).toLocaleString('en-US')} employees` : ''}`);
  if (score) {
    push('score', `Intent ${score.score} · ${score.band}${score.closed ? ' · closed' : ''}${score.flagged_out ? ' · live' : ''}`);
    for (const l of breakdownLines(score)) push('score', l);
  }
  const srcLabel = score?.source_label || (SOURCE_ORDER.includes(sourceRow.source_kind) ? sourceRow.source_kind : 'other');
  const who = [sourcePartner, sourceRow.source_person, sourceRow.source_office].filter(Boolean).join(' · ');
  push('source', `Source: ${sourceLabelOf(srcLabel)}${who ? ` · ${who}` : ''}${sourceRow.source_note ? ` · ${sourceRow.source_note}` : ''}`);
  if (meta.owner_team === 'upside' || meta.owner_team === 'both' || sourceRow.no_double_touch) push('source', `Upside-owned${sourceRow.co_owner_name ? ` with ${sourceRow.co_owner_name}` : ''}${sourceRow.no_double_touch ? ' · no double touch (coordinate before any outreach)' : ''}`);
  if (journey) push('source', `Journey: ${journey}`);
  if (meta.visits_7d != null) {
    const v = detail.visits?.[0] || {};
    const pages = (v.top_paths || []).slice(0, 3).map(p => p.path || p).filter(Boolean);
    push('visit', `Visited ${meta.visits_7d} time${meta.visits_7d === 1 ? '' : 's'} in 7 d${meta.unique_visitors_7d != null ? ` · ${meta.unique_visitors_7d} unique visitors` : ''}${pages.length ? ` · pages ${pages.join(', ')}` : ''}${meta.last_visit ? ` · last ${md(meta.last_visit)}` : ''}`);
  }
  for (const p of (detail.people || []).slice(0, PEOPLE_MAX)) push('person', `${p.name}${p.title ? ` — ${p.title}` : ''}${p.source === 'web_visit' || p.identified ? ' (identified visitor)' : ''}`);
  const done = (detail.research?.runs || []).find(r => r.status === 'done' && r.result);
  if (done) {
    const age = Math.round((now - Date.parse(done.created_at)) / DAY);
    push('research', `Researched ${md(done.created_at)} (${age} d ago)`);
    for (const [k, label] of RESEARCH_LINES) if (done.result[k]) push('research', `${label}: ${done.result[k]}`);
  } else push('research', 'Not researched yet');
  for (const t of (detail.todos || []).slice(0, TASKS_MAX)) push('task', `Open to-do: ${t.text}${t.due_date ? ` · due ${md(t.due_date)}` : ''}${t.owner ? ` · ${t.owner}` : ''}`);
  if (meta.last_touch_at) {
    const days = Math.max(0, Math.round((now - Date.parse(meta.last_touch_at)) / DAY));
    push('touch', `Last touch: ${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`}${meta.last_touch_who || meta.last_touch_channel ? ` (${[meta.last_touch_who, meta.last_touch_channel].filter(Boolean).join(', ')})` : ''}`);
  } else push('touch', 'Never touched');
  for (const r of (detail.recent || []).slice(0, TOUCHES_MAX)) push('touch', r.text || r.note || (r.event === 'status' ? `Stage ${r.from_status || '?'} → ${r.to_status || '?'}` : r.event === 'touch' ? `${r.touch_type || 'touch'} ${md(r.at)}` : r.event));
  const next = detail.steps?.next;
  if (next) push('next', `Suggested next step: ${STEP_LABEL[next] || next}`);
  return lines;
}

export function briefMarkdown(name, lines) {
  return [`# Brief: ${name}`, ...lines.map(l => `- [${l.ref}] ${l.text}`), '', 'Use only these lines as facts; cite the ref of any line you rely on.'].join('\n');
}

export async function companyBrief(supabase, { businessId, type, id, now = Date.now() }) {
  if (!BRIEF_TYPES.includes(type)) return reply(400, { error: `type must be one of ${BRIEF_TYPES.join('|')}` });
  const d = await companyDetail(supabase, { businessId, type, id, now: new Date(now) });
  if (d.status !== 200) return d;
  const detail = d.body;
  let score = must(await supabase.from('sales_company_scores').select('*').eq('business_id', businessId).eq('company_type', type).eq('company_id', id).maybeSingle());
  if (!score) {
    const r = await recomputeScores(supabase, { businessId, trigger: 'manual', now, only: { type, id } });
    score = r.rows[0] || null;
  }
  const sourceRow = must(await supabase.from(TABLE[type]).select('source_kind, source_partner_id, source_person, source_office, source_note, co_owner_name, no_double_touch').eq('business_id', businessId).eq('id', id).maybeSingle()) || {};
  const sourcePartner = sourceRow.source_partner_id ? (must(await supabase.from('sales_goals').select('name').eq('id', sourceRow.source_partner_id).maybeSingle())?.name || null) : null;
  // brad-attribution-v1 F5: the chain as one ref line, only once some stage has a date.
  const { journey: chain, funnel } = await recordFunnel(supabase, { businessId, type, id });
  const journey = ALL_STAGES.some(s => funnel[s]) ? chain : null;
  const meta = score?.components?.meta || {};
  const name = detail.record?.name || meta.name || type;
  const lines = briefLines({ type, name, score, meta, sourceRow, sourcePartner, journey, detail, now });
  return reply(200, {
    company: { type, id, name }, score: score ? { score: score.score, band: score.band, closed: score.closed, flagged_out: score.flagged_out, source_label: score.source_label, computed_at: score.computed_at } : null,
    upside_owned: meta.owner_team === 'upside' || meta.owner_team === 'both', no_double_touch: !!sourceRow.no_double_touch,
    next_step: detail.steps?.next ? STEP_LABEL[detail.steps.next] || detail.steps.next : null,
    lines, markdown: briefMarkdown(name, lines),
  });
}
export async function briefRoute(req, res) {
  const r = await companyBrief(getSupabase(), { businessId: req.params.businessId, type: req.params.type, id: req.params.id });
  res.status(r.status).json(r.body);
}
