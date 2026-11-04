import { useState, useEffect } from 'react';
import { SA, SA_TYPE } from '../theme';
import { goalsApi, OPEN_PIPELINE_RECORD } from './goalsApi';
import { ErrorNote, fmt, cardStyle } from './goalsUi';
import { StatusChip } from './ClientParts';

// homelover-clients-v1 C9 - Sources › Network: who brought in whom, as an indented tree from each top-level referrer
// (GET goals/sources/network). A partner line carries its whole sub-network's rollup (clients · lives · in pipeline);
// a company seen higher up reads "↻ see above"; a cut-off branch reads "and n more". A name opens its window.
const TYPE_WORD = { partner: 'partner', employer: 'employer', target: 'target' };
const open = n => window.dispatchEvent(new CustomEvent(OPEN_PIPELINE_RECORD, { detail: { key: `${n.type}-${n.id}` } }));

function Node({ n }) {
  return (
    <li data-network-node={`${n.type}:${n.id}`} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minHeight: 28, fontSize: 13 }}>
        {n.depth > 1 && <span aria-hidden="true" style={{ color: SA.muted }}>└</span>}
        <button type="button" className="ui-btn ui-btn--tertiary" onClick={() => open(n)} style={{ height: 24, padding: '0 2px', fontSize: n.depth === 1 ? 14 : 13, fontWeight: n.depth === 1 ? 600 : 500, color: SA.text }}>{n.name}</button>
        <span style={{ fontSize: 11, color: SA.muted, border: `1px solid ${SA.border}`, borderRadius: 999, padding: '0 8px', lineHeight: '18px' }}>{n.client_status ? 'client' : TYPE_WORD[n.type]}</span>
        {n.repeat ? <span style={{ color: SA.muted }}>↻ see above</span> : <>
          {n.client_status ? <><StatusChip status={n.client_status} /><span style={{ color: SA.text }}>{fmt(n.lives)} lives</span></> : n.type !== 'partner' && n.status_label ? <span style={{ color: SA.muted }}>{n.status_label}</span> : null}
          {n.rollup && <span style={{ color: SA.muted }}>{fmt(n.rollup.clients)} {n.rollup.clients === 1 ? 'client' : 'clients'} · {fmt(n.rollup.lives)} lives · {fmt(n.rollup.in_pipeline)} in pipeline</span>}
          {n.partner_not_set && <span style={{ color: SA.warn }}>its own referrer not set</span>}
        </>}
      </div>
      {(n.children?.length > 0 || n.more > 0) && (
        <ul style={{ margin: 0, padding: '0 0 0 22px' }}>
          {n.children.map(c => <Node key={`${c.type}:${c.id}`} n={c} />)}
          {n.more > 0 && <li style={{ listStyle: 'none', fontSize: 13, color: SA.muted, minHeight: 24 }}>└ and {fmt(n.more)} more</li>}
        </ul>
      )}
    </li>
  );
}

export default function NetworkTree({ businessId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    goalsApi.sourcesNetwork(businessId).then(d => live && setData(d)).catch(e => live && setError(e.message));
    return () => { live = false; };
  }, [businessId]);
  return (
    <section aria-label="Network" data-network-tree style={{ ...cardStyle, padding: 20, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <h2 style={{ ...SA_TYPE.label, color: SA.muted, margin: 0 }}>Who brought in whom</h2>
      <span style={{ fontSize: 12, color: SA.muted }}>From each partner whose own source names no partner. Set a partner's Source to another partner and it moves under it; its clients then count "via" that partner too.</span>
      {error && <ErrorNote message={error} />}
      {!data && !error && <span style={{ fontSize: 13, color: SA.muted }}>Loading…</span>}
      {data && !data.roots.length && <span style={{ fontSize: 13, color: SA.muted }}>No company is sourced to a partner yet.</span>}
      {data && data.roots.length > 0 && <ul style={{ margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>{data.roots.map(n => <Node key={`${n.type}:${n.id}`} n={n} />)}</ul>}
      {data && data.partners_with_none > 0 && <span style={{ fontSize: 12, color: SA.muted }}>{fmt(data.partners_with_none)} partners haven't brought anything in yet.</span>}
    </section>
  );
}
