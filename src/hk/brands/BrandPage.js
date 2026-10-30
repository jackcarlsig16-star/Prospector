import React, { useCallback, useEffect, useRef, useState } from 'react';
import Button from '../../ui/Button';
import Field from '../../ui/Field';
import { Icon } from '../HkMarks';
import VerdictBanner from './VerdictBanner';
import { fromDetail, STATUS_LABELS } from './verdict';
import { hkGet, hkPatch } from '../hkApi';
import ComposerModal from './ComposerModal';
import BrandLabels from './BrandLabels';
import SiteSuggestion from './SiteSuggestion';
import BrandResearch from './BrandResearch';
import BrandTimeline from './BrandTimeline';
import LogActivity from './LogActivity';
import { NextStep, Contacts, Deal, Details } from './BrandRail';
import { useBrandCommands, PrimaryAction, QuickIcons, KEYS, isTyping, isOpenDialog } from './QuickCommands';

// hkos-data-foundation-v1 D6 + grow-ui-refresh-v1 U7 - the Brand page, built to mockup 2: a header card (initial tile,
// name, website pill with Save / Wrong for a suggestion, the label set with Category and Owner, the primary + quick
// commands + Log activity + More, "Pitch = claim + copy …", the status stepper with "n of 3 email touches", the one-line
// verdict), the Research card and the Timeline card on the left, and Next step · Contacts · Deal · Details on the right.
// Keys P T R S X L work anywhere on the page while nothing is being typed. Contact emails show here only (D5).
const STEPS = ['candidate', 'claimed', 'drafted', 'sent', 'replied', 'meeting', 'signed'];
const STEP_OF = { bumped: 'sent', final_sent: 'sent' };
const OFF_STEPPER = { passed: 'Passed', skipped: 'Skipped', sponsor: 'Sponsor' };
const bestContact = contacts => { const live = contacts.filter(c => !c.left_company); const c = live.find(x => x.is_primary && x.email) || live.find(x => x.email) || live.find(x => x.is_primary) || live[0]; return c ? { has_email: !!c.email, title: c.title || null, name: c.name } : null; };
const fmtDay = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function Stepper({ status, sent, max, snoozedUntil, passReason }) {
  const at = STEPS.indexOf(STEP_OF[status] || status);
  return (
    <div className="hk-stepper" data-hk-stepper={status}>
      <ol className="hk-stepper__steps" aria-label="Status">
        {STEPS.map((s, i) => <li key={s} className={`hk-stepper__step${i <= at ? ' hk-stepper__step--done' : ''}${i === at ? ' hk-stepper__step--now' : ''}`} aria-current={i === at ? 'step' : undefined}><span className="hk-stepper__bar" aria-hidden="true" />{STATUS_LABELS[s]}</li>)}
      </ol>
      <span className="hk-stepper__side">
        {OFF_STEPPER[status] && <span className="hk-label hk-label--block" data-hk-off-stepper>{OFF_STEPPER[status]}{passReason ? ` · ${passReason}` : ''}</span>}
        {snoozedUntil && Date.parse(snoozedUntil) > Date.now() && <span className="hk-label hk-label--grey" data-hk-snoozed>Snoozed until {fmtDay(snoozedUntil)}</span>}
        <span className="hk-meta hk-stepper__touches" data-hk-touches><span aria-hidden="true">{Array.from({ length: max }, (_, i) => <span key={i} className={`hk-dot-sm${i < sent ? ' hk-dot-sm--on' : ''}`} />)}</span> {sent} of {max} email touches</span>
      </span>
    </div>
  );
}

