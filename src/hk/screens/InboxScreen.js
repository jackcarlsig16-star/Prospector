import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Tabs from '../../ui/Tabs';
import Button from '../../ui/Button';
import { Sprout } from '../HkMarks';
import AddBrandModal from '../brands/AddBrandModal';
import { hkGet, hkPost, hkPatch, hkDelete } from '../hkApi';
import { relative } from '../hkSync';
import { Messages } from '../inbox/ThreadPane';
import IntelStrip from '../inbox/IntelCard';
import { ThreadRow, OtherGroups, groupOther } from '../inbox/InboxRows';
import { imagesDefault, gmailThreadUrl } from '../inbox/inboxPrefs';
import useMediaQuery from '../../utils/useMediaQuery';
import { HK_INBOX } from '../hkTheme';

// hkos-inbox-v1 (I3) / hkos-inbox-v2 - the signed-in founder's own HumanKind Gmail, read live through /inbox/*.
// v2: lanes (Needs you · Brands · Other · Sent · Drafts; Needs you and Other share one INBOX page), the intel card +
// Analyze at the top of the reader, and a layout that stays with you: from 1100 px the list and the reader scroll on
// their own inside the window (opening a thread never scrolls the page; J / K move), 760-1099 the reader is a drawer
// over the list, under 760 one pane at a time. Gmail busy: the last list with a plain line and ONE retry after the
// server's retry_after_ms. Reading writes nothing; no compose, no Send.
const LANES = [['needs_you', 'Needs you'], ['brands', 'Brands'], ['other', 'Other'], ['sent', 'Sent'], ['drafts', 'Drafts']];
const SOURCE = { needs_you: 'inbox', other: 'inbox', brands: 'brands', sent: 'sent', drafts: 'drafts' };
export const ONLY_YOU = 'Only you see your inbox.';
const FIT_GAP = 16;
const MIN_PANES = 420;
const dedupe = rows => { const seen = new Set(); return rows.filter(r => (seen.has(r.thread_id) ? false : seen.add(r.thread_id))); };
const typing = t => !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
// hkos-inbox-list-width W1: the list column width the user dragged to, per browser (px; absent = HK_INBOX.listShare).
const LIST_W_KEY = 'prospector_hk_inbox_list_w';
const readListW = () => { try { const v = Number(localStorage.getItem(LIST_W_KEY)); return Number.isFinite(v) && v > 0 ? v : null; } catch { return null; } };
const writeListW = v => { try { localStorage.setItem(LIST_W_KEY, String(v)); } catch { /* private mode */ } };

