import { useState, useMemo, useRef, useEffect, useCallback } from 'react';

// outreach-matrix-veinmap-repurpose-v1 — ported from mockups/outreach-matrix.html.
// The mockup ships both a light and a dark palette behind prefers-color-scheme;
// this app is unconditionally dark, so only the mockup's dark values are used
// here. Every selector is prefixed .om-root so these generic class names
// (.card, .grid, .cell, .chip) can't collide with anything global.
const CSS = `
.om-root {
  --surface-1:      #1a1a19;
  --surface-2:      #0d0d0d;
  --text-primary:   #ffffff;
  --text-secondary: #c3c2b7;
  --text-muted:     #898781;
  --gridline:       #2c2c2a;
  --baseline:       #383835;
  --border:         rgba(255,255,255,0.10);
  --weekend-bg:     #232320;
  --blue:           #3987e5;
  --blue-soft:      #1c3a5c;
  --orange:         #d95926;
  --orange-soft:    #4a2c1c;
  --red:            #e66767;
  --red-soft:       #4a2222;
  --green:          #0ca30c;
  --green-soft:     #1c3a1c;
  background: var(--surface-2);
  color: var(--text-primary);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
.om-root * { box-sizing: border-box; }
.om-root .card {
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 14px;
  overflow: hidden;
}
.om-root .top { padding: 20px 24px 16px; border-bottom: 1px solid var(--gridline); }
.om-root .top-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.om-root .title-block h1 { font-size: 19px; font-weight: 650; margin: 0 0 4px; letter-spacing: -0.01em; }
.om-root .title-block p { margin: 0; font-size: 13px; color: var(--text-secondary); }
.om-root .period-nav { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.om-root .period-nav button {
  width: 28px; height: 28px; border-radius: 8px;
  border: 1px solid var(--border); background: var(--surface-1);
  color: var(--text-primary); font-size: 14px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.om-root .period-nav button:hover:not(:disabled) { background: var(--weekend-bg); }
.om-root .period-nav button:disabled { opacity: 0.35; cursor: default; }
.om-root .period-label { font-size: 13px; font-weight: 600; min-width: 168px; text-align: center; }
.om-root .period-today-btn {
  font-size: 12px; font-weight: 600; color: var(--blue);
  background: none; border: none; cursor: pointer; padding: 4px 6px;
}
.om-root .placeholder-banner {
  display: flex; align-items: flex-start; gap: 8px;
  margin: 14px 0 0; padding: 10px 12px; border-radius: 10px;
  background: var(--orange-soft); color: var(--orange);
  font-size: 12.5px; font-weight: 600; line-height: 1.4;
}
.om-root .legend { display: flex; flex-wrap: wrap; gap: 18px; margin-top: 14px; }
.om-root .legend-item { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--text-secondary); }
.om-root .legend-swatch {
  width: 16px; height: 16px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; font-size: 9px; color: #fff;
}
.om-root .legend-swatch.generated { background: var(--orange); }
.om-root .legend-swatch.sent { background: var(--blue); }
.om-root .legend-swatch.scheduled { background: transparent; border: 2px dashed var(--blue); }
.om-root .legend-swatch.overdue { background: var(--red); box-shadow: 0 0 0 3px var(--red-soft); }
.om-root .legend-swatch.meeting { background: var(--green); border-radius: 4px; transform: rotate(45deg); width: 13px; height: 13px; }
.om-root .filters {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 14px 24px; border-bottom: 1px solid var(--gridline); background: var(--surface-1);
}
.om-root .search-box {
  display: flex; align-items: center; gap: 6px;
  border: 1px solid var(--border); border-radius: 8px;
  padding: 6px 10px; background: var(--surface-2); min-width: 190px;
}
.om-root .search-box svg { flex-shrink: 0; opacity: 0.5; }
.om-root .search-box input {
  border: none; outline: none; background: transparent;
  font-size: 13px; color: var(--text-primary); width: 100%;
}
.om-root .search-box input::placeholder { color: var(--text-muted); }
.om-root .chip-group { display: flex; gap: 6px; flex-wrap: wrap; }
.om-root .chip {
  font-size: 12.5px; font-weight: 500; padding: 6px 12px; border-radius: 20px;
  border: 1px solid var(--border); background: var(--surface-2);
  color: var(--text-secondary); cursor: pointer; white-space: nowrap;
}
.om-root .chip:hover { background: var(--weekend-bg); }
.om-root .chip.toggle.active.overdue-chip { background: var(--red); border-color: var(--red); color: #fff; }
.om-root .chip.toggle.active.active-chip { background: var(--green); border-color: var(--green); color: #fff; }
.om-root .filters-spacer { flex: 1; }
.om-root .clear-filters {
  font-size: 12.5px; font-weight: 600; color: var(--blue);
  background: none; border: none; cursor: pointer; white-space: nowrap;
}
.om-root .result-count { font-size: 12px; color: var(--text-muted); padding: 8px 24px 0; }
.om-root .matrix-wrap { padding: 12px 0 20px; }
.om-root .matrix-scroll { position: relative; overflow-x: auto; padding-bottom: 4px; }
.om-root .grid { display: grid; grid-template-columns: 290px repeat(28, 32px); width: max-content; min-width: 100%; }
.om-root .cell {
  display: flex; align-items: center; justify-content: center;
  height: 44px; border-bottom: 1px solid var(--gridline); position: relative;
}
.om-root .head-spacer, .om-root .head-name {
  position: sticky; left: 0; z-index: 3; background: var(--surface-1);
  justify-content: flex-start; padding-left: 20px;
}
.om-root .head-week {
  grid-column: span 7; height: 26px; font-size: 11px; font-weight: 650;
  color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em;
  border-bottom: none; justify-content: center;
}
.om-root .head-spacer { height: 26px; border-bottom: none; }
.om-root .head-day { height: 30px; flex-direction: column; gap: 1px; font-size: 10.5px; color: var(--text-muted); line-height: 1.2; }
.om-root .head-day .dow { font-weight: 600; letter-spacing: 0.02em; }
.om-root .head-day.weekend { background: var(--weekend-bg); }
.om-root .head-day.is-today { color: var(--blue); font-weight: 700; }
.om-root .head-name { height: 30px; font-size: 11px; font-weight: 650; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.om-root .row-name {
  position: sticky; left: 0; z-index: 2; background: var(--surface-1);
  justify-content: flex-start; gap: 10px; padding: 6px 14px 6px 16px;
  height: 60px; cursor: pointer; border-left: 3px solid transparent;
}
.om-root .row-name:hover { background: var(--weekend-bg); }
.om-root .row-name.is-active-cycle { border-left-color: var(--green); }
.om-root .avatar {
  width: 30px; height: 30px; border-radius: 8px;
  background: var(--weekend-bg); color: var(--text-secondary);
  font-size: 11px; font-weight: 700;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.om-root .row-name-text { min-width: 0; }
.om-root .row-name-text .acct { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 225px; }
.om-root .row-name-text .biz { font-size: 11px; color: var(--text-muted); display: flex; align-items: center; gap: 5px; margin-top: 2px; }
.om-root .active-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); flex-shrink: 0; }
.om-root .day-cell { height: 60px; }
.om-root .day-cell.weekend { background: var(--weekend-bg); }
.om-root .mark {
  width: 20px; height: 20px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; color: #fff; cursor: pointer; font-weight: 700;
}
.om-root .mark.sent { background: var(--blue); }
.om-root .mark.generated { background: var(--orange); }
.om-root .mark.scheduled { background: transparent; border: 2px dashed var(--blue); color: var(--blue); }
.om-root .mark.overdue { background: var(--red); animation: om-pulse-glow 1.8s ease-in-out infinite; }
.om-root .mark.meeting { border-radius: 5px; transform: rotate(45deg); background: var(--green); width: 16px; height: 16px; }
.om-root .mark.meeting .glyph { transform: rotate(-45deg); }
@keyframes om-pulse-glow {
  0%, 100% { box-shadow: 0 0 0 0 rgba(208,59,59,0.55); }
  50% { box-shadow: 0 0 0 6px rgba(208,59,59,0); }
}
.om-root .today-line {
  position: absolute; top: 0; bottom: 0; width: 0;
  border-left: 2px dashed var(--blue); z-index: 1; pointer-events: none;
}
.om-root .empty-state { padding: 40px 24px; text-align: center; color: var(--text-muted); font-size: 13px; }
.om-tooltip {
  position: fixed; pointer-events: none;
  background: #ffffff; color: #1a1a19;
  font-size: 11.5px; line-height: 1.45; padding: 8px 10px;
  border-radius: 8px; max-width: 220px; z-index: 50;
  opacity: 0; transition: opacity 0.1s ease;
  box-shadow: 0 4px 16px rgba(0,0,0,0.25);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
.om-tooltip.show { opacity: 1; }
.om-tooltip b { display: block; margin-bottom: 2px; }
.om-tooltip .tt-status { display: inline-block; margin-top: 4px; font-weight: 600; }
.om-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.35);
  opacity: 0; pointer-events: none; transition: opacity 0.18s ease; z-index: 60;
}
.om-overlay.open { opacity: 1; pointer-events: auto; }
.om-drawer {
  position: fixed; top: 0; right: 0; bottom: 0;
  width: 380px; max-width: 92vw;
  background: #1a1a19; color: #ffffff;
  box-shadow: -8px 0 32px rgba(0,0,0,0.25);
  transform: translateX(100%); transition: transform 0.22s ease;
  z-index: 61; display: flex; flex-direction: column;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
.om-drawer.open { transform: translateX(0); }
.om-drawer .drawer-head {
  padding: 20px 20px 16px; border-bottom: 1px solid var(--gridline);
  display: flex; align-items: flex-start; gap: 12px;
}
.om-drawer .avatar { width: 38px; height: 38px; font-size: 13px; border-radius: 10px; }
.om-drawer .drawer-title { flex: 1; min-width: 0; }
.om-drawer .drawer-title .name { font-size: 15px; font-weight: 700; }
.om-drawer .drawer-title .biz { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
.om-drawer .drawer-close {
  width: 26px; height: 26px; border-radius: 7px;
  border: 1px solid var(--border); background: var(--surface-2);
  cursor: pointer; font-size: 13px; color: var(--text-secondary); flex-shrink: 0;
}
.om-drawer .drawer-body { padding: 16px 20px 24px; overflow-y: auto; flex: 1; }
.om-drawer .action-banner {
  display: flex; gap: 8px; align-items: flex-start;
  padding: 10px 12px; border-radius: 10px;
  font-size: 12.5px; font-weight: 600; margin-bottom: 16px; line-height: 1.4;
}
.om-drawer .action-banner.warn { background: var(--red-soft); color: var(--red); }
.om-drawer .action-banner.ready { background: var(--orange-soft); color: var(--orange); }
.om-drawer .action-banner.ok { background: var(--green-soft); color: var(--green); }
.om-drawer .timeline-label {
  font-size: 11px; font-weight: 650; text-transform: uppercase;
  letter-spacing: 0.04em; color: var(--text-muted); margin: 4px 0 10px;
}
.om-drawer .step {
  display: flex; gap: 10px; padding: 10px 0;
  border-bottom: 1px solid var(--gridline); transition: background 0.4s ease;
}
.om-drawer .step:last-child { border-bottom: none; }
.om-drawer .step.highlight { background: var(--weekend-bg); border-radius: 8px; padding-left: 8px; padding-right: 8px; margin: 0 -8px; }
.om-drawer .step-mark { flex-shrink: 0; margin-top: 2px; }
.om-drawer .step-mark .mark { cursor: default; }
.om-drawer .step-body { min-width: 0; flex: 1; }
.om-drawer .step-date { font-size: 11px; color: var(--text-muted); margin-bottom: 2px; }
.om-drawer .step-title { font-size: 13px; font-weight: 650; }
.om-drawer .step-subject { font-size: 12px; color: var(--text-secondary); margin-top: 3px; font-style: italic; }
.om-drawer .step-status-pill {
  display: inline-block; font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.03em;
  padding: 2px 7px; border-radius: 20px; margin-top: 6px;
}
.om-drawer .step-status-pill.sent { background: var(--blue-soft); color: var(--blue); }
.om-drawer .step-status-pill.generated { background: var(--orange-soft); color: var(--orange); }
.om-drawer .step-status-pill.scheduled { background: var(--weekend-bg); color: var(--text-secondary); }
.om-drawer .step-status-pill.overdue { background: var(--red-soft); color: var(--red); }
.om-drawer .step-status-pill.meeting { background: var(--green-soft); color: var(--green); }
.om-drawer, .om-overlay, .om-tooltip {
  --surface-1: #1a1a19; --surface-2: #0d0d0d;
  --text-secondary: #c3c2b7; --text-muted: #898781;
  --gridline: #2c2c2a; --border: rgba(255,255,255,0.10); --weekend-bg: #232320;
  --blue: #3987e5; --blue-soft: #1c3a5c;
  --orange: #d95926; --orange-soft: #4a2c1c;
  --red: #e66767; --red-soft: #4a2222;
  --green: #0ca30c; --green-soft: #1c3a1c;
}
`;

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MIN_OFFSET = -2;
const MAX_OFFSET = 2;
const STATUS_LABEL = {
  sent: 'Sent',
  generated: 'Generated — ready to send',
  scheduled: 'Scheduled',
  overdue: 'Overdue — not sent',
  meeting: 'Meeting booked',
};

