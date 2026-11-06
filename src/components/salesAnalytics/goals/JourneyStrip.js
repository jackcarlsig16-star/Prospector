import { useState, useEffect, useRef } from 'react';
import { SA } from '../theme';
import { goalsApi } from './goalsApi';
import { updateOpportunity } from '../pipelineApi';
import { ErrorNote } from './goalsUi';
import { STAGE_ORDER, STAGE_LABELS } from '../pipelineStages';
import { WORKFLOW_STEPS, stepOf } from '../../../constants/partnerPipeline';
import { boardStage } from '../../../constants/pipelineBoard';

// company-window-v4 J - the journey card, the window's ONE stage control: eight equal-column nodes on one track.
// Employers and targets walk Target → Researched → Contacted → Replied → Meeting → Pilot → Verbal → Client (Researched is
// a research_runs fact, Client the client status; Contract has no node - a record at Contract sits on Verbal with
// "contract" under it); partners walk their own workflow steps (D4: no Researched node, in_sequence sits on Sent).
// Done = green ✓ with the date reached, now = accent with a glow, later = outlined with its number; green fills the
// track up to the current node. A later node is the forward move through the existing paths (partner status signal
// with expect, employer advance with expect + to, a target's Add to pipeline, Researched = Run research, Client =
// Make client) with the 10 s Undo; skipping stages asks first. Nothing goes backward here (⋯ › Jump to stage does), a
// side lane (Lost · Nurture · On hold · Paused) reads only. Viewers read. Narrow: the track scrolls inside the card.
// A date-only stamp (client_since) is an LA calendar day; a timestamp is read in LA time.
const md = d => new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? `${d}T12:00:00Z` : d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: /^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? 'UTC' : 'America/Los_Angeles' });
const SIDE = { lost: 'Lost', nurture: 'Nurture', on_hold: 'On hold', paused: 'Paused' };
const JOURNEY_NODES = [['target', 'Target'], ['researched', 'Researched'], ['contacted', 'Contacted'], ['responded', 'Replied'], ['meeting', 'Meeting'], ['proposal_pilot', 'Pilot'], ['verbal', 'Verbal'], ['launched', 'Client']];
const NODE_W = 68;

// -> { nodes: [{ id, label, state, at, sub? }], current, side, stage, path } or null (visitor / Apollo-only rows have no deal).
// flow = { research: { created_at } | null, client: { client_status, client_since } | null } for employers / targets.
export function journeyModel(type, stage, history = [], flow = null) {
  const reached = {};
  for (const h of history) reached[h.stage === 'in_sequence' ? 'first_email_sent' : h.stage] = h.at;
  const at = id => (reached[id] ? md(reached[id]) : null);
  if (type === 'partner') {
    const s = stage || 'not_started';
    const cur = s === 'paused' ? -1 : stepOf(s);
    const nodes = WORKFLOW_STEPS.map((w, i) => ({ id: w.id, label: w.label, at: at(w.id), state: cur < 0 ? 'later' : i < cur ? 'done' : i === cur ? 'now' : 'later' }));
    return { nodes, current: cur, side: SIDE[s] || null, stage: s, path: 'partner' };
  }
  if (type === 'employer' || type === 'target') {
    const s = type === 'target' ? 'target' : stage || 'target';
    const si = STAGE_ORDER.indexOf(s);
    const research = flow?.research || null;
    const client = flow?.client?.client_status ? flow.client : null;
    const nodes = JOURNEY_NODES.map(([id, label]) => {
      if (id === 'researched') return { id, label, at: research ? md(research.created_at) : null, state: research ? 'done' : 'later' };
      const ni = STAGE_ORDER.indexOf(id);
      const contract = id === 'verbal' && s === 'contract';
      const state = id === 'launched' && client ? 'done' : contract ? 'now' : si < 0 ? 'later' : ni < si ? 'done' : ni === si ? 'now' : 'later';
      return { id, label, at: id === 'launched' && client?.client_since ? md(client.client_since) : at(id), state, ...(contract ? { sub: 'contract' } : {}) };
    });
    const now = nodes.findIndex(n => n.state === 'now');
    const lastDone = nodes.reduce((a, n, i) => (n.state === 'done' ? i : a), -1);
    return { nodes, current: now >= 0 ? now : si < 0 ? -1 : lastDone, side: SIDE[s] || null, stage: s, path: 'employer' };
  }
  return null;
}

