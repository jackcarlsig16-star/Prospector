import { useState, useEffect, useCallback } from 'react';
import { SA } from '../theme';
import { goalsApi } from './goalsApi';
import { cardStyle, h3Style, ErrorNote, Btn } from './goalsUi';
import { md } from './companyPanelFacts';

// intake-insights-v1 I5 - Dashboard > Overview "Track & improve": the Track / Optimize items people kept from notes
// (live = open | planned), newest seen first, with how often they came up and the note they came from. Members move one
// open -> planned -> done or dismiss it (expect = the status shown; a teammate's change in between says so). "Copy for
// planner" copies the ticked items (all shown when none are ticked) as a plain block to paste into the planning chat -
// the item text only, nothing else about a contact.
const STATUS = [['open', 'Open'], ['planned', 'Planned'], ['done', 'Done'], ['dismissed', 'Dismiss']];
export function plannerBlock(items, today = new Date()) {
  const day = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const lines = kind => items.filter(i => i.kind === kind).map(i => `- ${i.text}${i.why ? ` - ${i.why}` : ''}${i.seen_count > 1 ? ` (seen ${i.seen_count}x)` : ''}${i.already_field ? ` [already tracked: ${i.already_field}]` : ''}`);
  return [`Track & improve - ${day}`, ...(lines('track').length ? ['TRACK', ...lines('track')] : []), ...(lines('optimize').length ? ['OPTIMIZE', ...lines('optimize')] : [])].join('\n');
}

export default function TrackImprove({ businessId, canEdit }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState(() => new Set());
  const [note, setNote] = useState('');
  const load = useCallback(() => goalsApi.insights(businessId).then(d => { setData(d); setError(''); }).catch(e => setError(e.message)), [businessId]);
  useEffect(() => { load(); }, [load]);
  const items = data ? [...data.track, ...data.optimize] : [];
  const setStatus = async (item, status) => {
    setError(''); setNote('');
    try { await goalsApi.setInsightStatus(businessId, item.id, { status, expect: item.status }); await load(); }
    catch (e) { setError(e.message); }
  };
  const copy = async () => {
    const chosen = items.filter(i => picked.has(i.id));
    try { await navigator.clipboard.writeText(plannerBlock(chosen.length ? chosen : items)); setNote(`Copied ${chosen.length || items.length} item${(chosen.length || items.length) === 1 ? '' : 's'} - paste them into the planning chat`); }
    catch { setError('Could not copy - your browser blocked the clipboard'); }
  };
  const toggle = id => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const group = (kind, label) => {
    const rows = items.filter(i => i.kind === kind);
    if (!rows.length) return null;
    return (
      <div role="group" aria-label={label} data-insight-kind={kind} style={{ display: 'flex', flexDirection: 'column' }}>
        <span className="ui-group-label" style={{ padding: '6px 0' }}>{label} · {rows.length}</span>
        {rows.map(i => (
          <div key={i.id} data-insight={i.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderTop: `1px solid ${SA.track}`, fontSize: 13 }}>
            <input type="checkbox" aria-label={`Pick for the planner: ${i.text}`} checked={picked.has(i.id)} onChange={() => toggle(i.id)} style={{ marginTop: 3 }} />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ color: SA.text, fontWeight: 500, overflowWrap: 'anywhere' }}>{i.text}</span>
              {i.why && <span style={{ color: SA.soft, fontSize: 12 }}>{i.why}</span>}
              <span style={{ color: SA.muted, fontSize: 12 }}>
                {i.already_field ? `Already tracked: ${i.already_field} · ` : ''}{i.seen_count > 1 ? `seen ${i.seen_count}× · ` : ''}{i.note ? `from ${i.note.title || 'notes'} · ${md(i.note.call_date)}` : 'from notes'}
              </span>
            </div>
            {canEdit
              ? <select aria-label={`Status of ${i.text}`} className="ui-filter__select" value={i.status} onChange={e => setStatus(i, e.target.value)} style={{ height: 30, borderRadius: 8 }}>{STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              : <span style={{ color: SA.muted, fontSize: 12 }}>{STATUS.find(([v]) => v === i.status)?.[1]}</span>}
          </div>
        ))}
      </div>
    );
  };
  return (
    <section aria-label="Track & improve" data-track-improve style={{ ...cardStyle, padding: 20, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ ...h3Style, marginRight: 'auto' }}>Track & improve</h2>
        {items.length > 0 && <Btn onClick={copy}>Copy for planner{picked.size ? ` (${picked.size})` : ''}</Btn>}
      </div>
      <span style={{ fontSize: 12, color: SA.muted }}>What to start tracking and what to do better - kept from uploaded notes.</span>
      {error && <ErrorNote message={error} />}
      {note && <span role="status" style={{ fontSize: 12, color: SA.good }}>{note}</span>}
      {!data && !error && <span style={{ fontSize: 13, color: SA.muted }}>Loading…</span>}
      {data && !items.length && <span style={{ fontSize: 13, color: SA.muted }}>Nothing kept yet - Track and Optimize items you keep when you accept notes land here.</span>}
      {group('track', 'Track')}
      {group('optimize', 'Optimize')}
    </section>
  );
}
