import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { C } from '../constants/colors';
import { pillStyle } from './FilterPill';

// outreach-matrix-veinmap-repurpose-v1 — grid mechanics ported from
// mockups/outreach-matrix.html.
// outreach-matrix-theme-and-architecture-correction-v1 — chrome restyled off
// the app's real tokens. Surfaces/text/gridlines read the same --c-* CSS
// variables C.bg/sur/card/txt/mut/dim resolve to (src/index.css:5-6), so this
// tracks the app's theme instead of the mockup's invented palette. The five
// status colors below are Jack's spec and are deliberately left exactly as
// shipped, including .mark.overdue's glow rgba.
const STATUS_CSS = `
.om-root {
  --om-generated:      #d95926;
  --om-generated-soft: #4a2c1c;
  --om-sent:           #3987e5;
  --om-sent-soft:      #1c3a5c;
  --om-overdue:        #e66767;
  --om-overdue-soft:   #4a2222;
  --om-meeting:        #0ca30c;
  --om-meeting-soft:   #1c3a1c;
}
`;

const CSS = `
.om-root, .om-drawer, .om-overlay, .om-tooltip {
  --om-surface:  var(--c-bg);
  --om-panel:    var(--c-sur);
  --om-line:     #2E3548;
  --om-txt:      var(--c-txt);
  --om-mut:      var(--c-mut);
  --om-dim:      var(--c-dim);
  font-family: 'SF Mono', ui-monospace, monospace;
}
.om-root { color: var(--om-txt); }
.om-root * { box-sizing: border-box; }
.om-root .panel { border: 1px solid var(--om-line); border-radius: 7px; overflow: hidden; }
.om-root .top { padding: 12px 14px 10px; border-bottom: 1px solid var(--om-line); }
.om-root .top-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
.om-root .title-block h1 {
  font-size: 12px; font-weight: 600; margin: 0 0 3px;
  letter-spacing: 0.06em; text-transform: uppercase; color: var(--om-txt);
}
.om-root .title-block p { margin: 0; font-size: 11px; color: var(--om-dim); }
.om-root .period-nav { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.om-root .period-nav button {
  width: 26px; height: 26px; border-radius: 4px;
  border: 1px solid #333; background: transparent;
  color: #ccc; font-size: 12px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.om-root .period-nav button:hover:not(:disabled) { border-color: var(--om-line); background: var(--om-panel); }
.om-root .period-nav button:disabled { opacity: 0.35; cursor: default; }
.om-root .period-label { font-size: 11px; font-weight: 500; min-width: 160px; text-align: center; color: var(--om-mut); letter-spacing: 0.04em; }
.om-root .period-today-btn {
  font-size: 11px; font-weight: 500; color: var(--om-sent);
  background: none; border: none; cursor: pointer; padding: 4px 6px; letter-spacing: 0.04em;
}
.om-root .placeholder-banner {
  display: flex; align-items: flex-start; gap: 8px;
  margin: 10px 0 0; padding: 8px 12px; border-radius: 7px;
  background: rgba(245,160,80,0.07); border: 1px solid rgba(245,160,80,0.27);
  color: #F5A050; font-size: 11px; line-height: 1.45;
}
.om-root .legend { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 10px; }
.om-root .legend-item { display: flex; align-items: center; gap: 6px; font-size: 10px; color: var(--om-mut); letter-spacing: 0.03em; }
.om-root .legend-swatch {
  width: 14px; height: 14px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; font-size: 8px; color: #fff;
}
.om-root .legend-swatch.generated { background: var(--om-generated); }
.om-root .legend-swatch.sent { background: var(--om-sent); }
.om-root .legend-swatch.scheduled { background: transparent; border: 2px dashed var(--om-sent); }
.om-root .legend-swatch.overdue { background: var(--om-overdue); box-shadow: 0 0 0 3px var(--om-overdue-soft); }
.om-root .legend-swatch.meeting { background: var(--om-meeting); border-radius: 3px; transform: rotate(45deg); width: 11px; height: 11px; }
.om-root .filters {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 10px 14px; border-bottom: 1px solid var(--om-line);
}
.om-root .search-box input {
  font-family: 'SF Mono', ui-monospace, monospace;
  height: 26px; min-width: 190px; padding: 0 10px;
  border: 1px solid #333; border-radius: 4px;
  background: transparent; color: #ccc; font-size: 11px;
  outline: none; letter-spacing: 0.04em;
}
.om-root .search-box input:focus { border-color: var(--om-line); }
.om-root .search-box input::placeholder { color: var(--om-dim); }
.om-root .filters-spacer { flex: 1; }
.om-root .clear-filters {
  font-family: 'SF Mono', ui-monospace, monospace;
  font-size: 10px; padding: 2px 7px; border-radius: 2px;
  background: transparent; border: 1px solid #333; color: #5a6a5a;
  cursor: pointer; white-space: nowrap;
}
.om-root .result-count { font-size: 10px; color: var(--om-dim); padding: 8px 14px 0; letter-spacing: 0.04em; }
.om-root .matrix-wrap { padding: 10px 0 14px; }
.om-root .matrix-scroll { position: relative; overflow-x: auto; padding-bottom: 4px; }
.om-root .grid { display: grid; grid-template-columns: 290px repeat(28, 32px); width: max-content; min-width: 100%; }
.om-root .cell {
  display: flex; align-items: center; justify-content: center;
  height: 44px; border-bottom: 1px solid var(--om-line); position: relative;
}
.om-root .head-spacer, .om-root .head-name {
  position: sticky; left: 0; z-index: 3; background: var(--om-surface);
  justify-content: flex-start; padding-left: 14px;
}
.om-root .head-week {
  grid-column: span 7; height: 24px; font-size: 10px; font-weight: 600;
  color: var(--om-dim); text-transform: uppercase; letter-spacing: 0.06em;
  border-bottom: none; justify-content: center;
}
.om-root .head-spacer { height: 24px; border-bottom: none; }
.om-root .head-day { height: 28px; flex-direction: column; gap: 1px; font-size: 10px; color: var(--om-dim); line-height: 1.2; }
.om-root .head-day .dow { font-weight: 600; letter-spacing: 0.02em; }
.om-root .head-day.weekend { background: var(--om-panel); }
.om-root .head-day.is-today { color: var(--om-sent); font-weight: 700; }
.om-root .head-name { height: 28px; font-size: 10px; font-weight: 600; color: var(--om-dim); text-transform: uppercase; letter-spacing: 0.06em; }
.om-root .row-name {
  position: sticky; left: 0; z-index: 2; background: var(--om-surface);
  justify-content: flex-start; gap: 9px; padding: 6px 12px 6px 11px;
  height: 60px; cursor: pointer; border-left: 3px solid transparent;
}
.om-root .row-name:hover { background: var(--om-panel); }
.om-root .row-name.is-active-cycle { border-left-color: var(--om-meeting); }
.om-root .avatar {
  width: 28px; height: 28px; border-radius: 4px;
  background: var(--c-card); color: var(--om-mut);
  font-size: 10px; font-weight: 600; letter-spacing: 0.04em;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.om-root .row-name-text { min-width: 0; }
.om-root .row-name-text .acct { font-size: 12px; font-weight: 500; color: var(--om-txt); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 225px; }
.om-root .row-name-text .biz { font-size: 10px; color: var(--om-dim); display: flex; align-items: center; gap: 5px; margin-top: 3px; letter-spacing: 0.04em; }
.om-root .active-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--om-meeting); flex-shrink: 0; }
.om-root .day-cell { height: 60px; }
.om-root .day-cell.weekend { background: var(--om-panel); }
.om-root .mark {
  width: 20px; height: 20px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; color: #fff; cursor: pointer; font-weight: 700;
}
.om-root .mark.sent { background: var(--om-sent); }
.om-root .mark.generated { background: var(--om-generated); }
.om-root .mark.scheduled { background: transparent; border: 2px dashed var(--om-sent); color: var(--om-sent); }
.om-root .mark.overdue { background: var(--om-overdue); animation: om-pulse-glow 1.8s ease-in-out infinite; }
.om-root .mark.meeting { border-radius: 5px; transform: rotate(45deg); background: var(--om-meeting); width: 16px; height: 16px; }
.om-root .mark.meeting .glyph { transform: rotate(-45deg); }
@keyframes om-pulse-glow {
  0%, 100% { box-shadow: 0 0 0 0 rgba(208,59,59,0.55); }
  50% { box-shadow: 0 0 0 6px rgba(208,59,59,0); }
}
.om-root .today-line {
  position: absolute; top: 0; bottom: 0; width: 0;
  border-left: 2px dashed var(--om-sent); z-index: 1; pointer-events: none;
}
.om-root .empty-state { padding: 32px 14px; text-align: center; color: var(--om-dim); font-size: 11px; letter-spacing: 0.04em; }
.om-tooltip {
  position: fixed; pointer-events: none;
  background: var(--c-sur); color: var(--c-txt);
  border: 1px solid #2E3548;
  font-size: 10.5px; line-height: 1.5; padding: 8px 10px;
  border-radius: 4px; max-width: 230px; z-index: 50;
  opacity: 0; transition: opacity 0.1s ease;
  box-shadow: 0 4px 16px rgba(0,0,0,0.5);
}
.om-tooltip.show { opacity: 1; }
.om-tooltip b { display: block; margin-bottom: 3px; font-weight: 600; }
.om-tooltip .tt-date { color: var(--c-mut); }
.om-tooltip .tt-status { display: inline-block; margin-top: 5px; font-weight: 600; }
.om-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.55);
  opacity: 0; pointer-events: none; transition: opacity 0.18s ease; z-index: 60;
}
.om-overlay.open { opacity: 1; pointer-events: auto; }
.om-drawer {
  position: fixed; top: 0; right: 0; bottom: 0;
  width: 380px; max-width: 92vw;
  background: var(--c-sur); color: var(--c-txt);
  border-left: 1px solid #2E3548;
  box-shadow: -8px 0 32px rgba(0,0,0,0.5);
  transform: translateX(100%); transition: transform 0.22s ease;
  z-index: 61; display: flex; flex-direction: column;
}
.om-drawer.open { transform: translateX(0); }
.om-drawer .drawer-head {
  padding: 14px 14px 12px; border-bottom: 1px solid #2E3548;
  display: flex; align-items: flex-start; gap: 10px;
}
.om-drawer .avatar {
  width: 34px; height: 34px; border-radius: 4px;
  background: var(--c-card); color: var(--c-mut);
  font-size: 11px; font-weight: 600; letter-spacing: 0.04em;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.om-drawer .drawer-title { flex: 1; min-width: 0; }
.om-drawer .drawer-title .name { font-size: 13px; font-weight: 600; }
.om-drawer .drawer-title .biz { font-size: 10px; color: var(--c-dim); margin-top: 3px; letter-spacing: 0.04em; }
.om-drawer .drawer-close {
  width: 24px; height: 24px; border-radius: 4px;
  border: 1px solid #333; background: transparent;
  cursor: pointer; font-size: 12px; color: var(--c-mut); flex-shrink: 0;
}
.om-drawer .drawer-body { padding: 12px 14px 20px; overflow-y: auto; flex: 1; }
.om-drawer .action-banner {
  display: flex; gap: 8px; align-items: flex-start;
  padding: 8px 12px; border-radius: 7px;
  font-size: 11px; margin-bottom: 14px; line-height: 1.45;
}
.om-drawer .action-banner.warn { background: var(--om-overdue-soft); color: var(--om-overdue); }
.om-drawer .action-banner.ready { background: var(--om-generated-soft); color: var(--om-generated); }
.om-drawer .action-banner.ok { background: var(--om-meeting-soft); color: var(--om-meeting); }
.om-drawer .timeline-label {
  font-size: 10px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.06em; color: var(--c-dim); margin: 4px 0 10px;
}
.om-drawer .step {
  display: flex; gap: 10px; padding: 10px 0;
  border-bottom: 1px solid #2E3548; transition: background 0.4s ease;
}
.om-drawer .step:last-child { border-bottom: none; }
.om-drawer .step.highlight { background: var(--c-card); border-radius: 4px; padding-left: 8px; padding-right: 8px; margin: 0 -8px; }
.om-drawer .step-mark { flex-shrink: 0; margin-top: 2px; }
.om-drawer .step-mark .mark { cursor: default; }
.om-drawer .step-body { min-width: 0; flex: 1; }
.om-drawer .step-date { font-size: 10px; color: var(--c-dim); margin-bottom: 3px; letter-spacing: 0.04em; }
.om-drawer .step-title { font-size: 12px; font-weight: 500; }
.om-drawer .step-subject { font-size: 11px; color: var(--c-mut); margin-top: 3px; }
.om-drawer .step-status-pill {
  display: inline-block; font-size: 9px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.06em;
  padding: 2px 7px; border-radius: 2px; margin-top: 6px;
}
.om-drawer .step-status-pill.sent { background: var(--om-sent-soft); color: var(--om-sent); }
.om-drawer .step-status-pill.generated { background: var(--om-generated-soft); color: var(--om-generated); }
.om-drawer .step-status-pill.scheduled { background: var(--c-card); color: var(--c-mut); }
.om-drawer .step-status-pill.overdue { background: var(--om-overdue-soft); color: var(--om-overdue); }
.om-drawer .step-status-pill.meeting { background: var(--om-meeting-soft); color: var(--om-meeting); }
`;

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WINDOW_DAYS = 28;
const MIN_OFFSET = -2;
const MAX_OFFSET = 2;
const STATUS_LABEL = {
  sent: 'Sent',
  generated: 'Generated — ready to send',
  scheduled: 'Scheduled',
  overdue: 'Overdue — not sent',
  meeting: 'Meeting booked',
};

