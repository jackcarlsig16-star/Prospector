import { useState, useRef, useEffect, useId } from 'react';
import { IconScorecard, IconGlobe, IconMail, IconLink } from '../../ui/icons';
import { splitMatch } from './scoutModel';

// scout-v2 REV3 Stage 2 - the bar's small parts. Glyph paths from specs/design/scout-v2 (16 box, currentColor).
const Svg = ({ size = 12, fill = 'none', children }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill={fill} stroke={fill === 'none' ? 'currentColor' : 'none'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ flex: 'none' }}>{children}</svg>
);
export const StarGlyph = ({ size = 15 }) => <Svg size={size} fill="currentColor"><path d="M8 1.5l1.6 4.2L14 8l-4.4 1.6L8 14.5 6.4 9.6 2 8l4.4-1.6z" /></Svg>;
export const LockGlyph = ({ size = 14 }) => <Svg size={size}><rect x="3.5" y="7" width="9" height="6.5" rx="1.2" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></Svg>;
export const CaretGlyph = () => <Svg size={11}><path d="M4.5 6.5 8 10l3.5-3.5" /></Svg>;
export const OpenGlyph = () => <Svg size={11}><path d="M13 3v5H4M6.5 5.5 4 8l2.5 2.5" /></Svg>;
export const PlusGlyph = () => <Svg size={11}><path d="M8 3.5v9M3.5 8h9" /></Svg>;
export const ClearGlyph = () => <Svg size={11}><path d="M4 4l8 8M12 4l-8 8" /></Svg>;
export const SortGlyph = () => <Svg size={11}><path d="M5 3v10M2.5 10.5 5 13l2.5-2.5M11 13V3M8.5 5.5 11 3l2.5 2.5" /></Svg>;
const Building = () => <Svg><rect x="3" y="2.5" width="10" height="11" rx="1" /><path d="M6 6h1M9 6h1M6 9h1M9 9h1M7 13.5v-2h2v2" /></Svg>;
const Person = () => <Svg><circle cx="8" cy="5.5" r="2.8" /><path d="M2.8 14c.6-3 2.7-4.3 5.2-4.3s4.6 1.3 5.2 4.3" /></Svg>;
const Bulb = () => <Svg><path d="M5.5 11.5a4.5 4.5 0 1 1 5 0v1.5h-5z" /><path d="M6.5 14.5h3" /></Svg>;
const Note = () => <Svg><path d="M4 2.5h6l2.5 2.5v8.5H4z" /><path d="M6 7h4.5M6 9.5h4.5" /></Svg>;
const ICONS = { partners: Building, employers: Building, targets: Building, clients: Building, accounts: Building, brands: Building, people: Person, brand_contacts: Person, todos: () => <IconScorecard size={12} />, insights: Bulb, call_notes: Note, intel: () => <IconGlobe size={12} />, outlook: () => <IconMail size={12} /> };
export const EntityIcon = ({ entity }) => { const I = ICONS[entity] || (() => <IconLink size={12} />); return <I />; };

// Matched words in neon text, no background highlight (B3).
export const Marked = ({ text, q }) => splitMatch(text, q).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i} style={{ color: 'inherit', fontSize: 'inherit' }}>{p.text}</span>));

export const WorkspaceTag = ({ name, color }) => <span className="scout-ws"><i className="scout-dot" style={{ background: color || 'var(--ui-muted)' }} />{name}</span>;

// B2 scope pill: one click opens the list (a listbox, never a <select> in a popover); ↑↓ move, Enter picks, Esc closes.
// options: [{ id, name, color }]; the last choice is "All my workspaces" (the platform owner: "All workspaces").
export function ScopePill({ value, options, allText, onChange, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const btnRef = useRef(null);
  const listRef = useRef(null);
  const id = useId();
  const choices = [...options, { id: 'all', name: allText }];
  const current = choices.find(c => c.id === value) || choices[choices.length - 1];
  useEffect(() => { if (open) { setActive(Math.max(0, choices.findIndex(c => c.id === current.id))); listRef.current?.focus(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return undefined;
    const close = e => { if (!listRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const pick = c => { setOpen(false); btnRef.current?.focus(); if (c.id !== value) onChange(c.id); };
  const onKey = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(choices.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(choices[active]); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); setOpen(false); btnRef.current?.focus(); }
  };
  return (
    <>
      <button ref={btnRef} type="button" className="scout-scope" data-scout-scope aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined}
        aria-label={`Scope: ${current.name}`} onClick={() => setOpen(o => !o)} onMouseDown={e => e.stopPropagation()}>
        {current.id !== 'all' && <i className="scout-dot" style={{ background: current.color || 'var(--ui-muted)' }} />}
        <span>{current.name}</span><CaretGlyph />
      </button>
      {open && (
        <ul ref={listRef} id={`${id}-list`} role="listbox" tabIndex={-1} aria-label="Scout scope" className="scout-scope-list ui-theme-dark"
          aria-activedescendant={`${id}-o${active}`} onKeyDown={onKey} style={{ top: 'calc(100% + 6px)', [align]: 0 }}>
          {choices.map((c, i) => (
            <li key={c.id} id={`${id}-o${i}`} role="option" aria-selected={c.id === current.id} className={i === active ? 'is-active' : undefined}
              onMouseEnter={() => setActive(i)} onMouseDown={e => e.preventDefault()} onClick={() => pick(c)}>
              {c.id !== 'all' ? <i className="scout-dot" style={{ background: c.color || 'var(--ui-muted)' }} /> : <StarGlyph size={11} />}{c.name}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
export const StaticScope = ({ name, color }) => <span className="scout-scope" data-static>{color && <i className="scout-dot" style={{ background: color }} />}<span>{name}</span></span>;
