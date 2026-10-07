import { useState, useEffect, useCallback, useMemo } from 'react';
import { SA, SA_TYPE, SA_SHAPE, SA_THEME_CSS, SA_THEME_CLASS, saSans } from '../theme';
import { laWeekStart, laDateString } from '../periods';
import { roleAtLeast } from '../../../constants/roles';
import { fetchMe } from '../../../utils/authSession';
import { goalsApi, TODOS_CHANGED, OPEN_GOALS_WEEK, OPEN_TASKS } from '../goals/goalsApi';
import { fetchFlags, completeFlag, dropFlag, reassignFlag, announceFlagsChanged, FLAGS_CHANGED } from '../huddleApi';
import { memberLookup, labelStyle, ErrorNote, ShowingChip } from '../goals/goalsUi';
import { buildTaskGroups, badgeCount } from './taskGroups';
import { useLinkOptions } from './linkTargets';
import QuickAdd from './QuickAdd';
import CallNotesPanel from './CallNotesPanel';
import TaskRow, { linkBtn } from './TaskRow';

// task-drawer-v1 - a second view of the Goals to-dos, on every page of a
// workspace with Goals & Sales on. Writes reuse the Goals/flag routes.
// localStorage key (per viewer convenience): prospector_task_drawer_open = '1' | '0'
const OPEN_KEY = 'prospector_task_drawer_open';
const UNDO_MS = 5000;
const WIDTH = 380;
const OWN_DELETE_MS = 2 * 60e3; // FIX-5, same window as the server's OWN_DELETE_WINDOW_MS

const readOpen = () => { try { return localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; } };
const writeOpen = v => { try { localStorage.setItem(OPEN_KEY, v ? '1' : '0'); } catch { /* private mode */ } };

const pill = on => ({ ...saSans, height: 32, padding: '0 12px', borderRadius: 999, fontSize: 13, cursor: 'pointer', border: `1px solid ${on ? SA.accent : SA.border}`, background: on ? SA.surface2 : 'transparent', color: on ? SA.text : SA.muted, display: 'inline-flex', alignItems: 'center', gap: 6 });

function Badge({ n }) {
  if (!n) return null;
  return <span aria-label={`${n} open`} style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999, background: SA.warn, color: SA.ground, fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{n}</span>;
}

