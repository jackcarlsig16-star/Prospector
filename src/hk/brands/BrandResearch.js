import React, { useState } from 'react';
import { Icon } from '../HkMarks';
import { hkGet, hkPatch, hkPost } from '../hkApi';
import { FIT_WORDS, FIT_TONE } from './labelRules';

// grow-ui-refresh-v1 U7 + U8 - the Brand page's Research card (mockup 2): fit chip, What they do, Why it fits, the
// Challenge idea card (Copy idea / Edit -> the brand's own idea), "researched <when> · <who> · $<cost>", and the split
// button: [Re-run] (its cost shown first when the day's research cap is within one call's average) ▾ Use a different
// website (researched, then offered as a suggestion - never saved as the website) · Add context for this brand (<= 300,
// addresses / phones refused, sent with the next research) · View last research input.
const fmt = iso => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(' PM', ' pm').replace(' AM', ' am') : '');
const money = n => `$${Number(n || 0).toFixed(2)}`;

export default function BrandResearch({ businessId, brand, research, budget, member, canEdit, onChanged, setNote }) {
  const [menu, setMenu] = useState(false);
  const [panel, setPanel] = useState(null); // 'site' | 'context' | 'input'
  const [site, setSite] = useState('');
  const [context, setContext] = useState(brand.research_context || '');
  const [input, setInput] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const idea = brand.challenge_idea || research?.challenge_idea || '';
  const [ideaDraft, setIdeaDraft] = useState(idea);
  const near = budget && budget.per_call != null && budget.spent_today + budget.per_call >= budget.cap_usd;
  const run = async (body, label) => {
    setBusy(true); setNote('');
    try {
      const r = await hkPost(businessId, `/brands/${brand.id}/research`, { click: true, confirm: true, ...body });
      setNote(r.status === 'not_found' ? `No website found for ${brand.name}.` : `${label}: ${r.suggested ? `website ${r.domain} (suggested)` : r.domain} · ${String(r.intel?.fit?.sponsor_fit || 'unknown').replace(/_/g, ' ')} fit · ${money(r.cost_usd)}.`);
      setPanel(null); await onChanged();
    } catch (e) { setNote(e.message); } finally { setBusy(false); }
  };
  const saveContext = async () => { setBusy(true); try { await hkPatch(businessId, `/brands/${brand.id}`, { research_context: context.trim() || null }); setPanel(null); setNote('Context saved. The next research uses it.'); await onChanged(); } catch (e) { setNote(e.message); } finally { setBusy(false); } };
  const showInput = async () => { setMenu(false); setPanel('input'); try { setInput((await hkGet(businessId, `/brands/${brand.id}/research-input`)).input); } catch (e) { setInput(e.message); } };
  const saveIdea = async () => { try { await hkPatch(businessId, `/brands/${brand.id}`, { challenge_idea: ideaDraft }); setEditing(false); await onChanged(); } catch (e) { setNote(e.message); } };
  const copyIdea = async () => { try { await navigator.clipboard.writeText(idea); setNote('Challenge idea copied.'); } catch { setNote(`Copy failed. The idea is: ${idea}`); } };
  const by = research?.researched_by ? member(research.researched_by)?.first_name || 'a member' : 'auto sweep';
  // "'Fuel Your Challenge' — members earn…" -> the name above the description (a spaced dash or a colon only).
  const ideaTitle = idea.split(/\s[—–-]\s|:\s/)[0].trim().replace(/^['"‘“]|['"’”]$/g, '');
  return (
    <section className="hk-bcard" aria-label="Research" data-hk-research-card>
      <div className="hk-bcard__head">
        <h2 className="hk-bcard__title">Research</h2>
        {research && <span className={`hk-label hk-label--${FIT_TONE[research.fit] || 'grey'}`} data-hk-research-fit>{FIT_WORDS[research.fit] || 'Fit unknown'}</span>}
        <span className="hk-spacer" />
        {research && <span className="hk-meta" data-hk-researched>{fmt(research.researched_at)} · {by}{research.cost_usd != null ? ` · ${money(research.cost_usd)}` : ''}</span>}
        {canEdit && (
          <span className="hk-split hk-anchor">
            <button type="button" className="hk-btn hk-split__main" disabled={busy} onClick={() => run({}, research ? 'Re-ran' : 'Researched')} aria-keyshortcuts="R" data-hk-rerun>
              <Icon name="search" size={15} />{busy ? 'Researching…' : `${research ? 'Re-run' : 'Research'}${near ? ` · ~${money(budget.per_call)}` : ''}`}
            </button>
            <button type="button" className="hk-btn hk-split__more" aria-label="More research options" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(m => !m)} data-hk-rerun-more><Icon name="chevron" size={15} /></button>
            {menu && (
              <span className="hk-menu hk-menu--right" role="menu" onMouseLeave={() => setMenu(false)}>
                <button type="button" role="menuitem" className="hk-btn hk-menu__item" onClick={() => { setMenu(false); setPanel('site'); }}>Use a different website</button>
                <button type="button" role="menuitem" className="hk-btn hk-menu__item" onClick={() => { setMenu(false); setPanel('context'); }}>Add context for this brand</button>
                <button type="button" role="menuitem" className="hk-btn hk-menu__item" onClick={showInput}>View last research input</button>
              </span>
            )}
          </span>
        )}
      </div>
      {near && <p className="hk-meta" data-hk-cap-near>Today's research is {money(budget.spent_today)} of the {money(budget.cap_usd)} cap; one more is about {money(budget.per_call)}.</p>}
      {panel === 'site' && (
        <form className="hk-inline-row" onSubmit={e => { e.preventDefault(); run({ website: site }, 'Researched'); }}>
          <input className="ui-input" aria-label="A different website" placeholder="brand.com" value={site} maxLength={200} onChange={e => setSite(e.target.value)} />
          <button type="submit" className="hk-btn hk-primary" disabled={busy || !site.trim()}>Research it</button>
          <button type="button" className="hk-btn hk-link" onClick={() => setPanel(null)}>Cancel</button>
          <span className="hk-meta">Becomes a suggestion; the saved website stays as it is.</span>
        </form>
      )}
      {panel === 'context' && (
        <div className="hk-inline-row">
          <textarea className="ui-input" rows={2} aria-label="Context for this brand" maxLength={300} value={context} onChange={e => setContext(e.target.value)} placeholder="e.g. They sponsor 5Ks; ask about their run club." />
          <button type="button" className="hk-btn hk-primary" disabled={busy} onClick={saveContext}>Save context</button>
          <button type="button" className="hk-btn hk-link" onClick={() => setPanel(null)}>Cancel</button>
          <span className="hk-meta">{context.length}/300 · no email addresses or phone numbers</span>
        </div>
      )}
      {panel === 'input' && <div className="hk-inline-row"><pre className="hk-pre" data-hk-research-input>{input ?? 'Loading…'}</pre><button type="button" className="hk-btn hk-link" onClick={() => setPanel(null)}>Close</button></div>}
      {research ? (
        <div className="hk-research">
          <div className="hk-research__text">
            <h3 className="hk-kicker">What they do</h3>
            <p className="hk-research__p">{research.what_they_do || 'Research found no description.'}</p>
            <h3 className="hk-kicker">Why it fits</h3>
            <p className="hk-research__p hk-research__p--muted">{research.why || 'No reason given.'}</p>
          </div>
          <div className="hk-research__idea">
            <h3 className="hk-kicker">Challenge idea</h3>
            {editing
              ? <div className="hk-srow__edit"><textarea className="ui-input" rows={3} maxLength={1000} value={ideaDraft} onChange={e => setIdeaDraft(e.target.value)} aria-label="Challenge idea" /><button type="button" className="hk-btn hk-chipbtn" onClick={saveIdea}>Save</button><button type="button" className="hk-btn hk-link" onClick={() => setEditing(false)}>Cancel</button></div>
              : <>{ideaTitle && ideaTitle !== idea && <p className="hk-research__ideatitle">{ideaTitle}</p>}<p className="hk-research__p hk-research__p--muted">{idea || 'No idea yet.'}</p></>}
            <div className="hk-srow__btns">
              {idea && <button type="button" className="hk-btn hk-chipbtn" onClick={copyIdea} data-hk-copy-idea><Icon name="copy" size={15} /> Copy idea</button>}
              {canEdit && !editing && <button type="button" className="hk-btn hk-chipbtn" onClick={() => { setIdeaDraft(idea); setEditing(true); }} data-hk-edit-idea><Icon name="note" size={15} /> Edit</button>}
            </div>
          </div>
        </div>
      ) : <p className="hk-meta" data-hk-not-researched>Not researched yet.{brand.research_attempted_at ? ` No website found ${fmt(brand.research_attempted_at)}.` : ''}</p>}
    </section>
  );
}
