import { cleanText, hasPii } from '../sales/scrubText.js';
import { laDateString } from '../sales/laDate.js';
import { addDays, laMonday } from '../sales/goalsShared.js';
import { scopedBusinesses } from './registry.js';

// scout-v2 REV2 Stage 1 (D1 (2), (3), D2, D7) - the ask's retrieval: parse the light filters from the question with the
// modules' vocabulary, run the matching intents (each module's existing reads) or the entity search + standing context,
// and pack one line per row "[entity:id] title · key fields · date" - cleanText'd, hasPii-checked (a tripping line is
// dropped and counted), at most PACK_MAX chars. The openers map (D2) rides on every item. Core: names no workspace.
export const PACK_MAX = 12000; // REVISABLE (spec D1)
export const SEARCH_LIMIT = 25;
const STOP = new Set(['show', 'me', 'my', 'mine', 'i', 'the', 'a', 'an', 'of', 'for', 'to', 'in', 'on', 'at', 'and', 'or', 'with', 'about', 'from', 'what', 'which', 'who', 'where', 'when', 'how', 'is', 'are', 'do', 'does', 'did', 'list', 'give', 'find', 'tell', 'all', 'any', 'please', 'scout', 'sorted', 'sort', 'by', 'top', 'this', 'last', 'past', 'week', 'month', 'day', 'days', 'today', 'yesterday', 'they', 'them', 'their', 'our', 'we', 'have', 'has', 'had', 'be', 'been', 'it', 'its', 'that', 'these', 'those', 'say', 'says', 'said', 'touch', 'touched', 'ranked', 'rank', 'score', 'scores', 'hottest', 'newest', 'latest', 'recent', 'date', 'heat', 'open', 'closed', 'done', 'pending', 'new', 'old', 'current', 'active', 'whos', 'whats', 'wheres', 'hows', 'im', 'ive', 'thats', 'theres', 'anyone', 'anybody', 'someone', 'everyone', 'us',
  // the flag words (opened / replied / visited ...) never become search terms - a name is not "replied"
  'opened', 'replied', 'replies', 'reply', 'clicked', 'clicks', 'click', 'visited', 'visiting', 'visitor', 'visitors', 'companies', 'company', 'emails', 'email', 'site', 'website', 'web',
  // FIX scout-company-lookup S3: the owner words are the flag, never part of a name
  'owns', 'owned', 'owner', 'whose']);
const CAP_STOP = new Set(['Show', 'What', 'Which', 'Who', 'Where', 'When', 'How', 'My', 'I', 'Me', 'The', 'List', 'Give', 'Find', 'Tell', 'Do', 'Does', 'Did', 'Are', 'Is', 'Scout', 'Hot', 'Warm', 'Cool', 'Cold', 'Yesterday', 'Today', 'This', 'Last', 'Prospector', 'Brad',
  // FIX scout-generative: a weekday is a date word ("my plan for Monday"), never a company candidate
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  // ... and a sentence's first word is not a name because it has a capital ("Goals for next week", "Catch me up")
  'Next', 'Our', 'Catch', 'Goals', 'Goal', 'Agenda', 'Plan', 'Plans', 'Planning', 'Priorities', 'Priority', 'Focus', "What's", 'Whats', "Who's", "How's", "Where's"]);
