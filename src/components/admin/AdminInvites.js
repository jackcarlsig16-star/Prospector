import { C, mono } from '../../constants/colors';
import { createInvite, revokeInvite, buildInviteEmail, normalizeRoleForForm, getInvites } from '../../utils/invites';

const ROLE_OPTIONS = [
  { value:"ae",      label:"AE",      color:C.gold },
  { value:"bdr",     label:"BDR",     color:C.purple },
  { value:"manager", label:"Manager", color:C.blue },
  { value:"admin",   label:"Admin",   color:C.red },
];

const STATUS_C = { pending:C.orange, used:C.green, revoked:C.dim };

const fmtDate = iso => { try { return new Date(iso).toLocaleDateString("en-US",{month:"short",day:"numeric"}); } catch { return "—"; } };

export default function AdminInvites({ invites, setInvites, inviteModal, setInviteModal, inviteForm, setInviteForm, inviteConfirm, setInviteConfirm, copiedInvCode, setCopiedInvCode, invitePage, setInvitePage, onSaveUsers, currentUser }) {
  const PAGE_SIZE    = 20;
  const sorted       = [...invites].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const pageInvites  = sorted.slice(invitePage*PAGE_SIZE, (invitePage+1)*PAGE_SIZE);
  const totalPages   = Math.ceil(sorted.length/PAGE_SIZE);
  const pendingCount = invites.filter(i=>i.status==="pending").length;
  const revokeGate   = () => { try { localStorage.removeItem("prospector_gate_unlocked"); } catch {} alert("Gate cleared. Reload to see the lock screen."); };

  const inp2 = { fontSize:13, padding:"8px 11px", background:C.bg, border:`1.5px solid ${C.brdM}`, borderRadius:6, color:C.txt, outline:"none", width:"100%", boxSizing:"border-box", ...mono };

  const handleSendInvite = () => {
    if (!inviteForm.name.trim() || !inviteForm.email.trim()) return;
    const invite = createInvite({ name:inviteForm.name, email:inviteForm.email, role:inviteForm.role, createdBy:currentUser?.name||"" });
    setInvites(getInvites());

    onSaveUsers(prev => {
      const email = invite.email.toLowerCase();
      if (prev.some(u => u.email?.toLowerCase() === email)) return prev;
      const entry = {
        id:      `inv_${invite.id}`,
        name:    invite.name,
        email:   invite.email,
        role:    normalizeRoleForForm(invite.role),
        company: currentUser?.company || "Prospector",
        status:  "pending",
      };
      const next = [...prev, entry];
      try { localStorage.setItem("prospector_team_users", JSON.stringify(next)); } catch {}
      return next;
    });

    const appUrl    = window.location.origin;
    const emailBody = buildInviteEmail({ name:invite.name, code:invite.code, role:invite.role, appUrl });
    window.open(`mailto:${invite.email}?subject=${encodeURIComponent("You're invited to Prospector")}&body=${encodeURIComponent(emailBody)}`);
    setInviteConfirm({ code:invite.code, email:invite.email });
    setInviteForm({ name:"", email:"", role:"bdr" });
    setInviteModal(false);
  };

  const handleResend = inv => {
    const appUrl    = window.location.origin;
    const emailBody = buildInviteEmail({ name:inv.name, code:inv.code, role:inv.role, appUrl });
    window.open(`mailto:${inv.email}?subject=${encodeURIComponent("You're invited to Prospector")}&body=${encodeURIComponent(emailBody)}`);
  };

  const handleRevoke = id => { revokeInvite(id); setInvites(getInvites()); };

  const handleCopyCode = code => {
    navigator.clipboard.writeText(code).catch(()=>{});
    setCopiedInvCode(code);
    setTimeout(()=>setCopiedInvCode(null), 1500);
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14, flexWrap:"wrap" }}>
        <p style={{ ...mono, margin:0, fontSize:11, color:C.dim, flex:1 }}>
          Per-person invite codes — single-use, role-specific. Each person gets their own code.
          {pendingCount>0 && <span style={{ color:C.orange, marginLeft:8 }}>· {pendingCount} pending</span>}
        </p>
        <button onClick={()=>{ setInviteConfirm(null); setInviteForm({name:"",email:"",role:"bdr"}); setInviteModal(true); }}
          style={{ ...mono, fontSize:12, padding:"6px 14px", background:`${C.gold}18`, border:`1px solid ${C.gold}55`, color:C.gold, borderRadius:6, cursor:"pointer", fontWeight:600, flexShrink:0 }}>
          + Invite someone
        </button>
      </div>

      {/* Confirm banner */}
      {inviteConfirm && (
        <div style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 14px", background:`${C.green}10`, border:`1px solid ${C.green}44`, borderRadius:8, marginBottom:14 }}>
          <span style={{ ...mono, fontSize:12, color:C.green, flex:1 }}>
            ✓ Invite sent to <strong>{inviteConfirm.email}</strong> — code: <strong style={{ letterSpacing:"0.12em" }}>{inviteConfirm.code}</strong>
          </span>
          <button onClick={()=>handleCopyCode(inviteConfirm.code)}
            style={{ ...mono, fontSize:11, padding:"3px 10px", background:`${C.green}14`, border:`1px solid ${C.green}44`, color:C.green, borderRadius:4, cursor:"pointer", flexShrink:0 }}>
            {copiedInvCode===inviteConfirm.code?"Copied ✓":"Copy code"}
          </button>
          <button onClick={()=>setInviteConfirm(null)} style={{ background:"transparent", border:"none", color:C.dim, cursor:"pointer", fontSize:16, lineHeight:1, flexShrink:0 }}>✕</button>
        </div>
      )}

      {/* Invite list */}
      {invites.length===0 ? (
        <div style={{ padding:"32px 0", textAlign:"center" }}>
          <p style={{ ...mono, fontSize:13, color:C.dim, margin:"0 0 6px" }}>No invites yet.</p>
          <p style={{ ...mono, fontSize:11, color:`${C.dim}88`, margin:0 }}>Send the first one with the button above.</p>
        </div>
      ) : (
        <div style={{ border:`1px solid ${C.brd}`, borderRadius:8, overflow:"hidden" }}>
          <div style={{ display:"grid", gridTemplateColumns:"1.8fr 120px 70px 80px 80px 170px", padding:"7px 14px", background:C.sur, borderBottom:`1px solid ${C.brd}` }}>
            {["Name / Email","Code","Role","Created","Status","Actions"].map(h=>(
              <span key={h} style={{ ...mono, fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>{h}</span>
            ))}
          </div>
          {pageInvites.map((inv,i)=>{
            const rc = ROLE_OPTIONS.find(r=>r.value===inv.role)?.color || C.dim;
            const sc = STATUS_C[inv.status] || C.dim;
            const isRevoked = inv.status==="revoked";
            const isUsed    = inv.status==="used";
            return (
              <div key={inv.id} style={{ display:"grid", gridTemplateColumns:"1.8fr 120px 70px 80px 80px 170px", padding:"9px 14px", borderBottom:i<pageInvites.length-1?`1px solid ${C.brd}11`:"none", background:isRevoked?`${C.sur}44`:C.card, opacity:isRevoked?0.45:1, alignItems:"center" }}>
                <div style={{ minWidth:0 }}>
                  <p style={{ ...mono, margin:"0 0 1px", fontSize:13, color:isRevoked?C.mut:C.txt, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{inv.name}</p>
                  <p style={{ ...mono, margin:0, fontSize:11, color:C.dim, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{inv.email}</p>
                  {isUsed && inv.usedBy && <p style={{ ...mono, margin:"1px 0 0", fontSize:10, color:`${C.green}88` }}>used by {inv.usedBy}</p>}
                </div>
                <span style={{ ...mono, fontSize:12, fontWeight:700, color:isRevoked?C.dim:C.gold, letterSpacing:"0.1em", textDecoration:isRevoked?"line-through":"none", whiteSpace:"nowrap" }}>{inv.code}</span>
                <span style={{ ...mono, fontSize:11, padding:"2px 7px", borderRadius:9, background:`${rc}18`, border:`1px solid ${rc}44`, color:rc, display:"inline-block", textAlign:"center" }}>
                  {ROLE_OPTIONS.find(r=>r.value===inv.role)?.label || inv.role}
                </span>
                <span style={{ ...mono, fontSize:11, color:C.dim }}>{fmtDate(inv.createdAt)}</span>
                <span style={{ ...mono, fontSize:11, color:sc }}>
                  {inv.status==="pending"?"● Pending":inv.status==="used"?`✓ Used ${inv.usedAt?fmtDate(inv.usedAt):""}`:inv.status==="revoked"?"✕ Revoked":"—"}
                </span>
                <div style={{ display:"flex", gap:5 }}>
                  {!isRevoked && (
                    <button onClick={()=>handleCopyCode(inv.code)}
                      style={{ ...mono, fontSize:10, padding:"2px 7px", background:`${C.gold}12`, border:`1px solid ${C.gold}33`, color:C.gold, borderRadius:4, cursor:"pointer", flexShrink:0 }}>
                      {copiedInvCode===inv.code?"✓":"⎘"}
                    </button>
                  )}
                  {inv.status==="pending" && (
                    <button onClick={()=>handleResend(inv)}
                      style={{ ...mono, fontSize:10, padding:"2px 7px", background:`${C.blue}12`, border:`1px solid ${C.blue}33`, color:C.blue, borderRadius:4, cursor:"pointer", flexShrink:0 }}>
                      Resend
                    </button>
                  )}
                  {!isRevoked && !isUsed && (
                    <button onClick={()=>handleRevoke(inv.id)}
                      style={{ ...mono, fontSize:10, padding:"2px 7px", background:"transparent", border:`1px solid ${C.red}33`, color:C.red+"aa", borderRadius:4, cursor:"pointer", flexShrink:0 }}>
                      Revoke
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages>1 && (
        <div style={{ display:"flex", justifyContent:"center", gap:8, marginTop:12 }}>
          <button onClick={()=>setInvitePage(p=>Math.max(0,p-1))} disabled={invitePage===0}
            style={{ ...mono, fontSize:11, padding:"4px 12px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:5, color:invitePage===0?C.dim:C.txt, cursor:invitePage===0?"not-allowed":"pointer" }}>←</button>
          <span style={{ ...mono, fontSize:11, color:C.dim, lineHeight:"27px" }}>{invitePage+1} / {totalPages}</span>
          <button onClick={()=>setInvitePage(p=>Math.min(totalPages-1,p+1))} disabled={invitePage===totalPages-1}
            style={{ ...mono, fontSize:11, padding:"4px 12px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:5, color:invitePage===totalPages-1?C.dim:C.txt, cursor:invitePage===totalPages-1?"not-allowed":"pointer" }}>→</button>
        </div>
      )}

      {/* Gate reset */}
      <div style={{ marginTop:20, background:C.card, border:`1px solid ${C.brd}`, borderRadius:8, padding:"14px 18px", display:"flex", alignItems:"center", gap:16 }}>
        <div style={{ flex:1 }}>
          <p style={{ ...mono, margin:"0 0 2px", fontSize:13, color:C.txt, fontWeight:600 }}>🔒 Force lock screen</p>
          <p style={{ ...mono, margin:0, fontSize:11, color:C.dim }}>Clears the unlock flag. Use to test the gate or reset your own session.</p>
        </div>
        <button onClick={revokeGate} style={{ ...mono, fontSize:12, padding:"7px 18px", background:`${C.red}12`, border:`1px solid ${C.red}44`, color:C.red, borderRadius:6, cursor:"pointer", flexShrink:0 }}>Revoke my access</button>
      </div>

      {/* Invite composer modal */}
      {inviteModal && (
        <div onClick={e=>{if(e.target===e.currentTarget){setInviteModal(false);}}} style={{ position:"fixed", inset:0, zIndex:1000, background:"#00000099", display:"flex", alignItems:"center", justifyContent:"center" }}>
          <div style={{ background:C.card, border:`1px solid ${C.brd}`, borderRadius:12, padding:"22px 26px", width:400, boxShadow:"0 20px 60px #000c" }}>
            <div style={{ display:"flex", alignItems:"center", marginBottom:20 }}>
              <span style={{ ...mono, fontSize:14, color:C.txt, fontWeight:700 }}>Invite someone to Prospector</span>
              <button onClick={()=>setInviteModal(false)} style={{ marginLeft:"auto", background:"transparent", border:"none", color:C.mut, fontSize:18, cursor:"pointer" }}>✕</button>
            </div>
            <div style={{ marginBottom:12 }}>
              <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>Name</div>
              <input type="text" placeholder="Casey Doe" value={inviteForm.name} onChange={e=>setInviteForm(f=>({...f,name:e.target.value}))} style={inp2}/>
            </div>
            <div style={{ marginBottom:16 }}>
              <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>Work email</div>
              <input type="email" placeholder="casey@example.com" value={inviteForm.email} onChange={e=>setInviteForm(f=>({...f,email:e.target.value}))}
                onKeyDown={e=>e.key==="Enter"&&inviteForm.name.trim()&&inviteForm.email.trim()&&handleSendInvite()}
                style={inp2}/>
            </div>
            <div style={{ marginBottom:22 }}>
              <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>Role</div>
              <div style={{ display:"flex", gap:6 }}>
                {ROLE_OPTIONS.map(r=>(
                  <button key={r.value} onClick={()=>setInviteForm(f=>({...f,role:r.value}))}
                    style={{ ...mono, flex:1, fontSize:11, padding:"7px 4px", borderRadius:6, border:`1px solid ${inviteForm.role===r.value?r.color:C.brd}`, background:inviteForm.role===r.value?`${r.color}18`:"transparent", color:inviteForm.role===r.value?r.color:C.dim, cursor:"pointer", fontWeight:inviteForm.role===r.value?700:400 }}>
                    {r.label}
                  </button>
                ))}
              </div>
              <p style={{ ...mono, margin:"8px 0 0", fontSize:11, color:C.dim }}>
                {inviteForm.role==="ae"?"Full territory access — assay engine, pricing, compliance, frontier"
                :inviteForm.role==="bdr"?"Account queue, tasks, frontier — read-only on AE territory"
                :inviteForm.role==="manager"?"Team command center, leaderboard, per-rep analytics"
                :"Full access including team management and platform settings"}
              </p>
            </div>
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
              <button onClick={()=>setInviteModal(false)} style={{ ...mono, fontSize:12, padding:"7px 16px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:6, color:C.mut, cursor:"pointer" }}>Cancel</button>
              <button onClick={handleSendInvite} disabled={!inviteForm.name.trim()||!inviteForm.email.trim()}
                style={{ ...mono, fontSize:12, padding:"7px 20px", background:inviteForm.name.trim()&&inviteForm.email.trim()?C.gold:"transparent", border:`1px solid ${inviteForm.name.trim()&&inviteForm.email.trim()?C.gold:C.brd}`, borderRadius:6, color:inviteForm.name.trim()&&inviteForm.email.trim()?C.bg:C.dim, cursor:inviteForm.name.trim()&&inviteForm.email.trim()?"pointer":"default", fontWeight:700 }}>
                Generate & Send →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
