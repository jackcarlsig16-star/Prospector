import React, { useEffect, useState } from 'react';
import Button, { ButtonRow } from '../../ui/Button';
import Field from '../../ui/Field';
import { hkGet } from '../hkApi';
import { RELATIONSHIP_LABELS } from '../brands/verdict';

// hkos-data-foundation-v1 Stage 4 - pick one live brand by name (Sponsors "+ Add sponsor", DNC "+ Add"). Only brands
// that are plain prospects are offered; the caller does the PATCH.
export default function BrandPicker({ businessId, title, line, confirmLabel, withReason, any = false, onClose, onPick }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [picked, setPicked] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => hkGet(businessId, '/brands', { view: 'all', q: q.trim(), owner: 'all' }).then(r => { if (live) setRows(r.brands.filter(b => any || b.relationship === 'prospect').slice(0, 12)); }).catch(e => { if (live) setError(e.message); }), q ? 250 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [businessId, q, any]);
  useEffect(() => { const onKey = e => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey); }, [onClose]);
  const submit = async e => {
    e.preventDefault(); if (!picked) return;
    setBusy(true); setError('');
    try { await onPick(picked, reason.trim()); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <>
      <div className="hk-backdrop" onClick={onClose} aria-hidden="true" />
      <form className="hk-modal" role="dialog" aria-modal="true" aria-labelledby="hk-picker-title" data-hk-picker onSubmit={submit}>
        <h2 id="hk-picker-title" className="hk-modal__title">{title}</h2>
        {line && <p className="hk-meta" style={{ marginTop: -8 }}>{line}</p>}
        <input className="ui-input" type="search" placeholder="Search brands" aria-label="Search brands" value={q} autoFocus onChange={e => setQ(e.target.value)} />
        <div className="hk-picker__list" role="radiogroup" aria-label="Brands">
          {!rows.length && <p className="hk-meta">{any ? 'No brand matches.' : 'No prospect brand matches. Add it under Brands first.'}</p>}
          {rows.map(b => (
            <label key={b.id} className={`hk-picker__item${picked?.id === b.id ? ' hk-picker__item--on' : ''}`}>
              <input type="radio" name="hk-pick" checked={picked?.id === b.id} onChange={() => setPicked(b)} />
              <span className="hk-table__title">{b.name}</span>
              <span className="hk-meta">{b.domain || RELATIONSHIP_LABELS[b.relationship]}</span>
            </label>
          ))}
        </div>
        {withReason && <Field label={withReason} htmlFor="hk-pick-reason"><input id="hk-pick-reason" className="ui-input" value={reason} maxLength={200} onChange={e => setReason(e.target.value)} /></Field>}
        {error && <p className="hk-error" role="alert">{error}</p>}
        <ButtonRow align="between">
          <Button variant="tertiary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy || !picked || (withReason && !reason.trim())}>{confirmLabel}</Button>
        </ButtonRow>
      </form>
    </>
  );
}
