import { SA, SA_TYPE, SA_SHAPE, saSans, saMono } from '../theme';
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

export function Chip({ children, color, style, ...rest }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 10px', borderRadius: 999, background: SA.surface2, border: `1px solid ${SA.border}`, fontSize: 12, color: color || SA.soft, whiteSpace: 'nowrap', ...style }} {...rest}>
      {children}
    </span>
  );
}
export const Dot = ({ color, square }) => <span style={{ width: 8, height: 8, borderRadius: square ? 2 : 999, background: color, flex: 'none' }} />;

export function Btn({ primary, children, style, ...rest }) {
  return (
    <button type="button" style={{ ...saSans, height: 44, padding: '0 16px', borderRadius: SA_SHAPE.radiusInner, border: `1px solid ${primary ? SA.accent : SA.border}`, background: primary ? SA.accent : SA.surface2, color: primary ? SA.ground : SA.text, fontSize: 14, fontWeight: 500, cursor: rest.disabled ? 'default' : 'pointer', opacity: rest.disabled ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: 8, ...style }} {...rest}>
      {children}
    </button>
  );
}
export function AddButton({ children, ...rest }) {
  return (
    <button type="button" style={{ ...saSans, height: 44, width: '100%', marginTop: 8, border: `1px dashed ${SA.borderStrong}`, borderRadius: SA_SHAPE.radiusInner, background: 'transparent', color: SA.muted, fontSize: 14, fontWeight: 500, textAlign: 'left', padding: '0 14px', cursor: 'pointer' }} {...rest}>
      {children}
    </button>
  );
}
export function SourceBadge({ source }) {
  return (
    <span style={{ ...saMono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 6, border: `1px solid ${SA.borderStrong}`, color: source === 'Manual' ? SA.soft : SA.link }}>
      {source}
    </span>
  );
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
