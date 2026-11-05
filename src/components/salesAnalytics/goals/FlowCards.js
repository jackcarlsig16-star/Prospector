import { SA, SA_TYPE } from '../theme';
import { Card } from './CompanyPanelSections';
import { Num } from './FlowChips';
import { nextStepText, overviewFacts } from './flowModel';
import { cameFromText } from './NetworkCard';

// homelover-flow-v1 F6 / F8 / F9 - the cards above the fold (mockups A + C): Next step (text from the record's next step /
// first open to-do / the reply suggestion, sub-line from last touch + visits, ONE primary = the flow's first item),
// Reached n of m people (GET goals/reach, live), Overview facts, and the live partner's Came from. Nothing here writes;
// the primary hands back to the panel. Names and titles only - never an address or a phone.
const text = { ...SA_TYPE.body, fontSize: 13, color: SA.text, overflowWrap: 'anywhere' };
const dim = { fontSize: 12.5, color: SA.muted };
const ink = { fontSize: 12.5, color: SA.soft };
const glow = { background: `linear-gradient(135deg, color-mix(in srgb, ${SA.accent} 8%, ${SA.surface2}) 0%, ${SA.surface2} 70%)`, border: `1px solid color-mix(in srgb, ${SA.accent} 35%, ${SA.border})`, borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 };

export function NextStepCard({ row, detail, suggestion, reach, primary, busy, onPrimary, canEdit }) {
  const n = nextStepText({ row, detail, suggestion, reach });
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

// F6: "3 of 11 people" + bar + "2 buyers reached · 4 buyers not yet · 0 replies". Hides when nobody is known and offers Check Apollo.
export function ReachedCard({ reach, canEdit, onCheckApollo, busy }) {
  if (!reach) return <Card label="Reached" testId="reached"><span style={dim}>Counting…</span></Card>;
  if (!reach.known) {
    return (
      <Card label="Reached" testId="reached" action={<span style={dim}>emails · campaigns · logged touches</span>}>
        <span style={dim}>Nobody known at this company yet.</span>
        {canEdit && <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" style={{ alignSelf: 'flex-start' }} disabled={busy === 'apollo'} onClick={onCheckApollo}>{busy === 'apollo' ? 'Checking…' : 'Check Apollo'}</button>}
      </Card>
    );
  }
  const pct = Math.round((reach.reached / reach.known) * 100);
  return (
    <Card label="Reached" testId="reached" action={<span style={dim}>emails · campaigns · logged touches</span>}>
      <div data-reached style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}><Num style={{ fontSize: 26, fontWeight: 600, color: SA.text, lineHeight: 1 }}>{reach.reached}</Num><span style={{ fontSize: 15, color: SA.soft }}>of {reach.known} people</span></div>
      <div aria-hidden="true" style={{ height: 6, borderRadius: 3, background: SA.track, overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${pct}%`, background: SA.accent, borderRadius: 3 }} /></div>
      <span data-reached-sub style={dim}>{reach.buyers_reached} buyer{reach.buyers_reached === 1 ? '' : 's'} reached · {reach.buyers_not_yet} buyer{reach.buyers_not_yet === 1 ? '' : 's'} not yet · {reach.replies} {reach.replies === 1 ? 'reply' : 'replies'}</span>
    </Card>
  );
}

export function OverviewCard({ row, record, research, fit, source, visits, client, people = 0, onSetSource, canEdit }) {
  const facts = overviewFacts({ row, record: { ...record, people_count: people }, research, fit, source, visits, client });
  return (
    <Card label="Overview" testId="overview">
      <div data-overview style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px 16px' }}>
        {facts.map(([label, value, sub, muted]) => (
          <div key={label} data-fact={label} style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span className="ui-group-label">{label}</span>
            {label === 'Came from' && canEdit && onSetSource
              ? <button type="button" className="ui-fact-btn" onClick={onSetSource} aria-haspopup="dialog" style={{ all: 'unset', cursor: 'pointer', ...text, fontWeight: 500, color: muted ? SA.warn : SA.text, textDecoration: 'underline dotted', textUnderlineOffset: 4 }}>{muted ? 'Not set — Set it' : value}</button>
              : <b style={{ ...text, fontWeight: 500, color: muted ? SA.muted : SA.text }}>{value}</b>}
            {sub && <span style={{ fontSize: 11.5, color: SA.muted }}>{sub}</span>}
          </div>
        ))}
      </div>
    </Card>
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
