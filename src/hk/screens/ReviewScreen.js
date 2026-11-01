import React, { useCallback, useEffect, useState } from 'react';
import Tabs from '../../ui/Tabs';
import Button from '../../ui/Button';
import { Sprout } from '../HkMarks';
import { Chip } from '../brands/BrandsScreen';
import { STATUS_LABELS, STATUS_TONE } from '../brands/verdict';
import { hkGet, hkPost } from '../hkApi';
import ImportsPanel from './ImportsPanel';

// hkos-data-foundation-v1 D6 - Review: possible duplicates side by side, imports (hkos-sheet-import-v1: ImportsPanel), data warnings.
const TABS = [['duplicates', 'Possible duplicates'], ['imports', 'Imports'], ['warnings', 'Data warnings'], ['links', 'Email links']];
const MATCH_WORDS = { name: 'Matched by the brand name in the subject', suggested_domain: 'Matched by the suggested website (not saved yet)' };
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

function WarningRows({ list, tone, onOpenBrand }) {
  return (
    <div className="hk-rows" style={{ marginTop: 14 }}>
      {list.map((w, i) => (
        <div key={`${w.brand_id}-${w.kind}-${i}`} className="hk-row" data-hk-warning={w.kind}>
          <button type="button" className="hk-btn hk-table__title" onClick={() => onOpenBrand(w.brand_id)}>{w.name}</button>
          <Chip tone={tone}>{WARN[w.kind] || w.kind}</Chip>
          {w.sponsor && <Chip tone="green">Sponsor</Chip>}
          <span className="hk-row__end hk-meta">{String(w.detail || '').slice(0, 40)}</span>
        </div>
      ))}
    </div>
  );
}

// grow-mailbox-link-v1 L7 - a Gmail thread Grow linked on a weaker match waits here for a person: Link (it becomes a
// manual link Grow may act on) or Not this brand (kept, so it is never linked again). Open in Gmail on your own threads.
function EmailLinks({ businessId, links, canEdit, mailboxEmail, onOpenBrand, onDone }) {
  const [busy, setBusy] = useState(null), [error, setError] = useState('');
  const decide = async (id, decision) => { setBusy(id); setError(''); try { await hkPost(businessId, `/review/email-links/${id}`, { decision }); await onDone(); } catch (e) { setError(e.message); } finally { setBusy(null); } };
  if (!links.length) return <div className="hk-empty" data-hk-empty><Sprout size={40} /><p className="hk-empty__title">No email links to check.</p><p className="hk-empty__line">Gmail threads matched only by a brand name, or by a website not saved yet, show here.</p></div>;
  return (
    <div className="hk-rows" style={{ marginTop: 14 }}>
      {error && <p className="hk-error" role="alert">{error}</p>}
      {links.map(l => (
        <div key={l.id} className="hk-row" data-hk-email-link={l.id}>
          <button type="button" className="hk-btn hk-table__title" onClick={() => onOpenBrand(l.brand_id)}>{l.brand_name || 'A brand'}</button>
          <span className="hk-meta">{MATCH_WORDS[l.matched_by] || 'Linked'} · {l.own ? 'your mailbox' : `${l.who || 'a teammate'}'s mailbox`}{l.message_count ? ` · ${l.message_count} message${l.message_count === 1 ? '' : 's'}` : ''} · last {fmt(l.last_at)}</span>
          <span className="hk-row__end" style={{ display: 'inline-flex', gap: 8 }}>
            {l.own && l.gmail_thread_id && mailboxEmail && <a className="hk-link" href={`https://mail.google.com/mail/?authuser=${encodeURIComponent(mailboxEmail)}#all/${encodeURIComponent(l.gmail_thread_id)}`} target="_blank" rel="noopener noreferrer">Open in Gmail</a>}
            {canEdit && l.link_state === 'review' && <><Button size="sm" disabled={busy === l.id} onClick={() => decide(l.id, 'link')}>Link</Button><Button size="sm" variant="tertiary" disabled={busy === l.id} onClick={() => decide(l.id, 'not_this_brand')}>Not this brand</Button></>}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function ReviewScreen({ businessId, shell, gmail, canEdit, compact, onOpenBrand, onGo, intent, onIntentDone }) {
  const [tab, setTab] = useState(() => (intent?.kind === 'import' ? 'imports' : 'duplicates'));
  const [importCount, setImportCount] = useState(0);
  const [autoOpen, setAutoOpen] = useState(() => intent?.kind === 'import');
  useEffect(() => { if (intent?.kind === 'import') { setTab('imports'); setAutoOpen(true); } }, [intent]);
  const autoOpened = useCallback(() => { setAutoOpen(false); onIntentDone?.(); }, [onIntentDone]);
  const [pairs, setPairs] = useState(null);
  const [warnings, setWarnings] = useState(null);
  const [links, setLinks] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [error, setError] = useState('');
  const members = shell?.members || [];
  const member = id => members.find(m => m.user_id === id);
  const load = useCallback(async () => {
    setError('');
    try { const [d, w, l] = await Promise.all([hkGet(businessId, '/review/duplicates'), hkGet(businessId, '/review/warnings'), hkGet(businessId, '/review/email-links')]); setPairs(d.pairs); setWarnings(w.warnings); setLinks(l.links); }
    catch (e) { setError(e.message); setPairs([]); setWarnings([]); setLinks([]); }
  }, [businessId]);
  useEffect(() => { load(); }, [load]);
  const decide = async body => { setError(''); try { await hkPost(businessId, '/review/duplicates/decide', body); setConfirm(null); await load(); } catch (e) { setError(e.message); } };
  const action = (warnings || []).filter(w => !w.low);
  const low = (warnings || []).filter(w => w.low).sort((a, b) => Number(!!b.sponsor) - Number(!!a.sponsor) || a.name.localeCompare(b.name));
  const counts = { duplicates: pairs?.length || 0, imports: importCount, warnings: action.length, links: (links || []).filter(l => l.link_state === 'review').length };
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
      {tab === 'links' && (links === null ? <p className="hk-meta">Checking…</p> : <EmailLinks businessId={businessId} links={links} canEdit={canEdit} mailboxEmail={gmail?.mailbox?.linked ? gmail.mailbox.email : null} onOpenBrand={onOpenBrand} onDone={load} />)}
      {tab === 'imports' && <ImportsPanel businessId={businessId} shell={shell} canEdit={canEdit} compact={compact} autoOpen={autoOpen} onAutoOpened={autoOpened} onCount={setImportCount} onOpenBrands={() => onGo?.('brands')} onOpenWarnings={() => { setTab('warnings'); load(); }} />}
      {tab === 'warnings' && (warnings === null ? <p className="hk-meta">Checking…</p> : !warnings.length ? (
        <div className="hk-empty" data-hk-empty><Sprout size={40} /><p className="hk-empty__title">No data warnings.</p><p className="hk-empty__line">Future dates, missing domains and owner conflicts show here.</p></div>
      ) : (
        <>
          {action.length ? <WarningRows list={action} tone="mustard" onOpenBrand={onOpenBrand} /> : <p className="hk-meta" style={{ marginTop: 14 }}>Nothing needs fixing.</p>}
          {low.length > 0 && <div data-hk-warnings-low style={{ marginTop: 24 }}>
            <p className="hk-meta">Missing domain · low priority · {low.length} (sponsors first)</p>
            <WarningRows list={low} tone="grey" onOpenBrand={onOpenBrand} />
          </div>}
        </>
      ))}
    </div>
  );
}
