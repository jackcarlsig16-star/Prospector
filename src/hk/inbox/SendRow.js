import React, { useState } from 'react';
import { Icon } from '../HkMarks';
import { hkPatch } from '../hkApi';
import BrandLabels from '../brands/BrandLabels';
import SiteSuggestion from '../brands/SiteSuggestion';
import { PrimaryAction, QuickIcons, KEYS, isTyping } from '../brands/QuickCommands';
import { siteOf, whyNowOf } from '../brands/labelRules';
import { fmtDate } from './inboxPrefs';

// grow-ui-refresh-v1 U4 + U5 - one ranked Send-these-10 row (checkbox, rank, initial tile, name + website state, Why
// now, labels, score, the primary, the quick commands, expand) and its in-place expand: What they do + Challenge idea |
// Best contact + the suggested website | Why score n (the real parts, J9) + More; footer = what Pitch does + the keys.
// A focused row answers P T R S X, Enter (expand), J / K (move); never while typing.
const money = n => (n == null ? null : `$${Number(n).toFixed(2)}`);

function Expand({ c, canEdit, businessId, onAct, onOpenBrand, onChanged, setNote }) {
  const [editing, setEditing] = useState(false);
  const [idea, setIdea] = useState(c.challenge_idea || c.research?.challenge_idea || '');
  const [dnc, setDnc] = useState(null);
  const shownIdea = c.challenge_idea || c.research?.challenge_idea;
  const saveIdea = async () => { try { await hkPatch(businessId, `/brands/${c.id}`, { challenge_idea: idea }); setEditing(false); await onChanged(); } catch (e) { setNote(e.message); } };
  const saveDnc = async () => { try { await hkPatch(businessId, `/brands/${c.id}`, { relationship: 'do_not_contact', dnc_reason: dnc }); setDnc(null); setNote(`${c.name} is marked do not contact.`); await onChanged(); } catch (e) { setNote(e.message); } };
  const copyIdea = async () => { try { await navigator.clipboard.writeText(shownIdea); setNote('Challenge idea copied.'); } catch { setNote(`Copy failed. The idea is: ${shownIdea}`); } };
  const total = c.score_parts.reduce((n, p) => n + p.points, 0);
  return (
    <div className="hk-srow__expand" data-hk-expand={c.id}>
      <div className="hk-srow__panel">
        <h3 className="hk-kicker">What they do</h3>
        <p className="hk-srow__text">{c.research?.what_they_do || (c.research ? 'Research found no description.' : 'Not researched yet.')}</p>
        <h3 className="hk-kicker">Challenge idea</h3>
        {editing
          ? <div className="hk-srow__edit"><textarea className="ui-input" rows={3} maxLength={1000} value={idea} onChange={e => setIdea(e.target.value)} aria-label="Challenge idea" /><button type="button" className="hk-btn hk-chipbtn" onClick={saveIdea}>Save</button><button type="button" className="hk-btn hk-link" onClick={() => setEditing(false)}>Cancel</button></div>
          : <p className="hk-srow__text">{shownIdea || 'No idea yet.'}</p>}
        <div className="hk-srow__btns">
          {shownIdea && <button type="button" className="hk-btn hk-chipbtn" onClick={copyIdea} data-hk-copy-idea><Icon name="copy" size={15} /> Copy idea</button>}
          {canEdit && !editing && <button type="button" className="hk-btn hk-chipbtn" onClick={() => setEditing(true)} data-hk-edit-idea><Icon name="note" size={15} /> Edit</button>}
          {c.research && <span className="hk-meta hk-srow__cost">Researched {fmtDate(c.research.researched_at)}{c.research.cost_usd != null ? ` · ${money(c.research.cost_usd)}` : ''}</span>}
        </div>
      </div>
      <div className="hk-srow__mid">
        <div className="hk-srow__panel">
          <h3 className="hk-kicker">Best contact</h3>
          {c.contact
            ? <div className="hk-srow__contact"><span className="hk-tile-sm" aria-hidden="true">{(c.contact.title || c.contact.name || '?')[0].toUpperCase()}</span><span><strong>{c.contact.title || c.contact.name}</strong><span className="hk-meta hk-block">{c.contact.title && c.contact.name ? `${c.contact.name} · ` : ''}{c.contact.source}</span></span></div>
            : <p className="hk-meta">No contact yet.</p>}
          {canEdit && <button type="button" className="hk-btn hk-link" onClick={() => onOpenBrand(c.id)} data-hk-add-contact>+ Add</button>}
        </div>
        {/* Stays mounted when the suggestion goes (Wrong site), so its Undo line survives the reload. */}
        <div className={c.suggestion ? 'hk-srow__sitebox' : undefined}>
          {c.suggestion && <h3 className="hk-kicker">Website (suggested)</h3>}
          <SiteSuggestion businessId={businessId} brandId={c.id} brandName={c.name} suggestion={c.suggestion} canEdit={canEdit} saveLabel="Yes, save" className="hk-srow__site-line" onChanged={onChanged} setNote={setNote} />
        </div>
      </div>
      <div className="hk-srow__panel">
        <h3 className="hk-kicker">Why score {c.score}</h3>
        <dl className="hk-parts" data-hk-score-parts={total}>
          {c.score_parts.map(p => <div key={p.key} className="hk-parts__row"><dt>{p.words[0].toUpperCase() + p.words.slice(1)}</dt><dd>{p.points > 0 ? `+${p.points}` : p.points}</dd></div>)}
        </dl>
        <h3 className="hk-kicker">More</h3>
        <ul className="hk-more">
          {canEdit && <li><button type="button" className="hk-btn hk-more__item" onClick={() => onAct('claim', c)} data-hk-more-claim><Icon name="person" size={15} /> Claim only</button></li>}
          <li><button type="button" className="hk-btn hk-more__item" onClick={() => onAct('copy', c)} data-hk-more-copy><Icon name="copy" size={15} /> Copy command: {c.command}</button></li>
          <li><button type="button" className="hk-btn hk-more__item" onClick={() => onOpenBrand(c.id)} data-hk-more-open><Icon name="chevron" size={15} /> Open brand page</button></li>
          {canEdit && (dnc == null
            ? <li><button type="button" className="hk-btn hk-more__item" onClick={() => setDnc('')} data-hk-more-dnc><Icon name="lock" size={15} /> Do not contact</button></li>
            : <li className="hk-srow__edit"><input className="ui-input" value={dnc} maxLength={200} onChange={e => setDnc(e.target.value)} aria-label="Why not contact them?" placeholder="Why?" /><button type="button" className="hk-btn hk-chipbtn" disabled={!dnc.trim()} onClick={saveDnc}>Mark</button><button type="button" className="hk-btn hk-link" onClick={() => setDnc(null)}>Cancel</button></li>)}
        </ul>
      </div>
      <p className="hk-srow__foot">
        <span><strong>Pitch</strong> claims it as yours and copies <code>{c.command}</code> for Claude. Nothing sends.</span>
        <span className="hk-keys" aria-label="Keys">{[['P', 'pitch'], ['T', 'target'], ['R', 'research'], ['S', 'snooze'], ['X', 'not a fit']].map(([k, w]) => <span key={k}><kbd>{k}</kbd> {w}</span>)}</span>
      </p>
    </div>
  );
}

