import { useState, useEffect, useRef } from 'react';
import { SA } from '../theme';
import { ErrorNote } from './goalsUi';
import { OWNER_TEAMS, TEAM_LABEL } from '../../../constants/ownership';
import { PRIORITIES, PRIORITY_WORD } from '../../../constants/salesChannels';
import { NOT_A_FIT, priorityValue } from './priorityActions';
import { stageOptions } from './companyPanelModel';
import { forwardStages, editControls } from './companyPanelFacts';
import { priorityColor } from '../palette';
import { SourceForm } from './LeadSource';
import useCompanyEdits, { nextStepWritable } from './companyEdits';
import { IconMore } from '../../../ui/icons';

// company-panel-v3 F / T / D1 / D2 - the facts ARE the edit row: an editable fact (per editControls, + Next step on
// partners / employers) is a button - label above, value + caret - that opens the same control the v2 Edit row had, as
// a popover anchored to it (role=dialog, labelled); each change saves at once with the 10 s Undo. Employees, Last touch,
// Reach, Website never edit here. Viewers get plain facts. The ⋯ menu holds Jump to stage (confirm on the way back),
// Source (the same form as the Source fact), Website (Set domain) and Copy link; their forms open under the facts.
const FACT_CONTROL = { Stage: 'stage', Owner: 'owner', Team: 'team', Priority: 'priority', Source: 'source' };
export const editableFacts = row => {
  const c = editControls(row);
  return [...Object.keys(FACT_CONTROL).filter(l => c.includes(FACT_CONTROL[l])), ...(nextStepWritable(row) ? ['Next step'] : [])];
};
const caret = <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" style={{ flex: 'none', color: 'var(--sa-faint, #5E6773)' }}><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const pop = { position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 20, minWidth: 220, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, background: SA.surface2, border: `1px solid ${SA.border}`, borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.35)' };
const selectStyle = { height: 32, width: '100%' };

function FactValue({ label, value, muted, sub, editable }) {
  return (
    <>
      <span className="ui-group-label">{label}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <b title={typeof value === 'string' ? value : undefined} style={{ fontWeight: 500, fontSize: 13, color: muted ? SA.muted : SA.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: label === 'Source' || label === 'Next step' ? 360 : 220 }}>{value}</b>
        {editable && caret}
        {sub && <span data-fact-sub style={{ fontSize: 11, color: SA.muted, whiteSpace: 'nowrap' }}>{sub}</span>}
      </span>
    </>
  );
}

export function MoreMenu({ row, canEdit, onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    const root = ref.current?.closest('[data-center-window]') || ref.current?.parentElement;
    root?.addEventListener('pointerdown', close); ref.current?.addEventListener('keydown', esc);
    const el = ref.current;
    return () => { root?.removeEventListener('pointerdown', close); el?.removeEventListener('keydown', esc); };
  }, [open]);
  const c = editControls(row);
  const items = [
    canEdit && stageOptions(row).length > forwardStages(row).length && ['jump', 'Jump to stage…'],
    canEdit && c.includes('source') && ['source', 'Source…'],
    canEdit && c.includes('domain') && ['domain', row.domain ? `Website · ${row.domain}` : 'Set domain…'],
    ['link', 'Copy link'],
  ].filter(Boolean);
  return (
    <span ref={ref} style={{ position: 'relative' }} data-more-menu>
      <button type="button" className="ui-btn ui-btn--tertiary" aria-label="More" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)} style={{ width: 32, padding: 0 }}><IconMore /></button>
      {open && (
        <div role="menu" aria-label="More" style={{ ...pop, left: 'auto', right: 0, minWidth: 200, padding: 4, gap: 0 }}>
          {items.map(([id, label]) => <button key={id} type="button" role="menuitem" className="ui-btn ui-btn--tertiary" style={{ justifyContent: 'flex-start', width: '100%' }} onClick={() => { setOpen(false); onPick(id); }}>{label}</button>)}
        </div>
      )}
    </span>
  );
}

