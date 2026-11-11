import { useState, useEffect, useRef } from 'react';
import { SA } from '../theme';
import { ui } from '../../../ui/kitTheme';
import { goalsApi } from './goalsApi';
import { labelStyle, inputStyle, ErrorNote } from './goalsUi';
import { apolloLine } from './partners/PartnerResearch';
import { needsRecord, addAsk, playbookPrompt, mondayOf } from './companyPanelModel';
import { updateOpportunity } from '../pipelineApi';
import OwnerPicker from './OwnerPicker';
import { bookMeeting, markContacted } from './companyReach';
import { DeprioritizeForm, TheyRepliedForm } from './FlowSheets';
import { ownerChip, isLivePartner } from './flowModel';
import { IconPencil, IconMail, IconCalendar, IconCheck, IconSearch, IconPeople, IconPhone, IconPause, IconLink } from '../../../ui/icons';

// homelover-flow-v1 F5 / F8 / F9 - the Actions row in four labelled verb groups that follow the flow, one row:
// REACH Draft email (E) · Log call · Book meeting · Mark contacted (only while behind Contacted) · They replied…
// (employers past Target) | DECIDE Add to pipeline ▾ (primary: a target's promote form; visitor / Apollo) · Not a fit (targets) ·
// Deprioritize… / Bring back | CAPTURE Note (N) · To-do (T) · Contact (C) | LEARN Research (R) · Check Apollo.
// Owner is an editable fact and every stage move is the Progress bar's, so neither has a button here.
// A live partner (mockup C): PARTNER Add referred client · Log referral · Book check-in · Draft email | CAPTURE |
// DECIDE Owner ▾ · Pause…. Buttons that don't apply to the state are hidden, not greyed. The single-key shortcuts
// listen on the window element only (no global handler), never while focus is in a field or a popover / menu is open,
// never with a modifier. Every write offers Undo where one exists. Draft email never sends. Members only. The open
// form is owned by the panel so a card's "+ Add" link can open it.
const SHORTCUT_KEYS = { n: 'note', t: 'todo', c: 'contact', e: 'draft', r: 'research' };
const kbd = k => <kbd aria-hidden="true" style={{ font: "10.5px 'Geist Mono', ui-monospace, monospace", color: SA.muted, border: `1px solid ${SA.border}`, borderRadius: 4, padding: '0 4px', marginLeft: 2 }}>{k}</kbd>;
function Group({ id, label, icon, children }) {
  return (
    <div role="group" aria-label={label} data-action-group={id} style={{ display: 'inline-flex', flexDirection: 'column', gap: 5, maxWidth: '100%' }}>
      <span className="ui-group-label" aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10 }}>{icon}{label}</span>
      <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>{children}</div>
    </div>
  );
}
const divider = <span aria-hidden="true" style={{ width: 1, height: 46, background: SA.border, alignSelf: 'flex-end', margin: '0 4px' }} />;
const LINK_TYPE = { partner: 'partner', employer: 'opportunity', target: 'target' };
const field = { ...inputStyle, height: 32, fontSize: 13, padding: '0 8px' };
const btn = 'ui-btn ui-btn--secondary';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
// Stages behind Contacted: Mark contacted shows; at or past it, it is gone (F8).
const behindContacted = (row, stage) => row.type === 'target' || (row.type === 'employer' && (stage || row.stage) === 'target') || (row.type === 'partner' && ['not_started', 'researching', 'first_email_drafted'].includes(stage || row.stage || 'not_started'));

