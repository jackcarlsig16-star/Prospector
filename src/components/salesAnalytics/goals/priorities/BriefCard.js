import { useState } from 'react';
import { SA } from '../../theme';
import { numStyle } from '../goalsUi';

// intent-score-v1 S3 Brief - the server-built block (GET goals/brief/:type/:id) as a card, with Copy-for-Claude
// (the same markdown the Write email call and the HK connector read). Names + titles only; no address ever arrives.
const KIND_LABEL = { company: 'Company', score: 'Score', source: 'Source', visit: 'Website', person: 'People', research: 'Research', task: 'Open to-dos', touch: 'Touches', next: 'Next step' };
const KIND_ORDER = ['company', 'score', 'source', 'visit', 'person', 'research', 'task', 'touch', 'next'];

export default function BriefCard({ brief, error, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(`${brief.markdown}\n`); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ }
  };
  const groups = brief ? KIND_ORDER.map(k => [k, brief.lines.filter(l => l.kind === k)]).filter(([, ls]) => ls.length) : [];
  return (
    <section aria-label="Brief" data-brief-card style={{ background: SA.surface2, border: `1px solid ${SA.border}`, borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: SA.text }}>Brief{brief ? ` · ${brief.company.name}` : ''}</h3>
        {brief?.score && <span style={{ ...numStyle, fontSize: 12, color: SA.muted }}>Intent {brief.score.score} · {brief.score.band}</span>}
        <span style={{ flex: 1 }} />
        {brief && <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={copy}>{copied ? 'Copied' : 'Copy for Claude'}</button>}
        <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" aria-label="Close brief" onClick={onClose}>✕</button>
      </div>
      {error && <p style={{ margin: 0, fontSize: 13, color: SA.bad }}>{error}</p>}
      {!brief && !error && <span style={{ fontSize: 13, color: SA.muted }}>Loading…</span>}
      {groups.map(([k, lines]) => (
        <div key={k} data-brief-group={k}>
          <span className="ui-group-label">{KIND_LABEL[k]}</span>
          <ul style={{ margin: '4px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {lines.map(l => <li key={l.ref} style={{ fontSize: 13, color: SA.text, display: 'flex', gap: 8 }}><span style={{ ...numStyle, color: SA.soft, flex: 'none', width: 28 }}>{l.ref}</span><span>{l.text}</span></li>)}
          </ul>
        </div>
      ))}
    </section>
  );
}
