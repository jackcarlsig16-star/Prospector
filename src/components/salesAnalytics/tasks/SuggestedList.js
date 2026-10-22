import { useState, useEffect } from 'react';
import { SA, SA_SHAPE, saSans } from '../theme';
import { goalsApi } from '../goals/goalsApi';
import { labelStyle, Chip, ErrorNote } from '../goals/goalsUi';
import { copyBtnStyle } from '../CopyForClaude';
import { linkBtn } from './TaskRow';
import { KIND_LABEL } from '../../../constants/tidy';

// call-notes-targets-v1 Stage 3 - what Tidy proposed. Propose-only: nothing
// changes until a Member clicks. Accept = ONE open to-do linked to the
// record (a duplicate pair opens both partners instead); Dismiss parks the
// key for 7 days. "Tidy now" forces a run. Viewers see the list only.
const actBtn = { ...copyBtnStyle, color: SA.text };
const when = iso => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' });
export const lastRunText = r => (!r ? 'Tidy hasn’t run yet' : r.status === 'running' ? `Tidy started ${when(r.started_at)} · running` : `Tidy ran ${when(r.started_at)}${r.status === 'error' ? ' · failed' : ''}`);

export default function SuggestedList({ businessId, data, canEdit, onChanged, onOpenPair }) {
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  const run = async fn => { setError(''); try { await fn(); } catch (e) { setError(e.message); } };
  const tidyNow = () => run(async () => {
    setBusy(true);
    try {
      const r = await goalsApi.runTidy(businessId, { force: true });
      setToast(r.created ? `Tidy: ${r.created} new suggestion${r.created === 1 ? '' : 's'}` : 'Tidy: nothing new');
      onChanged();
    } finally { setBusy(false); }
  });
  const accept = s => run(async () => {
    const r = await goalsApi.acceptSuggestion(businessId, s.id);
    onChanged();
    if (r.open) { setToast(`Opening both: ${s.text.replace(/^Possible duplicate: /, '')}`); if (onOpenPair) onOpenPair(r.open, 'Possible duplicate'); }
    else setToast(`To-do added: ${r.todo.text}`);
  });
  const dismiss = s => run(async () => {
    await goalsApi.dismissSuggestion(businessId, s.id);
    onChanged();
    setToast(`Dismissed for 7 days: ${s.text}`);
  });

  const rows = data?.suggestions || [];
  return (
    <section aria-label="Suggested" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ ...labelStyle, color: SA.soft }}>Suggested · {rows.length}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: SA.muted }}>{lastRunText(data?.last_run)}</span>
        {canEdit && <button type="button" onClick={tidyNow} disabled={busy} style={{ ...linkBtn, fontSize: 12, fontWeight: 600 }}>{busy ? 'Tidying…' : 'Tidy now'}</button>}
      </div>
      {error && <ErrorNote message={error} />}
      {!rows.length && <p style={{ fontSize: 14, color: SA.muted, margin: '8px 0' }}>Nothing suggested. Tidy runs once a day on the first visit; Tidy now runs it again.</p>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map(s => (
          <li key={s.id} data-suggestion-id={s.id} style={{ borderTop: `1px solid ${SA.track}`, padding: '10px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <Chip>{KIND_LABEL[s.kind] || s.kind}</Chip>
              <span style={{ fontSize: 14, fontWeight: 600, color: SA.text, overflowWrap: 'anywhere' }}>{s.text}</span>
            </div>
            {s.reason && <span style={{ fontSize: 12, color: SA.muted }}>{s.reason}</span>}
            {canEdit && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <button type="button" style={actBtn} onClick={() => accept(s)}>{s.ref_type === 'pair' ? 'Accept → open both' : 'Accept → to-do'}</button>
                <button type="button" style={{ ...actBtn, color: SA.muted }} onClick={() => dismiss(s)}>Dismiss · 7 d</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {toast && (
        <div role="status" style={{ ...saSans, padding: '10px 12px', borderRadius: SA_SHAPE.radiusInner, background: SA.surface2, border: `1px solid ${SA.border}`, fontSize: 13, overflowWrap: 'anywhere' }}>{toast}</div>
      )}
    </section>
  );
}
