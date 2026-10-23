import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { SA, SA_TYPE, SA_THEME_CLASS, SA_THEME_ROOT_ID, saSans } from '../theme';
import Button from '../../../ui/Button';
import Tag from '../../../ui/Tag';
import { goalsApi, OPEN_ATTENTION, OPEN_CONNECTIONS, OPEN_TASKS } from './goalsApi';
import { triggerSync } from '../salesApi';
import { openTasks } from '../tasks/LinkedTasks';
import { timeAgo } from '../huddleView';
import { ErrorNote, numStyle } from './goalsUi';

// actions-home-attention-v1 D2/D3/D5 - the "Needs attention (n)" / "All clear"
// button in the Actions frame row and its drawer: each sync source's state
// with the existing manual control beside it, the counts that need you (each
// opens the list it counts) and Paste call notes (the Tasks drawer's panel).
// One read (GET goals/attention); the drawer opening re-reads the held moves.
// A page-load pull / Tidy failure (pageLoadFailures, loop-quickfixes Q5) shows
// as Failed "on page load" until the source reports OK again. Viewers read.
const WIDTH = 380;
const STATUS = { ok: ['OK', SA.good], stale: ['Stale', SA.warn], failed: ['Failed', SA.bad], running: ['Running', SA.accent], not_connected: ['Not connected', SA.borderStrong] };
const PAGE_LOAD = { apollo: 'apollo', visitors: 'visits', tidy: 'tidy' };
const ERR_SHOWN = 90;

export function withPageLoad(sources, failures = {}) {
  return sources.map(s => {
    const f = failures[PAGE_LOAD[s.id]];
    return f && s.status !== 'ok' && s.status !== 'running' ? { ...s, status: 'failed', error: `on page load: ${f}` } : s;
  });
}
export const attentionN = (sources, counts) => sources.filter(s => s.status === 'stale' || s.status === 'failed').length + Object.values(counts).filter(n => n > 0).length;

async function syncOutlook() {
  const r = await fetch('/api/microsoft/sync', { method: 'POST' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Outlook sync failed (${r.status})`);
  return d;
}

function SourceLine({ s, canEdit, busy, onRun }) {
  const [label, tone] = STATUS[s.status] || STATUS.ok;
  const [more, setMore] = useState(false);
  const control = { apollo: 'Sync now', outlook: 'Sync Outlook', visitors: 'Pull now', tidy: 'Tidy now' }[s.id];
  const long = s.error && s.error.length > ERR_SHOWN;
  return (
    <li data-source={s.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 0', borderTop: `1px solid ${SA.track}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 32 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: SA.text, flex: '1 1 auto', minWidth: 0 }}>{s.label}</span>
        <Tag color={tone}>{label}</Tag>
        {canEdit && control && s.status !== 'not_connected' && <Button size="sm" disabled={busy || s.status === 'running'} disabledReason={s.status === 'running' ? 'Running now' : 'Working…'} onClick={() => onRun(s.id)}>{busy ? 'Working…' : control}</Button>}
      </div>
      <span style={{ fontSize: 12, color: SA.soft, ...numStyle }}>
        {s.status === 'not_connected'
          ? <>Not connected — <button type="button" className="ui-link" onClick={() => window.dispatchEvent(new Event(OPEN_CONNECTIONS))}>Connections</button></>
          : s.last_at ? `last ${timeAgo(s.last_at)}` : 'no run yet'}
        {s.left > 0 && <> · <span data-backlog style={{ color: SA.warn }}>{s.left} message{s.left === 1 ? '' : 's'} left</span>{canEdit && s.status !== 'running' && <> — <button type="button" className="ui-link" disabled={busy} onClick={() => onRun(s.id)}>Sync again</button></>}</>}
      </span>
      {s.error && (
        <span role="note" title={s.error} style={{ fontSize: 12, color: SA.bad, overflowWrap: 'anywhere' }}>
          {long && !more ? `${s.error.slice(0, ERR_SHOWN)}…` : s.error}
          {long && <> <button type="button" className="ui-link" onClick={() => setMore(m => !m)}>{more ? 'less' : 'more'}</button></>}
        </span>
      )}
    </li>
  );
}

const COUNT_LINES = [
  ['overdue_todos', 'Your overdue to-dos', 'tasks'],
  ['overdue_waiting', 'Overdue waiting-on', 'waiting'],
  ['campaign_sends', 'Your campaign sends due', 'campaigns'],
  ['campaign_replies', 'Campaign replies to answer', 'campaigns'],
  ['held_apollo', 'Held Apollo moves', 'partners'],
  ['held_outlook', 'Held Outlook moves', 'partners'],
];

