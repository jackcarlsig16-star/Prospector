import { MODELS, estimateCostUsd } from '../../src/config/models.js';
import { hasPii, cleanText } from '../sales/scrubText.js';
import { laDateString } from '../sales/laDate.js';
import { laStartOfDayMs } from '../sales/goalsShared.js';
import { scoutDeps, getScoutSupabase } from './registry.js';
import { buildContext } from './retrieve.js';

// scout-v2 REV2 Stage 1 (D1 POST, D4, D5) - POST /api/scout/ask { q, scope, thread?, filters? } -> { answer_md, items,
// usage, context_stats }. The server builds everything (retrieve.js) and calls Claude once with a SERVER system prompt:
// MODELS.STANDARD, max_tokens MAX_TOKENS, thinking off, callType 'scout_ask' -> a usage row with the observed cost. The
// model cites records as [rN] labels; the server resolves them to items (unknown labels dropped). The answer is
// hasPii-checked: one that trips is withheld and counted. DAILY_CAP asks per user per LA day -> 429.
export const DAILY_CAP = 40; // REVISABLE (spec D4)
export const MAX_TOKENS = 1200;
export const LIST_MAX = 15; // records named in the prose; the rest ride in the table (Jack, Stage 3)
export const CALL_TYPE = 'scout_ask';
export const Q_MAX = 500, THREAD_MAX = 6, TURN_MAX = 2000;
export const SYSTEM = [
  'You are Scout, the assistant inside Prospector, a sales workspace. You answer questions about the user\'s own records.',
  'Answer ONLY from the CONTEXT lines in the user message. Each line is one record: a label like [r1] followed by its fields.',
  'When the user says "show me" or asks for a list, reply with a short list, one line per record, and cite each record with its label exactly as written, like [r3]. Cite a record whenever you rely on it.',
  `List at most ${LIST_MAX} records in the prose; when more match, end with one line "+ n more (in the table): " followed by the remaining labels only, like "+ 3 more (in the table): [r16] [r17] [r18]".`,
  'Sort as asked (date, score, heat) and say which sort you used. Otherwise keep the context\'s order.',
  'Never invent a record, a number, a date or a contact detail. Email addresses and phone numbers are never in the context; never guess one.',
  'If the context does not hold what was asked, say so plainly and name the filter, chip, window or workspace that would find it.',
  'Plain prose or bullets. No headings. No em dashes or en dashes: use a comma or a colon instead.',
].join('\n');
const TOKEN = /\[(r\d+)\]/g;
export const askDeps = { callAnthropic: null, now: () => Date.now() };

export async function asksToday(supabase, userId, now = Date.now()) {
  const since = new Date(laStartOfDayMs(laDateString(new Date(now)))).toISOString();
  const { count, error } = await supabase.from('business_anthropic_usage').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('call_type', CALL_TYPE).gte('created_at', since);
  if (error) throw new Error(error.message);
  return count || 0;
}

// The model's text -> { answer_md, items }: known labels become the record's title, unknown ones are dropped. The
// "+ n more (in the table): [r16] …" line keeps its words; its labels join the items (the table) but not the prose.
const MORE = /^(\s*\+\s*\d+\s+more\s*\(in the table\))\s*:?\s*(.*)$/im;
export function resolveRefs(text, items) {
  const used = new Map();
  const more = MORE.exec(text);
  const body = more ? text.replace(MORE, '$1') : text;
  const answer = body.replace(TOKEN, (m, label) => {
    const it = items.get(label);
    if (!it) return '';
    if (!used.has(label)) used.set(label, it);
    return it.title;
  }).replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' ');
  for (const [, label] of (more?.[2] || '').matchAll(TOKEN)) { const it = items.get(label); if (it && !used.has(label)) used.set(label, it); }
  return { answer_md: answer.trim(), items: [...used.values()] };
}

