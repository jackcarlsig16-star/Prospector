import { hasPii } from './scrubText.js';

// intent-score-v1 S7 - the HARD rules on a Write email draft, enforced in code on the model's draft AND on any pasted
// draft (POST goals/compose/lint). Pure: inputs are the draft, the Brief's lines (refs), the workspace rules row
// (sales_settings.compose_rules, defaults below) and the sender's first name. Every number in the draft must appear
// in a Brief line or in the proof points; every claim the model made must trace to a Brief ref.
export const DEFAULT_COMPOSE_RULES = {
  max_words: 150,
  ask_minutes: 15,
  proof_points: [],
  banned_claims: ['guarantee', 'guaranteed', 'best in class', 'best-in-class', 'industry leading', 'industry-leading', '#1', 'no risk', 'risk free', 'risk-free', 'free money', 'revolutionary', 'game changer', 'game-changer'],
};
const NUMBER = /\d[\d,]*(?:\.\d+)?%?/g;
const PRICING = /\$\s?\d|\b(?:per|a|each)\s+(?:month|user|employee|seat|year|head)\b|\bpricing\b|\bprice\b|\bdiscount\b/i;
const DASH = /[—–]/;
const words = s => String(s || '').trim().split(/\s+/).filter(Boolean).length;
const norm = s => String(s || '').toLowerCase();
// Times of day and [placeholders] like [Tue 10am] are not facts; everything else with a digit must trace.
const NOT_FACTS = /\[[^\]]*\]|\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/gi;
export const refsOf = v => (Array.isArray(v) ? v : String(v || '').split(/[,\s;/&]+/)).map(x => String(x).trim().toUpperCase()).filter(x => /^B\d+$/.test(x));
const numbersIn = s => (String(s || '').replace(NOT_FACTS, ' ').match(NUMBER) || []).map(n => n.replace(/,/g, ''));

export function mergeRules(row) {
  const r = row && typeof row === 'object' ? row : {};
  return {
    max_words: Number.isInteger(r.max_words) && r.max_words > 0 ? r.max_words : DEFAULT_COMPOSE_RULES.max_words,
    ask_minutes: Number.isInteger(r.ask_minutes) && r.ask_minutes > 0 ? r.ask_minutes : DEFAULT_COMPOSE_RULES.ask_minutes,
    proof_points: Array.isArray(r.proof_points) ? r.proof_points.map(String) : DEFAULT_COMPOSE_RULES.proof_points,
    banned_claims: Array.isArray(r.banned_claims) ? r.banned_claims.map(String) : DEFAULT_COMPOSE_RULES.banned_claims,
  };
}

// refs: [{ ref, text }] (the Brief lines); claims: [{ claim, brief_ref }] from the model (optional for a pasted draft).
export function lintDraft({ subject, body, claims = [], refs = [], rules = DEFAULT_COMPOSE_RULES, signOff = null }) {
  const issues = [];
  const add = (rule, detail) => issues.push({ rule, detail });
  const text = `${subject || ''}\n${body || ''}`;
  if (!String(subject || '').trim()) add('subject_missing', 'The draft has no subject line');
  if (!String(body || '').trim()) add('body_missing', 'The draft has no body');
  const refIds = new Set(refs.map(r => r.ref));
  // A claim may cite several lines ("B13, B14" or ["B13", "B14"]); every one it cites must be a Brief line.
  for (const c of Array.isArray(claims) ? claims : []) {
    const cited = refsOf(c?.brief_ref);
    const missing = cited.filter(r => !refIds.has(r));
    if (!c || !cited.length || missing.length) add('claim_unmatched', `"${String(c?.claim || '').slice(0, 120)}" does not trace to a Brief line${missing.length ? ` (${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not in the Brief)` : ''}`);
  }
  const known = new Set([...refs.flatMap(r => numbersIn(r.text)), ...rules.proof_points.flatMap(numbersIn), String(rules.ask_minutes)]);
  for (const n of new Set(numbersIn(body))) if (!known.has(n) && !known.has(n.replace(/%$/, ''))) add('number_unverified', `${n} is not in the Brief or the proof points`);
  for (const b of rules.banned_claims) if (b && norm(text).includes(norm(b))) add('banned_claim', `"${b}" is on the banned list`);
  if (PRICING.test(text)) add('pricing', 'No pricing in a first email');
  if (DASH.test(text)) add('dash', 'Use hyphens, not em or en dashes');
  if (signOff) {
    const last = String(body || '').trim().split('\n').map(l => l.trim()).filter(Boolean).pop() || '';
    if (norm(last).replace(/[,.!]/g, '') !== norm(signOff)) add('sign_off', `Sign off with your first name alone on the last line ("${signOff}")`);
  }
  const n = words(body);
  if (n > rules.max_words) add('length', `${n} words - the cap is ${rules.max_words}`);
  if (hasPii(text)) add('address', 'An email address or phone number is in the draft');
  return { ok: issues.length === 0, issues, words: n };
}
