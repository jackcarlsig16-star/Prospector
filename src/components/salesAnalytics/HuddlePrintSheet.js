import { SA, SA_TYPE } from './theme';
import { OWNER_LABELS, actionText, signalOf } from './huddleView';

// Print-only agenda (sales-huddle-v2 Stage 4): one column per owner with what
// to talk about - their flags, top Needs action, replies - so it fits on 1-2
// landscape pages. The full list stays in the Huddle sheet CSV.
// Reuses SalesAnalyticsTab's PRINT_STYLES: only #sales-analytics-print-area
// prints, and SA tokens flip to the light palette under @media print.
const NEEDS_TOP = 10;
const h2 = { ...SA_TYPE.cardTitle, fontSize: 13, margin: '10px 0 4px' };
const line = { fontSize: 10.5, lineHeight: 1.35, margin: '0 0 3px' };

export default function HuddlePrintSheet({ dateLabel, since, needs, prospects, flags, memberSlug, issues, today }) {
  const owners = ['jack', 'cyrus', 'unassigned'].filter(o => needs.some(p => p.owner === o) || flags.some(f => memberSlug(f.owner_user_id) === o));
  const byId = new Map(prospects.map(p => [p.contact_id, p]));
  return (
    <div id="sales-analytics-print-area" className="print-only" style={{ color: SA.text }}>
      <h1 style={{ ...SA_TYPE.pageTitle, fontSize: 20, margin: '0 0 2px' }}>Daily Huddle agenda · {dateLabel}</h1>
      {since && (
        <p style={{ fontSize: 11, color: SA.muted, margin: '0 0 8px' }}>
          Since last huddle: {since.replies} replies · {since.real_clicks} real clicks · {since.real_opens} real opens · {since.done} done
        </p>
      )}
      {issues.length > 0 && (
        <p style={{ fontSize: 11, margin: '0 0 8px' }}><strong>Sequence issues:</strong> {issues.map(i => `${i.title} (${i.action})`).join(' · ')}</p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(owners.length, 1)}, minmax(0, 1fr))`, gap: 20 }}>
        {owners.map(o => {
          const mineFlags = flags.filter(f => memberSlug(f.owner_user_id) === o);
          const mineNeeds = needs.filter(p => p.owner === o);
          const replies = prospects.filter(p => p.owner === o && p.last_human_signal?.kind === 'reply' && ['new', 'claimed', 'contacted'].includes(p.status));
          return (
            <section key={o} className="print-avoid-break">
              <h2 style={{ ...SA_TYPE.cardTitle, fontSize: 15, margin: '0 0 2px', borderBottom: `1px solid ${SA.border}`, paddingBottom: 4 }}>{OWNER_LABELS[o]}</h2>
              {mineFlags.length > 0 && <>
                <h3 style={h2}>🚩 Flagged ({mineFlags.length})</h3>
                {mineFlags.map(f => {
                  const p = byId.get(f.prospect_contact_id);
                  return <p key={f.id} style={line}><strong>{p?.name || f.contacts[0]}</strong>{p?.company ? ` · ${p.company}` : ''} — {f.steps.map(s => `${s.done ? '☑' : '☐'} ${s.text}`).join('  ')}{f.flag_note ? ` · “${f.flag_note}”` : ''}</p>;
                })}
              </>}
              <h3 style={h2}>Needs action today ({mineNeeds.length}{mineNeeds.length > NEEDS_TOP ? `, top ${NEEDS_TOP}` : ''})</h3>
              {mineNeeds.length === 0 && <p style={{ ...line, color: SA.muted }}>Nothing urgent.</p>}
              {mineNeeds.slice(0, NEEDS_TOP).map(p => (
                <p key={p.contact_id} style={line}><strong>{p.name || 'Unknown contact'}</strong>{p.company ? ` · ${p.company}` : ''} — {actionText(p, today)}{signalOf(p, today).context ? ` · ${signalOf(p, today).context}` : ''}</p>
              ))}
              {replies.length > 0 && <>
                <h3 style={h2}>Replies ({replies.length})</h3>
                {replies.map(p => <p key={p.contact_id} style={line}>{p.name || 'Unknown contact'}{p.company ? ` · ${p.company}` : ''} — {signalOf(p, today).context}</p>)}
              </>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