export function validateAsk(body = {}) {
  const q = typeof body.q === 'string' ? body.q.trim() : '';
  if (q.length < 2) return { error: 'q is required' };
  if (q.length > Q_MAX) return { error: `q is too long (max ${Q_MAX} characters)` };
  const thread = Array.isArray(body.thread) ? body.thread.slice(-THREAD_MAX) : [];
  if (!thread.every(t => t && ['user', 'assistant'].includes(t.role) && typeof t.content === 'string')) return { error: 'thread must be [{ role: user|assistant, content }]' };
  const scope = body.scope === 'all' ? 'all' : typeof body.scope === 'string' && body.scope ? body.scope : null;
  return { q, thread: thread.map(t => ({ role: t.role, content: cleanText(t.content, TURN_MAX) })), scope };
}

export async function ask(supabase, registry, { auth, body, now = askDeps.now() }) {
  const v = validateAsk(body);
  if (v.error) return { status: 400, body: { error: v.error } };
  const scope = v.scope || auth.roles.keys().next().value || 'all';
  if (scope !== 'all' && !auth.isPlatformOwner && !auth.roles.has(scope)) return { status: 403, body: { error: 'You are not in that workspace' } };
  const n = await asksToday(supabase, auth.user.id, now);
  if (n >= DAILY_CAP) return { status: 429, body: { error: `Scout has answered ${DAILY_CAP} questions for you today. It opens again tomorrow.`, cap: DAILY_CAP, used: n } };
  let ctx;
  try { ctx = await buildContext(supabase, registry, { auth, scope, q: v.q, now }); }
  catch (e) { if (e.status) return { status: e.status, body: { error: e.message } }; throw e; }
  const system = `${SYSTEM}\n\nToday is ${laDateString(new Date(now))} (Pacific).${ctx.glossary.length ? `\n\nHouse vocabulary:\n${ctx.glossary.map(l => `- ${l}`).join('\n')}` : ''}`;
  const user = `${v.q}\n\nFilters I read from the question: ${JSON.stringify({ mine: ctx.ask.mine, entity: ctx.ask.entity, since: ctx.ask.since, until: ctx.ask.until, band: ctx.ask.band, source: ctx.ask.source, sort: ctx.ask.sort, company: ctx.ask.company })}\n\nCONTEXT (${ctx.lines.length} lines${ctx.stats.truncated ? `, ${ctx.stats.truncated} more cut by the size cap` : ''}):\n${ctx.pack || '(nothing matched)'}`;
  const messages = [...v.thread.filter((t, i, a) => !(i === 0 && t.role === 'assistant')), { role: 'user', content: user }];
  if (!askDeps.callAnthropic) askDeps.callAnthropic = (await import('../businesses/shared.js')).callAnthropic;
  const data = await askDeps.callAnthropic({ system, messages, max_tokens: MAX_TOKENS, thinking: false, model: MODELS.STANDARD, supabase, businessId: scope === 'all' ? null : scope, userId: auth.user.id, callType: CALL_TYPE, timeoutMs: 60000 });
  let text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').replace(/[—–]/g, '-');
  // Checked after the [rN] labels become titles (the shown text).
  let { answer_md, items } = resolveRefs(text, ctx.items);
  const withheld = hasPii(answer_md);
  if (withheld) { answer_md = 'Answer withheld: it contained an address or phone number.'; items = []; }
  const usage = { input_tokens: data.usage?.input_tokens ?? null, output_tokens: data.usage?.output_tokens ?? null, cost_usd: data.usage ? estimateCostUsd(MODELS.STANDARD, data.usage) : null };
  return { status: 200, body: { answer_md, items, usage, withheld, ask: { mine: ctx.ask.mine, entity: ctx.ask.entity, since: ctx.ask.since, until: ctx.ask.until, since_kind: ctx.ask.since_kind, band: ctx.ask.band, source: ctx.ask.source, sort: ctx.ask.sort, company: ctx.ask.company }, context_stats: ctx.stats, scope, cap: { used: n + 1, max: DAILY_CAP } } };
}

export async function askRoute(req, res) {
  try {
    const r = await ask(await getScoutSupabase(), scoutDeps.registry(), { auth: req.auth, body: req.body || {} });
    res.status(r.status).json(r.body);
  } catch (e) { res.status(500).json({ error: e.message }); }
}
