import { useState, useId } from 'react';
import { segments, barLabel, breakdownTitle, breakdownLines, GROUP_COLOR, GROUP_LABEL } from './topTargetsModel';

// S1: ONE five-segment bar, 160 px = 100 points (full width on a card). Hover or focus opens the breakdown: each
// group's inputs. On a card the five numbers sit under the bar instead.
export default function ScoreBar({ row, wide = false }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const segs = segments(row.groups, row.score);
  const bar = (
    <span className="tt-bar" style={wide ? { width: '100%' } : undefined}>
      {segs.map(s => <i key={s.key} data-seg={s.key} title={`${GROUP_LABEL[s.key]} ${s.points}`} style={{ width: `${s.pct}%`, background: GROUP_COLOR[s.key] }} />)}
    </span>
  );
  if (wide) {
    return (
      <div>
        <div role="img" aria-label={barLabel(row.groups)} data-score-bar>{bar}</div>
        <div className="tt-nums">{segs.map(s => <span key={s.key}><b>{s.points}</b> {GROUP_LABEL[s.key]}</span>)}</div>
      </div>
    );
  }
  return (
    <div style={{ position: 'relative' }} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className="tt-barbtn" data-score-bar aria-label={barLabel(row.groups)} aria-expanded={open} aria-controls={open ? id : undefined}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}>{bar}</button>
      {open && (
        <div id={id} role="tooltip" className="tt-pop" data-breakdown style={{ top: 18, left: 0, width: 372 }}>
          <h4>{breakdownTitle(row)}</h4>
          {breakdownLines(row).map(l => (
            <div key={l.key} className="tt-pr"><i style={{ background: GROUP_COLOR[l.key] }} /><b>{l.label}</b><em>{l.points}</em><span>{l.text}</span></div>
          ))}
          <div className="tt-popfoot">Bar length is the score out of 100. The five parts always add up to the number in the pill.</div>
        </div>
      )}
    </div>
  );
}
