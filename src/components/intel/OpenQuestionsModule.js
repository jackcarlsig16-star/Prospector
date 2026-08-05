import { C, mono } from '../../constants/colors';
import { MEDPICC_FIELDS } from '../../utils/dealIntel';

const PAD = { padding: '11px 13px' };
const LBL = { ...mono, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 8, color: '#f59e0b99' };

const GlowDot = ({ color, size = 8 }) => (
  <span style={{ width: size, height: size, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}aa`, flexShrink: 0, display: 'inline-block' }} />
);

const OQ_MED_KEYS = ['metrics', 'economic_buyer', 'decision_criteria', 'champion', 'competition'];

export default function OpenQuestionsModule({ acc }) {
  const med = acc.medpicc || {};
  const missingMed = OQ_MED_KEYS.filter(k => !med[k]).map(k => {
    const f = MEDPICC_FIELDS.find(x => x.key === k);
    return `${f?.label || k} not yet discovered`;
  });
  const callOQs = [...new Set((acc.calls || []).flatMap(c => c.openQuestions || []))];
  const all = [...new Set([...callOQs, ...missingMed])];
  const show = all.slice(0, 4);
  const extra = all.length - show.length;

  return (
    <div style={{ ...PAD, borderLeft: '2px solid #f59e0b22' }}>
      <span style={LBL}>Open Questions</span>
      {show.length === 0
        ? <span style={{ ...mono, fontSize: 12, color: '#d9770644' }}>—</span>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {show.map((q, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                <div style={{ paddingTop: 4, flexShrink: 0 }}>
                  <GlowDot color='#d97706' size={6} />
                </div>
                <span style={{ ...mono, fontSize: 12, color: '#fbbf24', lineHeight: 1.5 }}>{q}</span>
              </div>
            ))}
            {extra > 0 && <span style={{ ...mono, fontSize: 10, color: C.dim }}>+{extra} more</span>}
          </div>
        )
      }
    </div>
  );
}
