import { useState } from 'react';
import { SA, saSans } from '../../theme';
import { SEMANTIC } from '../../palette';
import { PIPELINE_STATUSES, STALE_DAYS, daysSinceTouch } from '../../../../constants/partnerPipeline';
import { labelStyle, subStyle, inputStyle, Chip, Dot, Btn, ErrorNote } from '../goalsUi';

const STATUS_LABEL = Object.fromEntries(PIPELINE_STATUSES.map(s => [s.id, s.label]));
// One color per stage of the funnel, from the shared palette: not yet out,
// outreach, engaged, closing, parked.
const STATUS_COLOR = {
  not_started: SA.neutral, researching: SA.neutral, first_email_drafted: SA.faint,
  first_email_sent: SA.accent, in_sequence: SA.accent,
  replied: SEMANTIC.warning, meeting_set: SEMANTIC.warning,
  proposal_pilot: SEMANTIC.healthy, live: SEMANTIC.healthy, paused: SA.faint,
};
export const statusOf = p => p.pipeline_status || 'not_started';
export const statusLabel = id => STATUS_LABEL[id];
export const statusColor = id => STATUS_COLOR[id];
export const tierLabel = t => (t === 'active' ? 'Active' : t ? `Tier ${t}` : null);

// The one-click status buttons, in funnel order.
const STATUS_BUTTONS = [
  { to: 'first_email_sent', icon: '✉', label: '1st email sent' },
  { to: 'replied', icon: '↩', label: 'Replied' },
  { to: 'meeting_set', icon: '📅', label: 'Meeting booked' },
  { to: 'proposal_pilot', icon: '🧪', label: 'Pilot' },
  { to: 'live', icon: '✅', label: 'Live' },
];
// Apollo stays read-only: this only opens Apollo's sequences page; adding
// people to a sequence happens there.
const APOLLO_SEQUENCES = 'https://app.apollo.io/#/sequences';

const iconBtn = active => ({
  ...saSans, minWidth: 36, height: 36, padding: '0 8px', borderRadius: 8, fontSize: 15, cursor: active ? 'default' : 'pointer',
  border: `1px solid ${active ? SA.accent : SA.border}`, background: active ? 'color-mix(in srgb, var(--sa-accent) 18%, transparent)' : SA.surface2, color: SA.text,
});

function Field({ label, children, color }) {
  if (!children) return null;
  return <div><span style={labelStyle}>{label}</span><div style={{ color: color || SA.text, whiteSpace: 'pre-wrap' }}>{children}</div></div>;
}

