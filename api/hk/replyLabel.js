// hkos-gmail-connect-v1 (G7) - one short FAST call labels a reply from brand name + subject + a <= 200-char snippet.
// The call is injected (callAnthropic in production, a stub in tests); the prompt never carries an address or a body.
import { MODELS } from '../../src/config/models.js';
import { cleanText } from '../sales/scrubText.js';

export const LABELS = ['interested', 'pricing', 'referral', 'decline', 'auto_reply', 'prefers_email', 'new_thread', 'other'];
export const URGENT = new Set(['interested', 'pricing']);
export const DAILY_CAP = 60;
export const SNIPPET_MAX = 200;
export const SUMMARY_MAX = 140;
export const CALL_TYPE = 'hk_reply_label';

export const isUrgent = label => URGENT.has(label);
export const capReached = (labelsToday, cap = DAILY_CAP) => labelsToday >= cap;
export const snippetOf = s => cleanText(s, SNIPPET_MAX);

export function buildPrompt({ brandName, subject, snippet }) {
  return {
    system: `You label one email reply to a sponsorship pitch. Reply with JSON only: {"label":"<one of ${LABELS.join('|')}>","summary":"<= ${SUMMARY_MAX} characters, plain words, no names, no addresses>"}.
interested = wants to talk or learn more; pricing = asks what it costs; referral = points to someone else; decline = no;
auto_reply = out of office or automatic; prefers_email = wants to keep it to email, no call; new_thread = unrelated to the pitch; other = anything else.`,
    messages: [{ role: 'user', content: `Brand: ${brandName || 'unknown'}\nSubject: ${subject || '(none)'}\nSnippet: ${snippetOf(snippet) || '(empty)'}` }],
  };
}

export function parseLabel(text, snippet = '') {
  const fallback = { label: 'other', summary: snippetOf(snippet).slice(0, SUMMARY_MAX) };
  try {
    const s = String(text || ''); const raw = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
    const label = LABELS.includes(raw.label) ? raw.label : 'other';
    const summary = cleanText(typeof raw.summary === 'string' && raw.summary.trim() ? raw.summary : fallback.summary, SUMMARY_MAX) || fallback.summary;
    return { label, summary };
  } catch { return fallback; }
}

// -> { label, summary, urgent, labeled } ; labeled=false when the cap held the call back (label other, next run retries).
export async function labelReply({ call, supabase, businessId, userId, brandName, subject, snippet, labelsToday = 0, cap = DAILY_CAP }) {
  const clean = snippetOf(snippet);
  if (capReached(labelsToday, cap)) return { label: 'other', summary: clean.slice(0, SUMMARY_MAX), urgent: false, labeled: false };
  const { system, messages } = buildPrompt({ brandName, subject, snippet: clean });
  const data = await call({ system, messages, model: MODELS.FAST, max_tokens: 200, thinking: false, timeoutMs: 30000, supabase, businessId, userId, callType: CALL_TYPE });
  const out = (data?.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const parsed = parseLabel(out, clean);
  return { ...parsed, urgent: isUrgent(parsed.label), labeled: true };
}
