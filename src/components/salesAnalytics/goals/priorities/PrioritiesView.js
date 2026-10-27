import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { SA } from '../../theme';
import { goalsApi } from '../goalsApi';
import { updateOpportunity } from '../../pipelineApi';
import { SOURCE_THEME_CSS, SOURCE_LABELS, SOURCE_ORDER, sourceColor } from '../../palette';
import useMediaQuery from '../../../../utils/useMediaQuery';
import { FRAME_TOOLS_ID } from '../../salesFrame';
import Segmented from '../../../../ui/Segmented';
import FilterSelect from '../../../../ui/FilterSelect';
import Button from '../../../../ui/Button';
import { ToggleChip } from '../../../../ui/Chip';
import CompanyPanel from '../CompanyPanel';
import { numStyle, ErrorNote } from '../goalsUi';
import { TOP_CAP } from '../../../../constants/pipelineBoard';
import DotsChart from './DotsChart';
import BarsChart from './BarsChart';
import PrioritiesTable from './PrioritiesTable';
import QuickMenu from './QuickMenu';
import BriefCard from './BriefCard';
import ComposePanel from './ComposePanel';
import { Y_METRICS, VIEWS, SEGMENTS, WINDOWS, BANDS, EMPTY_FILTERS, PAGE_SIZE, filterParams, filtersFromView, activeFilterCount, isDimmed, toggleLit, pageOf, readViewPrefs, writeViewPrefs } from './prioritiesModel';

// intent-score-v1 S3 / S5 - Sales > Pipeline > Priorities: the book ranked by intent as DOTS (default), BARS or a
// TABLE; filters in one row above; the legend IS the source toggle (dims, never removes; colors follow the entity);
// a click selects -> the company window opens by key (the Pipeline row) and the quick menu appears under the chart;
// Share saves the filter state as a named view and exports a PNG (html2canvas, lazy from the CDN) + the CSV.
// Phone: the table by default, the chart in a sideways-scrolling card. Dark module -> .ui-theme-dark.
const HTML2CANVAS = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
const rowBar = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minHeight: 36 };
const rowKey = r => `${r.type}-${r.id}`;
const opts = (all, list) => [{ value: '', label: all }, ...list];
const TOP_N = [['40', 'Top 40'], ['20', 'Top 20'], ['10', 'Top 10'], ['all', 'Everything']];

function loadHtml2canvas() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  return new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = HTML2CANVAS; s.onload = () => resolve(window.html2canvas); s.onerror = () => reject(new Error('Could not load the screenshot library')); document.head.appendChild(s); });
}