export default function PartnerCard({ partner, open, onToggle, canEdit, members, lookup, onUpdate, onSignal, today }) {
  const [panel, setPanel] = useState(null); // 'email' | 'note'
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const owner = lookup(partner.owner_user_id);
  const status = statusOf(partner);
  const days = daysSinceTouch(partner);
  const stale = days !== null && days >= STALE_DAYS;
  const snoozed = partner.snoozed_until && partner.snoozed_until > today;
  const run = async fn => { setError(''); try { await fn(); return true; } catch (e) { setError(e.message); return false; } };
  const signal = s => run(() => onSignal(partner, s));
  const watchOut = [partner.watch_outs, partner.do_not_say].filter(Boolean).join('\n');

  return (
    <div style={{ background: SA.inset, border: `1px solid ${open ? SA.borderStrong : partner.hot ? SEMANTIC.warning : SA.border}`, borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8, opacity: snoozed && !open ? 0.7 : 1 }}>
      <button type="button" onClick={onToggle} aria-expanded={open}
        style={{ all: 'unset', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6, borderRadius: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
          <span style={{ fontWeight: 600 }}>{partner.hot && <span aria-label="Hot" title="Hot">🔥 </span>}{partner.name}</span>
          <span style={{ ...subStyle, fontSize: 12, whiteSpace: 'nowrap', color: stale ? SA.bad : SA.muted }} title={partner.last_touch_at ? `Last touch ${new Date(partner.last_touch_at).toLocaleDateString()}` : 'No touch yet'}>
            {days === null ? 'No touch' : days === 0 ? 'Today' : `${days}d`}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Chip><Dot color={statusColor(status)} />{statusLabel(status)}</Chip>
          {partner.tier && <Chip>{tierLabel(partner.tier)}</Chip>}
          {partner.owner_user_id && <Chip><Dot color={owner.color} />{owner.first}</Chip>}
          {snoozed && <Chip>⏸ until {new Date(`${partner.snoozed_until}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}</Chip>}
        </div>
        {partner.category && <span style={{ ...subStyle, fontSize: 12 }}>{partner.category.replace(/^\d+\.\s*/, '')}</span>}
        {partner.next_step && <span style={{ fontSize: 12, color: SA.soft }}>Next: {partner.next_step}</span>}
      </button>

      {canEdit && (
        <div role="group" aria-label={`Update ${partner.name}`} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STATUS_BUTTONS.map(b => (
            <button key={b.to} type="button" title={b.label} aria-label={b.label} aria-pressed={status === b.to} disabled={status === b.to}
              onClick={() => signal({ type: 'status', to: b.to })} style={iconBtn(status === b.to)}>{b.icon}</button>
          ))}
          <button type="button" title={partner.hot ? 'Not hot' : 'Hot'} aria-label={partner.hot ? 'Mark not hot' : 'Mark hot'} aria-pressed={!!partner.hot}
            onClick={() => signal({ type: 'hot', hot: !partner.hot })} style={iconBtn(false)}>{partner.hot ? '🔥' : '♨'}</button>
          <button type="button" title="Snooze 7 days" aria-label="Snooze 7 days" onClick={() => signal({ type: 'snooze', days: 7 })} style={iconBtn(false)}>⏸</button>
        </div>
      )}

      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: `1px solid ${SA.border}`, paddingTop: 10, fontSize: 13 }}>
          <Field label="Watch out" color={SA.warn}>{watchOut}</Field>
          <Field label="Known contacts">{partner.known_contacts}</Field>
          <Field label="Target titles">{partner.target_titles}</Field>
          {partner.sequence_to_use && (
            <div>
              <span style={labelStyle}>Sequence to use</span>
              <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span>{partner.sequence_to_use}</span>
                <a href={APOLLO_SEQUENCES} target="_blank" rel="noreferrer" style={{ color: SA.link, fontSize: 12 }}>Open in Apollo ↗</a>
              </div>
            </div>
          )}
          <Field label="Next step">{partner.next_step}</Field>
          <Field label="Angle">{partner.angle}</Field>
          <Field label="Role">{partner.partner_role}</Field>
          <Field label="Their words" color={SA.soft}>{partner.motto}</Field>
          {partner.champion && <Field label="Champion">{partner.champion}</Field>}
          {partner.meeting_status && partner.meeting_status.trim().toUpperCase() !== 'N' && <Field label="Meeting notes">{partner.meeting_status}</Field>}
          <Field label="Sources" color={SA.muted}>{partner.sources}</Field>
          {partner.first_email_at && <Field label="1st email sent" color={SA.muted}>{partner.first_email_at}</Field>}
          {canEdit && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <label style={labelStyle} htmlFor={`prio-${partner.id}`}>Priority</label>
              <select id={`prio-${partner.id}`} value={partner.priority ?? ''} onChange={e => run(() => onUpdate(partner.id, { priority: e.target.value ? Number(e.target.value) : null }))} style={{ ...inputStyle, height: 36, width: 'auto' }}>
                <option value="1">P1 · this week</option><option value="2">P2 · 30 days</option><option value="3">P3 · 60–90 days</option><option value="">Unprioritized</option>
              </select>
              <label style={labelStyle} htmlFor={`own-${partner.id}`}>👤 Assign</label>
              <select id={`own-${partner.id}`} value={partner.owner_user_id || ''} onChange={e => signal({ type: 'assign', owner_user_id: e.target.value || null })} style={{ ...inputStyle, height: 36, width: 'auto' }}>
                <option value="">Unassigned</option>
                {members.map(m => <option key={m.user_id} value={m.user_id}>{m.name}{m.role === 'viewer' ? ' (viewer)' : ''}</option>)}
              </select>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 4 }}>
            {partner.first_email && <Btn style={{ height: 36 }} aria-expanded={panel === 'email'} onClick={() => setPanel(panel === 'email' ? null : 'email')}>Open first email</Btn>}
            {canEdit && <Btn style={{ height: 36 }} aria-expanded={panel === 'note'} onClick={() => setPanel(panel === 'note' ? null : 'note')}>📝 Quick note</Btn>}
            {canEdit && status !== 'paused' && <Btn style={{ height: 36 }} onClick={() => signal({ type: 'deprioritize' })}>Deprioritize</Btn>}
          </div>
          {panel === 'email' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {partner.first_email_note && <span style={{ ...subStyle, fontSize: 12 }}>{partner.first_email_note}</span>}
              <pre style={{ ...saSans, margin: 0, whiteSpace: 'pre-wrap', background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: 8, padding: 12, fontSize: 13, maxHeight: 280, overflow: 'auto' }}>{partner.first_email}</pre>
              <Btn style={{ height: 36, alignSelf: 'flex-start' }} onClick={async () => { try { await navigator.clipboard.writeText(partner.first_email); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { setError('Copy failed - select the text instead'); } }}>{copied ? 'Copied ✓' : 'Copy email'}</Btn>
            </div>
          )}
          {panel === 'note' && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input autoFocus value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Called, left voicemail" aria-label="Quick note"
                onKeyDown={async e => { if (e.key === 'Enter' && note.trim() && await signal({ type: 'note', note })) { setNote(''); setPanel(null); } if (e.key === 'Escape') setPanel(null); }}
                style={{ ...inputStyle, flex: '1 1 220px' }} />
              <Btn primary style={{ height: 40 }} disabled={!note.trim()} onClick={async () => { if (await signal({ type: 'note', note })) { setNote(''); setPanel(null); } }}>Save</Btn>
            </div>
          )}
        </div>
      )}
      {error && <ErrorNote message={error} />}
    </div>
  );
}