export default function TaskDrawer({ businessId, compact, onOpenGoals }) {
  const [open, setOpen] = useState(readOpen);
  const [week] = useState(() => laWeekStart());
  const [me, setMe] = useState(null);
  const [members, setMembers] = useState([]);
  const [todos, setTodos] = useState([]);
  const [flags, setFlags] = useState([]);
  const [filter, setFilter] = useState('me');
  const [linkFilter, setLinkFilter] = useState(null); // { type, id } from a Goals "open tasks" link
  const [expanded, setExpanded] = useState(() => new Set());
  const [showDone, setShowDone] = useState(false);
  const [toast, setToast] = useState(null); // { text, undo? }
  const [error, setError] = useState('');
  const [pasting, setPasting] = useState(false);

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
  useEffect(() => {
    const onOpenTasks = e => { setLinkFilter(e.detail.link); setFilter(e.detail.filter || 'team'); setOpen(true); };
    window.addEventListener(OPEN_TASKS, onOpenTasks);
    return () => window.removeEventListener(OPEN_TASKS, onOpenTasks);
  }, []);
  // A Goals link's filter lasts until the drawer closes; the next open is the plain list.
  useEffect(() => { writeOpen(open); if (!open) { setLinkFilter(null); setPasting(false); } }, [open]);
  useEffect(() => {
    if (!open) return;
    // While pasting notes, Escape would throw the pasted text away - Cancel does that.
    const onKey = e => { if (e.key === 'Escape' && !pasting) setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, pasting]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), UNDO_MS);
    return () => clearTimeout(t);
  }, [toast]);
  const links = useLinkOptions(businessId, week);
  // Link chip names: fetched only once something is linked (metric names are built in).
  const needsNames = [...todos, ...flags].some(t => t.link_type && t.link_type !== 'metric') || (linkFilter && linkFilter.type !== 'metric');
  const loadLinks = links.load;
  useEffect(() => { if (open && needsNames) loadLinks(); }, [open, needsNames, loadLinks]);

  const lookup = useMemo(() => memberLookup(members), [members]);
  const meId = me?.profile?.id;
  const myRole = me?.memberships?.find(m => m.business_id === businessId)?.role;
  const canEdit = !!me && (me.profile?.is_platform_owner || roleAtLeast(myRole, 'member'));
  const canAdmin = !!me && (me.profile?.is_platform_owner || roleAtLeast(myRole, 'admin'));
  const today = laDateString();
  const inLink = t => !linkFilter || (t.link_type === linkFilter.type && t.link_id === linkFilter.id);
  const groups = meId ? buildTaskGroups({ todos: todos.filter(inLink), flags: flags.filter(inLink), filter, meId, today }) : [];
  const badge = meId ? badgeCount({ todos, flags, meId }) : 0;
  const flagIds = new Set(flags.map(f => f.id));

  const run = async fn => { setError(''); try { await fn(); return true; } catch (e) { setError(e.message); return false; } };
  const removeMode = t => (!flagIds.has(t.id) && (canAdmin || (t.created_by === meId && Date.now() - Date.parse(t.created_at) <= OWN_DELETE_MS)) ? 'delete' : 'drop');
  const add = body => run(async () => {
    await goalsApi.createWeekGoal(businessId, { ...body, kind: 'todo', week_start: week });
    setToast({ text: body.owner_user_id === meId ? `Added: ${body.text}` : `Added for ${lookup(body.owner_user_id).first}: ${body.text}` });
  });
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
  const update = (t, patch) => run(() => goalsApi.updateWeekGoal(businessId, t.id, patch));
  const addStep = (t, text) => run(async () => {
    await goalsApi.createStep(businessId, t.id, { text, sort_order: t.steps.length });
    if (flagIds.has(t.id)) announceFlagsChanged();
  });
  const remove = t => run(async () => {
    if (!window.confirm(`Delete "${t.text}"? This can't be undone.`)) return;
    await goalsApi.deleteWeekGoal(businessId, t.id);
    setToast({ text: `Deleted: ${t.text}` });
  });
  const drop = t => run(async () => {
    if (flagIds.has(t.id)) {
      if (!window.confirm(`Drop the flag "${t.text}"? It closes without marking anyone contacted.`)) return;
      await dropFlag(businessId, t.id);
      announceFlagsChanged();
      return setToast({ text: `Flag dropped: ${t.text}` });
    }
    await goalsApi.updateWeekGoal(businessId, t.id, { status: 'dropped' });
    setToast({ text: `Dropped: ${t.text}`, undo: () => goalsApi.updateWeekGoal(businessId, t.id, { status: t.status }) });
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

  const loadNote = noteId => goalsApi.callNote(businessId, noteId);
  const showCalls = () => { setPasting(false); setLinkFilter(null); setFilter('team'); };
  const created = (n, note) => {
    showCalls();
    setToast({ text: `Created ${n} task${n === 1 ? '' : 's'} from ${note.title ? `“${note.title}”` : 'the call notes'}` });
  };
  const act = { setDone, reassign, update, toggleStep, addStep, remove, drop, openInGoals, loadNote };
  const row = t => (
    <TaskRow key={t.id} t={t} isFlag={flagIds.has(t.id)} isOpen={expanded.has(t.id)} onToggle={() => toggleExpanded(t.id)}
      members={members} lookup={lookup} links={links} today={today} week={week}
      can={{ edit: canEdit, remove: removeMode(t) }} act={act} />
  );

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
            <div style={{ flex: 1 }} />
            {/* Header slot: "Log outreach" (sales-quick-add-research-v1) goes next to this. */}
            {canEdit && !pasting && <button type="button" onClick={() => setPasting(true)} style={pill(false)}>📝 Paste call notes</button>}
            <button type="button" onClick={() => setOpen(false)} aria-label="Close tasks"
              style={{ all: 'unset', cursor: 'pointer', width: 44, height: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: SA.muted }}>×</button>
          </header>
          {pasting && canEdit && <CallNotesPanel businessId={businessId} members={members} lookup={lookup} links={links} onClose={() => setPasting(false)} onCreated={created} onShowCalls={showCalls} />}
          {!pasting && canEdit && <QuickAdd meId={meId} members={members} lookup={lookup} links={links} onAdd={add} />}
          {!pasting && (
            <>
              <div role="group" aria-label="Whose tasks" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '12px 16px' }}>
                {filters.map(f => (
                  <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} style={pill(filter === f.id)}>
                    {f.color && <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: f.color }} />}{f.label}
                  </button>
                ))}
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 16px' }}>
                {linkFilter && <div style={{ marginBottom: 4 }}><ShowingChip label={links.labelFor(linkFilter.type, linkFilter.id)} count={groups.reduce((n, g) => n + g.items.length, 0)} onClear={() => setLinkFilter(null)} /></div>}
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
            </>
          )}
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
