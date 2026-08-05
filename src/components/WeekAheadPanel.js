import React, { useState, useMemo } from 'react';
import { C, mono } from '../constants/colors';
import { loadDismissed, addDismissed, commitmentKey, localDateStr } from '../utils/weekAhead';

const TEAL = '#2dd4bf';
const CARD = (extra={}) => ({ background:'#0f172a', border:'1px solid #1e293b', borderRadius:8, padding:'12px 14px', ...extra });
const SH = (extra={}) => ({ ...mono, fontSize:10, color:TEAL, textTransform:'uppercase', letterSpacing:'0.09em', fontWeight:600, marginBottom:8, ...extra });

const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtShortDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${DAYS_SHORT[d.getDay()]} ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

function findAccount(accounts, name) {
  if (!name) return null;
  const n = name.toLowerCase().trim();
  return accounts.find(a => (a.name || '').toLowerCase().trim() === n)
    || accounts.find(a => n.includes((a.name || '').toLowerCase().trim()) && (a.name || '').length > 3)
    || null;
}

function hasOpenTask(tasks, accId, title) {
  if (!accId || !title) return false;
  const t = title.toLowerCase().trim();
  return tasks.some(x =>
    x.accId === accId &&
    (x.title || '').toLowerCase().trim() === t &&
    x.status !== 'Done' && x.status !== 'done' && x.status !== 'Stale'
  );
}

function urgencyMarker(urgency, dueDate) {
  const today = localDateStr();
  if (urgency === 'today' || (dueDate && dueDate === today)) return { icon: '⚡', color: '#F59E0B' };
  if (urgency === 'this_week') return { icon: '⚡', color: '#F59E0B' };
  return { icon: '→', color: '#6b7280' };
}

function deadlineDot(dueDate) {
  if (!dueDate) return { color: '#6b7280', icon: '◆' };
  const today = localDateStr();
  const friday = (() => { const d = new Date(); const dow = d.getDay(); const off = dow === 0 ? -2 : 5 - dow; d.setDate(d.getDate() + off); return localDateStr(d); })();
  if (dueDate <= today) return { color: '#ef4444', icon: '🔴' };
  if (dueDate <= friday) return { color: '#F59E0B', icon: '◆' };
  return { color: '#6b7280', icon: '◆' };
}

