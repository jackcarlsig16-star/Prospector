import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createShellRegistry, settingsFor, canAdd } from '../shell/shellRegistry';
import { staysInPanel } from '../shell/askRules';
import ShellSearch, { FOCUS_FIELD } from '../shell/ShellSearch';
import Icon from '../shell/icons';
import { SALES_SHELL } from './salesAnalytics/shellEntry';
import { workspaceNav } from '../constants/businessNav';
import { readNav, SALES_NAV } from './salesAnalytics/salesNav';
import AttentionDrawer from './salesAnalytics/goals/AttentionDrawer';
import { goalsApi, TODOS_CHANGED, PAGE_LOAD_FAILURES } from './salesAnalytics/goals/goalsApi';
import { laDateString } from './salesAnalytics/periods';
import { scoutApi } from './scout/scoutApi';
import { SCOUT_CAPTURE, looksLikeCommand } from './scout/scoutActions';
import { readThread, saveThread, threadMessages, THREAD_MAX, entityLabel } from './scout/scoutModel';
import { signOut } from '../utils/authSession';

// app-shell-v2 - everything the shell (src/shell/AppShell.js) is handed, built from the workspace's registry entry.
// The shell itself names no workspace and no page; this file is where the app's pages meet it:
//   an entry workspace  -> its items, badges, Settings groups, the one field (search + ask), Needs attention, + To-do
//   any other workspace -> its own nav rows (constants/businessNav.js) and the Scout bar it had
//   no workspace open   -> Workspaces (and Admin for whoever may open it)
const REGISTRY = createShellRegistry([SALES_SHELL]);
const APP_PAGES = ['admin', 'connections', 'voice-profile', 'ui-kit', 'businesses-home'];
const SETTINGS_PAGES = ['admin', 'connections', 'voice-profile'];
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : '');
const initialsOf = name => String(name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
const SALES_ITEM = { actions: 'today', pipeline: 'pipeline', settings: 'settings' };

export function useWorkspaceShell({ me, activeUser, page, setPage, businessPage, setBusinessPage, activeBusiness, businesses, compact, showAdmin, showUiKit, ideasBadge, openScoutItem, onSelectBusiness, onAllWorkspaces, onOpenDigest, onOpenBugReport, onOpenProfile, legacyScout }) {
  const meId = me?.profile?.id || 'anon';
  const isPlatformOwner = !!me?.profile?.is_platform_owner;
  const workspace = page !== 'businesses-home' ? activeBusiness || null : null;
  const entry = REGISTRY.entryFor(workspace);
  const memberRole = workspace ? me?.memberships?.find(m => m.business_id === workspace.id)?.role || null : null;
  const role = memberRole || (isPlatformOwner && workspace ? 'owner' : null);
  const businessId = workspace?.id || null;
  const [salesNav, setSalesNav] = useState(() => readNav());
  const [adminSection, setAdminSection] = useState('users');
  const [settingsPick, setSettingsPick] = useState(null);
  const [todayBadge, setTodayBadge] = useState(0);
  const [members, setMembers] = useState([]);
  const [failures, setFailures] = useState({});
  const [pageSeed, setPageSeed] = useState(null);
  const [scoutWin, setScoutWin] = useState({ open: false, seed: null }); // seed stays once set: the window is mounted from its first open
  const openRef = useRef(openScoutItem);
  openRef.current = openScoutItem;

  useEffect(() => { const h = e => setSalesNav({ tab: e.detail.tab, view: e.detail.view }); window.addEventListener(SALES_NAV, h); return () => window.removeEventListener(SALES_NAV, h); }, []);
  useEffect(() => { const h = e => { if (e.detail?.businessId === businessId) setFailures(e.detail.failures || {}); }; window.addEventListener(PAGE_LOAD_FAILURES, h); return () => window.removeEventListener(PAGE_LOAD_FAILURES, h); }, [businessId]);
  // Q9: the Today badge = the member's rows in the list's first two groups - the number the Today read already carries.
  const hasBadge = !!entry?.items.some(i => i.badge === 'today');
  useEffect(() => {
    if (!hasBadge || !businessId) { setTodayBadge(0); return undefined; }
    let live = true;
    const load = () => goalsApi.today(businessId, { owner: 'me' }).then(d => { if (live) setTodayBadge(Number(d.badge) || 0); }).catch(() => {});
    load();
    window.addEventListener(TODOS_CHANGED, load);
    return () => { live = false; window.removeEventListener(TODOS_CHANGED, load); };
  }, [hasBadge, businessId]);
  useEffect(() => {
    if (!entry?.search || !businessId) { setMembers([]); return undefined; }
    let live = true;
    goalsApi.members(businessId).then(ms => { if (live) setMembers(ms || []); }).catch(() => {});
    return () => { live = false; };
  }, [entry, businessId]);

  const go = useCallback(to => {
    if (!to) return;
    if (to.page === 'sales-analytics' && businessId) {
      openRef.current({ workspace_id: businessId, open: { page: 'sales', params: { tab: to.tab, ...(to.view ? { view: to.view } : {}) } } });
      if (to.anchor) setTimeout(() => document.querySelector(`[data-anchor="${to.anchor}"], section[aria-label="Last sends"]`)?.scrollIntoView({ block: 'start' }), 600);
    } else if (APP_PAGES.includes(to.page)) { if (to.section) setAdminSection(to.section); setPage(to.page); }
    else { setBusinessPage(to.page); setPage('business-detail'); }
  }, [businessId, setPage, setBusinessPage]);
  const goItem = useCallback(item => { setSettingsPick(null); go(item.to); }, [go]);

  const onSales = page === 'business-detail' && businessPage === 'sales-analytics';
  const inSettings = !!entry && (SETTINGS_PAGES.includes(page) || (onSales && salesNav.tab === 'settings'));
  const nav = useMemo(() => {
    if (entry) {
      const badge = { today: todayBadge, ideas: ideasBadge };
      const first = entry.settings?.workspace?.[0];
      const active = inSettings ? 'settings'
        : page !== 'business-detail' ? null
        : onSales ? (salesNav.tab === 'dashboard' ? (salesNav.view === 'overview' ? 'home' : 'dashboard') : SALES_ITEM[salesNav.tab] || null)
        : entry.items.some(i => i.to.page === businessPage) ? entry.items.find(i => i.to.page === businessPage).id : null;
      return { items: entry.items.map(i => ({ ...i, badge: i.badge ? badge[i.badge] || 0 : 0 })), footer: first ? [{ id: 'settings', label: 'Settings', icon: 'settings', to: first.to }] : [], active, phoneTabs: entry.phone };
    }
    if (workspace) return { items: workspaceNav(workspace).map(n => ({ id: n.id, label: n.lb, glyph: n.ic, to: { page: n.id }, badge: n.id === 'ideas' ? ideasBadge : 0 })), footer: [], active: page === 'business-detail' ? businessPage : null };
    return { items: [{ id: 'workspaces', label: 'Workspaces', icon: 'grid', to: { page: 'businesses-home' } }, ...(showAdmin ? [{ id: 'admin', label: 'Admin', icon: 'settings', to: { page: 'admin' } }] : [])], footer: [], active: page === 'businesses-home' ? 'workspaces' : page === 'admin' ? 'admin' : null };
  }, [entry, workspace, todayBadge, ideasBadge, inSettings, page, onSales, salesNav, businessPage, showAdmin]);

  // Settings: WORKSPACE (everyone reads) and ADMIN (the workspace owner and the platform owner; absent otherwise - Q4).
  const settings = useMemo(() => {
    if (!inSettings) return null;
    const s = settingsFor(entry, { role, isPlatformOwner });
    const here = page === 'voice-profile' ? 'voice-profile' : page === 'connections' ? 'connections' : page === 'admin' ? (s.admin.find(p => p.to.page === 'admin' && p.to.section === adminSection)?.id || null) : (s.workspace.find(p => p.to.tab === 'settings')?.id || null);
    const picked = settingsPick && [...s.workspace, ...s.admin].find(p => p.id === settingsPick && p.to.page === (onSales ? 'sales-analytics' : page));
    return { groups: [{ label: 'Workspace', items: s.workspace }, { label: 'Admin', tag: 'Owner', items: s.admin }], active: picked ? picked.id : here, onGo: p => { setSettingsPick(p.id); go(p.to); } };
  }, [inSettings, entry, role, isPlatformOwner, page, adminSection, settingsPick, onSales, go]);

  // The one field: search is a plain read; an ask is one Scout ask - a short answer stays in the panel (Q7); a list, a
  // card, a draft or a command opens the Scout WINDOW over the page (W1), never the Scout page. On the Scout page the
  // field is that page's composer: every ask lands in its thread (W2). The turn is saved to the day's thread either way.
  const onScoutPage = !!entry && page === 'business-detail' && businessPage === 'scout';
  useEffect(() => { setScoutWin({ open: false, seed: null }); setPageSeed(null); }, [businessId]);
  useEffect(() => { if (onScoutPage) setScoutWin(w => (w.open ? { ...w, open: false } : w)); else setPageSeed(null); }, [onScoutPage]);
  const onSearch = useCallback((q, signal) => scoutApi.quick(q, businessId, { signal }).then(r => r.groups || []), [businessId]);
  const openScout = useCallback(seed => { const s = { ...seed, at: Date.now() }; if (onScoutPage) setPageSeed(s); else setScoutWin({ open: true, seed: s }); }, [onScoutPage]);
  const closeScout = useCallback(refocus => {
    setScoutWin(w => ({ ...w, open: false }));
    // back to the field (quietly - see FOCUS_FIELD); on a phone, where the field is behind its button, to that button
    if (refocus) setTimeout(() => { const centre = document.querySelector('[data-shell-centre]'); if (centre) centre.focus(); else window.dispatchEvent(new Event(FOCUS_FIELD)); }, 0);
  }, []);
  const onAsk = useCallback(async q => {
    if (onScoutPage || looksLikeCommand(q)) { openScout({ q }); return { page: true }; }
    const at = Date.now(), turns = readThread(meId);
    const r = await scoutApi.ask({ q, scope: businessId, thread: threadMessages(turns) });
    if (r.withheld) return { summary: 'Answer withheld: it held an address or a phone number.' };
    if (r.cant) return { summary: r.cant.reason };
    const turn = { at, q, scope: businessId, elapsed: Math.max(1, Math.round((Date.now() - at) / 1000)), answer_md: r.answer_md, summary: r.summary || null, sections: r.sections || null, items: r.items || [], usage: r.usage, ask: r.ask, cap: r.cap, ...(r.resolved ? { resolved: r.resolved } : {}), ...(r.offer ? { offer: r.offer } : {}), context_stats: { reads: r.context_stats?.reads || [], rows_by_entity: r.context_stats?.rows_by_entity || {} } };
    saveThread(meId, [...turns, turn].slice(-THREAD_MAX));
    if (!staysInPanel(r)) { openScout({ openLast: true }); return { page: true }; }
    const row = r.sections?.[0]?.rows?.[0] || (r.items?.length === 1 ? r.items[0] : null);
    const reads = Object.keys(r.context_stats?.rows_by_entity || {}).map(e => entityLabel(e).toLowerCase()).join(' · ');
    return { summary: r.summary || r.answer_md, row: row?.open ? row : null, reads: reads || null, cap: r.cap };
  }, [businessId, meId, openScout, onScoutPage]);
  const onOpen = useCallback(row => openRef.current({ ...row, workspace_id: businessId }), [businessId]);
  const colorOf = useCallback(id => members.find(m => m.user_id === id)?.color || null, [members]);
  const mayAdd = !!entry && canAdd({ role: memberRole, isPlatformOwner });
  const search = entry?.search && businessId
    ? opts => <ShellSearch userId={meId} onSearch={onSearch} onAsk={onAsk} onOpen={onOpen} onOpenScout={() => openScout({ openLast: true })} tryAsking={entry.tryAsking || []} colorOf={colorOf} today={laDateString()} {...opts} />
    : null;
  const attention = entry && businessId && me
    ? opts => <AttentionDrawer key={businessId} businessId={businessId} canEdit={mayAdd} isAdmin={isPlatformOwner || ['owner', 'admin'].includes(memberRole)} compact={compact} pageLoadFailures={failures}
        onNav={(tab, view) => go({ page: 'sales-analytics', tab, view })} icon={<span style={{ color: '#F2B544', display: 'inline-flex' }}><Icon name="bell" size={15} /></span>} short={!!opts.short} />
    : null;
  const onAddTodo = mayAdd ? () => window.dispatchEvent(new CustomEvent(SCOUT_CAPTURE, { detail: { businessId, text: '' } })) : null;

  const name = activeUser?.name || 'You';
  const user = { name, first: name.split(' ')[0], initials: activeUser?.initials || initialsOf(name), sub: [cap(role), workspace?.name].filter(Boolean).join(' · ') || null, color: colorOf(meId) };
  const menu = [
    { id: 'voice-profile', label: 'Voice profile', onClick: () => go({ page: 'voice-profile' }) },
    { id: 'connections', label: 'Connections', onClick: () => go({ page: 'connections' }) },
    { id: 'digest', label: 'Daily digest', onClick: onOpenDigest },
    { id: 'week', label: 'Week ahead', onClick: onOpenDigest },
    { id: 'bug', label: 'Report a bug', onClick: onOpenBugReport },
    { id: 'profile', label: 'Profile & badges', onClick: onOpenProfile },
    ...(showAdmin && (isPlatformOwner || !entry) ? [{ id: 'admin', label: 'Admin', onClick: () => go({ page: 'admin', section: 'users' }) }] : []),
    ...(showUiKit ? [{ id: 'ui-kit', label: 'UI kit', onClick: () => go({ page: 'ui-kit' }) }] : []),
    'sep',
    { id: 'sign-out', label: 'Sign out', onClick: signOut },
  ];

  return {
    entry, role, inSettings, settings, adminSection, mayAdd, go,
    scout: { pageSeed, open: scoutWin.open, seed: scoutWin.seed, close: closeScout },
    shell: { compact, userId: meId, workspace, role: cap(role) || null, workspaces: businesses, nav, search, legacySearch: search ? null : legacyScout, attention, onAddTodo, user, menu, onGo: goItem, onPickWorkspace: onSelectBusiness, onAllWorkspaces },
  };
}
