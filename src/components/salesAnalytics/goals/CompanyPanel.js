import { useState, useEffect, useCallback } from 'react';
import { SA, SA_TYPE } from '../theme';
import { goalsApi } from './goalsApi';
import useMediaQuery from '../../../utils/useMediaQuery';
import CenterWindow from '../CenterWindow';
import TypeChip from './TypeChip';
import CompanyActions from './CompanyActions';
import CompanyFacts, { MoreMenu } from './CompanyFacts';
import { companyWindowUrl } from '../salesNav';
import { IconStar, IconExternal, IconClose } from '../../../ui/icons';
import InterestBand from './InterestBand';
import { SignalsCard, TodosCard, WaitingCard, NotesCard, IntelCard, PeopleCard, ExtraCards } from './CompanyPanelSections';
import { ErrorNote, memberLookup } from './goalsUi';
import { factsFor } from './companyPanelFacts';
const mdShort = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
import { needsRecord } from './companyPanelModel';
import { SourceHistoryCard, ReferredByCard } from './LeadSource';
import CompanyStepsStrip from './CompanyStepsStrip';
import IntentFact from './IntentFact';
import JourneyLine from './JourneyLine';
import { Link } from '../../../ui/Button';

// company-panel-v2 - the one company window for every Pipeline row (partner,
// employer, target, Apollo-only, visitor). Pinned head: L1 title row (name ·
// type · ★ Top · site · ✕), L2 the seven labelled facts, L3 the Interest band
// while a signal is fresh, L4 the labelled Actions row, L5 the Edit row.
// Scrolling body (L6): two columns from 980 px, one below. L7 footer. Viewers
// (L8) see facts and body only. Every write reloads the board (onChanged) and
// this body (version). `row` is the board row; the body is GET goals/company.
const POLL_MS = 3000;
const btn = 'ui-btn ui-btn--secondary';