export default function PrioritiesView({ businessId, canEdit, isAdmin, meId, onOpenPeople }) {
  const prefs = useMemo(readViewPrefs, []);
  const phone = useMediaQuery('(max-width: 760px)');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [y, setY] = useState(() => (Y_METRICS.some(([id]) => id === prefs.y) ? prefs.y : 'intent'));
  const [view, setView] = useState(() => (VIEWS.some(([id]) => id === prefs.view) ? prefs.view : null)); // null = dots (table on a phone)
  const [lit, setLit] = useState(() => new Set());
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
  const effectiveView = view || (phone ? 'table' : 'dots');

  useEffect(() => { setToolsSlot(document.getElementById(FRAME_TOOLS_ID)); }, []);
  useEffect(() => { goalsApi.members(businessId).then(setMembers).catch(() => setMembers([])); }, [businessId]);
  useEffect(() => { goalsApi.composeStatus(businessId).then(setCompose).catch(() => setCompose(null)); }, [businessId]);
  useEffect(() => { goalsApi.scoreViews(businessId).then(setViews).catch(() => setViews([])); }, [businessId]);
  useEffect(() => { writeViewPrefs({ y, view: view || undefined }); }, [y, view]);
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

  const rows = useMemo(() => {
    const all = data?.rows || [];
    return topN === 'all' ? all : all.slice(0, Number(topN));
  }, [data, topN]);
  const paged = useMemo(() => pageOf(rows, page, PAGE_SIZE), [rows, page]);
  const litCounts = data?.sources || {};
  const selected = useMemo(() => [...(data?.rows || []), ...(data?.live || [])].find(r => r.key === selectedKey) || null, [data, selectedKey]);
  const panelRow = panelKey && board ? board.find(r => rowKey(r) === panelKey) || null : null;
  const set = (k, v) => setFilters(f => ({ ...f, [k]: v }));
  const nFilters = activeFilterCount(filters);

  const select = r => {
    setSelectedKey(r.key);
    setPanelKey(r.key);
    if (!board) loadBoard();
  };
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
    const name = shareName.trim() || `Priorities ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
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

  const chartProps = { rows: paged.rows, lit, y, thresholds: data?.thresholds, caps: data?.caps, counts: data?.counts || {}, selectedKey, onSelect: select, showTrend, width: phone ? Math.max(width, 720) : width };
  const legend = (
    <div ref={legendRef} role="group" aria-label="Source" data-legend style={rowBar}>
      <span className="ui-group-label" aria-hidden="true">Source</span>
      {SOURCE_ORDER.map(s => (
        <ToggleChip key={s} pressed={lit.has(s)} data-legend-source={s} count={litCounts[s] ?? 0} title={`${SOURCE_LABELS[s]} - click to light only this source (others dim); click more to compare`} onClick={() => setLit(l => toggleLit(l, s))}>
          <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: sourceColor(s), flex: 'none' }} />{SOURCE_LABELS[s]}
        </ToggleChip>
      ))}
      {lit.size > 0 && <Button variant="tertiary" onClick={() => setLit(new Set())}>All sources</Button>}
    </div>
  );
  const filterControls = (
    <>
      <Segmented label="Segment" items={SEGMENTS.map(([id, label]) => ({ id, label }))} value={filters.segment} onChange={v => set('segment', v)} />
      <FilterSelect label="Owner" value={filters.owner} options={[...opts('All owners', members.filter(m => m.role !== 'viewer').map(m => ({ value: m.user_id, label: m.name }))), { value: 'unassigned', label: 'Unassigned' }]} onChange={v => set('owner', v)} />
      <FilterSelect label="Band" value={filters.band} options={opts('All bands', BANDS.map(b => ({ value: b, label: b })))} onChange={v => set('band', v)} />
      <FilterSelect label="Window" value={filters.window} options={WINDOWS.map(([value, label]) => ({ value, label }))} onChange={v => set('window', v)} />
      <ToggleChip pressed={filters.needs_touch} count={data?.counts?.needs_touch ?? ''} title={data ? `Score ≥ ${data.needs_touch_rule.min} and no touch in ${data.needs_touch_rule.days} days` : undefined} onClick={() => set('needs_touch', !filters.needs_touch)}>Needs a touch</ToggleChip>
      <ToggleChip pressed={showTrend} count={data?.counts?.band_changed ?? ''} title="Mark companies whose band changed since the last snapshot" onClick={() => setShowTrend(t => !t)}>Since yesterday</ToggleChip>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: SA.muted }}>
        Min score <input type="range" min={0} max={100} step={5} value={filters.min} aria-label="Minimum score" onChange={e => set('min', Number(e.target.value))} style={{ width: 90 }} /><span style={{ ...numStyle, minWidth: 22, color: SA.text }}>{filters.min}</span>
      </label>
      <input type="search" className="ui-input ui-input--sm" aria-label="Search companies" placeholder="Search" value={filters.q} onChange={e => set('q', e.target.value)} style={{ width: 140 }} />
      {nFilters > 0 && <Button variant="tertiary" onClick={() => setFilters(EMPTY_FILTERS)}>Clear ({nFilters})</Button>}
    </>
  );
  const tools = (
    <>
      {views.length > 0 && <FilterSelect label="Saved view" value="" options={opts('Saved views', views.map(v => ({ value: v.id, label: v.name })))} onChange={id => { const v = views.find(x => x.id === id); if (v) applyView(v); }} />}
      {canEdit && <button type="button" className="ui-btn ui-btn--secondary no-print" onClick={() => setShareOpen(o => !o)} title="Save this view by name, download a PNG of the chart and the CSV of the table">Share</button>}
      {isAdmin && <button type="button" className="ui-btn ui-btn--secondary no-print" disabled={recomputing} onClick={recompute} title="Recompute every company's score now (also runs after pulls, signals, research, source edits, syncs and once a day)">{recomputing ? 'Recomputing…' : 'Recompute now'}</button>}
    </>
  );
  const overlayRoot = document.getElementById('sales-analytics-root') || document.body;
  const stale = data?.stale;

  return (
    <section aria-label="Priorities" data-priorities style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <style>{SOURCE_THEME_CSS}</style>
      {toolsSlot && createPortal(tools, toolsSlot)}
      <div role="group" aria-label="Filters" data-filter-row style={rowBar}>{filterControls}</div>
      <div role="group" aria-label="View" data-view-row style={rowBar}>
        <span className="ui-group-label" aria-hidden="true">View</span>
        <Segmented label="Chart view" items={VIEWS.map(([id, label]) => ({ id, label }))} value={effectiveView} onChange={setView} />
        {effectiveView !== 'table' && <>
          <span className="ui-group-label" aria-hidden="true">Y</span>
          <Segmented label="Y axis" items={Y_METRICS.map(([id, label]) => ({ id, label }))} value={y} onChange={setY} />
          <span style={{ fontSize: 12, color: SA.muted }}>Rank by Intent</span>
          <FilterSelect label="Show" value={topN} options={TOP_N.map(([value, label]) => ({ value, label }))} onChange={setTopN} />
        </>}
        <span style={{ flex: 1 }} />
        {data && <span style={{ ...numStyle, fontSize: 12, color: SA.muted }} data-counts>{data.counts.shown} of {data.counts.ranked} ranked · P1 {data.counts.P1} · P2 {data.counts.P2} · P3 {data.counts.P3} · P4 {data.counts.P4}{data.counts.live ? ` · ${data.counts.live} live` : ''}{stale ? ' · scores older than a day' : ''}</span>}
      </div>
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
        <div ref={shotRef} data-share-shot style={{ display: 'flex', flexDirection: 'column', gap: 8, background: SA.inset, border: `1px solid ${SA.border}`, borderRadius: 12, padding: 12 }}>
          {legend}
          {nFilters > 0 && <div data-filter-line style={{ fontSize: 12, color: SA.muted }}>Filters: {filters.segment !== 'all' ? `${SEGMENTS.find(([id]) => id === filters.segment)?.[1]} · ` : ''}{filters.owner ? `${filters.owner === 'unassigned' ? 'Unassigned' : members.find(m => m.user_id === filters.owner)?.name || 'owner'} · ` : ''}{filters.band ? `${filters.band} · ` : ''}{filters.window ? `visited ${filters.window} d · ` : ''}{filters.needs_touch ? 'needs a touch · ' : ''}{filters.min ? `min ${filters.min} · ` : ''}{filters.q ? `"${filters.q}" · ` : ''}{data.today}</div>}
          {effectiveView === 'table'
            ? <PrioritiesTable rows={rows} live={data.live} lit={lit} selectedKey={selectedKey} onSelect={select} showTrend={showTrend} phone={phone} />
            : (
              <div ref={chartRef} data-chart-box style={{ overflowX: phone ? 'auto' : 'visible', minWidth: 0 }}>
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
      {selected && (
        <QuickMenu businessId={businessId} row={selected} members={members} meId={meId} canEdit={canEdit} compose={compose} nextStep={brief?.key === selected.key ? brief.brief?.next_step : null}
          onBrief={() => openBrief(selected)} onCompose={() => setComposeFor(selected)} onOpen={() => { setPanelKey(selected.key); if (!board) loadBoard(); }} onChanged={reloadAll} onToast={setToast} />
      )}
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
