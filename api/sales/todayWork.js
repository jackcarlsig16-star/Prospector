import { MODELS, estimateCostUsd } from '../../src/config/models.js';
import { cleanText, hasPii, packHasPii } from './scrubText.js';
import { nbaOf, VERB_IDS } from './todayRank.js';

// actions-v2 A2 (Q7-Q10) - the work panel's server side. Nothing here runs until a verb is clicked, and nothing is
// ever sent or written: POST goals/today/:key/work { verb?, tone?, person? } returns
//   { grounds, steps, draft | brief | people, prompt_pack, usage }.
// GROUNDS (Q9) are stored facts only, assembled BEFORE any call and handed over as the only material. A step is
// either a template keyed by the matched Next Best Action rule (no model text at all) or a model step that cites ONE
// ground id - its "based on" line is that ground's own text, never the model's; a step citing no ground is dropped.
// (C2: so is a step that names a date its ground does not.)
// Calls: Draft email / Draft reply = ONE call (the Write-email call, returning the draft and its steps together);
// Prep call = one call; Next steps = one call, none when there is no ground; Find people = none. Every call is a
// Write-email call (callType intent_compose): its daily cap governs, and the cost is the usage row's, never a constant.
// D38: a call that fails still answers with what needed no call (row, grounds, the rule's step, prompt_pack) beside
// the error, so the Claude pane keeps working.
export const STEP_TEMPLATES = { reply_today: 'Reply today', book_meeting: 'Book the meeting', contact_referral: 'Contact the referral', follow_up_clicked: 'Follow up — they clicked', linkedin_touch: 'LinkedIn touch', find_contact: 'Find the right contact' };
export const STEPS_MAX = 4;
export const NOTES_MAX = 3;
export const WORK_MAX_TOKENS = 900;
export const TONES = { shorter: 'Make this draft shorter than you otherwise would: at most 70 words in the body.', warmer: 'Make this draft a little warmer in tone, without hype and without adding any fact.' };
// FIX claude-pack-dossier P5: five asks, each the pack's last line (## Ask). {person} = the row's person; ___ is typed.
export const ASK_BLANK = '___';
export const ASKS = [
  ['sequence', 'Write a 3-touch sequence', 'Write a 3-touch outreach sequence (email, follow-up, last note) for this record, using only the facts above.'],
  ['email', 'Write one email', 'Write one first email to {person}, using only the facts above. Under it, list the facts you used.'],
  ['research', 'Research the account', 'Research this account: what should a HomeLover account executive know before reaching out? Say what is known from the facts above and what is still unknown.'],
  ['call', 'Prep me for a call', 'Prep me for a call with this record: an opening line, three questions to ask and the likely objections, using only the facts above.'],
  ['objection', 'Handle this objection', `Help me answer this objection from them, using only the facts above: ${ASK_BLANK}`],
];
const NOTHING = 'Nothing to suggest beyond the draft.';
const reply = (status, body) => ({ status, body });
const md = d => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : null);
const n = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const said = v => String(v || '').replace(/_/g, ' ');

