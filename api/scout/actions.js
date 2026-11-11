import { randomUUID } from 'crypto';
import { cleanText, hasPii } from '../sales/scrubText.js';
import { laDateString } from '../sales/laDate.js';
import { addDays } from '../sales/goalsShared.js';
import { roleAtLeast } from '../../src/constants/roles.js';
import { scoutDeps, getScoutSupabase, scopedBusinesses } from './registry.js';

// scout-v3 S1 - Scout acts, the model never writes. A typed command or a menu pick -> POST /api/scout/plan (no write):
// parseCommand reads the verb, the targets (resolved against the rows of the answer on screen) and the arguments, and
// the module's verb plans each row -> a confirm card { plan_id, rows: [{ key, title, from, to, skipped }] }, an "open"
// (draft email, quick capture, copy - nothing to confirm) or the can't-do state. POST /act { plan_id } runs each row
// through the module's existing route and keeps its undo handle; POST /undo { plan_id } reverses the batch as one.
// Plans live in memory (ruling R10): 2 minutes to confirm, UNDO_MS to undo; a new ask or plan cancels an open card.
// Core names no workspace and no verb: verbs, their words and their rules come from the registry.
export const PLAN_TTL_MS = 2 * 60e3;
export const UNDO_MS = 15e3; // the client shows 10 s; the slack covers slow networks
export const BATCH_MAX = 25; // D8
export const NAMES_MAX = 3;
const plans = new Map();
export const actDeps = { now: () => Date.now() };
const reply = (status, body) => ({ status, body });

// S5: what Scout never does, read from the command's first words.
const REFUSED = [
  [/^(send|reply|forward)\b|^email\s+(?!open|click|repl|rate|funnel|to site|stats|performance|sequence)/, "I can't send email. Scout never sends, deletes, or moves a stage. I can open a draft for you to send yourself.", 'draft'],
  [/^(delete|remove|erase|archive)\b/, "I can't delete a record. Scout never sends, deletes, or moves a stage.", null],
  [/^(move|advance|push|promote|change)\b.*\b(stage|stages|pipeline|contacted|meeting|proposal|client|signed|won|lost)\b|^(mark|make|set)\b.*\b(client|signed|launched|won|lost)\b/, "I can't move a stage or add a client. Scout never sends, deletes, or moves a stage - open the record's window for that.", null],
  [/^(add|put|enrol|enroll)\b.*\b(sequence|apollo|cadence)\b|^(sync|refresh)\b/, "I can't write to Apollo. Scout never sends, deletes, or moves a stage.", null],
];
const LEAD_IN = /^(?:(?:please|scout|hey scout|ok|okay|can you|could you|go ahead and|now)[,\s]+)+/;

// D7: "Thursday" = the next Thursday in LA (never today); today / tomorrow / next week / in n days / Nov 12 / 11/12 /
// an ISO day. A date already past comes back with past: true - shown on the card, never silently moved.
const DOW = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const DATE_WORDS = new RegExp(`\\b(?:(?:until|till|til|by|on|due|for)\\s+)?(?:(\\d{4}-\\d{2}-\\d{2})|(today|tomorrow)|(next week)|in (\\d{1,3}) (day|week)s?|(?:next |this )?(${DOW.join('|')}|${DOW.map(d => d.slice(0, 3)).join('|')})|(${MONTHS.join('|')}|${MONTHS.map(m => m.slice(0, 3)).join('|')}|sept)\\.? (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?|(\\d{1,2})/(\\d{1,2}))\\b`, 'i');
export function parseDate(text, today) {
  const m = DATE_WORDS.exec(String(text || ''));
  if (!m) return null;
  const out = date => ({ date, past: date < today, phrase: m[0] });
  const pad = n => String(n).padStart(2, '0');
  if (m[1]) return out(m[1]);
  if (m[2]) return out(m[2].toLowerCase() === 'today' ? today : addDays(today, 1));
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  if (m[3]) return out(addDays(today, ((8 - dow) % 7) || 7));
  if (m[4]) return out(addDays(today, Number(m[4]) * (m[5].toLowerCase() === 'week' ? 7 : 1)));
  if (m[6]) { const want = DOW.findIndex(d => d.startsWith(m[6].toLowerCase().slice(0, 3))); return out(addDays(today, ((want - dow + 7) % 7) || 7)); }
  if (m[7]) { const mon = MONTHS.findIndex(x => x.startsWith(m[7].toLowerCase().slice(0, 3))); return out(`${m[9] || today.slice(0, 4)}-${pad(mon + 1)}-${pad(m[8])}`); }
  const mm = Number(m[10]), dd = Number(m[11]);
  return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31 ? out(`${today.slice(0, 4)}-${pad(mm)}-${pad(dd)}`) : null;
}

