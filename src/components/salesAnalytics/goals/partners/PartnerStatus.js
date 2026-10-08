import { SA } from '../../theme';
import { STALE_DAYS, nextStepFor } from '../../../../constants/partnerPipeline';
import { labelStyle, subStyle, numStyle, Btn } from '../goalsUi';
import { MoreMenu } from './PartnerRow';
import { lastTouch, stageName } from './activityTimeline';

const md = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const daysAgo = iso => Math.floor((Date.now() - Date.parse(iso)) / 864e5);

// partner-360-v1 - the top of the story: where the partner is, when we last
// touched them, and the one thing to do next. The row above carries the
// stage bar; this repeats only the words.
export default function PartnerStatus({ partner, events, lookup, actions, logOpen, onLogTouch }) {
  const status = partner.pipeline_status || 'not_started';
  const paused = status === 'paused';
  const touch = lastTouch(partner, events, lookup);
  const days = touch?.at ? daysAgo(touch.at) : null;
  const stale = days !== null && days >= STALE_DAYS && !paused && status !== 'live';
  const next = paused ? { label: 'Resume' } : nextStepFor(status);
  const touchLine = !touch ? 'No touch yet'
    : touch.undated ? 'Contacted · no touch date recorded'
      : ['Last touch:', [touch.what, md(touch.at), touch.by].filter(Boolean).join(' · '), touch.source].filter(Boolean).join(' ');
  return (
    <section aria-label="Status and next step" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: '6px 16px', flexWrap: 'wrap', alignItems: 'baseline' }}>
        <span style={{ fontWeight: 600 }}>{stageName(status)}</span>
        <span style={{ color: SA.soft }}>{touchLine}</span>
        {days !== null && <span style={{ ...numStyle, color: stale ? SA.bad : SA.muted }}>{days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`}</span>}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: '1 1 220px', minWidth: 0 }}>
          <span style={labelStyle}>Next</span>
          <span>{status === 'live' ? 'Live · keep the relationship warm' : next.label}</span>
          {(stale || partner.next_step) && <span style={{ ...subStyle, fontSize: 12, color: stale ? SA.bad : SA.muted }}>{stale ? `${days} days since the last touch — follow up` : partner.next_step}</span>}
        </div>
        {actions && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {status !== 'live' && <Btn primary style={{ height: 36, padding: '0 12px', fontSize: 13 }} onClick={() => actions.onNext(partner)}>{paused ? 'Resume' : `Next: ${next.label}`}</Btn>}
            <Btn style={{ height: 36, padding: '0 12px', fontSize: 13 }} aria-expanded={logOpen} onClick={onLogTouch}>{logOpen ? 'Close' : 'Log touch'}</Btn>
            <MoreMenu partner={partner} members={actions.members} onSignal={actions.onSignal} />
          </div>
        )}
      </div>
    </section>
  );
}