export default function CompanyFacts({ businessId, row, record, facts, canEdit, members, source, panel, setPanel, onPatch, onChanged, onToast }) {
  const [openFact, setOpenFact] = useState(null);
  const [draft, setDraft] = useState('');
  const edits = useCompanyEdits({ businessId, row, members, onPatch, onChanged, onToast });
  const rowRef = useRef(null);
  useEffect(() => {
    if (!openFact) return undefined;
    const close = e => { if (!e.target.closest?.('[data-fact-pop], [data-fact-button]')) setOpenFact(null); };
    const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); setOpenFact(null); } };
    const root = rowRef.current;
    const dialog = root?.closest('[data-center-window]') || document.body;
    dialog.addEventListener('pointerdown', close); root?.addEventListener('keydown', esc);
    return () => { dialog.removeEventListener('pointerdown', close); root?.removeEventListener('keydown', esc); };
  }, [openFact]);
  const editable = canEdit ? editableFacts(row) : [];
  const busy = w => edits.busy === w;
  const done = ok => { if (ok) setOpenFact(null); };
  const nextBefore = record?.next_step ?? row.next_step ?? null;
  const control = label => {
    if (label === 'Stage') return <div role="listbox" aria-label="Stage" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{forwardStages(row).map(s => <button key={s.id} type="button" role="option" aria-selected={s.id === row.stage} className="ui-btn ui-btn--tertiary" disabled={busy('stage') || s.id === row.stage} style={{ justifyContent: 'flex-start' }} onClick={async () => done(await edits.changeStage(s.id))}>{s.label}{s.id === row.stage ? ' · now' : ''}</button>)}</div>;
    if (label === 'Owner') return <select aria-label="Owner" className="ui-filter__select" style={selectStyle} value={row.owner_user_id || ''} disabled={busy('owner')} onChange={async e => done(await edits.changeOwner(e.target.value))}>{[{ value: '', label: 'Unassigned' }, ...members.filter(m => m.role !== 'viewer').map(m => ({ value: m.user_id, label: m.name }))].map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
    if (label === 'Team') return <select aria-label="Team" className="ui-filter__select" style={selectStyle} value={row.owner_team || ''} disabled={busy('team')} onChange={async e => done(await edits.changeTeam(e.target.value))}>{[{ value: '', label: 'None' }, ...OWNER_TEAMS.map(t => ({ value: t, label: TEAM_LABEL[t] }))].map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
    if (label === 'Priority') return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {priorityValue(row) && priorityValue(row) !== NOT_A_FIT && <span className="ui-tag__dot" data-priority-dot aria-hidden="true" style={{ '--tag-color': priorityColor(priorityValue(row)) }} />}
        <select aria-label="Priority" className="ui-filter__select" style={selectStyle} value={priorityValue(row)} disabled={busy('priority')} onChange={async e => done(await edits.changePriority(e.target.value))}>{[{ value: '', label: '—' }, ...PRIORITIES.map(p => ({ value: String(p), label: `P${p} · ${PRIORITY_WORD[p]}` })), { value: NOT_A_FIT, label: 'Not a fit' }].map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
      </span>
    );
    if (label === 'Next step') return (
      <form onSubmit={async e => { e.preventDefault(); done(await edits.saveNextStep(draft, nextBefore)); }} style={{ display: 'flex', gap: 6 }}>
        <input autoFocus aria-label="Next step" className="ui-input ui-input--sm" maxLength={200} placeholder="e.g. Send the one-pager" value={draft} onChange={e => setDraft(e.target.value)} style={{ width: 260 }} />
        <button type="submit" className="ui-btn ui-btn--primary ui-btn--sm" disabled={busy('next')}>{busy('next') ? 'Saving…' : 'Save'}</button>
      </form>
    );
    return null;
  };
  const click = label => {
    if (label === 'Source') { setOpenFact(null); setPanel(panel === 'source' ? null : 'source'); return; }
    if (label === 'Next step') setDraft(nextBefore || '');
    setOpenFact(f => (f === label ? null : label));
  };
  return (
    <div ref={rowRef} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div data-facts-row style={{ display: 'flex', gap: '6px 18px', flexWrap: 'wrap' }}>
        {facts.map(([label, value, muted, sub]) => {
          const ed = editable.includes(label);
          const title = label === 'Stage' ? 'Stage only moves forward · saves at once · Undo 10 s' : label === 'Next step' && row.type === 'target' ? 'Set after Add to pipeline' : undefined;
          return ed ? (
            <span key={label} style={{ position: 'relative' }}>
              <button type="button" data-fact={label} data-fact-button aria-haspopup="dialog" aria-expanded={openFact === label || (label === 'Source' && panel === 'source')} title={title} onClick={() => click(label)}
                className="ui-fact-btn" style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', flexDirection: 'column', gap: 3, minWidth: 0, padding: '4px 8px', margin: '0 -8px', borderRadius: 8, boxShadow: openFact === label ? `0 0 0 1px ${SA.border}` : undefined, background: openFact === label ? SA.surface2 : undefined }}>
                <FactValue label={label} value={value} muted={muted} sub={sub} editable />
              </button>
              {openFact === label && <div role="dialog" aria-label={label} data-fact-pop style={pop}>{control(label)}</div>}
            </span>
          ) : (
            <div key={label} data-fact={label} title={title} style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, padding: '4px 0' }}>
              <FactValue label={label} value={value} muted={muted} sub={sub} />
            </div>
          );
        })}
      </div>
      {panel === 'jump' && (
        <div role="group" aria-label="Jump to stage" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {stageOptions(row).map(s => (
            <button key={s.id} type="button" className="ui-btn ui-btn--secondary" disabled={s.dir === 'now' || busy('stage')} aria-current={s.dir === 'now' ? 'true' : undefined} onClick={async () => { if (await edits.changeStage(s.id)) setPanel(null); }}
              title={s.dir === 'back' ? 'Backwards - asks you to confirm' : undefined} style={{ color: s.dir === 'back' ? SA.warn : undefined }}>
              {s.dir === 'back' ? '↩ ' : ''}{s.label}{s.dir === 'now' ? ' · now' : ''}
            </button>
          ))}
          <button type="button" className="ui-btn ui-btn--tertiary" onClick={() => setPanel(null)}>Close</button>
        </div>
      )}
      {panel === 'domain' && <DomainForm row={row} busy={busy('domain')} onSave={async d => { if (await edits.saveDomain(d)) setPanel(null); }} onCancel={() => setPanel(null)} />}
      {panel === 'source' && <SourceForm key={source?.set_at || 'none'} businessId={businessId} row={row} source={source} onSaved={() => { setPanel(null); onChanged(); }} onToast={onToast} onCancel={() => setPanel(null)} />}
      {edits.error && <ErrorNote message={edits.error} />}
    </div>
  );
}

function DomainForm({ row, busy, onSave, onCancel }) {
  const [draft, setDraft] = useState(row.domain || '');
  return (
    <form data-domain-form onSubmit={e => { e.preventDefault(); onSave(draft); }} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <input aria-label="Website" placeholder="company.com" value={draft} maxLength={120} onChange={e => setDraft(e.target.value)} className="ui-input ui-input--sm" style={{ width: 220 }} />
      <button type="submit" className="ui-btn ui-btn--primary ui-btn--sm" disabled={busy}>{busy ? 'Saving…' : 'Save website'}</button>
      <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={onCancel}>Cancel</button>
      <span style={{ fontSize: 12, color: SA.muted }}>Fill-only elsewhere; a typed website is never overwritten</span>
    </form>
  );
}
