import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ensureHkTheme } from './hkTheme';
import { HK_SCREENS, visibleScreens, parseHkHash, hkHash, ownerOptions } from './hkScreens';
import { HK_MODULES } from '../constants/hkModules';
import { OwnerToggle, WorkspaceMenu, AvatarMenu, SearchPill, SyncPill, WordPill, TabBar, MoreSheet } from './HkChrome';
import { Sprout } from './HkMarks';
import HkScreen from './HkScreen';
import NewMenu from './NewMenu';
import Rail, { readNarrow, writeNarrow } from './nav/Rail';
import SearchPanel from './nav/SearchPanel';
import FiltersSheet from './nav/FiltersSheet';
import useBrandList from './nav/useBrandList';
import { brandBuckets, inboxBuckets, inboxCounts } from './nav/railBuckets';
import { parseBrandQuery, brandQuery, toggleValue, parseInboxQuery, inboxQuery, layoutOf, VIEW_LABELS, BRAND_BUCKETS, valueLabel, ownerValueOf, MAIL_LANES, REPLY_ITEMS, DRAFT_ITEMS } from './nav/filterState';
import { selLabel } from './inbox/InboxSpace';
import { roleAtLeast } from '../constants/roles';
import { signOut } from '../utils/authSession';
import { hkPatch, hkGet, hkPost, hkFetch } from './hkApi';
import { syncPillState, pageloadDue, syncKey } from './hkSync';
import { todayBadge } from './screens/TodayScreen';

// hkos-project-shell-v1 - the HumanKind Sales OS: a full-screen shell App.js renders INSTEAD of the Prospector shell
// for an hk_sales workspace. The owner filter is hk_member_prefs.owner_filter (data-foundation D7), no localStorage.
// grow-nav-filters-v1 - the rail (N1/N2): three spaces, the active space's filter buckets with live counts, the
// Workspace group. The address carries the space AND its filters (#hk/brands?view=pipeline&stage=sent, N9); Back /
// Forward step through filter changes. Saved views and collapsed buckets are the member's own preferences (N7).

const slug = name => `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'view'}-${Date.now().toString(36)}`;
const typing = t => !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

