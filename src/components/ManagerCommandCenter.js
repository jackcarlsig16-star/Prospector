import { useState, useMemo } from 'react';
import { C, TS, mono } from '../constants/colors';
import { T } from '../constants/tokens';
import { staleDays } from '../utils/staleness';
import ScoutCommandBar from './ScoutCommandBar';

// ── localStorage helpers ──────────────────────────────────────────────────────
export const loadManagerConfig = () => {
  try { return JSON.parse(localStorage.getItem("prospector_manager_config")||"null"); } catch { return null; }
};
export const saveManagerConfig = cfg => localStorage.setItem("prospector_manager_config", JSON.stringify(cfg));

const calcGrade = (accs) => {
  if (!accs.length) return { grade:"—", c:C.dim, score:0 };
  const gold=accs.filter(a=>a.tier==="Gold").length;
  const silver=accs.filter(a=>a.tier==="Silver").length;
  const slag=accs.filter(a=>a.tier==="Slag").length;
  const total=accs.length;
  const score=Math.round((gold*2+silver-slag*0.5)/total*50);
  if (score>=60) return { grade:"A", c:C.gold };
  if (score>=40) return { grade:"B", c:C.green };
  if (score>=25) return { grade:"C", c:C.orange };
  return { grade:"D", c:C.red };
};

