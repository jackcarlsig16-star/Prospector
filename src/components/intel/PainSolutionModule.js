import { C, mono } from '../../constants/colors';

const PAD = { padding: '11px 13px' };
const LBL = { ...mono, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 8, color: '#c084fc99' };

const GlowDot = ({ color, size = 8 }) => (
  <span style={{ width: size, height: size, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}aa`, flexShrink: 0, display: 'inline-block' }} />
);

export default function PainSolutionModule({ acc }) {
  const ppTopic = p => typeof p === 'string' ? p : (p?.topic || '');
  const ppSolution = p => typeof p === 'object' ? p?.solution : null;

  const seenTopics = new Set();
  const allPains = [];
  if (acc.medpicc?.identify_pain) {
    allPains.push({ topic: acc.medpicc.identify_pain, solution: null });
    seenTopics.add(acc.medpicc.identify_pain);
  }
  (acc.calls || []).forEach(c => (c.painPoints || []).forEach(p => {
    const t = ppTopic(p);
    if (!seenTopics.has(t)) { seenTopics.add(t); allPains.push(typeof p === 'string' ? { topic: p, solution: null } : p); }
  }));
  const show = allPains.slice(0, 4);
  const extra = allPains.length - show.length;

  return (
    <div style={PAD}>
      <span style={LBL}>Pain → Solution</span>
      {show.length === 0
        ? <span style={{ ...mono, fontSize: 12, color: '#7c3aed44' }}>No pain points confirmed yet</span>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {show.map((p, i) => {
              const topic = ppTopic(p);
              const sol = ppSolution(p);
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                  <div style={{ paddingTop: 3, flexShrink: 0 }}>
                    <GlowDot color='#7c3aed' size={6} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ ...mono, fontSize: 14, fontWeight: 700, color: '#a78bfa', lineHeight: 1.4 }}>{topic}</div>
                    {sol && <div style={{ ...mono, fontSize: 12, color: '#6d4a9a', lineHeight: 1.4, marginTop: 2 }}>{sol}</div>}
                  </div>
                </div>
              );
            })}
            {extra > 0 && <span style={{ ...mono, fontSize: 10, color: C.dim }}>+{extra} more</span>}
          </div>
        )
      }
    </div>
  );
}