// Pure. row = the Today row · person = its People row (or null) · visit = the company's latest web_visits row ·
// score = its listScores row · pinReason = the record's pin reason · notes = [{ call_date, title, text }] newest first ·
// siblings = the other open rows on the same record. -> [{ id: 'G1', kind, text, rule? }] - a ground that still holds
// an address or phone shape after cleanText is left out.
export function groundsFor({ row, person = null, visit = null, score = null, pinReason = null, notes = [], siblings = [] }) {
  const out = [];
  const add = (kind, text, extra = {}) => { const t = cleanText(text, 320); if (t && !hasPii(t)) out.push({ kind, text: t, ...extra }); };
  const c = row.company, name = c?.name || 'The company';
  if (visit && Number(visit.visits_7d) > 0) {
    const top = Array.isArray(visit.top_paths) && visit.top_paths[0] ? String(visit.top_paths[0].path || visit.top_paths[0]) : null;
    add('visit', `${name} was on the site: ${n(Number(visit.visits_7d), 'visit')} in 7 days, last ${md(visit.last_visit || visit.seen_to || visit.pulled_on)}${top ? `; top page ${top}` : ''}`);
  }
  if (person) {
    const e = person.emails || {};
    if (e.sent || e.opened || e.clicked || e.replied) add('activity', `${person.name}: ${e.sent} sent, ${e.opened} opened, ${e.clicked} clicked, ${e.replied} replied${person.last_email?.at ? `; last ${person.last_email.what || 'signal'} ${md(person.last_email.at)}` : ''}${person.last_email?.reply_class ? ` (${said(person.last_email.reply_class)})` : ''}`);
    const rule = nbaOf(person);
    if (rule) add('nba', `${rule.label}: ${rule.reason}`, { rule: rule.id });
    if (person.heat_band) add('heat', `${person.name} is ${person.heat_band}${person.heat != null ? ` (heat ${person.heat})` : ''}`);
    if (person.title) add('title', `${person.name} is ${person.title}${person.buyer ? ' - a buyer title' : ' - not on the buyer-title list'}`);
  }
  if (score?.stage) add('stage', `${name} is at ${said(score.stage)}${score.last_touch_at ? `; ${score.touches ? `${score.touches} touch${score.touches === 1 ? '' : 'es'}, ` : ''}last touch ${md(score.last_touch_at)}${score.last_touch_channel ? ` by ${said(score.last_touch_channel)}` : ''}` : '; no touch recorded'}`);
  if (c?.pinned) add('pin', `${name} is pinned${pinReason ? `: ${pinReason}` : ''}`);
  if (siblings.length) add('todos', `${n(siblings.length, 'other open to-do')} on ${name}: ${siblings.slice(0, 2).map(s => `"${s.text}"${s.due ? ` (due ${md(s.due)})` : ''}`).join('; ')}`);
  for (const note of notes.slice(0, NOTES_MAX)) add('note', `Call note ${md(note.call_date)}${note.title ? ` (${note.title})` : ''}: ${String(note.text || '').replace(/\s+/g, ' ').slice(0, 220)}`);
  return out.map((g, i) => ({ id: `G${i + 1}`, ...g }));
}

