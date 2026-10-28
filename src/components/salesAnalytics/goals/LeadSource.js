import { useState, useEffect } from 'react';
import { SA, SA_TYPE } from '../theme';
import { goalsApi } from './goalsApi';
import { inputStyle, ErrorNote, numStyle, fmt } from './goalsUi';
import { Card } from './CompanyPanelSections';
import { md, sourceText } from './companyPanelFacts';
import { SOURCE_KINDS, SOURCE_LABEL } from '../../../constants/leadSources';
import FilterSelect from '../../../ui/FilterSelect';

// lead-source-v1 Stage 3 - the company window's Source pieces: the Edit row's
// Source form (B2, Members), the Source history card (D4) and a partner's
// "Referred by" card (B3). The text fields hold names and short phrases; the
// server refuses an address or phone in any of them.
const field = { ...inputStyle, height: 32, fontSize: 13, padding: '0 8px' };
const dim = { fontSize: 13, color: SA.muted };
const text = { ...SA_TYPE.body, fontSize: 13, color: SA.text, overflowWrap: 'anywhere' };
const TEXT_FIELDS = [['source_person', 'Person', 'Rep or person, e.g. Brad Cillian', 120], ['source_office', 'Office', 'Office / branch, e.g. Chicago', 120], ['route_in', 'Route in', 'How we got in, e.g. Brad intro at Hub', 300], ['source_note', 'Note', 'Anything else (optional)', 500]];
const EDIT_FIELDS = ['source_kind', 'source_partner_id', 'source_person', 'source_office', 'source_campaign_id', 'route_in', 'source_note'];

export const sourceBody = s => Object.fromEntries(EDIT_FIELDS.map(k => [k, s?.[k] || null]));

// What one history row says: "Backfill · Unknown → Partner referral · Upside".
export function historyText(e) {
  const side = s => (s?.source_kind ? [SOURCE_LABEL[s.source_kind], s.partner_name, s.source_person, s.source_office].filter(Boolean).join(' · ') : 'Not set');
  return `${side(e.from_source)} → ${side(e.to_source)}`;
}
const REASON = { create: 'Created', edit: 'Edited', backfill: 'Backfill', promote: 'Promoted', import: 'Import' };

