import { useState, useEffect } from 'react';
import { C, mono } from '../constants/colors';
import { getBusinessesForMember, getProjectsForUser } from '../utils/db';
import { BUSINESS_NAV } from '../constants/businessNav';
import NavRow from './NavRow';
import BusinessesHomePage from './BusinessesHomePage';
import BusinessDetailPage from './BusinessDetailPage';
import PersistentScout from './PersistentScout';

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
      {activeBusiness && (()=>{
        const accent = activeBusiness.color || C.gold;
        const otherBusinesses = businesses.filter(b=>b.id!==activeBusiness.id);
        return (
        <div style={{ borderLeft:`3px solid ${accent}`, padding:"6px 0" }}>
          <p style={{ ...mono, margin:0, fontSize:9, color:accent, textTransform:"uppercase", letterSpacing:"0.1em", padding:"4px 14px 6px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", fontWeight:600 }}>{activeBusiness.name}</p>
          {BUSINESS_NAV.filter(n=>!n.ownerOnly || isOwner).map(n => (
            <NavRow key={n.id} icon={n.ic} label={n.lb} active={businessPage===n.id} onClick={()=>setBusinessPage(n.id)} accent={accent} />
          ))}
          {otherBusinesses.length > 0 && (
            <>
              <p style={{ ...mono, margin:0, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.1em", padding:"10px 14px 2px" }}>Other Workspaces</p>
              {otherBusinesses.map(b => (
                <div key={b.id} onClick={()=>onSelectBusiness(b)} style={{ padding:"5px 14px", cursor:"pointer", display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ width:8, height:8, borderRadius:"50%", background:b.color||C.gold, flexShrink:0 }} />
                  <span style={{ ...mono, fontSize:12, color:C.mut, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{b.name}</span>
                </div>
              ))}
            </>
          )}
        </div>
        );
      })()}
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
  const [projects, setProjects] = useState([]);
  // Members have no team_users row to persist a preference against - this
  // resets every session rather than being remembered, a deliberate Phase 1
  // simplification (scout-global-persistent-v1).
  const [allBusinessesConfirmed, setAllBusinessesConfirmed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getBusinessesForMember(identity.email).then(list => {
      if (cancelled) return;
      setBusinesses(list);
      setLoading(false);
    });
    // Projects are still owner_email-scoped app-wide (same as Jack's own path
    // in App.js) - a member only sees projects for businesses they themselves
    // own, not ones they've merely joined. Matches existing behavior, not a
    // new limitation introduced here.
    getProjectsForUser(identity.email).then(list => { if (!cancelled) setProjects(list); });
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
        <PersistentScout
          isBusinessContext={!!activeBusiness}
          activeBusiness={activeBusiness}
          businesses={businesses}
          territoryAccounts={[]}
          activeUser={{ name: identity.name, email: identity.email }}
          allBusinessesConfirmed={allBusinessesConfirmed}
          onConfirmAllBusinesses={()=>setAllBusinessesConfirmed(true)}
          onNav={()=>{}}
        />
        {activeBusiness ? (
          <BusinessDetailPage
            key={activeBusiness.id}
            business={activeBusiness}
            userEmail={identity.email}
            view={businessPage}
            onUpdated={b=>{ setActiveBusiness(b); setBusinesses(prev=>prev.map(x=>x.id===b.id?b:x)); }}
            projects={projects.filter(p=>p.business_id===activeBusiness.id)}
            onProjectCreated={p=>setProjects(prev=>[p, ...prev])}
            onProjectUpdated={p=>setProjects(prev=>prev.map(x=>x.id===p.id?p:x))}
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
