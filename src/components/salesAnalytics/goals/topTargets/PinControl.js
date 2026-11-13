import { useState, useEffect, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import { SA_THEME_CLASS } from '../../theme';
import { starState, starLabel, REASON_MAX } from './topTargetsModel';

// The star, three states (S4, S6): filled = pinned -> a menu (Edit reason · Renew · Unpin); hollow accent = the pin
// ran out -> Renew · Unpin; hollow faint = not pinned -> the reason form. A Viewer gets the glyph alone. On a phone
// the menu and the form are a bottom sheet; on a desktop they are portalled and fixed under the star, so no table
// cell clips them. onAct(action, reason) does the write; a rejected write stays open.
const PATH = 'M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z';
export const Star = ({ state, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false" style={{ color: state === 'none' ? 'var(--sa-faint)' : 'var(--sa-accent)' }}
    {...(state === 'pinned' ? { fill: 'currentColor', stroke: 'none' } : { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' })}><path d={PATH} /></svg>
);

function ReasonForm({ row, edit, phone, busy, error, onSubmit, onCancel }) {
  const [text, setText] = useState(edit ? row.pin?.reason || '' : '');
  const id = useId();
  const value = text.trim();
  return (
    <form onSubmit={e => { e.preventDefault(); if (value) onSubmit(value); }} style={{ display: 'flex', flexDirection: 'column', gap: phone ? 10 : 8 }}>
      <h4 style={phone ? { fontSize: 15 } : undefined}>{edit ? `Edit reason · ${row.name}` : `Pin ${row.name}`}</h4>
      <label className="tt-lbl" htmlFor={id}>Why — shown on the {phone ? 'card' : 'row'}</label>
      <textarea id={id} autoFocus className="tt-ta" maxLength={REASON_MAX} placeholder="One line the team will read" value={text} onChange={e => setText(e.target.value)} style={phone ? { height: 84, fontSize: 16 } : undefined} />
      {error && <span role="alert" style={{ color: 'var(--sa-bad)', fontSize: 12 }}>{error}</span>}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span className="tt-num" style={{ color: 'var(--sa-muted)', fontSize: 12 }}>{text.length} / {REASON_MAX} · pins last 30 days</span>
        <span style={{ display: 'flex', gap: phone ? 8 : 6 }}>
          <button type="button" className="tt-btn" style={phone ? { height: 44, padding: '0 16px' } : undefined} onClick={onCancel}>Cancel</button>
          <button type="submit" className="tt-btn tt-btn--pri" style={phone ? { height: 44, padding: '0 20px' } : undefined} disabled={!value || busy}>{busy ? 'Saving…' : edit ? 'Save' : 'Pin'}</button>
        </span>
      </div>
    </form>
  );
}

export default function PinControl({ row, canEdit, phone = false, onAct }) {
  const [mode, setMode] = useState(null); // null | 'menu' | 'form' | 'edit'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [at, setAt] = useState(null);
  const root = useRef(null);
  const state = starState(row);
  useEffect(() => {
    if (!mode) return undefined;
    const out = e => { if (!root.current?.contains(e.target) && !e.target.closest?.('[data-pin-sheet], [data-pin-pop]')) setMode(null); };
    const scrolled = e => { if (!e.target.closest?.('[data-pin-pop]')) setMode(null); };
    if (!phone) window.addEventListener('scroll', scrolled, true);
    const esc = e => { if (e.key === 'Escape') setMode(null); };
    document.addEventListener('pointerdown', out); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', out); document.removeEventListener('keydown', esc); window.removeEventListener('scroll', scrolled, true); };
  }, [mode, phone]);
  if (!canEdit) return state === 'none' ? <span className="tt-star" data-star="none"><Star state="none" size={phone ? 20 : 16} /></span>
    : <span className="tt-star" data-star={state} role="img" aria-label={state === 'pinned' ? 'Pinned' : 'Pin expired'}><Star state={state} size={phone ? 20 : 16} /></span>;

  const run = async (action, reason) => {
    setBusy(true); setError('');
    try { await onAct(action, reason); setMode(null); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const menu = (
    <div role="menu" aria-label={`Pin · ${row.name}`} style={{ display: 'flex', flexDirection: 'column' }}>
      {state === 'pinned' && <button type="button" role="menuitem" className="tt-mi" disabled={busy} onClick={() => { setError(''); setMode('edit'); }}>Edit reason</button>}
      <button type="button" role="menuitem" className="tt-mi" disabled={busy} onClick={() => run('renew')}>Renew <span>30 more days</span></button>
      <button type="button" role="menuitem" className="tt-mi tt-mi--bad" disabled={busy} onClick={() => run('unpin')}>Unpin</button>
      {error && <span role="alert" style={{ color: 'var(--sa-bad)', fontSize: 12, padding: '4px 10px' }}>{error}</span>}
    </div>
  );
  const form = <ReasonForm row={row} edit={mode === 'edit'} phone={phone} busy={busy} error={error} onSubmit={r => run(mode === 'edit' ? 'reason' : 'pin', r)} onCancel={() => setMode(null)} />;
  const body = mode === 'menu' ? menu : form;
  return (
    <span ref={root} style={{ position: 'relative', display: 'inline-flex' }}>
      <button type="button" className="tt-star tt-star--btn" data-star={state} aria-label={starLabel(row)} aria-haspopup={state === 'none' ? 'dialog' : 'menu'} aria-expanded={!!mode}
        style={phone ? { width: 44, height: 44 } : undefined} onClick={e => { const b = e.currentTarget.getBoundingClientRect(); setAt({ top: b.bottom + 6, right: Math.max(8, window.innerWidth - b.right) }); setError(''); setMode(m => (m ? null : state === 'none' ? 'form' : 'menu')); }}><Star state={state} size={phone ? 20 : 16} /></button>
      {mode && !phone && createPortal(
        <div className={`${SA_THEME_CLASS} ${mode === 'menu' ? 'tt-pop tt-pop--menu' : 'tt-pop'}`} data-pin-pop={mode} style={{ position: 'fixed', top: at?.top ?? 0, right: at?.right ?? 8, zIndex: 4003, width: mode === 'menu' ? 230 : 320 }}>{body}</div>, document.body)}
      {mode && phone && createPortal(
        <div className={SA_THEME_CLASS} data-pin-sheet={mode} style={{ position: 'fixed', inset: 0, zIndex: 4003, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: 'rgba(11,13,16,.6)' }}
          onPointerDown={e => { if (e.target === e.currentTarget) setMode(null); }}>
          <div className="tt-sheet"><div className="tt-grip" aria-hidden="true" />{body}</div>
        </div>, document.body)}
    </span>
  );
}
