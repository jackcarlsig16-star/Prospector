// hkos-data-foundation-v1 D3 - lint_draft: the server-side form of the outreach rules (skill v2 + lintSeed.json).
// Pure. Every problem quotes the offending text (<= 80 chars). level 'reject' blocks a draft; 'warn' does not.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const seed = require('./lintSeed.json');

const PHONE = /(?:\+?\d[\d\s().-]{7,}\d)/g;
const ISO_DATE = /^\s*\d{4}-\d{2}-\d{2}\s*$/;
const DASHES = /[–—]/;
const PRICING = /\$\s?\d|\bprice\b|\bpricing\b|\bcost\b|\bper month\b|\brate card\b/i;
const CALL_ASK = /\b15[\s-]?min(?:ute)?s?\b/i;
const SIGN_OFF = /^\s*(thanks|thank you|best|cheers|talk soon|warmly|regards|all the best)[,!.]?\s*$|^\s*[-–—]\s*\S/i;
const TITLE_LINE = /\b(founder|co-founder|ceo|coo|cmo|cto|director|manager|head of|vp|president|partnerships?)\b/i;
const STAT = /(\d[\d,]*)\s*\+?\s*(?:verified\s+)?(challenge completions|completions|members)\b/gi;
const URGENCY = /\b(last chance|act now|limited time|only \d+ (spots|seats) left|urgent|expires (today|tomorrow)|don't miss out|final notice)\b/i;
const PILLARS = ['fitness', 'community', 'mindfulness', 'sustainability', 'learning'];

const excerpt = (text, index, len = 60) => String(text).slice(Math.max(0, index - 20), Math.max(0, index - 20) + Math.min(80, len + 40)).replace(/\s+/g, ' ').trim();
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const toNumber = s => Number(String(s).replace(/,/g, ''));

export function subjectMatchesFormat(subject, format) {
  if (!format) return true;
  const re = new RegExp('^' + escapeRe(format).replace(/\\\[[^\]]*\\\]/g, '.+') + '$', 'i');
  return re.test(String(subject || '').trim());
}

// settings: { banned_phrases: [], subject_format, members_stat, completions_stat }
export function lintDraft(subject, body, kind, settings = {}) {
  const problems = [];
  const push = (rule, message, text, level = 'reject') => problems.push({ rule, message, excerpt: String(text).slice(0, 80), level });
  const all = `${subject || ''}\n${body || ''}`;
  const dash = all.match(DASHES);
  if (dash) push('dash', 'No em or en dashes - use a plain hyphen.', excerpt(all, dash.index));
  const phrases = [...new Set([...(settings.banned_phrases || []), ...seed.banned_words].map(p => String(p).trim().toLowerCase()).filter(Boolean))];
  for (const p of phrases) {
    const m = new RegExp(`(^|[^a-z])${escapeRe(p)}(?![a-z])`, 'i').exec(all);
    if (m) push('banned_phrase', `"${p}" is on the banned list.`, excerpt(all, m.index + m[1].length));
  }
  const price = PRICING.exec(all);
  if (price) push('pricing', 'No pricing in outreach - pricing belongs on the call.', excerpt(all, price.index));
  if ((kind === 'cold' || kind === 'bump') && !CALL_ASK.test(all)) push('call_ask', 'A cold or bump email ends with a soft 15-minute call ask.', (body || '').trim().split('\n').filter(Boolean).pop() || '');
  const lines = String(body || '').split('\n');
  const signOffAt = lines.findIndex(l => SIGN_OFF.test(l));
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const phones = (l.match(PHONE) || []).filter(m => !ISO_DATE.test(m));
    if (phones.length) { push('phone_number', 'No phone numbers anywhere in a draft.', l.trim()); continue; }
    if (signOffAt >= 0 && i > signOffAt + 1 && l.trim() && TITLE_LINE.test(l)) push('signature_block', 'No typed signature block after the sign-off - first name only.', l.trim());
  }
  for (const m of all.matchAll(STAT)) {
    const n = toNumber(m[1]); const what = /member/i.test(m[2]) ? 'members' : 'completions';
    const want = what === 'members' ? settings.members_stat : settings.completions_stat;
    if (want != null && n !== Number(want)) push('stale_stat', `${what} stat ${m[1]} differs from hk_settings (${want}).`, excerpt(all, m.index, m[0].length));
  }
  const urgency = URGENCY.exec(all);
  if (urgency) push('fake_urgency', 'No fake urgency or pressure.', excerpt(all, urgency.index));
  const named = PILLARS.filter(p => new RegExp(`\\b${p}\\b`, 'i').test(body || ''));
  if (named.length === 5) push('all_five_pillars', 'Name the 3 most relevant pillars only, never all five.', named.join(', '));
  if (kind === 'cold' && settings.subject_format && !subjectMatchesFormat(subject, settings.subject_format)) push('subject_format', `Subject should follow "${settings.subject_format}".`, subject || '(empty)', 'warn');
  return problems;
}

export const lintRejects = problems => problems.filter(p => p.level === 'reject');
