import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { SA_THEME_CLASS } from '../../theme';
import { goalsApi, OPEN_PIPELINE_RECORD } from '../goalsApi';
import { priorityColor } from '../../palette';
import { memberColor } from '../../../../constants/memberColors';
import useMediaQuery from '../../../../utils/useMediaQuery';
import FilterSelect from '../../../../ui/FilterSelect';
import { IconSearch } from '../../../../ui/icons';
import ScoreBar from './ScoreBar';
import PinControl, { Star } from './PinControl';
import { TT_CSS } from './topTargetsStyles';
import { BANDS, SIZE_OPTIONS, GROUP_ORDER, GROUP_LABEL, GROUP_COLOR, routeParams, ownerChips, pinLine, shortDate } from './topTargetsModel';

// top-targets-v1 Stage 2 - Pipeline › Top targets: one ranking for "who do we go after" (GET goals/top-targets: pins
// first, newest pin on top, then score). The chips are the route's own filters and counts; the star is the one pin
// writer (POST goals/company/:type/:id/pin) with a 10 s Undo. Rulings S1-S7: one five-segment bar, the Why line stops
// at the stage, Mine replaces the signed-in member's chip, an expired pin is a hollow star with Renew, Viewers read.
const UNDO_MS = 10000;
const DONE = { pin: 'Pinned', renew: 'Pin renewed for 30 days', unpin: 'Unpinned', reason: 'Pin reason saved' };
const openCompany = r => window.dispatchEvent(new CustomEvent(OPEN_PIPELINE_RECORD, { detail: { key: `${r.type}-${r.id}` } }));
const TodoBox = () => <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false"><rect x="2.5" y="2.5" width="11" height="11" rx="2.5" /></svg>;

