import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { goalsApi, TODOS_CHANGED } from '../goalsApi';
import { ErrorNote } from '../goalsUi';
import { ConfirmCard } from '../../../scout/ScoutActionCard';
import ComposePanel from '../priorities/ComposePanel';
import WorkPanel from './WorkPanel';
import { useTodayActions } from './useTodayActions';
import { TODAY_CSS } from './todayStyles';
import { SOURCE, SOURCE_IDS, scoutRow, todayQuery, bulkDates, dayWords, companyRow, TODAY_WORK, takeWork } from './todayRows';
import { Strip, CompanyCell, PersonCell, OwnerCell, DueCell, FromCell, Verb, Check, MoreButton, RowMenu, Toast, Icon, CHECK } from './TodayParts';

// actions-v2 Stage 2 - Actions is "Today": ONE ranked list (GET goals/today - the server groups and ranks; this
// screen never sorts). Five groups, a row once, in the first it fits; This week's five above; chips Mine / Team /
// Overdue / Undated / Snoozed, the Source select and search narrow it. A Member's check circle and ⋯ menu go through
// Scout's plan -> act -> undo (useTodayActions); a Viewer gets the same list with no Done, no ⋯ and no verb.
// Stage 3: the verb on each row opens Scout's work panel under it (WorkPanel; a sheet on a phone) - one at a time,
// nothing generated before the click, nothing ever sent. Scout opens the same panel on a row (TODAY_WORK).
// localStorage (per viewer): prospector_today_strip - '0' when This week's five is folded.
const STRIP_KEY = 'prospector_today_strip';
const stored = () => { try { return localStorage.getItem(STRIP_KEY) !== '0'; } catch { return true; } };
const COLS = [42, 30, null, 220, 186, 96, 104, 42, 132, 44];