const addDays = (date, n) => {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + n);
  return d;
};
const dayDiff = (a, b) => Math.round((a.getTime() - b.getTime()) / 86400000);
const fmtShort = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const fmtLong = (d) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const initials = (name) => (name || '?').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const markGlyph = (status) => (status === 'sent' ? '✓' : status === 'generated' ? '✎' : status === 'overdue' ? '!' : '');

// ── Cadence event source ─────────────────────────────────────────────────────
// The ONE place account cadence data comes from. Everything below this line
// consumes Event[] and knows nothing about how the events were produced -
// swapping this for a richer query is a single-function change.
//
// Event: { id, date: Date, type: 'email'|'meeting', status, label, subject }
//
// Only ONE of the five mark states has a real source today: 'generated',
// from accounts.data.emails[] - the array EmailModal's save button appends to
// (AccountCard.js:311, capped at 10). Its `date` is a toLocaleDateString()
// display string, not a timestamp, so it parses to day precision only.
//
// 'sent', 'scheduled', 'overdue' and 'meeting' have NO source anywhere in
// Prospector: nothing marks an email sent, there is no scheduled/step model,
// and no per-account booked-meeting flag exists. They stay in the legend as
// the intended vocabulary and light up on their own once a real cadence
// model lands. last_touched_at is deliberately NOT used here - it is a
// single denormalized last-contact cache, not a step history.

