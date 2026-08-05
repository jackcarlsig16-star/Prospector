import { C, mono } from '../../constants/colors';

const PAD = { padding: '11px 13px' };
const LBL = { ...mono, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 8, color: '#f8717199' };

const GlowDot = ({ color, size = 8 }) => (
  <span style={{ width: size, height: size, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}aa`, flexShrink: 0, display: 'inline-block' }} />
);

export default function BlockersModule({ acc, compliance }) {
  const bText = b => typeof b === 'string' ? b : (b?.text || '');

  const callBlockers = [...new Set((acc.calls || []).flatMap(c => (c.blockers || []).map(bText)))].filter(Boolean);
  const compBlockers = acc.stage === 'Active Deal' && compliance?.steps
    ? compliance.steps
      .filter(s => s.status === 'Blocked')
      .map(s => `${s.id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}: blocked`)
    : [];

  const show = [...callBlockers.slice(0, 4), ...(callBlockers.length < 4 ? compBlockers.slice(0, 4 - callBlockers.length) : [])];
  const extra = [...callBlockers, ...compBlockers].length - show.length;

  if (show.length === 0) return (
    <div style={PAD}>
      <span style={LBL}>Blockers</span>
      <span style={{ ...mono, fontSize: 12, color: '#4ade80' }}>No active blockers ✦</span>
    </div>
  );

  return (
    <div style={PAD}>
      <span style={LBL}>Blockers</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {show.map((b, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
            <div style={{ paddingTop: 4, flexShrink: 0 }}>
              <GlowDot color='#dc2626' size={6} />
            </div>
            <span style={{ ...mono, fontSize: 12, color: '#fca5a5', lineHeight: 1.5 }}>{b}</span>
          </div>
        ))}
        {extra > 0 && <span style={{ ...mono, fontSize: 10, color: C.dim }}>+{extra} more</span>}
      </div>
    </div>
  );
}
