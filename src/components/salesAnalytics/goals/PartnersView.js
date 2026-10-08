import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { SA, saSans } from '../theme';
import Ring, { RingLegend } from '../charts/Ring';
import { PIPELINE_STATUSES, WORKFLOW_STEPS, TIERS, TOUCH_STATUSES, TOUCH_TYPES, isStalePartner, daysSinceTouch, stepOf, nextStepFor } from '../../../constants/partnerPipeline';
import { cardStyle, labelStyle, h2Style, h3Style, subStyle, numStyle, inputStyle, Chip, Btn, AddButton, ErrorNote, ShowingChip } from './goalsUi';
import PartnerCard, { statusOf, statusLabel, statusColor, tierLabel } from './partners/PartnerCard';
import WorkflowView from './partners/WorkflowView';
import BulkTouchLog from './partners/BulkTouchLog';
import ApolloExport from './partners/ApolloExport';
import DomainReview from './partners/DomainReview';
import useMediaQuery from '../../../utils/useMediaQuery';

// prospector_partners_mode - per-viewer convenience: last Partners layout
// ('workflow' | 'board'). Anything else (the retired 'priority' / 'columns'
// layouts) opens on Workflow, the default.
const MODE_KEY = 'prospector_partners_mode';
const MODES = [['workflow', 'Workflow'], ['board', 'Board']];
const UNDO_MS = 5000; // REVISABLE (spec)
const readMode = () => { try { const m = localStorage.getItem(MODE_KEY); return MODES.some(([id]) => id === m) ? m : 'workflow'; } catch { return 'workflow'; } };
const writeMode = m => { try { localStorage.setItem(MODE_KEY, m); } catch { /* private mode */ } };
const localToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

// What the server will do, applied before it answers (partnerSignals.js is
// the source of truth; its reply replaces this).
function predict(p, s) {
  const now = new Date().toISOString();
  if (s.type === 'status') return { ...p, pipeline_status: s.to, ...(TOUCH_STATUSES.includes(s.to) ? { last_touch_at: now } : {}), ...(s.to === 'first_email_sent' && !p.first_email_at ? { first_email_at: localToday() } : {}) };
  if (s.type === 'deprioritize') return { ...p, pipeline_status: 'paused' };
  if (s.type === 'assign') return { ...p, owner_user_id: s.owner_user_id };
  if (s.type === 'hot') return { ...p, hot: s.hot };
  if (s.type === 'snooze') return { ...p, snoozed_until: new Date(Date.now() + (s.days || 7) * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }) };
  return p;
}
// prospector_partners_moved - sessionStorage, per viewer: "Moved to X ·
// today" notes, kept for the browser session so a row shows what changed.
const MOVED_KEY = 'prospector_partners_moved';
const readMoved = () => { try { return JSON.parse(sessionStorage.getItem(MOVED_KEY) || '{}') || {}; } catch { return {}; } };
const writeMoved = m => { try { sessionStorage.setItem(MOVED_KEY, JSON.stringify(m)); } catch { /* private mode */ } };
const stageName = status => (status === 'paused' ? 'Paused' : WORKFLOW_STEPS[stepOf(status)].label);
const CHANGED_TEXT = 'Changed by someone else — refreshed';

const SIGNAL_TEXT = { status: s => `→ ${statusLabel(s.to)}`, deprioritize: () => '→ Paused', assign: () => 'reassigned', hot: s => (s.hot ? 'marked hot' : 'no longer hot'), snooze: () => 'snoozed 7 days', note: () => 'note saved', touch: s => `· ${TOUCH_TYPES.find(t => t.id === s.touch_type)?.label || 'touch'} logged` };

const pill = on => ({ ...saSans, height: 32, padding: '0 12px', borderRadius: 999, fontSize: 13, cursor: 'pointer', border: `1px solid ${on ? SA.accent : SA.border}`, background: on ? 'color-mix(in srgb, var(--sa-accent) 18%, transparent)' : SA.surface2, color: on ? SA.text : SA.soft });

