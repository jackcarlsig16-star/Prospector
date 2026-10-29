import React, { useCallback, useEffect, useState } from 'react';
import Button from '../../ui/Button';
import { Chip } from '../brands/BrandsScreen';
import { HeatChip } from '../signals/Heat';
import SignalsPanel from '../signals/SignalsPanel';
import { hkGet, hkPost, hkPatch } from '../hkApi';
import { fmtDate } from './inboxPrefs';

// grow-inbox-intel-v1 REV3 B1 - the Inbox's first lane. Tiles (today's numbers, each linking to its list), Send these
// 10 (B3 cards with the why, research, a found website + Use, Claim / Copy Claude command / Open brand / Research),
// Important now (the top 7 Needs-you rows of the list the Inbox already loaded, by B2), Waiting on them (B6), and the
// Signals panel (moved here from Today). One read (GET briefing); 0 Gmail calls of its own.
export const IMPORTANT_N = 7;
export const importantNow = rows => rows.filter(t => t.lane === 'needs_you' && t.importance).sort((a, b) => b.importance.score - a.importance.score).slice(0, IMPORTANT_N);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function Tile({ n, label, onClick, id }) {
  return (
    <button type="button" className="hk-btn hk-tile" onClick={onClick} disabled={!onClick} data-hk-tile={id}>
      <span className="hk-tile__n">{n}</span><span className="hk-tile__label">{label}</span>
    </button>
  );
}

function Card({ c, i, businessId, canEdit, meId, onOpenBrand, onChanged, setNote }) {
  const [busy, setBusy] = useState('');
  const [copied, setCopied] = useState(false);
  const run = async (what, fn) => { setBusy(what); try { await fn(); await onChanged(); } catch (e) { setNote(e.message); } finally { setBusy(''); } };
  const research = () => run('research', async () => {
    const r = await hkPost(businessId, `/brands/${c.id}/research`, { click: true });
    setNote(r.status === 'not_found' ? `No website found for ${c.name}. It is not retried for 30 days.` : r.status === 'cached' ? `${c.name} was researched recently; the saved research is shown.` : `${c.name}: ${r.suggested ? `website ${r.domain} (${r.confidence} confidence)` : r.domain} · ${String(r.intel?.fit?.sponsor_fit || 'unknown').replace(/_/g, ' ')} fit.`);
  });
  const use = () => run('use', async () => { await hkPost(businessId, `/brands/${c.id}/use-domain`, {}); setNote(`${c.name} now uses ${c.suggestion.domain}.`); });
  const claim = () => run('claim', async () => { await hkPatch(businessId, `/brands/${c.id}`, { claim: true }); setNote(`${c.name} is yours.`); });
  const copy = async () => { try { await navigator.clipboard.writeText(c.command); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setNote(`Copy failed. The command is: ${c.command}`); } };
  const facts = [c.category, c.city].filter(Boolean).join(' · ');
  return (
    <li className="hk-send__card" data-hk-send-card={c.id}>
      <div className="hk-send__top">
        <span className="hk-send__rank" aria-hidden="true">{i + 1}</span>
        <button type="button" className="hk-btn hk-table__title" onClick={() => onOpenBrand(c.id)}>{c.name}</button>
        <HeatChip band={c.heat_band} />
        <span className="hk-meta" data-hk-send-score>Score {c.score}</span>
      </div>
      {facts && <p className="hk-meta hk-send__line">{facts}</p>}
      <p className="hk-send__line" data-hk-send-why>{c.why.length ? c.why.join(' · ') : 'Nothing stands out yet'}</p>
      {c.research?.line && <p className="hk-meta hk-send__line" data-hk-send-research>{c.research.line}</p>}
      {c.suggestion && (
        <p className="hk-send__line" data-hk-send-site={c.suggestion.confidence}>
          {c.suggestion.confidence === 'high' ? `Website: ${c.suggestion.domain}` : `Possible website: ${c.suggestion.domain}?`}
          {canEdit && <> · <button type="button" className="hk-btn hk-link" disabled={!!busy} onClick={use} data-hk-use-site>Use</button></>}
        </p>
      )}
      {!c.research && c.research_attempted_at && <p className="hk-meta hk-send__line">No website found {fmtDate(c.research_attempted_at)}.</p>}
      <div className="hk-send__actions">
        {canEdit && !c.owner_user_id && <Button size="sm" variant="primary" disabled={!!busy} onClick={claim} data-hk-send-claim>Claim</Button>}
        {c.owner_user_id === meId && <Chip tone="green">Yours</Chip>}
        <Button size="sm" onClick={copy} data-hk-send-copy>{copied ? 'Copied' : 'Copy Claude command'}</Button>
        <Button size="sm" variant="tertiary" onClick={() => onOpenBrand(c.id)}>Open brand</Button>
        {canEdit && !c.research && !c.research_attempted_at && <Button size="sm" disabled={!!busy} onClick={research} data-hk-send-research-btn>{busy === 'research' ? 'Researching…' : 'Research'}</Button>}
      </div>
    </li>
  );
}

