import React, { useState } from 'react';
import Button from '../../ui/Button';
import Field from '../../ui/Field';
import ToggleRow from '../../ui/ToggleRow';
import { Icon } from '../HkMarks';
import { hkPatch, hkPost } from '../hkApi';
import { PrimaryAction } from './QuickCommands';
import { SOURCE_LABELS, RELATIONSHIP_LABELS } from './verdict';
import { marketOf } from './labelRules';

// grow-ui-refresh-v1 U7 - the Brand page's right rail (mockup 2): Next step (three numbered steps + the primary
// repeated), Contacts (primary starred, + Add; members see addresses as today, D5), Deal (empty until
// grow-brands-sheet: "fills in when they sign"), Details (label / value rows; Category, Market and Size edit in place
// through PATCH; "Edit all details" opens the full form; "+ Custom field" arrives with the sheet).
const STEPS = {
  pitch: name => [`Pitch ${name}`, ['Pitch claims it as yours and copies the Claude command.', 'Paste in Claude. It writes the email and saves a Gmail draft.', 'Review and send from Gmail. Grow logs it.']],
  research: name => [`Research ${name}`, ['Research finds the website, what they do and the fit.', 'Add an email contact if research has none.', 'Pitch: claim it and copy the Claude command.']],
  add_email: name => [`Find an email for ${name}`, ['Add the best contact with an email under Contacts.', 'Pitch claims it as yours and copies the Claude command.', 'Review and send from Gmail. Grow logs it.']],
  open_draft: name => [`Send the draft to ${name}`, ['Open the draft in Gmail.', 'Review it and send.', 'Grow logs the send and plans the follow-up.']],
  open_reply: name => [`Answer ${name}`, ['Open the reply.', 'Answer it in Gmail.', 'Mark it handled in Grow.']],
};
const SOURCE_WORDS = { import: 'from the sheet', site_published: 'from their website', apollo_verified: 'on file', user_supplied: 'added by a member' };

export function NextStep({ brand, primary, onAct, onGo, onOpenBrand, busy, canEdit }) {
  if (!primary) return null;
  if (primary.kind === 'owned') return <section className="hk-bcard hk-bcard--next" aria-label="Next step"><h3 className="hk-kicker">Next step</h3><p className="hk-research__p">{primary.label}. Nothing to do here.</p></section>;
  const [title, steps] = (STEPS[primary.kind] || STEPS.pitch)(brand.name);
  return (
    <section className="hk-bcard hk-bcard--next" aria-label="Next step" data-hk-next-step={primary.kind}>
      <h3 className="hk-kicker">Next step</h3>
      <p className="hk-next__title">{title}</p>
      <ol className="hk-next__steps">{steps.map((s, i) => <li key={i}><span className="hk-next__n" aria-hidden="true">{i + 1}</span>{s}</li>)}</ol>
      {canEdit && <div className="hk-next__btn"><PrimaryAction brand={{ ...brand, primary }} onAct={onAct} onGo={onGo} onOpenBrand={() => document.getElementById('hk-contacts-card')?.scrollIntoView({ behavior: 'smooth' })} busy={busy} /></div>}
    </section>
  );
}

export function Contacts({ businessId, brandId, contacts, canEdit, member, onChanged }) {
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const save = async e => {
    e.preventDefault(); setError('');
    try { await hkPost(businessId, `/brands/${brandId}/contacts`, { name: form.name.trim(), title: form.title.trim() || undefined, email: form.email.trim() || undefined, is_primary: form.is_primary }); setForm(null); onChanged(); }
    catch (err) { setError(err.message); }
  };
  const live = [...contacts].sort((a, b) => Number(!!b.is_primary) - Number(!!a.is_primary));
  return (
    <section className="hk-bcard" aria-label="Contacts" id="hk-contacts-card" data-hk-contacts>
      <div className="hk-bcard__head"><h3 className="hk-kicker">Contacts</h3><span className="hk-spacer" />{canEdit && !form && <button type="button" className="hk-btn hk-link" onClick={() => setForm({ name: '', title: '', email: '', is_primary: !contacts.length })} data-hk-add-contact>+ Add</button>}</div>
      {!live.length && !form && <p className="hk-meta">No contacts yet.</p>}
      {live.map(c => (
        <div key={c.id} className="hk-contact" data-hk-contact>
          <span className="hk-tile-sm" aria-hidden="true">{(c.title || c.name || '?')[0].toUpperCase()}</span>
          <span className="hk-contact__body">
            <strong>{c.title || c.name}{c.is_primary ? <span aria-label="primary contact"> ★</span> : null}</strong>
            {c.title && <span className="hk-block">{c.name}</span>}
            {c.email ? <a className="hk-link hk-block" href={`mailto:${c.email}`}>{c.email}</a> : <span className="hk-meta hk-block">No email yet</span>}
            <span className="hk-meta hk-block">{c.email ? `Email on file · ${c.email_source === 'user_supplied' && member(c.created_by) ? `added by ${member(c.created_by).first_name}` : SOURCE_WORDS[c.email_source] || 'on file'}` : ''}{c.left_company ? ' · left the company' : ''}</span>
          </span>
        </div>
      ))}
      {form && (
        <form className="hk-form" onSubmit={save} data-hk-contact-form>
          <Field label="Name" htmlFor="hk-c-name"><input id="hk-c-name" className="ui-input" value={form.name} autoFocus maxLength={160} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Title" htmlFor="hk-c-title"><input id="hk-c-title" className="ui-input" value={form.title} maxLength={120} onChange={e => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Email" htmlFor="hk-c-email" hint="Shown to HumanKind members only"><input id="hk-c-email" className="ui-input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></Field>
          <ToggleRow label="Primary contact" checked={form.is_primary} onChange={v => setForm({ ...form, is_primary: v })} />
          {error && <p className="hk-error" role="alert">{error}</p>}
          <span style={{ display: 'inline-flex', gap: 8 }}><Button type="submit" variant="primary" disabled={!form.name.trim()}>Save contact</Button><Button variant="tertiary" onClick={() => setForm(null)}>Cancel</Button></span>
        </form>
      )}
    </section>
  );
}

