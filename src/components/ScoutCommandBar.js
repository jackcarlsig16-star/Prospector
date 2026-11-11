import { useState, useEffect, useRef, useCallback, useId, useMemo } from 'react';
import './scout/scoutStyles';
import { scoutApi } from './scout/scoutApi';
import { goalsApi } from './salesAnalytics/goals/goalsApi';
import ScoutResults, { optionId } from './scout/ScoutResults';
import { WorkingPanel, AnswerPanel, EdgePanel } from './scout/ScoutAnswer';
import { ConfirmCard, ActWorking, DoneLine, CantDo, ActNote } from './scout/ScoutActionCard';
import { useScoutActions } from './scout/useScoutActions';
import { looksLikeCommand } from './scout/scoutActions';
import ComposePanel from './salesAnalytics/goals/priorities/ComposePanel';
import { SA_THEME_CSS, SA_THEME_CLASS } from './salesAnalytics/theme';
import { StarGlyph, ScopePill, StaticScope } from './scout/ScoutParts';
import { MIN_CHARS, DEBOUNCE_MS, THREAD_MAX, isQuestion, readThread, saveThread, threadMessages, canActIn } from './scout/scoutModel';

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
  const [menu, setMenu] = useState(null);
  const [members, setMembers] = useState([]);
  const [compose, setCompose] = useState(null);
  const [composeToast, setComposeToast] = useState('');
  const [inlineKey, setInlineKey] = useState(null);
  const [retry, setRetry] = useState(0);
  const sheet = mode === 'sheet';
  const empty = scopeOptions.length === 0;
  const colorOf = useCallback(id => scopeOptions.find(o => o.id === id)?.color || null, [scopeOptions]);
  const canAct = scope !== 'all' && !viewer && canActIn(scope, me, businesses);

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

  // An acted-on answer is the same turn, updated in place (rows + its action sub-line) and saved to the thread.
  const onTurn = useCallback(turn => {
    setCurrent(turn);
    setTurns(ts => { const next = ts.map(t => (t.at === turn.at ? turn : t)); saveThread(meId, next); return next; });
  }, [meId]);
  const openRef = useRef(null);
  const actions = useScoutActions({ scope, current: view === 'answer' ? current : null, onTurn, onOpenItem: item => openRef.current?.(item, true), onCompose: setCompose });
  // The result line of an action sits under the answer's last section: bring it into view, the popover scrolls inside itself.
  const actRef = useRef(null);
  const actKey = actions.act ? `${actions.act.kind}:${actions.act.text || ''}` : '';
  useEffect(() => { if (actKey) actRef.current?.scrollIntoView({ block: 'nearest' }); }, [actKey]);
  useEffect(() => {
    if (!composeToast) return undefined;
    const t = setTimeout(() => setComposeToast(''), 4000);
    return () => clearTimeout(t);
  }, [composeToast]);
  useEffect(() => { setMembers([]); }, [scope]);
  // the members of the answer's workspace: owner names on task rows, the Assign ▸ list (with each member's colour)
  const salesScope = scope !== 'all' && !!businesses.find(b => b.id === scope)?.features?.goals_sales;
  useEffect(() => { if (current && salesScope && !members.length) goalsApi.members(scope).then(ms => { const list = (ms || []).map(m => ({ user_id: m.user_id, first: String(m.name || 'Member').split(' ')[0], color: m.color || null })); const mine = String(me?.profile?.display_name || '').split(' ')[0]; setMembers(meId && mine && !list.some(m => m.user_id === meId) ? [...list, { user_id: meId, first: mine, color: null }] : list); }).catch(() => {}); }, [current, salesScope, members.length, scope]);

  const ask = useCallback(async (question = text) => {
    if (!question || question.length < MIN_CHARS) return;
    const at = Date.now();
    setAsked({ q: question, at }); setTick(0); setView('working'); setOpen(true); setEdge(null); setInlineKey(null); setMenu(null); actions.onNewAsk();
    try {
      const r = await scoutApi.ask({ q: question, scope, thread: threadMessages(turns) });
      const elapsed = Math.max(1, Math.round((Date.now() - at) / 1000));
      if (r.withheld) { setEdge({ kind: 'withheld', q: question }); setView('edge'); return; }
      const turn = { at, q: question, scope, elapsed, answer_md: r.answer_md, summary: r.summary || null, sections: r.sections || null, items: r.items || [], usage: r.usage, ask: r.ask, cap: r.cap, context_stats: { reads: r.context_stats?.reads || [], rows_by_entity: r.context_stats?.rows_by_entity || {} } };
      const next = [...turns, turn].slice(-THREAD_MAX);
      setTurns(next); saveThread(meId, next); setCurrent(turn); setView('answer');
    } catch (e) {
      setEdge(e.status === 429 ? { kind: 'cap', cap: e.body?.cap ? { used: e.body.used, max: e.body.cap } : null } : e.offline || e.status >= 500 ? { kind: 'offline', retry: 'ask', q: question } : { kind: 'error', message: e.message });
      setView('edge');
    }
  }, [text, scope, turns, meId]); // eslint-disable-line react-hooks/exhaustive-deps

  // stay = opened from a row's ⋯ menu: the panel stays up so the action's line is read (a click outside closes it).
  const openItem = useCallback((item, stay = false) => {
    if (!item?.open) return;
    onOpen(item);
    if (item.open.inline) { setInlineKey(`${item.entity}:${item.id}`); return; }
    if (stay) return;
    setOpen(false); inputRef.current?.blur(); onDone?.();
  }, [onOpen, onDone]);
  openRef.current = openItem;

  // One input: a line that opens with a verb is a command (the server decides; not a command -> it is asked).
  const submit = async () => {
    if (!looksLikeCommand(text)) return ask();
    setOpen(true); setEdge(null); setMenu(null);
    if (view !== 'answer' || !current) setView('act');
    if (await actions.command(text) === 'ask') return ask();
    return setQ('');
  };

  const clearThread = () => { setTurns([]); saveThread(meId, []); setCurrent(null); actions.clear(); setView('search'); };
  const reopen = t => { setCurrent(t); setInlineKey(null); setMenu(null); actions.clear(); setView('answer'); };

  // Typing a command over an answer keeps the answer (its rows are what "those" means); anything else searches.
  const onChange = e => { const v = e.target.value; setQ(v); setOpen(true); setEdge(null); const keep = current && looksLikeCommand(v); if (keep) setView('answer'); else if (view !== 'search' && v.trim()) setView('search'); };
  const onKeyDown = e => {
    const n = flat.length;
    if (e.key === 'ArrowDown' && groups) { e.preventDefault(); setActive(a => (a >= n ? 0 : a + 1)); }
    else if (e.key === 'ArrowUp' && groups) { e.preventDefault(); setActive(a => (a <= 0 ? n : a - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (empty) return;
      if (actions.act?.kind === 'card' && !text) actions.confirm();
      else if (groups && active < n && !looksLikeCommand(text)) openItem(flat[active]);
      else submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (actions.act?.kind === 'card') actions.cancel();
      else if (open) setOpen(false); else { inputRef.current?.blur(); onDone?.(); }
    }
  };

  const showPanel = open || sheet;
  const a = actions.act;
  const actBody = !a ? null
    : a.kind === 'card' ? <ConfirmCard card={a.card} onConfirm={actions.confirm} onCancel={actions.cancel} />
    : a.kind === 'working' ? <ActWorking card={a.card} ticked={a.ticked} />
    : a.kind === 'done' ? <DoneLine result={a.result} secondsLeft={a.left} undone={a.undone} onUndo={actions.undo} onRetry={actions.retry} />
    : a.kind === 'cant' ? <CantDo cant={a.cant} onNearest={a.cant.nearest?.id ? actions.nearest : null} />
    : a.kind === 'planning' ? <ActNote kind="planning">{a.label}</ActNote>
    : <ActNote kind={a.kind}>{a.text}</ActNote>;
  const actBlock = actBody && <div ref={actRef} data-scout-actblock>{actBody}</div>;
  let panel = null, listShown = false;
  if (showPanel && empty) panel = <EdgePanel kind="empty" />;
  else if (showPanel && view === 'working') panel = <WorkingPanel q={asked.q} elapsed={tick} />;
  else if (showPanel && view === 'answer' && current) {
    const opt = scopeOptions.find(o => o.id === current.scope);
    panel = (
      <AnswerPanel key={current.at} turn={current} phone={sheet} scopeAll={current.scope === 'all'} colorOf={colorOf} viewer={viewer} canAct={canAct && current.scope === scope}
        scopeChip={<StaticScope name={opt?.name || allText} color={opt?.color} />}
        onOpen={openItem} inlineKey={inlineKey} members={members} menu={menu} onMenu={setMenu} onPick={(item, id, args) => { setMenu(null); actions.pick(item, id, args); }}
        onCopy={actions.copy} act={actBlock}
        turns={turns} onReopen={reopen} onClear={clearThread} />
    );
  } else if (showPanel && view === 'act' && actBlock) {
    panel = <div className="scout-panel" data-scout-actpanel>{actBlock}</div>;
  } else if (showPanel && edge) {
    panel = <EdgePanel kind={edge.kind} q={edge.q} cap={edge.cap} message={edge.message} onAsk={() => ask(text)} onRetry={() => { if (edge.retry === 'search') { setEdge(null); setRetry(n => n + 1); } else ask(edge.q || asked.q); }} />;
  } else if (showPanel && view === 'search' && groups) {
    listShown = groups.length > 0;
    panel = listShown
      ? <ScoutResults listId={listId} groups={groups} q={text} active={active} onActive={setActive} onOpen={openItem} onAsk={() => ask()} scopeAll={scope === 'all'} colorOf={colorOf} phone={sheet} />
      : <EdgePanel kind="nohits" q={text} onAsk={() => ask()} />;
  }
  const answerish = view === 'answer' || view === 'working' || view === 'act';
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
      {/* the panel's colours are the sales page's variables: outside that page they come from the theme class */}
      {compose && <span className={`${SA_THEME_CLASS} ui-theme-dark`} data-scout-compose><style>{SA_THEME_CSS}</style><ComposePanel businessId={scope} row={compose} onClose={() => setCompose(null)} onToast={t => setComposeToast(t.text)} /></span>}
      {composeToast && <div className="scout-toast ui-theme-dark" role="status" data-scout-toast>{composeToast}</div>}
    </div>
  );
}