export default function CompanyPanel({ businessId, row, canEdit, members, meId, onStar, onPatch, onChanged, onToast, onConvert, onClose, onOpenFull, onOpenPeople, initialSection = null }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [form, setForm] = useState(null); // 'note' | 'todo' | 'contact' | 'promote' | 'add' | 'draft-kind'
  const [starBusy, setStarBusy] = useState(false);
  const [source, setSource] = useState(null); // lead-source-v1: GET goals/source -> { source, history, journey (brad-attribution-v1) }
  const [editPanel, setEditPanel] = useState(null); // company-panel-v3 D2: 'jump' | 'source' | 'domain' under the facts
  const [links, setLinks] = useState([]); // intake-insights-v1: channel links naming this company
  // L6 (REVISABLE 980): two columns only when the window gets its full 1040 px, so a 1000 px viewport stacks.
  const wide = useMediaQuery('(min-width: 1040px)');
  const running = detail?.research?.runs?.[0]?.status === 'running';
  useEffect(() => {
    let live = true;
    goalsApi.companyDetail(businessId, row.type, row.id).then(d => { if (live) { setDetail(d); setError(''); } }).catch(e => live && setError(e.message));
    return () => { live = false; };
  }, [businessId, row.type, row.id, version]);
  const sourced = !needsRecord(row.type); // partner / employer / target carry a source
  useEffect(() => {
    if (!sourced) return undefined;
    let live = true;
    goalsApi.source(businessId, row.type, row.id).then(d => live && setSource(d)).catch(() => live && setSource(null));
    return () => { live = false; };
  }, [businessId, row.type, row.id, version, sourced]);
  useEffect(() => {
    if (!sourced) return undefined;
    let live = true;
    goalsApi.channelLinks(businessId, { record: `${row.type}:${row.id}` }).then(l => live && setLinks(l)).catch(() => live && setLinks([]));
    return () => { live = false; };
  }, [businessId, row.type, row.id, version, sourced]);
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => setVersion(v => v + 1), POLL_MS);
    return () => clearInterval(t);
  }, [running]);
  const changed = useCallback(() => { setVersion(v => v + 1); onChanged(); }, [onChanged]);
  const star = async () => { setStarBusy(true); try { await onStar(); } catch (e) { onToast({ text: e.message }); } finally { setStarBusy(false); } };

  const lookup = memberLookup(members);
  const facts = factsFor(row, detail?.record, sourced && source ? source.source : undefined);
  // visitor-to-record-v1 V5: a record that visited the site says so in its facts (first visit · visits / 7 d · pages).
  const web = (row.type === 'employer' || row.type === 'target' || row.type === 'partner') && detail?.visits?.length ? detail.visits[0] : null;
  if (web) facts.push(['Website', `first visit ${web.first_visit ? mdShort(web.first_visit) : '—'} · ${web.visits_7d ?? 0} visit${web.visits_7d === 1 ? '' : 's'} / 7 d${(web.top_paths || []).length ? ` · ${web.top_paths.slice(0, 2).map(x => x.path || x).join(', ')}` : ''}`, false]);
  const site = detail?.record?.site || null;
  const bandShown = !!detail?.interest?.show;
  const fullLabel = row.type === 'visitor' ? 'Open visitor report →' : row.type === 'apollo' ? 'Open in Companies →' : row.type === 'target' ? 'Open in Tasks →' : 'Open full card →';
  const pickMore = async id => {
    if (id !== 'link') { setEditPanel(p => (p === id ? null : id)); return; }
    try { await navigator.clipboard.writeText(companyWindowUrl(row)); onToast({ text: `Link to ${row.name} copied` }); } catch { onToast({ text: 'Could not copy the link' }); }
  };
  const head = (
    <>
      <div data-company-panel={row.type} style={{ display: 'flex', alignItems: 'center', gap: '8px 12px', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', color: SA.text, overflowWrap: 'anywhere', minWidth: 0 }}>{row.name}</h2>
        <TypeChip row={row} style={{ height: 24 }} />
        {canEdit && (row.type === 'partner' || row.type === 'employer') && (
          <button type="button" className="ui-btn ui-btn--tertiary" aria-pressed={row.top} disabled={starBusy} onClick={star} style={{ height: 28, padding: '0 8px', fontSize: 12, color: row.top ? SA.warn : undefined }}><IconStar size={13} fill={row.top ? 'currentColor' : 'none'} />Top</button>
        )}
        {!canEdit && row.top && <span aria-label="Top" style={{ color: SA.warn, fontSize: 13 }}>★ Top</span>}
        {site?.domain && <Link href={`https://${site.domain}`} target="_blank" rel="noreferrer" style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4 }}>{site.domain}<IconExternal size={12} /></Link>}
        {!needsRecord(row.type) && <IntentFact businessId={businessId} row={row} canEdit={canEdit} version={version} compact />}
        <span style={{ flex: 1 }} />
        {canEdit && !needsRecord(row.type) && <MoreMenu row={row} canEdit onPick={pickMore} />}
        <button type="button" aria-label="Close panel" onClick={onClose} className="ui-btn ui-btn--tertiary" style={{ width: 32, padding: 0 }}><IconClose /></button>
      </div>
      <CompanyFacts businessId={businessId} row={row} record={detail?.record} facts={facts} canEdit={canEdit} members={members} source={sourced && source ? source.source : null}
        panel={editPanel} setPanel={setEditPanel} onPatch={onPatch} onChanged={changed} onToast={onToast} />
      {sourced && source?.journey && <JourneyLine businessId={businessId} row={row} journey={source.journey} source={source.source} canEdit={canEdit} onMarked={() => setVersion(v => v + 1)} onToast={onToast} />}
      {detail?.steps && <CompanyStepsStrip businessId={businessId} row={row} detail={detail} canEdit={canEdit} members={members} onChanged={changed} onConvert={onConvert} onToast={onToast} setForm={setForm} />}
      {bandShown && <InterestBand businessId={businessId} row={row} interest={detail.interest} canEdit={canEdit} onChanged={changed} onToast={onToast} />}
      {canEdit
        ? <CompanyActions businessId={businessId} row={row} members={members} meId={meId} form={form} setForm={setForm} bandShown={bandShown || !!detail?.steps?.next} onPatch={onPatch} onChanged={changed} onToast={onToast} onConvert={onConvert} onClose={onClose} />
        : <p style={{ ...SA_TYPE.body, fontSize: 12, color: SA.muted, margin: 0 }}>You have view access, so this is read-only.</p>}
    </>
  );
  const cardProps = { businessId, row, detail, canEdit, onForm: setForm, onChanged: changed, onToast };
  return (
    <CenterWindow label={row.name} head={head} onClose={onClose}>
      {error && <ErrorNote message={error} />}
      {!detail && !error && <span style={{ fontSize: 13, color: SA.muted }}>Loading…</span>}
      {detail && (
        <div data-panel-body style={{ display: 'grid', gridTemplateColumns: wide ? '1fr 1fr' : '1fr', gap: 12, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
            <SignalsCard {...cardProps} onOpenPeople={onOpenPeople} />
            <TodosCard {...cardProps} />
            <WaitingCard {...cardProps} />
            <NotesCard {...cardProps} lookup={lookup} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
            {detail.research && <IntelCard {...cardProps} />}
            {!needsRecord(row.type) || detail.people.length > 0 ? <div data-section="people" ref={el => { if (el && initialSection === 'people' && !el.dataset.shown) { el.dataset.shown = '1'; el.scrollIntoView({ block: 'start' }); } }}><PeopleCard {...cardProps} /></div> : null}
            {row.type === 'partner' && <ReferredByCard businessId={businessId} row={row} version={version} />}
            {sourced && <SourceHistoryCard data={source} links={links} />}
            <ExtraCards row={row} detail={detail} />
          </div>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto', paddingTop: 8 }}>
        <button type="button" className={btn} onClick={onOpenFull}>{fullLabel}</button>
        <span style={{ flex: 1, textAlign: 'center', fontSize: 12, color: SA.muted }}>Esc closes</span>
        <button type="button" className={btn} onClick={onClose}>Close</button>
      </div>
    </CenterWindow>
  );
}
