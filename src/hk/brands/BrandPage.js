import React, { useCallback, useEffect, useRef, useState } from 'react';
import Tabs from '../../ui/Tabs';
import Button from '../../ui/Button';
import Field from '../../ui/Field';
import ToggleRow from '../../ui/ToggleRow';
import { Avatar } from '../HkMarks';
import VerdictBanner from './VerdictBanner';
import { Chip } from './BrandsScreen';
import { fromDetail, STATUS_LABELS, RELATIONSHIP_LABELS, STATUS_TONE, RELATIONSHIP_TONE, SOURCE_LABELS } from './verdict';
import { hkGet, hkPatch, hkPost } from '../hkApi';
import ComposerModal from './ComposerModal';

// hkos-data-foundation-v1 D6 - the Brand page: header + chips + touch counter, the Verdict banner, the primary action
// by state, More, and four tabs. Contact emails show here only (D5), as mailto links.
const TABS = [['timeline', 'Timeline'], ['contacts', 'Contacts'], ['notes', 'Notes & ideas'], ['details', 'Details']];
const fmt = iso => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const ACTION_WORDS = { 'brand.created': 'added the brand', 'brand.claimed': 'claimed it', 'brand.released': 'released it', 'brand.status': 'set the status', 'brand.relationship': 'changed the relationship', 'brand.updated': 'edited', 'brand.merged': 'merged a duplicate into it', 'contact.added': 'added a contact', 'contact.updated': 'edited a contact', 'sponsor.period_added': 'added a sponsor period', 'sponsor.period_removed': 'removed a sponsor period' };