export function Deal() {
  return (
    <section className="hk-bcard" aria-label="Deal" data-hk-deal>
      <div className="hk-bcard__head"><h3 className="hk-kicker">Deal</h3><span className="hk-spacer" /><span className="hk-meta">fills in when they sign</span></div>
      <dl className="hk-kv">{['Plan', 'List price', 'Per month', 'Lifetime'].map(k => <div key={k} className="hk-kv__row"><dt>{k}</dt><dd className="hk-meta">—</dd></div>)}</dl>
    </section>
  );
}

const EDITABLE = { Category: ['category', 80], Size: ['size_band', 40] };

export function Details({ businessId, brand, research, owner, canEdit, onChanged }) {
  const [editing, setEditing] = useState(null);
  const [value, setValue] = useState('');
  const [full, setFull] = useState(null);
  const [error, setError] = useState('');
  const patch = async body => { setError(''); try { await hkPatch(businessId, `/brands/${brand.id}`, body); setEditing(null); setFull(null); await onChanged(); } catch (e) { setError(e.message); } };
  const hint = brand.owner_hint && String(brand.owner_hint).trim();
  const rows = [
    ['Industry', research?.industry || null, research ? 'from research' : 'after research'],
    ['Category', brand.category || null],
    ['Market', marketOf({ ...brand, research })],
    ['Size', brand.size_band || research?.size_hint || null],
    ['Based in', research?.hq_city || brand.city || null],
    ['Owner', owner ? owner.first_name : hint ? '—' : 'Unclaimed'],
    ['Sheet owner', hint ? hint[0].toUpperCase() + hint.slice(1) : null],
    ['Source', SOURCE_LABELS[brand.source] || brand.source],
    ['Relationship', RELATIONSHIP_LABELS[brand.relationship]],
  ];
  const start = k => { setEditing(k); setValue(k === 'Market' ? (brand.is_local ? 'Chicago' : 'National') : brand[EDITABLE[k][0]] || ''); };
  const save = () => (editing === 'Market' ? patch({ is_local: value === 'Chicago' }) : patch({ [EDITABLE[editing][0]]: value.trim() || null }));
  const startFull = () => setFull({ name: brand.name, domain: brand.domain || '', niche: brand.niche || '', city: brand.city || '', neighborhood: brand.neighborhood || '', aliases: (brand.aliases || []).join(', ') });
  return (
    <section className="hk-bcard" aria-label="Details" data-hk-details>
      <div className="hk-bcard__head"><h3 className="hk-kicker">Details</h3></div>
      <dl className="hk-kv">
        {rows.map(([k, v, note]) => (
          <div key={k} className="hk-kv__row" data-hk-detail={k}>
            <dt>{k}</dt>
            {editing === k ? (
              <dd className="hk-kv__edit">
                {k === 'Market'
                  ? <select className="ui-input" aria-label="Market" value={value} onChange={e => setValue(e.target.value)}><option>Chicago</option><option>National</option></select>
                  : <input className="ui-input" aria-label={k} value={value} maxLength={EDITABLE[k][1]} onChange={e => setValue(e.target.value)} autoFocus />}
                <button type="button" className="hk-btn hk-link" onClick={save}>Save</button><button type="button" className="hk-btn hk-link" onClick={() => setEditing(null)}>Cancel</button>
              </dd>
            ) : (
              <dd>{v || <span className="hk-meta">{note ? `— (${note})` : '—'}</span>}
                {canEdit && (EDITABLE[k] || k === 'Market') && <button type="button" className="hk-btn hk-kv__pen" aria-label={`Edit ${k}`} onClick={() => start(k)}><Icon name="pencil" size={13} /></button>}
              </dd>
            )}
          </div>
        ))}
      </dl>
      {canEdit && !full && <button type="button" className="hk-btn hk-link" onClick={startFull} data-hk-edit>Edit all details</button>}
      {full && (
        <form className="hk-form" onSubmit={e => { e.preventDefault(); patch({ ...full, domain: full.domain || null, aliases: full.aliases.split(',').map(s => s.trim()).filter(Boolean) }); }}>
          {[['name', 'Name'], ['domain', 'Website'], ['niche', 'Niche'], ['city', 'City'], ['neighborhood', 'Neighborhood'], ['aliases', 'Aliases (comma separated)']].map(([k, label]) => <Field key={k} label={label} htmlFor={`hk-d-${k}`}><input id={`hk-d-${k}`} className="ui-input" value={full[k]} onChange={e => setFull({ ...full, [k]: e.target.value })} /></Field>)}
          <span style={{ display: 'inline-flex', gap: 8 }}><Button type="submit" variant="primary">Save details</Button><Button variant="tertiary" onClick={() => setFull(null)}>Cancel</Button></span>
        </form>
      )}
      {error && <p className="hk-error" role="alert">{error}</p>}
    </section>
  );
}
