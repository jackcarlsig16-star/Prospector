import { useState } from 'react';
import { SA } from '../theme';
import { goalsApi } from './goalsApi';
import { updateOpportunity } from '../pipelineApi';
import { labelStyle, inputStyle, ErrorNote } from './goalsUi';
import { apolloLine } from './partners/PartnerResearch';
import { OWNER_TEAMS, TEAM_LABEL } from '../../../constants/ownership';
import { PRIORITIES, PRIORITY_WORD } from '../../../constants/salesChannels';
import { NOT_A_FIT, priorityValue, priorityText, writePriority, undoValue } from './priorityActions';
import { needsRecord, addAsk, nextStage, stageOptions, isBackward, stageLabel, playbookPrompt, mondayOf, PRIORITY_TYPES } from './companyPanelModel';
import { boardStage } from '../../../constants/pipelineBoard';
import { TOUCH_STATUSES } from '../../../constants/partnerPipeline';

// sales-ia-v2 P4 - the action bar every row type shares. An action that needs
// a record on a visitor / Apollo-only row asks "Add <X> to Pipeline as a
// target?" first and does both on yes. Every priority / stage / Not-a-fit
// change hands the caller an Undo (shown 10 s). Draft email never sends:
// it copies the record + a playbook prompt for Claude. Members only - the
// panel renders no bar for a Viewer.
const LINK_TYPE = { partner: 'partner', employer: 'opportunity', target: 'target' };
const field = { ...inputStyle, height: 32, fontSize: 13, padding: '0 8px' };
const btn = 'ui-btn ui-btn--secondary';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

