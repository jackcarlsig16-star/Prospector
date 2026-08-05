import React, { useState, useEffect, useCallback, useRef } from 'react';
import { mono } from '../../constants/colors';

const HISTORY_KEY = 'prospector_intent_history';
const MAX_DAYS    = 30;
const BAR_H       = 200;
const BAR_MIN     = 40;
const BAR_W       = 32;
const BAR_GAP     = 16;

const TYPE_C = {
  webVisit:          '#39FF14',
  intentActivity:    '#FF3DFF',
  contactEngagement: '#00F5FF',
};

const TYPE_LABEL = {
  webVisit:          'Web Visits',
  intentActivity:    'Intent Signals',
  contactEngagement: 'Contact Engagements',
};

const BREATHE = {
  webVisit:          'intentBreathGreen',
  intentActivity:    'intentBreathMagenta',
  contactEngagement: 'intentBreathCyan',
};

const KEYFRAMES = `
@keyframes intentBarGrow {
  from { transform: scaleY(0); }
  to   { transform: scaleY(1); }
}
@keyframes intentHotPulse {
  0%,100% { box-shadow: 0 0 4px #ef4444, 0 0 8px #ef4444; }
  50%     { box-shadow: 0 0 10px #ef4444, 0 0 24px #ef4444, 0 0 36px #ef444455; }
}
@keyframes intentBlink {
  0%,49% { opacity: 1; } 50%,100% { opacity: 0; }
}
@keyframes intentBreathGreen {
  0%,100% { box-shadow: 0 0 3px #39FF14, 0 0 6px #39FF1466; }
  50%     { box-shadow: 0 0 9px #39FF14, 0 0 18px #39FF14; }
}
@keyframes intentBreathMagenta {
  0%,100% { box-shadow: 0 0 3px #FF3DFF, 0 0 6px #FF3DFF66; }
  50%     { box-shadow: 0 0 9px #FF3DFF, 0 0 18px #FF3DFF; }
}
@keyframes intentBreathCyan {
  0%,100% { box-shadow: 0 0 3px #00F5FF, 0 0 6px #00F5FF66; }
  50%     { box-shadow: 0 0 9px #00F5FF, 0 0 18px #00F5FF; }
}
`;

function injectKeyframes() {
  if (document.getElementById('intent-keyframes')) return;
  const s = document.createElement('style');
  s.id = 'intent-keyframes';
  s.textContent = KEYFRAMES;
  document.head.appendChild(s);
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}

function saveHistory(entries) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_DAYS);
  const pruned = entries.filter(e => !e.date || new Date(e.date) >= cutoff);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(pruned)); } catch {}
  return pruned;
}

function mergeIntoHistory(existing, incoming) {
  const seen = new Set(existing.map(e => `${e.domain}|${e.date}`));
  const next = [...existing];
  for (const e of incoming) {
    const key = `${e.domain}|${e.date}`;
    if (!seen.has(key)) { seen.add(key); next.push(e); }
  }
  return next;
}

function accountDomains(accounts) {
  const map = {};
  for (const acc of accounts) {
    if (!acc.web) continue;
    try {
      const host = new URL(acc.web.startsWith('http') ? acc.web : `https://${acc.web}`).hostname.replace(/^www\./, '');
      map[host] = acc;
    } catch {}
  }
  return map;
}

