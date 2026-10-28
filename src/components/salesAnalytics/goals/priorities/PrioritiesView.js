import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { SA } from '../../theme';
import { goalsApi } from '../goalsApi';
import { updateOpportunity } from '../../pipelineApi';
import { SOURCE_THEME_CSS, SOURCE_LABELS, SOURCE_ORDER, sourceColor } from '../../palette';
import useMediaQuery from '../../../../utils/useMediaQuery';
import { FRAME_TOOLS_ID } from '../../salesFrame';
import FilterSelect from '../../../../ui/FilterSelect';
import Button from '../../../../ui/Button';
import { ToggleChip } from '../../../../ui/Chip';
import CompanyPanel from '../CompanyPanel';
import { numStyle, ErrorNote } from '../goalsUi';
import { TOP_CAP } from '../../../../constants/pipelineBoard';
import DotsChart from './DotsChart';
import FilterBar from './FilterBar';
import ChartToolbar from './ChartToolbar';
import { IconRefresh } from '../../../../ui/icons';
import BarsChart from './BarsChart';
import PrioritiesTable from './PrioritiesTable';
import QuickMenu from './QuickMenu';
import BriefCard from './BriefCard';
import ComposePanel from './ComposePanel';
import { Y_METRICS, VIEWS, EMPTY_FILTERS, PAGE_SIZE, filterParams, filtersFromView, activeFilterCount, toggleLit, pageOf, readPrefs, writePrefs, heightPx } from './prioritiesModel';

// intent-score-v1 S3 / S5 - Sales > Pipeline > Priorities: the book ranked by intent as DOTS (default), BARS or a
// TABLE; filters in one row above; the legend IS the source toggle (dims, never removes; colors follow the entity);
// a click SELECTS (FIX priorities-select-vs-open-v1): the breakdown card pins beside the mark with the quick menu inside,
// a second click or Esc deselects; the company window opens only on purpose - the menu's Open, the name in the card or
// the table's Open, a double-click, Enter on a selected mark or "o". FIX priorities-click-outside-v1: a press anywhere
// else in the view deselects (pointerdown + pointerup on the section root, no document listener; a touch scroll cancels
// the press); the card, the menu, the marks, the Brief, the toast, the Y / Names switches keep it; an open Assign
// dropdown closes first; an open window or Write email panel owns the press;
// Share saves the filter state as a named view and exports a PNG (html2canvas, lazy from the CDN) + the CSV.
// Phone: the table by default, the chart in a sideways-scrolling card. Dark module -> .ui-theme-dark.
const HTML2CANVAS = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
const rowBar = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minHeight: 36 };
const rowKey = r => `${r.type}-${r.id}`;
const opts = (all, list) => [{ value: '', label: all }, ...list];
const card = { display: 'flex', flexDirection: 'column', gap: 10, background: SA.inset, border: `1px solid ${SA.border}`, borderRadius: 12, padding: 12 };
export const agoText = (iso, now = Date.now()) => { if (!iso) return 'never'; const m = Math.max(0, Math.round((now - Date.parse(iso)) / 6e4)); return m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const KEEPS_SELECTION = '[data-pinned-card], [data-quick-menu], [data-dot], [data-bar], [data-row-name], [data-brief-card], [data-keeps-selection], [role="status"]';

function loadHtml2canvas() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  return new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = HTML2CANVAS; s.onload = () => resolve(window.html2canvas); s.onerror = () => reject(new Error('Could not load the screenshot library')); document.head.appendChild(s); });
}

