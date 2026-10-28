import { SA } from '../../theme';
import { numStyle } from '../goalsUi';
import Segmented from '../../../../ui/Segmented';
import { ToggleChip } from '../../../../ui/Chip';
import { IconDots, IconBars, IconTable, IconIntent, IconSize, IconActivity, IconHeightCompact, IconHeightStandard, IconHeightTall, IconRings, IconTrend } from '../../../../ui/icons';
import { VIEWS, Y_METRICS, HEIGHTS, NAME_MODES, BANDS } from './prioritiesModel';
import { BAND_COLOR } from './DotsChart';

// priorities-v2 C - the CHART card's toolbar: how it's drawn, never what's in the set. View and Y as icon + word,
// "Ranked by intent" (D2, static), the Top stepper, three height icons; right: Rings, Since yesterday (D4 - a display
// toggle, not a filter), Names (FIX priorities-labels), the P1-P4 chips with counts (a click filters to that band).
// Three toggles, three behaviours: Names = labels on dots, Rings = component rings, Since yesterday = ▲ / ▼ markers.
export const TOP_STEPS = ['10', '20', '40', 'all'];
const VIEW_ICON = { dots: <IconDots />, bars: <IconBars />, table: <IconTable /> };
const Y_ICON = { intent: <IconIntent />, size: <IconSize />, activity: <IconActivity /> };
const HEIGHT_ICON = { compact: <IconHeightCompact />, standard: <IconHeightStandard />, tall: <IconHeightTall /> };
const lbl = text => <span className="ui-group-label" aria-hidden="true">{text}</span>;
const field = { display: 'inline-flex', alignItems: 'center', gap: 6 };
const keep = { 'data-keeps-selection': true, style: { ...field } };

export default function ChartToolbar({ view, setView, y, setY, topN, setTopN, height, setHeight, rings, setRings, showTrend, setShowTrend, names, setNames, counts = {}, band, onBand }) {
  const chart = view !== 'table';
  const i = TOP_STEPS.indexOf(topN);
  return (
    <div role="group" aria-label="Chart controls" data-chart-toolbar style={{ display: 'flex', alignItems: 'center', gap: '8px 14px', flexWrap: 'wrap' }}>
      <h2 className="ui-group-label" style={{ margin: 0 }}>Chart</h2>
      <Segmented label="View" items={VIEWS.map(([id, label]) => ({ id, label, icon: VIEW_ICON[id] }))} value={view} onChange={setView} />
      {chart && <>
        <span {...keep}>{lbl('Y axis')}<Segmented label="Y axis" items={Y_METRICS.map(([id, label]) => ({ id, label, icon: Y_ICON[id] }))} value={y} onChange={setY} /></span>
        <span style={{ fontSize: 12, color: SA.muted }} data-ranked-by>Ranked by intent</span>
        <span style={field}>
          {lbl('Top')}
          <span role="group" aria-label="How many to show" style={{ display: 'inline-flex', alignItems: 'center', height: 28, border: `1px solid ${SA.border}`, borderRadius: 6, background: SA.inset }}>
            <button type="button" className="ui-btn ui-btn--tertiary ui-btn--sm" aria-label="Fewer" disabled={i <= 0} onClick={() => setTopN(TOP_STEPS[i - 1])} style={{ height: 26, minWidth: 24, padding: 0 }}>−</button>
            <span data-top-n style={{ ...numStyle, minWidth: 34, textAlign: 'center', fontSize: 12, fontWeight: 500, color: SA.text }}>{topN === 'all' ? 'All' : topN}</span>
            <button type="button" className="ui-btn ui-btn--tertiary ui-btn--sm" aria-label="More" disabled={i >= TOP_STEPS.length - 1} onClick={() => setTopN(TOP_STEPS[i + 1])} style={{ height: 26, minWidth: 24, padding: 0 }}>+</button>
          </span>
        </span>
        <span {...keep}>{lbl('Height')}<Segmented label="Chart height" items={HEIGHTS.map(([id, label, px]) => ({ id, label: '', icon: HEIGHT_ICON[id], ariaLabel: `${label}, ${px}px`, title: `${label} · ${px} px` }))} value={height} onChange={setHeight} /></span>
      </>}
      <span style={{ flex: 1 }} />
      <span {...keep}>
        {chart && <ToggleChip pressed={rings} title="Draw the component rings (visits, people, fit, research, engagement) around each dot" onClick={() => setRings(!rings)}><IconRings size={13} />Rings</ToggleChip>}
        <ToggleChip pressed={showTrend} count={counts.band_changed ?? ''} title="Mark companies whose band changed since the last snapshot (▲ / ▼)" onClick={() => setShowTrend(!showTrend)}><IconTrend size={13} />Since yesterday</ToggleChip>
        {chart && <>{lbl('Names')}<Segmented label="Names" items={NAME_MODES.map(([id, label]) => ({ id, label }))} value={names} onChange={setNames} /></>}
      </span>
      <span role="group" aria-label="Bands" style={{ ...field, gap: 4 }}>
        {BANDS.map(b => (
          <ToggleChip key={b} data-band-chip={b} pressed={band === b} count={counts[b] ?? 0} title={`Show only ${b}`} onClick={() => onBand(band === b ? '' : b)} style={{ fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 11, letterSpacing: '.06em', borderColor: BAND_COLOR[b], color: BAND_COLOR[b] }}>{b}</ToggleChip>
        ))}
      </span>
    </div>
  );
}
