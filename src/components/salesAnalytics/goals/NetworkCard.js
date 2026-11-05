import { useState, useEffect } from 'react';
import { SA, SA_TYPE } from '../theme';
import { goalsApi, OPEN_PIPELINE_RECORD } from './goalsApi';
import { ErrorNote, fmt } from './goalsUi';
import { Card } from './CompanyPanelSections';
import { StatusChip } from './ClientParts';

// homelover-clients-v1 C8 (mock C, Nov 3) - the partner panel's Network card: what this partner brought in. It grew
// out of the "Referred by" card (lead-source-v1 B3), whose rep / office grouping stays as the "by rep" toggle. Header =
// real counts; groups Clients · Employers in pipeline · Partners · Targets (25 each, then "and n more"); "Came from" =
// this partner's own source and ownership, so the chain reads both ways. A row opens that company's window.
const dim = { fontSize: 13, color: SA.muted };
const text = { ...SA_TYPE.body, fontSize: 13, color: SA.text, overflowWrap: 'anywhere' };
const plural = (n, one, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const openRow = r => window.dispatchEvent(new CustomEvent(OPEN_PIPELINE_RECORD, { detail: { key: `${r.type}-${r.id}` } }));

export function cameFromText(cf) {
  if (!cf?.kind) return { text: 'Source not set', missing: true };
  if (cf.partner_not_set) return { text: `${cf.label} · partner not set`, missing: true };
  return { text: [cf.label, cf.partner_name, cf.person].filter(Boolean).join(' · '), missing: false };
}

const Toggle = ({ by, setBy }) => (
  <span role="group" aria-label="Group the network" style={{ display: 'inline-flex', gap: 2, fontSize: 12 }}>
    {[['type', 'by type'], ['rep', 'by rep']].map(([id, label]) => (
      <button key={id} type="button" aria-pressed={by === id} onClick={() => setBy(id)} className="ui-btn ui-btn--tertiary"
        style={{ height: 24, fontSize: 12, padding: '0 6px', color: by === id ? SA.text : SA.muted, fontWeight: by === id ? 600 : 400 }}>{label}</button>
    ))}
  </span>
);

function NameButton({ r }) {
  return <button type="button" className="ui-btn ui-btn--tertiary" onClick={() => openRow(r)} style={{ height: 24, padding: '0 2px', fontSize: 13, color: SA.text, fontWeight: 500, justifyContent: 'flex-start', minWidth: 0, overflowWrap: 'anywhere', textAlign: 'left' }}>{r.name}</button>;
}

export default function NetworkCard({ businessId, row, version, canEdit, onSetSource, onAddClient, hideCameFrom = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [by, setBy] = useState('type');
  useEffect(() => {
    let live = true;
    goalsApi.referredBy(businessId, row.id).then(d => { if (live) { setData(d); setError(''); } }).catch(e => live && setError(e.message));
    return () => { live = false; };
  }, [businessId, row.id, version]);
  const n = data?.network;
  const cf = cameFromText(n?.came_from);
  const own = n?.ownership;
  return (
    <Card label="Network" count={data ? data.total : null} testId="network" action={<Toggle by={by} setBy={setBy} />}>
      {error && <ErrorNote message={error} />}
      {!data && !error && <span style={dim}>Loading…</span>}
      {n && (
        <>
          <div data-network-header style={{ fontSize: 15, color: SA.text }}>
            <b style={{ fontWeight: 600 }}>{plural(n.header.clients, 'client')} · {fmt(n.header.lives)} lives</b>
            <span style={{ color: SA.muted }}> · {fmt(n.header.in_pipeline)} in pipeline · {plural(n.header.partners, 'partner')}</span>
          </div>
          {!hideCameFrom && <div data-came-from style={{ ...text, color: SA.soft }}>
            Came from: <span style={{ color: cf.missing ? SA.warn : SA.text }}>{cf.text}</span>
            {cf.missing && canEdit && onSetSource && <> — <button type="button" className="ui-btn ui-btn--tertiary" onClick={onSetSource} style={{ height: 22, padding: '0 4px', fontSize: 13, color: SA.warn }}>Set it</button></>}
            {own && (own.team || own.owner) && <span style={{ display: 'block', color: SA.muted, fontSize: 12 }}>Ownership: {[own.team, own.owner, own.co_owner_name && 'co-owner set'].filter(Boolean).join(' · ')}</span>}
          </div>}
          {canEdit && onAddClient && <button type="button" className="ui-btn ui-btn--primary" style={{ alignSelf: 'flex-start', height: 32 }} onClick={onAddClient}>+ Add a client they referred</button>}
          {by === 'type' ? n.groups.filter(g => g.total || g.key === 'clients' || g.key === 'employers').map(g => (
            <div key={g.key} data-network-group={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="ui-group-label">{g.label}{g.total ? ` (${fmt(g.total)})` : ''}</span>
              {!g.total && <span style={dim}>{g.key === 'clients' ? 'None yet.' : 'None yet — add one with "Add a client they referred" or set Source on the employer.'}</span>}
              {g.rows.map(r => (
                <div key={`${r.type}-${r.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, flexWrap: 'wrap' }}>
                  <NameButton r={r} />
                  <span style={{ flex: 1 }} />
                  {g.key === 'clients' ? <><StatusChip status={r.client_status} /><span style={{ color: SA.text }}>{r.lives != null ? fmt(r.lives) : '—'}</span></> : <span style={{ color: SA.muted }}>{r.status_label || '—'}{r.owner ? ` · ${r.owner}` : ''}</span>}
                </div>
              ))}
              {g.more > 0 && <span style={dim}>and {fmt(g.more)} more</span>}
            </div>
          )) : data.groups.map(g => (
            <div key={`${g.person || ''}|${g.office || ''}`} data-referred-group style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="ui-group-label">{[g.person || 'No rep named', g.office].filter(Boolean).join(' · ')} ({g.rows.length})</span>
              {g.rows.map(r => (
                <div key={`${r.type}-${r.id}`} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 13, flexWrap: 'wrap' }}>
                  <NameButton r={r} />
                  <span style={{ color: SA.muted }}>{r.type} · {r.client_status ? 'client' : r.stage_label || '—'} · {r.owner || 'Unassigned'}{r.covered_lives != null ? ` · ${fmt(r.covered_lives)} lives` : ''}</span>
                </div>
              ))}
            </div>
          ))}
          {by === 'rep' && !data.total && <span style={dim}>Nothing is sourced to {row.name} yet.</span>}
        </>
      )}
    </Card>
  );
}
