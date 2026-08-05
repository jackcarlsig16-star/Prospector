import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { C, mono } from '../constants/colors';
import BriefItems from './BriefItems';
import { fetchRecentThreads, generateBrief } from './DailyDigest';
import { getValidGmailToken } from '../utils/getValidGmailToken';
import { COMPANY_EMAIL_DOMAIN } from '../constants/appConfig';
import {
  loadCachedWeekAhead, buildWeekAhead, clearCachedWeekAhead,
  loadDismissed as loadWeekDismissed, addDismissed as addWeekDismissed,
  commitmentKey, getWeekRange, localDateStr,
} from '../utils/weekAhead';

const TEAL = '#2dd4bf';
const CYN  = '#00B4D8';
const NEON       = '#39FF14';
const NEON_RED   = '#FF4444';
const NEON_CYAN  = '#00F5FF';
const NEON_AMBER = '#FFB800';
const PARTNER_PURPLE = '#A855F7';
const CARD = (extra={}) => ({
  background: '#050f05',
  border: '1px solid rgba(0,245,255,0.15)',
  boxShadow: '0 0 20px rgba(0,245,255,0.06)',
  borderRadius: 8,
  padding: 16,
  transition: 'border-color 0.2s, box-shadow 0.2s',
  ...extra,
});
const SH   = (extra={}) => ({ ...mono, fontSize:10, color:TEAL, textTransform:'uppercase', letterSpacing:'0.12em', fontWeight:600, ...extra });
const SECTION_SH = {
  ...mono,
  fontSize: 10,
  color: NEON_CYAN,
  textTransform: 'uppercase',
  letterSpacing: '0.16em',
  fontWeight: 700,
  textShadow: '0 0 8px rgba(0,245,255,0.4)',
  margin: 0,
};

const HANDOFF_RE = /\b(disco(very)?|coach(ing)?|intro\s*call|new\s*biz|bdr|hand.?off|pass.?off|referral|nba)\b/i;
const PARTNER_RE = /\bpartner(ship)?\b/i;
const STAGE_BADGE_COLOR = { 'Intro': TEAL, '2nd call': NEON_CYAN, '3rd call': NEON_AMBER, 'Closing': NEON_RED };

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const briefDismissedKey = () => `prospector_brief_dismissed_${localDateStr()}`;
const loadBriefDismissed = () => { try { return new Set(JSON.parse(localStorage.getItem(briefDismissedKey()) || '[]')); } catch { return new Set(); } };
const briefItemKey = it => `${it.account || 'no-acc'}|${it.headline || it.subject || ''}`;
const briefCacheKey = () => `prospector_morning_brief_${localDateStr()}`;
const loadBrief = () => { try { return JSON.parse(localStorage.getItem(briefCacheKey()) || 'null'); } catch { return null; } };

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h % 12 || 12}:${m}${h >= 12 ? 'pm' : 'am'}`;
}

function fmtDay(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return DAYS[d.getDay()];
}

// ── Timezone helpers ────────────────────────────────────────────────────────
const TZ_LABEL_MAP = { PST:'PT', PDT:'PT', MST:'MT', MDT:'MT', CST:'CT', CDT:'CT', EST:'ET', EDT:'ET' };
const CITY_TZ = {
  // ET
  'new york':'America/New_York', nyc:'America/New_York', boston:'America/New_York',
  miami:'America/New_York', atlanta:'America/New_York',
  washington:'America/New_York', dc:'America/New_York',
  charlotte:'America/New_York', philadelphia:'America/New_York', philly:'America/New_York',
  toronto:'America/Toronto',
  // CT
  chicago:'America/Chicago', dallas:'America/Chicago', houston:'America/Chicago',
  minneapolis:'America/Chicago', 'kansas city':'America/Chicago', austin:'America/Chicago',
  // MT
  denver:'America/Denver', 'salt lake city':'America/Denver',
  phoenix:'America/Phoenix', boise:'America/Boise',
  // PT
  'san francisco':'America/Los_Angeles', sf:'America/Los_Angeles',
  'los angeles':'America/Los_Angeles', la:'America/Los_Angeles',
  seattle:'America/Los_Angeles', portland:'America/Los_Angeles',
  vancouver:'America/Vancouver',
};

function detectCustomerTZ(acc) {
  if (!acc) return null;
  const haystack = [
    acc.name,
    acc.notes,
    JSON.stringify(acc.medpicc || {}),
    (acc.personas || []).map(p => `${p.name || ''} ${p.title || ''} ${p.email || ''}`).join(' '),
  ].filter(Boolean).join(' ').toLowerCase();
  for (const [city, tz] of Object.entries(CITY_TZ)) {
    const re = new RegExp(`\\b${city.replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (re.test(haystack)) return tz;
  }
  return null;
}