export function getGeneratedEmailEvents(account) {
  const entries = Array.isArray(account?.emails) ? account.emails : [];
  return entries.reduce((events, entry, i) => {
    const date = new Date(entry?.date);
    if (Number.isNaN(date.getTime())) return events;
    events.push({
      id: `${account.id}-gen${i}`,
      date: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
      type: 'email',
      status: 'generated',
      label: 'Email generated',
      subject: entry.subject || entry.persona || '(no subject)',
    });
    return events;
  }, []);
}

// ── Grid ─────────────────────────────────────────────────────────────────────

function Mark({ event, onHover, onMove, onLeave, onClick }) {
  return (
    <div
      className={`mark ${event.status}${event.type === 'meeting' ? ' meeting' : ''}`}
      onMouseEnter={onHover}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      onClick={onClick}
    >
      <span className={event.type === 'meeting' ? 'glyph' : ''}>
        {event.type === 'meeting' ? '★' : markGlyph(event.status)}
      </span>
    </div>
  );
}

function StaticMark({ event }) {
  return (
    <div className={`mark ${event.status}${event.type === 'meeting' ? ' meeting' : ''}`}>
      <span className={event.type === 'meeting' ? 'glyph' : ''}>
        {event.type === 'meeting' ? '★' : markGlyph(event.status)}
      </span>
    </div>
  );
}

