import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ui } from '../../ui/kitTheme';
import { KIT_RADIUS, KIT_SPACE, KIT_TYPE } from '../../ui/tokens';
import Card from '../../ui/Card';
import Button, { ButtonRow } from '../../ui/Button';
import Tag from '../../ui/Tag';
import { lineColor } from './tetherColor';

// mailbox-connections-v1 REV2 (M6) - the tether map: every mailbox the signed-in person connected on the left, every
// workspace they belong to on the right, a curve for each tether. Replaces GoogleCard in Connections. Kit tokens only;
// the single new color per tether is businesses.color (3:1 variant when needed). Copy has no em or en dashes.
const PURPOSE_LABEL = { drafts: 'Outreach drafts', inbox: 'Inbox', calendar: 'Calendar', voice: 'Voice', sync: 'Outlook sync' };
const PURPOSE_TILE = { drafts: ['Outreach drafts', 'Drafts land in this mailbox, never sent by Prospector'], inbox: ['Read your inbox', 'Replies and threads read inside the workspace'], calendar: ['Calendar', 'Meetings read for this workspace'] };
const PHONE = 760;
const AMBER = '#B7791F';
const small = { ...KIT_TYPE.small, color: ui.muted };
const fine = { ...KIT_TYPE.label, color: ui.faint, fontWeight: 400 };
const nodeBase = { all: 'unset', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px', borderRadius: KIT_RADIUS.inner, border: `1px solid ${ui.border}`, background: ui.inset, color: ui.text, cursor: 'pointer', ...KIT_TYPE.body, textAlign: 'left', position: 'relative', zIndex: 1 };
const dot = color => <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', background: color, flex: 'none' }} />;
const cssVar = (el, name, fallback) => { try { const v = getComputedStyle(el).getPropertyValue(name).trim(); return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback; } catch { return fallback; } };
const surfaceOf = el => cssVar(el, '--ui-surface', '#0d150d');
const isLight = hexColor => { const [r, g, b] = hexColor.replace('#', '').match(/.{2}/g).map(x => parseInt(x, 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5; };
const connectUrl = (q) => { const back = window.location.pathname + window.location.search; return `/api/google/connect?${new URLSearchParams({ feature: 'gmail', return: back, ...q })}`; };

export async function loadMailboxes() {
  const r = await fetch('/api/mailboxes');
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Mailboxes failed to load (${r.status})`);
  return r.json();
}
const api = (method, path, body) => fetch(`/api/mailboxes${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }).then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `${method} ${path} failed (${r.status})`); return d; });

// Every line the map draws, from the API payload. Pure and tested.
export function tethersOf(data, surface = '#0d150d') {
  if (!data) return [];
  const out = [];
  const def = data.accounts.find(a => a.is_default);
  for (const w of data.workspaces) {
    const lc = lineColor(w.color || '#888888', surface).color;
    if (w.google_link) out.push({ id: `g:${w.id}`, from: `account:${w.google_link.account_id}`, to: `workspace:${w.id}`, color: w.google_link.state === 'needs_reconnect' ? AMBER : lc, dash: w.google_link.state === 'needs_reconnect' ? '6 4' : null, pill: w.google_link.purposes.map(p => PURPOSE_LABEL[p] || p).join(' · '), state: w.google_link.state, kind: 'google' });
    if (w.microsoft_derived?.length) out.push({ id: `m:${w.id}`, from: 'microsoft', to: `workspace:${w.id}`, color: lc, dash: '3 5', pill: w.microsoft_derived.map(p => PURPOSE_LABEL[p] || p).join(' · '), state: data.microsoft?.state || 'ok', kind: 'microsoft' });
    if (w.apollo_derived) out.push({ id: `a:${w.id}`, from: 'apollo', to: `workspace:${w.id}`, color: lc, dash: '3 5', pill: 'Apollo · read-only', state: 'ok', kind: 'apollo' });
  }
  if (def) out.push({ id: 'default', from: `account:${def.id}`, to: 'personal', color: '#8A8A8A', dash: '6 4', pill: 'Default · tools with no workspace', state: def.state, kind: 'default' });
  return out;
}
const touches = (t, sel) => !!sel && (t.from === sel || t.to === sel);

