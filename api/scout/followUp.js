// scout-v3.1 C1 - what a follow-up points at, resolved against the rows of the LAST answer (every section, in display
// order). One pure rule for asks and commands. Core: it names no workspace; `kinds` (the noun words per entity) are
// the caller's. -> { rows, how, phrase, pronoun?, ambiguous? }:
//   how  'named'   a row's own name, its company's name ("the Cloudflare ones"), or a first / last name one row carries
//        'ordinal' "the second one", "#3", "row 2", "the 3rd", "the last one", "the second and third"
//        'first'   "the first 3", "top two", "the last 2"
//        'all'     "them", "those", "these", "they", "their", "all of them", "everyone"
//        'one'     "her", "him", "that one", "this one", "it" after a preposition, "that company", "that person"
//        'none'    nothing in the text points at a row
// An ordinal or a pronoun followed by a noun counts inside that kind only ("the first task" is the first TASK). A
// singular pronoun with several rows to choose from is ambiguous: rows stays empty and the caller asks which one - it
// never guesses. "that company" on one person row is that person's company (company: true).
// ask: true = the text is a QUESTION, where the same words often mean something new, so only an explicit back-reference
// counts: "the first 3" needs "ones" / "of them" after it (a bare "top 5" is a new question), an ordinal needs "one" or
// a noun, and "they / their" do not point back when the question names its own subject before them.
const ORDINAL = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, '6th': 6, '7th': 7, '8th': 8, '9th': 9, '10th': 10 };
const COUNT = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const ORD = Object.keys(ORDINAL).join('|');
const NUM = `\\d{1,2}|${Object.keys(COUNT).filter(w => w !== 'one').join('|')}`;
export const KIND_WORDS = { people: ['person', 'people', 'prospect', 'prospects', 'contact', 'contacts', 'lead', 'leads'], todos: ['task', 'tasks', 'to-do', 'to-dos', 'todo', 'todos'], company: ['company', 'companies', 'account', 'accounts', 'employer', 'employers', 'partner', 'partners', 'target', 'targets'] };
const clean = s => String(s || '').toLowerCase().replace(/['’]/g, '');
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const TIME = '(?:weeks?|months?|days?|years?|d|time|touch|touched|email|emails|call|visit|step)';
export function resolveFollowUp(text, rows, { kinds = KIND_WORDS, companyEntities = ['partners', 'employers', 'targets'], ask = false, entities = null } = {}) {
  const t = ` ${clean(text)} `;
  const nounRe = Object.values(kinds).flat().sort((a, b) => b.length - a.length).map(esc).join('|');
  const kindOf = word => (word ? Object.keys(kinds).find(k => kinds[k].includes(word)) || null : null);
  // entities = the kinds the caller can use at all (a verb's): a bare "the last one" then counts inside them
  const base = entities ? rows.filter(r => entities.includes(r.entity)) : rows;
  const of = kind => (!kind ? base : kind === 'company' ? rows.filter(r => companyEntities.includes(r.entity)) : rows.filter(r => r.entity === kind));
  const the = phrase => { const i = t.indexOf(phrase); return i > 4 && t.slice(i - 4, i) === 'the ' ? `the ${phrase}` : phrase; };
  const out = (list, how, phrase, extra = {}) => ({ rows: list, how, phrase: the(phrase.trim()), ...extra });

  // a row's own name or its company's name, in full
  const named = rows.filter(r => [r.title, r.company?.name].filter(Boolean).some(n => String(n).length > 2 && t.includes(clean(n))));
  if (named.length) return out(named, 'named', [...new Set(named.flatMap(r => [r.title, r.company?.name]).filter(n => n && t.includes(clean(n))))][0]);

  // "the first 3", "top two tasks", "the last 2"
  const few = new RegExp(`\\b(first|top|last)\\s+(${NUM})(?:\\s+(${nounRe}))?\\b(?!\\s*${TIME}\\b)${ask ? '(?=\\s+(?:ones|of (?:them|those|these))\\b)' : ''}`).exec(t);
  if (few) { const n = COUNT[few[2]] || Number(few[2]), pool = of(kindOf(few[3])); return out(few[1] === 'last' ? pool.slice(-n) : pool.slice(0, n), 'first', few[0]); }
  // "the second one", "the 3rd task", "the last one", "the second and third"
  const ords = [...t.matchAll(new RegExp(`\\b(${ORD}|last)\\b(?!\\s+${TIME}\\b)(?!-)(?:\\s+(one|ones|${nounRe}))?`, 'g'))].filter(m => !/^\s*(?:of all|thing)\b/.test(t.slice(m.index + m[0].length)));
  const lead = ords.filter(m => m[2] || (/\bthe\s*$/.test(t.slice(0, m.index)) && (!ask || /^\s*(?:$|and\b|or\b|,)/.test(t.slice(m.index + m[0].length)))));
  // "the second and third": an ordinal joined to one that already points at a row
  const refs = lead.length ? ords.filter(m => lead.includes(m) || /\b(?:and|or|,)\s*(?:the\s+)?$/.test(t.slice(0, m.index)) || /^\s*(?:and|or|,)/.test(t.slice(m.index + m[0].length))) : [];
  if (refs.length) {
    const noun = refs.map(m => m[2]).find(w => w && !/^ones?$/.test(w));
    const pool = of(kindOf(noun));
    const picked = refs.map(m => (m[1] === 'last' ? pool[pool.length - 1] : pool[ORDINAL[m[1]] - 1])).filter(Boolean);
    return out([...new Set(picked)], 'ordinal', t.slice(refs[0].index, refs[refs.length - 1].index + refs[refs.length - 1][0].length));
  }
  // "#3", "row 2", "number 4"
  const nth = /(?:#|\b(?:row|number|no\.?)\s*)(\d{1,2})\b/.exec(t);
  if (nth) return out(base.slice(Number(nth[1]) - 1, Number(nth[1])), 'ordinal', nth[0]);

  // a first or last name that the rows of one kind carry ("Danilea")
  const partial = [];
  for (const m of String(text || '').matchAll(/\b\p{Lu}[\p{L}'’-]{2,}/gu)) {
    const w = clean(m[0]).replace(/s$/, ''), exact = clean(m[0]);
    const hits = rows.filter(r => r.entity !== 'todos').filter(r => { const parts = clean(r.title).split(/\s+/); return parts.length > 1 && [parts[0], parts[parts.length - 1]].some(p => p === exact || p === w); });
    if (hits.length) partial.push({ hits, phrase: m[0] });
  }
  if (partial.length) return out([...new Set(partial.flatMap(p => p.hits))], 'named', partial[0].phrase);

  // "them", "those tasks", "these", "they", "their", "all of them", "everyone"
  const all = new RegExp(`\\b(?:all of them|all of those|all (?:\\d{1,2}|${Object.keys(COUNT).join('|')})|everyone|every one|each of them|them|they|their|theirs|(?:those|these|all)(?:\\s+(${nounRe}))?)\\b`).exec(t);
  const timed = all && new RegExp(`^\\s*${TIME}\\b`).test(t.slice(all.index + all[0].length));
  // a question that names its own subject first ("which companies opened their emails") is not pointing back
  const own = all && ask && /^(?:they|their|theirs)$/.test(all[0]) && (new RegExp(`\\b(?:${nounRe})\\b`).test(t.slice(0, all.index)) || /\b\p{Lu}\p{L}{2,}/u.test(String(text || '').slice(1, Math.max(1, all.index - 1))));
  if (all && !timed && !own) return out(of(kindOf(all[1])), 'all', all[0], { pronoun: true });

  // "her", "him", "that one", "this company", "it" after a preposition or a verb that takes an object
  const one = new RegExp(`\\b(?:(?:that|this)\\s+(one|${nounRe})|(her|him|his|hers|she|he)|(?:about|for|to|on|with|of|snooze|assign|draft|copy|open)\\s+(it|this|that))\\b(?!\\s+(?:week|month|day|year))`).exec(t);
  if (one) {
    const kind = kindOf(one[1]);
    const pool = one[2] ? of('people') : of(kind);
    // "that company" on one person row = that person's company
    if (kind === 'company' && !pool.length) { const people = of('people').filter(r => r.company?.name); if (people.length === 1) return out(people, 'one', one[0], { pronoun: true, company: true }); return out([], 'one', one[0], { pronoun: true, ambiguous: people.length > 1 }); }
    return out(pool.length === 1 ? pool : [], 'one', one[0], { pronoun: true, ambiguous: pool.length > 1 });
  }
  return { rows: [], how: 'none', phrase: null };
}

// What was resolved, in words: "the second one → Meagan Earl, Cloudflare" (a person carries their company; at most
// three names, then "+ n more").
export function resolvedLine(r) {
  if (!r?.rows?.length || !r.phrase) return null;
  const name = x => (r.company ? x.company.name : x.company?.name && x.entity === 'people' ? `${x.title}, ${x.company.name}` : x.title);
  const names = r.rows.slice(0, 3).map(name);
  return `${r.phrase} → ${names.join(' · ')}${r.rows.length > 3 ? ` + ${r.rows.length - 3} more` : ''}`;
}
