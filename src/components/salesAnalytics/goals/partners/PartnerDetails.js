import { useState, useEffect } from 'react';
import { SA, saSans } from '../../theme';
import { WORKFLOW_STEPS, stepOf } from '../../../../constants/partnerPipeline';
import { labelStyle, subStyle, inputStyle, Btn, ErrorNote } from '../goalsUi';

// sales-partners-workflow-v1 Stage 4 - a row's drop-down: the research and
// intel from the sheet (read-only here), priority and the stored first
// email (both moved over from the old cards), and the partner's history.
// Apollo stays read-only: the link only opens Apollo's sequences page.
const APOLLO_SEQUENCES = 'https://app.apollo.io/#/sequences';
const stage = s => (s === 'paused' ? 'Paused' : s ? WORKFLOW_STEPS[stepOf(s)].label : '—');
const when = iso => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function Field({ label, children, color }) {
  if (!children) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span style={labelStyle}>{label}</span>
      <div style={{ color: color || SA.text, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{children}</div>
    </div>
  );
}

export function eventText(e, lookup) {
  switch (e.event) {
    case 'status': return `${stage(e.from_status)} → ${stage(e.to_status)}`;
    case 'deprioritize': return `Paused (from ${stage(e.from_status)})`;
    case 'assign': return `Assigned to ${e.meta?.to_owner ? lookup(e.meta.to_owner).first : 'nobody'}`;
    case 'hot': return e.meta?.hot ? 'Marked hot' : 'No longer hot';
    case 'snooze': return `Snoozed until ${e.meta?.until || '—'}`;
    case 'note': return `Note: ${e.note}`;
    case 'undo': return `Undid the ${e.meta?.undid_event || 'last'} change`;
    default: return e.event;
  }
}

function History({ goalId, version, lookup, onEvents }) {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    onEvents(goalId).then(ev => { if (live) { setEvents(ev); setError(''); } }).catch(e => live && setError(e.message));
    return () => { live = false; };
  }, [goalId, version, onEvents]);
  if (error) return <ErrorNote message={error} />;
  if (!events) return <span style={{ ...subStyle, fontSize: 13 }}>Loading history…</span>;
  if (!events.length) return <span style={{ ...subStyle, fontSize: 13 }}>No changes yet. Every Next, More action and note will show here.</span>;
  const undone = new Set(events.filter(e => e.event === 'undo').map(e => e.meta?.undid));
  return (
    <ol aria-label="History" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
      {events.map(e => (
        <li key={e.id} style={{ display: 'flex', gap: 10, fontSize: 13, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ color: SA.muted, minWidth: 108, fontVariantNumeric: 'tabular-nums' }}>{when(e.at)}</span>
          <span style={{ flex: '1 1 200px', color: undone.has(e.id) ? SA.muted : SA.text, textDecoration: undone.has(e.id) ? 'line-through' : 'none' }}>{eventText(e, lookup)}</span>
          <span style={{ color: SA.muted }}>{e.by_user ? lookup(e.by_user).first : 'automatic'}</span>
        </li>
      ))}
    </ol>
  );
}

// bump: the parent's change counter - a note changes no partner field, so
// updated_at alone wouldn't refresh the history.
export default function PartnerDetails({ partner, lookup, canEdit, onUpdate, onEvents, bump }) {
  const [showEmail, setShowEmail] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const watch = [partner.do_not_say, partner.watch_outs].filter(Boolean).join('\n');
  return (
    <div style={{ borderTop: `1px solid ${SA.border}`, padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 14, fontSize: 13 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px 20px' }}>
        <Field label="Angle">{partner.angle}</Field>
        <Field label="Next step">{partner.next_step}</Field>
        <Field label="Partner role">{partner.partner_role}</Field>
        <Field label="Known contacts">{partner.known_contacts}</Field>
        <Field label="Target titles">{partner.target_titles}</Field>
        {partner.sequence_to_use && (
          <Field label="Sequence to use">
            {partner.sequence_to_use} · <a href={APOLLO_SEQUENCES} target="_blank" rel="noreferrer" style={{ color: SA.link }}>Open in Apollo ↗</a>
          </Field>
        )}
        <Field label="Flags / do not say" color={SA.warn}>{watch}</Field>
        <Field label="Notes">{partner.notes}</Field>
        <Field label="Their words" color={SA.soft}>{partner.motto}</Field>
        <Field label="Champion">{partner.champion}</Field>
        {partner.meeting_status && partner.meeting_status.trim().toUpperCase() !== 'N' && <Field label="Meeting notes">{partner.meeting_status}</Field>}
        <Field label="1st email sent" color={SA.muted}>{partner.first_email_at}</Field>
        <Field label="Sources" color={SA.muted}>{partner.sources}</Field>
      </div>
      {(canEdit || partner.first_email) && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {canEdit && <>
            <label style={labelStyle} htmlFor={`wf-prio-${partner.id}`}>Priority</label>
            <select id={`wf-prio-${partner.id}`} value={partner.priority ?? ''} style={{ ...inputStyle, height: 36, width: 'auto' }}
              onChange={async e => { setError(''); try { await onUpdate(partner.id, { priority: e.target.value ? Number(e.target.value) : null }); } catch (err) { setError(err.message); } }}>
              <option value="1">P1 · this week</option><option value="2">P2 · 30 days</option><option value="3">P3 · 60–90 days</option><option value="">Unprioritized</option>
            </select>
          </>}
          {partner.first_email && <Btn style={{ height: 36 }} aria-expanded={showEmail} onClick={() => setShowEmail(s => !s)}>{showEmail ? 'Hide first email' : 'Open first email'}</Btn>}
        </div>
      )}
      {showEmail && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {partner.first_email_note && <span style={{ ...subStyle, fontSize: 12 }}>{partner.first_email_note}</span>}
          <pre style={{ ...saSans, margin: 0, whiteSpace: 'pre-wrap', background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: 8, padding: 12, fontSize: 13, maxHeight: 280, overflow: 'auto' }}>{partner.first_email}</pre>
          <Btn style={{ height: 36, alignSelf: 'flex-start' }} onClick={async () => { try { await navigator.clipboard.writeText(partner.first_email); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { setError('Copy failed - select the text instead'); } }}>{copied ? 'Copied ✓' : 'Copy email'}</Btn>
        </div>
      )}
      {error && <ErrorNote message={error} />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={labelStyle}>History · newest first</span>
        <History goalId={partner.id} version={`${partner.updated_at}|${bump}`} lookup={lookup} onEvents={onEvents} />
      </div>
    </div>
  );
}
