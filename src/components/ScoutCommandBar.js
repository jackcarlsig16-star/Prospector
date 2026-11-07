import { useState, useEffect, useRef, useCallback, useId, useMemo } from 'react';
import './scout/scoutStyles';
import { scoutApi } from './scout/scoutApi';
import { goalsApi } from './salesAnalytics/goals/goalsApi';
import ScoutResults, { optionId } from './scout/ScoutResults';
import { WorkingPanel, AnswerPanel, EdgePanel } from './scout/ScoutAnswer';
import { StarGlyph, ScopePill, StaticScope } from './scout/ScoutParts';
import { MIN_CHARS, DEBOUNCE_MS, THREAD_MAX, isQuestion, readThread, saveThread, threadMessages, taskBody, canTask as canTaskFor } from './scout/scoutModel';

// scout-v2 REV3 Stage 2 - one input: typing (2+ chars, 250 ms) searches GET /api/scout/search and shows grouped hits;
// Enter opens the keyboard row, or asks when the line reads as a question (or nothing matched); asking is one
// POST /api/scout/ask - the server builds the context and makes the Claude call (never /proxy from here). The answer
// panel keeps the day's last 6 turns (D12). mode: 'compact' (the workspace header: 300 -> 560 px focused), 'plain'
// (a page's content width) or 'sheet' (the phone's bottom sheet, both mounts).
export default function ScoutCommandBar({ mode = 'plain', scope, scopeOptions, allText, onScope, me, businesses, onOpen, viewer = false, autoFocus = false, onDone }) {
  const listId = useId();
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const seq = useRef(0);
  const meId = me?.profile?.id || null;
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState(null); // { q, scope, groups }
  const [active, setActive] = useState(0);
  const [view, setView] = useState('search'); // search | working | answer | edge
  const [edge, setEdge] = useState(null); // { kind, q?, cap?, message? }
  const [turns, setTurns] = useState(() => readThread(meId));
  const [current, setCurrent] = useState(null);
  const [asked, setAsked] = useState({ q: '', at: 0 });
  const [tick, setTick] = useState(0);
  const [taskStates, setTaskStates] = useState({});
  const [taskNote, setTaskNote] = useState('');
  const [inlineKey, setInlineKey] = useState(null);
  const [retry, setRetry] = useState(0);
  const sheet = mode === 'sheet';
  const empty = scopeOptions.length === 0;
  const colorOf = useCallback(id => scopeOptions.find(o => o.id === id)?.color || null, [scopeOptions]);
  const canTask = useCallback(item => canTaskFor(item, me, businesses), [me, businesses]);

  useEffect(() => { setTurns(readThread(meId)); }, [meId]);
  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);

  // ⌘K / Ctrl+K focuses the bar (the phone's star opens the sheet instead - PersistentScout).
  useEffect(() => {
    if (sheet) return undefined;
    const onKey = e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); inputRef.current?.focus(); setOpen(true); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet]);

  useEffect(() => {
    if (!open || sheet) return undefined;
    const close = e => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open, sheet]);

  // Search: 2+ chars after 250 ms quiet; a stale reply never replaces a newer one.
  const text = q.trim();
  useEffect(() => {
    if (empty || view !== 'search' || text.length < MIN_CHARS) { setResults(null); return undefined; }
    const my = ++seq.current;
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = setTimeout(() => {
      scoutApi.search(text, scope, { signal: ctl?.signal })
        .then(r => { if (seq.current === my) { setResults({ q: text, groups: r.groups || [] }); setEdge(null); } })
        .catch(e => { if (e?.name !== 'AbortError' && seq.current === my) { setResults(null); setEdge(e.offline || e.status >= 500 ? { kind: 'offline', retry: 'search' } : { kind: 'error', message: e.message }); } });
    }, DEBOUNCE_MS);
    return () => { clearTimeout(t); ctl?.abort(); };
  }, [text, scope, view, empty, retry]);

  const groups = useMemo(() => (results?.q === text ? results.groups : null), [results, text]);
  const flat = useMemo(() => (groups || []).flatMap(g => g.items), [groups]);
  useEffect(() => { setActive(isQuestion(text) || !flat.length ? flat.length : 0); }, [groups]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (view !== 'working') return undefined;
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, [view]);

  const ask = useCallback(async (question = text) => {
    if (!question || question.length < MIN_CHARS) return;
    const at = Date.now();
    setAsked({ q: question, at }); setTick(0); setView('working'); setOpen(true); setEdge(null); setTaskNote(''); setInlineKey(null);
    try {
      const r = await scoutApi.ask({ q: question, scope, thread: threadMessages(turns) });
      const elapsed = Math.max(1, Math.round((Date.now() - at) / 1000));
      if (r.withheld) { setEdge({ kind: 'withheld', q: question }); setView('edge'); return; }
      const turn = { at, q: question, scope, elapsed, answer_md: r.answer_md, items: r.items || [], usage: r.usage, ask: r.ask, cap: r.cap, context_stats: { reads: r.context_stats?.reads || [], rows_by_entity: r.context_stats?.rows_by_entity || {} } };
      const next = [...turns, turn].slice(-THREAD_MAX);
      setTurns(next); saveThread(meId, next); setCurrent(turn); setTaskStates({}); setView('answer');
    } catch (e) {
      setEdge(e.status === 429 ? { kind: 'cap', cap: e.body?.cap ? { used: e.body.used, max: e.body.cap } : null } : e.offline || e.status >= 500 ? { kind: 'offline', retry: 'ask', q: question } : { kind: 'error', message: e.message });
      setView('edge');
    }
  }, [text, scope, turns, meId]);

  const openItem = useCallback(item => {
    if (!item?.open) return;
    onOpen(item);
    if (item.open.inline) { setInlineKey(`${item.entity}:${item.id}`); return; }
    setOpen(false); inputRef.current?.blur(); onDone?.();
  }, [onOpen, onDone]);

  const addTask = async item => {
    const k = `${item.entity}:${item.id}`;
    setTaskStates(s => ({ ...s, [k]: 'busy' }));
    try {
      const body = taskBody(item, meId);
      await goalsApi.createWeekGoal(item.workspace_id, body);
      setTaskStates(s => ({ ...s, [k]: 'added' }));
      setTaskNote(`Added to your to-dos: ${body.text}${body.link_type ? ' (linked)' : ''}`);
    } catch (e) { setTaskStates(s => ({ ...s, [k]: undefined })); setTaskNote(e.message); }
  };

  const clearThread = () => { setTurns([]); saveThread(meId, []); setCurrent(null); setView('search'); };
  const reopen = t => { setCurrent(t); setTaskStates({}); setInlineKey(null); setView('answer'); };

  const onChange = e => { setQ(e.target.value); setOpen(true); setEdge(null); if (view !== 'search') setView('search'); };
  const onKeyDown = e => {
    const n = flat.length;
    if (e.key === 'ArrowDown' && groups) { e.preventDefault(); setActive(a => (a >= n ? 0 : a + 1)); }
    else if (e.key === 'ArrowUp' && groups) { e.preventDefault(); setActive(a => (a <= 0 ? n : a - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (empty) return;
      if (groups && active < n) openItem(flat[active]);
      else ask();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (open) setOpen(false); else { inputRef.current?.blur(); onDone?.(); }
    }
  };

  const showPanel = open || sheet;
  let panel = null, listShown = false;
  if (showPanel && empty) panel = <EdgePanel kind="empty" />;
  else if (showPanel && view === 'working') panel = <WorkingPanel q={asked.q} elapsed={tick} />;
  else if (showPanel && view === 'answer' && current) {
    const opt = scopeOptions.find(o => o.id === current.scope);
    panel = (
      <AnswerPanel key={current.at} turn={current} phone={sheet} scopeAll={current.scope === 'all'} colorOf={colorOf} canTask={canTask} viewer={viewer}
        scopeChip={<StaticScope name={opt?.name || allText} color={opt?.color} />}
        onOpen={openItem} onTask={addTask} taskStates={taskStates} taskNote={taskNote} inlineKey={inlineKey}
        turns={turns} onReopen={reopen} onClear={clearThread} />
    );
  } else if (showPanel && edge) {
    panel = <EdgePanel kind={edge.kind} q={edge.q} cap={edge.cap} message={edge.message} onAsk={() => ask(text)} onRetry={() => { if (edge.retry === 'search') { setEdge(null); setRetry(n => n + 1); } else ask(edge.q || asked.q); }} />;
  } else if (showPanel && view === 'search' && groups) {
    listShown = groups.length > 0;
    panel = listShown
      ? <ScoutResults listId={listId} groups={groups} q={text} active={active} onActive={setActive} onOpen={openItem} onAsk={() => ask()} scopeAll={scope === 'all'} colorOf={colorOf} phone={sheet} />
      : <EdgePanel kind="nohits" q={text} onAsk={() => ask()} />;
  }
  const answerish = view === 'answer' || view === 'working';
  const focusRing = open || sheet;

  return (
    <div ref={rootRef} className={`scout scout--${mode}${open ? ' is-open' : ''}`} data-scout-bar={mode === 'compact' ? 'compact' : 'full'}>
      <div className={`scout-bar ui-theme-dark${focusRing ? ' is-focus' : ''}`}>
        <span className="scout-glyph"><StarGlyph /></span>
        <input ref={inputRef} value={q} onChange={onChange} onKeyDown={onKeyDown} onFocus={() => setOpen(true)}
          role="combobox" aria-label="Search or ask Scout" aria-expanded={listShown} aria-controls={listShown ? listId : undefined}
          aria-activedescendant={listShown ? optionId(listId, active) : undefined} aria-autocomplete="list"
          placeholder={focusRing ? 'Search, or ask a question…' : 'Search or ask Scout'} autoComplete="off" spellCheck={false} />
        {!sheet && (focusRing
          ? (!empty && <ScopePill value={scope} options={scopeOptions} allText={allText} onChange={onScope} />)
          : <kbd aria-hidden="true">⌘K</kbd>)}
        {view === 'working' && <span className="scout-think" aria-hidden="true" />}
      </div>
      {panel && <div className={`scout-pop ui-theme-dark${answerish ? ' scout-pop--answer' : ''}`} data-scout-pop>{panel}</div>}
    </div>
  );
}
