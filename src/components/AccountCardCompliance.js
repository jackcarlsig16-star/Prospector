import React, { useState } from 'react';
import { mono } from '../constants/colors';
import { T } from '../constants/tokens';
import { syncComplianceFromSFDC } from '../utils/sfdcSync';
import { STANDARD_STEPS, PARTNER_STEPS, STEP_STATUSES, getCompliance, saveCompliance } from '../utils/storage';

// HUD alias — tokens with this file's local labels
const HUD = {
  neon:   T.neon,
  amber:  T.amber,
  red:    T.red,
  cyan:   T.cyan,
  dim:    '#444',
  mut:    '#5a6a5a',
  txt:    '#cfe8d4',
  bg:     T.bg.base,
  panel:  T.bg.surface,
  bdr:    '#1a3a1a',
};

// Map step.status → node visual state
const nodeStateFor = (status) => {
  if (status === 'Approved')          return { glyph: '●', color: HUD.neon,  fill: 'solid', pulse: false, glow: true  };
  if (status === 'Blocked')           return { glyph: '✕', color: HUD.red,   fill: 'solid', pulse: false, glow: true  };
  if (status === 'Submitted' ||
      status === 'In Progress')       return { glyph: '◐', color: HUD.amber, fill: 'half',  pulse: true,  glow: false };
  return                                       { glyph: '○', color: HUD.dim,   fill: 'empty', pulse: false, glow: false };
};

const STATUS_C = {
  'Not Started': HUD.dim,
  'In Progress': HUD.amber,
  'Submitted':   HUD.amber,
  'Approved':    HUD.neon,
  'Blocked':     HUD.red,
};

