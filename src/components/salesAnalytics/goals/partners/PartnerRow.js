import { SA } from '../../theme';
import { WORKFLOW_STEPS, STALE_DAYS, stepOf, daysSinceTouch, isTouched } from '../../../../constants/partnerPipeline';
import { subStyle, numStyle, Chip } from '../goalsUi';
import { familyOf, categoryName } from './partnerTypes';
import { tierLabel } from './PartnerCard';

// sales-partners-workflow-v1 - one partner as a workflow row: type marker,
// who / priority / tier, and an 8-step stage bar filled in the type color.
// Stage 2 is read-only; actions arrive in Stage 3.
export function StageBar({ status, color, compact }) {
  const step = stepOf(status);
  const paused = step === null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <div role="img" aria-label={paused ? 'Paused' : `Step ${step + 1} of 8: ${WORKFLOW_STEPS[step].label}`}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(8, minmax(0, 1fr))', gap: 3 }}>
        {WORKFLOW_STEPS.map((s, i) => (
          <span key={s.id} style={{ height: 8, borderRadius: 3, background: !paused && i <= step ? color : SA.track, opacity: paused ? 0.5 : 1,
            boxShadow: !paused && i === step ? `0 0 0 1px ${SA.text}` : undefined }} />
        ))}
      </div>
      {compact
        ? <span style={{ fontSize: 11, color: SA.soft }}>{paused ? 'Paused' : WORKFLOW_STEPS[step].label}</span>
        : (
          // Only the current step is labeled (the key lists all 8), anchored
          // under its segment and allowed to run past it so it never clips.
          <div aria-hidden="true" style={{ display: 'grid', gridTemplateColumns: 'repeat(8, minmax(0, 1fr))', gap: 3, height: 14 }}>
            {paused
              ? <span style={{ gridColumn: '1 / -1', fontSize: 11, color: SA.muted }}>Paused</span>
              : <span style={{ gridColumn: step + 1, justifySelf: step < 4 ? 'start' : 'end', fontSize: 11, fontWeight: 600, color: SA.text, whiteSpace: 'nowrap' }}>
                  {step + 1} · {WORKFLOW_STEPS[step].label}
                </span>}
          </div>
        )}
    </div>
  );
}

// Days since the last touch. A partner can be past Sent with no touch date
// (imported from the sheet that way) - that's "—", not "No touch".
function touchLabel(partner, days) {
  if (days !== null) return { text: days === 0 ? 'Today' : `${days}d`, title: `Last touch ${new Date(partner.last_touch_at).toLocaleDateString()}` };
  return isTouched(partner) ? { text: '—', title: 'Contacted, but no touch date recorded' } : { text: 'No touch', title: 'No touch yet' };
}

export default function PartnerRow({ partner, lookup, compact, showCategory }) {
  const fam = familyOf(partner.category);
  const owner = partner.owner_user_id ? lookup(partner.owner_user_id) : null;
  const days = daysSinceTouch(partner);
  const paused = partner.pipeline_status === 'paused';
  const touch = touchLabel(partner, days);
  const touchColor = days !== null && days >= STALE_DAYS ? SA.bad : SA.muted;
  return (
    <div data-partner-id={partner.id} style={{ display: 'flex', alignItems: 'stretch', background: SA.inset, border: `1px solid ${SA.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <span aria-hidden="true" title={fam.label} style={{ width: 4, flex: 'none', background: fam.color }} />
      <div style={{ flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: compact ? '1fr' : 'minmax(200px, 1fr) minmax(280px, 1.4fr) 56px', gap: compact ? 8 : 16, alignItems: 'center', padding: '10px 12px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {owner && <span title={owner.first} aria-label={`Owner ${owner.first}`} style={{ width: 8, height: 8, borderRadius: 999, background: owner.color, flex: 'none' }} />}
            <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{partner.name}</span>
            {partner.hot && <span aria-label="Hot" title="Hot">🔥</span>}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {partner.priority && <Chip style={{ height: 20, color: partner.priority === 1 ? SA.text : SA.soft, borderColor: partner.priority === 1 ? SA.accent : SA.border }}>P{partner.priority}</Chip>}
            {partner.tier && <Chip style={{ height: 20 }}>{tierLabel(partner.tier)}</Chip>}
            {paused && <Chip style={{ height: 20 }}>Paused</Chip>}
            {showCategory && <span style={{ ...subStyle, fontSize: 12 }}>{categoryName(partner.category)}</span>}
            {compact && <span title={touch.title} style={{ ...numStyle, fontSize: 12, color: touchColor }}>{touch.text}</span>}
          </div>
        </div>
        <StageBar status={partner.pipeline_status} color={fam.color} compact={compact} />
        {!compact && (
          <span title={touch.title} style={{ ...numStyle, fontSize: 12, textAlign: 'right', color: touchColor }}>{touch.text}</span>
        )}
      </div>
    </div>
  );
}
