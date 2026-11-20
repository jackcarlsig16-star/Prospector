import { useCallback, useEffect, useRef, useState } from 'react';
import { goalsApi, TODOS_CHANGED } from '../goalsApi';
import { ErrorNote } from '../goalsUi';
import { ConfirmCard } from '../../../scout/ScoutActionCard';
import { useTodayActions } from './useTodayActions';
import { TODAY_CSS } from './todayStyles';
import { SOURCE, SOURCE_IDS, scoutRow, todayQuery, bulkDates, dayWords } from './todayRows';
import { Strip, CompanyCell, PersonCell, OwnerCell, DueCell, FromCell, Verb, Check, MoreButton, RowMenu, Toast, Icon, CHECK } from './TodayParts';

// actions-v2 Stage 2 - Actions is "Today": ONE ranked list (GET goals/today - the server groups and ranks; this
// screen never sorts). Five groups, a row once, in the first it fits; This week's five above; chips Mine / Team /
// Overdue / Undated / Snoozed, the Source select and search narrow it. A Member's check circle and ⋯ menu go through
// Scout's plan -> act -> undo (useTodayActions); a Viewer gets the same list with no Done, no ⋯ and no verb.
// The verb on each row is what Scout's work panel will do there (Stage 3).
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
  const seq = useRef(0);

  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 250); return () => clearTimeout(t); }, [search]);
  const load = useCallback(() => {
    const mine = ++seq.current;
    return goalsApi.today(businessId, todayQuery({ owner, chip, source, q }))
      .then(d => { if (mine === seq.current) { setData(d); setError(''); } })
      .catch(e => { if (mine === seq.current) setError(e.message); });
  }, [businessId, owner, chip, source, q]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { window.addEventListener(TODOS_CHANGED, load); return () => window.removeEventListener(TODOS_CHANGED, load); }, [load]);
  const actions = useTodayActions({ businessId, onChanged: load });
  const closeMenu = useCallback(() => setMenu(null), []);

  if (!data) return <div className="td"><style>{TODAY_CSS}</style>{error ? <ErrorNote message={error} /> : <p className="td-note" role="status">Loading today…</p>}</div>;

  const { groups, counts, today } = data;
  const members = data.members || [];
  const rows = groups.flatMap(g => g.rows);
  const pick = (row, p, instant = true) => { setMenu(null); actions.run({ verb: p.verb, rows: [scoutRow(row)], args: p.args, instant, say: p.say }); };
  const done = row => pick(row, { verb: 'task_done', args: {}, say: {} });
  const toggleStrip = () => setStripOpen(o => { try { localStorage.setItem(STRIP_KEY, o ? '0' : '1'); } catch { /* private mode */ } return !o; });
  const filtered = !!(chip || source || q);
  const clear = () => { setChip(null); setSource(''); setSearch(''); };
  const undated = rows.filter(r => r.kind === 'todo' && !r.due);
  const dateAll = date => actions.run({ verb: 'task_due', rows: undated.slice(0, 25).map(scoutRow), args: { date }, say: { date } });
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
  const card = actions.state?.kind === 'card' && (
    <div className="td-card td-confirm" data-today-card><ConfirmCard card={actions.state.card} onConfirm={actions.confirm} onCancel={actions.dismiss} /><p className="td-note" style={{ margin: '8px 0 0' }}>One batch. Undo puts every row back.</p></div>
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
            <GroupRows key={g.id} g={g} span={canEdit ? 10 : 7} open={groupOpen(g)} onToggle={g.id === 'rest' ? () => setRestOpen(o => !o) : null} fold={foldLine(g)}>
              {groupOpen(g) && visible(g).map(row => (
                <tr key={row.key} data-today-row={row.key} data-kind={row.kind}>
                  <td className="td-rk td-num" style={{ padding: '0 6px' }}>{row.rank}</td>
                  {canEdit && <td style={{ padding: '0 4px' }}>{row.kind === 'todo' && <Check row={row} onDone={() => done(row)} />}</td>}
                  <td title={row.text}><span className="td-task">{row.text}</span></td>
                  <td><CompanyCell company={row.company} /></td>
                  <td><PersonCell person={row.person} /></td>
                  <td><OwnerCell row={row} lookup={lookup} /></td>
                  <td><DueCell row={row} today={today} canEdit={canEdit} onSetDate={e => setDate(row, e)} /></td>
                  <td><FromCell source={row.source} /></td>
                  {canEdit && <td style={{ padding: '0 4px 0 10px' }}><Verb verb={row.verb} /></td>}
                  {canEdit && <td style={{ padding: '0 8px' }}>{editable(row) && <MoreButton row={row} open={menu?.key === row.key} onClick={e => openMenu(row, e)} />}</td>}
                </tr>
              ))}
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
          <div style={{ display: 'flex', gap: 10 }}><span className="td-num td-rk" style={{ fontSize: 13, marginTop: 1 }}>{row.rank}</span><div className="td-task">{row.text}</div></div>
          {(row.company || row.person) && <div className="td-pline"><span className="co">{row.company ? <CompanyCell company={row.company} /> : null}</span>{row.person && <span><PersonCell person={row.person} /></span>}</div>}
          <div className="td-pline"><OwnerCell row={row} lookup={lookup} /><DueCell row={row} today={today} canEdit={canEdit} onSetDate={e => setDate(row, e)} /><FromCell source={row.source} />{canEdit && <Verb verb={row.verb} />}</div>
          {editable(row) && (
            <div className="td-pact">
              {row.kind === 'todo' && <button type="button" className="td-dn" onClick={() => done(row)} aria-label={`Done: ${row.text}`} data-today-done><Icon d={CHECK} />Done</button>}
              <MoreButton row={row} open={menu?.key === row.key} onClick={e => openMenu(row, e)} />
            </div>
          )}
        </article>
      ))}
      {groupOpen(g) && foldLine(g)}
    </section>
  ));

  return (
    <div className={`td${compact ? ' td-ph' : ''}`} data-today={owner} data-today-viewer={canEdit ? undefined : ''}>
      <style>{TODAY_CSS}</style>
      {error && <ErrorNote message={error} />}
      <Strip strip={data.strip} five={data.five} open={stripOpen} onToggle={toggleStrip} />
      {bar}
      <div className="td-note" data-today-count>Showing <b className="td-num" style={{ color: 'var(--sa-text)', fontWeight: 500 }}>{counts.shown}</b> of <span className="td-num">{counts.team}</span> open · ranked for you, not sortable</div>
      {dateCard}
      {card}
      {empty}
      {rows.length > 0 && (compact ? phone : table)}
      <section className="td-card td-rule" aria-label="How this is ranked"><span className="td-lbl">How this is ranked</span><span className="td-note">{data.rule}</span></section>
      {menuRow && <RowMenu key={`${menu.key}:${menu.sub || ''}`} row={menuRow} anchor={menu.anchor} today={today} members={members} initial={menu.sub} onPick={p => pick(menuRow, p)} onClose={closeMenu} />}
      <Toast state={actions.state} onUndo={actions.undo} onClose={actions.dismiss} />
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