export default function BrandPage({ businessId, brandId, shell, gmail, onBack, canEdit, onGmailChanged }) {
  const [composer, setComposer] = useState(false);
  const [savedNote, setSavedNote] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('timeline');
  const [moreOpen, setMoreOpen] = useState(false);
  const [dncReason, setDncReason] = useState(null);
  const me = shell?.me, members = shell?.members || [];
  const isOwnerRole = me?.role === 'owner';
  const member = id => members.find(m => m.user_id === id);

  const load = useCallback(async () => {
    setError('');
    try { setData(await hkGet(businessId, `/brands/${brandId}`)); } catch (e) { setError(e.message); }
  }, [businessId, brandId]);
  useEffect(() => { setData(null); load(); }, [load]);

  const patch = async body => { try { await hkPatch(businessId, `/brands/${brandId}`, body); await load(); } catch (e) { setError(e.message); } };
  if (error && !data) return <p className="hk-error" role="alert">{error}</p>;
  if (!data) return <p className="hk-meta">Loading brand…</p>;
  const { brand, contacts, touches, replies, events, verdict, email_touches_sent, max_email_touches } = data;
  const owner = member(brand.owner_user_id);
  const mine = brand.owner_user_id && brand.owner_user_id === me?.user_id;
  const hasDraft = touches.some(t => t.state === 'drafted');
  const primary = !canEdit ? null
    : !brand.owner_user_id && brand.relationship === 'prospect' ? <Button variant="primary" onClick={() => patch({ claim: true })} data-hk-claim>Claim</Button>
    : mine && !hasDraft ? <Button variant="primary" onClick={() => setComposer(true)} data-hk-draft-email-primary>Draft email</Button>
    : <Button variant="primary" disabled disabledReason={mine ? 'A draft is already waiting in Gmail' : owner ? `Owned by ${owner.first_name}` : 'Not a prospect'}>Draft</Button>;

  const more = canEdit && (
    <div className="hk-anchor">
      <Button aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen(o => !o)} data-hk-more>More</Button>
      {moreOpen && (
        <div className="hk-menu hk-menu--right" role="menu" onMouseLeave={() => setMoreOpen(false)}>
          <button type="button" role="menuitem" className="hk-btn hk-menu__item" onClick={() => { setMoreOpen(false); setComposer(true); }} data-hk-draft-email>Draft email…</button>
          <button type="button" role="menuitem" className="hk-btn hk-menu__item" onClick={() => { setMoreOpen(false); setTab('details'); }}>Edit</button>
          {brand.owner_user_id && (mine || isOwnerRole) && <button type="button" role="menuitem" className="hk-btn hk-menu__item" onClick={() => { setMoreOpen(false); patch({ claim: false }); }}>Release</button>}
          {brand.relationship !== 'do_not_contact' && <button type="button" role="menuitem" className="hk-btn hk-menu__item" onClick={() => { setMoreOpen(false); setDncReason(''); }}>Mark do-not-contact</button>}
          {isOwnerRole && brand.relationship === 'prospect' && <button type="button" role="menuitem" className="hk-btn hk-menu__item" onClick={() => { setMoreOpen(false); patch({ relationship: 'sponsor' }); }}>Mark as sponsor</button>}
          <button type="button" role="menuitem" className="hk-btn hk-menu__item" disabled title="Use Review, Possible duplicates">Merge with…</button>
          <button type="button" role="menuitem" className="hk-btn hk-menu__item" disabled title="Arrives with Gmail (step 3)">Log outside touch</button>
        </div>
      )}
    </div>
  );

  return (
    <div className="hk-brand" data-hk-brand-page={brand.id}>
      <button type="button" className="hk-btn hk-link" onClick={onBack}>Back to Brands</button>
      <header className="hk-brand__head">
        <div>
          <h1 className="hk-head__title">{brand.name}</h1>
          {brand.domain && <a className="hk-link" href={`https://${brand.domain}`} target="_blank" rel="noopener noreferrer">{brand.domain}</a>}
          <div className="hk-brand__chips">
            <Chip tone={STATUS_TONE[brand.status]}>{STATUS_LABELS[brand.status]}</Chip>
            <span className="hk-chip hk-chip--grey">{owner ? <><Avatar name={owner.first_name} index={owner.palette_index} size={18} /> {owner.first_name}</> : 'Unclaimed'}</span>
            <Chip tone={RELATIONSHIP_TONE[brand.relationship]}>{RELATIONSHIP_LABELS[brand.relationship]}</Chip>
            <Chip tone={brand.is_local ? 'green' : 'grey'}>{brand.is_local ? 'Local Chicago' : 'National'}</Chip>
            {brand.category && <Chip tone="grey">{brand.category}</Chip>}
            <span className="hk-meta" data-hk-touches>{email_touches_sent} of {max_email_touches} email touches</span>
          </div>
        </div>
        <div className="hk-brand__actions">{primary}{more}</div>
      </header>
      <VerdictBanner verdict={fromDetail(verdict)} members={members} brandName={brand.name} />
      {savedNote && <p className="hk-banner hk-banner--green" role="status" data-hk-draft-saved><span className="hk-banner__title">{savedNote}</span></p>}
      {dncReason !== null && (
        <form className="hk-inline-form" onSubmit={e => { e.preventDefault(); if (dncReason.trim()) { patch({ relationship: 'do_not_contact', dnc_reason: dncReason.trim() }); setDncReason(null); } }}>
          <Field label="Why should this brand never be contacted?" htmlFor="hk-dnc"><input id="hk-dnc" className="ui-input" value={dncReason} maxLength={200} autoFocus onChange={e => setDncReason(e.target.value)} /></Field>
          <span style={{ display: 'inline-flex', gap: 8 }}><Button type="submit" variant="danger" disabled={!dncReason.trim()}>Mark do-not-contact</Button><Button variant="tertiary" onClick={() => setDncReason(null)}>Cancel</Button></span>
        </form>
      )}
      {error && <p className="hk-error" role="alert">{error}</p>}
      <Tabs label="Brand sections" items={TABS.map(([id, label]) => ({ id, label }))} value={tab} onChange={setTab} />
      <div className="hk-brand__body">
        {tab === 'timeline' && <Timeline events={events} touches={touches} replies={replies} member={member} mailbox={gmail?.mailbox} me={me} />}
        {tab === 'contacts' && <Contacts businessId={businessId} brandId={brand.id} contacts={contacts} canEdit={canEdit} onChanged={load} />}
        {tab === 'notes' && <Notes businessId={businessId} brand={brand} canEdit={canEdit} onSaved={load} />}
        {tab === 'details' && <Details businessId={businessId} brand={brand} canEdit={canEdit} member={member} onSaved={load} />}
      </div>
      {composer && <ComposerModal businessId={businessId} brand={brand} contacts={contacts} touches={touches} gmail={gmail} onClose={() => setComposer(false)} onSaved={r => { setComposer(false); setSavedNote(r.gmail_draft_url ? 'Saved to your HumanKind Gmail Drafts.' : 'Draft saved.'); load(); onGmailChanged?.(); if (r.gmail_draft_url) window.open(r.gmail_draft_url, '_blank', 'noopener'); }} />}
    </div>
  );
}

function Actor({ kind, userId, member }) {
  const m = userId ? member(userId) : null;
  if (m) return <span className="hk-owner"><Avatar name={m.first_name} index={m.palette_index} size={22} />{m.first_name}</span>;
  return <span className="hk-owner"><span className="hk-avatar hk-avatar--system" style={{ width: 22, height: 22, fontSize: 11 }}>{kind === 'claude' ? 'C' : 'S'}</span>{kind === 'claude' ? 'Claude' : 'System'}</span>;
}

