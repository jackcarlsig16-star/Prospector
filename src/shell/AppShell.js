import { useState, useCallback } from 'react';
import { SHELL_CSS, SHELL_RAIL_KEY } from './shellStyles';
import ShellNav from './ShellNav';
import ShellHeader, { ShortcutsDialog } from './ShellHeader';
import { PhoneTop, PhoneTabs, MoreSheet } from './ShellPhone';
import Icon from './icons';

// app-shell-v2 - the one shell: the left nav (sections only), the header (the one field, Needs attention, + To-do, the
// account menu) and the page. Under 900 px: a top bar, the page, bottom tabs. Everything a workspace shows comes in as
// props built from its registry entry (shellRegistry.js); this file names no workspace and no page.
//   nav: { items, footer, active, phoneTabs: [item id] }   search(opts) -> the field (opts.fullScreen on a phone)
//   attention(opts) -> the Needs attention button (opts.short on a phone)   onAddTodo: absent for a Viewer
const readRail = userId => { try { return JSON.parse(localStorage.getItem(SHELL_RAIL_KEY) || '{}')[userId] === 'rail'; } catch { return false; } };
const writeRail = (userId, rail) => { try { const all = JSON.parse(localStorage.getItem(SHELL_RAIL_KEY) || '{}'); localStorage.setItem(SHELL_RAIL_KEY, JSON.stringify({ ...all, [userId]: rail ? 'rail' : 'wide' })); } catch { /* private mode */ } };

export default function AppShell({ compact, userId, workspace, role, workspaces, nav, search, legacySearch = null, attention, onAddTodo, user, menu, onGo, onPickWorkspace, onAllWorkspaces, children }) {
  const [rail, setRail] = useState(() => readRail(userId));
  const [more, setMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const onRail = useCallback(v => { setRail(v); writeRail(userId, v); }, [userId]);
  // "Keyboard shortcuts" sits last above the sign-out rule (desktop, where the field's keys apply).
  const menuItems = (() => {
    if (!search || compact) return menu;
    const at = menu.findIndex(m => m !== 'sep' && m.id === 'sign-out');
    const cut = at < 0 ? menu.length : menu[at - 1] === 'sep' ? at - 1 : at;
    return [...menu.slice(0, cut), { id: 'shortcuts', label: 'Keyboard shortcuts', onClick: () => setShortcuts(true) }, ...menu.slice(cut)];
  })();
  const hue = workspace?.color || undefined;

  if (compact) {
    const tabIds = nav.phoneTabs || nav.items.slice(0, 3).map(i => i.id);
    const all = [...nav.items, ...nav.footer];
    const tabs = tabIds.map(id => all.find(i => i.id === id)).filter(Boolean);
    const rest = all.filter(i => !tabIds.includes(i.id));
    return (
      <div className="sh-root" style={hue ? { '--sh-hue': hue } : undefined} data-shell="phone">
        <style>{SHELL_CSS}</style>
        <PhoneTop workspace={workspace} attention={<>{!search && legacySearch}{attention?.({ short: true })}</>} onAddTodo={onAddTodo} />
        <main id="main-content" className="sh-main"><div className="sh-pad">{children}</div></main>
        <PhoneTabs tabs={tabs} active={nav.active} onGo={onGo} canSearch={!!search} onSearch={() => setSearching(true)} onMore={() => setMore(true)} moreActive={rest.some(i => i.id === nav.active)} />
        {searching && search && (
          <div className="sh-full" role="dialog" aria-modal="true" aria-label="Search or ask Scout" data-shell-fullsearch>
            <div style={{ padding: '10px 12px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              {search({ fullScreen: true, onClose: () => setSearching(false) })}
              <button type="button" className="sh-btn sh-btn--ghost" style={{ height: 44, border: 0 }} onClick={() => setSearching(false)}>Cancel</button>
            </div>
          </div>
        )}
        {more && <MoreSheet workspace={workspace} role={role} workspaces={workspaces} items={rest} active={nav.active} user={user} menu={menuItems} onGo={onGo} onPickWorkspace={onPickWorkspace} onAllWorkspaces={onAllWorkspaces} onClose={() => setMore(false)} />}
      </div>
    );
  }
  return (
    <div className="sh-root" style={hue ? { '--sh-hue': hue } : undefined} data-shell="desk">
      <style>{SHELL_CSS}</style>
      <ShellNav workspace={workspace} role={role} workspaces={workspaces} items={nav.items} footer={nav.footer} active={nav.active} rail={rail} onRail={onRail} onGo={onGo} onPickWorkspace={onPickWorkspace} onAllWorkspaces={onAllWorkspaces} />
      <div className="sh-col">
        <ShellHeader search={search ? search({}) : legacySearch} attention={attention?.({})} onAddTodo={onAddTodo} user={user} menu={menuItems} />
        <main id="main-content" className="sh-main"><div className="sh-pad">{children}</div></main>
      </div>
      {shortcuts && <ShortcutsDialog onClose={() => setShortcuts(false)} />}
    </div>
  );
}

// The Settings page's frame: the WORKSPACE group (everyone reads) and the ADMIN group (the owner; absent otherwise).
export function SettingsFrame({ groups, active, onGo, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }} data-shell-settings>
      <h1 className="sh-h1">Settings</h1>
      <div className="sh-settings">
        <nav aria-label="Settings" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {groups.filter(g => g.items.length).map((g, i) => (
            <div key={g.label} role="group" aria-label={g.label} style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: i ? 14 : 0 }} data-settings-group={g.label}>
              <span className="sh-lbl" style={{ padding: '0 10px 6px', display: 'flex', alignItems: 'center', gap: 6 }}>{g.label}{g.tag && <span style={{ font: "500 9.5px 'Geist Mono',monospace", border: '1px solid var(--sh-line)', borderRadius: 999, padding: '1px 6px', color: 'var(--sh-dim)' }}>{g.tag}</span>}</span>
              {g.items.map(p => <button key={p.id} type="button" className="sh-si" aria-current={active === p.id ? 'page' : undefined} onClick={() => onGo(p)} data-settings-item={p.id}><Icon name={p.icon} />{p.label}</button>)}
            </div>
          ))}
        </nav>
        <div style={{ minWidth: 0 }}>{children}</div>
      </div>
    </div>
  );
}

export function ComingSoon({ title, note, icon = 'marketing' }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 48 }} data-shell-soon>
      <div className="sh-card" style={{ width: 420, maxWidth: '100%', padding: 28, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
        <span style={{ color: 'var(--sh-hue)', display: 'inline-flex' }}><Icon name={icon} size={22} /></span>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{title}</h1>
        <div className="sh-note">{note}</div>
      </div>
    </div>
  );
}
