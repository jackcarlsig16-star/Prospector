import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../HkMarks';
import { hkPost } from '../hkApi';
import { UNDO_MS, pipelineBlock } from '../signals/Heat';
import { useSheetConfirm, claimAsking } from './sheetConfirm';

// grow-ui-refresh-v1 U2 + U3 - the one primary per brand and the quick commands, in the mockup's order and icons:
// Target toggle (T) · + Pipeline (no key) · Research / re-run (R) · Snooze 14 days (S) · Not a fit (X); Pitch = P.
// Every one-click action answers in one toast with Undo (10 s); Not a fit's reason is editable in the toast. Keys never
// fire while typing. Nothing here sends: Pitch claims and copies the Claude command.
export const KEYS = { p: 'pitch', t: 'target', r: 'research', s: 'snooze', x: 'notfit' };
export const isOpenDialog = () => !!document.querySelector('[role="dialog"], [role="alertdialog"]');
export const isTyping = e => { const t = e.target; return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); };
const copyText = async text => { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } };

// -> { act(action, brand), busy, node } - node holds the sheet-owner question and the toast; render it once.
export function useBrandCommands({ businessId, onChanged, setError }) {
  const sheet = useSheetConfirm();
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState('');
  const [reason, setReason] = useState('');
  const latest = useRef(null);
  useEffect(() => { if (!toast || toast.hold) return undefined; const t = setTimeout(() => setToast(null), UNDO_MS); return () => clearTimeout(t); }, [toast]);
  const path = (b, p) => `/brands/${b.id}/${p}`;
  const run = useCallback(async (key, fn) => {
    setBusy(key); setError?.('');
    try { const out = await fn(); await onChanged?.(); return out; } catch (e) { setError?.(e.message); return null; } finally { setBusy(''); }
  }, [onChanged, setError]);
  const act = useCallback((action, b, extra = {}) => run(`${action}:${b.id}`, async () => {
    if (action === 'pitch') {
      const r = await claimAsking(sheet.confirm, x => hkPost(businessId, path(b, 'pitch'), x));
      if (!r) return;
      const copied = await copyText(r.command);
      setToast({ line: copied ? r.words : `${r.claimed ? 'Claimed. ' : ''}Copy failed - the command is ${r.command}`, undo: r.claimed ? () => hkPost(businessId, path(b, 'pitch'), { undo: true, expect_updated_at: r.brand.updated_at }) : null });
    } else if (action === 'target') {
      const on = !b.targeted_at;
      await hkPost(businessId, path(b, 'target'), { on });
      setToast({ line: on ? `${b.name} added to Targets.` : `${b.name} removed from Targets.`, undo: () => hkPost(businessId, path(b, 'target'), { on: !on }) });
    } else if (action === 'pipeline' || action === 'claim') {
      const r = await claimAsking(sheet.confirm, x => hkPost(businessId, path(b, 'pipeline'), x));
      if (!r) return;
      setToast({ line: r.already ? `${b.name} is already yours.` : `${b.name} is yours and on your Pipeline.`, undo: r.already ? null : () => hkPost(businessId, path(b, 'pipeline'), { undo: true, expect_updated_at: r.brand.updated_at }) });
    } else if (action === 'research') {
      const r = await hkPost(businessId, path(b, 'research'), { click: true });
      setToast({ line: r.status === 'not_found' ? `No website found for ${b.name}. It is not retried for 30 days.` : r.status === 'cached' ? `${b.name} was researched recently; the saved research is shown.` : `${b.name}: ${r.suggested ? `website ${r.domain} (${r.confidence} confidence)` : r.domain} · ${String(r.intel?.fit?.sponsor_fit || 'unknown').replace(/_/g, ' ')} fit.`, undo: null });
    } else if (action === 'snooze') {
      await hkPost(businessId, path(b, 'snooze'), { on: true });
      setToast({ line: `${b.name} snoozed for 14 days.`, undo: () => hkPost(businessId, path(b, 'snooze'), { on: false }) });
    } else if (action === 'notfit') {
      const r = await hkPost(businessId, path(b, 'not-a-fit'), {});
      latest.current = r.brand.updated_at; setReason(r.brand.pass_reason || 'Not a fit');
      setToast({ line: `${b.name}: not a fit.`, reasonFor: b, undo: () => hkPost(businessId, path(b, 'not-a-fit'), { undo: true, expect_updated_at: latest.current }) });
    } else if (action === 'log') {
      const r = await hkPost(businessId, path(b, 'activity'), extra);
      setToast({ line: `Logged: ${r.what} on ${r.date}.`, undo: () => hkPost(businessId, path(b, 'activity'), { undo: r.touch_id }) });
    } else if (action === 'copy') {
      const command = b.command;
      setToast({ line: (await copyText(command)) ? `Copied ${command}. Paste into Claude.` : `Copy failed - the command is ${command}`, undo: null });
    }
  }), [businessId, run, sheet.confirm]);
  const undo = () => { const fn = toast.undo; setToast(null); run('undo', fn); };
  const saveReason = () => run('reason', async () => { const r = await hkPost(businessId, path(toast.reasonFor, 'not-a-fit'), { reason }); latest.current = r.brand.updated_at; setToast(t => ({ ...t, hold: false, line: `${toast.reasonFor.name}: ${r.brand.pass_reason}.` })); });
  const node = (
    <>
      {sheet.node}
      {toast && (
        <div className="hk-toast" role="status" data-hk-toast>
          <span>{toast.line}</span>
          {toast.reasonFor && <label className="hk-toast__reason">Reason <input className="ui-input" value={reason} maxLength={200} onFocus={() => setToast(t => ({ ...t, hold: true }))} onChange={e => setReason(e.target.value)} data-hk-pass-reason /></label>}
          {toast.reasonFor && <button type="button" className="hk-btn hk-link" disabled={!!busy || !reason.trim()} onClick={saveReason} data-hk-pass-reason-save>Save</button>}
          {toast.undo && <button type="button" className="hk-btn hk-link" disabled={!!busy} onClick={undo} data-hk-toast-undo>Undo</button>}
        </div>
      )}
    </>
  );
  return { act, busy, node };
}