const STEP_LABELS = [
  'Step 1 — Cold intro',
  'Step 2 — Value follow-up',
  'Step 3 — Case study nudge',
  'Step 4 — Breakup email',
];
const STEP_SUBJECTS = [
  'Opening note — worth a quick look?',
  'A couple of proof points before I follow up again',
  'One more example, then I will leave it alone',
  'Should I close this out for now?',
];

const addDays = (date, n) => {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + n);
  return d;
};
const fmtShort = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const fmtLong = (d) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const initials = (name) => (name || '?').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const markGlyph = (status) => (status === 'sent' ? '✓' : status === 'generated' ? '✎' : status === 'overdue' ? '!' : '');

const hashOf = (str) => {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
};

// Placeholder cadence, NOT real data - no per-account generated/sent/step
// model exists yet (see the banner this renders alongside). Derived from a
// hash of the account id so a given account keeps the same pattern across
// renders and page loads instead of flickering a new one each time. Steps
// are stored relative to today so paging through periods moves through real
// time rather than repeating the same marks in every window.
function placeholderCadence(account) {
  const h = hashOf(String(account.id || account.name || ''));
  const count = 3 + (h % 2);
  const firstRel = -(14 + (h % 4));
  const steps = [];
  for (let i = 0; i < count; i++) {
    const rel = firstRel + i * 7;
    let status;
    if (rel > 0) status = 'scheduled';
    else if (rel > -2) status = 'generated';
    else status = 'sent';
    steps.push({ rel, type: 'email', status, label: STEP_LABELS[i], subject: STEP_SUBJECTS[i % STEP_SUBJECTS.length] });
  }
  const pastEmails = steps.filter(s => s.status === 'sent');
  if (h % 3 === 0 && pastEmails.length) pastEmails[pastEmails.length - 1].status = 'overdue';
  const activeCycle = h % 4 === 0;
  if (activeCycle) {
    steps.push({ rel: firstRel + 5, type: 'meeting', status: 'meeting', label: 'Discovery call booked', subject: '30 min intro call' });
  }
  return { steps, activeCycle };
}

