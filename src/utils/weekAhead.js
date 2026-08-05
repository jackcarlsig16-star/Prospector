import { MODELS } from '../config/models';
import { getValidGmailToken } from './getValidGmailToken';
import { buildAccountEmailQuery } from './accountEmailQuery';
import { COMPANY_EMAIL_DOMAIN } from '../constants/appConfig';

// ── Date helpers ────────────────────────────────────────────────────────────
// Local-date pattern (not toISOString) — see DailyDigest.js comment
export function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export function getISOWeek(d = new Date()) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  const week = 1 + Math.round(((date - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return { year: date.getFullYear(), week };
}

export function weekKey(d = new Date()) {
  const { year, week } = getISOWeek(d);
  return `${year}-W${String(week).padStart(2,'0')}`;
}

export const cacheKey = (d) => `prospector_week_ahead_${weekKey(d)}`;
export const dismissedKey = (d) => `prospector_week_ahead_dismissed_${weekKey(d)}`;

export function getWeekRange(d = new Date()) {
  const monday = new Date(d);
  const dow = monday.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  monday.setDate(monday.getDate() + offset);
  monday.setHours(0, 0, 0, 0);
  const friday = new Date(monday);
  friday.setDate(friday.getDate() + 4);
  friday.setHours(23, 59, 59, 999);
  return { monday, friday };
}

// ── Cache I/O ───────────────────────────────────────────────────────────────
const WEEK_AHEAD_EVENT = 'prospector_week_ahead_updated';

export function loadCachedWeekAhead(d = new Date()) {
  try { return JSON.parse(localStorage.getItem(cacheKey(d)) || 'null'); } catch { return null; }
}

export function saveCachedWeekAhead(data, d = new Date()) {
  try {
    localStorage.setItem(cacheKey(d), JSON.stringify(data));
    window.dispatchEvent(new CustomEvent(WEEK_AHEAD_EVENT));
  } catch {}
}

export function clearCachedWeekAhead(d = new Date()) {
  try { localStorage.removeItem(cacheKey(d)); } catch {}
  window.dispatchEvent(new CustomEvent(WEEK_AHEAD_EVENT));
}

export function loadDismissed(d = new Date()) {
  try { return new Set(JSON.parse(localStorage.getItem(dismissedKey(d)) || '[]')); } catch { return new Set(); }
}

export function addDismissed(commitmentKey, d = new Date()) {
  const dismissed = loadDismissed(d);
  dismissed.add(commitmentKey);
  try { localStorage.setItem(dismissedKey(d), JSON.stringify([...dismissed])); } catch {}
  window.dispatchEvent(new CustomEvent(WEEK_AHEAD_EVENT));
}

// ── Build week ahead ────────────────────────────────────────────────────────
const THREAD_CACHE_KEY = 'prospector_threads_cache';
const THREAD_CACHE_TTL = 4 * 60 * 60 * 1000;
const MAX_DOMAINS = 5;
const MAX_BODY_CHARS = 2000;

function isExternalAttendee(a) {
  const email = (a?.email || '').toLowerCase();
  if (!email || a.self) return false;
  return !email.endsWith('@' + COMPANY_EMAIL_DOMAIN);
}

async function fetchCalendarEvents(token) {
  const { monday, friday } = getWeekRange();
  const url = `/proxy/gcal/events?timeMin=${encodeURIComponent(monday.toISOString())}&timeMax=${encodeURIComponent(friday.toISOString())}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const data = await res.json();
  if (!Array.isArray(data.items)) return [];
  return data.items.filter(ev => ev.start?.dateTime && (ev.attendees || []).some(isExternalAttendee));
}

function extractDomains(events) {
  const set = new Set();
  events.forEach(ev => {
    (ev.attendees || []).forEach(a => {
      if (!isExternalAttendee(a)) return;
      const domain = (a.email || '').toLowerCase().split('@')[1];
      if (domain) set.add(domain);
    });
  });
  return Array.from(set);
}

async function fetchSentThreadsForDomain(domain, token) {
  let threadCache = {};
  try { threadCache = JSON.parse(localStorage.getItem(THREAD_CACHE_KEY) || '{}'); } catch {}
  const cached = threadCache[domain];
  if (cached && Date.now() - (cached.cachedAt || 0) < THREAD_CACHE_TTL && Array.isArray(cached.sentSnippets)) {
    return cached.sentSnippets;
  }

  // weekAhead works from bare attendee-domain strings (not full acc records).
  // Wrap as a minimal acc and let buildAccountEmailQuery apply the free-tier
  // guard — if domain is gmail/yahoo/etc., the helper returns no query and
  // we skip that domain entirely instead of flooding the AE's sent folder.
  const { q: rawQ } = buildAccountEmailQuery({ web: domain }, { dateClause: ' newer_than:14d', sentOnly: true });
  if (!rawQ) return [];
  const listRes = await fetch(`/proxy/gmail/messages?q=${encodeURIComponent(rawQ)}&maxResults=3`, {
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
      return data.text ? { subject: data.subject || '', text: String(data.text).slice(0, MAX_BODY_CHARS) } : null;
    } catch { return null; }
  }));
  const sentSnippets = bodies.filter(Boolean);

  try {
    const existing = threadCache[domain] || {};
    threadCache[domain] = { ...existing, sentSnippets, cachedAt: Date.now() };
    localStorage.setItem(THREAD_CACHE_KEY, JSON.stringify(threadCache));
  } catch {}
  return sentSnippets;
}

function fmtEventsForPrompt(events) {
  return events.map(ev => {
    const start = new Date(ev.start.dateTime);
    const dateStr = localDateStr(start);
    const timeStr = start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const attendees = (ev.attendees || []).filter(isExternalAttendee).map(a => a.email).join(', ');
    const descPart = ev.description ? `\n  desc: ${String(ev.description).slice(0, 400).replace(/\s+/g, ' ')}` : '';
    return `[${dateStr} ${timeStr}] ${ev.summary || '(no title)'} — attendees: ${attendees}${descPart}`;
  }).join('\n');
}

function fmtThreadsForPrompt(threadsByDomain) {
  return Object.entries(threadsByDomain).map(([domain, threads]) => {
    if (!threads?.length) return '';
    const block = threads.map((t, i) => `  Thread ${i+1}: ${t.subject}\n    ${t.text.slice(0, 800).replace(/\s+/g, ' ').trim()}`).join('\n');
    return `${domain}:\n${block}`;
  }).filter(Boolean).join('\n\n');
}

export async function buildWeekAhead() {
  const token = await getValidGmailToken();
  if (!token) throw new Error('Gmail not connected');

  const events = await fetchCalendarEvents(token);
  const domains = extractDomains(events).slice(0, MAX_DOMAINS);

  const threadsByDomain = {};
  for (const domain of domains) {
    threadsByDomain[domain] = await fetchSentThreadsForDomain(domain, token);
  }

  const { monday, friday } = getWeekRange();
  const weekStart = localDateStr(monday);
  const weekEnd = localDateStr(friday);
  const today = localDateStr();
  const eventsText = fmtEventsForPrompt(events) || '(no calendar events this week)';
  const sentText = fmtThreadsForPrompt(threadsByDomain) || '(no recent sent threads)';

  const prompt = `You are extracting commitments, meetings, and deadlines for a sales AE from their calendar and sent emails.
Return JSON only. No preamble. Only extract what is explicitly stated — do not infer.

Week: ${weekStart} to ${weekEnd}
Today: ${today}

Calendar events:
${eventsText}

Sent emails (recent threads per account):
${sentText}

Return:
{
  "commitments": [
    {
      "account": "",
      "commitment": "",
      "dueDate": "YYYY-MM-DD or null",
      "urgency": "today|this_week|soon"
    }
  ],
  "upcomingMeetings": [
    {
      "account": "",
      "date": "YYYY-MM-DD",
      "time": "",
      "attendees": [],
      "prepNeeded": true
    }
  ],
  "forecastDeadlines": [
    {
      "label": "",
      "dueDate": "YYYY-MM-DD"
    }
  ]
}`;

  const res = await fetch('/proxy/anthropic/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELS.STANDARD,
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Extract failed (${res.status})`);
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Could not parse week ahead response');
  const parsed = JSON.parse(match[0]);

  const result = {
    commitments: Array.isArray(parsed.commitments) ? parsed.commitments : [],
    upcomingMeetings: Array.isArray(parsed.upcomingMeetings) ? parsed.upcomingMeetings : [],
    forecastDeadlines: Array.isArray(parsed.forecastDeadlines) ? parsed.forecastDeadlines : [],
    weekStart,
    weekEnd,
    cachedAt: Date.now(),
  };
  saveCachedWeekAhead(result);
  return result;
}

export function commitmentKey(c) {
  return `${(c.account || '').toLowerCase().trim()}|${(c.commitment || '').toLowerCase().trim()}|${c.dueDate || ''}`;
}
