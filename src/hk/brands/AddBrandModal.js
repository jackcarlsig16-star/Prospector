import React, { useEffect, useRef, useState } from 'react';
import Field from '../../ui/Field';
import Button, { ButtonRow } from '../../ui/Button';
import ToggleRow from '../../ui/ToggleRow';
import VerdictBanner from './VerdictBanner';
import { verdictView, saveRule } from './verdict';
import { hkPost } from '../hkApi';

// hkos-data-foundation-v1 D6 - Add brand. Name / domain blur runs brands/check; the banner decides whether Save is
// open, needs "Save anyway" (force_duplicate) or is blocked (sponsor, do not contact). No kit modal exists, so the
// dialog chrome is the shell's own (hk-modal) - flagged in the Stage 3 report.
const EMPTY = { name: '', domain: '', category: '', is_local: false, neighborhood: '', notes: '', challenge_idea: '' };

export default function AddBrandModal({ businessId, members, onClose, onSaved, onOpenMatch }) {
  const [form, setForm] = useState(EMPTY);
  const [verdict, setVerdict] = useState(null);
  const [checking, setChecking] = useState(false);
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const checked = useRef('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const check = async () => {
    const name = form.name.trim();
    const key = `${name}|${form.domain.trim()}`;
    if (!name || key === checked.current) return;
    checked.current = key;
    setChecking(true); setError(''); setForce(false);
    try {
      const { results } = await hkPost(businessId, '/brands/check', [{ name, domain: form.domain.trim() || undefined }]);
      setVerdict(results[0]);
    } catch (e) { setError(e.message); setVerdict(null); }
    finally { setChecking(false); }
  };

  const view = verdictView(verdict, { members, brandName: form.name });
  const rule = saveRule(view, { force });
  const save = async claim => {
    if (!form.name.trim()) { setError('Name is required.'); return; }
    setBusy(true); setError('');
    try {
      const body = { name: form.name.trim(), domain: form.domain.trim() || undefined, category: form.category.trim() || undefined, is_local: form.is_local, neighborhood: form.neighborhood.trim() || undefined, notes: form.notes.trim() || undefined, challenge_idea: form.challenge_idea.trim() || undefined, claim, force_duplicate: force || undefined };
      const { brand } = await hkPost(businessId, '/brands', body);
      onSaved(brand);
    } catch (e) {
      if (e.verdict) { setVerdict(e.verdict); checked.current = `${form.name.trim()}|${form.domain.trim()}`; }
      setError(e.message);
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="hk-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="hk-modal" role="dialog" aria-modal="true" aria-labelledby="hk-add-brand-title" data-hk-add-brand>
        <h2 id="hk-add-brand-title" className="hk-modal__title">Add brand</h2>
        <form className="hk-form" onSubmit={e => { e.preventDefault(); if (rule.canSave) save(false); }}>
          <Field label="Name" htmlFor="hk-brand-name">
            <input id="hk-brand-name" className="ui-input" value={form.name} autoFocus maxLength={160} onChange={e => set('name', e.target.value)} onBlur={check} />
          </Field>
          <Field label="Domain" htmlFor="hk-brand-domain" hint="brand.com, no www">
            <input id="hk-brand-domain" className="ui-input" value={form.domain} onChange={e => set('domain', e.target.value)} onBlur={check} />
          </Field>
          <Field label="Category" htmlFor="hk-brand-category">
            <input id="hk-brand-category" className="ui-input" value={form.category} maxLength={80} onChange={e => set('category', e.target.value)} />
          </Field>
          <ToggleRow label="Local Chicago?" help="On for a Chicago storefront or venue" checked={form.is_local} onChange={v => set('is_local', v)} />
          <Field label="Neighborhood" htmlFor="hk-brand-neighborhood">
            <input id="hk-brand-neighborhood" className="ui-input" value={form.neighborhood} maxLength={80} onChange={e => set('neighborhood', e.target.value)} />
          </Field>
          <Field label="Notes" htmlFor="hk-brand-notes">
            <textarea id="hk-brand-notes" className="ui-input" rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} />
          </Field>
          <Field label="Challenge idea" htmlFor="hk-brand-idea">
            <textarea id="hk-brand-idea" className="ui-input" rows={2} value={form.challenge_idea} onChange={e => set('challenge_idea', e.target.value)} />
          </Field>
          <VerdictBanner verdict={verdict} checking={checking} members={members} brandName={form.name} onOpenMatch={onOpenMatch} onForce={() => setForce(f => !f)} forced={force} />
          {error && <p className="hk-error" role="alert">{error}</p>}
          <ButtonRow align="between">
            <Button variant="tertiary" onClick={onClose}>Cancel</Button>
            <span style={{ display: 'inline-flex', gap: 8 }}>
              <Button type="submit" variant="secondary" disabled={!rule.canSave || busy} disabledReason={rule.why}>{rule.label}</Button>
              <Button variant="primary" disabled={!rule.canSave || busy} disabledReason={rule.why} onClick={() => save(true)}>{force ? 'Save anyway and claim' : 'Save and claim'}</Button>
            </span>
          </ButtonRow>
        </form>
      </div>
    </>
  );
}
