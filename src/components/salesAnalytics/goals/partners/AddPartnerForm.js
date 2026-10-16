import { useState, useEffect, useRef, useCallback } from 'react';
import { SA, saSans } from '../../theme';
import { inputStyle, Btn, ErrorNote } from '../goalsUi';

// partner-add-research-v1 Stage 1 - the Add partner form asks the dupe-check
// route as the name is typed (debounced) and again on submit. An exact hit
// anywhere (partner incl. archived, pipeline, target incl. not-a-fit, Apollo)
// turns the button into "Add anyway"; a partial hit is a warning line only.
// A failed check never blocks the save.
const DEBOUNCE_MS = 350;
const DUPE_LABEL = { partner: 'partner', opportunity: 'pipeline', target: 'target', account: 'Apollo' };
const detail = r => (r.archived ? ' · archived' : r.type === 'target' && r.status === 'rejected' ? ' · not a fit' : '');
export const dupeLabel = r => `${r.name} (${DUPE_LABEL[r.type]}${detail(r)})`;

const linkBtn = { ...saSans, border: 'none', background: 'transparent', color: SA.link, cursor: 'pointer', padding: 0, fontSize: 13 };

export default function AddPartnerForm({ onCreate, onDupeCheck, onOpenPartner, onDone, onCancel }) {
  const [draft, setDraft] = useState({ name: '', priority: '1' });
  const [error, setError] = useState('');
  const [dupes, setDupes] = useState(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const check = useCallback(async name => {
    const mine = ++seq.current;
    try {
      const r = await onDupeCheck({ name });
      if (mine === seq.current) setDupes({ name, ...r });
      return r;
    } catch { if (mine === seq.current) setDupes(null); return null; }
  }, [onDupeCheck]);

  useEffect(() => {
    const name = draft.name.trim();
    if (name.length < 2) { setDupes(null); return undefined; }
    const t = setTimeout(() => check(name), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [draft.name, check]);

  const name = draft.name.trim();
  const current = dupes && dupes.name === name ? dupes : null;
  const blocked = !!(current && current.exact.length);

  const add = async () => {
    if (!name || busy) return;
    setError('');
    setBusy(true);
    try {
      if (!blocked) {
        const r = current || await check(name);
        if (r && r.exact.length) return;
      }
      await onCreate({ name, priority: draft.priority ? Number(draft.priority) : null });
      onDone();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input autoFocus placeholder="Partner name (Enter to save)" aria-label="Partner name" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
          onKeyDown={e => { if (e.key === 'Enter') add(); if (e.key === 'Escape') onCancel(); }} style={{ ...inputStyle, flex: '1 1 220px' }} />
        <select aria-label="Priority" value={draft.priority} onChange={e => setDraft(d => ({ ...d, priority: e.target.value }))} style={{ ...inputStyle, width: 'auto' }}>
          <option value="1">P1</option><option value="2">P2</option><option value="3">P3</option><option value="">Unprioritized</option>
        </select>
        <Btn primary style={{ height: 40 }} onClick={add} disabled={!name || busy}>{blocked ? 'Add anyway' : 'Add'}</Btn>
        <Btn style={{ height: 40 }} onClick={onCancel}>Cancel</Btn>
      </div>
      {blocked && (
        <div role="status" style={{ ...saSans, fontSize: 13, color: SA.bad, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <span>Already in Prospector:</span>
          {current.exact.map(r => (
            <span key={`${r.type}:${r.id}`}>
              {dupeLabel(r)}
              {r.type === 'partner' && !r.archived && onOpenPartner && <> <button type="button" onClick={() => onOpenPartner(r.id)} style={linkBtn}>Open</button></>}
            </span>
          ))}
        </div>
      )}
      {current && !blocked && current.partial.length > 0 && (
        <div role="status" style={{ ...saSans, fontSize: 13, color: SA.warn }}>Similar: {current.partial.map(dupeLabel).join(' · ')}</div>
      )}
      {error && <ErrorNote message={error} />}
    </div>
  );
}
