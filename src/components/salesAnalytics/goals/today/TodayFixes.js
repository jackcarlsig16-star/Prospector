import { useCallback, useEffect, useState } from 'react';
import { goalsApi, TODOS_CHANGED } from '../goalsApi';
import { ConfirmCard } from '../../../scout/ScoutActionCard';
import { useTodayActions } from './useTodayActions';
import { TODAY_CSS } from './todayStyles';
import { bulkDates, dayWords, REVIEW_NOTE } from './todayRows';

// actions-v2 A4 - "Fix the list": the top of the Needs attention drawer. At most five fixes, worst first (GET
// goals/today/fixes, computed when the drawer opens). Every button is one of Scout's verbs: it shows Scout's confirm
// card with each row listed, Confirm writes the batch, and the done line carries one Undo. A Viewer reads the list.
// A failed feed is a fix too: it sits on top, in red. onCount(n, feeds): the drawer adds n to the number on its button
// - the fixes that are NOT feeds, since the drawer counts a failed feed itself (once) - and shows the feeds under them.
export default function TodayFixes({ businessId, canEdit, onCount }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [dating, setDating] = useState(null);
  const load = useCallback(() => goalsApi.todayFixes(businessId).then(d => { setData(d); setError(''); onCount?.(d.items.filter(i => !i.id.startsWith('feed:')).length, d.feeds || []); }).catch(e => setError(e.message)), [businessId, onCount]);
  useEffect(() => { load(); }, [load]);
  const actions = useTodayActions({ businessId, onChanged: () => { load(); window.dispatchEvent(new Event(TODOS_CHANGED)); } });
  const s = actions.state;
  if (error) return <p className="td-note" role="alert">Fix the list: {error}</p>;
  if (!data) return <p className="td-note" role="status">Checking the list…</p>;
  const run = (fix, args = {}, say = {}) => {
    setDating(null);
    // a call to review is not one of Scout's verbs: the list opens the Intake review on the newest one
    if (fix.action.review) { window.dispatchEvent(new CustomEvent(REVIEW_NOTE, { detail: { noteId: fix.action.review } })); return; }
    actions.run({ verb: fix.action.verb, rows: fix.action.rows, args, say });
  };
  return (
    <section aria-label="Fix the list" className="td" data-today-fixes style={{ gap: 0, maxWidth: 'none' }}>
      <style>{TODAY_CSS}</style>
      <h3 className="ui-group-label" style={{ margin: '8px 0 0' }}>Fix the list</h3>
      <p className="td-note" style={{ margin: '4px 0 8px' }}>{data.items.length ? `The ${data.items.length === 1 ? 'one thing' : `${data.items.length} things`} most worth fixing, worst first. Never more than five.` : 'Nothing to fix.'}</p>
      {data.items.map(fix => (
        <div key={fix.id} className="td-fix" data-today-fix={fix.id}>
          <b className={fix.id.startsWith('feed:') ? 'td-bad' : undefined}>{fix.title}</b>
          <span className="td-note">{fix.note}</span>
          {canEdit && fix.action && (
            <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {fix.action.needs === 'date' && dating === fix.id
                ? <>{bulkDates(data.today || new Date().toISOString().slice(0, 10)).map(d => <button key={d} type="button" className="td-btn" onClick={() => run(fix, { date: d }, { date: d })}>{dayWords(d)}</button>)}
                  <input type="date" className="td-date" aria-label="Pick a date" style={{ margin: 0 }} onChange={e => e.target.value && run(fix, { date: e.target.value }, { date: e.target.value })} /></>
                : <button type="button" className="td-btn" disabled={s?.kind === 'busy'} onClick={() => (fix.action.needs === 'date' ? setDating(fix.id) : run(fix))} data-today-fix-run>{fix.action.label}</button>}
            </span>
          )}
        </div>
      ))}
      {s?.kind === 'card' && <div className="td-card td-confirm" data-today-card style={{ marginTop: 8 }}><ConfirmCard card={s.card} onConfirm={actions.confirm} onCancel={actions.dismiss} /><p className="td-note" style={{ margin: '8px 0 0' }}>One batch. Undo puts every row back.</p></div>}
      {s && s.kind !== 'card' && (
        <p className="td-note" role="status" data-today-fix-line style={{ margin: '8px 0 0', color: 'var(--sa-text)' }}>
          {s.kind === 'busy' ? 'Working…' : s.kind === 'note' ? s.text : s.line}
          {s.kind === 'done' && !s.undone && s.left > 0 && <> <button type="button" className="td-link" onClick={actions.undo} data-today-undo>Undo <span className="td-num">{s.left} s</span></button></>}
        </p>
      )}
    </section>
  );
}
