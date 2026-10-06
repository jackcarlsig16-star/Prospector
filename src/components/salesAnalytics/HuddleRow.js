import { useState } from 'react';
import { SA, SA_TYPE, SA_SHAPE, saSans } from './theme';
import { SEMANTIC } from './palette';
import HuddleCard from './HuddleCard';
import { OWNER_LABELS, HEAT_LABELS, actionText, dueBucket, signalOf, plusDays } from './huddleView';

// sales-huddle-v2 REV1 - one prospect, two lines: signal + heat + who +
// next action, then context and links. One-click actions for Members;
// ⋯ opens the full card (status, next action, collateral, pipeline). Phone
// numbers are never shown (standing rule).
const TONE = { reply: SEMANTIC.healthy, click: SEMANTIC.warning, open: '#AFC0FF', over: SA.bad, due: SA.soft };
const HEAT_COLOR = { hot: SEMANTIC.problem, warm: SEMANTIC.warning, cold: SA.neutral };

const chip = color => ({ display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 8px', borderRadius: 999, fontSize: 12, whiteSpace: 'nowrap', color, border: `1px solid color-mix(in srgb, ${color} 45%, transparent)`, background: `color-mix(in srgb, ${color} 10%, transparent)` });
const iconBtn = on => ({ ...saSans, minWidth: 34, height: 32, padding: '0 8px', borderRadius: 8, fontSize: 14, cursor: 'pointer', color: SA.text, border: `1px solid ${on ? SA.accent : SA.border}`, background: on ? 'color-mix(in srgb, var(--sa-accent) 18%, transparent)' : SA.surface2 });
const smallBtn = { ...saSans, height: 32, padding: '0 10px', borderRadius: 8, fontSize: 13, cursor: 'pointer', color: SA.text, border: `1px solid ${SA.border}`, background: SA.surface2 };
const link = { fontSize: 12, color: SA.link, textDecoration: 'none' };

// stacked (phones): the action buttons get their own line; otherwise they sit
// at the end of the first line, as in the mockup.
export default function HuddleRow({ businessId, p, today, canEdit, ownerColor, onAct, onFlag, collateral, isNewSinceHuddle, onUpdated, stacked }) {
  const [panel, setPanel] = useState(null); // snooze | due | owner | note | card
  const [note, setNote] = useState('');
  const [due, setDue] = useState(p.next_action_due || plusDays(today, 1));
  const [error, setError] = useState('');
  const { chip: sig, context } = signalOf(p, today);
  const overdue = dueBucket(p, today) === 'overdue';
  const act = async (patch, label) => { setError(''); try { await onAct(p, patch, label); setPanel(null); return true; } catch (e) { setError(e.message); return false; } };
  const toggle = id => setPanel(panel === id ? null : id);
  const actions = canEdit && (
    <div role="group" aria-label={`Actions for ${p.name}`} style={{ display: 'flex', flexWrap: stacked ? 'wrap' : 'nowrap', gap: 6 }}>
      <button type="button" title="Done (contacted)" aria-label="Done" disabled={p.status === 'contacted'} onClick={() => act({ status: 'contacted' }, 'marked contacted')} style={iconBtn(p.status === 'contacted')}>✓</button>
      <button type="button" title="Snooze" aria-label="Snooze" aria-expanded={panel === 'snooze'} onClick={() => toggle('snooze')} style={iconBtn(panel === 'snooze')}>⏰</button>
      <button type="button" title="Set due date" aria-label="Set due date" aria-expanded={panel === 'due'} onClick={() => toggle('due')} style={iconBtn(panel === 'due')}>📅</button>
      <button type="button" title="Owner" aria-label="Change owner" aria-expanded={panel === 'owner'} onClick={() => toggle('owner')} style={iconBtn(panel === 'owner')}>👤</button>
      <button type="button" title="Note" aria-label="Add note" aria-expanded={panel === 'note'} onClick={() => toggle('note')} style={iconBtn(panel === 'note')}>📝</button>
      {onFlag && <button type="button" title="Flag for a teammate" aria-label="Flag" onClick={() => onFlag(p)} style={iconBtn(false)}>🚩</button>}
      <button type="button" title="More: status, next action, collateral, pipeline" aria-label="More" aria-expanded={panel === 'card'} onClick={() => toggle('card')} style={iconBtn(panel === 'card')}>⋯</button>
    </div>
  );
  const appendNote = text => {
    const stamp = new Date(`${today}T12:00:00Z`).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' });
    return [p.notes, `${stamp}: ${text.trim()}`].filter(Boolean).join('\n');
  };

  return (
    <div id={`huddle-card-${p.contact_id}`} style={{ padding: '10px 12px', borderRadius: SA_SHAPE.radiusInner, background: SA.surface, border: `1px solid ${panel === 'card' ? SA.borderStrong : SA.border}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', flexWrap: stacked ? 'wrap' : 'nowrap', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, flex: '1 1 auto', minWidth: 0 }}>
          {sig && <span style={chip(TONE[sig.tone])}>{sig.label}</span>}
          <span style={chip(HEAT_COLOR[p.heat_band])} title={`Heat ${p.score}\n${(p.why || []).join('\n')}`}>{HEAT_LABELS[p.heat_band]}</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: SA.text, minWidth: 0 }}>{p.name || 'Unknown contact'}</span>
          <span style={{ fontSize: 13, color: SA.muted, minWidth: 0, flex: '1 1 160px' }}>{[p.title, p.company].filter(Boolean).join(' · ')}</span>
          {isNewSinceHuddle && <span style={chip(SA.accent)}>new</span>}
        </div>
        {/* Owner + actions never wrap away from the name on desktop. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
          <span style={{ ...chip(SA.soft), borderColor: SA.border, background: 'transparent' }}><span style={{ width: 7, height: 7, borderRadius: 999, background: ownerColor(p.owner) }} />{OWNER_LABELS[p.owner]}</span>
          {!stacked && actions}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, fontSize: 12 }}>
        <span style={{ fontWeight: 600, color: overdue ? SA.bad : SA.accent }}>→ {actionText(p, today)}</span>
        {context && <span style={{ color: SA.muted }}>{context}</span>}
        <span style={{ flex: 1 }} />
        {p.linkedin_url && <a href={p.linkedin_url} target="_blank" rel="noreferrer" style={link}>LinkedIn ↗</a>}
        <a href={p.apollo_url} target="_blank" rel="noreferrer" style={link}>Apollo ↗</a>
      </div>
      {stacked && actions}
      {panel === 'snooze' && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[[1, '1 day'], [3, '3 days'], [7, '1 week']].map(([n, lb]) => (
            <button key={n} type="button" style={smallBtn} onClick={() => act({ status: 'not_now', snooze_until: plusDays(today, n) }, `snoozed ${lb}`)}>{lb}</button>
          ))}
        </div>
      )}
      {panel === 'due' && (
        <form onSubmit={e => { e.preventDefault(); act({ next_action_due: due || null }, due ? `due ${due}` : 'due date cleared'); }} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <input type="date" aria-label="Due date" value={due} onChange={e => setDue(e.target.value)} style={{ ...smallBtn, cursor: 'text' }} />
          <button type="submit" style={smallBtn}>Set</button>
          {p.next_action_due && <button type="button" style={smallBtn} onClick={() => act({ next_action_due: null }, 'due date cleared')}>Clear</button>}
        </form>
      )}
      {panel === 'owner' && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {Object.entries(OWNER_LABELS).map(([id, lb]) => (
            <button key={id} type="button" disabled={p.owner === id} style={{ ...smallBtn, opacity: p.owner === id ? 0.5 : 1 }} onClick={() => act({ owner: id }, `owner → ${lb}`)}>
              <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 999, background: ownerColor(id), marginRight: 6 }} />{lb}
            </button>
          ))}
        </div>
      )}
      {panel === 'note' && (
        <form onSubmit={async e => { e.preventDefault(); if (note.trim() && await act({ notes: appendNote(note) }, 'note added')) setNote(''); }} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <input autoFocus aria-label="Note" placeholder="e.g. Called, left voicemail" value={note} onChange={e => setNote(e.target.value)} style={{ ...smallBtn, cursor: 'text', flex: '1 1 220px' }} />
          <button type="submit" disabled={!note.trim()} style={{ ...smallBtn, opacity: note.trim() ? 1 : 0.5 }}>Add</button>
        </form>
      )}
      {panel === 'card' && (
        <HuddleCard businessId={businessId} prospect={p} collateral={collateral} today={today} isNewSinceHuddle={isNewSinceHuddle} onUpdated={onUpdated} />
      )}
      {error && <span style={{ ...SA_TYPE.body, fontSize: 12, color: SA.bad }}>⚠ {error}</span>}
    </div>
  );
}
