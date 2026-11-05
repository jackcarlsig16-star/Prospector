import { SA, SA_TYPE } from '../theme';
import { Card } from './CompanyPanelSections';
import { nextStepText } from './flowModel';
import { cameFromText } from './NetworkCard';

// homelover-flow-v1 F9 - the live partner's cards above the fold (mockup C): Next step (text from the record's next
// step / first open to-do, sub-line from last touch + visits, ONE primary) and Came from. Nothing here writes; the
// primary hands back to the panel. Names and titles only - never an address or a phone.
const text = { ...SA_TYPE.body, fontSize: 13, color: SA.text, overflowWrap: 'anywhere' };
const dim = { fontSize: 12.5, color: SA.muted };
const ink = { fontSize: 12.5, color: SA.soft };
const glow = { background: `linear-gradient(135deg, color-mix(in srgb, ${SA.accent} 8%, ${SA.surface2}) 0%, ${SA.surface2} 70%)`, border: `1px solid color-mix(in srgb, ${SA.accent} 35%, ${SA.border})`, borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 };

export function NextStepCard({ row, detail, primary, busy, onPrimary, canEdit }) {
  const n = nextStepText({ row, detail });
  return (
    <section aria-label="Next step" data-section="next-step" style={glow}>
      <span className="ui-group-label" style={{ color: SA.soft }}>Next step</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <b data-next-step-text style={{ fontSize: 15, fontWeight: 600, color: n.empty ? SA.muted : SA.text, overflowWrap: 'anywhere' }}>{n.text}</b>
          {n.sub && <span data-next-step-sub style={ink}>{n.sub}</span>}
        </div>
        {canEdit && primary && <button type="button" className="ui-btn ui-btn--primary" data-flow-primary={primary.id} disabled={!!busy} onClick={() => onPrimary(primary)} style={{ height: 36 }}>{busy === primary.id ? 'Working…' : primary.label}</button>}
      </div>
    </section>
  );
}

// F9 (mockup C): the live partner's own source + ownership, from the Network payload's came_from (clients-v1 C8).
export function CameFromCard({ network, canEdit, onSetSource }) {
  const cf = cameFromText(network?.came_from);
  const own = network?.ownership;
  return (
    <Card label="Came from" testId="came-from">
      <div data-came-from style={{ ...text, fontSize: 15 }}>
        {network ? <>{cf.missing && cf.text.includes('partner not set') ? <>{cf.text.split(' · ')[0]} · <span style={{ color: SA.warn }}>partner not set</span></> : <span style={{ color: cf.missing ? SA.warn : SA.text }}>{cf.text}</span>}
          {cf.missing && canEdit && onSetSource && <> — <button type="button" className="ui-btn ui-btn--tertiary" onClick={onSetSource} style={{ height: 22, padding: '0 4px', fontSize: 14, color: SA.warn }}>Set it</button></>}</> : <span style={dim}>Loading…</span>}
      </div>
      {own && (own.team || own.owner) && <span style={dim}>Ownership: {[own.team, own.owner, own.co_owner_name && 'co-owner set'].filter(Boolean).join(' · ')}</span>}
    </Card>
  );
}