export default function PrioritiesView({ businessId, canEdit, isAdmin, meId, onOpenPeople }) {
  const prefs = useMemo(readPrefs, []);
  const phone = useMediaQuery('(max-width: 760px)');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [y, setY] = useState(prefs.y);
  const [view, setView] = useState(prefs.view); // null = dots (table on a phone)
  const [lit, setLit] = useState(() => new Set());
  const [names, setNames] = useState(prefs.names);
  const [height, setHeight] = useState(prefs.height);
  const [rings, setRings] = useState(prefs.rings);
  const [zerosOpen, setZerosOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [topN, setTopN] = useState('40');
  const [showTrend, setShowTrend] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [members, setMembers] = useState([]);
  const [board, setBoard] = useState(null); // the Pipeline rows (lazy) - the company window opens by their key
  const [selectedKey, setSelectedKey] = useState(null);
  const [panelKey, setPanelKey] = useState(null);
  const [brief, setBrief] = useState(null); // { key, brief?, error? }
  const [composeFor, setComposeFor] = useState(null);
  const [compose, setCompose] = useState(null);
  const [views, setViews] = useState([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareName, setShareName] = useState('');
  const [sharing, setSharing] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [toast, setToast] = useState(null);
  const [toolsSlot, setToolsSlot] = useState(null);
  const [width, setWidth] = useState(960);
  const [anchors, setAnchors] = useState({});
  const chartRef = useRef(null);
  const legendRef = useRef(null);
  const shotRef = useRef(null);
  const undoTimer = useRef(null);
  const subClose = useRef(null); // the quick menu's open dropdown, closed by an outside press before the selection would be
  const press = useRef(false);
  // brad-attribution-v1 F5: each card's funnel chain, read once (GET goals/sources/funnel) the first time a pointer or focus reaches the chart.
  const [chains, setChains] = useState(null);
  const chainsAsked = useRef(false);
  const effectiveView = view || (phone ? 'table' : 'dots');

  useEffect(() => { setToolsSlot(document.getElementById(FRAME_TOOLS_ID)); }, []);
  useEffect(() => { goalsApi.members(businessId).then(setMembers).catch(() => setMembers([])); }, [businessId]);
  useEffect(() => { goalsApi.composeStatus(businessId).then(setCompose).catch(() => setCompose(null)); }, [businessId]);
  useEffect(() => { goalsApi.scoreViews(businessId).then(setViews).catch(() => setViews([])); }, [businessId]);
  useEffect(() => { writePrefs({ y, view: view || undefined, names, height, rings }); }, [y, view, names, height, rings]);

  useEffect(() => {
    if (!toast) return undefined;
    undoTimer.current = setTimeout(() => setToast(null), toast.undo ? 8000 : 4000);
    return () => clearTimeout(undoTimer.current);
  }, [toast]);
  useEffect(() => {
    const el = chartRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(entries => { const w = entries[0]?.contentRect?.width; if (w) setWidth(Math.round(w)); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [effectiveView]);
  const load = useCallback(() => goalsApi.scores(businessId, filterParams(filters)).then(d => { setData(d); setError(''); }).catch(e => setError(e.message)), [businessId, filters]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [filters, topN]);
  const loadBoard = useCallback(() => goalsApi.pipelineBoard(businessId, true).then(setBoard).catch(e => setToast({ text: e.message })), [businessId]);
  const reloadAll = useCallback(() => { load(); if (board) loadBoard(); }, [load, board, loadBoard]);

  // Legend threads start at each lit pill's horizontal center, measured against the chart box.
  useEffect(() => {
    const box = chartRef.current?.getBoundingClientRect();
    if (!box || !legendRef.current) return;
    const next = {};
    for (const el of legendRef.current.querySelectorAll('[data-legend-source]')) {
      const r = el.getBoundingClientRect();
      next[el.getAttribute('data-legend-source')] = r.left + r.width / 2 - box.left;
    }
    setAnchors(next);
  }, [lit, width, effectiveView]);

  const needChains = useCallback(() => {
    if (chainsAsked.current) return;
    chainsAsked.current = true;
    goalsApi.sourcesFunnel(businessId).then(d => setChains(new Map(d.companies.map(c => [`${c.type}-${c.id}`, c])))).catch(() => { chainsAsked.current = false; });
  }, [businessId]);
  const rows = useMemo(() => {
    const all = (data?.rows || []).map(r => (chains?.has(r.key) ? { ...r, chain: chains.get(r.key) } : r));
    return topN === 'all' ? all : all.slice(0, Number(topN));
  }, [data, topN, chains]);
  const paged = useMemo(() => pageOf(rows, page, PAGE_SIZE), [rows, page]);
  const litCounts = data?.sources || {};
  const selected = useMemo(() => [...(data?.rows || []), ...(data?.live || [])].find(r => r.key === selectedKey) || null, [data, selectedKey]);
  const panelRow = panelKey && board ? board.find(r => rowKey(r) === panelKey) || null : null;
  const windowOpen = !!panelRow;
  // Esc clears the selection (and a stale window key) when no window / compose panel is open - those close themselves first.
  useEffect(() => {
    if (!selectedKey || windowOpen || composeFor) return undefined;
    const onKey = e => { if (e.key === 'Escape') { setSelectedKey(null); setPanelKey(null); setBrief(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedKey, windowOpen, composeFor]);
  const onPointerDown = e => {
    press.current = false;
    if (!selectedKey || windowOpen || composeFor || (e.button != null && e.button !== 0)) return;
    const t = e.target;
    if (t.closest?.(KEEPS_SELECTION) || t.hasAttribute?.('data-chart-box')) return; // a scrollbar press lands on the box itself
    if (subClose.current) { subClose.current(); return; }
    press.current = true;
  };
  const onPointerUp = () => { if (press.current) { press.current = false; setSelectedKey(null); setPanelKey(null); setBrief(null); } };
  const onPointerCancel = () => { press.current = false; };
  const setSubClose = useCallback(fn => { subClose.current = fn; }, []);
  const set = (k, v) => setFilters(f => ({ ...f, [k]: v }));
  const nFilters = activeFilterCount(filters);
  const stale = data?.stale;
  const overlayRoot = document.getElementById('sales-analytics-root') || document.body;

  const select = r => {
    setSelectedKey(k => (k === r.key ? null : r.key));
    if (selectedKey === r.key) setBrief(null);
    if (!board) loadBoard();
  };
  const open = r => { setPanelKey(r.key); if (!board) loadBoard(); };
  const openBrief = async r => {
    setBrief({ key: r.key });
    try { setBrief({ key: r.key, brief: await goalsApi.brief(businessId, r.type, r.id) }); } catch (e) { setBrief({ key: r.key, error: e.message }); }
  };
  const recompute = async () => {
    setRecomputing(true);
    try { const r = await goalsApi.recomputeScores(businessId); setToast({ text: `Recomputed ${r.counts.companies} companies · P1 ${r.counts.P1} · P2 ${r.counts.P2}` }); await load(); }
    catch (e) { setToast({ text: e.message }); }
    finally { setRecomputing(false); }
  };
  const applyView = v => { setFilters(filtersFromView(v.filters)); if (Y_METRICS.some(([id]) => id === v.y)) setY(v.y); if (VIEWS.some(([id]) => id === v.view)) setView(v.view); setLit(new Set()); };
  const share = async () => {
    const name = shareName.trim() || `Map ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    setSharing(true);
    try {
      const r = await goalsApi.saveScoreView(businessId, { name, filters: { ...filters, source: lit.size ? [...lit] : filters.source }, y, view: effectiveView });
      setViews(r.views);
      if (shotRef.current) {
        const h2c = await loadHtml2canvas();
        const canvas = await h2c(shotRef.current, { backgroundColor: '#12161B', scale: 2, useCORS: true, logging: false });
        const a = document.createElement('a'); a.download = `${name.replace(/[^\w-]+/g, '-')}.png`; a.href = canvas.toDataURL('image/png'); a.click();
      }
      window.open(goalsApi.scoresCsvUrl(businessId, filterParams({ ...filters, source: lit.size ? [...lit] : filters.source })), '_blank', 'noopener');
      setToast({ text: `Saved "${name}" · PNG and CSV downloading` });
      setShareOpen(false); setShareName('');
    } catch (e) { setToast({ text: e.message }); }
    finally { setSharing(false); }
  };
  const starRow = async r => {
    if (!r.top && board.filter(x => x.top).length >= TOP_CAP) throw new Error(`Top is full (${TOP_CAP}): unstar one first.`);
    if (r.type === 'partner') await goalsApi.partnerSignal(businessId, r.id, { type: 'hot', hot: !r.top });
    else await updateOpportunity(businessId, r.id, { is_top: !r.top });
    setBoard(bs => bs.map(x => (x.id === r.id ? { ...x, top: !r.top } : x)));
  };
  const patchRow = (r, patch) => setBoard(bs => bs.map(x => (rowKey(x) === rowKey(r) ? { ...x, ...patch } : x)));

  const menu = selected ? (
    <QuickMenu businessId={businessId} row={selected} members={members} meId={meId} canEdit={canEdit} compose={compose} nextStep={brief?.key === selected.key ? brief.brief?.next_step : null}
      onBrief={() => openBrief(selected)} onCompose={() => setComposeFor(selected)} onOpen={() => open(selected)} onChanged={reloadAll} onToast={setToast} onSubClose={setSubClose} />
  ) : null;
  const chartProps = { rows: paged.rows, lit, y, thresholds: data?.thresholds, caps: data?.caps, counts: data?.counts || {}, selectedKey, onSelect: select, onOpen: open, menu, showTrend, width: phone ? Math.max(width, 720) : width, names, phone, height: heightPx(height), rings };
  const zeroSources = SOURCE_ORDER.filter(s => !(litCounts[s] > 0) && !lit.has(s));
  const legend = (
    <div ref={legendRef} role="group" aria-label="Source" data-legend style={rowBar}>
      <span className="ui-group-label" aria-hidden="true">Source</span>
      {SOURCE_ORDER.filter(s => zerosOpen || !zeroSources.includes(s)).map(s => (
        <ToggleChip key={s} pressed={lit.has(s)} data-legend-source={s} count={litCounts[s] ?? 0} title={`${SOURCE_LABELS[s]} - click to light only this source (others dim); click more to compare`} onClick={() => setLit(l => toggleLit(l, s))}>
          <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: sourceColor(s), flex: 'none' }} />{SOURCE_LABELS[s]}
        </ToggleChip>
      ))}
      {zeroSources.length > 0 && <button type="button" className="ui-chip" data-zero-sources aria-expanded={zerosOpen} onClick={() => setZerosOpen(o => !o)} style={{ borderStyle: 'dashed', color: SA.muted }}>{zerosOpen ? 'Hide sources with 0' : `+ ${zeroSources.length} source${zeroSources.length === 1 ? '' : 's'} with 0`}</button>}
      {lit.size > 0 && <Button variant="tertiary" onClick={() => setLit(new Set())}>All sources</Button>}
    </div>
  );
  const tools = (
    <>
      {data && <span data-counts style={{ ...numStyle, fontSize: 12, color: SA.muted, whiteSpace: 'nowrap', marginRight: 'auto' }}>{data.counts.ranked} ranked · {data.counts.live} live · recomputed {agoText(data.computed_at)}{stale ? ' · scores older than a day' : ''}</span>}
      {views.length > 0 && <FilterSelect label="Saved view" value="" options={opts('Saved views', views.map(v => ({ value: v.id, label: v.name })))} onChange={id => { const v = views.find(x => x.id === id); if (v) applyView(v); }} />}
      {canEdit && <button type="button" className="ui-btn ui-btn--secondary no-print" onClick={() => setShareOpen(o => !o)} title="Save this view by name, download a PNG of the chart and the CSV of the table">Share</button>}
      {isAdmin && <button type="button" className="ui-btn ui-btn--secondary no-print" disabled={recomputing} onClick={recompute} title="Recompute every company's score now (also runs after pulls, signals, research, source edits, syncs and once a day)"><IconRefresh size={13} />{recomputing ? 'Recomputing…' : 'Recompute'}</button>}
    </>
  );

  return (
    <section aria-label="Map" data-priorities onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <style>{SOURCE_THEME_CSS}</style>
      {toolsSlot && createPortal(tools, toolsSlot)}
      <FilterBar filters={filters} set={set} onClear={() => setFilters(EMPTY_FILTERS)} data={data} members={members} />
      {shareOpen && (
        <form data-share-form onSubmit={e => { e.preventDefault(); share(); }} style={{ ...rowBar, padding: '8px 10px', background: SA.surface2, border: `1px solid ${SA.border}`, borderRadius: 10 }}>
          <input className="ui-input ui-input--sm" aria-label="View name" placeholder="Name this view (e.g. Brad's companies)" value={shareName} onChange={e => setShareName(e.target.value)} style={{ width: 260 }} />
          <button type="submit" className="ui-btn ui-btn--primary ui-btn--sm" disabled={sharing}>{sharing ? 'Saving…' : 'Save view + PNG + CSV'}</button>
          <a className="ui-btn ui-btn--secondary ui-btn--sm" href={goalsApi.scoresCsvUrl(businessId, filterParams(filters))} target="_blank" rel="noreferrer">CSV only</a>
          {views.length > 0 && views.map(v => <span key={v.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: SA.muted }}><button type="button" className="ui-btn ui-btn--tertiary ui-btn--sm" onClick={() => applyView(v)}>{v.name}</button><button type="button" className="ui-btn ui-btn--tertiary ui-btn--sm" aria-label={`Delete view ${v.name}`} onClick={async () => { try { setViews(await goalsApi.deleteScoreView(businessId, v.id)); } catch (e) { setToast({ text: e.message }); } }}>✕</button></span>)}
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => setShareOpen(false)}>Cancel</button>
        </form>
      )}
      {error && <ErrorNote message={error} />}
      {data && (
        <div ref={shotRef} data-share-shot role="group" aria-label="Chart" style={card}>
          <ChartToolbar view={effectiveView} setView={setView} y={y} setY={setY} topN={topN} setTopN={setTopN} height={height} setHeight={setHeight} rings={rings} setRings={setRings}
            showTrend={showTrend} setShowTrend={setShowTrend} names={names} setNames={setNames} counts={data.counts} band={filters.band} onBand={b => set('band', b)} />
          {legend}
          {nFilters > 0 && <div data-filter-line style={{ fontSize: 12, color: SA.muted }}>{data.counts.shown} of {data.counts.ranked} shown · {data.today}</div>}
          {effectiveView === 'table'
            ? <PrioritiesTable rows={rows} live={data.live} lit={lit} selectedKey={selectedKey} onSelect={select} onOpen={open} showTrend={showTrend} phone={phone} caps={data.caps} collapsible={false} />
            : (
              <div ref={chartRef} data-chart-box onPointerEnter={needChains} onFocus={needChains} style={{ overflowX: phone ? 'auto' : 'visible', minWidth: 0 }}>
                <div style={{ minWidth: phone ? 720 : 0 }}>
                  {effectiveView === 'bars' ? <BarsChart {...chartProps} /> : <DotsChart {...chartProps} anchors={anchors} />}
                </div>
              </div>
            )}
          {effectiveView !== 'table' && paged.pages > 1 && (
            <div data-pager style={{ ...rowBar, justifyContent: 'center', fontSize: 12, color: SA.muted }}>
              <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={paged.page === 0} onClick={() => setPage(p => p - 1)}>← Prev</button>
              <span style={numStyle}>{paged.from}–{paged.to} of {paged.total}</span>
              <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={paged.page >= paged.pages - 1} onClick={() => setPage(p => p + 1)}>Next →</button>
            </div>
          )}
          {data.counts.live > 0 && effectiveView !== 'table' && <div style={{ fontSize: 12, color: SA.muted }}>{data.counts.live} live (closed-won or pilot) and {data.counts.duplicates} duplicate{data.counts.duplicates === 1 ? '' : 's'} are out of the ranking - see the Table and the CSV.</div>}
        </div>
      )}
      {data && effectiveView !== 'table' && (
        <section aria-label="Detail" data-detail-card style={card}>
          <div style={{ ...rowBar, minHeight: 0 }}>
            <h2 className="ui-group-label" style={{ margin: 0 }}>{topN === 'all' ? 'Everything' : `Top ${topN}`} · detail</h2>
            <span style={{ fontSize: 12, color: SA.muted }}>Click a dot or a row — they select together</span>
            <span style={{ flex: 1 }} />
            <a className="ui-btn ui-btn--secondary ui-btn--sm" href={goalsApi.scoresCsvUrl(businessId, filterParams(filters))} target="_blank" rel="noreferrer">Export CSV</a>
          </div>
          <PrioritiesTable key={`${paged.page}-${topN}`} rows={paged.rows} live={data.live} lit={lit} selectedKey={selectedKey} onSelect={select} onOpen={open} showTrend={showTrend} phone={phone} caps={data.caps} from={paged.from} />
        </section>
      )}
      {effectiveView === 'table' && menu}
      {brief && selected && brief.key === selected.key && <BriefCard brief={brief.brief} error={brief.error} onClose={() => setBrief(null)} />}
      {composeFor && <ComposePanel businessId={businessId} row={composeFor} onClose={() => { setComposeFor(null); goalsApi.composeStatus(businessId).then(setCompose).catch(() => {}); }} onToast={setToast} />}
      {panelRow && (
        <CompanyPanel businessId={businessId} row={panelRow} canEdit={canEdit} members={members} meId={meId} onStar={() => starRow(panelRow)} onPatch={patch => patchRow(panelRow, patch)} onChanged={reloadAll} onToast={setToast}
          onConvert={reloadAll} onClose={() => setPanelKey(null)} onOpenFull={() => setPanelKey(null)} onOpenPeople={onOpenPeople && (c => { setPanelKey(null); onOpenPeople(c); })} />
      )}
      {panelKey && !panelRow && board && <span style={{ fontSize: 12, color: SA.muted }}>That company is not on the Pipeline board any more - recompute to refresh the ranking.</span>}
      {toast && createPortal(
        <div role="status" className="no-print" style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 4005, padding: '10px 16px', borderRadius: 10, background: SA.surface2, border: `1px solid ${SA.border}`, color: SA.text, fontSize: 14, display: 'flex', gap: 14, alignItems: 'center' }}>
          {toast.text}
          {toast.undo && <Button variant="tertiary" style={{ fontWeight: 600 }} onClick={async () => { const u = toast.undo; setToast(null); try { await u(); } catch (e) { setToast({ text: e.message }); } }}>Undo</Button>}
        </div>, overlayRoot)}
    </section>
  );
}
