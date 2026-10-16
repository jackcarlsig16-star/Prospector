import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { SA, SA_SHAPE, SA_THEME_CSS, SA_THEME_CLASS, saSans } from '../theme';
import { laWeekStart } from '../periods';
import { roleAtLeast } from '../../../constants/roles';
import { fetchMe } from '../../../utils/authSession';
import { createNugget } from '../../../utils/nuggets';
import { goalsApi, OPEN_TASKS } from '../goals/goalsApi';
import { memberLookup, labelStyle, inputStyle, Btn, ErrorNote } from '../goals/goalsUi';
import { useLinkOptions } from '../tasks/linkTargets';
import QuickAdd from '../tasks/QuickAdd';
import CallNotesPanel from '../tasks/CallNotesPanel';
import Segmented from '../../../ui/Segmented';

// sales-ia-v1 Stage 3 - the "+" in the workspace header. One panel, three
// modes: Task mounts QuickAdd, Note mounts CallNotesPanel (Intake), Idea
// appends to the browser-only Ideas store through the setter App.js owns.
// Company arrives with pipeline-wide-table-v1 REV3 Stage 3.
const MODES = [{ id: 'task', label: 'Task', meta: 'T' }, { id: 'note', label: 'Note', meta: 'N' }, { id: 'idea', label: 'Idea', meta: 'I' }];
const MODE_KEYS = { t: 'task', n: 'note', i: 'idea' };
const WIDTH = 560;
const Z = 4001; // the Tasks drawer's tier, so the panel sits above the sticky header and the drawer tab

export const inTextField = el => !!el && (el.isContentEditable || !!el.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));

