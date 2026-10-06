import { useState } from 'react';
import { SA, saSans } from '../theme';
import { PRIORITY_COLORS, SEMANTIC } from '../palette';
import Ring, { RingLegend } from '../charts/Ring';
import { cardStyle, labelStyle, h2Style, h3Style, subStyle, numStyle, inputStyle, Chip, Dot, Btn, AddButton, ErrorNote } from './goalsUi';

const COLUMNS = [
  { p: 1, title: 'P1', when: 'This week' },
  { p: 2, title: 'P2', when: 'Next 30 days' },
  { p: 3, title: 'P3', when: '60–90 days' },
];
// "N" is the sheet's shorthand for no meeting yet.
const noMeeting = s => !s || s.trim().toUpperCase() === 'N';

function Field({ label, children, color }) {
  if (!children) return null;
  return <div><span style={labelStyle}>{label}</span><div style={{ color: color || SA.text, whiteSpace: 'pre-wrap' }}>{children}</div></div>;
}

function PartnerCard({ partner, open, onToggle, canEdit, members, lookup, onUpdate }) {
  const [panel, setPanel] = useState(null); // 'email' | 'meeting'
  const [meeting, setMeeting] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const owner = lookup(partner.owner_user_id);
  const update = async body => { setError(''); try { await onUpdate(partner.id, body); return true; } catch (e) { setError(e.message); return false; } };

  return (
    <div style={{ background: SA.inset, border: `1px solid ${open ? SA.borderStrong : SA.border}`, borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button type="button" onClick={onToggle} aria-expanded={open}
        style={{ all: 'unset', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8, borderRadius: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
          <span style={{ fontWeight: 600 }}>{partner.name}</span>
          <span style={{ ...subStyle, fontSize: 12 }}>{open ? 'Hide' : 'Details'}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Chip><Dot color={noMeeting(partner.meeting_status) ? 'var(--sa-neutral)' : SEMANTIC.warning} />{noMeeting(partner.meeting_status) ? 'No meeting yet' : partner.meeting_status}</Chip>
          {partner.owner_user_id && <Chip><Dot color={owner.color} />{owner.first}</Chip>}
        </div>
        {partner.champion && <span style={{ ...subStyle, fontSize: 12 }}>Champion: {partner.champion}</span>}
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: `1px solid ${SA.border}`, paddingTop: 10, fontSize: 13 }}>
          <Field label="Angle">{partner.angle}</Field>
          <Field label="Their words" color={SA.soft}>{partner.motto}</Field>
          <Field label="Watch out" color={SA.warn}>{partner.watch_outs}</Field>
          <Field label="Sources" color={SA.muted}>{partner.sources}</Field>
          {canEdit && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <label style={{ ...labelStyle }} htmlFor={`prio-${partner.id}`}>Priority</label>
              <select id={`prio-${partner.id}`} value={partner.priority ?? ''} onChange={e => update({ priority: e.target.value ? Number(e.target.value) : null })} style={{ ...inputStyle, height: 36, width: 'auto' }}>
                <option value="1">P1 · this week</option><option value="2">P2 · 30 days</option><option value="3">P3 · 60–90 days</option><option value="">Unprioritized</option>
              </select>
              <select aria-label="Owner" value={partner.owner_user_id || ''} onChange={e => update({ owner_user_id: e.target.value || null })} style={{ ...inputStyle, height: 36, width: 'auto' }}>
                <option value="">Unassigned</option>
                {members.map(m => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
              </select>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 4 }}>
            <Btn style={{ height: 36 }} aria-expanded={panel === 'email'} onClick={() => setPanel(panel === 'email' ? null : 'email')}>Open first email</Btn>
            {canEdit && <Btn style={{ height: 36 }} aria-expanded={panel === 'meeting'} onClick={() => { setMeeting(noMeeting(partner.meeting_status) ? '' : partner.meeting_status); setPanel(panel === 'meeting' ? null : 'meeting'); }}>Log meeting</Btn>}
          </div>
          {panel === 'email' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {partner.first_email_note && <span style={{ ...subStyle, fontSize: 12 }}>{partner.first_email_note}</span>}
              {partner.first_email
                ? <>
                    <pre style={{ ...saSans, margin: 0, whiteSpace: 'pre-wrap', background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: 8, padding: 12, fontSize: 13, maxHeight: 280, overflow: 'auto' }}>{partner.first_email}</pre>
                    <Btn style={{ height: 36, alignSelf: 'flex-start' }} onClick={async () => { try { await navigator.clipboard.writeText(partner.first_email); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { setError('Copy failed - select the text instead'); } }}>{copied ? 'Copied ✓' : 'Copy email'}</Btn>
                  </>
                : <span style={{ ...subStyle, fontSize: 12 }}>No first email stored yet.</span>}
            </div>
          )}
          {panel === 'meeting' && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input autoFocus value={meeting} onChange={e => setMeeting(e.target.value)} placeholder="e.g. Intro held 10/8; leadership pending" aria-label="Meeting status"
                onKeyDown={async e => { if (e.key === 'Enter' && await update({ meeting_status: meeting.trim() || null })) setPanel(null); if (e.key === 'Escape') setPanel(null); }}
                style={{ ...inputStyle, flex: '1 1 220px' }} />
              <Btn primary style={{ height: 40 }} onClick={async () => { if (await update({ meeting_status: meeting.trim() || null })) setPanel(null); }}>Save</Btn>
            </div>
          )}
          {error && <ErrorNote message={error} />}
        </div>
      )}
    </div>
  );
}

