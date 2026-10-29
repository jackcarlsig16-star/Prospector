import React, { useCallback, useEffect, useState } from 'react';
import Button from '../../ui/Button';
import { hkGet, hkPost } from '../hkApi';
import { HeatChip, ListButtons, UNDO_MS } from './Heat';

// grow-signals-v1 G6 - the Signals panel on Today (no Briefing yet): prospect signals newest first, unseen bold, each
// with Act (opens the brand, or the Inbox for a sender) and Dismiss (Undo for 10 s), plus + Target / + Pipeline.
// Sponsor signals sit under their own folded Sponsors heading and add 0 to heat. No Snooze in v1. What the panel
// shows is marked seen once it has loaded (the bold stays for this visit).
const SHOW = 8;
const fmt = iso => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
const lineOf = s => s.detail || `${s.brand?.name || s.domain || 'A sender'} ${s.words}`;

export default function SignalsPanel({ businessId, shell, canEdit, onOpenBrand, onGo, onSeen }) {
  const [data, setData] = useState(null);
  const [unseen, setUnseen] = useState(() => new Set());
  const [all, setAll] = useState(false);
  const [undo, setUndo] = useState(null);
  const [error, setError] = useState('');
  const meId = shell?.me?.user_id, members = shell?.members || [];
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
  const row = (s, sponsor = false) => (
    <div key={s.id} className={`hk-row hk-row--wrap hk-signals__row${(!s.seen_at || unseen.has(s.id)) ? ' hk-signals__row--unseen' : ''}`} data-hk-signal={s.kind}>
      <span className="hk-signals__words">{lineOf(s)}</span>
      {!sponsor && <HeatChip band={s.brand?.heat_band} />}
      <span className="hk-meta">{fmt(s.occurred_at)}{sponsor ? ' · 0 points' : ''}</span>
      <span className="hk-today__actions">
        <Button size="sm" variant="primary" onClick={() => act(s)} data-hk-signal-act>{s.brand ? 'Open brand' : 'Open Inbox'}</Button>
        {canEdit && <Button size="sm" variant="tertiary" onClick={() => dismiss(s)} data-hk-signal-dismiss>Dismiss</Button>}
        {!sponsor && s.brand && <ListButtons businessId={businessId} brand={s.brand} meId={meId} members={members} canEdit={canEdit} compact onChanged={load} />}
      </span>
    </div>
  );
  return (
    <section className="hk-today__card" aria-label="Signals" data-hk-section="signals">
      <h2 className="hk-section-title">Signals ({prospects.length})</h2>
      {undo && <p className="hk-meta" role="status" data-hk-signal-undo-line>Dismissed. <button type="button" className="hk-btn hk-link" onClick={() => dismiss(undo, true)} data-hk-signal-undo>Undo</button></p>}
      {error && <p className="hk-error" role="alert">{error}</p>}
      {prospects.length ? <div className="hk-rows">{shown.map(s => row(s))}</div> : <p className="hk-meta">No prospect signals right now.</p>}
      {prospects.length > SHOW && <p><button type="button" className="hk-btn hk-link" onClick={() => setAll(a => !a)} data-hk-signals-more>{all ? 'Show fewer' : `Show all ${prospects.length}`}</button></p>}
      {sponsors.length > 0 && (
        <details className="hk-signals__sponsors" data-hk-signals-sponsors>
          <summary>Sponsors ({sponsors.length}) · 0 points, not counted in heat</summary>
          <div className="hk-rows">{sponsors.map(s => row(s, true))}</div>
        </details>
      )}
    </section>
  );
}
