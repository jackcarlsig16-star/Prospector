import { useState } from 'react';
import { SA, SA_TYPE, SA_SHAPE, saSans, saMono } from '../theme';
import '../../../ui/kitTheme';
import { SEMANTIC, memberColor, UNASSIGNED_COLOR } from '../palette';

// ── Dates (YYYY-MM-DD, America/Los_Angeles weeks from periods.js) ───────────
export const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const md = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
export const monthOf = d => `${d.slice(0, 7)}-01`;
export const monthName = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });

// Mondays whose week starts inside the month - same rule as the server's
// scorecard columns (September = Sep 7, 14, 21, 28).
export function weeksOfMonth(month) {
  const first = new Date(`${month}T12:00:00Z`);
  const offset = (8 - first.getUTCDay()) % 7;
  const weeks = [];
  for (let w = addDays(month, offset); w.slice(0, 7) === month.slice(0, 7); w = addDays(w, 7)) weeks.push(w);
  return weeks;
}
// "Week 4 · Sep 28 – Oct 4", numbered within the month its Monday falls in.
export function weekLabel(weekStart) {
  const n = weeksOfMonth(monthOf(weekStart)).indexOf(weekStart) + 1;
  return `Week ${n} · ${md(weekStart)} – ${md(addDays(weekStart, 6))}`;
}
export const shortWeek = weekStart => `Wk ${weeksOfMonth(monthOf(weekStart)).indexOf(weekStart) + 1} · ${md(weekStart)}`;
export const weekOf = weekStart => `Week of ${md(weekStart)}`;

// ── Numbers ─────────────────────────────────────────────────────────────────
export const fmt = n => (n == null ? '—' : Number(n).toLocaleString('en-US'));
export const short = n => (n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : fmt(n));
export const pct = r => (r == null ? '—' : `${(r * 100).toFixed(1)}%`);
// PROPOSED/REVISABLE (REV4): good >= 90% of goal, warn >= 60%, bad below.
export const progressColor = p => (p == null ? SA.muted : p >= 0.9 ? SEMANTIC.healthy : p >= 0.6 ? SEMANTIC.warning : SEMANTIC.problem);

// ── People ──────────────────────────────────────────────────────────────────
// members come back in join order, so index -> color is stable.
export function memberLookup(members) {
  const byId = new Map(members.map((m, i) => [m.user_id, { ...m, first: m.name.split(' ')[0], color: memberColor(i) }]));
  return id => byId.get(id) || { user_id: null, name: 'Unassigned', first: 'Unassigned', color: UNASSIGNED_COLOR };
}
// owner filter: 'team' or a user id; null-owned items show under Team only.
export const ownedBy = (owner, userId) => owner === 'team' || userId === owner;

