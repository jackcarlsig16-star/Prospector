import { useState, useEffect, useRef, useCallback } from 'react';
import { SA, SA_TYPE, SA_SHAPE, SA_BAD_TINT } from './theme';
import { TREND_COLORS, TREND_THEME_CSS } from './palette';
import { EMAIL_HEALTH_THRESHOLDS } from './metrics.registry';
import { fetchEmailCounts, fetchSalesEvents, createSalesEvent } from './salesApi';
import { currentUserLabel } from './huddleApi';
import { laDateString } from './periods';
import { RANGES, buildBuckets, bucketStart, pct, shortDate } from './emailTrendData';
import EmailHealthTable from './EmailHealthTable';
import ExportButton from './ExportButton';
import { exportWidgetCsv } from './exportCsv';

// sales-email-trend-v1 REV2 Stage 3. Three stacked panels on one shared
// time axis instead of the SPEC's two: five toggleable rate lines in one
// panel can't pass the dataviz palette validator (lines cross, so every
// pair must be distinguishable), and the 2%/5% benchmarks belong to
// bounce/spam only - so deliverability and engagement each get their own
// panel, each within the validated 2-3 colour limit. Never a dual axis.
const DELIVERABILITY = [
  { key: 'hardBounce', label: 'Hard bounce', color: TREND_COLORS.hardBounce },
  { key: 'spamBlock', label: 'Spam block', color: TREND_COLORS.spamBlock },
];
const ENGAGEMENT = [
  { key: 'open', label: 'Open', color: TREND_COLORS.open },
  { key: 'reply', label: 'Reply', color: TREND_COLORS.reply },
  { key: 'click', label: 'Click', color: TREND_COLORS.click },
];
const DEFAULT_ON = { hardBounce: true, spamBlock: true, open: true, reply: true, click: false };
const MAILBOX_COLORS = [TREND_COLORS.mailbox1, TREND_COLORS.mailbox2];
const EVENT_CATEGORIES = ['deliverability', 'mailbox', 'sequence', 'list', 'other'];

const M = { left: 44, right: 92, top: 22 };
const PANEL = { sent: 120, deliverability: 120, engagement: 120 };
const GAP = 34;

function niceMax(v, floor) {
  const m = Math.max(v * 1.15, floor);
  const steps = [0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1];
  return steps.find(s => s >= m) || 1;
}

function countMax(v) {
  if (v <= 10) return 10;
  const mag = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / mag) * mag;
}