function Mark({ step, onHover, onMove, onLeave, onClick }) {
  const cls = `mark ${step.status}${step.type === 'meeting' ? ' meeting' : ''}`;
  return (
    <div
      className={cls}
      onMouseEnter={onHover}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      onClick={onClick}
    >
      <span className={step.type === 'meeting' ? 'glyph' : ''}>
        {step.type === 'meeting' ? '★' : markGlyph(step.status)}
      </span>
    </div>
  );
}

export default function OutreachMatrix({ accounts = [], business }) {
  const [query, setQuery] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [activeOnly, setActiveOnly] = useState(false);
  const [periodOffset, setPeriodOffset] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [highlightKey, setHighlightKey] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const tooltipRef = useRef(null);

  const today = useMemo(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }, []);

  // Anchor the 28-day window to the Monday two weeks before the current
  // week, so "today" lands in week 3 the way the mockup shows it.
  const anchorStart = useMemo(() => {
    const dow = today.getDay();
    return addDays(today, (dow === 0 ? -6 : 1 - dow) - 14);
  }, [today]);

  const windowStart = useMemo(() => addDays(anchorStart, periodOffset * 28), [anchorStart, periodOffset]);
  const todayIndex = Math.round((today.getTime() - windowStart.getTime()) / 86400000);
  const todayIdx = todayIndex >= 0 && todayIndex <= 27 ? todayIndex : null;

  const rows = useMemo(() => accounts.map(a => {
    const { steps, activeCycle } = placeholderCadence(a);
    return { id: String(a.id), name: a.name || '(unnamed)', activeCycle, steps };
  }), [accounts]);

  const visible = useMemo(() => rows.filter(r => {
    if (query && r.name.toLowerCase().indexOf(query.toLowerCase()) === -1) return false;
    if (overdueOnly && !r.steps.some(s => s.status === 'overdue')) return false;
    if (activeOnly && !r.activeCycle) return false;
    return true;
  }), [rows, query, overdueOnly, activeOnly]);

  const dayDate = useCallback((idx) => addDays(windowStart, idx), [windowStart]);
  const isWeekend = useCallback((idx) => {
    const dow = dayDate(idx).getDay();
    return dow === 0 || dow === 6;
  }, [dayDate]);
  const stepDate = useCallback((step) => addDays(today, step.rel), [today]);
  const indexInWindow = useCallback((step) => {
    const idx = Math.round((stepDate(step).getTime() - windowStart.getTime()) / 86400000);
    return idx >= 0 && idx <= 27 ? idx : null;
  }, [stepDate, windowStart]);

  const selected = visible.find(r => r.id === selectedId) || rows.find(r => r.id === selectedId) || null;

  const closeDrawer = useCallback(() => { setSelectedId(null); setHighlightKey(null); }, []);

  useEffect(() => {
    if (!selectedId) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') closeDrawer(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedId, closeDrawer]);

  const moveTooltip = (ev) => {
    const el = tooltipRef.current;
    if (!el) return;
    const x = Math.min(ev.clientX + 14, window.innerWidth - 236);
    const y = Math.min(ev.clientY + 14, window.innerHeight - 100);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  };

  const showTooltip = (ev, step) => {
    setTooltip({ label: step.label, date: fmtLong(stepDate(step)), subject: step.subject, status: STATUS_LABEL[step.status] });
    moveTooltip(ev);
  };

  const clearFilters = () => { setQuery(''); setOverdueOnly(false); setActiveOnly(false); };
  const filtered = !!query || overdueOnly || activeOnly;

  const stepKey = (rowId, step) => `${rowId}-${step.rel}-${step.label}`;

  const weekStarts = [0, 1, 2, 3].map(w => addDays(windowStart, w * 7));
  const windowEnd = addDays(windowStart, 27);

  return (
    <div className="om-root">
      <style>{CSS}</style>
      <div className="card">
        <div className="top">
          <div className="top-row">
            <div className="title-block">
              <h1>Outreach Matrix</h1>
              <p>{business?.name || 'Accounts'} · cadence tracking &amp; planning, one 4-week view at a time</p>
            </div>
            <div className="period-nav">
              <button onClick={() => setPeriodOffset(o => Math.max(MIN_OFFSET, o - 1))} disabled={periodOffset <= MIN_OFFSET} title="Previous 4 weeks">‹</button>
              <div className="period-label">{`${fmtShort(windowStart)} – ${fmtShort(windowEnd)}, ${windowEnd.getFullYear()}`}</div>
              <button onClick={() => setPeriodOffset(o => Math.min(MAX_OFFSET, o + 1))} disabled={periodOffset >= MAX_OFFSET} title="Next 4 weeks">›</button>
              <button className="period-today-btn" onClick={() => setPeriodOffset(0)}>Today</button>
            </div>
          </div>

          <div className="placeholder-banner">
            <span>⚠</span>
            <span>Cadence data not yet connected — the marks below are a sample pattern, not tracked activity. Account names and count are real.</span>
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
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search accounts…" />
          </div>
          <div className="chip-group">
            <button className={`chip toggle overdue-chip${overdueOnly ? ' active' : ''}`} onClick={() => setOverdueOnly(v => !v)}>Overdue only</button>
            <button className={`chip toggle active-chip${activeOnly ? ' active' : ''}`} onClick={() => setActiveOnly(v => !v)}>Active cycles only</button>
          </div>
          <div className="filters-spacer" />
          {filtered && <button className="clear-filters" onClick={clearFilters}>Clear filters</button>}
        </div>

        <div className="result-count">{`Showing ${visible.length} of ${rows.length} accounts`}</div>

        <div className="matrix-wrap">
          {visible.length === 0 ? (
            <div className="empty-state">{rows.length === 0 ? 'No accounts in this business yet.' : 'No accounts match these filters.'}</div>
          ) : (
            <div className="matrix-scroll">
              <div className="grid">
                <div className="cell head-spacer" />
                {weekStarts.map((w, i) => <div key={i} className="cell head-week">{`Week of ${fmtShort(w)}`}</div>)}

                <div className="cell head-name">Accounts</div>
                {Array.from({ length: 28 }, (_, i) => {
                  const d = dayDate(i);
                  return (
                    <div key={i} className={`cell head-day${isWeekend(i) ? ' weekend' : ''}${i === todayIdx ? ' is-today' : ''}`}>
                      <div className="dow">{DOW[d.getDay()]}</div>
                      <div className="num">{d.getDate()}</div>
                    </div>
                  );
                })}

                {visible.map(r => {
                  const byDay = {};
                  r.steps.forEach(s => {
                    const idx = indexInWindow(s);
                    if (idx === null) return;
                    (byDay[idx] = byDay[idx] || []).push(s);
                  });
                  return (
                    <div key={r.id} style={{ display: 'contents' }}>
                      <div className={`cell row-name${r.activeCycle ? ' is-active-cycle' : ''}`} onClick={() => { setSelectedId(r.id); setHighlightKey(null); }}>
                        <div className="avatar">{initials(r.name)}</div>
                        <div className="row-name-text">
                          <div className="acct">{r.name}</div>
                          <div className="biz">
                            {r.activeCycle && <span className="active-dot" />}
                            {`${business?.name || ''}${r.activeCycle ? ' · Active cycle' : ''}`}
                          </div>
                        </div>
                      </div>
                      {Array.from({ length: 28 }, (_, di) => (
                        <div key={di} className={`cell day-cell${isWeekend(di) ? ' weekend' : ''}`}>
                          {(byDay[di] || []).map(s => (
                            <Mark
                              key={stepKey(r.id, s)}
                              step={s}
                              onHover={e => showTooltip(e, s)}
                              onMove={moveTooltip}
                              onLeave={() => setTooltip(null)}
                              onClick={e => { e.stopPropagation(); setSelectedId(r.id); setHighlightKey(stepKey(r.id, s)); }}
                            />
                          ))}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
              {todayIdx !== null && <div className="today-line" style={{ left: 290 + todayIdx * 32 + 16 }} />}
            </div>
          )}
        </div>
      </div>

      <div ref={tooltipRef} className={`om-tooltip${tooltip ? ' show' : ''}`}>
        {tooltip && (
          <>
            <b>{tooltip.label}</b>
            {tooltip.date}<br />“{tooltip.subject}”
            <span className="tt-status">{tooltip.status}</span>
          </>
        )}
      </div>

      <div className={`om-overlay${selected ? ' open' : ''}`} onClick={closeDrawer} />
      <div className={`om-drawer${selected ? ' open' : ''}`}>
        {selected && <Drawer row={selected} business={business} highlightKey={highlightKey} stepDate={stepDate} stepKey={stepKey} onClose={closeDrawer} />}
      </div>
    </div>
  );
}

function Drawer({ row, business, highlightKey, stepDate, stepKey, onClose }) {
  const sorted = [...row.steps].sort((a, b) => a.rel - b.rel);
  const overdue = sorted.filter(s => s.status === 'overdue');
  const ready = sorted.filter(s => s.status === 'generated');

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
          <div className="action-banner warn">{`⚠ ${overdue[0].label} was due ${fmtShort(stepDate(overdue[0]))} — not yet marked sent.`}</div>
        ) : ready.length ? (
          <div className="action-banner ready">{`✎ ${ready[0].label} has a draft ready — send it today.`}</div>
        ) : row.activeCycle ? (
          <div className="action-banner ok">✓ In an active sales cycle — cadence is on track.</div>
        ) : null}

        <div className="timeline-label">Cadence timeline</div>
        {sorted.map(s => {
          const key = stepKey(row.id, s);
          return (
            <div key={key} className={`step${key === highlightKey ? ' highlight' : ''}`}>
              <div className="step-mark">
                <div className={`mark ${s.status}${s.type === 'meeting' ? ' meeting' : ''}`}>
                  <span className={s.type === 'meeting' ? 'glyph' : ''}>{s.type === 'meeting' ? '★' : markGlyph(s.status)}</span>
                </div>
              </div>
              <div className="step-body">
                <div className="step-date">{fmtLong(stepDate(s))}</div>
                <div className="step-title">{s.label}</div>
                <div className="step-subject">“{s.subject}”</div>
                <span className={`step-status-pill ${s.status}`}>{STATUS_LABEL[s.status]}</span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
