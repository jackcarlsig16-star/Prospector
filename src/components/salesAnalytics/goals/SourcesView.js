import { useState, useEffect, useCallback, useRef } from 'react';
import { SA, SA_TYPE } from '../theme';
import { goalsApi } from './goalsApi';
import { cardStyle, labelStyle, numStyle, fmt, h3Style, ErrorNote, Btn } from './goalsUi';
import { TEAM_OPTIONS } from './dashboardModel';
import { BOARD_COLORS } from '../../../constants/pipelineBoard';
import useMediaQuery from '../../../utils/useMediaQuery';
import FilterSelect from '../../../ui/FilterSelect';
import SourcesBackfill from './SourcesBackfill';
import SourceFunnel from './SourceFunnel';
import ChannelLinks from './ChannelLinks';
import PeopleCompanyPanel from '../PeopleCompanyPanel';
import { SOURCE_KINDS, SOURCE_LABEL } from '../../../constants/leadSources';

// lead-source-v1 B4 - Dashboard > Sources: companies by source kind, by
// referring partner, and down to the partner's rep and office, with each
// group's Pipeline bands (Meeting / Pilot-live are the yellow / green bands)
// and covered lives. Export for <partner> previews that partner's referred
// companies in #sales-analytics-print-area (SalesAnalyticsTab PRINT_STYLES)
// and downloads the same rows as CSV - structured fields only, never route
// in, notes or other free text (the server builds the rows).
const RANGES = [['', 'All time'], ['30', '30 days'], ['90', '90 days'], ['365', '12 months']];
const BAND_HEAD = { green: 'Pilot / live', yellow: 'Meeting' };
const BANDS = ['green', 'yellow', 'blue', 'gray', 'light', 'faded'].map(id => ({ id, label: BAND_HEAD[id] || BOARD_COLORS.find(c => c.id === id).label }));
const cell = { padding: '8px 10px', borderTop: `1px solid ${SA.track}`, fontSize: 13, color: SA.text, ...numStyle, textAlign: 'right', whiteSpace: 'nowrap' };
const today = () => new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function GroupTable({ title, groups, empty, narrow, onExport }) {
  return (
    <section aria-label={title} data-sources-table={title} style={{ ...cardStyle, padding: narrow ? 16 : 20, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <h3 style={h3Style}>{title}</h3>
      {!groups.length && <span style={{ fontSize: 13, color: SA.muted }}>{empty}</span>}
      {groups.length > 0 && (narrow ? (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {groups.map(g => (
            <li key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 0', borderTop: `1px solid ${SA.track}`, fontSize: 13 }}>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
                <b style={{ color: SA.text, fontWeight: 600, overflowWrap: 'anywhere' }}>{g.label}</b>
                {onExport && <button type="button" className="ui-btn ui-btn--tertiary" style={{ height: 28, fontSize: 12 }} onClick={() => onExport(g.key)}>Export</button>}
              </span>
              <span style={{ color: SA.soft, ...numStyle }}>{fmt(g.companies)} companies · {fmt(g.meetings)} meeting · {fmt(g.pilot_live)} pilot / live{g.covered_lives ? ` · ${fmt(g.covered_lives)} lives` : ''}</span>
              <span style={{ color: SA.muted, ...numStyle }}>{BANDS.filter(b => g.bands[b.id]).map(b => `${b.label} ${g.bands[b.id]}`).join(' · ')}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th scope="col" style={{ ...labelStyle, textAlign: 'left', padding: '8px 10px' }}>{title.replace(/^By /, '')}</th>
                <th scope="col" style={{ ...labelStyle, textAlign: 'right', padding: '8px 10px' }}>Companies</th>
                {BANDS.map(b => <th key={b.id} scope="col" style={{ ...labelStyle, textAlign: 'right', padding: '8px 10px', whiteSpace: 'nowrap' }}>{b.label}</th>)}
                <th scope="col" style={{ ...labelStyle, textAlign: 'right', padding: '8px 10px', whiteSpace: 'nowrap' }}>Covered lives</th>
                {onExport && <th scope="col" style={{ ...labelStyle, textAlign: 'left', padding: '8px 10px' }}>Export</th>}
              </tr>
            </thead>
            <tbody>
              {groups.map(g => (
                <tr key={g.key}>
                  <td style={{ ...cell, textAlign: 'left', whiteSpace: 'normal', fontWeight: 500 }}>{g.label}</td>
                  <td style={cell}>{fmt(g.companies)}</td>
                  {BANDS.map(b => <td key={b.id} style={{ ...cell, color: g.bands[b.id] ? SA.text : SA.muted }}>{g.bands[b.id] || '—'}</td>)}
                  <td style={cell}>{g.covered_lives ? fmt(g.covered_lives) : '—'}</td>
                  {onExport && <td style={{ ...cell, padding: '4px 10px' }}><button type="button" className="ui-btn ui-btn--tertiary" style={{ height: 28, fontSize: 12 }} onClick={() => onExport(g.key)}>Export</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}

// The printable page for one partner: its referred companies and their stages.
function PartnerExport({ businessId, partnerId, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setData(null);
    goalsApi.sourcesExport(businessId, partnerId).then(d => live && setData(d)).catch(e => live && setError(e.message));
    return () => { live = false; };
  }, [businessId, partnerId]);
  const csv = async () => {
    setBusy(true); setError('');
    try {
      const res = await fetch(goalsApi.sourcesExportCsvUrl(businessId, partnerId));
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Export failed (${res.status})`);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await res.blob());
      a.download = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'referred.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const t = data?.totals;
  return (
    <section aria-label="Export for partner" data-partner-export style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <div className="no-print" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <h3 style={{ ...h3Style, marginRight: 'auto' }}>Export for {data?.partner.name || '…'}</h3>
        <Btn primary disabled={!data} onClick={() => window.print()}>Print / PDF</Btn>
        <Btn disabled={!data || busy} onClick={csv}>{busy ? 'Downloading…' : 'CSV'}</Btn>
        <Btn onClick={onClose}>Close</Btn>
      </div>
      <p className="no-print" style={{ margin: 0, fontSize: 12, color: SA.muted }}>What the partner sees: company, type, stage, owner, covered lives, their rep and office. No notes, route in, emails or phones.</p>
      {error && <ErrorNote message={error} />}
      {!data && !error && <span style={{ fontSize: 13, color: SA.muted }}>Loading…</span>}
      {data && (
        <div id="sales-analytics-print-area" style={{ color: SA.text, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h1 style={{ ...SA_TYPE.pageTitle, fontSize: 20, margin: 0 }}>Companies referred by {data.partner.name}</h1>
          <p style={{ margin: 0, fontSize: 12, color: SA.muted, ...numStyle }}>
            {today()} · {fmt(t.companies)} companies · {fmt(t.meetings)} at meeting · {fmt(t.pilot_live)} pilot / live{t.covered_lives ? ` · ${fmt(t.covered_lives)} covered lives` : ''}
          </p>
          {!data.rows.length && <span style={{ fontSize: 13, color: SA.muted }}>Nothing is sourced to {data.partner.name} yet.</span>}
          {data.rows.length > 0 && (
            <div className="sa-scroll" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{data.columns.map(c => <th key={c.key} scope="col" style={{ ...labelStyle, textAlign: c.key === 'covered_lives' ? 'right' : 'left', padding: '6px 10px', whiteSpace: 'nowrap' }}>{c.label}</th>)}</tr></thead>
                <tbody>
                  {data.rows.map((r, i) => (
                    <tr key={i}>
                      {data.columns.map(c => <td key={c.key} style={{ ...cell, textAlign: c.key === 'covered_lives' ? 'right' : 'left', whiteSpace: c.key === 'name' ? 'normal' : 'nowrap', fontWeight: c.key === 'name' ? 500 : 400 }}>{c.key === 'covered_lives' ? (r[c.key] != null ? fmt(r[c.key]) : '—') : r[c.key] || '—'}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default function SourcesView({ businessId, partners, isAdmin, canEdit, members, meId, onToast }) {
  const [days, setDays] = useState('');
  const [team, setTeam] = useState('');
  const [partner, setPartner] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [exportFor, setExportFor] = useState(null);
  const [version, setVersion] = useState(0);
  // brad-attribution-v1 F4: the dated funnel (Rep / Source filter it; the band tally below keeps Range / Team / Partner).
  const [rep, setRep] = useState('');
  const [source, setSource] = useState('');
  const [funnel, setFunnel] = useState(null);
  const [funnelError, setFunnelError] = useState('');
  const [reps, setReps] = useState([]);
  const [company, setCompany] = useState(null); // { company, link } for the company window
  const opener = useRef(null);
  const narrow = useMediaQuery('(max-width: 720px)');
  useEffect(() => {
    let live = true;
    goalsApi.sources(businessId, { days, team, partner }).then(d => { if (live) { setData(d); setError(''); } }).catch(e => live && setError(e.message));
    return () => { live = false; };
  }, [businessId, days, team, partner, version]);
  useEffect(() => {
    let live = true;
    goalsApi.sourcesFunnel(businessId, { days, team, partner, rep, source }).then(d => {
      if (!live) return;
      setFunnel(d); setFunnelError('');
      if (!rep) setReps([...new Set(d.companies.map(c => c.source_person).filter(Boolean))].sort((a, b) => a.localeCompare(b)));
    }).catch(e => live && setFunnelError(e.message));
    return () => { live = false; };
  }, [businessId, days, team, partner, rep, source, version]);
  const openCompany = useCallback((c, el) => { opener.current = el; setCompany({ company: c.name, link: { type: c.type, id: c.id } }); }, []);
  const closeCompany = useCallback(() => setCompany(null), []);
  const panelToast = useCallback(t => onToast(t.text), [onToast]);
  // Focus goes back to the name that opened the window once it's gone.
  useEffect(() => { if (!company && opener.current) { opener.current.focus(); opener.current = null; } }, [company]);
  const partnerOptions = [{ value: '', label: 'All partners' }, ...[...partners].filter(p => !p.archived_at).sort((a, b) => a.name.localeCompare(b.name)).map(p => ({ value: p.id, label: p.name }))];
  const t = data?.totals;
  return (
    <div data-sources-view style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <div className="no-print" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <FilterSelect label="Range" value={days} options={RANGES.map(([value, label]) => ({ value, label }))} onChange={setDays} />
        <FilterSelect label="Team" value={team} options={TEAM_OPTIONS.map(([value, label]) => ({ value, label }))} onChange={setTeam} />
        <FilterSelect label="Partner" value={partner} options={partnerOptions} onChange={setPartner} />
        <FilterSelect label="Rep" value={rep} options={[{ value: '', label: 'All reps' }, ...reps.map(r => ({ value: r, label: r }))]} onChange={setRep} />
        <FilterSelect label="Source" value={source} options={[{ value: '', label: 'All sources' }, ...SOURCE_KINDS.map(k => ({ value: k, label: SOURCE_LABEL[k] }))]} onChange={setSource} />
        {partner && <Btn onClick={() => setExportFor(partner)}>Export for {partners.find(p => p.id === partner)?.name || 'partner'}</Btn>}
        <span style={{ fontSize: 12, color: SA.muted }}>Range = companies added in that window · source = who brought the lead, not how it entered Prospector</span>
      </div>
      {exportFor && <PartnerExport businessId={businessId} partnerId={exportFor} onClose={() => setExportFor(null)} />}
      {funnelError && <ErrorNote message={funnelError} />}
      {!funnel && !funnelError && <span style={{ fontSize: 13, color: SA.muted }}>Loading the funnel…</span>}
      {funnel && <SourceFunnel data={funnel} narrow={narrow} onOpenCompany={openCompany} />}
      {error && <ErrorNote message={error} />}
      {!data && !error && <span style={{ fontSize: 13, color: SA.muted }}>Loading…</span>}
      {data && <>
        <h2 style={{ ...h3Style, marginTop: 8 }}>Pipeline bands today{rep || source ? <span style={{ fontWeight: 400, fontSize: 12, color: SA.muted }}> · Rep / Source filter the funnel only</span> : null}</h2>
        <p data-sources-totals style={{ margin: 0, fontSize: 14, color: SA.text, ...numStyle }}>
          <b>{fmt(t.companies)}</b> companies · <b>{fmt(t.meetings)}</b> at meeting · <b>{fmt(t.pilot_live)}</b> pilot / live{t.covered_lives ? <> · <b>{fmt(t.covered_lives)}</b> covered lives</> : null}
        </p>
        <GroupTable title="By source" groups={data.by_kind} empty="No companies in this range." narrow={narrow} />
        <GroupTable title="By referring partner" groups={data.by_partner} empty="No company is sourced to a partner yet." narrow={narrow} onExport={setExportFor} />
        <GroupTable title="By rep" groups={data.by_person} empty="No partner rep named yet." narrow={narrow} />
        <GroupTable title="By office" groups={data.by_office} empty="No partner office named yet." narrow={narrow} />
      </>}
      <ChannelLinks businessId={businessId} partner={partner} narrow={narrow} />
      {company && <PeopleCompanyPanel businessId={businessId} person={company} canEdit={canEdit} members={members} meId={meId} onToast={panelToast} onClose={closeCompany} onOpenFull={closeCompany} />}
      {isAdmin && <SourcesBackfill businessId={businessId} onApplied={() => setVersion(v => v + 1)} />}
    </div>
  );
}