function roundedTopBar(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

const segButton = active => ({
  ...SA_TYPE.body, fontSize: 12, border: 0, borderRadius: 7, padding: '0 12px', height: 32, cursor: 'pointer',
  background: active ? SA.surface2 : 'transparent', color: active ? SA.text : SA.muted,
});
const segWrap = { display: 'inline-flex', background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusInner, padding: 3 };
const inputStyle = { ...SA_TYPE.body, fontSize: 12, height: 32, padding: '0 8px', background: SA.surface2, border: `1px solid ${SA.border}`, borderRadius: 7, color: SA.text };

export default function EmailTrendChart({ businessId, widgetId = 'email_trend' }) {
  const [data, setData] = useState(null);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');
  const [granularity, setGranularity] = useState('week');
  const [rangeId, setRangeId] = useState('30d');
  const [on, setOn] = useState(DEFAULT_ON);
  const [hover, setHover] = useState(null);
  const [width, setWidth] = useState(640);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ event_date: laDateString(), label: '', category: 'deliverability' });
  const [saving, setSaving] = useState(false);
  const wrapRef = useRef(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [counts, evs] = await Promise.all([fetchEmailCounts(businessId), fetchSalesEvents(businessId)]);
      setData(counts);
      setEvents(evs);
    } catch (e) {
      setError(e.message);
    }
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!wrapRef.current) return undefined;
    const ro = new ResizeObserver(entries => setWidth(Math.max(320, Math.floor(entries[0].contentRect.width))));
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [data]);

  const saveEvent = async e => {
    e.preventDefault();
    setSaving(true);
    try {
      const ev = await createSalesEvent(businessId, { ...draft, created_by: currentUserLabel() });
      setEvents(list => [...list, ev].sort((a, b) => a.event_date.localeCompare(b.event_date)));
      setAdding(false);
      setDraft(d => ({ ...d, label: '' }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (error && !data) return <p style={{ fontSize: 12, color: SA.bad }}>⚠ {error}</p>;
  if (!data) return <p style={{ fontSize: 12, color: SA.muted }}>Loading…</p>;
  if (!data.rows.length) {
    return <p style={{ fontSize: 12, color: SA.muted, padding: '12px 0' }}>No email history yet — it fills in after the first sync.</p>;
  }

  const { buckets, mailboxes } = buildBuckets(data.rows, { granularity, rangeId });
  const n = buckets.length;
  const plotW = width - M.left - M.right;
  const band = plotW / n;
  const xMid = i => M.left + band * i + band / 2;
  const barW = Math.max(3, Math.min(28, band * 0.6));

  const y0 = { sent: M.top, deliverability: M.top + PANEL.sent + GAP, engagement: M.top + PANEL.sent + GAP + PANEL.deliverability + GAP };
  const height = y0.engagement + PANEL.engagement + 26;

  const sentMax = countMax(Math.max(...buckets.map(b => b.sent), 1));
  // Low-volume buckets don't set the rate scale - one email bounced out of
  // one sent would otherwise squash every real week to the floor. Their
  // off-scale points are pinned to the top edge and say so.
  const scaled = buckets.some(b => !b.lowVolume && b.sent > 0) ? buckets.filter(b => !b.lowVolume) : buckets;
  const delivMax = niceMax(Math.max(0, ...scaled.flatMap(b => DELIVERABILITY.filter(s => on[s.key]).map(s => b.rates[s.key] || 0))), EMAIL_HEALTH_THRESHOLDS.concerning * 1.3);
  const engMax = niceMax(Math.max(0, ...scaled.flatMap(b => ENGAGEMENT.filter(s => on[s.key]).map(s => b.rates[s.key] || 0))), 0.05);
  const yRate = (panel, max) => v => y0[panel] + PANEL[panel] - (v / max) * PANEL[panel];

  const labelEvery = Math.ceil(n / Math.max(2, Math.floor(plotW / 64)));
  const eventsByBucket = new Map();
  for (const ev of events) {
    const k = bucketStart(ev.event_date, granularity);
    if (!eventsByBucket.has(k)) eventsByBucket.set(k, []);
    eventsByBucket.get(k).push(ev);
  }

  // Direct labels at the right edge, pushed apart so close values don't
  // overprint each other.
  const spreadLabels = (labels, minGap = 14) => {
    const sorted = [...labels].sort((a, b) => a.y - b.y);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].y - sorted[i - 1].y < minGap) sorted[i].y = sorted[i - 1].y + minGap;
    }
    return sorted;
  };

  const renderLines = (series, panel, max) => {
    const y = yRate(panel, max);
    const top = y0[panel];
    const labels = [];
    const lines = series.filter(s => on[s.key]).map(s => {
      const pts = buckets.map((b, i) => {
        const v = b.rates[s.key];
        if (v === null) return null;
        return { i, x: xMid(i), y: Math.max(top, y(v)), offScale: v > max, b };
      });
      const segs = [];
      for (let i = 1; i < pts.length; i++) {
        if (pts[i - 1] && pts[i]) segs.push({ a: pts[i - 1], z: pts[i], dashed: pts[i].b.partial || pts[i].offScale || pts[i - 1].offScale });
      }
      const last = [...pts].reverse().find(Boolean);
      if (last) labels.push({ y: last.y + 4, color: s.color, text: `${s.label} ${pct(last.b.rates[s.key])}` });
      return (
        <g key={s.key}>
          {segs.map(sg => (
            <line key={`${sg.a.i}-${sg.z.i}`} x1={sg.a.x} y1={sg.a.y} x2={sg.z.x} y2={sg.z.y} stroke={s.color} strokeWidth={2} strokeDasharray={sg.dashed ? '4 4' : undefined} strokeLinecap="round" />
          ))}
          {pts.filter(Boolean).map(p => {
            const hollow = p.b.lowVolume || p.b.partial || p.offScale;
            return (
              <g key={p.i}>
                <circle cx={p.x} cy={p.y} r={4} fill={hollow ? SA.surface : s.color} stroke={hollow ? s.color : SA.surface} strokeWidth={2} />
                {p.offScale && <text x={p.x + 8} y={p.y + 4} fontSize={9} fill={SA.muted}>{pct(p.b.rates[s.key], 0)} ↑<title>{`${s.label} ${pct(p.b.rates[s.key])} on ${p.b.sent} sent — off the scale, low volume`}</title></text>}
              </g>
            );
          })}
        </g>
      );
    });
    return (
      <g>
        {lines}
        {spreadLabels(labels).map(l => (
          <text key={l.text} x={width - M.right + 10} y={l.y} fontSize={11} fill={SA.text}><tspan fill={l.color}>●</tspan> {l.text}</text>
        ))}
      </g>
    );
  };

  const axis = (panel, max, fmt) => [0, max / 2, max].map(v => {
    const yy = y0[panel] + PANEL[panel] - (v / max) * PANEL[panel];
    return (
      <g key={`${panel}-${v}`}>
        <line x1={M.left} x2={width - M.right} y1={yy} y2={yy} stroke={SA.border} strokeWidth={1} />
        <text x={M.left - 8} y={yy + 4} fontSize={10} textAnchor="end" fill={SA.faint}>{fmt(v)}</text>
      </g>
    );
  });

  const legendToggle = s => (
    <button key={s.key} onClick={() => setOn(o => ({ ...o, [s.key]: !o[s.key] }))} aria-pressed={on[s.key]}
      style={{ ...SA_TYPE.body, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 10px', borderRadius: SA_SHAPE.radiusPill, cursor: 'pointer',
        background: on[s.key] ? SA.surface2 : 'transparent', border: `1px solid ${SA.border}`, color: on[s.key] ? SA.text : SA.faint }}>
      <span style={{ width: 10, height: 3, borderRadius: 2, background: on[s.key] ? s.color : SA.faint }} />{s.label}
    </button>
  );

  const hb = hover === null ? null : buckets[hover];
  const handleExport = () => exportWidgetCsv(widgetId, buckets.filter(b => b.sent > 0), [
    { label: granularity === 'week' ? 'Week starting' : 'Day', key: 'start' },
    { label: 'Partial', value: b => (b.partial ? 'yes' : '') },
    { label: 'Sent', value: b => b.sent },
    ...mailboxes.map(m => ({ label: `Sent ${m}`, value: b => b.sentByMailbox[m] })),
    { label: 'Delivered', value: b => b.delivered },
    { label: 'Hard bounced', value: b => b.hard_bounced },
    { label: 'Spam blocked', value: b => b.spam_blocked },
    { label: 'Opened', value: b => b.opened },
    { label: 'Clicked', value: b => b.clicked },
    { label: 'Replied', value: b => b.replied },
    { label: 'Hard bounce %', value: b => pct(b.rates.hardBounce) },
    { label: 'Spam block %', value: b => pct(b.rates.spamBlock) },
    { label: 'Total bounce % (Apollo-style)', value: b => pct(b.rates.totalBounce) },
    { label: 'Open %', value: b => pct(b.rates.open) },
    { label: 'Reply %', value: b => pct(b.rates.reply) },
    { label: 'Click %', value: b => pct(b.rates.click) },
    { label: 'Low volume', value: b => (b.lowVolume ? 'yes' : '') },
  ]);

  return (
    <div>
      <style>{TREND_THEME_CSS}</style>
      <div className="no-print" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={segWrap}>
          {[['week', 'Week'], ['day', 'Day']].map(([id, label]) => <button key={id} onClick={() => setGranularity(id)} style={segButton(granularity === id)}>{label}</button>)}
        </div>
        <div style={segWrap}>
          {RANGES.map(r => <button key={r.id} onClick={() => setRangeId(r.id)} style={segButton(rangeId === r.id)}>{r.label}</button>)}
        </div>
        <button onClick={() => setAdding(a => !a)} style={{ ...segButton(false), border: `1px solid ${SA.border}`, height: 38 }}>+ Add event</button>
        <span style={{ flex: 1 }} />
        <ExportButton onClick={handleExport} />
      </div>

      {adding && (
        <form onSubmit={saveEvent} className="no-print" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          <input type="date" required value={draft.event_date} onChange={e => setDraft(d => ({ ...d, event_date: e.target.value }))} style={inputStyle} />
          <input required maxLength={120} placeholder="What changed (e.g. jack@ reconnected)" value={draft.label} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} style={{ ...inputStyle, flex: '1 1 220px' }} />
          <select value={draft.category} onChange={e => setDraft(d => ({ ...d, category: e.target.value }))} style={inputStyle}>
            {EVENT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button type="submit" disabled={saving} style={{ ...inputStyle, background: SA.accent, color: SA.ground, border: 0, fontWeight: 600, cursor: 'pointer' }}>Save</button>
        </form>
      )}
      {error && data && <p style={{ fontSize: 12, color: SA.bad, margin: '0 0 8px' }}>⚠ {error}</p>}

      <div ref={wrapRef} style={{ position: 'relative' }} onMouseLeave={() => setHover(null)}>
        {/* viewBox + width 100% so the chart scales into the narrower printed column */}
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Email performance over time: sent volume, deliverability rates and engagement rates" style={{ display: 'block', overflow: 'visible', width: '100%', height: 'auto' }}>
          {/* Panel titles */}
          <text x={M.left} y={y0.sent - 8} fontSize={11} fill={SA.muted}>
            Sent{mailboxes.length > 1 ? ' by mailbox' : ''}
            {mailboxes.length > 1 && mailboxes.map((m, mi) => (
              <tspan key={m} fill={SA.text}>{'   '}<tspan fill={MAILBOX_COLORS[mi] || SA.faint}>■</tspan> {m.split('@')[0]}@</tspan>
            ))}
          </text>
          <text x={M.left} y={y0.deliverability - 8} fontSize={11} fill={SA.muted}>Deliverability (% of sent)</text>
          <text x={M.left} y={y0.engagement - 8} fontSize={11} fill={SA.muted}>Engagement (% of sent)</text>

          {axis('sent', sentMax, v => Math.round(v).toLocaleString())}
          {axis('deliverability', delivMax, v => pct(v, 0))}
          {axis('engagement', engMax, v => pct(v, 0))}

          {/* Benchmarks: bounce / spam only */}
          {(() => {
            const y = yRate('deliverability', delivMax);
            const top = y0.deliverability;
            return (
              <g>
                <rect x={M.left} y={top} width={plotW} height={Math.max(0, y(EMAIL_HEALTH_THRESHOLDS.concerning) - top)} fill={SA_BAD_TINT} />
                {[EMAIL_HEALTH_THRESHOLDS.good, EMAIL_HEALTH_THRESHOLDS.concerning].map(v => (
                  <line key={v} x1={M.left} x2={width - M.right} y1={y(v)} y2={y(v)} stroke={SA.muted} strokeWidth={1} strokeDasharray="5 4" />
                ))}
                {/* One combined label when the two lines sit too close to label separately */}
                {y(EMAIL_HEALTH_THRESHOLDS.good) - y(EMAIL_HEALTH_THRESHOLDS.concerning) < 16 ? (
                  <text x={width - M.right - 4} y={y(EMAIL_HEALTH_THRESHOLDS.concerning) - 4} fontSize={10} textAnchor="end" fill={SA.muted}>
                    good &lt; {pct(EMAIL_HEALTH_THRESHOLDS.good, 0)} · concerning &gt; {pct(EMAIL_HEALTH_THRESHOLDS.concerning, 0)}
                  </text>
                ) : [[EMAIL_HEALTH_THRESHOLDS.good, `good < ${pct(EMAIL_HEALTH_THRESHOLDS.good, 0)}`], [EMAIL_HEALTH_THRESHOLDS.concerning, `concerning > ${pct(EMAIL_HEALTH_THRESHOLDS.concerning, 0)}`]].map(([v, label]) => (
                  <text key={v} x={width - M.right - 4} y={y(v) - 4} fontSize={10} textAnchor="end" fill={SA.muted}>{label}</text>
                ))}
              </g>
            );
          })()}

          {/* Sent bars, stacked by mailbox with a 2px surface gap */}
          {buckets.map((b, i) => {
            let acc = 0;
            const x = xMid(i) - barW / 2;
            const segs = mailboxes.map((m, mi) => ({ m, v: b.sentByMailbox[m], color: MAILBOX_COLORS[mi] || SA.faint })).filter(s => s.v > 0);
            return (
              <g key={b.key} opacity={b.lowVolume ? 0.45 : 1}>
                {segs.map((s, si) => {
                  const h = (s.v / sentMax) * PANEL.sent;
                  const yTop = y0.sent + PANEL.sent - acc - h;
                  acc += h;
                  const gap = si < segs.length - 1 ? 2 : 0;
                  const isTop = si === segs.length - 1;
                  return isTop
                    ? <path key={s.m} d={roundedTopBar(x, yTop, barW, Math.max(0, h - gap), 4)} fill={s.color} fillOpacity={b.partial ? 0.5 : 1} stroke={b.partial ? s.color : 'none'} strokeDasharray={b.partial ? '3 2' : undefined} />
                    : <rect key={s.m} x={x} y={yTop + gap} width={barW} height={Math.max(0, h - gap)} fill={s.color} fillOpacity={b.partial ? 0.5 : 1} />;
                })}
                {b.partial && b.sent > 0 && <text x={xMid(i)} y={y0.sent + PANEL.sent - (b.sent / sentMax) * PANEL.sent - 5} fontSize={10} textAnchor="middle" fill={SA.muted}>partial</text>}
              </g>
            );
          })}
          {renderLines(DELIVERABILITY, 'deliverability', delivMax)}
          {renderLines(ENGAGEMENT, 'engagement', engMax)}

          {/* Event markers */}
          {buckets.map((b, i) => (eventsByBucket.get(b.key) || []).map((ev, ei) => (
            <g key={ev.id}>
              <line x1={xMid(i)} x2={xMid(i)} y1={y0.sent} y2={y0.engagement + PANEL.engagement} stroke={SA.accent} strokeWidth={1} strokeDasharray="2 3" opacity={0.8} />
              <text x={xMid(i) > width - M.right - 140 ? xMid(i) - 4 : xMid(i) + 4} textAnchor={xMid(i) > width - M.right - 140 ? 'end' : 'start'} y={y0.sent + 10 + ei * 12} fontSize={10} fill={SA.accent}>
                <title>{`${ev.event_date} · ${ev.label}${ev.created_by ? ` · ${ev.created_by}` : ''}`}</title>
                ▾ {ev.label.length > 22 ? `${ev.label.slice(0, 21)}…` : ev.label}
              </text>
            </g>
          )))}

          {/* x labels */}
          {buckets.map((b, i) => (i % labelEvery === 0 || i === n - 1) && (
            <text key={b.key} x={xMid(i)} y={height - 6} fontSize={10} textAnchor="middle" fill={SA.faint}>{b.label}</text>
          ))}

          {/* Hover layer: whole column is the hit target */}
          {hover !== null && <line x1={xMid(hover)} x2={xMid(hover)} y1={y0.sent} y2={y0.engagement + PANEL.engagement} stroke={SA.muted} strokeWidth={1} />}
          {buckets.map((b, i) => (
            <rect key={b.key} className="no-print" x={M.left + band * i} y={y0.sent} width={band} height={y0.engagement + PANEL.engagement - y0.sent} fill="transparent" onMouseEnter={() => setHover(i)} />
          ))}
        </svg>

        {hb && (
          <div className="no-print" style={{
            position: 'absolute', top: 8, left: Math.min(Math.max(0, xMid(hover) + 12), width - 250), width: 238, pointerEvents: 'none',
            background: SA.surface2, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusInner, padding: '10px 12px', fontSize: 12, color: SA.text, boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              {granularity === 'week' ? `Week of ${hb.label}` : shortDate(hb.start)}{hb.partial ? ' · partial' : ''}
            </div>
            <div>Sent {hb.sent.toLocaleString()}{mailboxes.length > 1 ? ` (${mailboxes.map(m => `${m.split('@')[0]} ${hb.sentByMailbox[m]}`).join(', ')})` : ''}</div>
            {hb.sent > 0 && [...DELIVERABILITY, { key: 'totalBounce', label: 'Total bounce (Apollo-style)' }, ...ENGAGEMENT].map(s => (
              <div key={s.key} style={{ color: s.key === 'totalBounce' ? SA.muted : SA.text, fontVariantNumeric: 'tabular-nums' }}>
                {s.label} {pct(hb.rates[s.key])} ({hb.counts[s.key]} / {hb.sent})
              </div>
            ))}
            {hb.lowVolume && <div style={{ color: SA.warn, marginTop: 4 }}>low volume — rates unreliable</div>}
            {(eventsByBucket.get(hb.key) || []).map(ev => <div key={ev.id} style={{ color: SA.accent, marginTop: 4 }}>▾ {ev.event_date}: {ev.label}</div>)}
          </div>
        )}
      </div>

      <div className="no-print" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        {[...DELIVERABILITY, ...ENGAGEMENT].map(legendToggle)}
      </div>

      <EmailHealthTable buckets={buckets} />

      <p style={{ fontSize: 11, color: SA.faint, margin: '12px 0 0', lineHeight: 1.5 }}>
        Counts are by send date: an open or reply is credited to the day its email went out. Rates are % of sent, which matches how Apollo reports bounce, spam block and reply.
        Open rates are an imperfect signal — security scanners and privacy features can inflate or suppress them, and ours can differ from Apollo’s. Reply rate is the more reliable engagement measure.
        {data.incomplete_weeks.length > 0 && ` Weeks ${data.incomplete_weeks.join(', ')} hit the fetch cap and may be undercounted.`}
      </p>
    </div>
  );
}
