import { numStyle } from '../goals/goalsUi';
import { KIT_PRIORITY } from '../../../ui/tokens';

// heat-v2 D1 - the one heat pill: the band word first in the band color, the number second (smaller, 75 %), an outline
// and a 20 % wash, never filled. Band colors are the kit's P1 / P2 / P4 tokens. A missing heat reads "—".
// H5: the Δ7 glyph after the number when the heat moved 10 or more against 7 days ago (absent until that history exists).
export const HEAT_COLOR = { hot: KIT_PRIORITY.P1[0], warm: KIT_PRIORITY.P2[0], cold: KIT_PRIORITY.P4[0] };
export const BAND_WORD = { hot: 'Hot', warm: 'Warm', cold: 'Cold' };
export const DELTA_MIN = 10; // REVISABLE (spec H5)
export const delta7 = r => (r.heat == null || r.heat_7d_ago == null ? null : r.heat - r.heat_7d_ago);

export default function HeatPill({ heat, band, delta = null, size = 'md', title }) {
  if (heat == null) return <span className="ui-table__dim" title={title || 'No heat yet - the next Apollo sync computes it'}>—</span>;
  const color = HEAT_COLOR[band] || HEAT_COLOR.cold;
  const sm = size === 'sm';
  const moved = delta != null && Math.abs(delta) >= DELTA_MIN;
  return (
    <span data-heat-band={band} title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: sm ? 5 : 7, height: sm ? 20 : 22, padding: sm ? '0 8px' : '0 9px', borderRadius: 999, border: `1px solid ${color}`, color, background: 'rgba(0,0,0,0.2)', fontSize: sm ? 11 : 12, fontWeight: 600, whiteSpace: 'nowrap', lineHeight: 1 }}>
      {BAND_WORD[band] || band}{' '}
      <small style={{ ...numStyle, fontSize: sm ? 10 : 11, fontWeight: 500, opacity: 0.75 }}>{heat}</small>
      {moved && <span data-heat-delta={delta > 0 ? 'up' : 'down'} aria-label={`${delta > 0 ? 'up' : 'down'} ${Math.abs(delta)} in 7 days`} title={`${delta > 0 ? '+' : ''}${delta} vs 7 days ago`} style={{ fontSize: 10 }}>{delta > 0 ? '▲' : '▼'}</span>}
    </span>
  );
}
