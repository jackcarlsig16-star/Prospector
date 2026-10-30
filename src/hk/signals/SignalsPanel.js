import React, { useCallback, useEffect, useState } from 'react';
import { hkGet, hkPost } from '../hkApi';
import { HeatChip, UNDO_MS } from './Heat';

// grow-signals-v1 G6 + grow-ui-refresh-v1 U5 - the Signals card in the Briefing's 340 px rail: prospect signals newest
// first, one line each (the words open the brand, or the Inbox for a sender), heat word, time and Dismiss (Undo for
// 10 s); unseen lines bold. Sponsor signals sit under their own folded Sponsors heading and add 0 to heat. What the
// panel shows is marked seen once it has loaded (the bold stays for this visit).
const SHOW = 8;
const fmt = iso => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
const lineOf = s => s.detail || `${s.brand?.name || s.domain || 'A sender'} ${s.words}`;

export default function SignalsPanel({ businessId, canEdit, onOpenBrand, onGo, onSeen }) {
  const [data, setData] = useState(null);
  const [unseen, setUnseen] = useState(() => new Set());
  const [all, setAll] = useState(false);
  const [undo, setUndo] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setData(await hkGet(businessId, '/signals')); setError(''); } catch (e) { setError(e.message); setData(d => d || { prospects: [], sponsors: [] }); }
  }, [businessId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!data) return;
    const ids = [...data.prospects, ...data.sponsors].filter(s => !s.seen_at).map(s => s.id);
    setUnseen(u => new Set([...u, ...ids]));
    if (!ids.length || !canEdit) return;
    hkPost(businessId, '/signals/seen', { ids: ids.slice(0, 200) }).then(() => onSeen?.()).catch(() => {});
  }, [data, businessId, canEdit, onSeen]);
  useEffect(() => { if (!undo) return undefined; const t = setTimeout(() => setUndo(null), UNDO_MS); return () => clearTimeout(t); }, [undo]);

  const act = async s => {
    if (canEdit) hkPost(businessId, `/signals/${s.id}/act`, {}).catch(() => {});
    if (s.brand) onOpenBrand(s.brand.id); else onGo('inbox');
  };
  const dismiss = async (s, back = false) => {
    try { await hkPost(businessId, `/signals/${s.id}/dismiss`, back ? { undo: true } : {}); setUndo(back ? null : s); await load(); }
    catch (e) { setError(e.message); }
  };

  if (!data) return null;
  const { prospects, sponsors } = data;
  if (!prospects.length && !sponsors.length && !undo) return null;
  const shown = all ? prospects : prospects.slice(0, SHOW);
  const line = (s, sponsor = false) => (
    <div key={s.id} className={`hk-rcard__sig${(!s.seen_at || unseen.has(s.id)) ? ' hk-rcard__sig--unseen' : ''}`} data-hk-signal={s.kind}>
      <button type="button" className="hk-btn hk-rcard__sigword" onClick={() => act(s)} data-hk-signal-act>{lineOf(s)}</button>
      {!sponsor && <HeatChip band={s.brand?.heat_band} />}
      <span className="hk-meta">{fmt(s.occurred_at)}{sponsor ? ' · 0 points' : ''}</span>
      {canEdit && <button type="button" className="hk-btn hk-link hk-rcard__dismiss" aria-label={`Dismiss: ${lineOf(s)}`} onClick={() => dismiss(s)} data-hk-signal-dismiss>Dismiss</button>}
    </div>
  );
  return (
    <section className="hk-rcard" aria-label="Signals" data-hk-section="signals">
      <h2 className="hk-rcard__title">Signals <span className="hk-meta">{prospects.length}</span></h2>
      {undo && <p className="hk-meta" role="status" data-hk-signal-undo-line>Dismissed. <button type="button" className="hk-btn hk-link" onClick={() => dismiss(undo, true)} data-hk-signal-undo>Undo</button></p>}
      {error && <p className="hk-error" role="alert">{error}</p>}
      {prospects.length ? <div className="hk-rcard__rows">{shown.map(s => line(s))}</div> : <p className="hk-meta">No prospect signals right now.</p>}
      {prospects.length > SHOW && <p><button type="button" className="hk-btn hk-link" onClick={() => setAll(a => !a)} data-hk-signals-more>{all ? 'Show fewer' : `Show all ${prospects.length}`}</button></p>}
      {sponsors.length > 0 && (
        <details className="hk-signals__sponsors" data-hk-signals-sponsors>
          <summary>Sponsors ({sponsors.length}) · 0 points, not counted in heat</summary>
          <div className="hk-rcard__rows">{sponsors.map(s => line(s, true))}</div>
        </details>
      )}
    </section>
  );
}

// grow-inbox-intel B1: the panel lives on the Inbox's Briefing; Today keeps one line pointing there.
export function SignalsLine({ businessId, onGo }) {
  const [n, setN] = useState(null);
  useEffect(() => { hkGet(businessId, '/signals').then(r => setN(r.prospects.filter(s => !s.seen_at).length)).catch(() => setN(null)); }, [businessId]);
  if (!n) return null;
  return <p className="hk-meta" data-hk-signals-line>{n} new signal{n === 1 ? '' : 's'} · <button type="button" className="hk-btn hk-link" onClick={() => onGo('inbox')}>Open Inbox</button></p>;
}
