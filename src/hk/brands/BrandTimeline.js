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

export default function BrandTimeline({ businessId, brand, events, touches, replies, member, mailbox, me, canEdit, onChanged }) {
  const [tab, setTab] = useState('timeline');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const own = mailbox?.linked ? mailbox.email : null;
  const gmailLink = t => (own && t.sender_user_id === me?.user_id && t.gmail_message_id ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(own)}#${t.state === 'drafted' ? 'drafts' : 'all'}/${encodeURIComponent(t.gmail_message_id)}` : null);
  const live = touches.filter(t => t.state !== 'discarded');
  const touchItems = live.map(t => ({ at: t.sent_at || t.drafted_at || t.created_at, key: `t-${t.id}`, actor: <Actor kind={t.created_by} userId={t.sender_user_id} member={member} />, text: touchWords(t), extra: t.kind === 'outside' ? '' : t.subject || '', link: gmailLink(t), email: t.channel === 'email' && t.kind !== 'outside' }));
  const replyItems = replies.map(r => ({ at: r.received_at, key: `r-${r.id}`, actor: <span className="hk-owner"><strong>{r.from_name || r.from_domain || 'Reply'}</strong></span>, text: `replied${r.label ? ` (${r.label.replace('_', ' ')})` : ''}`, extra: r.summary || '', email: true }));
  const eventItems = events.filter(e => e.action !== 'touch.logged' && e.action !== 'draft_created').map(e => ({ at: e.created_at, key: `e-${e.id}`, actor: <Actor kind={e.actor_kind} userId={e.actor_user_id} member={member} />, text: ACTION_WORDS[e.action] || e.action, extra: e.detail?.reason || e.detail?.note || (e.detail?.changed?.length ? e.detail.changed.join(', ') : '') }));
  const all = [...eventItems, ...touchItems, ...replyItems].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const emails = [...touchItems, ...replyItems].filter(i => i.email).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const notes = notesOf(brand);
  const tabs = [['timeline', `Timeline ${all.length}`], ['emails', `Emails ${emails.length}`], ['notes', `Notes ${notes.length}`]];
  const addNote = async e => {
    e.preventDefault(); setError('');
    const day = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    try { await hkPatch(businessId, `/brands/${brand.id}`, { notes: [`${day}: ${note.trim()}`, ...notes].join('\n') }); setNote(''); setTab('notes'); await onChanged(); } catch (err) { setError(err.message); }
  };
  const list = items => (items.length ? (
    <ol className="hk-tl" data-hk-timeline>
      {items.map(it => <li key={it.key} className="hk-tl__item">{it.actor}<span className="hk-tl__text">{it.text}{it.extra ? <span className="hk-meta"> · {it.extra}</span> : null}{it.link ? <> · <a className="hk-link" href={it.link} target="_blank" rel="noopener noreferrer">Open in Gmail</a></> : null}</span><time className="hk-meta">{fmt(it.at)}</time></li>)}
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
