import { useMemo, useState } from 'react';
import { C, TS, mono } from '../constants/colors';
import { staleDays } from '../utils/staleness';
import { loadManagerConfig } from './ManagerCommandCenter';

// ── Manager Analytics ─────────────────────────────────────────────────────────
// AE comparison view shown when activeRole === "Manager"

function ManagerAnalytics({ accounts=[], tasks=[] }) {
  const config = useMemo(loadManagerConfig, []);
  const aes = config?.aes || [];
  const [copied, setCopied] = useState(false);

  const todayStr = new Date().toISOString().split("T")[0];
  const weekAgo  = new Date(Date.now()-7*86400000).toISOString().split("T")[0];

  const aeStats = useMemo(() => {
    return aes.map(ae => {
      const accts  = accounts.filter(a => a.aeId === ae.id);
      const total  = accts.length || 0;
      const gold   = accts.filter(a=>a.tier==="Gold").length;
      const silver = accts.filter(a=>a.tier==="Silver").length;
      const slag   = accts.filter(a=>a.tier==="Slag").length;
      const goldPct   = total ? Math.round((gold/total)*100) : 0;
      const atRisk    = accts.filter(a=>staleDays(a.last)>=90).length;
      const stageMap  = {};
      accts.forEach(a=>{ const s=a.stage||"Prospecting"; stageMap[s]=(stageMap[s]||0)+1; });

      const aeName = ae.name.split(" ")[0].toLowerCase();
      const myTasks = tasks.filter(t => !t.personal && t.assignee?.toLowerCase().includes(aeName));
      const openTasks = myTasks.filter(t=>t.status!=="Done").length;
      const completedThisWeek = myTasks.filter(t=>t.status==="Done" && t.completedAt >= weekAgo).length;

      // Pipeline velocity: avg days accounts spend per stage (rough estimate from addedAt + last)
      const engaged = accts.filter(a=>a.stage==="Engaged"||a.stage==="Qualified"||a.stage==="Evaluating"||a.stage==="Negotiating");
      const avgDaysActive = engaged.length
        ? Math.round(engaged.reduce((s,a)=>{ const d=a.addedAt?staleDays(a.addedAt.slice(0,10)):0; return s+d; },0)/engaged.length)
        : null;

      return { ...ae, total, gold, silver, slag, goldPct, atRisk, stageMap, openTasks, completedThisWeek, avgDaysActive };
    });
  }, [aes, accounts, tasks, weekAgo]);

  const copyReport = () => {
    const lines = [
      `Team Analytics Report — ${new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}`,
      "",
      ...aeStats.map(ae => [
        `${ae.name}`,
        `  Accounts: ${ae.total} total, ${ae.gold} Gold (${ae.goldPct}% Gold)`,
        `  At risk (90+ days): ${ae.atRisk}`,
        `  Open tasks: ${ae.openTasks} | Completed this week: ${ae.completedThisWeek}`,
        ae.avgDaysActive ? `  Avg days in pipeline: ${ae.avgDaysActive}d` : null,
      ].filter(Boolean).join("\n")),
    ].join("\n");
    navigator.clipboard.writeText(lines).then(()=>{ setCopied(true); setTimeout(()=>setCopied(false),2000); });
  };

  if (!aes.length) {
    return (
      <div style={{ padding:"24px", background:`${C.blue}08`, border:`1px dashed ${C.blue}33`, borderRadius:10, textAlign:"center", marginBottom:16 }}>
        <p style={{ ...mono, fontSize:13, color:C.dim, margin:0 }}>Add AEs in the Command Center to see team analytics.</p>
      </div>
    );
  }

  const METRICS = [
    { key:"goldPct",            label:"Gold %",            fmt:v=>`${v}%`,       color:C.gold,   desc:"% of accounts rated Gold" },
    { key:"atRisk",             label:"At Risk",           fmt:v=>v,             color:C.red,    desc:"Accounts 90+ days stale" },
    { key:"openTasks",          label:"Open Tasks",        fmt:v=>v,             color:C.orange, desc:"Tasks still open" },
    { key:"completedThisWeek",  label:"Done This Week",    fmt:v=>v,             color:C.green,  desc:"Tasks completed in last 7 days" },
    { key:"avgDaysActive",      label:"Avg Days Active",   fmt:v=>v!=null?`${v}d`:"—", color:C.blue, desc:"Avg days in active pipeline stages" },
  ];

  const maxVals = {};
  METRICS.forEach(m => {
    maxVals[m.key] = Math.max(...aeStats.map(ae=>ae[m.key]||0), 1);
  });

  return (
    <div style={{ marginBottom:16 }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
        <p style={{ ...mono, margin:0, fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", flex:1 }}>Manager Analytics — AE Comparison</p>
        <button onClick={copyReport} style={{ ...mono, fontSize:11, padding:"4px 12px", background:copied?`${C.green}14`:"transparent", border:`1px solid ${copied?C.green:C.brd}`, color:copied?C.green:C.dim, borderRadius:4, cursor:"pointer" }}>
          {copied ? "✓ Copied!" : "⬇ Download Report"}
        </button>
      </div>

      {/* Metric bars per AE */}
      <div style={{ display:"grid", gridTemplateColumns:`160px repeat(${aes.length}, 1fr)`, gap:0, background:C.sur, border:`1px solid ${C.brd}`, borderRadius:10, overflow:"hidden" }}>
        {/* Header row */}
        <div style={{ padding:"8px 12px", borderBottom:`1px solid ${C.brd}`, background:C.card }}>
          <span style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase" }}>Metric</span>
        </div>
        {aeStats.map(ae => (
          <div key={ae.id} style={{ padding:"8px 12px", borderBottom:`1px solid ${C.brd}`, borderLeft:`1px solid ${C.brd}22`, background:C.card, textAlign:"center" }}>
            <div style={{ ...mono, fontSize:12, color:C.txt, fontWeight:500 }}>{ae.name.split(" ")[0]}</div>
            <div style={{ ...mono, fontSize:9, color:C.dim }}>{ae.total} accts</div>
          </div>
        ))}

        {/* Metric rows */}
        {METRICS.map((m,mi) => (
          [
            <div key={`lbl-${m.key}`} style={{ padding:"10px 12px", borderBottom:mi<METRICS.length-1?`1px solid ${C.brd}22`:"none", display:"flex", flexDirection:"column", gap:2 }}>
              <span style={{ ...mono, fontSize:11, color:C.txt }}>{m.label}</span>
              <span style={{ ...mono, fontSize:9, color:C.dim }}>{m.desc}</span>
            </div>,
            ...aeStats.map(ae => {
              const val = ae[m.key];
              const barPct = maxVals[m.key] > 0 ? Math.round(((val||0)/maxVals[m.key])*100) : 0;
              return (
                <div key={`${m.key}-${ae.id}`} style={{ padding:"10px 12px", borderBottom:mi<METRICS.length-1?`1px solid ${C.brd}22`:"none", borderLeft:`1px solid ${C.brd}22`, display:"flex", flexDirection:"column", gap:4, alignItems:"center" }}>
                  <span style={{ ...mono, fontSize:14, color:m.color, fontWeight:600 }}>{m.fmt(val)}</span>
                  <div style={{ width:"80%", height:4, background:`${C.brd}44`, borderRadius:2 }}>
                    <div style={{ width:`${barPct}%`, height:"100%", background:m.color, borderRadius:2, transition:"width 0.3s" }}/>
                  </div>
                </div>
              );
            }),
          ]
        ))}
      </div>

      {/* Tier breakdown per AE */}
      <div style={{ marginTop:12, background:C.sur, border:`1px solid ${C.brd}`, borderRadius:10, padding:"14px 16px" }}>
        <p style={{ ...mono, margin:"0 0 10px", fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>Tier Distribution per AE</p>
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {aeStats.map(ae => {
            const total = ae.total || 1;
            return (
              <div key={ae.id} style={{ display:"flex", alignItems:"center", gap:10 }}>
                <span style={{ ...mono, fontSize:11, color:C.txt, width:80, flexShrink:0 }}>{ae.name.split(" ")[0]}</span>
                <div style={{ flex:1, height:12, borderRadius:3, background:C.bg, display:"flex", overflow:"hidden", gap:1 }}>
                  {["Gold","Silver","Tin","Slag"].map(t => {
                    const cnt = ae.accts?.filter(a=>a.tier===t).length || 0;
                    return <div key={t} style={{ width:`${(cnt/total)*100}%`, background:TS[t]?.c||C.dim, transition:"width 0.3s" }} title={`${t}: ${cnt}`}/>;
                  })}
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  {["Gold","Silver","Tin","Slag"].map(t => {
                    const cnt = ae.accts?.filter(a=>a.tier===t).length || 0;
                    if (!cnt) return null;
                    return <span key={t} style={{ ...mono, fontSize:10, color:TS[t]?.c||C.dim }}>{cnt}</span>;
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default ManagerAnalytics;