export const templateSteps = grounds => grounds.filter(g => g.kind === 'nba' && STEP_TEMPLATES[g.rule]).slice(0, 1).map(g => ({ text: STEP_TEMPLATES[g.rule], ground: g.id, based_on: g.text, source: 'rule' }));
// actions-v2 follow-up (ruling C2): the dates a line names - a month and day ("Nov 16", "11/16", an ISO day), a
// weekday, a relative day ("today", "tomorrow", "next week", "in 3 days", "end of the month"), a bare month - each in
// one comparable form, so "November 16th" and "Nov 16" are the same date.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_WORD = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const DAYS = { mon: 'monday', tue: 'tuesday', tues: 'tuesday', wed: 'wednesday', thu: 'thursday', thur: 'thursday', thurs: 'thursday', fri: 'friday' };
export function dateTokens(text) {
  let t = ` ${String(text || '').toLowerCase()} `;
  const out = new Set();
  const take = (re, f) => { t = t.replace(re, (...m) => { out.add(f(m)); return ' '; }); };
  const md = (mon, day) => `${MONTHS[mon]} ${Number(day)}`;
  take(/\b\d{4}-(\d{2})-(\d{2})\b/g, m => md(Number(m[1]) - 1, m[2]));
  take(/\b(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\b/g, m => md(Number(m[1]) - 1, m[2]));
  take(new RegExp(`\\b${MONTH_WORD}\\.? (\\d{1,2})(?:st|nd|rd|th)?\\b`, 'g'), m => md(MONTHS.indexOf(m[1].slice(0, 3)), m[2]));
  take(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? (?:of )?${MONTH_WORD}\\b`, 'g'), m => md(MONTHS.indexOf(m[2].slice(0, 3)), m[1]));
  take(new RegExp(`\\b(?:in|by|during|early|mid|late|this|next|last) ${MONTH_WORD}\\b`, 'g'), m => MONTHS[MONTHS.indexOf(m[1].slice(0, 3))]);
  take(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tues|thurs|thur|tue|wed|thu|fri)\b/g, m => DAYS[m[1]] || m[1]);
  take(/\b(today|tonight|tomorrow|yesterday|eod|eow)\b/g, m => m[1]);
  take(/\b(this|next|last) (week|month|quarter|year)\b/g, m => `${m[1]} ${m[2]}`);
  take(/\b(?:end|start|beginning) of (?:the |this |next )?(day|week|month|quarter|year)\b/g, m => `edge of ${m[1]}`);
  take(/\b(?:in|within) (?:the next )?(\d{1,3}|a|an|one|two|three|four|five|six|seven) (day|week|month)s?\b/g, m => `in ${m[1]} ${m[2]}`);
  return out;
}

// The model's steps: kept only when they cite ONE ground that exists; "based on" is the ground's text. C2: a step
// naming a date its ground does not name is dropped too - the model made the date up.
export function citedSteps(raw, grounds, have = []) {
  const byId = new Map(grounds.map(g => [g.id, g]));
  const out = [...have];
  for (const s of Array.isArray(raw) ? raw : []) {
    const g = typeof s?.ground === 'string' ? byId.get(s.ground.trim()) : null;
    const text = cleanText(String(s?.text || ''), 160);
    if (!g || !text || hasPii(String(s.text)) || out.some(o => o.text.toLowerCase() === text.toLowerCase())) continue;
    const known = dateTokens(g.text);
    if ([...dateTokens(String(s.text))].some(d => !known.has(d))) continue;
    out.push({ text, ground: g.id, based_on: g.text, source: 'model' });
  }
  return out.slice(0, STEPS_MAX);
}
export const groundsBlock = grounds => ['GROUNDS (stored facts - the only material a step may use):', ...grounds.map(g => `- [${g.id}] ${g.text}`)].join('\n');
const STEPS_RULE = 'each { "text": a short imperative line, "ground": "G2" } citing exactly ONE ground id from GROUNDS. A step with no ground must not be returned. A step names a date, a weekday or a deadline only when its ground names that same date; never invent one. No email address or phone number.';
export const stepsAsk = (grounds, { replyTo = null, tone = null } = {}) => [
  replyTo ? `This is a REPLY, not a first email: ${replyTo} wrote back. Answer them directly and keep the ask.` : null,
  tone ? TONES[tone] : null,
  grounds.length ? `${groundsBlock(grounds)}\nAlso return, in the same JSON object, "steps": up to 3 next steps for the account executive, ${STEPS_RULE}` : null,
].filter(Boolean).join('\n\n');
// A8: the one place the panel's own system prompts live - company-context-v1 feeds here, with no panel change.
export function workSystem(verb) {
  const head = 'You help a HomeLover account executive act on one to-do. Use ONLY the Brief lines and the GROUNDS in the message as facts. Never invent a fact, a number, a name or a title. No pricing. No email address or phone number. Hyphens, never em or en dashes.';
  return verb === 'prep_call'
    ? `${head}\n\nReturn ONLY a JSON object: { "brief": string (a call prep of at most 160 words: who they are, why now, three questions to ask, one likely objection), "steps": [...] } - "steps": up to 3, ${STEPS_RULE}`
    : `${head}\n\nReturn ONLY a JSON object: { "steps": [...] } - up to 3 next steps, ${STEPS_RULE}`;
}

// The Copy-for-Claude pack with each ask chip as its Ask (real length, PII-gated per variant). person = the row's
// person's name (the email chip names them); the objection chip's blank is filled in the browser.
export function promptPack(pack, person = null) {
  if (!pack || pack.blocked || !pack.text) return pack?.blocked ? { blocked: true, reason: 'Not copied: the pack still held an address or phone shape.' } : null;
  const who = person ? cleanText(person, 120) : null;
  const asks = ASKS.map(([id, base, ask]) => {
    const label = id === 'email' && who ? `Write one email to ${who.split(' ')[0]}` : base;
    const text = pack.text.replace(/## Ask\n[\s\S]*$/, `## Ask\n${ask.replace('{person}', who || 'the best person to reach at this company')}\n`);
    return packHasPii(text) ? { id, label, blocked: true } : { id, label, text, chars: text.length, ...(id === 'objection' ? { blank: ASK_BLANK } : {}) };
  });
  return { asks, records: pack.records, cut: pack.cut || 0 };
}

