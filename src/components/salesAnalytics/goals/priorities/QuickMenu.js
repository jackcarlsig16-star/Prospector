import { useState, useEffect } from 'react';
import { SA } from '../../theme';
import { goalsApi } from '../goalsApi';
import { updateOpportunity } from '../../pipelineApi';
import { Chip } from '../goalsUi';
import { mondayOf, playbookPrompt } from '../companyPanelModel';
import { bookMeeting, markContacted } from '../companyReach';
import { DeprioritizeForm, TheyRepliedForm } from '../FlowSheets';
import { flowMenu, ownerChip } from '../flowModel';
import { OwnerChip } from '../FlowChips';
import { FIT_WORD, DEPRIORITIZE_REASON_WORD } from '../../../../constants/fitLevels';
import { STAGE_LABELS } from '../../pipelineStages';
import { PIPELINE_STATUSES } from '../../../../constants/partnerPipeline';

// homelover-flow-v1 F5 (mockup B) - the Map's quick menu follows the flow. Header: name · NEW today · "Visitor · n
// visits · n people · top page · Fit <level> <score>" · owner chip. CLAIM IT (Me · each member) while nobody owns it;
// NEXT IN THE FLOW = the state's items, first = the next step; Deprioritize… with the reason chips inline (F4); a
// deprioritized record shows its reason and Bring back. Every write: an Activity row + Undo 10 s (a Claim's Undo = the
// flow event's undo; a partner's = the partner undo). Brief and Write email stay as a quiet last row. On an Upside-owned /
// no-double-touch row the touching items are disabled with the reason. Never a stage move outside advanceStage /
// applyPartnerSignal with expect.
const LINK_TYPE = { partner: 'partner', employer: 'opportunity', target: 'target' };
const LOCK_REASON = 'Upside-owned with no double touch - coordinate with Brad before touching this company';
const TOUCHING = new Set(['claim', 'draft', 'contacted', 'call', 'book', 'todo', 'they_replied', 'next', 'promote']);
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const btn = 'ui-btn ui-btn--secondary ui-btn--sm';
const item = (primary = false) => `ui-btn ui-btn--sm ${primary ? 'ui-btn--primary' : 'ui-btn--tertiary'}`;
const kindWord = r => (r.type === 'partner' ? 'Partner' : r.type === 'employer' ? 'Employer' : r.last_visit ? 'Visitor' : 'Target');
const stageWord = r => (r.type === 'partner' ? PIPELINE_STATUSES.find(s => s.id === r.stage)?.label : r.type === 'employer' ? STAGE_LABELS[r.stage] : null);

export function summaryLine(r) {
  const page = r.components?.pages?.inputs?.paths?.[0] || null;
  const fit = r.fit_level === 'deprioritized' ? `Deprioritized · ${DEPRIORITIZE_REASON_WORD[r.deprioritized_reason] || ''}`.trim() : r.fit_level ? `Fit ${FIT_WORD[r.fit_level]}${r.fit_score != null ? ` ${r.fit_score}` : ''}` : 'Fit —';
  return [kindWord(r), stageWord(r), `${r.visits_7d ?? 0} visit${r.visits_7d === 1 ? '' : 's'}`, `${r.people ?? 0} people`, page, fit].filter(Boolean).join(' · ');
}

