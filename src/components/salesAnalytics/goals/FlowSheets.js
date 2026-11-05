import { useState } from 'react';
import { SA } from '../theme';
import { goalsApi } from './goalsApi';
import { inputStyle, ErrorNote } from './goalsUi';
import { DEPRIORITIZE_REASONS, DEPRIORITIZE_NOTE_MAX, HAND_FIT_LEVELS, FIT_WORD } from '../../../constants/fitLevels';
import { ownerChip } from './flowModel';

// homelover-flow-v1 F4 / F7 / F1 - the inline sheets under the Actions row and the two head-chip menus: Deprioritize…
// (preset reason chips + a note for Other; Activity + Undo 10 s), They replied… (six outcomes -> stage / suggestion;
// Undo puts the stage back), the Fit menu (Strong · Good · Low by hand, clear, Deprioritize…) and the Owner menu
// (each member in their color; Me first; picking the current owner just closes). Every write is one Stage 1 route.
export const OUTCOMES = [['meeting_set', 'Meeting set'], ['interested', 'Interested'], ['question', 'Question'], ['not_now', 'Not now'], ['not_right_person', 'Not the right person'], ['no', 'No']];
const field = { ...inputStyle, height: 32, fontSize: 13, padding: '0 8px' };
const chip = active => ({ height: 28, fontSize: 12.5, borderRadius: 999, ...(active ? { borderColor: SA.bad, color: SA.bad } : {}) });

export function DeprioritizeForm({ businessId, row, expect = null, onDone, onCancel, onToast, onChanged }) {
  const [reason, setReason] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setBusy(true); setError('');
    try {
      const r = await goalsApi.deprioritize(businessId, row.type, row.id, { reason, ...(note.trim() ? { note: note.trim() } : {}), ...(expect ? { expect } : {}) });
      onDone?.();
      onChanged?.();
      onToast({ text: `${row.name}: deprioritized · ${r.fit.word}`, undo: async () => { await goalsApi.undoFlow(businessId, r.event.id); onChanged?.(); } });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <div role="group" aria-label="Deprioritize" data-deprioritize-form style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: 13, color: SA.soft }}>Why deprioritize {row.name}? The stage stays; it leaves the Map's default view and the Due lists.</span>
      <div role="radiogroup" aria-label="Reason" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {DEPRIORITIZE_REASONS.map(([id, word]) => <button key={id} type="button" role="radio" aria-checked={reason === id} className="ui-btn ui-btn--secondary ui-btn--sm" style={chip(reason === id)} disabled={busy} onClick={() => setReason(id)}>{id === 'other' ? 'Other…' : word}</button>)}
      </div>
      {reason && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <input aria-label="Note" autoFocus={reason === 'other'} value={note} maxLength={DEPRIORITIZE_NOTE_MAX} onChange={e => setNote(e.target.value)} placeholder={reason === 'other' ? 'Say why in a few words' : 'Note (optional)'} className="ui-input" style={{ ...field, flex: '1 1 240px', width: 'auto' }} onKeyDown={e => { if (e.key === 'Enter' && (reason !== 'other' || note.trim())) save(); }} />
          <button type="button" className="ui-btn ui-btn--danger" disabled={busy || (reason === 'other' && !note.trim())} onClick={save}>{busy ? 'Saving…' : 'Deprioritize'}</button>
          <button type="button" className="ui-btn ui-btn--tertiary" disabled={busy} onClick={onCancel}>Cancel</button>
        </div>
      )}
      {error && <ErrorNote message={error} />}
    </div>
  );
}

