import React, { useEffect, useState } from 'react';
import Button from '../../ui/Button';
import Field from '../../ui/Field';
import ToggleRow from '../../ui/ToggleRow';
import { hkPatch, hkGet, hkDelete } from '../hkApi';
import { relative } from '../hkSync';
import { imagesDefault, setImagesDefault } from '../inbox/inboxPrefs';

// hkos-gmail-connect-v1 G8 - Settings > Connections in the HK theme: one row per founder, the caller's own mailbox
// state and Sync now, and the plain-text signature the server appends to drafts.
export default function ConnectionsSettings({ businessId, shell, gmail, syncing, onSync, onOpenConnections, onGmailChanged }) {
  const [sig, setSig] = useState(gmail?.signature_text || '');
  const [state, setState] = useState('');
  const [images, setImages] = useState(imagesDefault);
  const [ignored, setIgnored] = useState(null);
  const [ignoredError, setIgnoredError] = useState('');
  const loadIgnored = async () => { try { setIgnored((await hkGet(businessId, '/inbox/ignore')).domains); } catch (e) { setIgnored([]); setIgnoredError(e.message); } };
  useEffect(() => { loadIgnored(); }, [businessId]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleImages = v => { setImagesDefault(v); setImages(v); };
  const unignore = async domain => { setIgnoredError(''); try { await hkDelete(businessId, `/inbox/ignore/${encodeURIComponent(domain)}`); await loadIgnored(); } catch (e) { setIgnoredError(e.message); } };
  useEffect(() => { setSig(gmail?.signature_text || ''); }, [gmail?.signature_text]);
  const me = shell?.me;
  const members = (shell?.members || []).filter(m => m.user_id);
  const save = async () => { setState('Saving…'); try { await hkPatch(businessId, '/gmail/signature', { signature_text: sig.trim() || null }); setState('Saved'); onGmailChanged?.(); } catch (e) { setState(e.message); } };
  const lastSync = gmail?.sync_state?.last_synced_at || gmail?.last_run?.finished_at || null;
  return (
    <section aria-label="Connections" data-hk-connections>
      <h2 className="hk-section-title">Connections</h2>
      <div className="hk-rows">
        {members.map(m => { const mine = m.user_id === me?.user_id; return (
          <div key={m.user_id} className="hk-row hk-row--wrap" data-hk-mailbox-row={mine ? 'me' : 'other'}>
            <span className="hk-row__name">Gmail - {m.first_name}</span>
            {mine ? (
              <>
                <span className={gmail?.mailbox?.linked ? (gmail.mailbox.state === 'ok' ? 'hk-chip hk-chip--green' : 'hk-chip hk-chip--mustard') : 'hk-chip hk-chip--grey'}>{gmail?.mailbox?.linked ? (gmail.mailbox.state === 'ok' ? `Linked to ${gmail.mailbox.email}` : `Needs reconnect · ${gmail.mailbox.email}`) : 'Not linked'}</span>
                <span className="hk-meta">{lastSync ? `Last sync ${relative(lastSync)}` : 'Never synced'}{gmail?.last_run?.status === 'error' ? ` · last run failed${gmail.last_run.error ? `: ${gmail.last_run.error}` : ''}` : ''}</span>
                <span className="hk-row__end" style={{ gap: 8 }}>
                  <Button size="sm" variant="primary" disabled={!gmail?.mailbox?.linked || gmail.mailbox.state !== 'ok' || syncing} disabledReason="Link a working Gmail first" onClick={onSync} data-hk-sync-now>{syncing ? 'Syncing…' : 'Sync now'}</Button>
                  <Button size="sm" onClick={onOpenConnections} data-hk-manage-connections>Manage on Connections</Button>
                </span>
              </>
            ) : <span className="hk-meta">Links their own mailbox from their login.</span>}
          </div>); })}
      </div>
      <p className="hk-meta" style={{ marginTop: 10 }}>Teammates link their own mailbox from their login. A workspace never falls back to anyone's default Gmail.</p>
      <div className="hk-form" style={{ marginTop: 18, maxWidth: 520 }}>
        <Field label="Signature" htmlFor="hk-sig" hint="Plain text, first-name style. Gmail does not add your signature to drafts made here, so this is appended.">
          <textarea id="hk-sig" className="ui-input" rows={3} maxLength={400} value={sig} onChange={e => setSig(e.target.value)} data-hk-signature />
        </Field>
        <div className="hk-note" data-hk-signature-preview>Preview: <em>Worth a 15-minute call to see if it makes sense?</em><br />{(sig || 'Thanks,\nJack').split('\n').map((l, i) => <span key={i}>{l}<br /></span>)}</div>
        <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}><Button variant="primary" onClick={save} data-hk-save-signature>Save signature</Button><span className="hk-meta" role="status">{state}</span></span>
      </div>
      <div className="hk-form" style={{ marginTop: 22, maxWidth: 520 }} data-hk-inbox-options>
        <h3 className="hk-section-title" style={{ fontSize: 16 }}>Inbox options</h3>
        <ToggleRow label="Show images by default" help="Off keeps remote images and tracking pixels blocked until you click Show images on a thread. Saved on this device only." checked={images} onChange={toggleImages} />
        <div>
          <span className="hk-meta">Ignored senders</span>
          {ignoredError && <p className="hk-error" role="alert">{ignoredError}</p>}
          {ignored === null ? <p className="hk-meta">Loading…</p> : !ignored.length ? <p className="hk-meta" data-hk-ignored-empty>None yet. Ignore a sender from the Inbox and its mail dims here.</p> : (
            <ul className="hk-ignored" data-hk-ignored>{ignored.map(d => <li key={d.domain}><span>{d.domain}</span><Button size="sm" variant="tertiary" onClick={() => unignore(d.domain)} data-hk-unignore={d.domain}>Stop ignoring</Button></li>)}</ul>
          )}
        </div>
      </div>
    </section>
  );
}