// Several tethers into one workspace would stack their pills at the midpoint, so each one sits at a different point
// along its own curve (the cubic evaluated at 0.5, then 0.32 / 0.68, ...).
const bez = (p0, p1, p2, p3, t) => (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3 * p3;
const SLOTS = [0.5, 0.3, 0.7, 0.2, 0.8];
// theme = the kit's computed values, so SVG text gets literal colors that pass 4.5:1 on the pill it sits on.
function Curves({ tethers, selected, box, rects, theme }) {
  if (!box) return null;
  const seen = {};
  const light = isLight(theme.surface);
  const amberPill = light ? { fill: '#FFF3D6', text: '#6B4A05' } : { fill: '#3A2D0F', text: '#F2C66D' };
  const pills = tethers.map(t => {
    const a = rects[t.from], b = rects[t.to];
    if (!a || !b) return null;
    const x1 = a.right - box.left, y1 = a.top + a.height / 2 - box.top, x2 = b.left - box.left, y2 = b.top + b.height / 2 - box.top;
    const dx = Math.max(40, (x2 - x1) / 2);
    const slot = SLOTS[Math.min(SLOTS.length - 1, seen[t.to] || 0)]; seen[t.to] = (seen[t.to] || 0) + 1;
    const w = Math.min(260, Math.max(90, t.pill.length * 6.2 + 18));
    return { t, x1, y1, x2, y2, dx, w, mx: bez(x1, x1 + dx, x2 - dx, x2, slot), my: bez(y1, y1, y2, y2, slot) };
  }).filter(Boolean);
  // Pills that still overlap (curves crossing) move down 26 px at a time until they clear.
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < pills.length; i++) for (let j = 0; j < i; j++) {
      const p = pills[i], q = pills[j];
      if (Math.abs(p.mx - q.mx) < (p.w + q.w) / 2 && Math.abs(p.my - q.my) < 24) p.my = q.my + 26;
    }
  }
  const paths = pills.map(({ t, x1, y1, x2, y2, dx, w, mx, my }) => {
    const on = touches(t, selected), dim = selected && !on;
    const flagged = t.state === 'needs_reconnect';
    return (
      <g key={t.id} data-tether={t.id} data-from={t.from} data-to={t.to} data-state={t.state} opacity={dim ? 0.45 : 1}>
        <path d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`} fill="none" stroke={t.color} strokeWidth={on ? 3 : 2} strokeDasharray={t.dash || undefined} strokeLinecap="round" />
        <circle cx={x1} cy={y1} r={5} fill={t.color} data-end="from" /><circle cx={x2} cy={y2} r={5} fill={t.color} data-end="to" />
        <g transform={`translate(${mx - w / 2}, ${my - 11})`} data-pill={t.id}>
          <rect width={w} height={22} rx={11} fill={flagged ? amberPill.fill : theme.surface2} stroke={t.color} />
          <text x={w / 2} y={15} textAnchor="middle" fontSize="11" fontFamily="Geist, ui-sans-serif, system-ui, sans-serif" fill={flagged ? amberPill.text : theme.text}>{flagged ? 'Needs reconnect' : t.pill}</text>
        </g>
      </g>
    );
  });
  return <svg aria-hidden="true" data-tether-layer width={box.width} height={box.height} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }}>{paths}</svg>;
}

function Node({ id, selected, onSelect, color, children, ring }) {
  const on = selected === id;
  return <button type="button" data-node={id} aria-pressed={on} onClick={() => onSelect(on ? null : id)} style={{ ...nodeBase, boxShadow: on ? `0 0 0 2px ${ring || color || ui.accent}` : 'none' }}>{children}</button>;
}

export default function TetherMap({ businesses }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [picker, setPicker] = useState(null);
  const [note, setNote] = useState('');
  const [rects, setRects] = useState({});
  const [box, setBox] = useState(null);
  const [surface, setSurface] = useState('#0d150d');
  const [theme, setTheme] = useState({ surface: '#0d150d', surface2: '#2E3540', text: '#E9ECF0' });
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < PHONE);
  const wrap = useRef(null);
  const load = useCallback(() => loadMailboxes().then(d => { setData(d); setError(''); }).catch(e => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const onR = () => setNarrow(window.innerWidth < PHONE); window.addEventListener('resize', onR); return () => window.removeEventListener('resize', onR); }, []);
  const measure = useCallback(() => {
    const el = wrap.current; if (!el) return;
    const sf = surfaceOf(el); setSurface(sf); setTheme({ surface: sf, surface2: cssVar(el, '--ui-surface2', '#2E3540'), text: cssVar(el, '--ui-text', '#E9ECF0') });
    const b = el.getBoundingClientRect(); setBox({ left: b.left, top: b.top, width: b.width, height: b.height });
    const next = {}; el.querySelectorAll('[data-node]').forEach(n => { next[n.dataset.node] = n.getBoundingClientRect(); }); setRects(next);
  }, []);
  useLayoutEffect(() => { measure(); if (!wrap.current || typeof ResizeObserver === 'undefined') return undefined; const ro = new ResizeObserver(() => measure()); ro.observe(wrap.current); window.addEventListener('resize', measure); return () => { ro.disconnect(); window.removeEventListener('resize', measure); }; }, [measure, data, narrow]);
  const tethers = useMemo(() => tethersOf(data, surface), [data, surface]);
  const colorOf = useCallback(w => lineColor(w.color || '#888888', surface).color, [surface]);
  const run = async (fn, okNote) => { setNote(''); try { await fn(); await load(); if (okNote) setNote(okNote); } catch (e) { setNote(e.message); } };

  if (error) return <Card title="Mailboxes" subtitle="Could not load"><p role="alert" style={{ ...KIT_TYPE.small, color: ui.dangerInk, margin: 0 }}>{error}</p></Card>;
  if (!data) return <Card title="Mailboxes" subtitle="…" />;
  const def = data.accounts.find(a => a.is_default) || null;
  const roleOf = w => w.role;
  const canLink = w => ['owner', 'admin', 'member'].includes(w.role);
  const workspaceOf = id => data.workspaces.find(w => w.id === id);
  const accountOf = id => data.accounts.find(a => a.id === id);
  const accountLine = a => `${a.features.map(f => ({ gmail: 'Gmail', calendar: 'Calendar', slides: 'Slides' }[f] || f)).join(', ') || 'No access'} granted · ${a.linked_business_ids.length} workspace${a.linked_business_ids.length === 1 ? '' : 's'}`;
  const workspaceLine = w => { const parts = []; if (w.google_link) parts.push(`${accountOf(w.google_link.account_id)?.email || 'Gmail'} · ${w.google_link.purposes.map(p => PURPOSE_LABEL[p]).join(' · ')}`); if (w.microsoft_derived?.length) parts.push(`Outlook · ${w.microsoft_derived.map(p => PURPOSE_LABEL[p]).join(' · ')}`); if (w.apollo_derived) parts.push('Apollo mailboxes'); return parts.join(' · ') || 'No mailbox linked'; };
  const selWs = selected?.startsWith('workspace:') ? workspaceOf(selected.slice(10)) : null;
  const selAcc = selected?.startsWith('account:') ? accountOf(selected.slice(8)) : null;

  const unlink = w => run(() => api('DELETE', '/link', { business_id: w.id }), `${w.name} unlinked.`);
  const makeDefault = a => run(() => api('POST', '/default', { account_id: a.id }), `${a.email} is now your default.`);
  const disconnect = a => { if (window.confirm(`Disconnect ${a.email}? Its workspaces lose their mailbox until you link another.`)) run(() => api('DELETE', `/accounts/${a.id}`), 'Disconnected.'); };
  const reconnect = a => window.location.assign(connectUrl({ grant: a.id }));
  const connectNew = (w, purposes) => window.location.assign(connectUrl(w ? { account: 'new', business: w.id, purposes: purposes.join(',') } : { account: 'new' }));

  const accountsCol = (
    <div data-col="accounts" style={{ display: 'grid', gap: KIT_SPACE[1], alignContent: 'start' }}>
      <div style={fine}>YOUR ACCOUNTS</div>
      {data.accounts.map(a => (
        <Node key={a.id} id={`account:${a.id}`} selected={selected} onSelect={setSelected} color={a.state === 'needs_reconnect' ? AMBER : ui.accent}>
          {dot(a.state === 'needs_reconnect' ? AMBER : ui.good)}
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={fine}>GOOGLE · GMAIL</span>
            <span style={{ display: 'block', color: ui.text, overflow: 'hidden', textOverflow: 'ellipsis' }} data-account-email>{a.email}</span>
            <span style={small}>{accountLine(a)}</span>
          </span>
          <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {a.is_default && <Tag color={ui.accent}>Default</Tag>}
            {a.state === 'needs_reconnect' && <Tag color={AMBER}>Reconnect</Tag>}
          </span>
        </Node>
      ))}
      {data.microsoft && (
        <Node id="microsoft" selected={selected} onSelect={setSelected} color={ui.accent}>
          {dot(data.microsoft.state === 'needs_reconnect' ? AMBER : ui.good)}
          <span style={{ minWidth: 0, flex: 1 }}><span style={fine}>MICROSOFT · OUTLOOK</span><span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>{data.microsoft.email}</span><span style={small}>{data.microsoft.business_ids.length} workspace{data.microsoft.business_ids.length === 1 ? '' : 's'} · read-only sync</span></span>
        </Node>
      )}
      {data.apollo.some(a => a.mailbox_count > 0) && (
        <Node id="apollo" selected={selected} onSelect={setSelected} color={ui.accent}>
          {dot(ui.good)}
          <span style={{ minWidth: 0, flex: 1 }}><span style={fine}>APOLLO · SHARED ORG</span><span style={{ display: 'block' }}>{data.apollo.reduce((n, a) => n + a.mailbox_count, 0)} mailboxes</span><span style={small}>read-only</span></span>
        </Node>
      )}
      <button type="button" data-node="connect" data-connect-new onClick={() => connectNew(null, [])} style={{ ...nodeBase, border: `1px dashed ${ui.control}`, background: 'transparent', color: ui.link, justifyContent: 'center', minHeight: 44 }}>+ Connect another Google account</button>
      <p style={{ ...small, margin: 0 }}>Google opens with an account picker. Each account keeps its own connection. Adding one never replaces another.</p>
    </div>
  );
  const workspacesCol = (
    <div data-col="workspaces" style={{ display: 'grid', gap: KIT_SPACE[1], alignContent: 'start' }}>
      <div style={fine}>WORKSPACES</div>
      {data.workspaces.map(w => (
        <Node key={w.id} id={`workspace:${w.id}`} selected={selected} onSelect={setSelected} color={colorOf(w)}>
          {dot(colorOf(w))}
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: 'block', color: ui.text }}>{w.name}</span>
            <span style={small}>{workspaceLine(w)}</span>
          </span>
          {!w.google_link && canLink(w) && <Button size="sm" onClick={e => { e.stopPropagation(); setPicker({ workspace: w }); }} data-link-mailbox={w.id}>Link a mailbox</Button>}
        </Node>
      ))}
      <Node id="personal" selected={selected} onSelect={setSelected} color="#8A8A8A">
        <span style={{ minWidth: 0, flex: 1, borderLeft: 'none' }}><span style={{ display: 'block', color: ui.text }}>Personal tools</span><span style={small}>Voice profile, Gmail intent, Slides. Not a workspace.</span></span>
      </Node>
    </div>
  );

  const detail = selWs ? (
    <div data-detail="workspace" style={{ marginTop: KIT_SPACE[2], padding: KIT_SPACE[2], border: `1px solid ${ui.border}`, borderRadius: KIT_RADIUS.inner, background: ui.surface2, display: 'grid', gap: KIT_SPACE[1] }}>
      <div style={{ ...KIT_TYPE.cardTitle, color: ui.text }}>{selWs.google_link ? <>{selWs.name} uses {accountOf(selWs.google_link.account_id)?.email || 'a Google mailbox'}</> : <>{selWs.name} has no Google mailbox linked</>}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: KIT_SPACE[1] }}>
        {Object.entries(PURPOSE_TILE).map(([p, [label, help]]) => { const on = !!selWs.google_link?.purposes.includes(p); return (
          <div key={p} data-purpose={p} data-linked={on} style={{ padding: 10, border: `1px solid ${ui.border}`, borderRadius: KIT_RADIUS.inner, background: ui.surface, display: 'grid', gap: 4 }}>
            <span style={{ color: ui.text }}>{label}</span><span style={small}>{help}</span>
            <Tag color={on ? ui.good : ui.off}>{on ? 'Linked' : 'Not linked'}</Tag>
            {!on && selWs.google_link && canLink(selWs) && <Button size="sm" onClick={() => { const acc = accountOf(selWs.google_link.account_id); const need = p === 'calendar' ? 'calendar' : 'gmail'; if (acc && !acc.features.includes(need)) window.location.assign(connectUrl({ grant: acc.id, feature: need, business: selWs.id, purposes: [...selWs.google_link.purposes, p].join(',') })); else run(() => api('PUT', '/link', { business_id: selWs.id, account_id: selWs.google_link.account_id, purposes: [...selWs.google_link.purposes, p] }), `${label} linked.`); }}>Link {label}</Button>}
          </div>); })}
      </div>
      {selWs.microsoft_derived?.length > 0 && <span style={small}>Outlook: {selWs.microsoft_derived.map(p => PURPOSE_LABEL[p]).join(' · ')} (derived from the workspace's Outlook sync, read-only here)</span>}
      {selWs.apollo_derived && <span style={small}>Apollo mailboxes are managed in Apollo (read-only here).</span>}
      {canLink(selWs) && <ButtonRow align="start"><Button onClick={() => setPicker({ workspace: selWs })} data-change-mailbox>{selWs.google_link ? 'Change mailbox' : 'Link a mailbox'}</Button>{selWs.google_link && <Button variant="tertiary" onClick={() => unlink(selWs)} data-unlink style={{ color: ui.dangerInk }}>Unlink</Button>}</ButtonRow>}
      <span style={small}>If this mailbox disconnects, {selWs.name} stops and asks you to reconnect. It never falls back to your default Gmail.</span>
    </div>
  ) : selAcc ? (
    <div data-detail="account" style={{ marginTop: KIT_SPACE[2], padding: KIT_SPACE[2], border: `1px solid ${ui.border}`, borderRadius: KIT_RADIUS.inner, background: ui.surface2, display: 'grid', gap: KIT_SPACE[1] }}>
      <div style={{ ...KIT_TYPE.cardTitle, color: ui.text }}>{selAcc.email}{selAcc.is_default ? ' · your default' : ''}</div>
      <span style={small}>{selAcc.linked_business_ids.length ? `Works for ${selAcc.linked_business_ids.map(id => workspaceOf(id)?.name).filter(Boolean).join(', ')}` : 'Linked to no workspace'}{selAcc.is_default ? ' · also the account your personal tools use' : ''}</span>
      {selAcc.state === 'needs_reconnect' && <span style={{ ...KIT_TYPE.small, color: AMBER }}>Google no longer accepts this account's token. Reconnect to resume; its workspaces keep their link.</span>}
      <ButtonRow align="start">
        {!selAcc.is_default && <Button onClick={() => makeDefault(selAcc)} data-make-default>Make default</Button>}
        {selAcc.state === 'needs_reconnect' && <Button variant="primary" onClick={() => reconnect(selAcc)} data-reconnect>Reconnect</Button>}
        <Button variant="tertiary" onClick={() => disconnect(selAcc)} data-disconnect style={{ color: ui.dangerInk }}>Disconnect</Button>
      </ButtonRow>
    </div>
  ) : null;

  const phone = (
    <div data-phone-list style={{ display: 'grid', gap: KIT_SPACE[1] }}>
      {data.workspaces.map(w => { const c = colorOf(w); const flagged = w.google_link?.state === 'needs_reconnect'; const derivedOnly = !w.google_link && (w.microsoft_derived?.length || w.apollo_derived); return (
        <div key={w.id} data-phone-workspace={w.id} style={{ padding: '10px 12px', borderLeft: `3px ${flagged || derivedOnly ? 'dashed' : 'solid'} ${flagged ? AMBER : c}`, background: ui.inset, borderRadius: KIT_RADIUS.inner, display: 'grid', gap: 6 }}>
          <span style={{ color: ui.text }}>{w.name}</span><span style={small}>{workspaceLine(w)}</span>
          {canLink(w) && <Button size="sm" onClick={() => setPicker({ workspace: w })} style={{ minHeight: 44 }} data-link-mailbox={w.id}>{w.google_link ? 'Change mailbox' : 'Link a mailbox'}</Button>}
        </div>); })}
      <div style={{ padding: '10px 12px', borderLeft: '3px dashed #8A8A8A', background: ui.inset, borderRadius: KIT_RADIUS.inner }}><span style={{ color: ui.text }}>Personal tools</span><div style={small}>{def ? `${def.email} (default)` : 'No default Google account'} · Voice profile, Gmail intent, Slides</div></div>
      <button type="button" data-connect-new onClick={() => connectNew(null, [])} style={{ ...nodeBase, border: `1px dashed ${ui.control}`, background: 'transparent', color: ui.link, justifyContent: 'center', minHeight: 44 }}>+ Connect another Google account</button>
    </div>
  );

  return (
    <>
      <Card title="Mailboxes" subtitle={`${data.accounts.length} Google account${data.accounts.length === 1 ? '' : 's'} · ${data.workspaces.filter(w => w.google_link).length} of ${data.workspaces.length} workspaces linked`}>
        {narrow ? phone : (
          <div ref={wrap} data-tether-map style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'minmax(0, 5fr) minmax(0, 4fr)', columnGap: 'clamp(80px, 18%, 220px)', alignItems: 'start' }}>
            <Curves tethers={tethers} selected={selected} box={box} rects={rects} theme={theme} />
            {accountsCol}{workspacesCol}
          </div>
        )}
        {detail}
        {note && <p role="status" style={{ ...KIT_TYPE.small, color: ui.muted, margin: `${KIT_SPACE[1]}px 0 0` }}>{note}</p>}
      </Card>
      {picker && <MailboxPicker workspace={picker.workspace} accounts={data.accounts} workspaces={data.workspaces} defaultId={def?.id} onClose={() => setPicker(null)} onConnectNew={purposes => connectNew(picker.workspace, purposes)} onLink={async (accountId, purposes) => { await run(() => api('PUT', '/link', { business_id: picker.workspace.id, account_id: accountId, purposes }), `${picker.workspace.name} linked.`); setPicker(null); }} />}
    </>
  );
}

// "Which mailbox should <Workspace> use?" - the kit has no modal; this is the smallest dialog on the kit tokens.
export function MailboxPicker({ workspace, accounts, workspaces, defaultId, onClose, onConnectNew, onLink }) {
  const [accountId, setAccountId] = useState(workspace.google_link?.account_id || accounts[0]?.id || null);
  const [purposes, setPurposes] = useState(workspace.google_link?.purposes || ['drafts', 'inbox']);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const onKey = e => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey); }, [onClose]);
  const toggle = p => setPurposes(ps => (ps.includes(p) ? ps.filter(x => x !== p) : [...ps, p]));
  const elsewhere = a => workspaces.filter(w => w.id !== workspace.id && w.google_link?.account_id === a.id).map(w => w.name);
  return (
    <>
      <div onClick={onClose} aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,.45)' }} />
      <div role="dialog" aria-modal="true" aria-labelledby="mailbox-picker-title" data-mailbox-picker style={{ position: 'fixed', zIndex: 81, top: '8vh', left: '50%', transform: 'translateX(-50%)', width: 'min(520px, calc(100vw - 32px))', maxHeight: '84vh', overflowY: 'auto', padding: KIT_SPACE[3], background: ui.surface, border: `1px solid ${ui.border}`, borderRadius: KIT_RADIUS.card, color: ui.text, ...KIT_TYPE.body }}>
        <h2 id="mailbox-picker-title" style={{ ...KIT_TYPE.cardTitle, margin: 0 }}>Which mailbox should {workspace.name} use?</h2>
        <p style={{ ...small, margin: '6px 0 12px' }}>Only your own accounts are listed. Teammates link their own mailboxes from their login.</p>
        <div role="radiogroup" aria-label="Your Google accounts" style={{ display: 'grid', gap: 8 }}>
          {accounts.map(a => { const used = elsewhere(a); return (
            <label key={a.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 10, border: `1px solid ${accountId === a.id ? ui.accent : ui.border}`, borderRadius: KIT_RADIUS.inner, background: ui.inset, cursor: 'pointer' }}>
              <input type="radio" name="mailbox" checked={accountId === a.id} onChange={() => setAccountId(a.id)} style={{ marginTop: 3 }} />
              <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                <span style={{ color: ui.text }} data-picker-email>{a.email}{a.is_default ? ' · default' : ''}{a.state === 'needs_reconnect' ? ' · needs reconnect' : ''}</span>
                {used.length > 0 && <span style={small}>Already linked to {used.join(', ')}</span>}
                {a.id === defaultId && <span style={{ ...KIT_TYPE.small, color: AMBER }} data-default-note>Your default account. {workspace.name} drafts would land in your personal Drafts.</span>}
              </span>
            </label>); })}
          <button type="button" data-picker-connect-new onClick={() => onConnectNew(purposes)} style={{ ...nodeBase, border: `1px dashed ${ui.control}`, background: 'transparent', color: ui.link, justifyContent: 'center', minHeight: 44 }}>+ Connect another Google account</button>
        </div>
        <div style={{ display: 'grid', gap: 6, margin: '14px 0' }}>
          {[['drafts', 'Outreach drafts (never sends)'], ['inbox', `Reading my inbox inside ${workspace.name}`], ['calendar', 'Calendar']].map(([p, label]) => (
            <label key={p} style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 32, cursor: 'pointer' }}><input type="checkbox" checked={purposes.includes(p)} onChange={() => toggle(p)} data-purpose-box={p} />{label}</label>
          ))}
        </div>
        <ButtonRow align="between">
          <Button variant="tertiary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!accountId || !purposes.length || busy} onClick={async () => { setBusy(true); try { await onLink(accountId, purposes); } finally { setBusy(false); } }} data-link-submit>Link mailbox</Button>
        </ButtonRow>
      </div>
    </>
  );
}
