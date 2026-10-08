import { useEffect, useRef } from 'react';
import { SA, SA_TYPE, SA_SHAPE, saSans } from '../theme';
import { PEOPLE_SOURCES } from '../../../constants/partnerPeople';
import { subStyle, numStyle, Btn, SourceBadge, weekOf } from './goalsUi';

// first-touch-people-v1 - the week's people behind the "People first-touched"
// number: name · partner · first touch date · where it came from.
const day = at => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });

export default function FirstTouchPeople({ weekStart, people, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }} style={{ position: 'fixed', inset: 0, background: '#000a', zIndex: 4500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="ftp-title"
        style={{ ...saSans, width: 520, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', background: SA.surface, border: `1px solid ${SA.borderStrong}`, borderRadius: SA_SHAPE.radiusCard, padding: 22, display: 'flex', flexDirection: 'column', gap: 12, color: SA.text }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h2 id="ftp-title" style={{ ...SA_TYPE.cardTitle, margin: 0, fontSize: 18 }}>People first-touched</h2>
          <span style={{ ...subStyle, fontSize: 13 }}>{weekOf(weekStart)} · {people.length}</span>
          <Btn onClick={onClose} style={{ marginLeft: 'auto', height: 32, fontSize: 13 }}>Close</Btn>
        </div>
        {people.length === 0 ? <span style={{ ...subStyle, fontSize: 13 }}>No one first-touched this week yet.</span> : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
            {people.map(p => (
              <li key={`${p.goal_id}:${p.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: `1px solid ${SA.track}`, fontSize: 13, minWidth: 0 }}>
                <span style={{ fontWeight: 600, flex: '1 1 0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                <span style={{ ...subStyle, flex: '1 1 0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.partner}</span>
                <span style={{ ...numStyle, color: SA.soft, flex: 'none' }}>{day(p.first_touch_at)}</span>
                <SourceBadge source={PEOPLE_SOURCES[p.source]} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
