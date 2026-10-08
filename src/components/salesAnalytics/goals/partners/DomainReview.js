import { useState } from 'react';
import { SA, saSans, saMono } from '../../theme';
import { labelStyle, subStyle, numStyle, Btn } from '../goalsUi';
import { SUGGESTION_BADGE } from '../../../../constants/partnerDomains';

// partner-domains-bulk-review-v1 - every pending domain suggestion in the
// workspace in one list, so confirming 19 of them is one click instead of
// 19 drop-downs. Each row still goes through the Stage 2 confirm route
// (no new write path); rows leave the list as they land. suggestions =
// the workspace GET's pending list at open time; onAdd(goalId, body) =
// POST partners/:id/domains; onChanged fires after any write so the header
// count and the Export panel catch up.
const BADGE_COLOR = { Both: SA.good, Apollo: SA.accent, Sheet: SA.soft };
const badge = label => ({ ...saMono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: BADGE_COLOR[label] || SA.muted, border: `1px solid ${BADGE_COLOR[label] || SA.border}`, borderRadius: 999, padding: '1px 7px', whiteSpace: 'nowrap' });
const tiny = { all: 'unset', cursor: 'pointer', fontSize: 14, color: SA.link, padding: '0 6px', lineHeight: '24px' };
const keyOf = s => `${s.goal_id}|${s.domain}`;

export default function DomainReview({ suggestions, onAdd, onChanged, onClose }) {
  const [rows] = useState(() => suggestions);
  const [status, setStatus] = useState({}); // key -> 'confirmed' | 'dismissed' | 'error'
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total, failed, running }
  const pending = rows.filter(s => !status[keyOf(s)] || status[keyOf(s)] === 'error');
  const both = pending.filter(s => s.both);
  const settle = (s, outcome) => setStatus(st => ({ ...st, [keyOf(s)]: outcome }));
  const one = async (s, dismiss) => {
    setBusy(true);
    try { await onAdd(s.goal_id, dismiss ? { domain: s.domain, dismiss: true } : { domain: s.domain }); settle(s, dismiss ? 'dismissed' : 'confirmed'); return true; }
    catch { settle(s, 'error'); return false; }
    finally { setBusy(false); onChanged(); }
  };
  const confirmAll = async list => {
    setBusy(true);
    let done = 0, failed = 0;
    setProgress({ done, total: list.length, failed, running: true });
    for (const s of list) {
      try { await onAdd(s.goal_id, { domain: s.domain }); settle(s, 'confirmed'); done++; }
      catch { settle(s, 'error'); failed++; }
      setProgress({ done, total: list.length, failed, running: true });
    }
    setProgress({ done, total: list.length, failed, running: false });
    setBusy(false); onChanged();
  };
  const confirmed = Object.values(status).filter(v => v === 'confirmed').length;
  const dismissed = Object.values(status).filter(v => v === 'dismissed').length;
  return (
    <section aria-label="Review domains" style={{ ...saSans, marginTop: 10, padding: 14, border: `1px solid ${SA.border}`, borderRadius: 10, background: SA.surface2, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={labelStyle}>Review domains</span>
        <span style={{ ...subStyle, ...numStyle, fontSize: 12 }}>
          {pending.length ? <><strong style={{ color: SA.text }}>{`${pending.length} pending`}</strong><span>{' · Both = the sheet and a same-name Apollo account agree on the host'}</span></> : <span>Nothing pending</span>}
          {(confirmed || dismissed) ? <span>{` · ${confirmed} confirmed${dismissed ? `, ${dismissed} dismissed` : ''} this session`}</span> : null}
        </span>
        <button type="button" onClick={onClose} style={{ all: 'unset', cursor: 'pointer', color: SA.link, fontSize: 12, marginLeft: 'auto' }}>Close</button>
      </div>
      {pending.length > 0 && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Btn primary style={{ height: 36 }} onClick={() => confirmAll(pending)} disabled={busy}>Confirm all ({pending.length})</Btn>
          {both.length > 0 && <Btn style={{ height: 36 }} onClick={() => confirmAll(both)} disabled={busy}>Confirm all 'Both' ({both.length})</Btn>}
          {progress?.running && <span role="status" style={{ ...subStyle, ...numStyle, fontSize: 12 }}>{progress.done} of {progress.total} confirmed…</span>}
        </div>
      )}
      {progress && !progress.running && (
        <span role="status" style={{ ...numStyle, fontSize: 12, color: progress.failed ? SA.warn : SA.good }}>
          {progress.done} of {progress.total} confirmed{progress.failed ? ` · ${progress.failed} failed - try again or open the partner` : ''}
        </span>
      )}
      {pending.length > 0 && (
        <ul aria-label="Pending domain suggestions" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {pending.map(s => {
            const label = SUGGESTION_BADGE(s);
            return (
              <li key={keyOf(s)} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', gap: '4px 10px', alignItems: 'center', padding: '5px 0', borderTop: `1px solid ${SA.track}` }}>
                <span style={{ display: 'flex', gap: '2px 10px', flexWrap: 'wrap', alignItems: 'baseline', minWidth: 0 }}>
                  <span style={{ color: SA.text, fontWeight: 500 }}>{s.partner_name}</span>
                  <span style={{ ...subStyle, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.domain}</span>
                  {status[keyOf(s)] === 'error' && <span style={{ color: SA.bad, fontSize: 12 }}>failed</span>}
                </span>
                <span style={badge(label)}>{label}</span>
                <span style={{ display: 'flex', gap: 2 }}>
                  <button type="button" style={{ ...tiny, color: SA.good }} aria-label={`Confirm ${s.domain} for ${s.partner_name}`} title="Confirm" disabled={busy} onClick={() => one(s, false)}>✓</button>
                  <button type="button" style={tiny} aria-label={`Dismiss ${s.domain} for ${s.partner_name}`} title="Not this partner's domain" disabled={busy} onClick={() => one(s, true)}>✕</button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
