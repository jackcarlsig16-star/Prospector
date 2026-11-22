import { MODELS, estimateCostUsd } from '../../src/config/models.js';
import { hasPii, cleanText } from '../sales/scrubText.js';
import { laDateString } from '../sales/laDate.js';
import { laStartOfDayMs } from '../sales/goalsShared.js';
import { scoutDeps, getScoutSupabase } from './registry.js';
import { buildContext } from './retrieve.js';
import { cancelPlans } from './actions.js';
import { resolveFollowUp, resolvedLine } from './followUp.js';

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
export const ROWS_MAX = 200, CANDIDATES_MAX = 8;
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
  // scout-v3.1 C6: the label IS the name on screen.
  'A label like [r3] is shown to the user as that record\'s name. So never write a record\'s name next to its label: write the label alone, where the name would go.',
  // app-shell-v2 W3: a to-do's label is shown as the to-do's whole text.
  'A to-do\'s label is shown to the user as the to-do\'s full text. After a to-do\'s label write only what that text does not already say (its due date, its owner, its steps): never repeat, quote or rephrase the to-do\'s text.',
  // fathom-notes-v1 F-10: call notes no member has accepted yet are marked in the context.
  'A context line marked "unreviewed" comes from call notes nobody has accepted yet: write "(unreviewed)" next to anything you take from it.',
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
  const once = onceEach(answer, [...used.values()].map(it => it.title));
  return { answer_md: onceText(once, [...used.values()].filter(it => it.row?.text)).trim(), items: withMore(more, items, used) };
}
// app-shell-v2 W3 post-pass: a record whose title IS its text (a to-do) was cited and then said again in other words
// ("<the to-do> Ask Brad for 15 minutes, due Oct 8") - the clauses after the title that only repeat the record's own
// words go; what the title does not say (due, owner, steps) stays.
const WORDS = /[a-z0-9']+/g, CLAUSE = /(?=[,;:.]\s|\s[-·]\s)/, FACT = /^\W*(due|overdue|no date|mine|unassigned|another owner|open|\d+\s*\/\s*\d+)\b/i;
export function onceText(text, records) {
  let out = text;
  for (const rec of records) {
    const own = new Set(String(rec.row.text).toLowerCase().match(WORDS) || []);
    if (!rec.title || own.size < 3) continue;
    out = out.split('\n').map(line => {
      const at = line.indexOf(rec.title);
      if (at < 0) return line;
      const wrap = /^(\*\*|__)?/.exec(line.slice(at + rec.title.length))[0];
      const cut = at + rec.title.length + wrap.length;
      const clauses = line.slice(cut).split(CLAUSE);
      const echo = c => { const w = c.toLowerCase().match(WORDS) || []; return w.length > 0 && !FACT.test(c) && w.filter(x => own.has(x)).length >= Math.ceil(w.length * 0.8); };
      let i = 0;
      while (i < clauses.length && echo(clauses[i])) i += 1;
      return i ? `${line.slice(0, cut)}${clauses.slice(i).join('')}` : line;
    }).join('\n');
  }
  return out;
}
const withMore = (more, items, used) => { for (const [, label] of (more?.[2] || '').matchAll(TOKEN)) { const it = items.get(label); if (it && !used.has(label)) used.set(label, it); } return [...used.values()]; };
// C6 post-pass: the model wrote the name and then cited it ("Dana Mayer [r1]" -> "Dana Mayer Dana Mayer") - the name
// stays once, with whatever wrapped the first one (bold, a list dash).
export function onceEach(text, titles) {
  let out = text;
  for (const t of [...new Set(titles)].filter(x => x && x.length > 2).sort((a, b) => b.length - a.length)) {
    const e = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(\\*\\*|__)?${e}(\\*\\*|__)?[ \\t]*[:,(\\-–·]?[ \\t]*\\(?${e}\\)?`, 'g'), (m, a = '', b = '') => `${a}${t}${b}`);
  }
  return out;
}

// app-shell-v2 W3 (scout-v3 S3, enforced): a list of records whose title IS their text (to-dos) is shown as its rows,
// so the summary keeps what the model said about the list and drops the lines that only say a row again (and the
// "+ n more" line - the rows carry the count). answer_md keeps them: it is the thread's memory, not the screen.
export function withoutRowLines(text, rows) {
  const titles = rows.filter(r => r.row?.text).map(r => r.title);
  if (titles.length < 2) return text;
  const said = line => { const l = line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/^(\*\*|__)/, ''); return titles.some(t => l.startsWith(t)); };
  const out = text.split('\n').filter(line => !said(line) && !/^\s*\+\s*\d+\s+more\s*\(in the table\)/i.test(line)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return out || 'Listed below.';
}

// scout-v3 D2: the model's text + the context's parts -> { summary, sections: [{ title, count, rule, read, rows, line,
// brief }] } and the flat answer_md / items the thread keeps. One part: the answer is the summary and its cited records
// are the one section's rows. Several: each "@@ n" block's labels are that section's rows (labels of another part are
// dropped; a block that cites none falls back to the part's own rows); count, rule and read come from the intents.
const BLOCK = /^[ \t]*@@[ \t]*(\d+)[ \t]*$/m;
export function sectioned(text, ctx) {
  const meta = p => ({ title: p.title || cleanText(p.q, 80), count: p.count, rule: p.rule, read: p.read, brief: p.brief, ...(p.fill ? { fill: p.fill } : {}) });
  if (ctx.parts.length < 2) {
    const r = resolveRefs(text, ctx.items), p = ctx.parts[0];
    return { ...r, summary: withoutRowLines(r.answer_md, r.items), sections: [{ ...meta(p), count: r.items.length, total: Math.max(p.count, r.items.length), rows: r.items, line: null }] };
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
  // scout-v3.1 C1: the rows of the answer on screen (every section, in display order), so a follow-up can point at them.
  const rowsOf = list => (Array.isArray(list) ? list : []).slice(0, ROWS_MAX).filter(r => r && typeof r.entity === 'string' && r.id != null).map(r => ({ key: `${r.entity}:${r.id}`, entity: r.entity, id: String(r.id), title: cleanText(String(r.title || ''), 160), company: r.company && typeof r.company === 'object' && r.company.name ? { type: r.company.type || null, id: r.company.id || null, name: cleanText(String(r.company.name), 160) } : null }));
  const rows = rowsOf(body.rows);
  // C8: the record(s) the conversation is narrowed to - what a pronoun means while the focus chip is up
  const focus = rowsOf(body.focus).slice(0, 10);
  return { q, thread: thread.map(t => ({ role: t.role, content: withActions(t) })), scope, rows, focus };
}

// C1: what the follow-up points at. -> null (not a follow-up) | { cant } | { rows, line, company? }.
export function followUpOf(q, rows, focus = []) {
  let r = resolveFollowUp(q, rows, { ask: true });
  // a pronoun means the focused record(s) while there is a focus; ordinals and names still read the rows on screen
  if (focus.length && (r.pronoun || r.how === 'none')) { const f = resolveFollowUp(q, focus, { ask: true }); if (f.pronoun && f.rows.length) r = f; }
  if (r.how === 'none') return null;
  if (!rows.length) return ['ordinal', 'one'].includes(r.how) ? { cant: 'Ask for a list first, then point at a row, like "the second one".' } : null;
  if (r.ambiguous) return { cant: 'Which one? Say it like "the second one" or use a name.', candidates: r.candidates.slice(0, CANDIDATES_MAX).map(c => ({ key: c.key, entity: c.entity, id: c.id, title: r.company ? c.company.name : c.title, ...(c.company?.name && !r.company ? { sub: c.company.name } : {}) })) };
  if (!r.rows.length) return r.how === 'ordinal' ? { cant: `The last answer has ${rows.length} row${rows.length === 1 ? '' : 's'}; that one is not among them.` } : null;
  return { rows: r.rows, line: resolvedLine(r), phrase: r.phrase, ...(r.company ? { company: true } : {}) };
}

// FIX scout-company-lookup S3 - a "who owns <x>" ask on one record: the server's own first sentence (never the
// model's) and, when nobody owns it, the offer of the assign verb's card on that row. `restated` matches a model
// answer that opens by saying the same thing again (seen live), so the owner is said once.
// -> null | { line, item, restated, offer }
export function ownerLead(ctx) {
  const p = ctx.parts.length === 1 ? ctx.parts[0] : null, o = p?.owner || null;
  const item = o ? [...ctx.items.values()].find(i => i.entity === p.brief.entity && String(i.id) === String(p.brief.id)) : null;
  if (!item) return null;
  const line = o.name ? `${o.title} is owned by ${o.name}${o.assigned ? ` · assigned ${o.assigned}` : ''}.` : `${o.title} has no owner — assign it?`;
  return hasPii(line) ? null : { line, item, restated: new RegExp(`^\\s*(?:\\*\\*)?${o.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\*\\*)? (?:is (?:currently )?(?:owned by|unassigned)|has no (?:assigned )?owner)[^.\\n]*\\.\\s*`, 'i'), offer: o.name ? null : { verb: 'assign', key: `${item.entity}:${item.id}`, label: 'Assign' } };
}

export async function ask(supabase, registry, { auth, body, now = askDeps.now() }) {
  const v = validateAsk(body);
  if (v.error) return { status: 400, body: { error: v.error } };
  const scope = v.scope || auth.roles.keys().next().value || 'all';
  if (scope !== 'all' && !auth.isPlatformOwner && !auth.roles.has(scope)) return { status: 403, body: { error: 'You are not in that workspace' } };
  const n = await asksToday(supabase, auth.user.id, now);
  if (n >= DAILY_CAP) return { status: 429, body: { error: `Scout has answered ${DAILY_CAP} questions for you today. It opens again tomorrow.`, cap: DAILY_CAP, used: n } };
  cancelPlans(auth.user.id); // S1: a new ask cancels an open confirm card
  const follow = followUpOf(v.q, v.rows, v.focus);
  // nothing to point at (or more than one candidate): said plainly, no model call, no ask counted
  if (follow?.cant) return { status: 200, body: { answer_md: follow.cant, summary: follow.cant, sections: [], items: [], usage: null, withheld: false, cant: { reason: follow.cant, ...(follow.candidates ? { candidates: follow.candidates } : {}) }, scope, cap: { used: n, max: DAILY_CAP } } };
  let ctx;
  try { ctx = await buildContext(supabase, registry, { auth, scope, q: v.q, now, follow }); }
  catch (e) { if (e.status) return { status: e.status, body: { error: e.message } }; throw e; }
  // FIX scout-company-lookup S4: a name nothing carries - said plainly, no model call, no ask counted
  if (ctx.cant) return { status: 200, body: { answer_md: ctx.cant.reason, summary: ctx.cant.reason, sections: [], items: [], usage: null, withheld: false, cant: ctx.cant, scope, cap: { used: n, max: DAILY_CAP } } };
  const lead = ownerLead(ctx);
  const system = `${SYSTEM}\n\nToday is ${laDateString(new Date(now))} (Pacific).${ctx.glossary.length ? `\n\nHouse vocabulary:\n${ctx.glossary.map(l => `- ${l}`).join('\n')}` : ''}`;
  const multi = ctx.parts.length > 1;
  const user = `${v.q}${multi ? `\n\n${PARTS_RULE(ctx.parts.length)}${ctx.parts_cut ? ` The question had ${ctx.parts.length + ctx.parts_cut} parts; say that only the first ${ctx.parts.length} are answered.` : ''}` : ''}${follow ? `\n\nThis is a follow-up on the last answer: ${follow.line}. Answer about ${follow.rows.length === 1 ? 'that record' : 'those records'} only.` : ''}${lead ? `\n\nThe answer already opens with the owner ("${lead.line}"); do not restate who owns it.` : ''}\n\nFilters I read from the question: ${JSON.stringify({ mine: ctx.ask.mine, entity: ctx.ask.entity, since: ctx.ask.since, until: ctx.ask.until, band: ctx.ask.band, band_kind: ctx.ask.bandKind, source: ctx.ask.source, sort: ctx.ask.sort, company: ctx.ask.company })}\n\nCONTEXT (${ctx.lines.length} lines${ctx.stats.truncated ? `, ${ctx.stats.truncated} more cut by the size cap` : ''}):\n${ctx.pack || '(nothing matched)'}`;
  const messages = [...v.thread.filter((t, i, a) => !(i === 0 && t.role === 'assistant')), { role: 'user', content: user }];
  if (!askDeps.callAnthropic) askDeps.callAnthropic = (await import('../businesses/shared.js')).callAnthropic;
  const data = await askDeps.callAnthropic({ system, messages, max_tokens: MAX_TOKENS, thinking: false, model: MODELS.STANDARD, supabase, businessId: scope === 'all' ? null : scope, userId: auth.user.id, callType: CALL_TYPE, timeoutMs: 60000 });
  let text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').replace(/[—–]/g, '-');
  // Checked after the [rN] labels become titles (the shown text).
  let { answer_md, items, summary, sections } = sectioned(text, ctx);
  const withheld = hasPii(answer_md) || hasPii(JSON.stringify(sections.map(x => [x.line, x.rows.map(r => [r.title, r.subtitle])])));
  if (withheld) { answer_md = 'Answer withheld: it contained an address or phone number.'; summary = answer_md; items = []; sections = []; }
  // C1: the summary says what the follow-up was read as ("the second one → Meagan Earl, Cloudflare").
  else if (follow) { summary = `${follow.line}. ${summary}`; answer_md = `${follow.line}. ${answer_md}`; }
  // S3: the owner is the first sentence; the record rides as a row even when the model cited nothing, so the assign
  // card has a row to act on.
  if (lead && !withheld) {
    summary = `${lead.line} ${summary.replace(lead.restated, '')}`.trim(); answer_md = `${lead.line} ${answer_md.replace(lead.restated, '')}`.trim();
    if (!items.some(i => i.entity === lead.item.entity && String(i.id) === String(lead.item.id))) { items = [lead.item, ...items]; sections[0].rows = [lead.item, ...sections[0].rows]; sections[0].count = sections[0].rows.length; sections[0].total = Math.max(sections[0].total, sections[0].count); }
  }
  const usage = { input_tokens: data.usage?.input_tokens ?? null, output_tokens: data.usage?.output_tokens ?? null, cost_usd: data.usage ? estimateCostUsd(MODELS.STANDARD, data.usage) : null };
  // A6: the usage row has no json column, so the matched intent is logged beside it (the next real-ask report counts misses).
  console.log(`[scout/ask] intent=${ctx.stats.intent} reads=${ctx.stats.reads.length} lines=${ctx.lines.length} tokens=${usage.input_tokens}/${usage.output_tokens} user=${String(auth.user.id).slice(0, 8)}`);
  return { status: 200, body: { answer_md, summary, sections, items, usage, withheld, ...(lead?.offer && !withheld ? { offer: lead.offer } : {}), ...(follow && !withheld ? { resolved: { phrase: follow.phrase, line: follow.line, rows: follow.rows.map(r => ({ entity: r.entity, id: r.id, title: r.title })) } } : {}), ask: { mine: ctx.ask.mine, entity: ctx.ask.entity, since: ctx.ask.since, until: ctx.ask.until, since_kind: ctx.ask.since_kind, band: ctx.ask.band, band_kind: ctx.ask.bandKind, source: ctx.ask.source, sort: ctx.ask.sort, company: ctx.ask.company }, context_stats: ctx.stats, scope, cap: { used: n + 1, max: DAILY_CAP } } };
}

export async function askRoute(req, res) {
  try {
    const r = await ask(await getScoutSupabase(), scoutDeps.registry(), { auth: req.auth, body: req.body || {} });
    res.status(r.status).json(r.body);
  } catch (e) { res.status(500).json({ error: e.message }); }
}