export default function QuickMenu({ businessId, row, members, meId, canEdit, compose, reach = null, onBrief, onCompose, onChanged, onToast, onOpen, nextStep, onSubClose }) {
  const [busy, setBusy] = useState(null);
  const [sheet, setSheet] = useState(null); // 'deprioritize' | 'they-replied'
  useEffect(() => {
    if (!onSubClose) return undefined;
    onSubClose(sheet ? () => setSheet(null) : null);
    return () => onSubClose(null);
  }, [sheet, onSubClose]);
  const locked = !!row.touch_locked;
  const plan = flowMenu(row);
  const rec = { type: row.type, id: row.id, name: row.name, stage: row.stage };
  const run = async (key, fn, text) => {
    setBusy(key);
    try { await fn(); if (text) onToast({ text }); onChanged && onChanged(); }
    catch (e) { onToast({ text: e.message }); }
    finally { setBusy(null); }
  };
  // F1: Claim / a later owner change - Activity + Undo (the flow event for employers / targets, the partner undo for partners).
  const claim = userId => run('claim', async () => {
    const who = userId ? (members.find(m => m.user_id === userId)?.name || '').split(' ')[0] : 'nobody';
    if (row.type === 'partner') {
      const { event } = await goalsApi.partnerSignal(businessId, row.id, { type: 'assign', owner_user_id: userId || null });
      onToast({ text: `${row.name}: ${userId ? `owner ${who}` : 'unassigned'}`, undo: async () => { await goalsApi.partnerUndo(businessId, row.id, event.id); onChanged && onChanged(); } });
      return;
    }
    const r = await goalsApi.editCompanyFields(businessId, row.type, row.id, { owner_user_id: userId || null });
    onToast({ text: `${row.name}: ${userId ? `owner ${who}` : 'unassigned'}`, undo: async () => { if (r.event) await goalsApi.undoFlow(businessId, r.event.id); else await goalsApi.editCompanyFields(businessId, row.type, row.id, { owner_user_id: row.owner_user_id || null }); onChanged && onChanged(); } });
  });
  const addTask = () => run('todo', async () => {
    const t = today();
    const goal = await goalsApi.createWeekGoal(businessId, { week_start: mondayOf(t), kind: 'todo', text: `${nextStep || 'Follow up'}: ${row.name}`, owner_user_id: meId || null, due_date: t, link_type: LINK_TYPE[row.type], link_id: row.id });
    onToast({ text: `To-do added for ${row.name}`, undo: async () => { await goalsApi.undoTodoEvent(businessId, goal.event_id); onChanged && onChanged(); } });
  });
  const research = () => run('research', async () => { await goalsApi.runCompanyResearch(businessId, row.type, row.id); }, `Researching ${row.name} - one Claude call, about a minute`);
  const draft = () => run('draft', async () => {
    const markdown = await goalsApi.copyBundle(businessId, row.type, row.id);
    await navigator.clipboard.writeText(`${markdown}${playbookPrompt(rec)}\n`);
  }, 'Copied for Claude - paste it into a Claude chat. Nothing was sent.');
  const promote = () => run('promote', async () => {
    const r = await goalsApi.promoteTarget(businessId, row.id, { to: 'employer', ...(meId ? { owner_user_id: meId } : {}) });
    const made = r.created || r.already;
    onToast({ text: r.created ? `${made.name} promoted to employer target` : `${made.name} is already in the pipeline` });
  });
  const next = () => run('next', async () => {
    const r = await goalsApi.advanceStage(businessId, row.type, row.id, row.stage);
    onToast({ text: `${row.name}: moved to ${STAGE_LABELS[r.after] || r.after}`, undo: async () => { if (row.type === 'partner') await goalsApi.partnerUndo(businessId, row.id, r.event.id); else await updateOpportunity(businessId, row.id, { stage: r.before, allow_backward: true }); onChanged && onChanged(); } });
  });
  const bringBack = () => run('bring_back', async () => {
    const r = await goalsApi.bringBack(businessId, row.type, row.id);
    onToast({ text: `${row.name}: brought back`, undo: async () => { await goalsApi.undoFlow(businessId, r.event.id); onChanged && onChanged(); } });
  });
  const reachFns = { contacted: () => run('contacted', () => markContacted({ businessId, row: rec, onChanged, onToast })), call: () => run('call', () => markContacted({ businessId, row: rec, touchType: 'call', onChanged, onToast })), book: () => run('book', () => bookMeeting({ businessId, row: rec, onChanged, onToast })) };
  const act = id => {
    if (id === 'open' || id === 'make_client' || id === 'add_client' || id === 'log_referral') return onOpen();
    if (id === 'they_replied') return setSheet(s => (s === 'they-replied' ? null : 'they-replied'));
    const fns = { research, promote, draft, todo: addTask, next, ...reachFns };
    return fns[id]?.();
  };
  const oc = ownerChip({ ownerUserId: row.owner_user_id, ownerTeam: row.owner_team, coOwnerName: row.co_owner_name, members, meId });
  const lockTitle = locked ? LOCK_REASON : undefined;
  const disabled = id => busy === id || (locked && TOUCHING.has(id));
  const composeLabel = compose ? `Write email · ${compose.cost_estimate_usd != null ? `~$${Number(compose.cost_estimate_usd).toFixed(2)}` : '—'} · ${compose.used}/${compose.max} today` : 'Write email';
  const composeCapped = !!compose && compose.used >= compose.max;
  const label = { display: 'block', fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: SA.muted, fontFamily: "'Geist Mono', ui-monospace, monospace" };
  return (
    <div role="toolbar" aria-label={`Actions for ${row.name}`} data-quick-menu data-flow-state={row.fit_level === 'deprioritized' ? 'deprioritized' : `${row.type}:${row.stage || ''}`} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 10px', borderRadius: 10, background: SA.surface2, border: `1px solid ${SA.border}` }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, fontSize: 13, color: SA.text }}>{row.name}</span>
          {row.new_today && <Chip data-new-badge style={{ height: 20, fontSize: 11, color: SA.accent, borderColor: SA.accent }}>NEW today</Chip>}
          {row.upside_owned && <Chip title={row.touch_locked ? LOCK_REASON : 'Upside-owned'} data-upside-chip style={{ height: 20, fontSize: 11 }}>Upside{row.touch_locked ? ' · no double touch' : ''}</Chip>}
        </span>
        <span data-menu-summary style={{ fontSize: 12, color: SA.soft }}>{summaryLine(row)}{reach && reach.known > 0 ? ` · reached ${reach.reached} of ${reach.known}` : ''}</span>
        <span><OwnerChip row={row} members={members} meId={meId} /></span>
      </div>
      {canEdit && plan.claim && !locked && (
        <div role="group" aria-label="Claim it" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={label}>Claim it</span>
          <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[...members.filter(m => m.user_id === meId), ...members.filter(m => m.user_id !== meId && m.role !== 'viewer')].map(m => {
              const c = ownerChip({ ownerUserId: m.user_id, members, meId });
              return <button key={m.user_id} type="button" className={btn} data-claim={m.user_id} disabled={busy === 'claim'} onClick={() => claim(m.user_id)} style={{ borderColor: `color-mix(in srgb, ${c.color} 55%, ${SA.border})`, gap: 6 }}><span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: c.color }} />{c.word}</button>;
            })}
          </span>
        </div>
      )}
      {plan.bring_back && <span data-deprioritized-reason style={{ fontSize: 12.5, color: SA.bad }}>↓ Deprioritized · {DEPRIORITIZE_REASON_WORD[plan.reason] || plan.reason}{row.deprioritized_note ? ` · ${row.deprioritized_note}` : ''}</span>}
      <div role="group" aria-label="Next in the flow" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={label}>Next in the flow</span>
        {(canEdit ? plan.items : plan.items.filter(it => it.id === 'open')).map((it, i) => (
          <button key={it.id} type="button" className={item(i === 0 && canEdit && it.id !== 'open')} data-flow-item={it.id} disabled={disabled(it.id)} aria-disabled={locked && TOUCHING.has(it.id)} title={locked && TOUCHING.has(it.id) ? lockTitle : undefined} aria-expanded={it.id === 'they_replied' ? sheet === 'they-replied' : undefined} onClick={() => (canEdit || it.id === 'open' ? act(it.id) : onOpen())} style={{ justifyContent: 'flex-start' }}>{busy === it.id ? 'Working…' : it.label}</button>
        ))}
        {canEdit && plan.bring_back && <button type="button" className={item(true)} data-flow-item="bring_back" disabled={busy === 'bring_back'} onClick={bringBack} style={{ justifyContent: 'flex-start' }}>{busy === 'bring_back' ? 'Working…' : 'Bring back'}</button>}
      </div>
      {canEdit && plan.deprioritize && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <button type="button" className="ui-btn ui-btn--tertiary ui-btn--sm" data-flow-item="deprioritize" aria-expanded={sheet === 'deprioritize'} onClick={() => setSheet(s => (s === 'deprioritize' ? null : 'deprioritize'))} style={{ justifyContent: 'flex-start', color: SA.bad }}>↓ Deprioritize…</button>
          {sheet === 'deprioritize' && <DeprioritizeForm businessId={businessId} row={rec} expect={row.stage || null} onDone={() => setSheet(null)} onCancel={() => setSheet(null)} onToast={onToast} onChanged={onChanged} />}
        </div>
      )}
      {sheet === 'they-replied' && <TheyRepliedForm businessId={businessId} row={rec} expect={row.stage} onDone={() => setSheet(null)} onCancel={() => setSheet(null)} onToast={onToast} onChanged={onChanged} onPatch={() => {}} />}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className={btn} onClick={onBrief}>Brief</button>
        {canEdit && <button type="button" className={btn} disabled={locked || composeCapped} aria-disabled={locked || composeCapped} title={lockTitle || (composeCapped ? 'Daily Write email cap reached' : 'One Claude call, never sends')} onClick={onCompose}>{composeLabel}</button>}
        <span style={{ fontSize: 11, color: SA.muted }}>Every action: Activity row + Undo 10 s</span>
      </div>
    </div>
  );
}