export function SourceForm({ businessId, row, source, onSaved, onToast, onCancel }) {
  const [draft, setDraft] = useState(() => sourceBody(source));
  const [partners, setPartners] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    goalsApi.partners(businessId).then(p => live && setPartners(p.filter(x => !x.archived_at && x.id !== row.id).sort((a, b) => a.name.localeCompare(b.name)))).catch(e => live && setError(e.message));
    return () => { live = false; };
  }, [businessId, row.id]);
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v || null }));
  const save = async () => {
    if (!draft.source_kind) { setError('Pick what kind of source it is'); return; }
    setBusy(true); setError('');
    const before = sourceBody(source);
    try {
      const saved = await goalsApi.editSource(businessId, row.type, row.id, { ...draft, expect_set_at: source?.set_at ?? null });
      onSaved();
      onToast({
        text: `${row.name}: source is ${sourceText(saved).text}`,
        undo: async () => {
          await goalsApi.editSource(businessId, row.type, row.id, { ...(before.source_kind ? before : { source_kind: null }), expect_set_at: saved.set_at });
          onSaved();
        },
      });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <div role="group" aria-label="Edit source" data-source-form style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', border: `1px solid ${SA.border}`, borderRadius: 10, background: SA.surface2 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <FilterSelect label="Kind" value={draft.source_kind || ''} disabled={busy} options={[{ value: '', label: 'Pick one' }, ...SOURCE_KINDS.map(k => ({ value: k, label: SOURCE_LABEL[k] }))]} onChange={v => set('source_kind', v)} />
        <FilterSelect label="Partner" value={draft.source_partner_id || ''} disabled={busy || !partners}
          options={[{ value: '', label: partners ? 'None' : 'Loading…' }, ...(partners || []).map(p => ({ value: p.id, label: p.name }))]} onChange={v => set('source_partner_id', v)} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
        {TEXT_FIELDS.map(([k, label, ph, max]) => (
          <input key={k} aria-label={label} placeholder={ph} maxLength={max} value={draft[k] || ''} disabled={busy} onChange={e => set(k, e.target.value)} className="ui-input" style={{ ...field, width: '100%' }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="ui-btn ui-btn--primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save source'}</button>
        <button type="button" className="ui-btn ui-btn--secondary" disabled={busy} onClick={onCancel}>Cancel</button>
        <span style={{ fontSize: 12, color: SA.muted }}>A source you set is never overwritten by an import or the backfill · logged, Undo for 10 s</span>
      </div>
      {error && <ErrorNote message={error} />}
    </div>
  );
}

// intake-insights-v1 I5: links = the channel links that name this company ("Linked in notes: Upside → referred → Acme").
const RELATION = { referred: 'referred', introduced: 'introduced', owns: 'owns', co_sells: 'co-sells with', reports_to: 'reports to', works_with: 'works with', other: '·' };
export const linkText = l => `${l.from_name} → ${RELATION[l.relation] || l.relation} → ${l.to_name}${l.link_date ? ` (${md(l.link_date)})` : ''}${l.seen_count > 1 ? ` · seen ${l.seen_count}×` : ''}`;
export function SourceHistoryCard({ data, links = [] }) {
  const history = data?.history || [];
  return (
    <Card label="Source history" count={history.length + links.length} testId="source-history">
      {links.map(l => <div key={l.id} data-linked-in-notes style={{ ...text, color: SA.soft }}>Linked in notes: {linkText(l)}</div>)}
      {data?.source?.source_note && <div style={{ ...text, color: SA.soft }}>Note: {data.source.source_note}</div>}
      {data?.source?.route_in && <div style={{ ...text, color: SA.soft }}>Route in: {data.source.route_in}</div>}
      {!history.length && <span style={dim}>No changes logged yet.</span>}
      {history.map(e => (
        <div key={e.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13 }}>
          <span style={{ ...numStyle, color: SA.muted, width: 48, flex: '0 0 48px' }}>{md(e.at)}</span>
          <span style={{ fontSize: 10.5, fontFamily: "'Geist Mono', ui-monospace, monospace", letterSpacing: '.06em', textTransform: 'uppercase', color: SA.muted, width: 64, flex: '0 0 64px', paddingTop: 2 }}>{REASON[e.reason] || e.reason}</span>
          <span style={{ ...text, flex: 1 }}>{historyText(e)}<span style={{ color: SA.muted }}> · {e.by || 'automatic'}</span></span>
        </div>
      ))}
    </Card>
  );
}

// B3 - every company this partner brought, grouped by the rep / office that brought it.
export function ReferredByCard({ businessId, row, version }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    goalsApi.referredBy(businessId, row.id).then(d => { if (live) { setData(d); setError(''); } }).catch(e => live && setError(e.message));
    return () => { live = false; };
  }, [businessId, row.id, version]);
  return (
    <Card label={`Referred by ${row.name}`} count={data ? data.total : null} testId="referred-by">
      {error && <ErrorNote message={error} />}
      {!data && !error && <span style={dim}>Loading…</span>}
      {data && !data.total && <span style={dim}>Nothing is sourced to {row.name} yet.</span>}
      {data?.groups.map(g => (
        <div key={`${g.person || ''}|${g.office || ''}`} data-referred-group style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="ui-group-label">{[g.person || 'No rep named', g.office].filter(Boolean).join(' · ')} ({g.rows.length})</span>
          {g.rows.map(r => (
            <div key={`${r.type}-${r.id}`} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 13, flexWrap: 'wrap' }}>
              <b style={{ color: SA.text, fontWeight: 500 }}>{r.name}</b>
              <span style={{ color: SA.muted }}>{r.type} · {r.stage_label || '—'} · {r.owner || 'Unassigned'}{r.covered_lives != null ? ` · ${fmt(r.covered_lives)} lives` : ''}{r.last_touch_at ? ` · touched ${md(r.last_touch_at)}` : ''}</span>
            </div>
          ))}
        </div>
      ))}
    </Card>
  );
}
