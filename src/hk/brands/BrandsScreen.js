import React, { useEffect, useMemo, useState } from 'react';
import DataTable from '../../ui/DataTable';
import { Icon, Sprout } from '../HkMarks';
import AddBrandModal from './AddBrandModal';
import BrandPicker from '../screens/BrandPicker';
import { STATUS_LABELS, STATUS_TONE } from './verdict';
import { hkPatch, hkPost } from '../hkApi';
import { HeatChip, heatBarStyle } from '../signals/Heat';
import OwnerChip from './OwnerChip';
import BrandLabels from './BrandLabels';
import { useSheetConfirm, bulkAsking } from './sheetConfirm';
import { useBrandCommands, PrimaryAction, QuickIcons } from './QuickCommands';
import { marketOf, contactOf, batchCommand } from './labelRules';

// hkos-data-foundation-v1 D6 + grow-nav-filters-v1 N3/N11 + grow-ui-refresh-v1 U6 - the Brands list to mockup 3: the kit
// DataTable on the hk tokens, fed by the Brands space (one paged, server-sorted read: useBrandList). Columns Brand (tile,
// name, domain) · Target · Industry (Category until research has one, J6) · Market · Heat · Stage · Owner · Contact ·
// Last touch · Score. Hovering or focusing a row shows its primary + quick commands in the actions cell; otherwise only
// the chevron. Selected rows are tinted; the forest bulk bar: Pitch n ready · Research n ~$ · Claim · + Target ·
// + Pipeline · Set status · Copy batch command · More (Release, Mark do-not-contact with a reason). Columns / Export CSV arrive with the brands sheet.
//   layout 'stage': grouped by status, groups in the server's status order (facets.stage), each with its count.
const MANUAL = [['meeting', 'Meeting'], ['signed', 'Signed'], ['passed', 'Passed'], ['skipped', 'Skipped']];
const fmt = iso => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
export const Chip = ({ tone, children }) => <span className={`hk-chip hk-chip--${tone || 'grey'}`}>{children}</span>;
const plural = (n, w) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`;
const money = n => `$${Number(n || 0).toFixed(2)}`;
const SELECTED_TINT = { '--ui-row-tint': '#E7F1E2' };

export default function BrandsScreen({ businessId, shell, compact, onOpenBrand, onGo, canEdit, list, sort, onSort, layout = 'table', emptyLine, intent = null, onIntentDone }) {
  const [selected, setSelected] = useState(() => new Set());
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [statusOpen, setStatusOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [dncReason, setDncReason] = useState(null);
  const [researchAsk, setResearchAsk] = useState(false);
  const [contactPick, setContactPick] = useState(false);
  const members = shell?.members || [];
  // hkos-sheet-import-v1 - "+ New": Add brand opens the modal; Add contact asks which brand, then opens its page.
  useEffect(() => {
    if (!intent || !canEdit) return;
    if (intent.kind === 'add_brand') setAdding(true);
    if (intent.kind === 'add_contact') setContactPick(true);
    if (intent.kind === 'add_brand' || intent.kind === 'add_contact') onIntentDone?.();
  }, [intent, canEdit, onIntentDone]);
  const member = id => members.find(m => m.user_id === id);
  const firstName = id => member(id)?.first_name || null;
  const meId = shell?.me?.user_id;
  const rows = list.rows;
  const rowsKey = rows ? rows.map(r => r.id).join() : '';
  useEffect(() => { setSelected(s => (s.size ? new Set([...s].filter(id => rowsKey.includes(id))) : s)); }, [rowsKey]);
  const cmd = useBrandCommands({ businessId, onChanged: list.reload, setError: setNote });

  const toggle = id => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const sheet = useSheetConfirm();
  const picked = (rows || []).filter(r => selected.has(r.id));
  const ready = picked.filter(r => r.primary?.kind === 'pitch');
  const toResearch = picked.filter(r => r.primary?.kind === 'research').slice(0, 10);
  const done = async refused => { setSelected(new Set()); await list.reload(); setBusy(''); if (refused?.length) setError(`Not done: ${refused.join('; ')}`); };
  // Claim / + Pipeline / Pitch ask once about brands the sheet lists as someone else's (grow-sheet-owner-respect F3).
  const bulkClaim = async () => { setBusy('claim'); setError(''); await done(await bulkAsking(sheet.confirm, [...selected], (id, x) => hkPatch(businessId, `/brands/${id}`, { claim: true, ...x }))); };
  // More ▾: Release, and Mark do-not-contact with a reason (one PATCH per brand; a refused brand is named, the rest go).
  const bulkPatch = async (label, body) => {
    setMoreOpen(false); setDncReason(null); setBusy(label); setError('');
    const refused = []; for (const id of selected) { try { await hkPatch(businessId, `/brands/${id}`, body); } catch (e) { refused.push(e.message); } }
    await done(refused);
  };
  const bulkStatus = async status => {
    setStatusOpen(false); setBusy('status'); setError('');
    const refused = []; for (const id of selected) { try { await hkPatch(businessId, `/brands/${id}`, { status }); } catch (e) { refused.push(e.message); } }
    await done(refused);
  };
  // grow-signals G7 bulk: + Target / + Pipeline one brand at a time; a refused brand is named, the rest still go.
  const bulkList = async (label, path, body) => {
    setBusy(label); setError('');
    const refused = [];
    if (path === 'pipeline') refused.push(...await bulkAsking(sheet.confirm, [...selected], (id, x) => hkPost(businessId, `/brands/${id}/pipeline`, { ...body, ...x })));
    else for (const id of selected) { try { await hkPost(businessId, `/brands/${id}/${path}`, body); } catch (e) { refused.push(e.message); } }
    await done(refused);
  };
  // Pitch n ready: each ready brand claimed through Pitch (sheet question asked once), then ONE "hk pitch a, b" copied.
  const bulkPitch = async () => {
    setBusy('pitch'); setError(''); setNote('');
    const claimed = [];
    const refused = await bulkAsking(sheet.confirm, ready.map(r => r.id), async (id, x) => { await hkPost(businessId, `/brands/${id}/pitch`, x); claimed.push(ready.find(r => r.id === id)); });
    if (claimed.length) { const text = batchCommand(claimed); try { await navigator.clipboard.writeText(text); setNote(`Pitched ${plural(claimed.length, 'brand')}. Copied ${text}. Paste into Claude.`); } catch { setNote(`Copy failed. The command is: ${text}`); } }
    await done(refused);
  };
  // Research n: the estimate first (J8, from the list read), then one brand per request; stops at the first stop.
  const bulkResearch = async () => {
    setResearchAsk(false); setBusy('research'); setError('');
    const results = []; let stopped = null;
    for (const r of toResearch) {
      try { const out = await hkPost(businessId, '/research/batch', { brand_ids: [r.id], confirm: true }); results.push(...out.results); if (out.stopped) { stopped = out.stopped; break; } } catch (e) { stopped = e.message; break; }
    }
    setNote(`Researched ${plural(results.filter(x => x.status === 'researched').length, 'brand')} (${money(results.reduce((n, x) => n + (x.cost_usd || 0), 0))})${stopped ? `. Stopped: ${stopped}` : ''}.`);
    await done();
  };
  const copyBatch = async () => { const text = batchCommand(ready); try { await navigator.clipboard.writeText(text); setNote(`Copied ${text}. Paste into Claude.`); } catch { setNote(`Copy failed. The command is: ${text}`); } };
  const perCall = list.estimate?.per_call ?? null;
  const researchLabel = `Research ${toResearch.length}${perCall != null && toResearch.length ? ` · ~${money(perCall * toResearch.length)}` : ''}`;

  // sortValue marks the columns the server can sort (brandFilters SORTS); serverSort keeps the rows as they arrive.
  const columns = useMemo(() => [
    ...(canEdit ? [{ id: 'pick', label: 'Select', width: 40, render: r => <input type="checkbox" className="hk-srow__check" aria-label={`Select ${r.name}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} /> }] : []),
    { id: 'name', label: 'Brand', sticky: true, minWidth: 200, sortValue: r => r.name, render: r => (
      <button type="button" className="hk-btn hk-table__name hk-brandcell" onClick={() => onOpenBrand(r.id)} data-hk-brand={r.id}>
        <span className="hk-tile-sm" aria-hidden="true">{r.name.trim()[0].toUpperCase()}</span>
        <span className="hk-brandcell__text"><span className="hk-table__title">{r.name}</span><span className="hk-meta">{r.domain || '—'}</span></span>
      </button>) },
    { id: 'target', label: 'Target', headerGlyph: 'Target', width: 66, render: r => (r.targeted_at ? <span className="hk-target-yes" title="Target"><Icon name="target" size={17} label="Target" /></span> : <span className="hk-meta" title="Not a target">—<span className="ui-sr-only">Not a target</span></span>) },
    { id: 'industry', label: 'Industry', headerGlyph: 'Industry', width: 132, render: r => (r.research?.industry ? r.research.industry : r.category ? <span title="Category - research has no industry yet">{r.category}</span> : <span className="hk-meta">—</span>) },
    { id: 'market', label: 'Market', headerGlyph: 'Market', width: 84, render: r => marketOf(r) },
    { id: 'heat', label: 'Heat', width: 78, sortValue: r => r.heat || 0, render: r => <HeatChip band={r.heat_band || 'cold'} showCold /> },
    { id: 'stage', label: 'Stage', width: 106, sortValue: r => r.status, render: r => <Chip tone={STATUS_TONE[r.status]}>{STATUS_LABELS[r.status] || r.status}</Chip> },
    { id: 'owner', label: 'Owner', headerGlyph: 'Owner', width: 112, render: r => <OwnerChip owner={member(r.owner_user_id)} hint={r.owner_hint} size={22} /> },
    { id: 'contact', label: 'Contact', headerGlyph: 'Contact', width: 116, render: r => { const c = contactOf(r); return c.ok ? c.words : <span className="hk-label hk-label--block">No email</span>; } },
    { id: 'last_touch', label: 'Last touch', width: 94, sortValue: r => r.last_touch_at || '', render: r => fmt(r.last_touch_at) || <span className="hk-meta">Never</span> },
    { id: 'score', label: 'Score', width: 64, sortValue: r => r.score ?? -1, render: r => (r.score == null ? <span className="hk-meta" title="Not one you can pitch now">—</span> : <span className="hk-score">{r.score}</span>) },
    { id: 'actions', label: 'Actions', stickyEnd: true, width: 56, render: r => (
      <span className="hk-rowacts">
        {canEdit && <span className="hk-rowacts__full"><PrimaryAction brand={r} onAct={cmd.act} onGo={onGo || (() => {})} onOpenBrand={onOpenBrand} busy={cmd.busy} /><QuickIcons brand={r} meId={meId} firstName={firstName} onAct={cmd.act} busy={cmd.busy} /></span>}
        <button type="button" className="hk-btn hk-qc hk-rowacts__chev" aria-label={`Open ${r.name}`} onClick={() => onOpenBrand(r.id)} data-hk-open-row={r.id}><Icon name="chevron" size={17} /></button>
      </span>) },
  ], [canEdit, selected, members, onOpenBrand, businessId, meId, cmd.act, cmd.busy]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    if (!rows) return [];
    if (layout !== 'stage') return [{ id: 'all', header: plural(list.total, 'brand'), rows }];
    const order = (list.facets?.stage || []).map(([v, n]) => [v, n]);
    for (const r of rows) if (!order.some(([v]) => v === r.status)) order.push([r.status, null]);
    return order.map(([v, n]) => ({ id: v, header: <>{STATUS_LABELS[v] || v} <span className="ui-table__count">{n ?? rows.filter(r => r.status === v).length}</span></>, rows: rows.filter(r => r.status === v) })).filter(g => g.rows.length);
  }, [rows, layout, list.total, list.facets]);

  return (
    <div className="hk-brands" data-hk-brands="brands">
      {canEdit && selected.size > 0 && (
        <div className="hk-fbulk" role="toolbar" aria-label="Bulk actions" data-hk-bulk>
          <span className="hk-fbulk__n">{selected.size} selected</span>
          <span className="hk-spacer" />
          <button type="button" className="hk-btn hk-fbulk__btn hk-fbulk__btn--amber" disabled={!!busy || !ready.length} onClick={bulkPitch} data-hk-bulk-pitch><Icon name="bolt" size={15} /> Pitch {ready.length} ready</button>
          <button type="button" className="hk-btn hk-fbulk__btn" disabled={!!busy || !toResearch.length} onClick={() => setResearchAsk(true)} data-hk-bulk-research>{researchLabel}</button>
          <button type="button" className="hk-btn hk-fbulk__btn" disabled={!!busy} onClick={bulkClaim} data-hk-bulk-claim>Claim</button>
          <button type="button" className="hk-btn hk-fbulk__btn" disabled={!!busy} onClick={() => bulkList('target', 'target', { on: true })} data-hk-bulk-target>+ Target</button>
          <button type="button" className="hk-btn hk-fbulk__btn" disabled={!!busy} onClick={() => bulkList('pipeline', 'pipeline', {})} data-hk-bulk-pipeline>+ Pipeline</button>
          <span className="hk-anchor">
            <button type="button" className="hk-btn hk-fbulk__btn" aria-haspopup="menu" aria-expanded={statusOpen} disabled={!!busy} onClick={() => setStatusOpen(o => !o)} data-hk-bulk-status>Set status ▾</button>
            {statusOpen && <span className="hk-menu hk-menu--right" role="menu" onMouseLeave={() => setStatusOpen(false)}>{MANUAL.map(([v, l]) => <button key={v} type="button" role="menuitem" className="hk-btn hk-menu__item" onClick={() => bulkStatus(v)}>{l}</button>)}</span>}
          </span>
          <button type="button" className="hk-btn hk-fbulk__btn" disabled={!!busy || !ready.length} onClick={copyBatch} data-hk-bulk-copy>Copy batch command</button>
          <span className="hk-anchor">
            <button type="button" className="hk-btn hk-fbulk__btn" aria-haspopup="menu" aria-expanded={moreOpen} disabled={!!busy} onClick={() => setMoreOpen(o => !o)} data-hk-bulk-more>More ▾</button>
            {moreOpen && (
              <span className="hk-menu hk-menu--right" role="menu" onMouseLeave={() => setMoreOpen(false)}>
                <button type="button" role="menuitem" className="hk-btn hk-menu__item" onClick={() => bulkPatch('release', { claim: false })}>Release</button>
                <button type="button" role="menuitem" className="hk-btn hk-menu__item" onClick={() => { setMoreOpen(false); setDncReason(''); }}>Mark do-not-contact…</button>
              </span>
            )}
          </span>
        </div>
      )}
      {canEdit && selected.size > 0 && dncReason !== null && (
        <form className="hk-bulk" aria-label="Mark do-not-contact" onSubmit={e => { e.preventDefault(); if (dncReason.trim()) bulkPatch('dnc', { relationship: 'do_not_contact', dnc_reason: dncReason.trim() }); }} data-hk-bulk-dnc>
          <label className="hk-logact__field hk-logact__note">Why should {plural(selected.size, 'brand')} never be contacted? <input className="ui-input" value={dncReason} maxLength={200} autoFocus onChange={e => setDncReason(e.target.value)} /></label>
          <button type="submit" className="hk-btn hk-primary" disabled={!!busy || !dncReason.trim()}>Mark do-not-contact</button>
          <button type="button" className="hk-btn hk-link" onClick={() => setDncReason(null)}>Cancel</button>
        </form>
      )}
      {researchAsk && (
        <div className="hk-bulk" role="alertdialog" aria-label="Research these brands?" data-hk-bulk-research-confirm>
          <span>Research {plural(toResearch.length, 'brand')} · {perCall != null ? `about ${money(perCall * toResearch.length)}` : 'no estimate yet'}. One research each; it stops at the daily cap.</span>
          <button type="button" className="hk-btn hk-primary" onClick={bulkResearch}>Research {toResearch.length}</button>
          <button type="button" className="hk-btn hk-link" onClick={() => setResearchAsk(false)}>Cancel</button>
        </div>
      )}
      {sheet.node}
      {note && <p className="hk-note" role="status" data-hk-brands-note>{note}</p>}
      {(error || list.error) && <p className="hk-error" role="alert">{error || list.error}</p>}
      {rows === null ? <p className="hk-meta">Loading brands…</p> : rows.length === 0 ? (
        <div className="hk-empty" data-hk-empty>
          <Sprout size={40} />
          <p className="hk-empty__title">No brand matches these filters.</p>
          <p className="hk-empty__line">{emptyLine || 'Remove a filter, or pick another view.'}</p>
        </div>
      ) : (
        <div className={list.loading ? 'hk-list--stale' : undefined} aria-busy={list.loading || undefined} data-hk-brand-list>
          <h2 className="ui-sr-only">Brand list</h2>
          <DataTable label="Brands" columns={columns} rowKey={r => r.id} compact={compact} rowStyle={r => ({ ...heatBarStyle(r.heat_band), ...(selected.has(r.id) ? SELECTED_TINT : {}) })} groups={groups}
            serverSort sort={sort} onSort={onSort} onReachEnd={list.next ? list.loadMore : null}
            renderCompact={r => (<>
              <button type="button" className="hk-btn hk-card-row" onClick={() => onOpenBrand(r.id)} data-hk-brand={r.id}>
                <span className="hk-table__title">{r.name}</span>
                <span className="hk-card-row__chips"><BrandLabels brand={r} owner={member(r.owner_user_id)} withOwner /><Chip tone={STATUS_TONE[r.status]}>{STATUS_LABELS[r.status]}</Chip></span>
              </button>
              {canEdit && <span className="hk-rowacts__full hk-rowacts__full--card"><PrimaryAction brand={r} onAct={cmd.act} onGo={onGo || (() => {})} onOpenBrand={onOpenBrand} busy={cmd.busy} /><QuickIcons brand={r} meId={meId} firstName={firstName} onAct={cmd.act} busy={cmd.busy} /></span>}
            </>)} />
          {list.next && <p className="hk-meta" data-hk-more-rows>Showing {rows.length.toLocaleString('en-US')} of {list.total.toLocaleString('en-US')}. More load as you scroll.</p>}
        </div>
      )}
      {cmd.node}
      {contactPick && <BrandPicker businessId={businessId} title="Which brand gets the contact?" line="Pick the brand, then add the contact on its Contacts tab." confirmLabel="Open brand" any onClose={() => setContactPick(false)} onPick={b => { setContactPick(false); onOpenBrand(b.id); }} />}
      {adding && <AddBrandModal businessId={businessId} members={members} onClose={() => setAdding(false)} onOpenMatch={id => { setAdding(false); onOpenBrand(id); }} onSaved={b => { setAdding(false); onOpenBrand(b.id); }} />}
    </div>
  );
}
