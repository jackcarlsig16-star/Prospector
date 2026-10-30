import React from 'react';
import { Icon } from '../HkMarks';

// grow-nav-filters-v1 N2 - a bucket = a header (icon · name · chevron, collapsible) and its items (dot · label · count).
// Shared by the desktop rail and the phone Filters sheet. Keyboard: ↑ / ↓ move through headers and items, Space or
// Enter toggles (native buttons), ← collapses a bucket (from an item: back to its header), → expands it.
//   buckets: [{ key, label, icon, items: [{ id, label, count?, active, tone?, extra?, edit? }] }] - edit replaces the row
export default function Buckets({ buckets, collapsed, onCollapse, onPick, label = 'Filters' }) {
  const onKeyDown = e => {
    const root = e.currentTarget, el = document.activeElement;
    if (!el?.dataset?.railItem) return;
    const all = [...root.querySelectorAll('[data-rail-item]')];
    const i = all.indexOf(el);
    const head = el.dataset.bucketHead || el.closest('[data-hk-bucket]')?.dataset.hkBucket;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); all[Math.max(0, Math.min(all.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus(); }
    else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (el.dataset.bucketHead) onCollapse(head, true);
      else root.querySelector(`[data-bucket-head="${head}"]`)?.focus();
    } else if (e.key === 'ArrowRight' && el.dataset.bucketHead) { e.preventDefault(); onCollapse(head, false); }
  };
  return (
    <div className="hk-buckets" role="group" aria-label={label} onKeyDown={onKeyDown}>
      {buckets.map(b => {
        const shut = collapsed.has(b.key);
        const n = b.items.filter(it => it.active).length;
        return (
          <section key={b.key} className="hk-bucket" data-hk-bucket={b.key} aria-label={b.label}>
            <button type="button" className="hk-btn hk-bucket__head" aria-expanded={!shut} onClick={() => onCollapse(b.key, !shut)} data-rail-item data-bucket-head={b.key}>
              <Icon name={b.icon} size={16} />
              <span className="hk-bucket__name">{b.label}</span>
              {shut && n > 0 && <span className="hk-bucket__on">{n} on</span>}
              <span className={`hk-bucket__chev${shut ? ' hk-bucket__chev--shut' : ''}`}><Icon name="chevron" size={14} /></span>
            </button>
            {!shut && (
              <ul className="hk-bucket__items">
                {b.items.map(it => (
                  <li key={it.id} className="hk-bucket__li">
                    {it.edit || <>
                    <button type="button" className="hk-btn hk-bucket__item" aria-pressed={!!it.active} onClick={() => onPick(b.key, it.id)} data-rail-item data-hk-filter={`${b.key}:${it.id}`}>
                      {it.tone && <span className={`hk-dot hk-dot--${it.tone}`} aria-hidden="true" />}
                      <span className="hk-bucket__label">{it.label}</span>
                      {it.count != null && <span className="hk-bucket__n">{it.count.toLocaleString('en-US')}</span>}
                    </button>
                    {it.extra}
                    </>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
