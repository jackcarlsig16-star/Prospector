import React, { useCallback, useEffect, useState } from 'react';
import Button from '../../ui/Button';
import Field from '../../ui/Field';
import { Icon } from '../HkMarks';
import { hkGet, hkPatch, hkPost } from '../hkApi';

// hkos-data-foundation-v1 D6 - Settings > Pitch: the stats line (amber until confirmed, re-confirm after 14 days), the
// two market lines with a live preview, the subject format, banned phrases and the locked rules. Owner role edits;
// any member may confirm the stats.
export const STALE_DAYS = 14;
export const statsState = (confirmedAt, now = Date.now()) => (!confirmedAt ? 'unconfirmed' : (now - new Date(confirmedAt).getTime()) / 86400e3 > STALE_DAYS ? 'stale' : 'fresh');
const fmtN = n => (n == null ? '?' : `${Number(n).toLocaleString('en-US')}+`);
export const previewLine = (firstName, line) => `I'm ${firstName}, co-founder of HumanKind, a free community wellness platform ${line || '…'}.`;

export default function PitchSettings({ businessId, shell, canEdit }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [phrase, setPhrase] = useState('');
  const [confirming, setConfirming] = useState(null);
  const [state, setState] = useState('');
  const [error, setError] = useState('');
  const isOwnerRole = shell?.me?.role === 'owner';
  const load = useCallback(async () => { setError(''); try { const d = await hkGet(businessId, '/settings'); setData(d); setForm({ market_line_local: d.settings.market_line_local || '', market_line_national: d.settings.market_line_national || '', subject_format: d.settings.subject_format || '', banned_phrases: d.settings.banned_phrases || [] }); } catch (e) { setError(e.message); } }, [businessId]);
  useEffect(() => { load(); }, [load]);
  if (!data || !form) return error ? <p className="hk-error" role="alert">{error}</p> : <p className="hk-meta">Loading pitch settings…</p>;
  const s = data.settings, st = statsState(s.stats_confirmed_at);
  const save = async () => { setState('Saving…'); setError(''); try { await hkPatch(businessId, '/settings', form); setState('Saved'); await load(); } catch (e) { setState(''); setError(e.message); } };
  const confirmStats = async e => { e.preventDefault(); setError(''); try { await hkPost(businessId, '/settings/confirm-stats', { members_stat: Number(confirming.members), completions_stat: Number(confirming.completions) }); setConfirming(null); await load(); } catch (err) { setError(err.message); } };
  const addPhrase = () => { const p = phrase.trim().toLowerCase(); if (!p || form.banned_phrases.includes(p)) return; setForm({ ...form, banned_phrases: [...form.banned_phrases, p] }); setPhrase(''); };
  const dis = !canEdit || !isOwnerRole;
  return (
    <section aria-label="Pitch" data-hk-pitch>
      <h2 className="hk-section-title">Pitch</h2>
      <div className={`hk-banner hk-banner--${st === 'fresh' ? 'green' : 'mustard'}`} data-hk-stats={st}>
        <div className="hk-banner__text">
          <span className="hk-banner__title">Pitching with {fmtN(s.members_stat)} members and {fmtN(s.completions_stat)} challenge completions</span>
          <span className="hk-banner__line">{st === 'unconfirmed' ? 'Not confirmed yet. Confirm before the first drafts go out.' : st === 'stale' ? `Confirmed ${new Date(s.stats_confirmed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, more than ${STALE_DAYS} days ago. Confirm again.` : `Confirmed ${new Date(s.stats_confirmed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.`}</span>
        </div>
        {canEdit && <div className="hk-banner__actions"><Button size="sm" variant={st === 'fresh' ? 'secondary' : 'primary'} onClick={() => setConfirming({ members: s.members_stat ?? '', completions: s.completions_stat ?? '' })} data-hk-confirm-stats>Confirm stats</Button></div>}
      </div>
      {confirming && (
        <form className="hk-inline-form" onSubmit={confirmStats} data-hk-confirm-form>
          <Field label="Members" htmlFor="hk-st-m"><input id="hk-st-m" className="ui-input" type="number" min="0" step="1" value={confirming.members} autoFocus onChange={e => setConfirming({ ...confirming, members: e.target.value })} /></Field>
          <Field label="Challenge completions" htmlFor="hk-st-c"><input id="hk-st-c" className="ui-input" type="number" min="0" step="1" value={confirming.completions} onChange={e => setConfirming({ ...confirming, completions: e.target.value })} /></Field>
          <span style={{ display: 'inline-flex', gap: 8 }}><Button type="submit" variant="primary" disabled={confirming.members === '' || confirming.completions === ''}>Confirm</Button><Button variant="tertiary" onClick={() => setConfirming(null)}>Cancel</Button></span>
        </form>
      )}
      {error && <p className="hk-error" role="alert">{error}</p>}
      <div className="hk-form" style={{ marginTop: 16 }}>
        <Field label="Market line, local Chicago" htmlFor="hk-ml-local" hint={previewLine(shell?.me?.first_name || 'Jack', form.market_line_local)}>
          <input id="hk-ml-local" className="ui-input" value={form.market_line_local} disabled={dis} maxLength={200} onChange={e => setForm({ ...form, market_line_local: e.target.value })} />
        </Field>
        <Field label="Market line, national" htmlFor="hk-ml-national" hint={previewLine(shell?.me?.first_name || 'Jack', form.market_line_national)}>
          <input id="hk-ml-national" className="ui-input" value={form.market_line_national} disabled={dis} maxLength={200} onChange={e => setForm({ ...form, market_line_national: e.target.value })} />
        </Field>
        <Field label="Subject format" htmlFor="hk-subject" hint="[Brand] and [descriptor] are filled per draft">
          <input id="hk-subject" className="ui-input" value={form.subject_format} disabled={dis} maxLength={120} onChange={e => setForm({ ...form, subject_format: e.target.value })} />
        </Field>
        <div>
          <div className="hk-meta" style={{ marginBottom: 6 }}>Banned phrases</div>
          <div className="hk-brand__chips" data-hk-banned>
            {form.banned_phrases.map(p => <span key={p} className="hk-chip hk-chip--block">{p}{!dis && <button type="button" className="hk-btn hk-chip__x" aria-label={`Remove ${p}`} onClick={() => setForm({ ...form, banned_phrases: form.banned_phrases.filter(x => x !== p) })}>×</button>}</span>)}
            {!dis && <span style={{ display: 'inline-flex', gap: 6 }}><input className="ui-input ui-input--sm" aria-label="Add a banned phrase" placeholder="Add a phrase" value={phrase} onChange={e => setPhrase(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addPhrase(); } }} /><Button size="sm" onClick={addPhrase}>Add</Button></span>}
          </div>
        </div>
        {!dis && <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}><Button variant="primary" onClick={save} data-hk-save-pitch>Save pitch settings</Button><span className="hk-meta" role="status">{state}</span></span>}
        {dis && canEdit && <p className="hk-meta">Only an owner-role member can change these. You can confirm the stats.</p>}
      </div>
      <h3 className="hk-section-title" style={{ marginTop: 22, fontSize: 16 }}>Locked rules</h3>
      <ul className="hk-locked" data-hk-locked>
        {(data.locked_rules || []).map(r => <li key={r.id} className="hk-locked__item"><Icon name="lock" size={16} label="Locked" />{r.rule}</li>)}
      </ul>
    </section>
  );
}
