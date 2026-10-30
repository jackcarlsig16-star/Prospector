import React, { useEffect, useState } from 'react';
import Button from '../../ui/Button';
import Buckets from './Buckets';

// grow-nav-filters-v1 N12 - the phone's Filters: a full-height sheet with the same buckets as the rail, a search over
// their values on top, and "Show n results" to close it.
export default function FiltersSheet({ buckets, collapsed, onCollapse, onPick, resultLabel, onClose }) {
  const [q, setQ] = useState('');
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const t = q.trim().toLowerCase();
  const shown = t ? buckets.map(b => ({ ...b, items: b.items.filter(it => `${b.label} ${it.label}`.toLowerCase().includes(t)) })).filter(b => b.items.length) : buckets;
  return (
    <>
      <div className="hk-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="hk-sheet hk-sheet--full" role="dialog" aria-modal="true" aria-label="Filters" data-hk-filters-sheet>
        <div className="hk-sheet__head">
          <input className="ui-input" type="search" aria-label="Search filters" placeholder="Search filters" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div className="hk-sheet__body">
          <Buckets buckets={shown} collapsed={t ? new Set() : collapsed} onCollapse={onCollapse} onPick={onPick} />
          {!shown.length && <p className="hk-meta">No filter matches.</p>}
        </div>
        <div className="hk-sheet__foot"><Button variant="primary" onClick={onClose} data-hk-show-results>{resultLabel}</Button></div>
      </div>
    </>
  );
}
