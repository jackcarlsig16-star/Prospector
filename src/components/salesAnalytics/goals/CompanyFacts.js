import { useState, useEffect, useRef } from 'react';
import { SA } from '../theme';
import { ErrorNote } from './goalsUi';
import { memberColor } from '../../../constants/memberColors';
import { OWNER_TEAMS, TEAM_LABEL } from '../../../constants/ownership';
import { stageOptions } from './companyPanelModel';
import { forwardStages, editControls, researchNumbers, readinessOf } from './companyPanelFacts';
import { ORG_TYPE_ENUM, ORG_TYPE_LABELS } from '../pipelineStages';
import { SourceForm } from './LeadSource';
import useCompanyEdits, { nextStepWritable } from './companyEdits';
import { IconMore } from '../../../ui/icons';

// company-window-v4 F1 / F2 - a fact's popover IS the list: Owner (members with their color dot + Unassigned), Team,
// Priority and Type open a role=listbox directly under the fact; a pick closes it and saves at once with the 10 s Undo
// (the same calls as before). Employees (number + "from research: n · Use") and Reach are small forms, Next step an
// inline text, Source the existing form under the facts. No <select> anywhere in the window. Readiness rides on the
// fact: a companySteps step still open (no owner, no size) draws its fact red dashed with "unassigned" / "unknown" in
// red and the step's "Needed before …" title. Viewers get plain facts. The ⋯ menu holds Jump to stage (confirm on the
// way back), Source, Website (Set domain) and Copy link; their forms open under the facts.
const FACT_CONTROL = { Owner: 'owner', Team: 'team', Employees: 'employees', Reach: 'reach', Type: 'type', Source: 'source' };
export const editableFacts = row => {
  const c = editControls(row);
  return [...Object.keys(FACT_CONTROL).filter(l => c.includes(FACT_CONTROL[l])), ...(nextStepWritable(row) ? ['Next step'] : [])];
};
const caret = <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" style={{ flex: 'none', color: 'var(--sa-faint, #5E6773)' }}><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const pop = { position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 20, minWidth: 200, padding: 6, display: 'flex', flexDirection: 'column', gap: 2, background: SA.surface2, border: `1px solid ${SA.border}`, borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.35)' };
const formPop = { ...pop, minWidth: 240, padding: 10, gap: 8 };
const NEED = { border: `1px dashed ${SA.bad}`, boxShadow: `0 0 0 3px color-mix(in srgb, ${SA.bad} 12%, transparent)` };
const num = v => (v == null || v === '' ? null : Number(String(v).replace(/[,\s]/g, '')));
const fmt = n => Number(n).toLocaleString('en-US');
const Dot = ({ color }) => <i aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: color, display: 'inline-block', flex: 'none' }} />;

function FactValue({ label, value, muted, sub, editable, dot, need }) {
  return (
    <>
      <span className="ui-group-label">{label}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        {dot && <Dot color={dot} />}
        <b title={typeof value === 'string' ? value : undefined} style={{ fontWeight: 500, fontSize: 13, color: need ? SA.bad : muted ? SA.muted : SA.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: `min(${label === 'Source' || label === 'Next step' ? 360 : 220}px, calc(100vw - 96px))`, ...(editable && !need ? { textDecoration: 'underline dotted', textDecorationColor: 'var(--sa-muted)', textUnderlineOffset: 4 } : {}) }}>{need ? need.word : value}</b>
        {editable && caret}
        {sub && !need && <span data-fact-sub style={{ fontSize: 11, color: SA.muted, whiteSpace: 'nowrap' }}>{sub}</span>}
      </span>
    </>
  );
}

// The list under a fact: one click = the pick. options [{ value, label, dot? }].
function Options({ label, options, value, busy, onPick }) {
  return (
    <div role="listbox" aria-label={label} data-fact-pop style={pop}>
      {options.map(o => (
        <button key={o.value} type="button" role="option" aria-selected={o.value === value} className="ui-btn ui-btn--tertiary" disabled={busy}
          style={{ justifyContent: 'flex-start', width: '100%', ...(o.value === value ? { background: SA.inset } : {}) }} onClick={() => onPick(o.value)}>
          {o.dot && <Dot color={o.dot} />}{o.label}
        </button>
      ))}
    </div>
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

function NumberForm({ label, fields, record, found, busy, onSave }) {
  const [draft, setDraft] = useState({});
  const value = k => (k in draft ? draft[k] : record?.[k] ?? '');
  const submit = e => {
    e.preventDefault();
    const body = Object.fromEntries(fields.filter(([k]) => k in draft).map(([k]) => [k, num(draft[k])]));
    if (!Object.keys(body).length) return onSave(null);
    return onSave(body, Object.fromEntries(Object.keys(body).map(k => [k, record?.[k] ?? null])));
  };
  return (
    <form role="dialog" aria-label={label} data-fact-pop onSubmit={submit} style={formPop}>
      {fields.map(([k, lb]) => {
        const use = found[k] != null && found[k] !== record?.[k] ? found[k] : null;
        return (
          <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: SA.soft }}>
            {lb}{record?.[`${k}_source`] ? <span style={{ color: SA.muted }}> · {record[`${k}_source`] === 'manual' ? 'typed' : record[`${k}_source`] === 'apollo' ? 'Apollo' : 'from research'}</span> : null}
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input autoFocus={k === fields[0][0]} aria-label={lb} inputMode="numeric" className="ui-input ui-input--sm" value={value(k)} onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))} style={{ width: 110 }} />
              {use != null && <span style={{ fontSize: 12, color: SA.muted, whiteSpace: 'nowrap' }}>from research: {fmt(use)} · <button type="button" className="ui-link" onClick={() => setDraft(d => ({ ...d, [k]: String(use) }))}>Use</button></span>}
            </span>
          </label>
        );
      })}
      <button type="submit" className="ui-btn ui-btn--primary ui-btn--sm" disabled={busy} style={{ alignSelf: 'flex-start' }}>{busy ? 'Saving…' : 'Save'}</button>
    </form>
  );
}

