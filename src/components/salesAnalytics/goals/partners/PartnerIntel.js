import { useState } from 'react';
import { SA, saSans } from '../../theme';
import { labelStyle, subStyle, inputStyle, Btn, ErrorNote } from '../goalsUi';
import PartnerDomains from './PartnerDomains';

// Apollo stays read-only: the link only opens Apollo's sequences page.
const APOLLO_SEQUENCES = 'https://app.apollo.io/#/sequences';
const cut = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function Field({ label, children, color }) {
  if (!children) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span style={labelStyle}>{label}</span>
      <div style={{ color: color || SA.text, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{children}</div>
    </div>
  );
}

// partner-360-v1 - the sheet's research and the stored first email, folded
// away behind one preview line (it was the whole drop-down before).
// domains: the partner_domains api ({ load, add, update, remove }); the
// Domains row stays visible while the rest is folded (it's what links the
// partner to Apollo, so it shouldn't hide behind Show).
export default function PartnerIntel({ partner, canEdit, onUpdate, domains }) {
  const [open, setOpen] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const watch = [partner.do_not_say, partner.watch_outs].filter(Boolean).join('\n');
  const preview = [cut(partner.angle || partner.partner_role, 90), partner.sequence_to_use && `Sequence: ${cut(partner.sequence_to_use, 40)}`, watch && 'has do-not-say'].filter(Boolean).join(' · ') || 'no research yet';
  return (
    <section aria-label="Intel" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)}
        style={{ all: 'unset', ...saSans, cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'baseline', minHeight: 24, fontSize: 13 }}>
        <span style={labelStyle}>Intel</span>
        <span style={{ color: SA.muted }}>{open ? 'Hide ▾' : 'Show ▸'}</span>
        {!open && <span style={{ ...subStyle, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{preview}</span>}
      </button>
      <PartnerDomains partner={partner} canEdit={canEdit} api={domains} />
      {open && <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px 20px' }}>
          <Field label="Angle">{partner.angle}</Field>
          <Field label="Partner role">{partner.partner_role}</Field>
          <Field label="Target titles">{partner.target_titles}</Field>
          {partner.sequence_to_use && (
            <Field label="Sequence to use">
              {partner.sequence_to_use} · <a href={APOLLO_SEQUENCES} target="_blank" rel="noreferrer" style={{ color: SA.link }}>Open in Apollo ↗</a>
            </Field>
          )}
          <Field label="Flags / do not say" color={SA.warn}>{watch}</Field>
          <Field label="Their words" color={SA.soft}>{partner.motto}</Field>
          <Field label="Champion">{partner.champion}</Field>
          <Field label="Known contacts (sheet)">{partner.known_contacts}</Field>
          {partner.meeting_status && partner.meeting_status.trim().toUpperCase() !== 'N' && <Field label="Meeting notes">{partner.meeting_status}</Field>}
          <Field label="Notes">{partner.notes}</Field>
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
      </>}
    </section>
  );
}
