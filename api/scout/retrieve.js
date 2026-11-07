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
const STOP = new Set(['show', 'me', 'my', 'mine', 'i', 'the', 'a', 'an', 'of', 'for', 'to', 'in', 'on', 'at', 'and', 'or', 'with', 'about', 'from', 'what', 'which', 'who', 'where', 'when', 'how', 'is', 'are', 'do', 'does', 'did', 'list', 'give', 'find', 'tell', 'all', 'any', 'please', 'scout', 'sorted', 'sort', 'by', 'top', 'this', 'last', 'past', 'week', 'month', 'day', 'days', 'today', 'yesterday', 'they', 'them', 'their', 'our', 'we', 'have', 'has', 'had', 'be', 'been', 'it', 'its', 'that', 'these', 'those', 'say', 'says', 'said', 'touch', 'touched', 'ranked', 'rank', 'score', 'scores', 'hottest', 'newest', 'latest', 'recent', 'date', 'heat', 'open', 'closed', 'done', 'pending', 'new', 'old', 'current', 'active']);
const CAP_STOP = new Set(['Show', 'What', 'Which', 'Who', 'Where', 'When', 'How', 'My', 'I', 'Me', 'The', 'List', 'Give', 'Find', 'Tell', 'Do', 'Does', 'Did', 'Are', 'Is', 'Scout', 'Hot', 'Warm', 'Cool', 'Cold', 'Yesterday', 'Today', 'This', 'Last', 'Prospector', 'Brad']);
const phraseIn = (text, phrase) => new RegExp(`(^|[^a-z])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(text);

// Merged vocabulary of the modules in scope (static words + the glossary's dynamic ones).
export function mergeVocab(parts) {
  const out = { entities: {}, bands: {}, sources: {} };
  for (const v of parts.filter(Boolean)) {
    for (const [k, words] of Object.entries(v.entities || {})) out.entities[k] = [...new Set([...(out.entities[k] || []), ...words])];
    Object.assign(out.bands, v.bands || {});
    Object.assign(out.sources, v.sources || {});
  }
  return out;
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
  const text = raw.toLowerCase();
  const words = text.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(Boolean);
  const vocabWords = new Set();
  const entity = Object.entries(vocab.entities || {}).find(([, ws]) => ws.some(w => phraseIn(text, w)))?.[0] || null;
  for (const ws of Object.values(vocab.entities || {})) ws.forEach(w => vocabWords.add(w));
  const band = Object.entries(vocab.bands || {}).find(([w]) => phraseIn(text, w))?.[1] || null;
  Object.keys(vocab.bands || {}).forEach(w => vocabWords.add(w));
  const sourceHits = Object.entries(vocab.sources || {}).filter(([w]) => phraseIn(text, w)).sort((a, b) => b[0].length - a[0].length || (b[1] === 'upside') - (a[1] === 'upside'));
  const source = sourceHits.find(([, v]) => v !== 'partner_referral')?.[1] || sourceHits[0]?.[1] || null;
  Object.keys(vocab.sources || {}).forEach(w => vocabWords.add(w));
  const time = sinceOf(text, today);
  const sort = /\b(by|on) score\b|\bhighest score\b/.test(text) ? 'score' : /\bnewest|latest|most recent|by date\b/.test(text) ? 'date' : /\bby heat\b|\bhottest\b/.test(text) ? 'heat' : null;
  const quoted = [...raw.matchAll(/"([^"]{2,80})"|“([^”]{2,80})”/g)].map(m => m[1] || m[2]);
  const caps = [];
  for (const tok of raw.replace(/[",.?!;:()]/g, ' ').split(/\s+/)) {
    const last = caps[caps.length - 1];
    if (/^\p{Lu}[\p{L}\p{N}&'’.-]*$/u.test(tok) && !CAP_STOP.has(tok) && !vocabWords.has(tok.toLowerCase())) { if (last) last.push(tok); else caps.push([tok]); }
    else if (last) caps.push(null);
  }
  const company = [...new Set([...quoted, ...caps.filter(Boolean).map(c => c.join(' '))].filter(Boolean))].slice(0, 3);
  const flags = {
    visitors: /\bvisit(ed|or|ors|s)?\b/.test(text), ranked: /\brank(ed|ing)?\b|\btop\b|\bscores?\b|\bhottest\b/.test(text), attention: /\battention\b|\bstale\b|\bfailed\b|\bbroken\b/.test(text),
    funnel: /\bfunnel\b|\breferr(ed|al|als)\b/.test(text), emails: /\bsequences?\b|\bopen rate\b|\breply rate\b|\bemails? (doing|performing|going)\b|\bhow are (my |our )?emails\b/.test(text),
    opened: /\bopen(ed|s)\b/.test(text), replied: /\brepl(ied|ies|y)\b/.test(text), clicked: /\bclick(ed|s)\b/.test(text),
  };
  const terms = words.filter(w => !STOP.has(w) && !vocabWords.has(w) && w.length > 1 && !/^\d+$/.test(w));
  return { q: raw, mine: /\b(my|mine|i|i've|i'm)\b/.test(text), entity, since: time?.since || null, until: time?.until || null, since_kind: time?.kind || null, band, source, sort, company, flags, terms, search: terms.join(' ') };
}

const refOf = (entity, id) => `${entity}:${id}`;

// -> { ask, pack, items: Map(ref -> item), stats, glossary, businesses }
export async function buildContext(supabase, registry, { auth, scope, q, now = Date.now() }) {
  const businesses = await scopedBusinesses(supabase, auth, scope);
  const today = laDateString(new Date(now));
  const many = businesses.length > 1;
  const reads = [], glossary = [], vocabParts = [], per = [];
  for (const b of businesses) for (const m of registry.modulesFor(b)) {
    vocabParts.push(m.vocabulary);
    const g = m.glossary ? await m.glossary(supabase, { businessId: b.id, business: b, auth, today, now }) : null;
    if (g) { vocabParts.push(g.vocabulary); glossary.push(...(g.lines || []).map(l => (many ? `${b.name}: ${l}` : l))); }
    per.push({ b, m });
  }
  const vocab = mergeVocab(vocabParts);
  const ask = parseAsk(q, vocab, { today });
  const found = []; // { item, b, priority }
  const add = (items, b, entity, priority) => { for (const it of items || []) found.push({ item: { entity, ...it }, b, priority }); };
  for (const { b, m } of per) {
    const ctx = { businessId: b.id, business: b, auth, ask, today, now };
    const matched = m.intents.filter(i => i.match(ask));
    for (const i of matched) { const r = await i.run(supabase, ctx); reads.push(many ? `${b.name}: ${r.read}` : r.read); add(r.items, b, null, 1); }
    if (!matched.length) {
      if (ask.search) for (const e of m.entities) {
        if (ask.entity && e.entity !== ask.entity) continue;
        if (e.gate && !e.gate({ words: ask.terms, q: ask.search })) continue;
        const rows = await e.search(supabase, { ...ctx, q: ask.search, words: ask.terms, limit: SEARCH_LIMIT });
        if (rows.length) { reads.push(many ? `${b.name}: search ${e.entity}` : `search ${e.entity}`); add(rows, b, e.entity, 2); }
      }
      if (m.standing) { const r = await m.standing(supabase, ctx); reads.push(...(r.reads || []).map(x => (many ? `${b.name}: ${x}` : x))); add(r.items, b, null, 3); }
    }
  }
  found.sort((a, b) => a.priority - b.priority);
  const items = new Map(), lines = [], seen = new Set(), rowsByEntity = {};
  let chars = 0, droppedPii = 0, truncated = 0;
  for (const { item, b } of found) {
    const entity = item.entity, id = String(item.id);
    const body = cleanText(String(item.text || [item.title, item.subtitle, item.date].filter(Boolean).join(' · ')), 400);
    if (hasPii(body)) { droppedPii += 1; continue; }
    const line = `[${refOf(entity, id)}] ${body}${many ? ` · workspace ${b.name}` : ''}`;
    const key = `${refOf(entity, id)}|${body}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (chars + line.length + 1 > PACK_MAX) { truncated += 1; continue; }
    chars += line.length + 1;
    lines.push(line);
    rowsByEntity[entity] = (rowsByEntity[entity] || 0) + 1;
    if (!items.has(refOf(entity, id))) {
      const open = registry.openerFor(entity);
      items.set(refOf(entity, id), { entity, id, title: cleanText(String(item.title || body), 160), workspace_id: b.id, workspace_name: b.name, open: open ? open(id, item) : null, why: body, subtitle: item.subtitle && !hasPii(String(item.subtitle)) ? cleanText(String(item.subtitle), 160) : null, date: item.date || null, score: typeof item.score === 'number' ? item.score : null });
    }
  }
  return { ask, pack: lines.join('\n'), lines, items, glossary: [...new Set(glossary)], businesses, stats: { rows_by_entity: rowsByEntity, reads, dropped_pii: droppedPii, truncated, chars, lines: lines.length, workspaces: [...new Set(per.map(p => p.b.name))] } };
}
