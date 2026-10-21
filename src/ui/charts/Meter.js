import { ui } from '../kitTheme';
import { fmtNum } from './chartKit';

// One ratio against a cap. The fill carries the state (accent -> warn past
// 80% -> bad at the cap); the track is a lighter step of the same ramp, and
// the numbers sit beside it so color is never the only signal.
export default function Meter({ label, value, cap, caption }) {
  const p = cap > 0 ? Math.min(1, value / cap) : 0;
  const fill = p >= 1 ? ui.bad : p >= 0.8 ? ui.warn : ui.accent;
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={cap} aria-valuenow={Math.min(value, cap)} aria-valuetext={`${fmtNum(value)} of ${fmtNum(cap)}`} style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 28, fontWeight: 600, lineHeight: 1.1, color: ui.text }}>{fmtNum(value)}</span>
        <span style={{ fontSize: 13, color: ui.muted }}>of {fmtNum(cap)}{caption ? ` · ${caption}` : ''}</span>
      </div>
      <div style={{ height: 10, borderRadius: 999, background: `color-mix(in srgb, ${fill} 22%, var(--ui-inset))`, overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(p > 0 ? 1 : 0, Math.round(p * 100))}%`, height: '100%', borderRadius: 999, background: fill, transition: 'width 200ms' }} />
      </div>
    </div>
  );
}
