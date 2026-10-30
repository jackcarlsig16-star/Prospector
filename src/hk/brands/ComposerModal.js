import React, { useEffect, useState } from 'react';
import Field from '../../ui/Field';
import Button, { ButtonRow } from '../../ui/Button';
import { hkGet, hkPost } from '../hkApi';
import { useSheetConfirm, claimAsking } from './sheetConfirm';
import { canSave, kindsAvailable, subjectFor, contactWithEmail, KIND_OPTIONS } from './composerRules';

// hkos-gmail-connect-v1 G8 (PROPOSED) - the minimal composer so the loop can run before the Claude connector exists.
// Run lint asks the server; Save to Gmail Drafts opens only after a clean lint on the text that was linted. Nothing in
// here sends, and the contact's address never appears: the server reads it from hk_contacts.
export default function ComposerModal({ businessId, brand, contacts, touches, gmail, onClose, onSaved }) {
  const kinds = kindsAvailable(touches);
  const [settings, setSettings] = useState(null);
  const [kind, setKind] = useState('cold');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [lint, setLint] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const contact = contactWithEmail(contacts);
  const sheet = useSheetConfirm();
  useEffect(() => { hkGet(businessId, '/settings').then(d => { setSettings(d); setSubject(s => s || subjectFor(d.settings?.subject_format, brand.name)); }).catch(e => setError(e.message)); }, [businessId, brand.name]);
  useEffect(() => { const onKey = e => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey); }, [onClose]);
  const text = `${kind}\n${subject}\n${body}`;
  const gate = canSave({ linted: !!lint, problems: lint?.problems, lintedText: lint?.text, currentText: text, hasRecipient: !!contact });
  const runLint = async () => { setBusy('lint'); setError(''); try { const r = await hkPost(businessId, '/drafts/lint', { subject, body_markdown: body, kind, channel: 'email' }); setLint({ ...r, text }); } catch (e) { setError(e.message); } finally { setBusy(''); } };
  const save = async () => {
    setBusy('save'); setError('');
    try { const r = await claimAsking(sheet.confirm, extra => hkPost(businessId, '/drafts', { brand_id: brand.id, contact_id: contact?.id, channel: 'email', kind, subject, body_markdown: body, ...extra })); if (r) onSaved(r); }
    catch (e) { if (e.status === 422 && e.problems) setLint({ problems: e.problems, lint_passed: false, text }); setError(e.message); }
    finally { setBusy(''); }
  };
  const mailboxOk = gmail?.mailbox?.linked && gmail.mailbox.state === 'ok';
  return (
    <>
      <div className="hk-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="hk-modal hk-modal--wide" role="dialog" aria-modal="true" aria-labelledby="hk-composer-title" data-hk-composer>
        <h2 id="hk-composer-title" className="hk-modal__title">Draft email to {brand.name}</h2>
        {!mailboxOk && <p className="hk-banner hk-banner--mustard" data-hk-composer-mailbox><span className="hk-banner__title">{gmail?.mailbox?.linked ? 'Reconnect your HumanKind Gmail on Connections first.' : 'Link your HumanKind Gmail on Connections first.'}</span></p>}
        <div className="hk-form">
          <Field label="To" htmlFor="hk-comp-to" hint="The address stays on the server; only the name shows here.">
            <input id="hk-comp-to" className="ui-input" value={contact ? `${contact.name}${contact.title ? ` (${contact.title})` : ''}` : ''} placeholder="no contact with an email yet" readOnly data-hk-composer-to />
          </Field>
          {!contact && <p className="hk-error" role="alert" data-hk-composer-block>This brand has no contact with an email yet. Add one under Contacts.</p>}
          <Field label="Kind" htmlFor="hk-comp-kind" hint={kinds.length === 1 ? 'Bump, final and reply unlock after a sent email on this brand.' : undefined}>
            <select id="hk-comp-kind" className="ui-input" value={kind} onChange={e => setKind(e.target.value)}>{KIND_OPTIONS.filter(([k]) => kinds.includes(k)).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </Field>
          <Field label="Subject" htmlFor="hk-comp-subject"><input id="hk-comp-subject" className="ui-input" value={subject} maxLength={200} onChange={e => setSubject(e.target.value)} /></Field>
          <Field label="Body" htmlFor="hk-comp-body"><textarea id="hk-comp-body" className="ui-input" rows={12} value={body} onChange={e => setBody(e.target.value)} /></Field>
          {settings?.locked_rules?.length > 0 && <div className="hk-note" data-hk-composer-rules><strong>Locked rules:</strong> {settings.locked_rules.map(r => r.rule).join(' ')}</div>}
          {lint && (
            <div data-hk-lint-result>
              {lint.lint_passed || !(lint.problems || []).some(p => p.level !== 'warn') ? <p className="hk-banner hk-banner--green"><span className="hk-banner__title">Lint passed{(lint.problems || []).length ? ` (${lint.problems.length} note${lint.problems.length === 1 ? '' : 's'})` : ''}</span></p> : <p className="hk-banner hk-banner--block"><span className="hk-banner__title">{(lint.problems || []).filter(p => p.level !== 'warn').length} rule{(lint.problems || []).filter(p => p.level !== 'warn').length === 1 ? '' : 's'} to fix</span></p>}
              <ul className="hk-problems">{(lint.problems || []).map((p, i) => <li key={i} className={`hk-problem hk-problem--${p.level}`}><strong>{p.rule}</strong> {p.message} <span className="hk-meta">{p.excerpt}</span></li>)}</ul>
            </div>
          )}
          {error && <p className="hk-error" role="alert">{error}</p>}
          {sheet.node}
          <ButtonRow align="between">
            <Button variant="tertiary" onClick={onClose}>Cancel</Button>
            <span style={{ display: 'inline-flex', gap: 8 }}>
              <Button onClick={runLint} disabled={busy !== '' || !body.trim()} data-hk-run-lint>{busy === 'lint' ? 'Checking…' : 'Run lint'}</Button>
              <Button variant="primary" onClick={save} disabled={!gate.ok || !mailboxOk || busy !== ''} disabledReason={gate.why || 'Link your Gmail first'} data-hk-save-draft>Save to Gmail Drafts</Button>
            </span>
          </ButtonRow>
          <p className="hk-strip">Nothing here sends. The draft lands in your HumanKind Gmail Drafts for you to send.</p>
        </div>
      </div>
    </>
  );
}
