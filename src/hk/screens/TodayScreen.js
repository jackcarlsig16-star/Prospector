import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Button from '../../ui/Button';
import { Avatar, Sprout } from '../HkMarks';
import { Chip } from '../brands/BrandsScreen';
import { hkGet, hkPost, hkPatch, hkFetch } from '../hkApi';
import { AGING_DAYS } from './DraftsScreen';
import SignalsPanel from '../signals/SignalsPanel';

// hkos-daily-check-v1 J5 - Today, phone-first: the stats strip, the founders' mailbox state, the run buttons (owner
// role), then the morning's sections as cards that hide when empty - Urgent, Replies waiting, Drafts to review,
// Follow-ups with no draft, DM text ready - the data-warnings link and the "done yesterday" line. One read for the
// sections (GET jobs/today, a fresh digest from the current rows) plus the replies and drafts lists the other screens
// already serve (they carry the caller's own Gmail links). No Send control anywhere; nothing here shows an address.
const KIND = { cold: 'Cold', bump: 'Bump', final: 'Final', reply: 'Reply', dm_text: 'DM' };
const LABEL = { interested: 'Interested', pricing: 'Pricing', referral: 'Referral', decline: 'Decline', auto_reply: 'Auto reply', prefers_email: 'Prefers email', new_thread: 'New thread', other: 'Other' };
const REASON = { lint: 'The draft failed the outreach rules', no_contact: 'No contact with an email yet', reconnect: 'Reconnect Gmail to draft it', no_thread: 'No earlier sent email on this brand', gmail: 'Gmail did not accept the draft', no_mailbox: 'Link a HumanKind Gmail on Connections first', blocked: 'Blocked' };
const SNOOZE = [['1', 'Tomorrow'], ['3', 'In 3 days'], ['7', 'In a week']];
const fmtTime = iso => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '');
const fmtDate = iso => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// The nav badge: what needs a person today.
export const todayBadge = counts => (counts ? (counts.urgent || 0) + (counts.replies || 0) + (counts.drafts || 0) + (counts.no_draft || 0) + (counts.dm_ready || 0) : 0);
// The owner toggle on Today: 'me' = the caller's brands, 'all' = everyone, else one member. Unowned rows always show.
export const ownerMatch = (ownerUserId, owner, meId) => owner === 'all' || !ownerUserId || ownerUserId === (owner === 'me' ? meId : owner);
export const runLine = (run, ranToday) => (!run ? 'The daily check has not run yet.' : ranToday ? `Daily check ran today at ${fmtTime(run.finished_at || run.started_at)} (${run.trigger})${run.status === 'partial' ? ', with some items' : ''}.` : `Last daily check ${fmtDate(run.started_at)} (${run.trigger}). Not run yet today.`);

