import { useState, useEffect, useCallback } from 'react';
import { C, mono } from '../../constants/colors';
import { ROLES, ROLE_LABELS, roleAtLeast } from '../../constants/roles';
import { fetchMe } from '../../utils/authSession';
import { CreateBusinessModal } from '../BusinessesHomePage';

// prospector-auth-v1 Stage 4 - per-workspace members, roles and invite links.
// Everything is enforced server-side (api/businesses/members.js,
// member-invites.js); this view only hides what the server would refuse.

const ROLE_COLOR = { owner: C.gold, admin: C.red, member: C.blue, viewer: C.dim };
const ALL = 'all';

async function call(url, opts = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function lastSeen(iso) {
  if (!iso) return 'never';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400e3);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days}d ago`;
}

const btn = (color, solid) => ({ ...mono, fontSize: 11, padding: '4px 10px', background: solid ? `${color}18` : 'transparent', border: `1px solid ${solid ? `${color}55` : C.brd}`, color: solid ? color : C.mut, borderRadius: 5, cursor: 'pointer', whiteSpace: 'nowrap' });
const inp = { ...mono, fontSize: 13, padding: '7px 10px', background: C.bg, border: `1.5px solid ${C.brdM}`, borderRadius: 6, color: C.txt, outline: 'none', boxSizing: 'border-box' };
const sectionLabel = { ...mono, fontSize: 10, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '18px 0 6px' };
const row = { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8 };

function RoleBadge({ role }) {
  const c = ROLE_COLOR[role] || C.mut;
  return <span style={{ ...mono, fontSize: 11, padding: '2px 9px', background: `${c}18`, border: `1px solid ${c}44`, color: c, borderRadius: 4 }}>{ROLE_LABELS[role] || role}</span>;
}

function LinkBox({ link, note, onDone }) {
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  return (
    <div style={{ padding: '12px 14px', background: `${C.green}0c`, border: `1px solid ${C.green}44`, borderRadius: 8, marginBottom: 12 }}>
      <p style={{ ...mono, margin: '0 0 8px', fontSize: 11, color: C.green }}>Invite link ready - single use, works for 7 days, only for {note.email}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <input readOnly value={link} onFocus={e => e.target.select()} style={{ ...inp, flex: 1, fontSize: 11 }} />
        <button onClick={copy} style={btn(C.green, true)}>{copied ? '✓ Copied' : 'Copy link'}</button>
        <button onClick={onDone} style={btn(C.mut)}>Done</button>
      </div>
      {note.emailed && <p style={{ ...mono, margin: '8px 0 0', fontSize: 11, color: C.green }}>Also emailed to {note.email}.</p>}
      {note.emailError && <p style={{ ...mono, margin: '8px 0 0', fontSize: 11, color: C.orange }}>{note.emailError}</p>}
    </div>
  );
}

export default function MembersAccess() {
  const [me, setMe] = useState(null);
  const [wsId, setWsId] = useState(null);
  const [data, setData] = useState(null);
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', role: 'member', sendEmail: false });
  const [linkNote, setLinkNote] = useState(null);
  const [addWsOpen, setAddWsOpen] = useState(false);

  const loadMe = useCallback(async selectId => {
    const m = await fetchMe();
    setMe(m);
    const manageable = m.memberships.filter(x => m.profile.is_platform_owner || roleAtLeast(x.role, 'admin'));
    setWsId(prev => selectId || prev || manageable[0]?.business_id || (m.profile.is_platform_owner ? ALL : null));
  }, []);
  useEffect(() => { loadMe().catch(e => setError(e.message)); }, [loadMe]);

  useEffect(() => {
    if (!wsId) return;
    setData(null); setOverview(null); setError(''); setLinkNote(null); setInviteOpen(false);
    (wsId === ALL ? call('/api/workspaces/members').then(setOverview) : call(`/api/businesses/${wsId}/members`).then(setData))
      .catch(e => setError(e.message));
  }, [wsId]);

  const isPlatformOwner = !!me?.profile.is_platform_owner;
  const manageable = (me?.memberships || []).filter(x => isPlatformOwner || roleAtLeast(x.role, 'admin'));
  const myRole = isPlatformOwner ? 'owner' : manageable.find(x => x.business_id === wsId)?.role;
  const canOwner = myRole === 'owner';
  const roleChoices = ROLES.filter(r => r !== 'owner' || canOwner);

  const run = async fn => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  const refresh = () => call(`/api/businesses/${wsId}/members`).then(setData);

  const changeRole = (m, role) => run(async () => {
    setData(await call(`/api/businesses/${wsId}/members/${m.id}`, { method: 'PATCH', body: JSON.stringify({ role }) }));
  });
  const removeMember = m => {
    if (!window.confirm(`Remove ${m.name} (${m.email}) from this workspace? They lose access on their next request.`)) return;
    run(async () => { setData(await call(`/api/businesses/${wsId}/members/${m.id}`, { method: 'DELETE' })); });
  };
  const sendInvite = e => {
    e.preventDefault();
    run(async () => {
      const r = await call(`/api/businesses/${wsId}/invites`, { method: 'POST', body: JSON.stringify({ name: form.name, email: form.email, role: form.role, send_email: form.sendEmail }) });
      setLinkNote({ link: r.link, email: r.invite.email, emailed: r.emailed, emailError: r.email_error });
      setForm({ name: '', email: '', role: 'member', sendEmail: false });
      setInviteOpen(false);
      await refresh();
    });
  };
  const inviteAction = (inv, action) => {
    if (action === 'revoke' && !window.confirm(`Cancel the invite for ${inv.email}? The link stops working.`)) return;
    run(async () => {
      const r = await call(`/api/businesses/${wsId}/invites/${inv.id}/${action}`, { method: 'POST' });
      setLinkNote(action === 'revoke' ? null : { link: r.link, email: inv.email, emailed: r.emailed, emailError: r.email_error });
      await refresh();
    });
  };

  if (!me) return <p style={{ ...mono, fontSize: 12, color: error ? C.red : C.dim }}>{error || 'Loading…'}</p>;
  if (!manageable.length && !isPlatformOwner) return <p style={{ ...mono, fontSize: 12, color: C.dim }}>You aren't an Admin or Owner of any workspace.</p>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {manageable.map(ws => (
          <button key={ws.business_id} onClick={() => setWsId(ws.business_id)}
            style={{ ...btn(ws.color || C.gold, wsId === ws.business_id), fontSize: 12, padding: '5px 12px' }}>{ws.name}</button>
        ))}
        {isPlatformOwner && <button onClick={() => setWsId(ALL)} style={{ ...btn(C.purple, wsId === ALL), fontSize: 12, padding: '5px 12px' }}>All workspaces</button>}
        {isPlatformOwner && <button onClick={() => setAddWsOpen(true)} style={{ ...btn(C.gold), marginLeft: 'auto' }}>+ Add workspace</button>}
      </div>

      {error && <p style={{ ...mono, fontSize: 12, color: C.red, margin: '0 0 12px' }}>{error}</p>}

      {wsId === ALL && overview && overview.workspaces.map(ws => (
        <div key={ws.id} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '0 0 6px' }}>
            <button onClick={() => setWsId(ws.id)} style={{ ...mono, fontSize: 13, fontWeight: 600, color: ws.color || C.txt, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>{ws.name} →</button>
            <span style={{ ...mono, fontSize: 11, color: C.dim }}>{ws.members.length} member{ws.members.length === 1 ? '' : 's'}{ws.open_invites ? ` · ${ws.open_invites} open invite${ws.open_invites === 1 ? '' : 's'}` : ''}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {ws.members.map(m => (
              <div key={m.email} style={{ ...row, padding: '6px 12px' }}>
                <span style={{ fontSize: 13, color: C.txt, flex: 1 }}>{m.name} <span style={{ ...mono, fontSize: 11, color: C.dim }}>{m.email}</span></span>
                <span style={{ ...mono, fontSize: 10, color: C.dim }}>{m.signed_up ? `seen ${lastSeen(m.last_seen_at)}` : 'not signed up'}</span>
                <RoleBadge role={m.role} />
              </div>
            ))}
          </div>
        </div>
      ))}

      {wsId !== ALL && data && (<>
        {linkNote && <LinkBox link={linkNote.link} note={linkNote} onDone={() => setLinkNote(null)} />}

        <div style={{ display: 'flex', alignItems: 'center', margin: '0 0 6px' }}>
          <p style={{ ...sectionLabel, margin: 0, flex: 1 }}>Members ({data.members.length})</p>
          {!inviteOpen && <button onClick={() => setInviteOpen(true)} style={btn(C.gold, true)}>+ Invite</button>}
        </div>

        {inviteOpen && (
          <form onSubmit={sendInvite} style={{ ...row, flexWrap: 'wrap', marginBottom: 10, borderColor: `${C.gold}55` }}>
            <input placeholder="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={{ ...inp, width: 150 }} />
            <input placeholder="email@company.com" type="email" required value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} style={{ ...inp, flex: 1, minWidth: 200 }} />
            <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} style={inp}>
              {roleChoices.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
            <label style={{ ...mono, fontSize: 11, color: C.mut, display: 'flex', alignItems: 'center', gap: 5 }} title="Sent by Supabase's default mailer, which only delivers a few emails an hour. The link always works.">
              <input type="checkbox" checked={form.sendEmail} onChange={e => setForm(f => ({ ...f, sendEmail: e.target.checked }))} /> Also email it
            </label>
            <button type="submit" disabled={busy} style={btn(C.gold, true)}>{busy ? '…' : 'Create link'}</button>
            <button type="button" onClick={() => setInviteOpen(false)} style={btn(C.mut)}>Cancel</button>
          </form>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {data.members.map(m => {
            const isMe = m.email === me.email;
            const ownerLocked = m.role === 'owner' && !canOwner;
            return (
              <div key={m.id} style={row}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 14, color: C.txt, fontWeight: 500 }}>{m.name}{isMe && <span style={{ ...mono, fontSize: 10, color: C.dim, marginLeft: 6 }}>you</span>}</p>
                  <p style={{ ...mono, margin: 0, fontSize: 11, color: C.dim }}>{m.email}</p>
                </div>
                <span style={{ ...mono, fontSize: 10, color: m.signed_up ? C.dim : C.orange }}>{m.signed_up ? `seen ${lastSeen(m.last_seen_at)}` : 'not signed up - invite them'}</span>
                {ownerLocked
                  ? <RoleBadge role={m.role} />
                  : <select value={m.role} disabled={busy} onChange={e => changeRole(m, e.target.value)} style={{ ...inp, fontSize: 12, padding: '4px 8px', color: ROLE_COLOR[m.role] }}>
                      {roleChoices.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                    </select>}
                {!ownerLocked && <button onClick={() => removeMember(m)} disabled={busy} style={btn(C.red)}>Remove</button>}
              </div>
            );
          })}
        </div>

        <p style={sectionLabel}>Pending invites ({data.invites.length})</p>
        {!data.invites.length && <p style={{ ...mono, fontSize: 12, color: C.dim, margin: 0 }}>None.</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {data.invites.map(inv => (
            <div key={inv.id} style={{ ...row, opacity: inv.expired ? 0.7 : 1 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13, color: C.txt }}>{inv.name || inv.email}{inv.name && <span style={{ ...mono, fontSize: 11, color: C.dim, marginLeft: 6 }}>{inv.email}</span>}</p>
                <p style={{ ...mono, margin: 0, fontSize: 10, color: inv.expired ? C.orange : C.dim }}>
                  {inv.expired ? 'expired' : `expires ${new Date(inv.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}{inv.invited_by ? ` · invited by ${inv.invited_by}` : ''}
                </p>
              </div>
              <RoleBadge role={inv.role} />
              {(inv.role !== 'owner' || canOwner) && (<>
                <button onClick={() => inviteAction(inv, 'link')} disabled={busy} title="Makes a new link; the old one stops working" style={btn(C.green)}>New link</button>
                <button onClick={() => inviteAction(inv, 'email')} disabled={busy} title="Makes a new link and emails it" style={btn(C.blue)}>Email</button>
                <button onClick={() => inviteAction(inv, 'revoke')} disabled={busy} style={btn(C.red)}>Revoke</button>
              </>)}
            </div>
          ))}
        </div>
      </>)}

      {wsId && !data && !overview && !error && <p style={{ ...mono, fontSize: 12, color: C.dim }}>Loading…</p>}

      {addWsOpen && (
        <CreateBusinessModal
          onClose={() => setAddWsOpen(false)}
          onCreated={b => { setAddWsOpen(false); loadMe(b.id).catch(e => setError(e.message)); }}
        />
      )}
    </div>
  );
}