export default function CompanyActions({ businessId, row, members, meId, form, setForm, bandShown, fit = null, stage = null, actionsRef = null, onPatch, onChanged, onToast, onConvert, onClose, onOwner, onAddClient }) {
  const [busy, setBusy] = useState('');
  const rootRef = useRef(null);
  const keysRef = useRef(null); // the latest shortcut handler, set below once the actions exist
  const [error, setError] = useState('');
  const [draft, setDraft] = useState({});
  // company-workflow-v1 W3: the owner person for Add to pipeline / Promote (defaults to me; a target keeps its own).
  const [owner, setOwner] = useState(undefined);
  const ownerPick = owner === undefined ? row.owner_user_id || meId || null : owner;
  useEffect(() => {
    const win = rootRef.current?.closest('[data-center-window]');
    if (!win) return undefined;
    const onKey = e => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const what = SHORTCUT_KEYS[e.key.toLowerCase()];
      if (!what || e.target.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return;
      if (win.querySelector('[role="menu"], [data-fact-pop], [data-intent-fact][open]')) return;
      e.preventDefault();
      keysRef.current?.(what);
    };
    win.addEventListener('keydown', onKey);
    return () => win.removeEventListener('keydown', onKey);
  }, []);
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  const open = f => { setForm(form === f ? null : f); setDraft({}); setError(''); };
  const current = stage || row.stage;
  const live = isLivePartner(row);
  const deprioritized = fit?.level === 'deprioritized';

  const act = async (what, fn) => {
    setBusy(what); setError('');
    try { return await fn(); } catch (e) { setError(e.message); return undefined; } finally { setBusy(''); }
  };
  const ensureRecord = async kind => {
    if (!needsRecord(row.type)) return row;
    if (!kind && !window.confirm(addAsk(row.name))) return null;
    const r = await goalsApi.addToPipeline(businessId, { type: row.type, id: row.id, to: 'target', ...(kind ? { kind } : {}) });
    const rec = r.created || r.already;
    onConvert(rec, !!r.already);
    return { ...row, type: rec.type, id: rec.id, name: rec.name, stage: r.created ? 'researching' : row.stage };
  };

  const addNote = () => act('note', async () => {
    const rec = await ensureRecord(); if (!rec) return;
    await goalsApi.addCompanyNote(businessId, rec.type, rec.id, draft.note.trim());
    setForm(null); onChanged(); onToast({ text: `Note added to ${rec.name}` });
  });
  const addTodo = () => act('todo', async () => {
    const rec = await ensureRecord(); if (!rec) return;
    const due = draft.due || null;
    const goal = await goalsApi.createWeekGoal(businessId, { week_start: mondayOf(due || today()), kind: 'todo', text: draft.text.trim(), owner_user_id: draft.owner ?? meId ?? null, due_date: due, link_type: LINK_TYPE[rec.type], link_id: rec.id });
    setForm(null); onChanged();
    const who = members.find(m => m.user_id === goal.owner_user_id);
    onToast({ text: `To-do added${who ? ` for ${who.name.split(' ')[0]}` : ''}`, undo: async () => { await goalsApi.undoTodoEvent(businessId, goal.event_id); onChanged(); } });
  });
  const addContact = () => act('contact', async () => {
    const rec = await ensureRecord(); if (!rec) return;
    await goalsApi.addCompanyContact(businessId, rec.type, rec.id, { name: draft.name.trim(), title: draft.title?.trim() || null, linkedin_url: draft.linkedin?.trim() || null });
    setForm(null); onChanged(); onToast({ text: `${draft.name.trim()} added to ${rec.name}` });
  });
  const draftEmail = kind => act('draft', async () => {
    const rec = await ensureRecord(kind); if (!rec) return;
    setForm(null);
    const markdown = await goalsApi.copyBundle(businessId, rec.type, rec.id);
    await navigator.clipboard.writeText(`${markdown}${playbookPrompt(rec)}\n`);
    onToast({ text: 'Copied for Claude - paste it into a Claude chat. Nothing was sent.' });
  });
  const research = () => act('research', async () => {
    const rec = await ensureRecord(); if (!rec) return;
    await goalsApi.runCompanyResearch(businessId, rec.type, rec.id);
    onChanged(); onToast({ text: `Researching ${rec.name} - one Claude call, about a minute` });
  });
  const checkApollo = () => act('apollo', async () => {
    const rec = await ensureRecord(); if (!rec) return;
    const a = await goalsApi.checkCompanyApollo(businessId, rec.type, rec.id);
    onChanged(); onToast({ text: apolloLine(a, rec.name) });
  });
  const notAFit = () => act('reject', async () => {
    const r = await goalsApi.rejectTarget(businessId, row.id);
    onChanged(); onClose();
    onToast({ text: `${row.name}: Not a fit`, undo: async () => { await goalsApi.rejectTarget(businessId, row.id, { undo: true, reopen: r.dropped }); onChanged(); } });
  });
  const promote = to => act('promote', async () => {
    const r = await goalsApi.promoteTarget(businessId, row.id, { to, ...(ownerPick ? { owner_user_id: ownerPick } : {}) });
    const rec = r.created || r.already;
    setForm(null);
    onConvert({ ...rec, type: rec.type === 'opportunity' ? 'employer' : rec.type }, !!r.already);
  });
  const addTo = to => act('add', async () => {
    const r = await goalsApi.addToPipeline(businessId, { type: row.type, id: row.id, to, ...(ownerPick ? { owner_user_id: ownerPick } : {}) });
    const rec = r.created || r.already;
    setForm(null);
    onConvert(rec, !!r.already);
    onToast({ text: r.already ? `${rec.name} is already in the pipeline as a ${rec.type}` : `${rec.name} added as a ${rec.type}` });
  });
  // F7: the "Mark lost?" suggestion - the Lost lane, Undo brings the stage back.
  const markLost = () => act('lost', async () => {
    const before = current;
    await updateOpportunity(businessId, row.id, { stage: 'lost' });
    onPatch({ stage: 'lost' }); onChanged();
    onToast({ text: `${row.name}: Lost`, undo: async () => { await updateOpportunity(businessId, row.id, { stage: before, allow_backward: true }); onPatch({ stage: before }); onChanged(); } });
  });
  const bringBack = () => act('bring_back', async () => {
    const r = await goalsApi.bringBack(businessId, row.type, row.id);
    onChanged();
    onToast({ text: `${row.name}: brought back`, undo: async () => { await goalsApi.undoFlow(businessId, r.event.id); onChanged(); } });
  });
  // F9: Pause… = the partner's paused lane, through applyPartnerSignal with expect; Undo = the partner undo.
  const pause = () => act('pause', async () => {
    if (!window.confirm(`Pause ${row.name}? It leaves the live list until resumed.`)) return;
    const { event } = await goalsApi.partnerSignal(businessId, row.id, { type: 'deprioritize', expect: current });
    onPatch({ stage: 'paused' }); onChanged();
    onToast({ text: `${row.name}: paused`, undo: async () => { await goalsApi.partnerUndo(businessId, row.id, event.id); onPatch({ stage: current }); onChanged(); } });
  });
  // F9: Log referral = a new target with this partner as its source.
  const logReferral = () => act('referral', async () => {
    const r = await goalsApi.createTarget(businessId, { name: draft.company.trim(), kind: draft.kind || 'employer' });
    const rec = r.created || r.already;
    if (r.created) await goalsApi.editSource(businessId, 'target', rec.id, { source_kind: 'partner_referral', source_partner_id: row.id, source_person: draft.person?.trim() || null });
    setForm(null); onChanged();
    onToast({ text: r.created ? `${rec.name} added as a target · referred by ${row.name}` : `${rec.name} is already in the pipeline - set its Source there` });
  });

  const reach = (what, fn, extra = {}) => act(what, () => fn({ businessId, row, onChanged, onToast, onConvert, ...extra }));
  const b = what => busy === what;
  const draftClick = () => (needsRecord(row.type) ? open('draft-kind') : draftEmail());
  keysRef.current = what => (what === 'draft' ? draftClick() : what === 'research' ? research() : open(what));
  if (actionsRef) actionsRef.current = { draft: draftClick, research, apollo: checkApollo, book: () => reach('book', bookMeeting), markLost };
  const oc = ownerChip({ ownerUserId: row.owner_user_id, ownerTeam: row.owner_team, coOwnerName: row.co_owner_name, members, meId });
  const ownerBtn = <button type="button" className={btn} aria-haspopup="menu" onClick={onOwner} title="Change the owner (partners through Assign, never a stage move)"><span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: oc.dashed ? 'transparent' : oc.color, border: oc.dashed ? `1.5px dashed ${oc.color}` : 'none' }} />Owner: {oc.word} ▾</button>;
  const deprioritizeBtn = deprioritized
    ? <button type="button" className={btn} disabled={b('bring_back')} onClick={bringBack}>{b('bring_back') ? 'Saving…' : 'Bring back'}</button>
    : <button type="button" className="ui-btn ui-btn--danger" aria-expanded={form === 'deprioritize'} onClick={() => open('deprioritize')} title="With a reason. The stage stays; it leaves the Map's default view and the Due lists.">↓ Deprioritize…</button>;
  const capture = (
    <Group id="capture" label="Capture" icon={<IconPencil size={12} />}>
      <button type="button" className={btn} aria-expanded={form === 'note'} aria-keyshortcuts="N" onClick={() => open('note')}>Note{kbd('N')}</button>
      <button type="button" className={btn} aria-expanded={form === 'todo'} aria-keyshortcuts="T" onClick={() => open('todo')}>To-do{kbd('T')}</button>
      <button type="button" className={btn} aria-expanded={form === 'contact'} aria-keyshortcuts="C" onClick={() => open('contact')}>Contact{kbd('C')}</button>
    </Group>
  );
  const learn = (
    <Group id="learn" label="Learn" icon={<IconSearch size={12} />}>
      <button type="button" className={btn} disabled={b('research')} aria-keyshortcuts="R" onClick={research} title="One Claude call with up to 3 web searches; 5 per company per day"><IconSearch size={13} />{b('research') ? 'Starting…' : 'Research'}{kbd('R')}</button>
      <button type="button" className={btn} disabled={b('apollo')} onClick={checkApollo} title="Reads Apollo's people at this company (no credits, at most 2 calls)"><IconPeople size={13} />{b('apollo') ? 'Checking…' : 'Check Apollo'}</button>
    </Group>
  );
  const draftBtn = <button type="button" className={btn} disabled={b('draft')} aria-keyshortcuts="E" aria-expanded={needsRecord(row.type) ? form === 'draft-kind' : undefined} onClick={draftClick} title="Copies the record + a short playbook prompt for Claude. Never sends."><IconMail size={13} />{b('draft') ? 'Copying…' : 'Draft email'}{kbd('E')}</button>;
  const groups = live ? (
    <>
      <Group id="partner" label="Partner" icon={<IconLink size={12} />}>
        <button type="button" className={btn} onClick={onAddClient}>+ Add referred client</button>
        <button type="button" className={btn} aria-expanded={form === 'referral'} onClick={() => open('referral')}><IconLink size={13} />Log referral</button>
        <button type="button" className={btn} disabled={b('book')} onClick={() => reach('book', bookMeeting)} title="Sets the next step and adds a to-do due today. No calendar write."><IconCalendar size={13} />{b('book') ? 'Saving…' : 'Book check-in'}</button>
        {draftBtn}
      </Group>
      {divider}{capture}{divider}
      <Group id="decide" label="Decide" icon={<IconCheck size={12} />}>
        {ownerBtn}
        <button type="button" className={btn} disabled={b('pause')} onClick={pause}><IconPause size={13} />{b('pause') ? 'Saving…' : 'Pause…'}</button>
      </Group>
    </>
  ) : (
    <>
      <Group id="reach" label="Reach" icon={<IconMail size={12} />}>
        {draftBtn}
        {!needsRecord(row.type) && <>
          <button type="button" className={btn} disabled={b('call')} onClick={() => reach('call', markContacted, { touchType: 'call' })} title="Logs a call as a touch / done to-do; moves a record that is behind Contacted"><IconPhone size={13} />{b('call') ? 'Saving…' : 'Log call'}</button>
          <button type="button" className={btn} disabled={b('book')} onClick={() => reach('book', bookMeeting)} title="Sets the next step and adds a to-do due today. No calendar write."><IconCalendar size={13} />{b('book') ? 'Saving…' : 'Book meeting'}</button>
          {behindContacted(row, current) && <button type="button" className={btn} disabled={b('contacted')} onClick={() => reach('contacted', markContacted)} title={row.type === 'partner' ? 'Logs an email touch. Not contacted yet = moves to Sent.' : row.type === 'employer' ? 'Logs a done to-do. At Target = moves to Contacted.' : 'Adds it to the pipeline as an employer at Contacted (Undo removes it).'}><IconCheck size={13} />{b('contacted') ? 'Saving…' : 'Mark contacted'}</button>}
          {row.type === 'employer' && !['target', 'lost'].includes(current) && <button type="button" className={btn} aria-expanded={form === 'they-replied'} onClick={() => open('they-replied')} title="What did they say? Moves the stage by its context, never back.">↩ They replied…</button>}
        </>}
      </Group>
      {divider}
      <Group id="decide" label="Decide" icon={<IconCheck size={12} />}>
        {needsRecord(row.type) && <button type="button" className={bandShown ? btn : 'ui-btn ui-btn--primary'} aria-expanded={form === 'add'} onClick={() => open('add')}>Add to pipeline ▾</button>}
        {row.type === 'target' && <>
          <button type="button" className="ui-btn ui-btn--primary" aria-expanded={form === 'promote'} disabled={b('promote')} onClick={() => open('promote')}>Add to pipeline ▾</button>
          <button type="button" className="ui-btn ui-btn--danger" disabled={b('reject')} onClick={notAFit}>Not a fit</button>
        </>}
        {row.type !== 'apollo' && deprioritizeBtn}
      </Group>
      {divider}{capture}{divider}{learn}
    </>
  );
  return (
    <section ref={rootRef} aria-label="Actions" data-actions-row style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: '10px 6px', margin: '0 -8px', padding: 8, borderRadius: 10, background: `linear-gradient(90deg, color-mix(in srgb, ${ui.generatedFrom} 12%, ${SA.surface}) 0%, color-mix(in srgb, ${ui.generatedTo} 12%, ${SA.surface}) 100%)`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${ui.generatedTo} 35%, ${SA.surface})` }}>
        <span className="ui-group-label" style={{ width: 72, flex: 'none', alignSelf: 'center' }}>Actions</span>
        {groups}
        <span style={{ fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', color: ui.generatedTo, whiteSpace: 'nowrap', alignSelf: 'flex-end', paddingBottom: 8 }}>✦ generated</span>
      </div>

      {form === 'note' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor="cp-note" style={labelStyle}>Note</label>
          <textarea id="cp-note" autoFocus rows={2} value={draft.note || ''} onChange={e => set('note', e.target.value)} placeholder="e.g. Called, left voicemail" className="ui-input" style={{ ...field, height: 'auto', padding: 8, resize: 'vertical', fontFamily: 'inherit' }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (draft.note?.trim()) addNote(); } }} />
          <button type="button" className="ui-btn ui-btn--primary" style={{ alignSelf: 'flex-start' }} disabled={!draft.note?.trim() || b('note')} onClick={addNote}>{b('note') ? 'Saving…' : 'Save note'}</button>
        </div>
      )}
      {form === 'todo' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor="cp-todo" style={labelStyle}>To-do</label>
          <input id="cp-todo" autoFocus value={draft.text || ''} onChange={e => set('text', e.target.value)} placeholder="What needs doing" className="ui-input" style={field}
            onKeyDown={e => { if (e.key === 'Enter' && draft.text?.trim()) addTodo(); }} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <select aria-label="To-do owner" value={draft.owner ?? meId ?? ''} onChange={e => set('owner', e.target.value || null)} className="ui-input" style={{ ...field, width: 'auto' }}>
              <option value="">Unassigned</option>
              {members.filter(m => m.role !== 'viewer').map(m => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
            </select>
            <input type="date" aria-label="To-do due date" value={draft.due || ''} onChange={e => set('due', e.target.value)} className="ui-input" style={{ ...field, width: 'auto', colorScheme: 'dark' }} />
            <button type="button" className="ui-btn ui-btn--primary" disabled={!draft.text?.trim() || b('todo')} onClick={addTodo}>{b('todo') ? 'Saving…' : 'Save to-do'}</button>
          </div>
        </div>
      )}
      {form === 'contact' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={labelStyle}>Contact - name, title and LinkedIn only (no email or phone)</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <input aria-label="Contact name" autoFocus value={draft.name || ''} onChange={e => set('name', e.target.value)} placeholder="Name" className="ui-input" style={{ ...field, flex: '1 1 140px', width: 'auto' }} />
            <input aria-label="Contact title" value={draft.title || ''} onChange={e => set('title', e.target.value)} placeholder="Title" className="ui-input" style={{ ...field, flex: '1 1 140px', width: 'auto' }} />
            <input aria-label="Contact LinkedIn URL" value={draft.linkedin || ''} onChange={e => set('linkedin', e.target.value)} placeholder="linkedin.com/in/name" className="ui-input" style={{ ...field, flex: '1 1 200px', width: 'auto' }} />
            <button type="button" className="ui-btn ui-btn--primary" disabled={!draft.name?.trim() || b('contact')} onClick={addContact}>{b('contact') ? 'Saving…' : 'Save contact'}</button>
          </div>
        </div>
      )}
      {form === 'promote' && (
        <div role="group" aria-label="Add to pipeline as" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <OwnerPicker members={members} value={ownerPick} onChange={setOwner} disabled={b('promote')} />
          <button type="button" className={btn} disabled={b('promote')} onClick={() => promote('partner')}>Partner</button>
          <button type="button" className={btn} disabled={b('promote')} onClick={() => promote('employer')}>Employer</button>
        </div>
      )}
      {form === 'draft-kind' && (
        <div role="group" aria-label={`Add ${row.name} as a target first`} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: SA.soft }}>Add {row.name} as a target first - employer or partner?</span>
          <button type="button" className={btn} disabled={b('draft')} onClick={() => draftEmail('employer')}>Employer</button>
          <button type="button" className={btn} disabled={b('draft')} onClick={() => draftEmail('partner')}>Partner</button>
        </div>
      )}
      {form === 'add' && (
        <div role="group" aria-label="Add to pipeline as" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <OwnerPicker members={members} value={ownerPick} onChange={setOwner} disabled={b('add')} />
          {[['target', 'Target'], ['partner', 'Partner'], ['employer', 'Employer']].map(([to, label]) => (
            <button key={to} type="button" className={btn} disabled={b('add')} onClick={() => addTo(to)}>{label}</button>
          ))}
        </div>
      )}
      {form === 'referral' && (
        <div role="group" aria-label="Log referral" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <input aria-label="Referred company" autoFocus value={draft.company || ''} onChange={e => set('company', e.target.value)} placeholder="Company they referred" className="ui-input" style={{ ...field, flex: '1 1 200px', width: 'auto' }} onKeyDown={e => { if (e.key === 'Enter' && draft.company?.trim()) logReferral(); }} />
          <select aria-label="Referred as" value={draft.kind || 'employer'} onChange={e => set('kind', e.target.value)} className="ui-input" style={{ ...field, width: 'auto' }}><option value="employer">Employer target</option><option value="partner">Partner target</option></select>
          <input aria-label="Referred by (person)" value={draft.person || ''} onChange={e => set('person', e.target.value)} placeholder="Who at the partner (optional)" className="ui-input" style={{ ...field, flex: '1 1 160px', width: 'auto' }} />
          <button type="button" className="ui-btn ui-btn--primary" disabled={!draft.company?.trim() || b('referral')} onClick={logReferral}>{b('referral') ? 'Saving…' : 'Add target'}</button>
        </div>
      )}
      {form === 'deprioritize' && <DeprioritizeForm businessId={businessId} row={row} expect={needsRecord(row.type) ? null : current} onDone={() => setForm(null)} onCancel={() => setForm(null)} onToast={onToast} onChanged={onChanged} />}
      {form === 'they-replied' && <TheyRepliedForm businessId={businessId} row={row} expect={current} onDone={() => setForm(null)} onCancel={() => setForm(null)} onToast={onToast} onChanged={onChanged} onPatch={onPatch} />}
      {error && <ErrorNote message={error} />}
    </section>
  );
}
