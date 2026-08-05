import React from 'react';
import { C, mono } from '../constants/colors';
import { GONG_MAX } from '../utils/dealIntel';

export default function AccountCardCallHistory({ acc, expandedCallIds, setExpandedCallIds, copiedCallId, setCopiedCallId, onUpdate, activeUser = {}, onRelaunchFollowUp }) {
  const calls = acc.calls || [];
  // helpers
  const nsGetText = ns => typeof ns === 'string' ? ns : (ns?.text || '');
  const nsGetDue = ns => typeof ns === 'object' ? ns?.dueDate : null;
  const nsGetOwner = ns => typeof ns === 'object' ? ns?.owner : null;
  const fmtDue = d => { if (!d) return ''; const dt = new Date(d + 'T12:00:00'); return `${dt.getMonth() + 1}/${dt.getDate()}`; };
  const fmtDueWithYear = d => { if (!d) return ''; const dt = new Date(d + 'T12:00:00'); return `${dt.getMonth() + 1}/${dt.getDate()}/${dt.getFullYear()}`; };
  const aeInitials = (activeUser.name || '').split(' ').filter(Boolean).map(w => w[0].toUpperCase()).join('');
  const todayFmt = (() => { const t = new Date(); return `${t.getMonth() + 1}/${t.getDate()}/${t.getFullYear()}`; })();

  return (
    <div style={{ marginBottom: 12 }}>
      {/* Call Log */}
      {calls.length > 0 && (
        <div>
          <p style={{ ...mono, margin: '0 0 6px', fontSize: 9, fontWeight: 700, color: '#333', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Call Log</p>
          {[...calls].reverse().map(call => {
            const qc = call.callQuality === 'Strong' ? C.green : call.callQuality === 'Weak' ? C.red : C.orange;
            const isExp = expandedCallIds.has(call.id);
            // SFDC copy — format: earliest due | call date + summary | timeline bullets | NS lines | today
            const prospectFirstName = (call.contact?.name || '').split(' ')[0] || '';
            const sfNsItems = [...(call.nextSteps || [])].sort((a, b) => (nsGetDue(a) || '').localeCompare(nsGetDue(b) || ''));
            const sfEarliestDue = sfNsItems.length ? fmtDueWithYear(nsGetDue(sfNsItems[0])) : '';
            const sfCallFmt = fmtDue(call.date);
            const sfSummary = call.summary || '';
            const sfTimelineLines = call.timeline
              ? call.timeline.split('\n').map(m => m.trim()).filter(Boolean).map(m => `- ${m}`).join('\n')
              : '';
            const sfNsLines = sfNsItems.map(ns => {
              const fmt = fmtDue(nsGetDue(ns));
              const txt = nsGetText(ns);
              const owner = nsGetOwner(ns);
              const who = (owner === 'prospect' && prospectFirstName) ? `${aeInitials} ${prospectFirstName}` : aeInitials;
              return `NS - ${fmt || '?'} ${who} to ${txt}`;
            }).join('\n');
            const sfBodyParts = [];
            if (sfCallFmt || sfSummary) sfBodyParts.push(`${sfCallFmt} - ${sfSummary}`);
            if (sfTimelineLines) sfBodyParts.push(sfTimelineLines);
            if (sfNsLines) sfBodyParts.push(sfNsLines);
            const sfText = [sfEarliestDue, '', ...sfBodyParts, '', todayFmt].join('\n');
            const isCopied = copiedCallId === call.id;
            return (
              <div key={call.id} style={{ marginBottom: 4 }}>
                <div onClick={() => setExpandedCallIds(s => { const n = new Set(s); n.has(call.id) ? n.delete(call.id) : n.add(call.id); return n; })}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 10px', background: C.card, border: `1px solid ${C.brd}`, borderRadius: isExp ? '6px 6px 0 0' : 6, cursor: 'pointer', userSelect: 'none' }}>
                  <span style={{ ...mono, fontSize: 11, color: C.dim, flexShrink: 0 }}>{call.date}</span>
                  <span style={{ ...mono, fontSize: 10, padding: '1px 6px', background: `${qc}14`, border: `1px solid ${qc}33`, color: qc, borderRadius: 3, flexShrink: 0 }}>{call.callQuality || 'Neutral'}</span>
                  {call.totalScore != null && <span style={{ ...mono, fontSize: 10, color: C.mut, flexShrink: 0 }}>Gong: {call.totalScore}/{GONG_MAX}</span>}
                  {call.decisionMaker && <span style={{ ...mono, fontSize: 10, color: '#00b4d8', flexShrink: 0 }}>DM: {call.decisionMaker}</span>}
                  <span style={{ flex: 1 }} />
                  {onRelaunchFollowUp && (
                    <button onClick={e => { e.stopPropagation(); onRelaunchFollowUp(call); }}
                      style={{ ...mono, fontSize: 10, padding: '2px 8px', background: '#f59e0b10', border: '1px solid #f59e0b44', color: '#f59e0b', borderRadius: 3, cursor: 'pointer', flexShrink: 0 }}>
                      ↻ Follow-up
                    </button>
                  )}
                  <button onClick={e => { e.stopPropagation(); onUpdate && onUpdate({ ...acc, calls: (acc.calls || []).filter(c => c.id !== call.id) }); }} style={{ background: 'transparent', border: 'none', color: C.dim, fontSize: 11, cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}>✕</button>
                  <span style={{ ...mono, fontSize: 10, color: C.dim, flexShrink: 0 }}>{isExp ? '▲' : '▼'}</span>
                </div>
                {isExp && (
                  <div style={{ padding: '10px 12px', background: '#0a0a0a', border: `1px solid ${C.brd}`, borderTop: 'none', borderRadius: '0 0 6px 6px' }}>
                    {/* Summary */}
                    {call.summary && <p style={{ ...mono, margin: '0 0 10px', fontSize: 13, color: '#c8c8c0', lineHeight: 1.6 }}>{call.summary}</p>}
                    {/* Highlights pills */}
                    {(() => {
                      const pills = [];
                      if ((call.painPoints || []).length > 0)      pills.push({ label: 'Pain identified',   color: '#f59e0b' });
                      if ((call.blockers || []).length > 0)         pills.push({ label: 'Blockers surfaced', color: '#f87171' });
                      if ((call.nextSteps || []).length > 0)        pills.push({ label: `${call.nextSteps.length} next step${call.nextSteps.length > 1 ? 's' : ''}`, color: '#00b4d8' });
                      if ((call.productsDiscussed || []).length > 0) pills.push({ label: 'Products scoped', color: '#c084fc' });
                      if ((call.totalScore ?? 0) >= 35)             pills.push({ label: 'Strong call',      color: '#4ade80' });
                      if (pills.length === 0) return null;
                      return (
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
                          {pills.slice(0, 3).map((p, i) => (
                            <span key={i} style={{ ...mono, fontSize: 10, color: p.color, background: `${p.color}14`, border: `1px solid ${p.color}33`, borderRadius: 3, padding: '2px 7px' }}>{p.label}</span>
                          ))}
                        </div>
                      );
                    })()}
                    {/* Next steps */}
                    {(call.nextSteps || []).length > 0 && (() => {
                      const sorted = [...call.nextSteps].sort((a, b) => (nsGetDue(a) || '').localeCompare(nsGetDue(b) || ''));
                      const show = sorted.slice(0, 4);
                      const extra = sorted.length - show.length;
                      return (
                        <div style={{ marginBottom: 10 }}>
                          <span style={{ ...mono, fontSize: 9, fontWeight: 700, color: '#333', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 5 }}>Next Steps</span>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                            {show.map((ns, i) => {
                              const txt = nsGetText(ns); const due = nsGetDue(ns); const owner = nsGetOwner(ns);
                              return (
                                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, padding: '4px 0', borderBottom: i < show.length - 1 ? '0.5px solid #111' : 'none' }}>
                                  <span style={{ ...mono, fontSize: 11, color: '#444', flexShrink: 0, paddingTop: 1, minWidth: 28 }}>{fmtDue(due) || '—'}</span>
                                  {owner && <span style={{ ...mono, fontSize: 11, color: '#555', flexShrink: 0, paddingTop: 1 }}>{owner} —</span>}
                                  <span style={{ ...mono, fontSize: 12, color: '#00b4d8', lineHeight: 1.5 }}>{txt}</span>
                                </div>
                              );
                            })}
                            {extra > 0 && <span style={{ ...mono, fontSize: 10, color: C.dim, paddingTop: 4 }}>+{extra} more</span>}
                          </div>
                        </div>
                      );
                    })()}
                    {/* Copy to Salesforce */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button onClick={() => { navigator.clipboard.writeText(sfText); setCopiedCallId(call.id); setTimeout(() => setCopiedCallId(null), 1400); }}
                        style={{ ...mono, fontSize: 10, padding: '2px 9px', background: isCopied ? `${C.green}18` : `${C.blue}10`, border: `1px solid ${isCopied ? C.green : C.blue + '44'}`, color: isCopied ? C.green : C.blue, borderRadius: 3, cursor: 'pointer', transition: 'all 0.15s' }}>
                        {isCopied ? '✓ Copied' : '⎘ Copy to Salesforce'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {calls.length === 0 && <p style={{ ...mono, fontSize: 12, color: C.dim }}>No calls logged yet.</p>}
    </div>
  );
}