// ── Pieces ──────────────────────────────────────────────────────────────────
export const cardStyle = { background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusCard, padding: 24 };
export const labelStyle = { ...SA_TYPE.label, color: SA.muted, fontWeight: 500 };
export const h2Style = { margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em', color: SA.text };
export const h3Style = { margin: 0, fontSize: 15, fontWeight: 600, color: SA.text };
export const subStyle = { color: SA.muted };
export const numStyle = { fontVariantNumeric: 'tabular-nums' };
export const rowStyle = { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: `1px solid ${SA.track}` };
export const inputStyle = { ...saSans, fontSize: 14, height: 40, boxSizing: 'border-box', background: SA.inset, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusInner, color: SA.text, padding: '0 12px' };

// ui-clarity-v1 R5 - a label chip (the kit Tag look: a wash of `color`, no
// border, no pointer). `color` is the wash hue, neutral when absent; callers
// that need a dot add their own. Never a control - ToggleChip / Button for that.
export function Chip({ children, color, style, className, ...rest }) {
  return (
    <span className={['ui-tag', className].filter(Boolean).join(' ')} style={{ '--tag-color': color || SA.borderStrong, height: 24, fontSize: 12, ...style }} {...rest}>
      {children}
    </span>
  );
}
export const Dot = ({ color, square }) => <span style={{ width: 8, height: 8, borderRadius: square ? 2 : 999, background: color, flex: 'none' }} />;

// R6 - the kit button at the Goals screens' 44 px size; primary = accent fill (one per area).
export function Btn({ primary, children, style, className, ...rest }) {
  return (
    <button type="button" className={['ui-btn', primary ? 'ui-btn--primary' : 'ui-btn--secondary', className].filter(Boolean).join(' ')} style={{ height: 44, padding: '0 16px', borderRadius: SA_SHAPE.radiusInner, fontSize: 14, gap: 8, ...style }} {...rest}>
      {children}
    </button>
  );
}
export function AddButton({ children, ...rest }) {
  return (
    <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" style={{ height: 44, marginTop: 8, borderRadius: SA_SHAPE.radiusInner, fontSize: 14, padding: '0 14px' }} {...rest}>
      {children}
    </button>
  );
}
export function SourceBadge({ source }) {
  return (
    <span className="ui-tag ui-tag--sm" style={{ '--tag-color': source === 'Manual' ? SA.borderStrong : SA.link, ...saMono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
      <span className="ui-tag__dot" aria-hidden="true" />{source}
    </span>
  );
}

// goals-surface-v1 - the one "a ring is filtering this list" marker (R4: an
// active filter is an accent-outlined chip; the whole chip clears it).
export function ShowingChip({ label, count, onClear }) {
  return (
    <button type="button" className="ui-chip ui-chip--active" onClick={onClear} aria-label={`Showing ${label} (${count}). Clear filter`} style={{ height: 30 }}>
      <span><span style={{ color: SA.muted }}>Showing:</span> {label} <span style={numStyle}>({count})</span></span>
      <span className="ui-chip__x" aria-hidden="true">×</span>
    </button>
  );
}

// goals-surface-v1 Stage 4 - a number that opens the list it counts. Looks
// like the number (dotted underline), works as a button.
export function DrillNumber({ onClick, title, children, style }) {
  return (
    <button type="button" className="sa-drill" onClick={onClick} title={title}
      style={{ all: 'unset', cursor: 'pointer', borderRadius: 4, textDecoration: 'underline dotted', textDecorationColor: 'var(--sa-muted)', textUnderlineOffset: 4, ...style }}>
      {children}
    </button>
  );
}

// Scroll an element into view and flash it, so a jump link shows where it landed.
export function flashTo(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.animate?.([{ boxShadow: `0 0 0 3px ${SA.accent}` }, { boxShadow: '0 0 0 0 transparent' }], { duration: 1600, delay: 250 });
  return true;
}

export function NeedsMigration({ what }) {
  return (
    <div role="status" style={{ background: SA.inset, border: `1px dashed ${SA.borderStrong}`, borderRadius: SA_SHAPE.radiusInner, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontWeight: 600, color: SA.warn }}>Needs the Stage 4 database update</span>
      <span style={{ fontSize: 13, color: SA.muted }}>{what} can’t load until the pending migration (sales-goals-v1 REV4 Stage 4) is run in Supabase.</span>
    </div>
  );
}

export function ErrorNote({ message }) {
  return <div role="alert" style={{ fontSize: 13, color: SEMANTIC.problem }}>{message}</div>;
}

// Inline number editor: click to edit, Enter saves, Esc cancels. Rates are
// typed as percentages (17 = 17%).
export function EditableNumber({ value, rate, placeholder, onSave, ariaLabel, display, muted }) {
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  if (draft === null) {
    return (
      <button type="button" onClick={() => setDraft(value == null ? '' : String(rate ? +(value * 100).toFixed(2) : value))} aria-label={ariaLabel}
        style={{ all: 'unset', cursor: 'pointer', color: value == null ? (muted ? SA.muted : SA.link) : 'inherit', textDecoration: 'underline dotted', textDecorationColor: SA.borderStrong, textUnderlineOffset: 3, ...numStyle }}>
        {value == null ? placeholder : display}
      </button>
    );
  }
  const save = async () => {
    const n = draft.trim() === '' ? null : Number(draft);
    if (n !== null && !(Number.isFinite(n) && n >= 0)) return;
    setBusy(true);
    try { await onSave(n == null ? null : rate ? n / 100 : n); setDraft(null); } catch { /* the table shows the error */ } finally { setBusy(false); }
  };
  return (
    <input autoFocus value={draft} disabled={busy} inputMode="decimal" aria-label={ariaLabel}
      onChange={e => setDraft(e.target.value)} onBlur={() => setDraft(null)}
      onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setDraft(null); }}
      style={{ ...inputStyle, height: 30, width: 96, textAlign: 'right', fontSize: 13 }} />
  );
}

// microsoft-connect-v1 Stage 4b - the calendar's count sits under the typed
// number on the meeting rows (only when the workspace has Outlook meetings on).
export function FromOutlook({ n }) {
  if (n == null) return null;
  return <div style={{ fontSize: 11, fontWeight: 400, color: SA.muted, marginTop: 4, whiteSpace: 'nowrap' }} title="Counted from synced Outlook calendar events with a confirmed partner domain">from Outlook: {fmt(n)}</div>;
}

// An upload's { name, data } body: the file as base64, no data: prefix.
export const toBase64 = file => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(new Error("Couldn't read that file"));
  r.readAsDataURL(file);
});