// ── AE Setup Panel ─────────────────────────────────────────────────────────────
export function AESetupPanel({ managerConfig, onSave, compact=false }) {
  const [email, setEmail] = useState("");
  const [name,  setName]  = useState("");
  const [err,   setErr]   = useState(null);
  const aes = managerConfig?.aes || [];

  const addAE = () => {
    if (!email.trim() || !name.trim()) { setErr("Name and email required"); return; }
    if (aes.some(a => a.email.toLowerCase() === email.trim().toLowerCase())) { setErr("Already added"); return; }
    const newCfg = {
      ...managerConfig,
      aes: [...aes, { id: Date.now().toString(), name: name.trim(), email: email.trim().toLowerCase() }],
    };
    onSave(newCfg);
    setEmail(""); setName(""); setErr(null);
  };

  const removeAE = (id) => onSave({ ...managerConfig, aes: aes.filter(a=>a.id!==id) });

  const inp = { ...mono, fontSize:12, padding:"6px 9px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:5, color:C.txt, outline:"none", width:"100%", boxSizing:"border-box" };

  return (
    <div>
      {!compact && <p style={{ ...mono, margin:"0 0 12px", fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>Your AEs</p>}
      <div style={{ display:"flex", gap:8, marginBottom:10 }}>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="Name" style={{ ...inp, width:130 }} onKeyDown={e=>e.key==="Enter"&&addAE()}/>
        <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="email@example.com" style={{ ...inp, flex:1 }} onKeyDown={e=>e.key==="Enter"&&addAE()}/>
        <button onClick={addAE} style={{ ...mono, fontSize:12, padding:"6px 14px", background:C.goldBg, border:`1px solid ${C.goldBdr}`, color:C.gold, borderRadius:5, cursor:"pointer", whiteSpace:"nowrap" }}>+ Add AE</button>
      </div>
      {err && <p style={{ ...mono, fontSize:11, color:C.red, margin:"0 0 8px" }}>{err}</p>}
      {aes.map(ae => (
        <div key={ae.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 10px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:6, marginBottom:5 }}>
          <div style={{ width:28, height:28, borderRadius:14, background:`${C.blue}22`, border:`1px solid ${C.blue}44`, display:"flex", alignItems:"center", justifyContent:"center" }}>
            <span style={{ ...mono, fontSize:11, color:C.blue, fontWeight:600 }}>{ae.name.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()}</span>
          </div>
          <div style={{ flex:1 }}>
            <div style={{ ...mono, fontSize:12, color:C.txt, fontWeight:500 }}>{ae.name}</div>
            <div style={{ ...mono, fontSize:10, color:C.dim }}>{ae.email}</div>
          </div>
          <button onClick={()=>removeAE(ae.id)} style={{ background:"none", border:"none", color:C.dim, cursor:"pointer", fontSize:14, lineHeight:1, padding:"2px 6px" }}>✕</button>
        </div>
      ))}
      {!aes.length && <p style={{ ...mono, fontSize:11, color:C.dim, fontStyle:"italic", margin:"4px 0 0" }}>No AEs added yet.</p>}
    </div>
  );
}

// ── Manager Command Center ────────────────────────────────────────────────────
function ManagerCommandCenter({ accounts=[], tasks=[], onNav, activeUser, onCreateTask, teamUsers=[], selectedAeId='all', setSelectedAeId, teamAEs: teamAEsProp }) {
  const [drillAeId, setDrillAeId] = useState(null);

  // teamAEs comes from App.js (lifted state for cross-page scope). Fall back
  // to local derivation for safety if rendered without the prop.
  const teamAEs = useMemo(() => {
    if (teamAEsProp && teamAEsProp.length >= 0) return teamAEsProp;
    if (!activeUser?.id) return [];
    return teamUsers.filter(u => u.role === 'AE' && u.reportsTo === activeUser.id);
  }, [teamAEsProp, teamUsers, activeUser]);

  const aeMap = useMemo(() => Object.fromEntries(teamAEs.map(ae => [ae.id, ae.name])), [teamAEs]);

  const teamAccounts = useMemo(() => {
    if (!teamAEs.length) return [];
    const ids = new Set(teamAEs.map(ae => ae.id));
    return accounts.filter(a => a.aeId && ids.has(a.aeId));
  }, [accounts, teamAEs]);

  const scopedAccounts = useMemo(() =>
    selectedAeId === 'all' ? teamAccounts : teamAccounts.filter(a => a.aeId === selectedAeId),
    [teamAccounts, selectedAeId]
  );

  // Per-AE stats now derived from teamAEs (reportsTo), not the manual form.
  const aeStats = useMemo(() => {
    return teamAEs.map(ae => {
      const aeAccts = accounts.filter(a => a.aeId === ae.id);
      const openTasks = tasks.filter(t => !t.personal && t.status !== "Done" && (t.assignee?.toLowerCase().includes(ae.name.split(" ")[0].toLowerCase())));
      const atRisk = aeAccts.filter(a => staleDays(a.last) >= 90).length;
      const grade = calcGrade(aeAccts);
      const gold = aeAccts.filter(a=>a.tier==="Gold").length;
      const silver = aeAccts.filter(a=>a.tier==="Silver").length;
      const stageCounts = {};
      aeAccts.forEach(a => { const s=a.stage||"Prospecting"; stageCounts[s]=(stageCounts[s]||0)+1; });
      return { ...ae, accts:aeAccts, openTasks:openTasks.length, atRisk, grade, gold, silver, total:aeAccts.length, stageCounts };
    });
  }, [teamAEs, accounts, tasks]);

  // Unassigned accounts (no aeId)
  const unassigned = accounts.filter(a => !a.aeId);

  // Combined pipeline by stage
  const pipelineCounts = useMemo(() => {
    const m = {};
    accounts.forEach(a => { const s=a.stage||"Prospecting"; m[s]=(m[s]||0)+1; });
    return m;
  }, [accounts]);

  // Team alerts: AEs with most at-risk accounts
  const alerts = useMemo(() => {
    const out = [];
    aeStats.forEach(ae => {
      if (ae.atRisk > 0) out.push({ type:"at_risk", ae, msg:`${ae.atRisk} account${ae.atRisk>1?"s":""} 90+ days stale` });
      if (ae.grade.grade==="D") out.push({ type:"grade", ae, msg:`Territory grade D — needs attention` });
    });
    if (unassigned.length > 0) out.push({ type:"unassigned", ae:null, msg:`${unassigned.length} account${unassigned.length>1?"s":""} not assigned to an AE` });
    return out;
  }, [aeStats, unassigned]);

  // Leaderboard: sort AEs by grade score desc, then gold count
  const leaderboard = [...aeStats].sort((a,b) => b.grade.score - a.grade.score || b.gold - a.gold);

  const STAGES_ORDER = ["Prospecting","Engaged","Qualified","Evaluating","Negotiating","Closed Won","Closed Lost"];
  const STAGE_C = { Prospecting:C.dim, Engaged:C.blue, Qualified:C.purple, Evaluating:C.orange, Negotiating:C.green, "Closed Won":C.gold, "Closed Lost":C.red };

  const drillAe = drillAeId ? aeStats.find(a=>a.id===drillAeId) : null;

  return (
    <div>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20 }}>
        <div style={{ flex:1 }}>
          <p style={{ ...mono, margin:"0 0 2px", fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.1em" }}>Manager View</p>
          <p style={{ margin:0, fontSize:18, fontWeight:500, color:C.txt }}>Team Command Center</p>
        </div>
        {onNav && <button onClick={()=>onNav("admin")} style={{ ...mono, fontSize:11, padding:"5px 12px", background:"transparent", border:`1px solid ${C.brd}`, color:C.mut, borderRadius:5, cursor:"pointer" }}>⚙ Org Chart →</button>}
        {onNav && <button onClick={()=>onNav("accounts")} style={{ ...mono, fontSize:11, padding:"5px 12px", background:C.goldBg, border:`1px solid ${C.goldBdr}`, color:C.gold, borderRadius:5, cursor:"pointer" }}>◈ Accounts →</button>}
      </div>

      {/* Scout — same component AE/Owner use, with aeMap so it can attribute deals to AEs in answers.
          (AE scope toggle pills now live in the App-level banner so they persist across pages.) */}
      <div style={{ marginBottom:16 }}>
        <ScoutCommandBar
          accounts={scopedAccounts}
          onNav={onNav}
          onCreateTask={onCreateTask}
          activeUser={activeUser}
          aeMap={aeMap}
        />
      </div>

      {/* Empty state */}
      {!teamAEs.length && (
        <div style={{ padding:"32px 24px", background:`${C.blue}08`, border:`1px dashed ${C.blue}33`, borderRadius:10, textAlign:"center", marginBottom:16 }}>
          <p style={{ ...mono, fontSize:14, color:C.blue, margin:"0 0 8px" }}>No direct reports yet</p>
          <p style={{ ...mono, fontSize:12, color:C.dim, margin:"0 0 12px" }}>Use the Org Chart to set AEs reporting to you. Once assigned, this page surfaces their pipeline, alerts, and leaderboard.</p>
          {onNav && <button onClick={()=>onNav("admin")} style={{ ...mono, fontSize:12, padding:"7px 18px", background:C.goldBg, border:`1px solid ${C.goldBdr}`, color:C.gold, borderRadius:6, cursor:"pointer" }}>Open Org Chart →</button>}
        </div>
      )}

      {teamAEs.length > 0 && (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:16 }}>
          {/* LEFT: Team Overview table */}
          <div style={{ background:C.sur, border:`1px solid ${C.brd}`, borderRadius:10, padding:"14px 16px" }}>
            <p style={{ ...mono, margin:"0 0 12px", fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>Team Overview</p>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 40px 48px 48px 48px 48px", gap:4, marginBottom:6 }}>
              {["AE","Grade","Gold","At Risk","Tasks","Total"].map(h => (
                <span key={h} style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase" }}>{h}</span>
              ))}
            </div>
            {aeStats.map(ae => (
              <div key={ae.id}
                onClick={() => setDrillAeId(drillAeId===ae.id ? null : ae.id)}
                style={{ display:"grid", gridTemplateColumns:"1fr 40px 48px 48px 48px 48px", gap:4, alignItems:"center", padding:"7px 0", borderTop:`1px solid ${C.brd}22`, cursor:"pointer",
                  background: drillAeId===ae.id ? `${C.blue}0d` : "transparent" }}
                onMouseEnter={e=>e.currentTarget.style.background=`${C.blue}08`}
                onMouseLeave={e=>e.currentTarget.style.background=drillAeId===ae.id?`${C.blue}0d`:"transparent"}>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <div style={{ width:22, height:22, borderRadius:11, background:`${C.blue}1A`, border:`1px solid ${C.blue}33`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                    <span style={{ ...mono, fontSize:9, color:C.blue }}>{ae.name.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()}</span>
                  </div>
                  <span style={{ ...mono, fontSize:12, color:C.txt }}>{ae.name.split(" ")[0]}</span>
                </div>
                <span style={{ ...mono, fontSize:13, color:ae.grade.c, fontWeight:600 }}>{ae.grade.grade}</span>
                <span style={{ ...mono, fontSize:12, color:C.gold }}>{ae.gold}</span>
                <span style={{ ...mono, fontSize:12, color:ae.atRisk>0?C.red:C.dim }}>{ae.atRisk}</span>
                <span style={{ ...mono, fontSize:12, color:ae.openTasks>0?C.orange:C.dim }}>{ae.openTasks}</span>
                <span style={{ ...mono, fontSize:12, color:C.mut }}>{ae.total}</span>
              </div>
            ))}

            {/* Drill-in: AE territory breakdown */}
            {drillAe && (
              <div style={{ marginTop:10, padding:"10px 12px", background:`${C.blue}0a`, border:`1px solid ${C.blue}22`, borderRadius:7 }}>
                <p style={{ ...mono, fontSize:10, color:C.blue, margin:"0 0 8px", textTransform:"uppercase" }}>{drillAe.name} — Territory Detail</p>
                <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
                  {["Gold","Silver","Tin","Slag"].map(t => (
                    <div key={t} style={{ display:"flex", flexDirection:"column", gap:1 }}>
                      <span style={{ ...mono, fontSize:9, color:C.dim }}>{t}</span>
                      <span style={{ ...mono, fontSize:13, color:TS[t]?.c||C.dim }}>{drillAe.accts.filter(a=>a.tier===t).length}</span>
                    </div>
                  ))}
                </div>
                <button onClick={()=>{onNav?.("accounts");}} style={{ ...mono, fontSize:10, marginTop:8, padding:"4px 10px", background:"transparent", border:`1px solid ${C.blue}44`, color:C.blue, borderRadius:4, cursor:"pointer" }}>View accounts →</button>
              </div>
            )}
          </div>

          {/* RIGHT: Alerts + Leaderboard */}
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            {/* Team Alerts */}
            <div style={{ background:C.sur, border:`1px solid ${C.brd}`, borderRadius:10, padding:"14px 16px" }}>
              <p style={{ ...mono, margin:"0 0 10px", fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>Team Alerts</p>
              {!alerts.length && <p style={{ ...mono, fontSize:12, color:C.green }}>✓ All clear</p>}
              {alerts.map((al,i) => (
                <div key={i} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 0", borderBottom:`1px solid ${C.brd}22` }}>
                  <span style={{ fontSize:12 }}>{al.type==="at_risk"?"⚠":al.type==="grade"?"▼":"◉"}</span>
                  {al.ae && <span style={{ ...mono, fontSize:11, color:C.blue, background:`${C.blue}14`, borderRadius:3, padding:"1px 6px" }}>{al.ae.name.split(" ")[0]}</span>}
                  <span style={{ ...mono, fontSize:11, color:al.type==="at_risk"?C.orange:al.type==="grade"?C.red:C.dim }}>{al.msg}</span>
                </div>
              ))}
            </div>

            {/* Leaderboard */}
            <div style={{ background:C.sur, border:`1px solid ${C.brd}`, borderRadius:10, padding:"14px 16px", flex:1 }}>
              <p style={{ ...mono, margin:"0 0 10px", fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>Leaderboard</p>
              {leaderboard.map((ae,i) => (
                <div key={ae.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"6px 0", borderBottom:`1px solid ${C.brd}22` }}>
                  <span style={{ ...mono, fontSize:11, color:i===0?C.gold:i===1?C.silver:C.dim, fontWeight:600, width:16 }}>#{i+1}</span>
                  <span style={{ ...mono, fontSize:12, color:C.txt, flex:1 }}>{ae.name.split(" ")[0]}</span>
                  <span style={{ ...mono, fontSize:12, color:ae.grade.c, fontWeight:600 }}>{ae.grade.grade}</span>
                  <span style={{ ...mono, fontSize:11, color:C.gold }}>◆{ae.gold}</span>
                  <span style={{ ...mono, fontSize:11, color:C.dim }}>{ae.total} accts</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Combined Pipeline */}
      {teamAEs.length > 0 && (
        <div style={{ background:C.sur, border:`1px solid ${C.brd}`, borderRadius:10, padding:"14px 16px", marginBottom:16 }}>
          <p style={{ ...mono, margin:"0 0 12px", fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>Combined Pipeline — All AEs</p>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            {STAGES_ORDER.filter(s=>pipelineCounts[s]>0).map(s => (
              <div key={s} style={{ display:"flex", flexDirection:"column", gap:3, padding:"8px 12px", background:`${STAGE_C[s]||C.dim}0d`, border:`1px solid ${STAGE_C[s]||C.dim}33`, borderRadius:6 }}>
                <span style={{ ...mono, fontSize:9, color:STAGE_C[s]||C.dim, textTransform:"uppercase", letterSpacing:"0.06em" }}>{s}</span>
                <span style={{ ...mono, fontSize:18, color:STAGE_C[s]||C.dim, fontWeight:600 }}>{pipelineCounts[s]}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default ManagerCommandCenter;
