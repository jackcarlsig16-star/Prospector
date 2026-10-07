import { useState, useEffect, useCallback, useMemo } from 'react';
import { SA, SA_TYPE, SA_SHAPE, SA_THEME_CSS, SA_THEME_CLASS, saSans } from '../theme';
import { SEMANTIC } from '../palette';
import { laWeekStart, laDateString } from '../periods';
import { roleAtLeast } from '../../../constants/roles';
import { fetchMe } from '../../../utils/authSession';
import { goalsApi, TODOS_CHANGED, OPEN_GOALS_WEEK } from '../goals/goalsApi';
import { fetchFlags, completeFlag, reassignFlag, announceFlagsChanged, FLAGS_CHANGED } from '../huddleApi';
import { memberLookup, labelStyle, ErrorNote } from '../goals/goalsUi';
import { buildTaskGroups, badgeCount } from './taskGroups';

// task-drawer-v1 - a second view of the Goals to-dos, on every page of a
// workspace with Goals & Sales on. Writes reuse the Goals/flag routes.
// localStorage key (per viewer convenience): prospector_task_drawer_open = '1' | '0'
const OPEN_KEY = 'prospector_task_drawer_open';
const UNDO_MS = 5000;
const WIDTH = 380;

const readOpen = () => { try { return localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; } };
const writeOpen = v => { try { localStorage.setItem(OPEN_KEY, v ? '1' : '0'); } catch { /* private mode */ } };
const md = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const prettyKey = k => k.replace(/_/g, ' ');

const pill = on => ({ ...saSans, height: 32, padding: '0 12px', borderRadius: 999, fontSize: 13, cursor: 'pointer', border: `1px solid ${on ? SA.accent : SA.border}`, background: on ? SA.surface2 : 'transparent', color: on ? SA.text : SA.muted, display: 'inline-flex', alignItems: 'center', gap: 6 });
const linkBtn = { all: 'unset', cursor: 'pointer', color: SA.link, fontSize: 13, minHeight: 28, display: 'inline-flex', alignItems: 'center' };

function Badge({ n }) {
  if (!n) return null;
  return <span aria-label={`${n} open`} style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999, background: SA.warn, color: SA.ground, fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{n}</span>;
}

