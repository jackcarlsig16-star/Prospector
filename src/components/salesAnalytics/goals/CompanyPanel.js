import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { SA, SA_TYPE, SA_THEME_CLASS } from '../theme';
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
import { SourceHistoryCard } from './LeadSource';
import NetworkCard from './NetworkCard';
import NetworkTree from './NetworkTree';
import { ClientCard, FilesCard, MakeClientForm } from './ClientParts';
import SidePanel from '../SidePanel';
import CompanyProgress from './CompanyProgress';
import IntentFact from './IntentFact';
import { Link } from '../../../ui/Button';
import { KindStageChip, OwnerChip, LiveChip } from './FlowChips';
import { OwnerMenu } from './FlowSheets';
import { NextStepCard, CameFromCard } from './FlowCards';
import { primaryAction, liveSince, isLivePartner } from './flowModel';
import useCompanyEdits from './companyEdits';

// company-panel-v2 - the one company window for every Pipeline row (partner, employer, target, Apollo-only, visitor).
// FIX company-window-subtract-v1 (REV2): every fact once, every action once, a block with nothing to say does not
// render; doing sits above reading. company-window-v4 Stage 1: the head reads title row (name · type · Top · Intent ·
// site · ⋯ · ✕) · Interest band (only while interest is live) · Actions row · facts row (a fact's popover is the list;
// readiness - no owner, no size - draws on the fact, no research on the Intel header) · stage strip (the journey in
// Stage 2), then the body cards. The SETUP strip is gone: its steps are the facts' red states and the journey's nodes.
// A live partner keeps its own layout: title row (Partner · category, Live since, owner, Intent, site), Next step
// (+ Add a client they referred) + Came from, Network + the network tree, partner actions. Buttons that don't apply to
// a state are hidden, not greyed. Every write reloads the board (onChanged) and this body (version). `row` is the
// board row; the body is GET goals/company.
const POLL_MS = 3000;
const btn = 'ui-btn ui-btn--secondary';
const RECORD = ['partner', 'employer', 'target'];

