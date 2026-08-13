import { useState, useEffect } from 'react';
import { C, mono } from '../constants/colors';
import { T } from '../constants/tokens';
import { staleDays, isStale, isWarn } from '../utils/staleness';
import { getAccountsForBusiness } from '../utils/db';

// Business-scoped Command Center — Deal Alerts + Diamonds in the Rough only
// (Option A, per Jack). Today's Goals and Calendar/Brief stay on the global
// Home page: they're built on a single per-user daily counter and a single
// Gmail OAuth connection, not on account data, so there's no per-business
// version of them to build.
//
// The gem-detection heuristic in the legacy HomePage additionally gates on a
// hardcoded set of fintech verticals (GEM_VERTS) - deliberately dropped here.
// What's left (tier/score/staleness) still works on any business's accounts,
// but tiers themselves come from assay.js's fintech-tuned scoring, so a
// non-Plaid business will likely surface fewer diamonds until that scoring
// is generalized (generalize-legacy-functions-v1, not this SPEC).

const lastTouch = acc => acc.last;
const CARD = () => ({ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '12px 14px' });
const SH = () => ({ ...mono, fontSize: 10, color: T.cyan, textTransform: 'uppercase', letterSpacing: '0.09em', fontWeight: 600, marginBottom: 8 });
const TIER_HEX = { Gold: T.tier.gold, Silver: T.tier.silver, Tin: T.tier.tin, Slag: T.tier.slag };

export default function BusinessCommandCenterTab({ business }) {
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
              <span style={{ ...mono, fontSize: 10, color: TIER_HEX[a.tier] || '#6b7280', border: `1px solid ${C.brd}`, borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>{a.tier || 'unscored'}</span>
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