export default function QuickCapture({ businessId, features, activeUser, onSaveNuggets, compact }) {
  const [me, setMe] = useState(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('task');
  const [members, setMembers] = useState([]);
  const [week] = useState(() => laWeekStart());
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [idea, setIdea] = useState('');
  const [savingIdea, setSavingIdea] = useState(false);
  const noteDirty = useRef(false);
  const panelRef = useRef(null);
  const enabled = !!features?.goals_sales;

  useEffect(() => { if (enabled) fetchMe().then(setMe).catch(() => setMe(null)); }, [enabled]);
  useEffect(() => { if (open && !members.length) goalsApi.members(businessId).then(setMembers).catch(e => setError(e.message)); }, [open, members.length, businessId]);
  const links = useLinkOptions(businessId, week);

  const close = useCallback(() => { setOpen(false); setStatus(''); setError(''); noteDirty.current = false; }, []);
  const canEdit = !!me && (me.profile?.is_platform_owner || roleAtLeast(me.memberships?.find(m => m.business_id === businessId)?.role, 'member'));
  const show = enabled && canEdit;

  useEffect(() => {
    if (!show) return;
    const onKey = e => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape' && open) {
        // Pasted notes are the one thing Esc could throw away - Cancel does that on purpose.
        if (mode === 'note' && noteDirty.current) return;
        return close();
      }
      if (inTextField(e.target)) return;
      const k = e.key.toLowerCase();
      if (!open) { if (k === 'c') { e.preventDefault(); setOpen(true); } return; }
      if (MODE_KEYS[k]) { e.preventDefault(); setMode(MODE_KEYS[k]); setStatus(''); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show, open, mode, close]);
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    (panel?.querySelector('textarea') || panel?.querySelector('input:not([type="date"])'))?.focus();
  }, [open, mode]);
  useEffect(() => { if (mode !== 'note') noteDirty.current = false; }, [mode]);

  if (!show) return null;

  const lookup = memberLookup(members);
  const meId = me.profile?.id;
  const openTasks = filter => window.dispatchEvent(new CustomEvent(OPEN_TASKS, { detail: { link: null, filter } }));
  const addTask = async body => {
    setError('');
    try {
      await goalsApi.createWeekGoal(businessId, { ...body, kind: 'todo', week_start: week });
      setStatus(body.owner_user_id === meId ? `Added: ${body.text}` : `Added for ${lookup(body.owner_user_id).first}: ${body.text}`);
      return true;
    } catch (e) { setError(e.message); return false; }
  };
  const noteCreated = () => { close(); openTasks('team'); };
  const saveIdea = async () => {
    if (!idea.trim() || savingIdea) return;
    setSavingIdea(true); setError('');
    const nugget = await createNugget({ text: idea, myName: activeUser?.name || 'AE' });
    onSaveNuggets(ns => [nugget, ...ns]);
    setIdea(''); setSavingIdea(false); setStatus('Saved to Ideas on this browser');
  };

  const sheet = compact
    ? { left: 0, right: 0, bottom: 0, maxHeight: '88vh', borderRadius: `${SA_SHAPE.radiusCard}px ${SA_SHAPE.radiusCard}px 0 0`, borderBottom: 'none' }
    : { top: '10vh', left: '50%', transform: 'translateX(-50%)', width: WIDTH, maxWidth: 'calc(100vw - 32px)', maxHeight: '80vh', borderRadius: SA_SHAPE.radiusCard };

  return (
    <>
      <style>{SA_THEME_CSS}</style>
      <button type="button" className="ui-btn ui-btn--primary no-print" onClick={() => setOpen(true)} aria-label="Quick capture" title="Quick capture (C)" data-capture-button
        style={{ width: 32, padding: 0, fontSize: 20, lineHeight: 1, flexShrink: 0 }}>+</button>
      {open && (
        <span className={`${SA_THEME_CLASS} ui-theme-dark no-print`}>
          <div onClick={close} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: Z }} />
          <section ref={panelRef} role="dialog" aria-modal="true" aria-label="Quick capture" data-capture-panel
            style={{ ...saSans, position: 'fixed', zIndex: Z + 1, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', background: SA.surface2, color: SA.text, border: `1px solid ${SA.borderStrong}`, boxShadow: '0 18px 40px rgba(0,0,0,0.45)', overflow: 'hidden', ...sheet }}>
            <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: compact ? '10px 12px' : '12px 16px', borderBottom: `1px solid ${SA.border}` }}>
              {compact && <span aria-hidden="true" style={{ position: 'absolute', top: 4, left: '50%', width: 36, height: 4, marginLeft: -18, borderRadius: 999, background: SA.borderStrong }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <Segmented label="Capture mode" items={MODES} value={mode} onChange={m => { setMode(m); setStatus(''); }} />
              </div>
              <button type="button" onClick={close} aria-label="Close quick capture" style={{ all: 'unset', cursor: 'pointer', color: SA.muted, fontSize: 16, padding: '4px 6px', lineHeight: 1 }}>✕</button>
            </header>
            {mode === 'task' && (
              <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 12 }}>
                <QuickAdd meId={meId} members={members} lookup={lookup} links={links} onAdd={addTask} />
                <span style={{ fontSize: 12, color: SA.muted, padding: '10px 16px 0' }}>Owner, due and link chips appear once there's text. Enter saves.</span>
              </div>
            )}
            {mode === 'note' && (
              <div onInput={() => { noteDirty.current = true; }} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <CallNotesPanel businessId={businessId} members={members} lookup={lookup} links={links} onClose={close} onCreated={noteCreated} onShowCalls={() => { close(); openTasks('team'); }} />
              </div>
            )}
            {mode === 'idea' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 16px 0' }}>
                <span style={{ ...labelStyle, color: SA.soft }}>Idea</span>
                <textarea value={idea} onChange={e => setIdea(e.target.value)} aria-label="Idea" disabled={savingIdea} rows={4}
                  placeholder="What would make this better? Be specific."
                  onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveIdea(); } }}
                  style={{ ...inputStyle, height: 'auto', minHeight: 96, padding: '10px 12px', resize: 'vertical', lineHeight: 1.5, fontSize: 14 }} />
                <footer style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0 12px' }}>
                  <span style={{ fontSize: 12, color: SA.muted }}>Saves to Ideas on this browser</span>
                  <Btn primary style={{ marginLeft: 'auto' }} disabled={!idea.trim() || savingIdea} onClick={saveIdea}>{savingIdea ? 'Saving…' : 'Save idea ⌘↵'}</Btn>
                </footer>
              </div>
            )}
            {(status || error) && (
              <div style={{ padding: '0 16px 12px' }}>
                {status && <span role="status" style={{ fontSize: 13, color: SA.good }}>{status}</span>}
                {error && <ErrorNote message={error} />}
              </div>
            )}
          </section>
        </span>
      )}
    </>
  );
}
