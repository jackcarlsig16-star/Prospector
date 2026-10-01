import { useState } from 'react';
import { SA, SA_TYPE, SA_SHAPE, SA_BAD_BG } from './theme';
import { cohortColor, AUDIENCE_LABELS, audienceColor } from './palette';
import { updateProspect } from './huddleApi';

const OWNERS = [['jack', 'Jack'], ['cyrus', 'Cyrus'], ['unassigned', '—']];
// Not now / Dead get their own flows (snooze date, confirm) in Stage 4.
const STATUSES = [['new', 'New'], ['claimed', 'Claimed'], ['contacted', 'Contacted'], ['booked', 'Booked']];
const NEXT_ACTIONS = [['call', 'Call'], ['email', 'Email'], ['linkedin', 'LinkedIn'], ['send_collateral', 'Send collateral'], ['wait', 'Wait']];

function relativeTime(iso) {
  if (!iso) return null;
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 60) return `${Math.max(min, 1)}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

function Badge({ children, color }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color, background: `color-mix(in srgb, ${color} 12%, transparent)`, borderRadius: SA_SHAPE.radiusPill, padding: '3px 9px', whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

const controlStyle = { ...SA_TYPE.body, fontSize: 13, height: 34, padding: '0 8px', background: SA.surface2, border: `1px solid ${SA.border}`, borderRadius: 8, color: SA.text };
const linkStyle = { fontSize: 12, color: SA.accent, textDecoration: 'none' };

async function copy(text) {
  try { await navigator.clipboard.writeText(text); } catch {}
}

export default function HuddleCard({ businessId, prospect: p, collateral, isNewSinceHuddle, onUpdated }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState(p.notes || '');
  const [collateralId, setCollateralId] = useState('');

  const save = async patch => {
    setSaving(true);
    setError('');
    try {
      const row = await updateProspect(businessId, p.contact_id, patch);
      onUpdated(row);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const seq = p.sequence;
  const b = p.badges;
  const chosen = collateral.find(c => c.id === collateralId);

  return (
    <div style={{ padding: '14px 16px', background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusInner, display: 'flex', flexDirection: 'column', gap: 10, opacity: saving ? 0.7 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ ...SA_TYPE.cardTitle, color: SA.text, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {p.name || 'Unknown contact'}
            {isNewSinceHuddle && <Badge color={SA.accent}>Since last huddle</Badge>}
            {p.in_pipeline && <Badge color={SA.good}>In pipeline</Badge>}
          </div>
          <div style={{ fontSize: 13, color: SA.muted, marginTop: 2 }}>
            {[p.title, p.company].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div title={p.why.join('\n')} style={{ textAlign: 'right', cursor: 'help', flexShrink: 0 }}>
          <div style={{ ...SA_TYPE.label, color: SA.faint }}>Heat</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: SA.text, fontVariantNumeric: 'tabular-nums' }}>{p.score}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, color: SA.muted }}>
        {seq && (
          <>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: cohortColor(seq.cohort) }} />
              {seq.cohort || 'Other'}
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, color: audienceColor(seq.audience) }}>{AUDIENCE_LABELS[seq.audience] || seq.audience}</span>
            <span title={seq.name || ''} style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {seq.name || 'Sequence not in latest sync'}
            </span>
            {p.step != null && <span style={{ whiteSpace: 'nowrap' }}>step {p.step}</span>}
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {b.replied && <Badge color={SA.good}>Replied{b.reply_class ? ` · ${b.reply_class.replace(/_/g, ' ')}` : ''}</Badge>}
        {b.click_days > 0 && <Badge color={SA.accent}>Clicked{b.click_days > 1 ? ` · ${b.click_days} days` : ''}</Badge>}
        {b.opens > 0 && !b.possible_bot_open && <Badge color={SA.muted}>Opened ×{b.opens}</Badge>}
        {b.possible_bot_open && <Badge color={SA.warn}>Possible bot open</Badge>}
        <span style={{ fontSize: 12, color: SA.faint }}>
          {p.last_signal_at ? `Last open/click ${relativeTime(p.last_signal_at)}` : 'No open/click time from Apollo'}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', background: SA.surface2, border: `1px solid ${SA.border}`, borderRadius: 8, padding: 2 }}>
          {OWNERS.map(([id, label]) => (
            <button key={id} disabled={saving} onClick={() => p.owner !== id && save({ owner: id })}
              style={{ ...SA_TYPE.body, fontSize: 12, border: 0, borderRadius: 6, padding: '0 10px', height: 28, cursor: 'pointer', background: p.owner === id ? SA.accent : 'transparent', color: p.owner === id ? SA.ground : SA.muted }}>
              {label}
            </button>
          ))}
        </div>
        <select aria-label="Status" disabled={saving} value={p.status} onChange={e => save({ status: e.target.value })} style={controlStyle}>
          {STATUSES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          {!STATUSES.some(([id]) => id === p.status) && <option value={p.status}>{p.status}</option>}
        </select>
        <select aria-label="Next action" disabled={saving} value={p.next_action || ''} onChange={e => save({ next_action: e.target.value || null })} style={controlStyle}>
          <option value="">No next action</option>
          {NEXT_ACTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <input aria-label="Next action due" type="date" disabled={saving} value={p.next_action_due || ''} onChange={e => save({ next_action_due: e.target.value || null })} style={controlStyle} />
      </div>

      {p.next_action === 'send_collateral' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {collateral.length === 0 ? (
            <span style={{ fontSize: 12, color: SA.faint }}>No collateral yet — add items in the Collateral library.</span>
          ) : (
            <>
              <select aria-label="Collateral" value={collateralId} onChange={e => setCollateralId(e.target.value)} style={controlStyle}>
                <option value="">Pick collateral…</option>
                {collateral.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
              {chosen && <button onClick={() => copy(chosen.url)} style={{ ...controlStyle, cursor: 'pointer' }}>Copy link</button>}
              {chosen && chosen.snippet && <button onClick={() => copy(chosen.snippet)} style={{ ...controlStyle, cursor: 'pointer' }}>Copy snippet</button>}
            </>
          )}
        </div>
      )}

      <textarea aria-label="Notes" placeholder="Notes" value={notes} disabled={saving} rows={2}
        onChange={e => setNotes(e.target.value)}
        onBlur={() => notes !== (p.notes || '') && save({ notes: notes || null })}
        style={{ ...SA_TYPE.body, fontSize: 13, padding: 8, background: SA.surface2, border: `1px solid ${SA.border}`, borderRadius: 8, color: SA.text, resize: 'vertical' }} />

      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <a href={p.apollo_url} target="_blank" rel="noopener noreferrer" style={linkStyle}>Open in Apollo ↗</a>
        {p.linkedin_url && <a href={p.linkedin_url} target="_blank" rel="noopener noreferrer" style={linkStyle}>LinkedIn ↗</a>}
        {p.phone && <span style={{ fontSize: 12, color: SA.muted }}>{p.phone}</span>}
        {error && <span style={{ fontSize: 12, color: SA.bad, background: SA_BAD_BG, borderRadius: 6, padding: '2px 8px' }}>{error}</span>}
      </div>
    </div>
  );
}