export default function JourneyStrip({ businessId, row, detail, canEdit, flow = null, onPatch, onChanged, onToast, onResearch, onAddToPipeline, onClient }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef(null);
  const m = journeyModel(row.type, detail?.record?.stage ?? row.stage, detail?.stage_history, flow);
  const current = m?.current ?? -1;
  useEffect(() => {
    const el = ref.current?.querySelector('[data-state="now"]');
    if (el?.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [current]);
  if (!m) return null;
  const editable = canEdit && !m.side;
  const label = id => m.nodes.find(n => n.id === id)?.label || STAGE_LABELS[id] || id;
  const stale = e => (e.status === 409 && /changed elsewhere|stale/i.test(e.message) ? 'This changed elsewhere - refresh' : e.message);
  const patchRow = to => onPatch?.(boardStage(row.type, row.type === 'partner' ? { pipeline_status: to, category: row.category } : { stage: to }));
  const moved = (to, undo) => {
    patchRow(to); onChanged();
    onToast({ text: `${row.name}: moved to ${label(to)}`, undo: async () => { await undo(); patchRow(m.stage); onChanged(); } });
  };
  // One guarded stage write with expect = the stage this card shows (409 when the screen is stale).
  const moveTo = async to => {
    if (row.type === 'partner') {
      const { event } = await goalsApi.partnerSignal(businessId, row.id, { type: 'status', to, expect: m.stage });
      moved(to, () => goalsApi.partnerUndo(businessId, row.id, event.id));
      return;
    }
    await goalsApi.advanceStage(businessId, 'employer', row.id, m.stage, to);
    moved(to, () => updateOpportunity(businessId, row.id, { stage: m.stage, allow_backward: true }));
  };
  const makesClient = nd => nd.id === 'launched' && m.path === 'employer' && m.stage !== 'contract';
  const click = async nd => {
    if (nd.state !== 'later' || busy) return;
    if (nd.id === 'researched') return onResearch?.();
    if (row.type === 'target') return onAddToPipeline?.();
    if (makesClient(nd)) return onClient?.();
    const i = m.nodes.indexOf(nd);
    const skipped = m.nodes.filter((x, j) => j > current && j < i && x.state === 'later' && x.id !== 'researched').map(x => x.label);
    if (skipped.length && !window.confirm(`Jump ${row.name} from ${m.nodes[current]?.label || label(m.stage)} to ${nd.label}, skipping ${skipped.join(', ')}?`)) return;
    setBusy(true); setError('');
    try { await moveTo(nd.id); } catch (e) { setError(stale(e)); } finally { setBusy(false); }
  };
  const titleOf = nd => (nd.id === 'researched' ? 'Run research' : row.type === 'target' ? 'Add to pipeline first' : makesClient(nd) ? 'Make client' : `Jump to ${nd.label}`);
  const n = m.nodes.length, half = 50 / n;
  const fill = current > 0 ? (current / (n - 1)) * (100 - 2 * half) : 0;
  return (
    <section role="group" aria-label="Journey" data-journey={row.type} data-stage={m.stage} style={{ background: SA.surface2, border: `1px solid ${SA.border}`, borderRadius: 10, padding: '12px 14px 8px', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <div ref={ref} data-journey-scroll style={{ overflowX: 'auto', overflowY: 'hidden', minWidth: 0 }}>
        <ol data-journey-track style={{ listStyle: 'none', margin: 0, padding: '4px 0 2px', display: 'grid', gridTemplateColumns: `repeat(${n}, minmax(${NODE_W}px, 1fr))`, position: 'relative', minWidth: n * NODE_W }}>
          <span aria-hidden="true" style={{ position: 'absolute', left: `${half}%`, right: `${half}%`, top: 15, height: 2, background: SA.track }} />
          <span aria-hidden="true" data-journey-fill style={{ position: 'absolute', left: `${half}%`, width: `${fill.toFixed(2)}%`, top: 15, height: 2, background: SA.good }} />
          {m.nodes.map((nd, i) => {
            const done = nd.state === 'done', now = nd.state === 'now';
            const clickable = editable && nd.state === 'later';
            const name = done ? `${nd.label}, done${nd.at ? ` ${nd.at}` : ''}` : now ? `${nd.label}, now${nd.sub ? ` (${nd.sub})` : ''}` : `${nd.label}, not yet`;
            const body = (
              <>
                <span aria-hidden="true" data-journey-dot style={{ width: 22, height: 22, borderRadius: 999, boxSizing: 'border-box', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 600, lineHeight: 1,
                  ...(done ? { background: SA.good, color: SA.ground } : now ? { background: SA.accent, color: SA.ground, boxShadow: `0 0 0 5px color-mix(in srgb, ${SA.accent} 22%, transparent)` } : { background: SA.surface2, border: `2px solid ${SA.borderStrong}`, color: SA.muted }) }}>
                  {done ? '✓' : now ? '' : i + 1}
                </span>
                <b style={{ fontSize: 12, fontWeight: 500, color: done || now ? SA.text : SA.muted, whiteSpace: 'nowrap' }}>{nd.label}</b>
                <small style={{ fontSize: 11, color: SA.muted, whiteSpace: 'nowrap' }}>{done ? nd.at || ' ' : now ? nd.sub || 'now' : ' '}</small>
              </>
            );
            const box = { all: 'unset', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, width: '100%', textAlign: 'center', position: 'relative', padding: '0 2px', cursor: clickable ? 'pointer' : 'default' };
            return (
              <li key={nd.id} data-node={nd.id} data-state={nd.state} aria-current={now ? 'step' : undefined} style={{ display: 'flex', minWidth: 0 }}>
                {clickable
                  ? <button type="button" aria-label={name} title={titleOf(nd)} disabled={busy} onClick={() => click(nd)} style={box}>{body}</button>
                  : <span role="img" aria-label={name} title={name} style={box}>{body}</span>}
              </li>
            );
          })}
        </ol>
      </div>
      {(editable || m.side) && (
        <span data-journey-hint style={{ fontSize: 12, color: SA.muted }}>{m.side ? `${m.side} · ⋯ › Jump to stage brings it back` : 'Click a later stage to move there · Undo 10 s'}</span>
      )}
      {error && <ErrorNote message={error} />}
    </section>
  );
}