function Box({ checked, disabled, title, onClick, label }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={checked} aria-label={label} title={title}
      style={{ width: 22, height: 22, flex: 'none', borderRadius: 6, border: `1.5px solid ${checked ? SEMANTIC.healthy : SA.borderStrong}`, background: checked ? SEMANTIC.healthy : 'transparent', cursor: disabled ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
      {checked && <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke={SA.ground} strokeWidth="2.4" aria-hidden="true"><path d="m3 8.5 3.2 3L13 4.5" /></svg>}
    </button>
  );
}

export default function TaskDrawer({ businessId, compact, onOpenGoals }) {
  const [open, setOpen] = useState(readOpen);
  const [week] = useState(() => laWeekStart());
  const [me, setMe] = useState(null);
  const [members, setMembers] = useState([]);
  const [todos, setTodos] = useState([]);
  const [flags, setFlags] = useState([]);
  const [filter, setFilter] = useState('me');
  const [expanded, setExpanded] = useState(() => new Set());
  const [showDone, setShowDone] = useState(false);
  const [linkNames, setLinkNames] = useState({});
  const [toast, setToast] = useState(null); // { text, undo? }
  const [error, setError] = useState('');

  const load = useCallback(() => Promise.all([goalsApi.weekGoals(businessId, week, week, 'todo'), fetchFlags(businessId)])
    .then(([t, f]) => { setTodos(t); setFlags(f); setError(''); })
    .catch(e => setError(e.message)), [businessId, week]);

  useEffect(() => {
    fetchMe().then(setMe).catch(() => setMe(null));
    goalsApi.members(businessId).then(setMembers).catch(e => setError(e.message));
  }, [businessId]);
  useEffect(() => {
    load();
    window.addEventListener(TODOS_CHANGED, load);
    window.addEventListener(FLAGS_CHANGED, load);
    return () => { window.removeEventListener(TODOS_CHANGED, load); window.removeEventListener(FLAGS_CHANGED, load); };
  }, [load]);
  useEffect(() => { writeOpen(open); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), UNDO_MS);
    return () => clearTimeout(t);
  }, [toast]);
  // Names for link chips, fetched only when something is linked.
  const linkTypes = [...new Set([...todos, ...flags].map(t => t.link_type).filter(Boolean))].sort().join(',');
  useEffect(() => {
    if (!open || !linkTypes) return;
    Promise.all([
      linkTypes.includes('commitment') ? goalsApi.weekGoals(businessId, week, week, 'commitment') : [],
      linkTypes.includes('partner') ? goalsApi.partners(businessId) : [],
    ]).then(([cs, ps]) => setLinkNames(Object.fromEntries([...cs.map(c => [c.id, c.text]), ...ps.map(p => [p.id, p.name])]))).catch(() => {});
  }, [open, linkTypes, businessId, week]);

  const lookup = useMemo(() => memberLookup(members), [members]);
  const meId = me?.profile?.id;
  const myRole = me?.memberships?.find(m => m.business_id === businessId)?.role;
  const canEdit = !!me && (me.profile?.is_platform_owner || roleAtLeast(myRole, 'member'));
  const today = laDateString();
  const groups = meId ? buildTaskGroups({ todos, flags, filter, meId, today }) : [];
  const badge = meId ? badgeCount({ todos, flags, meId }) : 0;
  const flagIds = new Set(flags.map(f => f.id));

  const run = async fn => { setError(''); try { await fn(); } catch (e) { setError(e.message); } };
  const setDone = (t, done) => run(async () => {
    if (flagIds.has(t.id)) {
      const who = t.contacts[0] || 'this prospect';
      if (!window.confirm(`Mark ${who} contacted and close the flag? (Same as Mark contacted in the Huddle.)`)) return;
      await completeFlag(businessId, t.id);
      announceFlagsChanged();
      return setToast({ text: `${who} marked contacted · flag closed` });
    }
    await goalsApi.updateWeekGoal(businessId, t.id, { status: done ? 'done' : 'open' });
    setToast({ text: done ? `Done: ${t.text}` : `Reopened: ${t.text}`, undo: () => goalsApi.updateWeekGoal(businessId, t.id, { status: done ? 'open' : 'done' }) });
  });
  const toggleStep = (t, s) => run(async () => {
    await goalsApi.updateStep(businessId, s.id, { done: !s.done });
    if (flagIds.has(t.id)) announceFlagsChanged();
  });
  const reassign = (t, userId) => run(async () => {
    if (flagIds.has(t.id)) { await reassignFlag(businessId, t.id, userId); announceFlagsChanged(); }
    else await goalsApi.updateWeekGoal(businessId, t.id, { owner_user_id: userId || null });
    setToast({ text: `${t.text} → ${lookup(userId || null).first}` });
  });
  const openInGoals = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('gview', 'week');
    window.history.replaceState(window.history.state, '', url);
    onOpenGoals();
    window.dispatchEvent(new Event(OPEN_GOALS_WEEK));
    if (compact) setOpen(false);
  };
  const toggleExpanded = id => setExpanded(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const filters = [
    { id: 'me', label: 'Me', color: meId && lookup(meId).color },
    ...members.filter(m => m.user_id !== meId).map(m => ({ id: m.user_id, label: lookup(m.user_id).first, color: lookup(m.user_id).color })),
    { id: 'team', label: 'Team' },
    { id: 'unassigned', label: 'Unassigned', color: lookup(null).color },
  ];

  const linkLabel = t => {
    if (!t.link_type) return null;
    if (t.link_type === 'metric') return `Goal: ${prettyKey(t.link_id)}`;
    if (t.link_type === 'company') return `Company: ${t.link_id}`;
    return `${t.link_type === 'partner' ? 'Partner' : 'Commitment'}: ${linkNames[t.link_id] || '…'}`;
  };

  const row = t => {
    const owner = lookup(t.owner_user_id);
    const nDone = t.steps.filter(s => s.done).length;
    const isFlag = flagIds.has(t.id);
    const done = t.st === 'done';
    // All steps ticked makes a to-do done by itself; only a step reopens it.
    const doneBySteps = done && t.status !== 'done';
    const isOpen = expanded.has(t.id);
    const overdue = !done && t.due_date && t.due_date < today;
    return (
      <li key={t.id} data-task-id={t.id} style={{ borderTop: `1px solid ${SA.track}`, padding: '10px 0' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ paddingTop: 2 }}>
            <Box checked={done} disabled={!canEdit || doneBySteps || (isFlag && done)} label={`Done: ${t.text}`}
              title={doneBySteps ? 'Every step is ticked - untick a step to reopen' : isFlag ? 'Mark contacted and close the flag' : undefined}
              onClick={() => setDone(t, !done)} />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button type="button" onClick={() => toggleExpanded(t.id)} aria-expanded={isOpen}
              style={{ all: 'unset', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: done ? SA.muted : SA.text, textDecoration: done ? 'line-through' : 'none', overflowWrap: 'anywhere' }}>
              {isFlag && '🚩 '}{t.text}
            </button>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, color: SA.muted }}>
              {canEdit ? (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 8px', borderRadius: 999, border: `1px solid ${SA.border}`, background: SA.surface2 }}>
                  <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: owner.color }} />
                  <select aria-label={`Owner of ${t.text}`} value={t.owner_user_id || ''} onChange={e => reassign(t, e.target.value)}
                    style={{ all: 'unset', ...saSans, fontSize: 12, color: SA.soft, cursor: 'pointer' }}>
                    {!isFlag && <option value="">Unassigned</option>}
                    {members.map(m => <option key={m.user_id} value={m.user_id}>{lookup(m.user_id).first}</option>)}
                  </select>
                </label>
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: owner.color }} />{owner.first}</span>
              )}
              {t.due_date && <span style={{ color: overdue ? SA.bad : SA.muted }}>due {md(t.due_date)}</span>}
              {t.steps.length > 0 && <span style={{ fontVariantNumeric: 'tabular-nums' }}>{nDone}/{t.steps.length}</span>}
              {linkLabel(t) && <span style={{ padding: '2px 8px', borderRadius: 999, border: `1px solid ${SA.border}`, color: SA.soft, overflowWrap: 'anywhere' }}>{linkLabel(t)}</span>}
            </div>
            {isOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
                {t.steps.length > 0 && (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {t.steps.map(s => (
                      <li key={s.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13 }}>
                        <Box checked={s.done} disabled={!canEdit} label={`Step done: ${s.text}`} onClick={() => toggleStep(t, s)} />
                        <span style={{ color: s.done ? SA.muted : SA.text, textDecoration: s.done ? 'line-through' : 'none', paddingTop: 2 }}>{s.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {t.flag_note && <span style={{ fontSize: 13, color: SA.soft }}>From {lookup(t.flagged_by).first}: “{t.flag_note}”</span>}
                {t.contacts.length > 0 && <span style={{ fontSize: 13, color: SA.muted }}>With {t.contacts.join(', ')}</span>}
                {t.week_start !== week && <span style={{ fontSize: 12, color: SA.warn }}>From the week of {md(t.week_start)}</span>}
                <button type="button" style={linkBtn} onClick={openInGoals}>Open in Goals →</button>
              </div>
            )}
          </div>
        </div>
      </li>
    );
  };

  const toggleButton = compact ? (
    <button type="button" onClick={() => setOpen(true)} aria-label={`Tasks${badge ? `, ${badge} open` : ''}`} className="no-print"
      style={{ ...saSans, position: 'fixed', top: 4, right: 8, zIndex: 4001, height: 44, padding: '0 12px', borderRadius: 10, border: 'none', background: 'transparent', color: SA.text, fontSize: 14, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      ✓ Tasks <Badge n={badge} />
    </button>
  ) : (
    <button type="button" onClick={() => setOpen(true)} aria-label={`Open tasks${badge ? `, ${badge} open` : ''}`} className="no-print"
      style={{ ...saSans, position: 'fixed', top: 140, right: 0, zIndex: 3000, width: 36, padding: '14px 0', borderRadius: '10px 0 0 10px', border: `1px solid ${SA.border}`, borderRight: 'none', background: SA.surface, color: SA.text, fontSize: 13, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <span style={{ writingMode: 'vertical-rl', letterSpacing: '0.04em' }}>Tasks</span>
      <Badge n={badge} />
    </button>
  );

  return (
    <>
      <style>{SA_THEME_CSS}</style>
      {!open && <span className={SA_THEME_CLASS}>{toggleButton}</span>}
      {open && compact && <div onClick={() => setOpen(false)} className="no-print" style={{ position: 'fixed', inset: 0, background: '#000a', zIndex: 4001 }} />}
      {open && (
        <aside className={`${SA_THEME_CLASS} no-print`} role="dialog" aria-modal={compact ? true : undefined} aria-labelledby="task-drawer-title"
          style={{ ...saSans, position: 'fixed', top: 0, right: 0, bottom: 0, width: compact ? '100vw' : WIDTH, maxWidth: '100vw', boxSizing: 'border-box', zIndex: 4002, background: SA.ground, color: SA.text, borderLeft: `1px solid ${SA.border}`, display: 'flex', flexDirection: 'column', boxShadow: '-12px 0 32px rgba(0,0,0,0.35)' }}>
          <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 12px 12px 16px', borderBottom: `1px solid ${SA.border}` }}>
            <h2 id="task-drawer-title" style={{ ...SA_TYPE.cardTitle, fontSize: 17, margin: 0, color: SA.text }}>Tasks</h2>
            <Badge n={badge} />
            {/* Header slot: "Paste call notes" (call-notes-to-tasks-v1) and "Log outreach" (sales-quick-add-research-v1). */}
            <div style={{ flex: 1 }} />
            <button type="button" onClick={() => setOpen(false)} aria-label="Close tasks"
              style={{ all: 'unset', cursor: 'pointer', width: 44, height: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: SA.muted }}>×</button>
          </header>
          <div role="group" aria-label="Whose tasks" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '12px 16px' }}>
            {filters.map(f => (
              <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} style={pill(filter === f.id)}>
                {f.color && <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: f.color }} />}{f.label}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 16px' }}>
            {me && !canEdit && <p style={{ fontSize: 13, color: SA.muted, margin: '0 0 8px' }}>You have view access, so tasks are read-only.</p>}
            {error && <div style={{ marginBottom: 8 }}><ErrorNote message={error} /></div>}
            {groups.filter(g => g.items.length).map(g => (
              <section key={g.id} aria-label={g.label} style={{ marginTop: 12 }}>
                {g.id === 'done' ? (
                  <button type="button" onClick={() => setShowDone(v => !v)} aria-expanded={showDone} style={{ ...linkBtn, ...labelStyle, color: SA.soft }}>
                    {showDone ? '▾' : '▸'} {g.label} · {g.items.length}
                  </button>
                ) : (
                  <span style={{ ...labelStyle, color: g.id === 'overdue' ? SA.bad : g.id === 'flagged' ? SA.warn : SA.soft }}>{g.label} · {g.items.length}</span>
                )}
                {(g.id !== 'done' || showDone) && <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0 }}>{g.items.map(row)}</ul>}
              </section>
            ))}
            {meId && !groups.some(g => g.items.length) && !error && <p style={{ fontSize: 14, color: SA.muted, marginTop: 16 }}>Nothing here for this week.</p>}
            <button type="button" style={{ ...linkBtn, marginTop: 16 }} onClick={openInGoals}>Open Goals → This week</button>
          </div>
          {toast && (
            <div role="status" style={{ margin: 12, padding: '10px 12px', borderRadius: SA_SHAPE.radiusInner, background: SA.surface2, border: `1px solid ${SA.border}`, display: 'flex', alignItems: 'center', gap: 12, fontSize: 13 }}>
              <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{toast.text}</span>
              {toast.undo && <button type="button" style={{ ...linkBtn, fontWeight: 600 }} onClick={() => { const undo = toast.undo; setToast(null); run(undo); }}>Undo</button>}
            </div>
          )}
        </aside>
      )}
    </>
  );
}
