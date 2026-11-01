import React, { useState } from 'react';
import { Avatar, Icon } from '../HkMarks';
import { hkPatch } from '../hkApi';

// grow-ui-refresh-v1 U7 - the Brand page's Timeline card (mockup 2): Timeline n (every event, touch and reply) ·
// Emails n (email touches and replies) · Notes n (the brand's notes, one per line), with "Add a note" at the bottom - a
// note is a dated line added to the brand's notes (PATCH notes, Activity row as any edit).
const fmt = iso => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
export const ACTION_WORDS = {
  'brand.created': 'added the brand', 'brand.domain_used': 'saved the suggested website', 'brand.domain_rejected': 'marked the suggested website wrong', 'brand.domain_restored': 'undid Wrong site',
  'brand.claimed': 'claimed it', 'brand.released': 'released it', 'brand.status': 'set the status', 'brand.relationship': 'changed the relationship', 'brand.updated': 'edited', 'brand.merged': 'merged a duplicate into it',
  'brand.targeted': 'added it to Targets', 'brand.untargeted': 'took it off Targets', 'brand.snoozed': 'snoozed it for 14 days', 'brand.unsnoozed': 'unsnoozed it', 'brand.passed': 'marked it not a fit', 'brand.unpassed': 'undid Not a fit', 'brand.pass_reason': 'changed the not-a-fit reason',
  'touch.logged': 'logged', 'touch.unlogged': 'removed a logged activity', draft_created: 'saved a draft', 'contact.added': 'added a contact', 'contact.updated': 'edited a contact', 'sponsor.period_added': 'added a sponsor period', 'sponsor.period_removed': 'removed a sponsor period',
};
export const notesOf = brand => String(brand.notes || '').split('\n').map(l => l.trim()).filter(Boolean);

function Actor({ kind, userId, member }) {
  const m = userId ? member(userId) : null;
  if (m) return <span className="hk-owner"><Avatar name={m.first_name} index={m.palette_index} size={22} /><strong>{m.first_name}</strong></span>;
  return <span className="hk-owner"><span className="hk-avatar hk-avatar--system" style={{ width: 22, height: 22, fontSize: 11 }}>{kind === 'claude' ? 'C' : 'S'}</span><strong>{kind === 'claude' ? 'Claude' : 'System'}</strong></span>;
}

const touchWords = t => (t.kind === 'outside' ? `logged: ${t.subject || 'activity'}` : `${t.state === 'imported' ? 'sheet said drafted:' : t.state} ${t.kind === 'final' ? 'final nudge' : t.kind} ${t.channel === 'ig_dm' ? 'DM' : 'email'}`);