function fmtTimeInTZ(date, tzId) {
  try {
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tzId })
      .format(date).replace(/\s/g, '').toLowerCase();
  } catch { return ''; }
}

function getShortTZ(date, tzId) {
  try {
    const opts = { timeZoneName: 'short' };
    if (tzId) opts.timeZone = tzId;
    const parts = new Intl.DateTimeFormat('en-US', opts).formatToParts(date);
    const tz = parts.find(p => p.type === 'timeZoneName')?.value || '';
    return TZ_LABEL_MAP[tz] || tz;
  } catch { return ''; }
}

function matchEventToAccount(ev, accounts) {
  if (!ev || !accounts?.length) return null;
  const title = (ev.summary || '').toLowerCase();
  const extEmails = (ev.attendees || []).filter(a => a.email && !a.email.toLowerCase().endsWith('@' + COMPANY_EMAIL_DOMAIN) && !a.self);
  const extDomains = extEmails.map(a => (a.email.split('@')[1] || '').toLowerCase());
  let best = null, bestScore = 0;
  for (const acc of accounts) {
    if (!acc.name) continue;
    const n = acc.name.toLowerCase();
    let score = 0;
    if (title === n) score += 15;
    else if (title.includes(n)) score += 10;
    const webRoot = (acc.web || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('.')[0];
    if (webRoot && webRoot.length >= 4 && extDomains.some(d => d.startsWith(webRoot))) score += 12;
    const words = n.split(/\s+/).filter(w => w.length > 3);
    if (words.length >= 2 && words.every(w => title.includes(w))) score += 6;
    if (score > bestScore) { bestScore = score; best = acc; }
  }
  return bestScore >= 6 ? best : null;
}

function classifyMeeting(ev, acc) {
  const att = ev.attendees || [];
  const nonSelf = att.filter(a => !a.self);
  const title = (ev.summary || '').toLowerCase();
  const isHandoff = HANDOFF_RE.test(title);
  const isPartner = PARTNER_RE.test(title) || isHandoff;
  if (!nonSelf.length) return { type: 'reminder', isPartner };
  const hasExternal = nonSelf.some(a => !a.email?.toLowerCase().endsWith('@' + COMPANY_EMAIL_DOMAIN));
  if (!hasExternal) return { type: 'internal', isPartner };
  if (isHandoff) return { type: 'handoff', isPartner };
  if (acc) return { type: 'customer', isPartner };
  return { type: 'other', isPartner };
}

function prepHintFor(acc) {
  if (!acc) return null;
  const stage = (acc.stage || '').toLowerCase();
  const calls = (acc.calls || []).length;
  if (stage.includes('closing') || stage.includes('negotiation') || calls >= 3) {
    return { label: 'Closing', text: 'Prep contract · Confirm legal contact · Final pricing' };
  }
  if (calls === 2) {
    return { label: '3rd call', text: 'Have pricing deck ready · Confirm SE availability' };
  }
  if (calls === 1) {
    return { label: '2nd call', text: 'Prep pricing range · Review pain points' };
  }
  return { label: 'Intro', text: 'Standard prep · Review last debrief' };
}

const Divider = () => (
  <div style={{ height: 1, background: '#1e293b', margin: '12px 0' }} />
);

export default function BriefPanel({
  accounts = [], tasks = [], activeUser, onNav, onCreateTask, onUpdateTask,
}) {
  const [tab, setTab] = useState('morning');
  const [brief, setBrief] = useState(loadBrief);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState(null);

  const [weekAhead, setWeekAhead] = useState(() => loadCachedWeekAhead());
  const [weekAheadLoading, setWeekAheadLoading] = useState(false);
  const [weekAheadError, setWeekAheadError] = useState(null);

  const [weekEvents, setWeekEvents] = useState(null);
  const [weekEventsLoading, setWeekEventsLoading] = useState(false);

  const [briefDismissed, setBriefDismissed] = useState(loadBriefDismissed);
  const [commitmentDismissed, setCommitmentDismissed] = useState(() => loadWeekDismissed());

  // Listen for week-ahead cache updates from elsewhere
  useEffect(() => {
    const onUpdate = () => setWeekAhead(loadCachedWeekAhead());
    window.addEventListener('prospector_week_ahead_updated', onUpdate);
    return () => window.removeEventListener('prospector_week_ahead_updated', onUpdate);
  }, []);

  // Listen for brief regenerations (eager load from App.js, etc.)
  useEffect(() => {
    const onUpdate = () => setBrief(loadBrief());
    window.addEventListener('prospector_brief_updated', onUpdate);
    return () => window.removeEventListener('prospector_brief_updated', onUpdate);
  }, []);

  // Fetch the week's external customer meetings whenever Weekly tab is opened
  useEffect(() => {
    if (tab !== 'weekly') return;
    if (weekEvents !== null) return;
    let cancelled = false;
    (async () => {
      const token = await getValidGmailToken();
      if (!token || cancelled) return;
      setWeekEventsLoading(true);
      const { monday, friday } = getWeekRange();
      try {
        const res = await fetch(`/proxy/gcal/events?timeMin=${encodeURIComponent(monday.toISOString())}&timeMax=${encodeURIComponent(friday.toISOString())}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (cancelled) return;
        const items = Array.isArray(data.items) ? data.items.filter(ev => ev.start?.dateTime) : [];
        setWeekEvents(items);
      } catch { if (!cancelled) setWeekEvents([]); }
      finally { if (!cancelled) setWeekEventsLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [tab, weekEvents]);

  const handleGetBrief = useCallback(async () => {
    const token = await getValidGmailToken();
    if (!token) { setBriefError('Connect Google in Settings to enable'); return; }
    setBriefLoading(true); setBriefError(null);
    try {
      const msgs = await fetchRecentThreads(token);
      if (msgs === null) { setBriefError('Gmail session expired — reconnect in Settings'); return; }
      if (!msgs.length)  { setBriefError('No recent inbox messages found'); return; }
      const result = { ...(await generateBrief(msgs, accounts, tasks)), generatedAt: Date.now() };
      setBrief(result);
      try { localStorage.setItem(briefCacheKey(), JSON.stringify(result)); } catch {}
      window.dispatchEvent(new CustomEvent('prospector_brief_updated'));
    } catch (e) {
      setBriefError('Brief generation failed — try again');
      console.error('[BriefPanel] brief error:', e);
    } finally {
      setBriefLoading(false);
    }
  }, [accounts, tasks]);

  const handleRefreshWeekAhead = useCallback(async () => {
    setWeekAheadLoading(true); setWeekAheadError(null);
    try { clearCachedWeekAhead(); await buildWeekAhead(); }
    catch (e) { setWeekAheadError(e.message || 'Generate failed'); }
    setWeekAheadLoading(false);
  }, []);

  // ── Counter — undismissed brief items + undismissed commitments ─────────────
  const briefUnreadCount = useMemo(() => {
    const items = brief?.items || [];
    if (!items.length) return 0;
    return items.filter(it => !briefDismissed.has(briefItemKey(it))).length;
  }, [brief, briefDismissed]);

  const commitmentUnreadCount = useMemo(() => {
    const items = weekAhead?.commitments || [];
    if (!items.length) return 0;
    return items.filter(c => !commitmentDismissed.has(commitmentKey(c))).length;
  }, [weekAhead, commitmentDismissed]);

  const totalCount = briefUnreadCount + commitmentUnreadCount;

  // ── Call Prep meetings — external events with matched accounts ──────────────
  const callPrepRows = useMemo(() => {
    if (!weekEvents) return [];
    return weekEvents
      .map(ev => {
        const matched = matchEventToAccount(ev, accounts);
        const { type, isPartner } = classifyMeeting(ev, matched);
        const acc = matched;
        const hint = type === 'handoff'
          ? { label: 'Intro', text: 'Standard prep · Review last debrief' }
          : type === 'customer' ? prepHintFor(acc) : null;
        return { ev, type, isPartner, acc, hint };
      })
      .filter(r => (r.type === 'customer' && r.acc) || r.type === 'handoff');
  }, [weekEvents, accounts]);

  const dismissCommitment = (c) => {
    const key = commitmentKey(c);
    addWeekDismissed(key);
    setCommitmentDismissed(prev => { const n = new Set(prev); n.add(key); return n; });
  };

  const addCommitmentTask = (c) => {
    if (!onCreateTask) return;
    const acc = accounts.find(a => a.name?.toLowerCase() === (c.account || '').toLowerCase());
    onCreateTask({
      id: Date.now(),
      title: c.commitment,
      type: 'Follow up',
      accId: acc?.id || null,
      accName: acc?.name || c.account || '',
      priority: c.urgency === 'today' ? 'High' : 'Medium',
      status: 'Open',
      dueDate: c.dueDate || null,
      createdAt: localDateStr(),
      source: 'week_ahead',
    });
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(0,245,255,0.3)'; e.currentTarget.style.boxShadow = '0 0 24px rgba(0,245,255,0.1)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(0,245,255,0.15)'; e.currentTarget.style.boxShadow = '0 0 20px rgba(0,245,255,0.06)'; }}
      style={{ ...CARD({ display: 'flex', flexDirection: 'column', height: '100%', flex: 1, width: '100%', minWidth: 0 }) }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <p style={{ ...SH(), margin: 0 }}>Brief</p>
          {totalCount > 0 && (
            <span style={{ ...mono, fontSize: 10, padding: '1px 8px', background: `${TEAL}14`, border: `1px solid ${TEAL}44`, color: TEAL, borderRadius: 10, fontWeight: 600, flexShrink: 0 }}>
              {totalCount}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
          {[['morning', 'Morning'], ['weekly', 'Weekly']].map(([k, lbl]) => (
            <button key={k} onClick={() => setTab(k)}
              style={{ ...mono, fontSize: 10, padding: '3px 8px', border: 'none', background: 'transparent', color: tab === k ? CYN : C.dim, cursor: 'pointer', borderBottom: tab === k ? `2px solid ${CYN}` : '2px solid transparent', paddingBottom: 2, transition: 'all 0.12s' }}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {/* ── Morning tab ─────────────────────────────────────────────────────── */}
      {tab === 'morning' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ ...mono, fontSize: 11, color: '#94a3b8' }}>
              {brief?.items?.length || 0} item{(brief?.items?.length || 0) !== 1 ? 's' : ''}
              {brief?.generatedAt && <span style={{ color: '#6b7280' }}> · generated {fmtTime(new Date(brief.generatedAt).toISOString())}</span>}
            </span>
            <div style={{ flex: 1 }} />
            {briefLoading
              ? <span style={{ ...mono, fontSize: 10, color: '#6b7280', fontStyle: 'italic' }}>Generating…</span>
              : <button onClick={handleGetBrief}
                  style={{ ...mono, fontSize: 10, color: TEAL, background: 'transparent', border: `1px solid ${TEAL}44`, borderRadius: 4, padding: '3px 10px', cursor: 'pointer' }}>
                  {brief ? '↺ Refresh' : 'Get Brief'}
                </button>
            }
          </div>
          {briefError && <div style={{ ...mono, fontSize: 10, color: C.red, marginBottom: 8 }}>{briefError}</div>}
          {!brief && !briefLoading && !briefError && (
            <div style={{ ...mono, fontSize: 11, color: '#6b7280', fontStyle: 'italic' }}>
              {localStorage.getItem('gmail_access_token') ? "Brief generates automatically on app open. Click Get Brief to refresh manually." : 'Connect Google in Settings to enable'}
            </div>
          )}
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            <BriefItems
              items={brief?.items || []}
              gongThreads={brief?.gongThreads || []}
              generatedAt={brief?.generatedAt}
              accounts={accounts}
              tasks={tasks}
              onNav={onNav}
              onUpdateTask={onUpdateTask}
            />
          </div>
        </div>
      )}

      {/* ── Weekly tab ──────────────────────────────────────────────────────── */}
      {tab === 'weekly' && (
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {/* ① Call Prep */}
          <WeeklySection title="Call Prep" subtitle={weekEventsLoading ? 'Loading…' : `${callPrepRows.length} meeting${callPrepRows.length !== 1 ? 's' : ''} this week`}>
            {!weekEvents && !weekEventsLoading && (
              <EmptyHint text="Connect Google to load this week's meetings." />
            )}
            {weekEvents && callPrepRows.length === 0 && (
              <EmptyHint text="No meetings scheduled this week." />
            )}
            {callPrepRows.map(({ ev, type, isPartner, acc, hint }) => {
              const start = ev.start.dateTime;
              const startDate = new Date(start);
              const dayLabel = fmtDay(start);
              const userTime = fmtTime(start);
              const userTz = getShortTZ(startDate);
              const customerTzId = detectCustomerTZ(acc);
              const customerTz = customerTzId ? getShortTZ(startDate, customerTzId) : null;
              const showSecondary = !!customerTz && customerTz !== userTz;
              const customerTimeStr = showSecondary ? fmtTimeInTZ(startDate, customerTzId) : null;
              const stageColor = hint ? (STAGE_BADGE_COLOR[hint.label] || TEAL) : null;
              const name = acc?.name || ev.summary || 'Meeting';
              return (
                <div key={ev.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderBottom: '1px solid #1a3a1a44' }}>
                  <div style={{ flexShrink: 0, width: 110, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ ...mono, fontSize: 11, color: NEON_AMBER, whiteSpace: 'nowrap' }}>
                      {dayLabel} {userTime}{userTz ? ` ${userTz}` : ''}
                    </span>
                    {showSecondary && (
                      <span style={{ ...mono, fontSize: 10, color: '#6b7280', whiteSpace: 'nowrap' }}>
                        {customerTimeStr} {customerTz}
                      </span>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      {isPartner && <span style={{ color: PARTNER_PURPLE, fontSize: 11, flexShrink: 0, textShadow: `0 0 6px ${PARTNER_PURPLE}88` }}>●</span>}
                      <span
                        onClick={() => acc && onNav?.('accounts', acc.id)}
                        style={{ ...mono, fontSize: 12, color: '#f1f5f9', cursor: acc ? 'pointer' : 'default', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                        {name}
                      </span>
                      {hint && (
                        <span style={{ ...mono, fontSize: 10, color: stageColor, padding: '2px 7px', background: `${stageColor}14`, border: `1px solid ${stageColor}66`, borderRadius: 3, flexShrink: 0, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600, boxShadow: `0 0 6px ${stageColor}66` }}>
                          {hint.label}
                        </span>
                      )}
                    </div>
                    {hint && (
                      <button
                        onClick={() => acc && onNav?.('accounts', acc.id)}
                        style={{ ...mono, marginTop: 4, fontSize: 11, color: '#888', background: 'transparent', border: 'none', padding: 0, cursor: acc ? 'pointer' : 'default', textAlign: 'left', display: 'flex', gap: 5, alignItems: 'baseline' }}
                        onMouseEnter={e => { if (acc) e.currentTarget.style.color = '#cfd8e3'; }}
                        onMouseLeave={e => { e.currentTarget.style.color = '#888'; }}>
                        <span style={{ color: NEON_CYAN, flexShrink: 0 }}>→</span>
                        <span>{hint.text}</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </WeeklySection>

          <Divider />

          {/* ② EOW Commitments */}
          <WeeklySection title="EOW Commitments" subtitle={weekAhead ? `${commitmentUnreadCount} open` : null}>
            {!weekAhead && !weekAheadLoading && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ ...mono, fontSize: 11, color: '#6b7280', fontStyle: 'italic' }}>Open on Monday to generate week ahead</span>
                <button onClick={handleRefreshWeekAhead} style={{ ...mono, alignSelf: 'flex-start', fontSize: 10, padding: '3px 10px', background: 'transparent', border: `1px solid ${TEAL}44`, color: TEAL, borderRadius: 4, cursor: 'pointer' }}>
                  Generate
                </button>
              </div>
            )}
            {weekAheadLoading && <EmptyHint text="Generating week ahead…" />}
            {weekAheadError && <div style={{ ...mono, fontSize: 11, color: C.red }}>✕ {weekAheadError}</div>}
            {weekAhead?.commitments?.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {weekAhead.commitments
                  .filter(c => !commitmentDismissed.has(commitmentKey(c)))
                  .map((c, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ ...mono, fontSize: 11, color: c.urgency === 'today' ? '#F59E0B' : '#94a3b8', flexShrink: 0 }}>
                      {c.urgency === 'today' ? '⚡' : '→'}
                    </span>
                    <span style={{ fontSize: 12, color: '#f1f5f9', flex: 1, minWidth: 0 }}>
                      {c.commitment}
                      {c.account && <span style={{ color: '#6b7280' }}> → {c.account}</span>}
                    </span>
                    {c.dueDate && <span style={{ ...mono, fontSize: 10, color: '#6b7280', flexShrink: 0 }}>{c.dueDate.slice(5)}</span>}
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0, width: 96, justifyContent: 'flex-end' }}>
                      <button onClick={() => addCommitmentTask(c)}
                        style={{ ...mono, fontSize: 10, padding: '2px 8px', background: 'transparent', border: `1px solid ${TEAL}44`, color: TEAL, borderRadius: 3, cursor: 'pointer' }}>
                        + Task
                      </button>
                      <button onClick={() => dismissCommitment(c)}
                        style={{ ...mono, fontSize: 11, padding: '2px 7px', background: 'transparent', border: '1px solid #1e293b', color: '#6b7280', borderRadius: 3, cursor: 'pointer' }}>
                        ✓
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {weekAhead?.commitments?.length === 0 && (
              <EmptyHint text="No commitments extracted this week." />
            )}
          </WeeklySection>

          <Divider />

          {/* ③ Deadlines */}
          <WeeklySection title="Deadlines">
            {!weekAhead?.forecastDeadlines?.length && (
              <EmptyHint text="No deadlines this week." />
            )}
            {weekAhead?.forecastDeadlines?.map((d, i) => {
              const today = localDateStr();
              const past = d.dueDate && d.dueDate <= today;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                  <span style={{ fontSize: 11, color: past ? '#ef4444' : '#F59E0B', flexShrink: 0 }}>{past ? '🔴' : '◆'}</span>
                  <span style={{ fontSize: 12, color: '#f1f5f9', flex: 1 }}>{d.label}</span>
                  <span style={{ ...mono, fontSize: 10, color: past ? '#ef4444' : '#F59E0B', flexShrink: 0 }}>{d.dueDate}</span>
                </div>
              );
            })}
          </WeeklySection>
        </div>
      )}
    </div>
  );
}

function WeeklySection({ title, subtitle, children }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <p style={SECTION_SH}>{title}</p>
        {subtitle && <span style={{ ...mono, fontSize: 10, color: '#6b7280' }}>{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

function EmptyHint({ text }) {
  return <div style={{ ...mono, fontSize: 11, color: '#6b7280', fontStyle: 'italic', padding: '4px 0' }}>{text}</div>;
}