const phraseIn = (text, phrase) => new RegExp(`(^|[^a-z])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(text);

// Merged vocabulary of the modules in scope (static words + the glossary's dynamic ones).
export function mergeVocab(parts) {
  const out = { entities: {}, bands: {}, sources: {}, stems: {}, members: [] };
  for (const v of parts.filter(Boolean)) {
    for (const [k, words] of Object.entries(v.entities || {})) out.entities[k] = [...new Set([...(out.entities[k] || []), ...words])];
    Object.assign(out.bands, v.bands || {});
    Object.assign(out.sources, v.sources || {});
    Object.assign(out.stems, v.stems || {});
    // scout-v3.1 C5: the members' names ride with the vocabulary, so a first name is never a company candidate
    for (const m of v.members || []) if (m?.name && !out.members.some(x => x.id === m.id)) out.members.push({ id: m.id, name: m.name });
  }
  return out;
}

// FIX scout-ask-routing-v1 A1: a token matches a vocabulary stem when it is the stem plus a word ending, repeated, so
// "visiting" -> visit, "hottest" -> hot and the fused "hottestperson" -> hot + person; "hotel" and "personal" match
// nothing. The stems and what they mean ({ entity | band | flag }) are the module's (its vocabulary.stems); core only
// applies this rule. -> the stems the token is made of (empty when any part is not a stem + ending).
const ENDINGS = ['', 's', 'es', 'ed', 'ing', 'or', 'ors', 'er', 'ers', 'est', 'test'];
export function stemHits(token, stems) {
  const found = new Set();
  const walk = t => {
    if (!t) return true;
    for (const s of stems) {
      if (!t.startsWith(s)) continue;
      const rest = t.slice(s.length);
      for (const end of ENDINGS) if (rest.startsWith(end) && walk(rest.slice(end.length))) { found.add(s); return true; }
    }
    return false;
  };
  return walk(token) ? found : new Set();
}

export function sinceOf(text, today) {
  const n = /\b(?:last|past)\s+(\d{1,3})\s+days?\b/.exec(text);
  if (n) return { since: addDays(today, -(Number(n[1]) - 1)), kind: `last ${n[1]} days` };
  if (/\byesterday\b/.test(text)) return { since: addDays(today, -1), until: addDays(today, -1), kind: 'yesterday' };
  if (/\btoday\b/.test(text)) return { since: today, kind: 'today' };
  if (/\bthis week\b/.test(text)) return { since: laMonday(today), kind: 'this week' };
  if (/\blast week\b/.test(text)) { const mon = laMonday(today); return { since: addDays(mon, -7), until: addDays(mon, -1), kind: 'last week' }; }
  if (/\bthis month\b/.test(text)) return { since: `${today.slice(0, 7)}-01`, kind: 'this month' };
  if (/\blast month\b/.test(text)) { const first = `${today.slice(0, 7)}-01`; const prev = addDays(first, -1); return { since: `${prev.slice(0, 7)}-01`, until: prev, kind: 'last month' }; }
  return null;
}

// The light filters (D1 (1)): "my" -> the caller; an entity word; a time phrase; a band word; a source word (a rep's
// name wins over the plain "referred"); a sort; capitalised or quoted names as company candidates; the intent flags.
// FIX scout-company-lookup S1: with `names` (the modules' name index: find(text) -> { name, type } | null) a company is
// a candidate whatever its case - the question's 1-3 word runs are looked up, the longest match wins, and a run made
// only of stop / vocabulary words or holding a member's first name is never looked up.
const NAME_LEAD = /\b(?:tell me about|what do we know about|notes on|intel on|brief (?:on|for)|whats up with|who owns|whose (?:is|are)|owners? of)\s+(.+)$/;
const AGENDA_ASK = /\bagenda\b|\bplan(?:s|ning)?\b|\bnext week\b|\bthis week\b|\bgoals?\b|\bpriorit(?:y|ies)\b|\bfocus\b|\bwhat should i (?:be )?do(?:ing)?\b|\bwhere should i start\b|\bwhat matters\b|\bcatch me up\b|\bwhats going on\b/;
const OWNER_ASK = /\bwho owns\b|\bwhose (?:is|are)\b|\bowners? of\b|(?<!\bno )\bowner\s*\??\s*$/;
export function parseAsk(q, vocab, { today, names = null }) {
  const raw = String(q || '').trim();
  // A1: apostrophes go ("who's" -> "whos", a stop word) before any word is read.
  const text = raw.toLowerCase().replace(/['’]/g, '');
  const words = text.replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter(Boolean);
  const vocabWords = new Set();
  const stems = vocab.stems || {};
  const stemKeys = Object.keys(stems).sort((a, b) => b.length - a.length);
  const hits = new Set();
  let superlative = false;
  for (const w of words) {
    const h = stemHits(w, stemKeys);
    if (!h.size) continue;
    vocabWords.add(w);
    for (const s of h) {
      // "hottest" / "warmest" (a band stem in the superlative) asks for a ranking by heat, not for that band alone.
      if (stems[s].band && w.startsWith(s) && /^t?est/.test(w.slice(s.length))) { superlative = true; continue; }
      hits.add(s);
    }
  }
  const stemOf = key => [...hits].map(s => stems[s][key]).find(Boolean) || null;
  // The explicit entity word wins; a stem ("person" inside "hottestperson") stands in when no word matched.
  let entity = Object.entries(vocab.entities || {}).find(([, ws]) => ws.some(w => phraseIn(text, w)))?.[0] || stemOf('entity');
  for (const ws of Object.values(vocab.entities || {})) ws.forEach(w => vocabWords.add(w));
  const band = Object.entries(vocab.bands || {}).find(([w]) => phraseIn(text, w))?.[1] || (vocab.bands || {})[stemOf('band')] || null;
  Object.keys(vocab.bands || {}).forEach(w => vocabWords.add(w));
  const stemFlags = new Set([...hits].map(s => stems[s].flag).filter(Boolean));
  const sourceHits = Object.entries(vocab.sources || {}).filter(([w]) => phraseIn(text, w)).sort((a, b) => b[0].length - a[0].length || (b[1] === 'upside') - (a[1] === 'upside'));
  const source = sourceHits.find(([, v]) => v !== 'partner_referral')?.[1] || sourceHits[0]?.[1] || null;
  Object.keys(vocab.sources || {}).forEach(w => vocabWords.add(w));
  const time = sinceOf(text, today);
  const sort = /\b(by|on) score\b|\bhighest score\b/.test(text) ? 'score' : /\bnewest|latest|most recent|by date\b/.test(text) ? 'date' : /\bby heat\b|\bhottest\b/.test(text) || superlative ? 'heat' : null;
  const quoted = [...raw.matchAll(/"([^"]{2,80})"|“([^”]{2,80})”/g)].map(m => m[1] || m[2]);
  // C5: a member's first name ("Cyrus", "Cyrus's") is a member token - the ask is about that member's records.
  const firstOf = m => String(m.name).trim().split(/\s+/)[0].toLowerCase();
  const memberOf = tok => (vocab.members || []).find(m => firstOf(m) === tok.toLowerCase().replace(/['’]s?$/, '')) || null;
  let member = null;
  const caps = [];
  for (const tok of raw.replace(/[",.?!;:()]/g, ' ').split(/\s+/)) {
    const last = caps[caps.length - 1];
    if (/^\p{Lu}[\p{L}\p{N}&'’.-]*$/u.test(tok) && memberOf(tok)) { member ||= memberOf(tok); if (last) caps.push(null); continue; }
    if (/^\p{Lu}[\p{L}\p{N}&'’.-]*$/u.test(tok) && !CAP_STOP.has(tok) && !vocabWords.has(tok.toLowerCase())) { if (last) last.push(tok); else caps.push([tok]); }
    else if (last) caps.push(null);
  }
  const lower = t => t.toLowerCase().replace(/['’]/g, '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter(Boolean);
  const memberFirsts = new Set((vocab.members || []).flatMap(m => [firstOf(m), `${firstOf(m)}s`]));
  const plain = w => STOP.has(w) || vocabWords.has(w) || /^\d+$/.test(w);
  const looked = [], consumed = new Set(), known = {};
  if (names) for (let i = 0; i < words.length; i++) for (let n = Math.min(3, words.length - i); n >= 1; n--) {
    const gram = words.slice(i, i + n);
    if (gram.some(w => memberFirsts.has(w)) || gram.every(plain)) continue;
    const e = names.find(gram.join(' '));
    if (e) { looked.push({ e, gram }); gram.forEach(w => consumed.add(w)); i += n - 1; break; }
  }
  // a capitalised or quoted name is the stronger signal: a looked-up run inside one is dropped, and a typed name that a
  // longer looked-up name contains gives way to it; a typed name the index knows takes the record's own spelling.
  const typed = [...quoted, ...caps.filter(Boolean).map(c => c.join(' '))].filter(Boolean).map(c => ({ c, e: names?.find(c) || null, w: lower(c) }));
  const lookedKept = looked.filter(h => !typed.some(t => h.gram.every(w => t.w.includes(w))));
  const kept = typed.filter(t => t.e || !lookedKept.some(h => t.w.every(w => h.gram.includes(w))));
  const flags = {
    visitors: /\bvisit(ed|or|ors|s|ing)?\b/.test(text) || stemFlags.has('visitors'), site: stemFlags.has('site'),
    ranked: /\brank(ed|ing)?\b|\btop\b|\bscores?\b|\bhottest\b/.test(text) || superlative, attention: /\battention\b|\bstale\b|\bfailed\b|\bbroken\b/.test(text),
    funnel: /\bfunnel\b|\breferr(ed|al|als)\b/.test(text), emails: /\bsequences?\b|\bopen rate\b|\breply rate\b|\bemails? (doing|performing|going)\b|\bhow are (my |our )?emails\b/.test(text),
    opened: /\bopen(ed|s)\b/.test(text), replied: /\brepl(ied|ies|y)\b/.test(text), clicked: /\bclick(ed|s)\b/.test(text),
    // email-funnel-v1 F7: "email to site rate", "emails -> website visits", "visit rate", "email funnel" -> the funnel route.
    // weekly-funnel-v1 W8: pacing, a metric's trend, last week's goals -> the weekly registry route.
    weekly: /\bpac(e|ing)\b|\bon (track|pace)\b|\btrend(s|ing)?\b|\b(hit|hitting|miss|missed|meet|met|make|made)\b[^.?!]{0,24}\bgoals?\b|\bweekly funnel\b|\bweek over week\b/.test(text),
    brief: /\bbrief\b|\bintel\b|\bpull\b|\bwhat do we know\b|\btell me about\b|\brecent call\b|\bnotes on\b|\bwhats up with\b/.test(text),
    // S3: "who owns <x>" / "whose is <x>" / "owner of <x>" / "<x> owner" - the answer leads with the owner
    owner: OWNER_ASK.test(text),
    // FIX scout-generative G1: the agenda lead words (a module's agenda intent takes the ask only when no other intent
    // of its own reads it). G5: team = "our goals" / "the team's agenda" - the member filter is off.
    agenda: AGENDA_ASK.test(text), team: /\b(?:our|ours|we|us|teams?|everyone|everybody)\b/.test(text),
    email_site: /\bemails?\b[^.?!]{0,16}\b(to|into|vs|versus|→|->)\s+(the\s+)?(site|website|web|visits?|visitors)\b|\b(site|website|visit|visitor|conversion) rate\b|\bemail funnel\b|\bfunnel\b[^.?!]{0,12}\bemails?\b/.test(text),
  };
  // a company the site has seen but that has no record is only a candidate when the question asks about it (a brief
  // or owner phrase, or the bare name) - a visitor called like an everyday word never hijacks another question.
  const bare = looked.length > 0 && words.every(w => plain(w) || consumed.has(w));
  const named = lookedKept.filter(h => h.e.type !== 'visitor' || flags.brief || flags.owner || bare);
  for (const x of [...kept, ...named]) if (x.e) known[x.e.name] = x.e;
  const company = [...new Set([...kept.map(t => t.e?.name || t.c), ...named.map(h => h.e.name)])].slice(0, 3);
  // scout-v3 D1: "who" with a heat word and no entity word asks for people ("who's hot"); "who visited" stays companies.
  if (!entity && vocab.entities?.people && /\bwhos?\b/.test(text) && (band || superlative) && !flags.visitors) entity = 'people';
  // scout-v3 D2 / R11: a count is a limit ("5 most important", "top 3") - never the n of "last n days" or a date's day.
  const limit = [...text.matchAll(/(?<!\b(?:last|past|in)\s)(?<!\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s)\b(\d{1,2})\b(?!\s*(?:days?|d|weeks?|months?|st|nd|rd|th)\b|[.:/-]\d)/g)].map(m => Number(m[1])).find(n => n >= 1 && n <= 50) || null;
  const pronoun = /\b(them|they|their|these|those companies|that company)\b/.test(text);
  // A3: a band word on a people ask is a heat band (hot / warm / cold), on a company ask the intent band (P1-P4).
  const bandKind = !band ? null : entity === 'people' || flags.opened || flags.replied || flags.clicked ? 'heat' : 'intent';
  const memberWords = member ? new Set([firstOf(member), `${firstOf(member)}s`]) : new Set();
  const terms = words.filter(w => !STOP.has(w) && !vocabWords.has(w) && !memberWords.has(w) && w.length > 1 && !/^\d+$/.test(w));
  // the bare name ("greyorange") is a brief of it
  if (named.length && bare && !entity && !band) flags.brief = true;
  // S4: a name asked for by a brief / owner phrase that nothing above recognised ("tell me about nothingco") - kept
  // apart from `company`, so the reads stay as they were; buildContext says "no record" when nothing carries it.
  const tail = (NAME_LEAD.exec(text)?.[1] || /^(.+?)\s+owner\s*\??\s*$/.exec(text)?.[1] || '').replace(/\band (?:who owns|whose|(?:its |the )?owner)\b.*$/, '');
  const guessWords = lower(tail).filter(w => !STOP.has(w));
  const guess = !company.length && !member && !entity && guessWords.length >= 1 && guessWords.length <= 4 && !guessWords.every(w => vocabWords.has(w) || /^\d+$/.test(w)) ? guessWords.join(' ') : null;
  return { q: raw, known, guess, limit, pronoun, member: member ? { id: member.id, name: firstOf(member)[0].toUpperCase() + firstOf(member).slice(1) } : null, mine: /\b(my|mine|i|ive|im)\b/.test(text), entity, since: time?.since || null, until: time?.until || null, since_kind: time?.kind || null, band, bandKind, source, sort, company, flags, terms, search: terms.join(' ') };
}

const refOf = (entity, id) => `${entity}:${id}`;

// FIX scout-generative G4 - the three example phrasings nearest the question: by the words they share with it (the
// intent's example, title and id), the `suggest` ones first on a tie. Pure; intents = [{ id, example, title?, suggest? }].
export function nearExamples(q, intents, n = 3) {
  const wordsOf = t => new Set(String(t || '').toLowerCase().replace(/['’]/g, '').match(/[a-z]{3,}/g) || []);
  const asked = wordsOf(q);
  const scored = intents.filter(i => i.example).map((i, at) => { const own = wordsOf(`${i.example} ${typeof i.title === 'string' ? i.title : ''} ${String(i.id).replace(/_/g, ' ')}`); return { example: i.example, at, suggest: !!i.suggest, hits: [...asked].filter(w => !STOP.has(w) && [...own].some(o => o === w || (w.length > 4 && o.startsWith(w.slice(0, 5))))).length }; });
  return [...new Set(scored.sort((a, b) => b.hits - a.hits || b.suggest - a.suggest || a.at - b.at).map(x => x.example))].slice(0, n);
}

// scout-v3 D2 - the section planner's first half: a multi-part ask -> its parts. Separators: ";", "and show", "and
// also", "then", a numbered "1. 2."; and the different-clause rule - a bare "and" splits when both sides (3+ words
// each) match an intent of their own and the two differ (by intents or entity). `signature(ask)` is the caller's view of
// the modules in scope ('' when no intent matches). At most PARTS_MAX parts; `cut` counts the rest.
export const PARTS_MAX = 5;
export const FOLLOW_MAX = 10;
const SEPARATOR = /\s*;\s*|\s+(?:and\s+then|and\s+also|and\s+show(?:\s+me)?|then(?:\s+show(?:\s+me)?)?|also\s+show(?:\s+me)?)\s+/i;
export function splitAsk(q, vocab, { today, signature, names = null }) {
  const raw = String(q || '').trim();
  const numbered = /(?:^|\s)1[.)]\s/.test(raw) ? raw.split(/(?:^|\s)\d{1,2}[.)]\s+/).map(x => x.trim()).filter(Boolean) : [];
  const pieces = numbered.length > 1 ? numbered : raw.split(SEPARATOR).map(x => x.trim()).filter(Boolean);
  const words = t => t.split(/\s+/).filter(Boolean).length;
  const clause = piece => {
    for (const m of piece.matchAll(/,?\s+and\s+/gi)) {
      const a = piece.slice(0, m.index).trim(), b = piece.slice(m.index + m[0].length).trim();
      if (words(a) < 3 || words(b) < 3) continue;
      // S5: "... and who owns it" is the owner flag on the same company, never a part of its own
      if (/^(?:who owns|whose (?:is|are)|(?:the |its )?owner)\b/i.test(b) && !parseAsk(b, vocab, { today, names }).company.length) continue;
      const sa = signature(parseAsk(a, vocab, { today, names })), sb = signature(parseAsk(b, vocab, { today, names }));
      if (sa && sb && sa !== sb) return [a, ...clause(b)];
    }
    return [piece];
  };
  const all = pieces.flatMap(clause);
  return { parts: all.length ? all.slice(0, PARTS_MAX) : [raw], cut: Math.max(0, all.length - PARTS_MAX) };
}

// Each record is cited by a short label [r1]…[rN] (numbered in the order it enters the pack) - a uuid token costs the
// model ~25 output tokens a record; the label maps back to the record here, never in the prompt.
// -> { ask, pack, items: Map(label -> item), stats, glossary, businesses }
// scout-v3.1 C6: a read line names the read and its counts - never a record id (a uuid, a person key, a member id).
const UUID_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
export const publicRead = read => String(read || '').replace(/"owner":"[^"]+"/g, '"owner":"a member"').replace(/\/(?:prospect|person|contact):[^\s·+]+/g, '/person').replace(new RegExp(`/?${UUID_G.source}`, 'gi'), '').replace(/ {2,}/g, ' ').trim();

// follow = what a follow-up resolved to (followUp.js): { rows: [{ entity, id, title, company }], company?: true }.
export async function buildContext(supabase, registry, { auth, scope, q, now = Date.now(), follow = null }) {
  const businesses = await scopedBusinesses(supabase, auth, scope);
  const today = laDateString(new Date(now));
  const many = businesses.length > 1;
  const glossary = [], vocabParts = [], per = [], indexes = [];
  for (const b of businesses) for (const m of registry.modulesFor(b)) {
    vocabParts.push(m.vocabulary);
    if (m.nameIndex) indexes.push(await m.nameIndex(supabase, { businessId: b.id, today, now }));
    const g = m.glossary ? await m.glossary(supabase, { businessId: b.id, business: b, auth, today, now }) : null;
    if (g) { vocabParts.push(g.vocabulary); glossary.push(...(g.lines || []).map(l => (many ? `${b.name}: ${l}` : l))); }
    per.push({ b, m });
  }
  const vocab = mergeVocab(vocabParts);
  const first = (list, f) => { for (const i of list) { const e = f(i); if (e) return e; } return null; };
  const names = indexes.length ? { find: t => first(indexes, i => { const e = i.find(t); return e && e.type !== 'visitor' ? e : null; }) || first(indexes, i => i.find(t)), near: t => indexes.flatMap(i => i.near(t)).slice(0, 3) } : null;
  const signature = a => { const ids = per.flatMap(({ m }) => m.intents.filter(x => x.match(a)).map(x => x.id)); return ids.length ? `${[...new Set(ids)].join('+')}|${a.entity || ''}` : ''; };
  const split = splitAsk(q, vocab, { today, signature, names });
  const multi = split.parts.length > 1;
  const budget = Math.floor(PACK_MAX / split.parts.length);
  const items = new Map(), labels = new Map(), lines = [], seen = new Set(), rowsByEntity = {}, reads = [], matchedAll = [], parts = [];
  let chars = 0, droppedPii = 0, truncated = 0, carry = [];
  const push = line => { lines.push(line); chars += line.length + 1; };
  for (const [pi, text] of split.parts.entries()) {
    const ask = parseAsk(text, vocab, { today, names });
    // D2 / R11: a pronoun carries the previous part's companies ("... and show my tasks for them").
    if (ask.pronoun && !ask.company.length && carry.length) { ask.company = carry.slice(0, 3); ask.carried = true; }
    // C1: a follow-up's rows become this ask's filter - the people themselves on a people ask, their companies on a
    // task ask (or "that company"), else the records by name (a company, or a person for the brief).
    if (follow?.rows.length && split.parts.length === 1) {
      const people = follow.rows.filter(r => r.entity === 'people'), companies = follow.rows.filter(r => r.entity !== 'people' && r.entity !== 'todos');
      const uniq = list => [...new Set(list.filter(Boolean))].slice(0, FOLLOW_MAX);
      const aboutPeople = ask.entity === 'people' || ask.flags.opened || ask.flags.replied || ask.flags.clicked;
      ask.pronoun = false; ask.resolved = true; ask.guess = null;
      if (people.length && aboutPeople && !follow.company) ask.follow = { people: people.map(r => String(r.id)) };
      else ask.company = uniq([...companies.map(r => r.title), ...people.map(r => (follow.company || ask.entity === 'todos' ? r.company?.name : r.title))]);
    }
    let found = []; // { item, b, priority }
    const partReads = [], matched = [], rules = [], titles = [], missing = [], idle = [];
    let total = null, brief = null, fill = null;
    const add = (list, b, entity, priority) => { for (const it of list || []) found.push({ item: { entity, ...it }, b, priority }); };
    for (const { b, m } of per) {
      const ctx = { businessId: b.id, business: b, auth, ask, today, now };
      const hit = m.intents.filter(i => i.match(ask));
      for (const i of hit) {
        const r = await i.run(supabase, ctx);
        matched.push(i.id); partReads.push(many ? `${b.name}: ${r.read}` : r.read); add(r.items, b, null, 1);
        const rule = r.rule || (typeof i.rule === 'function' ? i.rule(ask) : i.rule); if (rule) rules.push(rule);
        // an intent marked `context` (a brief riding along with a list) lends its lines, not the section's title or count
        const title = typeof i.title === 'function' ? i.title(ask) : i.title; if (title) titles.push({ title, context: !!i.context });
        if (typeof r.total === 'number' && !(i.context && hit.length > 1)) total = (total || 0) + r.total;
        if (r.brief) brief = r.brief;
        if (r.fill) fill = r.fill;
        if (r.missing) missing.push(...r.missing);
      }
      if (!hit.length) {
        if (ask.search) for (const e of m.entities) {
          if (ask.entity && e.entity !== ask.entity) continue;
          if (e.gate && !e.gate({ words: ask.terms, q: ask.search })) continue;
          const rows = await e.search(supabase, { ...ctx, q: ask.search, words: ask.terms, limit: SEARCH_LIMIT });
          if (rows.length) { partReads.push(many ? `${b.name}: search ${e.entity}` : `search ${e.entity}`); add(rows, b, e.entity, 2); }
        }
        idle.push({ b, m, ctx });
      }
    }
    // S4: one name was asked for and no record, person or search hit carries it -> no standing reads and no model
    // call: the can't-do state, with the visits when the site has seen that company and a near name when there is one.
    // A guessed name with a near record is offered that record even when the loose search found rows.
    const guessed = !matched.length && ask.guess && (!found.length || names?.near(ask.guess).length) ? ask.guess : null;
    const unknown = split.parts.length === 1 ? (!found.length && missing[0]) || guessed || null : null;
    if (unknown) {
      const typedName = cleanText(String(unknown), 60);
      const seen = names?.find(typedName), visitor = seen?.type === 'visitor' ? seen : null;
      const near = visitor ? [] : names?.near(typedName) || [];
      const said = `No record named ${visitor ? visitor.name : typedName} in Prospector${visitor ? ` · ${visitor.seen}` : ''}`;
      const lead = ask.flags.owner ? 'who owns' : 'tell me about';
      return { businesses, ask, cant: {
        reason: hasPii(said) ? 'No record by that name in Prospector' : said,
        ...(visitor?.add ? { add: { ...visitor.add, name: visitor.name } } : {}),
        ...(near.length ? { did_you_mean: true, candidates: near.map(e => ({ key: refOf(e.entity, e.id), entity: e.entity, id: e.id, title: e.name, ask: `${lead} "${e.name}"` })) } : {}),
      } };
    }
    for (const { b, m, ctx } of idle) if (m.standing) { const r = await m.standing(supabase, ctx); partReads.push(...(r.reads || []).map(x => (many ? `${b.name}: ${x}` : x))); add(r.items, b, null, 3); }
    found.sort((a, b) => a.priority - b.priority);
    if (ask.limit && matched.length) { const keep = new Set(); found = found.filter(f => { const k = refOf(f.item.entity, f.item.id); if (keep.has(k)) return true; if (keep.size >= ask.limit) return false; keep.add(k); return true; }); }
    const named = ask.carried ? [] : ask.company.length ? ask.company : [...new Set(found.map(f => f.item.company).filter(Boolean))].slice(0, 5);
    if (named.length) carry = named;
    reads.push(...partReads); matchedAll.push(...matched);
    if (multi) push(`PART ${pi + 1} of ${split.parts.length}: "${cleanText(text, 200)}"`);
    // A5: no intent in any module matched -> the first context line says so and offers three of the modules' own example
    // phrasings (each intent declares one; the `suggest` ones first) so the answer can say what was read and how to ask.
    if (!matched.length) {
      const examples = nearExamples(text, per.flatMap(({ m }) => m.intents));
      push(`No specific read matched this question; the context below is the standing summary (${partReads.join(' · ') || 'nothing read'}).${examples.length ? ` Closer phrasings: ${examples.map(e => `'${e}'`).join(' · ')}` : ''}`);
    }
    const start = chars, partLabels = [], groups = [];
    for (const { item, b, priority } of found) {
      const entity = item.entity, id = String(item.id);
      const body = cleanText(String(item.text || [item.title, item.subtitle, item.date].filter(Boolean).join(' · ')), 700);
      if (hasPii(body)) { droppedPii += 1; continue; }
      const label = labels.get(refOf(entity, id)) || `r${labels.size + 1}`;
      const line = `[${label}] ${body}${many ? ` · workspace ${b.name}` : ''}`;
      const key = `${pi}|${refOf(entity, id)}|${body}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (chars - start + line.length + 1 > budget) { truncated += 1; continue; }
      push(line);
      rowsByEntity[entity] = (rowsByEntity[entity] || 0) + 1;
      if (!partLabels.includes(label)) partLabels.push(label);
      // G1: an intent's items may name their group (the agenda's Due · Pinned · Goals …) - the answer's sections
      if (item.group && priority === 1) { const g = groups.find(x => x.title === item.group) || groups[groups.push({ title: item.group, labels: [] }) - 1]; if (!g.labels.includes(label)) g.labels.push(label); }
      if (!labels.has(refOf(entity, id))) {
        labels.set(refOf(entity, id), label);
        const open = registry.openerFor(entity);
        // the row's words are checked, not its ids (a uuid reads as a phone shape)
        const row = item.row && !hasPii([item.row.name, item.row.title, item.row.text, item.row.company?.name].filter(Boolean).join(' · ')) ? item.row : null;
        // a row's company / link ref opens through its own entity's opener (the client never builds a route)
        if (row) for (const ref of [row.company, row.link]) if (ref?.entity && ref.id) { const o = registry.openerFor(ref.entity); ref.open = o ? o(String(ref.id), ref) : null; }
        items.set(label, { entity, id, title: cleanText(String(item.title || body), 160), workspace_id: b.id, workspace_name: b.name, open: open ? open(id, item) : null, why: body, subtitle: item.subtitle && !hasPii(String(item.subtitle)) ? cleanText(String(item.subtitle), 160) : null, date: item.date || null, score: typeof item.score === 'number' ? item.score : null, ...(row ? { row } : {}), ...(item.quiet ? { quiet: true } : {}) });
      }
    }
    if (multi && !partLabels.length && matched.length) push('(no rows for this part)');
    // S3: the owner stays on the server (the answer's first sentence is built from it); the client gets the grid
    const { owner = null, ...shown } = brief || {};
    parts.push({ q: text, ask, intent: matched.length ? [...new Set(matched)].join('+') : 'none', title: (titles.find(t => !t.context) || titles[0])?.title || null, rule: rules.join(' ') || null, read: partReads.map(publicRead).join(' · '), labels: partLabels, groups: groups.length ? groups : null, count: total ?? partLabels.length, fill, brief: (ask.flags.brief || ask.flags.owner) && brief ? shown : null, owner: ask.flags.owner && owner ? owner : null });
  }
  const intent = matchedAll.length ? [...new Set(matchedAll)].join('+') : 'none';
  return { ask: parts[0].ask, parts, parts_cut: split.cut, pack: lines.join('\n'), lines, items, glossary: [...new Set(glossary)], businesses, stats: { intent, parts: parts.length, rows_by_entity: rowsByEntity, reads: reads.map(publicRead), dropped_pii: droppedPii, truncated, chars, try: nearExamples(q, per.flatMap(({ m }) => m.intents)), lines: lines.length, workspaces: [...new Set(per.map(p => p.b.name))] } };
}
