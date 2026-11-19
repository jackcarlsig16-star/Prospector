import { useState, useMemo } from 'react';
import { SA } from '../theme';
import { Chart, HoverCard } from './ExplorerView';
import { geometry, heightPx } from './explorerModel';
import { chartData } from './scorecardWeekly';

// weekly-funnel-v1 W6 - a Scorecard row, expanded: the Explorer's chart over the row's own weekly series (the route's
// digits), the goal dotted where a week has one, this week's point hollow. Hover a week = week · value · goal; click pins.
const HEIGHT = 'compact';
export default function WeeklyChart({ metric, wording }) {
  const [hover, setHover] = useState(null);
  const [pinned, setPinned] = useState(null);
  const data = useMemo(() => chartData(metric), [metric]);
  const geom = geometry(data.labels.length, heightPx(HEIGHT));
  const active = pinned ?? hover;
  return (
    <div data-weekly-chart={metric.key} style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <div style={{ position: 'relative', minWidth: 0 }}>
        <Chart data={data} show="lines" height={HEIGHT} hover={hover} pinned={pinned} onHover={setHover} onPin={setPinned} countLine hollowCurrent />
        {active != null && <HoverCard data={data} index={active} pinned={pinned != null} geom={geom} />}
      </div>
      <span style={{ fontSize: 12, color: SA.muted, whiteSpace: 'normal' }}>
        {metric.hint ? `${metric.name} = ${metric.hint}. ` : ''}The hollow point is this week to date{data.series.length > 1 ? '; the dotted line is the goal of each week that has one' : ''}. {metric.kind === 'manual' ? wording?.manual : wording?.week}
      </span>
    </div>
  );
}