// The rows a command points at, from the answer on screen: explicit keys (a menu pick); "all / those / them / all
// five"; "the first 3"; "row 2"; a row's own name or its company's ("the Cloudflare ones"); "this / it" when one row.
const COUNT_WORD = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
export function resolveTargets(text, rows, keys) {
  if (Array.isArray(keys) && keys.length) return { rows: rows.filter(r => keys.includes(r.key)), how: 'picked' };
  const t = ` ${String(text || '').toLowerCase().replace(/['’]/g, '')} `;
  const named = rows.filter(r => [r.title, r.company?.name].filter(Boolean).some(n => String(n).length > 2 && t.includes(String(n).toLowerCase().replace(/['’]/g, ''))));
  if (named.length) return { rows: named, how: 'named' };
  const first = /\b(?:first|top)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b/.exec(t);
  if (first) return { rows: rows.slice(0, COUNT_WORD[first[1]] || Number(first[1])), how: 'first' };
  const nth = /\b(?:row|number|#)\s*(\d{1,2})\b/.exec(t);
  if (nth) return { rows: rows.slice(Number(nth[1]) - 1, Number(nth[1])), how: 'row' };
  const pronoun = /\b(all|those|these|them|everyone|every one|each)\b/.test(t);
  if (pronoun) return { rows, how: 'all', pronoun: true };
  if (/\b(this|that|it|him|her|this one|that one)\b/.test(t)) return { rows: rows.length === 1 ? rows : [], how: 'one', pronoun: true };
  return { rows: [], how: 'none' };
}

// A command = the text opens with a verb's lead words (after "please", "scout," ...). -> { verb } | { refused } | null
// (null = not a command; the client sends it as an ask).
export function parseCommand(text, verbs) {
  const t = String(text || '').trim().toLowerCase().replace(/['’]/g, '').replace(LEAD_IN, '');
  const verb = verbs.find(v => v.lead.test(t));
  if (verb) return { verb, text: t };
  const no = REFUSED.find(([re]) => re.test(t));
  return no ? { refused: { reason: no[1], nearest: no[2] } } : null;
}

const purge = now => { for (const [id, p] of plans) if (now - p.created_at > PLAN_TTL_MS + UNDO_MS && (!p.acted_at || now - p.acted_at > UNDO_MS)) plans.delete(id); };
export function cancelPlans(userId) { for (const [id, p] of plans) if (p.user_id === userId && !p.acted_at) plans.delete(id); }
export const openPlans = () => plans.size;

const pillsOf = verbs => verbs.filter(v => v.pill !== false).map(v => ({ id: v.id, label: v.label }));
const cant = (verbs, reason, nearest = null) => ({ cant: { reason, pills: pillsOf(verbs), nearest: nearest ? (verbs.find(v => v.id === nearest) ? { id: nearest, label: verbs.find(v => v.id === nearest).label } : { label: nearest }) : null } });
const publicRow = r => ({ key: r.key, kind: r.kind, title: r.title, from: r.from ?? null, to: r.to ?? null, skipped: r.skipped || null, note: r.note || null });
const capNames = raw => { const out = []; let cur = null; for (const tok of String(raw || '').replace(/[",.?!;:()]/g, ' ').split(/\s+/).slice(1)) { if (/^\p{Lu}[\p{L}\p{N}&'’.-]*$/u.test(tok)) { if (cur) cur.push(tok); else out.push(cur = [tok]); } else cur = null; } return out.map(c => c.join(' ')); };

async function setup(supabase, registry, auth, scope) {
  if (!scope || scope === 'all') throw Object.assign(new Error('Pick one workspace to act in'), { status: 400 });
  const [business] = await scopedBusinesses(supabase, auth, scope);
  if (!business) throw Object.assign(new Error('You are not in that workspace'), { status: 403 });
  const mods = registry.modulesFor(business).filter(m => m.verbs.length);
  return { business, mod: mods[0] || null, verbs: mods[0]?.verbs || [] };
}

// POST /api/scout/plan { scope, text?, verb?, keys?, args?, rows } -> the card | { open, line } | { cant } | { command: false }
export async function plan(supabase, registry, { auth, body = {}, now = actDeps.now() }) {
  let s;
  try { s = await setup(supabase, registry, auth, body.scope); } catch (e) { return reply(e.status || 500, { error: e.message }); }
  const { business, mod, verbs } = s;
  purge(now);
  if (!mod) return reply(200, cant([], 'Scout has no actions in this workspace yet.'));
  if (!auth.isPlatformOwner && !roleAtLeast(auth.roles.get(business.id), 'member')) return reply(403, { error: 'Viewers can read, not change', ...cant(verbs, "You have view access here, so I can't change records.") });
  const text = typeof body.text === 'string' ? cleanText(body.text, 500) : '';
  const picked = typeof body.verb === 'string' ? verbs.find(v => v.id === body.verb) : null;
  if (typeof body.verb === 'string' && !picked) return reply(200, cant(verbs, "That isn't something I can do."));
  const cmd = picked ? { verb: picked, text: text.toLowerCase() } : parseCommand(text, verbs);
  if (!cmd) return reply(200, { command: false });
  if (cmd.refused) return reply(200, cant(verbs, cmd.refused.reason, cmd.refused.nearest));
  const verb = cmd.verb;
  const rows = (Array.isArray(body.rows) ? body.rows : []).slice(0, 200).filter(r => r && typeof r.entity === 'string' && r.id != null).map(r => ({ key: `${r.entity}:${r.id}`, entity: r.entity, id: String(r.id), title: cleanText(String(r.title || ''), 160), company: r.company && typeof r.company === 'object' ? { type: r.company.type || null, id: r.company.id || null, name: cleanText(String(r.company.name || ''), 160) } : null }));
  const today = laDateString(new Date(now));
  const members = mod.members ? await mod.members(supabase, business.id) : [];
  const target = resolveTargets(cmd.text, rows, body.keys);
  const usable = target.rows.filter(r => !verb.accepts || verb.accepts.includes(r.entity));
  const args = { ...(body.args && typeof body.args === 'object' ? body.args : {}) };
  if (verb.needs === 'member' && !('owner_user_id' in args)) {
    const to = /\bto\s+(me|myself|nobody|no one|unassigned|[a-z][a-z-]+)\b/.exec(cmd.text) || (/^unassign\b/.test(cmd.text) ? [null, 'nobody'] : null);
    const who = to && (['me', 'myself'].includes(to[1]) ? members.find(m => m.id === auth.user.id) : ['nobody', 'no one', 'unassigned'].includes(to[1]) ? { id: null, name: 'Unassigned' } : members.find(m => m.name.toLowerCase().split(/\s+/)[0] === to[1]));
    if (!who) return reply(200, cant(verbs, to ? `I don't know a member called "${cleanText(to[1], 40)}".` : 'Say who to assign to, like "assign those to Ana".', verb.id));
    args.owner_user_id = who.id; args.owner_name = who.name.split(/\s+/)[0];
  } else if (verb.needs === 'member') { const who = members.find(m => m.id === args.owner_user_id); args.owner_name = args.owner_user_id == null ? 'Unassigned' : who?.name.split(/\s+/)[0]; if (args.owner_user_id != null && !who) return reply(200, cant(verbs, 'That member is not in this workspace.', verb.id)); }
  if (typeof args.date === 'string') args.when = { date: args.date, past: args.date < today, phrase: args.date };
  else { const when = parseDate(cmd.text, today); if (when) { args.when = when; args.date = when.date; } }
  const memberWords = new Set(members.flatMap(m => m.name.split(/\s+/)));
  // names typed in the command (capitalised runs), without the date words and the members' names
  const undated = args.when?.phrase ? String(body.text || '').replace(new RegExp(args.when.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' , ') : body.text;
  args.names = capNames(undated).filter(n => !memberWords.has(n) && !parseDate(n, today)).slice(0, NAMES_MAX);
  if (!usable.length && !args.names.length && !verb.free) return reply(200, cant(verbs, target.pronoun || !rows.length ? 'Ask for a list first, then tell me what to do with it.' : target.rows.length ? `${verb.label} doesn't apply to those rows.` : 'Tell me which rows, like "the first 3" or a name.', null));
  if (usable.length > BATCH_MAX) return reply(200, cant(verbs, `That is ${usable.length} rows. Narrow it to ${BATCH_MAX} or fewer.`, verb.id));
  const id = randomUUID();
  const ctx = { businessId: business.id, business, auth, today, now, planId: id };
  let p;
  try { p = await verb.plan(supabase, ctx, usable, { ...args, text: cmd.text, raw: text }); }
  catch (e) { return reply(e.status || 500, { error: e.message }); }
  if (p.cant) return reply(200, cant(verbs, p.cant.reason, p.cant.nearest));
  if (p.open) return reply(200, { verb: verb.id, label: verb.label, open: p.open, line: p.line });
  if (p.rows.length > BATCH_MAX) return reply(200, cant(verbs, `That is ${p.rows.length} rows. Narrow it to ${BATCH_MAX} or fewer.`, verb.id));
  if (p.rows.length && p.rows.every(r => r.blocked)) return reply(200, cant(verbs, p.rows[0].skipped, p.nearest || null));
  if (!p.rows.length) return reply(200, cant(verbs, 'Nothing there to act on.', null));
  cancelPlans(auth.user.id);
  plans.set(id, { id, user_id: auth.user.id, business_id: business.id, verb, args, rows: p.rows, created_at: now, acted_at: null, undone_at: null });
  const will = p.rows.filter(r => !r.skipped).length;
  const card = { plan_id: id, verb: verb.id, label: verb.label, to: p.to ?? args.owner_name ?? args.date ?? null, when: args.when || null, rows: p.rows.map(publicRow), summary: { will, skipped: p.rows.length - will }, note: p.note || null, expires_at: new Date(now + PLAN_TTL_MS).toISOString() };
  if (hasPii(card.rows.map(r => [r.title, r.from, r.to, r.skipped, r.note].filter(Boolean).join(' · ')).join(' · '))) { plans.delete(id); return reply(500, { error: 'The card was blocked: it held an address or phone shape' }); }
  return reply(200, card);
}

const mine = (id, auth) => { const p = plans.get(id); return p && p.user_id === auth.user.id ? p : null; };
const resultRow = r => ({ ...publicRow(r), ok: r.result?.ok === true, error: r.result?.error || null, skipped: r.result?.skipped || r.skipped || null });

// POST /api/scout/act { plan_id, keys? } -> per-row ok / skipped / error + the done line. keys = Retry on failed rows only.
export async function act(supabase, registry, { auth, body = {}, now = actDeps.now() }) {
  const p = mine(body.plan_id, auth);
  if (!p || p.undone_at) return reply(404, { error: 'Plan not found - ask again' });
  const retry = Array.isArray(body.keys) && body.keys.length ? new Set(body.keys) : null;
  if (!p.acted_at && now - p.created_at > PLAN_TTL_MS) { plans.delete(p.id); return reply(410, { error: 'Plan expired - ask again', expired: true }); }
  if (p.acted_at && !retry) return reply(409, { error: 'Already done' });
  const todo = p.rows.filter(r => !r.skipped && (retry ? retry.has(r.key) && r.result && !r.result.ok && !r.result.skipped : !r.result));
  if (!todo.length) return reply(409, { error: 'Nothing to do' });
  const ctx = { businessId: p.business_id, auth, today: laDateString(new Date(now)), now, planId: p.id, args: p.args };
  for (const r of todo) {
    try {
      const out = await p.verb.act(supabase, ctx, r.exec, p.args) || {};
      if (out.skipped) r.result = { ok: false, skipped: out.skipped };
      else { r.result = { ok: true }; r.undo = out.undo ?? null; if (out.to !== undefined) r.to = out.to; }
    } catch (e) { r.result = { ok: false, error: cleanText(e.message || 'failed', 200) }; }
  }
  p.acted_at = now;
  const ran = p.rows.filter(r => r.result), done = ran.filter(r => r.result.ok), failed = ran.filter(r => r.result.error), skipped = p.rows.length - done.length - failed.length;
  const to = p.args.owner_name ? ` to ${p.args.owner_name}` : p.args.date && p.verb.needs === 'date' ? ` until ${p.args.date}` : '';
  const line = [`${p.verb.done} ${done.length}${ran.length > 1 || failed.length ? ` of ${ran.length}` : ''}${to}`, ...failed.map(r => `${r.title} failed: ${r.result.error}`), skipped ? `${skipped} skipped` : null].filter(Boolean).join(' · ');
  return reply(200, { plan_id: p.id, verb: p.verb.id, rows: p.rows.map(resultRow), done: done.length, failed: failed.length, skipped, line, can_undo: done.length > 0, undo_until: new Date(now + UNDO_MS).toISOString() });
}

// POST /api/scout/undo { plan_id } -> the whole batch back as one action, within UNDO_MS of the act.
export async function undo(supabase, registry, { auth, body = {}, now = actDeps.now() }) {
  const p = mine(body.plan_id, auth);
  if (!p || !p.acted_at) return reply(404, { error: 'Nothing to undo' });
  if (p.undone_at) return reply(409, { error: 'Already undone' });
  if (now - p.acted_at > UNDO_MS) return reply(409, { error: 'Undo expired · open the record to change it', expired: true });
  const ctx = { businessId: p.business_id, auth, today: laDateString(new Date(now)), now, planId: p.id, args: p.args };
  const rows = [];
  for (const r of p.rows.filter(x => x.result?.ok)) {
    try { await p.verb.undo(supabase, ctx, r.exec, r.undo); rows.push({ key: r.key, title: r.title, ok: true, from: r.from ?? null }); }
    catch (e) { rows.push({ key: r.key, title: r.title, ok: false, error: cleanText(e.message || 'failed', 200) }); }
  }
  p.undone_at = now;
  const bad = rows.filter(r => !r.ok);
  return reply(200, { plan_id: p.id, rows, undone: rows.length - bad.length, line: bad.length ? `undone ${rows.length - bad.length} of ${rows.length} · ${bad.map(r => `${r.title}: ${r.error}`).join(' · ')}` : 'undone' });
}

// POST /api/scout/pack { scope, q, records: [{ entity, id }] } -> { text, records, chars } | 422 { blocked } (D10; no model call).
export const PACK_RECORDS_MAX = 10;
export async function pack(supabase, registry, { auth, body = {}, now = actDeps.now() }) {
  let s;
  try { s = await setup(supabase, registry, auth, body.scope); } catch (e) { return reply(e.status || 500, { error: e.message }); }
  const mod = registry.modulesFor(s.business).find(m => m.pack);
  if (!mod) return reply(200, cant(s.verbs, 'There is nothing to copy for Claude in this workspace yet.'));
  const records = (Array.isArray(body.records) ? body.records : []).filter(r => r && typeof r.entity === 'string' && r.id != null).slice(0, PACK_RECORDS_MAX).map(r => ({ entity: r.entity, id: String(r.id) }));
  if (!records.length) return reply(400, { error: 'records is required' });
  try {
    const r = await mod.pack(supabase, { businessId: s.business.id, business: s.business, auth, today: laDateString(new Date(now)), now }, { q: cleanText(String(body.q || ''), 500), records });
    return r.blocked ? reply(422, { blocked: true, error: 'Not copied: the pack still held an address or phone shape.' }) : reply(200, r);
  } catch (e) { return reply(e.status || 500, { error: e.message }); }
}

const route = fn => async (req, res) => {
  try { const r = await fn(await getScoutSupabase(), scoutDeps.registry(), { auth: req.auth, body: req.body || {} }); res.status(r.status).json(r.body); }
  catch (e) { res.status(500).json({ error: e.message }); }
};
export const planRoute = route(plan), actRoute = route(act), undoRoute = route(undo), packRoute = route(pack);
