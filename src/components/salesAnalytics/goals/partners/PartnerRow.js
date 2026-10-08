import { useState, useEffect, useRef } from 'react';
import { SA, saSans } from '../../theme';
import { WORKFLOW_STEPS, STALE_DAYS, stepOf, daysSinceTouch, isTouched, nextStepFor } from '../../../../constants/partnerPipeline';
import { subStyle, numStyle, inputStyle, Chip, Btn } from '../goalsUi';
import { familyOf, categoryName } from './partnerTypes';
import { tierLabel } from './PartnerCard';

// sales-partners-workflow-v1 - one partner as a workflow row: type marker,
// who / priority / tier, an 8-step stage bar filled in the type color, and
// (Member+) Next, the More menu and up/down. Viewers get the row only.
export function StageBar({ status, color, compact }) {
  const step = stepOf(status);
  const paused = step === null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <div role="img" aria-label={paused ? 'Paused' : `Step ${step + 1} of 8: ${WORKFLOW_STEPS[step].label}`}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(8, minmax(0, 1fr))', gap: 3 }}>
        {WORKFLOW_STEPS.map((s, i) => (
          <span key={s.id} style={{ height: 8, borderRadius: 3, background: !paused && i <= step ? color : SA.track, opacity: paused ? 0.5 : 1, transition: 'background 350ms ease, box-shadow 350ms ease',
            boxShadow: !paused && i === step ? `0 0 0 1px ${SA.text}` : undefined }} />
        ))}
      </div>
      {compact
        ? <span style={{ fontSize: 11, color: SA.soft }}>{paused ? 'Paused' : WORKFLOW_STEPS[step].label}</span>
        : (
          // Only the current step is labeled (the key lists all 8), anchored
          // under its segment and allowed to run past it so it never clips.
          <div aria-hidden="true" style={{ display: 'grid', gridTemplateColumns: 'repeat(8, minmax(0, 1fr))', gap: 3, height: 14 }}>
            {paused
              ? <span style={{ gridColumn: '1 / -1', fontSize: 11, color: SA.muted }}>Paused</span>
              : <span style={{ gridColumn: step + 1, justifySelf: step < 4 ? 'start' : 'end', fontSize: 11, fontWeight: 600, color: SA.text, whiteSpace: 'nowrap' }}>
                  {step + 1} · {WORKFLOW_STEPS[step].label}
                </span>}
          </div>
        )}
    </div>
  );
}

// Days since the last touch. A partner can be past Sent with no touch date
// (imported from the sheet that way) - that's "—", not "No touch".
function touchLabel(partner, days) {
  if (days !== null) return { text: days === 0 ? 'Today' : `${days}d`, title: `Last touch ${new Date(partner.last_touch_at).toLocaleDateString()}` };
  return isTouched(partner) ? { text: '—', title: 'Contacted, but no touch date recorded' } : { text: 'No touch', title: 'No touch yet' };
}

const menuItem = { all: 'unset', boxSizing: 'border-box', ...saSans, display: 'block', width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 14, color: SA.text, cursor: 'pointer' };
const smallBtn = { all: 'unset', ...saSans, width: 32, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, color: SA.muted, cursor: 'pointer', fontSize: 11 };

