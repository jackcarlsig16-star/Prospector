import React, { useState } from 'react';
import Button from '../../ui/Button';

// grow-nav-filters-v1 N10 + N7 - above every list: one removable chip per active filter (Grow's .hk-chip + .hk-chip__x),
// Clear all, Save view (a name, <= 40 characters, stored in your own preferences) and the result count.
//   chips: [{ key, label, onRemove }]
export const VIEW_NAME_MAX = 40;

export default function ActiveFilters({ chips, count, onClear, onSave, savedAs = null }) {
  const [naming, setNaming] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async e => {
    e.preventDefault();
    const name = naming.trim();
    if (!name) return;
    setBusy(true); setError('');
    try { await onSave(name); setNaming(null); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="hk-active" data-hk-active-filters>
      <span className="hk-active__count" role="status" data-hk-result-count>{count}</span>
      {savedAs && <span className="hk-meta">View: {savedAs}</span>}
      <ul className="hk-active__chips" aria-label="Active filters">
        {chips.map(c => (
          <li key={c.key}><span className="hk-chip hk-chip--grey" data-hk-active-chip={c.key}>{c.label}<button type="button" className="hk-btn hk-chip__x" aria-label={`Remove ${c.label}`} onClick={c.onRemove}>×</button></span></li>
        ))}
      </ul>
      {chips.length > 0 && <button type="button" className="hk-btn hk-link" onClick={onClear} data-hk-clear-filters>Clear all</button>}
      {onSave && chips.length > 0 && !savedAs && (naming === null
        ? <button type="button" className="hk-btn hk-link" onClick={() => setNaming('')} data-hk-save-view>Save view</button>
        : (
          <form className="hk-active__save" onSubmit={save}>
            <input className="ui-input ui-input--sm" aria-label="View name" maxLength={VIEW_NAME_MAX} autoFocus value={naming} onChange={e => setNaming(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setNaming(null); }} data-hk-view-name />
            <Button size="sm" variant="primary" type="submit" disabled={busy || !naming.trim()} data-hk-save-view-confirm>Save</Button>
            <Button size="sm" variant="tertiary" onClick={() => setNaming(null)}>Cancel</Button>
          </form>
        ))}
      {error && <p className="hk-error" role="alert">{error}</p>}
    </div>
  );
}
