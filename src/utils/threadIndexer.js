import { MODELS } from '../config/models';
import { getValidGmailToken } from './getValidGmailToken';
import { buildAccountEmailQuery, extractDomain as extractAccDomain } from './accountEmailQuery';

const CACHE_KEY = 'prospector_threads_cache';
const TTL_MS = 4 * 60 * 60 * 1000;
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 500;

let status = { running: false, processed: 0, total: 0 };
const listeners = new Set();
function setStatus(patch) {
  status = { ...status, ...patch };
  listeners.forEach(fn => { try { fn(status); } catch {} });
}
export function getIndexerStatus() { return status; }
export function subscribeIndexerStatus(fn) {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}

// extractDomain re-exported from accountEmailQuery so the cache key (which
// stays domain-keyed in this commit — see Option A trade-off) keeps using
// the same extraction pipeline that the query helper uses.
const extractDomain = extractAccDomain;

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; }
}

function writeCache(cache) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
}

async function fetchThreadsForAccount(acc, token) {
  const { q } = buildAccountEmailQuery(acc, { dateClause: ' newer_than:14d' });
  if (!q) return [];
  const listRes = await fetch(`/proxy/gmail/messages?q=${encodeURIComponent(q)}&maxResults=5`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listRes.ok) return [];
  const listData = await listRes.json();
  const ids = (listData.messages || []).map(m => m.id);
  if (!ids.length) return [];
  const bodies = await Promise.all(ids.map(async id => {
    try {
      const r = await fetch(`/proxy/gmail/message/${id}/body`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) return null;
      const data = await r.json();
      return data.text ? { subject: data.subject || '', from: data.from || '', text: String(data.text).slice(0, 2000) } : null;
    } catch { return null; }
  }));
  return bodies.filter(Boolean);
}

async function summarizeThreads(acc, threads) {
  const threadBodies = threads.map((t, i) =>
    `--- Thread ${i + 1} ---\nFrom: ${t.from}\nSubject: ${t.subject}\n${t.text}`
  ).join('\n\n');

  const res = await fetch('/proxy/anthropic/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELS.FAST,
      max_tokens: 120,
      system: 'You are extracting deal signal from email threads. Be terse and specific.',
      messages: [{
        role: 'user',
        content: `Summarize these email threads for account ${acc?.name || extractDomain(acc) || 'unknown'} in 3 fields only:
- sentiment: one of "positive" | "neutral" | "at_risk" | "stalled"
- signals: array of max 3 short strings describing key deal signals
- last_contact_direction: "inbound" | "outbound" | "none"

Threads:
${threadBodies}

Return JSON only. No preamble.`,
      }],
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

async function indexOne(acc, token) {
  // Cache key remains the extracted domain — see Option A note in
  // buildAccountEmailQuery: query scope is now persona-first, but storage
  // stays domain-keyed for compatibility with the 9 downstream readers
  // (radarScoring, scoutContext, triggers, etc.) that still look up by
  // domain. The cache re-key is a separate future commit.
  // If acc has no domain at all, we skip caching — same as today.
  const domain = extractDomain(acc);
  if (!domain) return;
  const cache = readCache();
  const entry = cache[domain];
  if (entry && Date.now() - (entry.cachedAt || 0) < TTL_MS) return;

  const threads = await fetchThreadsForAccount(acc, token);
  if (!threads.length) {
    cache[domain] = { sentiment: 'neutral', signals: [], last_contact_direction: 'none', cachedAt: Date.now() };
    writeCache(cache);
    return;
  }
  const summary = await summarizeThreads(acc, threads);
  if (!summary) return;
  cache[domain] = {
    sentiment: summary.sentiment || 'neutral',
    signals: Array.isArray(summary.signals) ? summary.signals.slice(0, 3) : [],
    last_contact_direction: summary.last_contact_direction || 'none',
    cachedAt: Date.now(),
  };
  writeCache(cache);
}

export async function indexAccountThreads(accounts) {
  if (!accounts?.length) return;
  const token = await getValidGmailToken();
  if (!token) return;

  const cache = readCache();
  const candidates = accounts.filter(a => {
    const d = extractDomain(a);
    if (!d) return false;
    const entry = cache[d];
    return !entry || Date.now() - (entry.cachedAt || 0) >= TTL_MS;
  });
  if (!candidates.length) return;

  setStatus({ running: true, processed: 0, total: candidates.length });
  try {
    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(acc => indexOne(acc, token).catch(() => {})));
      setStatus({ processed: Math.min(i + batch.length, candidates.length) });
      if (i + BATCH_SIZE < candidates.length) {
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
      }
    }
  } finally {
    setStatus({ running: false });
  }
}