export default function CompanyPanel({ businessId, row, canEdit, members, meId, onStar, onPatch, onChanged, onToast, onConvert, onClose, onOpenFull, onOpenPeople, initialSection = null }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [form, setForm] = useState(null); // 'note' | 'todo' | 'contact' | 'promote' | 'add' | 'draft-kind' | 'deprioritize' | 'they-replied' | 'referral'
  const [starBusy, setStarBusy] = useState(false);
  const [source, setSource] = useState(null); // lead-source-v1: GET goals/source -> { source, history, journey (brad-attribution-v1) }
  const [editPanel, setEditPanel] = useState(null); // company-panel-v3 D2: 'jump' | 'source' | 'domain' under the facts
  const [links, setLinks] = useState([]); // intake-insights-v1: channel links naming this company
  const [clientSheet, setClientSheet] = useState(null); // homelover-clients-v1: { preset? } = the Make client sheet
  // homelover-flow-v1: the Stage 1 reads (GET goals/fit · goals/flow) and the live partner's owner menu.
  const [fit, setFit] = useState(null);
  const [flow, setFlow] = useState([]);
  const [network, setNetwork] = useState(null);
  const [menu, setMenu] = useState(null); // 'owner'
  const [busy, setBusy] = useState('');
  const actionsRef = useRef({});
  const edits = useCompanyEdits({ businessId, row, members, onPatch, onChanged: () => setVersion(v => v + 1), onToast });
  // L6 (REVISABLE 980): two columns only when the window gets its full 1040 px, so a 1000 px viewport stacks.
  const wide = useMediaQuery('(min-width: 1040px)');
  const running = detail?.research?.runs?.[0]?.status === 'running';
  const isRecord = RECORD.includes(row.type);
  const live = isLivePartner(row);
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
    if (!isRecord) return undefined;
    let alive = true;
    goalsApi.fitOf(businessId, row.type, row.id).then(d => alive && setFit(d)).catch(() => alive && setFit(null));
    goalsApi.flowEvents(businessId, row.type, row.id).then(d => alive && setFlow(d)).catch(() => alive && setFlow([]));
    if (live) goalsApi.referredBy(businessId, row.id).then(d => alive && setNetwork(d.network || null)).catch(() => alive && setNetwork(null));
    return () => { alive = false; };
  }, [businessId, row.type, row.id, version, isRecord, live]);
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => setVersion(v => v + 1), POLL_MS);
    return () => clearInterval(t);
  }, [running]);
  useEffect(() => {
    if (!menu) return undefined;
    const close = e => { if (!e.target.closest?.('[data-chip-menu]')) setMenu(null); };
    const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); setMenu(null); } };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [menu]);
  const changed = useCallback(() => { setVersion(v => v + 1); onChanged(); }, [onChanged]);
  const star = async () => { setStarBusy(true); try { await onStar(); } catch (e) { onToast({ text: e.message }); } finally { setStarBusy(false); } };

  const lookup = memberLookup(members);
  const facts = factsFor(row, detail?.record, sourced && source ? source.source : undefined);
  // visitor-to-record-v1 V5: a record that visited the site says so in its facts (first visit · visits / 7 d · pages).
  const web = isRecord && detail?.visits?.length ? detail.visits[0] : null;
  if (web) facts.push(['Website', `first visit ${web.first_visit ? mdShort(web.first_visit) : '—'} · ${web.visits_7d ?? 0} visit${web.visits_7d === 1 ? '' : 's'} / 7 d${(web.top_paths || []).length ? ` · ${web.top_paths.slice(0, 2).map(x => x.path || x).join(', ')}` : ''}`, false]);
  const site = detail?.record?.site || null;
  const bandShown = !!detail?.interest?.show;
  const fullLabel = row.type === 'visitor' ? 'Open visitor report →' : row.type === 'apollo' ? 'Open in Companies →' : row.type === 'target' ? 'Open in Tasks →' : 'Open full card →';
  const pickMore = async id => {
    if (id !== 'link') { setEditPanel(p => (p === id ? null : id)); return; }
    try { await navigator.clipboard.writeText(companyWindowUrl(row)); onToast({ text: `Link to ${row.name} copied` }); } catch { onToast({ text: 'Could not copy the link' }); }
  };
  const act = async (what, fn) => { setBusy(what); try { await fn(); } catch (e) { onToast({ text: e.message }); } finally { setBusy(''); } };
  const bringBack = () => act('bring_back', async () => {
    const r = await goalsApi.bringBack(businessId, row.type, row.id);
    changed();
    onToast({ text: `${row.name}: brought back`, undo: async () => { await goalsApi.undoFlow(businessId, r.event.id); changed(); } });
  });
  const pickOwner = userId => act('owner', async () => {
    if (await edits.changeOwner(userId)) { setMenu(null); onPatch({ owner_user_id: userId || null, owner: members.find(m => m.user_id === userId)?.name.split(' ')[0] || null }); onChanged(); }
  });
  // The live partner's Next step primary: Bring back when deprioritized, else + Add a client they referred.
  const primary = primaryAction({ row, fit });
  const runPrimary = p => (p.id === 'bring_back' ? bringBack() : setClientSheet({ preset: { source_kind: 'partner_referral', source_partner_id: row.id } }));
  // Owner is an editable fact; the stage strip's Assigned step opens that fact's control.
  const openOwnerFact = () => document.querySelector('[data-center-window] [data-fact="Owner"][data-fact-button]')?.click();
  const ownerChip = live && (canEdit
    ? <span data-chip-menu style={{ position: 'relative' }}>
        <OwnerChip row={row} members={members} meId={meId} onClick={() => setMenu(m => (m === 'owner' ? null : 'owner'))} expanded={menu === 'owner'} />
        {menu === 'owner' && <OwnerMenu row={row} members={members} meId={meId} busy={busy === 'owner'} onPick={pickOwner} onClose={() => setMenu(null)} />}
      </span>
    : <OwnerChip row={row} members={members} meId={meId} />);
  const actions = canEdit
    ? <CompanyActions businessId={businessId} row={row} members={members} meId={meId} form={form} setForm={setForm} bandShown={bandShown || !!detail?.steps?.next} fit={fit} stage={detail?.record?.stage ?? row.stage} actionsRef={actionsRef} onPatch={onPatch} onChanged={changed} onToast={onToast} onConvert={onConvert} onClose={onClose} onOwner={() => setMenu('owner')} onAddClient={() => setClientSheet({ preset: { source_kind: 'partner_referral', source_partner_id: row.id } })} />
    : <p style={{ ...SA_TYPE.body, fontSize: 12, color: SA.muted, margin: 0 }}>You have view access, so this is read-only.</p>;
  const titleRow = (
    <div data-company-panel={row.type} data-layout={live ? 'live-partner' : 'classic'} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px 10px', flexWrap: 'wrap', flex: '1 1 auto', minWidth: 0 }}>
      <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', color: SA.text, overflowWrap: 'anywhere', minWidth: 0 }}>{row.name}</h2>
      {live ? <KindStageChip row={row} /> : <TypeChip row={row} style={{ height: 24 }} />}
      {live && <LiveChip since={liveSince(detail?.stage_history)} />}
      {canEdit && (row.type === 'partner' || row.type === 'employer') && (
        <button type="button" className="ui-btn ui-btn--tertiary" aria-pressed={row.top} disabled={starBusy} onClick={star} style={{ height: 28, padding: '0 8px', fontSize: 12, color: row.top ? SA.warn : undefined }}><IconStar size={13} fill={row.top ? 'currentColor' : 'none'} />Top</button>
      )}
      {!canEdit && row.top && <span aria-label="Top" style={{ color: SA.warn, fontSize: 13 }}>★ Top</span>}
      {ownerChip}
      {!needsRecord(row.type) && <IntentFact businessId={businessId} row={row} canEdit={canEdit} version={version} compact />}
      {site?.domain && <Link href={`https://${site.domain}`} target="_blank" rel="noreferrer" style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4 }}>{site.domain}<IconExternal size={12} /></Link>}
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 'none' }}>
      {canEdit && !needsRecord(row.type) && <MoreMenu row={row} canEdit onPick={pickMore} />}
      <button type="button" aria-label="Close panel" onClick={onClose} className="ui-btn ui-btn--tertiary" style={{ width: 32, padding: 0 }}><IconClose /></button>
    </div>
    </div>
  );
  const editPanels = (
    <CompanyFacts businessId={businessId} row={row} record={detail?.record} detail={detail} steps={detail?.steps} facts={live ? [] : facts} canEdit={canEdit} members={members} source={sourced && source ? source.source : null}
      panel={editPanel} setPanel={setEditPanel} onPatch={onPatch} onChanged={changed} onToast={onToast} />
  );
  // F2: no fresh research = the Intel card header glows (it owns Run research / Refresh); a row with no record cannot be researched yet.
  const researchNeed = !!detail?.steps?.steps?.find(s => s.id === 'research' && !['done', 'skip', 'running'].includes(s.status) && !s.needs_record);
  const flowSteps = (row.type === 'employer' || row.type === 'target') && detail
    ? { research: detail.research?.runs?.find(r => r.status === 'done') || null, owner: row.owner_user_id ? (members.find(m => m.user_id === row.owner_user_id)?.name || '').split(' ')[0] || 'owner' : null, client: detail.record?.client || null }
    : null;
  const head = live
    ? <>{titleRow}{editPanel && editPanels}</>
    : (
      <>
        {titleRow}
        {bandShown && <InterestBand businessId={businessId} row={row} interest={detail.interest} canEdit={canEdit} onChanged={changed} onToast={onToast} />}
        {actions}
        {editPanels}
        {detail && !needsRecord(row.type) && <CompanyProgress businessId={businessId} row={row} detail={detail} canEdit={canEdit} flow={flowSteps} onPatch={onPatch} onChanged={changed} onToast={onToast}
          onResearch={() => actionsRef.current.research?.()} onOwner={openOwnerFact} onClient={() => setClientSheet({})} />}
      </>
    );
  const cardProps = { businessId, row, detail, canEdit, live, onForm: setForm, onChanged: changed, onToast };
  const twoCol = { display: 'grid', gridTemplateColumns: wide ? '1fr 1fr' : '1fr', gap: 12, alignItems: 'start' };
  return (
    <>
    <CenterWindow label={row.name} head={head} onClose={onClose}>
      {error && <ErrorNote message={error} />}
      {!detail && !error && <span style={{ fontSize: 13, color: SA.muted }}>Loading…</span>}
      {detail && live && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: wide ? '3fr 2fr' : '1fr', gap: 12, alignItems: 'stretch' }}>
            <NextStepCard row={row} detail={detail} primary={primary} busy={busy} canEdit={canEdit} onPrimary={runPrimary} />
            <CameFromCard network={network} canEdit={canEdit} onSetSource={() => setEditPanel(p => (p === 'source' ? null : 'source'))} />
          </div>
          <div style={twoCol}>
            <NetworkCard businessId={businessId} row={row} version={version} canEdit={canEdit} onSetSource={() => setEditPanel('source')} onAddClient={null} hideCameFrom />
            <section aria-label="Network view" data-section="network-tree" style={{ background: SA.surface2, border: `1px solid ${SA.border}`, borderRadius: 10, padding: '12px 14px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span className="ui-group-label">Network view (sources › network)</span>
              <NetworkTree businessId={businessId} limit={3} />
            </section>
          </div>
          {actions}
        </>
      )}
      {detail && (
        <div data-panel-body style={twoCol}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
            <SignalsCard {...cardProps} onOpenPeople={onOpenPeople} />
            <TodosCard {...cardProps} />
            <WaitingCard {...cardProps} />
            <NotesCard {...cardProps} lookup={lookup} flow={flow} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
            {row.type === 'partner' && !live && <NetworkCard businessId={businessId} row={row} version={version} canEdit={canEdit}
              onSetSource={() => setEditPanel('source')} onAddClient={() => setClientSheet({ preset: { source_kind: 'partner_referral', source_partner_id: row.id } })} />}
            {row.type === 'employer' && <ClientCard {...cardProps} onMake={() => setClientSheet({})} />}
            {row.type === 'employer' && <FilesCard businessId={businessId} row={row} canEdit={canEdit} version={version} onToast={onToast} />}
            {detail.research && <IntelCard {...cardProps} need={researchNeed} />}
            {!needsRecord(row.type) || detail.people.length > 0 ? <div data-section="people" ref={el => { if (el && initialSection === 'people' && !el.dataset.shown) { el.dataset.shown = '1'; el.scrollIntoView({ block: 'start' }); } }}><PeopleCard {...cardProps} /></div> : null}
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
      {/* Portaled to <body> so the sheet's complementary landmark is top-level (axe), themed like QuickCapture's add flows. */}
      {clientSheet && canEdit && createPortal(<span className={`${SA_THEME_CLASS} ui-theme-dark no-print`}>
        <SidePanel label={row.type === 'employer' ? `Make ${row.name} a client` : `Add a client ${row.name} referred`} width={620} onClose={() => setClientSheet(null)}>
          <MakeClientForm businessId={businessId} row={row.type === 'employer' ? row : null} record={row.type === 'employer' ? detail?.record : null}
            source={row.type === 'employer' && source ? source.source : null} preset={clientSheet.preset || null} onToast={onToast}
            onCancel={() => setClientSheet(null)} onDone={() => { setClientSheet(null); changed(); }} />
        </SidePanel>
      </span>, document.body)}
    </>
  );
}
