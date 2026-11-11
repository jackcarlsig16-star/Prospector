import { MODELS, estimateCostUsd } from '../../src/config/models.js';
import { hasPii, cleanText } from '../sales/scrubText.js';
import { laDateString } from '../sales/laDate.js';
import { laStartOfDayMs } from '../sales/goalsShared.js';
import { scoutDeps, getScoutSupabase } from './registry.js';
import { buildContext } from './retrieve.js';
import { cancelPlans } from './actions.js';

// scout-v2 REV2 Stage 1 (D1 POST, D4, D5) - POST /api/scout/ask { q, scope, thread?, filters? } -> { answer_md, items,
// usage, context_stats }. The server builds everything (retrieve.js) and calls Claude once with a SERVER system prompt:
// MODELS.STANDARD, max_tokens MAX_TOKENS, thinking off, callType 'scout_ask' -> a usage row with the observed cost. The
// model cites records as [rN] labels; the server resolves them to items (unknown labels dropped). The answer is
// hasPii-checked: one that trips is withheld and counted. DAILY_CAP asks per user per LA day -> 429.
export const DAILY_CAP = 40; // REVISABLE (spec D4)
export const MAX_TOKENS = 1200;
export const LIST_MAX = 15; // records named in the prose; the rest ride in the table (Jack, Stage 3)
export const CALL_TYPE = 'scout_ask';
export const Q_MAX = 500, THREAD_MAX = 6, TURN_MAX = 2000, ACTIONS_MAX = 5;
export const SYSTEM = [
  'You are Scout, the assistant inside Prospector, a sales workspace. You answer questions about the user\'s own records.',
  'Answer ONLY from the CONTEXT lines in the user message. Each line is one record: a label like [r1] followed by its fields.',
  'When the user says "show me" or asks for a list, reply with a short list, one line per record, and cite each record with its label exactly as written, like [r3]. Cite a record whenever you rely on it.',
  `List at most ${LIST_MAX} records in the prose; when more match, end with one line "+ n more (in the table): " followed by the remaining labels only, like "+ 3 more (in the table): [r16] [r17] [r18]".`,
  'Sort as asked (date, score, heat) and say which sort you used. Otherwise keep the context\'s order.',
  'Never invent a record, a number, a date or a contact detail. Email addresses and phone numbers are never in the context; never guess one.',
  'If the context does not hold what was asked, say so plainly and say what was read. Never direct the user to a screen, page, view, chip or filter: answer from the context, and when it lacks the answer, say what was read.',
  'When the context opens with "No specific read matched", say in one sentence what was read, that nothing in it answers the question, and offer the example phrasings from that line, as "Try: ...".',
  'Plain prose or bullets. No headings. No em dashes or en dashes: use a comma or a colon instead.',
  // scout-v3 S3: the rows are shown as a table under the answer, so the prose never restates them.
  'Name each record once. Never write "---". Do not add a "Records" list: the cited records are shown as rows.',
].join('\n');
// scout-v3 D2: a multi-part ask - one summary sentence, then one "@@ n" block per part, in order, holding only that
// part's labels (the server renders them as the section's rows with its count and rule) or one line when it has none.
export const PARTS_RULE = n => [
  `This question has ${n} parts; the context is grouped as PART 1 … PART ${n}.`,
  'First write ONE sentence that names the parts and how many records each has. Do not name any record in it.',
  `Then, for each part in order, write a line with only "@@" and the part number (like "@@ 1"), and under it that part's record labels in the order asked, like "[r1] [r4] [r2]", at most the count the part asks for (else at most ${LIST_MAX}). Use labels from that part only.`,
  'A part with no rows gets one plain line under its "@@" line saying what was read and that nothing matched. Never answer a part from another part\'s rows.',
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

// scout-v3 D2: the model's text + the context's parts -> { summary, sections: [{ title, count, rule, read, rows, line,
// brief }] } and the flat answer_md / items the thread keeps. One part: the answer is the summary and its cited records
// are the one section's rows. Several: each "@@ n" block's labels are that section's rows (labels of another part are
// dropped; a block that cites none falls back to the part's own rows); count, rule and read come from the intents.
const BLOCK = /^[ \t]*@@[ \t]*(\d+)[ \t]*$/m;
export function sectioned(text, ctx) {
  const meta = p => ({ title: p.title || cleanText(p.q, 80), count: p.count, rule: p.rule, read: p.read, brief: p.brief });
  if (ctx.parts.length < 2) {
    const r = resolveRefs(text, ctx.items), p = ctx.parts[0];
    return { ...r, summary: r.answer_md, sections: [{ ...meta(p), count: r.items.length, total: Math.max(p.count, r.items.length), rows: r.items, line: null }] };
  }
  const chunks = text.split(new RegExp(BLOCK.source, 'gm'));
  const summary = resolveRefs(chunks[0], new Map()).answer_md;
  const blocks = new Map(); for (let i = 1; i + 1 < chunks.length; i += 2) blocks.set(Number(chunks[i]), chunks[i + 1]);
  const all = new Map();
  const sections = ctx.parts.map((p, i) => {
    const own = new Map(p.labels.map(l => [l, ctx.items.get(l)]));
    const cap = p.ask.limit || LIST_MAX;
    const cited = resolveRefs(blocks.get(i + 1) || '', own).items;
    const rows = (cited.length ? cited : p.labels.map(l => own.get(l))).slice(0, cap);
    for (const r of rows) all.set(`${r.entity}:${r.id}`, r);
    const said = cleanText((blocks.get(i + 1) || '').replace(TOKEN, '').replace(/\s+/g, ' '), 300);
    // the count is the rows shown; total keeps how many matched in all ("5 of 49")
    return { ...meta(p), count: rows.length, total: Math.max(p.count, rows.length), rows, line: rows.length ? null : said || `Nothing matched. Read: ${p.read || 'nothing'}.` };
  });
  const answer_md = [summary, ...sections.map(x => `${x.title} (${x.count})\n${x.rows.length ? x.rows.map(r => `- ${r.title}`).join('\n') : x.line}`)].filter(Boolean).join('\n\n');
  return { answer_md, items: [...all.values()], summary, sections };
}

export function validateAsk(body = {}) {
  const q = typeof body.q === 'string' ? body.q.trim() : '';
  if (q.length < 2) return { error: 'q is required' };
  if (q.length > Q_MAX) return { error: `q is too long (max ${Q_MAX} characters)` };
  const thread = Array.isArray(body.thread) ? body.thread.slice(-THREAD_MAX) : [];
  if (!thread.every(t => t && ['user', 'assistant'].includes(t.role) && typeof t.content === 'string' && (t.actions === undefined || (Array.isArray(t.actions) && t.actions.every(a => typeof a === 'string'))))) return { error: 'thread must be [{ role: user|assistant, content, actions? }]' };
  const scope = body.scope === 'all' ? 'all' : typeof body.scope === 'string' && body.scope ? body.scope : null;
  // D11: an action is a sub-line of the answer it acted on ("→ assigned 3 to Ana · undone"), never its own turn.
  const withActions = t => [cleanText(t.content, TURN_MAX), ...(t.actions || []).slice(-ACTIONS_MAX).map(a => `→ ${cleanText(a, 200)}`)].join('\n');
  return { q, thread: thread.map(t => ({ role: t.role, content: withActions(t) })), scope };
}

export async function ask(supabase, registry, { auth, body, now = askDeps.now() }) {
  const v = validateAsk(body);
  if (v.error) return { status: 400, body: { error: v.error } };
  const scope = v.scope || auth.roles.keys().next().value || 'all';
  if (scope !== 'all' && !auth.isPlatformOwner && !auth.roles.has(scope)) return { status: 403, body: { error: 'You are not in that workspace' } };
  const n = await asksToday(supabase, auth.user.id, now);
  if (n >= DAILY_CAP) return { status: 429, body: { error: `Scout has answered ${DAILY_CAP} questions for you today. It opens again tomorrow.`, cap: DAILY_CAP, used: n } };
  cancelPlans(auth.user.id); // S1: a new ask cancels an open confirm card
  let ctx;
  try { ctx = await buildContext(supabase, registry, { auth, scope, q: v.q, now }); }
  catch (e) { if (e.status) return { status: e.status, body: { error: e.message } }; throw e; }
  const system = `${SYSTEM}\n\nToday is ${laDateString(new Date(now))} (Pacific).${ctx.glossary.length ? `\n\nHouse vocabulary:\n${ctx.glossary.map(l => `- ${l}`).join('\n')}` : ''}`;
  const multi = ctx.parts.length > 1;
  const user = `${v.q}${multi ? `\n\n${PARTS_RULE(ctx.parts.length)}${ctx.parts_cut ? ` The question had ${ctx.parts.length + ctx.parts_cut} parts; say that only the first ${ctx.parts.length} are answered.` : ''}` : ''}\n\nFilters I read from the question: ${JSON.stringify({ mine: ctx.ask.mine, entity: ctx.ask.entity, since: ctx.ask.since, until: ctx.ask.until, band: ctx.ask.band, band_kind: ctx.ask.bandKind, source: ctx.ask.source, sort: ctx.ask.sort, company: ctx.ask.company })}\n\nCONTEXT (${ctx.lines.length} lines${ctx.stats.truncated ? `, ${ctx.stats.truncated} more cut by the size cap` : ''}):\n${ctx.pack || '(nothing matched)'}`;
  const messages = [...v.thread.filter((t, i, a) => !(i === 0 && t.role === 'assistant')), { role: 'user', content: user }];
  if (!askDeps.callAnthropic) askDeps.callAnthropic = (await import('../businesses/shared.js')).callAnthropic;
  const data = await askDeps.callAnthropic({ system, messages, max_tokens: MAX_TOKENS, thinking: false, model: MODELS.STANDARD, supabase, businessId: scope === 'all' ? null : scope, userId: auth.user.id, callType: CALL_TYPE, timeoutMs: 60000 });
  let text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').replace(/[—–]/g, '-');
  // Checked after the [rN] labels become titles (the shown text).
  let { answer_md, items, summary, sections } = sectioned(text, ctx);
  const withheld = hasPii(answer_md) || hasPii(JSON.stringify(sections.map(x => [x.line, x.rows.map(r => [r.title, r.subtitle])])));
  if (withheld) { answer_md = 'Answer withheld: it contained an address or phone number.'; summary = answer_md; items = []; sections = []; }
  const usage = { input_tokens: data.usage?.input_tokens ?? null, output_tokens: data.usage?.output_tokens ?? null, cost_usd: data.usage ? estimateCostUsd(MODELS.STANDARD, data.usage) : null };
  // A6: the usage row has no json column, so the matched intent is logged beside it (the next real-ask report counts misses).
  console.log(`[scout/ask] intent=${ctx.stats.intent} reads=${ctx.stats.reads.length} lines=${ctx.lines.length} tokens=${usage.input_tokens}/${usage.output_tokens} user=${String(auth.user.id).slice(0, 8)}`);
  return { status: 200, body: { answer_md, summary, sections, items, usage, withheld, ask: { mine: ctx.ask.mine, entity: ctx.ask.entity, since: ctx.ask.since, until: ctx.ask.until, since_kind: ctx.ask.since_kind, band: ctx.ask.band, band_kind: ctx.ask.bandKind, source: ctx.ask.source, sort: ctx.ask.sort, company: ctx.ask.company }, context_stats: ctx.stats, scope, cap: { used: n + 1, max: DAILY_CAP } } };
}

export async function askRoute(req, res) {
  try {
    const r = await ask(await getScoutSupabase(), scoutDeps.registry(), { auth: req.auth, body: req.body || {} });
    res.status(r.status).json(r.body);
  } catch (e) { res.status(500).json({ error: e.message }); }
}
