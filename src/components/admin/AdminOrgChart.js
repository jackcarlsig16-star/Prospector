import { C, mono } from '../../constants/colors';
import OrgChart from '../OrgChart';

export default function AdminOrgChart({ users, setUsers, invitedIds, setInvitedIds, currentUser, onSaveUsers, onUpdateCurrentUser, seedTeam, importSeedTeam }) {
  const existingIds  = new Set(users.map(u=>u.id));
  let tombstoned = new Set();
  try { tombstoned = new Set(JSON.parse(localStorage.getItem('prospector_removed_user_ids') || '[]')); } catch {}
  const missingCount = seedTeam.filter(u => !existingIds.has(u.id) && !tombstoned.has(u.id)).length;
  const pendingCount = users.filter(n => n.status==="pending"||!n.status).length;

  const sendAllInvites = () => {
    const pending = users.filter(n => n.email && (n.status==="pending"||!n.status) && !invitedIds.has(n.id));
    if(!pending.length) return;
    const appUrl  = window.location.origin;
    const toList  = pending.map(n=>n.email).join(",");
    const subject = encodeURIComponent("You're invited to Prospector");
    const body    = encodeURIComponent(`Team,\n\nYou're invited to Prospector — our deal intelligence tool for the SMB AE team.\n\nJoin here: ${appUrl}`);
    window.open(`mailto:${toList}?subject=${subject}&body=${body}`);
    setInvitedIds(s => new Set([...s, ...pending.map(n=>n.id)]));
  };

  const ownerId       = currentUser?.id || currentUser?.email || currentUser?.name || "owner";
  const ownerNode     = { ...currentUser, id: ownerId, role: "AE", _isOwner: true, status: "active" };
  const filteredUsers = users.filter(u =>
    u.id !== ownerId &&
    (!(u.email && currentUser?.email) || u.email.toLowerCase() !== currentUser.email.toLowerCase())
  );

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16, flexWrap:"wrap" }}>
        <p style={{ ...mono, margin:0, fontSize:11, color:C.dim, flex:1 }}>
          Drag AE chips onto manager boxes to reassign · drag BDR chips onto AE chips to assign
          {pendingCount>0 && <span style={{ color:C.orange, marginLeft:8 }}>· {pendingCount} pending</span>}
        </p>
        {missingCount>0 && (
          <button onClick={importSeedTeam}
            style={{ ...mono, fontSize:11, padding:"4px 12px", background:`${C.blue}14`, border:`1px solid ${C.blue}44`, color:C.blue, borderRadius:6, cursor:"pointer" }}>
            ↓ Load SMB team ({missingCount})
          </button>
        )}
        {pendingCount>0 && (
          <button onClick={sendAllInvites}
            style={{ ...mono, fontSize:11, padding:"4px 12px", background:`${C.purple}14`, border:`1px solid ${C.purple}44`, color:C.purple, borderRadius:6, cursor:"pointer" }}>
            ✉ Invite all pending ({pendingCount})
          </button>
        )}
      </div>
      <OrgChart
        teamUsers={[ownerNode, ...filteredUsers]}
        onSaveUsers={next => {
          const ownerInNext = next.find(u => u._isOwner);
          if (ownerInNext && ownerInNext.reportsTo !== currentUser?.reportsTo) {
            onUpdateCurrentUser && onUpdateCurrentUser({ reportsTo: ownerInNext.reportsTo || null });
          }
          const withoutOwner = next.filter(u => !u._isOwner);
          setUsers(withoutOwner); onSaveUsers(withoutOwner);
        }}
        activeUser={currentUser}
        isAdmin={true}
      />
    </div>
  );
}
