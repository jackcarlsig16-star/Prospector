import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { SA_THEME_ROOT_ID, SA_THEME_CLASS } from '../theme';
import { goalsApi } from '../goals/goalsApi';
import { ownerOf, useAssignCss } from './AssignPerson';

// FIX people-assign-design-v1 A5 / A1 - the write and its confirmation, Scout's done-line shape: a glyph, one
// sentence, Undo with the seconds left. Five lines: assigned · unassigned · undone · someone else changed it
// (reloaded) · failure + Retry (the same assign with the same expect; a second failure keeps the line and the button).
// The write itself is unchanged: POST goals/people/:key/assign { owner_user_id, expect } and the event's own Undo.
export const UNDO_SECONDS = 10;
const WASH_MS = 3000;
const STAY = { ok: 4, warn: 6, bad: 10 }; // seconds a line without Undo stays

// onLocal(key, userId | undefined) shows the new owner at once (undefined = drop the local value, the reload decides).
// inFlight: an optional ref to a Set the screen reads - the person keys with a write on its way, whose local owner a
// reload that started earlier must not paint over (Undo pressed while the assign's reload is still loading).
export function useAssign({ businessId, members, onLocal, onChanged, inFlight = null }) {
  const [line, setLine] = useState(null);
  const [wash, setWash] = useState(null);
  const n = useRef(0);
  const say = l => { n.current += 1; setLine({ ...l, id: n.current }); };
  const who = id => ownerOf(members, id)?.name || 'a member';
  useEffect(() => {
    if (!wash) return undefined;
    const t = setTimeout(() => setWash(null), WASH_MS);
    return () => clearTimeout(t);
  }, [wash]);
  const undo = async (p, eventId) => {
    onLocal(p.key, p.from);
    inFlight?.current.add(p.key);
    try {
      await goalsApi.undoPersonEvent(businessId, eventId);
      inFlight?.current.delete(p.key);
      onChanged();
      say({ tone: 'ok', text: p.from ? `Undone. ${p.name} is back with ${who(p.from)}.` : `Undone. ${p.name} is unassigned again.` });
    } catch (e) { inFlight?.current.delete(p.key); onLocal(p.key, undefined); onChanged(); say({ tone: 'bad', text: `Couldn’t undo. ${e.message}` }); }
  };
  const send = async p => {
    onLocal(p.key, p.to);
    inFlight?.current.add(p.key);
    try {
      const out = await goalsApi.assignPerson(businessId, p.key, { owner_user_id: p.to, expect: { owner_user_id: p.from } });
      inFlight?.current.delete(p.key);
      onChanged();
      setWash(p.key);
      say({ tone: 'ok', text: p.to ? `${p.name} assigned to ${who(p.to)}.` : `${p.name} is unassigned.`, undo: out.event ? () => undo(p, out.event.id) : null });
    } catch (e) {
      inFlight?.current.delete(p.key);
      onLocal(p.key, undefined);
      if (e.status === 409) { onChanged(); say({ tone: 'warn', text: `${p.name}: someone changed the owner first. Reloaded.` }); }
      else say({ tone: 'bad', text: `Couldn’t assign ${p.name}. ${e.message}`, retry: () => send(p) });
    }
  };
  // person = { key, name, from }
  return { assign: (person, to) => send({ ...person, to }), line, clear: useCallback(() => setLine(null), []), washKey: wash };
}

const GLYPH = {
  ok: ['var(--sa-good)', <><circle cx="8" cy="8" r="6" /><path d="M5.5 8.2l1.8 1.8 3.4-3.8" /></>],
  warn: ['var(--sa-warn)', <><path d="M8 2.5 14 13H2z" /><path d="M8 6.5v3M8 11.3h.01" /></>],
  bad: ['var(--sa-bad)', <><path d="M8 2.5 14 13H2z" /><path d="M8 6.5v3M8 11.3h.01" /></>],
};

export function AssignDoneLine({ line, onClear, phone = false }) {
  useAssignCss();
  const total = line ? (line.undo ? UNDO_SECONDS : STAY[line.tone]) : 0;
  const [, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  // The seconds left are read from the line's own start on every render, so the first frame already says 10 s.
  const start = useRef({ id: null, at: 0 });
  if (line && start.current.id !== line.id) start.current = { id: line.id, at: Date.now() };
  const left = total - Math.floor((Date.now() - start.current.at) / 1000);
  useEffect(() => {
    if (!line) return undefined;
    setBusy(false);
    const t = setInterval(() => { if (total - Math.floor((Date.now() - start.current.at) / 1000) <= 0) { clearInterval(t); onClear(); } else setTick(n => n + 1); }, 250);
    return () => clearInterval(t);
  }, [line?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!line) return null;
  const [color, path] = GLYPH[line.tone];
  const run = fn => async () => { setBusy(true); await fn(); };
  return createPortal(
    <div role="status" data-assign-done={line.tone} className={`${SA_THEME_CLASS} no-print asg-done${phone ? ' asg-done--phone' : ''}`}>
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{path}</svg>
      <span data-assign-done-line>{line.text}</span>
      {line.undo && <button type="button" className="asg-u" data-assign-undo disabled={busy} onClick={run(line.undo)}>Undo <span>{Math.max(0, left)} s</span></button>}
      {line.retry && <button type="button" className="asg-u" data-assign-retry disabled={busy} onClick={run(line.retry)}>Retry</button>}
    </div>, document.getElementById(SA_THEME_ROOT_ID) || document.body);
}
