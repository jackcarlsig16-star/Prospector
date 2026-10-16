import { useState, useEffect } from 'react';
import { SA, saSans } from '../../theme';
import { labelStyle, subStyle, Btn, ErrorNote } from '../goalsUi';
import { laDateString } from '../../periods';

// partner-add-research-v1 Stage 2 - the research card: sits between the Intel
// and Domains drawers so it shows even when Intel is folded (D2). A run never
// writes to the partner; every line here is a click away from the record:
// Confirm site -> partner_domains (confirmed) + company_domain when empty,
// Wrong site -> nothing saved, Use -> appends "(M/D) AI: ..." to the mapped
// intel field, Set category -> only when the partner has none. Viewer sees
// the result, no buttons. api: { load(id), run(id) }; domains: { add };
// confirmedDomains: the partner's confirmed domains (from the Domains drawer).
const POLL_MS = 3000;
// result field -> [label, sales_goals column it appends to]
export const USE_FIELDS = [
  ['summary', 'Summary', 'angle'], ['mission', 'Mission (their words)', 'angle'], ['positioning', 'Positioning', 'angle'],
  ['size', 'Scale', null], ['hq_city', 'HQ', null], ['recent_news', 'Recent news', 'angle'], ['housing_perk', 'Housing perk', 'watch_outs'],
  ['why_homelover', 'Why us', 'angle'], ['first_angle', 'First angle', 'first_email'], ['watch_outs', 'Watch-outs', 'watch_outs'], ['titles', 'Titles to approach', 'target_titles'],
];
export const stampDate = (d = laDateString()) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
export const appendAi = (existing, text, d) => { const line = `(${stampDate(d)}) AI: ${text}`; return existing ? `${existing}\n${line}` : line; };
const money = c => (c == null ? '' : `$${Number(c).toFixed(3)}`);
const when = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const small = { height: 28, padding: '0 10px', fontSize: 12 };
const link = { color: SA.link, textDecoration: 'none' };

export default function PartnerResearch({ partner, canEdit, api, domains, confirmedDomains = [], onDomainData, onUpdate }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [used, setUsed] = useState({});
  const latest = data?.runs?.[0] || null;
  const running = latest?.status === 'running';
  useEffect(() => {
    if (!api) return undefined;
    let live = true;
    setData(null); setWrong(false); setUsed({}); setError('');
    api.load(partner.id).then(d => { if (live) setData(d); }).catch(e => live && setError(e.message));
    return () => { live = false; };
  }, [partner.id, api]);
  useEffect(() => {
    if (!api || !running) return undefined;
    const t = setInterval(() => api.load(partner.id).then(setData).catch(() => {}), POLL_MS);
    return () => clearInterval(t);
  }, [api, running, partner.id]);
  if (!api) return null;

  const act = async fn => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const run = () => act(async () => { await api.run(partner.id); setWrong(false); setUsed({}); setData(await api.load(partner.id)); });
  const r = latest?.status === 'done' ? latest.result : null;
  const siteConfirmed = !!(r?.domain && confirmedDomains.includes(r.domain));
  const confirmSite = () => act(async () => {
    const d = await domains.add(partner.id, { domain: r.domain });
    if (onDomainData) onDomainData(d);
    if (!partner.company_domain) await onUpdate(partner.id, { company_domain: r.domain });
  });
  const use = (field, column) => act(async () => { await onUpdate(partner.id, { [column]: appendAi(partner[column], r[field]) }); setUsed(u => ({ ...u, [field]: true })); });
  const capReached = data ? data.today >= data.cap : false;
  const status = !data ? 'loading…' : running ? 'Researching…' : !latest ? 'none yet' : latest.status === 'error' ? `failed ${when(latest.created_at)}` : `${when(latest.created_at)}${latest.cost_usd != null ? ` · ${money(latest.cost_usd)}` : ''}${r?.web_searches != null ? ` · ${r.web_searches} search${r.web_searches === 1 ? '' : 'es'}` : ''}`;

  return (
    <section aria-label={`Research on ${partner.name}`} style={{ ...saSans, display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 0', borderTop: `1px solid ${SA.border}`, fontSize: 13 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={labelStyle}>Research</span>
        <span role="status" style={{ ...subStyle, fontSize: 12 }}>{status}</span>
        {canEdit && data && !running && (
          <Btn style={small} onClick={run} disabled={busy || capReached} title={capReached ? `Cap reached (${data.cap} per partner per day)` : latest ? 'A new run; the earlier result stays stored' : 'One Claude call with up to 3 web searches'}>
            {latest ? 'Re-run' : 'Research'}
          </Btn>
        )}
        {capReached && !running && <span style={{ ...subStyle, fontSize: 12 }}>cap reached · {data.cap}/day</span>}
      </div>
      {latest?.status === 'error' && <ErrorNote message={`Research failed: ${latest.error}`} />}
      {r && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={labelStyle}>Site</span>
            {r.domain
              ? <>
                  <a href={r.website || `https://${r.domain}`} target="_blank" rel="noreferrer" style={link}>{r.domain}</a>
                  <span style={{ ...subStyle, fontSize: 12 }}>· {r.website_confidence}</span>
                  {r.source_urls.map((u, i) => <a key={u} href={u} target="_blank" rel="noreferrer" style={{ ...link, fontSize: 12 }}>source {i + 1} ↗</a>)}
                  {siteConfirmed && <span style={{ color: SA.good, fontSize: 12 }}>confirmed ✓</span>}
                  {!siteConfirmed && wrong && <span style={{ ...subStyle, fontSize: 12 }}>marked wrong · nothing saved</span>}
                  {canEdit && !siteConfirmed && !wrong && <>
                    <Btn primary style={small} onClick={confirmSite} disabled={busy}>Confirm site</Btn>
                    <Btn style={small} onClick={() => setWrong(true)} disabled={busy}>Wrong site</Btn>
                  </>}
                </>
              : <span style={{ ...subStyle, fontSize: 12 }}>no site found</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '10px 20px' }}>
            {USE_FIELDS.filter(([f]) => r[f]).map(([f, label, column]) => (
              <div key={f} style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={labelStyle}>{label}</span>
                <div style={{ color: SA.text, overflowWrap: 'anywhere' }}>{r[f]}</div>
                {canEdit && column && (used[f]
                  ? <span style={{ color: SA.good, fontSize: 12 }}>Used ✓</span>
                  : <button type="button" onClick={() => use(f, column)} disabled={busy} aria-label={`Use ${label}`} style={{ ...saSans, alignSelf: 'flex-start', border: 'none', background: 'transparent', color: SA.link, cursor: 'pointer', padding: 0, fontSize: 12 }}>Use → {column.replace('_', ' ')}</button>)}
              </div>
            ))}
          </div>
          {r.suggested_category && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={labelStyle}>Suggested category</span>
              <span>{r.suggested_category}</span>
              {partner.category
                ? <span style={{ ...subStyle, fontSize: 12 }}>current: {partner.category}</span>
                : canEdit && <Btn style={small} onClick={() => act(() => onUpdate(partner.id, { category: r.suggested_category }))} disabled={busy}>Set category</Btn>}
            </div>
          )}
        </>
      )}
      {error && <ErrorNote message={error} />}
    </section>
  );
}
