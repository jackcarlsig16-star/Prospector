import { useState } from 'react';
import { mono } from '../../constants/colors';
import { CARD, RADIUS } from './tokens';

const fmt = n => n.toLocaleString('en-US');
const label = { ...mono, fontSize: 9, fontWeight: 700, color: CARD.textMuted, textTransform: 'uppercase', letterSpacing: '0.09em' };

// assay-employee-count-metric-v1 — employeeCount is an extraction field, so
// absent means "no source stated one", not "zero" and not "small". The empty
// state says that in words rather than showing a dash a reader could mistake
// for a real low number.
export default function CompanyMetrics({ acc, onUpdate }) {
  const count = typeof acc?.employeeCount === 'number' ? acc.employeeCount : null;
  const manual = !!acc?.employeeCountEditedManually;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(count === null ? '' : String(count));

  const commit = () => {
    const trimmed = draft.trim();
    const n = trimmed === '' ? null : Number(trimmed.replace(/[^0-9.]/g, ''));
    const next = Number.isFinite(n) && n > 0 ? Math.round(n) : null;
    setEditing(false);
    if (next === count && manual) return;
    // Clearing the field also clears the manual flag, so a later re-assay is
    // free to populate it again - otherwise an emptied value would stay
    // permanently protected and unfillable.
    onUpdate({ ...acc, employeeCount: next, employeeCountEditedManually: next !== null });
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span style={label}>Company Metrics</span>
      <span style={{ width: 1, height: 12, background: CARD.borderStrong }} />
      <span style={{ ...mono, fontSize: 10, color: CARD.textMuted }}>Employees</span>
      {editing ? (
        <input
          type="number" autoFocus value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') { setDraft(count === null ? '' : String(count)); setEditing(false); }
          }}
          placeholder="headcount"
          style={{ ...mono, fontSize: 11, width: 92, padding: '2px 6px', background: CARD.surface, border: `1px solid ${CARD.borderStrong}`, borderRadius: RADIUS.sm, color: CARD.textPrimary, outline: 'none' }}
        />
      ) : onUpdate ? (
        <button
          onClick={() => { setDraft(count === null ? '' : String(count)); setEditing(true); }}
          title={manual ? 'Manually entered — a re-assay will not overwrite this' : 'Click to enter a headcount'}
          style={{ ...mono, fontSize: count === null ? 10 : 11, fontWeight: count === null ? 400 : 600, fontStyle: count === null ? 'italic' : 'normal', color: count === null ? CARD.textMuted : CARD.textPrimary, background: 'transparent', border: '1px dashed transparent', borderRadius: RADIUS.sm, padding: '1px 4px', cursor: 'pointer' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = CARD.borderStrong; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; }}
        >
          {count === null ? 'not found — add' : fmt(count)}
        </button>
      ) : (
        <span style={{ ...mono, fontSize: count === null ? 10 : 11, fontWeight: count === null ? 400 : 600, fontStyle: count === null ? 'italic' : 'normal', color: count === null ? CARD.textMuted : CARD.textPrimary }}>
          {count === null ? 'not found' : fmt(count)}
        </span>
      )}
      {manual && !editing && <span style={{ ...mono, fontSize: 9, color: CARD.textSubtle }} title="Protected from automated re-assay">manual</span>}
    </div>
  );
}