export default function SendRow({ c, i, open, onToggle, selected, onSelect, canEdit, meId, members, cmd, onOpenBrand, onGo, businessId, onChanged, setNote, onMove }) {
  const firstName = id => members.find(m => m.user_id === id)?.first_name || null;
  const site = siteOf(c);
  const onKeyDown = e => {
    if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'j' || k === 'k') { e.preventDefault(); onMove(k === 'j' ? 1 : -1); return; }
    if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); onToggle(); return; }
    const action = KEYS[k];
    if (!action || !canEdit) return;
    if (action === 'pitch' && c.primary?.kind !== 'pitch') return;
    e.preventDefault(); cmd.act(action, c);
  };
  return (
    <li className={`hk-srow${open ? ' hk-srow--open' : ''}${selected ? ' hk-srow--selected' : ''}`} tabIndex={0} onKeyDown={onKeyDown} aria-label={`${i + 1}. ${c.name}, score ${c.score}`} data-hk-send-row={c.id}>
      <div className="hk-srow__main">
        {canEdit && <input type="checkbox" className="hk-srow__check" checked={selected} onChange={() => onSelect(c.id)} aria-label={`Select ${c.name}`} />}
        <span className="hk-srow__rank" aria-hidden="true">{i + 1}</span>
        <span className="hk-tile-sm hk-tile-sm--lg" aria-hidden="true">{c.name.trim()[0].toUpperCase()}</span>
        <div className="hk-srow__body">
          <div className="hk-srow__title">
            <button type="button" className="hk-btn hk-srow__name" onClick={() => onOpenBrand(c.id)}>{c.name}</button>
            <span className={`hk-srow__site hk-srow__site--${site.state}`} data-hk-site-state={site.state}>{site.state === 'none' ? 'no website yet' : site.state === 'suggested' ? `${site.domain} · suggested` : site.domain}</span>
            <span className="hk-srow__why" data-hk-send-why><strong>Why now:</strong> {whyNowOf(c)}</span>
          </div>
          <BrandLabels brand={c} />
        </div>
        <span className="hk-srow__score" data-hk-send-score={c.score}><span className="hk-srow__n">{c.score}</span><span className="hk-srow__unit">Score</span></span>
        {canEdit && <span className="hk-srow__acts"><PrimaryAction brand={c} onAct={cmd.act} onGo={onGo} onOpenBrand={onOpenBrand} busy={cmd.busy} /><QuickIcons brand={c} meId={meId} firstName={firstName} onAct={cmd.act} busy={cmd.busy} /></span>}
        <button type="button" className="hk-btn hk-qc hk-srow__chev" aria-expanded={open} aria-label={open ? `Collapse ${c.name}` : `Expand ${c.name}`} onClick={onToggle} data-hk-expand-btn={c.id}><Icon name="chevron" size={17} /></button>
      </div>
      {open && <Expand c={c} canEdit={canEdit} businessId={businessId} onAct={cmd.act} onOpenBrand={onOpenBrand} onChanged={onChanged} setNote={setNote} />}
    </li>
  );
}
