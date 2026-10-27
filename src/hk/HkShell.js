import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ensureHkTheme } from './hkTheme';
import { HK_SCREENS, visibleScreens, phoneTabs, moreScreens, parseHkHash, hkHash, ownerOptions } from './hkScreens';
import { HK_MODULES } from '../constants/hkModules';
import { SideNav, OwnerToggle, WorkspaceMenu, AvatarMenu, SearchPill, SyncPill, TabBar, MoreSheet, Palette } from './HkChrome';
import { Sprout } from './HkMarks';
import HkScreen from './HkScreen';
import { signOut } from '../utils/authSession';
import { hkPatch, hkGet, hkPost } from './hkApi';
import { syncPillState, pageloadDue, syncKey } from './hkSync';

// hkos-project-shell-v1 - the HumanKind Sales OS: a full-screen shell App.js renders INSTEAD of the Prospector shell
// for an hk_sales workspace. The current screen lives in the URL hash (#hk/<screen>, #hk/settings/<section>,
// #hk/brands/<id>). The owner filter is hk_member_prefs.owner_filter (data-foundation D7), no localStorage.

export default function HkShell({ business, businesses, userId, compact, onSelectBusiness, onAllWorkspaces, onOpenAdmin, onOpenConnections }) {
  const [nav, setNav] = useState(() => parseHkHash(window.location.hash) || { screen: 'today', section: null });
  const [shell, setShell] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [owner, setOwner] = useState('me');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [gmail, setGmail] = useState(null);
  const [syncing, setSyncing] = useState(false);

  ensureHkTheme();

  useEffect(() => {
    let cancelled = false;
    setShell(null); setLoadError(null);
    fetch(`/api/hk/${business.id}/shell`)
      .then(r => r.ok ? r.json() : r.json().catch(() => ({})).then(b => Promise.reject(new Error(b.error || `Sales OS failed to load (${r.status})`))))
      .then(data => { if (!cancelled) { setShell(data); if (data.me?.owner_filter) setOwner(data.me.owner_filter); } })
      .catch(e => { if (!cancelled) setLoadError(e.message); });
    return () => { cancelled = true; };
  }, [business.id]);

  // hkos-gmail-connect-v1 G5.5 - the mailbox state + badges, then one page-load sync per hour per user (the server
  // guards the same window; prospector_hk_sync_<business>_<user> mirrors it so a reload never fires a second one).
  const loadGmail = useCallback(() => hkGet(business.id, '/gmail/status').then(setGmail).catch(() => setGmail(null)), [business.id]);
  useEffect(() => { loadGmail(); }, [loadGmail]);
  const runSync = useCallback(async (trigger = 'manual') => {
    setSyncing(true);
    try { await hkPost(business.id, `/sync?trigger=${trigger}`, {}); } catch {} finally { setSyncing(false); await loadGmail(); }
  }, [business.id, loadGmail]);
  useEffect(() => {
    if (!gmail?.mailbox?.linked || gmail.mailbox.state !== 'ok') return;
    let last = null; try { last = localStorage.getItem(syncKey(business.id, userId)); } catch {}
    if (!pageloadDue(last)) return;
    try { localStorage.setItem(syncKey(business.id, userId), String(Date.now())); } catch {}
    runSync('pageload');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gmail?.mailbox?.linked, gmail?.mailbox?.state, business.id, userId]);

  // The address follows the screen; Back/Forward move between screens. Leaving the shell drops the #hk/ hash so a
  // reload of the Prospector screen stays there.
  useEffect(() => {
    const onPop = () => { const p = parseHkHash(window.location.hash); if (p) setNav(p); };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (window.location.hash.startsWith('#hk/')) window.history.replaceState(null, '', window.location.pathname + window.location.search);
    };
  }, []);
  useEffect(() => {
    const want = hkHash(nav.screen, nav.section, nav.brandId);
    if (window.location.hash !== want) {
      if (window.location.hash.startsWith('#hk/')) window.history.pushState(null, '', want);
      else window.history.replaceState(null, '', want);
    }
  }, [nav]);

  // ⌘K / Ctrl+K, only while the shell is mounted.
  useEffect(() => {
    const onKey = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setMoreOpen(false); setPaletteOpen(o => !o); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Today's greeting follows the Chicago clock.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const screens = useMemo(() => visibleScreens(shell?.modules || HK_MODULES).map(s => (s.id === 'drafts' ? { ...s, count: gmail?.badges?.drafts || 0 } : s.id === 'replies' ? { ...s, count: gmail?.badges?.replies || 0 } : s)), [shell, gmail]);
  const options = useMemo(() => ownerOptions(shell?.me, shell?.members), [shell]);
  const ownerValue = options.some(o => o.id === owner) ? owner : 'me';
  const pickOwner = id => {
    setOwner(id);
    hkPatch(business.id, '/me/prefs', { owner_filter: id }).catch(() => {});
  };

  const go = useCallback((screen, section = null, brandId = null) => {
    setPaletteOpen(false); setMoreOpen(false);
    setNav({ screen, section: screen === 'settings' ? section || 'members' : null, brandId: screen === 'brands' ? brandId : null });
  }, []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const closeMore = useCallback(() => setMoreOpen(false), []);

  const current = HK_SCREENS.find(s => s.id === nav.screen) || HK_SCREENS[0];
  const mine = shell?.members.find(m => m.user_id === shell.me.user_id);
  const ownerToggle = shell && <div style={{ padding: '0 4px' }}><OwnerToggle options={options} value={ownerValue} onChange={pickOwner} /></div>;

  const body = loadError
    ? <p className="hk-meta" role="alert">{loadError}</p>
    : !shell
      ? <p className="hk-meta">Loading the Sales OS…</p>
      : <HkScreen screen={current} section={nav.section} brandId={nav.brandId || null} businessId={business.id} owner={ownerValue} compact={compact} shell={shell} now={now} gmail={gmail} syncing={syncing} onSync={() => runSync('manual')} onGmailChanged={loadGmail} onOpenConnections={onOpenConnections} onSection={s => go('settings', s)} onOpenAdmin={onOpenAdmin} onOpenBrand={id => go('brands', null, id)} />;

  const avatar = shell && <AvatarMenu me={shell.me} paletteIndex={mine?.palette_index || 1} size={compact ? 30 : 34} onBack={onAllWorkspaces} onSignOut={signOut} />;
  const syncPill = <SyncPill state={syncPillState(gmail, syncing)} onSync={() => runSync('manual')} onConnections={onOpenConnections} />;

  return (
    <div className={`hk-theme hk-shell${compact ? ' hk-shell--phone' : ''}`} data-hk-shell>
      {compact ? (
        <>
          <header className="hk-phone-top">
            <Sprout size={24} />
            <span className="hk-phone-top__name">Sales OS</span>
            <span className="hk-spacer" />
            {syncPill}
            {avatar}
          </header>
          {ownerToggle && <div style={{ padding: '12px 16px 0' }}>{ownerToggle}</div>}
          <main className="hk-content">{body}</main>
          <TabBar tabs={phoneTabs(screens)} current={current.id} moreOpen={moreOpen} onGo={go} onMore={() => setMoreOpen(o => !o)} />
        </>
      ) : (
        <>
          <SideNav screens={screens} current={current.id} onGo={go} owner={ownerToggle} />
          <div className="hk-main">
            <header className="hk-top">
              <WorkspaceMenu business={business} businesses={businesses} onSelectBusiness={onSelectBusiness} onAllWorkspaces={onAllWorkspaces} />
              <SearchPill onOpen={() => setPaletteOpen(true)} />
              {syncPill}
              <span className="hk-spacer" />
              {avatar}
            </header>
            <main className="hk-content">{body}</main>
          </div>
        </>
      )}
      <div id="hk-portal-root" className="hk-theme">
        {moreOpen && compact && <MoreSheet screens={moreScreens(screens)} onGo={go} onBack={onAllWorkspaces} onSignOut={signOut} onClose={closeMore} />}
        {paletteOpen && <Palette screens={screens} onGo={go} onClose={closePalette} />}
      </div>
    </div>
  );
}