export default function TopTargetsView({ businessId, canEdit, meId, members = [] }) {
  const phone = useMediaQuery('(max-width: 760px)');
  const [filters, setFilters] = useState({ owner: 'me', band: '', pinned: false, size: '', q: '' });
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const seq = useRef(0);
  const set = patch => setFilters(f => ({ ...f, ...patch }));

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const d = await goalsApi.topTargets(businessId, routeParams(filters));
      if (mine === seq.current) { setData(d); setError(''); }
    } catch (e) { if (mine === seq.current) setError(e.message); }
  }, [businessId, filters]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setTimeout(() => setFilters(f => (f.q === search.trim() ? f : { ...f, q: search.trim() })), 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), toast.undo ? UNDO_MS : 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const act = async (row, action, reason) => {
    try {
      const out = await goalsApi.pinCompany(businessId, row.type, row.id, { action, ...(reason ? { reason } : {}), expect: { pinned_until: row.pinned_until } });
      const undo = out.undo?.kind === 'partner' ? () => goalsApi.partnerUndo(businessId, row.id, out.undo.id) : () => goalsApi.undoFlow(businessId, out.undo.id);
      setToast({ text: `${row.name}: ${DONE[action]}`, undo: out.undo ? async () => { await undo(); await load(); } : null });
      await load();
    } catch (e) { await load(); throw e; }
  };
  const renew = row => act(row, 'renew').catch(e => setToast({ text: e.message }));

  const colorOf = id => { const i = members.findIndex(m => m.user_id === id); return i < 0 ? null : members[i].color || memberColor(i); };
  const owners = ownerChips(members.map((m, i) => ({ ...m, color: m.color || memberColor(i) })), meId, data);
  const narrowed = filters.band || filters.pinned || filters.size || filters.q;
  const clear = () => { setSearch(''); set({ band: '', pinned: false, size: '', q: '' }); };

  const chips = (
    <>
      {owners.map(o => (
        <button key={o.id} type="button" className="tt-chip" data-owner-chip={o.id} aria-pressed={filters.owner === o.id} onClick={() => set({ owner: o.id })}>
          {o.color && <i style={{ background: o.color }} />}{o.label} <b className="tt-num">{o.count}</b>
        </button>
      ))}
      {!phone && <span className="tt-sep" />}
      <button type="button" className="tt-chip" data-pinned-chip aria-pressed={filters.pinned} onClick={() => set({ pinned: !filters.pinned })}><Star state="pinned" size={12} />Pinned <b className="tt-num">{data?.pinned ?? 0}</b></button>
      {!phone && <span className="tt-sep" />}
      {BANDS.map(b => (
        <button key={b} type="button" className="tt-chip" data-band-chip={b} aria-pressed={filters.band === b} style={{ color: priorityColor(b) }} onClick={() => set({ band: filters.band === b ? '' : b })}>{b} <b className="tt-num">{data?.counts?.bands?.[b] ?? 0}</b></button>
      ))}
      {!phone && <span className="tt-sep" />}
      <FilterSelect variant="pill" label="Size" value={filters.size} options={SIZE_OPTIONS} onChange={v => set({ size: v })} />
    </>
  );
  const searchBox = (
    <label className="tt-search" style={phone ? { width: '100%', height: 44 } : undefined}>
      <IconSearch size={13} />
      <input type="search" aria-label="Search companies" placeholder="Search companies" value={search} onChange={e => setSearch(e.target.value)} autoFocus={phone} />
    </label>
  );
  const count = data && (
    <span data-count-line>Showing <b className="tt-num">{data.total}</b> of {data.scope} · <b className="tt-num">{data.pinned}</b> pinned{!phone && ' · pinned first, newest pin on top, then by score'}</span>
  );
  const rows = data?.rows || [];

  const company = (r, big) => (
    <div className="tt-co">
      <button type="button" className="tt-name" data-row-name style={big ? { fontSize: 15, whiteSpace: 'normal' } : undefined} onClick={() => openCompany(r)}>{r.name}</button>
      <span>{r.stage_label}{r.owner_user_id ? <><i style={{ background: colorOf(r.owner_user_id) || 'var(--sa-muted)' }} />{String(r.owner || '').trim().split(/\s+/)[0]}</> : <> · Unassigned</>}</span>
    </div>
  );
  const scoreCell = (r, wrap) => {
    const line = pinLine(r);
    return (
      <>
        <span className="tt-band" style={{ color: priorityColor(r.band), borderColor: priorityColor(r.band) }}>{r.band}<small className="tt-num">{r.score}</small></span>
        {line && (
          <div className="tt-pinl" data-pin-line={line.live ? 'live' : 'expired'} style={wrap ? { margin: 0, whiteSpace: 'normal' } : undefined} title={line.live ? `${line.lead} · ${line.rest}` : undefined}>
            {line.live ? <><b>{line.lead}</b>{line.rest && ` · ${line.rest}`}</> : <>{line.lead}{canEdit && <> · <button type="button" className="tt-link" onClick={() => renew(r)}>Renew</button></>}</>}
          </div>
        )}
      </>
    );
  };
  const nextCell = r => (r.next
    ? <div className="tt-nx"><TodoBox /><div>{r.next.text}{r.next.due && <span className="tt-num"> · {shortDate(r.next.due)}</span>}</div></div>
    : <span style={{ color: 'var(--sa-muted)' }}>—</span>);
  const star = r => <PinControl row={r} canEdit={canEdit} phone={phone} onAct={(action, reason) => act(r, action, reason)} />;
  const empty = data && !rows.length && (
    <div data-empty style={{ padding: 20, fontSize: 13, color: 'var(--sa-muted)' }}>No companies match.{narrowed && <> <button type="button" className="tt-link" onClick={clear}>Clear filters</button></>}</div>
  );

  return (
    <section aria-label="Top targets" data-top-targets={phone ? 'cards' : 'table'} className="tt" style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 1100 }}>
      <style>{TT_CSS}</style>
      {phone && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-.02em', color: 'var(--sa-text)' }}>Top targets</h2>
          <button type="button" className="tt-star tt-star--btn" style={{ width: 44, height: 44, color: 'var(--sa-muted)' }} aria-label="Search" aria-expanded={searchOpen} onClick={() => setSearchOpen(o => !o)}><IconSearch size={18} /></button>
        </div>
      )}
      {phone && searchOpen && searchBox}
      <div data-chips style={phone ? { display: 'flex', gap: 6, overflowX: 'auto', marginRight: -16, paddingRight: 16 } : { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {chips}{!phone && <span style={{ marginLeft: 'auto' }}>{searchBox}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 12.5, color: 'var(--sa-muted)' }}>
        {count || <span>Loading…</span>}
        {!phone && <span aria-hidden="true">{GROUP_ORDER.map(k => <span key={k} className="tt-legend"><i style={{ background: GROUP_COLOR[k] }} />{GROUP_LABEL[k]}</span>)}</span>}
      </div>
      {error && <div role="alert" style={{ color: 'var(--sa-bad)', fontSize: 13 }}>⚠ {error}</div>}
      {!phone && (
        <div className="tt-card">
          <table>
            <colgroup><col style={{ width: 186 }} /><col style={{ width: 206 }} /><col style={{ width: 184 }} /><col style={{ width: 262 }} /><col style={{ width: 202 }} /><col style={{ width: 60 }} /></colgroup>
            <thead><tr>
              <th scope="col"><span className="tt-lbl">Company</span></th>
              <th scope="col" aria-sort="descending"><span className="tt-lbl" style={{ color: 'var(--sa-text)' }}>Score ▼</span></th>
              <th scope="col"><span className="tt-lbl" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} title="Hover a bar for each part's inputs">Breakdown <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="var(--sa-accent)" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6" /><path d="M8 7.5v4M8 5.2h.01" /></svg></span></th>
              <th scope="col"><span className="tt-lbl">Why</span></th>
              <th scope="col"><span className="tt-lbl">Next</span></th>
              <th scope="col" style={{ textAlign: 'center' }}><span className="tt-lbl">Pin</span></th>
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.key} data-row={r.key}>
                  <td>{company(r)}</td>
                  <td>{scoreCell(r)}</td>
                  <td style={{ overflow: 'visible' }}><ScoreBar row={r} /></td>
                  <td><div className="tt-why" title={r.why.short}>{r.why.short}</div></td>
                  <td>{nextCell(r)}</td>
                  <td style={{ overflow: 'visible', textAlign: 'center' }}>{star(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {empty}
        </div>
      )}
      {phone && rows.map(r => (
        <article key={r.key} data-row={r.key} className="tt-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>{company(r, true)}<span style={{ margin: '-10px -10px -10px 0' }}>{star(r)}</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>{scoreCell(r, true)}</div>
          <ScoreBar row={r} wide />
          <div style={{ fontSize: 13, lineHeight: 1.4, color: 'var(--sa-soft)' }}>{r.why.short}</div>
          {r.next && nextCell(r)}
        </article>
      ))}
      {phone && empty}
      {toast && createPortal(
        <div role="status" className={`${SA_THEME_CLASS} no-print`} style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 4005, padding: '10px 16px', borderRadius: 10, background: 'var(--sa-surface-2)', border: '1px solid var(--sa-border)', color: 'var(--sa-text)', fontSize: 14, display: 'flex', gap: 14, alignItems: 'center', maxWidth: 'calc(100vw - 32px)' }}>
          {toast.text}
          {toast.undo && <button type="button" className="tt-link" style={{ fontWeight: 600 }} onClick={async () => { const u = toast.undo; setToast(null); try { await u(); } catch (e) { setToast({ text: e.message }); } }}>Undo</button>}
        </div>, document.body)}
    </section>
  );
}
