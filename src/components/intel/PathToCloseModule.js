import { C, mono } from '../../constants/colors';

const PAD = { padding: '11px 13px' };
const LBL = { ...mono, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 8, color: '#4ade8099' };

const fmtMD = s => {
  if (!s) return '';
  const d = new Date(s.length === 10 ? s + 'T12:00:00' : s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

const nodeState = (due) => {
  if (!due) return 'future';
  const today = new Date();
  const dueDate = new Date(due + 'T12:00:00');
  if (dueDate < today) return 'past';
  if ((dueDate - today) <= 7 * 24 * 60 * 60 * 1000) return 'soon';
  return 'future';
};

const pulseStyle = `
  @keyframes ptc-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
`;

export default function PathToCloseModule({ acc }) {
  const nsGetText = ns => typeof ns === 'string' ? ns : (ns?.text || '');
  const nsGetDue = ns => typeof ns === 'object' ? ns?.dueDate : null;
  const nsGetOwner = ns => typeof ns === 'object' ? ns?.owner : null;

  // Aggregate timeline milestones + nextSteps, dedup by normalized text
  const seen = new Set();
  const allItems = [];
  (acc.calls || []).forEach(c => {
    if (c.timeline) {
      c.timeline.split('\n').map(m => m.trim()).filter(Boolean).forEach(m => {
        const key = m.toLowerCase().trim();
        if (!seen.has(key)) { seen.add(key); allItems.push({ text: m, date: c.date, owner: null, type: 'milestone' }); }
      });
    }
    (c.nextSteps || []).forEach(ns => {
      const txt = nsGetText(ns);
      const key = txt.toLowerCase().trim();
      if (!seen.has(key)) {
        seen.add(key);
        allItems.push({ text: txt, date: nsGetDue(ns) || c.date, dueDate: nsGetDue(ns), owner: nsGetOwner(ns), type: 'action' });
      }
    });
  });
  allItems.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const show = allItems.slice(0, 5);
  const extra = allItems.length - show.length;

  return (
    <div style={PAD}>
      <style>{pulseStyle}</style>
      <span style={LBL}>Path to Close</span>
      {acc.pathToClose && (
        <div style={{ ...mono, fontSize: 13, color: '#f59e0b', marginBottom: 10, lineHeight: 1.5 }}>{acc.pathToClose}</div>
      )}
      {show.length === 0
        ? <span style={{ ...mono, fontSize: 12, color: '#4ade8033' }}>Log a debrief to generate path to close</span>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {show.map((item, i) => {
              const st = nodeState(item.dueDate);
              const isPast = st === 'past';
              const isSoon = st === 'soon';
              const dotColor = isPast ? '#4ade80' : isSoon ? '#f59e0b' : '#444';
              const dotFilled = isPast;
              const textColor = isPast ? '#4ade80' : isSoon ? '#f59e0b' : '#888';
              return (
                <div
                  key={i}
                  onClick={() => {}}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 0', cursor: 'default', borderBottom: i < show.length - 1 ? '0.5px solid #111' : 'none' }}
                >
                  <div style={{ paddingTop: 4, flexShrink: 0 }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: dotFilled ? dotColor : 'transparent',
                      border: `1.5px solid ${dotColor}`,
                      boxShadow: isSoon ? `0 0 6px ${dotColor}99` : 'none',
                      display: 'inline-block',
                      animation: isSoon ? 'ptc-pulse 1.8s ease-in-out infinite' : 'none',
                    }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ ...mono, fontSize: 12, color: textColor, lineHeight: 1.5, textDecoration: isPast ? 'line-through' : 'none', textDecorationColor: '#4ade8055' }}>
                      {item.text}
                    </span>
                    {item.owner && <span style={{ ...mono, fontSize: 11, color: '#555', marginLeft: 5 }}>— {item.owner}</span>}
                  </div>
                  {item.dueDate && (
                    <span style={{ ...mono, fontSize: 11, color: '#444', flexShrink: 0, paddingTop: 3 }}>{fmtMD(item.dueDate)}</span>
                  )}
                </div>
              );
            })}
            {extra > 0 && <span style={{ ...mono, fontSize: 10, color: C.dim, paddingTop: 5 }}>+{extra} more</span>}
          </div>
        )
      }
    </div>
  );
}
