import { useState, useEffect } from 'react';
import { C, mono, TIER_COLOR } from '../constants/colors';
import { T } from '../constants/tokens';
import { staleDays, isStale, isWarn } from '../utils/staleness';
import { getAccountsForBusiness } from '../utils/db';
import TodayGoals from './TodayGoals';
import SalesCalendarWidget from './CalendarWidget';
import BriefPanel from './BriefPanel';

// Business Command Center — full dashboard shape, matching the global
// HomePage layout (business-nav-architecture-v1 follow-up, per Jack:
// Option 2). Two different kinds of widget live here:
//
// - Today's Goals, Calendar, Brief: genuinely per-user/global (one Gmail
//   OAuth connection, one date-keyed daily counter) - these reuse the
//   EXACT SAME components and state App.js's global HomePage uses (passed
//   down as sharedAccounts/sharedTasks/dailyStats/etc.), not a duplicated
//   or business-scoped copy. Labeled "Shared across all businesses" so
//   that's honest rather than implied to be this business's own numbers.
//   (Scout itself now lives in App.js's persistent global mount, not here -
//   scout-global-persistent-v1.)
// - Deal Alerts, Diamonds in the Rough: genuinely business-scoped, computed
//   from this business's own accounts (unchanged from the prior version).

const lastTouch = acc => acc.last;
const CARD = () => ({ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '12px 14px' });
const SH = () => ({ ...mono, fontSize: 10, color: T.cyan, textTransform: 'uppercase', letterSpacing: '0.09em', fontWeight: 600, marginBottom: 8 });

function SharedLabel() {
  return (
    <span style={{ ...mono, fontSize: 9, color: C.dim, background: `${C.dim}18`, border: `1px solid ${C.dim}44`, borderRadius: 9, padding: '1px 7px', marginBottom: 6, display: 'inline-block' }}>
      🌐 Shared across all businesses
    </span>
  );
}

export default function BusinessCommandCenterTab({ business, sharedAccounts=[], sharedTasks=[], setSharedTasks, dailyStats={}, activeUser, onNav, onUpdateAccount }) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getAccountsForBusiness(business.id).then(accs => {
      if (cancelled) return;
      setAccounts(accs);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [business.id]);

  if (loading) {
    return <p style={{ ...mono, fontSize: 13, color: C.dim }}>Loading…</p>;
  }

  const atRisk = accounts.filter(a => isStale(lastTouch(a)) && (a.score||9) <= 2);
  const warnAccs = accounts.filter(a => isWarn(lastTouch(a)) && (a.score||9) <= 2);
  const alerts = [
    ...atRisk.slice(0, 5).map(a => ({ id: a.id, name: a.name, label: `${staleDays(lastTouch(a))}d no activity`, tag: a.tier || 'At Risk', c: a.tier === 'Gold' ? C.gold : '#94a3b8' })),
    ...warnAccs.slice(0, 3).map(a => ({ id: a.id, name: a.name, label: `${staleDays(lastTouch(a))}d — approaching`, tag: 'Warning', c: C.orange })),
  ];

  const notWorked = a => !['Engaged', 'Active Deal', 'Qualified', 'Closed Won', 'Closed Lost'].includes(a.stage || 'Prospecting');
  const gems = [];
  accounts.filter(a => a.tier === 'Gold' && notWorked(a)).forEach(a => gems.push({ acc: a, reason: 'Gold-tier, not yet worked' }));
  accounts.filter(a => a.tier === 'Silver' && notWorked(a)).slice(0, 2).forEach(a => gems.push({ acc: a, reason: 'Silver-tier, not yet worked' }));
  accounts.filter(a => a.tier === 'Gold' && staleDays(lastTouch(a)) >= 60 && !gems.find(g => g.acc.id === a.id)).forEach(a => gems.push({ acc: a, reason: `Gold-tier, ${staleDays(lastTouch(a))}d stale` }));
  const topGems = gems.slice(0, 5);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <SharedLabel />
        <TodayGoals dailyStats={dailyStats} accounts={sharedAccounts} tasks={sharedTasks} />
      </div>

      <div>
        <SharedLabel />
        <div style={{ display: 'flex', gap: 16, alignItems: 'stretch' }}>
          <div style={{ flex: '1 1 50%', minWidth: 0, display: 'flex' }}>
            <SalesCalendarWidget
              accounts={sharedAccounts}
              onNav={onNav}
              tasks={sharedTasks}
              authError={localStorage.getItem('prospector_gmail_auth_error') || null}
              onEventsLoaded={()=>{}}
              onCreateTask={t => setSharedTasks && setSharedTasks(prev => [{ ...t, source: t.source || 'calendar' }, ...prev])}
              onUpdateAccount={onUpdateAccount}
            />
          </div>
          <div style={{ flex: '1 1 50%', minWidth: 0, display: 'flex' }}>
            <BriefPanel
              accounts={sharedAccounts}
              tasks={sharedTasks}
              activeUser={activeUser}
              onNav={onNav}
              onCreateTask={t => setSharedTasks && setSharedTasks(prev => [t, ...prev])}
              onUpdateTask={(id, patch) => setSharedTasks && setSharedTasks(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t))}
            />
          </div>
        </div>
      </div>

      <div style={CARD()}>
        <p style={{ ...SH(), marginBottom: 8 }}>Deal Alerts</p>
        {alerts.length === 0 ? (
          <div style={{ ...mono, fontSize: 11, color: '#4ade80' }}>All clear ✓</div>
        ) : (
          alerts.map((a, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid #1e293b22' }}>
              <span style={{ ...mono, fontSize: 10, color: a.c, flexShrink: 0 }}>⚑</span>
              <span style={{ fontSize: 12, color: '#f1f5f9', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
              <span style={{ ...mono, fontSize: 10, color: a.c, flexShrink: 0 }}>{a.tag}</span>
            </div>
          ))
        )}
      </div>

      <div style={CARD()}>
        <p style={SH()}>💎 Diamonds in the Rough</p>
        {topGems.length === 0 ? (
          <div style={{ ...mono, fontSize: 11, color: '#6b7280' }}>
            {accounts.length === 0 ? 'No accounts yet for this business.' : 'Nothing standing out right now.'}
          </div>
        ) : (
          topGems.map(({ acc: a, reason }) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #1e293b22' }}>
              <span style={{ ...mono, fontSize: 10, color: TIER_COLOR[a.tier] || '#6b7280', border: `1px solid ${C.brd}`, borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>{a.tier || 'unscored'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
                <div style={{ ...mono, fontSize: 10, color: '#6b7280' }}>{reason}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
