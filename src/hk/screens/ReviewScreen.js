import React, { useCallback, useEffect, useState } from 'react';
import Tabs from '../../ui/Tabs';
import Button from '../../ui/Button';
import { Sprout } from '../HkMarks';
import { Chip } from '../brands/BrandsScreen';
import { STATUS_LABELS, STATUS_TONE } from '../brands/verdict';
import { hkGet, hkPost } from '../hkApi';
import ImportsPanel from './ImportsPanel';

// hkos-data-foundation-v1 D6 - Review: possible duplicates side by side, imports (hkos-sheet-import-v1: ImportsPanel), data warnings.
const TABS = [['duplicates', 'Possible duplicates'], ['imports', 'Imports'], ['warnings', 'Data warnings']];
const REASON = { same_domain: 'Same domain', same_name: 'Same name', name_contains: 'One name contains the other' };
const WARN = { future_last_touch: 'Last touch is in the future', far_next_due: 'Next due is more than a year out', missing_domain: 'No domain past candidate', owner_conflict: 'Owner set while owner is unclear' };
const fmt = iso => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');

function BrandCard({ b, member }) {
  const o = member(b.owner_user_id);
  return (
    <div className="hk-dup-card">
      <div className="hk-table__title">{b.name}</div>
      <div className="hk-meta">{b.domain || 'No domain'}</div>
      <div className="hk-brand__chips" style={{ marginTop: 6 }}><Chip tone={STATUS_TONE[b.status]}>{STATUS_LABELS[b.status]}</Chip>{o && <Chip tone="grey">{o.first_name}</Chip>}<span className="hk-meta">Created {fmt(b.created_at)}</span></div>
    </div>
  );
}

export default function ReviewScreen({ businessId, shell, canEdit, compact, onOpenBrand, onGo, intent, onIntentDone }) {
  const [tab, setTab] = useState(() => (intent?.kind === 'import' ? 'imports' : 'duplicates'));
  const [importCount, setImportCount] = useState(0);
  const [autoOpen, setAutoOpen] = useState(() => intent?.kind === 'import');
  useEffect(() => { if (intent?.kind === 'import') { setTab('imports'); setAutoOpen(true); } }, [intent]);
  const autoOpened = useCallback(() => { setAutoOpen(false); onIntentDone?.(); }, [onIntentDone]);
  const [pairs, setPairs] = useState(null);
  const [warnings, setWarnings] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [error, setError] = useState('');
  const members = shell?.members || [];
  const member = id => members.find(m => m.user_id === id);
  const load = useCallback(async () => {
    setError('');
    try { const [d, w] = await Promise.all([hkGet(businessId, '/review/duplicates'), hkGet(businessId, '/review/warnings')]); setPairs(d.pairs); setWarnings(w.warnings); }
    catch (e) { setError(e.message); setPairs([]); setWarnings([]); }
  }, [businessId]);
  useEffect(() => { load(); }, [load]);
  const decide = async body => { setError(''); try { await hkPost(businessId, '/review/duplicates/decide', body); setConfirm(null); await load(); } catch (e) { setError(e.message); } };
  const counts = { duplicates: pairs?.length || 0, imports: importCount, warnings: warnings?.length || 0 };
  return (
    <div data-hk-review>
      <Tabs label="Review sections" items={TABS.map(([id, label]) => ({ id, label: counts[id] ? `${label} (${counts[id]})` : label }))} value={tab} onChange={setTab} />
      {error && <p className="hk-error" role="alert">{error}</p>}
      {tab === 'duplicates' && (pairs === null ? <p className="hk-meta">Checking…</p> : !pairs.length ? (
        <div className="hk-empty" data-hk-empty><Sprout size={40} /><p className="hk-empty__title">Nothing to merge.</p><p className="hk-empty__line">Pairs with the same domain or overlapping names show here.</p></div>
      ) : (
        <div className="hk-rows" style={{ marginTop: 14 }}>
          {pairs.map(p => (
            <div key={`${p.a.id}|${p.b.id}`} className="hk-dup" data-hk-pair>
              <div className="hk-dup__cards"><BrandCard b={p.a} member={member} /><span className="hk-dup__vs">{REASON[p.reason] || p.reason}</span><BrandCard b={p.b} member={member} /></div>
              {canEdit && (confirm && confirm.key === `${p.a.id}|${p.b.id}` ? (
                <div className="hk-inline-form" data-hk-merge-confirm>
                  <p style={{ margin: 0 }}>Merge <strong>{confirm.loser.name}</strong> into <strong>{confirm.winner.name}</strong>: its contacts, touches, replies and sponsor periods move over, <strong>{confirm.loser.name}</strong> is archived and kept as an alias. Claims and notes on the winner stay as they are.</p>
                  <span style={{ display: 'inline-flex', gap: 8 }}><Button variant="primary" onClick={() => decide({ brand_a: p.a.id, brand_b: p.b.id, verdict: 'merge', winner: confirm.winner.id })}>Merge</Button><Button variant="tertiary" onClick={() => setConfirm(null)}>Cancel</Button></span>
                </div>
              ) : (
                <div className="hk-dup__actions">
                  <Button size="sm" onClick={() => setConfirm({ key: `${p.a.id}|${p.b.id}`, winner: p.a, loser: p.b })}>Merge into left</Button>
                  <Button size="sm" onClick={() => setConfirm({ key: `${p.a.id}|${p.b.id}`, winner: p.b, loser: p.a })}>Merge into right</Button>
                  <Button size="sm" variant="tertiary" onClick={() => decide({ brand_a: p.a.id, brand_b: p.b.id, verdict: 'not_duplicate' })}>Not a duplicate</Button>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
      {tab === 'imports' && <ImportsPanel businessId={businessId} shell={shell} canEdit={canEdit} compact={compact} autoOpen={autoOpen} onAutoOpened={autoOpened} onCount={setImportCount} onOpenBrands={() => onGo?.('brands')} onOpenWarnings={() => { setTab('warnings'); load(); }} />}
      {tab === 'warnings' && (warnings === null ? <p className="hk-meta">Checking…</p> : !warnings.length ? (
        <div className="hk-empty" data-hk-empty><Sprout size={40} /><p className="hk-empty__title">No data warnings.</p><p className="hk-empty__line">Future dates, missing domains and owner conflicts show here.</p></div>
      ) : (
        <div className="hk-rows" style={{ marginTop: 14 }}>
          {warnings.map((w, i) => (
            <div key={`${w.brand_id}-${w.kind}-${i}`} className="hk-row" data-hk-warning={w.kind}>
              <button type="button" className="hk-btn hk-table__title" onClick={() => onOpenBrand(w.brand_id)}>{w.name}</button>
              <Chip tone="mustard">{WARN[w.kind] || w.kind}</Chip>
              <span className="hk-row__end hk-meta">{String(w.detail || '').slice(0, 40)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