export default function OutreachMatrix({ accounts = [], business, eventsFor = getGeneratedEmailEvents }) {
  const [query, setQuery] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [activeOnly, setActiveOnly] = useState(false);
  const [periodOffset, setPeriodOffset] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [highlightId, setHighlightId] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const tooltipRef = useRef(null);

  const today = useMemo(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }, []);

  // Anchor the 28-day window to the Monday two weeks before the current week,
  // so today lands in week 3 the way the mockup shows it.
  const dateWindow = useMemo(() => {
    const dow = today.getDay();
    const anchor = addDays(today, (dow === 0 ? -6 : 1 - dow) - 14);
    const start = addDays(anchor, periodOffset * WINDOW_DAYS);
    return { start, days: WINDOW_DAYS, today };
  }, [today, periodOffset]);

  const rows = useMemo(() => accounts.map(a => {
    const events = eventsFor(a, dateWindow);
    return {
      id: String(a.id),
      name: a.name || '(unnamed)',
      events,
      activeCycle: events.some(e => e.type === 'meeting'),
    };
  }), [accounts, eventsFor, dateWindow]);

  const visible = useMemo(() => rows.filter(r => {
    if (query && r.name.toLowerCase().indexOf(query.toLowerCase()) === -1) return false;
    if (overdueOnly && !r.events.some(e => e.status === 'overdue')) return false;
    if (activeOnly && !r.activeCycle) return false;
    return true;
  }), [rows, query, overdueOnly, activeOnly]);

  const dayDate = useCallback((idx) => addDays(dateWindow.start, idx), [dateWindow]);
  const isWeekend = useCallback((idx) => {
    const dow = dayDate(idx).getDay();
    return dow === 0 || dow === 6;
  }, [dayDate]);
  const columnOf = useCallback((event) => {
    const idx = dayDiff(event.date, dateWindow.start);
    return idx >= 0 && idx < WINDOW_DAYS ? idx : null;
  }, [dateWindow]);

  const todayColumn = useMemo(() => {
    const idx = dayDiff(today, dateWindow.start);
    return idx >= 0 && idx < WINDOW_DAYS ? idx : null;
  }, [today, dateWindow]);

  const selected = rows.find(r => r.id === selectedId) || null;
  const closeDrawer = useCallback(() => { setSelectedId(null); setHighlightId(null); }, []);

  useEffect(() => {
    if (!selectedId) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') closeDrawer(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedId, closeDrawer]);

  const moveTooltip = (ev) => {
    const el = tooltipRef.current;
    if (!el) return;
    el.style.left = `${Math.min(ev.clientX + 14, window.innerWidth - 246)}px`;
    el.style.top = `${Math.min(ev.clientY + 14, window.innerHeight - 100)}px`;
  };
  const showTooltip = (ev, event) => {
    setTooltip({ label: event.label, date: fmtLong(event.date), subject: event.subject, status: STATUS_LABEL[event.status] });
    moveTooltip(ev);
  };

  const marksInWindow = useMemo(
    () => visible.reduce((n, r) => n + r.events.filter(e => columnOf(e) !== null).length, 0),
    [visible, columnOf],
  );

  const clearFilters = () => { setQuery(''); setOverdueOnly(false); setActiveOnly(false); };
  const filtered = !!query || overdueOnly || activeOnly;

  const weekStarts = [0, 1, 2, 3].map(w => addDays(dateWindow.start, w * 7));
  const windowEnd = addDays(dateWindow.start, WINDOW_DAYS - 1);

  return (
    <div className="om-root">
      <style>{STATUS_CSS}{CSS}</style>
      <div className="panel">
        <div className="top">
          <div className="top-row">
            <div className="title-block">
              <h1>Outreach Matrix</h1>
              <p>{`${business?.name || 'Accounts'} · cadence tracking & planning, one 4-week view at a time`}</p>
            </div>
            <div className="period-nav">
              <button onClick={() => setPeriodOffset(o => Math.max(MIN_OFFSET, o - 1))} disabled={periodOffset <= MIN_OFFSET} title="Previous 4 weeks">‹</button>
              <div className="period-label">{`${fmtShort(dateWindow.start)} – ${fmtShort(windowEnd)}, ${windowEnd.getFullYear()}`}</div>
              <button onClick={() => setPeriodOffset(o => Math.min(MAX_OFFSET, o + 1))} disabled={periodOffset >= MAX_OFFSET} title="Next 4 weeks">›</button>
              <button className="period-today-btn" onClick={() => setPeriodOffset(0)}>Today</button>
            </div>
          </div>

          <div className="placeholder-banner">
            <span>⚠</span>
            <span>Only generated emails are tracked today — every mark below is a real record. Sent, scheduled, overdue and meeting states have no source yet, so they stay empty until cadence tracking is built.</span>
          </div>

          <div className="legend">
            <div className="legend-item"><span className="legend-swatch generated">✎</span>Email generated</div>
            <div className="legend-item"><span className="legend-swatch sent">✓</span>Sent</div>
            <div className="legend-item"><span className="legend-swatch scheduled" />Scheduled / upcoming</div>
            <div className="legend-item"><span className="legend-swatch overdue">!</span>Overdue — not sent</div>
            <div className="legend-item"><span className="legend-swatch meeting" />Meeting booked / active cycle</div>
          </div>
        </div>

        <div className="filters">
          <div className="search-box">
            <input type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search accounts…" />
          </div>
          <button style={pillStyle(overdueOnly, C.red)} onClick={() => setOverdueOnly(v => !v)}>Overdue only</button>
          <button style={pillStyle(activeOnly, C.green)} onClick={() => setActiveOnly(v => !v)}>Active cycles only</button>
          <div className="filters-spacer" />
          {filtered && <button className="clear-filters" onClick={clearFilters}>Clear all ×</button>}
        </div>

        <div className="result-count">{`Showing ${visible.length} of ${rows.length} accounts · ${marksInWindow} tracked event${marksInWindow === 1 ? '' : 's'} in this window`}</div>

        <div className="matrix-wrap">
          {visible.length === 0 ? (
            <div className="empty-state">{rows.length === 0 ? 'No accounts in this business yet.' : 'No accounts match these filters.'}</div>
          ) : (
            <div className="matrix-scroll">
              <div className="grid">
                <div className="cell head-spacer" />
                {weekStarts.map((w, i) => <div key={i} className="cell head-week">{`Week of ${fmtShort(w)}`}</div>)}

                <div className="cell head-name">Accounts</div>
                {Array.from({ length: WINDOW_DAYS }, (_, i) => {
                  const d = dayDate(i);
                  return (
                    <div key={i} className={`cell head-day${isWeekend(i) ? ' weekend' : ''}${i === todayColumn ? ' is-today' : ''}`}>
                      <div className="dow">{DOW[d.getDay()]}</div>
                      <div className="num">{d.getDate()}</div>
                    </div>
                  );
                })}

                {visible.map(r => {
                  const byColumn = {};
                  r.events.forEach(e => {
                    const col = columnOf(e);
                    if (col === null) return;
                    (byColumn[col] = byColumn[col] || []).push(e);
                  });
                  return (
                    <div key={r.id} style={{ display: 'contents' }}>
                      <div className={`cell row-name${r.activeCycle ? ' is-active-cycle' : ''}`} onClick={() => { setSelectedId(r.id); setHighlightId(null); }}>
                        <div className="avatar">{initials(r.name)}</div>
                        <div className="row-name-text">
                          <div className="acct">{r.name}</div>
                          <div className="biz">
                            {r.activeCycle && <span className="active-dot" />}
                            {`${business?.name || ''}${r.activeCycle ? ' · Active cycle' : ''}`}
                          </div>
                        </div>
                      </div>
                      {Array.from({ length: WINDOW_DAYS }, (_, col) => (
                        <div key={col} className={`cell day-cell${isWeekend(col) ? ' weekend' : ''}`}>
                          {(byColumn[col] || []).map(e => (
                            <Mark
                              key={e.id}
                              event={e}
                              onHover={ev => showTooltip(ev, e)}
                              onMove={moveTooltip}
                              onLeave={() => setTooltip(null)}
                              onClick={ev => { ev.stopPropagation(); setSelectedId(r.id); setHighlightId(e.id); }}
                            />
                          ))}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
              {todayColumn !== null && <div className="today-line" style={{ left: 290 + todayColumn * 32 + 16 }} />}
            </div>
          )}
        </div>
      </div>

      <div ref={tooltipRef} className={`om-tooltip${tooltip ? ' show' : ''}`}>
        {tooltip && (
          <>
            <b>{tooltip.label}</b>
            <span className="tt-date">{tooltip.date}</span><br />“{tooltip.subject}”
            <span className="tt-status">{tooltip.status}</span>
          </>
        )}
      </div>

      <div className={`om-overlay${selected ? ' open' : ''}`} onClick={closeDrawer} />
      <div className={`om-drawer${selected ? ' open' : ''}`}>
        {selected && <CadenceDrawer row={selected} business={business} highlightId={highlightId} onClose={closeDrawer} />}
      </div>
    </div>
  );
}

function CadenceDrawer({ row, business, highlightId, onClose }) {
  const sorted = [...row.events].sort((a, b) => a.date - b.date);
  const overdue = sorted.filter(e => e.status === 'overdue');
  const ready = sorted.filter(e => e.status === 'generated');

  return (
    <>
      <div className="drawer-head">
        <div className="avatar">{initials(row.name)}</div>
        <div className="drawer-title">
          <div className="name">{row.name}</div>
          <div className="biz">{`${business?.name || ''}${row.activeCycle ? ' · Active sales cycle' : ''}`}</div>
        </div>
        <button className="drawer-close" onClick={onClose}>✕</button>
      </div>
      <div className="drawer-body">
        {overdue.length ? (
          <div className="action-banner warn">{`⚠ ${overdue[0].label} was due ${fmtShort(overdue[0].date)} — not yet marked sent.`}</div>
        ) : ready.length ? (
          <div className="action-banner ready">{`✎ ${ready[0].label} has a draft ready — send it today.`}</div>
        ) : row.activeCycle ? (
          <div className="action-banner ok">✓ In an active sales cycle — cadence is on track.</div>
        ) : null}

        <div className="timeline-label">Cadence timeline</div>
        {sorted.map(e => (
          <div key={e.id} className={`step${e.id === highlightId ? ' highlight' : ''}`}>
            <div className="step-mark"><StaticMark event={e} /></div>
            <div className="step-body">
              <div className="step-date">{fmtLong(e.date)}</div>
              <div className="step-title">{e.label}</div>
              <div className="step-subject">“{e.subject}”</div>
              <span className={`step-status-pill ${e.status}`}>{STATUS_LABEL[e.status]}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
