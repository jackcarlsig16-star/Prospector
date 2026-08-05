import React, { useState } from 'react';
import { C, TS, mono } from '../constants/colors';
import { T } from '../constants/tokens';
import {
  migrateOutboundEntry,
  promoteToAE,
  CADENCE_C,
  CADENCE_LABEL,
} from '../utils/outbound';
import { getTriggersForAccount, TRIGGER_C } from '../utils/triggers';
import { searchDomain, extractHunterDomain } from '../utils/hunter';
import { ALL_STATUSES, STATUS_EMOJI, STATUS_C } from '../constants/frontierStatus';

const TIER_BORDER = { Gold: T.tier.gold, Silver: T.tier.silver, Tin: T.tier.tin, Slag: T.tier.slag };

const contactDisplayName = c => {
  if (!c) return null;
  const fn = c.firstName || '';
  const ln = c.lastName || '';
  return [fn, ln].filter(Boolean).join(' ').trim() || c.email || null;
};

const fmtDate = iso => {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' }); }
  catch { return ''; }
};

const fmtAge = days => {
  if (days === null || days === undefined) return '';
  if (days <= 0) return 'today';
  if (days === 1) return '1d ago';
  return `${days}d ago`;
};

function CadencePips({ steps = [], state }) {
  const slots = steps.length || 4;
  const sent = steps.filter(s => s.sentAt).length;
  const pips = [];
  for (let i = 0; i < slots; i++) {
    const step = steps[i];
    const isSent = step?.sentAt;
    pips.push(
      <span key={i} style={{
        display: 'inline-block',
        width: 7, height: 7,
        borderRadius: '50%',
        background: isSent ? CADENCE_C[state] || T.cyan : 'transparent',
        border: `1px solid ${isSent ? (CADENCE_C[state] || T.cyan) : '#3a4a3a'}`,
        boxShadow: isSent ? `0 0 4px ${CADENCE_C[state] || T.cyan}66` : 'none',
      }}/>
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {pips}
      {steps.length > 0 && (
        <span style={{ ...mono, fontSize: 10, color: '#5a6a5a', marginLeft: 4 }}>
          Step {Math.min(sent + 1, steps.length)}/{steps.length}
        </span>
      )}
    </span>
  );
}

function TouchButton({ state, onClick, disabled }) {
  const label = state === 'cold' ? '+ Start'
    : state === 'reply_waiting' ? '💬 Reply'
    : state === 'replied' ? '💬 Reply'
    : state === 'booked' ? '✓ Booked'
    : state === 'paused' ? '▶ Resume'
    : state === 'stalled' ? '↻ Restart'
    : '✉ Touch';
  const c = CADENCE_C[state] || T.cyan;
  const isAction = state !== 'booked';
  return (
    <button
      onClick={e => { e.stopPropagation(); if (isAction && !disabled) onClick?.(); }}
      disabled={disabled || !isAction}
      style={{
        ...mono, fontSize: 11, padding: '4px 11px',
        background: `${c}14`,
        border: `1px solid ${c}66`,
        color: c,
        borderRadius: 4,
        cursor: isAction && !disabled ? 'pointer' : 'default',
        letterSpacing: '0.04em',
        whiteSpace: 'nowrap',
        textShadow: `0 0 6px ${c}44`,
      }}>
      {label}
    </button>
  );
}

function TriggerChip({ trigger, onClick, draggable = false }) {
  const c = TRIGGER_C[trigger.type] || '#cfcfcf';
  const prefix = trigger.type === 'intent' || trigger.type === 'engagement' ? '⚡ ' : '';
  const age = trigger.ageInDays !== null && trigger.ageInDays !== undefined ? ` · ${fmtAge(trigger.ageInDays)}` : '';
  return (
    <span
      draggable={draggable}
      onDragStart={draggable ? e => {
        e.dataTransfer.setData('text/plain', trigger.label);
      } : undefined}
      onClick={() => {
        try { navigator.clipboard.writeText(trigger.label); } catch {}
        onClick?.();
      }}
      title="Click to copy · drag into the email composer"
      style={{
        ...mono, fontSize: 11, padding: '3px 9px',
        background: `${c}10`, border: `1px solid ${c}44`, color: c,
        borderRadius: 3, cursor: 'pointer', whiteSpace: 'nowrap',
        letterSpacing: '0.02em',
      }}>
      {prefix}{trigger.label}{age}
    </span>
  );
}

export default function OutboundCard({
  entry: rawEntry,
  accounts = [],
  setAccounts,
  setFrontier,
  onCreateTask,
  activeUser,
  intentHistory = [],
  threadCache = {},
  isExpanded,
  onToggleExpand,
  onOpenCompose,
  onUnassign,
}) {
  const entry = migrateOutboundEntry(rawEntry);
  const ob = entry.outbound;
  const cadence = ob?.cadence || { state: 'cold', steps: [] };
  const state = cadence.state || 'cold';
  const stateC = CADENCE_C[state] || '#555';

  const acct = accounts.find(a => (a.name || '').toLowerCase() === (entry.name || '').toLowerCase()) || {};
  const loc = acct.loc || [acct.city, acct.state].filter(Boolean).join(', ') || null;
  const tierKey = entry.tier || acct.tier;
  const tierC = TIER_BORDER[tierKey] || '#3a4a3a';
  const tierGlyph = TS[tierKey]?.i || '○';

  const triggers = getTriggersForAccount({ ...acct, web: entry.web || acct.web, signals: entry.signals?.length ? entry.signals : acct.sigs },
    { intentHistory, threadCache, frontierEntry: entry });
  const topTrigger = triggers[0] || null;

  const topContact = ob.topContact;
  const alternates = ob.alternateContacts || [];

  // ── Local UI state ──
  const [showAddTrigger, setShowAddTrigger] = useState(false);
  const [manualTriggerDraft, setManualTriggerDraft] = useState('');
  const [showLogTouch, setShowLogTouch] = useState(false);
  const [logDraft, setLogDraft] = useState({ type: 'email', subject: '', date: new Date().toISOString().slice(0, 10) });
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState(ob.notes || '');
  const [findingContacts, setFindingContacts] = useState(false);
  const [findError, setFindError] = useState(null);

  const updateEntry = patch => setFrontier?.(fl => fl.map(f => f.id === entry.id ? { ...f, ...patch } : f));
  const updateOutbound = patch => setFrontier?.(fl => fl.map(f => f.id === entry.id
    ? { ...f, outbound: { ...f.outbound, ...patch } }
    : f));
  const updateCadence = patch => setFrontier?.(fl => fl.map(f => f.id === entry.id
    ? { ...f, outbound: { ...f.outbound, cadence: { ...f.outbound?.cadence, ...patch } } }
    : f));

  const addManualTrigger = () => {
    const label = manualTriggerDraft.trim();
    if (!label) return;
    const t = { label, addedAt: new Date().toISOString(), addedBy: activeUser?.id || null };
    updateOutbound({ manualTriggers: [...(ob.manualTriggers || []), t] });
    setManualTriggerDraft('');
    setShowAddTrigger(false);
  };

  const logTouch = () => {
    if (!logDraft.subject.trim()) return;
    const step = {
      type: logDraft.type,
      subject: logDraft.subject.trim(),
      sentAt: new Date(`${logDraft.date}T12:00:00`).toISOString(),
      loggedManually: true,
    };
    const steps = [...(cadence.steps || []), step];
    updateOutbound({
      cadence: {
        ...cadence,
        state: state === 'cold' ? 'in_sequence' : state,
        steps,
        currentStepIdx: steps.filter(s => s.sentAt).length,
      },
    });
    setLogDraft({ type: 'email', subject: '', date: new Date().toISOString().slice(0, 10) });
    setShowLogTouch(false);
  };

  const saveNotes = () => {
    updateOutbound({ notes: notesDraft });
    setEditingNotes(false);
  };

  const swapContact = alt => {
    const newAlts = [topContact, ...alternates.filter(a =>
      `${a.email}|${a.firstName}|${a.lastName}` !== `${alt.email}|${alt.firstName}|${alt.lastName}`)].filter(Boolean);
    updateOutbound({ topContact: alt, alternateContacts: newAlts.slice(0, 4) });
  };

  const findContacts = async () => {
    setFindingContacts(true); setFindError(null);
    const domain = extractHunterDomain(entry.web || acct.web);
    if (!domain) { setFindError('No website on this account'); setFindingContacts(false); return; }
    const r = await searchDomain({ domain, limit: 5 });
    if (r.error) { setFindError(r.error); setFindingContacts(false); return; }
    const contacts = r.contacts || [];
    if (contacts.length === 0) { setFindError('No contacts found'); setFindingContacts(false); return; }
    updateOutbound({ topContact: contacts[0], alternateContacts: contacts.slice(1, 5) });
    setFindingContacts(false);
  };

  const canPromote = state === 'replied' && cadence.replyClassification === 'interested';

  // ── Render ──
  return (
    <div style={{ marginBottom: 4 }}>
      {/* Collapsed row */}
      <div
        onClick={() => onToggleExpand?.(entry.id)}
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 2fr 1.4fr 1.6fr 1.4fr auto auto',
          gap: 10,
          padding: '10px 12px',
          background: isExpanded ? '#031007' : '#020a06',
          border: `1px solid ${isExpanded ? '#2a4a2a' : '#142a16'}`,
          borderLeft: `3px solid ${tierC}`,
          borderRadius: isExpanded ? '6px 6px 0 0' : 6,
          alignItems: 'center',
          cursor: 'pointer',
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = 'rgba(0,245,255,0.025)'; }}
        onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = '#020a06'; }}>
        {/* State dot */}
        <span title={CADENCE_LABEL[state]} style={{
          display: 'inline-block', width: 9, height: 9, borderRadius: '50%',
          background: stateC,
          boxShadow: state === 'reply_waiting' || state === 'booked' ? `0 0 8px ${stateC}` : 'none',
          animation: state === 'reply_waiting' ? 'pulse 1.5s ease-in-out infinite' : 'none',
        }}/>

        {/* Identity */}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: T.neon, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
            {tierKey && <span style={{ ...mono, fontSize: 10, color: tierC, border: `1px solid ${tierC}44`, borderRadius: 3, padding: '0 4px', flexShrink: 0 }}>{tierGlyph}</span>}
            {entry.isDemo && <span style={{ ...mono, fontSize: 8, padding: '1px 5px', background: `${T.amber}14`, border: `1px solid ${T.amber}55`, color: T.amber, borderRadius: 3, letterSpacing: '0.08em' }}>DEMO</span>}
            {setFrontier && (() => {
              const sv = entry.status || "Have not touched yet";
              const sc = STATUS_C[sv] || '#555';
              return (
                <span onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} style={{ flexShrink: 0, marginLeft: 'auto' }}>
                  <select
                    value={sv}
                    onChange={e => { e.stopPropagation(); updateEntry({ status: e.target.value }); }}
                    title={`Status: ${sv}`}
                    style={{ background: 'transparent', border: `1px solid ${sc}44`, borderRadius: 3, color: sc, fontSize: 10, fontFamily: 'monospace', padding: '1px 4px', cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none' }}>
                    {ALL_STATUSES.map(s => (
                      <option key={s} value={s} style={{ background: '#0a1410', color: STATUS_C[s] || '#cfe8d4' }}>
                        {STATUS_EMOJI[s] ? `${STATUS_EMOJI[s]} ${s}` : s}
                      </option>
                    ))}
                  </select>
                </span>
              );
            })()}
          </div>
          <p style={{ ...mono, margin: '2px 0 0', fontSize: 11, color: '#5a6a5a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {[acct.vert, loc].filter(Boolean).join(' · ') || entry.useCase || '—'}
          </p>
        </div>

        {/* Cadence */}
        <div onClick={e => e.stopPropagation()}>
          <CadencePips steps={cadence.steps} state={state}/>
        </div>

        {/* Top contact */}
        <div style={{ minWidth: 0 }}>
          {topContact ? (
            <>
              <p style={{ margin: 0, fontSize: 12, color: '#cfe8d4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {contactDisplayName(topContact)}
              </p>
              <p style={{ ...mono, margin: '1px 0 0', fontSize: 10, color: '#5a6a5a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {topContact.position || topContact.department || '—'}
              </p>
            </>
          ) : (
            <p style={{ ...mono, margin: 0, fontSize: 11, color: '#5a6a5a', fontStyle: 'italic' }}>no contact yet</p>
          )}
        </div>

        {/* Top trigger */}
        <div style={{ minWidth: 0, overflow: 'hidden' }}>
          {topTrigger ? (
            <p style={{ ...mono, margin: 0, fontSize: 11, color: TRIGGER_C[topTrigger.type] || '#5a6a5a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {topTrigger.type === 'intent' || topTrigger.type === 'engagement' ? '⚡ ' : '· '}
              {topTrigger.label}
              {topTrigger.ageInDays !== null && topTrigger.ageInDays !== undefined ? ` · ${fmtAge(topTrigger.ageInDays)}` : ''}
            </p>
          ) : <p style={{ ...mono, margin: 0, fontSize: 11, color: '#3a4a3a', fontStyle: 'italic' }}>no signal</p>}
        </div>

        {/* Touch action */}
        <div onClick={e => e.stopPropagation()}>
          <TouchButton state={state} onClick={() => { onOpenCompose?.(entry); }}/>
        </div>

        {/* Expand toggle */}
        <button
          onClick={e => { e.stopPropagation(); onToggleExpand?.(entry.id); }}
          title={isExpanded ? 'Collapse' : 'Expand'}
          style={{ ...mono, fontSize: 11, padding: '4px 7px', background: '#0a1410', border: '1px solid #1a3a1a', color: '#5a6a5a', borderRadius: 4, cursor: 'pointer' }}>
          {isExpanded ? '▲' : '▼'}
        </button>
      </div>

      {/* Expanded body */}
      {isExpanded && (
        <div style={{
          background: '#031007',
          border: '1px solid #2a4a2a',
          borderTop: 'none',
          borderLeft: `3px solid ${tierC}`,
          borderRadius: '0 0 6px 6px',
          padding: '14px 18px',
        }}>
          {/* ① Identity row */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, paddingBottom: 12, borderBottom: '1px solid #1a3a1a' }}>
            <div>
              <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: T.neon, textShadow: `0 0 8px ${T.neon}44` }}>{entry.name}</p>
              <p style={{ ...mono, margin: '3px 0 0', fontSize: 11, color: '#5a6a5a' }}>
                {tierKey && <span style={{ color: tierC, marginRight: 6 }}>{tierGlyph} {tierKey}</span>}
                {[acct.vert, loc, acct.size && `~${acct.size}`].filter(Boolean).join(' · ') || '—'}
              </p>
              {(entry.web || acct.web) && (
                <a href={(entry.web || acct.web).startsWith('http') ? (entry.web || acct.web) : `https://${entry.web || acct.web}`}
                  target="_blank" rel="noreferrer"
                  style={{ ...mono, fontSize: 11, color: T.cyan, textDecoration: 'none' }}>
                  {extractHunterDomain(entry.web || acct.web)}
                </a>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {canPromote && (
                <button onClick={() => promoteToAE(entry, { accounts, setAccounts, setFrontier, onCreateTask, activeUser })}
                  style={{ ...mono, fontSize: 11, padding: '6px 14px', background: `${T.amber}18`, border: `1px solid ${T.amber}`, color: T.amber, borderRadius: 4, cursor: 'pointer', letterSpacing: '0.04em', textShadow: `0 0 6px ${T.amber}66`, fontWeight: 500 }}>
                  Promote to AE →
                </button>
              )}
              {onUnassign && (
                <button onClick={() => onUnassign(entry.name)}
                  style={{ ...mono, fontSize: 10, padding: '4px 10px', background: 'transparent', border: `1px solid ${C.red}44`, color: `${C.red}AA`, borderRadius: 4, cursor: 'pointer' }}>
                  ✕ Unassign
                </button>
              )}
            </div>
          </div>

          {/* ② Contacts row */}
          <div style={{ padding: '12px 0', borderBottom: '1px solid #1a3a1a' }}>
            <p style={{ ...mono, margin: '0 0 8px', fontSize: 10, fontWeight: 600, color: '#5a6a5a', textTransform: 'uppercase', letterSpacing: '0.1em' }}>👤 Primary contact</p>
            {topContact ? (
              <div>
                <p style={{ margin: 0, fontSize: 13, color: '#cfe8d4' }}>
                  <strong style={{ fontWeight: 600 }}>{contactDisplayName(topContact)}</strong>
                  {topContact.position && <span style={{ color: '#7a8a7a' }}> · {topContact.position}</span>}
                </p>
                <p style={{ ...mono, margin: '2px 0 0', fontSize: 12, color: T.cyan }}>
                  {topContact.email}
                  {topContact.confidence !== undefined && <span style={{ color: '#5a6a5a', marginLeft: 8 }}>Hunter {topContact.confidence}%</span>}
                </p>
                {topContact.linkedin && (
                  <a href={topContact.linkedin} target="_blank" rel="noreferrer" style={{ ...mono, fontSize: 11, color: '#4A9AE8', textDecoration: 'none' }}>↗ LinkedIn</a>
                )}
              </div>
            ) : (
              <p style={{ ...mono, fontSize: 12, color: '#5a6a5a', margin: 0 }}>No contact enriched yet.</p>
            )}

            {alternates.length > 0 && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {alternates.map((alt, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                    <span style={{ ...mono, color: '#7a8a7a', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      alt: <span style={{ color: '#cfe8d4' }}>{contactDisplayName(alt)}</span>
                      {alt.position && <span> ({alt.position})</span>}
                      {alt.email && <span style={{ color: T.cyan, marginLeft: 6 }}>· {alt.email}</span>}
                      {alt.confidence !== undefined && <span style={{ color: '#5a6a5a', marginLeft: 6 }}>{alt.confidence}%</span>}
                    </span>
                    <button onClick={() => swapContact(alt)}
                      style={{ ...mono, fontSize: 10, padding: '3px 9px', background: 'transparent', border: '1px solid #2a4a2a', color: '#7a8a7a', borderRadius: 3, cursor: 'pointer' }}>
                      Use this contact
                    </button>
                  </div>
                ))}
              </div>
            )}

            {!topContact && (
              <div style={{ marginTop: 8 }}>
                <button onClick={findContacts} disabled={findingContacts}
                  style={{ ...mono, fontSize: 11, padding: '5px 12px', background: `${T.cyan}10`, border: `1px solid ${T.cyan}55`, color: T.cyan, borderRadius: 4, cursor: findingContacts ? 'wait' : 'pointer' }}>
                  {findingContacts ? '⟳ Searching Hunter…' : '🔍 Find contact'}
                </button>
                {findError && <span style={{ ...mono, fontSize: 11, color: C.red, marginLeft: 8 }}>✕ {findError}</span>}
              </div>
            )}
          </div>

          {/* ③ Triggers row */}
          <div style={{ padding: '12px 0', borderBottom: '1px solid #1a3a1a' }}>
            <p style={{ ...mono, margin: '0 0 8px', fontSize: 10, fontWeight: 600, color: '#5a6a5a', textTransform: 'uppercase', letterSpacing: '0.1em' }}>⚡ Triggers</p>
            {triggers.length === 0 ? (
              <p style={{ ...mono, fontSize: 12, color: '#5a6a5a', margin: 0, fontStyle: 'italic' }}>No signals yet — add one manually below.</p>
            ) : (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {triggers.map((t, i) => <TriggerChip key={i} trigger={t} draggable/>)}
              </div>
            )}
            {showAddTrigger ? (
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <input autoFocus value={manualTriggerDraft} onChange={e => setManualTriggerDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addManualTrigger(); if (e.key === 'Escape') { setShowAddTrigger(false); setManualTriggerDraft(''); } }}
                  placeholder="e.g. Saw Sarah speak at Money 20/20"
                  style={{ flex: 1, ...mono, fontSize: 12, padding: '5px 10px', background: '#0a1410', border: '1px solid #2a4a2a', borderRadius: 4, color: '#cfe8d4', outline: 'none' }}/>
                <button onClick={addManualTrigger} style={{ ...mono, fontSize: 11, padding: '5px 10px', background: `${T.neon}14`, border: `1px solid ${T.neon}55`, color: T.neon, borderRadius: 4, cursor: 'pointer' }}>Add</button>
                <button onClick={() => { setShowAddTrigger(false); setManualTriggerDraft(''); }} style={{ ...mono, fontSize: 11, padding: '5px 8px', background: 'transparent', border: '1px solid #2a4a2a', color: '#5a6a5a', borderRadius: 4, cursor: 'pointer' }}>✕</button>
              </div>
            ) : (
              <button onClick={() => setShowAddTrigger(true)} style={{ ...mono, fontSize: 11, marginTop: 8, padding: '3px 9px', background: 'transparent', border: '1px solid #2a4a2a', color: '#5a6a5a', borderRadius: 3, cursor: 'pointer' }}>+ Add trigger manually</button>
            )}
          </div>

          {/* ④ Cadence row */}
          <div style={{ padding: '12px 0', borderBottom: '1px solid #1a3a1a' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <p style={{ ...mono, margin: 0, fontSize: 10, fontWeight: 600, color: '#5a6a5a', textTransform: 'uppercase', letterSpacing: '0.1em' }}>📨 Cadence</p>
              <span style={{ ...mono, fontSize: 11, color: stateC, textShadow: `0 0 6px ${stateC}44` }}>{CADENCE_LABEL[state]}</span>
              {cadence.sequenceId && <span style={{ ...mono, fontSize: 11, color: '#5a6a5a' }}>· {cadence.sequenceId}</span>}
            </div>
            <div style={{ marginTop: 8 }}><CadencePips steps={cadence.steps} state={state}/></div>

            {(cadence.steps || []).length > 0 ? (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {[...cadence.steps].sort((a, b) => (b.sentAt || b.plannedAt || '').localeCompare(a.sentAt || a.plannedAt || '')).map((s, i) => {
                  const sent = !!s.sentAt;
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                      <span style={{ ...mono, fontSize: 11, color: '#5a6a5a', width: 56, flexShrink: 0 }}>{fmtDate(s.sentAt || s.plannedAt)}</span>
                      <span style={{ ...mono, fontSize: 12, color: sent ? '#cfe8d4' : '#7a8a7a', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.type === 'linkedin' ? '🔗' : s.type === 'call' ? '☎' : '✉'} {s.subject || s.type || '—'}
                      </span>
                      <span style={{ ...mono, fontSize: 11, color: sent ? T.neon : '#5a6a5a' }}>{sent ? '✓ sent' : '○ planned'}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p style={{ ...mono, fontSize: 12, color: '#5a6a5a', margin: '8px 0 0', fontStyle: 'italic' }}>No touches logged yet.</p>
            )}

            {showLogTouch ? (
              <div style={{ marginTop: 10, padding: '10px 12px', background: '#0a1410', border: '1px solid #2a4a2a', borderRadius: 5 }}>
                <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                  <select value={logDraft.type} onChange={e => setLogDraft(d => ({ ...d, type: e.target.value }))}
                    style={{ ...mono, fontSize: 11, padding: '4px 8px', background: '#020a06', border: '1px solid #2a4a2a', color: '#cfe8d4', borderRadius: 3, outline: 'none' }}>
                    <option value="email">✉ email</option>
                    <option value="linkedin">🔗 linkedin</option>
                    <option value="call">☎ call</option>
                  </select>
                  <input type="date" value={logDraft.date} onChange={e => setLogDraft(d => ({ ...d, date: e.target.value }))}
                    style={{ ...mono, fontSize: 11, padding: '4px 8px', background: '#020a06', border: '1px solid #2a4a2a', color: '#cfe8d4', borderRadius: 3, outline: 'none' }}/>
                </div>
                <input value={logDraft.subject} onChange={e => setLogDraft(d => ({ ...d, subject: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') logTouch(); if (e.key === 'Escape') setShowLogTouch(false); }}
                  placeholder="Subject / what happened" autoFocus
                  style={{ width: '100%', boxSizing: 'border-box', ...mono, fontSize: 12, padding: '6px 10px', background: '#020a06', border: '1px solid #2a4a2a', borderRadius: 3, color: '#cfe8d4', outline: 'none' }}/>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button onClick={logTouch} style={{ ...mono, fontSize: 11, padding: '5px 12px', background: `${T.neon}14`, border: `1px solid ${T.neon}55`, color: T.neon, borderRadius: 4, cursor: 'pointer' }}>Log</button>
                  <button onClick={() => setShowLogTouch(false)} style={{ ...mono, fontSize: 11, padding: '5px 9px', background: 'transparent', border: '1px solid #2a4a2a', color: '#5a6a5a', borderRadius: 4, cursor: 'pointer' }}>Cancel</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                <button onClick={() => setShowLogTouch(true)} style={{ ...mono, fontSize: 11, padding: '4px 11px', background: 'transparent', border: '1px solid #2a4a2a', color: '#7a8a7a', borderRadius: 4, cursor: 'pointer' }}>+ Log touch manually</button>
                {state === 'in_sequence' && (
                  <button onClick={() => updateCadence({ state: 'paused' })}
                    style={{ ...mono, fontSize: 11, padding: '4px 11px', background: 'transparent', border: `1px solid ${T.amber}44`, color: T.amber, borderRadius: 4, cursor: 'pointer' }}>Pause sequence</button>
                )}
              </div>
            )}
          </div>

          {/* ⑤ Notes */}
          <div style={{ padding: '12px 0', borderBottom: '1px solid #1a3a1a' }}>
            <p style={{ ...mono, margin: '0 0 8px', fontSize: 10, fontWeight: 600, color: '#5a6a5a', textTransform: 'uppercase', letterSpacing: '0.1em' }}>📝 Notes</p>
            {editingNotes ? (
              <div>
                <textarea value={notesDraft} onChange={e => setNotesDraft(e.target.value)} autoFocus rows={3}
                  onBlur={saveNotes}
                  onKeyDown={e => { if (e.key === 'Escape') { setEditingNotes(false); setNotesDraft(ob.notes || ''); } }}
                  style={{ width: '100%', boxSizing: 'border-box', ...mono, fontSize: 12, padding: '7px 10px', background: '#0a1410', border: '1px solid #2a4a2a', borderRadius: 4, color: '#cfe8d4', outline: 'none', resize: 'vertical', lineHeight: 1.5 }}/>
              </div>
            ) : (
              <p onClick={() => { setNotesDraft(ob.notes || ''); setEditingNotes(true); }}
                style={{ ...mono, margin: 0, fontSize: 12, color: ob.notes ? '#cfe8d4' : '#5a6a5a', fontStyle: ob.notes ? 'normal' : 'italic', cursor: 'text', lineHeight: 1.5 }}>
                {ob.notes || 'Click to add notes...'}
              </p>
            )}
          </div>

          {/* Action row */}
          <div style={{ display: 'flex', gap: 8, paddingTop: 12, flexWrap: 'wrap' }}>
            <button onClick={() => onOpenCompose?.(entry)}
              style={{ ...mono, fontSize: 12, padding: '7px 14px', background: `${T.neon}14`, border: `1px solid ${T.neon}66`, color: T.neon, borderRadius: 5, cursor: 'pointer', letterSpacing: '0.04em', textShadow: `0 0 6px ${T.neon}44`, fontWeight: 500 }}>
              ✉ Compose next touch
            </button>
            <button onClick={findContacts} disabled={findingContacts}
              style={{ ...mono, fontSize: 12, padding: '7px 12px', background: 'transparent', border: `1px solid ${T.cyan}44`, color: T.cyan, borderRadius: 5, cursor: findingContacts ? 'wait' : 'pointer' }}>
              {findingContacts ? '⟳ Searching…' : '🔍 Refind contact'}
            </button>
            <button onClick={() => onToggleExpand?.(entry.id)}
              style={{ ...mono, fontSize: 12, padding: '7px 12px', background: 'transparent', border: '1px solid #2a4a2a', color: '#7a8a7a', borderRadius: 5, cursor: 'pointer', marginLeft: 'auto' }}>
              ✕ Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
