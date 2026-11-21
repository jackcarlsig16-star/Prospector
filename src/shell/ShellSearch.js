import { useState, useEffect, useRef, useId, useMemo, useCallback } from 'react';
import Icon from './icons';
import { isQuestion } from './askRules';

// app-shell-v2 S2 / S3 - the header's ONE field: it searches companies, people and to-dos and asks Scout.
//   focused, nothing typed  Recent (records opened and questions asked from here, per viewer) + three "Try asking" chips
//   a search                grouped rows (<= 3 a group, the group's count beside its name), Ask Scout last (Cmd/Ctrl+Enter)
//   a question (Q6)         Ask Scout is the first, selected row, so Enter asks; the records it mentions sit under it
//   no match                one line, then Ask Scout as the only row
//   the answer (Q7)         a short answer stays in this panel; anything longer opens the Scout page (the caller decides)
// Keys: "/" and Cmd/Ctrl+K focus the field from anywhere; Up / Down move; Tab / Shift+Tab jump to the next / previous
// group; Enter opens the selected row; Cmd/Ctrl+Enter asks; Esc closes and returns focus to where it was.
// ARIA: the input is the combobox (aria-expanded, aria-controls, aria-activedescendant); the panel is the listbox, each
// group a role=group named by its label, each row a role=option. Neon is this field's focus colour and nothing else's.
export const RECENT_KEY = 'prospector_shell_recent'; // localStorage, per user: { [userId]: [{ kind, title, sub?, open?, q?, at }] } (max 5)
export const RECENT_MAX = 5, DEBOUNCE_MS = 150, MIN_CHARS = 2;
const ICON_OF = { companies: 'company', people: 'person', todos: 'today' };
const PILL = { P1: '#FF9F57', P2: '#F2C94C', P3: '#8FA8FF', P4: '#A8B2C0', Hot: '#FF9F57', Warm: '#F2C94C', Cool: '#8FA8FF' };

