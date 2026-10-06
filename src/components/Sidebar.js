import { useState, useEffect, useRef } from "react";
import { C, mono } from '../constants/colors';
import { initials, isAdmin } from '../constants/appConfig';
import { BUSINESS_NAV, TOOLS_NAV } from '../constants/businessNav';
import NavRow from './NavRow';
import { signOut } from '../utils/authSession';

function readImgPref(key) {
  try { return localStorage.getItem(`prospector_img_${key}`) || JSON.parse(localStorage.getItem("prospector_prefs")||"{}")[key] || null; } catch { return null; }
}

const FOCUSABLE = 'button:not([disabled]), select:not([disabled]), a[href], input, [tabindex]:not([tabindex="-1"])';
const sectionLabel = { ...mono, margin:0, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.1em", padding:"10px 14px 4px" };

// nav-admin-cleanup-v1 - one sidebar for desktop and phone. Under 900px
// (`compact`) it becomes a drawer behind a top-bar menu button: closes on
// navigate, backdrop tap and Esc, and keeps keyboard focus inside while open.
export default function Sidebar({ compact, page, setPage, toolsActiveTool, setToolsActiveTool, viewAs, setViewAs, activeInitials, hasUnviewedBadges, onOpenProfile, diamonds, activeUser, teamUsers, newJoinCount=0, newNuggetCount=0, showAdmin, businesses=[], onSelectBusiness, onGoToBusinesses, activeBusiness=null, businessPage, setBusinessPage, onOpenDigest, onOpenBugReport }) {
  const [avatarImage, setAvatarImage] = useState(()=>readImgPref("avatarImage"));
  const [companyLogo, setCompanyLogo] = useState(()=>readImgPref("companyLogo"));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const menuBtnRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    const handler = () => {
      setAvatarImage(readImgPref("avatarImage"));
      setCompanyLogo(readImgPref("companyLogo"));
    };
    window.addEventListener('prospector_prefs_change', handler);
    return () => window.removeEventListener('prospector_prefs_change', handler);
  }, []);

  useEffect(() => { if (!compact) setDrawerOpen(false); }, [compact]);

  useEffect(() => {
    if (!drawerOpen) return;
    const menuBtn = menuBtnRef.current;
    panelRef.current?.querySelector(FOCUSABLE)?.focus();
    const onKey = e => {
      if (e.key === "Escape") { setDrawerOpen(false); return; }
      if (e.key !== "Tab") return;
      const items = [...(panelRef.current?.querySelectorAll(FOCUSABLE) || [])];
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); menuBtn?.focus(); };
  }, [drawerOpen]);

  const go = fn => (...args) => { fn?.(...args); setDrawerOpen(false); setUserMenuOpen(false); };
  const inWorkspace = !!activeBusiness && page === "business-detail";
  const accent = activeBusiness?.color || C.gold;
  const workspaceNav = activeBusiness ? BUSINESS_NAV.filter(n => !n.businessIds || n.businessIds.includes(activeBusiness.id)) : [];
  const totalDiamonds = (diamonds?.log||[]).reduce((s,e)=>s+e.amount,0);

  const panel = (
    <div ref={panelRef} role={compact ? "dialog" : undefined} aria-modal={compact ? true : undefined} aria-label={compact ? "Menu" : undefined}
      style={{ width: compact ? 280 : 178, maxWidth: "85vw", background:C.sur, borderRight:`1px solid ${C.brd}`, display:"flex", flexDirection:"column", height:"100vh", position: compact ? "fixed" : "sticky", top:0, left:0, flexShrink:0, zIndex: compact ? 4001 : undefined, overflowY:"auto" }}>
      <div style={{ padding:"12px 14px", borderBottom:`1px solid ${C.brd}`, minHeight:50, display:"flex", alignItems:"center", gap:8 }}>
        <div style={{ flex:1 }}>
          <p style={{ ...mono, margin:0, fontWeight:600, fontSize:15, color:C.gold, letterSpacing:"0.1em" }}>PROSPECTOR</p>
          <p style={{ ...mono, margin:0, fontSize:11, color:C.mut, letterSpacing:"0.05em" }}>PROSPECT INTELLIGENCE</p>
        </div>
        {compact && (
          <button type="button" onClick={()=>setDrawerOpen(false)} aria-label="Close menu" style={{ ...mono, width:44, height:44, background:"transparent", border:"none", color:C.mut, fontSize:18, cursor:"pointer" }}>✕</button>
        )}
      </div>

      <div style={{ borderBottom:`1px solid ${C.brd}`, padding:"4px 0 10px" }}>
        <p style={sectionLabel}>Workspace</p>
        <div style={{ padding:"0 12px" }}>
          <select aria-label="Workspace"
            value={inWorkspace ? activeBusiness.id : ""}
            onChange={e => {
              const b = businesses.find(x => x.id === e.target.value);
              if (b) go(onSelectBusiness)(b); else go(onGoToBusinesses)();
            }}
            style={{ ...mono, width:"100%", minHeight: compact ? 44 : 30, fontSize:12, padding:"4px 6px", background:C.bg, border:`1px solid ${inWorkspace ? accent : C.brd}`, borderRadius:5, color:C.txt, cursor:"pointer", outline:"none" }}>
            <option value="">🏢 All workspaces</option>
            {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      </div>

      <div style={{ flex:1, padding:"6px 0", borderLeft: inWorkspace ? `5px solid ${accent}` : "none" }}>
        {inWorkspace ? workspaceNav.map(n => (
          <div key={n.id}>
            <NavRow icon={n.ic} label={n.lb} accent={accent} tall={compact}
              active={businessPage===n.id}
              badge={n.id==="ideas" ? newNuggetCount : 0}
              onClick={go(()=>setBusinessPage(n.id))} />
            {n.id==="tools" && businessPage==="tools" && TOOLS_NAV.map(t => (
              <NavRow key={t.id} sub icon={t.ic} label={t.lb} accent={accent} tall={compact}
                active={toolsActiveTool===t.id}
                onClick={go(()=>setToolsActiveTool(t.id))} />
            ))}
          </div>
        )) : (
          <NavRow icon="🏢" label="Workspaces" tall={compact} active={page==="businesses-home"} onClick={go(onGoToBusinesses)} />
        )}
        {showAdmin && (
          <div style={{ borderTop:`1px solid ${C.brd}`, marginTop:6, paddingTop:6 }}>
            <NavRow icon="⚙" label="Admin" tall={compact} active={page==="admin"} onClick={go(()=>setPage("admin"))} />
          </div>
        )}
        {compact && (
          <div style={{ borderTop:`1px solid ${C.brd}`, marginTop:6, paddingTop:6 }}>
            <NavRow icon="☕" label="Daily digest" tall onClick={go(onOpenDigest)} />
            <NavRow icon="🐞" label="Report a bug" tall onClick={go(onOpenBugReport)} />
          </div>
        )}
      </div>

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
        {userMenuOpen && !viewAs && (
          <div id="user-menu" style={{ margin:"0 -12px 8px", paddingBottom:6, borderBottom:`1px solid ${C.brd}` }}>
            <NavRow icon="☆" label="Profile & badges" tall={compact} onClick={go(onOpenProfile)} />
            <NavRow icon="🎙" label="Voice Profile" tall={compact} active={page==="voice-profile"} onClick={go(()=>setPage("voice-profile"))} />
            <NavRow icon="G" label="Google connections" tall={compact} active={page==="google-connections"} onClick={go(()=>setPage("google-connections"))} />
            <NavRow icon="⏻" label="Sign out" tall={compact} accent={C.red} onClick={signOut} />
          </div>
        )}
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <button type="button" onClick={!viewAs?()=>setUserMenuOpen(o=>!o):undefined} disabled={!!viewAs} aria-expanded={userMenuOpen} aria-controls="user-menu" aria-label={`My profile, ${activeUser.name}`}
            style={{ display:"flex", alignItems:"center", gap:8, flex:1, minWidth:0, minHeight: compact ? 44 : undefined, font:"inherit", textAlign:"left", background:"transparent", border:"none", cursor:viewAs?"default":"pointer", borderRadius:6, padding:"2px 4px", margin:"-2px -4px" }}
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
              <p style={{ margin:0, fontSize:13, color:C.txt, lineHeight:1.3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{activeUser.name}</p>
              <p style={{ ...mono, margin:0, fontSize:11, color:C.mut }}>{(activeUser.role||"AE")} · {(activeUser.company||"Prospector").toUpperCase()}</p>
            </div>
          </button>
          <div style={{ display:"flex", alignItems:"center", gap:4, flexShrink:0 }}>
            {!viewAs && totalDiamonds > 0 && (
              <span style={{ ...mono, fontSize:10, color:"#5bc8f5", display:"flex", alignItems:"center", gap:1 }}>💎{totalDiamonds}</span>
            )}
            {viewAs
              ? <button onClick={()=>setViewAs(null)} style={{ ...mono, fontSize:10, padding:"2px 6px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:4, cursor:"pointer", whiteSpace:"nowrap" }}>← You</button>
              : isAdmin(activeUser) && teamUsers.length>0 && (
                  <select aria-label="View as" onChange={e=>{ const u=teamUsers.find(x=>x.id===e.target.value); if(u && isAdmin(activeUser)) setViewAs({...u,initials:initials(u.name)}); e.target.value=""; }}
                    defaultValue="" style={{ ...mono, fontSize:10, padding:"2px 2px", background:C.sur, border:`1px solid ${C.brd}`, color:C.dim, borderRadius:4, cursor:"pointer", width:28 }}>
                    <option value="" disabled>⇄</option>
                    {teamUsers.map(u=><option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
                  </select>
                )
            }
          </div>
        </div>
      </div>
    </div>
  );

  if (!compact) return panel;

  const title = inWorkspace ? activeBusiness.name : { admin:"Admin", "voice-profile":"Voice Profile", "google-connections":"Google connections" }[page] || "Workspaces";
  return (
    <>
      <div style={{ position:"sticky", top:0, zIndex:4000, display:"flex", alignItems:"center", gap:8, height:52, padding:"0 8px", background:C.sur, borderBottom:`1px solid ${C.brd}` }}>
        <button ref={menuBtnRef} type="button" onClick={()=>setDrawerOpen(true)} aria-label="Open menu" aria-expanded={drawerOpen}
          style={{ ...mono, width:44, height:44, background:"transparent", border:"none", color:C.txt, fontSize:20, cursor:"pointer" }}>☰</button>
        {inWorkspace && <span style={{ width:8, height:8, borderRadius:"50%", background:accent, flexShrink:0 }} />}
        <span style={{ ...mono, fontSize:13, color:C.txt, fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{title}</span>
      </div>
      {drawerOpen && (
        <>
          <div onClick={()=>setDrawerOpen(false)} style={{ position:"fixed", inset:0, background:"#000a", zIndex:4000 }} />
          {panel}
        </>
      )}
    </>
  );
}
