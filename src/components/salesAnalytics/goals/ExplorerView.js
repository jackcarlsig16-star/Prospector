import { useState, useEffect, useRef, useMemo } from 'react';
import useMediaQuery from '../../../utils/useMediaQuery';
import { SA } from '../theme';
import { LAYERS, LAYER_IDS, SHOWS, BY, SPLITS, HEIGHTS, BAND } from '../../../constants/explorerLayers';
import Segmented from '../../../ui/Segmented';
import FilterSelect from '../../../ui/FilterSelect';
import { ToggleChip } from '../../../ui/Chip';
import { IconHeightCompact, IconHeightStandard, IconHeightTall } from '../../../ui/icons';
import { goalsApi } from './goalsApi';
import { exportWidgetCsv } from '../exportCsv';
import { cardStyle, labelStyle, numStyle, ErrorNote } from './goalsUi';
import { DEFAULTS, cleanState, readPrefs, writePrefs, fmtValue, heightPx, chipGlyph, scales, ticks, geometry, bucketAt, labelEvery, csvOf } from './explorerModel';

// dashboard-v3 Stage 3 (E) - the Explorer: one chart, your layers, over GET goals/explorer (every number the route's;
// this file draws and formats). LAYERS = outlined toggle chips (square = count on the left axis as columns, dash = rate
// on the right axis as a line); SHOW Lines · Columns · Table; BY Week · Day; SPLIT Team · Person · Mailbox · Sequence ·
// Cohort (one series per entity in its color, the legend carries the name - never a mailbox address); HEIGHT three stops;
// this period shaded; last value labelled at the line end; hover = a card with every ON series' value; click = pin.
// Save view (name -> sales_settings.saved_views, kind 'explorer') and Share (PNG of the card via html2canvas from the
// CDN + the CSV) are Members'; a Viewer sees neither. Threshold band behind a delivery layer: good < 2 %, concerning ≥ 5 %.
const HTML2CANVAS = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
const HEIGHT_ICON = { compact: <IconHeightCompact />, standard: <IconHeightStandard />, tall: <IconHeightTall /> };
const lbl = text => <span className="ui-group-label" aria-hidden="true" style={{ width: 56, flex: 'none' }}>{text}</span>;
const row = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 };
const GRID = 'rgba(120,130,144,.16)', SHADE = 'rgba(120,130,144,.08)';
function loadHtml2canvas() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  return new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = HTML2CANVAS; s.onload = () => resolve(window.html2canvas); s.onerror = () => reject(new Error('Could not load the screenshot library')); document.head.appendChild(s); });
}

