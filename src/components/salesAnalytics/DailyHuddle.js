import { useState, useEffect, useCallback, useRef } from 'react';
import { SA, SA_TYPE, SA_SHAPE, SA_BAD_BG, SA_BAD_BORDER, saSans } from './theme';
import { fetchRuns, triggerSync, fetchInsights } from './salesApi';
import { fetchHuddle, startHuddle, fetchCollateral, updateProspect, fetchFlags, flagProspect, unflag, reassignFlag, announceFlagsChanged, FLAGS_CHANGED } from './huddleApi';
import HuddleRow from './HuddleRow';
import HuddleFeed from './HuddleFeed';
import FlagDialog from './FlagDialog';
import FlaggedLane from './FlaggedLane';
import CollateralLibrary from './CollateralLibrary';
import HuddlePrintSheet from './HuddlePrintSheet';
import HuddlePartners from './HuddlePartners';
import RightRail from './RightRail';
import Ring, { RingLegend } from './charts/Ring';
import { goalsApi } from './goals/goalsApi';
import { memberLookup } from './goals/goalsUi';
import { exportWidgetCsv } from './exportCsv';
import { fetchMe } from '../../utils/authSession';
import { roleAtLeast } from '../../constants/roles';
import useMediaQuery from '../../utils/useMediaQuery';
import {
  OWNER_LABELS, NEXT_ACTION_LABELS, HEAT_LABELS, SORTS, applyFilters, sortProspects, needsAction, onAutopilot,
  byCompany, flagsFor,
} from './huddleView';

const UNDO_MS = 5000; // REVISABLE (spec)

const HUDDLE_SHEET_COLUMNS = [
  { label: 'Owner', value: p => OWNER_LABELS[p.owner] || p.owner },
  { label: 'Name', key: 'name' },
  { label: 'Title', key: 'title' },
  { label: 'Company', key: 'company' },
  { label: 'Status', key: 'status' },
  { label: 'Heat', key: 'score' },
  { label: 'Next best action', value: p => p.next_best_action.label },
  { label: 'Next action', value: p => NEXT_ACTION_LABELS[p.next_action] || '' },
  { label: 'Due', key: 'next_action_due' },
  { label: 'In pipeline', value: p => (p.in_pipeline ? 'yes' : '') },
  { label: 'Notes', key: 'notes' },
  { label: 'Last open/click', key: 'last_signal_at' },
  { label: 'LinkedIn', key: 'linkedin_url' },
  { label: 'Apollo', key: 'apollo_url' },
];

const DUE_OPTIONS = [['all', 'All'], ['overdue', 'Overdue'], ['today', 'Today'], ['week', 'This week'], ['none', 'No date']];
const HEAT_OPTIONS = [['all', 'All'], ['hot', 'Hot'], ['warm', 'Warm'], ['cold', 'Cold']];
const readOwner = () => { const o = new URLSearchParams(window.location.search).get('owner'); return ['jack', 'cyrus'].includes(o) ? o : 'team'; };

function fmtTime(iso) {
  return iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never';
}

function Section({ title, count, sub, children, empty }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <h2 style={{ ...SA_TYPE.cardTitle, fontSize: 17, color: SA.text, margin: 0 }}>{title}</h2>
        <span style={{ ...SA_TYPE.label, color: SA.faint }}>{count}{sub ? ` · ${sub}` : ''}</span>
      </div>
      {count === 0 ? <p style={{ fontSize: 13, color: SA.faint, margin: 0 }}>{empty}</p> : children}
    </section>
  );
}

const headerButton = { ...SA_TYPE.body, fontSize: 13, fontWeight: 500, background: 'transparent', color: SA.text, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusInner, padding: '0 16px', height: 44, cursor: 'pointer' };
const railCard = { background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusCard, padding: 18, display: 'flex', flexDirection: 'column', gap: 10 };
const railLabel = { ...SA_TYPE.label, color: SA.muted, fontWeight: 500 };
const scrollList = { display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 640, overflowY: 'auto', paddingRight: 4 };

