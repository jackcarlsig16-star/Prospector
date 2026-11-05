import { useState } from 'react';
import { SA } from '../theme';
import ProgressBar from '../../../ui/ProgressBar';
import { goalsApi } from './goalsApi';
import { updateOpportunity } from '../pipelineApi';
import { markContacted } from './companyReach';
import { ErrorNote } from './goalsUi';
import { STAGE_ORDER, STAGE_LABELS } from '../pipelineStages';
import { WORKFLOW_STEPS, stepOf } from '../../../constants/partnerPipeline';
import { boardStage } from '../../../constants/pipelineBoard';

// company-progress-bar-v1 Stage 2 - where this deal is. D1 the bar (partner = the workflow steps, employer and target =
// the pipeline stages; a target sits on Target), done steps carry the date reached. D2 one primary = the next stage;
// More = side lanes. D3/ruling 1 Mark contacted moves a record that is behind (a target is added as an employer at
// Contacted). D4 every move: the bar moves, "Last touch" updates, toast with Undo. D5 a segment = jump there (confirm
// when backward). Ruling 2: only the bar's own Book meeting advances; the to-do Book meeting stays a to-do. Viewers:
// the bar, no buttons.
const md = d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
const laDay = d => new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
export const NEXT_VERB = {
  employer: { target: 'Mark contacted', contacted: 'Log reply', responded: 'Book meeting', meeting: 'Send proposal / pilot', proposal_pilot: 'Verbal yes', verbal: 'Contract signed', contract: 'Mark launched' },
  partner: { not_started: 'Start research', researching: 'Mark drafted', first_email_drafted: 'Mark sent', first_email_sent: 'Log reply', in_sequence: 'Log reply', replied: 'Book meeting', meeting_set: 'Start pilot', proposal_pilot: 'Mark live' },
};
const SIDE = { lost: 'Lost', nurture: 'Nurture', on_hold: 'On hold', paused: 'Paused' };

const mdy = d => (d ? md(d) : null);
// homelover-flow-v1 F8: the account card's bar reads target → researched → assigned → contacted → replied → meeting →
// pilot → verbal → contract → client. Researched / Assigned / Client are facts (research run, owner, client status) with
// their own done state; the stage steps keep the index rule. flow = { research: { created_at }, owner: 'Cyrus', client: { client_status, client_since } }.
function flowSteps(steps, stage, flow) {
  const first = steps.find(s => s.id === 'target');
  const i = id => steps.findIndex(s => s.id === id);
  const stageIdx = steps.findIndex(s => s.id === stage);
  const cur = id => (stageIdx >= 0 && i(id) < stageIdx ? 'done' : stageIdx === i(id) ? 'now' : 'later');
  const out = [
    first,
    { id: 'researched', label: 'Researched', at: mdy(flow.research?.created_at), state: flow.research ? 'done' : 'later' },
    { id: 'assigned', label: 'Assigned', at: null, sub: flow.owner || null, state: flow.owner ? 'done' : 'later' },
    ...steps.filter(s => ['contacted', 'responded', 'meeting', 'proposal_pilot', 'verbal', 'contract'].includes(s.id)).map(s => ({ ...s, label: s.id === 'responded' ? 'Replied' : s.id === 'proposal_pilot' ? 'Pilot' : s.label })),
    { ...steps.find(s => s.id === 'launched'), label: 'Client', ...(flow.client?.client_status ? { state: 'done', at: mdy(flow.client.client_since) || steps.find(s => s.id === 'launched').at } : {}) },
  ];
  const current = out.findIndex(s => s.id === stage);
  return { steps: out.map(s => (s.state ? s : { ...s, state: cur(s.id) })), current };
}

// -> { steps, current, side, stage, path } for the record, or null (visitor / Apollo-only rows have no deal yet).
export function progressModel(type, stage, history = [], flow = null) {
  const reached = {};
  for (const h of history) reached[h.stage === 'in_sequence' ? 'first_email_sent' : h.stage] = h.at;
  if (type === 'partner') {
    const s = stage || 'not_started';
    const steps = WORKFLOW_STEPS.map(w => ({ id: w.id, label: w.label, at: reached[w.id] ? md(reached[w.id]) : null }));
    return { steps, current: s === 'paused' ? -1 : stepOf(s), side: SIDE[s] || null, stage: s, path: 'partner' };
  }
  if (type === 'employer' || type === 'target') {
    const s = type === 'target' ? 'target' : stage || 'target';
    const steps = STAGE_ORDER.map(id => ({ id, label: STAGE_LABELS[id], at: reached[id] ? md(reached[id]) : null }));
    if (flow) { const f = flowSteps(steps, s, flow); return { ...f, side: SIDE[s] || null, stage: s, path: 'employer', flow: true }; }
    return { steps, current: STAGE_ORDER.indexOf(s), side: SIDE[s] || null, stage: s, path: 'employer' };
  }
  return null;
}

export function lastTouchLine(lt, now = new Date()) {
  if (!lt?.at) return null;
  const when = laDay(lt.at) === laDay(now) ? 'today' : md(lt.at);
  const what = lt.what || (lt.touch_type === 'stage' ? 'stage moved' : lt.touch_type === 'done' ? 'to-do done' : lt.touch_type ? `${lt.touch_type} touch` : null);
  return ['Last touch: ' + when, lt.by, what].filter(Boolean).join(' · ');
}

