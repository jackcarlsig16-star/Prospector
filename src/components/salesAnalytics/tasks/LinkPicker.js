import { useState, useId } from 'react';
import { SA, saSans } from '../theme';
import { labelStyle } from '../goals/goalsUi';
import { filterLinkOptions } from './linkTargets';

export const chipStyle = { ...saSans, display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 8px', borderRadius: 999, border: `1px solid ${SA.border}`, background: SA.surface2, color: SA.soft, fontSize: 12, cursor: 'pointer', maxWidth: '100%' };

// Typeahead over commitments, goals, partners and companies, grouped.
// onChange(type, id) - both null clears the link.
export default function LinkPicker({ link, links, onChange, disabled, taskText }) {
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const groups = filterLinkOptions(links.options, query);
  const flat = groups.flatMap(g => g.items.map(o => ({ type: g.type, ...o })));
  const close = () => { setEditing(false); setQuery(''); setActive(0); };
  const pick = o => { close(); onChange(o.type, o.id); };
  const what = taskText ? ` for ${taskText}` : '';

  if (!editing) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, maxWidth: '100%' }}>
        <button type="button" disabled={disabled} onClick={() => { links.load(); setEditing(true); }} aria-label={link ? `Change link${what}` : `Link${what}`}
          style={{ ...chipStyle, cursor: disabled ? 'default' : 'pointer', overflowWrap: 'anywhere', height: 'auto', minHeight: 26 }}>
          {link ? links.labelFor(link.type, link.id) : '🔗 Link'}
        </button>
        {link && !disabled && (
          <button type="button" onClick={() => onChange(null, null)} aria-label={`Remove link${what}`}
            style={{ all: 'unset', cursor: 'pointer', width: 24, height: 26, textAlign: 'center', color: SA.muted }}>×</button>
        )}
      </span>
    );
  }

  const onKey = e => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, flat.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (flat[active]) pick(flat[active]); }
  };
  let n = -1;
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <input autoFocus value={query} onChange={e => { setQuery(e.target.value); setActive(0); }} onKeyDown={onKey}
        onBlur={e => { if (!e.currentTarget.parentElement.contains(e.relatedTarget)) close(); }}
        role="combobox" aria-expanded aria-controls={listId} aria-activedescendant={flat[active] ? `${listId}-${active}` : undefined}
        aria-label={`Search what to link${what}`} placeholder="Commitment, goal, partner or company"
        style={{ ...saSans, fontSize: 13, height: 34, boxSizing: 'border-box', background: SA.inset, border: `1px solid ${SA.accent}`, borderRadius: 8, color: SA.text, padding: '0 10px' }} />
      <div id={listId} role="listbox" aria-label="Link to" style={{ maxHeight: 260, overflowY: 'auto', border: `1px solid ${SA.border}`, borderRadius: 8, background: SA.surface }}>
        {groups.map(g => (
          <div key={g.type} role="group" aria-label={g.label}>
            <div style={{ ...labelStyle, fontSize: 11, padding: '8px 10px 4px' }}>{g.label}</div>
            {g.items.map(o => {
              n += 1;
              const i = n;
              return (
                <button key={o.id} id={`${listId}-${i}`} type="button" role="option" aria-selected={i === active}
                  onMouseDown={e => e.preventDefault()} onClick={() => pick({ type: g.type, ...o })} onMouseEnter={() => setActive(i)}
                  style={{ all: 'unset', ...saSans, boxSizing: 'border-box', display: 'block', width: '100%', minHeight: 32, padding: '6px 10px', fontSize: 13, cursor: 'pointer', color: SA.text, background: i === active ? SA.surface2 : 'transparent', overflowWrap: 'anywhere' }}>
                  {o.label}
                </button>
              );
            })}
          </div>
        ))}
        {!flat.length && <div style={{ padding: 10, fontSize: 13, color: SA.muted }}>{query ? 'No match' : 'Loading…'}</div>}
      </div>
    </div>
  );
}