function Segmented({ label, options, value, onChange, counts }) {
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map(([id, lb]) => {
        const on = value === id;
        return (
          <button key={id} type="button" aria-pressed={on} onClick={() => onChange(id)}
            style={{ ...saSans, height: 32, padding: '0 10px', borderRadius: 999, fontSize: 13, cursor: 'pointer', border: `1px solid ${on ? SA.accent : SA.border}`, background: on ? 'color-mix(in srgb, var(--sa-accent) 18%, transparent)' : SA.surface2, color: on ? SA.text : SA.soft }}>
            {lb}{counts && counts[id] != null ? <span style={{ color: SA.muted, marginLeft: 5 }}>{counts[id]}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export default function DailyHuddle({ businessId, focusContactId, onFocused }) {
  const [data, setData] = useState(null);
  const [collateral, setCollateral] = useState([]);
  const [lastRun, setLastRun] = useState(null);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [showLibrary, setShowLibrary] = useState(false);
  const [issues, setIssues] = useState(null);
  const [issuesError, setIssuesError] = useState('');
  const [members, setMembers] = useState([]);
  const [me, setMe] = useState(null);
  const [owner, setOwner] = useState(readOwner);
  const [filters, setFilters] = useState({ heat: 'all', due: 'all', stale: false, sort: 'signal', hideBots: true });
  const [feedKey, setFeedKey] = useState(0);
  const [flags, setFlags] = useState([]);
  const [flagging, setFlagging] = useState(null);
  const [openCompanies, setOpenCompanies] = useState(() => new Set());
  const [showAutopilot, setShowAutopilot] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const compact = useMediaQuery('(max-width: 1099px)');
  const phone = useMediaQuery('(max-width: 899px)');

  const load = useCallback(async () => {
    setError('');
    try {
      const [huddle, items, runs] = await Promise.all([fetchHuddle(businessId), fetchCollateral(businessId), fetchRuns(businessId, 1)]);
      setData(huddle);
      setCollateral(items);
      setLastRun(runs[0] || null);
    } catch (e) {
      setError(e.message);
    }
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  // Separate from load(): insights take ~1-3s and shouldn't hold up the rows.
  // info-level (R10 "back in the green") isn't an issue.
  useEffect(() => {
    fetchInsights(businessId)
      .then(d => setIssues((d.insights || []).filter(i => i.severity !== 'info').slice(0, 2)))
      .catch(e => setIssuesError(e.message));
  }, [businessId]);

  // Owner chips use the Goals member colors. Huddle owners are still the
  // jack/cyrus/unassigned slugs, matched to members by first name.
  useEffect(() => { goalsApi.members(businessId).then(setMembers).catch(() => setMembers([])); }, [businessId]);
  useEffect(() => { fetchMe().then(setMe).catch(() => setMe(null)); }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const loadFlags = useCallback(() => fetchFlags(businessId).then(setFlags).catch(e => setMessage(e.message)), [businessId]);
  useEffect(() => {
    loadFlags();
    window.addEventListener(FLAGS_CHANGED, loadFlags);
    return () => window.removeEventListener(FLAGS_CHANGED, loadFlags);
  }, [loadFlags]);

  // ?owner= is shared with the Goals tab, so a link opens the same person.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (owner === 'team') url.searchParams.delete('owner'); else url.searchParams.set('owner', owner);
    window.history.replaceState({}, '', url);
  }, [owner]);

  const reloadCollateral = async () => setCollateral(await fetchCollateral(businessId));

  const handleSync = async () => {
    setSyncing(true);
    setMessage('');
    try {
      const run = await triggerSync(businessId);
      setMessage(run.status === 'success' ? 'Sync complete.' : `Sync finished: ${run.status}`);
      await load();
      setFeedKey(k => k + 1);
    } catch (e) {
      setMessage(e.message);
    } finally {
      setSyncing(false);
    }
  };

  const handleStart = async () => {
    try {
      const huddle = await startHuddle(businessId);
      setData(d => ({ ...d, last_huddle: huddle }));
    } catch (e) {
      setMessage(e.message);
    }
  };

  // The server sends the raw sales_prospect_state row back; computed fields
  // (score, badges, heat band) stay as they were until the next load.
  const handleUpdated = row => {
    setData(d => ({ ...d, prospects: d.prospects.map(p => (p.contact_id === row.contact_id ? { ...p, ...row } : p)) }));
  };

  const showToast = (text, undoFn) => {
    clearTimeout(toastTimer.current);
    setToast({ text, undo: undoFn });
    toastTimer.current = setTimeout(() => setToast(null), UNDO_MS);
  };
  // One-click row actions: optimistic, then the PATCH (its trigger logs
  // who/when), then a 5-second undo that PATCHes the previous values back.
  const act = async (p, patch, label) => {
    const prev = Object.fromEntries(Object.keys(patch).map(k => [k, p[k] ?? null]));
    handleUpdated({ contact_id: p.contact_id, ...patch });
    try {
      handleUpdated(await updateProspect(businessId, p.contact_id, patch));
    } catch (e) { handleUpdated({ contact_id: p.contact_id, ...prev }); throw e; }
    // Undo only if the fields still hold what this click set (409 otherwise).
    showToast(`${p.name || 'Prospect'} ${label}`, async () => handleUpdated(await updateProspect(businessId, p.contact_id, { ...prev, expect: patch })));
  };
  const undo = async () => {
    if (!toast) return;
    clearTimeout(toastTimer.current);
    const t = toast;
    setToast({ ...t, busy: true });
    try { await t.undo(); setToast(null); }
    catch (e) { setToast({ ...t, error: e.message }); toastTimer.current = setTimeout(() => setToast(null), UNDO_MS); }
  };
  // 🚩 Flag for ...: one Goals to-do + steps; undo deletes it and puts the
  // owner back if the flag had claimed an unassigned prospect.
  const submitFlag = async (p, body) => {
    const r = await flagProspect(businessId, p.contact_id, body);
    handleUpdated(r.prospect);
    setFlagging(null);
    await loadFlags(); announceFlagsChanged();
    const who = members.find(m => m.user_id === body.assignee_user_id)?.name.split(' ')[0] || 'teammate';
    showToast(`${p.name || 'Prospect'} flagged for ${who}`, async () => {
      const u = await unflag(businessId, r.todo.id, r.prospect.owner !== r.prev_owner ? r.prev_owner : null, r.prospect.owner);
      if (u.prospect) handleUpdated(u.prospect);
      await loadFlags(); announceFlagsChanged();
    });
  };
  // Optimistic tick, so the box responds at once; reverts if the save fails.
  // "Reassign instead" (one open flag per prospect): moves the flag's to-do.
  const submitReassign = async (p, goalId, assignee) => {
    const r = await reassignFlag(businessId, goalId, assignee);
    setFlagging(null);
    await loadFlags(); announceFlagsChanged();
    const who = members.find(m => m.user_id === assignee)?.name.split(' ')[0] || 'teammate';
    showToast(`${p.name || 'Prospect'}'s flag moved to ${who}`, async () => {
      await reassignFlag(businessId, goalId, r.from_user_id);
      await loadFlags(); announceFlagsChanged();
    });
  };
  const toggleFlagStep = async (f, step) => {
    const setStep = val => setFlags(fs => fs.map(x => (x.id === f.id ? { ...x, steps: x.steps.map(st => (st.id === step.id ? val : st)) } : x)));
    setStep({ ...step, done: !step.done });
    try { setStep(await goalsApi.updateStep(businessId, step.id, { done: !step.done })); }
    catch (e) { setStep(step); throw e; }
    announceFlagsChanged();
  };
  const completeFlag = async f => {
    await goalsApi.updateWeekGoal(businessId, f.id, { status: 'done' });
    handleUpdated(await updateProspect(businessId, f.prospect_contact_id, { status: 'contacted' }));
    await loadFlags(); announceFlagsChanged();
  };

  const myRole = me?.memberships?.find(m => m.business_id === businessId)?.role;
  const canEdit = !!me && (me.profile?.is_platform_owner || roleAtLeast(myRole, 'member'));

  const today = data?.today;
  const lastHuddleAt = data?.last_huddle?.huddle_at;
  const isSnoozed = p => p.status === 'not_now' && (!p.snooze_until || p.snooze_until > today);
  const visible = (data?.prospects || []).filter(p => p.status !== 'dead' && !isSnoozed(p));
  const hiddenByHuddle = { snoozed: (data?.prospects || []).filter(isSnoozed).length, dead: (data?.prospects || []).filter(p => p.status === 'dead').length };
  const hidden = { ...data?.excluded, ...hiddenByHuddle };
  const nameById = new Map((data?.prospects || []).map(p => [p.contact_id, p.name]));
  const done = data?.done_recent || [];

  const f = { ...filters, owner };
  const shown = data ? applyFilters(visible, f, today) : [];
  const needs = sortProspects(shown.filter(p => needsAction(p, today)), filters.sort, today);
  const autopilot = sortProspects(shown.filter(p => onAutopilot(p, today)), filters.sort, today);
  const companies = byCompany(shown, filters.sort, today);
  // Rail counts ignore their own filter, so each option shows what it would give.
  const heatCounts = data ? Object.fromEntries(HEAT_OPTIONS.map(([id]) => [id, applyFilters(visible, { ...f, heat: id }, today).length])) : {};
  const dueCounts = data ? Object.fromEntries(DUE_OPTIONS.map(([id]) => [id, applyFilters(visible, { ...f, due: id }, today).length])) : {};
  const teamNeeds = data ? applyFilters(visible, { ...f, owner: 'team' }, today).filter(p => needsAction(p, today)) : [];
  const doneToday = done.filter(e => new Date(e.changed_at).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }) === today).length;

  const lookup = memberLookup(members);
  const ownerColor = slug => lookup(members.find(m => m.name.split(' ')[0].toLowerCase() === slug)?.user_id).color;
  const people = [{ id: 'team', name: 'Team', color: SA.accent }, { id: 'jack', name: 'Jack', color: ownerColor('jack') }, { id: 'cyrus', name: 'Cyrus', color: ownerColor('cyrus') }];
  const ownerParts = ['jack', 'cyrus', 'unassigned'].map(o => ({ label: OWNER_LABELS[o], count: teamNeeds.filter(p => p.owner === o).length, color: ownerColor(o) })).filter(x => x.count);

  const bandById = new Map((data?.prospects || []).map(p => [p.contact_id, p.heat_band]));
  const staleById = new Map((data?.prospects || []).map(p => [p.contact_id, p.stale]));
  // Feed "Open": jump to the prospect's row, opening its company group if
  // that's the only place it's listed.
  const openProspect = contactId => {
    const jump = () => {
      const el = document.getElementById(`huddle-card-${contactId}`);
      if (!el) return false;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.animate([{ boxShadow: `0 0 0 2px ${SA.accent}` }, { boxShadow: '0 0 0 0 transparent' }], { duration: 1600 });
      return true;
    };
    if (jump()) return;
    const p = shown.find(x => x.contact_id === contactId);
    if (!p) { setMessage('That prospect isn\'t in the list right now (snoozed, excluded, or filtered out).'); return; }
    setOpenCompanies(set => new Set(set).add((p.company || 'No company').trim()));
    setTimeout(jump, 60);
  };
  const since = data?.since_last_huddle;
  const prospectsById = new Map((data?.prospects || []).map(p => [p.contact_id, p]));
  const myFlags = me ? flagsFor(flags, me.profile.id) : [];
  const onFlag = canEdit ? p => setFlagging(p) : null;
  // Arriving from a Goals to-do ("Open in Huddle"): jump once the rows exist.
  useEffect(() => {
    if (!focusContactId || !data) return;
    const t = setTimeout(() => { openProspect(focusContactId); onFocused?.(); }, 200);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusContactId, !!data]);

  const row = p => (
    <HuddleRow key={p.contact_id} businessId={businessId} p={p} today={today} canEdit={canEdit} ownerColor={ownerColor} onAct={act} onFlag={onFlag} stacked={phone}
      collateral={collateral} isNewSinceHuddle={!!lastHuddleAt && p.created_at > lastHuddleAt} onUpdated={handleUpdated} />
  );
  const dateLabel = today ? new Date(`${today}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';

  const rail = (
    <RightRail label="Huddle filters" moreLabel="filters & summary" people={people} owner={owner} onOwner={setOwner} compact={compact}>
      <div style={railCard}>
        <span style={railLabel}>Heat</span>
        <Segmented label="Heat" options={HEAT_OPTIONS} value={filters.heat} counts={heatCounts} onChange={v => setFilters(x => ({ ...x, heat: v }))} />
        <span style={railLabel}>Due</span>
        <Segmented label="Due" options={DUE_OPTIONS} value={filters.due} counts={dueCounts} onChange={v => setFilters(x => ({ ...x, due: v }))} />
        <label style={railLabel} htmlFor="huddle-sort">Sort</label>
        <select id="huddle-sort" value={filters.sort} onChange={e => setFilters(x => ({ ...x, sort: e.target.value }))}
          style={{ ...saSans, height: 36, borderRadius: 10, background: SA.inset, border: `1px solid ${SA.border}`, color: SA.text, padding: '0 10px', fontSize: 14 }}>
          {Object.entries(SORTS).map(([id, s]) => <option key={id} value={id}>{s.label}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: SA.soft, cursor: 'pointer', minHeight: 32 }}>
          <input type="checkbox" checked={filters.hideBots} onChange={e => setFilters(x => ({ ...x, hideBots: e.target.checked }))} /> Hide bot opens
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: SA.soft, cursor: 'pointer', minHeight: 32 }}>
          <input type="checkbox" checked={filters.stale} onChange={e => setFilters(x => ({ ...x, stale: e.target.checked }))} /> Stale only (7+ days)
        </label>
      </div>
      <div style={railCard}>
        <span style={railLabel}>Today's actions</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Ring parts={ownerParts} center={String(teamNeeds.length)} size={80} stroke={12} track={!teamNeeds.length} label="Today's actions by owner" />
          <RingLegend parts={ownerParts} />
        </div>
        <span style={{ fontSize: 13, color: SA.muted }}>{doneToday} done today</span>
      </div>
      <div style={railCard}>
        <span style={railLabel}>Top sequence issues</span>
        {issuesError ? <p style={{ fontSize: 13, color: SA.warn, margin: 0 }}>⚠ {issuesError}</p>
          : issues === null ? <p style={{ fontSize: 13, color: SA.faint, margin: 0 }}>Checking sequences…</p>
          : !issues.length ? <p style={{ fontSize: 13, color: SA.faint, margin: 0 }}>No sequence issues flagged.</p>
          : issues.map(i => (
            <div key={`${i.id}:${i.scope_key}`} title={i.evidence} style={{ borderLeft: `3px solid ${i.severity === 'bad' ? SA.bad : SA.warn}`, paddingLeft: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: SA.text }}>{i.title}</div>
              <div style={{ fontSize: 12, color: SA.muted, marginTop: 2 }}>{i.action}</div>
            </div>
          ))}
      </div>
    </RightRail>
  );

  // The screen is display:none in print (no-print) - visibility:hidden alone
  // keeps its height and printed a page per screenful. Only the agenda prints.
  return (
    <>
    <div className="no-print">
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 24, marginBottom: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ ...SA_TYPE.label, color: SA.muted }}>HomeLover · Command Center</div>
          <h1 style={{ margin: 0, ...SA_TYPE.pageTitle, color: SA.text }}>Daily Huddle{dateLabel && ` · ${dateLabel}`}</h1>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: SA.muted }}>
            <span>As of last sync {fmtTime(lastRun?.finished_at)}</span>
            <span>Last huddle {fmtTime(lastHuddleAt)}</span>
          </div>
          {message && <span style={{ fontSize: 12, color: SA.warn }}>{message}</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setShowLibrary(s => !s)} style={headerButton}>{showLibrary ? 'Hide library' : 'Collateral library'}</button>
          <button onClick={() => exportWidgetCsv('huddle_sheet', [...visible].sort((a, b) => a.owner.localeCompare(b.owner) || b.score - a.score), HUDDLE_SHEET_COLUMNS)}
            disabled={!data} style={headerButton}>Huddle sheet CSV</button>
          <button onClick={() => window.print()} disabled={!data} style={headerButton}>Print agenda</button>
          <button onClick={handleSync} disabled={syncing} style={{ ...headerButton, opacity: syncing ? 0.6 : 1 }}>{syncing ? 'Syncing…' : 'Sync now'}</button>
          <button onClick={handleStart} style={{ ...headerButton, fontWeight: 600, background: SA.accent, color: SA.ground, border: 0 }}>Start huddle</button>
        </div>
      </div>

      {error && (
        <div style={{ fontSize: 13, color: SA.bad, padding: '10px 14px', background: SA_BAD_BG, border: `1px solid ${SA_BAD_BORDER}`, borderRadius: SA_SHAPE.radiusInner, marginBottom: 16 }}>⚠ {error}</div>
      )}

      {showLibrary && <CollateralLibrary businessId={businessId} items={collateral} onChanged={reloadCollateral} />}

      {!data ? (
        !error && <p style={{ ...SA_TYPE.body, fontSize: 13, color: SA.muted }}>Loading…</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: compact ? 'column' : 'row', gap: 24, alignItems: 'flex-start' }}>
          {compact && <div style={{ width: '100%' }}>{rail}</div>}
          <main style={{ flex: '1 1 0', minWidth: 0, width: '100%' }}>
            {since && (
              <div aria-label="Since last huddle" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '6px 16px', padding: '10px 14px', marginBottom: 20, borderRadius: SA_SHAPE.radiusInner, background: SA.inset, border: `1px solid ${SA.border}`, fontSize: 13, color: SA.soft }}>
                <span style={{ ...SA_TYPE.label, color: SA.muted }}>{lastHuddleAt ? `Since last huddle · ${fmtTime(lastHuddleAt)}` : 'Last 24 hours'}</span>
                {[[since.replies, 'replies'], [since.real_clicks, 'real clicks'], [since.real_opens, 'real opens'], [since.bot_hidden, 'bot opens hidden'], [since.done, 'done']].map(([n, lb]) => (
                  <span key={lb}><b style={{ color: SA.text, fontVariantNumeric: 'tabular-nums' }}>{n}</b> {lb}</span>
                ))}
              </div>
            )}
            <FlaggedLane flags={myFlags} prospectsById={prospectsById} lookup={lookup} canEdit={canEdit}
              onToggleStep={toggleFlagStep} onComplete={completeFlag} onOpen={openProspect} />
            <HuddlePartners businessId={businessId} />

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 460px), 1fr))', gap: '0 24px', alignItems: 'start' }}>
              <Section title="Needs action today" count={needs.length} sub="sorted by signal" empty="Nothing urgent for these filters — sequences are running.">
                <div className="sa-scroll" style={scrollList}>{needs.map(row)}</div>
              </Section>
              <HuddleFeed businessId={businessId} reloadKey={feedKey} today={today} lastHuddleAt={lastHuddleAt} filters={{ owner, heat: filters.heat, stale: filters.stale, hideBots: filters.hideBots }}
                bandById={bandById} staleById={staleById} ownerColor={ownerColor} onOpen={openProspect}
                onFlag={onFlag && (id => { const p = prospectsById.get(id); if (p) onFlag(p); else setMessage('That prospect isn\'t in the Huddle list, so it can\'t be flagged from here.'); })} />
            </div>

            <Section title="By company" count={companies.length} empty="No companies for these filters.">
              <div className="sa-scroll" style={{ ...scrollList, gap: 6 }}>
                {companies.map(c => {
                  const open = openCompanies.has(c.company);
                  return (
                    <div key={c.company}>
                      <button type="button" aria-expanded={open} onClick={() => setOpenCompanies(s => { const n = new Set(s); if (n.has(c.company)) n.delete(c.company); else n.add(c.company); return n; })}
                        style={{ ...saSans, width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: SA_SHAPE.radiusInner, background: SA.surface, border: `1px solid ${SA.border}`, color: SA.text, cursor: 'pointer', textAlign: 'left', fontSize: 14 }}>
                        <span style={{ color: SA.muted }}>{open ? '▾' : '▸'}</span>
                        <span style={{ fontWeight: 600, flex: '1 1 auto', minWidth: 0 }}>{c.company}</span>
                        <span style={{ fontSize: 12, color: SA.muted }}>{c.people.length} {c.people.length === 1 ? 'person' : 'people'}</span>
                        <span style={{ fontSize: 12, color: SA.soft }}>{HEAT_LABELS[c.band]}</span>
                        {c.owners.map(o => <span key={o} title={OWNER_LABELS[o]} style={{ width: 8, height: 8, borderRadius: 999, background: ownerColor(o) }} />)}
                      </button>
                      {open && <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0 4px 16px' }}>{c.people.map(row)}</div>}
                    </div>
                  );
                })}
              </div>
            </Section>

            <section style={{ marginBottom: 24 }}>
              <button type="button" aria-expanded={showAutopilot} onClick={() => setShowAutopilot(s => !s)}
                style={{ ...saSans, width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: SA_SHAPE.radiusInner, background: SA.inset, border: `1px dashed ${SA.borderStrong}`, color: SA.soft, cursor: 'pointer', textAlign: 'left', fontSize: 14 }}>
                <span style={{ color: SA.muted }}>{showAutopilot ? '▾' : '▸'}</span>
                <span style={{ flex: 1 }}>On autopilot — letting the sequence run</span>
                <span style={{ ...SA_TYPE.label, color: SA.faint }}>{autopilot.length}</span>
              </button>
              {showAutopilot && <div className="sa-scroll" style={{ ...scrollList, marginTop: 8 }}>{autopilot.map(row)}</div>}
            </section>

            <details style={{ marginBottom: 16 }}>
              <summary style={{ ...SA_TYPE.cardTitle, color: SA.text, cursor: 'pointer' }}>
                Done since yesterday <span style={{ ...SA_TYPE.label, color: SA.faint }}>{done.length}</span>
              </summary>
              {done.length === 0 ? (
                <p style={{ fontSize: 13, color: SA.faint }}>Nothing marked Contacted or Booked yesterday or today.</p>
              ) : (
                <ul style={{ fontSize: 13, color: SA.muted, paddingLeft: 18 }}>
                  {done.map(e => (
                    <li key={`${e.contact_id}:${e.changed_at}`}>
                      {nameById.get(e.contact_id) || e.contact_id} → {e.to_value} · {fmtTime(e.changed_at)}{e.changed_by ? ` · ${e.changed_by}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </details>

            {Object.values(hidden).some(Boolean) && (
              <p style={{ fontSize: 12, color: SA.faint }}>
                Hidden: {Object.entries(hidden).filter(([, n]) => n).map(([k, n]) => `${n} ${k.replace(/_/g, ' ')}`).join(' · ')}
              </p>
            )}
          </main>
          {!compact && <div style={{ flex: '0 0 300px', minWidth: 0 }}>{rail}</div>}
        </div>
      )}

      {flagging && (
        <FlagDialog p={flagging} members={members} myUserId={me?.profile?.id} today={today}
          onSubmit={body => submitFlag(flagging, body)} onReassign={(goalId, assignee) => submitReassign(flagging, goalId, assignee)} onClose={() => setFlagging(null)} />
      )}

      <div aria-live="polite" style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 3500, maxWidth: 'calc(100vw - 32px)' }}>
        {toast && (
          <div style={{ ...saSans, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 12, background: SA.surface2, border: `1px solid ${SA.borderStrong}`, boxShadow: '0 10px 30px #0008', fontSize: 14, color: SA.text }}>
            <span>{toast.error || toast.text}</span>
            {!toast.error && <button type="button" onClick={undo} disabled={toast.busy} style={{ ...headerButton, height: 36 }}>{toast.busy ? 'Undoing…' : 'Undo'}</button>}
          </div>
        )}
      </div>
    </div>
    {data && <HuddlePrintSheet dateLabel={dateLabel} since={since} needs={sortProspects(visible.filter(p => needsAction(p, today)), 'signal', today)} prospects={visible}
      flags={flags} memberSlug={id => { const m = members.find(x => x.user_id === id); const f = m && m.name.split(' ')[0].toLowerCase(); return ['jack', 'cyrus'].includes(f) ? f : 'unassigned'; }}
      issues={issues || []} today={today} />}
    </>
  );
}
