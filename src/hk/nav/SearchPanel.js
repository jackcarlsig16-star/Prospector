import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../HkMarks';
import { hkGet } from '../hkApi';

// grow-nav-filters-v1 N6 - one search (the rail box, "/", ⌘K and the phone Search tab open it): filters and views
// (from the counts the server already gave), screens, and records - brands, people (by name; never an address), tracked
// replies - from GET /search once 2 characters are typed. ↑ / ↓ move, Enter picks, Esc closes. A query holding "@" is
// never sent (an address must not ride in a URL).
export const RECORD_DELAY_MS = 200;
const LABEL_WORD = { interested: 'Interested', pricing: 'Pricing', referral: 'Referral', decline: 'Decline', auto_reply: 'Auto reply', prefers_email: 'Prefers email', new_thread: 'New thread', other: 'Other' };

export default function SearchPanel({ businessId, initial = '', screens, filterItems = [], onGo, onApply, onOpenBrand, onOpenReply, onClose }) {
  const [q, setQ] = useState(initial);
  const [sel, setSel] = useState(0);
  const [records, setRecords] = useState(null);
  const [note, setNote] = useState('');
  const seq = useRef(0);
  const text = q.trim().toLowerCase();
  useEffect(() => {
    setRecords(null); setNote('');
    if (text.length < 2) return undefined;
    if (text.includes('@')) { setNote('Search by name or website - an email address is never sent.'); return undefined; }
    const n = ++seq.current;
    const t = setTimeout(() => hkGet(businessId, '/search', { q: q.trim() }).then(r => { if (n === seq.current) setRecords(r); }).catch(e => { if (n === seq.current) setNote(e.message); }), RECORD_DELAY_MS);
    return () => clearTimeout(t);
  }, [businessId, text]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const hit = s => !text || s.toLowerCase().includes(text);
    const out = [];
    const filters = text ? filterItems.filter(f => hit(f.label)).slice(0, 8) : [];
    if (filters.length) out.push({ title: 'Filters and views', items: filters.map(f => ({ key: `f-${f.id}`, icon: 'filter', label: f.label, meta: f.count != null ? `(${f.count.toLocaleString('en-US')})` : '', run: () => onApply(f) })) });
    const sc = screens.filter(s => hit(s.label));
    if (sc.length) out.push({ title: 'Go to', items: sc.map(s => ({ key: `s-${s.id}`, icon: s.icon, label: s.label, run: () => onGo(s.id) })) });
    if (records?.brands?.length) out.push({ title: 'Brands', items: records.brands.map(b => ({ key: `b-${b.id}`, icon: 'brands', label: b.name, meta: b.domain || '', run: () => onOpenBrand(b.id) })) });
    if (records?.people?.length) out.push({ title: 'People', items: records.people.map(p => ({ key: `p-${p.contact_id}`, icon: 'people', label: p.name, meta: p.brand_name, run: () => onOpenBrand(p.brand_id) })) });
    if (records?.replies?.length) out.push({ title: 'Replies', items: records.replies.map(r => ({ key: `r-${r.id}`, icon: 'replies', label: r.brand_name, meta: `${LABEL_WORD[r.label] || 'Reply'}${r.handled ? ' · handled' : ''}`, run: () => onOpenReply(r) })) });
    return out;
  }, [text, filterItems, screens, records, onApply, onGo, onOpenBrand, onOpenReply]);
  const flat = groups.flatMap(g => g.items);
  useEffect(() => { setSel(0); }, [text, records]);
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(i => Math.min(i + 1, flat.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && flat[sel]) { e.preventDefault(); flat[sel].run(); }
  };
  let i = -1;
  return (
    <>
      <div className="hk-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="hk-palette" role="dialog" aria-modal="true" aria-label="Search" data-hk-palette>
        <input className="hk-palette__input" autoFocus placeholder="Search brands, people, replies, filters" aria-label="Search brands, people, replies, filters" value={q}
          onChange={e => setQ(e.target.value)} onKeyDown={onKey} data-hk-search-input />
        <div className="hk-palette__list" role="listbox" aria-label="Results">
          {groups.map(g => (
            <div key={g.title} role="group" aria-label={g.title}>
              <div className="hk-menu__label">{g.title}</div>
              {g.items.map(it => { i += 1; const me = i; return (
                <button key={it.key} type="button" role="option" aria-selected={me === sel} className="hk-btn hk-palette__item" data-selected={me === sel} onMouseEnter={() => setSel(me)} onClick={it.run} data-hk-search-hit={it.key}>
                  <Icon name={it.icon} size={18} /><span>{it.label}</span>{it.meta && <span className="hk-meta">{it.meta}</span>}
                </button>
              ); })}
            </div>
          ))}
          {!flat.length && <p className="hk-palette__none">{note || (text.length >= 2 && records === null ? 'Searching…' : 'Nothing matches.')}</p>}
          {note && flat.length > 0 && <p className="hk-palette__none">{note}</p>}
        </div>
      </div>
    </>
  );
}
