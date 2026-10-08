import { useState, useEffect, useRef, useCallback } from 'react';
import { SA, SA_TYPE, SA_SHAPE, SA_BAD_BG, SA_BAD_BORDER, saSans } from './theme';
import { fetchLive, FLAGS_CHANGED } from './huddleApi';
import { ShowingChip, DrillNumber, inputStyle } from './goals/goalsUi';
import HuddleLiveRow from './HuddleLiveRow';

// huddle-live-feed-v1 - the Huddle's default tab: Apollo's newest-first
// Emails list, one row per person, plus what Prospector knows. All counting
// happens server-side (GET /huddle/live); this only filters and renders.
const PAGE = 25;
const ACTIVITY = [[null, 'All'], ['replied', 'Replied'], ['clicked', 'Clicked'], ['opened2', 'Opened 2+']];
const NUMBERS = [['replied', 'Replies'], ['clicked', 'Clicks'], ['opened2', 'Opened 2+ times'], ['flagged_me', 'Flagged to me']];

const ago = iso => {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return min < 1 ? 'just now' : min < 60 ? `${min} min ago` : min < 48 * 60 ? `${Math.round(min / 60)} h ago` : `${Math.round(min / 1440)} d ago`;
};
const fmt = iso => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function Pills({ label, options, value, onChange }) {
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map(([id, lb, color]) => {
        const on = value === id;
        return (
          <button key={String(id)} type="button" aria-pressed={on} onClick={() => onChange(id)}
            style={{ ...saSans, display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px', borderRadius: 999, fontSize: 13, cursor: 'pointer', border: `1px solid ${on ? SA.accent : SA.border}`, background: on ? 'color-mix(in srgb, var(--sa-accent) 18%, transparent)' : SA.surface2, color: on ? SA.text : SA.soft }}>
            {color && <span style={{ width: 7, height: 7, borderRadius: 999, background: color }} />}{lb}
          </button>
        );
      })}
    </div>
  );
}

const toggleStyle = { display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: SA.soft, cursor: 'pointer', minHeight: 32 };
const syncBtn = { ...saSans, height: 32, padding: '0 12px', borderRadius: 8, fontSize: 13, cursor: 'pointer', color: SA.text, border: `1px solid ${SA.border}`, background: SA.surface2 };

