import { normName } from './intakeMatch.js';

// todo-events-v1 T7 (K9) - which record a to-do's text names. A name counts when its words stand in the text as
// whole words AND the first of them is written with a capital (or a digit) there: a record called "test" or
// "Target" is not named by "test emails" or "the target company" (the Nov 10 backfill found exactly those three).
// -> { link: { link_type, link_id, name } } when ONE record is named · { choices: [...] } when several are (the
// screen asks which) · null when none is. records = [{ type: partner | opportunity | target, id, name }].
const MIN = 4, MAX_WORDS = 6;
export function linkFor(text, records) {
  const words = String(text || '').split(/[\s,;:()/]+/).filter(Boolean);
  const named = new Map();
  const byName = new Map();
  for (const r of records) { const n = normName(r.name); if (n.length >= MIN) byName.set(n, [...(byName.get(n) || []), r]); }
  for (let i = 0; i < words.length; i++) {
    if (!/^[\p{Lu}\d]/u.test(words[i].replace(/^["'“‘]+/, ''))) continue;
    for (let len = 1; len <= MAX_WORDS && i + len <= words.length; len++) {
      for (const r of byName.get(normName(words.slice(i, i + len).join(' '))) || []) named.set(`${r.type}:${r.id}`, r);
    }
  }
  const hits = [...named.values()];
  if (!hits.length) return null;
  const one = hits.length === 1 ? hits[0] : null;
  return one ? { link: { link_type: one.type, link_id: one.id, name: one.name } } : { choices: hits.map(h => ({ type: h.type, id: h.id, name: h.name })) };
}

// The live records of a workspace as the accept context holds them (rejected targets name nothing to work on).
export const linkRecords = ctx => [
  ...(ctx.partners || []).map(p => ({ type: 'partner', id: p.id, name: p.name })),
  ...(ctx.opportunities || []).map(o => ({ type: 'opportunity', id: o.id, name: o.organization })),
  ...(ctx.targets || []).filter(t => t.status !== 'rejected' && t.status !== 'accepted').map(t => ({ type: 'target', id: t.id, name: t.name })),
];
