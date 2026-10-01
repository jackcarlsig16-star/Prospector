import { useState, useEffect, useCallback } from 'react';
import { SA, SA_TYPE, SA_SHAPE, SA_BAD_BG, SA_BAD_BORDER } from './theme';
import { fetchRuns, triggerSync } from './salesApi';
import { fetchHuddle, startHuddle, fetchCollateral } from './huddleApi';
import HuddleCard from './HuddleCard';
import CollateralLibrary from './CollateralLibrary';

const OWNER_LABELS = { jack: 'Jack', cyrus: 'Cyrus', unassigned: 'Unassigned' };

function fmtTime(iso) {
  return iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never';
}

function Section({ title, count, children, empty }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <h2 style={{ ...SA_TYPE.cardTitle, fontSize: 17, color: SA.text, margin: 0 }}>{title}</h2>
        <span style={{ ...SA_TYPE.label, color: SA.faint }}>{count}</span>
      </div>
      {count === 0 ? <p style={{ fontSize: 13, color: SA.faint, margin: 0 }}>{empty}</p> : children}
    </section>
  );
}

const cardList = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 420px), 1fr))', gap: 10 };
const headerButton = { ...SA_TYPE.body, fontSize: 13, fontWeight: 500, background: 'transparent', color: SA.text, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusInner, padding: '0 16px', height: 44, cursor: 'pointer' };

