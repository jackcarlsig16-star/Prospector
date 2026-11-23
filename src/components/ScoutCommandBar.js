import { useState, useEffect, useRef, useCallback, useId, useMemo } from 'react';
import './scout/scoutStyles';
import { scoutApi } from './scout/scoutApi';
import { goalsApi } from './salesAnalytics/goals/goalsApi';
import ScoutResults, { optionId } from './scout/ScoutResults';
import { WorkingPanel, AnswerPanel, EdgePanel } from './scout/ScoutAnswer';
import { ConfirmCard, ActWorking, DoneLine, CantDo, ActNote, DraftBlock } from './scout/ScoutActionCard';
import { useScoutActions } from './scout/useScoutActions';
import { looksLikeCommand, planRows, keyOf, focusLabel } from './scout/scoutActions';
import ComposePanel from './salesAnalytics/goals/priorities/ComposePanel';
import { SA_THEME_CSS, SA_THEME_CLASS } from './salesAnalytics/theme';
import { StarGlyph, ScopePill, StaticScope } from './scout/ScoutParts';
import { MIN_CHARS, DEBOUNCE_MS, THREAD_MAX, isQuestion, readThread, saveThread, threadMessages, canActIn } from './scout/scoutModel';

// scout-v2 REV3 Stage 2 - one input: typing (2+ chars, 250 ms) searches GET /api/scout/search and shows grouped hits;
// Enter opens the keyboard row, or asks when the line reads as a question (or nothing matched); asking is one
// POST /api/scout/ask - the server builds the context and makes the Claude call (never /proxy from here). The answer
// panel keeps the day's last 6 turns (D12). mode: 'compact' (the workspace header: 300 -> 560 px focused), 'plain'
// (a page's content width) or 'sheet' (the phone's bottom sheet, both mounts).
// app-shell-v2 W1 / W2 - the thread laid out in place, under the shell's one field (no search here, no Cmd/Ctrl+K):
// 'window' (the Scout window: the thread, then a follow-up input at the bottom) and 'page' (the Scout page: the thread
// only - the header's field is its composer). seed = what the header sent: { openLast: true } shows the thread's last
// answer, { q } runs that line here (a command plans, a question asks). onDone(why): 'esc' | 'open' (a record opened).
export default function ScoutCommandBar({ mode = 'plain', scope, scopeOptions, allText, onScope, me, businesses, onOpen, viewer = false, autoFocus = false, onDone, seed = null, stacked = false }) {
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
  // scout-v3.1 C8: the record(s) a follow-up narrowed the conversation to - what "her" / "it" mean until cleared
  const [focus, setFocus] = useState(null);
  const sheet = mode === 'sheet';
  const thread = mode === 'window' || mode === 'page';
  const fixed = sheet || thread;
  const empty = scopeOptions.length === 0;
  const colorOf = useCallback(id => scopeOptions.find(o => o.id === id)?.color || null, [scopeOptions]);
  const canAct = scope !== 'all' && !viewer && canActIn(scope, me, businesses);

  useEffect(() => { setTurns(readThread(meId)); }, [meId]);
  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);

  // ⌘K / Ctrl+K focuses the bar (the phone's star opens the sheet instead - PersistentScout).
  useEffect(() => {
    if (fixed) return undefined;
    const onKey = e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); inputRef.current?.focus(); setOpen(true); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fixed]);

  useEffect(() => {
    if (!open || fixed) return undefined;
    const close = e => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open, fixed]);

  // Search: 2+ chars after 250 ms quiet; a stale reply never replaces a newer one.
  const text = q.trim();
  useEffect(() => {
    if (empty || thread || view !== 'search' || text.length < MIN_CHARS) { setResults(null); return undefined; }
    const my = ++seq.current;
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = setTimeout(() => {
      scoutApi.search(text, scope, { signal: ctl?.signal })
        .then(r => { if (seq.current === my) { setResults({ q: text, groups: r.groups || [] }); setEdge(null); } })
        .catch(e => { if (e?.name !== 'AbortError' && seq.current === my) { setResults(null); setEdge(e.offline || e.status >= 500 ? { kind: 'offline', retry: 'search' } : { kind: 'error', message: e.message }); } });
    }, DEBOUNCE_MS);
    return () => { clearTimeout(t); ctl?.abort(); };
  }, [text, scope, view, empty, thread, retry]);

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
  const actions = useScoutActions({ scope, current: view === 'answer' ? current : null, focus: focus?.rows || null, onTurn, onOpenItem: item => openRef.current?.(item, true), onCompose: setCompose });
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

  // rows = the answer on screen (every section, in order): what "the second one" points at. opts.rows = one picked row.
  const ask = useCallback(async (question = text, opts = {}) => {
    if (!question || question.length < MIN_CHARS) return;
    const at = Date.now();
    setAsked({ q: question, at }); setTick(0); setView('working'); setOpen(true); setEdge(null); setInlineKey(null); setMenu(null); actions.onNewAsk();
    if (thread) setQ('');
    try {
      const rows = opts.rows || (current && current.scope === scope ? planRows(current) : []);
      const r = await scoutApi.ask({ q: question, scope, thread: threadMessages(turns), ...(rows.length ? { rows } : {}), ...(focus && !opts.rows ? { focus: focus.rows } : {}) });
      const elapsed = Math.max(1, Math.round((Date.now() - at) / 1000));
      if (r.withheld) { setEdge({ kind: 'withheld', q: question }); setView('edge'); return; }
      // nothing to point at, or several candidates ("Which one?"): said under the answer on screen - no turn, no ask spent
      if (r.cant) { actions.askCant(r.cant, question); setView(current ? 'answer' : 'act'); return; }
      const turn = { at, q: question, scope, elapsed, answer_md: r.answer_md, summary: r.summary || null, sections: r.sections || null, items: r.items || [], usage: r.usage, ask: r.ask, cap: r.cap, ...(r.resolved ? { resolved: r.resolved } : {}), ...(r.offer ? { offer: r.offer } : {}), context_stats: { reads: r.context_stats?.reads || [], rows_by_entity: r.context_stats?.rows_by_entity || {} } };
      const next = [...turns, turn].slice(-THREAD_MAX);
      setFocus(r.resolved ? { rows: r.resolved.rows, label: focusLabel(r.resolved.rows) } : null);
      setTurns(next); saveThread(meId, next); setCurrent(turn); setView('answer');
    } catch (e) {
      setEdge(e.status === 429 ? { kind: 'cap', cap: e.body?.cap ? { used: e.body.used, max: e.body.cap } : null } : e.offline || e.status >= 500 ? { kind: 'offline', retry: 'ask', q: question } : { kind: 'error', message: e.message });
      setView('edge');
    }
  }, [text, scope, turns, meId, current, focus]); // eslint-disable-line react-hooks/exhaustive-deps

  // stay = opened from a row's ⋯ menu: the panel stays up so the action's line is read (a click outside closes it).
  const openItem = useCallback((item, stay = false) => {
    if (!item?.open) return;
    onOpen(item);
    if (item.open.inline) { setInlineKey(`${item.entity}:${item.id}`); return; }
    if (stay) return;
    setOpen(false); inputRef.current?.blur(); onDone?.('open');
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

  const clearThread = () => { setTurns([]); saveThread(meId, []); setCurrent(null); setFocus(null); actions.clear(); setView('search'); };
  const reopen = t => { setCurrent(t); setFocus(t.resolved ? { rows: t.resolved.rows, label: focusLabel(t.resolved.rows) } : null); setInlineKey(null); setMenu(null); actions.clear(); setView('answer'); };
  // "Which one?": a command runs again on the row picked; a question is asked again about that one row
  // ("Did you mean": the candidate carries the question to ask instead)
  const choose = c => (c.ask ? ask(c.ask) : actions.act?.ask ? ask(actions.act.text, { rows: planRows(current).filter(r => keyOf(r) === c.key) }) : actions.choose(c));

  // The thread opens on its last answer. A seed re-reads the day's thread first: the header's panel asks save to it too.
  useEffect(() => { const last = thread ? turns.slice(-1)[0] : null; if (last) reopen(last); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const seeded = useRef(null);
  useEffect(() => {
    if (!seed || seeded.current === seed.at) return;
    if (seed.openLast) { seeded.current = seed.at; const saved = readThread(meId), last = saved.slice(-1)[0]; setTurns(saved); if (last) reopen(last); return; }
    if (seed.q && text !== seed.q) { setTurns(readThread(meId)); setQ(seed.q); return; }
    if (seed.q) { seeded.current = seed.at; submit(); }
  }, [seed, text]); // eslint-disable-line react-hooks/exhaustive-deps

  // Typing a command over an answer keeps the answer (its rows are what "those" means); anything else searches.
  const onChange = e => { const v = e.target.value; setQ(v); if (thread) return; setOpen(true); setEdge(null); const keep = current && looksLikeCommand(v); if (keep) setView('answer'); else if (view !== 'search' && v.trim()) setView('search'); };
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
      else if (thread) onDone?.('esc');
      else if (open) setOpen(false); else { inputRef.current?.blur(); onDone?.('esc'); }
    }
  };

  const showPanel = open || fixed;
  const a = actions.act;
  const actBody = !a ? null
    : a.kind === 'card' ? <ConfirmCard card={a.card} onConfirm={actions.confirm} onCancel={actions.cancel} onEdit={actions.editTask} />
    : a.kind === 'draft' ? <DraftBlock draft={a.draft} copied={a.copied} onCopy={actions.copyDraft} onOpen={actions.openDraft} onRegenerate={actions.regenerate} />
    : a.kind === 'working' ? <ActWorking card={a.card} ticked={a.ticked} />
    : a.kind === 'done' ? <DoneLine result={a.result} secondsLeft={a.left} undone={a.undone} onUndo={actions.undo} onRetry={actions.retry} />
    : a.kind === 'cant' ? <CantDo cant={a.cant} onNearest={a.cant.nearest?.id ? actions.nearest : null} onChoose={a.cant.candidates?.length ? choose : null} onAdd={canAct && a.cant.add ? actions.addTarget : null} />
    : a.kind === 'planning' ? <ActNote kind="planning">{a.label}</ActNote>
    : <ActNote kind={a.kind}>{a.text}</ActNote>;
  const actBlock = actBody && <div ref={actRef} data-scout-actblock>{actBody}</div>;
  let panel = null, listShown = false;
  if (showPanel && empty) panel = <EdgePanel kind="empty" />;
  else if (showPanel && view === 'working') panel = <WorkingPanel q={asked.q} elapsed={tick} />;
  else if (showPanel && view === 'answer' && current) {
    const opt = scopeOptions.find(o => o.id === current.scope);
    panel = (
      <AnswerPanel key={current.at} turn={current} phone={sheet || stacked} cards={mode === 'window'} scopeAll={current.scope === 'all'} colorOf={colorOf} viewer={viewer} canAct={canAct && current.scope === scope}
        scopeChip={<StaticScope name={opt?.name || allText} color={opt?.color} />}
        onOpen={openItem} inlineKey={inlineKey} members={members} menu={menu} onMenu={setMenu} onPick={(item, id, args) => { setMenu(null); actions.pick(item, id, args); }}
        onCopy={actions.copy} act={actBlock} activeKey={actions.activeKey}
        focus={focus && <div className="scout-focus" data-scout-focus><span className="scout-pill">{focus.label}<button type="button" aria-label={`Clear the focus (${focus.label})`} title="Clear the focus" onClick={() => setFocus(null)}>×</button></span></div>}
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
  if (thread && !panel) panel = <div className="scout-panel" data-scout-empty><span className="scout-note">{mode === 'page' ? 'Nothing asked yet today. Type in the field at the top: a question, or a command.' : 'Ask about this workspace’s companies, people, to-dos and email, or give a command. Lists, confirm cards and follow-ups stay in this window.'}</span></div>;
  const answerish = view === 'answer' || view === 'working' || view === 'act';
  const focusRing = thread ? open : open || sheet;
  const bar = (
    <div className={`scout-bar ui-theme-dark${focusRing ? ' is-focus' : ''}`}>
      <span className="scout-glyph"><StarGlyph /></span>
      {thread
        ? <input ref={inputRef} value={q} onChange={onChange} onKeyDown={onKeyDown} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} aria-label="Ask a follow-up or give a command" placeholder="Ask a follow-up, or give a command…" autoComplete="off" spellCheck={false} enterKeyHint="send" />
        : <input ref={inputRef} value={q} onChange={onChange} onKeyDown={onKeyDown} onFocus={() => setOpen(true)}
            role="combobox" aria-label="Search or ask Scout" aria-expanded={listShown} aria-controls={listShown ? listId : undefined}
            aria-activedescendant={listShown ? optionId(listId, active) : undefined} aria-autocomplete="list"
            placeholder={focusRing ? 'Search, or ask a question…' : 'Search or ask Scout'} autoComplete="off" spellCheck={false} />}
      {!fixed && (focusRing
        ? (!empty && <ScopePill value={scope} options={scopeOptions} allText={allText} onChange={onScope} />)
        : <kbd aria-hidden="true">⌘K</kbd>)}
      {view === 'working' && <span className="scout-think" aria-hidden="true" />}
    </div>
  );

  return (
    <div ref={rootRef} className={`scout scout--${mode}${open ? ' is-open' : ''}`} data-scout-bar={mode === 'compact' ? 'compact' : 'full'} data-scout-thread={thread ? mode : undefined}>
      {!thread && bar}
      {panel && <div className={`scout-pop ui-theme-dark${answerish ? ' scout-pop--answer' : ''}`} data-scout-pop>{panel}</div>}
      {mode === 'window' && bar}
      {/* the panel's colours are the sales page's variables: outside that page they come from the theme class */}
      {compose && <span className={`${SA_THEME_CLASS} ui-theme-dark`} data-scout-compose><style>{SA_THEME_CSS}</style><ComposePanel businessId={scope} row={compose} onClose={() => setCompose(null)} onToast={t => setComposeToast(t.text)} /></span>}
      {composeToast && <div className="scout-toast ui-theme-dark" role="status" data-scout-toast>{composeToast}</div>}
    </div>
  );
}