export function TheyRepliedForm({ businessId, row, expect, onDone, onCancel, onToast, onChanged, onPatch }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const pick = async outcome => {
    setBusy(outcome); setError('');
    try {
      const r = await goalsApi.theyReplied(businessId, row.id, { outcome, expect });
      if (r.stage.after !== r.stage.before) onPatch?.({ stage: r.stage.after });
      onDone?.(); onChanged?.();
      const moved = r.stage.after !== r.stage.before ? ` · moved to ${r.stage.after}` : '';
      onToast({ text: `${row.name}: ${OUTCOMES.find(([id]) => id === outcome)[1]}${moved}${r.suggestion ? ` · ${r.suggestion.text}` : ''}`, undo: async () => { await goalsApi.undoFlow(businessId, r.event.id); if (moved) onPatch?.({ stage: r.stage.before }); onChanged?.(); } });
    } catch (e) { setError(e.status === 409 ? 'This changed elsewhere - refresh' : e.message); } finally { setBusy(''); }
  };
  return (
    <div role="group" aria-label="They replied" data-they-replied-form style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: 13, color: SA.soft }}>They replied — what did they say? Meeting set moves to Meeting; the rest to Responded (never back).</span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {OUTCOMES.map(([id, word]) => <button key={id} type="button" className="ui-btn ui-btn--secondary ui-btn--sm" style={{ height: 30, fontSize: 13 }} disabled={!!busy} onClick={() => pick(id)}>{busy === id ? 'Saving…' : word}</button>)}
        <button type="button" className="ui-btn ui-btn--tertiary ui-btn--sm" disabled={!!busy} onClick={onCancel}>Cancel</button>
      </div>
      {error && <ErrorNote message={error} />}
    </div>
  );
}

const menu = { position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 20, minWidth: 200, padding: 4, display: 'flex', flexDirection: 'column', gap: 2, background: SA.surface2, border: `1px solid ${SA.border}`, borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.35)' };
const item = 'ui-btn ui-btn--tertiary ui-btn--sm';

// The Fit chip's menu: a hand-set level wins until cleared; Deprioritize… opens the reason sheet.
export function FitMenu({ fit, busy, onSet, onDeprioritize, onBringBack, onClose }) {
  const level = fit?.hand_level || null;
  const dep = fit?.level === 'deprioritized';
  return (
    <div role="menu" aria-label="Fit" data-fit-menu style={menu}>
      {!dep && HAND_FIT_LEVELS.map(l => <button key={l} type="button" role="menuitemradio" aria-checked={level === l} className={item} style={{ justifyContent: 'flex-start' }} disabled={busy} onClick={() => onSet(level === l ? null : l)}>{FIT_WORD[l]}{level === l ? ' · set by hand' : ''}</button>)}
      {!dep && level && <button type="button" role="menuitem" className={item} style={{ justifyContent: 'flex-start', color: SA.muted }} disabled={busy} onClick={() => onSet(null)}>Clear (score decides)</button>}
      {!dep && <button type="button" role="menuitem" className={item} style={{ justifyContent: 'flex-start', color: SA.bad }} disabled={busy} onClick={onDeprioritize}>Deprioritize…</button>}
      {dep && <button type="button" role="menuitem" className={item} style={{ justifyContent: 'flex-start' }} disabled={busy} onClick={onBringBack}>Bring back</button>}
      <button type="button" role="menuitem" className={item} style={{ justifyContent: 'flex-start', color: SA.muted }} onClick={onClose}>Close</button>
    </div>
  );
}

// The Owner chip's menu: Me first, then each member in their color, then Unassigned. The current owner is marked and
// picking it just closes (no "already assigned" error).
export function OwnerMenu({ row, members, meId, busy, onPick, onClose }) {
  const list = members.filter(m => m.role !== 'viewer');
  const ordered = [...list.filter(m => m.user_id === meId), ...list.filter(m => m.user_id !== meId)];
  const current = row.owner_user_id || null;
  return (
    <div role="menu" aria-label="Owner" data-owner-menu style={menu}>
      {ordered.map(m => {
        const c = ownerChip({ ownerUserId: m.user_id, members, meId });
        return <button key={m.user_id} type="button" role="menuitemradio" aria-checked={current === m.user_id} className={item} style={{ justifyContent: 'flex-start', gap: 8 }} disabled={busy} onClick={() => (current === m.user_id ? onClose() : onPick(m.user_id))}><span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: c.color }} />{m.user_id === meId ? `Me (${(m.name || '').split(' ')[0]})` : (m.name || '').split(' ')[0]}{current === m.user_id ? ' · now' : ''}</button>;
      })}
      <button type="button" role="menuitemradio" aria-checked={!current} className={item} style={{ justifyContent: 'flex-start', color: SA.muted }} disabled={busy} onClick={() => (!current ? onClose() : onPick(null))}>Unassigned</button>
    </div>
  );
}