function aggregateByDomain(history) {
  const byDomain = {};
  for (const entry of history) {
    if (!byDomain[entry.domain]) {
      byDomain[entry.domain] = { ...entry, activities: [], latestDate: entry.date };
    } else if (entry.date > byDomain[entry.domain].latestDate) {
      byDomain[entry.domain].buyingStage = entry.buyingStage;
      byDomain[entry.domain].name = entry.name;
      byDomain[entry.domain].knownContacts = Math.max(byDomain[entry.domain].knownContacts || 0, entry.knownContacts || 0);
      byDomain[entry.domain].latestDate = entry.date;
    }
    byDomain[entry.domain].activities.push(...(entry.activities || []));
  }
  return Object.values(byDomain).map(d => {
    const acts = d.activities;
    const webScore     = acts.filter(a => a.type === 'webVisit').reduce((s, a) => s + (a.intentWeight || 1), 0);
    const intentScore  = acts.filter(a => a.type === 'intentActivity').reduce((s, a) => s + (a.intentWeight || 1), 0);
    const contactScore = acts.filter(a => a.type === 'contactEngagement').reduce((s, a) => s + (a.intentWeight || 1), 0);
    const total = webScore + intentScore + contactScore;
    return { ...d, webScore, intentScore, contactScore, total };
  }).sort((a, b) => b.total - a.total);
}