export default function InboxScreen({ businessId, shell, gmail, compact, canEdit, onOpenBrand, onOpenConnections, onUnread }) {
  const [lane, setLane] = useState('needs_you');
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [lists, setLists] = useState({});
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState('ok');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [openId, setOpenId] = useState(null);
  const [thread, setThread] = useState(null);
  const [threadError, setThreadError] = useState('');
  const [threadNotice, setThreadNotice] = useState('');
  const [showImages, setShowImages] = useState(() => new Set());
  const [imagesByDefault] = useState(imagesDefault);
  const [busy, setBusy] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState('');
  const [height, setHeight] = useState(null);
  const [panesW, setPanesW] = useState(0);
  const [listW, setListW] = useState(readListW);
  const laneRef = useRef(lane);
  laneRef.current = lane;
  const filled = useRef(new Set());
  const latest = useRef(0);
  const openRef = useRef(null);
  const orderRef = useRef([]);
  const retried = useRef(new Set());
  const timers = useRef([]);
  const panesRef = useRef(null);
  const listRef = useRef(null);
  const readerRef = useRef(null);
  const small = useMediaQuery('(max-width: 759px)');
  const narrow = useMediaQuery('(max-width: 1099px)');
  const mode = compact || small ? 'phone' : narrow ? 'drawer' : 'split';
  const source = SOURCE[lane];
  const members = shell?.members || [];
  const mailboxEmail = gmail?.mailbox?.linked ? gmail.mailbox.email : null;

  // One automatic retry per list / thread while Gmail is busy, after the server's retry_after_ms.
  const retryOnce = useCallback((key, ms, fn) => {
    if (retried.current.has(key)) return;
    retried.current.add(key);
    timers.current.push(setTimeout(fn, ms || 60_000));
  }, []);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const load = useCallback(async ({ pageToken = null, refresh = false, append = false } = {}) => {
    const n = ++latest.current;
    const key = `list:${source}:${q}`;
    if (refresh) { retried.current.delete(key); filled.current.delete(key); }
    setLoading(true); setError('');
    try {
      const data = await hkGet(businessId, '/inbox/threads', { tab: source, q, pageToken, refresh: refresh ? '1' : '' });
      if (n !== latest.current) return;
      setState('ok');
      setLists(prev => ({ ...prev, [source]: append && prev[source] ? { ...data, threads: dedupe([...prev[source].threads, ...data.threads]) } : data }));
      setNotice(data.busy ? data.notice : '');
      if (data.busy) retryOnce(key, data.retry_after_ms, () => loadRef.current());
      // W3: a first page that leaves the lane short fetches ONE more page, then stops (Load more stays for the rest).
      const shown = source === 'inbox' ? data.threads.filter(t => t.lane === laneRef.current).length : data.threads.length;
      if (!pageToken && source !== 'brands' && data.next_page_token && shown < HK_INBOX.fillRows && !filled.current.has(key)) {
        filled.current.add(key);
        loadRef.current({ pageToken: data.next_page_token, append: true });
      }
      if (source === 'inbox' && !pageToken && typeof data.unread === 'number') onUnread?.(data.unread);
    } catch (e) {
      if (n !== latest.current) return;
      if (e.status === 409 && /mailbox/.test(e.message) && !/Reconnect/.test(e.message)) setState('no_mailbox');
      else if (e.status === 409) setState('reconnect');
      else if (e.status === 403) { setState('forbidden'); setError(e.message); }
      else if (e.body?.busy) { setNotice(e.message); retryOnce(key, e.body.retry_after_ms, () => loadRef.current()); }
      else setError(e.message);
    } finally { if (n === latest.current) setLoading(false); }
  }, [businessId, source, q, onUnread, retryOnce]);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => { load(); }, [load]);

  const open = useCallback(async (id, { refresh = false, again = false } = {}) => {
    const other = openRef.current !== id;
    openRef.current = id;
    setOpenId(id);
    if (other) setNote('');
    if (!again) { setThread(null); setThreadError(''); setThreadNotice(''); setCopied(false); }
    if (readerRef.current) readerRef.current.scrollTop = 0;
    try {
      const t = await hkGet(businessId, `/inbox/threads/${id}`, { refresh: refresh ? '1' : '' });
      if (openRef.current !== id) return;
      setThread(t); setThreadNotice(t.busy ? t.notice : '');
      if (t.busy) retryOnce(`thread:${id}`, t.retry_after_ms, () => { if (openRef.current === id) openAgain.current(id); });
    } catch (e) {
      if (openRef.current !== id) return;
      if (e.body?.busy) { setThreadNotice(e.message); retryOnce(`thread:${id}`, e.body.retry_after_ms, () => { if (openRef.current === id) openAgain.current(id); }); } else setThreadError(e.message);
    }
  }, [businessId, retryOnce]);
  const openAgain = useRef(null);
  openAgain.current = id => open(id, { again: true });

  const list = lists[source] || null;
  const all = list?.threads || [];
  const rows = lane === 'needs_you' || lane === 'other' ? all.filter(t => t.lane === lane) : all;
  const groups = lane === 'other' ? groupOther(rows) : null;
  orderRef.current = groups ? groups.flatMap(g => g.rows.map(t => t.thread_id)) : rows.map(t => t.thread_id);
  const inboxRows = lists.inbox?.threads || [];
  const counts = {
    needs_you: lists.inbox ? inboxRows.filter(t => t.lane === 'needs_you').length : null,
    other: lists.inbox ? inboxRows.filter(t => t.lane === 'other').length : null,
    brands: lists.brands ? `${lists.brands.threads.length}${lists.brands.more ? '+' : ''}` : lists.inbox ? inboxRows.filter(t => t.chip.kind === 'tracked' || t.chip.kind === 'matches').length : null,
  };

  // The panes fill the window under the page header so each scrolls on its own and the page itself does not.
  useLayoutEffect(() => {
    if (mode === 'phone') { setHeight(null); return undefined; }
    // Fill to the window first, then give back whatever the shell keeps under the panes (its padding) if the page overflows.
    const fit = () => {
      const el = panesRef.current; if (!el) return;
      setPanesW(Math.round(el.getBoundingClientRect().width));
      const want = Math.floor(window.innerHeight - (el.getBoundingClientRect().top + window.scrollY) - FIT_GAP);
      el.style.height = `${want}px`;
      const over = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      setHeight(Math.max(MIN_PANES, want - over));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [mode, state]);

  // W1: the list takes listShare of the panes (or the dragged width), held to listMin..listMax and to what leaves the
  // reader readerMin. The divider drags it; ← / → move it by step; the choice is remembered.
  const clampW = w => Math.round(Math.max(HK_INBOX.listMin, Math.min(HK_INBOX.listMax, w, panesW - HK_INBOX.readerMin - HK_INBOX.divider)));
  const width = mode === 'split' && panesW ? clampW(listW ?? panesW * HK_INBOX.listShare) : null;
  const dragTo = (w, save) => { const c = clampW(w); setListW(c); if (save) writeListW(c); };
  const startDrag = e => {
    e.preventDefault();
    // Move by the pointer's travel, so the column does not jump to where the divider was grabbed.
    const x0 = e.clientX, w0 = width;
    let last = width;
    const move = ev => { last = w0 + ev.clientX - x0; dragTo(last, false); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); dragTo(last, true); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const onDividerKey = e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    dragTo(width + (e.key === 'ArrowRight' ? HK_INBOX.step : -HK_INBOX.step), true);
  };

  // Keep a row in view inside the list pane without moving the page.
  const reveal = id => {
    const pane = listRef.current; const row = pane?.querySelector(`[data-hk-thread="${id}"]`);
    if (!pane || !row) return;
    const p = pane.getBoundingClientRect(), r = row.getBoundingClientRect();
    if (r.top < p.top) pane.scrollTop -= p.top - r.top; else if (r.bottom > p.bottom) pane.scrollTop += r.bottom - p.bottom;
    row.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (mode === 'phone') return undefined;
    const onKey = e => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      const k = e.key.toLowerCase(); if (k !== 'j' && k !== 'k') return;
      const ids = orderRef.current; if (!ids.length) return;
      e.preventDefault();
      const i = ids.indexOf(openRef.current);
      const next = k === 'j' ? ids[i < 0 ? 0 : Math.min(ids.length - 1, i + 1)] : ids[i < 0 ? 0 : Math.max(0, i - 1)];
      if (next !== openRef.current) { open(next); reveal(next); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mode, open]);

  const act = async fn => { setBusy(true); setNote(''); setError(''); try { await fn(); } catch (e) { setNote(e.message); } finally { setBusy(false); } };
  const link = () => act(async () => { await hkPost(businessId, `/inbox/threads/${openId}/link`, { brand_id: thread.brand.id }); setNote(`Linked to ${thread.brand.name}.`); await load({ refresh: true }); await open(openId, { refresh: true }); });
  const ignoreDomain = domain => act(async () => { await hkPost(businessId, '/inbox/ignore', { domain }); setNote(`Ignoring ${domain}.`); await load({ refresh: true }); if (openId) await open(openId, { refresh: true }); });
  const ignore = () => ignoreDomain(thread.sender.domain);
  const unignore = () => act(async () => { await hkDelete(businessId, `/inbox/ignore/${encodeURIComponent(thread.sender.domain)}`); await load({ refresh: true }); await open(openId, { refresh: true }); });
  const status = (brandId, s) => act(async () => { await hkPatch(businessId, `/brands/${brandId}`, { status: s }); await open(openId, { refresh: true }); });
  const handled = () => act(async () => { await hkPatch(businessId, `/replies/${thread.unhandled_reply_id}`, { handled: true }); setNote('Marked handled.'); await open(openId, { refresh: true }); });
  const track = async body => { const r = await hkPost(businessId, '/inbox/track', { ...body, thread_id: openId }); if (tracking === 'target') await hkPost(businessId, `/brands/${r.brand.id}/target`, { on: true }); return { brand: r.brand }; };
  const tracked = async brand => { setNote(tracking === 'target' ? `Tracking ${brand.name} and added it to Targets.` : `Tracking ${brand.name}.`); setTracking(false); await load({ refresh: true }); await open(openId, { refresh: true }); };
  const analyzed = intel => {
    setThread(t => (t ? { ...t, intel } : t));
    const fit = intel.intel?.fit?.sponsor_fit || null, domain = thread?.sender?.domain;
    setLists(prev => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, { ...v, threads: v.threads.map(t => (domain && t.from_domain === domain ? { ...t, intel_fit: fit } : t)) }])));
  };
  const copyCmd = async () => { const cmd = `hk reply ${thread.brand.name}`; try { await navigator.clipboard.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setNote(`Copy failed. The command is: ${cmd}`); } };
  const showThreadImages = () => setShowImages(s => new Set([...s, openId]));
  const imagesOn = openId ? imagesByDefault || showImages.has(openId) : false;
  const close = () => { openRef.current = null; setOpenId(null); setThread(null); };
  const pickLane = id => { setLane(id); close(); };

  if (state === 'no_mailbox') return <div className="hk-empty" data-hk-empty data-hk-inbox-state="no_mailbox"><Sprout size={40} /><p className="hk-empty__title">Link your HumanKind Gmail</p><p className="hk-empty__line">Your inbox reads live from the mailbox tethered to this workspace. Link it on Connections.</p><Button variant="primary" onClick={onOpenConnections}>Open Connections</Button></div>;
  if (state === 'forbidden') return <div className="hk-empty" data-hk-empty data-hk-inbox-state="forbidden"><Sprout size={40} /><p className="hk-empty__title">Members only</p><p className="hk-empty__line">A viewer has no mailbox here.</p></div>;

  const tools = (
    <div className="hk-inbox__tools" data-hk-inbox-tools>
      <Tabs label="Inbox lanes" items={LANES.map(([id, label]) => ({ id, label: counts[id] != null ? `${label} ${counts[id]}` : label }))} value={lane} onChange={pickLane} />
      <form className="hk-inbox__search" onSubmit={e => { e.preventDefault(); setQ(input.trim()); }}>
        <input className="ui-input ui-input--sm hk-search-input" type="search" aria-label="Search Gmail" placeholder="Search Gmail, e.g. from:rumpl.com" value={input} onChange={e => setInput(e.target.value)} data-hk-inbox-search />
        <Button size="sm" variant="tertiary" disabled={loading} onClick={() => load({ refresh: true })} data-hk-inbox-refresh>Refresh</Button>
      </form>
      {notice && <p className="hk-banner hk-banner--mustard" role="status" data-hk-inbox-busy><span className="hk-banner__title">{notice}</span></p>}
      {state === 'reconnect' && <p className="hk-banner hk-banner--mustard" data-hk-inbox-state="reconnect"><span className="hk-banner__title">Gmail needs reconnect.</span> <button type="button" className="hk-btn hk-link" onClick={onOpenConnections}>Open Connections</button></p>}
      {error && <p className="hk-banner hk-banner--mustard" role="alert" data-hk-inbox-error><span className="hk-banner__title">{list ? `Showing the list from ${relative(list.fetched_at)}.` : 'Gmail did not answer.'}</span> {error} <button type="button" className="hk-btn hk-link" onClick={() => load({ refresh: true })}>Try again</button></p>}
    </div>
  );

  const paneList = (
    <section className="hk-inbox__list" aria-label="Threads" data-hk-inbox-list ref={listRef}>
      {list === null && !error && !notice && state === 'ok' && <p className="hk-meta" style={{ padding: '12px 4px' }}>Reading your Gmail…</p>}
      {list && !rows.length && <div className="hk-empty" data-hk-empty><Sprout size={32} /><p className="hk-empty__title">{q ? 'Nothing matches that search.' : lane === 'needs_you' ? 'Nobody is waiting on you on this page.' : lane === 'brands' ? 'No brand mail yet.' : lane === 'other' ? 'No marketing or automated mail on this page.' : 'Nothing here yet.'}</p></div>}
      <ul className="hk-inbox__rows">
        {groups
          ? <OtherGroups groups={groups} openId={openId} onOpen={open} canEdit={canEdit} busy={busy} onIgnore={ignoreDomain} />
          : rows.map(t => <ThreadRow key={t.thread_id} t={t} on={t.thread_id === openId} onOpen={open} showDomain={mode !== 'split' || width == null || width >= HK_INBOX.domainAt} />)}
      </ul>
      {lists.brands?.more && lane === 'brands' && <p className="hk-meta" data-hk-brands-more>Showing the newest 25 brand threads. Search to find older ones.</p>}
      {list?.next_page_token && lane !== 'brands' && <Button size="sm" disabled={loading} onClick={() => load({ pageToken: list.next_page_token, append: true })} data-hk-load-more>Load more</Button>}
      <p className="hk-meta hk-inbox__foot">{ONLY_YOU}</p>
    </section>
  );

  const reader = openId ? (
    <section className={`hk-inbox__thread${mode === 'drawer' ? ' hk-inbox__drawer' : ''}`} aria-label="Thread" data-hk-inbox-thread ref={readerRef}>
      {mode !== 'split' && <button type="button" className="hk-btn hk-link" onClick={close} data-hk-inbox-back>{mode === 'phone' ? 'Back to the list' : 'Close'}</button>}
      {threadNotice && <p className="hk-banner hk-banner--mustard" role="status" data-hk-thread-busy><span className="hk-banner__title">{threadNotice}</span></p>}
      {threadError && <p className="hk-error" role="alert">{threadError}</p>}
      {!thread && !threadError && !threadNotice && <p className="hk-meta">Opening…</p>}
      {thread && (
        <>
          <IntelStrip key={thread.thread_id} businessId={businessId} thread={thread} members={members} canEdit={canEdit} busy={busy} onOpenBrand={onOpenBrand} onStatus={status} onLink={link}
            onTrack={() => setTracking(true)} onTrackTarget={() => setTracking('target')} meId={shell?.me?.user_id} onIgnore={ignore} onUnignore={unignore} onAnalyzed={analyzed} />
          {/* polish P2: one row - subject left, actions right - so the email starts right under it. */}
          <header className="hk-inbox__thread-head hk-inbox__thread-head--row">
            <h2 className="hk-inbox__subject-title" title={thread.subject || undefined}>{thread.subject || '(no subject)'}</h2>
            <div className="hk-inbox__actions">
              {mailboxEmail && <a className="ui-btn ui-btn--primary ui-btn--sm" href={gmailThreadUrl(mailboxEmail, thread.thread_id)} target="_blank" rel="noopener noreferrer" data-hk-reply-gmail>Reply in Gmail</a>}
              {thread.brand && <Button size="sm" onClick={copyCmd} data-hk-copy-command>{copied ? 'Copied' : 'Copy Claude command'}</Button>}
              {thread.unhandled_reply_id && canEdit && <Button size="sm" disabled={busy} onClick={handled} data-hk-mark-handled>Mark handled</Button>}
            </div>
          </header>
          {note && <p className="hk-meta" role="status" data-hk-inbox-note>{note}</p>}
          <Messages thread={thread} showImages={imagesOn} onShowImages={showThreadImages} gmailEmail={mailboxEmail} />
        </>
      )}
    </section>
  ) : mode === 'split' ? <section className="hk-inbox__thread hk-inbox__thread--empty" aria-label="Thread" data-hk-inbox-thread ref={readerRef}><p className="hk-meta">Pick a thread to read it here. J and K move through the list.</p></section> : null;

  return (
    <div className={`hk-inbox hk-inbox--${mode}${compact ? ' hk-inbox--phone' : ''}`} data-hk-inbox data-hk-inbox-mode={mode}>
      {!(mode === 'phone' && openId) && tools}
      <div className="hk-inbox__panes" ref={panesRef} style={{ ...(height ? { height } : {}), ...(width ? { '--hk-list-w': `${width}px` } : {}) }} data-hk-inbox-panes>
        {mode === 'phone' ? (openId ? reader : paneList) : mode === 'split' ? <>
          {paneList}
          <div role="separator" aria-orientation="vertical" aria-label="Resize the list" aria-valuenow={width || undefined} aria-valuemin={HK_INBOX.listMin} aria-valuemax={HK_INBOX.listMax}
            tabIndex={0} className="hk-inbox__divider" onPointerDown={startDrag} onKeyDown={onDividerKey} data-hk-divider />
          {reader}
        </> : <>{paneList}{reader}</>}
      </div>
      {tracking && thread && <AddBrandModal businessId={businessId} members={members} title={tracking === 'target' ? 'Track as brand + Target' : 'Track as brand'} initial={thread.intel?.prefill || { name: thread.sender.name === thread.sender.domain ? '' : thread.sender.name, domain: thread.sender.domain || '' }}
        onSave={track} onSaved={tracked} onClose={() => setTracking(false)} onOpenMatch={id => { setTracking(false); onOpenBrand(id); }} />}
    </div>
  );
}