export function Chart({ data, show, height, hover, pinned, onHover, onPin }) {
  const n = data.labels.length;
  const H = heightPx(height);
  const g = geometry(n, H);
  const sc = scales(data.series);
  const counts = data.series.filter(s => s.kind === 'count'), rates = data.series.filter(s => s.kind === 'rate');
  const asColumns = show === 'columns' ? data.series : counts;
  const asLines = show === 'columns' ? [] : rates;
  const yOf = s => (v => (s.kind === 'count' ? g.yCount(v, sc.maxCount) : g.yRate(v, sc.maxRate)));
  const cw = Math.min(g.maxColumn, (g.slot * 0.8) / Math.max(1, asColumns.length));
  const band = data.series.some(s => LAYERS[s.layer]?.band) && sc.hasRates;
  const every = labelEvery(n);
  const active = pinned ?? hover;
  const svgRef = useRef(null);
  const toIndex = e => { const r = svgRef.current.getBoundingClientRect(); return bucketAt(((e.clientX - r.left) / r.width) * g.W, g, n); };
  return (
    <svg ref={svgRef} width="100%" viewBox={`0 0 ${g.W} ${H}`} style={{ display: 'block', cursor: 'crosshair' }} role="img" aria-label={`Explorer: ${data.series.map(s => s.label).join(', ')} by ${data.by}`}
      data-explorer-chart onMouseMove={e => onHover(toIndex(e))} onMouseLeave={() => onHover(null)} onClick={e => { const i = toIndex(e); if (i != null) onPin(pinned === i ? null : i); }}>
      {band && <>
        <rect x={g.x0} y={g.yRate(Math.min(BAND.good, sc.maxRate), sc.maxRate)} width={g.plotW} height={g.y0 - g.yRate(Math.min(BAND.good, sc.maxRate), sc.maxRate)} fill="rgba(61,214,140,.08)" data-band="good" />
        {sc.maxRate > BAND.concerning && <rect x={g.x0} y={g.padT} width={g.plotW} height={g.yRate(BAND.concerning, sc.maxRate) - g.padT} fill="rgba(255,120,120,.08)" data-band="concerning" />}
      </>}
      {data.labels.map((l, i) => (l.current || i === active) && <rect key={`s${i}`} x={g.x0 + i * g.slot} y={g.padT} width={g.slot} height={g.plotH} fill={i === active && !l.current ? GRID : SHADE} data-shade={l.current ? 'current' : 'active'} />)}
      {ticks(1).map((t, i) => { const y = g.padT + g.plotH - t * g.plotH; return (
        <g key={i}>
          <line x1={g.x0} x2={g.x0 + g.plotW} y1={y} y2={y} stroke={GRID} />
          {sc.hasCounts && <text x={g.x0 - 6} y={y + 3} textAnchor="end" fontSize="10" fill="#6B7480">{Math.round(t * sc.maxCount).toLocaleString('en-US')}</text>}
          {sc.hasRates && <text x={g.x0 + g.plotW + 6} y={y + 3} fontSize="10" fill="#6B7480">{`${Math.round(t * sc.maxRate * 100)}%`}</text>}
        </g>); })}
      {asColumns.map((s, k) => s.values.map((v, i) => v == null ? null : (
        <rect key={`${k}-${i}`} x={g.x0 + i * g.slot + (g.slot - cw * asColumns.length) / 2 + k * cw} y={yOf(s)(v)} width={Math.max(1, cw - 1)} height={Math.max(0, g.y0 - yOf(s)(v))} fill={s.color} fillOpacity=".55" rx="2" data-col={s.layer} />
      )))}
      {asLines.map((s, k) => {
        const pts = s.values.map((v, i) => (v == null ? null : [g.center(i), yOf(s)(v)]));
        let d = '', on = false;
        pts.forEach(p => { if (!p) { on = false; return; } d += `${on ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)} `; on = true; });
        const lastI = s.values.map((v, i) => (v == null ? -1 : i)).filter(i => i >= 0).pop();
        return (
          <g key={`l${k}`} data-line={s.layer}>
            <path d={d} fill="none" stroke={s.color} strokeWidth="2" />
            {pts.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r="2.6" fill={s.color} />)}
            {lastI != null && lastI >= 0 && <text x={g.center(lastI) + 8} y={pts[lastI][1] + 3} fontSize="10.5" fontWeight="600" fill={s.color} data-end-label={s.layer}>{fmtValue('rate', s.values[lastI])}</text>}
          </g>
        );
      })}
      {data.labels.map((l, i) => (i % every === 0 || i === n - 1) && <text key={`t${i}`} x={g.center(i)} y={H - 7} textAnchor="middle" fontSize="10.5" fill="#A8B2C0">{l.label}</text>)}
      {pinned != null && <line x1={g.center(pinned)} x2={g.center(pinned)} y1={g.padT} y2={g.y0} stroke="#E9ECF0" strokeDasharray="3 3" data-pin-line />}
    </svg>
  );
}

