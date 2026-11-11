import { laDateString } from '../salesAnalytics/periods';

// scout-v2 REV3 Stage 2 - the bar's pure parts: the remembered scope (B2), the day's thread (D12), the matched-text
// split (B3), what a typed line means (one input; what you typed decides), the answer's sort (B4), the footer line
// (from the usage row and context_stats, never a constant) and the Add as task body (D14).

// localStorage keys: prospector_scout_scope = { [userId]: '<businessId>' | 'all' } (B2, remembered per user);
// prospector_scout_thread = { user, day, turns: [...] } (D12: the last 6 turns, per user per LA day).
export const SCOPE_KEY = 'prospector_scout_scope';
export const THREAD_KEY = 'prospector_scout_thread';
export const THREAD_MAX = 6;
export const MIN_CHARS = 2;
export const DEBOUNCE_MS = 250;

const readJson = key => { try { const v = JSON.parse(localStorage.getItem(key)); return v && typeof v === 'object' ? v : null; } catch { return null; } };
const writeJson = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ } };

// options: [{ id, name, color }] + 'all'. A stored scope that is no longer one of them falls back.
export function pickScope({ userId, options, activeId }) {
  const stored = readJson(SCOPE_KEY)?.[userId];
  if (stored === 'all' || options.some(o => o.id === stored)) return stored;
  if (activeId && options.some(o => o.id === activeId)) return activeId;
  return options.length === 1 ? options[0].id : 'all';
}
export function saveScope(userId, scope) { writeJson(SCOPE_KEY, { ...(readJson(SCOPE_KEY) || {}), [userId]: scope }); }
export const allLabel = isOwner => (isOwner ? 'All workspaces' : 'All my workspaces');

export function readThread(userId, now = new Date()) {
  const t = readJson(THREAD_KEY);
  if (!t || t.user !== userId || t.day !== laDateString(now) || !Array.isArray(t.turns)) return [];
  return t.turns.slice(-THREAD_MAX);
}
export function saveThread(userId, turns, now = new Date()) {
  writeJson(THREAD_KEY, { user: userId, day: laDateString(now), turns: turns.slice(-THREAD_MAX) });
}
// The server's thread (≤ 6 messages): the last three turns as question + answer.
export const threadMessages = turns => turns.filter(t => t.answer_md).slice(-3).flatMap(t => [{ role: 'user', content: t.q }, { role: 'assistant', content: t.answer_md, ...(t.actions?.length ? { actions: t.actions } : {}) }]);

// The matched words of the query inside a title: [{ text, hit }] (case-insensitive, every occurrence).
export function splitMatch(text, q) {
  const s = String(text || '');
  const words = [...new Set(String(q || '').toLowerCase().split(/\s+/).filter(w => w.length >= MIN_CHARS))].sort((a, b) => b.length - a.length);
  if (!words.length || !s) return [{ text: s, hit: false }];
  const re = new RegExp(`(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return s.split(re).filter(Boolean).map(part => ({ text: part, hit: words.includes(part.toLowerCase()) }));
}

// One input: a question (a question word first, a "?", or 4+ words) asks on Enter; anything else opens the top hit.
const QUESTION = /^(who|what|which|when|where|why|how|show|list|give|find|tell|any|are|is|did|do|does|can|should)\b/i;
export const isQuestion = q => { const t = String(q || '').trim(); return /\?$/.test(t) || QUESTION.test(t) || t.split(/\s+/).length >= 4; };

const LIST_OF = { people: 'People', todos: 'Actions', call_notes: 'Actions', insights: 'Actions', accounts: 'Accounts', intel: 'Intel' };
// Where a row goes: a company-shaped row opens its window ("Open"); a row with a list destination names it.
export const destination = item => (LIST_OF[item.entity] ? `${LIST_OF[item.entity]} →` : 'Open');

const ENTITY_LABEL = { partners: 'Partner', employers: 'Employer', targets: 'Target', clients: 'Client', people: 'Person', todos: 'To-do', call_notes: 'Call note', insights: 'Insight', intel: 'Intel', accounts: 'Account', outlook: 'Outlook', visitor: 'Visitor' };
export const entityLabel = e => ENTITY_LABEL[e] || String(e || '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

export const recordsRead = stats => Object.values(stats?.rows_by_entity || {}).reduce((n, v) => n + v, 0);
export const costText = usage => (usage?.cost_usd == null ? null : `$${usage.cost_usd < 0.01 ? usage.cost_usd.toFixed(4) : usage.cost_usd.toFixed(3)}`);
export function footerParts(answer) {
  const reads = answer?.context_stats?.reads || [];
  return {
    records: recordsRead(answer?.context_stats),
    reads: reads.length ? `${reads.length} read${reads.length === 1 ? '' : 's'}: ${reads.join(' · ')}` : '0 reads',
    cost: costText(answer?.usage),
    asks: answer?.cap ? `${answer.cap.used} of ${answer.cap.max} asks today` : null,
  };
}

// Scout's actions: Members and above, in one sales workspace (never "all", never a Viewer).
export function canActIn(scope, me, businesses) {
  const b = businesses.find(x => x.id === scope);
  if (!b?.features?.goals_sales || !me) return false;
  if (me.profile?.is_platform_owner) return true;
  const role = me.memberships?.find(m => m.business_id === scope)?.role;
  return !!role && role !== 'viewer';
}
export const isViewerIn = (me, scope, options) => {
  if (!me || me.profile?.is_platform_owner) return false;
  const ids = scope === 'all' ? options.map(o => o.id) : [scope];
  return ids.length > 0 && ids.every(id => me.memberships?.find(m => m.business_id === id)?.role === 'viewer');
};

// The thread's one-line summary of an answer: its first sentence.
export const summaryOf = text => { const s = String(text || '').replace(/\s+/g, ' ').trim(); const m = /^(.{1,110}?[.!?])(\s|$)/.exec(s); return m ? m[1] : s.slice(0, 110); };
export const clock = ts => new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: false, timeZone: 'America/Los_Angeles' });