export default function WeekAheadPanel({ data, accounts=[], tasks=[], onCreateTask, onNav, onRefresh, loading=false, error=null }) {
  const [dismissed, setDismissed] = useState(() => loadDismissed());

  const commitments = useMemo(() => {
    if (!data?.commitments) return [];
    return data.commitments.filter(c => !dismissed.has(commitmentKey(c)));
  }, [data, dismissed]);

  const meetings = data?.upcomingMeetings || [];
  const deadlines = data?.forecastDeadlines || [];

  const handleDismiss = (c) => {
    const key = commitmentKey(c);
    addDismissed(key);
    setDismissed(prev => { const n = new Set(prev); n.add(key); return n; });
  };

  const handleAddTask = (c) => {
    if (!onCreateTask) return;
    const acc = findAccount(accounts, c.account);
    const today = localDateStr();
    onCreateTask({
      id: Date.now(),
      title: c.commitment,
      type: 'Follow up',
      accId: acc?.id || null,
      accName: acc?.name || c.account || '',
      priority: c.urgency === 'today' ? 'High' : 'Medium',
      status: 'Open',
      dueDate: c.dueDate || null,
      createdAt: today,
      source: 'week_ahead',
    });
  };

  if (!data) {
    return (
      <div style={{ ...CARD() }}>
        <p style={SH()}>Week Ahead</p>
        <div style={{ ...mono, fontSize:11, color:'#6b7280', fontStyle:'italic' }}>
          {loading ? 'Generating…' : (error ? <span style={{ color:C.red }}>✕ {error}</span> : 'Not generated yet')}
        </div>
        {!loading && onRefresh && (
          <button onClick={onRefresh} style={{ ...mono, marginTop:8, fontSize:10, color:TEAL, background:'transparent', border:`1px solid ${TEAL}44`, borderRadius:4, padding:'3px 10px', cursor:'pointer' }}>
            Generate now →
          </button>
        )}
      </div>
    );
  }

  const generatedAt = data.cachedAt ? new Date(data.cachedAt) : null;
  const generatedLabel = generatedAt ? `${DAYS_SHORT[generatedAt.getDay()]} ${MONTHS_SHORT[generatedAt.getMonth()]} ${generatedAt.getDate()}` : '';

  return (
    <div style={{ ...CARD() }}>
      <p style={SH()}>Week Ahead — {data.weekStart} to {data.weekEnd}</p>

      {/* ① Commitments */}
      <div style={{ marginBottom:14 }}>
        <p style={{ ...mono, fontSize:9, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6, fontWeight:600 }}>Commitments this week</p>
        {commitments.length === 0 ? (
          <div style={{ ...mono, fontSize:11, color:'#6b7280', fontStyle:'italic' }}>No commitments extracted this week</div>
        ) : commitments.map((c, i) => {
          const acc = findAccount(accounts, c.account);
          const taskExists = acc && hasOpenTask(tasks, acc.id, c.commitment);
          const marker = urgencyMarker(c.urgency, c.dueDate);
          return (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 0', borderBottom:'1px solid #1e293b22' }}>
              <span style={{ ...mono, fontSize:11, color:marker.color, flexShrink:0 }}>{marker.icon}</span>
              <div style={{ flex:1, minWidth:0 }}>
                <span style={{ fontSize:12, color:'#f1f5f9' }}>{c.commitment}</span>
                {c.account && (
                  <>
                    <span style={{ ...mono, fontSize:10, color:'#6b7280', margin:'0 4px' }}>→</span>
                    <span
                      onClick={() => acc && onNav?.('accounts', acc.id)}
                      style={{ ...mono, fontSize:11, color: acc ? TEAL : '#6b7280', cursor: acc ? 'pointer' : 'default' }}>
                      {c.account}
                    </span>
                  </>
                )}
              </div>
              {c.dueDate && (
                <span style={{ ...mono, fontSize:10, color:marker.color, flexShrink:0 }}>{fmtShortDate(c.dueDate)}</span>
              )}
              {taskExists ? (
                <span style={{ ...mono, fontSize:10, color:'#4ade80', flexShrink:0, opacity:0.7 }}>✓ task exists</span>
              ) : (
                <>
                  <button onClick={() => handleAddTask(c)}
                    style={{ ...mono, fontSize:10, padding:'2px 8px', background:'transparent', border:`1px solid ${TEAL}44`, color:TEAL, borderRadius:4, cursor:'pointer', flexShrink:0 }}>
                    + Task
                  </button>
                  <button onClick={() => handleDismiss(c)}
                    title="Dismiss"
                    style={{ ...mono, fontSize:11, padding:'2px 7px', background:'transparent', border:'1px solid #1e293b', color:'#6b7280', borderRadius:4, cursor:'pointer', flexShrink:0 }}>
                    ✓
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* ② Meetings */}
      <div style={{ marginBottom:14 }}>
        <p style={{ ...mono, fontSize:9, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6, fontWeight:600 }}>Meetings ahead</p>
        {meetings.length === 0 ? (
          <div style={{ ...mono, fontSize:11, color:'#6b7280', fontStyle:'italic' }}>No external meetings scheduled</div>
        ) : meetings.map((m, i) => {
          const acc = findAccount(accounts, m.account);
          const attendeeStr = Array.isArray(m.attendees) && m.attendees.length ? m.attendees.slice(0, 2).join(', ') : '';
          return (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 0', borderBottom:'1px solid #1e293b22' }}>
              <span style={{ ...mono, fontSize:10, color:'#6b7280', flexShrink:0, minWidth:62 }}>{fmtShortDate(m.date)}</span>
              <span style={{ ...mono, fontSize:10, color:'#6b7280', flexShrink:0, minWidth:50 }}>{m.time || '—'}</span>
              <div style={{ flex:1, minWidth:0, display:'flex', alignItems:'center', gap:6, overflow:'hidden' }}>
                <span
                  onClick={() => acc && onNav?.('accounts', acc.id)}
                  style={{ fontSize:12, color: acc ? '#f1f5f9' : '#94a3b8', cursor: acc ? 'pointer' : 'default', fontWeight:500, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                  {m.account}
                </span>
                {attendeeStr && (
                  <span style={{ ...mono, fontSize:10, color:'#6b7280', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>· {attendeeStr}</span>
                )}
              </div>
              {m.prepNeeded ? (
                <button
                  onClick={() => acc && onNav?.('accounts', acc.id)}
                  style={{ ...mono, fontSize:10, padding:'2px 7px', background:`#F59E0B14`, border:`1px solid #F59E0B55`, color:'#F59E0B', borderRadius:4, cursor: acc ? 'pointer' : 'default', flexShrink:0 }}>
                  ⚠ prep needed
                </button>
              ) : (
                <span style={{ ...mono, fontSize:10, color:'#4ade80', flexShrink:0, opacity:0.7 }}>✓ ready</span>
              )}
            </div>
          );
        })}
      </div>

      {/* ③ Deadlines */}
      <div style={{ marginBottom:10 }}>
        <p style={{ ...mono, fontSize:9, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6, fontWeight:600 }}>Deadlines</p>
        {deadlines.length === 0 ? (
          <div style={{ ...mono, fontSize:11, color:'#6b7280', fontStyle:'italic' }}>No deadlines this week</div>
        ) : deadlines.map((d, i) => {
          const dot = deadlineDot(d.dueDate);
          return (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:8, padding:'4px 0' }}>
              <span style={{ fontSize:11, color:dot.color, flexShrink:0 }}>{dot.icon}</span>
              <span style={{ fontSize:12, color:'#f1f5f9', flex:1 }}>{d.label}</span>
              <span style={{ ...mono, fontSize:10, color:dot.color, flexShrink:0 }}>{fmtShortDate(d.dueDate)}</span>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{ display:'flex', alignItems:'center', gap:8, paddingTop:8, borderTop:'1px solid #1e293b' }}>
        <span style={{ ...mono, fontSize:10, color:'#6b7280' }}>
          {generatedLabel ? `Generated ${generatedLabel}` : ''}
        </span>
        {error && <span style={{ ...mono, fontSize:10, color:C.red }}>✕ {error}</span>}
        <div style={{ flex:1 }}/>
        {onRefresh && (
          <button onClick={onRefresh} disabled={loading}
            style={{ ...mono, fontSize:10, padding:'3px 10px', background:'transparent', border:`1px solid ${TEAL}44`, color:loading ? '#6b7280' : TEAL, borderRadius:4, cursor: loading ? 'default' : 'pointer' }}>
            {loading ? 'generating…' : '↻ Refresh'}
          </button>
        )}
      </div>
    </div>
  );
}
