import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DataTable from '../../ui/DataTable';
import Tabs from '../../ui/Tabs';
import Button from '../../ui/Button';
import { Sprout } from '../HkMarks';
import { Chip } from '../brands/BrandsScreen';
import { STATUS_LABELS, STATUS_TONE } from '../brands/verdict';
import { hkGet, hkPost } from '../hkApi';

// hkos-sheet-import-v1 S5 - Review > Imports: the runs table (with Undo), [New import] -> the file read as base64 in the
// browser -> the server's preview (per-tab cards + the row table with filters) -> [Commit import] / [Cancel]. Contact
// presence only ("2 contacts, has email"), never an address; the browser never sees the plan's contacts.
export const RESULT_LABELS = { new: 'New', matches: 'Matches existing', possible_duplicate: 'Possible duplicate', warning: 'Warning' };
export const RESULT_TONE = { new: 'green', matches: 'blue', possible_duplicate: 'mustard', warning: 'orange' };
export const KIND_LABELS = { pete_outreach: "Pete's outreach", jack_outreach: "Jack's outreach", launch: 'Launch sponsors', monthly: 'Monthly sponsors', nonprofit: 'Non-profits', press: 'Press', podcast: 'Podcasts', sheet8: 'Sheet8 list', skipped: 'Skipped' };
export const WARNING_LABELS = { draft_not_linked: 'Draft not linked to Gmail', unmapped_status: 'Unmapped status', future_date: 'Future date', missing_date: 'No date', extra_dates: 'More than 3 dates', two_founders: 'Two founders', bad_website: 'Website unreadable', duplicate_domain: 'Domain already planned', owner_missing: "Pete's touches wait for his sign-in", legacy_founding_partner_missing: 'Legacy founding partner missing' };
export const RUN_STATUS = { preview: ['Preview', 'grey'], committed: ['Committed', 'green'], undone: ['Undone', 'grey'], failed: ['Failed', 'block'] };
const FILTERS = [['all', 'All'], ['new', 'New'], ['matches', 'Matches'], ['possible_duplicate', 'Possible duplicate'], ['warning', 'Warning']];
const fmt = iso => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : w.endsWith('ch') ? 'es' : 's'}`;

export const contactLine = b => (!b.contact_count ? 'No contact' : `${plural(b.contact_count, 'contact')}${b.has_email ? ', has email' : ', no email'}`);
export const tabLine = t => (t.kind === 'skipped' ? `${t.rows_read} rows skipped: ${t.reason}` : `${plural(t.rows, 'row')} · ${t.create} to create · ${t.match} match · ${plural(t.warnings, 'warning')}${t.skipped_rows ? ` · ${t.skipped_rows} without a name` : ''}`);
export const filterRows = (brands, f) => (f === 'all' ? brands : f === 'warning' ? brands.filter(b => b.warnings.length) : brands.filter(b => b.result === f));
export const warningText = w => `${WARNING_LABELS[w.code] || w.code}${w.detail ? `: ${String(w.detail).slice(0, 80)}` : ''}`;
const readAsBase64 = file => new Promise((resolve, reject) => { const r = new FileReader(); r.onerror = () => reject(new Error('could not read the file')); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.readAsDataURL(file); });

export default function ImportsPanel({ businessId, shell, canEdit, compact, autoOpen, onAutoOpened, onCount, onOpenBrands, onOpenWarnings }) {
  const [runs, setRuns] = useState(null);
  const [preview, setPreview] = useState(null);
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const [undoing, setUndoing] = useState(null);
  const fileRef = useRef(null);
  const members = shell?.members || [];
  const isOwnerRole = shell?.me?.role === 'owner';
  const member = id => members.find(m => m.user_id === id);
  const load = useCallback(async () => {
    try { const { runs: r } = await hkGet(businessId, '/imports'); setRuns(r); onCount?.(r.length); }
    catch (e) { setError(e.message); setRuns([]); }
  }, [businessId, onCount]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (autoOpen && canEdit) { fileRef.current?.click(); onAutoOpened?.(); } }, [autoOpen, canEdit, onAutoOpened]);

  const pick = async e => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setError(''); setToast(null); setBusy('preview');
    try { const data = await readAsBase64(file); setPreview(await hkPost(businessId, '/imports/preview', { name: file.name, data })); setFilter('all'); await load(); }
    catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };
  const commit = async () => {
    setError(''); setBusy('commit');
    try {
      const { counts } = await hkPost(businessId, `/imports/${preview.run.id}/commit`, {});
      setPreview(null);
      setToast({ kind: 'committed', text: `Imported ${plural(counts.brands, 'brand')}, ${plural(counts.contacts, 'contact')}, ${plural(counts.touches, 'touch')} and ${plural(counts.periods, 'sponsor period')}.${counts.matched ? ` ${counts.matched} matched existing brands and were left as they are.` : ''}${counts.touches_deferred ? ` ${plural(counts.touches_deferred, 'touch')} wait for Pete's first sign-in.` : ''}` });
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };
  const undo = async id => {
    setError(''); setBusy('undo');
    try { const { deleted } = await hkPost(businessId, `/imports/${id}/undo`, {}); setUndoing(null); setToast({ kind: 'undone', text: `Undone: ${plural(deleted.brands, 'brand')}, ${plural(deleted.contacts, 'contact')}, ${plural(deleted.touches, 'touch')} and ${plural(deleted.periods, 'period')} removed.` }); await load(); }
    catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  const rows = useMemo(() => (preview ? filterRows(preview.preview.brands, filter) : []), [preview, filter]);
  const counts = useMemo(() => (preview ? Object.fromEntries(FILTERS.map(([id]) => [id, filterRows(preview.preview.brands, id).length])) : {}), [preview]);
  const columns = useMemo(() => [
    { id: 'name', label: 'Name', sticky: true, minWidth: 200, sortValue: r => r.name, render: r => <span className="hk-table__name"><span className="hk-table__title">{r.name}</span>{r.domain && <span className="hk-meta">{r.domain}</span>}</span> },
    { id: 'result', label: 'Result', width: 150, sortValue: r => r.result, render: r => <Chip tone={RESULT_TONE[r.result]}>{RESULT_LABELS[r.result]}</Chip> },
    { id: 'status', label: 'Status', width: 110, sortValue: r => r.status, render: r => <Chip tone={STATUS_TONE[r.status]}>{STATUS_LABELS[r.status] || r.status}</Chip> },
    { id: 'tabs', label: 'Tabs', minWidth: 160, sortValue: r => r.tabs.join(', '), render: r => <span className="hk-meta">{r.tabs.join(', ')}</span> },
    { id: 'owner', label: 'Owner', width: 80, sortValue: r => r.owner_hint || '', render: r => (r.owner_hint ? r.owner_hint[0].toUpperCase() + r.owner_hint.slice(1) : <span className="hk-meta">·</span>) },
    { id: 'contacts', label: 'Contacts', width: 150, sortValue: r => r.contact_count, render: r => <span className="hk-meta">{contactLine(r)}</span> },
    { id: 'touches', label: 'Touches', width: 80, sortValue: r => r.touches, render: r => r.touches || <span className="hk-meta">·</span> },
    { id: 'periods', label: 'Periods', width: 120, sortValue: r => r.periods.length, render: r => (r.periods.length ? r.periods.join(', ') : <span className="hk-meta">·</span>) },
    { id: 'warnings', label: 'Warnings', minWidth: 220, sortValue: r => r.warnings.length, render: r => (r.warnings.length ? <span className="hk-meta">{r.warnings.map(warningText).join(' · ')}</span> : r.duplicate_of.length ? <span className="hk-meta">Looks like {r.duplicate_of.join(', ')}</span> : r.existing ? <span className="hk-meta">Already in Brands as {r.existing.name}</span> : <span className="hk-meta">·</span>) },
  ], []);

  return (
    <div data-hk-imports>
      <div className="hk-toolbar">
        <span className="hk-meta">Imports from the Sheet: preview first, then commit. An import can be undone until one of its brands changes.</span>
        <span className="hk-spacer" />
        {canEdit && <><input ref={fileRef} type="file" accept=".xlsx,.csv" aria-label="Import file" style={{ display: 'none' }} onChange={pick} data-hk-import-file /><Button variant="primary" disabled={!!busy} onClick={() => fileRef.current?.click()} data-hk-new-import>{busy === 'preview' ? 'Reading…' : 'New import'}</Button></>}
      </div>
      {error && <p className="hk-error" role="alert">{error}</p>}
      {toast && (
        <p className="hk-note" role="status" data-hk-import-toast>
          {toast.text}
          {toast.kind === 'committed' && <> <button type="button" className="hk-btn hk-link" onClick={onOpenBrands}>Open Brands</button> · <button type="button" className="hk-btn hk-link" onClick={onOpenWarnings}>Data warnings</button></>}
        </p>
      )}
      {preview && (
        <section className="hk-section" aria-label="Import preview" data-hk-import-preview>
          <div className="hk-section__head">
            <h2 className="hk-section-title">Preview: {preview.run.source}</h2>
            <span style={{ display: 'inline-flex', gap: 8 }}>
              <Button variant="primary" disabled={!!busy || !isOwnerRole} disabledReason={isOwnerRole ? undefined : 'Only an owner-role member can commit an import'} onClick={commit} data-hk-commit-import>{busy === 'commit' ? 'Importing…' : 'Commit import'}</Button>
              <Button variant="tertiary" disabled={!!busy} onClick={() => setPreview(null)}>Cancel</Button>
            </span>
          </div>
          <p className="hk-meta" data-hk-import-totals>{plural(preview.preview.totals.rows, 'row')} read as {plural(preview.preview.totals.brands, 'brand')}: {preview.preview.totals.create} to create, {preview.preview.totals.match} matching existing brands, {plural(preview.preview.totals.possible_duplicates, 'possible duplicate')}, {plural(preview.preview.totals.warnings, 'warning')}. {preview.preview.totals.contacts_with_email} contacts carry an email (shown on each brand page only).</p>
          <div className="hk-import-cards">
            {preview.preview.tabs.map(t => (
              <div key={t.name} className={`hk-import-card${t.kind === 'skipped' ? ' hk-import-card--skipped' : ''}`} data-hk-import-tab={t.kind}>
                <div className="hk-table__title">{t.name}</div>
                <div className="hk-meta">{KIND_LABELS[t.kind] || t.kind}{t.period ? ` · ${t.period}` : ''}</div>
                <div className="hk-import-card__line">{tabLine(t)}</div>
              </div>
            ))}
          </div>
          {preview.preview.warnings.length > 0 && <ul className="hk-import-warnings" data-hk-import-warnings>{preview.preview.warnings.map((w, i) => <li key={i} className="hk-meta">{warningText(w)}</li>)}</ul>}
          <Tabs label="Preview filters" items={FILTERS.map(([id, label]) => ({ id, label: `${label} (${counts[id] || 0})` }))} value={filter} onChange={setFilter} />
          {!rows.length ? <p className="hk-meta" style={{ marginTop: 12 }}>Nothing in this filter.</p> : (
            <DataTable label="Import rows" columns={columns} rowKey={r => r.key} compact={compact} groups={[{ id: 'rows', header: plural(rows.length, 'brand'), rows }]}
              renderCompact={r => (
                <div className="hk-card-row" data-hk-import-row={r.key}>
                  <span className="hk-table__title">{r.name}</span>
                  <span className="hk-card-row__chips"><Chip tone={RESULT_TONE[r.result]}>{RESULT_LABELS[r.result]}</Chip><Chip tone={STATUS_TONE[r.status]}>{STATUS_LABELS[r.status] || r.status}</Chip></span>
                  <span className="hk-meta">{contactLine(r)}{r.warnings.length ? ` · ${r.warnings.map(w => WARNING_LABELS[w.code] || w.code).join(', ')}` : ''}</span>
                </div>)} />
          )}
        </section>
      )}
      <section className="hk-section" aria-label="Import history">
        <h2 className="hk-section-title">History</h2>
        {runs === null ? <p className="hk-meta">Checking…</p> : !runs.length ? (
          <div className="hk-empty" data-hk-empty><Sprout size={40} /><p className="hk-empty__title">No imports yet.</p><p className="hk-empty__line">New import takes the tracker (.xlsx) or one tab as .csv, shows a preview, and writes only when you commit.</p></div>
        ) : (
          <div className="hk-rows">
            {runs.map(r => { const by = member(r.started_by), [label, tone] = RUN_STATUS[r.status] || [r.status, 'grey']; return (
              <div key={r.id} className="hk-row hk-row--wrap" data-hk-import-run={r.status}>
                <span className="hk-meta">{fmt(r.finished_at || r.created_at)}</span>
                <span className="hk-table__title">{r.source}</span>
                <Chip tone={tone}>{label}</Chip>
                <span className="hk-meta">{plural(r.rows_read, 'row')} read · {r.created_count} created · {r.matched_count} matched · {r.flagged_count} flagged</span>
                {by && <span className="hk-meta">by {by.first_name}</span>}
                {r.status === 'failed' && r.summary?.reason && <span className="hk-meta">{r.summary.reason}</span>}
                {canEdit && r.can_undo && (undoing === r.id ? (
                  <span className="hk-row__end" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }} data-hk-undo-confirm>
                    <span className="hk-meta">Remove every brand, contact, touch and period this import created?</span>
                    <Button size="sm" variant="danger" disabled={!!busy} onClick={() => undo(r.id)}>Undo import</Button>
                    <Button size="sm" variant="tertiary" disabled={!!busy} onClick={() => setUndoing(null)}>Keep</Button>
                  </span>
                ) : (
                  <span className="hk-row__end"><Button size="sm" disabled={!!busy || !isOwnerRole} disabledReason={isOwnerRole ? undefined : 'Only an owner-role member can undo an import'} onClick={() => setUndoing(r.id)} data-hk-undo-import>Undo</Button></span>
                ))}
              </div>); })}
          </div>
        )}
      </section>
    </div>
  );
}
