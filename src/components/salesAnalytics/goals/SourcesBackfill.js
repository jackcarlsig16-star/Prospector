import { useState } from 'react';
import { SA } from '../theme';
import { goalsApi } from './goalsApi';
import { cardStyle, labelStyle, numStyle, fmt, h3Style, inputStyle, ErrorNote, Btn } from './goalsUi';
import { SOURCE_KINDS, SOURCE_LABEL } from '../../../constants/leadSources';

// lead-source-v1 B5 - the backfill screen (Owner / Admin; the routes refuse
// anyone else). Preview groups every record whose source is still open by
// the value it came from (the master-sheet Source line, or the channel when
// there's no sheet block); each group's proposed mapping can be changed and
// is applied only once its Confirm box is ticked. Apply never touches a
// source a person set, and re-running writes nothing new.
const field = { ...inputStyle, height: 32, fontSize: 13, padding: '0 8px' };
const cell = { padding: '8px 10px', borderTop: `1px solid ${SA.track}`, fontSize: 13, color: SA.text, verticalAlign: 'top' };
const TYPE_WORD = { partner: 'partner', employer: 'employer', target: 'target' };
const byType = o => Object.entries(o).map(([k, n]) => `${n} ${TYPE_WORD[k]}${n === 1 ? '' : 's'}`).join(' · ');

export const mappingsFrom = (groups, picks) => Object.fromEntries(groups.filter(g => picks[g.key]?.on).map(g => {
  const p = picks[g.key];
  return [g.key, { source_kind: p.source_kind, source_partner_id: p.source_partner_id || null, source_person: p.source_person || null }];
}));

export default function SourcesBackfill({ businessId, onApplied }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [partners, setPartners] = useState([]);
  const [picks, setPicks] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const load = async () => {
    setBusy('preview'); setError(''); setResult(null);
    try {
      const [p, ps] = await Promise.all([goalsApi.sourcesBackfill(businessId), goalsApi.partners(businessId)]);
      setPreview(p);
      setPartners(ps.filter(x => !x.archived_at).sort((a, b) => a.name.localeCompare(b.name)));
      setPicks(Object.fromEntries(p.groups.map(g => [g.key, { on: false, source_kind: g.proposed.source_kind, source_partner_id: g.proposed.source_partner_id || '', source_person: g.proposed.source_person || '' }])));
      setOpen(true);
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  };
  const set = (key, k, v) => setPicks(p => ({ ...p, [key]: { ...p[key], [k]: v } }));
  const chosen = preview ? preview.groups.filter(g => picks[g.key]?.on) : [];
  const records = chosen.reduce((n, g) => n + g.count, 0);
  const apply = async () => {
    if (!window.confirm(`Write a source on ${records} record${records === 1 ? '' : 's'} from ${chosen.length} confirmed group${chosen.length === 1 ? '' : 's'}? Sources a person set are left alone.`)) return;
    setBusy('apply'); setError('');
    try {
      const r = await goalsApi.applySourcesBackfill(businessId, mappingsFrom(preview.groups, picks));
      setResult(r);
      onApplied();
      const p = await goalsApi.sourcesBackfill(businessId);
      setPreview(p);
      setPicks(prev => Object.fromEntries(p.groups.map(g => [g.key, { ...(prev[g.key] || { source_kind: g.proposed.source_kind, source_partner_id: g.proposed.source_partner_id || '', source_person: g.proposed.source_person || '' }), on: false }])));
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  };
  return (
    <section aria-label="Backfill sources" data-sources-backfill style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <h3 style={{ ...h3Style, marginRight: 'auto' }}>Backfill sources <span style={{ fontSize: 12, fontWeight: 400, color: SA.muted }}>· Owner / Admin</span></h3>
        <Btn disabled={!!busy} onClick={load}>{busy === 'preview' ? 'Reading…' : preview ? 'Preview again' : 'Preview backfill'}</Btn>
        {open && <Btn onClick={() => setOpen(false)}>Hide</Btn>}
      </div>
      <p style={{ margin: 0, fontSize: 12, color: SA.muted }}>Reads the master-sheet Source / Route in lines in each record's notes (or its channel). Nothing is written until you confirm a group and apply.</p>
      {error && <ErrorNote message={error} />}
      {result && <p role="status" style={{ margin: 0, fontSize: 13, color: SA.good }}>Wrote {fmt(result.written)} source{result.written === 1 ? '' : 's'} from {result.groups} group{result.groups === 1 ? '' : 's'}{result.skipped ? ` · ${fmt(result.skipped)} skipped (set since)` : ''}.</p>}
      {open && preview && <>
        <p style={{ margin: 0, fontSize: 13, color: SA.text, ...numStyle }}>{fmt(preview.total)} companies · {fmt(preview.kept)} already have a source (kept) · {fmt(preview.total - preview.kept)} still open, in {preview.groups.length} group{preview.groups.length === 1 ? '' : 's'}</p>
        {!preview.groups.length && <span style={{ fontSize: 13, color: SA.muted }}>Nothing left to backfill.</span>}
        {preview.groups.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead>
                <tr>{['Confirm', 'Value', 'Records', 'Source kind', 'Partner', 'Person'].map(h => <th key={h} scope="col" style={{ ...labelStyle, textAlign: 'left', padding: '8px 10px', whiteSpace: 'nowrap' }}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {preview.groups.map(g => {
                  const p = picks[g.key] || {};
                  return (
                    <tr key={g.key} data-backfill-group={g.key}>
                      <td style={cell}><input type="checkbox" aria-label={`Confirm ${g.key}`} checked={!!p.on} disabled={!!busy} onChange={e => set(g.key, 'on', e.target.checked)} style={{ width: 18, height: 18 }} /></td>
                      <td style={{ ...cell, minWidth: 180 }}><div style={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{g.key}</div><div style={{ fontSize: 12, color: SA.muted }}>{g.rule}</div></td>
                      <td style={{ ...cell, ...numStyle, whiteSpace: 'nowrap' }}><b>{fmt(g.count)}</b><div style={{ fontSize: 12, color: SA.muted }}>{byType(g.by_type)}</div></td>
                      <td style={cell}>
                        <select aria-label={`Source kind for ${g.key}`} className="ui-input" value={p.source_kind || ''} disabled={!!busy} onChange={e => set(g.key, 'source_kind', e.target.value)} style={{ ...field, width: 170 }}>
                          {SOURCE_KINDS.map(k => <option key={k} value={k}>{SOURCE_LABEL[k]}</option>)}
                        </select>
                      </td>
                      <td style={cell}>
                        <select aria-label={`Partner for ${g.key}`} className="ui-input" value={p.source_partner_id || ''} disabled={!!busy} onChange={e => set(g.key, 'source_partner_id', e.target.value)} style={{ ...field, width: 180 }}>
                          <option value="">None</option>
                          {partners.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </select>
                      </td>
                      <td style={cell}><input aria-label={`Person for ${g.key}`} className="ui-input" maxLength={120} value={p.source_person || ''} disabled={!!busy} onChange={e => set(g.key, 'source_person', e.target.value)} placeholder="—" style={{ ...field, width: 150 }} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {preview.groups.length > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Btn primary disabled={!chosen.length || !!busy} onClick={apply}>{busy === 'apply' ? 'Applying…' : `Apply ${chosen.length} confirmed group${chosen.length === 1 ? '' : 's'} (${fmt(records)} records)`}</Btn>
            <span style={{ fontSize: 12, color: SA.muted }}>Each record keeps its own route in · one history row per record · safe to re-run</span>
          </div>
        )}
      </>}
    </section>
  );
}
