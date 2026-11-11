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
  'opened', 'replied', 'replies', 'reply', 'clicked', 'clicks', 'click', 'visited', 'visiting', 'visitor', 'visitors', 'companies', 'company', 'emails', 'email', 'site', 'website', 'web']);
const CAP_STOP = new Set(['Show', 'What', 'Which', 'Who', 'Where', 'When', 'How', 'My', 'I', 'Me', 'The', 'List', 'Give', 'Find', 'Tell', 'Do', 'Does', 'Did', 'Are', 'Is', 'Scout', 'Hot', 'Warm', 'Cool', 'Cold', 'Yesterday', 'Today', 'This', 'Last', 'Prospector', 'Brad']);
const phraseIn = (text, phrase) => new RegExp(`(^|[^a-z])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(text);

// Merged vocabulary of the modules in scope (static words + the glossary's dynamic ones).
export function mergeVocab(parts) {
  const out = { entities: {}, bands: {}, sources: {}, stems: {} };
  for (const v of parts.filter(Boolean)) {
    for (const [k, words] of Object.entries(v.entities || {})) out.entities[k] = [...new Set([...(out.entities[k] || []), ...words])];
    Object.assign(out.bands, v.bands || {});
    Object.assign(out.sources, v.sources || {});
    Object.assign(out.stems, v.stems || {});
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
export function parseAsk(q, vocab, { today }) {
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
  const caps = [];
  for (const tok of raw.replace(/[",.?!;:()]/g, ' ').split(/\s+/)) {
    const last = caps[caps.length - 1];
    if (/^\p{Lu}[\p{L}\p{N}&'’.-]*$/u.test(tok) && !CAP_STOP.has(tok) && !vocabWords.has(tok.toLowerCase())) { if (last) last.push(tok); else caps.push([tok]); }
    else if (last) caps.push(null);
  }
  const company = [...new Set([...quoted, ...caps.filter(Boolean).map(c => c.join(' '))].filter(Boolean))].slice(0, 3);
  const flags = {
    visitors: /\bvisit(ed|or|ors|s|ing)?\b/.test(text) || stemFlags.has('visitors'), site: stemFlags.has('site'),
    ranked: /\brank(ed|ing)?\b|\btop\b|\bscores?\b|\bhottest\b/.test(text) || superlative, attention: /\battention\b|\bstale\b|\bfailed\b|\bbroken\b/.test(text),
    funnel: /\bfunnel\b|\breferr(ed|al|als)\b/.test(text), emails: /\bsequences?\b|\bopen rate\b|\breply rate\b|\bemails? (doing|performing|going)\b|\bhow are (my |our )?emails\b/.test(text),
    opened: /\bopen(ed|s)\b/.test(text), replied: /\brepl(ied|ies|y)\b/.test(text), clicked: /\bclick(ed|s)\b/.test(text),
    // email-funnel-v1 F7: "email to site rate", "emails -> website visits", "visit rate", "email funnel" -> the funnel route.
    brief: /\bbrief\b|\bintel\b|\bpull\b|\bwhat do we know\b|\btell me about\b|\brecent call\b|\bnotes on\b/.test(text),
    email_site: /\bemails?\b[^.?!]{0,16}\b(to|into|vs|versus|→|->)\s+(the\s+)?(site|website|web|visits?|visitors)\b|\b(site|website|visit|visitor|conversion) rate\b|\bemail funnel\b|\bfunnel\b[^.?!]{0,12}\bemails?\b/.test(text),
  };
  // scout-v3 D1: "who" with a heat word and no entity word asks for people ("who's hot"); "who visited" stays companies.
  if (!entity && vocab.entities?.people && /\bwhos?\b/.test(text) && (band || superlative) && !flags.visitors) entity = 'people';
  // scout-v3 D2 / R11: a count is a limit ("5 most important", "top 3") - never the n of "last n days" or a date's day.
  const limit = [...text.matchAll(/(?<!\b(?:last|past|in)\s)(?<!\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s)\b(\d{1,2})\b(?!\s*(?:days?|d|weeks?|months?|st|nd|rd|th)\b|[.:/-]\d)/g)].map(m => Number(m[1])).find(n => n >= 1 && n <= 50) || null;
  const pronoun = /\b(them|they|their|these|those companies|that company)\b/.test(text);
  // A3: a band word on a people ask is a heat band (hot / warm / cold), on a company ask the intent band (P1-P4).
  const bandKind = !band ? null : entity === 'people' || flags.opened || flags.replied || flags.clicked ? 'heat' : 'intent';
  const terms = words.filter(w => !STOP.has(w) && !vocabWords.has(w) && w.length > 1 && !/^\d+$/.test(w));
  return { q: raw, limit, pronoun, mine: /\b(my|mine|i|ive|im)\b/.test(text), entity, since: time?.since || null, until: time?.until || null, since_kind: time?.kind || null, band, bandKind, source, sort, company, flags, terms, search: terms.join(' ') };
}

const refOf = (entity, id) => `${entity}:${id}`;

// scout-v3 D2 - the section planner's first half: a multi-part ask -> its parts. Separators: ";", "and show", "and
// also", "then", a numbered "1. 2."; and the different-clause rule - a bare "and" splits when both sides (3+ words
// each) match an intent of their own and the two differ (by intents or entity). `signature(ask)` is the caller's view of
// the modules in scope ('' when no intent matches). At most PARTS_MAX parts; `cut` counts the rest.
export const PARTS_MAX = 5;
const SEPARATOR = /\s*;\s*|\s+(?:and\s+then|and\s+also|and\s+show(?:\s+me)?|then(?:\s+show(?:\s+me)?)?|also\s+show(?:\s+me)?)\s+/i;
export function splitAsk(q, vocab, { today, signature }) {
  const raw = String(q || '').trim();
  const numbered = /(?:^|\s)1[.)]\s/.test(raw) ? raw.split(/(?:^|\s)\d{1,2}[.)]\s+/).map(x => x.trim()).filter(Boolean) : [];
  const pieces = numbered.length > 1 ? numbered : raw.split(SEPARATOR).map(x => x.trim()).filter(Boolean);
  const words = t => t.split(/\s+/).filter(Boolean).length;
  const clause = piece => {
    for (const m of piece.matchAll(/,?\s+and\s+/gi)) {
      const a = piece.slice(0, m.index).trim(), b = piece.slice(m.index + m[0].length).trim();
      if (words(a) < 3 || words(b) < 3) continue;
      const sa = signature(parseAsk(a, vocab, { today })), sb = signature(parseAsk(b, vocab, { today }));
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
export async function buildContext(supabase, registry, { auth, scope, q, now = Date.now() }) {
  const businesses = await scopedBusinesses(supabase, auth, scope);
  const today = laDateString(new Date(now));
  const many = businesses.length > 1;
  const glossary = [], vocabParts = [], per = [];
  for (const b of businesses) for (const m of registry.modulesFor(b)) {
    vocabParts.push(m.vocabulary);
    const g = m.glossary ? await m.glossary(supabase, { businessId: b.id, business: b, auth, today, now }) : null;
    if (g) { vocabParts.push(g.vocabulary); glossary.push(...(g.lines || []).map(l => (many ? `${b.name}: ${l}` : l))); }
    per.push({ b, m });
  }
  const vocab = mergeVocab(vocabParts);
  const signature = a => { const ids = per.flatMap(({ m }) => m.intents.filter(x => x.match(a)).map(x => x.id)); return ids.length ? `${[...new Set(ids)].join('+')}|${a.entity || ''}` : ''; };
  const split = splitAsk(q, vocab, { today, signature });
  const multi = split.parts.length > 1;
  const budget = Math.floor(PACK_MAX / split.parts.length);
  const items = new Map(), labels = new Map(), lines = [], seen = new Set(), rowsByEntity = {}, reads = [], matchedAll = [], parts = [];
  let chars = 0, droppedPii = 0, truncated = 0, carry = [];
  const push = line => { lines.push(line); chars += line.length + 1; };
  for (const [pi, text] of split.parts.entries()) {
    const ask = parseAsk(text, vocab, { today });
    // D2 / R11: a pronoun carries the previous part's companies ("... and show my tasks for them").
    if (ask.pronoun && !ask.company.length && carry.length) { ask.company = carry.slice(0, 3); ask.carried = true; }
    let found = []; // { item, b, priority }
    const partReads = [], matched = [], rules = [], titles = [];
    let total = null, brief = null;
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
      }
      if (!hit.length) {
        if (ask.search) for (const e of m.entities) {
          if (ask.entity && e.entity !== ask.entity) continue;
          if (e.gate && !e.gate({ words: ask.terms, q: ask.search })) continue;
          const rows = await e.search(supabase, { ...ctx, q: ask.search, words: ask.terms, limit: SEARCH_LIMIT });
          if (rows.length) { partReads.push(many ? `${b.name}: search ${e.entity}` : `search ${e.entity}`); add(rows, b, e.entity, 2); }
        }
        if (m.standing) { const r = await m.standing(supabase, ctx); partReads.push(...(r.reads || []).map(x => (many ? `${b.name}: ${x}` : x))); add(r.items, b, null, 3); }
      }
    }
    found.sort((a, b) => a.priority - b.priority);
    if (ask.limit && matched.length) { const keep = new Set(); found = found.filter(f => { const k = refOf(f.item.entity, f.item.id); if (keep.has(k)) return true; if (keep.size >= ask.limit) return false; keep.add(k); return true; }); }
    const named = ask.carried ? [] : ask.company.length ? ask.company : [...new Set(found.map(f => f.item.company).filter(Boolean))].slice(0, 5);
    if (named.length) carry = named;
    reads.push(...partReads); matchedAll.push(...matched);
    if (multi) push(`PART ${pi + 1} of ${split.parts.length}: "${cleanText(text, 200)}"`);
    // A5: no intent in any module matched -> the first context line says so and offers three of the modules' own example
    // phrasings (each intent declares one; the `suggest` ones first) so the answer can say what was read and how to ask.
    if (!matched.length) {
      const withExample = per.flatMap(({ m }) => m.intents.filter(i => i.example));
      const examples = [...new Set([...withExample.filter(i => i.suggest), ...withExample.filter(i => !i.suggest)].map(i => i.example))].slice(0, 3);
      push(`No specific read matched this question; the context below is the standing summary (${partReads.join(' · ') || 'nothing read'}).${examples.length ? ` Try: ${examples.map(e => `'${e}'`).join(' · ')}` : ''}`);
    }
    const start = chars, partLabels = [];
    for (const { item, b } of found) {
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
      if (!labels.has(refOf(entity, id))) {
        labels.set(refOf(entity, id), label);
        const open = registry.openerFor(entity);
        // the row's words are checked, not its ids (a uuid reads as a phone shape)
        const row = item.row && !hasPii([item.row.name, item.row.title, item.row.text, item.row.company?.name].filter(Boolean).join(' · ')) ? item.row : null;
        // a row's company / link ref opens through its own entity's opener (the client never builds a route)
        if (row) for (const ref of [row.company, row.link]) if (ref?.entity && ref.id) { const o = registry.openerFor(ref.entity); ref.open = o ? o(String(ref.id), ref) : null; }
        items.set(label, { entity, id, title: cleanText(String(item.title || body), 160), workspace_id: b.id, workspace_name: b.name, open: open ? open(id, item) : null, why: body, subtitle: item.subtitle && !hasPii(String(item.subtitle)) ? cleanText(String(item.subtitle), 160) : null, date: item.date || null, score: typeof item.score === 'number' ? item.score : null, ...(row ? { row } : {}) });
      }
    }
    if (multi && !partLabels.length && matched.length) push('(no rows for this part)');
    parts.push({ q: text, ask, intent: matched.length ? [...new Set(matched)].join('+') : 'none', title: (titles.find(t => !t.context) || titles[0])?.title || null, rule: rules.join(' ') || null, read: partReads.join(' · '), labels: partLabels, count: total ?? partLabels.length, brief: ask.flags.brief && brief ? brief : null });
  }
  const intent = matchedAll.length ? [...new Set(matchedAll)].join('+') : 'none';
  return { ask: parts[0].ask, parts, parts_cut: split.cut, pack: lines.join('\n'), lines, items, glossary: [...new Set(glossary)], businesses, stats: { intent, parts: parts.length, rows_by_entity: rowsByEntity, reads, dropped_pii: droppedPii, truncated, chars, lines: lines.length, workspaces: [...new Set(per.map(p => p.b.name))] } };
}