export default function HuddleLive({ businessId, members, myUserId, ownerColor, ownerLabel, canEdit, reloadKey, onFlag, onContacted, onSync, syncing, phone }) {
  const [filter, setFilter] = useState(null);
  const [sinceHuddle, setSinceHuddle] = useState(false);
  const [owner, setOwner] = useState('');
  const [sequence, setSequence] = useState('');
  const [q, setQ] = useState('');
  const [needle, setNeedle] = useState('');
  const [showBots, setShowBots] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [data, setData] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [moreFilters, setMoreFilters] = useState(false);
  const reqId = useRef(0);
  const shownRef = useRef(PAGE);

  useEffect(() => { const t = setTimeout(() => setNeedle(q.trim()), 250); return () => clearTimeout(t); }, [q]);

  const params = { filter, since: sinceHuddle && filter !== 'flagged_me' ? 'huddle' : null, owner, sequence, q: needle, show_bots: showBots, show_closed: showClosed };
  const key = JSON.stringify(params);
  // keep = reload after an action without collapsing what's already loaded.
  const load = useCallback(async (offset, keep) => {
    const id = ++reqId.current;
    setLoading(true); setError('');
    try {
      const limit = keep ? Math.min(Math.max(shownRef.current, PAGE), 100) : PAGE;
      const d = await fetchLive(businessId, { ...JSON.parse(key), offset, limit });
      if (id !== reqId.current) return;
      setData(d);
      setRows(prev => { const next = offset ? [...prev, ...d.rows] : d.rows; shownRef.current = next.length; return next; });
    } catch (e) { if (id === reqId.current) setError(e.message); }
    finally { if (id === reqId.current) setLoading(false); }
  }, [businessId, key]);

  useEffect(() => { load(0, false); }, [load]);
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } load(0, true); }, [reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onFlags = () => load(0, true);
    window.addEventListener(FLAGS_CHANGED, onFlags);
    return () => window.removeEventListener(FLAGS_CHANGED, onFlags);
  }, [load]);

  const pickFilter = (f, since) => { setFilter(f); setSinceHuddle(!!since && f !== 'flagged_me'); };
  const sync = data?.sync;
  const people = [['', 'Team', SA.accent], ...members.map(m => [m.user_id, m.user_id === myUserId ? 'Mine' : m.name.split(' ')[0], ownerColor(m.name.split(' ')[0].toLowerCase())]), ['unassigned', 'Unassigned', ownerColor('unassigned')]];
  const now = Date.now();
  // Phones fold owner / sequence / search / toggles under "Filters"; the count says what's on.
  const activeMore = [owner, sequence, needle, showBots, showClosed].filter(Boolean).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div aria-label="Sync status" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 12px', fontSize: 13, color: SA.muted }}>
        {sync?.failed && (
          <span style={{ color: SA.bad }}>⚠ Last sync failed · started {fmt(sync.failed.started_at)}{sync.failed.stuck ? ', never finished' : sync.failed.error ? ` (${sync.failed.error})` : ''}</span>
        )}
        {sync && (
          <span style={{ color: sync.stale ? SA.warn : SA.muted }} title={sync.synced_at ? fmt(sync.synced_at) : ''}>
            {sync.synced_at ? `Synced ${ago(sync.synced_at)}` : 'Never synced'}{sync.stale && sync.synced_at ? ' — over 2 hours old' : ''}
          </span>
        )}
        {sync?.running && <span>Sync running…</span>}
        {canEdit && <button type="button" onClick={onSync} disabled={syncing} style={{ ...syncBtn, opacity: syncing ? 0.6 : 1 }}>{syncing ? 'Syncing…' : 'Sync now'}</button>}
      </div>

      {data && (
        <div aria-label="Since last huddle" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '6px 18px', padding: '10px 14px', borderRadius: SA_SHAPE.radiusInner, background: SA.inset, border: `1px solid ${SA.border}`, fontSize: 13, color: SA.soft }}>
          <span style={{ ...SA_TYPE.label, color: SA.muted }}>Since last huddle · {fmt(data.since)}</span>
          {NUMBERS.map(([f, lb]) => (
            <span key={f}>
              <DrillNumber onClick={() => pickFilter(f, true)} title={`Show ${lb.toLowerCase()}${f === 'flagged_me' ? '' : ' since the last huddle'}`}
                style={{ fontWeight: 700, fontSize: 15, color: SA.text, fontVariantNumeric: 'tabular-nums' }}>{data.numbers[f]}</DrillNumber> {lb}
            </span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <Pills label="Activity" options={ACTIVITY} value={filter === 'flagged_me' ? undefined : filter} onChange={f => pickFilter(f, false)} />
          {filter === 'flagged_me' && <ShowingChip label="Flagged to me" count={data?.total ?? 0} onClear={() => pickFilter(null)} />}
          {sinceHuddle && filter && filter !== 'flagged_me' && <ShowingChip label="since last huddle" count={data?.total ?? 0} onClear={() => setSinceHuddle(false)} />}
          {phone && (
            <button type="button" aria-expanded={moreFilters} onClick={() => setMoreFilters(o => !o)}
              style={{ ...syncBtn, borderRadius: 999, borderColor: activeMore ? SA.accent : SA.border }}>Filters{activeMore ? ` (${activeMore})` : ''} {moreFilters ? '▴' : '▾'}</button>
          )}
        </div>
        {(!phone || moreFilters) && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <Pills label="Owner" options={people} value={owner} onChange={setOwner} />
          <select aria-label="Sequence" value={sequence} onChange={e => setSequence(e.target.value)} style={{ ...inputStyle, height: 32, fontSize: 13, maxWidth: phone ? '100%' : 260 }}>
            <option value="">All sequences</option>
            {(data?.sequences || []).map(s => <option key={s.id} value={s.id}>{s.name || s.id}</option>)}
          </select>
          <input type="search" aria-label="Search name or company" placeholder="Search name or company" value={q} onChange={e => setQ(e.target.value)}
            style={{ ...inputStyle, height: 32, fontSize: 13, flex: phone ? '1 1 100%' : '0 1 240px', minWidth: 0 }} />
          <label style={toggleStyle}><input type="checkbox" checked={showBots} onChange={e => setShowBots(e.target.checked)} /> Show bot opens ({data?.bot_only_count ?? 0})</label>
          <label style={toggleStyle}><input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} /> Show closed ({data?.closed_count ?? 0})</label>
        </div>}
      </div>

      {error && <div style={{ fontSize: 13, color: SA.bad, padding: '10px 14px', background: SA_BAD_BG, border: `1px solid ${SA_BAD_BORDER}`, borderRadius: SA_SHAPE.radiusInner }}>⚠ {error}</div>}

      <div style={{ fontSize: 12, color: SA.faint }}>{data ? `${data.total} ${data.total === 1 ? 'person' : 'people'} · newest activity first` : loading ? 'Loading…' : ''}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(r => (
          <HuddleLiveRow key={r.contact_id} r={r} now={now} canEdit={canEdit} stacked={phone}
            ownerColor={ownerColor(r.owner)} ownerLabel={ownerLabel(r.owner)}
            expanded={expanded === r.contact_id} onToggle={() => setExpanded(x => (x === r.contact_id ? null : r.contact_id))}
            onFlag={onFlag} onContacted={onContacted} />
        ))}
        {data && !rows.length && !loading && <p style={{ fontSize: 13, color: SA.faint, margin: 0 }}>No activity for these filters.</p>}
      </div>
      {data?.next_offset != null && (
        <button type="button" onClick={() => load(data.next_offset, false)} disabled={loading}
          style={{ ...syncBtn, height: 44, alignSelf: 'flex-start', padding: '0 18px', opacity: loading ? 0.6 : 1 }}>
          {loading ? 'Loading…' : `Load more (${data.total - rows.length} left)`}
        </button>
      )}
      {rows.length > 0 && <span style={{ fontSize: 12, color: SA.faint }}>Times are Pacific · a reply's time is when the sync first saw it (Apollo gives no reply time).</span>}
    </div>
  );
}