// grow-mailbox-link-v1 L6 - one entry per linked Gmail thread: who <-> them, n messages, who is waiting, the deal facts
// from the thread read, the summary (shared members only - the server sends existence + founder + date otherwise) and
// Open in Gmail for your own mailbox only.
const DEAL_WORDS = { interested: 'Interested', discussing: 'Discussing', scheduling: 'Scheduling', confirmed: 'Confirmed', declined: 'Declined', other: 'In conversation' };
const DEAL_TONE = { interested: 'green', discussing: 'mustard', scheduling: 'mustard', confirmed: 'green', declined: 'block', other: 'line' };
const monthWord = ym => (ym ? new Date(`${ym}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : '');
export function threadChips(t) {
  if (!t.shared) return null;
  return (
    <span className="hk-labels" data-hk-thread-facts>
      {t.deal_stage && <span className={`hk-label hk-label--${DEAL_TONE[t.deal_stage] || 'line'}`} data-hk-deal={t.deal_stage}>{DEAL_WORDS[t.deal_stage] || t.deal_stage}{t.deal_month ? ` · ${monthWord(t.deal_month)}` : ''}{t.deal_amount_usd != null ? ` · $${Number(t.deal_amount_usd).toLocaleString('en-US')}` : ''}</span>}
      {t.waiting_on === 'us' && <span className="hk-label hk-label--orange">Waiting on us{t.waiting_days ? ` · ${t.waiting_days} d` : ''}</span>}
      {t.waiting_on === 'them' && <span className="hk-label hk-label--grey">Waiting on them{t.waiting_days ? ` · ${t.waiting_days} d` : ''}</span>}
      {t.our_question_open && <span className="hk-label hk-label--line">Our question is open</span>}
    </span>
  );
}

export default function BrandTimeline({ businessId, brand, events, touches, replies, threads = [], member, mailbox, me, canEdit, onChanged }) {
  const [tab, setTab] = useState('timeline');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const own = mailbox?.linked ? mailbox.email : null;
  const gmailLink = t => (own && t.sender_user_id === me?.user_id && t.gmail_message_id ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(own)}#${t.state === 'drafted' ? 'drafts' : 'all'}/${encodeURIComponent(t.gmail_message_id)}` : null);
  const live = touches.filter(t => t.state !== 'discarded');
  const touchItems = live.map(t => ({ at: t.sent_at || t.drafted_at || t.created_at, key: `t-${t.id}`, actor: <Actor kind={t.created_by} userId={t.sender_user_id} member={member} />, text: touchWords(t), extra: t.kind === 'outside' ? '' : t.subject || '', link: gmailLink(t), email: t.channel === 'email' && t.kind !== 'outside' }));
  const replyItems = replies.map(r => ({ at: r.received_at, key: `r-${r.id}`, actor: <span className="hk-owner"><strong>{r.from_name || r.from_domain || 'Reply'}</strong></span>, text: `replied${r.label ? ` (${r.label.replace('_', ' ')})` : ''}`, extra: r.summary || '', email: true }));
  const eventItems = events.filter(e => e.action !== 'touch.logged' && e.action !== 'draft_created').map(e => ({ at: e.created_at, key: `e-${e.id}`, actor: <Actor kind={e.actor_kind} userId={e.actor_user_id} member={member} />, text: ACTION_WORDS[e.action] || e.action, extra: e.detail?.reason || e.detail?.note || (e.detail?.changed?.length ? e.detail.changed.join(', ') : '') }));
  const threadItems = threads.map(t => ({
    at: t.last_at, key: `th-${t.id}`, email: true, thread: true,
    actor: <Actor kind="system" userId={t.member_user_id} member={member} />,
    text: t.shared ? `${t.own ? 'You' : t.who || 'A teammate'} ↔ them · ${t.message_count} message${t.message_count === 1 ? '' : 's'}` : `${t.who || 'A teammate'} has a conversation with them`,
    extra: t.shared ? t.summary || '' : 'details are private to their mailbox',
    chips: threadChips(t),
    link: t.own && t.gmail_thread_id && own ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(own)}#all/${encodeURIComponent(t.gmail_thread_id)}` : null,
  }));
  const all = [...eventItems, ...touchItems, ...replyItems, ...threadItems].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const emails = [...touchItems, ...replyItems, ...threadItems].filter(i => i.email).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const notes = notesOf(brand);
  const tabs = [['timeline', `Timeline ${all.length}`], ['emails', `Emails ${emails.length}`], ['notes', `Notes ${notes.length}`]];
  const addNote = async e => {
    e.preventDefault(); setError('');
    const day = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    try { await hkPatch(businessId, `/brands/${brand.id}`, { notes: [`${day}: ${note.trim()}`, ...notes].join('\n') }); setNote(''); setTab('notes'); await onChanged(); } catch (err) { setError(err.message); }
  };
  const list = items => (items.length ? (
    <ol className="hk-tl" data-hk-timeline>
      {items.map(it => <li key={it.key} className="hk-tl__item" {...(it.thread ? { 'data-hk-thread': it.key } : {})}>{it.actor}<span className="hk-tl__text">{it.text}{it.extra ? <span className="hk-meta"> · {it.extra}</span> : null}{it.link ? <> · <a className="hk-link" href={it.link} target="_blank" rel="noopener noreferrer">Open in Gmail</a></> : null}{it.chips ? <span className="hk-tl__chips">{it.chips}</span> : null}</span><time className="hk-meta">{fmt(it.at)}</time></li>)}
    </ol>
  ) : <p className="hk-meta">Nothing here yet.</p>);
  return (
    <section className="hk-bcard" aria-label="Timeline" data-hk-timeline-card>
      <div className="hk-btabs" role="tablist" aria-label="Brand history">
        {tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className="hk-btn hk-btabs__tab" onClick={() => setTab(id)} data-hk-tl-tab={id}>{label}</button>)}
      </div>
      {tab === 'timeline' && list(all)}
      {tab === 'emails' && list(emails)}
      {tab === 'notes' && (notes.length ? <ul className="hk-tl" data-hk-notes>{notes.map((n, i) => <li key={i} className="hk-tl__item hk-tl__item--note">{n}</li>)}</ul> : <p className="hk-meta">No notes yet.</p>)}
      {canEdit && (
        <form className="hk-addnote" onSubmit={addNote}>
          <Icon name="note" size={16} />
          <input className="hk-addnote__input" aria-label="Add a note" placeholder="Add a note…" maxLength={500} value={note} onChange={e => setNote(e.target.value)} data-hk-add-note />
          {note.trim() && <button type="submit" className="hk-btn hk-chipbtn">Add</button>}
        </form>
      )}
      {error && <p className="hk-error" role="alert">{error}</p>}
    </section>
  );
}
