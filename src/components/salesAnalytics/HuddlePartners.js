import { useState, useEffect } from 'react';
import { SA, SA_TYPE, SA_SHAPE } from './theme';
import { goalsApi } from './goals/goalsApi';
import { memberLookup } from './goals/goalsUi';
import { STALE_DAYS, daysSinceTouch } from '../../constants/partnerPipeline';
import { statusOf, statusLabel, statusColor, tierLabel } from './goals/partners/PartnerCard';

// sales-partners-pipeline-v1 Stage 4 - partners someone flagged 🔥 in
// Goals > Partners, at the top of the Daily Huddle. Read-only here; the
// buttons live on the partner card. Hidden when nothing is hot.
export default function HuddlePartners({ businessId }) {
  const [partners, setPartners] = useState(null);
  const [members, setMembers] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    Promise.all([goalsApi.hotPartners(businessId), goalsApi.members(businessId)])
      .then(([p, m]) => { setPartners(p); setMembers(m); })
      .catch(e => setError(e.message));
  }, [businessId]);
  if (error) return <p style={{ fontSize: 12, color: SA.warn, margin: '0 0 16px' }}>⚠ Hot partners didn't load: {error}</p>;
  if (!partners?.length) return null;
  const lookup = memberLookup(members);

  return (
    <section style={{ marginBottom: 24 }} aria-labelledby="huddle-partners">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <h2 id="huddle-partners" style={{ ...SA_TYPE.cardTitle, fontSize: 17, color: SA.text, margin: 0 }}>🔥 Partners</h2>
        <span style={{ ...SA_TYPE.label, color: SA.faint }}>{partners.length}</span>
        <span style={{ fontSize: 12, color: SA.muted }}>Update them in Goals → Partners</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {partners.map(p => {
          const owner = lookup(p.owner_user_id);
          const days = daysSinceTouch(p);
          const status = statusOf(p);
          return (
            <div key={p.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '10px 14px', background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusInner, fontSize: 13 }}>
              <span style={{ fontWeight: 600, color: SA.text }}>{p.name}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: SA.soft }}><span style={{ width: 8, height: 8, borderRadius: 999, background: statusColor(status) }} />{statusLabel(status)}</span>
              {p.tier && <span style={{ color: SA.muted }}>{tierLabel(p.tier)}</span>}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: SA.soft }}><span style={{ width: 8, height: 8, borderRadius: 999, background: owner.color }} />{owner.first}</span>
              <span style={{ color: days !== null && days >= STALE_DAYS ? SA.bad : SA.muted }}>{days === null ? 'no touch yet' : days === 0 ? 'touched today' : `${days}d since touch`}</span>
              {p.next_step && <span style={{ color: SA.soft, flex: '1 1 200px' }}>Next: {p.next_step}</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