function Column({ title, sub, color, items, collapsed, onCollapse, render }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <button type="button" onClick={onCollapse} disabled={!onCollapse} aria-expanded={onCollapse ? !collapsed : undefined}
        style={{ all: 'unset', display: 'flex', alignItems: 'center', gap: 8, cursor: onCollapse ? 'pointer' : 'default' }}>
        <span style={{ width: 10, height: 10, borderRadius: 3, background: color }} />
        <span style={h3Style}>{title}</span><span style={{ ...numStyle, ...subStyle }}>{items.length}</span>
        {onCollapse && <span style={{ ...subStyle, fontSize: 12 }}>{collapsed ? 'Show ▸' : 'Hide ▾'}</span>}
      </button>
      {sub && <span style={{ ...subStyle, fontSize: 12, marginTop: -6 }}>{sub}</span>}
      {!collapsed && <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 640, overflowY: 'auto', paddingRight: 2 }}>{items.map(render)}</div>}
    </div>
  );
}

// owner/status are set by clicking the donuts (goals-surface-v1); ids +
// idsLabel by an Overview number that names a set ("P1 untouched").
const NO_FILTERS = { category: '', tiers: [], stale: false, hot: false, owner: null, status: null, ids: null, idsLabel: '' };

// teamView: the person filter is on Team. Reorder needs the whole group in
// view (see WorkflowView), so it's only offered then.
export default function PartnersView({ partners, lookup, members, canEdit, error, onUpdate, onCreate, onSignal, onUndo, onReplace, onRank, onRefresh, onEvents, teamView, focusFilter, tasksFor, onPeople, onAddPerson, onDeletePerson, onRefreshPeople, onCreateTask, onTouches, onDomains, onAddDomain, onUpdateDomain, onDeleteDomain, onAllDomains, csvUrl }) {
  const [mode, setMode] = useState(readMode);
  const [stage, setStage] = useState(null);
  const compact = useMediaQuery('(max-width: 760px)');
  const [openId, setOpenId] = useState(null);
  const [filters, setFilters] = useState(NO_FILTERS);
  const [showPaused, setShowPaused] = useState(false);
  const [toast, setToast] = useState(null); // { text, goalId, eventId, busy, error }
  const toastTimer = useRef(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', priority: '1' });
  const [addError, setAddError] = useState('');
  const [moved, setMoved] = useState(readMoved);
  const [focus, setFocus] = useState(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [peopleBusy, setPeopleBusy] = useState(false);
  // partner-domains-bulk-review-v1 - the workspace's pending domain
  // suggestions drive "Review domains (n)"; bumped after every domain write.
  const [domainBump, setDomainBump] = useState(0);
  const [domainSummary, setDomainSummary] = useState(null);
  // A Goals / Overview number opening Partners filtered ({ stage?, tiers?,
  // owner?, ids?, label? }, a new object each time). {} clears the filters.
  useEffect(() => {
    if (!focusFilter) return;
    setStage(focusFilter.stage || null);
    setFilters({ ...NO_FILTERS, tiers: focusFilter.tiers || [], owner: focusFilter.owner || null, ids: focusFilter.ids || null, idsLabel: focusFilter.label || '' });
    setMode('workflow'); writeMode('workflow');
  }, [focusFilter]);
  const [historyBump, setHistoryBump] = useState(0);
  // GoalsTab passes a fresh function each render; the drop-down's history
  // effect needs a stable one.
  const eventsRef = useRef(onEvents);
  eventsRef.current = onEvents;
  const fetchEvents = useCallback(goalId => eventsRef.current(goalId), []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const today = localToday();
  const categories = [...new Set(partners.map(p => p.category).filter(Boolean))].sort();
  const shown = partners.filter(p =>
    (!filters.category || p.category === filters.category)
    && (!filters.tiers.length || filters.tiers.includes(p.tier))
    && (!filters.stale || isStalePartner(p, Date.now(), today))
    && (!filters.hot || p.hot)
    && (!filters.owner || (p.owner_user_id || 'unassigned') === filters.owner)
    && (!filters.status || statusOf(p) === filters.status)
    && (!filters.ids || filters.ids.includes(p.id)));
  const stale = partners.filter(p => isStalePartner(p, Date.now(), today)).sort((a, b) => daysSinceTouch(b) - daysSinceTouch(a));
  const filtering = filters.category || filters.tiers.length || filters.stale || filters.hot || filters.owner || filters.status || filters.ids;

  const showToast = t => {
    clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), UNDO_MS);
  };
  const signal = async (p, s) => {
    onReplace(predict(p, s));
    try {
      const { goal, event } = await onSignal(p.id, s);
      onReplace(goal);
      showToast({ text: `${p.name} ${SIGNAL_TEXT[s.type](s)}`, goalId: p.id, eventId: event.id });
    } catch (e) { onReplace(p); throw e; }
  };
  const undo = async () => {
    if (!toast) return;
    clearTimeout(toastTimer.current);
    setToast(t => ({ ...t, busy: true }));
    try { const { goal } = await onUndo(toast.goalId, toast.eventId); onReplace(goal); setToast(null); setHistoryBump(n => n + 1); }
    catch (e) { setToast(t => ({ ...t, busy: false, error: e.message })); toastTimer.current = setTimeout(() => setToast(null), UNDO_MS); }
  };
  // Workflow rows: the toast says what happened and what's next; a teammate's
  // change in between (409) reloads the list instead of failing quietly.
  const workflowSignal = async (p, sig, what) => {
    onReplace(predict(p, sig));
    try {
      const { goal, event } = await onSignal(p.id, sig);
      onReplace(goal);
      let text = `${p.name} ${what || SIGNAL_TEXT[sig.type](sig)}`;
      if (goal.pipeline_status !== p.pipeline_status) {
        const nx = nextStepFor(goal.pipeline_status);
        text = `${p.name} → ${what || stageName(goal.pipeline_status)}${goal.pipeline_status === 'live' ? ' · live' : nx ? ` · Next: ${nx.label.toLowerCase()}` : ''}`;
        const m = { ...moved, [p.id]: `Moved to ${stageName(goal.pipeline_status)} · today` };
        setMoved(m); writeMoved(m);
      }
      showToast({ text, goalId: p.id, eventId: event.id });
      setHistoryBump(n => n + 1);
      return goal;
    } catch (e) {
      onReplace(p);
      if (/changed by someone else|already /i.test(e.message)) { await onRefresh(); showToast({ error: CHANGED_TEXT }); }
      else showToast({ error: e.message });
      return null;
    }
  };
  // Paused resumes to the stage it was paused from (latest move into paused).
  const nextFor = async p => {
    if (p.pipeline_status === 'paused') {
      const events = await onEvents(p.id).catch(() => []);
      const pause = events.find(e => e.to_status === 'paused' && e.event !== 'undo');
      const to = pause?.from_status && pause.from_status !== 'paused' ? pause.from_status : 'not_started';
      return workflowSignal(p, { type: 'status', to, expect: 'paused' }, `resumed at ${stageName(to)}`);
    }
    const nx = nextStepFor(p.pipeline_status);
    return nx && workflowSignal(p, { type: 'status', to: nx.to, expect: p.pipeline_status || 'not_started' }, nx.label);
  };
  const rowActions = p => (canEdit ? { members, onNext: nextFor, onSignal: sig => workflowSignal(p, sig) } : null);
  const rank = async (goalId, order) => {
    try { await onRank(goalId, order); } catch (e) { showToast({ error: e.message }); }
  };

  const openPartner = id => { setOpenId(id); setFocus({ id }); };
  // GoalsTab passes fresh functions each render; the drop-down's effects need stable ones.
  const peopleRef = useRef({ onPeople, onAddPerson, onDeletePerson });
  peopleRef.current = { onPeople, onAddPerson, onDeletePerson };
  const people = useMemo(() => ({ load: id => peopleRef.current.onPeople(id), add: (id, body) => peopleRef.current.onAddPerson(id, body), remove: (id, pid) => peopleRef.current.onDeletePerson(id, pid) }), []);
  const domainsRef = useRef({ onDomains, onAddDomain, onUpdateDomain, onDeleteDomain, onAllDomains });
  domainsRef.current = { onDomains, onAddDomain, onUpdateDomain, onDeleteDomain, onAllDomains };
  const bumpDomains = () => setDomainBump(k => k + 1);
  const domains = useMemo(() => ({
    load: id => domainsRef.current.onDomains(id),
    add: (id, body) => domainsRef.current.onAddDomain(id, body).then(d => { bumpDomains(); return d; }),
    update: (id, did, body) => domainsRef.current.onUpdateDomain(id, did, body).then(d => { bumpDomains(); return d; }),
    remove: (id, did) => domainsRef.current.onDeleteDomain(id, did).then(d => { bumpDomains(); return d; }),
  }), []);
  const loadAllDomains = useCallback(() => domainsRef.current.onAllDomains(), [domainBump]);
  useEffect(() => {
    if (!canEdit) return;
    let live = true;
    loadAllDomains().then(d => live && setDomainSummary(d)).catch(() => {});
    return () => { live = false; };
  }, [canEdit, loadAllDomains]);
  const pendingCount = domainSummary?.counts?.pending || 0;
  const onCount = useCallback((id, n) => onReplace({ id, people_count: n }), [onReplace]);
  const details = { canEdit, onUpdate, onEvents: fetchEvents, bump: historyBump, tasksFor, people, domains, onCreateTask, onCount };

  // partner-360-v1 Stage 3 - one Sync now with the partner-people step forced;
  // the toast reports what Apollo gave and what it cost.
  const refreshPeople = async () => {
    setPeopleBusy(true);
    try {
      const r = await onRefreshPeople();
      const c = r.partner_contacts;
      showToast({ noUndo: true, text: c ? `People refreshed · ${c.contacts_seen} from Apollo at ${c.partners_synced} of ${c.partners_matched} matched partners · ${c.calls} Apollo call${c.calls === 1 ? '' : 's'}` : 'Sync ran, but the partner-people step reported nothing - check the sync status' });
      onRefresh(); setHistoryBump(k => k + 1);
    } catch (e) { showToast({ error: e.message }); }
    finally { setPeopleBusy(false); }
  };
  const setModeSaved = m => { setMode(m); writeMode(m); };
  const toggleTier = t => setFilters(f => ({ ...f, tiers: f.tiers.includes(t) ? f.tiers.filter(x => x !== t) : [...f.tiers, t] }));

  const render = p => (
    <PartnerCard key={p.id} partner={p} open={openId === p.id} onToggle={() => setOpenId(openId === p.id ? null : p.id)} today={today}
      canEdit={canEdit} members={members} lookup={lookup} onUpdate={onUpdate} onSignal={signal} />
  );

  const ownerParts = [...members.map(m => ({ id: m.user_id, label: lookup(m.user_id).first, count: partners.filter(p => p.owner_user_id === m.user_id).length, color: lookup(m.user_id).color }))].filter(x => x.count);
  const unowned = partners.filter(p => !p.owner_user_id).length;
  if (unowned) ownerParts.push({ id: 'unassigned', label: 'Unassigned', count: unowned, color: lookup(null).color });
  const statusParts = PIPELINE_STATUSES.map(s => ({ id: s.id, label: s.label, count: partners.filter(p => statusOf(p) === s.id).length, color: statusColor(s.id) })).filter(x => x.count);
  const ownerPart = ownerParts.find(x => x.id === filters.owner);
  const statusPart = statusParts.find(x => x.id === filters.status);
  const setOwner = id => setFilters(f => ({ ...f, owner: id }));
  const setStatus = id => setFilters(f => ({ ...f, status: id }));


  const add = async () => {
    if (!draft.name.trim()) return;
    setAddError('');
    try { await onCreate({ name: draft.name.trim(), priority: draft.priority ? Number(draft.priority) : null }); setDraft({ name: '', priority: '1' }); setAdding(false); }
    catch (e) { setAddError(e.message); }
  };

  return (
    <section style={cardStyle} aria-labelledby="h-part">
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 260px' }}>
          <span style={labelStyle}>Partner goals</span>
          <h2 style={h2Style} id="h-part">Partnerships to land</h2>
          <span style={subStyle}>Click a partner for contacts, sequence, next step and what to watch out for. Buttons log every change.</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Ring parts={ownerParts} center={String(partners.length)} size={80} stroke={12} track={!partners.length} label="Partners by owner" onSelect={setOwner} selected={filters.owner} />
            <RingLegend parts={ownerParts} onSelect={setOwner} selected={filters.owner} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Ring parts={statusParts} center={String(partners.length)} size={80} stroke={12} track={!partners.length} label="Partners by pipeline status" onSelect={setStatus} selected={filters.status} />
            <RingLegend parts={statusParts} onSelect={setStatus} selected={filters.status} />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 20 }}>
        <div role="group" aria-label="Layout" style={{ display: 'inline-flex', gap: 4, padding: 3, borderRadius: 999, background: SA.inset, border: `1px solid ${SA.border}` }}>
          {MODES.map(([id, label]) => <button key={id} type="button" aria-pressed={mode === id} onClick={() => setModeSaved(id)} style={{ ...pill(mode === id), border: 'none' }}>{label}</button>)}
        </div>
        <select aria-label="Category" value={filters.category} onChange={e => setFilters(f => ({ ...f, category: e.target.value }))} style={{ ...inputStyle, height: 32, width: 'auto', maxWidth: '100%', borderRadius: 999, fontSize: 13 }}>
          <option value="">All categories</option>
          {categories.map(c => <option key={c} value={c}>{c.replace(/^\d+\.\s*/, '')}</option>)}
        </select>
        {TIERS.map(t => <button key={t} type="button" aria-pressed={filters.tiers.includes(t)} onClick={() => toggleTier(t)} style={pill(filters.tiers.includes(t))}>{tierLabel(t)}</button>)}
        <button type="button" aria-pressed={filters.stale} onClick={() => setFilters(f => ({ ...f, stale: !f.stale }))} style={pill(filters.stale)}>Stale only</button>
        <button type="button" aria-pressed={filters.hot} onClick={() => setFilters(f => ({ ...f, hot: !f.hot }))} style={pill(filters.hot)}>🔥 Hot only</button>
        {(filtering || stage) && <button type="button" onClick={() => { setFilters(NO_FILTERS); setStage(null); }} style={{ ...pill(false), border: 'none', background: 'transparent', color: SA.link }}>Clear</button>}
        <span style={{ ...subStyle, ...numStyle, fontSize: 13 }}>{shown.length} of {partners.length}</span>
        {canEdit && pendingCount > 0 && <button type="button" aria-expanded={reviewOpen} onClick={() => { setReviewOpen(o => !o); setExportOpen(false); setBulkOpen(false); }} style={{ ...pill(reviewOpen), marginLeft: 'auto' }}>Review domains ({pendingCount})</button>}
        {canEdit && <button type="button" aria-expanded={exportOpen} onClick={() => { setExportOpen(o => !o); setReviewOpen(false); setBulkOpen(false); }} style={{ ...pill(exportOpen), marginLeft: pendingCount > 0 ? 0 : 'auto' }}>Export to Apollo (CSV)</button>}
        {canEdit && <button type="button" aria-expanded={bulkOpen} onClick={() => { setBulkOpen(o => !o); setExportOpen(false); setReviewOpen(false); }} style={pill(bulkOpen)}>＋ Log touches</button>}
        {canEdit && <button type="button" onClick={refreshPeople} disabled={peopleBusy} title="Pull the people Apollo knows at partners with a confirmed domain (runs a Sync now)" style={{ ...pill(false), opacity: peopleBusy ? 0.6 : 1 }}>{peopleBusy ? 'Refreshing people…' : '↻ Refresh partner people'}</button>}
      </div>
      {reviewOpen && canEdit && domainSummary && <DomainReview suggestions={domainSummary.suggestions || []} onAdd={domains.add} onChanged={bumpDomains} onClose={() => setReviewOpen(false)} />}
      {exportOpen && canEdit && <ApolloExport load={loadAllDomains} csvUrl={csvUrl} onClose={() => setExportOpen(false)} />}
      {bulkOpen && canEdit && (
        <BulkTouchLog partners={partners} onPreview={touches => onTouches({ dry_run: true, touches })} onApply={touches => onTouches({ touches })}
          onDone={n => { setBulkOpen(false); showToast({ text: `Logged ${n} touch${n === 1 ? '' : 'es'}`, noUndo: true }); onRefresh(); setHistoryBump(k => k + 1); }} onClose={() => setBulkOpen(false)} />
      )}
      {(filters.owner || filters.status || filters.ids) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {filters.ids && <ShowingChip label={filters.idsLabel || 'Selected partners'} count={partners.filter(p => filters.ids.includes(p.id)).length} onClear={() => setFilters(f => ({ ...f, ids: null, idsLabel: '' }))} />}
          {filters.owner && <ShowingChip label={`Owner ${filters.owner === 'unassigned' ? 'Unassigned' : lookup(filters.owner).first}`} count={ownerPart?.count ?? 0} onClear={() => setOwner(null)} />}
          {filters.status && <ShowingChip label={statusLabel(filters.status)} count={statusPart?.count ?? 0} onClear={() => setStatus(null)} />}
        </div>
      )}

      <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 10, background: SA.inset, border: `1px solid ${stale.length ? SA.bad : SA.border}` }} aria-label="Stale partners">
        <span style={labelStyle}>Stale · 7+ days without a touch</span>
        {!stale.length
          ? <div style={{ ...subStyle, fontSize: 13, marginTop: 4 }}>Nothing stale. Partners you haven't contacted yet don't count.</div>
          : <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {stale.map(p => (
                <Chip key={p.id} role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => openPartner(p.id)} onKeyDown={e => { if (e.key === 'Enter') openPartner(p.id); }}>
                  <span style={{ color: SA.bad, ...numStyle }}>{daysSinceTouch(p)}d</span>{p.name} · {lookup(p.owner_user_id).first}
                </Chip>
              ))}
            </div>}
      </div>

      {error && <div style={{ marginTop: 12 }}><ErrorNote message={error.message} /></div>}
      {!error && !partners.length && <p style={{ ...subStyle, margin: '20px 0 0' }}>No partners yet{canEdit ? ' — add your first' : ''}.</p>}
      {!error && partners.length > 0 && !shown.length && <p style={{ ...subStyle, margin: '20px 0 0' }}>No partners match these filters.</p>}

      {shown.length > 0 && mode === 'workflow' && <WorkflowView partners={partners} shown={shown} lookup={lookup} compact={compact} stage={stage} onStage={setStage}
        rowActions={rowActions} onRank={canEdit && teamView && !filtering ? rank : null} movedNotes={moved} canEdit={canEdit} details={details} focus={focus} />}
      {shown.length > 0 && mode !== 'workflow' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginTop: 20 }}>
          {PIPELINE_STATUSES.map(s => {
            const items = shown.filter(p => statusOf(p) === s.id);
            if (!items.length) return null;
            const paused = s.id === 'paused';
            return <Column key={s.id} title={s.label} color={statusColor(s.id)} items={items} render={render}
              collapsed={paused && !showPaused} onCollapse={paused ? () => setShowPaused(v => !v) : null} />;
          })}
        </div>
      )}

      {canEdit && (adding
        ? <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input autoFocus placeholder="Partner name (Enter to save)" aria-label="Partner name" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') add(); if (e.key === 'Escape') setAdding(false); }} style={{ ...inputStyle, flex: '1 1 220px' }} />
            <select aria-label="Priority" value={draft.priority} onChange={e => setDraft(d => ({ ...d, priority: e.target.value }))} style={{ ...inputStyle, width: 'auto' }}>
              <option value="1">P1</option><option value="2">P2</option><option value="3">P3</option><option value="">Unprioritized</option>
            </select>
            <Btn primary style={{ height: 40 }} onClick={add} disabled={!draft.name.trim()}>Add</Btn>
            <Btn style={{ height: 40 }} onClick={() => setAdding(false)}>Cancel</Btn>
          </div>
        : <AddButton onClick={() => setAdding(true)}>+ Add partner</AddButton>)}
      {addError && <div style={{ marginTop: 8 }}><ErrorNote message={addError} /></div>}

      <div aria-live="polite" style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 3500, maxWidth: 'calc(100vw - 32px)' }}>
        {toast && (
          <div style={{ ...saSans, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 12, background: SA.surface2, border: `1px solid ${SA.borderStrong}`, boxShadow: '0 10px 30px #0008', fontSize: 14, color: SA.text }}>
            <span>{toast.error || toast.text}</span>
            {!toast.error && !toast.noUndo && <Btn style={{ height: 36 }} onClick={undo} disabled={toast.busy}>{toast.busy ? 'Undoing…' : 'Undo'}</Btn>}
          </div>
        )}
      </div>
    </section>
  );
}