export default function IntentFeed({ accounts = [], activeUser, user, teamUsers = [] }) {
  const [history,     setHistory]     = useState(loadHistory);
  const [loading,     setLoading]     = useState(false);
  const [fetchError,  setFetchError]  = useState(null);
  const [lastFetch,   setLastFetch]   = useState(null);
  const [emailFound,  setEmailFound]  = useState(null);
  const [parsedCount, setParsedCount] = useState(null);
  const [tooltip,     setTooltip]     = useState(null);
  const [selectedAE,  setSelectedAE]  = useState(null);
  const [hoverScore,  setHoverScore]  = useState(null); // { domain, score }
  const [syncDots,    setSyncDots]    = useState(0);
  const tickRef = useRef(null);

  useEffect(() => { injectKeyframes(); }, []);

  // Sync dots animation while loading
  useEffect(() => {
    if (!loading) { setSyncDots(0); return; }
    const t = setInterval(() => setSyncDots(n => (n + 1) % 4), 350);
    return () => clearInterval(t);
  }, [loading]);

  // Cleanup ticker on unmount
  useEffect(() => () => { if (tickRef.current) clearInterval(tickRef.current); }, []);

  const startTick = useCallback((domain, target) => {
    if (tickRef.current) clearInterval(tickRef.current);
    const start = Date.now();
    tickRef.current = setInterval(() => {
      const t = Math.min((Date.now() - start) / 300, 1);
      setHoverScore({ domain, score: Math.round(t * target) });
      if (t >= 1) clearInterval(tickRef.current);
    }, 16);
  }, []);

  const stopTick = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    setHoverScore(null);
  }, []);

  const isBDR       = activeUser?.role === 'BDR';
  const assignedAEs = isBDR ? (activeUser?.assignedAEs || []).map(id => teamUsers.find(u => u.id === id)).filter(Boolean) : [];
  const domainMap   = accountDomains(accounts);

  const fetchIntent = useCallback(async () => {
    const token = localStorage.getItem('gmail_access_token');
    if (!token) return;
    setLoading(true);
    setFetchError(null);
    try {
      const res  = await fetch('/api/gmail-intent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken: token }) });
      const data = await res.json();
      if (res.status === 401) { setFetchError('Gmail token expired — reconnect Gmail.'); return; }
      if (!res.ok || data.error) { setFetchError(data.error || 'Failed to fetch 6sense data'); return; }
      setEmailFound(data.emailFound ?? data.found ?? false);
      setParsedCount(data.parsed ?? null);
      if (data.found && data.accounts?.length) {
        setHistory(prev => { const merged = mergeIntoHistory(prev, data.accounts); return saveHistory(merged); });
        setLastFetch(data.date);
      }
    } catch (err) {
      setFetchError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchIntent(); }, [fetchIntent]);

  const aggregated = aggregateByDomain(history);

  const filtered = (() => {
    if (!isBDR || !selectedAE) return aggregated;
    const aeAccts  = accounts.filter(a => (a.byId && a.byId === selectedAE.id) || a.by === selectedAE.name);
    const aeDomains = accountDomains(aeAccts);
    return aggregated.filter(d => aeDomains[d.domain]);
  })();

  const displayed  = filtered.slice(0, 20);
  const maxScore   = Math.max(...displayed.map(d => d.total), 1);
  const hasGmailToken   = !!localStorage.getItem('gmail_access_token');
  const noEmailFound    = !loading && !fetchError && hasGmailToken && history.length === 0;
  const noneInTerritory = !loading && displayed.length > 0 && displayed.every(d => !domainMap[d.domain]);
  const hasUrgent       = aggregated.some(d => domainMap[d.domain] && ['Purchase', 'Decision'].includes(d.buyingStage));

  const syncLabel = loading ? `[ SYNCING${'.'.repeat(syncDots)} ]` : '[ SYNC ]';

  return (
    <div data-intent-urgent={hasUrgent ? '1' : '0'}
      style={{ minHeight: 320, padding: 24, background: '#050f05', borderRadius: 8, position: 'relative', overflow: 'hidden',
        backgroundImage: 'linear-gradient(rgba(57,255,20,0.07) 1px,transparent 1px),linear-gradient(90deg,rgba(57,255,20,0.07) 1px,transparent 1px)',
        backgroundSize: '40px 40px',
      }}>

      {/* Radial gradient overlay */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse at 50% 60%, #0a1a0f 0%, transparent 65%)', zIndex: 0 }} />
      {/* Scanlines overlay */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', backgroundImage: 'repeating-linear-gradient(0deg,transparent,transparent 1px,rgba(0,0,0,0.04) 1px,rgba(0,0,0,0.04) 2px)', zIndex: 0 }} />

      {/* All content above overlays */}
      <div style={{ position: 'relative', zIndex: 1 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid rgba(57,255,20,0.15)' }}>
          <span style={{ ...mono, fontSize: 11, color: '#39FF14', textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 700 }}>
            ◆ 6SENSE INTENT
            <span style={{ animation: 'intentBlink 1s step-end infinite', display: 'inline-block', marginLeft: 4 }}>▊</span>
          </span>
          {lastFetch && <span style={{ ...mono, fontSize: 10, color: '#4a5a4a' }}>synced {lastFetch}</span>}

          {/* Legend — top right */}
          <div style={{ display: 'flex', gap: 14, marginLeft: 'auto', alignItems: 'center' }}>
            {Object.entries(TYPE_C).map(([type, color]) => (
              <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0, animation: `${BREATHE[type]} 2s ease-in-out infinite` }} />
                <span style={{ ...mono, fontSize: 10, color: '#4a5a4a', textTransform: 'capitalize' }}>{TYPE_LABEL[type]}</span>
              </div>
            ))}
          </div>

          <button
            onClick={fetchIntent} disabled={loading}
            style={{ ...mono, fontSize: 10, padding: '3px 10px', background: 'transparent',
              border: `1px solid ${loading ? '#2a4a2a' : '#39FF14'}`,
              borderRadius: 3, color: loading ? '#2a4a2a' : '#39FF14',
              cursor: loading ? 'default' : 'pointer', letterSpacing: '0.08em', flexShrink: 0,
              boxShadow: loading ? 'none' : '0 0 6px #39FF1444',
              transition: 'box-shadow 0.2s',
            }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.boxShadow = '0 0 14px #39FF14aa'; }}
            onMouseLeave={e => { e.currentTarget.style.boxShadow = loading ? 'none' : '0 0 6px #39FF1444'; }}>
            {syncLabel}
          </button>
        </div>

        {/* BDR AE toggle */}
        {isBDR && assignedAEs.length > 1 && (
          <div style={{ display: 'flex', gap: 5, marginBottom: 12 }}>
            <button onClick={() => setSelectedAE(null)}
              style={{ ...mono, fontSize: 10, padding: '2px 9px', borderRadius: 3, cursor: 'pointer', background: !selectedAE ? '#0a2010' : 'transparent', border: `1px solid ${!selectedAE ? '#39FF14' : '#1a3a1a'}`, color: !selectedAE ? '#39FF14' : '#4a5a4a' }}>
              All AEs
            </button>
            {assignedAEs.map(ae => (
              <button key={ae.id} onClick={() => setSelectedAE(ae)}
                style={{ ...mono, fontSize: 10, padding: '2px 9px', borderRadius: 3, cursor: 'pointer', background: selectedAE?.id === ae.id ? '#0a2010' : 'transparent', border: `1px solid ${selectedAE?.id === ae.id ? '#39FF14' : '#1a3a1a'}`, color: selectedAE?.id === ae.id ? '#39FF14' : '#4a5a4a' }}>
                {ae.name.split(' ')[0]}
              </button>
            ))}
          </div>
        )}

        {/* Error */}
        {fetchError && (
          <div style={{ ...mono, fontSize: 11, color: '#FF3DFF', padding: '8px 12px', background: '#FF3DFF10', border: '1px solid #FF3DFF30', borderRadius: 6, marginBottom: 12 }}>
            {fetchError}
          </div>
        )}

        {/* Empty: no Gmail token */}
        {!hasGmailToken && !loading && (
          <div style={{ padding: '40px 20px', textAlign: 'center', border: '1px dashed #1a3a1a', borderRadius: 8 }}>
            <p style={{ ...mono, fontSize: 13, color: '#39FF14', margin: '0 0 6px' }}>Gmail not connected</p>
            <p style={{ ...mono, fontSize: 11, color: '#4a5a4a', margin: '0 0 14px' }}>Connect Gmail to pull 6sense alert emails automatically.</p>
            <button onClick={() => window.location.href = '/api/gmail/auth'}
              style={{ ...mono, fontSize: 11, padding: '5px 14px', background: '#0a2010', border: '1px solid #39FF1444', borderRadius: 5, color: '#39FF14', cursor: 'pointer' }}>
              Connect Gmail →
            </button>
          </div>
        )}

        {/* Empty: no email found */}
        {noEmailFound && (
          <div style={{ padding: '40px 20px', textAlign: 'center', border: '1px dashed #1a3a1a', borderRadius: 8 }}>
            {emailFound === true && parsedCount === 0 ? (
              <>
                <p style={{ ...mono, fontSize: 12, color: '#39FF14', margin: '0 0 6px' }}>Email found, but no accounts parsed</p>
                <p style={{ ...mono, fontSize: 11, color: '#4a5a4a', margin: 0 }}>
                  A 6sense alert was found but the format didn't match the parser template. Forward a sample to your admin.
                </p>
              </>
            ) : (
              <>
                <p style={{ ...mono, fontSize: 12, color: '#4a5a4a', margin: '0 0 6px' }}>No 6sense alerts in the last 7 days</p>
                <p style={{ ...mono, fontSize: 11, color: '#2a4a2a', margin: 0 }}>
                  Check that 6sense is configured to send daily alerts to your connected Gmail account.
                </p>
              </>
            )}
          </div>
        )}

        {/* Chart */}
        {displayed.length > 0 && (
          <>
            {noneInTerritory && (
              <p style={{ ...mono, fontSize: 11, color: '#4a5a4a', marginBottom: 10 }}>
                None of these accounts are in your territory — showing at reduced opacity.
              </p>
            )}

            {/* Bars */}
            <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: BAR_GAP, minWidth: 'max-content', paddingBottom: 48, paddingTop: 32, position: 'relative' }}>
                {displayed.map((d, idx) => {
                  const inTerritory  = !!domainMap[d.domain];
                  const isHot        = ['Purchase', 'Decision'].includes(d.buyingStage);
                  const totalH       = Math.max(BAR_MIN, Math.round((d.total / maxScore) * BAR_H));
                  const webH         = d.total > 0 ? Math.round((d.webScore     / d.total) * totalH) : 0;
                  const intentH      = d.total > 0 ? Math.round((d.intentScore  / d.total) * totalH) : 0;
                  const contactH     = Math.max(0, totalH - webH - intentH);
                  const shortName    = d.domain.replace(/\.(com|io|co|net|org|ai)$/, '').slice(0, 12).toUpperCase();
                  const acc          = domainMap[d.domain];
                  const displayScore = hoverScore?.domain === d.domain ? hoverScore.score : d.total;

                  // Dominant segment color for drop-shadow
                  const glowColor = contactH >= intentH && contactH >= webH
                    ? TYPE_C.contactEngagement
                    : intentH >= webH ? TYPE_C.intentActivity : TYPE_C.webVisit;

                  return (
                    <div key={d.domain}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: inTerritory ? 1 : 0.4, cursor: 'pointer', position: 'relative', width: BAR_W }}
                      onMouseEnter={e => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setTooltip({ d, rect });
                        startTick(d.domain, d.total);
                      }}
                      onMouseLeave={() => { setTooltip(null); stopTick(); }}
                      onClick={() => acc && window.dispatchEvent(new CustomEvent('prospector:navToAccount', { detail: { id: acc.id } }))}>

                      {/* HOT badge */}
                      {isHot && (
                        <div style={{ ...mono, fontSize: 9, color: '#ef4444', fontWeight: 700, padding: '1px 5px', borderRadius: 3, border: '1px solid #ef4444', animation: 'intentHotPulse 1.2s ease-in-out infinite', marginBottom: 4, flexShrink: 0, letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
                          🔴 HOT
                        </div>
                      )}
                      {!isHot && <div style={{ height: 20, flexShrink: 0 }} />}

                      {/* Score on hover */}
                      <div style={{ ...mono, fontSize: 10, color: glowColor, fontWeight: 700, marginBottom: 3, flexShrink: 0, minHeight: 14, opacity: hoverScore?.domain === d.domain ? 1 : 0, transition: 'opacity 0.15s' }}>
                        {displayScore}
                      </div>

                      {/* Stacked bar — animates from bottom */}
                      <div style={{ width: BAR_W, display: 'flex', flexDirection: 'column', borderRadius: '3px 3px 0 0', overflow: 'visible',
                        transformOrigin: 'bottom', animation: `intentBarGrow 0.45s ease-out ${idx * 50}ms both`,
                        filter: `drop-shadow(0 0 6px ${glowColor})`,
                      }}>
                        <div style={{ width: BAR_W, borderRadius: '3px 3px 0 0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                          {contactH > 0 && <div style={{ height: contactH, background: TYPE_C.contactEngagement }} />}
                          {intentH  > 0 && <div style={{ height: intentH,  background: TYPE_C.intentActivity    }} />}
                          {webH     > 0 && <div style={{ height: webH,     background: TYPE_C.webVisit          }} />}
                          {totalH === 0  && <div style={{ height: BAR_MIN, background: '#1a3a1a', borderRadius: '3px 3px 0 0' }} />}
                        </div>
                      </div>

                      {/* Label */}
                      <div style={{ position: 'absolute', bottom: -36, left: '50%', transform: 'translateX(-50%) rotate(45deg)', transformOrigin: 'top left', whiteSpace: 'nowrap' }}>
                        <span style={{ ...mono, fontSize: 11, color: inTerritory ? '#39FF14' : '#2a4a2a', letterSpacing: '0.08em', fontWeight: 600 }}>
                          {shortName}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ ...mono, fontSize: 9, color: '#1a3a1a', marginTop: 4 }}>
              Y-axis = weighted intent score · pricing/demo = 3pts · product pages = 2pts · other = 1pt
            </div>
          </>
        )}
      </div>

      {/* Tooltip */}
      {tooltip && <IntentTooltip d={tooltip.d} rect={tooltip.rect} acc={domainMap[tooltip.d?.domain]} />}
    </div>
  );
}

function IntentTooltip({ d, rect, acc }) {
  if (!d || !rect) return null;
  const webVisits     = d.activities.filter(a => a.type === 'webVisit');
  const intentSignals = d.activities.filter(a => a.type === 'intentActivity');
  const contacts      = d.activities.filter(a => a.type === 'contactEngagement');
  const topPages      = [...new Set(webVisits.map(a => a.label))].slice(0, 3);
  const topKeywords   = [...new Map(intentSignals.map(a => [a.keyword, a])).values()].slice(0, 3);

  const left = Math.min(Math.max(rect.left - 100, 8), window.innerWidth - 268);
  const top  = Math.max(8, rect.top - 210);

  return (
    <div style={{
      position: 'fixed', left, top,
      width: 248, background: '#0a1a0f', border: '1px solid #00F5FF',
      borderRadius: 8, padding: 12, zIndex: 9999, pointerEvents: 'none',
      boxShadow: '0 4px 24px rgba(0,245,255,0.15)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ ...mono, fontSize: 12, color: '#fff', fontWeight: 600 }}>{d.name}</span>
        <span style={{ ...mono, fontSize: 9, color: '#4a5a4a' }}>{d.domain}</span>
      </div>

      <span style={{ ...mono, fontSize: 9, padding: '2px 7px', borderRadius: 3,
        background: d.buyingStage === 'Purchase' ? '#ef444422' : d.buyingStage === 'Decision' ? '#f59e0b22' : '#ffffff11',
        color: d.buyingStage === 'Purchase' ? '#ef4444' : d.buyingStage === 'Decision' ? '#f59e0b' : '#aaa',
        border: `1px solid ${d.buyingStage === 'Purchase' ? '#ef444444' : d.buyingStage === 'Decision' ? '#f59e0b44' : '#333'}`,
        marginBottom: 8, display: 'inline-block' }}>
        {d.buyingStage}
      </span>

      <div style={{ display: 'flex', gap: 10, marginBottom: 8, marginTop: 4, flexWrap: 'wrap' }}>
        {webVisits.length > 0     && <span style={{ ...mono, fontSize: 10, color: TYPE_C.webVisit          }}>{webVisits.length} web visit{webVisits.length !== 1 ? 's' : ''}</span>}
        {intentSignals.length > 0 && <span style={{ ...mono, fontSize: 10, color: TYPE_C.intentActivity    }}>{intentSignals.length} intent signal{intentSignals.length !== 1 ? 's' : ''}</span>}
        {contacts.length > 0      && <span style={{ ...mono, fontSize: 10, color: TYPE_C.contactEngagement }}>{contacts.length} contact</span>}
      </div>

      {topPages.length > 0 && (
        <div style={{ marginBottom: 5 }}>
          <span style={{ ...mono, fontSize: 9, color: '#4a5a4a', display: 'block', marginBottom: 3 }}>Pages visited</span>
          {topPages.map(p => <div key={p} style={{ ...mono, fontSize: 10, color: '#aaa' }}>· {p}</div>)}
        </div>
      )}

      {topKeywords.length > 0 && (
        <div style={{ marginBottom: 5 }}>
          <span style={{ ...mono, fontSize: 9, color: '#4a5a4a', display: 'block', marginBottom: 3 }}>Intent keywords</span>
          {topKeywords.map(k => <div key={k.keyword} style={{ ...mono, fontSize: 10, color: '#aaa' }}>· {k.keyword} ({k.count})</div>)}
        </div>
      )}

      {d.knownContacts > 0 && (
        <div style={{ ...mono, fontSize: 10, color: '#aaa', marginTop: 4 }}>
          {d.knownContacts} known contact{d.knownContacts !== 1 ? 's' : ''}
        </div>
      )}

      {acc
        ? <div style={{ ...mono, fontSize: 9, color: TYPE_C.webVisit, marginTop: 6 }}>✓ In territory → {acc.stage || 'Prospecting'}</div>
        : <div style={{ ...mono, fontSize: 9, color: '#4a5a4a', marginTop: 6 }}>· Not in territory</div>
      }
    </div>
  );
}
