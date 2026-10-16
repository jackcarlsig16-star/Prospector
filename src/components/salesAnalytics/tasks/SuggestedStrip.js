import { useState, useEffect } from 'react';
import { SA, SA_SHAPE, saSans } from '../theme';
import { goalsApi, TODOS_CHANGED } from '../goals/goalsApi';
import { openTasks } from './LinkedTasks';

// call-notes-targets-v1 Stage 3 - the one-line Huddle strip ("4 suggestions")
// that opens the Suggested list in the Tasks drawer. Hidden at 0; a Viewer
// sees the count only (the list is read-only for them).
export default function SuggestedStrip({ businessId }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    const load = () => goalsApi.suggestions(businessId).then(d => { if (live) setN(d.suggestions.length); }).catch(() => {});
    load();
    window.addEventListener(TODOS_CHANGED, load);
    return () => { live = false; window.removeEventListener(TODOS_CHANGED, load); };
  }, [businessId]);
  if (!n) return null;
  return (
    <div role="status" data-suggested-strip="" className="no-print" style={{ ...saSans, display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px', marginBottom: 16, borderRadius: SA_SHAPE.radiusInner, background: SA.surface2, border: `1px solid ${SA.border}`, fontSize: 13, color: SA.text }}>
      <span>✦ {n} suggestion{n === 1 ? '' : 's'} from Tidy</span>
      <span style={{ flex: 1 }} />
      <button type="button" onClick={() => openTasks({ link: null, view: 'suggested', filter: 'team' })}
        style={{ ...saSans, background: 'transparent', border: 0, color: SA.link, cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: 0 }}>Open →</button>
    </div>
  );
}