export default function BrandPage({ businessId, brandId, shell, gmail, onBack, onGo, canEdit, onGmailChanged, onSignalsChanged }) {
  const [composer, setComposer] = useState(false);
  const [savedNote, setSavedNote] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [dncReason, setDncReason] = useState(null);
  const keyRef = useRef(null);
  const me = shell?.me, members = shell?.members || [];
  const isOwnerRole = me?.role === 'owner';
  const member = useCallback(id => members.find(m => m.user_id === id), [members]);

  const load = useCallback(async () => {
    setError('');
    try { setData(await hkGet(businessId, `/brands/${brandId}`)); } catch (e) { setError(e.message); }
  }, [businessId, brandId]);
  useEffect(() => { setData(null); load(); }, [load]);
  const changed = useCallback(async () => { await load(); onSignalsChanged?.(); }, [load, onSignalsChanged]);
  const cmd = useBrandCommands({ businessId, onChanged: changed, setError: setNote });
  useEffect(() => { const h = e => keyRef.current?.(e); document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h); }, []);

  const patch = async body => { try { await hkPatch(businessId, `/brands/${brandId}`, body); await load(); } catch (e) { setError(e.message); } };
  if (error && !data) return <p className="hk-error" role="alert">{error}</p>;
  if (!data) return <p className="hk-meta">Loading brand…</p>;
  const { brand, contacts, touches, replies, events, verdict, email_touches_sent, max_email_touches, research, research_budget, primary, command } = data;
  const owner = member(brand.owner_user_id);
  const mine = brand.owner_user_id && brand.owner_user_id === me?.user_id;
  const b = { ...brand, research, contact: bestContact(contacts), command, primary };
  keyRef.current = e => {
    if (!canEdit || isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || isOpenDialog() || composer) return;
    const k = e.key.toLowerCase();
    if (k === 'l') { e.preventDefault(); setLogOpen(true); return; }
    const action = KEYS[k];
    if (!action || (action === 'pitch' && primary?.kind !== 'pitch')) return;
    e.preventDefault(); cmd.act(action, b);
  };

  const more = canEdit && (
    <span className="hk-anchor">
      <button type="button" className="hk-btn hk-qc" aria-label="More" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen(o => !o)} data-hk-more data-tip="More"><Icon name="more" size={17} /></button>
      {moreOpen && (
        <span className="hk-menu hk-menu--right" role="menu" onMouseLeave={() => setMoreOpen(false)}>
          <button type="button" role="menuitem" className="hk-btn hk-menu__item" onClick={() => { setMoreOpen(false); setComposer(true); }} data-hk-draft-email>Draft email…</button>
          {!brand.owner_user_id && brand.relationship === 'prospect' && <button type="button" role="menuitem" className="hk-btn hk-menu__item" onClick={() => { setMoreOpen(false); cmd.act('claim', b); }} data-hk-claim>Claim only</button>}
          <button type="button" role="menuitem" className="hk-btn hk-menu__item" onClick={() => { setMoreOpen(false); cmd.act('copy', b); }}>Copy command</button>
          {brand.owner_user_id && (mine || isOwnerRole) && <button type="button" role="menuitem" className="hk-btn hk-menu__item" onClick={() => { setMoreOpen(false); patch({ claim: false }); }}>Release</button>}
          {brand.relationship !== 'do_not_contact' && <button type="button" role="menuitem" className="hk-btn hk-menu__item" onClick={() => { setMoreOpen(false); setDncReason(''); }}>Mark do-not-contact</button>}
          {isOwnerRole && brand.relationship === 'prospect' && <button type="button" role="menuitem" className="hk-btn hk-menu__item" onClick={() => { setMoreOpen(false); patch({ relationship: 'sponsor' }); }}>Mark as sponsor</button>}
        </span>
      )}
    </span>
  );

  return (
    <div className="hk-brand" data-hk-brand-page={brand.id}>
      <button type="button" className="hk-btn hk-link hk-brand__back" onClick={onBack}>← Brands</button>
      <section className="hk-bcard hk-bhead" aria-label={`${brand.name} header`}>
        <div className="hk-bhead__top">
          <span className="hk-tile-sm hk-tile-sm--xl" aria-hidden="true">{brand.name.trim()[0].toUpperCase()}</span>
          <div className="hk-bhead__main">
            <div className="hk-bhead__name">
              <h1 className="hk-bhead__title">{brand.name}</h1>
              {brand.domain
                ? <a className="hk-sitepill" href={`https://${brand.domain}`} target="_blank" rel="noopener noreferrer" data-hk-site-pill="saved"><Icon name="globe" size={14} />{brand.domain}</a>
                : brand.domain_suggested ? <span className="hk-sitepill hk-sitepill--suggested" data-hk-site-pill="suggested"><Icon name="globe" size={14} /><SiteSuggestion businessId={businessId} brandId={brand.id} brandName={brand.name} suggestion={{ domain: brand.domain_suggested, confidence: brand.domain_confidence || 'low' }} canEdit={canEdit} saveLabel="Save" className="hk-sitepill__line" onChanged={load} setNote={setNote} /></span>
                  : <span className="hk-meta" data-hk-site-pill="none">no website yet</span>}
            </div>
            <BrandLabels brand={b} owner={owner} withCategory withOwner />
          </div>
          <div className="hk-bhead__acts">
            {canEdit && <span className="hk-srow__acts">
              <PrimaryAction brand={b} onAct={cmd.act} onGo={onGo || (() => {})} onOpenBrand={() => document.getElementById('hk-contacts-card')?.scrollIntoView({ behavior: 'smooth' })} busy={cmd.busy} />
              <QuickIcons brand={b} meId={me?.user_id} firstName={id => member(id)?.first_name || null} onAct={cmd.act} busy={cmd.busy} />
              <button type="button" className="hk-btn hk-qc" aria-label="Log activity" aria-keyshortcuts="L" aria-expanded={logOpen} data-tip="Log activity (L)" onClick={() => setLogOpen(o => !o)} data-hk-qc-log><Icon name="note" size={17} /></button>
              {more}
            </span>}
            {canEdit && <span className="hk-meta hk-bhead__pitchline">Pitch = claim + copy <code>{command}</code></span>}
          </div>
        </div>
        {logOpen && <LogActivity brand={brand} busy={cmd.busy} onLog={body => cmd.act('log', b, body)} onClose={() => setLogOpen(false)} />}
        <Stepper status={brand.status} sent={email_touches_sent} max={max_email_touches} snoozedUntil={brand.snoozed_until} passReason={brand.pass_reason} />
        <VerdictBanner verdict={fromDetail(verdict)} members={members} brandName={brand.name} />
      </section>
      {savedNote && <p className="hk-banner hk-banner--green" role="status" data-hk-draft-saved><span className="hk-banner__title">{savedNote}</span></p>}
      {note && <p className="hk-note" role="status" data-hk-brand-note>{note}</p>}
      {dncReason !== null && (
        <form className="hk-inline-form" onSubmit={e => { e.preventDefault(); if (dncReason.trim()) { patch({ relationship: 'do_not_contact', dnc_reason: dncReason.trim() }); setDncReason(null); } }}>
          <Field label="Why should this brand never be contacted?" htmlFor="hk-dnc"><input id="hk-dnc" className="ui-input" value={dncReason} maxLength={200} autoFocus onChange={e => setDncReason(e.target.value)} /></Field>
          <span style={{ display: 'inline-flex', gap: 8 }}><Button type="submit" variant="danger" disabled={!dncReason.trim()}>Mark do-not-contact</Button><Button variant="tertiary" onClick={() => setDncReason(null)}>Cancel</Button></span>
        </form>
      )}
      {error && <p className="hk-error" role="alert">{error}</p>}
      <div className="hk-bgrid">
        <div className="hk-bgrid__main">
          <BrandResearch businessId={businessId} brand={brand} research={research} budget={research_budget} member={member} canEdit={canEdit} onChanged={changed} setNote={setNote} />
          <BrandTimeline businessId={businessId} brand={brand} events={events} touches={touches} replies={replies} member={member} mailbox={gmail?.mailbox} me={me} canEdit={canEdit} onChanged={load} />
        </div>
        <aside className="hk-bgrid__rail" aria-label="About this brand">
          <NextStep brand={b} primary={primary} onAct={cmd.act} onGo={onGo || (() => {})} busy={cmd.busy} canEdit={canEdit} />
          <Contacts businessId={businessId} brandId={brand.id} contacts={contacts} canEdit={canEdit} member={member} onChanged={load} />
          <Deal />
          <Details businessId={businessId} brand={brand} research={research} owner={owner} canEdit={canEdit} onChanged={load} />
        </aside>
      </div>
      {cmd.node}
      {composer && <ComposerModal businessId={businessId} brand={brand} contacts={contacts} touches={touches} gmail={gmail} onClose={() => setComposer(false)} onSaved={r => { setComposer(false); setSavedNote(r.gmail_draft_url ? 'Saved to your HumanKind Gmail Drafts.' : 'Draft saved.'); load(); onGmailChanged?.(); if (r.gmail_draft_url) window.open(r.gmail_draft_url, '_blank', 'noopener'); }} />}
    </div>
  );
}