export default function HkShell({ business, businesses, userId, compact, onSelectBusiness, onAllWorkspaces, onOpenAdmin, onOpenConnections }) {
  const [nav, setNav] = useState(() => parseHkHash(window.location.hash) || { screen: 'today', section: null });
  const [shell, setShell] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [owner, setOwner] = useState('me');
  const [search, setSearch] = useState(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [gmail, setGmail] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [intent, setIntent] = useState(null);
  const [todayCounts, setTodayCounts] = useState(null);
  const [hotUnseen, setHotUnseen] = useState(0);
  const [prefs, setPrefs] = useState({ saved_views: [], rail: {} });
  const [narrow, setNarrow] = useState(readNarrow);
  const [laneCounts, setLaneCounts] = useState({});
  const [inboxLists, setInboxLists] = useState(null);
  const [searchFacets, setSearchFacets] = useState(null);

  ensureHkTheme();

  useEffect(() => {
    let cancelled = false;
    setShell(null); setLoadError(null);
    fetch(`/api/hk/${business.id}/shell`)
      .then(r => r.ok ? r.json() : r.json().catch(() => ({})).then(b => Promise.reject(new Error(b.error || `Grow failed to load (${r.status})`))))
      .then(data => { if (!cancelled) { setShell(data); if (data.me?.owner_filter) setOwner(data.me.owner_filter); } })
      .catch(e => { if (!cancelled) setLoadError(e.message); });
    hkGet(business.id, '/me/prefs').then(r => { if (!cancelled) setPrefs({ saved_views: r.prefs.saved_views || [], rail: r.prefs.rail || {} }); }).catch(() => {});
    return () => { cancelled = true; };
  }, [business.id]);

  const options = useMemo(() => ownerOptions(shell?.me, shell?.members), [shell]);
  const ownerValue = options.some(o => o.id === owner) ? owner : 'me';
  const pickOwner = id => {
    setOwner(id);
    hkPatch(business.id, '/me/prefs', { owner_filter: id }).catch(() => {});
  };

  // hk-imported-drafts-noise F4 - the badges are always the signed-in member's own items (Inbox = open tracked replies +
  // queued drafts, Today = its sections), whatever the owner toggle shows; never the workspace total.
  const loadGmail = useCallback(() => hkGet(business.id, '/gmail/status', { owner: 'me' }).then(setGmail).catch(() => setGmail(null)), [business.id]);
  const loadToday = useCallback(() => hkGet(business.id, '/jobs/today', { owner: 'me' }).then(t => setTodayCounts(t.owner_counts || t.digest?.counts || null)).catch(() => {}), [business.id]);
  useEffect(() => { if (shell) loadToday(); }, [shell, loadToday]);
  // grow-signals-v1 G6 - the Inbox item's green badge: unseen signals on Hot / Warm brands (Today marks them seen).
  const loadHot = useCallback(() => hkGet(business.id, '/signals').then(r => setHotUnseen(r.unseen_hot_warm || 0)).catch(() => {}), [business.id]);
  useEffect(() => { loadHot(); }, [loadHot]);
  useEffect(() => { if (shell) loadGmail(); }, [shell, loadGmail]);
  const runSync = useCallback(async (trigger = 'manual') => {
    setSyncing(true);
    try { await hkPost(business.id, `/sync?trigger=${trigger}`, {}); } catch {} finally { setSyncing(false); await loadGmail(); }
  }, [business.id, loadGmail]);
  useEffect(() => {
    if (!gmail?.mailbox?.linked || gmail.mailbox.state !== 'ok') return;
    let last = null; try { last = localStorage.getItem(syncKey(business.id, userId)); } catch {}
    if (!pageloadDue(last)) return;
    try { localStorage.setItem(syncKey(business.id, userId), String(Date.now())); } catch {}
    // hkos-daily-check-v1 J2 - the page-load runner: the caller's sync (60-min guard) + the workspace daily-check when due.
    hkPost(business.id, '/jobs/pageload', {}).catch(() => {}).then(() => { loadGmail(); loadToday(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gmail?.mailbox?.linked, gmail?.mailbox?.state, business.id, userId]);

  // The address follows the space + its filters; Back/Forward move between them. An old link (#hk/replies …) lands on
  // its new view once, replacing the address. Leaving the shell drops the #hk/ hash.
  useEffect(() => {
    const onPop = () => { const p = parseHkHash(window.location.hash); if (p) setNav(p); };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (window.location.hash.startsWith('#hk/')) window.history.replaceState(null, '', window.location.pathname + window.location.search);
    };
  }, []);
  useEffect(() => {
    const want = hkHash(nav.screen, nav.section, nav.brandId, nav.query);
    if (window.location.hash !== want) {
      if (window.location.hash.startsWith('#hk/') && !nav.redirected) window.history.pushState(null, '', want);
      else window.history.replaceState(null, '', want);
    }
  }, [nav]);

  const go = useCallback((screen, section = null, brandId = null) => {
    setSearch(null); setMoreOpen(false); setFiltersOpen(false);
    setNav({ screen, section: screen === 'settings' ? section || 'members' : null, brandId: screen === 'brands' ? brandId : null });
  }, []);
  const brandState = useMemo(() => parseBrandQuery(nav.screen === 'brands' ? nav.query : ''), [nav]);
  const inboxSel = useMemo(() => parseInboxQuery(nav.screen === 'inbox' ? nav.query : ''), [nav]);
  const setBrandState = useCallback(st => { setSearch(null); setNav({ screen: 'brands', section: null, brandId: null, query: brandQuery(st) }); }, []);
  const setInboxSel = useCallback(sel => { setSearch(null); setNav({ screen: 'inbox', section: null, query: inboxQuery(sel) }); }, []);

  const inBrands = nav.screen === 'brands' && !nav.brandId, inInbox = nav.screen === 'inbox';
  const list = useBrandList(business.id, brandState, ownerValue, !!shell && inBrands);
  const facets = list.facets || searchFacets;

  // N4 - tracked replies + queued drafts counted from the database for the rail (0 Gmail).
  const loadInboxLists = useCallback(() => Promise.all([hkGet(business.id, '/replies', { owner: ownerValue, handled: 'all' }), hkGet(business.id, '/drafts', { owner: ownerValue })])
    .then(([r, d]) => setInboxLists({ replies: r.replies, drafts: d.drafts })).catch(() => {}), [business.id, ownerValue]);
  useEffect(() => { if (shell && inInbox) loadInboxLists(); }, [shell, inInbox, loadInboxLists]);
  const inboxChanged = useCallback(() => { loadInboxLists(); loadGmail(); }, [loadInboxLists, loadGmail]);

  // N7 - saved views + collapsed buckets: the member's own preferences (PUT /me/prefs; deleting removes a preference).
  const putPrefs = useCallback(async next => {
    const r = await hkFetch(business.id, '/me/prefs', { method: 'PUT', body: next });
    setPrefs({ saved_views: r.prefs.saved_views || [], rail: r.prefs.rail || {} });
  }, [business.id]);
  const savedViews = prefs.saved_views;
  const saveView = useCallback(async name => {
    const id = slug(name);
    const view = inInbox
      ? { id, name, space: 'inbox', filters: { [inboxSel.kind === 'lane' ? 'lane' : inboxSel.kind]: [inboxSel.value] } }
      : { id, name, space: 'brands', view: brandState.view, filters: brandState.filters, ...(brandState.sort ? { sort: { by: brandState.sort, dir: brandState.dir || 'asc' } } : {}), layout: layoutOf(brandState) };
    await putPrefs({ saved_views: [...savedViews, view] });
    if (!inInbox) setBrandState({ ...brandState, saved: id });
  }, [inInbox, inboxSel, brandState, savedViews, putPrefs, setBrandState]);
  const removeView = useCallback(v => { putPrefs({ saved_views: savedViews.filter(x => x.id !== v.id) }).catch(() => {}); if (brandState.saved === v.id) setBrandState({ ...brandState, saved: null }); }, [savedViews, putPrefs, brandState, setBrandState]);
  const [renaming, setRenaming] = useState(null);
  const renameView = useCallback(v => setRenaming(v.id), []);
  const saveRename = useCallback(async (v, name) => { await putPrefs({ saved_views: savedViews.map(x => (x.id === v.id ? { ...x, name } : x)) }); setRenaming(null); }, [savedViews, putPrefs]);
  const cancelRename = useCallback(() => setRenaming(null), []);
  const applySaved = useCallback(v => {
    if (v.space === 'inbox') { const [k, vals] = Object.entries(v.filters)[0] || ['lane', ['briefing']]; setInboxSel({ kind: k, value: vals[0] }); return; }
    setBrandState({ view: v.view || 'all', filters: v.filters || {}, sort: v.sort?.by || null, dir: v.sort?.dir || null, layout: v.layout || null, q: '', saved: v.id });
  }, [setBrandState, setInboxSel]);

  const space = inBrands ? 'brands' : inInbox ? 'inbox' : null;
  const collapsed = useMemo(() => new Set(prefs.rail?.collapsed?.[space] || []), [prefs, space]);
  const onCollapse = useCallback((key, shut) => {
    const cur = new Set(prefs.rail?.collapsed?.[space] || []);
    if (shut) cur.add(key); else cur.delete(key);
    const rail = { ...prefs.rail, collapsed: { ...(prefs.rail?.collapsed || {}), [space]: [...cur] } };
    setPrefs(p => ({ ...p, rail }));
    hkFetch(business.id, '/me/prefs', { method: 'PUT', body: { rail } }).catch(() => {});
  }, [prefs, space, business.id]);

  const meId = shell?.me?.user_id;
  const members = useMemo(() => shell?.members || [], [shell]);
  const buckets = useMemo(() => {
    if (inBrands) return brandBuckets({ facets: list.facets, state: brandState, meId, members, savedViews, onRename: renameView, onRemove: removeView, renaming, onRenameSave: saveRename, onRenameCancel: cancelRename });
    if (inInbox) {
      const b = inboxBuckets({ sel: inboxSel, laneCounts, counts: inboxLists ? inboxCounts(inboxLists.replies, inboxLists.drafts) : null });
      const mine = savedViews.filter(v => v.space === 'inbox');
      return mine.length ? [{ key: 'saved', label: 'Saved views', icon: 'star', items: mine.map(v => ({ id: `saved:${v.id}`, label: v.name, active: false })) }, ...b] : b;
    }
    return [];
  }, [inBrands, inInbox, list.facets, brandState, meId, members, savedViews, renameView, removeView, renaming, saveRename, cancelRename, inboxSel, laneCounts, inboxLists]);
  const onPick = useCallback((key, id) => {
    if (id.startsWith('saved:')) { const v = savedViews.find(x => `saved:${x.id}` === id); if (v) applySaved(v); return; }
    if (inInbox) { setInboxSel({ kind: key === 'my_mail' ? 'lane' : key === 'tracked_replies' ? 'replies' : 'drafts', value: id }); return; }
    if (key === 'views') { setBrandState({ view: id, filters: {}, q: '', sort: null, dir: null, layout: null, saved: null }); return; }
    setBrandState(toggleValue(brandState, key, id));
  }, [inInbox, savedViews, applySaved, setInboxSel, setBrandState, brandState]);

  // N6 - the search panel's filter hits: every view and bucket value the server counted (fetched once when the panel
  // opens outside Brands - a database read, never Gmail), plus the Inbox items.
  useEffect(() => {
    if (!search || list.facets || searchFacets) return;
    hkGet(business.id, '/brands', { page: 1, limit: 1, facets: '1', ...(ownerValue !== 'all' ? { owner: ownerValue } : {}) }).then(r => setSearchFacets(r.facets)).catch(() => {});
  }, [search, list.facets, searchFacets, business.id, ownerValue]);
  useEffect(() => { setSearchFacets(null); }, [ownerValue]);
  const filterItems = useMemo(() => {
    const base = inBrands ? brandState : parseBrandQuery('');
    const out = (facets?.view || []).map(([v, n]) => ({ id: `view:${v}`, label: `View › ${VIEW_LABELS[v]}`, count: n, apply: () => setBrandState({ ...parseBrandQuery(''), view: v }) }));
    for (const b of BRAND_BUCKETS) for (const [v, n] of facets?.[b.key] || []) {
      const id = b.key === 'owner' ? ownerValueOf(v, meId) : v;
      out.push({ id: `${b.key}:${v}`, label: `${b.label} › ${valueLabel(b.key, v, { meId, members })}`, count: n, apply: () => setBrandState(base.filters[b.key]?.includes(id) ? base : toggleValue(base, b.key, id)) });
    }
    for (const [kind, items] of [['lane', MAIL_LANES], ['replies', REPLY_ITEMS], ['drafts', DRAFT_ITEMS]]) for (const [v] of items) out.push({ id: `inbox:${kind}:${v}`, label: `Inbox › ${selLabel({ kind, value: v }).replace(': ', ' › ')}`, count: null, apply: () => setInboxSel({ kind, value: v }) });
    for (const v of savedViews) out.push({ id: `saved:${v.id}`, label: `Saved view › ${v.name}`, count: null, apply: () => applySaved(v) });
    return out;
  }, [facets, inBrands, brandState, meId, members, savedViews, setBrandState, setInboxSel, applySaved]);

  // ⌘K / Ctrl+K and "/" open the search; "[" collapses / expands the rail. Only while the shell is mounted.
  useEffect(() => {
    const onKey = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setMoreOpen(false); setSearch(s => (s ? null : { initial: '' })); return; }
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (e.key === '/') { e.preventDefault(); setSearch({ initial: '' }); }
      else if (e.key === '[' && !compact) { e.preventDefault(); setNarrow(v => { writeNarrow(!v); return !v; }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [compact]);
  const setRailNarrow = v => { writeNarrow(v); setNarrow(v); };

  // Today's greeting follows the Chicago clock.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const screens = useMemo(() => visibleScreens(shell?.modules || HK_MODULES).map(s => (
    s.id === 'inbox' ? { ...s, count: (gmail?.badges?.replies || 0) + (gmail?.badges?.drafts || 0), hot: hotUnseen }
      : s.id === 'today' ? { ...s, count: todayBadge(todayCounts) } : s)), [shell, gmail, todayCounts, hotUnseen]);
  const spaces = screens.filter(s => s.group === 'space'), workspace = screens.filter(s => s.group === 'workspace' || (!s.group && !s.reserved));

  const pickNew = useCallback(kind => {
    const screen = kind === 'import' ? 'review' : 'brands';
    go(screen);
    setIntent({ kind, n: Date.now() });
  }, [go]);
  const clearIntent = useCallback(() => setIntent(null), []);
  const closeMore = useCallback(() => setMoreOpen(false), []);
  const closeSearch = useCallback(() => setSearch(null), []);
  const closeFilters = useCallback(() => setFiltersOpen(false), []);
  const openBrand = useCallback(id => go('brands', null, id), [go]);

  const current = HK_SCREENS.find(s => s.id === nav.screen) || HK_SCREENS[0];
  const mine = shell?.members.find(m => m.user_id === shell.me.user_id);
  const ownerToggle = shell && <div style={{ padding: '0 4px' }}><OwnerToggle options={options} value={ownerValue} onChange={pickOwner} /></div>;
  const savedName = inBrands && brandState.saved ? savedViews.find(v => v.id === brandState.saved)?.name || null : null;
  const resultLabel = inBrands ? (list.rows === null ? 'Show results' : `Show ${list.total.toLocaleString('en-US')} result${list.total === 1 ? '' : 's'}`) : 'Done';

  const body = loadError
    ? <p className="hk-meta" role="alert">{loadError}</p>
    : !shell
      ? <p className="hk-meta">Loading Grow…</p>
      : <HkScreen screen={current} section={nav.section} brandId={nav.brandId || null} businessId={business.id} owner={ownerValue} compact={compact} shell={shell} now={now} gmail={gmail} syncing={syncing} onSync={() => runSync('manual')} onGmailChanged={loadGmail} onOpenConnections={onOpenConnections} onSection={s => go('settings', s)} onOpenAdmin={onOpenAdmin} onOpenBrand={openBrand} onGo={go} onTodayCounts={setTodayCounts} onSignalsSeen={loadHot} intent={intent} onIntentDone={clearIntent}
          brands={{ state: brandState, setState: setBrandState, list, savedName, onSaveView: saveView, onOpenFilters: () => setFiltersOpen(true) }}
          inboxSpace={{ sel: inboxSel, setSel: setInboxSel, onSaveView: saveView, onOpenFilters: () => setFiltersOpen(true), onCountsChanged: inboxChanged, onLaneCounts: setLaneCounts }} />;

  const avatar = shell && <AvatarMenu me={shell.me} paletteIndex={mine?.palette_index || 1} size={compact ? 30 : 34} onBack={onAllWorkspaces} onSignOut={signOut} />;
  const newMenu = shell && roleAtLeast(shell.me.role, 'member') && <NewMenu compact={compact} onPick={pickNew} />;
  const syncPill = <SyncPill state={syncPillState(gmail, syncing)} onSync={() => runSync('manual')} onConnections={onOpenConnections} />;
  const wordPill = shell && <WordPill me={shell.me} members={shell.members} />;

  return (
    <div className={`hk-theme hk-shell${compact ? ' hk-shell--phone' : ''}`} data-hk-shell>
      {compact ? (
        <>
          <header className="hk-phone-top">
            <Sprout size={24} />
            <span className="hk-phone-top__name">Grow</span>
            <span className="hk-spacer" />
            {newMenu}
            {syncPill}
            {wordPill}
            {avatar}
          </header>
          {ownerToggle && <div style={{ padding: '12px 16px 0' }}>{ownerToggle}</div>}
          <main className="hk-content">{body}</main>
          <TabBar tabs={spaces} current={current.id} moreOpen={moreOpen} onGo={go} onSearch={() => setSearch({ initial: '' })} onMore={() => setMoreOpen(o => !o)} />
        </>
      ) : (
        <>
          <Rail spaces={spaces} workspace={workspace} current={current.id} onGo={go} owner={ownerToggle} buckets={buckets} collapsed={collapsed} onCollapse={onCollapse} onPick={onPick}
            narrow={narrow} onNarrow={setRailNarrow} onSearch={text => setSearch({ initial: text })} />
          <div className="hk-main">
            <header className="hk-top">
              <WorkspaceMenu business={business} businesses={businesses} onSelectBusiness={onSelectBusiness} onAllWorkspaces={onAllWorkspaces} />
              <SearchPill onOpen={() => setSearch({ initial: '' })} />
              {syncPill}
              {wordPill}
              <span className="hk-spacer" />
              {newMenu}
              {avatar}
            </header>
            <main className="hk-content">{body}</main>
          </div>
        </>
      )}
      <div id="hk-portal-root" className="hk-theme">
        {moreOpen && compact && <MoreSheet screens={workspace} onGo={go} onBack={onAllWorkspaces} onSignOut={signOut} onClose={closeMore} />}
        {filtersOpen && compact && (inBrands || inInbox) && <FiltersSheet buckets={buckets} collapsed={collapsed} onCollapse={onCollapse} onPick={onPick} resultLabel={resultLabel} onClose={closeFilters} />}
        {search && <SearchPanel businessId={business.id} initial={search.initial} screens={screens} filterItems={filterItems} onGo={go} onApply={f => f.apply()} onOpenBrand={openBrand}
          onOpenReply={r => setInboxSel({ kind: 'replies', value: r.handled ? 'handled' : 'open', reply: r.id })} onClose={closeSearch} />}
      </div>
    </div>
  );
}