export function DealComplianceTracker({ accId, accName, acc, tasks=[], onUpdateTask, onUpdateAcc }) {
  const defaultData = (type) => {
    const steps = type === 'partner' ? PARTNER_STEPS : STANDARD_STEPS;
    return { type, steps: steps.map(s => ({ id: s.id, status: 'Not Started', days: 0, notes: '', startedAt: null, completedAt: null })) };
  };

  const reconcile = (stored) => {
    const stepDefs = stored.type === 'partner' ? PARTNER_STEPS : STANDARD_STEPS;
    const storedById = {};
    (stored.steps || []).forEach(s => { storedById[s.id] = s; });
    return {
      ...stored,
      steps: stepDefs.map(s => storedById[s.id] || { id: s.id, status: 'Not Started', days: 0, notes: '', startedAt: null, completedAt: null }),
    };
  };

  const [data, setData] = useState(() => {
    const stored = getCompliance(accId);
    return stored ? reconcile(stored) : defaultData('standard');
  });
  const [expanded, setExpanded] = useState(false);
  const [syncState, setSyncState] = useState(null);
  const [syncMsg,   setSyncMsg]   = useState('');
  const [nudgedStepId, setNudgedStepId] = useState(null);
  const [autoCompleteToast, setAutoCompleteToast] = useState(null);
  const [emailCopied, setEmailCopied] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(false);
  const [templateDraft, setTemplateDraft] = useState('');
  const [chatterOpen, setChatterOpen] = useState(false);
  const [chatterText, setChatterText] = useState('');
  const [chatterCopied, setChatterCopied] = useState(false);
  const [clientIdEdit, setClientIdEdit] = useState(false);
  const [clientIdDraft, setClientIdDraft] = useState('');
  const [blockerEditing, setBlockerEditing] = useState(null); // step.id when blocker input is open

  const steps = data.type === 'partner' ? PARTNER_STEPS : STANDARD_STEPS;
  const updateAndSave = (next) => { setData(next); saveCompliance(accId, next); };
  const setType = (t) => { if (data.type !== t) updateAndSave(defaultData(t)); };

  const PR_TASK_MATCH = t =>
    t.accId === accId && t.status !== 'Done' && (
      (t.title || '').toLowerCase().includes('production request') ||
      (t.title || '').toLowerCase().includes('security review') ||
      (t.title || '').toLowerCase().includes('security questionnaire') ||
      (t.type || '').toLowerCase() === 'salesforce'
    );

  const setStepField = (stepId, field, value) => {
    const apply = (s) => {
      const u = { ...s, [field]: value };
      if (field === 'status') {
        if (value !== 'Not Started' && !s.startedAt)       u.startedAt = new Date().toISOString();
        if (value === 'Approved' && !s.completedAt)         u.completedAt = new Date().toISOString();
        if (value === 'Not Started') { u.startedAt = null; u.completedAt = null; }
      }
      return u;
    };
    const found = data.steps.some(s => s.id === stepId);
    const newSteps = found
      ? data.steps.map(s => s.id !== stepId ? s : apply(s))
      : [...data.steps, apply({ id: stepId, status: 'Not Started', notes: '', startedAt: null, completedAt: null })];
    updateAndSave({ ...data, steps: newSteps });

    if (field === 'status' && value === 'Approved' && onUpdateTask) {
      const linked = (tasks || []).find(PR_TASK_MATCH);
      if (linked) {
        onUpdateTask(linked.id, { status: 'Done', completedAt: new Date().toISOString() });
        setAutoCompleteToast(accName);
        setTimeout(() => setAutoCompleteToast(null), 3500);
      }
    }
  };

  const PR_EMAIL_KEY = 'prospector_pr_email_template';
  const DEFAULT_PR_TEMPLATE = `Subject: Next Step: Submit Your Production Request\n\nHi [First Name],\n\nThanks for creating your dashboard account — you're one step closer to going live!\n\nThe next step is to submit your Production Request, which kicks off the due diligence review. This is a straightforward process, but I'm happy to walk you through it if it would be helpful.\n\nJust reply to this email and we can find a time, or I can send over a quick guide.`;
  const getTemplate = () => localStorage.getItem(PR_EMAIL_KEY) || DEFAULT_PR_TEMPLATE;

  const copyPrEmail = (e) => {
    e.stopPropagation();
    const firstName = (acc?.personas || [])[0]?.name?.split(' ')[0] || '';
    const text = getTemplate().replace(/\[First Name\]/g, firstName || '[First Name]');
    navigator.clipboard.writeText(text);
    setEmailCopied(true);
    setTimeout(() => setEmailCopied(false), 2000);
  };

  const openChatter = (e) => {
    e.stopPropagation();
    const user = (() => { try { return JSON.parse(localStorage.getItem('prospector_user') || '{}'); } catch { return {}; } })();
    const prods = [...new Set((acc?.calls || []).flatMap(c => (c.productsDiscussed || []).map(p => typeof p === 'string' ? p : p?.product)).filter(Boolean))].join(', ') || 'N/A';
    const sqStatus = data.steps.find(s => s.id === 'security_q')?.status || 'Not Started';
    setChatterText([
      `🚀 PR Review — ${acc?.name || accName}`,
      `SFDC: ${acc?.sfdcLink || 'N/A'}`,
      `Website: ${acc?.website || 'N/A'}`,
      `Products: ${prods}`,
      `Use Case: ${acc?.ucs || 'N/A'}`,
      `Business Model: ${acc?.bm || 'N/A'}`,
      `Security Q: ${sqStatus}`,
      `Timing: ${acc?.medpicc?.timeline || 'N/A'}`,
      `AE: ${user?.name || 'N/A'}`,
    ].join('\n'));
    setChatterOpen(true);
  };

  const sendNudge = async (step) => {
    const contactFirst = (acc?.personas || [])[0]?.name?.split(' ')[0] || '';
    const subject = `Re: ${accName} — ${step.label} Update`;
    const body = `Hi${contactFirst ? ` ${contactFirst}` : ''},\n\nJust checking in on the status of your ${step.label} — happy to help if there are any blockers on your end. Let me know!\n\nBest,\nJack`;
    const token = localStorage.getItem('gmail_access_token');
    let drafted = false;
    if (token) {
      try {
        const raw = btoa(unescape(encodeURIComponent(
          `Subject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
        ))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: { raw } }),
        });
        if (r.ok) drafted = true;
      } catch {}
    }
    if (!drafted) navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
    setNudgedStepId(step.id);
    setTimeout(() => setNudgedStepId(null), 2000);
  };

  const handleSync = async () => {
    setSyncState('loading'); setSyncMsg('');
    const result = await syncComplianceFromSFDC(acc, data, updateAndSave);
    setSyncState(result.status);
    if (result.status === 'error') setSyncMsg(result.message || 'Unknown error');
    if (result.status === 'ok') setTimeout(() => setSyncState(null), 2000);
  };

  const done    = data.steps.filter(s => s.status === 'Approved').length;
  const total   = steps.length;
  const blocked = data.steps.some(s => s.status === 'Blocked');
  const showSync = (acc?.clientIds || []).length > 0 && !!localStorage.getItem('sfdc_access_token');

  // ── PIPELINE NODE + LINK ───────────────────────────────────────────────────
  const Node = ({ status, label, isLast }) => {
    const ns = nodeStateFor(status);
    const ringStyle = {
      width: 18, height: 18, borderRadius: '50%',
      border: `1.5px solid ${ns.color}`,
      background: ns.fill === 'solid' ? ns.color : ns.fill === 'half' ? `linear-gradient(90deg, ${ns.color} 50%, transparent 50%)` : 'transparent',
      boxShadow: ns.glow ? `0 0 8px ${ns.color}99` : 'none',
      flexShrink: 0,
      animation: ns.pulse ? 'pipelinePulse 2s ease-in-out infinite' : 'none',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    };
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        <div style={ringStyle} title={`${label}: ${status}`}/>
        <span style={{ ...mono, fontSize: 9, color: ns.color, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
          {label}
        </span>
      </div>
    );
  };

  const Link = ({ leftDone }) => (
    <div style={{
      flex: 1, height: 2, minWidth: 24,
      background: leftDone
        ? HUD.neon
        : `repeating-linear-gradient(90deg, #333 0 5px, transparent 5px 9px)`,
      marginTop: -22, // align with node center (node is 18 tall, label below)
    }}/>
  );

  return (
    <div style={{ marginTop: 12, padding: '10px 14px', background: HUD.bg, border: `1px solid ${HUD.bdr}`, borderRadius: 7 }}>
      <style>{`@keyframes pipelinePulse{0%,100%{opacity:1}50%{opacity:0.5}}`}</style>

      {/* Auto-complete toast */}
      {autoCompleteToast && (
        <div style={{ ...mono, fontSize: 10, color: HUD.neon, background: `${HUD.neon}0d`, border: `1px solid ${HUD.neon}33`, borderRadius: 4, padding: '5px 10px', marginBottom: 8 }}>
          ✓ Task auto-completed — {autoCompleteToast} production request approved
        </div>
      )}

      {/* ── Collapsed pipeline row ───────────────────────────────────────── */}
      <div onClick={(e) => { e.stopPropagation(); setExpanded(o => !o); }}
        style={{ display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer', userSelect: 'none' }}>

        {/* Track toggle */}
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          {[['standard', 'Standard'], ['partner', 'Partner']].map(([val, lb]) => {
            const on = data.type === val;
            const accent = val === 'partner' ? '#A855F7' : HUD.neon;
            return (
              <button key={val} onClick={() => setType(val)}
                style={{ ...mono, fontSize: 9, padding: '2px 8px', borderRadius: 3,
                  background: on ? `${accent}14` : 'transparent',
                  border: `1px solid ${on ? accent : '#333'}`,
                  color: on ? accent : '#666',
                  cursor: 'pointer', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                {lb}
              </button>
            );
          })}
        </div>

        {/* Pipeline */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', gap: 0, padding: '4px 0' }}>
          {steps.map((step, i) => {
            const sd = data.steps.find(s => s.id === step.id) || { status: 'Not Started' };
            const isLast = i === steps.length - 1;
            const leftStatus = i === 0 ? 'Approved' : (data.steps.find(s => s.id === steps[i - 1].id)?.status);
            return (
              <React.Fragment key={step.id}>
                {i > 0 && <Link leftDone={leftStatus === 'Approved'}/>}
                <Node status={sd.status} label={step.short || step.label} isLast={isLast}/>
              </React.Fragment>
            );
          })}
        </div>

        {/* Completion + sync + chevron */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          {showSync && (
            <button onClick={handleSync} disabled={syncState === 'loading'}
              style={{ ...mono, fontSize: 9, padding: '2px 7px', background: syncState === 'ok' ? `${HUD.neon}14` : 'transparent', border: `1px solid ${syncState === 'ok' ? HUD.neon : syncState === 'error' ? HUD.red : `${HUD.cyan}44`}`, color: syncState === 'ok' ? HUD.neon : syncState === 'error' ? HUD.red : HUD.cyan, borderRadius: 3, cursor: syncState === 'loading' ? 'default' : 'pointer' }}>
              {syncState === 'loading' ? 'Syncing…' : syncState === 'ok' ? '✓ SF' : syncState === 'error' ? `⚠` : '↻ SF'}
            </button>
          )}
          <span style={{ ...mono, fontSize: 11, color: blocked ? HUD.red : done === total ? HUD.neon : HUD.mut, letterSpacing: '0.04em' }}>
            {done}/{total}
          </span>
          <span style={{ ...mono, fontSize: 10, color: HUD.mut, cursor: 'pointer' }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* ── Expanded step rows ───────────────────────────────────────────── */}
      <div style={{ maxHeight: expanded ? 1000 : 0, overflow: 'hidden', transition: 'max-height 0.2s ease-out' }}>
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${HUD.bdr}`, display: 'flex', flexDirection: 'column', gap: 6 }} onClick={e => e.stopPropagation()}>
          {steps.map(step => {
            const sd  = data.steps.find(s => s.id === step.id) || { status: 'Not Started', notes: '' };
            const ns  = nodeStateFor(sd.status);
            const sc  = STATUS_C[sd.status] || HUD.dim;
            const isBlocked = sd.status === 'Blocked';
            const isNudged  = nudgedStepId === step.id;
            const isPR      = step.id === 'prod_request';
            const showBlockerInput = isBlocked || blockerEditing === step.id;

            return (
              <div key={step.id} style={{ borderLeft: isBlocked ? `2px solid ${HUD.red}` : '2px solid transparent', paddingLeft: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ ...mono, fontSize: 14, color: ns.color, width: 16, flexShrink: 0, textAlign: 'center' }}>{ns.glyph}</span>
                  <span style={{ ...mono, fontSize: 11, color: sc, textTransform: 'uppercase', letterSpacing: '0.06em', flex: 1, minWidth: 0, textDecoration: sd.status === 'Approved' ? 'line-through' : undefined, opacity: sd.status === 'Approved' ? 0.7 : 1 }}>
                    {step.label}
                  </span>
                  {sd.completedAt && <span style={{ ...mono, fontSize: 9, color: HUD.mut, flexShrink: 0 }}>{new Date(sd.completedAt).toLocaleDateString([], { month: 'numeric', day: 'numeric' })}</span>}
                  <select value={sd.status} onChange={e => setStepField(step.id, 'status', e.target.value)}
                    style={{ ...mono, fontSize: 10, padding: '2px 5px', background: HUD.bg, border: `1px solid ${sc}66`, borderRadius: 3, color: sc, outline: 'none', cursor: 'pointer', flexShrink: 0 }}>
                    {STEP_STATUSES.map(st => <option key={st} value={st}>{st}</option>)}
                  </select>
                  <button onClick={() => sendNudge(step)} disabled={sd.status === 'Approved'}
                    onMouseEnter={e => { if (sd.status !== 'Approved') { e.currentTarget.style.color = HUD.neon; e.currentTarget.style.borderColor = HUD.neon; } }}
                    onMouseLeave={e => { if (sd.status !== 'Approved' && !isNudged) { e.currentTarget.style.color = HUD.mut; e.currentTarget.style.borderColor = '#333'; } }}
                    style={{ ...mono, fontSize: 10, padding: '2px 9px', background: isNudged ? `${HUD.neon}14` : 'transparent', border: `1px solid ${isNudged ? HUD.neon : '#333'}`, color: isNudged ? HUD.neon : HUD.mut, borderRadius: 3, cursor: sd.status === 'Approved' ? 'default' : 'pointer', flexShrink: 0, opacity: sd.status === 'Approved' ? 0.4 : 1, letterSpacing: '0.04em', transition: 'all 0.12s' }}>
                    {isNudged ? '✓ Sent' : '→ Nudge'}
                  </button>
                </div>

                {/* Blocker input — only when status is Blocked */}
                {showBlockerInput && (
                  <div style={{ marginTop: 6, marginLeft: 24, display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ ...mono, fontSize: 10, color: HUD.red }}>Blocker:</span>
                    <input
                      autoFocus
                      value={sd.notes || ''}
                      onChange={e => setStepField(step.id, 'notes', e.target.value)}
                      onBlur={() => setBlockerEditing(null)}
                      placeholder="What's blocking this step?"
                      style={{ ...mono, flex: 1, fontSize: 11, padding: '3px 7px', background: HUD.bg, border: `1px solid ${HUD.red}44`, borderRadius: 3, color: HUD.txt, outline: 'none' }}
                    />
                  </div>
                )}

                {/* PR-only actions: Copy intro email + Chatter msg */}
                {isPR && (
                  <div style={{ marginTop: 6, marginLeft: 24, display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button onClick={copyPrEmail}
                      style={{ ...mono, fontSize: 9, padding: '2px 8px', background: emailCopied ? `${HUD.neon}14` : 'transparent', border: `1px solid ${emailCopied ? HUD.neon : '#333'}`, color: emailCopied ? HUD.neon : HUD.mut, borderRadius: 3, cursor: 'pointer', whiteSpace: 'nowrap', letterSpacing: '0.04em' }}>
                      {emailCopied ? '✓ Copied' : '📋 Copy intro email'}
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); setTemplateDraft(getTemplate()); setEditingTemplate(true); }}
                      style={{ ...mono, fontSize: 9, padding: '2px 6px', background: 'transparent', border: '1px solid #333', color: HUD.mut, borderRadius: 3, cursor: 'pointer' }} title="Edit template">✏</button>
                    <button onClick={openChatter}
                      style={{ ...mono, fontSize: 9, padding: '2px 8px', background: 'transparent', border: `1px solid ${HUD.cyan}55`, color: HUD.cyan, borderRadius: 3, cursor: 'pointer', whiteSpace: 'nowrap', letterSpacing: '0.04em' }}>
                      💬 Chatter msg
                    </button>
                  </div>
                )}

                {editingTemplate && isPR && (
                  <div style={{ marginTop: 6, marginLeft: 24, display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 8px', background: HUD.panel, border: `1px solid ${HUD.bdr}`, borderRadius: 4 }}>
                    <textarea value={templateDraft} onChange={e => setTemplateDraft(e.target.value)} rows={8}
                      style={{ ...mono, fontSize: 10, background: HUD.bg, border: `1px solid ${HUD.bdr}`, borderRadius: 3, color: HUD.txt, padding: '5px 7px', resize: 'vertical', outline: 'none', width: '100%', boxSizing: 'border-box' }}/>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => { localStorage.setItem(PR_EMAIL_KEY, templateDraft); setEditingTemplate(false); }}
                        style={{ ...mono, fontSize: 9, padding: '2px 10px', background: `${HUD.neon}14`, border: `1px solid ${HUD.neon}55`, color: HUD.neon, borderRadius: 3, cursor: 'pointer' }}>Save</button>
                      <button onClick={() => setEditingTemplate(false)}
                        style={{ ...mono, fontSize: 9, padding: '2px 8px', background: 'transparent', border: '1px solid #333', color: HUD.mut, borderRadius: 3, cursor: 'pointer' }}>Cancel</button>
                      <button onClick={() => setTemplateDraft(DEFAULT_PR_TEMPLATE)}
                        style={{ ...mono, fontSize: 9, padding: '2px 8px', background: 'transparent', border: '1px solid #333', color: HUD.mut, borderRadius: 3, cursor: 'pointer' }}>Reset</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* SFDC sync extras: Wadsworth link + Products from SF */}
          {data.wadsworthLink && (
            <a href={data.wadsworthLink} target="_blank" rel="noreferrer" style={{ ...mono, fontSize: 10, color: HUD.cyan, textDecoration: 'none', marginTop: 4, display: 'inline-block', padding: '2px 0' }}>🔗 Client Tracker ↗</a>
          )}
          {(data.productsApproved || data.productsInReview || data.productsRFI || data.productsRejected) && (
            <div style={{ marginTop: 4, padding: '6px 10px', background: HUD.panel, border: `1px solid ${HUD.bdr}`, borderRadius: 4 }}>
              <span style={{ ...mono, fontSize: 9, fontWeight: 600, color: HUD.mut, textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 3 }}>Products from SF</span>
              {data.productsApproved && <p style={{ ...mono, fontSize: 11, color: HUD.neon,  margin: '2px 0' }}>✓ Approved: {data.productsApproved}</p>}
              {data.productsInReview && <p style={{ ...mono, fontSize: 11, color: HUD.amber, margin: '2px 0' }}>◐ In Review: {data.productsInReview}</p>}
              {data.productsRFI      && <p style={{ ...mono, fontSize: 11, color: HUD.amber, margin: '2px 0' }}>⚠ RFI: {data.productsRFI}</p>}
              {data.productsRejected && <p style={{ ...mono, fontSize: 11, color: HUD.red,   margin: '2px 0' }}>✕ Rejected: {data.productsRejected}</p>}
            </div>
          )}

          {/* Client ID row */}
          {(() => {
            const ids = acc?.clientIds || [];
            const hasIds = ids.length > 0;
            if (clientIdEdit) {
              return (
                <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ ...mono, fontSize: 10, color: HUD.cyan, letterSpacing: '0.06em' }}>CLIENT ID</span>
                  <input autoFocus value={clientIdDraft} onChange={e => setClientIdDraft(e.target.value)}
                    placeholder="a_xxx, a_yyy…"
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        const arr = clientIdDraft.split(',').map(s => s.trim()).filter(Boolean);
                        if (onUpdateAcc) onUpdateAcc({ ...acc, clientIds: arr });
                        setClientIdEdit(false);
                      }
                      if (e.key === 'Escape') setClientIdEdit(false);
                    }}
                    style={{ ...mono, flex: 1, fontSize: 11, padding: '3px 7px', background: HUD.bg, border: `1px solid ${HUD.cyan}55`, borderRadius: 3, color: HUD.txt, outline: 'none' }}/>
                  <button onClick={() => setClientIdEdit(false)} style={{ ...mono, fontSize: 9, padding: '2px 7px', background: 'transparent', border: '1px solid #333', color: HUD.mut, borderRadius: 3, cursor: 'pointer' }}>✕</button>
                </div>
              );
            }
            return (
              <div onClick={() => { if (onUpdateAcc) { setClientIdDraft(ids.join(', ')); setClientIdEdit(true); } }}
                style={{ marginTop: 6, padding: '6px 10px', background: HUD.panel, border: `1px solid ${hasIds ? HUD.neon + '33' : HUD.amber + '55'}`, borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6, cursor: onUpdateAcc ? 'pointer' : 'default' }}>
                <span style={{ ...mono, fontSize: 10, color: hasIds ? HUD.neon : HUD.amber, letterSpacing: '0.06em', flex: 1 }}>
                  CLIENT ID — {hasIds ? ids.join(', ') : '△ not set'}
                </span>
                {hasIds && (
                  <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(ids.join(', ')); }}
                    style={{ ...mono, fontSize: 9, padding: '2px 7px', background: 'transparent', border: `1px solid ${HUD.cyan}44`, color: HUD.cyan, borderRadius: 3, cursor: 'pointer' }}>📋</button>
                )}
              </div>
            );
          })()}
        </div>
      </div>

      {/* Chatter modal */}
      {chatterOpen && (
        <div onClick={() => { setChatterOpen(false); setChatterCopied(false); }}
          style={{ position: 'fixed', inset: 0, zIndex: 1200, background: '#00000099', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#07101a', border: '1px solid #1e2a3a', borderRadius: 10, width: 480, maxWidth: '100%', boxShadow: '0 24px 64px #000f', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #1e2a3a' }}>
              <span style={{ ...mono, fontSize: 12, fontWeight: 700, color: HUD.cyan }}>💬 Chatter Message</span>
              <button onClick={() => { setChatterOpen(false); setChatterCopied(false); }} style={{ background: 'transparent', border: 'none', color: '#555', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>✕</button>
            </div>
            <textarea value={chatterText} onChange={e => setChatterText(e.target.value)} rows={10}
              style={{ ...mono, fontSize: 12, background: '#0a0a0a', border: 'none', borderBottom: '1px solid #1e2a3a', color: '#e0e0e0', padding: '12px 16px', resize: 'vertical', outline: 'none', lineHeight: 1.6, borderRadius: 0 }}/>
            <div style={{ padding: '10px 16px', display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => { navigator.clipboard.writeText(chatterText); setChatterCopied(true); setTimeout(() => setChatterCopied(false), 1800); }}
                style={{ ...mono, fontSize: 11, padding: '5px 16px', background: chatterCopied ? `${HUD.neon}14` : '#0a1020', border: `1px solid ${chatterCopied ? HUD.neon : HUD.cyan + '44'}`, color: chatterCopied ? HUD.neon : HUD.cyan, borderRadius: 4, cursor: 'pointer' }}>
                {chatterCopied ? '✓ Copied!' : '📋 Copy'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ComplianceMiniBar({ accId }) {
  const data = getCompliance(accId);
  if (!data) return null;
  const steps = data.type === 'partner' ? PARTNER_STEPS : STANDARD_STEPS;
  const currentIdx = data.steps.findIndex(s => s.status !== 'Approved');
  const allDone = currentIdx === -1;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
      <style>{`@keyframes compliance_pulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
      {steps.map((step, i) => {
        const sd = data.steps.find(s => s.id === step.id) || { status: 'Not Started' };
        const isApproved = sd.status === 'Approved';
        const isBlocked  = sd.status === 'Blocked';
        const isCurrent  = i === currentIdx;
        let bg = HUD.dim;
        if (isApproved)      bg = HUD.neon;
        else if (isBlocked)  bg = HUD.red;
        else if (isCurrent)  bg = HUD.amber;
        return (
          <div key={step.id} title={`${step.label}: ${sd.status}`} style={{
            width: 6, height: 6, borderRadius: '50%', background: bg, flexShrink: 0,
            animation: isCurrent && !isBlocked ? 'compliance_pulse 1.6s ease-in-out infinite' : undefined,
          }}/>
        );
      })}
      {allDone && <span style={{ ...mono, fontSize: 9, color: HUD.neon, marginLeft: 2 }}>✓</span>}
    </div>
  );
}
