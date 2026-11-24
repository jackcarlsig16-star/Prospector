import { useState, useEffect, useCallback } from 'react';
import { SA } from '../theme';
import { goalsApi, OPEN_PIPELINE_RECORD } from './goalsApi';
import { cardStyle, labelStyle, numStyle, fmt, h3Style, ErrorNote, inputStyle } from './goalsUi';
import useMediaQuery from '../../../utils/useMediaQuery';
import { ToggleChip } from '../../../ui/Chip';
import StatusPill from '../../../ui/StatusPill';
import NoteReview from './today/NoteReview';

// fathom-notes-v1 REV 2 F11 - Dashboard > Calls: one row per call note from any source (a Fathom recording or pasted
// notes), newest first, over GET goals/calls (the view sales_calls_v). Names, dates and status only - the notes' text
// opens in the review drawer, members only. A Viewer reads the list and sees no Open / Extract.
const FILTERS = [['unreviewed', 'Unreviewed'], ['week', 'This week'], ['with', 'With a company'], ['none', 'No company']];
const STATUS = { reviewed: 'ok', unreviewed: 'warn', no_proposal: 'off' };
const md = d => new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const minutes = s => (s ? `${Math.max(1, Math.round(s / 60))} min` : '—');
const plural = (n, one, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const openRecord = r => window.dispatchEvent(new CustomEvent(OPEN_PIPELINE_RECORD, { detail: { key: `${r.type}-${r.id}` } }));
const th = { ...labelStyle, textAlign: 'left', padding: '8px 10px', whiteSpace: 'nowrap' };
const td = { padding: '8px 10px', borderTop: `1px solid ${SA.track}`, fontSize: 13, color: SA.text, verticalAlign: 'top' };

export const statusText = c => (c.status === 'reviewed' ? `Reviewed ${md(c.reviewed_at)}` : c.status_label);
export const attendeeText = a => (a.total ? `${a.names.slice(0, 3).join(', ')}${a.total > 3 ? ` +${a.total - 3}` : ''} · ${a.external} external` : '—');

function Company({ record }) {
  if (!record) return <span style={{ color: SA.muted }}>—</span>;
  return <button type="button" className="ui-link" style={{ fontSize: 13, textAlign: 'left' }} onClick={() => openRecord(record)}>{record.name}</button>;
}
function Actions({ call, canEdit, onOpen, wrap = false }) {
  return (
    <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center', flexWrap: wrap ? 'wrap' : 'nowrap' }}>
      {call.fathom_url && <a className="ui-link" style={{ fontSize: 13 }} href={call.fathom_url} target="_blank" rel="noreferrer" aria-label={`Open ${call.title} in Fathom`}>Fathom ↗</a>}
      {canEdit && call.status === 'no_proposal' && call.source === 'Fathom' && (
        <button type="button" className="ui-btn ui-btn--tertiary" style={{ height: 24, fontSize: 13 }} aria-label={`Extract ${call.title}`} onClick={() => onOpen(call, true)}>Extract</button>
      )}
      {canEdit && <button type="button" className="ui-btn ui-btn--tertiary" style={{ height: 24, fontSize: 13 }} aria-label={`Open ${call.title}`} onClick={() => onOpen(call, false)}>Open</button>}
    </span>
  );
}

export default function CallsView({ businessId, canEdit }) {
  const narrow = useMediaQuery('(max-width: 720px)');
  const [who, setWho] = useState('team');
  const [on, setOn] = useState({});
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [review, setReview] = useState(null); // { noteId, extractNow }

  const load = useCallback(() => goalsApi.calls(businessId, { who, unreviewed: on.unreviewed ? '1' : '', week: on.week ? '1' : '', company: on.with ? 'with' : on.none ? 'none' : '', q: q.trim() })
    .then(d => { setData(d); setError(''); }).catch(e => setError(e.message)), [businessId, who, on, q]);
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);

  // With a company and No company exclude each other.
  const toggle = id => setOn(prev => ({ ...prev, [id]: !prev[id], ...(id === 'with' && !prev.with ? { none: false } : {}), ...(id === 'none' && !prev.none ? { with: false } : {}) }));
  const closeReview = () => { setReview(null); load(); };
  const open = (call, extractNow) => setReview({ noteId: call.id, extractNow });
  const calls = data?.calls || [];
  const c = data?.counts;

  return (
    <section aria-label="Calls" data-calls-view style={{ ...cardStyle, padding: narrow ? 16 : 20, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h3 style={h3Style}>Calls</h3>
        {c && <span data-calls-count style={{ fontSize: 13, color: SA.soft, ...numStyle }}>{plural(c.calls, 'call')} · {fmt(c.unreviewed)} unreviewed · {fmt(c.no_company)} without a company</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <div role="group" aria-label="Whose calls" style={{ display: 'inline-flex', gap: 6 }}>
          <ToggleChip pressed={who === 'mine'} onClick={() => setWho('mine')}>Mine</ToggleChip>
          <ToggleChip pressed={who === 'team'} onClick={() => setWho('team')}>Team</ToggleChip>
        </div>
        <div role="group" aria-label="Filter calls" style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
          {FILTERS.map(([id, label]) => <ToggleChip key={id} pressed={!!on[id]} onClick={() => toggle(id)}>{label}</ToggleChip>)}
        </div>
        <input type="search" value={q} onChange={e => setQ(e.target.value)} aria-label="Search calls by title or company" placeholder="Search title or company"
          style={{ ...inputStyle, height: 32, fontSize: 13, flex: '1 1 180px', minWidth: 0, maxWidth: 280, marginLeft: narrow ? 0 : 'auto' }} />
      </div>
      {error && <ErrorNote message={error} />}
      {!data && !error && <span style={{ fontSize: 13, color: SA.muted }}>Loading…</span>}
      {data && !calls.length && <span data-calls-empty style={{ fontSize: 13, color: SA.muted }}>{data.total ? 'No call matches these filters.' : 'No calls yet. A Fathom recording or pasted call notes land here.'}</span>}
      {calls.length > 0 && (narrow ? (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {calls.map(call => (
            <li key={call.id} data-call={call.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 0', borderTop: `1px solid ${SA.track}`, fontSize: 13 }}>
              <span style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'baseline' }}>
                <b style={{ color: SA.text, fontWeight: 600, overflowWrap: 'anywhere' }}>{call.title}</b>
                <span style={{ color: SA.muted, whiteSpace: 'nowrap', ...numStyle }}>{md(call.call_date)}</span>
              </span>
              <span style={{ color: SA.soft, overflowWrap: 'anywhere' }}>{[call.member?.name, call.source, call.duration_seconds ? minutes(call.duration_seconds) : null].filter(Boolean).join(' · ')}</span>
              {call.attendees.total > 0 && <span style={{ color: SA.muted, overflowWrap: 'anywhere' }}>{attendeeText(call.attendees)}</span>}
              <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <StatusPill status={STATUS[call.status]}>{statusText(call)}</StatusPill>
                <Company record={call.record} />
              </span>
              <Actions call={call} canEdit={canEdit} onOpen={open} wrap />
            </li>
          ))}
        </ul>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Date', 'Call', 'Member', 'Attendees', 'Company', 'Duration', 'Status', 'Open'].map(h => <th key={h} scope="col" style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {calls.map(call => (
                <tr key={call.id} data-call={call.id}>
                  <td style={{ ...td, whiteSpace: 'nowrap', color: SA.soft, ...numStyle }}>{md(call.call_date)}</td>
                  <td style={{ ...td, minWidth: 180, overflowWrap: 'anywhere' }}><span style={{ fontWeight: 600 }}>{call.title}</span><span style={{ display: 'block', fontSize: 12, color: SA.muted }}>{call.source}</span></td>
                  <td style={{ ...td, whiteSpace: 'nowrap', color: SA.soft }}>{call.member?.name || '—'}</td>
                  <td style={{ ...td, color: SA.soft, minWidth: 140, overflowWrap: 'anywhere' }}>{attendeeText(call.attendees)}</td>
                  <td style={{ ...td, minWidth: 120, overflowWrap: 'anywhere' }}><Company record={call.record} /></td>
                  <td style={{ ...td, whiteSpace: 'nowrap', color: SA.soft, ...numStyle }}>{minutes(call.duration_seconds)}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}><StatusPill status={STATUS[call.status]}>{statusText(call)}</StatusPill></td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}><Actions call={call} canEdit={canEdit} onOpen={open} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {review && canEdit && <NoteReview businessId={businessId} noteId={review.noteId} extractNow={review.extractNow} onClose={closeReview} onAccepted={closeReview} />}
    </section>
  );
}