export function readRecent(userId) { try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '{}')[userId]; return Array.isArray(v) ? v.slice(0, RECENT_MAX) : []; } catch { return []; } }
export function pushRecent(userId, entry) {
  const same = r => (entry.kind === 'ask' ? r.kind === 'ask' && r.q === entry.q : r.kind !== 'ask' && r.id === entry.id);
  const next = [{ ...entry, at: Date.now() }, ...readRecent(userId).filter(r => !same(r))].slice(0, RECENT_MAX);
  try { const all = JSON.parse(localStorage.getItem(RECENT_KEY) || '{}'); localStorage.setItem(RECENT_KEY, JSON.stringify({ ...all, [userId]: next })); } catch { /* private mode */ }
  return next;
}
// "met" inside "MetLife" -> [before, match, after] on the first hit, case-insensitive.
export function markOf(text, q) { const s = String(text || ''), i = q ? s.toLowerCase().indexOf(q.toLowerCase()) : -1; return i < 0 ? [s, '', ''] : [s.slice(0, i), s.slice(i, i + q.length), s.slice(i + q.length)]; }
const Marked = ({ text, q }) => { const [a, m, b] = markOf(text, q); return <>{a}{m && <mark>{m}</mark>}{b}</>; };
const dueWord = (due, today) => (!due ? null : due === today ? 'Today' : due < today ? 'Overdue' : new Date(`${due}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }));

export function Pill({ pill }) { return pill ? <span className="sh-pill" style={{ color: PILL[pill.label] || '#A8B2C0', borderColor: PILL[pill.label] || '#A8B2C0' }}>{pill.label}{pill.value != null && <small className="sh-num">{pill.value}</small>}</span> : null; }

export default function ShellSearch({ userId, onSearch, onAsk, onOpen, onOpenScout, tryAsking = [], colorOf = () => null, today, fullScreen = false, onClose, canAsk = true }) {
  const listId = useId();
  const inputRef = useRef(null), rootRef = useRef(null), backRef = useRef(null), seq = useRef(0);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(fullScreen);
  const [groups, setGroups] = useState(null); // for `found.q`
  const [found, setFound] = useState('');
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState(() => readRecent(userId));
  const [answer, setAnswer] = useState(null); // { q, working } | { q, summary, row, reads } | { q, error }
  const text = q.trim();
  const question = isQuestion(text);

  useEffect(() => { setRecent(readRecent(userId)); }, [userId]);
  useEffect(() => { if (fullScreen) inputRef.current?.focus(); }, [fullScreen]);
  const focusField = useCallback(() => { backRef.current = document.activeElement !== inputRef.current ? document.activeElement : backRef.current; inputRef.current?.focus(); setOpen(true); }, []);
  const close = useCallback(() => {
    setOpen(false); setAnswer(null); setQ('');
    if (fullScreen) { onClose?.(); return; }
    inputRef.current?.blur();
    const back = backRef.current; backRef.current = null;
    if (back && back !== document.body && document.contains(back)) back.focus?.();
  }, [fullScreen, onClose]);

  useEffect(() => {
    if (fullScreen) return undefined;
    const onKey = e => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '') || e.target?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); focusField(); }
      else if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); focusField(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullScreen, focusField]);
  useEffect(() => {
    if (!open || fullScreen) return undefined;
    const out = e => { if (!rootRef.current?.contains(e.target)) { setOpen(false); setAnswer(null); } };
    document.addEventListener('mousedown', out);
    return () => document.removeEventListener('mousedown', out);
  }, [open, fullScreen]);

  useEffect(() => {
    if (text.length < MIN_CHARS) { setGroups(null); setFound(''); return undefined; }
    const my = ++seq.current;
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = setTimeout(() => {
      Promise.resolve().then(() => onSearch(text, ctl?.signal)).then(g => { if (seq.current === my) { setGroups(g || []); setFound(text); } })
        .catch(e => { if (e?.name !== 'AbortError' && seq.current === my) { setGroups([]); setFound(text); } });
    }, DEBOUNCE_MS);
    return () => { clearTimeout(t); ctl?.abort(); };
  }, [text, onSearch]);

  // The rows on screen, in order: what Up / Down walk and what aria-activedescendant names.
  const shown = useMemo(() => {
    if (answer) return [];
    const ask = canAsk && text.length >= MIN_CHARS ? [{ kind: 'ask', id: 'ask', group: 'ask' }] : [];
    if (!text) return recent.map((r, i) => ({ ...r, id: `recent-${i}`, group: 'recent', recent: true }));
    if (found !== text || !groups) return ask;
    const rows = groups.filter(g => g.items.length).flatMap(g => g.items.map(i => ({ ...i, kind: g.key, group: g.key })));
    return question ? [...ask, ...rows] : [...rows, ...ask];
  }, [answer, text, recent, found, groups, question, canAsk]);
  useEffect(() => { setActive(0); }, [text, found, question]);

  const ask = useCallback(async (question_ = text) => {
    if (!canAsk || question_.length < MIN_CHARS) return;
    setRecent(pushRecent(userId, { kind: 'ask', q: question_ }));
    setAnswer({ q: question_, working: true });
    try {
      const r = await onAsk(question_);
      if (r?.page) { setOpen(false); setAnswer(null); setQ(''); inputRef.current?.blur(); onClose?.(); return; }
      setAnswer({ q: question_, summary: r.summary, row: r.row || null, reads: r.reads || null, cap: r.cap || null });
    } catch (e) { setAnswer({ q: question_, error: e?.status === 429 ? 'That was the last ask for today. Search still works.' : e?.message || 'Scout could not answer just now.' }); }
  }, [text, userId, onAsk, onClose, canAsk]);

  const openRow = row => {
    if (!row) return;
    if (row.kind === 'ask' && !row.recent) return ask();
    if (row.kind === 'ask') return ask(row.q);
    if (!row.recent) setRecent(pushRecent(userId, { kind: row.kind, id: row.id, title: row.title, sub: row.sub || null, pill: row.pill || null, open: row.open }));
    onOpen(row);
    setOpen(false); setQ(''); inputRef.current?.blur(); onClose?.();
  };
  const jumpGroup = dir => {
    if (!shown.length) return;
    const starts = shown.map((r, i) => (i === 0 || shown[i - 1].group !== r.group ? i : -1)).filter(i => i >= 0);
    const cur = starts.filter(i => i <= active).pop() ?? 0, at = starts.indexOf(cur);
    setActive(starts[(at + dir + starts.length) % starts.length]);
  };
  const onKeyDown = e => {
    if (e.key === 'Escape') { e.preventDefault(); if (answer) { setAnswer(null); return; } close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); if (shown.length) setActive(a => (a + 1) % shown.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (shown.length) setActive(a => (a - 1 + shown.length) % shown.length); }
    else if (e.key === 'Tab' && open && shown.length > 1 && !answer) { e.preventDefault(); jumpGroup(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (answer) return; if (e.metaKey || e.ctrlKey) ask(); else openRow(shown[active]); }
  };

  const optId = i => `${listId}-o${i}`;
  const Row = (row, extra = {}) => {
    const i = shown.indexOf(row), sel = i === active;
    if (row.kind === 'ask') return (
      <button key={row.id} type="button" id={optId(i)} role="option" aria-selected={sel} tabIndex={-1} className="sh-row sh-row--ask" onMouseEnter={() => setActive(i)} onMouseDown={e => e.preventDefault()} onClick={() => openRow(row)} data-ask-row>
        <span className="sh-ico"><Icon name="star" size={13} /></span>
        <span className="sh-ttl">{row.recent ? row.q : <>Ask Scout <span className="sh-ask-q">“{text}”</span></>}</span>
        <span className="sh-sub">{row.recent ? 'asked' : ''}</span>
        {!fullScreen && !row.recent && <span className="sh-r">{question || !shown.some(r => r.kind !== 'ask') ? <span className="sh-kbd">↵</span> : <><span className="sh-kbd">⌘</span><span className="sh-kbd">↵</span></>}</span>}
      </button>
    );
    const owner = row.owner ? <span className="sh-ow"><i style={{ background: colorOf(row.owner.id) || '#6B7480' }} />{row.owner.name}</span> : null;
    return (
      <button key={`${row.group}-${row.id}`} type="button" id={optId(i)} role="option" aria-selected={sel} tabIndex={-1} className="sh-row" onMouseEnter={() => setActive(i)} onMouseDown={e => e.preventDefault()} onClick={() => openRow(row)} {...extra}>
        <span className="sh-ico"><Icon name={ICON_OF[row.kind] || 'dot'} size={13} /></span>
        <span className="sh-ttl"><Marked text={row.title} q={row.recent ? '' : text} /></span>
        <span className="sh-sub">{row.sub ? <Marked text={row.sub} q={row.recent ? '' : text} /> : ''}</span>
        <span className="sh-r"><Pill pill={row.pill} />{row.kind === 'todos' ? (row.due ? <span className="sh-num">{dueWord(row.due, today)}</span> : null) : owner}{sel && !fullScreen && <span className="sh-kbd">↵</span>}</span>
      </button>
    );
  };
  const Group = (key, label, rows, count) => rows.length > 0 && (
    <div key={key} role="group" aria-labelledby={`${listId}-g-${key}`}>
      <div className="sh-rg"><span className="sh-lbl" id={`${listId}-g-${key}`}>{label}</span><span className="sh-lbl sh-num" style={{ color: 'var(--sh-dim)' }}>{count ?? rows.length}</span></div>
      {rows.map(r => Row(r))}
    </div>
  );

  const askRow = shown.find(r => r.kind === 'ask' && !r.recent);
  const recordRows = shown.filter(r => r.kind !== 'ask' && !r.recent);
  const ready = found === text && !!groups;
  let body = null, hint = null;
  if (answer) {
    body = (
      <div className="sh-answer" role="status" aria-live="polite" data-shell-answer>
        <div className="sh-lbl" style={{ color: 'var(--sh-neon)', display: 'flex', gap: 6, alignItems: 'center' }}><Icon name="star" size={12} />Scout</div>
        {answer.working ? <p className="sh-note">Reading for “{answer.q}”…</p> : answer.error ? <p>{answer.error}</p> : <p>{answer.summary}</p>}
        {!answer.working && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {answer.row && <button type="button" className="sh-btn" onClick={() => { onOpen(answer.row); close(); }}>Open {answer.row.title}</button>}
          <button type="button" className="sh-btn sh-btn--ghost" onClick={() => { onOpenScout(); close(); }}>Keep asking in Scout</button>
        </div>}
      </div>
    );
    hint = <><span>{answer.reads ? `Read: ${answer.reads}` : ''}</span><span style={{ marginLeft: 'auto' }}><span className="sh-kbd">Esc</span>close</span></>;
  } else if (!text) {
    body = <>
      {Group('recent', 'Recent', shown)}
      {canAsk && tryAsking.length > 0 && <div role="group" aria-label="Try asking">
        <div className="sh-rg"><span className="sh-lbl">Try asking</span></div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '4px 14px 12px' }}>{tryAsking.map(t => <button key={t} type="button" className="sh-chip" tabIndex={-1} onMouseDown={e => e.preventDefault()} onClick={() => { setQ(t); inputRef.current?.focus(); }}>{t}</button>)}</div>
      </div>}
      {!shown.length && !(canAsk && tryAsking.length) && <div style={{ padding: 16 }} className="sh-note">Type to search companies, people and to-dos.</div>}
    </>;
  } else if (text.length < MIN_CHARS) {
    body = <div style={{ padding: 16 }} className="sh-note">Keep typing…</div>;
  } else if (ready && !recordRows.length) {
    body = <><div style={{ padding: 16, color: 'var(--sh-mut)', fontSize: 13.5 }} data-no-match>No company, person or to-do matches “{text}”.</div>{askRow && Row(askRow)}<div style={{ height: 8 }} /></>;
    hint = askRow ? <><span><span className="sh-kbd">↵</span>ask Scout</span><span style={{ marginLeft: 'auto' }}><span className="sh-kbd">Esc</span>close</span></> : null;
  } else {
    const byGroup = (groups || []).filter(g => g.items.length).map(g => Group(g.key, question ? 'Mentioned' : g.label, shown.filter(r => r.group === g.key), question ? null : g.count));
    body = question
      ? <>{askRow && Row(askRow)}{ready ? byGroup : null}<div style={{ height: 6 }} /></>
      : <>{ready ? byGroup : <div style={{ padding: 16 }} className="sh-note">Searching…</div>}{askRow && <><div className="sh-sep" />{Row(askRow)}</>}<div style={{ height: 6 }} /></>;
    hint = question
      ? <><span><span className="sh-kbd">↵</span>ask Scout</span><span style={{ marginLeft: 'auto' }}><span className="sh-kbd">Esc</span>close</span></>
      : <><span><span className="sh-kbd">↑</span><span className="sh-kbd">↓</span>move</span><span><span className="sh-kbd">↵</span>open</span>{canAsk && <span><span className="sh-kbd">⌘</span><span className="sh-kbd">↵</span>ask Scout</span>}<span><span className="sh-kbd">Tab</span>next group</span><span style={{ marginLeft: 'auto' }}><span className="sh-kbd">Esc</span>close</span></>;
  }
  const listed = open && !answer && shown.length > 0;

  return (
    <div ref={rootRef} className="sh-search" data-shell-search>
      <div className={`sh-sf${open ? ' is-focus' : ''}`} onMouseDown={e => { if (e.target !== inputRef.current) { e.preventDefault(); focusField(); } }}>
        <span className="sh-sfglyph"><Icon name="star" size={15} /></span>
        <input ref={inputRef} value={q} onChange={e => { setQ(e.target.value); setOpen(true); setAnswer(null); }} onKeyDown={onKeyDown} onFocus={() => setOpen(true)}
          role="combobox" aria-label="Search or ask Scout" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={listed} aria-controls={listed ? listId : undefined}
          aria-activedescendant={listed ? optId(active) : undefined} placeholder={canAsk ? 'Search companies, people and to-dos, or ask Scout' : 'Search companies, people and to-dos'} autoComplete="off" spellCheck={false} enterKeyHint="search" />
        {!fullScreen && <span className="sh-kbd" aria-hidden="true">{open ? 'Esc' : '⌘K'}</span>}
      </div>
      {open && !fullScreen && <div className="sh-scrim" aria-hidden="true" />}
      {open && (
        <div className="sh-pan" data-shell-panel>
          {answer ? body : <div id={listId} role={listed ? 'listbox' : undefined} aria-label={listed ? 'Results' : undefined}>{body}</div>}
          {hint && !fullScreen && <div className="sh-foot">{hint}</div>}
        </div>
      )}
    </div>
  );
}
