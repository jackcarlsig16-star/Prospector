import { useState, useEffect, useCallback } from 'react';
import { C, mono } from '../constants/colors';
import { getListsForBusiness, createList, renameList, deleteList, getMembersForBusiness, getPermissionsForMembers, setMemberListPermission, getAccountCountForList } from '../utils/db';

const inp = { fontSize:13, padding:"7px 10px", background:C.bg, border:`1.5px solid ${C.brdM}`, borderRadius:6, color:C.txt, outline:"none", boxSizing:"border-box", ...mono };
const sectionLabel = { ...mono, fontSize:12, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:10 };

const LEVELS = [
  { id: 'none', label: 'None' },
  { id: 'view', label: 'View' },
  { id: 'edit', label: 'Edit' },
];

function levelFor(permissions, memberId, listId) {
  const row = permissions.find(p => p.member_id === memberId && p.list_id === listId);
  if (!row) return 'none';
  return row.can_edit ? 'edit' : row.can_view ? 'view' : 'none';
}

// Type-to-confirm rather than a plain yes/no click - deleting a list feels
// destructive even though the underlying accounts are always safe (cascade
// only ever touches list_id-scoped rows, never accounts themselves)
// (accounts-lists-and-activity-model-v1, Phase 7).
function DeleteListConfirm({ list, onClose, onConfirmed }) {
  const [count, setCount] = useState(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { getAccountCountForList(list.id).then(setCount); }, [list.id]);

  const confirmed = typed.trim() === list.name;

  const handleDelete = async () => {
    setBusy(true);
    await deleteList(list.id);
    setBusy(false);
    onConfirmed(list.id);
  };

  return (
    <div onClick={e=>{if(e.target===e.currentTarget) onClose();}} style={{ position:"fixed", inset:0, zIndex:1000, background:"#00000099", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ background:C.card, border:`1px solid ${C.red}55`, borderRadius:12, padding:"22px 26px", width:400, boxShadow:"0 20px 60px #000c" }}>
        <p style={{ ...mono, fontSize:14, color:C.txt, fontWeight:700, margin:"0 0 12px" }}>Delete "{list.name}"?</p>
        <p style={{ ...mono, fontSize:12, color:C.dim, margin:"0 0 16px", lineHeight:1.6 }}>
          {count === null ? 'Checking account count…' : (
            <>This list has <span style={{ color:C.txt, fontWeight:700 }}>{count}</span> account{count !== 1 ? 's' : ''}. Deleting it won't delete the accounts — they'll stay in the repository, just with one fewer list. Type the list name to confirm.</>
          )}
        </p>
        <input autoFocus value={typed} onChange={e=>setTyped(e.target.value)} placeholder={list.name}
          onKeyDown={e=>e.key==='Enter' && confirmed && !busy && handleDelete()}
          style={{ ...inp, marginBottom:16 }} disabled={busy} />
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
          <button onClick={onClose} style={{ ...mono, fontSize:12, padding:"7px 16px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:6, color:C.mut, cursor:"pointer" }}>Cancel</button>
          <button onClick={handleDelete} disabled={!confirmed||busy}
            style={{ ...mono, fontSize:12, padding:"7px 18px", background:confirmed?C.red:"transparent", border:`1px solid ${confirmed?C.red:C.brd}`, borderRadius:6, color:confirmed?"#fff":C.dim, cursor:confirmed&&!busy?"pointer":"default", fontWeight:700 }}>
            {busy ? "Deleting…" : "Delete list"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ListRow({ list, onRenamed, onDeleted }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(list.name);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const commit = async () => {
    if (!name.trim() || name.trim() === list.name) { setEditing(false); setName(list.name); return; }
    setBusy(true);
    const { error } = await renameList(list.id, name.trim());
    setBusy(false);
    if (!error) onRenamed(list.id, name.trim());
    setEditing(false);
  };

  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 10px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:6 }}>
      {editing ? (
        <input autoFocus value={name} onChange={e=>setName(e.target.value)} onBlur={commit}
          onKeyDown={e=>{ if(e.key==="Enter") commit(); if(e.key==="Escape"){setEditing(false);setName(list.name);} }}
          style={{ ...inp, flex:1, padding:"4px 8px" }} disabled={busy} />
      ) : (
        <span onClick={()=>setEditing(true)} style={{ ...mono, fontSize:13, color:C.txt, flex:1, cursor:"pointer" }}>{list.name}</span>
      )}
      <button onClick={()=>setConfirmingDelete(true)}
        style={{ ...mono, fontSize:11, color:C.dim, background:"transparent", border:"none", cursor:"pointer", padding:"2px 6px" }}
        onMouseEnter={e=>e.currentTarget.style.color=C.red} onMouseLeave={e=>e.currentTarget.style.color=C.dim}>✕</button>
      {confirmingDelete && (
        <DeleteListConfirm list={list} onClose={()=>setConfirmingDelete(false)} onConfirmed={onDeleted} />
      )}
    </div>
  );
}

export default function MembersPermissionsTab({ business, viewerEmail }) {
  const [lists, setLists] = useState([]);
  const [members, setMembers] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newListName, setNewListName] = useState('');
  const [newListPreset, setNewListPreset] = useState('solo');
  const [creating, setCreating] = useState(false);

  const isOwner = (business.owner_email || '').toLowerCase() === (viewerEmail || '').toLowerCase();

  const load = useCallback(async () => {
    const [listRows, memberRows] = await Promise.all([
      getListsForBusiness(business.id),
      getMembersForBusiness(business.id),
    ]);
    setLists(listRows);
    setMembers(memberRows);
    const permRows = await getPermissionsForMembers(memberRows.map(m => m.id));
    setPermissions(permRows);
    setLoading(false);
  }, [business.id]);

  useEffect(() => { load(); }, [load]);

  if (!isOwner) {
    return <p style={{ ...mono, fontSize:13, color:C.dim }}>Only {business.name}'s owner can manage members and lists.</p>;
  }

  // Solo = just the creator (the owner, who always has implicit full access
  // regardless of any permission row - so this is really "grant no one else
  // anything"). Shared = every current member gets view+edit on this new
  // list right away. Both are a starting point, not a lock - the matrix
  // stays fully editable afterward either way.
  const handleCreateList = async () => {
    if (!newListName.trim() || creating) return;
    setCreating(true);
    const { list, error } = await createList(business.id, newListName.trim());
    if (!error) {
      setLists(prev => [...prev, list]);
      setNewListName('');
      if (newListPreset === 'shared' && members.length > 0) {
        await Promise.all(members.map(m => setMemberListPermission(m.id, list.id, 'edit')));
        setPermissions(prev => [...prev, ...members.map(m => ({ member_id: m.id, list_id: list.id, can_view: true, can_edit: true }))]);
      }
    }
    setCreating(false);
  };

  // The actual delete already ran inside DeleteListConfirm's verify-stage
  // flow (real count shown, type-to-confirm) - this just reconciles local
  // state afterward, doesn't delete a second time.
  const handleDeleteList = (listId) => {
    setLists(prev => prev.filter(l => l.id !== listId));
    setPermissions(prev => prev.filter(p => p.list_id !== listId));
  };

  const handleLevelChange = async (memberId, listId, level) => {
    setPermissions(prev => {
      const without = prev.filter(p => !(p.member_id === memberId && p.list_id === listId));
      if (level === 'none') return without;
      return [...without, { member_id: memberId, list_id: listId, can_view: true, can_edit: level === 'edit' }];
    });
    await setMemberListPermission(memberId, listId, level);
  };

  if (loading) return <p style={{ ...mono, fontSize:13, color:C.dim }}>Loading…</p>;

  return (
    <div style={{ maxWidth:900 }}>
      <div style={{ marginBottom:32 }}>
        <div style={sectionLabel}>Lists</div>
        <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:10 }}>
          {lists.map(l => (
            <ListRow key={l.id} list={l}
              onRenamed={(id,name)=>setLists(prev=>prev.map(x=>x.id===id?{...x,name}:x))}
              onDeleted={handleDeleteList} />
          ))}
          {lists.length === 0 && <p style={{ ...mono, fontSize:12, color:C.dim, margin:0 }}>No lists yet — create one below to start granting access.</p>}
        </div>
        <div style={{ display:"flex", gap:8, marginBottom:8 }}>
          {[
            { id:'solo', label:'Solo', hint:'Just you' },
            { id:'shared', label:'Shared', hint:`Every current member gets edit (${members.length})`, disabled: members.length===0 },
          ].map(p => (
            <button key={p.id} disabled={p.disabled} title={p.hint} onClick={()=>setNewListPreset(p.id)} style={{
              ...mono, fontSize:11, padding:"5px 12px", borderRadius:20, cursor:p.disabled?"default":"pointer",
              background: newListPreset===p.id ? C.gold : "transparent", color: newListPreset===p.id ? C.bg : (p.disabled?C.dim:C.mut),
              border:`1px solid ${newListPreset===p.id ? C.gold : C.brd}`, fontWeight: newListPreset===p.id ? 700 : 400,
              opacity: p.disabled ? 0.5 : 1,
            }}>{p.label}</button>
          ))}
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <input placeholder="New list name" value={newListName} onChange={e=>setNewListName(e.target.value)}
            onKeyDown={e=>e.key==="Enter" && handleCreateList()} style={{ ...inp, flex:1 }} />
          <button onClick={handleCreateList} disabled={!newListName.trim()||creating}
            style={{ ...mono, fontSize:12, padding:"7px 16px", background:newListName.trim()?C.gold:"transparent", border:`1px solid ${newListName.trim()?C.gold:C.brd}`, borderRadius:6, color:newListName.trim()?C.bg:C.dim, cursor:newListName.trim()?"pointer":"default", fontWeight:700 }}>
            + Add
          </button>
        </div>
      </div>

      <div>
        <div style={sectionLabel}>Permissions</div>
        {members.length === 0 ? (
          <p style={{ ...mono, fontSize:12, color:C.dim, margin:0 }}>
            No members yet. Share the invite link below to add collaborators — new members default to view+edit on every current list.
          </p>
        ) : lists.length === 0 ? (
          <p style={{ ...mono, fontSize:12, color:C.dim, margin:0 }}>Create a list above before setting permissions.</p>
        ) : (
          <div style={{ overflowX:"auto" }}>
            <table style={{ borderCollapse:"collapse", width:"100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign:"left", padding:"6px 10px", ...mono, fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.05em" }}>Member</th>
                  {lists.map(l => (
                    <th key={l.id} style={{ textAlign:"left", padding:"6px 10px", ...mono, fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.05em" }}>{l.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.map(m => (
                  <tr key={m.id} style={{ borderTop:`1px solid ${C.brd}` }}>
                    <td style={{ padding:"8px 10px" }}>
                      <div style={{ ...mono, fontSize:13, color:C.txt }}>{m.name}</div>
                      <div style={{ ...mono, fontSize:10, color:C.dim }}>{m.email}</div>
                    </td>
                    {lists.map(l => (
                      <td key={l.id} style={{ padding:"8px 10px" }}>
                        <select value={levelFor(permissions, m.id, l.id)} onChange={e=>handleLevelChange(m.id, l.id, e.target.value)}
                          style={{ ...mono, fontSize:11, padding:"4px 6px", background:C.bg, border:`1px solid ${C.brdM}`, borderRadius:4, color:C.txt, cursor:"pointer" }}>
                          {LEVELS.map(lv => <option key={lv.id} value={lv.id}>{lv.label}</option>)}
                        </select>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ marginTop:32, padding:"14px 16px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:8 }}>
        <div style={{ ...mono, fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>Invite link</div>
        <p style={{ ...mono, fontSize:12, color:C.txt, margin:0, wordBreak:"break-all" }}>{window.location.origin}/join/{business.access_code}</p>
      </div>
    </div>
  );
}
