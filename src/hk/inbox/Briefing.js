import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../HkMarks';
import { HeatChip } from '../signals/Heat';
import SignalsPanel from '../signals/SignalsPanel';
import { hkGet, hkPost } from '../hkApi';
import { fmtDate } from './inboxPrefs';
import SendRow from './SendRow';
import { useBrandCommands } from '../brands/QuickCommands';
import { batchCommand } from '../brands/labelRules';

// grow-inbox-intel-v1 REV3 B1 + grow-ui-refresh-v1 U5 - the Inbox's first lane, built to mockup 1: one status strip
// (zero counts small and grey, non-zero ones as chips that jump to their list; sent / reply rate / research spend on the
// right), "Send these 10" as ranked full-width rows (U1-U4) with a segmented filter, Research the n (estimate first,
// J8) and Copy batch command, the sheet-list line, and a 340 px right rail: Important now (the top 7 Needs-you rows
// of the list the Inbox already loaded), Waiting on them (Bump when due opens Today's follow-ups; never sends) and
// Signals. One read (GET briefing); 0 Gmail calls of its own.
export const IMPORTANT_N = 7;
export const importantNow = rows => rows.filter(t => t.lane === 'needs_you' && t.importance).sort((a, b) => b.importance.score - a.importance.score).slice(0, IMPORTANT_N);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const money = n => `$${Number(n || 0).toFixed(2)}`;
export const FILTERS = [['pitch', 'Ready to pitch'], ['research', 'Needs research'], ['add_email', 'Needs email']];

function StatusStrip({ t, R, onGo, onLane }) {
  const items = [['replies', 'Replies', t.replies_waiting, () => onGo('replies')], ['hot', 'Hot', t.hot, () => onGo('replies')], ['drafts', 'Drafts', t.drafts, () => onGo('drafts')], ['followups', 'Follow-ups', t.followups_due, () => onGo('today')], ['dms', 'DMs', t.dms_due, () => onGo('today')]];
  const waiting = items.some(([, , n]) => n > 0);
  return (
    <div className="hk-strip-bar" role="group" aria-label="Today in numbers" data-hk-status-strip>
      {!waiting && <span className="hk-label hk-label--green" data-hk-nothing-waiting><Icon name="check" size={13} /> Nothing waiting on you</span>}
      {items.map(([id, label, n, go]) => (n > 0
        ? <button key={id} type="button" className="hk-btn hk-label hk-label--orange hk-strip-bar__chip" onClick={go} data-hk-tile={id}>{label} {n}</button>
        : <span key={id} className="hk-strip-bar__zero" data-hk-tile={id}>{label} <strong>0</strong></span>))}
      <span className="hk-spacer" />
      <button type="button" className="hk-btn hk-strip-bar__stat" onClick={() => onLane('sent')} data-hk-tile="sent">Sent this week <strong>{t.sent_week}</strong></button>
      {t.reply_rate_week != null && <span className="hk-strip-bar__stat" data-hk-tile="rate">Reply rate <strong>{t.reply_rate_week}%</strong></span>}
      <span className="hk-strip-bar__stat" data-hk-tile="researched">Researched today <strong>{t.researched_today.n}/{t.researched_today.cap}</strong> <span className="hk-meta">{money(R.today_spend)} of {money(R.cap_usd)}</span></span>
    </div>
  );
}