export default function TodayList({ businessId, canEdit, lookup, compact = false }) {
  const [owner, setOwner] = useState(canEdit ? 'me' : 'team');
  const [chip, setChip] = useState(null);
  const [source, setSource] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [allOverdue, setAllOverdue] = useState(false);
  const [restOpen, setRestOpen] = useState(false);
  const [stripOpen, setStripOpen] = useState(stored);
  const [menu, setMenu] = useState(null); // { key, anchor }
  const [work, setWork] = useState(null); // { key, verb, person, state: 'working' | 'ready' | 'failed', data, error }
  const [copied, setCopied] = useState(null); // { text, onDone? } - the line after Copy
  const [compose, setCompose] = useState(null);
  const [wanted, setWanted] = useState(takeWork); // Scout asked for the panel on a row: { key, verb }
  const seq = useRef(0), wseq = useRef(0);

  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 250); return () => clearTimeout(t); }, [search]);
  const load = useCallback(() => {
    const mine = ++seq.current;
    return goalsApi.today(businessId, todayQuery({ owner, chip, source, q }))
      .then(d => { if (mine === seq.current) { setData({ ...d, shown_for: owner }); setError(''); } })
      .catch(e => { if (mine === seq.current) setError(e.message); });
  }, [businessId, owner, chip, source, q]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { window.addEventListener(TODOS_CHANGED, load); return () => window.removeEventListener(TODOS_CHANGED, load); }, [load]);
  const actions = useTodayActions({ businessId, onChanged: load });
  const closeMenu = useCallback(() => setMenu(null), []);

  const startWork = useCallback(async (row, { verb = row.verb, tone = null, person = null } = {}) => {
    const mine = ++wseq.current;
    setWork(w => ({ key: row.key, verb, person, state: 'working', data: w?.key === row.key && w.data?.prompt_pack ? { prompt_pack: w.data.prompt_pack, grounds: w.data.grounds } : null, error: '' }));
    let d;
    try { d = await goalsApi.todayWork(businessId, row.key, { verb, ...(tone ? { tone } : {}), ...(person ? { person: { key: person.key } } : {}) }); }
    catch (e) { d = { failed: { status: 0, error: e.message } }; }
    if (mine !== wseq.current) return;
    setWork(w => (w ? { ...w, verb: d.verb || verb, state: d.failed ? 'failed' : 'ready', data: d, error: d.failed?.error || '' } : w));
  }, [businessId]);
  const closeWork = useCallback(() => {
    wseq.current++;
    setWork(w => { if (w) setTimeout(() => document.querySelector(`[data-today-row="${w.key}"] [data-today-verb]`)?.focus(), 0); return null; });
  }, []);
  useEffect(() => { const h = e => { takeWork(); setWanted(e.detail); }; window.addEventListener(TODAY_WORK, h); return () => window.removeEventListener(TODAY_WORK, h); }, []);
  // a row that left the list (done, dropped, re-ranked away) takes its panel with it
  useEffect(() => { if (work && data && !data.groups.some(g => g.rows.some(r => r.key === work.key))) { wseq.current++; setWork(null); } }, [work, data]);
  useEffect(() => {
    if (!wanted || !data || data.shown_for !== owner) return;
    const row = data.groups.flatMap(g => g.rows).find(r => r.key === wanted.key);
    if (row) { setWanted(null); if (row.folded) setAllOverdue(true); if (row.group === 'rest') setRestOpen(true); startWork(row, { verb: wanted.verb || row.verb }); }
    else if (owner === 'me') setOwner('team');
    else { setWanted(null); setCopied({ text: 'That to-do is not on the list any more.' }); }
  }, [wanted, data, owner, startWork]);

  if (!data) return <div className="td"><style>{TODAY_CSS}</style>{error ? <ErrorNote message={error} /> : <p className="td-note" role="status">Loading today…</p>}</div>;

  const { groups, counts, today } = data;
  const members = data.members || [];
  const rows = groups.flatMap(g => g.rows);
  const run = a => { setCopied(null); return actions.run(a); };
  const pick = (row, p, instant = true) => { setMenu(null); run({ verb: p.verb, rows: [scoutRow(row)], args: p.args, instant, say: p.say }); };
  const done = row => pick(row, { verb: 'task_done', args: {}, say: {} });
  const canFive = canEdit && !!data.five.can_add;
  const workRow = work ? rows.find(r => r.key === work.key) || null : null;
  const toggleWork = row => (work?.key === row.key ? closeWork() : startWork(row));
  const copyOut = async (text, what) => {
    try { await navigator.clipboard.writeText(text); } catch { setCopied({ text: 'Not copied: the browser blocked the clipboard.' }); return false; }
    actions.dismiss();
    const row = workRow;
    setCopied(what === 'Prompt' ? { text: `Prompt copied · ${text.length.toLocaleString('en-US')} characters.` } : { text: `${what} copied. Mark it done when it’s sent.`, onDone: canEdit && row?.kind === 'todo' ? () => { setCopied(null); done(row); } : null });
    return true;
  };
  const openCompose = (row, prefill) => { const c = row.company, p = work.data?.row?.person || null; setCompose({ type: c.type, id: c.id, name: c.name, key: `${c.type}-${c.id}`, to: p?.name || null, person: p ? { person_key: p.key, name: p.name, title: p.title } : null, prefill }); };
  const addTodo = (row, words, person = null) => run({ verb: 'add_task', text: `add a task to ${words}`, rows: [person ? { entity: 'people', id: person.key, title: person.name, company: row.company?.id ? { type: row.company.type, id: row.company.id, name: row.company.name } : null } : companyRow(row.company)].filter(Boolean) });
  const stale = groups.find(g => g.id === 'rest').rows.filter(r => r.stale);
  const toggleStrip = () => setStripOpen(o => { try { localStorage.setItem(STRIP_KEY, o ? '0' : '1'); } catch { /* private mode */ } return !o; });
  const filtered = !!(chip || source || q);
  const clear = () => { setChip(null); setSource(''); setSearch(''); };
  const undated = rows.filter(r => r.kind === 'todo' && !r.due);
  const dateAll = date => run({ verb: 'task_due', rows: undated.slice(0, 25).map(scoutRow), args: { date }, say: { date } });
  const ranked = groups.slice(0, 4).reduce((n, g) => n + g.n, 0);
  const openMenu = (row, e) => { const anchor = e.currentTarget; setMenu(m => (m?.key === row.key ? null : { key: row.key, anchor })); };
  const setDate = (row, e) => setMenu({ key: row.key, anchor: e.currentTarget, sub: 'due' });
  const menuRow = menu ? rows.find(r => r.key === menu.key) : null;
  const visible = g => g.rows.filter(r => !(g.id === 'due' && r.folded && !allOverdue && g.fold));
  const groupOpen = g => g.id !== 'rest' || restOpen || filtered;
  const editable = row => canEdit && row.kind !== 'waiting';

  const chipBtn = (id, label, n, on, onClick, bad = false) => (
    <button key={id} type="button" className="td-chip" aria-pressed={on} onClick={onClick} data-today-chip={id}>{label} <b className={`td-num${bad && n ? ' td-bad' : ''}`}>{n}</b></button>
  );
  const bar = (
    <div className="td-bar" role="group" aria-label="Filter the list">
      {chipBtn('mine', 'Mine', owner === 'me' ? counts.mine : '·', owner === 'me', () => setOwner('me'))}
      {chipBtn('team', 'Team', counts.team, owner === 'team', () => setOwner('team'))}
      {!compact && <span className="td-sep" aria-hidden="true" />}
      {chipBtn('overdue', 'Overdue', counts.overdue, chip === 'overdue', () => setChip(c => (c === 'overdue' ? null : 'overdue')), true)}
      {chipBtn('undated', 'Undated', counts.undated, chip === 'undated', () => setChip(c => (c === 'undated' ? null : 'undated')))}
      {chipBtn('snoozed', 'Snoozed', counts.snoozed, chip === 'snoozed', () => setChip(c => (c === 'snoozed' ? null : 'snoozed')))}
      {!compact && <>
        <span className="td-sep" aria-hidden="true" />
        <select className="td-sel" aria-label="Source" value={source} onChange={e => setSource(e.target.value)}>
          <option value="">Source: All</option>
          {SOURCE_IDS.map(id => <option key={id} value={id}>{SOURCE[id][0]}</option>)}
        </select>
        <input className="td-search" type="search" aria-label="Search to-dos" placeholder="Search to-dos" value={search} onChange={e => setSearch(e.target.value)} />
      </>}
    </div>
  );
  const foldLine = g => (g.id === 'due' && g.fold && !allOverdue
    ? <button type="button" className="td-link td-fold" onClick={() => setAllOverdue(true)} data-today-fold>Show all <span className="td-num">{g.fold.overdue}</span> overdue · oldest is <span className="td-num">{g.fold.oldest_days}</span> d late</button>
    : null);
  const empty = !rows.length
    ? <div className="td-card td-empty" data-today-empty="none"><b>{filtered ? 'No to-dos match.' : 'Nothing on the list.'}</b>{filtered && <button type="button" className="td-btn" onClick={clear}>Clear filters</button>}</div>
    : !ranked && !filtered
      ? <div className="td-card td-empty" data-today-empty="ranked"><b>Nothing due, nothing ranked.</b><span className="td-note">You have <span className="td-num">{undated.length}</span> undated to-do{undated.length === 1 ? '' : 's'} in Everything else.</span></div>
      : null;
  const dateCard = canEdit && chip === 'undated' && undated.length > 0 && actions.state?.kind !== 'card' && (
    <div className="td-card td-confirm" data-today-datecard style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span className="td-gen">Scout</span><span>Set a date on {Math.min(undated.length, 25)} of these{undated.length > 25 ? ` (${undated.length} undated - 25 at a time)` : ''}:</span>
      {bulkDates(today).map(d => <button key={d} type="button" className="td-btn" onClick={() => dateAll(d)}>{dayWords(d)}</button>)}
      <input type="date" className="td-date" aria-label="Pick a date" style={{ margin: 0 }} onChange={e => e.target.value && dateAll(e.target.value)} />
    </div>
  );
  const cardUp = actions.state?.kind === 'card';
  const card = cardUp && (
    <div className="td-card td-confirm" data-today-card><ConfirmCard card={actions.state.card} onConfirm={actions.confirm} onCancel={actions.dismiss} /><p className="td-note" style={{ margin: '8px 0 0' }}>One batch. Undo puts every row back.</p></div>
  );

  const num = row => (allOverdue ? row.rank_open : row.rank ?? row.rank_open);
  const dropLine = canEdit && stale.length > 0 && (
    <span data-today-stale><span className="td-num">{stale.length}</span> here {stale.length === 1 ? 'has' : 'have'} not been touched in 30 days or more · <button type="button" className="td-link" onClick={() => run({ verb: 'task_drop', rows: stale.slice(0, 25).map(scoutRow) })} data-today-bulkdrop>Drop {stale.length > 25 ? 'the first 25' : stale.length === 1 ? 'it' : `all ${stale.length}`} with Scout</button></span>
  );
  const tail = g => (g.id === 'rest' ? dropLine : foldLine(g));
  const panel = workRow && (
    <WorkPanel work={work} row={workRow} canEdit={canEdit} phone={compact} notice={card || null}
      onClose={closeWork} onRetry={o => startWork(workRow, { verb: work.verb, person: work.person, ...o })} onCopy={copyOut} onCompose={prefill => openCompose(workRow, prefill)}
      onDone={() => done(workRow)} onFinish={() => pick(workRow, { verb: 'task_finish', args: {}, say: {} })} onAddReply={() => pick(workRow, { verb: 'reply_todos', args: {}, say: {} })}
      onAddTodo={words => addTodo(workRow, words)} onAddPerson={p => addTodo(workRow, `reach out to ${p.name}`, p)} onDraftFor={p => startWork(workRow, { verb: 'draft_email', person: p })} />
  );
  const table = (
    <div className="td-card" style={{ overflow: 'hidden' }}>
      <table data-today-table>
        <colgroup>{COLS.filter((_, i) => canEdit || ![1, 8, 9].includes(i)).map((w, i) => <col key={i} style={w ? { width: w } : undefined} />)}</colgroup>
        <thead><tr>
          <th scope="col"><span className="td-lbl">#</span></th>
          {canEdit && <th><span className="ui-sr-only">Done</span></th>}
          {['Task', 'Company', 'Person', 'Owner', 'Due', 'From'].map(h => <th key={h} scope="col"><span className="td-lbl">{h}</span></th>)}
          {canEdit && <th scope="col"><span className="td-gen">Scout can</span></th>}
          {canEdit && <th><span className="ui-sr-only">More</span></th>}
        </tr></thead>
        <tbody>
          {groups.filter(g => g.n > 0 || g.id !== 'visited').map(g => (
            <GroupRows key={g.id} g={g} span={canEdit ? 10 : 7} open={groupOpen(g)} onToggle={g.id === 'rest' ? () => setRestOpen(o => !o) : null} fold={tail(g)}>
              {groupOpen(g) && visible(g).map(row => (<Fragment key={row.key}>
                <tr data-today-row={row.key} data-kind={row.kind} className={work?.key === row.key ? 'td-on' : undefined}>
                  <td className="td-rk td-num" style={{ padding: '0 6px' }}>{num(row)}</td>
                  {canEdit && <td style={{ padding: '0 4px' }}>{row.kind === 'todo' && <Check row={row} onDone={() => done(row)} />}</td>}
                  <td title={row.text}><span className="td-task">{row.text}</span></td>
                  <td><CompanyCell company={row.company} /></td>
                  <td><PersonCell person={row.person} /></td>
                  <td><OwnerCell row={row} lookup={lookup} /></td>
                  <td><DueCell row={row} today={today} canEdit={canEdit} onSetDate={e => setDate(row, e)} /></td>
                  <td><FromCell source={row.source} /></td>
                  {canEdit && <td style={{ padding: '0 4px 0 10px' }}><Verb row={row} open={work?.key === row.key} onClick={() => toggleWork(row)} /></td>}
                  {canEdit && <td style={{ padding: '0 8px' }}>{editable(row) && <MoreButton row={row} open={menu?.key === row.key} onClick={e => openMenu(row, e)} />}</td>}
                </tr>
                {work?.key === row.key && <tr data-today-work={row.key}><td colSpan={10} className="td-wk">{panel}</td></tr>}
              </Fragment>))}
            </GroupRows>
          ))}
        </tbody>
      </table>
    </div>
  );
  const phone = groups.filter(g => g.n > 0).map(g => (
    <section key={g.id} aria-label={g.label} data-today-group={g.id} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2 className="td-lbl td-gh" style={{ fontWeight: 500 }}>
        {g.id === 'rest' ? <button type="button" className="td-link" aria-expanded={groupOpen(g)} onClick={() => setRestOpen(o => !o)} style={{ color: 'inherit' }}>{groupOpen(g) ? '▾' : '▸'} {g.label}</button> : g.label} · <span className="td-num">{g.n}</span>
      </h2>
      {groupOpen(g) && visible(g).map(row => (
        <article key={row.key} className="td-card td-pcard" data-today-row={row.key} data-kind={row.kind}>
          <div style={{ display: 'flex', gap: 10 }}><span className="td-num td-rk" style={{ fontSize: 13, marginTop: 1 }}>{num(row)}</span><div className="td-task">{row.text}</div></div>
          {(row.company || row.person) && <div className="td-pline"><span className="co">{row.company ? <CompanyCell company={row.company} /> : null}</span>{row.person && <span><PersonCell person={row.person} /></span>}</div>}
          <div className="td-pline"><OwnerCell row={row} lookup={lookup} /><DueCell row={row} today={today} canEdit={canEdit} onSetDate={e => setDate(row, e)} /><FromCell source={row.source} /></div>
          {canEdit && (
            <div className="td-pact">
              <Verb row={row} open={work?.key === row.key} onClick={() => toggleWork(row)} />
              {row.kind === 'todo' && <button type="button" className="td-dn" onClick={() => done(row)} aria-label={`Done: ${row.text}`} data-today-done><Icon d={CHECK} />Done</button>}
              {editable(row) && <MoreButton row={row} open={menu?.key === row.key} onClick={e => openMenu(row, e)} />}
            </div>
          )}
        </article>
      ))}
      {groupOpen(g) && tail(g)}
    </section>
  ));

  return (
    <div className={`td${compact ? ' td-ph' : ''}`} data-today={owner} data-today-viewer={canEdit ? undefined : ''}>
      <style>{TODAY_CSS}</style>
      {error && <ErrorNote message={error} />}
      <Strip strip={data.strip} five={data.five} open={stripOpen} onToggle={toggleStrip} onRemove={canFive ? s => run({ verb: 'five_remove', rows: [{ entity: 'todos', id: s.todo_id, title: s.text }], instant: true }) : null} />
      {bar}
      <div className="td-note" data-today-count>Showing <b className="td-num" style={{ color: 'var(--sa-text)', fontWeight: 500 }}>{counts.shown}</b> of <span className="td-num">{counts.team}</span> open · ranked for you, not sortable</div>
      {dateCard}
      {!workRow && card}
      {empty}
      {rows.length > 0 && (compact ? phone : table)}
      <section className="td-card td-rule" aria-label="How this is ranked"><span className="td-lbl">How this is ranked</span><span className="td-note">{data.rule}</span></section>
      {menuRow && <RowMenu key={`${menu.key}:${menu.sub || ''}`} row={menuRow} anchor={menu.anchor} today={today} members={members} initial={menu.sub} canFive={canFive} onPick={p => pick(menuRow, p)} onClose={closeMenu} />}
      {compact && panel}
      {compose && <ComposePanel businessId={businessId} row={compose} onClose={() => setCompose(null)} onToast={t => setCopied({ text: t.text })} />}
      <Toast state={actions.state} copied={copied} onUndo={actions.undo} onClose={actions.dismiss} onCopiedClose={() => setCopied(null)} />
    </div>
  );
}

function GroupRows({ g, span, open, onToggle, fold, children }) {
  return (
    <>
      <tr className="td-g" data-today-group={g.id}>
        <td colSpan={span}>
          {onToggle ? <button type="button" className="td-link" aria-expanded={open} onClick={onToggle} style={{ color: 'inherit', fontWeight: 600 }}>{open ? '▾' : '▸'} {g.label}</button> : g.label}
          <span className="c td-num">{g.n}</span><span className="c">{g.note}{g.collapsed && !open ? ' · collapsed' : ''}</span>
        </td>
      </tr>
      {children}
      {open && fold && <tr className="td-more"><td colSpan={span}>{fold}</td></tr>}
    </>
  );
}