export default function PartnersView({ partners, lookup, members, canEdit, error, onUpdate, onCreate }) {
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', priority: '1' });
  const [addError, setAddError] = useState('');
  const unprioritized = partners.filter(p => p.priority == null);
  const columns = [...COLUMNS, ...(unprioritized.length ? [{ p: null, title: 'Unprioritized', when: 'Not placed yet' }] : [])];
  const colorOf = p => PRIORITY_COLORS[p ?? 'none'];
  const ringParts = columns.map(c => ({ label: c.p ? `${c.title} · ${c.when.toLowerCase()}` : 'Unprioritized', count: partners.filter(x => (x.priority ?? null) === c.p).length, color: colorOf(c.p) }));
  const add = async () => {
    if (!draft.name.trim()) return;
    setAddError('');
    try { await onCreate({ name: draft.name.trim(), priority: draft.priority ? Number(draft.priority) : null }); setDraft({ name: '', priority: '1' }); setAdding(false); }
    catch (e) { setAddError(e.message); }
  };

  return (
    <section style={cardStyle} aria-labelledby="h-part">
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle}>Partner goals</span>
          <h2 style={h2Style} id="h-part">Partnerships to land</h2>
          <span style={subStyle}>P1 = this week · P2 = next 30 days · P3 = 60–90 days. Click a partner for its angle, motto and first email.</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Ring parts={ringParts} center={String(partners.length)} label="Partners by priority" />
          <RingLegend parts={ringParts} />
        </div>
      </div>
      {error && <div style={{ marginTop: 12 }}><ErrorNote message={error.message} /></div>}
      {!error && !partners.length && <p style={{ ...subStyle, margin: '20px 0 0' }}>No partners yet{canEdit ? ' — add your first' : ''}.</p>}
      {partners.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginTop: 20 }}>
          {columns.map(c => {
            const items = partners.filter(x => (x.priority ?? null) === c.p);
            return (
              <div key={c.title} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: colorOf(c.p) }} />
                  <span style={h3Style}>{c.title}</span><span style={{ ...numStyle, ...subStyle }}>{items.length}</span>
                </div>
                <span style={{ ...subStyle, fontSize: 12, marginTop: -6 }}>{c.when}</span>
                {items.map(p => (
                  <PartnerCard key={p.id} partner={p} open={openId === p.id} onToggle={() => setOpenId(openId === p.id ? null : p.id)}
                    canEdit={canEdit} members={members} lookup={lookup} onUpdate={onUpdate} />
                ))}
              </div>
            );
          })}
        </div>
      )}
      {canEdit && (adding
        ? <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input autoFocus placeholder="Partner name (Enter to save)" aria-label="Partner name" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') add(); if (e.key === 'Escape') setAdding(false); }} style={{ ...inputStyle, flex: '1 1 220px' }} />
            <select aria-label="Priority" value={draft.priority} onChange={e => setDraft(d => ({ ...d, priority: e.target.value }))} style={{ ...inputStyle, width: 'auto' }}>
              <option value="1">P1</option><option value="2">P2</option><option value="3">P3</option><option value="">Unprioritized</option>
            </select>
            <Btn primary style={{ height: 40 }} onClick={add} disabled={!draft.name.trim()}>Add</Btn>
            <Btn style={{ height: 40 }} onClick={() => setAdding(false)}>Cancel</Btn>
          </div>
        : <AddButton onClick={() => setAdding(true)}>+ Add partner</AddButton>)}
      {addError && <div style={{ marginTop: 8 }}><ErrorNote message={addError} /></div>}
    </section>
  );
}