export default function TodayScreen({ businessId, shell, owner, compact, gmail, canEdit, onOpenBrand, onGo, onOpenConnections, onCounts, onSignalsSeen }) {
  const [today, setToday] = useState(null);
  const [replies, setReplies] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [preview, setPreview] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [copied, setCopied] = useState('');
  const me = shell?.me, members = shell?.members || [];
  const isOwnerRole = me?.role === 'owner';
  const member = id => members.find(m => m.user_id === id);
  const byName = name => members.find(m => m.first_name === name)?.user_id || null;
  const load = useCallback(async () => {
    setError('');
    try {
      const [t, r, d] = await Promise.all([hkGet(businessId, '/jobs/today'), hkGet(businessId, '/replies', { handled: 'false', owner: 'all' }), hkGet(businessId, '/drafts')]);
      setToday(t); setReplies(r.replies); setDrafts(d.drafts); onCounts?.(t.digest?.counts || null);
    } catch (e) { setError(e.message); setToday(t0 => t0 || { digest: null }); }
  }, [businessId, onCounts]);
  useEffect(() => { load(); }, [load]);
  const act = async (label, fn) => { setBusy(label); setError(''); try { await fn(); await load(); } catch (e) { setError(e.message); } finally { setBusy(''); } };
  const copy = async (key, text) => { try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(''), 1500); } catch { setError(`Copy failed. The text is: ${text}`); } };
  const runDaily = () => act('daily', async () => { const r = await hkPost(businessId, '/jobs/daily-check', {}); setNote(r.skipped ? `Already ran today (${r.run ? fmtTime(r.run.started_at) : ''}). Tomorrow's check will pick up anything new.` : `Daily check done: ${plural(r.counts.drafted, 'draft')} written, ${plural(r.counts.no_draft, 'follow-up')} without a draft, ${plural(r.counts.dm_texts, 'DM text')}, Slack ${r.counts.slack}.`); });
  const runSync = () => act('sync', async () => { const r = await hkPost(businessId, '/jobs/gmail-sync-all', {}); setNote(`Gmail synced for ${plural(r.counts.synced, 'mailbox')}${r.counts.reconnect ? `, ${r.counts.reconnect} need reconnect` : ''}.`); });

  const digest = today?.digest || null;
  const now = Date.now();
  const openReplies = useMemo(() => replies.filter(r => !r.handled && !(r.snoozed_until && Date.parse(r.snoozed_until) > now) && ownerMatch(r.brand_owner_user_id, owner, me?.user_id)), [replies, owner, me, now]);
  const urgent = openReplies.filter(r => r.urgent), waiting = openReplies.filter(r => !r.urgent);
  const draftRows = useMemo(() => drafts.filter(d => d.channel !== 'ig_dm' && ownerMatch(d.brand_owner_user_id, owner, me?.user_id)), [drafts, owner, me]);
  const noDraft = useMemo(() => (digest?.sections?.no_draft || []).filter(e => ownerMatch(byName(e.owner), owner, me?.user_id)), [digest, owner, me]); // eslint-disable-line react-hooks/exhaustive-deps
  const dmReady = useMemo(() => drafts.filter(d => d.channel === 'ig_dm' && ownerMatch(d.brand_owner_user_id, owner, me?.user_id)), [drafts, owner, me]);
  const reconnect = (today?.mailboxes || []).filter(m => m.state === 'needs_reconnect');
  const empty = !urgent.length && !waiting.length && !draftRows.length && !noDraft.length && !dmReady.length;
  const done = digest?.done_yesterday || { sent: 0, replies_handled: 0, meetings: 0 };
  const Owner = ({ id }) => { const m = member(id); return m ? <span className="hk-owner"><Avatar name={m.first_name} index={m.palette_index} size={20} />{m.first_name}</span> : <span className="hk-meta">Unclaimed</span>; };

  if (!today) return error ? <p className="hk-error" role="alert">{error}</p> : <p className="hk-meta">Loading today…</p>;
  return (
    <div className="hk-today" data-hk-today>
      {today.stats_stale && (
        <div className="hk-banner hk-banner--mustard" data-hk-stats-strip>
          <div className="hk-banner__text"><span className="hk-banner__title">Stats need a fresh confirmation</span><span className="hk-banner__line">Drafts quote the member and completion counts from Settings. Confirm them so the numbers stay true.</span></div>
          <div className="hk-banner__actions"><Button size="sm" variant="primary" onClick={() => onGo('settings', 'pitch')} data-hk-confirm-stats-link>Confirm stats</Button></div>
        </div>
      )}
      {reconnect.length > 0 && (
        <div className="hk-banner hk-banner--orange" role="alert" data-hk-reconnect-banner>
          <div className="hk-banner__text"><span className="hk-banner__title">Reconnect Gmail for {reconnect.map(m => m.first_name).join(' and ')}</span><span className="hk-banner__line">Follow-ups for their brands wait until the mailbox is reconnected.</span></div>
          <div className="hk-banner__actions"><Button size="sm" onClick={onOpenConnections}>Connections</Button></div>
        </div>
      )}
      {today.run?.status === 'error' && <div className="hk-banner hk-banner--block" role="alert" data-hk-run-error><div className="hk-banner__text"><span className="hk-banner__title">The last daily check failed</span><span className="hk-banner__line">{today.run.error || 'No detail recorded.'}</span></div></div>}
      <div className="hk-toolbar" data-hk-today-bar>
        <span className="hk-meta" data-hk-run-line>{runLine(today.run, today.ran_today)}</span>
        <span className="hk-spacer" />
        {isOwnerRole && <Button size="sm" disabled={!!busy} onClick={runSync} data-hk-sync-all>{busy === 'sync' ? 'Syncing…' : 'Sync Gmail now'}</Button>}
        {isOwnerRole && <Button size="sm" variant="primary" disabled={!!busy} onClick={runDaily} data-hk-run-daily>{busy === 'daily' ? 'Running…' : 'Run daily check now'}</Button>}
      </div>
      {note && <p className="hk-note" role="status" data-hk-run-note>{note}</p>}
      {error && <p className="hk-error" role="alert">{error}</p>}
      <SignalsPanel businessId={businessId} shell={shell} canEdit={canEdit} onOpenBrand={onOpenBrand} onGo={onGo} onSeen={onSignalsSeen} />
      {urgent.length > 0 && (
        <section className="hk-today__card hk-today__card--urgent" aria-label="Urgent" data-hk-section="urgent">
          <h2 className="hk-section-title">Urgent ({urgent.length})</h2>
          <div className="hk-rows">{urgent.map(r => (
            <div key={r.id} className="hk-row hk-row--wrap" data-hk-urgent={r.id}>
              <button type="button" className="hk-btn hk-table__title" onClick={() => onOpenBrand(r.brand_id)}>{r.brand_name}</button>
              <Chip tone={r.label === 'pricing' ? 'block' : 'green'}>{LABEL[r.label] || 'Reply'}</Chip>
              <Owner id={r.brand_owner_user_id} />
              <span className="hk-meta hk-today__summary">{r.summary}</span>
              {r.label === 'pricing' && <span className="hk-strip hk-today__strip" data-hk-pricing-strip>Do not quote pricing in the reply.</span>}
              <span className="hk-today__actions">
                {r.open_url ? <a className="ui-btn ui-btn--primary ui-btn--sm" href={r.open_url} target="_blank" rel="noopener noreferrer" data-hk-open-reply>Open in Gmail</a> : <span className="hk-meta">In {member(r.sender_user_id)?.first_name || 'a teammate'}'s inbox</span>}
                <Button size="sm" onClick={() => copy(`cmd-${r.id}`, `hk reply ${r.brand_name}`)}>{copied === `cmd-${r.id}` ? 'Copied' : 'Copy Claude command'}</Button>
                <Button size="sm" disabled={!!busy} onClick={() => act('handled', () => hkPatch(businessId, `/replies/${r.id}`, { handled: true }))} data-hk-mark-handled>Mark handled</Button>
              </span>
            </div>))}</div>
        </section>
      )}
      {waiting.length > 0 && (
        <section className="hk-today__card" aria-label="Replies waiting" data-hk-section="replies">
          <h2 className="hk-section-title">Replies waiting ({waiting.length})</h2>
          <div className="hk-rows">{waiting.map(r => (
            <div key={r.id} className="hk-row hk-row--wrap" data-hk-waiting={r.id}>
              <button type="button" className="hk-btn hk-table__title" onClick={() => onOpenBrand(r.brand_id)}>{r.brand_name}</button>
              <Chip tone="grey">{LABEL[r.label] || 'Reply'}</Chip>
              <Owner id={r.brand_owner_user_id} />
              <span className="hk-meta hk-today__summary">{r.summary}</span>
              <span className="hk-today__actions">
                {r.open_url && <a className="ui-btn ui-btn--secondary ui-btn--sm" href={r.open_url} target="_blank" rel="noopener noreferrer">Open in Gmail</a>}
                <select className="ui-input ui-input--sm" aria-label={`Set status for ${r.brand_name}`} defaultValue="" disabled={!!busy} onChange={e => { const v = e.target.value; e.target.value = ''; if (v) act('status', () => hkPatch(businessId, `/brands/${r.brand_id}`, { status: v })); }}><option value="">Set status</option><option value="meeting">Meeting</option><option value="signed">Signed</option><option value="passed">Passed</option></select>
                <select className="ui-input ui-input--sm" aria-label={`Snooze ${r.brand_name}`} defaultValue="" disabled={!!busy} onChange={e => { const v = e.target.value; e.target.value = ''; if (v) act('snooze', () => hkPatch(businessId, `/replies/${r.id}`, { snoozed_until: new Date(Date.now() + Number(v) * 86400e3).toISOString() })); }}><option value="">Snooze</option>{SNOOZE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                <Button size="sm" disabled={!!busy} onClick={() => act('handled', () => hkPatch(businessId, `/replies/${r.id}`, { handled: true }))}>Mark handled</Button>
              </span>
            </div>))}</div>
        </section>
      )}
      {draftRows.length > 0 && (
        <section className="hk-today__card" aria-label="Drafts to review" data-hk-section="drafts">
          <h2 className="hk-section-title">Drafts to review ({draftRows.length})</h2>
          <div className="hk-rows">{draftRows.map(d => (
            <div key={d.id} className="hk-row hk-row--wrap" data-hk-draft-row={d.id}>
              <button type="button" className="hk-btn hk-table__title" onClick={() => onOpenBrand(d.brand_id)}>{d.brand_name}</button>
              <Chip tone={d.kind === 'cold' ? 'blue' : 'lilac'}>{KIND[d.kind] || d.kind}</Chip>
              <span className="hk-meta">{d.created_by === 'system' ? 'Written by the daily check' : d.created_by === 'claude' ? 'Written by Claude' : `By ${member(d.sender_user_id)?.first_name || 'a founder'}`}</span>
              <span className={d.age_days > AGING_DAYS ? 'hk-chip hk-chip--mustard' : 'hk-meta'}>{d.age_days > AGING_DAYS ? `${d.age_days} d, aging` : `${d.age_days} d`}</span>
              <span className="hk-today__actions">
                {d.gmail_draft_url ? <a className="ui-btn ui-btn--primary ui-btn--sm" href={d.gmail_draft_url} target="_blank" rel="noopener noreferrer" data-hk-open-draft>Open in Gmail</a> : <Button size="sm" variant="primary" disabled disabledReason={d.mine ? 'No Gmail draft id yet' : "In another founder's mailbox"}>Open in Gmail</Button>}
                <Button size="sm" onClick={async () => { try { const { touch } = await hkGet(businessId, `/drafts/${d.id}`); setPreview(touch); } catch (e) { setError(e.message); } }}>Preview</Button>
                <Button size="sm" variant="danger" disabled={(!d.mine && !isOwnerRole) || !!busy} disabledReason="Only the sender or an owner-role member" onClick={() => setConfirm({ id: d.id, what: 'draft' })}>Discard</Button>
              </span>
            </div>))}</div>
        </section>
      )}
      {noDraft.length > 0 && (
        <section className="hk-today__card hk-today__card--mustard" aria-label="Follow-ups with no draft" data-hk-section="no_draft">
          <h2 className="hk-section-title">Follow-ups with no draft ({noDraft.length})</h2>
          <div className="hk-rows">{noDraft.map((e, i) => (
            <div key={`${e.brand_id}-${i}`} className="hk-row hk-row--wrap" data-hk-no-draft={e.brand_id}>
              <button type="button" className="hk-btn hk-table__title" onClick={() => onOpenBrand(e.brand_id)}>{e.brand_name}</button>
              <Chip tone="lilac">{KIND[e.kind] || e.kind} due</Chip>
              {e.owner && <Chip tone="grey">{e.owner}</Chip>}
              <span className="hk-meta hk-today__summary">{REASON[e.reason] || e.reason_text || e.reason}{e.detail ? `: ${e.detail}` : ''}</span>
              <span className="hk-today__actions">
                <Button size="sm" variant="primary" disabled={!!busy} onClick={() => act('retry', async () => { const r = await hkPost(businessId, '/jobs/retry-draft', { brand_id: e.brand_id }); setNote(r.drafted ? `Draft written for ${e.brand_name}.` : `Still no draft for ${e.brand_name}: ${REASON[r.reason] || r.reason}${r.detail ? ` (${r.detail})` : ''}.`); })} data-hk-retry-draft>Retry draft</Button>
                <Button size="sm" onClick={() => copy(`nd-${e.brand_id}`, `hk ${e.kind} ${e.brand_name}`)}>{copied === `nd-${e.brand_id}` ? 'Copied' : 'Copy Claude command'}</Button>
                <Button size="sm" variant="tertiary" disabled={!!busy} onClick={() => act('skip', () => hkPost(businessId, '/jobs/skip-touch', { brand_id: e.brand_id }))} data-hk-skip-touch>Skip this touch</Button>
              </span>
            </div>))}</div>
        </section>
      )}
      {dmReady.length > 0 && (
        <section className="hk-today__card" aria-label="DM text ready" data-hk-section="dm_ready">
          <h2 className="hk-section-title">DM text ready ({dmReady.length})</h2>
          <div className="hk-rows">{dmReady.map(d => (
            <div key={d.id} className="hk-row hk-row--wrap" data-hk-dm={d.id}>
              <button type="button" className="hk-btn hk-table__title" onClick={() => onOpenBrand(d.brand_id)}>{d.brand_name}</button>
              <Chip tone="lilac">Instagram DM</Chip>
              <Owner id={d.brand_owner_user_id} />
              <span className="hk-today__actions">
                <Button size="sm" variant="primary" onClick={async () => { try { const { touch } = await hkGet(businessId, `/drafts/${d.id}`); await copy(`dm-${d.id}`, touch.body_text || ''); } catch (e) { setError(e.message); } }} data-hk-copy-dm>{copied === `dm-${d.id}` ? 'Copied' : 'Copy DM'}</Button>
                <Button size="sm" disabled={!!busy} onClick={() => act('dm-sent', () => hkPost(businessId, `/drafts/${d.id}/dm-sent`, {}))} data-hk-dm-sent>Mark DM sent</Button>
                <Button size="sm" variant="tertiary" disabled={!!busy} onClick={() => setConfirm({ id: d.id, what: 'dm' })}>Skip</Button>
              </span>
            </div>))}</div>
        </section>
      )}
      {empty && (
        <div className="hk-empty" data-hk-empty>
          <Sprout size={40} />
          <p className="hk-empty__title">Nothing needs you right now.</p>
          <p className="hk-empty__line">Replies, drafts and due follow-ups land here each morning.</p>
          <Button onClick={() => copy('batch', 'hk batch 15')} data-hk-find-brands>{copied === 'batch' ? 'Copied' : 'Find new brands'}</Button>
        </div>
      )}
      <p className="hk-meta hk-today__foot" data-hk-today-foot>
        {digest?.data_warnings ? <><button type="button" className="hk-btn hk-link" onClick={() => onGo('review')} data-hk-warnings-link>{plural(digest.data_warnings, 'data warning')}</button> · </> : null}
        Done yesterday: {done.sent} sent · {done.replies_handled} replies handled · {done.meetings} meetings
      </p>
      {preview && (
        <>
          <div className="hk-backdrop" onClick={() => setPreview(null)} aria-hidden="true" />
          <div className="hk-modal" role="dialog" aria-modal="true" aria-label="Draft preview" data-hk-preview>
            <h2 className="hk-modal__title">{preview.subject || 'Instagram DM'}</h2>
            <pre className="hk-pre">{preview.body_text}</pre>
            <Button variant="tertiary" onClick={() => setPreview(null)}>Close</Button>
          </div>
        </>
      )}
      {confirm && (
        <>
          <div className="hk-backdrop" onClick={() => setConfirm(null)} aria-hidden="true" />
          <div className="hk-modal" role="dialog" aria-modal="true" aria-label="Confirm" data-hk-discard-confirm>
            <h2 className="hk-modal__title">{confirm.what === 'dm' ? 'Skip this DM?' : 'Discard this draft?'}</h2>
            <p>{confirm.what === 'dm' ? 'The DM text is dropped. The brand keeps its email sequence.' : "This deletes the draft in Gmail and marks the touch discarded. The brand's next follow-up is unchanged."}</p>
            <span style={{ display: 'inline-flex', gap: 8 }}><Button variant="danger" disabled={!!busy} onClick={() => act('discard', async () => { await hkFetch(businessId, `/drafts/${confirm.id}`, { method: 'DELETE' }); setConfirm(null); })}>{confirm.what === 'dm' ? 'Skip' : 'Discard'}</Button><Button variant="tertiary" onClick={() => setConfirm(null)}>Cancel</Button></span>
          </div>
        </>
      )}
    </div>
  );
}
