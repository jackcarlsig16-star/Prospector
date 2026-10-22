import { useState, useEffect, useCallback } from 'react';
import { SA, SA_TYPE } from '../theme';
import { goalsApi } from './goalsApi';
import useMediaQuery from '../../../utils/useMediaQuery';
import CenterWindow from '../CenterWindow';
import TypeChip from './TypeChip';
import CompanyActions from './CompanyActions';
import CompanyEditRow from './CompanyEditRow';
import InterestBand from './InterestBand';
import { SignalsCard, TodosCard, WaitingCard, NotesCard, IntelCard, PeopleCard, ExtraCards } from './CompanyPanelSections';
import { ErrorNote, memberLookup } from './goalsUi';
import { factsFor } from './companyPanelFacts';
import { needsRecord } from './companyPanelModel';
import { Link } from '../../../ui/Button';
import { priorityColor } from '../palette';

// company-panel-v2 - the one company window for every Pipeline row (partner,
// employer, target, Apollo-only, visitor). Pinned head: L1 title row (name ·
// type · ★ Top · site · ✕), L2 the seven labelled facts, L3 the Interest band
// while a signal is fresh, L4 the labelled Actions row, L5 the Edit row.
// Scrolling body (L6): two columns from 980 px, one below. L7 footer. Viewers
// (L8) see facts and body only. Every write reloads the board (onChanged) and
// this body (version). `row` is the board row; the body is GET goals/company.
const POLL_MS = 3000;
const btn = 'ui-btn ui-btn--secondary';

export default function CompanyPanel({ businessId, row, canEdit, members, meId, onStar, onPatch, onChanged, onToast, onConvert, onClose, onOpenFull, onOpenPeople }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [form, setForm] = useState(null); // 'note' | 'todo' | 'contact' | 'promote' | 'add'
  const [starBusy, setStarBusy] = useState(false);
  // L6 (REVISABLE 980): two columns only when the window gets its full 1040 px, so a 1000 px viewport stacks.
  const wide = useMediaQuery('(min-width: 1040px)');
  const running = detail?.research?.runs?.[0]?.status === 'running';
  useEffect(() => {
    let live = true;
    goalsApi.companyDetail(businessId, row.type, row.id).then(d => { if (live) { setDetail(d); setError(''); } }).catch(e => live && setError(e.message));
    return () => { live = false; };
  }, [businessId, row.type, row.id, version]);
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => setVersion(v => v + 1), POLL_MS);
    return () => clearInterval(t);
  }, [running]);
  const changed = useCallback(() => { setVersion(v => v + 1); onChanged(); }, [onChanged]);
  const star = async () => { setStarBusy(true); try { await onStar(); } catch (e) { onToast({ text: e.message }); } finally { setStarBusy(false); } };

  const lookup = memberLookup(members);
  const facts = factsFor(row, detail?.record);
  const site = detail?.record?.site || null;
  const bandShown = !!detail?.interest?.show;
  const fullLabel = row.type === 'visitor' ? 'Open visitor report →' : row.type === 'apollo' ? 'Open in Companies →' : row.type === 'target' ? 'Open in Tasks →' : 'Open full card →';
  const head = (
    <>
      <div data-company-panel={row.type} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', color: SA.text, overflowWrap: 'anywhere', minWidth: 0 }}>{row.name}</h2>
        <TypeChip row={row} style={{ height: 24 }} />
        {canEdit && (row.type === 'partner' || row.type === 'employer') && (
          <button type="button" className={btn} aria-pressed={row.top} disabled={starBusy} onClick={star} style={{ height: 26, padding: '0 10px', fontSize: 12, color: row.top ? SA.warn : undefined }}>{row.top ? '★ Top' : '☆ Top'}</button>
        )}
        {!canEdit && row.top && <span aria-label="Top" style={{ color: SA.warn, fontSize: 13 }}>★ Top</span>}
        {site?.domain && <Link href={`https://${site.domain}`} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>{site.domain} ↗</Link>}
        <span style={{ flex: 1 }} />
        <button type="button" aria-label="Close panel" onClick={onClose} className={btn} style={{ width: 32, padding: 0, fontSize: 16, lineHeight: 1 }}>✕</button>
      </div>
      <div data-facts-row style={{ display: 'flex', gap: '12px 28px', flexWrap: 'wrap' }}>
        {facts.map(([label, value, muted]) => (
          <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <span className="ui-group-label">{label}</span>
            <b title={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500, fontSize: 13, color: muted ? SA.muted : SA.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>
              {label === 'Priority' && !muted && !row.not_a_fit && priorityColor(row.priority) && <span className="ui-tag__dot" data-priority-dot aria-hidden="true" style={{ '--tag-color': priorityColor(row.priority) }} />}{value}
            </b>
          </div>
        ))}
      </div>
      {bandShown && <InterestBand businessId={businessId} row={row} interest={detail.interest} canEdit={canEdit} onChanged={changed} onToast={onToast} />}
      {canEdit
        ? <>
          <CompanyActions businessId={businessId} row={row} members={members} meId={meId} form={form} setForm={setForm} bandShown={bandShown} onPatch={onPatch} onChanged={changed} onToast={onToast} onConvert={onConvert} onClose={onClose} />
          <CompanyEditRow businessId={businessId} row={row} members={members} onPatch={onPatch} onChanged={changed} onToast={onToast} />
        </>
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
            {!needsRecord(row.type) || detail.people.length > 0 ? <PeopleCard {...cardProps} /> : null}
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