// The one primary by state (server-chosen, rules.js primaryOf). Owned by another member = words, no button.
export function PrimaryAction({ brand, onAct, onGo, onOpenBrand, busy }) {
  const p = brand.primary;
  if (!p) return null;
  if (p.kind === 'owned') return <span className="hk-meta hk-primary-owned" data-hk-primary="owned">{p.label}</span>;
  const go = { pitch: () => onAct('pitch', brand), research: () => onAct('research', brand), add_email: () => onOpenBrand(brand.id), open_draft: () => onGo('drafts'), open_reply: () => onGo('replies') }[p.kind];
  const icon = { pitch: 'bolt', research: 'search', add_email: 'person', open_draft: 'drafts', open_reply: 'replies' }[p.kind];
  return (
    <button type="button" className={`hk-btn hk-primary${p.kind === 'add_email' ? ' hk-primary--amber' : ''}`} disabled={!!busy} onClick={go} aria-keyshortcuts={p.kind === 'pitch' ? 'P' : p.kind === 'research' ? 'R' : undefined} data-hk-primary={p.kind}>
      <Icon name={icon} size={16} />{p.kind === 'research' && busy === `research:${brand.id}` ? 'Researching…' : p.label}
    </button>
  );
}

const Q = ({ icon, tip, keyName, pressed, disabled, why, onClick, attr }) => (
  <button type="button" className="hk-btn hk-qc" aria-label={tip} title={why || undefined} data-tip={why || `${tip}${keyName ? ` (${keyName})` : ''}`} aria-keyshortcuts={keyName} aria-pressed={pressed} aria-disabled={disabled || undefined} onClick={disabled ? undefined : onClick} {...{ [`data-hk-qc-${attr}`]: '' }}>
    <Icon name={icon} size={17} />
  </button>
);

// meId + firstName for + Pipeline's block reason (the same rules the server applies).
export function QuickIcons({ brand: b, meId, firstName, onAct, busy }) {
  const inPipe = b.owner_user_id === meId && b.status !== 'candidate';
  const blocked = inPipe ? 'Already on your Pipeline' : pipelineBlock(b, meId, firstName);
  return (
    <span className="hk-qcs" role="group" aria-label={`Quick commands for ${b.name}`}>
      <Q icon="target" tip="Toggle Target" keyName="T" pressed={!!b.targeted_at} disabled={!!busy} onClick={() => onAct('target', b)} attr="target" />
      <Q icon="pipeline" tip="Add to your Pipeline" pressed={inPipe} disabled={!!busy || !!blocked} why={blocked} onClick={() => onAct('pipeline', b)} attr="pipeline" />
      <Q icon="search" tip={b.research ? 'Re-run research' : 'Run research'} keyName="R" disabled={!!busy} onClick={() => onAct('research', b)} attr="research" />
      <Q icon="clock" tip="Snooze 14 days" keyName="S" disabled={!!busy} onClick={() => onAct('snooze', b)} attr="snooze" />
      <Q icon="ban" tip="Not a fit" keyName="X" disabled={!!busy} onClick={() => onAct('notfit', b)} attr="notfit" />
    </span>
  );
}