export const workDeps = {
  loadToday: async (...a) => (await import('./todayRoutes.js')).loadToday(...a),
  compose: async (...a) => (await import('./composeRoutes.js')).composeEmail(...a),
  cap: async (...a) => (await import('./composeRoutes.js')).composeCap(...a),
  brief: async (...a) => (await import('./companyBrief.js')).companyBrief(...a),
  pack: async (...a) => (await import('./targetsRoutes.js')).copyPack(...a),
  call: async (...a) => (await import('../businesses/shared.js')).callAnthropic(...a),
};
const PIN_TABLE = { partner: 'sales_goals', employer: 'sales_opportunities', target: 'sales_targets' };
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const jsonIn = text => { try { return JSON.parse(String(text || '').match(/\{[\s\S]*\}/)?.[0] || 'null'); } catch { return null; } };
const usd = v => (v != null ? Math.round(v * 1e4) / 1e4 : null);

export async function work(supabase, { businessId, auth, key, body = {}, businessName = null, now = Date.now(), deps = workDeps }) {
  const t = await deps.loadToday(supabase, businessId, { now });
  const rows = t.view.groups.flatMap(g => g.rows);
  const row = rows.find(r => r.key === key);
  if (!row) return reply(404, { error: 'That row is no longer on the list - reload' });
  const verb = body.verb == null ? row.verb : body.verb;
  if (!VERB_IDS.includes(verb)) return reply(400, { error: `verb must be one of ${VERB_IDS.join('|')}` });
  if (body.tone != null && !TONES[body.tone]) return reply(400, { error: `tone must be one of ${Object.keys(TONES).join('|')}` });
  const c = row.company?.id ? row.company : null;
  if (!c && verb !== 'next_steps') return reply(422, { error: `${row.company?.name || 'This row'} has no company record, so there is no Brief to work from - Next steps is the verb here.` });
  // Find people's "Draft" hands a stored person of the same company over by key.
  let person = row.person ? t.people.find(p => p.key === row.person.key) || null : null;
  if (body.person != null) {
    person = typeof body.person?.key === 'string' ? t.people.find(p => p.key === body.person.key && p.company?.id === c?.id) || null : null;
    if (!person) return reply(400, { error: 'person must be { key } of a stored person at this company' });
  }

  const raw = row.kind === 'todo' ? t.todos.find(x => x.id === row.id) || null : null;
  const siblings = c ? rows.filter(r => r.key !== row.key && r.kind === 'todo' && r.company?.id === c.id) : [];
  const noteIds = [...new Set([raw?.source_note_id, ...siblings.map(s => t.todos.find(x => x.id === s.id)?.source_note_id)].filter(Boolean))];
  const [notes, pinRow] = await Promise.all([
    noteIds.length ? supabase.from('sales_call_notes').select('id, title, call_date, text').eq('business_id', businessId).in('id', noteIds).then(must) : [],
    c?.pinned ? supabase.from(PIN_TABLE[c.type]).select('pin_reason').eq('business_id', businessId).eq('id', c.id).maybeSingle().then(must) : null,
  ]);
  const grounds = groundsFor({
    row, person, visit: c ? t.visitOf({ type: c.type, id: c.id, name: c.name }) : null, score: c ? t.scores.find(s => s.type === c.type && s.id === c.id) || null : null,
    pinReason: pinRow?.pin_reason || null, notes: [...notes].sort((a, b) => String(b.call_date).localeCompare(String(a.call_date))), siblings,
  });
  const rule = templateSteps(grounds);
  const out = { key, verb, row: { text: row.text, company: c ? { type: c.type, id: c.id, name: c.name } : row.company ? { name: row.company.name } : null, person: person ? { key: person.key, name: person.name, title: person.title || null } : null }, grounds, steps: rule, usage: { calls: 0, cost_usd: null, cap: null } };

  const records = c ? [{ type: c.type, id: c.id, first: person ? { key: person.key, name: person.name } : null }] : person ? [{ type: 'person', id: person.key }] : [];
  if (records.length) {
    try { out.prompt_pack = promptPack(await deps.pack(supabase, { businessId, question: ASKS[0][2], scope: businessName, today: t.view.today, records }), person?.name || null); }
    catch (e) { if (e.status !== 404) throw e; out.prompt_pack = null; }
  } else out.prompt_pack = null;

  const failed = (status, body) => reply(status, { ...out, ...body });

  if (verb === 'find_people') {
    const taken = new Set(t.todos.map(x => x.person_key).filter(Boolean));
    out.people = t.people.filter(p => p.company?.id === c.id && p.company?.type === c.type && !taken.has(p.key)).sort((a, b) => (b.heat ?? -1) - (a.heat ?? -1))
      .map(p => ({ key: p.key, name: p.name, title: p.title || null, heat: p.heat ?? null, heat_band: p.heat_band ?? null, buyer: !!p.buyer }));
    return reply(200, out);
  }
  if (verb === 'next_steps' && !grounds.length) return reply(200, { ...out, note: 'Nothing stored to base a step on - link this to-do to a company or a person first.' });

  if (verb === 'draft_email' || verb === 'draft_reply') {
    const to = person ? { person_key: person.key, name: person.name, title: person.title || null } : null;
    let r;
    try {
      r = await deps.compose(supabase, { businessId, userId: auth.user.id, userName: auth.user.name, type: c.type, id: c.id, person: to, now,
        extra: { ask: stepsAsk(grounds, { replyTo: verb === 'draft_reply' ? person?.name || c.name : null, tone: body.tone || null }) } });
    } catch (e) { return failed(502, { error: `The draft failed: ${e.message}` }); }
    if (r.status !== 200) return failed(r.status, r.body);
    const d = r.body.draft;
    out.steps = citedSteps(r.body.extra?.steps, grounds, rule);
    out.usage = { calls: 1, cost_usd: r.body.cost_usd ?? null, cap: r.body.cap || null };
    const about = { to: to ? { name: to.name, title: to.title, company: c.name } : { name: null, title: null, company: c.name }, tone: body.tone || null };
    out.draft = hasPii(`${d.subject}\n${d.body}`) ? { ...about, withheld: true, reason: 'Draft withheld: it held an address or phone shape. Try again.' }
      : { ...about, subject: d.subject, body: d.body, lint: r.body.lint ? { ok: r.body.lint.ok, issues: r.body.lint.issues.length } : null };
    if (!out.steps.length) out.note = NOTHING;
    return reply(200, out);
  }

  // Prep call and Next steps: one call of their own, under the same cap.
  const cap = await deps.cap(supabase, businessId, now);
  if (cap.used >= cap.max) return failed(429, { error: `Write email cap reached (${cap.max} per day for this workspace)`, used: cap.used, max: cap.max });
  let material = groundsBlock(grounds);
  if (c) { const b = await deps.brief(supabase, { businessId, type: c.type, id: c.id, now }); if (b.status !== 200) return failed(b.status, b.body); material = `${b.body.markdown}\n\n${material}`; }
  let data;
  try {
    data = await deps.call({ system: workSystem(verb), messages: [{ role: 'user', content: `${material}\n\nThe to-do: ${row.text}` }], max_tokens: WORK_MAX_TOKENS, model: MODELS.STANDARD, thinking: false, timeoutMs: 60000, supabase, businessId, userId: auth.user.id, callType: 'intent_compose' });
  } catch (e) { return failed(502, { error: `The call failed: ${e.message}` }); }
  if (data.stop_reason === 'max_tokens') return failed(502, { error: 'The answer was cut off - try again' });
  const j = jsonIn((data.content || []).filter(x => x.type === 'text').map(x => x.text).join(''));
  if (!j) return failed(502, { error: 'The model returned nothing readable - try again' });
  out.steps = citedSteps(j.steps, grounds, rule);
  out.usage = { calls: 1, cost_usd: usd(estimateCostUsd(data.usage?.model || MODELS.STANDARD, data.usage) ?? null), cap: { used: cap.used + 1, max: cap.max } };
  if (verb === 'prep_call') {
    const text = cleanText(String(j.brief || ''), 1600);
    out.brief = !text ? { withheld: true, reason: 'No brief came back - try again.' } : hasPii(text) ? { withheld: true, reason: 'Brief withheld: it held an address or phone shape. Try again.' } : { text };
  }
  if (!out.steps.length) out.note = 'Nothing to suggest from what is stored.';
  return reply(200, out);
}