export default function CompanyFacts({ businessId, row, record, detail, steps, facts, canEdit, members, source, panel, setPanel, onPatch, onChanged, onToast }) {
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
  const need = readinessOf(steps);
  const people = members.filter(m => m.role !== 'viewer');
  const colorOf = m => m.color || memberColor(members.indexOf(m));
  const ownerDot = row.owner_user_id ? colorOf(members.find(m => m.user_id === row.owner_user_id) || {}) : null;
  const found = researchNumbers(detail);
  const saveNumbers = async (body, before) => { if (!body) { setOpenFact(null); return; } done(await edits.saveNumbers(body, before)); };
  const control = label => {
    if (label === 'Owner') return <Options label="Owner" value={row.owner_user_id || ''} busy={busy('owner')} onPick={async v => done(await edits.changeOwner(v))} options={[...people.map(m => ({ value: m.user_id, label: m.name, dot: colorOf(m) })), { value: '', label: 'Unassigned' }]} />;
    if (label === 'Team') return <Options label="Team" value={row.owner_team || ''} busy={busy('team')} onPick={async v => done(await edits.changeTeam(v))} options={[...OWNER_TEAMS.map(t => ({ value: t, label: TEAM_LABEL[t] })), { value: '', label: 'None' }]} />;
    if (label === 'Type') return <Options label="Type" value={record?.org_type || row.org_type || ''} busy={busy('type')} onPick={async v => done(await edits.changeType(v))} options={ORG_TYPE_ENUM.map(t => ({ value: t, label: ORG_TYPE_LABELS[t] }))} />;
    if (label === 'Employees') return <NumberForm label="Employees" fields={[['employees', 'Employees']]} record={record} found={found} busy={busy('numbers')} onSave={saveNumbers} />;
    if (label === 'Reach') return <NumberForm label="Reach" fields={[['reach_employees', 'Covers (employees)'], ['reach_clients', 'Clients']]} record={record} found={found} busy={busy('numbers')} onSave={saveNumbers} />;
    if (label === 'Next step') return (
      <form role="dialog" aria-label="Next step" data-fact-pop onSubmit={async e => { e.preventDefault(); done(await edits.saveNextStep(draft, nextBefore)); }} style={{ ...formPop, flexDirection: 'row', minWidth: 0 }}>
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
      <div data-facts-row style={{ display: 'flex', gap: '6px 14px', flexWrap: 'wrap' }}>
        {facts.map(([label, value, muted, sub]) => {
          const ed = editable.includes(label);
          const nd = muted && need[label] ? need[label] : null;
          const title = nd ? nd.title : label === 'Next step' && row.type === 'target' ? 'Set after Add to pipeline' : undefined;
          const dot = label === 'Owner' && !nd ? ownerDot : null;
          return ed ? (
            <span key={label} style={{ position: 'relative' }}>
              <button type="button" data-fact={label} data-fact-button data-need={nd ? 'true' : undefined} aria-haspopup={['Owner', 'Team', 'Type'].includes(label) ? 'listbox' : 'dialog'} aria-expanded={openFact === label || (label === 'Source' && panel === 'source')} title={title} onClick={() => click(label)}
                className="ui-fact-btn" style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', flexDirection: 'column', gap: 3, minWidth: 0, padding: '4px 8px', margin: '0 -8px', borderRadius: 8, border: '1px solid transparent', boxSizing: 'border-box', ...(nd ? NEED : {}), ...(openFact === label ? { boxShadow: `0 0 0 1px ${SA.border}`, background: SA.surface2 } : {}) }}>
                <FactValue label={label} value={value} muted={muted} sub={sub} editable dot={dot} need={nd} />
              </button>
              {openFact === label && control(label)}
            </span>
          ) : (
            <div key={label} data-fact={label} data-need={nd ? 'true' : undefined} title={title} style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, padding: '4px 8px', margin: '0 -8px', borderRadius: 8, border: '1px solid transparent', boxSizing: 'border-box', ...(nd ? NEED : {}) }}>
              <FactValue label={label} value={value} muted={muted} sub={sub} dot={dot} need={nd} />
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