// Everything that isn't the one-step Next move, in words.
export function MoreMenu({ partner, members, onSignal }) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState('root');
  const [note, setNote] = useState('');
  const box = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = e => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  // Escape closes the menu only - not the row's drop-down around it.
  const onKeyDown = e => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); } };
  const go = signal => { setOpen(false); onSignal(signal); };
  const status = partner.pipeline_status || 'not_started';
  const current = stepOf(status);
  return (
    <div ref={box} onKeyDown={onKeyDown} style={{ position: 'relative' }}>
      <Btn style={{ height: 36, padding: '0 10px', whiteSpace: 'nowrap' }} aria-haspopup="menu" aria-expanded={open} aria-label={`More actions for ${partner.name}`}
        onClick={() => { setOpen(o => !o); setPanel('root'); }}>⋯ More</Btn>
      {open && (
        <div role="menu" aria-label={`Actions for ${partner.name}`}
          style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 40, width: 240, maxWidth: 'calc(100vw - 32px)', maxHeight: 360, overflowY: 'auto', background: SA.surface2, border: `1px solid ${SA.borderStrong}`, borderRadius: 12, padding: 6, boxShadow: '0 10px 30px #0008' }}>
          {panel === 'root' && <>
            <button role="menuitem" type="button" style={menuItem} onClick={() => setPanel('stage')}>Jump to stage… ›</button>
            <button role="menuitem" type="button" style={menuItem} onClick={() => setPanel('assign')}>Assign… ›</button>
            <button role="menuitem" type="button" style={menuItem} onClick={() => go({ type: 'hot', hot: !partner.hot })}>{partner.hot ? 'Hot off' : '🔥 Hot on'}</button>
            <button role="menuitem" type="button" style={menuItem} onClick={() => go({ type: 'snooze', days: 7 })}>Snooze 7 days</button>
            {status !== 'paused' && <button role="menuitem" type="button" style={menuItem} onClick={() => go({ type: 'deprioritize', expect: status })}>Deprioritize (pause)</button>}
            <button role="menuitem" type="button" style={menuItem} onClick={() => setPanel('note')}>Add note… ›</button>
          </>}
          {panel === 'stage' && <>
            <button type="button" style={{ ...menuItem, color: SA.muted }} onClick={() => setPanel('root')}>‹ Back</button>
            {WORKFLOW_STEPS.map((st, i) => (
              <button key={st.id} role="menuitemradio" aria-checked={i === current} type="button" disabled={i === current}
                style={{ ...menuItem, color: i === current ? SA.muted : SA.text, cursor: i === current ? 'default' : 'pointer' }}
                onClick={() => go({ type: 'status', to: st.id, expect: status })}>
                <span style={{ ...numStyle, color: SA.muted, marginRight: 8 }}>{i + 1}</span>{st.label}{i === current ? ' · now' : ''}
              </button>
            ))}
          </>}
          {panel === 'assign' && <>
            <button type="button" style={{ ...menuItem, color: SA.muted }} onClick={() => setPanel('root')}>‹ Back</button>
            {[{ user_id: null, name: 'Unassigned' }, ...members].map(m => (
              <button key={m.user_id || 'none'} role="menuitemradio" aria-checked={(partner.owner_user_id || null) === m.user_id} type="button"
                disabled={(partner.owner_user_id || null) === m.user_id} style={menuItem}
                onClick={() => go({ type: 'assign', owner_user_id: m.user_id })}>
                {m.name}{m.role === 'viewer' ? ' (viewer)' : ''}{(partner.owner_user_id || null) === m.user_id ? ' · now' : ''}
              </button>
            ))}
          </>}
          {panel === 'note' && (
            <form style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 6 }} onSubmit={e => { e.preventDefault(); if (note.trim()) { go({ type: 'note', note }); setNote(''); } }}>
              <input autoFocus value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Called, left voicemail" aria-label={`Note on ${partner.name}`} style={inputStyle} />
              <div style={{ display: 'flex', gap: 6 }}>
                <Btn primary type="submit" style={{ height: 36 }} disabled={!note.trim()}>Save note</Btn>
                <Btn style={{ height: 36 }} onClick={() => setPanel('root')}>Back</Btn>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

// actions (Member+ only): { onNext, onSignal, members, rank: { onUp, onDown, canUp, canDown, drag } }
// expanded/onToggle/details: the drop-down. While it's open the row's Next
// and More move down into its Status section (partner-360-v1).
export default function PartnerRow({ partner, lookup, compact, showCategory, movedNote, actions, expanded, onToggle, details }) {
  const fam = familyOf(partner.category);
  const owner = partner.owner_user_id ? lookup(partner.owner_user_id) : null;
  const days = daysSinceTouch(partner);
  const status = partner.pipeline_status || 'not_started';
  const paused = status === 'paused';
  const touch = touchLabel(partner, days);
  const touchColor = days !== null && days >= STALE_DAYS ? SA.bad : SA.muted;
  const [busy, setBusy] = useState(false);
  const next = paused ? { label: 'Resume' } : nextStepFor(status);
  const rank = actions?.rank;
  const drag = rank?.drag;
  const onNext = async () => { setBusy(true); try { await actions.onNext(partner); } finally { setBusy(false); } };
  return (
    <div data-partner-id={partner.id} draggable={!!drag && !expanded} onDragStart={drag?.onStart} onDragOver={drag?.onOver} onDrop={drag?.onDrop} onDragEnd={drag?.onEnd}
      onKeyDown={e => { if (e.key === 'Escape' && expanded) onToggle(); }}
      style={{ display: 'flex', alignItems: 'stretch', background: SA.inset, border: `1px solid ${drag?.target ? SA.accent : SA.border}`, borderRadius: 10, opacity: drag?.dragging ? 0.5 : 1 }}>
      <span aria-hidden="true" title={fam.label} style={{ width: 4, flex: 'none', background: fam.color, borderRadius: '10px 0 0 10px' }} />
      {rank && (
        <div role="group" aria-label={`Order of ${partner.name}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, padding: '0 2px' }}>
          <button type="button" style={{ ...smallBtn, opacity: rank.canUp ? 1 : 0.3 }} disabled={!rank.canUp} aria-label={`Move ${partner.name} up`} onClick={rank.onUp}>▲</button>
          {drag && <span aria-hidden="true" title="Drag to reorder" style={{ ...smallBtn, height: 18, cursor: 'grab', fontSize: 13 }}>⠿</span>}
          <button type="button" style={{ ...smallBtn, opacity: rank.canDown ? 1 : 0.3 }} disabled={!rank.canDown} aria-label={`Move ${partner.name} down`} onClick={rank.onDown}>▼</button>
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : `minmax(150px, 1fr) minmax(170px, 1.3fr) ${actions ? 'auto' : '56px'}`, gap: compact ? 8 : 16, alignItems: 'center', padding: rank ? '10px 12px 10px 4px' : '10px 12px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <button type="button" aria-expanded={!!expanded} onClick={onToggle} title={expanded ? 'Hide details' : 'Show research, intel and history'}
            style={{ all: 'unset', ...saSans, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, borderRadius: 6 }}>
            <span aria-hidden="true" style={{ color: SA.muted, fontSize: 11, width: 10 }}>{expanded ? '▾' : '▸'}</span>
            {fam.mark && <span aria-label={fam.label} title={fam.label} style={{ color: fam.color }}>{fam.mark}</span>}
            {owner && <span title={owner.first} aria-label={`Owner ${owner.first}`} style={{ width: 8, height: 8, borderRadius: 999, background: owner.color, flex: 'none' }} />}
            <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{partner.name}</span>
            {partner.hot && <span aria-label="Hot" title="Hot">🔥</span>}
          </button>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {partner.priority && <Chip style={{ height: 20, color: partner.priority === 1 ? SA.text : SA.soft, borderColor: partner.priority === 1 ? SA.accent : SA.border }}>P{partner.priority}</Chip>}
            {partner.tier && <Chip style={{ height: 20 }}>{tierLabel(partner.tier)}</Chip>}
            {partner.people_count > 0 && <Chip style={{ height: 20 }} title="People we know here" aria-label={`${partner.people_count} people known`}>👤 {partner.people_count}</Chip>}
            {paused && <Chip style={{ height: 20 }}>Paused</Chip>}
            {showCategory && <span style={{ ...subStyle, fontSize: 12 }}>{categoryName(partner.category)}</span>}
            {compact && <span title={touch.title} style={{ ...numStyle, fontSize: 12, color: touchColor }}>{touch.text}</span>}
          </div>
          {movedNote && <span role="status" style={{ fontSize: 12, color: SA.link }}>{movedNote}</span>}
        </div>
        <StageBar status={partner.pipeline_status} color={fam.color} compact={compact} />
        {!actions && !compact && <span title={touch.title} style={{ ...numStyle, fontSize: 12, textAlign: 'right', color: touchColor }}>{touch.text}</span>}
        {actions && expanded && !compact && <span title={touch.title} style={{ ...numStyle, fontSize: 12, color: touchColor, textAlign: 'right', whiteSpace: 'nowrap' }}>{touch.text}</span>}
        {actions && !expanded && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: compact ? 'flex-start' : 'flex-end', flexWrap: compact ? 'wrap' : 'nowrap' }}>
            {!compact && <span title={touch.title} style={{ ...numStyle, fontSize: 12, color: touchColor, minWidth: 44, textAlign: 'right', whiteSpace: 'nowrap' }}>{touch.text}</span>}
            {next
              ? <Btn primary style={{ height: 36, padding: '0 12px', fontSize: 13, whiteSpace: 'nowrap' }} disabled={busy} onClick={onNext}>{busy ? 'Saving…' : paused ? 'Resume' : `Next: ${next.label}`}</Btn>
              : <span style={{ fontSize: 13, color: SA.good, padding: '0 6px' }}>✓ Live</span>}
            <MoreMenu partner={partner} members={actions.members} onSignal={actions.onSignal} />
          </div>
        )}
      </div>
      {expanded && details}
      </div>
    </div>
  );
}
