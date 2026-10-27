import React, { useCallback, useEffect, useRef, useState } from 'react';
import Segmented from '../../ui/Segmented';
import Button from '../../ui/Button';
import { Sprout } from '../HkMarks';
import { Chip } from '../brands/BrandsScreen';
import AddBrandModal from '../brands/AddBrandModal';
import { hkGet, hkPost, hkPatch, hkDelete } from '../hkApi';
import { relative } from '../hkSync';
import { Messages, BrandPanel, chipLabel, chipTone } from '../inbox/ThreadPane';
import { imagesDefault, gmailThreadUrl, fmtDate, REPLY_LABEL } from '../inbox/inboxPrefs';

// hkos-inbox-v1 (I3) - the signed-in founder's own HumanKind Gmail, read live through /inbox/*. Desktop: list, thread,
// brand panel; phone: list or thread, the panel folded under the messages. Reading writes nothing; the only actions
// are link / track / ignore / Mark handled (an existing reply row) and quick brand status. No compose, no Send.
const TABS = [{ id: 'inbox', label: 'Inbox' }, { id: 'brands', label: 'Brands only' }, { id: 'sent', label: 'Sent' }, { id: 'drafts', label: 'Drafts' }];
export const ONLY_YOU = 'Only you see your inbox.';

export default function InboxScreen({ businessId, shell, gmail, compact, canEdit, onOpenBrand, onOpenConnections, onUnread }) {
  const [tab, setTab] = useState('inbox');
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [list, setList] = useState(null);
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState('ok');
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);
  const [thread, setThread] = useState(null);
  const [threadError, setThreadError] = useState('');
  const [showImages, setShowImages] = useState(() => new Set());
  const [imagesByDefault] = useState(imagesDefault);
  const [busy, setBusy] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState('');
  const latest = useRef(0);
  const members = shell?.members || [];
  const mailboxEmail = gmail?.mailbox?.linked ? gmail.mailbox.email : null;

  const load = useCallback(async ({ pageToken = null, refresh = false, append = false } = {}) => {
    const n = ++latest.current;
    setLoading(true); setError('');
    try {
      const data = await hkGet(businessId, '/inbox/threads', { tab, q, pageToken, refresh: refresh ? '1' : '' });
      if (n !== latest.current) return;
      setState('ok');
      setList(prev => (append && prev ? { ...data, threads: [...prev.threads, ...data.threads] } : data));
      if (tab === 'inbox' && !pageToken && typeof data.unread === 'number') onUnread?.(data.unread);
    } catch (e) {
      if (n !== latest.current) return;
      if (e.status === 409 && /mailbox/.test(e.message) && !/Reconnect/.test(e.message)) setState('no_mailbox');
      else if (e.status === 409) setState('reconnect');
      else if (e.status === 403) { setState('forbidden'); setError(e.message); }
      else setError(e.message);
    } finally { if (n === latest.current) setLoading(false); }
  }, [businessId, tab, q, onUnread]);
  useEffect(() => { load(); }, [load]);

  const open = useCallback(async (id, { refresh = false } = {}) => {
    setOpenId(id); setThread(null); setThreadError(''); setCopied(false);
    try { setThread(await hkGet(businessId, `/inbox/threads/${id}`, { refresh: refresh ? '1' : '' })); } catch (e) { setThreadError(e.message); }
  }, [businessId]);

  const act = async fn => { setBusy(true); setNote(''); setError(''); try { await fn(); } catch (e) { setNote(e.message); } finally { setBusy(false); } };
  const link = () => act(async () => { await hkPost(businessId, `/inbox/threads/${openId}/link`, { brand_id: thread.brand.id }); setNote(`Linked to ${thread.brand.name}.`); await load({ refresh: true }); await open(openId, { refresh: true }); });
  const ignore = () => act(async () => { await hkPost(businessId, '/inbox/ignore', { domain: thread.sender.domain }); setNote(`Ignoring ${thread.sender.domain}.`); await load({ refresh: true }); await open(openId, { refresh: true }); });
  const unignore = () => act(async () => { await hkDelete(businessId, `/inbox/ignore/${encodeURIComponent(thread.sender.domain)}`); await load({ refresh: true }); await open(openId, { refresh: true }); });
  const status = (brandId, s) => act(async () => { await hkPatch(businessId, `/brands/${brandId}`, { status: s }); await open(openId, { refresh: true }); });
  const handled = () => act(async () => { await hkPatch(businessId, `/replies/${thread.unhandled_reply_id}`, { handled: true }); setNote('Marked handled.'); await open(openId, { refresh: true }); });
  const track = async body => { const r = await hkPost(businessId, '/inbox/track', { ...body, thread_id: openId }); return { brand: r.brand }; };
  const tracked = async brand => { setTracking(false); setNote(`Tracking ${brand.name}.`); await load({ refresh: true }); await open(openId, { refresh: true }); };
  const copyCmd = async () => { const cmd = `hk reply ${thread.brand.name}`; try { await navigator.clipboard.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setNote(`Copy failed. The command is: ${cmd}`); } };
  const showThreadImages = () => setShowImages(s => new Set([...s, openId]));
  const imagesOn = openId ? imagesByDefault || showImages.has(openId) : false;
  const back = () => { setOpenId(null); setThread(null); };

  if (state === 'no_mailbox') return <div className="hk-empty" data-hk-empty data-hk-inbox-state="no_mailbox"><Sprout size={40} /><p className="hk-empty__title">Link your HumanKind Gmail</p><p className="hk-empty__line">Your inbox reads live from the mailbox tethered to this workspace. Link it on Connections.</p><Button variant="primary" onClick={onOpenConnections}>Open Connections</Button></div>;
  if (state === 'forbidden') return <div className="hk-empty" data-hk-empty data-hk-inbox-state="forbidden"><Sprout size={40} /><p className="hk-empty__title">Members only</p><p className="hk-empty__line">A viewer has no mailbox here.</p></div>;

  const rows = list?.threads || [];
  const paneList = (
    <section className="hk-inbox__list" aria-label="Threads" data-hk-inbox-list>
      <div className="hk-inbox__tools">
        <Segmented label="Inbox tabs" items={TABS} value={tab} onChange={t => { setTab(t); setOpenId(null); setThread(null); }} />
        <form className="hk-inbox__search" onSubmit={e => { e.preventDefault(); setQ(input.trim()); }}>
          <input className="ui-input ui-input--sm hk-search-input" type="search" aria-label="Search Gmail" placeholder="Search Gmail, e.g. from:rumpl.com" value={input} onChange={e => setInput(e.target.value)} data-hk-inbox-search />
          <Button size="sm" variant="tertiary" disabled={loading} onClick={() => load({ refresh: true })} data-hk-inbox-refresh>Refresh</Button>
        </form>
      </div>
      {state === 'reconnect' && <p className="hk-banner hk-banner--mustard" data-hk-inbox-state="reconnect"><span className="hk-banner__title">Gmail needs reconnect.</span> <button type="button" className="hk-btn hk-link" onClick={onOpenConnections}>Open Connections</button></p>}
      {error && <p className="hk-banner hk-banner--mustard" role="alert" data-hk-inbox-error><span className="hk-banner__title">{list ? `Showing the list from ${relative(list.fetched_at)}.` : 'Gmail did not answer.'}</span> <span className="hk-banner__line">{error}</span> <button type="button" className="hk-btn hk-link" onClick={() => load({ refresh: true })}>Try again</button></p>}
      {list === null && !error && state === 'ok' && <p className="hk-meta" style={{ padding: '12px 4px' }}>Reading your Gmail…</p>}
      {list && !rows.length && <div className="hk-empty" data-hk-empty><Sprout size={32} /><p className="hk-empty__title">{q ? 'Nothing matches that search.' : tab === 'brands' ? 'No brand mail on this page.' : 'Your inbox is empty.'}</p><p className="hk-empty__line">{tab === 'brands' ? 'Threads from tracked or matching brands show here.' : 'Mail in your HumanKind Gmail shows here as it arrives.'}</p></div>}
      <ul className="hk-inbox__rows">
        {rows.map(t => (
          <li key={t.thread_id}>
            <button type="button" className={`hk-btn hk-inbox__row${t.thread_id === openId ? ' hk-inbox__row--on' : ''}${t.chip.kind === 'not_tracked' ? ' hk-inbox__row--dim' : ''}${t.unread ? ' hk-inbox__row--unread' : ''}`} onClick={() => open(t.thread_id)} aria-current={t.thread_id === openId ? 'true' : undefined} data-hk-thread={t.thread_id} data-hk-chip={t.chip.kind}>
              <span className="hk-inbox__row-top">{t.unread && <span className="hk-inbox__dot" aria-label="Unread" />}<span className="hk-inbox__from">{t.from_name}</span>{t.from_hint && t.from_hint !== t.from_name && <span className="hk-meta hk-inbox__hint">{t.from_hint}</span>}<span className="hk-spacer" /><span className="hk-meta">{fmtDate(t.date)}</span></span>
              <span className="hk-inbox__subject">{t.subject}</span>
              <span className="hk-meta hk-inbox__snippet">{t.snippet}</span>
              <span className="hk-inbox__chips">{t.chip.kind === 'not_tracked' ? <span className="hk-meta">Not tracked</span> : <Chip tone={chipTone(t.chip)}>{chipLabel(t.chip)}</Chip>}{t.chip.kind === 'tracked' && t.chip.label && <Chip tone="lilac">{REPLY_LABEL[t.chip.label] || t.chip.label}</Chip>}{t.has_attachments && <span className="hk-meta">Attachment</span>}</span>
            </button>
          </li>
        ))}
      </ul>
      {list?.next_page_token && <Button size="sm" disabled={loading} onClick={() => load({ pageToken: list.next_page_token, append: true })} data-hk-load-more>Load more</Button>}
      <p className="hk-meta hk-inbox__foot">{ONLY_YOU}</p>
    </section>
  );

  const paneThread = openId ? (
    <section className="hk-inbox__thread" aria-label="Thread" data-hk-inbox-thread>
      {compact && <button type="button" className="hk-btn hk-link" onClick={back} data-hk-inbox-back>Back to the list</button>}
      {threadError && <p className="hk-error" role="alert">{threadError}</p>}
      {!thread && !threadError && <p className="hk-meta">Opening…</p>}
      {thread && (
        <>
          <header className="hk-inbox__thread-head">
            <h2 className="hk-inbox__subject-title">{thread.subject || '(no subject)'}</h2>
            <div className="hk-inbox__actions">
              {mailboxEmail && <a className="ui-btn ui-btn--primary ui-btn--sm" href={gmailThreadUrl(mailboxEmail, thread.thread_id)} target="_blank" rel="noopener noreferrer" data-hk-reply-gmail>Reply in Gmail</a>}
              {thread.brand && <Button size="sm" onClick={copyCmd} data-hk-copy-command>{copied ? 'Copied' : 'Copy Claude command'}</Button>}
              {thread.unhandled_reply_id && canEdit && <Button size="sm" disabled={busy} onClick={handled} data-hk-mark-handled>Mark handled</Button>}
            </div>
            {note && <p className="hk-meta" role="status" data-hk-inbox-note>{note}</p>}
          </header>
          <Messages thread={thread} showImages={imagesOn} onShowImages={showThreadImages} gmailEmail={mailboxEmail} />
          {compact && <BrandPanel thread={thread} members={members} canEdit={canEdit} busy={busy} onOpenBrand={onOpenBrand} onStatus={status} onLink={link} onTrack={() => setTracking(true)} onIgnore={ignore} onUnignore={unignore} />}
        </>
      )}
    </section>
  ) : <section className="hk-inbox__thread hk-inbox__thread--empty" aria-label="Thread" data-hk-inbox-thread><p className="hk-meta">Pick a thread to read it here.</p></section>;

  return (
    <div className={`hk-inbox${compact ? ' hk-inbox--phone' : ''}`} data-hk-inbox>
      {compact ? (openId ? paneThread : paneList) : (
        <>
          {paneList}
          {paneThread}
          {thread ? <BrandPanel thread={thread} members={members} canEdit={canEdit} busy={busy} onOpenBrand={onOpenBrand} onStatus={status} onLink={link} onTrack={() => setTracking(true)} onIgnore={ignore} onUnignore={unignore} /> : <aside className="hk-inbox__panel hk-inbox__panel--empty" aria-hidden="true" />}
        </>
      )}
      {tracking && thread && <AddBrandModal businessId={businessId} members={members} title="Track as brand" initial={{ name: thread.sender.name === thread.sender.domain ? '' : thread.sender.name, domain: thread.sender.domain || '' }} onSave={track} onSaved={tracked} onClose={() => setTracking(false)} onOpenMatch={id => { setTracking(false); onOpenBrand(id); }} />}
    </div>
  );
}
