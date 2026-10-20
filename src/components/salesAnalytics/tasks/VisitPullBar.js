import { useState, useEffect, useCallback } from 'react';
import { SA } from '../theme';
import { goalsApi } from '../goals/goalsApi';
import { linkBtn } from './TaskRow';

// signals-v1 Stage 4 - one line above the Signals list: when Prospector last
// pulled website visitors, today's P1-P4 counts, and "Pull now" (Members).
// The pull itself runs on a Member's first load of the day; this only
// reports it, or says the 500-credit monthly pause is on.
const md = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export default function VisitPullBar({ businessId, canEdit, onPulled }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const load = useCallback(() => goalsApi.visitStatus(businessId).then(setStatus).catch(() => setStatus(null)), [businessId]);
  useEffect(() => { load(); }, [load]);
  const pull = async () => {
    setBusy(true); setNote('');
    try {
      const r = await goalsApi.visitPull(businessId, { force: true });
      setNote(r.ran ? `Pulled ${r.counts.companies} compan${r.counts.companies === 1 ? 'y' : 'ies'} · ${r.counts.signals} new signal${r.counts.signals === 1 ? '' : 's'}` : r.reason);
      onPulled?.();
    } catch (e) { setNote(e.message); }
    finally { setBusy(false); load(); }
  };
  if (!status) return null;
  const run = status.last_run, t = status.today;
  const line = status.paused || (!run ? 'Website visits: not pulled yet'
    : run.status === 'error' ? `Website visits: the ${md(run.la_date)} pull failed`
    : run.status === 'running' ? 'Website visits: pulling…'
    : `Website visits pulled ${md(run.la_date)} · P1 ${t.P1} · P2 ${t.P2} · P3 ${t.P3} · P4 ${t.P4}`);
  return (
    <div role="status" aria-label="Website visitor pull" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12, color: status.paused ? SA.warn : SA.muted }}>
      <span style={{ overflowWrap: 'anywhere' }}>{line}</span>
      {canEdit && !status.paused && <button type="button" disabled={busy} onClick={pull} style={{ ...linkBtn, fontSize: 12, fontWeight: 600 }}>{busy ? 'Pulling…' : 'Pull now'}</button>}
      {note && <span style={{ color: SA.soft, overflowWrap: 'anywhere' }}>{note}</span>}
    </div>
  );
}
