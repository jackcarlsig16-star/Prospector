import { useState, useEffect, useMemo, useRef } from 'react';
import { mono } from '../constants/colors';
import { ALL_PRODUCTS, PRODUCTS_DATA } from '../constants/products/core';
import { MODELS } from '../config/models';
import { getACV } from '../utils/ledgerEngine';

const CACHE_KEY = 'prospector_veinmap_cache';
const TTL_MS = 24 * 60 * 60 * 1000;
const TIER_ORDER = { Gold: 0, Silver: 1, Tin: 2, Slag: 3 };

// ── Holographic palette — local to VeinMap, NOT shared T tokens ──────────────
const HOLO = {
  pageBg:      '#020408',
  gridBg:      '#040810',
  cellHoverBg: '#0a1520',
  headerBg:    '#030609',

  core:        '#39FF14',
  fit:         '#FF6B00',
  whitespace:  '#00F5FF',
  unscored:    '#1a2a1a',

  iceWhite:    '#C8E8FF',
  arrLabel:    '#4a7a9a',
  muted:       '#1e3a2a',
  sidebarLbl:  '#7ab8a0',
  hint:        '#2a5a4a',
};

// Category colors — overrides PRODUCTS_DATA.c so Open Finance gets the
// magenta distinct from Credit & Underwriting's blue.
const CATEGORY_COLOR = {
  'Payments & Bank Connectivity': '#FFB800',
  'Financial Insights':           '#A878F0',
  'KYC / AML / Fraud & Risk':     '#F06060',
  'Credit & Underwriting':        '#60A8F0',
  'Onboarding & Identity':        '#3EE088',
  'Open Finance & Platform':      '#F060C8',
};

const TIER_VISUAL = {
  Gold:   { c: '#FFD700', glow: '0 0 6px #FFD70066' },
  Silver: { c: '#7EB8D4', glow: '0 0 4px #7EB8D444' },
  Tin:    { c: '#8899AA', glow: 'none' },
  Slag:   { c: '#555566', glow: 'none' },
};

// Product → category-color map, built once at module load. Replaces PROD_COLOR
// so that any color drift in core.js doesn't leak into VeinMap.
const PRODUCT_CATEGORY_COLOR = (() => {
  const m = {};
  PRODUCTS_DATA.forEach(cat => {
    cat.items.forEach(p => { m[p.name] = CATEGORY_COLOR[cat.cat] || HOLO.iceWhite; });
  });
  return m;
})();

const KEYFRAMES = `
@keyframes vein-pulse {
  0%, 100% {
    box-shadow: 0 0 8px #39FF1488, 0 0 16px #39FF1422;
    opacity: 1;
    transform: scale(1);
  }
  50% {
    box-shadow: 0 0 16px #39FF14bb, 0 0 32px #39FF1455;
    opacity: 0.85;
    transform: scale(1.08);
  }
}
`;