function Timeline({ events, touches, replies, member, mailbox, me }) {
  const own = mailbox?.linked ? mailbox.email : null;
  const gmailLink = t => (own && t.sender_user_id === me?.user_id && t.gmail_message_id ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(own)}#${t.state === 'drafted' ? 'drafts' : 'all'}/${encodeURIComponent(t.gmail_message_id)}` : null);
  const items = [
    ...events.map(e => ({ at: e.created_at, key: `e-${e.id}`, actor: <Actor kind={e.actor_kind} userId={e.actor_user_id} member={member} />, text: ACTION_WORDS[e.action] || e.action, extra: e.detail?.changed?.length ? e.detail.changed.join(', ') : e.detail?.name || '' })),
    ...touches.map(t => ({ at: t.sent_at || t.drafted_at || t.created_at, key: `t-${t.id}`, actor: <Actor kind={t.created_by} userId={t.sender_user_id} member={member} />, text: `${t.state} ${t.kind} (${t.channel})`, extra: t.subject || '', link: gmailLink(t) })),
    ...replies.map(r => ({ at: r.received_at, key: `r-${r.id}`, actor: <span className="hk-owner">{r.from_name || r.from_domain || 'Reply'}</span>, text: `replied${r.label ? ` (${r.label.replace('_', ' ')})` : ''}`, extra: r.summary || '' })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  if (!items.length) return <p className="hk-meta">Nothing yet. Claims, notes, touches and replies land here.</p>;
  return (
    <ol className="hk-timeline" data-hk-timeline>
      {items.map(it => <li key={it.key} className="hk-timeline__item">{it.actor}<span className="hk-timeline__text">{it.text}{it.extra ? <span className="hk-meta"> · {it.extra}</span> : null}{it.link ? <> · <a className="hk-link" href={it.link} target="_blank" rel="noopener noreferrer">Open in Gmail</a></> : null}</span><time className="hk-meta">{fmt(it.at)}</time></li>)}
    </ol>
  );
}

function Contacts({ businessId, brandId, contacts, canEdit, onChanged }) {
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const save = async e => {
    e.preventDefault(); setError('');
    try { await hkPost(businessId, `/brands/${brandId}/contacts`, { name: form.name.trim(), title: form.title.trim() || undefined, email: form.email.trim() || undefined, is_primary: form.is_primary }); setForm(null); onChanged(); }
    catch (err) { setError(err.message); }
  };
  return (
    <div data-hk-contacts>
      {!contacts.length && <p className="hk-meta">No contacts yet.</p>}
      <div className="hk-rows">
        {contacts.map(c => (
          <div key={c.id} className="hk-row" data-hk-contact>
            <span className="hk-row__name">{c.is_primary ? '★ ' : ''}{c.name}</span>
            {c.title && <span className="hk-meta">{c.title}</span>}
            {c.email ? <a className="hk-link" href={`mailto:${c.email}`}>{c.email}</a> : <span className="hk-meta">No email</span>}
            <span className="hk-row__end hk-meta">{c.email_source ? c.email_source.replace('_', ' ') : ''}{c.left_company ? ' · left' : ''}</span>
          </div>
        ))}
      </div>
      {canEdit && !form && <p style={{ marginTop: 12 }}><Button onClick={() => setForm({ name: '', title: '', email: '', is_primary: !contacts.length })} data-hk-add-contact>+ Add contact</Button></p>}
      {form && (
        <form className="hk-inline-form" onSubmit={save} data-hk-contact-form>
          <Field label="Name" htmlFor="hk-c-name"><input id="hk-c-name" className="ui-input" value={form.name} autoFocus maxLength={160} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Title" htmlFor="hk-c-title"><input id="hk-c-title" className="ui-input" value={form.title} maxLength={120} onChange={e => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Email" htmlFor="hk-c-email" hint="Shown to HumanKind members only"><input id="hk-c-email" className="ui-input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></Field>
          <ToggleRow label="Primary contact" checked={form.is_primary} onChange={v => setForm({ ...form, is_primary: v })} />
          {error && <p className="hk-error" role="alert">{error}</p>}
          <span style={{ display: 'inline-flex', gap: 8 }}><Button type="submit" variant="primary" disabled={!form.name.trim()}>Save contact</Button><Button variant="tertiary" onClick={() => setForm(null)}>Cancel</Button></span>
        </form>
      )}
    </div>
  );
}

// Autosave 800 ms after the last keystroke (REVISABLE); the last saved state is shown next to the field group. Leaving
// the tab before the timer fires flushes at once, so a quick edit is never lost.
function Notes({ businessId, brand, canEdit, onSaved }) {
  const [draft, setDraft] = useState({ notes: brand.notes || '', challenge_idea: brand.challenge_idea || '', origin_hook: brand.origin_hook || '', reward_idea: brand.reward_idea || '' });
  const [state, setState] = useState('');
  const timer = useRef(null);
  const pending = useRef(null);
  const flush = useCallback(async d => {
    pending.current = null;
    setState('Saving…');
    try { await hkPatch(businessId, `/brands/${brand.id}`, d); setState('Saved'); onSaved(); } catch (e) { setState(e.message); }
  }, [businessId, brand.id, onSaved]);
  const change = (k, v) => { const d = { ...draft, [k]: v }; setDraft(d); pending.current = d; setState('Unsaved'); clearTimeout(timer.current); timer.current = setTimeout(() => flush(d), 800); };
  useEffect(() => () => { clearTimeout(timer.current); if (pending.current) { const d = pending.current; pending.current = null; hkPatch(businessId, `/brands/${brand.id}`, d).then(onSaved).catch(() => {}); } }, [businessId, brand.id, onSaved]);
  const field = (k, label, rows) => (
    <Field key={k} label={label} htmlFor={`hk-n-${k}`}><textarea id={`hk-n-${k}`} className="ui-input" rows={rows} value={draft[k]} disabled={!canEdit} onChange={e => change(k, e.target.value)} /></Field>
  );
  return (
    <div className="hk-form" data-hk-notes>
      {field('notes', 'Notes', 5)}{field('challenge_idea', 'Challenge idea', 3)}{field('origin_hook', 'Origin hook', 2)}{field('reward_idea', 'Reward idea', 2)}
      <p className="hk-meta" role="status" data-hk-save-state>{state}</p>
    </div>
  );
}

function Details({ businessId, brand, canEdit, member, onSaved }) {
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const start = () => { setForm({ name: brand.name, domain: brand.domain || '', category: brand.category || '', niche: brand.niche || '', size_band: brand.size_band || '', city: brand.city || '', neighborhood: brand.neighborhood || '', is_local: !!brand.is_local, aliases: (brand.aliases || []).join(', ') }); setEdit(true); };
  const save = async e => {
    e.preventDefault(); setError('');
    try { await hkPatch(businessId, `/brands/${brand.id}`, { ...form, domain: form.domain || null, aliases: form.aliases.split(',').map(s => s.trim()).filter(Boolean) }); setEdit(false); onSaved(); } catch (err) { setError(err.message); }
  };
  const by = member(brand.created_by);
  if (!edit) return (
    <dl className="hk-details" data-hk-details>
      {[['Aliases', (brand.aliases || []).join(', ')], ['Source', SOURCE_LABELS[brand.source] || brand.source], ['Segment', brand.segment], ['Size band', brand.size_band], ['Niche', brand.niche], ['City', brand.city], ['Neighborhood', brand.neighborhood], ['Created by', by ? by.first_name : ''], ['Import ref', brand.import_ref], ['Created', fmt(brand.created_at)], ['Updated', fmt(brand.updated_at)]].map(([k, v]) => <React.Fragment key={k}><dt className="hk-meta">{k}</dt><dd>{v || <span className="hk-meta">·</span>}</dd></React.Fragment>)}
      {canEdit && <dd style={{ gridColumn: '1 / -1' }}><Button onClick={start} data-hk-edit>Edit details</Button></dd>}
    </dl>
  );
  const input = (k, label) => <Field key={k} label={label} htmlFor={`hk-d-${k}`}><input id={`hk-d-${k}`} className="ui-input" value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} /></Field>;
  return (
    <form className="hk-form" onSubmit={save}>
      {input('name', 'Name')}{input('domain', 'Domain')}{input('category', 'Category')}{input('niche', 'Niche')}{input('size_band', 'Size band')}{input('city', 'City')}{input('neighborhood', 'Neighborhood')}{input('aliases', 'Aliases (comma separated)')}
      <ToggleRow label="Local Chicago?" checked={form.is_local} onChange={v => setForm({ ...form, is_local: v })} />
      {error && <p className="hk-error" role="alert">{error}</p>}
      <span style={{ display: 'inline-flex', gap: 8 }}><Button type="submit" variant="primary">Save details</Button><Button variant="tertiary" onClick={() => setEdit(false)}>Cancel</Button></span>
    </form>
  );
}