function HoverCard({ data, index, pinned, geom }) {
  const l = data.labels[index];
  const left = Math.min(92, Math.max(0, ((geom.center(index) - geom.padL) / geom.plotW) * 100));
  return (
    <div data-hover-card={pinned ? 'pinned' : 'hover'} role={pinned ? 'status' : undefined} style={{ position: 'absolute', top: 8, left: `${left}%`, transform: left > 60 ? 'translateX(-100%)' : 'none', zIndex: 3, minWidth: 180, padding: '8px 10px', borderRadius: 8, background: SA.surface2, border: `1px solid ${SA.borderStrong}`, boxShadow: '0 8px 24px rgba(0,0,0,.4)', fontSize: 12, pointerEvents: 'none' }}>
      <div style={{ fontWeight: 600, color: SA.text, marginBottom: 4 }}>{data.by === 'day' ? l.label : `Week of ${l.label}`}{l.current ? ' · this ' + data.by : ''}{pinned ? ' · pinned' : ''}</div>
      {data.series.map(s => (
        <div key={`${s.layer}:${s.split_key}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: SA.soft }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i aria-hidden="true" style={{ width: 8, height: s.kind === 'count' ? 8 : 2, borderRadius: 2, background: s.color, display: 'inline-block' }} />{s.label}</span>
          <span style={{ ...numStyle, color: SA.text }}>{fmtValue(s.kind, s.values[index])}</span>
        </div>
      ))}
    </div>
  );
}

export default function ExplorerView({ businessId, canEdit, context = 'home', defaults = DEFAULTS, sub = 'one chart, your layers · 8 weeks + this week' }) {
  const phone = useMediaQuery('(max-width: 760px)');
  const [state, setState] = useState(() => readPrefs(context, defaults));
  const { layers, show, by, split, height } = state;
  const set = patch => setState(s => ({ ...s, ...patch }));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [hover, setHover] = useState(null);
  const [pinned, setPinned] = useState(null);
  const [views, setViews] = useState([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState('');
  const shotRef = useRef(null);
  useEffect(() => { writePrefs(context, state); }, [context, state]);
  useEffect(() => {
    let live = true;
    setError('');
    goalsApi.explorer(businessId, { layers: layers.join(','), by, split }).then(d => { if (live) { setData(d); setPinned(null); } }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [businessId, layers, by, split]);
  useEffect(() => { goalsApi.explorerViews(businessId).then(setViews).catch(() => setViews([])); }, [businessId]);
  useEffect(() => { if (!toast) return undefined; const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t); }, [toast]);

  const toggleLayer = id => set({ layers: layers.includes(id) ? (layers.length > 1 ? layers.filter(l => l !== id) : layers) : [...layers, id] });
  const geom = useMemo(() => (data ? geometry(data.labels.length, heightPx(height)) : null), [data, height]);
  const entities = useMemo(() => {
    if (!data || data.split === 'team') return [];
    const seen = new Map();
    for (const s of data.series) if (s.split_key !== 'team' && !seen.has(s.split_key)) seen.set(s.split_key, { key: s.split_key, label: s.label.split(' · ')[0], color: s.color });
    return [...seen.values()];
  }, [data]);
  const applyView = v => { set(cleanState(v.state, defaults)); setToast(`View "${v.name}" applied`); };
  const saveView = async e => {
    e.preventDefault();
    const name = saveName.trim() || `Explorer ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    setBusy('save');
    try { const r = await goalsApi.saveExplorerView(businessId, { name, state }); setViews(r.views); setSaveOpen(false); setSaveName(''); setToast(`Saved "${name}"`); }
    catch (err) { setToast(err.message); } finally { setBusy(''); }
  };
  const deleteView = async v => { try { setViews(await goalsApi.deleteExplorerView(businessId, v.id)); } catch (err) { setToast(err.message); } };
  const share = async () => {
    if (!data) return;
    setBusy('share');
    try {
      const { rows, columns } = csvOf(data);
      exportWidgetCsv('explorer', rows, columns);
      if (shotRef.current) {
        const h2c = await loadHtml2canvas();
        const canvas = await h2c(shotRef.current, { backgroundColor: '#1E242C', scale: 2, useCORS: true, logging: false });
        const a = document.createElement('a'); a.download = `explorer-${data.from}-${data.to}.png`; a.href = canvas.toDataURL('image/png'); a.click();
      }
      setToast('PNG and CSV downloading');
    } catch (err) { setToast(err.message); } finally { setBusy(''); }
  };
  const active = pinned ?? hover;

  return (
    <section ref={shotRef} aria-labelledby="h-explorer" data-explorer={context} data-explorer-state={`${show}|${by}|${split}|${height}`} style={{ ...cardStyle, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, position: 'relative' }}>
      {/* The controls row scrolls sideways on a phone: a segmented control cannot wrap, so nothing in it may shrink (the spacer's inline flex: 1 still wins). */}
      <style>{'[data-explorer-controls] > * { flex: none; }'}</style>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <h2 id="h-explorer" style={{ margin: 0, fontSize: 15, fontWeight: 600, color: SA.text }}>Explorer</h2>
        <span style={{ fontSize: 12, color: SA.muted }}>{sub}{data?.cached_at ? ' · cached' : ''}</span>
      </div>
      <div role="group" aria-label="Layers" style={{ ...row, gap: 6 }}>
        {lbl('Layers')}
        {LAYER_IDS.map(id => {
          const L = LAYERS[id];
          const note = data?.notes?.[id] || L.sub;
          return (
            <ToggleChip key={id} data-layer-chip={id} pressed={layers.includes(id)} title={`${layers.includes(id) ? 'Hide' : 'Show'} ${L.label}`} onClick={() => toggleLayer(id)}>
              <i aria-hidden="true" style={{ display: 'inline-block', borderRadius: 2, background: L.color, boxShadow: '0 0 0 1px rgba(11,13,16,.45)', ...(chipGlyph(id) === 'square' ? { width: 10, height: 10 } : { width: 12, height: 2 }) }} />
              {L.label}{note && <span style={{ fontWeight: 400, opacity: 0.85 }}>{note}</span>}
            </ToggleChip>
          );
        })}
      </div>
      <div className="no-print" data-html2canvas-ignore="true" data-explorer-controls style={{ ...row, gap: 10, ...(phone ? { flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: 4 } : {}) }}>
        {lbl('Show')}<Segmented label="Show" items={SHOWS.map(([id, label]) => ({ id, label }))} value={show} onChange={v => set({ show: v })} />
        <span className="ui-group-label" aria-hidden="true">By</span><Segmented label="By" items={BY.map(([id, label]) => ({ id, label }))} value={by} onChange={v => set({ by: v })} />
        <span className="ui-group-label" aria-hidden="true">Split</span><Segmented label="Split" items={SPLITS.map(([id, label]) => ({ id, label }))} value={split} onChange={v => set({ split: v })} />
        <span className="ui-group-label" aria-hidden="true">Height</span><Segmented label="Chart height" items={HEIGHTS.map(([id, label, px]) => ({ id, label: '', icon: HEIGHT_ICON[id], ariaLabel: `${label}, ${px}px`, title: `${label} · ${px} px` }))} value={height} onChange={v => set({ height: v })} />
        <span style={{ flex: 1 }} />
        {views.length > 0 && <FilterSelect label="Saved view" value="" options={[{ value: '', label: 'Saved views' }, ...views.map(v => ({ value: v.id, label: v.name }))]} onChange={id => { const v = views.find(x => x.id === id); if (v) applyView(v); }} />}
        {canEdit && <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" aria-expanded={saveOpen} onClick={() => setSaveOpen(o => !o)}>Save view</button>}
        {canEdit && <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={busy === 'share' || !data} onClick={share} title="Download this chart as a PNG and its numbers as a CSV">{busy === 'share' ? 'Sharing…' : 'Share'}</button>}
      </div>
      {saveOpen && canEdit && (
        <form data-save-form onSubmit={saveView} className="no-print" data-html2canvas-ignore="true" style={{ ...row, padding: '8px 10px', background: SA.surface2, border: `1px solid ${SA.border}`, borderRadius: 10 }}>
          <input className="ui-input ui-input--sm" aria-label="View name" placeholder="Name this view (e.g. Bounces by mailbox)" value={saveName} onChange={e => setSaveName(e.target.value)} style={{ width: 260 }} />
          <button type="submit" className="ui-btn ui-btn--primary ui-btn--sm" disabled={busy === 'save'}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
          {views.map(v => (
            <span key={v.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 12, color: SA.muted }}>
              <button type="button" className="ui-btn ui-btn--tertiary ui-btn--sm" onClick={() => applyView(v)}>{v.name}</button>
              <button type="button" className="ui-btn ui-btn--tertiary ui-btn--sm ui-btn--icon" aria-label={`Delete view ${v.name}`} onClick={() => deleteView(v)}>×</button>
            </span>
          ))}
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => setSaveOpen(false)}>Cancel</button>
        </form>
      )}
      {error && <ErrorNote message={error} />}
      {data && show !== 'table' && (
        <div style={{ position: 'relative', minWidth: 0, ...(phone ? { overflowX: 'auto' } : {}) }} {...(phone ? { tabIndex: 0, role: 'region', 'aria-label': 'Chart (scrolls sideways)' } : {})}>
          <div style={phone ? { minWidth: 720 } : undefined}>
            <Chart data={data} show={show} height={height} hover={hover} pinned={pinned} onHover={setHover} onPin={setPinned} />
          </div>
          {active != null && geom && <HoverCard data={data} index={active} pinned={pinned != null} geom={geom} />}
        </div>
      )}
      {data && show === 'table' && (
        <div className="ui-table-box" style={{ overflowX: 'auto' }}>
          <table className="ui-table ui-table--dense" data-explorer-table>
            <thead><tr><th>{data.by === 'day' ? 'Day' : 'Week of'}</th>{data.series.map(s => <th key={`${s.layer}:${s.split_key}`} style={{ textAlign: 'right' }}>{s.label}</th>)}</tr></thead>
            <tbody>
              {data.labels.map((l, i) => (
                <tr key={l.key} data-current={l.current || undefined} style={l.current ? { background: SHADE } : undefined}>
                  <td style={{ fontWeight: 500, color: SA.text }}>{l.label}{l.current ? ` · this ${data.by}` : ''}</td>
                  {data.series.map(s => <td key={`${s.layer}:${s.split_key}`} data-cell={`${s.layer}:${s.split_key}:${l.key}`} style={{ textAlign: 'right', ...numStyle }}>{fmtValue(s.kind, s.values[i])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!data && !error && <div style={{ height: heightPx(height), display: 'flex', alignItems: 'center', justifyContent: 'center', color: SA.muted, fontSize: 13 }}>Loading…</div>}
      {entities.length > 0 && (
        <div data-explorer-legend style={{ ...row, gap: 12, fontSize: 12, color: SA.muted }}>
          {entities.map(e => <span key={e.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: e.color, display: 'inline-block' }} />{e.label}</span>)}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12, color: SA.muted }}>
        <span>Counts on the left axis, rates on the right. Hover a {by} for every layer's value; click a {by} to pin it. This {by} is shaded.</span>
        <span style={{ fontSize: 11, color: SA.faint }}>{data ? `${data.labels.length} ${data.by}s · ${data.from} – ${data.to}` : ''}</span>
      </div>
      {toast && <div role="status" style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', padding: '8px 14px', borderRadius: 10, background: SA.surface2, border: `1px solid ${SA.border}`, fontSize: 13, color: SA.text, zIndex: 4 }}>{toast}</div>}
    </section>
  );
}
