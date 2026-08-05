import { useState, useEffect } from "react";
import { C, mono } from '../constants/colors';
import { NAV, NAV_ROLES, initials, isAdmin } from '../constants/appConfig';
import { upsertBdrAssignment, removeBdrAssignment } from '../utils/db';

function readSidebarPrefs() {
  try { return JSON.parse(localStorage.getItem("prospector_prefs")||"{}"); } catch { return {}; }
}
function readImgPref(key) {
  try { return localStorage.getItem(`prospector_img_${key}`) || JSON.parse(localStorage.getItem("prospector_prefs")||"{}")[key] || null; } catch { return null; }
}

const ROLE_LEVEL = { Owner:5, Admin:4, Manager:3, AE:2, BDR:1 };

export default function Sidebar({ page, setPage, activeRole, toolsActiveTool, setToolsActiveTool, accountsSubPage, setAccountsSubPage, viewAs, setViewAs, activeInitials, hasUnviewedBadges, onOpenProfile, diamonds, activeUser, teamUsers, newJoinCount=0, onUpdateTeamUser, pendingApprovalCount=0, newNuggetCount=0, activeProject, onGoToProjects }) {
  const [sidebarPrefs, setSidebarPrefs] = useState(readSidebarPrefs);
  const [avatarImage, setAvatarImage] = useState(()=>readImgPref("avatarImage"));
  const [companyLogo, setCompanyLogo] = useState(()=>readImgPref("companyLogo"));
  useEffect(() => {
    const handler = () => {
      setSidebarPrefs(readSidebarPrefs());
      setAvatarImage(readImgPref("avatarImage"));
      setCompanyLogo(readImgPref("companyLogo"));
    };
    window.addEventListener('prospector_prefs_change', handler);
    return () => window.removeEventListener('prospector_prefs_change', handler);
  }, []);

  return (
    <div style={{ width:178, background:C.sur, borderRight:`1px solid ${C.brd}`, display:"flex", flexDirection:"column", height:"100vh", position:"sticky", top:0, flexShrink:0 }}>
      <div style={{ padding:"12px 14px", borderBottom:`1px solid ${C.brd}`, minHeight:50, display:"flex", alignItems:"center" }}>
        <div>
          <p style={{ ...mono, margin:0, fontWeight:600, fontSize:15, color:C.gold, letterSpacing:"0.1em" }}>PROSPECTOR</p>
          <p style={{ ...mono, margin:0, fontSize:11, color:C.mut, letterSpacing:"0.05em" }}>PROSPECT INTELLIGENCE</p>
        </div>
      </div>
      {activeProject && (
        <button onClick={onGoToProjects} title="All Projects" style={{
          display:"flex", alignItems:"center", gap:8, width:"100%", padding:"10px 14px",
          background:"transparent", border:"none", borderBottom:`1px solid ${C.brd}`,
          cursor:"pointer", textAlign:"left",
        }}>
          <span style={{ width:10, height:10, borderRadius:"50%", background:activeProject.color||C.gold, flexShrink:0 }} />
          <span style={{ ...mono, fontSize:12, color:C.txt, fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1 }}>
            {activeProject.name}
          </span>
          <span style={{ ...mono, fontSize:10, color:C.dim }}>All Projects ↗</span>
        </button>
      )}
      <div style={{ flex:1, padding:"6px 0", overflowY:"auto" }}>
        {NAV.filter(n=>(NAV_ROLES[n.id]||[]).includes(activeRole)).map(n=>{
        const parentActive = page===n.id || (n.id==="intelligence" && page==="analytics");
        return (
          <div key={n.id}>
            <div onClick={()=>setPage(n.id)} style={{ padding:"7px 12px", cursor:"pointer", display:"flex", alignItems:"center", gap:8, background:parentActive?C.card:"transparent", borderLeft:`3px solid ${parentActive?C.gold:"transparent"}` }}>
              <span style={{ ...mono, fontSize:14, color:parentActive?C.gold:C.mut }}>{n.ic}</span>
              <span style={{ fontSize:13, color:parentActive?C.txt:C.mut, whiteSpace:"nowrap", flex:1 }}>{n.lb}</span>
              {n.id==="admin" && pendingApprovalCount > 0 && (
                <div style={{ minWidth:16, height:16, borderRadius:8, background:"#EF4444", display:"flex", alignItems:"center", justifyContent:"center", padding:"0 4px", boxSizing:"border-box" }}>
                  <span style={{ ...mono, fontSize:9, color:"#fff", fontWeight:700, lineHeight:1 }}>{pendingApprovalCount}</span>
                </div>
              )}
              {n.id==="ideas" && newNuggetCount > 0 && (
                <div style={{ minWidth:16, height:16, borderRadius:8, background:"#EF4444", display:"flex", alignItems:"center", justifyContent:"center", padding:"0 4px", boxSizing:"border-box" }}>
                  <span style={{ ...mono, fontSize:9, color:"#fff", fontWeight:700, lineHeight:1 }}>{newNuggetCount}</span>
                </div>
              )}
              {(n.id==="tools"||n.id==="accounts"||n.id==="intelligence") && <span style={{ fontSize:10, color:C.dim }}>{parentActive?"▾":"▸"}</span>}
            </div>
            {n.id==="accounts" && page==="accounts" && (
              <div style={{ paddingLeft:20, borderLeft:`3px solid ${C.gold}33` }}>
                {[{id:"territory",ic:"◈",lb:"Territory"},{id:"prod_requests",ic:"📋",lb:"Prod. Requests"}].map(t=>(
                  <div key={t.id} onClick={()=>setAccountsSubPage(t.id)}
                    style={{ padding:"5px 12px", cursor:"pointer", display:"flex", alignItems:"center", gap:6,
                      background:accountsSubPage===t.id?`${C.gold}14`:"transparent",
                      borderLeft:`2px solid ${accountsSubPage===t.id?C.gold:"transparent"}` }}>
                    <span style={{ ...mono, fontSize:12, color:accountsSubPage===t.id?C.gold:C.dim }}>{t.ic}</span>
                    <span style={{ fontSize:12, color:accountsSubPage===t.id?C.txt:C.mut }}>{t.lb}</span>
                  </div>
                ))}
              </div>
            )}
            {n.id==="tools" && page==="tools" && (
              <div style={{ paddingLeft:20, borderLeft:`3px solid ${C.gold}33` }}>
                {[{id:"deal",ic:"$",lb:"Deal Workspace"},{id:"lookalike",ic:"◈",lb:"Account Lookalike"},{id:"email",ic:"✉",lb:"Email Generator"}].map(t=>(
                  <div key={t.id} onClick={()=>{setPage("tools");setToolsActiveTool(t.id);}}
                    style={{ padding:"5px 12px", cursor:"pointer", display:"flex", alignItems:"center", gap:6,
                      background:toolsActiveTool===t.id?`${C.gold}14`:"transparent",
                      borderLeft:`2px solid ${toolsActiveTool===t.id?C.gold:"transparent"}` }}>
                    <span style={{ ...mono, fontSize:12, color:toolsActiveTool===t.id?C.gold:C.dim }}>{t.ic}</span>
                    <span style={{ fontSize:12, color:toolsActiveTool===t.id?C.txt:C.mut }}>{t.lb}</span>
                  </div>
                ))}
              </div>
            )}
            {n.id==="intelligence" && parentActive && (
              <div style={{ paddingLeft:20, borderLeft:`3px solid ${C.gold}33` }}>
                {[
                  { id:"analytics",    ic:"▲", lb:"Analytics",                                        action:()=>setPage("analytics") },
                  { id:"profile",      ic:"☆", lb:"Profile",                                          action:()=>onOpenProfile?.() },
                  { id:"intelligence", ic:"⬟", lb:`${activeUser?.company || "Prospector"} Knowledge`,      action:()=>setPage("intelligence") },
                ].map(t=>{
                  const active = page===t.id;
                  return (
                    <div key={t.id} onClick={t.action}
                      style={{ padding:"5px 12px", cursor:"pointer", display:"flex", alignItems:"center", gap:6,
                        background:active?`${C.gold}14`:"transparent",
                        borderLeft:`2px solid ${active?C.gold:"transparent"}` }}>
                      <span style={{ ...mono, fontSize:12, color:active?C.gold:C.dim }}>{t.ic}</span>
                      <span style={{ fontSize:12, color:active?C.txt:C.mut }}>{t.lb}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
        })}
      </div>
      {/* Profile switcher */}
      <div style={{ padding:"10px 12px", borderTop:`1px solid ${C.brd}` }}>
        {companyLogo && (
          <div style={{ marginBottom:8, display:"flex", justifyContent:"center" }}>
            <img src={companyLogo} alt="Company" style={{ maxWidth:"100%", maxHeight:32, objectFit:"contain" }}/>
          </div>
        )}
        {viewAs&&(
          <div style={{ marginBottom:8, padding:"5px 8px", background:`${C.purple}18`, border:`1px solid ${C.purple}44`, borderRadius:5, display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ ...mono, fontSize:10, color:C.purple, flex:1 }}>Viewing as {viewAs.role}</span>
            <button onClick={()=>setViewAs(null)} style={{ ...mono, fontSize:10, background:"transparent", border:"none", color:C.purple, cursor:"pointer", padding:0 }}>✕ Exit</button>
          </div>
        )}
        {/* BDR: Assigned AE self-assignment */}
        {!viewAs && activeUser?.role === "BDR" && activeUser?.id && onUpdateTeamUser && (()=>{
          const aes = (teamUsers||[]).filter(u => u.role === "AE" || isAdmin(u));
          if (!aes.length) return null;
          const currentAEId = (activeUser.assignedAEs || [])[0] || "";
          return (
            <div style={{ marginBottom:8 }}>
              <p style={{ ...mono, margin:"0 0 3px", fontSize:9, color:`${C.gold}66`, textTransform:"uppercase", letterSpacing:"0.1em" }}>Assigned AE</p>
              <select
                value={currentAEId}
                onChange={e => {
                  const newAE = aes.find(u => u.id === e.target.value);
                  const oldAE = aes.find(u => u.id === currentAEId);
                  if (oldAE?.email && activeUser.email) removeBdrAssignment(activeUser.email, oldAE.email);
                  if (newAE?.email && activeUser.email) upsertBdrAssignment(activeUser.email, newAE.email);
                  onUpdateTeamUser(activeUser.id, { assignedAEs: e.target.value ? [e.target.value] : [] });
                }}
                style={{ ...mono, width:"100%", fontSize:10, padding:"3px 6px", background:C.bg, border:`1px solid ${C.brd}`, borderRadius:4, color:C.mut, cursor:"pointer", outline:"none" }}
              >
                <option value="">— not assigned —</option>
                {aes.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          );
        })()}
        {/* Reports-to self-assign (non-admin, non-viewAs) */}
        {!viewAs && !isAdmin(activeUser) && activeUser?.role !== "BDR" && activeUser?.id && onUpdateTeamUser && (()=>{
          const myLevel = ROLE_LEVEL[activeUser.role]||1;
          const eligible = (teamUsers||[]).filter(u => u.id !== activeUser.id && (ROLE_LEVEL[u.role]||1) > myLevel);
          if(!eligible.length) return null;
          return (
            <div style={{ marginBottom:8 }}>
              <p style={{ ...mono, margin:"0 0 3px", fontSize:9, color:`${C.gold}66`, textTransform:"uppercase", letterSpacing:"0.1em" }}>Reports to</p>
              <select
                value={activeUser.reportsTo||""}
                onChange={e => onUpdateTeamUser(activeUser.id, { reportsTo: e.target.value||null })}
                style={{ ...mono, width:"100%", fontSize:10, padding:"3px 6px", background:C.bg, border:`1px solid ${C.brd}`, borderRadius:4, color:C.mut, cursor:"pointer", outline:"none" }}
              >
                <option value="">— no manager —</option>
                {eligible.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
              </select>
            </div>
          );
        })()}
        <div onClick={!viewAs?onOpenProfile:undefined} style={{ display:"flex", alignItems:"center", gap:8, cursor:viewAs?"default":"pointer", borderRadius:6, padding:"2px 4px", margin:"-2px -4px" }}
          onMouseEnter={e=>{ if(!viewAs) e.currentTarget.style.background=`${C.gold}0a`; }}
          onMouseLeave={e=>{ e.currentTarget.style.background="transparent"; }}>
          <div style={{ position:"relative", flexShrink:0 }}>
            {avatarImage && !viewAs
              ? <img src={avatarImage} alt="" style={{ width:24, height:24, borderRadius:"50%", objectFit:"contain", border:`1px solid ${C.goldBdr}` }}/>
              : <div style={{ width:24, height:24, borderRadius:"50%", background:viewAs?`${C.purple}28`:C.goldBg, border:`1px solid ${viewAs?C.purple:C.goldBdr}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, color:viewAs?C.purple:C.gold, fontWeight:600, ...mono }}>{activeInitials}</div>
            }
            {!viewAs && newJoinCount > 0 && (
              <div style={{ position:"absolute", top:-4, right:-4, minWidth:14, height:14, borderRadius:7, background:"#EF4444", border:`1.5px solid ${C.bg}`, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 3px", boxSizing:"border-box" }}>
                <span style={{ ...mono, fontSize:8, color:"#fff", fontWeight:700, lineHeight:1 }}>{newJoinCount}</span>
              </div>
            )}
            {!viewAs && newJoinCount === 0 && hasUnviewedBadges && (
              <div style={{ position:"absolute", top:-2, right:-2, width:7, height:7, borderRadius:"50%", background:C.gold, border:`1.5px solid ${C.bg}` }}/>
            )}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <p style={{ margin:0, fontSize:13, color:C.txt, lineHeight:1.3 }}>{activeUser.name}</p>
            <p style={{ ...mono, margin:0, fontSize:11, color:C.mut }}>{(activeUser.role||"AE")} · {(activeUser.company||"Prospector").toUpperCase()}</p>
          </div>

          <div style={{ display:"flex", alignItems:"center", gap:4, flexShrink:0 }}>
            {!viewAs && (diamonds.log||[]).reduce((s,e)=>s+e.amount,0) > 0 && (
              <span style={{ ...mono, fontSize:10, color:"#5bc8f5", display:"flex", alignItems:"center", gap:1 }}>
                💎{(diamonds.log||[]).reduce((s,e)=>s+e.amount,0)}
              </span>
            )}
            {viewAs
              ? <button onClick={e=>{e.stopPropagation();setViewAs(null);}} style={{ ...mono, fontSize:10, padding:"2px 6px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:4, cursor:"pointer", whiteSpace:"nowrap" }}>← You</button>
              : isAdmin(activeUser) && teamUsers.length>0 && (
                  <select onClick={e=>e.stopPropagation()} onChange={e=>{ const u=teamUsers.find(x=>x.id===e.target.value); if(u && isAdmin(activeUser)) setViewAs({...u,initials:initials(u.name)}); e.target.value=""; }}
                    defaultValue="" style={{ ...mono, fontSize:10, padding:"2px 2px", background:C.sur, border:`1px solid ${C.brd}`, color:C.dim, borderRadius:4, cursor:"pointer", width:28 }}>
                    <option value="" disabled>⇄</option>
                    {teamUsers.map(u=><option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
                  </select>
                )
            }
          </div>
        </div>
        {/* Sign out */}
        {!viewAs && (
          <div style={{ marginTop:6, textAlign:"center" }}>
            <button
              onClick={() => {
                ["prospector_user","prospector_gate_unlocked","prospector_pending_role","prospector_gate_attempts"]
                  .forEach(k => { try { localStorage.removeItem(k); } catch {} });
                window.location.reload();
              }}
              style={{ ...mono, fontSize:10, color:C.dim, background:"transparent", border:"none", cursor:"pointer", padding:"2px 6px", borderRadius:3 }}
              onMouseEnter={e => e.currentTarget.style.color = C.red}
              onMouseLeave={e => e.currentTarget.style.color = C.dim}
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