export default function CompanyActions({ businessId, row, members, meId, onStar, onPatch, onChanged, onToast, onConvert, onClose }) {
  const [form, setForm] = useState(null); // 'note' | 'todo' | 'contact' | 'jump' | 'add'
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [draft, setDraft] = useState({});
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  const open = f => { setForm(x => (x === f ? null : f)); setDraft({}); setError(''); };

  const act = async (what, fn) => {
    setBusy(what); setError('');
    try { return await fn(); } catch (e) { setError(e.message); return undefined; } finally { setBusy(''); }
  };
  // A visitor / Apollo-only row has no record: make it a target first (confirm), then act on that.
  const ensureRecord = async () => {
    if (!needsRecord(row.type)) return row;
    if (!window.confirm(addAsk(row.name))) return null;
    const r = await goalsApi.addToPipeline(businessId, { type: row.type, id: row.id, to: 'target' });
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
    onToast({ text: `To-do added${who ? ` for ${who.name.split(' ')[0]}` : ''}`, undo: async () => { await goalsApi.deleteWeekGoal(businessId, goal.id); onChanged(); } });
  });
  const addContact = () => act('contact', async () => {
    const rec = await ensureRecord(); if (!rec) return;
    await goalsApi.addCompanyContact(businessId, rec.type, rec.id, { name: draft.name.trim(), title: draft.title?.trim() || null, linkedin_url: draft.linkedin?.trim() || null });
    setForm(null); onChanged(); onToast({ text: `${draft.name.trim()} added to ${rec.name}` });
  });
  const draftEmail = () => act('draft', async () => {
    const rec = await ensureRecord(); if (!rec) return;
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
  const changePriority = value => act('priority', async () => {
    const before = undoValue(row);
    await writePriority(businessId, row, value);
    onChanged();
    onToast({ text: `${row.name}: ${priorityText(value)}`, undo: async () => { await writePriority(businessId, row, before); onChanged(); } });
  });
  const changeStage = to => act('stage', async () => {
    const back = isBackward(row, to);
    if (back && !window.confirm(`Move ${row.name} back from ${stageLabel(row)} to ${stageLabel(row, to)}?`)) return;
    const before = row.stage;
    let undo;
    if (row.type === 'partner') {
      const { event } = await goalsApi.partnerSignal(businessId, row.id, { type: 'status', to, expect: before, ...(back ? { allow_backward: true } : {}) });
      undo = () => goalsApi.partnerUndo(businessId, row.id, event.id);
    } else if (row.type === 'employer') {
      await updateOpportunity(businessId, row.id, { stage: to, ...(back ? { allow_backward: true } : {}) });
      undo = () => updateOpportunity(businessId, row.id, { stage: before, allow_backward: true });
    } else {
      await goalsApi.updateTarget(businessId, row.id, { status: to, ...(back ? { allow_backward: true } : {}) });
      undo = () => goalsApi.updateTarget(businessId, row.id, { status: before, allow_backward: true });
    }
    // The row shows the move at once; the board reload confirms it.
    const patch = row.type === 'partner' ? boardStage('partner', { pipeline_status: to, category: row.category }) : row.type === 'employer' ? boardStage('employer', { stage: to }) : boardStage('target', { status: to });
    if (row.type === 'partner' && TOUCH_STATUSES.includes(to)) patch.last_touch_at = new Date().toISOString();
    setForm(null); onPatch(patch); onChanged();
    onToast({ text: `${row.name}: ${stageLabel(row, to)}`, undo: async () => { await undo(); onChanged(); } });
  });
  const changeOwner = userId => act('owner', async () => {
    if (row.type === 'partner') await goalsApi.partnerSignal(businessId, row.id, { type: 'assign', owner_user_id: userId || null });
    else await updateOpportunity(businessId, row.id, { owner: members.find(m => m.user_id === userId)?.name || null });
    onChanged();
  });
  const changeTeam = team => act('team', async () => {
    if (row.type === 'partner') await goalsApi.partnerSignal(businessId, row.id, { type: 'assign', owner_team: team || null });
    else if (row.type === 'employer') await updateOpportunity(businessId, row.id, { owner_team: team || null });
    else await goalsApi.updateTarget(businessId, row.id, { owner_team: team || null });
    onChanged();
  });
  const notAFit = () => act('reject', async () => {
    const r = await goalsApi.rejectTarget(businessId, row.id);
    onChanged(); onClose();
    onToast({ text: `${row.name}: Not a fit`, undo: async () => { await goalsApi.rejectTarget(businessId, row.id, { undo: true, reopen: r.dropped }); onChanged(); } });
  });
  const promote = to => act('promote', async () => {
    const r = await goalsApi.promoteTarget(businessId, row.id, { to });
    const rec = r.created || r.already;
    onConvert({ ...rec, type: rec.type === 'opportunity' ? 'employer' : rec.type }, !!r.already);
  });
  const addTo = to => act('add', async () => {
    const r = await goalsApi.addToPipeline(businessId, { type: row.type, id: row.id, to });
    const rec = r.created || r.already;
    setForm(null);
    onConvert(rec, !!r.already);
    onToast({ text: r.already ? `${rec.name} is already in the pipeline as a ${rec.type}` : `${rec.name} added as a ${rec.type}` });
  });

  const next = nextStage(row);
  const ownerId = row.type === 'partner' ? row.owner_user_id : members.find(m => m.name === row.owner)?.user_id;
  const b = what => busy === what;
  return (
    <section aria-label="Actions" className="ui-theme-dark" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <button type="button" className={btn} aria-expanded={form === 'note'} onClick={() => open('note')}>Add note</button>
        <button type="button" className={btn} aria-expanded={form === 'todo'} onClick={() => open('todo')}>Add to-do</button>
        <button type="button" className={btn} disabled={b('draft')} onClick={draftEmail} title="Copies the record + a short playbook prompt for Claude. Never sends.">{b('draft') ? 'Copying…' : 'Draft email in Claude'}</button>
        <button type="button" className={btn} disabled={b('research')} onClick={research} title="One Claude call with up to 3 web searches; 5 per company per day">{b('research') ? 'Starting…' : 'Research'}</button>
        <button type="button" className={btn} aria-expanded={form === 'contact'} onClick={() => open('contact')}>Add contact</button>
        <button type="button" className={btn} disabled={b('apollo')} onClick={checkApollo} title="Reads Apollo's people at this company (no credits, at most 2 calls)">{b('apollo') ? 'Checking…' : 'Check Apollo'}</button>
        {PRIORITY_TYPES.includes(row.type) && (
          <select aria-label="Priority" data-priority={row.type} value={priorityValue(row)} disabled={b('priority')} onChange={e => changePriority(e.target.value)} style={{ ...field, width: 'auto' }}>
            <option value="">Priority ▾</option>
            {PRIORITIES.map(p => <option key={p} value={String(p)}>P{p} · {PRIORITY_WORD[p]}</option>)}
            <option value={NOT_A_FIT}>Not a fit</option>
          </select>
        )}
        {next && <button type="button" className="ui-btn ui-btn--primary" disabled={b('stage')} onClick={() => changeStage(next.to)}>{b('stage') ? 'Saving…' : `Next: ${next.label}`}</button>}
        {stageOptions(row).length > 0 && <button type="button" className={btn} aria-expanded={form === 'jump'} onClick={() => open('jump')}>Jump to stage ▾</button>}
        {(row.type === 'partner' || row.type === 'employer') && (
          <select aria-label="Owner" value={ownerId || ''} disabled={b('owner')} onChange={e => changeOwner(e.target.value)} style={{ ...field, width: 'auto' }}>
            <option value="">Owner ▾ (unassigned)</option>
            {members.filter(m => m.role !== 'viewer').map(m => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
          </select>
        )}
        {!needsRecord(row.type) && (
          <select aria-label="Team" value={row.owner_team || ''} disabled={b('team')} onChange={e => changeTeam(e.target.value)} style={{ ...field, width: 'auto' }}>
            <option value="">Team ▾ (none)</option>
            {OWNER_TEAMS.map(t => <option key={t} value={t}>{TEAM_LABEL[t]}</option>)}
          </select>
        )}
        {(row.type === 'partner' || row.type === 'employer') && (
          <button type="button" className={btn} aria-pressed={row.top} disabled={b('star')} onClick={() => act('star', onStar)} style={{ color: row.top ? SA.warn : undefined }}>{row.top ? '★ Top' : '☆ Top'}</button>
        )}
        {needsRecord(row.type) && <button type="button" className="ui-btn ui-btn--primary" aria-expanded={form === 'add'} onClick={() => open('add')}>Add to pipeline ▾</button>}
        {row.type === 'target' && <>
          <button type="button" className={btn} disabled={b('promote')} onClick={() => promote('partner')}>Promote to partner</button>
          <button type="button" className={btn} disabled={b('promote')} onClick={() => promote('employer')}>Promote to employer</button>
          <button type="button" className="ui-btn ui-btn--danger" disabled={b('reject')} onClick={notAFit}>Not a fit</button>
        </>}
      </div>

      {form === 'note' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor="cp-note" style={labelStyle}>Note</label>
          <textarea id="cp-note" rows={2} value={draft.note || ''} onChange={e => set('note', e.target.value)} placeholder="e.g. Called, left voicemail" style={{ ...field, height: 'auto', padding: 8, resize: 'vertical', fontFamily: 'inherit' }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (draft.note?.trim()) addNote(); } }} />
          <button type="button" className="ui-btn ui-btn--primary" style={{ alignSelf: 'flex-start' }} disabled={!draft.note?.trim() || b('note')} onClick={addNote}>{b('note') ? 'Saving…' : 'Save note'}</button>
        </div>
      )}
      {form === 'todo' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor="cp-todo" style={labelStyle}>To-do</label>
          <input id="cp-todo" value={draft.text || ''} onChange={e => set('text', e.target.value)} placeholder="What needs doing" style={field}
            onKeyDown={e => { if (e.key === 'Enter' && draft.text?.trim()) addTodo(); }} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <select aria-label="To-do owner" value={draft.owner ?? meId ?? ''} onChange={e => set('owner', e.target.value || null)} style={{ ...field, width: 'auto' }}>
              <option value="">Unassigned</option>
              {members.filter(m => m.role !== 'viewer').map(m => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
            </select>
            <input type="date" aria-label="To-do due date" value={draft.due || ''} onChange={e => set('due', e.target.value)} style={{ ...field, width: 'auto', colorScheme: 'dark' }} />
            <button type="button" className="ui-btn ui-btn--primary" disabled={!draft.text?.trim() || b('todo')} onClick={addTodo}>{b('todo') ? 'Saving…' : 'Save to-do'}</button>
          </div>
        </div>
      )}
      {form === 'contact' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={labelStyle}>Contact - name, title and LinkedIn only (no email or phone)</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <input aria-label="Contact name" value={draft.name || ''} onChange={e => set('name', e.target.value)} placeholder="Name" style={{ ...field, flex: '1 1 140px' }} />
            <input aria-label="Contact title" value={draft.title || ''} onChange={e => set('title', e.target.value)} placeholder="Title" style={{ ...field, flex: '1 1 140px' }} />
            <input aria-label="Contact LinkedIn URL" value={draft.linkedin || ''} onChange={e => set('linkedin', e.target.value)} placeholder="https://linkedin.com/in/…" style={{ ...field, flex: '1 1 200px' }} />
            <button type="button" className="ui-btn ui-btn--primary" disabled={!draft.name?.trim() || b('contact')} onClick={addContact}>{b('contact') ? 'Saving…' : 'Save contact'}</button>
          </div>
        </div>
      )}
      {form === 'jump' && (
        <div role="group" aria-label="Jump to stage" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {stageOptions(row).map(s => (
            <button key={s.id} type="button" className={btn} disabled={s.dir === 'now' || b('stage')} aria-current={s.dir === 'now' ? 'true' : undefined} onClick={() => changeStage(s.id)}
              title={s.dir === 'back' ? 'Backwards - asks you to confirm' : undefined} style={{ color: s.dir === 'now' ? SA.muted : s.dir === 'back' ? SA.warn : undefined }}>
              {s.dir === 'back' ? '↩ ' : ''}{s.label}{s.dir === 'now' ? ' · now' : ''}
            </button>
          ))}
        </div>
      )}
      {form === 'add' && (
        <div role="group" aria-label="Add to pipeline as" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[['target', 'Target'], ['partner', 'Partner'], ['employer', 'Employer']].map(([to, label]) => (
            <button key={to} type="button" className={btn} disabled={b('add')} onClick={() => addTo(to)}>{label}</button>
          ))}
        </div>
      )}
      {error && <ErrorNote message={error} />}
    </section>
  );
}
