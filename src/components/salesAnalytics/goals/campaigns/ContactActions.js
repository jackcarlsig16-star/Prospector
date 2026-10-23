import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { SA, SA_THEME_ROOT_ID } from '../../theme';
import Button from '../../../../ui/Button';
import Segmented from '../../../../ui/Segmented';
import FilterSelect from '../../../../ui/FilterSelect';
import { contactMoves, MARK_OPTIONS, PROMOTE_OPTIONS, defaultPromoteTo } from './campaignModel';

// seif-campaign-v1 B4/B5 - one contact's buttons, in an Actions row and in the
// campaign's contacts table. contact: { id, name, company, segment, status,
// current_step, track_id }. onAct(action, body) does the write (the parent
// owns the toast and Undo); onCopy copies the step's email. Members only.
const rowSelect = { height: 24, fontSize: 12, borderRadius: 6, padding: '0 4px' };

export function PromoteDialog({ contact, members, lookup, onPromote, onClose }) {
  const [to, setTo] = useState(defaultPromoteTo(contact.segment));
  const [owner, setOwner] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const esc = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const go = async () => { setBusy(true); try { await onPromote({ to, ...(owner ? { owner_user_id: owner } : {}) }); } finally { setBusy(false); } };
  return createPortal(
    <div className="no-print" style={{ position: 'fixed', inset: 0, zIndex: 4006, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} />
      <div role="dialog" aria-modal="true" aria-label={`Promote ${contact.company || contact.name}`} className="ui-theme-dark"
        style={{ position: 'relative', width: 'min(440px, 100%)', background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: SA.text }}>Promote {contact.company || 'the company'} to Pipeline</h2>
        <p style={{ margin: 0, fontSize: 13, color: SA.soft }}>From {contact.name}. A company already in Pipeline is linked, not added twice, and keeps its owner.</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="ui-group-label" aria-hidden="true">As</span>
          <Segmented label="Promote as" items={PROMOTE_OPTIONS.map(([id, label]) => ({ id, label }))} value={to} onChange={setTo} />
        </div>
        <FilterSelect label="Hand to" value={owner} onChange={setOwner}
          options={[{ value: '', label: 'No owner yet' }, ...members.map(m => ({ value: m.user_id, label: lookup(m.user_id).first }))]} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="tertiary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={go}>{busy ? 'Promoting…' : 'Promote'}</Button>
        </div>
      </div>
    </div>, document.getElementById(SA_THEME_ROOT_ID) || document.body);
}

// actions-v2 REV2 A3 - the same buttons as Actions slots: a send = Copy email · Sent · More (Stop, Skip, …);
// a reply = Respond (onRespond, the company window) · — · More (Promote…, Stop, statuses). onPromote opens the dialog.
export function contactSlots({ contact, onAct, onCopy, onRespond, onPromote }) {
  const can = contactMoves(contact);
  const step = contact.current_step;
  const reply = contact.status === 'replied';
  const more = [
    !reply && can.stop && { id: 'stop', label: 'Stop (no more steps)', run: () => onAct('stop') },
    can.skip && { id: 'skip', label: `Skip step ${step}`, run: () => onAct('skip', { step_no: step }) },
    can.replied && { id: 'replied', label: 'They replied', run: () => onAct('replied') },
    reply && can.promote && { id: 'promote', label: 'Promote…', run: onPromote },
    reply && can.stop && { id: 'stop', label: 'Stop', run: () => onAct('stop') },
    can.pause && { id: 'pause', label: 'Take off the schedule', run: () => onAct('pause') },
    can.resume && { id: 'resume', label: 'Put back on the schedule', run: () => onAct('resume') },
    ...(can.mark ? MARK_OPTIONS.filter(([st]) => st !== contact.status).map(([st, label]) => ({ id: `status:${st}`, label, run: () => onAct('status', { status: st }) })) : []),
  ].filter(Boolean);
  if (reply) return { primary: { label: 'Respond', title: 'Open the company window to answer', run: onRespond }, second: null, more };
  return {
    primary: can.send ? { label: 'Copy email', title: `Copy step ${step}'s subject and body to paste into your mailbox`, run: onCopy } : null,
    second: can.send ? { label: 'Sent', title: `Step ${step} went out from your mailbox`, run: () => onAct('sent', { step_no: step }) } : null,
    more,
  };
}

export default function ContactActions({ contact, members, lookup, onAct, onCopy }) {
  const [promoting, setPromoting] = useState(false);
  const can = contactMoves(contact);
  const step = contact.current_step;
  const more = [
    can.skip && ['skip', `Skip step ${step}`],
    can.replied && ['replied', 'They replied'],
    can.pause && ['pause', 'Take off the schedule'],
    can.resume && ['resume', 'Put back on the schedule'],
    ...(can.mark ? MARK_OPTIONS.filter(([s]) => s !== contact.status).map(([s, label]) => [`status:${s}`, label]) : []),
  ].filter(Boolean);
  const pickMore = v => {
    if (!v) return;
    if (v.startsWith('status:')) onAct('status', { status: v.slice(7) });
    else onAct(v, v === 'skip' ? { step_no: step } : {});
  };
  return (
    <>
      {can.send && <Button size="sm" title={`Copy step ${step}'s subject and body to paste into your mailbox`} onClick={onCopy}>Copy email</Button>}
      {/* D3 (undecided): a Members-only "Copy address" button goes here, right after Copy email. */}
      {can.send && <Button size="sm" title={`Step ${step} went out from your mailbox`} onClick={() => onAct('sent', { step_no: step })}>Sent</Button>}
      {can.promote && <Button size="sm" title="Add the company to Pipeline from this reply" onClick={() => setPromoting(true)}>Promote…</Button>}
      {can.stop && <Button size="sm" title="No more steps for this person" onClick={() => onAct('stop')}>Stop</Button>}
      {more.length > 0 && (
        <select className="ui-filter__select" aria-label={`More for ${contact.name}`} value="" title="More" onChange={e => pickMore(e.target.value)} style={{ ...rowSelect, width: 74 }}>
          <option value="">More…</option>
          {more.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      )}
      {promoting && <PromoteDialog contact={contact} members={members} lookup={lookup} onClose={() => setPromoting(false)}
        onPromote={async body => { await onAct('promote', body); setPromoting(false); }} />}
    </>
  );
}