export default function CompanyProgress({ businessId, row, detail, canEdit, flow = null, onPatch, onChanged, onToast, onConvert, onResearch, onOwner, onClient }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [more, setMore] = useState(false);
  const m = progressModel(row.type, detail?.record?.stage ?? row.stage, detail?.stage_history, flow);
  if (!m) return null;
  const label = id => (m.path === 'partner' ? WORKFLOW_STEPS.find(w => w.id === id)?.label : STAGE_LABELS[id]) || SIDE[id] || id;
  const stale = e => (e.status === 409 && /changed elsewhere|stale/i.test(e.message) ? 'This changed elsewhere - refresh' : e.message);
  const act = async (what, fn) => { setBusy(what); setError(''); setMore(false); try { await fn(); } catch (e) { setError(stale(e)); } finally { setBusy(''); } };
  const patchRow = to => onPatch?.(boardStage(row.type, row.type === 'partner' ? { pipeline_status: to, category: row.category } : { stage: to }));
  const moved = (to, undo) => {
    patchRow(to); onChanged();
    onToast({ text: `${row.name}: moved to ${label(to)}`, undo: async () => { await undo(); patchRow(m.stage); onChanged(); } });
  };
  // Employer / partner: one stage write with expect = what this screen shows.
  const moveTo = async (to, { backward = false } = {}) => {
    if (row.type === 'partner') {
      const { event } = await goalsApi.partnerSignal(businessId, row.id, to === 'paused' ? { type: 'deprioritize', expect: m.stage } : { type: 'status', to, expect: m.stage });
      moved(to, () => goalsApi.partnerUndo(businessId, row.id, event.id));
      return;
    }
    await updateOpportunity(businessId, row.id, { stage: to, ...(backward ? { allow_backward: true } : {}) });
    moved(to, () => updateOpportunity(businessId, row.id, { stage: m.stage, allow_backward: true }));
  };
  const nextVerb = row.type === 'target' ? 'Mark contacted' : NEXT_VERB[m.path][m.stage];
  const primary = () => act('next', async () => {
    if (row.type === 'target' || (row.type === 'employer' && m.stage === 'target')) {
      await markContacted({ businessId, row, onChanged, onToast, onConvert });
      return;
    }
    const r = await goalsApi.advanceStage(businessId, row.type, row.id, m.stage);
    moved(r.after, () => (row.type === 'partner' ? goalsApi.partnerUndo(businessId, row.id, r.event.id) : updateOpportunity(businessId, row.id, { stage: r.before, allow_backward: true })));
  });
  const jump = i => {
    const to = m.steps[i].id;
    if (to === 'researched') return onResearch?.();
    if (to === 'assigned') return onOwner?.();
    if (to === 'launched' && m.flow && m.stage !== 'contract') return onClient?.();
    if (to === m.stage || row.type === 'target') return;
    const backward = !m.side && i < m.current;
    if (backward && !window.confirm(`Move ${row.name} back to ${m.steps[i].label}?`)) return;
    return act('jump', () => moveTo(to, { backward }));
  };
  const lanes = m.path === 'partner' ? ['paused'] : ['lost', 'nurture', 'on_hold'];
  const lt = lastTouchLine(detail?.record?.last_touch);
  const editable = canEdit && (row.type !== 'target' || !!m.flow);
  return (
    <section aria-label="Progress" data-company-progress={row.type} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="ui-group-label" style={{ width: 72, flex: 'none' }}>Progress</span>
        {m.flow && <span style={{ order: 9, flexBasis: '100%', fontSize: 11.5, color: SA.muted, textAlign: 'right' }}>click a stage to jump · Undo 10 s</span>}
        <div style={{ flex: '1 1 420px', minWidth: 0 }}>
          <ProgressBar label={`${row.name} progress`} steps={m.steps} current={m.current} side={m.side} onStep={editable && !busy ? jump : null} />
        </div>
        {canEdit && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', position: 'relative' }}>
            {nextVerb && !m.side && <button type="button" className="ui-btn ui-btn--primary" data-progress-next disabled={!!busy} onClick={primary}>{busy === 'next' ? 'Saving…' : nextVerb}</button>}
            {row.type !== 'target' && (
              <button type="button" className="ui-btn ui-btn--secondary" aria-expanded={more} aria-haspopup="menu" disabled={!!busy} onClick={() => setMore(o => !o)}>More ▾</button>
            )}
            {more && (
              <div role="menu" aria-label="Move to" style={{ position: 'absolute', right: 0, top: 36, zIndex: 5, display: 'flex', flexDirection: 'column', gap: 2, padding: 6, borderRadius: 8, background: SA.surface, border: `1px solid ${SA.border}`, minWidth: 160 }}>
                {lanes.filter(l => l !== m.stage).map(l => <button key={l} type="button" role="menuitem" className="ui-btn ui-btn--tertiary" style={{ justifyContent: 'flex-start' }} onClick={() => act('lane', () => moveTo(l))}>{SIDE[l]}</button>)}
                {m.side && m.path === 'employer' && <button type="button" role="menuitem" className="ui-btn ui-btn--tertiary" style={{ justifyContent: 'flex-start' }} onClick={() => act('lane', () => moveTo('target', { backward: true }))}>Back to the pipeline (Target)</button>}
                <span style={{ fontSize: 11.5, color: SA.muted, padding: '4px 4px 0' }}>Jump to a stage: click it on the bar.</span>
              </div>
            )}
          </div>
        )}
      </div>
      {lt && <div data-last-touch style={{ fontSize: 12.5, color: SA.soft, paddingLeft: 80 }}>{lt}</div>}
      {error && <ErrorNote message={error} />}
    </section>
  );
}
