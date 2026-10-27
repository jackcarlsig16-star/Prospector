import React, { useCallback, useEffect, useState } from 'react';
import Button from '../../ui/Button';
import { Avatar, Icon } from '../HkMarks';
import { Chip } from '../brands/BrandsScreen';
import { RELATIONSHIP_LABELS, RELATIONSHIP_TONE } from '../brands/verdict';
import { hkGet, hkPatch, hkPost, hkFetch } from '../hkApi';
import BrandPicker from './BrandPicker';

// hkos-data-foundation-v1 D6 - Sponsors: A) current / past sponsors with their periods, B) the do-not-contact block.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const periodLabel = p => (p === 'launch' ? 'Launch' : /^\d{4}-\d{2}$/.test(p) ? `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(2, 4)}` : p);
const fmt = iso => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');

export default function SponsorsScreen({ businessId, shell, canEdit, onOpenBrand }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [picker, setPicker] = useState(null);
  const [periodFor, setPeriodFor] = useState(null);
  const [period, setPeriod] = useState({ period: '', note: '' });
  const members = shell?.members || [];
  const isOwnerRole = shell?.me?.role === 'owner';
  const member = id => members.find(m => m.user_id === id);
  const load = useCallback(async () => { setError(''); try { setData(await hkGet(businessId, '/sponsors')); } catch (e) { setError(e.message); setData({ sponsors: [], dnc: [] }); } }, [businessId]);
  useEffect(() => { load(); }, [load]);
  const act = async fn => { try { await fn(); await load(); } catch (e) { setError(e.message); throw e; } };
  const addPeriod = async e => {
    e.preventDefault();
    await act(() => hkPost(businessId, `/sponsors/${periodFor}/periods`, { period: period.period.trim().toLowerCase(), note: period.note.trim() || undefined }));
    setPeriodFor(null); setPeriod({ period: '', note: '' });
  };
  if (!data) return <p className="hk-meta">Loading sponsors…</p>;
  return (
    <div data-hk-sponsors>
      <p className="hk-note" data-hk-sponsors-note>Brands here are blocked from drafting. Niche is used to warn on lookalike brands.</p>
      {error && <p className="hk-error" role="alert">{error}</p>}
      <section aria-label="Sponsors" className="hk-section">
        <div className="hk-section__head">
          <h2 className="hk-section-title">Current and past sponsors</h2>
          {canEdit && isOwnerRole && <Button variant="primary" size="sm" onClick={() => setPicker('sponsor')} data-hk-add-sponsor>+ Add sponsor</Button>}
        </div>
        {!data.sponsors.length && <p className="hk-meta">No sponsors yet. Sponsors and founding partners arrive with the Sheet import, or add one here.</p>}
        <div className="hk-rows">
          {data.sponsors.map(b => { const o = member(b.owner_user_id); return (
            <div key={b.id} className="hk-row hk-row--wrap" data-hk-sponsor={b.id}>
              <button type="button" className="hk-btn hk-table__title" onClick={() => onOpenBrand(b.id)}>{b.name}</button>
              <Chip tone={RELATIONSHIP_TONE[b.relationship]}>{RELATIONSHIP_LABELS[b.relationship]}</Chip>
              {b.source === 'import' && <Chip tone="lilac">Import</Chip>}
              {b.niche && <span className="hk-meta">{b.niche}</span>}
              <span className="hk-period-chips">{b.periods.map(p => <span key={p.id} className="hk-chip hk-chip--green" title={p.note || ''}>{periodLabel(p.period)}{canEdit && isOwnerRole && <button type="button" className="hk-btn hk-chip__x" aria-label={`Remove ${periodLabel(p.period)}`} onClick={() => act(() => hkFetch(businessId, `/sponsors/${b.id}/periods/${p.id}`, { method: 'DELETE' }))}>×</button>}</span>)}</span>
              {o && <span className="hk-owner"><Avatar name={o.first_name} index={o.palette_index} size={22} />{o.first_name}</span>}
              {b.notes && <span className="hk-meta hk-truncate">{b.notes}</span>}
              {canEdit && <span className="hk-row__end"><Button size="sm" onClick={() => { setPeriodFor(b.id); setPeriod({ period: '', note: '' }); }}>Add period</Button></span>}
              {periodFor === b.id && (
                <form className="hk-inline-form hk-inline-form--row" onSubmit={addPeriod} data-hk-period-form>
                  <input className="ui-input ui-input--sm" aria-label="Period (YYYY-MM or launch)" placeholder="2026-07 or launch" value={period.period} autoFocus onChange={e => setPeriod({ ...period, period: e.target.value })} />
                  <input className="ui-input ui-input--sm" aria-label="Note" placeholder="Note" value={period.note} onChange={e => setPeriod({ ...period, note: e.target.value })} />
                  <Button type="submit" size="sm" variant="primary" disabled={!/^(\d{4}-(0[1-9]|1[0-2])|launch)$/i.test(period.period.trim())}>Save period</Button>
                  <Button size="sm" variant="tertiary" onClick={() => setPeriodFor(null)}>Cancel</Button>
                </form>
              )}
            </div>); })}
        </div>
      </section>
      <section aria-label="Do not contact" className="hk-section">
        <div className="hk-section__head">
          <h2 className="hk-section-title">Do not contact</h2>
          {canEdit && <Button size="sm" onClick={() => setPicker('dnc')} data-hk-add-dnc>+ Add</Button>}
        </div>
        {!data.dnc.length && <p className="hk-meta">Nobody is blocked.</p>}
        <div className="hk-rows">
          {data.dnc.map(b => { const by = member(b.marked_by); return (
            <div key={b.id} className="hk-row hk-row--wrap" data-hk-dnc={b.id}>
              <button type="button" className="hk-btn hk-table__title" onClick={() => onOpenBrand(b.id)}>{b.name}</button>
              <Chip tone="block">Do not contact</Chip>
              <span className="hk-meta">{b.dnc_reason}</span>
              <span className="hk-meta">{by ? by.first_name : 'Unknown'} · {fmt(b.marked_at)}</span>
              {canEdit && <span className="hk-row__end"><Button size="sm" variant="danger" disabled={!isOwnerRole} disabledReason="Only an owner-role member can lift a block" onClick={() => { const reason = window.prompt('Why can this brand be contacted again?'); if (reason && reason.trim()) act(() => hkPatch(businessId, `/brands/${b.id}`, { relationship: 'prospect', reason: reason.trim() })); }}>Remove</Button></span>}
            </div>); })}
        </div>
      </section>
      {picker === 'sponsor' && <BrandPicker businessId={businessId} title="Which brand is a sponsor?" line="Only prospect brands are listed. Add a new brand under Brands first." confirmLabel="Mark as sponsor" onClose={() => setPicker(null)} onPick={async b => { await act(() => hkPatch(businessId, `/brands/${b.id}`, { relationship: 'sponsor' })); setPicker(null); }} />}
      {picker === 'dnc' && <BrandPicker businessId={businessId} title="Which brand should never be contacted?" confirmLabel="Block" withReason="Why?" onClose={() => setPicker(null)} onPick={async (b, reason) => { await act(() => hkPatch(businessId, `/brands/${b.id}`, { relationship: 'do_not_contact', dnc_reason: reason })); setPicker(null); }} />}
    </div>
  );
}