export default function Briefing({ businessId, shell, owner, canEdit, rows, listReady, onOpenThread, onOpenBrand, onGo, onLane, onSignalsSeen }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [sweeping, setSweeping] = useState(false);
  const meId = shell?.me?.user_id;
  const load = useCallback(async () => {
    try { setData(await hkGet(businessId, '/briefing', { owner: owner || 'me' })); setError(''); } catch (e) { setError(e.message); }
  }, [businessId, owner]);
  useEffect(() => { load(); }, [load]);
  const sweep = async () => {
    setSweeping(true); setNote('');
    try {
      const r = await hkPost(businessId, '/jobs/research-sweep', {});
      setNote(r.skipped ? `Research did not run: ${r.skipped}.` : `Researched ${plural(r.counts.calls, 'brand')} ($${r.counts.cost_usd.toFixed(2)})${r.counts.stopped ? `, stopped at the ${r.counts.stopped}` : ''}.`);
      await load();
    } catch (e) { setNote(e.message); } finally { setSweeping(false); }
  };
  if (error && !data) return <p className="hk-error" role="alert">{error}</p>;
  if (!data) return <p className="hk-meta">Loading the briefing…</p>;
  const t = data.tiles, imp = importantNow(rows || []), R = data.research;
  return (
    <div className="hk-briefing" data-hk-briefing>
      <div className="hk-tiles" role="group" aria-label="Today in numbers">
        <Tile id="replies" n={t.replies_waiting} label="Replies waiting" onClick={() => onGo('replies')} />
        <Tile id="hot" n={t.hot} label="Hot replies" onClick={() => onGo('replies')} />
        <Tile id="drafts" n={t.drafts} label="Drafts to review" onClick={() => onGo('drafts')} />
        <Tile id="followups" n={t.followups_due} label="Follow-ups due" onClick={() => onGo('today')} />
        <Tile id="dms" n={t.dms_due} label="DMs due" onClick={() => onGo('today')} />
        <Tile id="sent" n={t.sent_week} label="Sent this week" onClick={() => onLane('sent')} />
        {t.reply_rate_week != null && <Tile id="rate" n={`${t.reply_rate_week}%`} label="Reply rate this week" />}
        <Tile id="researched" n={`${t.researched_today.n} of ${t.researched_today.cap}`} label="Researched today" />
      </div>
      {note && <p className="hk-note" role="status" data-hk-briefing-note>{note}</p>}
      <section className="hk-today__card" aria-label="Send these 10" data-hk-section="send">
        <div className="hk-section__head">
          <h2 className="hk-section-title">Send these {data.send.length}</h2>
          <span className="hk-meta">of {data.eligible} you can pitch</span>
          <span className="hk-spacer" />
          {canEdit && <Button size="sm" disabled={sweeping || !R.on} disabledReason="Auto-research is off in Settings, Pitch" onClick={sweep} data-hk-run-research>{sweeping ? 'Researching…' : 'Run research now'}</Button>}
        </div>
        <p className="hk-meta" data-hk-research-line>Auto-research {R.on ? `on: up to ${R.n} a day by ${R.time}, $${Number(R.cap_usd).toFixed(2)} cap` : 'off'} · today {R.today_calls} of {R.n} (${Number(R.today_spend).toFixed(2)})</p>
        {data.send.length ? <ol className="hk-send">{data.send.map((c, i) => <Card key={c.id} c={c} i={i} businessId={businessId} canEdit={canEdit} meId={meId} onOpenBrand={onOpenBrand} onChanged={load} setNote={setNote} />)}</ol>
          : <p className="hk-meta">No brand you can pitch right now.</p>}
      </section>
      <section className="hk-today__card" aria-label="Important now" data-hk-section="important">
        <h2 className="hk-section-title">Important now</h2>
        {!listReady ? <p className="hk-meta">Reading your Gmail…</p> : imp.length ? (
          <div className="hk-rows">{imp.map(r => (
            <button key={r.thread_id} type="button" className="hk-btn hk-row hk-row--wrap hk-important__row" onClick={() => onOpenThread(r.thread_id)} data-hk-important={r.thread_id}>
              <span className="hk-table__title">{r.from_name}</span>
              {r.importance.why && <Chip tone="blue">{r.importance.why}</Chip>}
              <span className="hk-meta hk-today__summary">{r.subject}</span>
              <span className="hk-meta">{fmtDate(r.date)}</span>
            </button>))}</div>
        ) : <p className="hk-meta">Nobody is waiting on you on this page.</p>}
      </section>
      <section className="hk-today__card" aria-label="Waiting on them" data-hk-section="waiting">
        <h2 className="hk-section-title">Waiting on them</h2>
        {data.waiting.length ? (
          <div className="hk-rows">{data.waiting.map(w => (
            <div key={w.id} className="hk-row hk-row--wrap" data-hk-waiting-on={w.id}>
              <button type="button" className="hk-btn hk-table__title" onClick={() => onOpenBrand(w.id)}>{w.name}</button>
              <span className="hk-meta">waiting {plural(w.waiting_days, 'day')} · {w.touches_used} of {w.max_email_touches} touches{w.next_due_at ? ` · next ${fmtDate(w.next_due_at)}` : ''}</span>
            </div>))}</div>
        ) : <p className="hk-meta">No sent email is waiting on a reply.</p>}
      </section>
      <SignalsPanel businessId={businessId} shell={shell} canEdit={canEdit} onOpenBrand={onOpenBrand} onGo={onGo} onSeen={onSignalsSeen} />
    </div>
  );
}