export default function DailyHuddle({ businessId }) {
  const [data, setData] = useState(null);
  const [collateral, setCollateral] = useState([]);
  const [lastRun, setLastRun] = useState(null);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [showLibrary, setShowLibrary] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const [huddle, items, runs] = await Promise.all([fetchHuddle(businessId), fetchCollateral(businessId), fetchRuns(businessId, 1)]);
      setData(huddle);
      setCollateral(items);
      setLastRun(runs[0] || null);
    } catch (e) {
      setError(e.message);
    }
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  const reloadCollateral = async () => setCollateral(await fetchCollateral(businessId));

  const handleSync = async () => {
    setSyncing(true);
    setMessage('');
    try {
      const run = await triggerSync(businessId);
      setMessage(run.status === 'success' ? 'Sync complete.' : `Sync finished: ${run.status}`);
      await load();
    } catch (e) {
      setMessage(e.message);
    } finally {
      setSyncing(false);
    }
  };

  const handleStart = async () => {
    try {
      const huddle = await startHuddle(businessId);
      setData(d => ({ ...d, last_huddle: huddle }));
    } catch (e) {
      setMessage(e.message);
    }
  };

  // The card gets the raw sales_prospect_state row back; computed fields
  // (score, badges, sequence) stay as they were until the next load.
  const handleUpdated = row => {
    setData(d => ({ ...d, prospects: d.prospects.map(p => (p.contact_id === row.contact_id ? { ...p, ...row } : p)) }));
  };

  const today = data?.today;
  const lastHuddleAt = data?.last_huddle?.huddle_at;
  const visible = (data?.prospects || []).filter(p =>
    p.status !== 'dead' && !(p.status === 'not_now' && (!p.snooze_until || p.snooze_until > today)));
  const due = visible.filter(p => p.next_action_due && p.next_action_due <= today && p.status !== 'booked');
  const dueIds = new Set(due.map(p => p.contact_id));
  const fresh = visible.filter(p => p.status === 'new' && !dueIds.has(p.contact_id));
  const inProgress = visible.filter(p => ['claimed', 'contacted'].includes(p.status) && !dueIds.has(p.contact_id));
  const owners = ['jack', 'cyrus', ...(inProgress.some(p => p.owner === 'unassigned') ? ['unassigned'] : [])];
  const nameById = new Map((data?.prospects || []).map(p => [p.contact_id, p.name]));
  const done = data?.done_recent || [];

  const card = p => (
    <HuddleCard key={`${p.contact_id}:${p.updated_at}`} businessId={businessId} prospect={p} collateral={collateral}
      isNewSinceHuddle={!!lastHuddleAt && p.created_at > lastHuddleAt} onUpdated={handleUpdated} />
  );

  const dateLabel = today ? new Date(`${today}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 24, marginBottom: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ ...SA_TYPE.label, color: SA.muted }}>HomeLover · Command Center</div>
          <h1 style={{ margin: 0, ...SA_TYPE.pageTitle, color: SA.text }}>Daily Huddle{dateLabel && ` · ${dateLabel}`}</h1>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: SA.muted }}>
            <span>Synced {fmtTime(lastRun?.finished_at)}</span>
            <span>Last huddle {fmtTime(lastHuddleAt)}</span>
          </div>
          {message && <span style={{ fontSize: 12, color: SA.warn }}>{message}</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setShowLibrary(s => !s)} style={headerButton}>{showLibrary ? 'Hide library' : 'Collateral library'}</button>
          <button onClick={handleSync} disabled={syncing} style={{ ...headerButton, opacity: syncing ? 0.6 : 1 }}>{syncing ? 'Syncing…' : 'Sync now'}</button>
          <button onClick={handleStart} style={{ ...headerButton, fontWeight: 600, background: SA.accent, color: SA.ground, border: 0 }}>Start huddle</button>
        </div>
      </div>

      {error && (
        <div style={{ fontSize: 13, color: SA.bad, padding: '10px 14px', background: SA_BAD_BG, border: `1px solid ${SA_BAD_BORDER}`, borderRadius: SA_SHAPE.radiusInner, marginBottom: 16 }}>⚠ {error}</div>
      )}
      {(data?.warnings || []).map(w => (
        <div key={w} style={{ fontSize: 13, color: SA.warn, marginBottom: 8 }}>⚠ {w}</div>
      ))}

      {showLibrary && <CollateralLibrary businessId={businessId} items={collateral} onChanged={reloadCollateral} />}

      {!data ? (
        !error && <p style={{ ...SA_TYPE.body, fontSize: 13, color: SA.muted }}>Loading…</p>
      ) : (
        <>
          <Section title="Due today / overdue" count={due.length} empty="Nothing due.">
            <div style={cardList}>{due.map(card)}</div>
          </Section>

          <Section title="New" count={fresh.length} empty="No new prospects.">
            <div style={cardList}>{fresh.map(card)}</div>
          </Section>

          <Section title="In progress" count={inProgress.length} empty="Nobody claimed or contacted yet.">
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, 380px), 1fr))`, gap: 16 }}>
              {owners.map(owner => {
                const mine = inProgress.filter(p => p.owner === owner);
                return (
                  <div key={owner}>
                    <div style={{ ...SA_TYPE.label, color: SA.muted, marginBottom: 8 }}>{OWNER_LABELS[owner]} · {mine.length}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{mine.map(card)}</div>
                  </div>
                );
              })}
            </div>
          </Section>

          <details style={{ marginBottom: 16 }}>
            <summary style={{ ...SA_TYPE.cardTitle, color: SA.text, cursor: 'pointer' }}>
              Done since yesterday <span style={{ ...SA_TYPE.label, color: SA.faint }}>{done.length}</span>
            </summary>
            {done.length === 0 ? (
              <p style={{ fontSize: 13, color: SA.faint }}>Nothing marked Contacted or Booked yesterday or today.</p>
            ) : (
              <ul style={{ fontSize: 13, color: SA.muted, paddingLeft: 18 }}>
                {done.map(e => (
                  <li key={`${e.contact_id}:${e.changed_at}`}>
                    {nameById.get(e.contact_id) || e.contact_id} → {e.to_value} · {fmtTime(e.changed_at)}{e.changed_by ? ` · ${e.changed_by}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </details>

          {Object.values(data.excluded).some(Boolean) && (
            <p style={{ fontSize: 12, color: SA.faint }}>
              Hidden: {Object.entries(data.excluded).filter(([, n]) => n).map(([k, n]) => `${n} ${k.replace(/_/g, ' ')}`).join(' · ')}
            </p>
          )}
        </>
      )}
    </div>
  );
}
