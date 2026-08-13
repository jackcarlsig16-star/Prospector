import { useState, useEffect } from 'react';
import { C, mono } from '../constants/colors';
import { getBusinessesForMember } from '../utils/db';
import BusinessesHomePage from './BusinessesHomePage';
import BusinessDetailPage from './BusinessDetailPage';

// Nav for a selected business - same items as business-nav-architecture-v1's
// BUSINESS_NAV in Sidebar.js, duplicated here rather than imported because a
// member session never renders Sidebar (which assumes a full Jack `user` -
// teamUsers, roles, admin badges - none of which exist for a joined member).
const BUSINESS_NAV = [
  { id: "command-center", ic: "⌂", lb: "Command Center" },
  { id: "overview",       ic: "◉", lb: "Overview" },
  { id: "accounts",       ic: "◈", lb: "Accounts" },
  { id: "search",         ic: "🔍", lb: "Search" },
  { id: "generation",     ic: "✉", lb: "Generation" },
  { id: "projects",       ic: "▣", lb: "Projects" },
  { id: "members",        ic: "👥", lb: "Members", ownerOnly: true },
];

function MemberSidebar({ identity, businesses, activeBusiness, onSelectBusiness, onGoToBusinesses, businessPage, setBusinessPage, onExit }) {
  const isOwner = activeBusiness && (activeBusiness.owner_email||"").toLowerCase()===(identity.email||"").toLowerCase();
  return (
    <div style={{ width:178, background:C.sur, borderRight:`1px solid ${C.brd}`, display:"flex", flexDirection:"column", height:"100vh", position:"sticky", top:0, flexShrink:0 }}>
      <div style={{ padding:"12px 14px", borderBottom:`1px solid ${C.brd}`, minHeight:50, display:"flex", alignItems:"center" }}>
        <p style={{ ...mono, margin:0, fontWeight:600, fontSize:15, color:C.gold, letterSpacing:"0.1em" }}>PROSPECTOR</p>
      </div>
      <div style={{ borderBottom:`1px solid ${C.brd}`, padding:"8px 0" }}>
        <button onClick={onGoToBusinesses} style={{
          display:"flex", alignItems:"center", gap:8, width:"100%", padding:"6px 14px",
          background: !activeBusiness ? C.card : "transparent",
          border:"none", borderLeft: !activeBusiness ? `3px solid ${C.gold}` : "3px solid transparent",
          cursor:"pointer", textAlign:"left",
        }}>
          <span style={{ ...mono, fontSize:12, color:C.txt, fontWeight:600 }}>🏢 My Businesses</span>
        </button>
        {businesses.length > 0 && (
          <div style={{ paddingLeft:20, borderLeft:`3px solid ${C.gold}33`, marginLeft:14, maxHeight:180, overflowY:"auto" }}>
            {businesses.map(b => (
              <div key={b.id} onClick={()=>onSelectBusiness(b)}
                style={{ padding:"5px 12px", cursor:"pointer", display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ width:8, height:8, borderRadius:"50%", background:b.color||C.gold, flexShrink:0 }} />
                <span style={{ ...mono, fontSize:12, color:C.mut, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{b.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {activeBusiness && (
        <div style={{ padding:"6px 0" }}>
          <p style={{ ...mono, margin:0, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.1em", padding:"4px 14px 6px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{activeBusiness.name}</p>
          {BUSINESS_NAV.filter(n=>!n.ownerOnly || isOwner).map(n => {
            const active = businessPage===n.id;
            return (
              <div key={n.id} onClick={()=>setBusinessPage(n.id)} style={{ padding:"7px 12px", cursor:"pointer", display:"flex", alignItems:"center", gap:8, background:active?C.card:"transparent", borderLeft:`3px solid ${active?C.gold:"transparent"}` }}>
                <span style={{ ...mono, fontSize:14, color:active?C.gold:C.mut }}>{n.ic}</span>
                <span style={{ fontSize:13, color:active?C.txt:C.mut, whiteSpace:"nowrap", flex:1 }}>{n.lb}</span>
              </div>
            );
          })}
        </div>
      )}
      <div style={{ flex:1 }} />
      <div style={{ padding:"10px 12px", borderTop:`1px solid ${C.brd}` }}>
        <p style={{ ...mono, margin:"0 0 2px", fontSize:12, color:C.txt }}>{identity.name}</p>
        <p style={{ ...mono, margin:"0 0 8px", fontSize:10, color:C.dim, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{identity.email}</p>
        <button onClick={onExit} style={{ ...mono, fontSize:10, color:C.dim, background:"transparent", border:"none", cursor:"pointer", padding:0 }}>Sign out</button>
      </div>
    </div>
  );
}

export default function MemberShell({ identity, initialBusiness=null, onExit }) {
  const [businesses, setBusinesses] = useState(initialBusiness ? [initialBusiness] : []);
  const [loading, setLoading] = useState(true);
  const [activeBusiness, setActiveBusiness] = useState(initialBusiness);
  const [businessPage, setBusinessPage] = useState('command-center');

  useEffect(() => {
    let cancelled = false;
    getBusinessesForMember(identity.email).then(list => {
      if (cancelled) return;
      setBusinesses(list);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [identity.email]);

  const selectBusiness = (b) => { setActiveBusiness(b); setBusinessPage('command-center'); };

  return (
    <div style={{ display:"flex", background:C.bg, minHeight:"100vh", width:"100%" }}>
      <MemberSidebar
        identity={identity}
        businesses={businesses}
        activeBusiness={activeBusiness}
        onSelectBusiness={selectBusiness}
        onGoToBusinesses={()=>setActiveBusiness(null)}
        businessPage={businessPage}
        setBusinessPage={setBusinessPage}
        onExit={onExit}
      />
      <div style={{ flex:1, minWidth:0 }}>
        {activeBusiness ? (
          <BusinessDetailPage
            key={activeBusiness.id}
            business={activeBusiness}
            userEmail={identity.email}
            view={businessPage}
            onUpdated={b=>{ setActiveBusiness(b); setBusinesses(prev=>prev.map(x=>x.id===b.id?b:x)); }}
            onProjectCreated={()=>{}}
            sharedAccounts={[]}
            sharedTasks={[]}
            setSharedTasks={()=>{}}
            dailyStats={{}}
            activeUser={{ name: identity.name, email: identity.email }}
            onNav={()=>{}}
          />
        ) : (
          <BusinessesHomePage
            businesses={businesses}
            loading={loading}
            userEmail={identity.email}
            onSelect={selectBusiness}
            onCreated={b=>{ setBusinesses(prev=>[b, ...prev]); selectBusiness(b); }}
          />
        )}
      </div>
    </div>
  );
}
