import { useEffect, useRef } from 'react';
import './kitTheme';

// pipeline-quick-panel-v1 - a DataTable cell you can type into. Read mode is
// a button showing render(value) with a pencil on row hover; `editing` swaps
// in an <input> (text or date) prefilled and selected. Enter commits, Esc
// cancels, blur commits only when the value changed, Tab commits then calls
// onTab. `saving` (a value) shows that value dimmed until the owner clears it.
// The owner holds editing/saving so the row's own value moves only on commit
// (and a sorted table never re-sorts under an open editor).
const norm = v => ((v ?? '').trim() || null);

export default function EditableCell({ value, render, type = 'text', label, editing = false, saving, onEdit, onCommit, onCancel, onTab }) {
  const inputRef = useRef(null);
  const buttonRef = useRef(null);
  const done = useRef(false);
  const was = useRef(false);
  useEffect(() => {
    if (editing) { done.current = false; inputRef.current.focus(); if (type === 'text') inputRef.current.select(); }
    else if (was.current) buttonRef.current?.focus();
    was.current = editing;
  }, [editing, type]);

  // Enter unmounts the input, and the browser's blur on that unmount must not commit again.
  const finish = v => { if (done.current) return; done.current = true; if (norm(v) === norm(value)) onCancel(); else onCommit(norm(v)); };
  const cancel = () => { if (done.current) return; done.current = true; onCancel(); };
  if (editing) {
    return (
      <input ref={inputRef} type={type} className="ui-cell-input" aria-label={label} defaultValue={value ?? ''} onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); finish(e.currentTarget.value); }
          else if (e.key === 'Escape') { e.stopPropagation(); cancel(); }
          else if (e.key === 'Tab' && !e.shiftKey && onTab) { e.preventDefault(); finish(e.currentTarget.value); onTab(); }
        }}
        onBlur={e => finish(e.target.value)} />
    );
  }
  const busy = saving !== undefined;
  const shown = busy ? saving : value;
  return (
    <button ref={buttonRef} type="button" className={`ui-cell${busy ? ' ui-cell--saving' : ''}`} aria-busy={busy || undefined} aria-label={shown == null ? label : undefined}
      onClick={e => { e.stopPropagation(); if (!busy) onEdit(); }}>
      <span>{render(shown)}</span>
    </button>
  );
}