const readCache = () => { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; } };
const writeCache = (c) => { try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch {} };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function scoreAccount(acc) {
  const promptSig = (acc.sigs || []).slice(0, 5).join('; ') || 'none';
  const promptPf = (acc.pf || '').slice(0, 300) || 'unknown';
  const userMsg = `Deal: ${acc.name}
Products already identified: ${acc.prods?.join(', ') || 'none'}
Use cases: ${acc.ucs?.join(', ') || 'none'}
product fit: ${promptPf}
Signals: ${promptSig}

Score each of these products 0-3:
${ALL_PRODUCTS.join(', ')}

Return JSON: { "Auth": 2, "Transactions": 3, ... }`;
  const res = await fetch('/proxy/anthropic/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELS.FAST,
      max_tokens: 600,
      system: 'You are a sales analyst. Given deal context, score each product 0-3: 3=core to this deal, 2=secondary fit, 1=future whitespace, 0=no signal. Return ONLY valid JSON, no preamble.',
      messages: [{ role: 'user', content: userMsg }],
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const text = data?.content?.[0]?.text || '';
  const cleaned = text.replace(/```json\n?/g, '').replace(/```/g, '').trim();
  const match = cleaned.match(/\{[\s\S]+\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

const SIGNAL_LABEL = { 3: 'Core', 2: 'Fit', 1: 'Whitespace', 0: 'None' };
const SIGNAL_COLOR = { 3: HOLO.core, 2: HOLO.fit, 1: HOLO.whitespace, 0: HOLO.unscored };

function Cell({ signal, productName, accName, acc, visible }) {
  const [hover, setHover] = useState(false);
  const isUnscored = signal === undefined || signal === null;
  // Render nothing when the signal level is toggled off in the legend, OR
  // when the score is 0 / unscored — empty cell, no glyph.
  const showGlyph = !isUnscored && signal > 0 && visible;
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: '100%', minWidth: 28, height: 28,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative',
        borderRight: '1px solid rgba(0,245,255,0.04)',
        borderBottom: '1px solid rgba(0,245,255,0.06)',
        background: hover ? HOLO.cellHoverBg : 'transparent',
        cursor: showGlyph ? 'pointer' : 'default',
        transition: 'background 0.1s',
      }}>
      {showGlyph && signal === 3 && (
        <span style={{
          width: 10, height: 10, borderRadius: '50%',
          background: HOLO.core,
          animation: 'vein-pulse 2.5s ease-in-out infinite',
        }}/>
      )}
      {showGlyph && signal === 2 && (
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: HOLO.fit,
          opacity: 0.7,
        }}/>
      )}
      {showGlyph && signal === 1 && (
        <span style={{
          width: 6, height: 6,
          border: `2px solid ${HOLO.whitespace}`,
          opacity: 0.15,
        }}/>
      )}
      {hover && showGlyph && (
        <div style={{
          position: 'absolute', bottom: '110%', left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(4, 12, 24, 0.95)',
          border: '1px solid rgba(0, 245, 255, 0.25)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.8), 0 0 12px rgba(0,245,255,0.1)',
          borderRadius: 6,
          backdropFilter: 'blur(12px)',
          padding: '10px 14px',
          whiteSpace: 'nowrap', zIndex: 100,
          ...mono,
          fontSize: 11,
          color: HOLO.iceWhite,
          pointerEvents: 'none',
          lineHeight: 1.6,
        }}>
          <div style={{ fontSize: 10, color: HOLO.sidebarLbl, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>{accName}</div>
          <div>{productName}</div>
          <div>
            <span style={{ color: HOLO.sidebarLbl, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', marginRight: 6 }}>Signal</span>
            <span style={{
              color: isUnscored ? HOLO.unscored : SIGNAL_COLOR[signal],
              textShadow: signal === 3 ? `0 0 6px ${HOLO.core}88` : 'none',
            }}>
              {isUnscored ? 'Unscored' : SIGNAL_LABEL[signal]}
            </span>
          </div>
          <div>
            <span style={{ color: HOLO.sidebarLbl, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', marginRight: 6 }}>Tier</span>
            <span>{acc.tier || '—'}</span>
            <span style={{ color: HOLO.sidebarLbl, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', marginLeft: 10, marginRight: 6 }}>ACV</span>
            <span>{getACV(acc) ? `$${Math.round(getACV(acc)).toLocaleString()}` : '—'}</span>
          </div>
          {acc.ucs?.length > 0 && (
            <div>
              <span style={{ color: HOLO.sidebarLbl, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', marginRight: 6 }}>UCs</span>
              <span>{acc.ucs.slice(0, 2).join(', ')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function VeinMap({ accounts = [], activeUser, managerSelectedAeId = null }) {
  const [cache, setCache] = useState(readCache);
  const [scope, setScope] = useState('active');
  const [tierFilter, setTierFilter] = useState(null);
  const [catFilter, setCatFilter] = useState(null);
  const [productFilter, setProductFilter] = useState(null);
  const [sortKey, setSortKey] = useState('tier');
  const [scoring, setScoring] = useState({ running: false, done: 0, total: 0 });
  const [visibleSignals, setVisibleSignals] = useState(() => new Set([1, 2, 3]));
  const abortRef = useRef(false);

  const toggleSignal = (s) => setVisibleSignals(prev => {
    const next = new Set(prev);
    if (next.has(s)) next.delete(s); else next.add(s);
    return next;
  });

  const inScope = useMemo(() => {
    let r = scope === 'active'
      ? accounts.filter(a => a.stage === 'Active Deal')
      : accounts;
    if (tierFilter) r = r.filter(a => a.tier === tierFilter);
    if (productFilter) r = r.filter(a => (cache[a.id]?.signals?.[productFilter] ?? 0) >= 1);
    if (managerSelectedAeId && managerSelectedAeId !== 'all') r = r.filter(a => a.aeId === managerSelectedAeId);
    return r;
  }, [accounts, scope, tierFilter, productFilter, cache, managerSelectedAeId]);

  const sortedRows = useMemo(() => {
    const list = [...inScope];
    if (sortKey === 'tier') {
      list.sort((a, b) => (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9) || (getACV(b) || 0) - (getACV(a) || 0));
    } else {
      list.sort((a, b) => ((cache[b.id]?.signals?.[sortKey] ?? -1) - (cache[a.id]?.signals?.[sortKey] ?? -1)));
    }
    return list;
  }, [inScope, sortKey, cache]);

  const productCols = useMemo(() => {
    if (!catFilter) return PRODUCTS_DATA;
    return PRODUCTS_DATA.filter(c => c.cat === catFilter);
  }, [catFilter]);

  const flatProducts = useMemo(() => productCols.flatMap(c => c.items.map(p => p.name)), [productCols]);

  const topByCore = useMemo(() => {
    const counts = {};
    inScope.forEach(a => {
      const sigs = cache[a.id]?.signals || {};
      Object.entries(sigs).forEach(([p, v]) => { if (v === 3) counts[p] = (counts[p] || 0) + 1; });
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [inScope, cache]);

  const lastScoredAt = useMemo(() => {
    let max = 0;
    Object.values(cache).forEach(e => {
      const t = e?.scoredAt ? new Date(e.scoredAt).getTime() : 0;
      if (t > max) max = t;
    });
    return max ? new Date(max) : null;
  }, [cache]);

  useEffect(() => {
    const stale = inScope.filter(a => {
      const entry = cache[a.id];
      if (!entry) return true;
      return Date.now() - new Date(entry.scoredAt).getTime() > TTL_MS;
    });
    if (!stale.length || scoring.running) return;
    abortRef.current = false;
    setScoring({ running: true, done: 0, total: stale.length });
    (async () => {
      let working = { ...cache };
      for (let i = 0; i < stale.length; i++) {
        if (abortRef.current) break;
        const acc = stale[i];
        const signals = await scoreAccount(acc);
        if (signals) {
          working = { ...working, [acc.id]: { signals, scoredAt: new Date().toISOString() } };
          writeCache(working);
          setCache(working);
        }
        setScoring(s => ({ ...s, done: i + 1 }));
        await sleep(300);
      }
      setScoring({ running: false, done: 0, total: 0 });
    })();
    return () => { abortRef.current = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inScope.length, scope]);

  const rescoreVisible = () => {
    const next = { ...cache };
    inScope.forEach(a => { delete next[a.id]; });
    writeCache(next);
    setCache(next);
  };

  const pill = (label, on, onClick, color = HOLO.core) => (
    <button onClick={onClick} style={{
      ...mono,
      fontSize: 11,
      padding: '3px 10px',
      borderRadius: 3,
      border: `1px solid ${on ? `${color}66` : '#0f2a1a'}`,
      background: on ? `${color}15` : 'transparent',
      color: on ? color : HOLO.hint,
      cursor: 'pointer',
      fontWeight: on ? 600 : 400,
      boxShadow: on ? `0 0 8px ${color}22` : 'none',
      transition: 'all 0.15s',
    }}>{label}</button>
  );

  const fmtLastScored = (d) => {
    if (!d) return '';
    const secs = Math.floor((Date.now() - d.getTime()) / 1000);
    if (secs < 60) return 'just now';
    if (secs < 3600) return `${Math.floor(secs/60)}m ago`;
    if (secs < 86400) return `${Math.floor(secs/3600)}h ago`;
    return `${Math.floor(secs/86400)}d ago`;
  };

  return (
    <div style={{
      background: HOLO.pageBg,
      width: '100%',
      height: 'calc(100vh - 100px)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      borderRadius: 6,
    }}>
      <style>{KEYFRAMES}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, padding: '14px 16px', flexWrap: 'wrap', flexShrink: 0 }}>
        <div>
          <p style={{ ...mono, margin: '0 0 4px', fontSize: 10, color: HOLO.sidebarLbl, textTransform: 'uppercase', letterSpacing: '0.14em', textShadow: `0 0 8px ${HOLO.whitespace}33` }}>⛏ VEIN MAP</p>
          <p style={{ margin: '0 0 3px', fontSize: 22, fontWeight: 400, color: HOLO.iceWhite, letterSpacing: '0.01em' }}>
            Territory <span style={{ color: HOLO.core, textShadow: `0 0 12px ${HOLO.core}66`, padding: '0 4px' }}>×</span> Product Matrix
          </p>
          <p style={{ ...mono, margin: 0, fontSize: 11, color: HOLO.hint }}>AI-powered cross-sell map · scored fresh every 24h</p>
        </div>
        <div style={{ flex: 1 }} />
        {scoring.running && (
          <span style={{ ...mono, fontSize: 11, color: HOLO.fit, display: 'inline-flex', alignItems: 'center', gap: 6, textShadow: `0 0 8px ${HOLO.fit}66` }}>
            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: HOLO.fit, boxShadow: `0 0 8px ${HOLO.fit}` }} />
            Scoring {scoring.done} / {scoring.total}…
          </span>
        )}
        {!scoring.running && lastScoredAt && (
          <span style={{ ...mono, fontSize: 10, color: HOLO.muted }}>Last scored {fmtLastScored(lastScoredAt)}</span>
        )}
        <button onClick={rescoreVisible} disabled={scoring.running} style={{
          ...mono, fontSize: 11, padding: '6px 14px',
          background: 'transparent',
          border: `1px solid ${scoring.running ? '#0f2a3a' : `${HOLO.whitespace}44`}`,
          color: scoring.running ? HOLO.muted : HOLO.whitespace,
          borderRadius: 4,
          cursor: scoring.running ? 'not-allowed' : 'pointer',
          boxShadow: scoring.running ? 'none' : `0 0 12px ${HOLO.whitespace}22`,
          letterSpacing: '0.06em',
          transition: 'all 0.15s',
        }}>⟳ RESCORE</button>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 6, padding: '0 16px 12px', flexWrap: 'wrap', alignItems: 'center', flexShrink: 0 }}>
        <span style={{ ...mono, fontSize: 10, color: HOLO.sidebarLbl, marginRight: 4, letterSpacing: '0.12em' }}>SCOPE</span>
        {pill('Active Deals', scope === 'active', () => setScope('active'))}
        {pill('All accounts', scope === 'all', () => setScope('all'))}
        <span style={{ ...mono, fontSize: 10, color: HOLO.sidebarLbl, marginLeft: 12, marginRight: 4, letterSpacing: '0.12em' }}>TIER</span>
        {['Gold', 'Silver', 'Tin', 'Slag'].map(t => pill(t, tierFilter === t, () => setTierFilter(tierFilter === t ? null : t), TIER_VISUAL[t].c))}
        <span style={{ ...mono, fontSize: 10, color: HOLO.sidebarLbl, marginLeft: 12, marginRight: 4, letterSpacing: '0.12em' }}>CATEGORY</span>
        {PRODUCTS_DATA.map(c => pill(c.cat.split(' ')[0], catFilter === c.cat, () => setCatFilter(catFilter === c.cat ? null : c.cat), CATEGORY_COLOR[c.cat] || HOLO.iceWhite))}
        {productFilter && pill(`× ${productFilter}`, true, () => setProductFilter(null), HOLO.fit)}
      </div>

      {/* Grid + sidebar — fill remaining viewport, flush, no gap */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{
          flex: 1, overflowX: 'auto', overflowY: 'auto',
          background: HOLO.gridBg,
          borderTop: '1px solid rgba(0, 245, 255, 0.08)',
          borderRight: '1px solid rgba(0, 245, 255, 0.08)',
          boxShadow: 'inset 0 0 40px rgba(0,245,255,0.02)',
        }}>
          <table style={{ borderCollapse: 'collapse', ...mono, fontSize: 11, width: '100%', minWidth: 'max-content' }}>
            <thead>
              {/* Category row */}
              <tr>
                <th style={{
                  position: 'sticky', top: 0, left: 0, zIndex: 30,
                  background: HOLO.headerBg,
                  borderRight: '1px solid rgba(0,245,255,0.08)',
                  borderBottom: '2px solid rgba(0,245,255,0.15)',
                  width: 180, minWidth: 180, maxWidth: 180,
                  padding: '8px 12px', textAlign: 'left',
                  boxShadow: '0 2px 12px rgba(0,245,255,0.08)',
                }}/>
                {productCols.map(c => {
                  const cc = CATEGORY_COLOR[c.cat] || HOLO.iceWhite;
                  return (
                    <th key={c.cat} colSpan={c.items.length} style={{
                      position: 'sticky', top: 0, zIndex: 10,
                      background: `linear-gradient(180deg, ${cc}18 0%, ${HOLO.headerBg} 100%)`,
                      borderTop: `2px solid ${cc}`,
                      borderLeft: '1px solid rgba(0,245,255,0.12)',
                      borderBottom: '2px solid rgba(0,245,255,0.15)',
                      padding: '6px 6px 8px',
                      color: cc,
                      fontSize: 9,
                      textTransform: 'uppercase',
                      letterSpacing: '0.12em',
                      textAlign: 'center',
                      fontWeight: 600,
                      textShadow: `0 0 12px ${cc}66`,
                    }}>{c.cat}</th>
                  );
                })}
              </tr>
              {/* Product row */}
              <tr>
                <th style={{
                  position: 'sticky', top: 34, left: 0, zIndex: 30,
                  background: HOLO.headerBg,
                  borderRight: '1px solid rgba(0,245,255,0.12)',
                  borderBottom: '2px solid rgba(0,245,255,0.15)',
                  width: 180, minWidth: 180, maxWidth: 180,
                  padding: '4px 12px', textAlign: 'left',
                  fontSize: 9, color: HOLO.sidebarLbl, letterSpacing: '0.12em',
                }}>
                  ACCOUNT ({sortedRows.length})
                </th>
                {flatProducts.map(p => {
                  const cc = PRODUCT_CATEGORY_COLOR[p] || HOLO.iceWhite;
                  const isSorted = sortKey === p;
                  return (
                    <th key={p}
                      onClick={() => setSortKey(sortKey === p ? 'tier' : p)}
                      style={{
                        position: 'sticky', top: 34, zIndex: 10,
                        background: HOLO.headerBg,
                        borderRight: '1px solid rgba(0,245,255,0.04)',
                        borderBottom: '2px solid rgba(0,245,255,0.15)',
                        minWidth: 28, height: 86, padding: 0,
                        cursor: 'pointer',
                        color: isSorted ? HOLO.core : cc,
                        fontSize: 9, verticalAlign: 'bottom',
                        opacity: isSorted ? 1 : 0.7,
                        textShadow: isSorted ? `0 0 8px ${HOLO.core}66` : 'none',
                      }}>
                      <div style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', padding: '4px 0', whiteSpace: 'nowrap', textAlign: 'left' }}>{p}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(a => {
                const sigs = cache[a.id]?.signals || {};
                const acv = getACV(a);
                const tv = TIER_VISUAL[a.tier] || { c: HOLO.muted, glow: 'none' };
                return (
                  <tr key={a.id} style={{ transition: 'background 0.12s' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'linear-gradient(90deg, rgba(57,255,20,0.05) 0%, transparent 60%)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={{
                      position: 'sticky', left: 0, zIndex: 20,
                      background: HOLO.gridBg,
                      borderRight: '1px solid rgba(0,245,255,0.12)',
                      borderBottom: '1px solid rgba(0,245,255,0.06)',
                      padding: '6px 12px',
                      width: 180, minWidth: 180, maxWidth: 180,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                        <span style={{
                          width: 8, height: 8, borderRadius: '50%',
                          background: tv.c, boxShadow: tv.glow, flexShrink: 0,
                        }} />
                        <span style={{ fontSize: 11, color: HOLO.iceWhite, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, fontWeight: 400 }}>{a.name}</span>
                        {acv > 0 && <span style={{ fontSize: 10, color: HOLO.arrLabel, flexShrink: 0 }}>${Math.round(acv / 1000)}k</span>}
                      </div>
                    </td>
                    {flatProducts.map(p => (
                      <td key={p} style={{ padding: 0 }}>
                        <Cell signal={sigs[p]} productName={p} accName={a.name} acc={a} visible={sigs[p] != null && visibleSignals.has(sigs[p])} />
                      </td>
                    ))}
                  </tr>
                );
              })}
              {!sortedRows.length && (
                <tr><td colSpan={flatProducts.length + 1} style={{ padding: 32, textAlign: 'center', color: HOLO.muted, ...mono, fontSize: 12 }}>No accounts in scope.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Sidebar — frosted glass intelligence panel, flush against grid */}
        <div style={{
          width: 220, flexShrink: 0,
          display: 'flex', flexDirection: 'column', gap: 14,
          background: 'rgba(2, 8, 16, 0.85)',
          borderLeft: '1px solid rgba(0, 245, 255, 0.12)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          padding: '14px 14px',
          overflowY: 'auto',
        }}>
          <div>
            <p style={{ ...mono, fontSize: 9, color: HOLO.whitespace, textTransform: 'uppercase', letterSpacing: '0.15em', margin: '0 0 8px', textShadow: `0 0 8px ${HOLO.whitespace}44`, borderBottom: '1px solid rgba(0,245,255,0.1)', paddingBottom: 4 }}>LEGEND</p>
            <div style={{ ...mono, fontSize: 11, lineHeight: 2, color: HOLO.sidebarLbl }}>
              {[
                { sig: 3, label: 'Core (3)',       sub: 'must-have',
                  swatch: <span style={{ width: 10, height: 10, borderRadius: '50%', background: HOLO.core, boxShadow: `0 0 8px ${HOLO.core}88`, display: 'inline-block' }}/> },
                { sig: 2, label: 'Fit (2)',        sub: 'secondary',
                  swatch: <span style={{ width: 6, height: 6, borderRadius: '50%', background: HOLO.fit, opacity: 0.7, display: 'inline-block' }}/> },
                { sig: 1, label: 'Whitespace (1)', sub: 'future',
                  swatch: <span style={{ width: 6, height: 6, border: `2px solid ${HOLO.whitespace}`, opacity: 0.15, display: 'inline-block' }}/> },
              ].map(({ sig, label, sub, swatch }) => {
                const on = visibleSignals.has(sig);
                return (
                  <button key={sig} onClick={() => toggleSignal(sig)} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    background: 'transparent', border: 'none', padding: '2px 0',
                    cursor: 'pointer', width: '100%', textAlign: 'left',
                    opacity: on ? 1 : 0.35,
                    transition: 'opacity 0.15s',
                    ...mono, fontSize: 11,
                  }}>
                    <span style={{ width: 12, display: 'inline-flex', justifyContent: 'center' }}>{swatch}</span>
                    <span style={{ color: HOLO.iceWhite, textDecoration: on ? 'none' : 'line-through' }}>{label}</span>
                    <span style={{ color: HOLO.muted, textDecoration: on ? 'none' : 'line-through' }}>· {sub}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p style={{ ...mono, fontSize: 9, color: HOLO.whitespace, textTransform: 'uppercase', letterSpacing: '0.15em', margin: '0 0 8px', textShadow: `0 0 8px ${HOLO.whitespace}44`, borderBottom: '1px solid rgba(0,245,255,0.1)', paddingBottom: 4 }}>TOP BY CORE SIGNAL</p>
            {topByCore.length === 0 ? (
              <p style={{ ...mono, fontSize: 11, color: HOLO.muted, margin: 0 }}>No core signals yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {topByCore.map(([p, count], idx) => {
                  const cc = PRODUCT_CATEGORY_COLOR[p] || HOLO.iceWhite;
                  const on = productFilter === p;
                  return (
                    <button key={p} onClick={() => setProductFilter(on ? null : p)} style={{
                      ...mono, fontSize: 11,
                      padding: '4px 6px',
                      background: on ? `${HOLO.core}10` : 'transparent',
                      border: 'none',
                      borderBottom: idx === topByCore.length - 1 ? 'none' : '1px solid rgba(0,245,255,0.05)',
                      borderLeft: on ? `2px solid ${HOLO.core}` : '2px solid transparent',
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      transition: 'all 0.12s',
                    }}>
                      <span style={{ color: on ? HOLO.core : HOLO.iceWhite, textShadow: on ? `0 0 6px ${HOLO.core}66` : 'none' }}>{p}</span>
                      <span style={{ color: cc, textShadow: `0 0 6px ${cc}44` }}>{count}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <p style={{ ...mono, fontSize: 9, color: HOLO.whitespace, textTransform: 'uppercase', letterSpacing: '0.15em', margin: '0 0 6px', textShadow: `0 0 8px ${HOLO.whitespace}44`, borderBottom: '1px solid rgba(0,245,255,0.1)', paddingBottom: 4 }}>IN SCOPE</p>
            <p style={{ ...mono, fontSize: 32, color: HOLO.core, margin: 0, fontWeight: 400, textShadow: `0 0 20px ${HOLO.core}66`, letterSpacing: '0.02em' }}>{sortedRows.length}</p>
            <p style={{ ...mono, fontSize: 10, color: HOLO.muted, margin: '2px 0 0' }}>of {accounts.length} total</p>
          </div>
        </div>
      </div>
    </div>
  );
}
