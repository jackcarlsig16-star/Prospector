import React, { useCallback, useEffect, useState } from 'react';
import Button from '../../ui/Button';
import Field from '../../ui/Field';
import ToggleRow from '../../ui/ToggleRow';
import { hkGet, hkPatch } from '../hkApi';

// grow-inbox-intel-v1 REV3 B3a / B4 / M2 - under Settings > Pitch: the target categories (editable), auto-research
// (on / per day / dollar cap / time) with its last run, and the reach-out weights (read-only in v1). Owner role edits.
const WEIGHT_WORDS = { draftable: 'Has a contact to email', idea: 'Has a challenge idea', website: 'Has a website', researched: 'Researched', local: 'Chicago local', category: 'Target category', fit_strong: 'Strong fit', fit_possible: 'Possible fit', heat_hot: 'Hot', heat_warm: 'Warm', targeted: 'On Targets', mine_untouched: 'Claimed by you, untouched 7+ days', niche_overlap: 'Niche overlaps a sponsor', size_large: 'Large company' };

export default function IntelSettings({ businessId, shell, canEdit }) {
  const [b, setB] = useState(null);
  const [form, setForm] = useState(null);
  const [cat, setCat] = useState('');
  const [state, setState] = useState('');
  const [error, setError] = useState('');
  const dis = !canEdit || shell?.me?.role !== 'owner';
  const load = useCallback(async () => {
    try { const d = await hkGet(businessId, '/briefing', { owner: 'me' }); setB(d); setForm({ target_categories: d.target_categories, sweep: { on: d.research.on, n: d.research.n, cap_usd: d.research.cap_usd, time: d.research.time } }); setError(''); }
    catch (e) { setError(e.message); }
  }, [businessId]);
  useEffect(() => { load(); }, [load]);
  if (!b || !form) return error ? <p className="hk-error" role="alert">{error}</p> : <p className="hk-meta">Loading research settings…</p>;
  const save = async () => { setState('Saving…'); setError(''); try { await hkPatch(businessId, '/settings', { intel: form }); setState('Saved'); await load(); } catch (e) { setState(''); setError(e.message); } };
  const addCat = () => { const c = cat.trim(); if (!c || form.target_categories.some(x => x.toLowerCase() === c.toLowerCase())) return; setForm({ ...form, target_categories: [...form.target_categories, c] }); setCat(''); };
  const sw = form.sweep, setSw = patch => setForm({ ...form, sweep: { ...sw, ...patch } });
  const last = b.research.last_run;
  return (
    <section aria-label="Briefing and research" data-hk-intel-settings style={{ marginTop: 24 }}>
      <h3 className="hk-section-title" style={{ fontSize: 16 }}>Briefing and research</h3>
      {error && <p className="hk-error" role="alert">{error}</p>}
      <div className="hk-form">
        <div>
          <div className="hk-meta" style={{ marginBottom: 6 }}>Target categories (matched to each brand's category; Chicago counts as local)</div>
          <div className="hk-brand__chips" data-hk-target-cats>
            {form.target_categories.map(c => <span key={c} className="hk-chip hk-chip--green">{c}{!dis && <button type="button" className="hk-btn hk-chip__x" aria-label={`Remove ${c}`} onClick={() => setForm({ ...form, target_categories: form.target_categories.filter(x => x !== c) })}>×</button>}</span>)}
            {!dis && <span style={{ display: 'inline-flex', gap: 6 }}><input className="ui-input ui-input--sm" aria-label="Add a target category" placeholder="Add a category" value={cat} onChange={e => setCat(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCat(); } }} /><Button size="sm" onClick={addCat}>Add</Button></span>}
          </div>
        </div>
        <ToggleRow label="Auto-research" help="Researches the top brands without research once a day. It uses Claude, capped by count and dollars." checked={!!sw.on} disabled={dis} onChange={v => setSw({ on: v })} />
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Field label="Brands per day" htmlFor="hk-sw-n"><input id="hk-sw-n" className="ui-input" type="number" min="0" max="25" step="1" value={sw.n} disabled={dis} onChange={e => setSw({ n: Number(e.target.value) })} /></Field>
          <Field label="Daily dollar cap" htmlFor="hk-sw-cap"><input id="hk-sw-cap" className="ui-input" type="number" min="0" max="5" step="0.05" value={sw.cap_usd} disabled={dis} onChange={e => setSw({ cap_usd: Number(e.target.value) })} /></Field>
          <Field label="Time (Chicago)" htmlFor="hk-sw-time" hint="A new time applies after the next deploy"><input id="hk-sw-time" className="ui-input" type="time" value={sw.time} disabled={dis} onChange={e => setSw({ time: e.target.value })} /></Field>
        </div>
        <p className="hk-meta" data-hk-sweep-last>{last ? `Last run ${new Date(last.started_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} (${last.trigger}): ${last.counts?.calls || 0} researched, $${Number(last.counts?.cost_usd || 0).toFixed(2)}${last.status === 'ok' ? '' : `, ${last.status}`}.` : 'Auto-research has not run yet.'} Today {b.research.today_calls} of {b.research.n}.</p>
        {!dis && <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}><Button variant="primary" onClick={save} data-hk-save-intel>Save research settings</Button><span className="hk-meta" role="status">{state}</span></span>}
        {dis && canEdit && <p className="hk-meta">Only an owner-role member can change these.</p>}
      </div>
      <h3 className="hk-section-title" style={{ marginTop: 18, fontSize: 16 }}>Reach-out weights</h3>
      <table className="hk-weights" data-hk-weights>
        <caption className="ui-sr-only">Points each reason adds to a brand's reach-out score (read-only)</caption>
        <tbody>{Object.entries(WEIGHT_WORDS).map(([k, w]) => <tr key={k}><th scope="row">{w}</th><td>{b.weights[k] > 0 ? `+${b.weights[k]}` : b.weights[k]}</td></tr>)}</tbody>
      </table>
    </section>
  );
}