export default function Briefing({ businessId, shell, owner, canEdit, rows, listReady, onOpenThread, onOpenBrand, onGo, onLane, onSignalsSeen }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [filter, setFilter] = useState(null);
  const [open, setOpen] = useState(undefined);
  const [selected, setSelected] = useState(() => new Set());
  const [batch, setBatch] = useState(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const listRef = useRef(null);
  const meId = shell?.me?.user_id;
  const members = shell?.members || [];
  const load = useCallback(async () => {
    try { setData(await hkGet(businessId, '/briefing', { owner: owner || 'me' })); setError(''); } catch (e) { setError(e.message); }
  }, [businessId, owner]);
  useEffect(() => { load(); }, [load]);
  const cmd = useBrandCommands({ businessId, onChanged: load, setError: setNote });
  const send = useMemo(() => data?.send || [], [data]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([k]) => [k, send.filter(c => c.primary?.kind === k).length])), [send]);
  // Row 1 opens by default when it has research; after that the person decides (undefined = not chosen yet).
  const openId = open === undefined ? (send[0]?.research ? send[0].id : null) : open;
  if (error && !data) return <p className="hk-error" role="alert">{error}</p>;
  if (!data) return <p className="hk-meta">Loading the briefing…</p>;
  const t = data.tiles, imp = importantNow(rows || []), R = data.research;
  const shown = filter ? send.filter(c => c.primary?.kind === filter) : send;
  const pool = selected.size ? send.filter(c => selected.has(c.id)) : send;
  const needResearch = pool.filter(c => c.primary?.kind === 'research');
  const ready = pool.filter(c => c.primary?.kind === 'pitch');
  const select = id => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const move = (from, step) => { const els = [...(listRef.current?.querySelectorAll('[data-hk-send-row]') || [])]; els[Math.max(0, Math.min(els.length - 1, from + step))]?.focus(); };
  const estimate = async () => {
    setBatchBusy(true); setNote('');
    try { const r = await hkPost(businessId, '/research/batch', { brand_ids: needResearch.slice(0, 10).map(c => c.id) }); setBatch(r.estimate); } catch (e) { setNote(e.message); } finally { setBatchBusy(false); }
  };
  // One brand per request (a 10-brand run can pass a server's 5-minute request limit); the server still checks the
  // click cap and the day's dollar cap on every one, and the run stops at the first stop or error.
  const runBatch = async () => {
    setBatchBusy(true);
    const results = []; let stopped = null;
    try {
      for (const c of needResearch.slice(0, 10)) {
        setNote(`Researching ${c.name} (${results.length + 1} of ${Math.min(10, needResearch.length)})…`);
        const r = await hkPost(businessId, '/research/batch', { brand_ids: [c.id], confirm: true });
        results.push(...r.results);
        if (r.stopped) { stopped = r.stopped; break; }
      }
    } catch (e) { stopped = e.message; }
    const found = results.filter(x => x.status === 'researched').length, none = results.filter(x => x.status === 'not_found').length;
    const cost = results.reduce((n, x) => n + (x.cost_usd || 0), 0);
    setNote(`Researched ${plural(found, 'brand')}${none ? `, no website found for ${none}` : ''} (${money(cost)})${stopped ? `. Stopped: ${stopped}` : ''}.`);
    setBatch(null); setSelected(new Set()); setBatchBusy(false); await load();
  };
  const copyBatch = async () => { const text = batchCommand(ready); try { await navigator.clipboard.writeText(text); setNote(`Copied ${text}. Paste into Claude.`); } catch { setNote(`Copy failed. The command is: ${text}`); } };
  return (
    <div className="hk-briefing" data-hk-briefing>
      <StatusStrip t={t} R={R} onGo={onGo} onLane={onLane} />
      <div className="hk-brief__grid">
        <section className="hk-brief__main" aria-label="Send these 10" data-hk-section="send">
          <div className="hk-brief__head">
            <div className="hk-brief__titles">
              <h2 className="hk-brief__title">Send these {send.length}</h2>
              <p className="hk-meta hk-brief__sub" data-hk-research-line>Best of {data.eligible.toLocaleString('en-US')} you can pitch. Ranked by target, contact, fit and timing. Auto-research {R.on ? `on: up to ${R.n} a day by ${R.time}, ${money(R.cap_usd)} cap` : 'off'}.</p>
            </div>
            <div className="hk-seg" role="group" aria-label="Show">
              {FILTERS.map(([k, label]) => <button key={k} type="button" className="hk-btn hk-seg__btn" aria-pressed={filter === k} onClick={() => setFilter(f => (f === k ? null : k))} data-hk-filter={k}>{label} {counts[k]}</button>)}
            </div>
            {canEdit && <button type="button" className="hk-btn hk-chipbtn" disabled={batchBusy || !needResearch.length} onClick={estimate} data-hk-research-batch><Icon name="search" size={15} /> Research the {Math.min(10, needResearch.length)}</button>}
            {canEdit && <button type="button" className="hk-btn hk-primary" disabled={!ready.length} onClick={copyBatch} data-hk-copy-batch><Icon name="copy" size={15} /> Copy batch command ({ready.length})</button>}
          </div>
          {batch && (
            <div className="hk-bulk" role="alertdialog" aria-label="Research these brands?" data-hk-batch-confirm>
              <span>Research {plural(batch.n, 'brand')} · {batch.words}. One research each; it stops at the daily {money(R.cap_usd)} cap.</span>
              <button type="button" className="hk-btn hk-primary" disabled={batchBusy} onClick={runBatch} data-hk-batch-run>{batchBusy ? 'Researching…' : `Research ${batch.n}`}</button>
              <button type="button" className="hk-btn hk-link" disabled={batchBusy} onClick={() => setBatch(null)}>Cancel</button>
            </div>
          )}
          {note && <p className="hk-note" role="status" data-hk-briefing-note>{note}</p>}
          {shown.length ? (
            <ol className="hk-srows" ref={listRef}>
              {shown.map(c => {
                const i = send.indexOf(c);
                return <SendRow key={c.id} c={c} i={i} open={openId === c.id} onToggle={() => setOpen(openId === c.id ? null : c.id)} selected={selected.has(c.id)} onSelect={select} canEdit={canEdit} meId={meId} members={members} cmd={cmd} onOpenBrand={onOpenBrand} onGo={onGo} businessId={businessId} onChanged={load} setNote={setNote} onMove={step => move(shown.indexOf(c), step)} />;
              })}
            </ol>
          ) : <p className="hk-meta">{filter ? 'None of these 10 right now.' : 'No brand you can pitch right now.'}</p>}
          {(data.sheet_skipped || []).map(s => <p key={s.hint} className="hk-meta" data-hk-sheet-skipped={s.hint}>{s.n === 1 ? `1 brand is on ${s.hint}'s sheet list. It stays` : `${s.n.toLocaleString('en-US')} brands are on ${s.hint}'s sheet list. They stay`} out of your 10 until {s.hint} claims {s.n === 1 ? 'it' : 'them'} or you take one.</p>)}
        </section>
        <aside className="hk-brief__rail" aria-label="Right now">
          <section className="hk-rcard" aria-label="Important now" data-hk-section="important">
            <h2 className="hk-rcard__title">Important now <span className="hk-meta">{listReady ? imp.length : ''}</span></h2>
            {!listReady ? <p className="hk-meta">Reading your Gmail…</p> : imp.length ? (
              <div className="hk-rcard__rows">{imp.map(r => (
                <button key={r.thread_id} type="button" className="hk-btn hk-rcard__row" onClick={() => onOpenThread(r.thread_id)} data-hk-important={r.thread_id}>
                  <span className="hk-rcard__line"><strong>{r.from_name}</strong>{r.importance.why && <span className="hk-label hk-label--orange">{r.importance.why}</span>}</span>
                  <span className="hk-meta">{r.subject} · {fmtDate(r.date)}</span>
                </button>))}</div>
            ) : <p className="hk-meta">Nobody is waiting on you on this page.</p>}
          </section>
          <section className="hk-rcard" aria-label="Waiting on them" data-hk-section="waiting">
            <h2 className="hk-rcard__title">Waiting on them <span className="hk-meta">{data.waiting.length}</span></h2>
            {data.waiting.length ? (
              <div className="hk-rcard__rows">{data.waiting.map(w => (
                <div key={w.id} className="hk-rcard__wait" data-hk-waiting-on={w.id}>
                  <button type="button" className="hk-btn hk-rcard__name" onClick={() => onOpenBrand(w.id)}>{w.name}</button>
                  <HeatChip band={w.heat_band} />
                  <span className={w.due ? 'hk-rcard__days hk-rcard__days--due' : 'hk-meta'}>{plural(w.waiting_days, 'day')}</span>
                  {w.due
                    ? <button type="button" className="hk-btn hk-link" onClick={() => onGo('today')} title="Opens Today's follow-ups; nothing sends" data-hk-bump={w.id}>Bump</button>
                    : <button type="button" className="hk-btn hk-link" onClick={() => onOpenBrand(w.id)} data-hk-open-waiting={w.id}>Open</button>}
                </div>))}</div>
            ) : <p className="hk-meta">No sent email is waiting on a reply.</p>}
          </section>
          <SignalsPanel businessId={businessId} canEdit={canEdit} onOpenBrand={onOpenBrand} onGo={onGo} onSeen={onSignalsSeen} />
        </aside>
      </div>
      {cmd.node}
    </div>
  );
}