export default function AttentionDrawer({ businessId, canEdit, compact, pageLoadFailures, onNav }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(fresh => goalsApi.attention(businessId, { fresh }).then(d => { setData(d); setError(''); }).catch(e => setError(e.message)), [businessId]);
  useEffect(() => { load(false); }, [load]);
  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener(OPEN_TASKS, close);
    return () => window.removeEventListener(OPEN_TASKS, close);
  }, []);
  useEffect(() => {
    if (!open) return undefined;
    const esc = e => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);

  const show = () => { window.dispatchEvent(new Event(OPEN_ATTENTION)); setOpen(true); setNote(''); load(true); };
  const run = async id => {
    setBusy(id); setNote('');
    try {
      if (id === 'apollo') await triggerSync(businessId);
      else if (id === 'outlook') await syncOutlook();
      else if (id === 'visitors') await goalsApi.visitPull(businessId, { force: true });
      else if (id === 'tidy') await goalsApi.runTidy(businessId, { force: true });
      setNote(`${data.sources.find(s => s.id === id).label}: done`);
    } catch (e) { setNote(`${data.sources.find(s => s.id === id).label}: ${e.message}`); }
    finally { setBusy(null); await load(true); }
  };
  const go = target => {
    setOpen(false);
    if (target === 'tasks') openTasks({ link: null, filter: 'me' });
    else if (target === 'waiting') openTasks({ link: null, filter: 'team', view: 'waiting' });
    else onNav('pipeline', target);
  };

  const sources = data ? withPageLoad(data.sources, pageLoadFailures) : [];
  const n = data ? attentionN(sources, data.counts) : 0;
  const button = !data
    ? <Button variant="tertiary" disabled disabledReason="Checking…">Checking…</Button>
    : n
      ? <Button aria-haspopup="dialog" aria-expanded={open} onClick={show}>Needs attention ({n})</Button>
      : <Button variant="tertiary" aria-haspopup="dialog" aria-expanded={open} onClick={show}>All clear</Button>;
  const root = document.getElementById(SA_THEME_ROOT_ID) || document.body;

  return (
    <>
      <span data-attention-button style={{ flex: 'none', display: 'inline-flex' }}>{button}</span>
      {open && createPortal(
        <>
          {compact && <div onClick={() => setOpen(false)} className="no-print" style={{ position: 'fixed', inset: 0, background: '#000a', zIndex: 4001 }} />}
          <aside className={`${SA_THEME_CLASS} no-print`} role="dialog" aria-modal={compact ? true : undefined} aria-labelledby="attention-drawer-title" data-attention-drawer
            style={{ ...saSans, position: 'fixed', top: 0, right: 0, bottom: 0, width: compact ? '100vw' : WIDTH, maxWidth: '100vw', boxSizing: 'border-box', zIndex: 4002, background: SA.ground, color: SA.text, borderLeft: `1px solid ${SA.border}`, display: 'flex', flexDirection: 'column', boxShadow: '-12px 0 32px rgba(0,0,0,0.35)' }}>
            <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 12px 12px 16px', borderBottom: `1px solid ${SA.border}` }}>
              <h2 id="attention-drawer-title" style={{ ...SA_TYPE.cardTitle, fontSize: 17, margin: 0, color: SA.text }}>{n ? `Needs attention (${n})` : 'All clear'}</h2>
              <div style={{ flex: 1 }} />
              <Button className="ui-btn--icon" onClick={() => setOpen(false)} aria-label="Close needs attention" style={{ width: 36, height: 36, fontSize: 20 }}>×</Button>
            </header>
            <div style={{ flex: '1 1 auto', overflowY: 'auto', padding: '8px 16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {error && <ErrorNote message={error} />}
              {!canEdit && <p style={{ fontSize: 13, color: SA.muted, margin: 0 }}>You have view access, so this is read-only.</p>}
              <section aria-label="Sync status">
                <h3 className="ui-group-label" style={{ margin: '8px 0 0' }}>Sync status</h3>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {sources.map(s => <SourceLine key={s.id} s={s} canEdit={canEdit} busy={busy === s.id} onRun={run} />)}
                </ul>
                {note && <p role="status" style={{ fontSize: 12, color: SA.soft, margin: '6px 0 0' }}>{note}</p>}
              </section>
              <section aria-label="Needs you">
                <h3 className="ui-group-label" style={{ margin: 0 }}>Needs you</h3>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {COUNT_LINES.map(([key, label, target]) => {
                    const c = data?.counts?.[key] ?? 0;
                    return (
                      <li key={key} data-count={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: `1px solid ${SA.track}`, fontSize: 14 }}>
                        <span style={{ flex: '1 1 auto', color: c ? SA.text : SA.soft }}>{label}</span>
                        {c
                          ? <button type="button" className="ui-link" style={numStyle} aria-label={`${label}: ${c} - open`} onClick={() => go(target)}>{c} →</button>
                          : <span style={{ ...numStyle, color: SA.soft }}>0</span>}
                      </li>
                    );
                  })}
                </ul>
              </section>
              {canEdit && (
                <section aria-label="Quick add">
                  <h3 className="ui-group-label" style={{ margin: '0 0 8px' }}>Quick add</h3>
                  <Button onClick={() => { setOpen(false); openTasks({ link: null, filter: 'me', paste: true }); }}>📝 Paste call notes</Button>
                </section>
              )}
            </div>
          </aside>
        </>, root)}
    </>
  );
}
