import { useState, useEffect } from "react";
import { C, TS, mono } from '../constants/colors';
import { staleDays, isStale, isWarn } from '../utils/staleness';
import { UCS_DATA, PROD_COLOR, ALL_PRODUCTS } from '../constants/products';
import { DEAL_STAGES } from './AccountCard';
import { getAllCompliance, STANDARD_STEPS, PARTNER_STEPS } from '../utils/storage';
import { NUGGET_STATUS_COLORS } from './frontier/GoldenNuggetsTab';
import { MiniBar, DonutChartLegacy, Sparkline, GRADE_THRESHOLDS } from './BadgesProfile';
import SmartTaskPanel from './TaskPanel';
import TodayGoals from './TodayGoals';
import SalesCalendarWidget from './CalendarWidget';
import BdrCommandCenter from './BdrCommandCenter';
import BriefPanel from './BriefPanel';
import ScoutCommandBar from './ScoutCommandBar';
import { loadAssayProgress } from '../utils/bulkAssay';

const SF_BASE = "https://your-org.lightning.force.com/lightning/r/Account/";
const toSfdcUrl = v => {
  if (!v || !v.trim()) return null;
  if (v.startsWith("http")) return v.trim();
  if (/^001[A-Za-z0-9]{12,15}$/.test(v.trim())) return `${SF_BASE}${v.trim()}/view`;
  return null;
};
const lastTouch = acc => acc.last;

const TEAL = "#2dd4bf";
const CARD = (extra={}) => ({ background:"#0f172a", border:"1px solid #1e293b", borderRadius:8, padding:"12px 14px", ...extra });
const SH   = (extra={}) => ({ ...mono, fontSize:10, color:TEAL, textTransform:"uppercase", letterSpacing:"0.09em", fontWeight:600, marginBottom:8, ...extra });

const VERT_C = {
  "Banks":"#60A8F0","BFM":"#F5A050","PFM":"#A878F0",
  "Wealth":"#F5C842","Consumer Payments":"#42E890","Technology":"#56C8E0",
  "Lending":"#F06060","Insurance":"#E878C0","Crypto":"#50C8A0",
  "Payroll":"#E8C870","Real Estate":"#90C878","Healthcare":"#78D0B0",
  "Commerce":"#E8A050","Investment":"#F5C842","Fintech":"#A878F0",
};
const STEALTH_STATUSES = ["Seeded","Outbounded","Replied","Meeting Booked","In Pipeline","Won"];
const STEALTH_STATUS_C = { "Seeded":C.dim,"Outbounded":C.blue,"Replied":C.tin,"Meeting Booked":C.green,"In Pipeline":C.purple,"Won":C.gold };
const GEM_VERTS = new Set(["PFM","Consumer Payments","Banks","Wealth","BFM","Lending","Payroll","Insurance","Crypto","EWA"]);
const GEM_REASONS = {
  unanalyzed_fintech: "Unanalyzed Fintech — high potential, no score yet",
  gold_unworked:      "Gold account — not in Frontier or active pipeline",
  silver_unworked:    "Silver account — worth a closer look",
  stale_gold:         "Gold account — 60+ days since last touch",
  high_products:      "3+ products detected — strong signal",
};

const calcTerritoryBreakdown = (accounts, snapshots=[]) => {
  const total = accounts.length;
  if (!total) return null;
  const ACTIVE_STAGES = new Set(["Engaged","Qualified","Closed Won"]);
  const analyzed = accounts.filter(a=>a.score);
  const gold   = analyzed.filter(a=>a.tier==="Gold").length;
  const silver = analyzed.filter(a=>a.tier==="Silver").length;
  const tin    = analyzed.filter(a=>a.tier==="Tin").length;
  const slag   = analyzed.filter(a=>a.tier==="Slag").length;
  const slagPenalized = analyzed.filter(a=>a.tier==="Slag"&&!ACTIVE_STAGES.has(a.stage||"Prospecting")).length;
  const goldPct    = gold/total;
  const silverPct  = silver/total;
  const slagPct    = slagPenalized/total;
  const goldPts    = Math.min(20, Math.round((goldPct/0.20)*20));
  const silverPts  = Math.min(10, Math.round((silverPct/0.20)*10));
  const slagPenalty= Math.min(10, Math.round(Math.max(0,(slagPct-0.30)/0.30)*10));
  const qualityPts = Math.max(0, goldPts + silverPts - slagPenalty);
  const atRiskAccs  = accounts.filter(a=>staleDays(lastTouch(a))>=90);
  const warnAccs2   = accounts.filter(a=>{ const d=staleDays(lastTouch(a)); return d>=60&&d<90; });
  const atRiskPenalty = Math.min(20, Math.round((atRiskAccs.length/total)*70));
  const warnPenalty   = Math.min(10, Math.round((warnAccs2.length/total)*35));
  const activityPts   = Math.max(0, 35 - atRiskPenalty - warnPenalty);
  const qualified  = accounts.filter(a=>(a.stage||"Prospecting")==="Qualified").length;
  const closedWon  = accounts.filter(a=>(a.stage||"Prospecting")==="Closed Won").length;
  const engaged    = accounts.filter(a=>(a.stage||"Prospecting")==="Engaged").length;
  const activePipe = qualified + closedWon + engaged;
  const pipelinePts= Math.min(10, Math.round((activePipe/total)*20));
  const weekAgo = Date.now() - 7*86400000;
  const addedThisWeek = accounts.filter(a=>a.uploadedAt&&new Date(a.uploadedAt).getTime()>weekAgo).length;
  const prevSnap = snapshots.length>=7 ? snapshots[snapshots.length-7] : null;
  const slagReduced = prevSnap&&prevSnap.slag!=null ? Math.max(0,(prevSnap.slag||0)-slag) : 0;
  const growthPts = Math.min(15, Math.round(Math.min(3,addedThisWeek)/3*8) + Math.min(7,slagReduced));
  const score = qualityPts + activityPts + pipelinePts + growthPts;
  const { grade, c } = GRADE_THRESHOLDS.find(t=>score>=t.min)||{ grade:"F", c:C.red };
  return {
    score, grade, c,
    quality:  { pts:qualityPts,  max:40, goldPts, silverPts, slagPenalty, gold, silver, tin, slag, slagPenalized, total, goldPct, silverPct, slagPct },
    activity: { pts:activityPts, max:35, atRiskPenalty, warnPenalty, atRisk:atRiskAccs.length, warn:warnAccs2.length },
    pipeline: { pts:pipelinePts, max:10, activePipe, qualified, closedWon, engaged, total },
    growth:   { pts:growthPts,   max:15, addedThisWeek, slagReduced },
  };
};

function HomePage({ accounts, onNav, activeBatch, firstName="there", snapshots=[], stealthList=[], onSfStatus, perms={}, frontier=[], activeUser, removalQueue=[], onConfirmRemoval, onDismissRemoval, tasks=[], setTasks, onOpenTaskModal, dailyStats={}, onRemoveAccount, onKeepAccount, onFlagForBDR, pool=[], onClaimAccount, onSkipPoolAccount, onUpdateAccount, nuggets=[], activeRole, teamUsers=[], compliance={} }) {
  const isBDR = !perms.canStealth && !perms.canReassay;
  const tot = accounts.length;
  const analyzed = accounts.filter(a=>a.score);
  const unana = accounts.filter(a=>!a.score&&!a.assay_failed).length;
  const cnt = { Gold:0, Silver:0, Tin:0, Slag:0 };
  accounts.forEach(a=>{ if(cnt[a.tier]!==undefined) cnt[a.tier]++; });

  const breakdown = calcTerritoryBreakdown(accounts, snapshots);
  const { score, grade, c:gradeColor } = breakdown || { score:0, grade:"—", c:C.dim };

  const GREETINGS = [
    "Mornin', {name}—strike anything good yet?",
    "Well howdy—what brings you to these parts?",
    "Evenin', {name}—pull up a stump.",
    "Howdy there—lookin' to stake a claim?",
    "Tip o' the hat—find any color yet?",
    "Howdy, {name}—pan's waitin'.",
    "Well now—another soul chasin' gold.",
    "You look like you've got the grit—welcome to the claim.",
    "Step right up—this creek's still got secrets.",
    "Careful now—these parts reward the patient.",
    "Howdy—fortune favors the diggin' kind.",
    "Pull up close—the ground's rich today.",
    "Welcome, {name}—let's see what shines.",
    "Reckon you're new 'round this creek?",
  ];
  const SAYINGS = [
    "You pan or you starve, partner.",
    "Strike dirt long enough, you'll hit gold.",
    "That vein's deeper than it looks.",
    "Don't sell your claim for fool's gold.",
    "Reckon this one's worth assayin'.",
    "I ain't sayin' it's gold… but it's glitterin'.",
    "Another day, another pan in the creek.",
    "You bring the grit, I'll bring the pickaxe.",
    "This here's a rich patch—stake it quick!",
    "Storm's comin', better lock down your claim.",
    "Ain't no gold in standin' still.",
    "That prospector's got a nose for nuggets.",
    "You dig where others quit.",
    "Pan enough mud, you learn what shines.",
    "Well I'll be—fresh meat at the claim!",
  ];
  const [greetIdx] = useState(()=>Math.floor(Math.random()*GREETINGS.length));
  const [sayingIdx] = useState(()=>Math.floor(Math.random()*SAYINGS.length));
  const greeting = GREETINGS[greetIdx].replace("{name}", firstName);
  const saying   = SAYINGS[sayingIdx];

  const [activeTab,   setActiveTab]   = useState("today");
  const [calEvents,   setCalEvents]   = useState([]);
  const [gradeOpen,   setGradeOpen]   = useState(false);
  const [prospectTab, setProspectTab] = useState("drop");
  const [siteEditId,  setSiteEditId]  = useState(null);
  const [siteEditVal, setSiteEditVal] = useState("");
  const [claimedId,   setClaimedId]   = useState(null);
  const [bdrSentId,   setBdrSentId]   = useState(null);
  // Watch the bulk assay so we can disable the "Run assay" button while a run is active
  const [assayActive, setAssayActive] = useState(() => {
    const p = loadAssayProgress();
    return !!(p && !p.done && p.total > 0 && (p.completed || 0) < p.total);
  });
  useEffect(() => {
    const recompute = () => {
      const p = loadAssayProgress();
      setAssayActive(!!(p && !p.done && p.total > 0 && (p.completed || 0) < p.total));
    };
    window.addEventListener('prospector_assay_updated', recompute);
    const t = setInterval(recompute, 2000);
    return () => { window.removeEventListener('prospector_assay_updated', recompute); clearInterval(t); };
  }, []);

  const doClaim = id => { onClaimAccount&&onClaimAccount(id); setClaimedId(id); setTimeout(()=>setClaimedId(null),1200); };
  const flagBDR = a  => { onFlagForBDR&&onFlagForBDR(a); setBdrSentId(a.id); setTimeout(()=>setBdrSentId(null),1500); };

  const lastWeekSnap = snapshots.length>=7 ? snapshots[snapshots.length-7] : snapshots[0];
  const scoreDelta = lastWeekSnap ? score - lastWeekSnap.score : null;
  const recentSnaps = snapshots.slice(-14);
  const atRisk   = accounts.filter(a=>isStale(lastTouch(a))&&a.score<=2);
  const warnAccs = accounts.filter(a=>isWarn(lastTouch(a))&&a.score<=2);

  const [debriefAlerts, setDebriefAlerts] = useState(() => {
    try { return JSON.parse(localStorage.getItem('prospector_debrief_alerts')||'[]').filter(a=>!a.dismissed); } catch { return []; }
  });
  useEffect(() => {
    const check = () => {
      try { const all=JSON.parse(localStorage.getItem('prospector_debrief_alerts')||'[]'); setDebriefAlerts(all.filter(a=>!a.dismissed)); } catch {}
    };
    const t = setInterval(check, 30000);
    return () => clearInterval(t);
  }, []);
  const dismissAlert = id => {
    const all = JSON.parse(localStorage.getItem('prospector_debrief_alerts')||'[]');
    const upd = all.map(a=>a.id===id?{...a,dismissed:true}:a);
    localStorage.setItem('prospector_debrief_alerts', JSON.stringify(upd));
    setDebriefAlerts(upd.filter(a=>!a.dismissed));
  };

  const ucCounts  = UCS_DATA.map(uc=>({...uc,n:accounts.filter(a=>a.ucs&&a.ucs.some(u=>u===uc.id||u.toLowerCase()===uc.lb.toLowerCase())).length})).filter(u=>u.n>0).sort((a,b)=>b.n-a.n);
  const prodCounts= ALL_PRODUCTS.map(p=>({name:p,n:accounts.filter(a=>a.prods&&a.prods.includes(p)).length,c:PROD_COLOR[p]||C.mut})).filter(p=>p.n>0).sort((a,b)=>b.n-a.n).slice(0,8);
  const vertMap   = {}; accounts.forEach(a=>{ if(a.vert){vertMap[a.vert]=(vertMap[a.vert]||0)+1;} });
  const vertCounts= Object.entries(vertMap).sort((a,b)=>b[1]-a[1]).slice(0,6);

  const tierSegs  = [{label:"Gold",v:cnt.Gold,c:C.gold},{label:"Silver",v:cnt.Silver,c:C.silver},{label:"Tin",v:cnt.Tin,c:C.tin},{label:"Slag",v:cnt.Slag,c:C.slag},{label:"Unanalyzed",v:unana,c:C.brd}];
  const stageSegs = DEAL_STAGES.map(s=>({label:s.id,v:accounts.filter(a=>(a.stage||"Prospecting")===s.id).length,c:s.c})).filter(s=>s.v>0);
  const vertSegs  = vertCounts.slice(0,7).map(([v,n])=>({label:v,v:n,c:VERT_C[v]||C.mut}));
  const freshSegs = [
    {label:"Active",  v:accounts.filter(a=>staleDays(lastTouch(a))<30).length,                                       c:C.green },
    {label:"Warm",    v:accounts.filter(a=>staleDays(lastTouch(a))>=30&&staleDays(lastTouch(a))<60).length,          c:C.blue  },
    {label:"Warning", v:accounts.filter(a=>staleDays(lastTouch(a))>=60&&staleDays(lastTouch(a))<90).length,          c:C.orange},
    {label:"At Risk", v:accounts.filter(a=>staleDays(lastTouch(a))>=90).length,                                      c:C.red   },
  ];

  if (isBDR) {
    return (
      <BdrCommandCenter
        accounts={accounts} tasks={tasks} frontier={frontier} activeUser={activeUser}
        firstName={firstName} onUpdateAccount={onUpdateAccount} onNav={onNav}
        setTasks={setTasks} teamUsers={teamUsers} compliance={compliance} calendarEvents={calEvents}
      />
    );
  }

  // ── Pre-compute candidates outside JSX ─────────────────────────────────────
  const DROP_STAGES = new Set(["Prospecting","Needs Follow-up"]);
  const favSet = new Set(JSON.parse(localStorage.getItem("prospector_favorites")||"[]"));
  const dropCandidates = accounts.filter(a=>{
    if(favSet.has(a.id)||a.keepOverride) return false;
    const days = staleDays(lastTouch(a));
    return a.tier==="Slag"||(a.tier==="Tin"&&days>=90)||!!a.dis||(DROP_STAGES.has(a.stage||"Prospecting")&&days>=90);
  }).sort((a,b)=>staleDays(lastTouch(b))-staleDays(lastTouch(a))).slice(0,5);
  const addCandidates = (pool||[]).filter(a=>!a.poolSkip&&(a.tier==="Gold"||a.tier==="Silver")).sort((a,b)=>(a.score||9)-(b.score||9)).slice(0,5);

  const inFrontierNames = new Set(frontier.map(f=>f.name.toLowerCase()));
  const ACTIVE_STAGES   = new Set(["Engaged","Active Deal","Qualified","Closed Won","Closed Lost"]);
  const notActive = a => !ACTIVE_STAGES.has(a.stage||"Prospecting");
  const notWorked = a => !inFrontierNames.has(a.name.toLowerCase())&&notActive(a);
  const gems = (() => {
    const gs = [];
    accounts.filter(a=>!a.score&&GEM_VERTS.has(a.vert)&&notWorked(a)).slice(0,3).forEach(a=>gs.push({acc:a,reason:GEM_REASONS.unanalyzed_fintech}));
    accounts.filter(a=>a.tier==="Gold"&&notWorked(a)).forEach(a=>gs.push({acc:a,reason:GEM_REASONS.gold_unworked}));
    accounts.filter(a=>a.tier==="Silver"&&notWorked(a)).slice(0,2).forEach(a=>gs.push({acc:a,reason:GEM_REASONS.silver_unworked}));
    accounts.filter(a=>a.tier==="Gold"&&notActive(a)&&staleDays(lastTouch(a))>=60&&!gs.find(g=>g.acc.id===a.id)).forEach(a=>gs.push({acc:a,reason:GEM_REASONS.stale_gold}));
    accounts.filter(a=>(a.prods||[]).length>=3&&notWorked(a)&&!gs.find(g=>g.acc.id===a.id)).slice(0,2).forEach(a=>gs.push({acc:a,reason:GEM_REASONS.high_products}));
    const seen = new Set();
    return gs.filter(g=>{if(seen.has(g.acc.id))return false;seen.add(g.acc.id);return true;}).sort((a,b)=>(a.acc.score||9)-(b.acc.score||9)).slice(0,5);
  })();

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>

      {/* ── Debrief alert banners ── */}
      {debriefAlerts.map(alert=>(
        <div key={alert.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 16px", background:`${C.gold}14`, border:`1px solid ${C.gold}44`, borderRadius:8 }}>
          <span style={{ fontSize:16 }}>📞</span>
          <span style={{ flex:1, fontSize:13, color:C.txt }}><span style={{ color:C.gold, fontWeight:600 }}>{alert.accName}</span> call just ended — log your debrief</span>
          <button onClick={()=>{ onNav("accounts",alert.accId||undefined); dismissAlert(alert.id); }} style={{ ...mono, fontSize:12, padding:"4px 12px", background:`${C.gold}22`, border:`1px solid ${C.gold}44`, color:C.gold, borderRadius:5, cursor:"pointer" }}>Log debrief →</button>
          <button onClick={()=>dismissAlert(alert.id)} style={{ background:"transparent", border:"none", color:C.dim, fontSize:16, cursor:"pointer", padding:"0 4px" }}>✕</button>
        </div>
      ))}

      {/* ── Removal recommendations ── */}
      {removalQueue.length>0&&(
        <div style={{ background:"#140808", border:`1px solid ${C.red}44`, borderRadius:8, padding:"12px 14px" }}>
          <p style={{ ...mono, margin:"0 0 10px", fontSize:11, fontWeight:500, color:C.red, textTransform:"uppercase", letterSpacing:"0.08em" }}>🚩 {removalQueue.length} removal recommendation{removalQueue.length>1?"s":""} from BDR</p>
          {removalQueue.map(item=>{
            const ds=item.flaggedAt?Math.floor((Date.now()-new Date(item.flaggedAt))/86400000):0;
            const ts=TS[item.accTier]||{};
            return(
              <div key={item.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 10px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:6, marginBottom:5 }}>
                {item.accTier&&<span style={{ ...mono, fontSize:11, color:ts.c, border:`1px solid ${ts.b||C.brd}`, borderRadius:3, padding:"1px 5px", flexShrink:0 }}>{ts.i} {item.accTier}</span>}
                <div style={{ flex:1, minWidth:0 }}>
                  <p style={{ margin:0, fontSize:14, fontWeight:500, color:C.txt }}>{item.accName}</p>
                  <p style={{ ...mono, margin:0, fontSize:11, color:C.mut }}>🚩 {item.flaggedBy} · {item.reason} · {ds===0?"today":`${ds}d ago`}</p>
                </div>
                {item.accWeb&&<a href={item.accWeb.startsWith("http")?item.accWeb:`https://${item.accWeb}`} target="_blank" rel="noreferrer" style={{ ...mono, fontSize:11, color:C.tin, textDecoration:"none", flexShrink:0 }}>↗</a>}
                <button onClick={()=>onConfirmRemoval&&onConfirmRemoval(item)} style={{ ...mono, fontSize:11, padding:"4px 10px", background:"#1A0808", border:`1px solid ${C.red}55`, color:C.red, borderRadius:4, cursor:"pointer", flexShrink:0 }}>✓ Mark removed</button>
                <button onClick={()=>onDismissRemoval&&onDismissRemoval(item.id)} style={{ ...mono, fontSize:11, padding:"4px 8px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:4, cursor:"pointer", flexShrink:0 }}>Dismiss</button>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Assay running ── */}
      {activeBatch&&(
        <div style={{ background:C.sur, borderLeft:`3px solid ${C.purple}`, borderRadius:8, padding:"12px 14px" }}>
          <p style={{ margin:"0 0 8px", fontSize:15, fontWeight:500, color:C.txt }}>⬡ Assay running — {activeBatch.fileName}</p>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8 }}>
            {[["Site",activeBatch.ws,C.blue],["Assayed",activeBatch.assay,C.purple],["Gold",activeBatch.gold||0,C.gold],["Silver",activeBatch.silver||0,C.silver]].map(([l,v,c])=>(
              <div key={l} style={{ background:C.card, borderRadius:6, padding:"7px 10px" }}>
                <p style={{ ...mono, margin:"0 0 2px", fontSize:11, color:C.mut, textTransform:"uppercase" }}>{l}</p>
                <p style={{ ...mono, margin:0, fontSize:20, fontWeight:600, color:c }}>{v||0}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Unanalyzed prompt ── */}
      {unana>0&&(
        <div style={{ background:C.sur, border:`1px solid ${C.tinBdr}`, borderRadius:8, padding:"10px 14px", display:"flex", alignItems:"center", gap:10 }}>
          <p style={{ margin:0, fontSize:14, color:C.txt, flex:1 }}><span style={{ color:C.tin, fontWeight:500 }}>{unana}</span> accounts not yet assayed</p>
          {assayActive ? (
            <span style={{ ...mono, fontSize:11, color:'#5a6a5a', fontStyle:'italic' }}>⛏ already running…</span>
          ) : (
            <button onClick={()=>onNav("accounts","open_assay")} style={{ fontSize:13, padding:"5px 12px", background:C.tinBg, border:`1px solid ${C.tinBdr}`, color:C.tin, borderRadius:5, cursor:"pointer" }}>Run assay →</button>
          )}
        </div>
      )}

      {/* ── Scout Command Bar ── */}
      <ScoutCommandBar
        accounts={accounts}
        onNav={onNav}
        onCreateTask={task=>setTasks&&setTasks(prev=>[task,...prev])}
        activeUser={activeUser}
      />

      {/* ── Header row ── */}
      <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
        <span style={{ fontSize:13, color:"#f1f5f9", fontWeight:500 }} title={saying}>{greeting}</span>
        <span style={{ ...mono, fontSize:11, color:"#374151" }}>·</span>
        <span style={{ ...mono, fontSize:11, color:"#6b7280" }}><span style={{ color:"#f1f5f9", fontWeight:600 }}>{tot}</span> accounts</span>
        <span style={{ ...mono, fontSize:11, color:"#374151" }}>·</span>
        <span style={{ ...mono, fontSize:11, color:"#6b7280" }}><span style={{ color:"#f1f5f9", fontWeight:600 }}>{analyzed.length}</span> analyzed</span>
        <span style={{ ...mono, fontSize:11, color:"#374151" }}>·</span>
        <span style={{ ...mono, fontSize:11, color:"#6b7280" }}>Q2 2026</span>
        <div style={{ marginLeft:"auto" }}>
          <button onClick={()=>setGradeOpen(o=>!o)}
            style={{ ...mono, display:"flex", alignItems:"center", gap:6, padding:"5px 12px", background:`${gradeColor}14`, border:`1px solid ${gradeColor}44`, borderRadius:6, cursor:"pointer" }}>
            <span style={{ fontSize:10, color:"#6b7280" }}>Territory</span>
            <span style={{ fontSize:15, fontWeight:700, color:gradeColor }}>{grade}</span>
            <span style={{ fontSize:11, color:"#6b7280" }}>{score}/100</span>
            {scoreDelta!==null&&(
              <span style={{ fontSize:10, color:scoreDelta>=0?"#4ade80":"#f87171" }}>{scoreDelta>=0?"↑":"↓"}{Math.abs(scoreDelta)}pts</span>
            )}
            {recentSnaps.length>=2&&<Sparkline data={recentSnaps} color={gradeColor} width={60} height={18}/>}
          </button>
        </div>
      </div>

      {/* ── Grade breakdown (collapsible) ── */}
      <div style={{ maxHeight:gradeOpen?"700px":"0", overflow:"hidden", transition:"max-height 0.35s cubic-bezier(0.4,0,0.2,1)" }}>
        {breakdown&&(()=>{
          const bd=breakdown;
          const pct=n=>`${Math.round(n*100)}%`;
          const curIdx=GRADE_THRESHOLDS.findIndex(t=>t.grade===bd.grade);
          const nextTier=curIdx>0?GRADE_THRESHOLDS[curIdx-1]:null;
          const ptsNeeded=nextTier?nextTier.min-bd.score:0;
          const Row=({label,pts,max,children})=>(
            <div style={{ marginBottom:10 }}>
              <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:4 }}>
                <span style={{ fontSize:13, fontWeight:500, color:C.txt }}>{label}</span>
                <span style={{ ...mono, fontSize:12, color:pts/max>=0.75?C.green:pts/max>=0.5?C.orange:C.red, marginLeft:"auto" }}>{pts}/{max} pts</span>
                <div style={{ width:80, height:5, background:C.sur, borderRadius:3, overflow:"hidden", flexShrink:0 }}>
                  <div style={{ height:"100%", width:`${(pts/max)*100}%`, background:pts/max>=0.75?C.green:pts/max>=0.5?C.orange:C.red, borderRadius:3, transition:"width 0.4s" }}/>
                </div>
              </div>
              <div>{children}</div>
            </div>
          );
          const Note=({text,c})=>(<p style={{ ...mono, margin:"2px 0", fontSize:11, color:c||C.mut }}>{text}</p>);
          return(
            <div style={{ background:C.card, border:`1px solid ${gradeColor}33`, borderRadius:8, padding:"14px 16px", marginTop:2 }}>
              <p style={{ ...mono, margin:"0 0 12px", fontSize:11, fontWeight:500, color:C.mut, textTransform:"uppercase", letterSpacing:"0.08em" }}>Grade Breakdown — {bd.score}/100</p>
              <Row label="Account quality" pts={bd.quality.pts} max={bd.quality.max}>
                <Note text={`${bd.quality.gold} Gold (${pct(bd.quality.goldPct)}) — target 20%+ for full points`} c={bd.quality.goldPct>=0.20?C.green:bd.quality.goldPct>=0.10?C.orange:C.red}/>
                <Note text={`${bd.quality.silver} Silver (${pct(bd.quality.silverPct)})`} c={bd.quality.silverPct>=0.20?C.green:C.mut}/>
                <Note text={`${bd.quality.slag} Slag — ${bd.quality.slagPct>0.30?"drag on score":"acceptable"}`} c={bd.quality.slagPct>0.30?C.red:C.mut}/>
              </Row>
              <Row label="Activity score" pts={bd.activity.pts} max={bd.activity.max}>
                {bd.activity.atRisk>0?<Note text={`${bd.activity.atRisk} accounts at risk (90+ days) — costs ${bd.activity.atRiskPenalty} pts`} c={C.red}/>:<Note text="No accounts at risk" c={C.green}/>}
                {bd.activity.warn>0&&<Note text={`${bd.activity.warn} approaching 90 days`} c={C.orange}/>}
              </Row>
              <Row label="Pipeline score" pts={bd.pipeline.pts} max={bd.pipeline.max}>
                <Note text={`${bd.pipeline.qualified} Qualified, ${bd.pipeline.closedWon} Closed Won`} c={bd.pipeline.qualified+bd.pipeline.closedWon>0?C.green:C.mut}/>
                <Note text={`${bd.pipeline.engaged} Engaged`} c={bd.pipeline.engaged>=10?C.green:bd.pipeline.engaged>0?C.orange:C.mut}/>
              </Row>
              <Row label="Territory growth" pts={bd.growth.pts} max={bd.growth.max}>
                <Note text={`Added this week: ${bd.growth.addedThisWeek}`} c={bd.growth.addedThisWeek>=2?C.green:bd.growth.addedThisWeek>0?C.orange:C.mut}/>
                <Note text={`Slag removed vs last week: ${bd.growth.slagReduced>0?`-${bd.growth.slagReduced}`:"none tracked"}`} c={bd.growth.slagReduced>0?C.green:C.mut}/>
              </Row>
              {nextTier&&ptsNeeded>0&&(
                <div style={{ marginTop:12, paddingTop:12, borderTop:`1px solid ${C.brd}` }}>
                  <p style={{ ...mono, margin:"0 0 6px", fontSize:11, fontWeight:500, color:C.mut, textTransform:"uppercase", letterSpacing:"0.08em" }}>To reach {nextTier.grade} (+{ptsNeeded} pts needed)</p>
                  {bd.quality.goldPct<0.20&&<Note text={`→ Bring Gold to 20%+ (${Math.ceil(bd.quality.total*0.20)-bd.quality.gold} more)`} c={nextTier.c}/>}
                  {bd.quality.slagPct>0.30&&<Note text={`→ Remove ${Math.ceil(bd.quality.slag-bd.quality.total*0.30)} Slag accounts`} c={nextTier.c}/>}
                  {bd.activity.atRisk>0&&<Note text={`→ Touch ${Math.min(bd.activity.atRisk,Math.ceil(ptsNeeded/1.5))} at-risk accounts`} c={nextTier.c}/>}
                </div>
              )}
              {!nextTier&&<Note text="Maximum grade — nothing higher to reach" c={C.green}/>}
            </div>
          );
        })()}
      </div>

      {/* ── Tab bar ── */}
      <div style={{ display:"flex", borderBottom:"1px solid #1e293b" }}>
        {[["today","Today"],["territory","Territory"]].map(([tab,label])=>(
          <button key={tab} onClick={()=>setActiveTab(tab)}
            style={{ ...mono, fontSize:12, padding:"8px 18px", background:"transparent", border:"none",
              borderBottom:`2px solid ${activeTab===tab?TEAL:"transparent"}`,
              color:activeTab===tab?"#f1f5f9":"#6b7280",
              cursor:"pointer", fontWeight:activeTab===tab?600:400, marginBottom:-1 }}>
            {label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════ TODAY TAB ══════════════════════════ */}
      {activeTab==="today"&&(
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>

          {/* A — Today's Goals */}
          <TodayGoals dailyStats={dailyStats} accounts={accounts} tasks={tasks}/>

          {/* Row 1 — Calendar (50%) + Brief (50%) */}
          <div style={{ display:"flex", gap:16, alignItems:"stretch" }}>
            <div style={{ flex:"1 1 50%", minWidth:0, display:"flex" }}>
              <SalesCalendarWidget accounts={accounts} onNav={onNav} tasks={tasks} authError={localStorage.getItem("prospector_gmail_auth_error")||null} onEventsLoaded={setCalEvents} onCreateTask={t=>setTasks&&setTasks(prev=>[{...t,source:t.source||"calendar"},...prev])} onUpdateAccount={onUpdateAccount}/>
            </div>
            <div style={{ flex:"1 1 50%", minWidth:0, display:"flex" }}>
              <BriefPanel
                accounts={accounts}
                tasks={tasks}
                activeUser={activeUser}
                onNav={onNav}
                onCreateTask={t=>setTasks&&setTasks(prev=>[t,...prev])}
                onUpdateTask={(id, patch) => setTasks && setTasks(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t))}
              />
            </div>
          </div>

          {/* Row 2 — Deal Alerts */}
          <div style={{ ...CARD() }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
              <p style={{ ...SH(), marginBottom:0, flex:1 }}>Deal Alerts</p>
              {atRisk.length>0&&<span style={{ ...mono, fontSize:9, color:C.red, background:`${C.red}18`, border:`1px solid ${C.red}44`, borderRadius:3, padding:"0 6px" }}>{atRisk.length} at risk</span>}
            </div>
            <div style={{ overflowY:"auto", maxHeight:220 }}>
              {(()=>{
                const alerts=[];
                const allComp=getAllCompliance();
                Object.entries(allComp).forEach(([accId,comp])=>{
                  const acc=accounts.find(a=>String(a.id)===String(accId));
                  if(!acc||acc.stage!=="Active Deal") return;
                  const steps=comp.type==="partner"?PARTNER_STEPS:STANDARD_STEPS;
                  (comp.steps||[]).forEach(s=>{
                    const stepDef=steps.find(st=>st.id===s.id);
                    if(!stepDef) return;
                    const days=(!s.startedAt||s.status==="Approved")?0:Math.floor((Date.now()-new Date(s.startedAt))/86400000);
                    if(s.status==="Blocked") alerts.push({accId,accName:acc.name,label:stepDef.label,tag:"Blocked",c:C.red});
                    else if(days>=7&&s.status!=="Approved") alerts.push({accId,accName:acc.name,label:`${stepDef.label} · ${days}d`,tag:"Stale",c:C.orange});
                  });
                });
                atRisk.slice(0,5).forEach(a=>alerts.push({accId:a.id,accName:a.name,label:`${staleDays(lastTouch(a))}d no activity`,tag:a.tier||"At Risk",c:a.tier==="Gold"?C.gold:"#94a3b8"}));
                warnAccs.slice(0,3).forEach(a=>alerts.push({accId:a.id,accName:a.name,label:`${staleDays(lastTouch(a))}d — approaching`,tag:"Warning",c:C.orange}));
                if(!alerts.length) return <div style={{ ...mono, fontSize:11, color:"#4ade80" }}>All clear ✓</div>;
                return(
                  <>
                    {alerts.slice(0,12).map((a,i)=>(
                      <div key={i} style={{ display:"flex", alignItems:"center", gap:8, padding:"5px 0", borderBottom:"1px solid #1e293b22" }}>
                        <span style={{ ...mono, fontSize:10, color:a.c, flexShrink:0 }}>⚑</span>
                        <span style={{ fontSize:12, color:"#f1f5f9", flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{a.accName}</span>
                        <span style={{ ...mono, fontSize:10, color:a.c, flexShrink:0 }}>{a.tag}</span>
                        <button onClick={()=>onNav("accounts",a.accId)} style={{ ...mono, fontSize:9, color:"#6b7280", background:"transparent", border:"none", cursor:"pointer", flexShrink:0 }}>View →</button>
                      </div>
                    ))}
                    {alerts.length>12&&<button onClick={()=>onNav("accounts")} style={{ ...mono, fontSize:10, color:TEAL, background:"transparent", border:"none", cursor:"pointer", marginTop:4 }}>Show all {alerts.length} →</button>}
                  </>
                );
              })()}
            </div>
          </div>

          {/* C — Diamonds + Drop/Add */}
          <div style={{ display:"flex", gap:10, alignItems:"flex-start" }}>

            {/* Diamonds in the Rough */}
            <div style={{ flex:1, ...CARD() }}>
              <p style={{ ...SH() }}>💎 Diamonds in the Rough</p>
              {gems.length===0
                ? <div style={{ ...mono, fontSize:11, color:"#6b7280" }}>Territory looking strong — no hidden gems right now</div>
                : gems.map(({acc:a,reason})=>{
                    const ts=TS[a.tier]||{};
                    return(
                      <div key={a.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 0", borderBottom:"1px solid #1e293b22" }}>
                        {a.tier
                          ? <span style={{ ...mono, fontSize:10, color:ts.c, border:`1px solid ${ts.b||C.brd}`, borderRadius:3, padding:"1px 5px", flexShrink:0 }}>{ts.i} {a.tier}</span>
                          : <span style={{ ...mono, fontSize:10, color:"#6b7280", border:"1px solid #1e293b", borderRadius:3, padding:"1px 5px", flexShrink:0 }}>unscored</span>
                        }
                        <div style={{ flex:1, minWidth:0 }}>
                          <div onClick={()=>onNav("accounts",a.id)} style={{ fontSize:12, color:"#f1f5f9", cursor:"pointer", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{a.name}</div>
                          <div style={{ ...mono, fontSize:10, color:"#6b7280" }}>{reason}</div>
                        </div>
                        <span style={{ ...mono, fontSize:10, color:VERT_C[a.vert]||"#6b7280", flexShrink:0 }}>{a.vert||""}</span>
                        <button onClick={()=>onNav("accounts",a.id)} style={{ ...mono, fontSize:10, padding:"2px 8px", background:"transparent", border:"1px solid #1e293b", color:"#6b7280", borderRadius:4, cursor:"pointer", flexShrink:0 }}>Open →</button>
                      </div>
                    );
                  })
              }
            </div>

            {/* Consider Dropping / Adding */}
            <div style={{ flex:1, background:prospectTab==="add"?"#0A0C06":"#160808", border:`1px solid ${prospectTab==="add"?C.gold:C.red}44`, borderRadius:8, padding:"12px 14px" }}>
              <div style={{ display:"flex", gap:0, marginBottom:10, borderBottom:`1px solid ${C.brd}` }}>
                {[["drop","🗑 Consider Dropping",C.red],["add","⬟ Consider Adding",C.gold]].map(([id,lb,c])=>(
                  <button key={id} onClick={()=>setProspectTab(id)} style={{ ...mono, fontSize:11, padding:"4px 12px", background:"transparent", border:"none", borderBottom:`2px solid ${prospectTab===id?c:"transparent"}`, color:prospectTab===id?c:C.dim, cursor:"pointer", fontWeight:prospectTab===id?600:400, marginBottom:-1 }}>{lb}</button>
                ))}
              </div>
              {prospectTab==="drop"&&(
                dropCandidates.length===0
                  ? <p style={{ ...mono, fontSize:12, color:C.dim, margin:0 }}>No drop candidates right now 🌱</p>
                  : dropCandidates.map(a=>{
                      const days=staleDays(lastTouch(a));
                      const reason=a.dis?"Disqualified":a.tier==="Slag"?"Slag — low fit":`${days}d no activity`;
                      const sfdcHref=toSfdcUrl(a.sfdc);
                      const liHref=a.linkedin||(a.name?`https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(a.name)}`:null);
                      const webHref=a.web?(a.web.startsWith("http")?a.web:`https://${a.web}`):(a.name?`https://www.google.com/search?q=${encodeURIComponent(a.name)}`:null);
                      const editingThis=siteEditId===a.id;
                      return(
                        <div key={a.id} style={{ borderBottom:`1px solid ${C.red}22`, padding:"5px 0" }}>
                          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                            <span style={{ flex:1, fontSize:12, color:"#f1f5f9", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{a.name}</span>
                            <span style={{ ...mono, fontSize:10, color:C.red, flexShrink:0 }}>{reason}</span>
                            <div style={{ display:"flex", gap:3, flexShrink:0 }}>
                              {sfdcHref&&<a href={sfdcHref} target="_blank" rel="noreferrer" style={{ ...mono, fontSize:9, padding:"1px 6px", background:"transparent", border:`1px solid ${C.orange}66`, color:C.orange, borderRadius:3, textDecoration:"none" }}>SF</a>}
                              {liHref&&<a href={liHref} target="_blank" rel="noreferrer" style={{ ...mono, fontSize:9, padding:"1px 6px", background:"transparent", border:"1px solid #4A9AE866", color:"#4A9AE8", borderRadius:3, textDecoration:"none" }}>in</a>}
                              {webHref&&<a href={webHref} target="_blank" rel="noreferrer" style={{ ...mono, fontSize:9, padding:"1px 6px", background:"transparent", border:`1px solid ${C.brd}`, color:C.mut, borderRadius:3, textDecoration:"none" }}>↗</a>}
                              {!a.web&&onUpdateAccount&&!editingThis&&<button onClick={()=>{ setSiteEditId(a.id); setSiteEditVal(""); }} style={{ ...mono, fontSize:9, padding:"1px 6px", background:`${C.blue}18`, border:`1px solid ${C.blue}66`, color:C.blue, borderRadius:3, cursor:"pointer" }}>+site</button>}
                              {onKeepAccount&&<button onClick={()=>onKeepAccount(a.id)} style={{ ...mono, fontSize:10, padding:"1px 6px", background:`${C.green}18`, border:`1px solid ${C.green}66`, color:C.green, borderRadius:3, cursor:"pointer" }}>↑</button>}
                              {onFlagForBDR&&<button onClick={()=>flagBDR(a)} style={{ ...mono, fontSize:9, padding:"1px 6px", background:bdrSentId===a.id?`${C.purple}44`:`${C.purple}18`, border:`1px solid ${C.purple}66`, color:C.purple, borderRadius:3, cursor:"pointer" }}>{bdrSentId===a.id?"Sent!":"BDR"}</button>}
                              {onRemoveAccount&&<button onClick={()=>onRemoveAccount(a.id)} style={{ ...mono, fontSize:9, padding:"1px 6px", background:`${C.red}18`, border:`1px solid ${C.red}66`, color:C.red, borderRadius:3, cursor:"pointer" }}>🗑</button>}
                            </div>
                          </div>
                          {a.dis&&<div style={{ ...mono, fontSize:10, color:"#6b7280", marginTop:2 }}>⚑ {a.dis}</div>}
                          {editingThis&&(
                            <div style={{ display:"flex", gap:5, marginTop:5, alignItems:"center" }}>
                              <input autoFocus value={siteEditVal} onChange={e=>setSiteEditVal(e.target.value)}
                                onKeyDown={e=>{ if(e.key==="Enter"&&siteEditVal.trim()){onUpdateAccount(a.id,{web:siteEditVal.trim()});setSiteEditId(null);} if(e.key==="Escape")setSiteEditId(null); }}
                                placeholder="company.com"
                                style={{ ...mono, flex:1, fontSize:11, padding:"3px 8px", background:C.sur, border:`1px solid ${C.blue}88`, borderRadius:4, color:C.txt, outline:"none" }}/>
                              <button onClick={()=>{ if(siteEditVal.trim()){onUpdateAccount(a.id,{web:siteEditVal.trim()});setSiteEditId(null);} }} style={{ ...mono, fontSize:10, padding:"3px 9px", background:`${C.blue}22`, border:`1px solid ${C.blue}66`, color:C.blue, borderRadius:4, cursor:"pointer" }}>Save</button>
                              <button onClick={()=>setSiteEditId(null)} style={{ ...mono, fontSize:10, padding:"3px 7px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:4, cursor:"pointer" }}>✕</button>
                            </div>
                          )}
                        </div>
                      );
                    })
              )}
              {prospectTab==="add"&&(
                addCandidates.length===0
                  ? <p style={{ ...mono, fontSize:12, color:C.dim, margin:0 }}>No Gold or Silver accounts in the pool right now.</p>
                  : addCandidates.map(a=>{
                      const ts=TS[a.tier]||{i:"·",c:C.dim};
                      const sfdcHref=toSfdcUrl(a.sfdc);
                      const liHref=a.linkedin||(a.name?`https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(a.name)}`:null);
                      const webHref=a.web?(a.web.startsWith("http")?a.web:`https://${a.web}`):(a.name?`https://www.google.com/search?q=${encodeURIComponent(a.name)}`:null);
                      return(
                        <div key={a.id} style={{ borderBottom:`1px solid ${C.gold}22`, padding:"5px 0" }}>
                          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                            <span style={{ ...mono, fontSize:10, color:ts.c, flexShrink:0 }}>{ts.i}</span>
                            <span style={{ flex:1, fontSize:12, color:"#f1f5f9", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{a.name}</span>
                            <span style={{ ...mono, fontSize:10, color:C.mut, flexShrink:0 }}>{a.vert||""}</span>
                            <div style={{ display:"flex", gap:3, flexShrink:0 }}>
                              {sfdcHref&&<a href={sfdcHref} target="_blank" rel="noreferrer" style={{ ...mono, fontSize:9, padding:"1px 6px", background:"transparent", border:`1px solid ${C.orange}66`, color:C.orange, borderRadius:3, textDecoration:"none" }}>SF</a>}
                              {liHref&&<a href={liHref} target="_blank" rel="noreferrer" style={{ ...mono, fontSize:9, padding:"1px 6px", background:"transparent", border:"1px solid #4A9AE866", color:"#4A9AE8", borderRadius:3, textDecoration:"none" }}>in</a>}
                              {webHref&&<a href={webHref} target="_blank" rel="noreferrer" style={{ ...mono, fontSize:9, padding:"1px 6px", background:"transparent", border:`1px solid ${C.brd}`, color:C.mut, borderRadius:3, textDecoration:"none" }}>↗</a>}
                              {onFlagForBDR&&<button onClick={()=>flagBDR(a)} style={{ ...mono, fontSize:9, padding:"1px 6px", background:bdrSentId===a.id?`${C.purple}44`:`${C.purple}18`, border:`1px solid ${C.purple}66`, color:C.purple, borderRadius:3, cursor:"pointer" }}>{bdrSentId===a.id?"Sent!":"BDR"}</button>}
                              {onSkipPoolAccount&&<button onClick={()=>onSkipPoolAccount(a.id)} style={{ ...mono, fontSize:10, padding:"1px 6px", background:`${C.red}18`, border:`1px solid ${C.red}66`, color:C.red, borderRadius:3, cursor:"pointer" }}>↓</button>}
                              {onClaimAccount&&<button onClick={()=>doClaim(a.id)} style={{ ...mono, fontSize:9, padding:"1px 9px", background:claimedId===a.id?`${C.green}44`:`${C.gold}22`, border:`1px solid ${claimedId===a.id?C.green:C.gold}88`, color:claimedId===a.id?C.green:C.gold, borderRadius:3, cursor:"pointer", fontWeight:600 }}>{claimedId===a.id?"✓ Claimed":"Claim"}</button>}
                            </div>
                          </div>
                          {a.pf&&<div style={{ ...mono, fontSize:10, color:"#6b7280", marginTop:2 }}>⬟ {a.pf}</div>}
                        </div>
                      );
                    })
              )}
            </div>
          </div>

          {/* E — Golden Nuggets */}
          {(()=>{
            const active=nuggets.filter(n=>["pending","reviewing","planned"].includes(n.status)).sort((a,b)=>(b.upvotes?.length||0)-(a.upvotes?.length||0)).slice(0,4);
            if(!active.length) return null;
            return(
              <div style={{ background:"#181208", border:`1px solid ${C.gold}33`, borderRadius:8, padding:"12px 14px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
                  <span style={{ fontSize:14 }}>🪙</span>
                  <p style={{ ...mono, margin:0, fontSize:11, fontWeight:600, color:C.gold, textTransform:"uppercase", letterSpacing:"0.06em" }}>Golden Nuggets — {nuggets.filter(n=>n.status==="pending").length} pending</p>
                  <button onClick={()=>onNav("team")} style={{ marginLeft:"auto", ...mono, fontSize:11, background:"transparent", border:"none", color:C.dim, cursor:"pointer", textDecoration:"underline" }}>View all →</button>
                </div>
                {active.map(n=>{
                  const sc=NUGGET_STATUS_COLORS[n.status]||C.mut;
                  return(
                    <div key={n.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"5px 8px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:5, marginBottom:4 }}>
                      <span style={{ ...mono, fontSize:10, padding:"1px 6px", borderRadius:3, background:`${sc}18`, border:`1px solid ${sc}44`, color:sc, flexShrink:0 }}>{n.status}</span>
                      <span style={{ fontSize:13, color:C.txt, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{n.summary||n.text}</span>
                      <span style={{ ...mono, fontSize:10, color:C.dim, flexShrink:0 }}>▲ {n.upvotes?.length||0}</span>
                    </div>
                  );
                })}
              </div>
            );
          })()}

        </div>
      )}

      {/* ═══════════════════════ TERRITORY TAB ═══════════════════════ */}
      {activeTab==="territory"&&(
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>

          {/* A — Tier stat cards */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:7 }}>
            {[["Gold","#fbbf24"],["Silver","#94a3b8"],["Tin","#64748b"],["Slag","#374151"]].map(([tier,accent])=>(
              <div key={tier} style={{ background:"#0f172a", border:"1px solid #1e293b", borderLeft:`3px solid ${accent}`, borderRadius:8, padding:"11px 14px" }}>
                <p style={{ ...mono, margin:"0 0 4px", fontSize:10, color:accent, textTransform:"uppercase", letterSpacing:"0.09em", fontWeight:600 }}>{tier}</p>
                <p style={{ ...mono, margin:"0 0 2px", fontSize:28, fontWeight:700, color:"#f1f5f9", lineHeight:1 }}>{cnt[tier]}</p>
                <p style={{ ...mono, margin:0, fontSize:11, color:"#6b7280" }}>{analyzed.length>0?Math.round(cnt[tier]/analyzed.length*100):0}% of analyzed</p>
              </div>
            ))}
          </div>

          {/* B — 3 donut charts */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10 }}>
            {[
              {title:"Territory Quality", segs:tierSegs,  center:{value:tot,                                   sub:"accounts"}},
              {title:"Top Verticals",     segs:vertSegs,  center:{value:vertSegs.reduce((s,x)=>s+x.v,0),      sub:"mapped"}},
              {title:"Pipeline Stage",    segs:stageSegs, center:{value:stageSegs.reduce((s,x)=>s+x.v,0),     sub:"tracked"}},
            ].map(chart=>(
              <div key={chart.title} style={{ ...CARD() }}>
                <p style={{ ...SH() }}>{chart.title}</p>
                <div style={{ display:"flex", gap:12, alignItems:"center" }}>
                  <DonutChartLegacy segments={chart.segs} size={110} thickness={22} center={chart.center}/>
                  <div style={{ flex:1, minWidth:0 }}>
                    {chart.segs.map(s=>(
                      <div key={s.label} style={{ display:"flex", alignItems:"center", gap:6, marginBottom:5 }}>
                        <span style={{ width:7, height:7, borderRadius:"50%", background:s.c, flexShrink:0 }}/>
                        <span style={{ fontSize:11, color:"#6b7280", flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.label}</span>
                        <span style={{ ...mono, fontSize:11, color:s.c, flexShrink:0 }}>{s.v}</span>
                      </div>
                    ))}
                    {chart.segs.length===0&&<span style={{ fontSize:11, color:"#6b7280" }}>No data yet</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* C — Account freshness */}
          <div style={{ ...CARD() }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:10 }}>
              <p style={{ ...SH(), marginBottom:0 }}>Account Freshness</p>
              <span style={{ ...mono, fontSize:11, color:"#6b7280" }}>{tot} accounts</span>
            </div>
            <MiniBar segments={freshSegs} height={10}/>
            <div style={{ display:"flex", gap:0, marginTop:10 }}>
              {freshSegs.map((s,i)=>(
                <div key={s.label} style={{ flex:1, borderRight:i<freshSegs.length-1?"1px solid #1e293b":"none", paddingRight:i<freshSegs.length-1?12:0, marginRight:i<freshSegs.length-1?12:0 }}>
                  <p style={{ ...mono, margin:"0 0 1px", fontSize:20, fontWeight:700, color:s.v>0?s.c:"#374151", lineHeight:1 }}>{s.v}</p>
                  <p style={{ ...mono, margin:0, fontSize:10, color:"#6b7280" }}>{s.label}</p>
                  <p style={{ ...mono, margin:0, fontSize:10, color:"#374151" }}>{tot>0?Math.round(s.v/tot*100):0}%</p>
                </div>
              ))}
            </div>
          </div>

          {/* D — Sourcing attribution */}
          {(()=>{
            const bdrAssigned=frontier.filter(f=>f.assignedTo);
            const bdrMeetings=bdrAssigned.filter(f=>f.status==="Meeting Booked").length;
            const bdrHandoffs=bdrAssigned.filter(f=>f.status==="Handoff complete").length;
            const bdrPipeline=bdrAssigned.filter(f=>{const a=accounts.find(x=>x.name.toLowerCase()===f.name.toLowerCase());return a&&["Qualified","Proposal","Negotiation","Closed Won"].includes(a.stage);}).length;
            const stealthWon=stealthList.filter(x=>x.status==="Won").length;
            const stealthPipeline=stealthList.filter(x=>["In Pipeline","Won"].includes(x.status)).length;
            if(!bdrAssigned.length&&!stealthList.length) return null;
            return(
              <div style={{ ...CARD() }}>
                <p style={{ ...SH() }}>Sourcing Attribution</p>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                  <div style={{ background:"#060d1a", border:"1px solid #1e293b", borderRadius:6, padding:"10px 12px" }}>
                    <p style={{ ...mono, margin:"0 0 8px", fontSize:11, color:C.purple, fontWeight:500 }}>◎ BDR — Casey</p>
                    {[["Accounts claimed",bdrAssigned.length,C.purple],["Meetings booked",bdrMeetings,C.blue],["Handoffs complete",bdrHandoffs,C.green],["In pipeline",bdrPipeline,C.gold]].map(([lb,n,c])=>(
                      <div key={lb} style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                        <span style={{ fontSize:12, color:"#6b7280" }}>{lb}</span>
                        <span style={{ ...mono, fontSize:12, color:n>0?c:"#374151", fontWeight:n>0?600:400 }}>{n}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ background:"#060d1a", border:"1px solid #1e293b", borderRadius:6, padding:"10px 12px" }}>
                    <p style={{ ...mono, margin:"0 0 8px", fontSize:11, color:C.tin, fontWeight:500 }}>✈ Stealth seeded</p>
                    {[["Seeds tracked",stealthList.length,C.tin],["In pipeline",stealthPipeline,C.purple],["Won",stealthWon,C.gold]].map(([lb,n,c])=>(
                      <div key={lb} style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                        <span style={{ fontSize:12, color:"#6b7280" }}>{lb}</span>
                        <span style={{ ...mono, fontSize:12, color:n>0?c:"#374151", fontWeight:n>0?600:400 }}>{n}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* E — Use Cases + Products */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div style={{ ...CARD() }}>
              <p style={{ ...SH() }}>Use Cases</p>
              {ucCounts.length===0
                ? <span style={{ ...mono, fontSize:11, color:"#6b7280" }}>No data yet</span>
                : ucCounts.map(uc=>(
                    <div key={uc.id} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                      <span style={{ width:7, height:7, borderRadius:"50%", background:uc.c||TEAL, flexShrink:0 }}/>
                      <span style={{ fontSize:12, color:"#f1f5f9", flex:1 }}>{uc.lb}</span>
                      <span style={{ ...mono, fontSize:12, color:uc.c||TEAL, fontWeight:600 }}>{uc.n}</span>
                    </div>
                  ))
              }
            </div>
            {prodCounts.length>0&&(
              <div style={{ ...CARD() }}>
                <p style={{ ...SH() }}>Top Products</p>
                {prodCounts.map((p,i)=>{
                  const pct=Math.min((p.n/(analyzed.length||1))*100,100);
                  return(
                    <div key={p.name} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
                      <span style={{ ...mono, fontSize:10, color:"#374151", width:14, textAlign:"right", flexShrink:0 }}>{i+1}</span>
                      <span style={{ fontSize:11, color:"#f1f5f9", width:80, flexShrink:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.name}</span>
                      <div style={{ flex:1, height:5, borderRadius:3, background:"#1e293b", overflow:"hidden" }}>
                        <div style={{ height:"100%", width:`${pct}%`, background:p.c, borderRadius:3, transition:"width 0.3s" }}/>
                      </div>
                      <span style={{ ...mono, fontSize:11, color:p.c, width:26, textAlign:"right", flexShrink:0 }}>{p.n}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Stealth funnel */}
          {stealthList.length>0&&(()=>{
            const acctStageOf=entry=>{const a=accounts.find(acc=>acc.stealthId===entry.id||(acc.stealthOrigin&&acc.name.toLowerCase()===entry.companyName.toLowerCase()));return a?.stage||null;};
            const stealthFunnel=STEALTH_STATUSES.map(s=>({s,c:STEALTH_STATUS_C[s]||C.dim,n:s==="Won"?stealthList.filter(x=>x.status==="Won"||(x.promoted&&acctStageOf(x)==="Closed Won")).length:stealthList.filter(x=>x.status===s).length}));
            const maxSN=Math.max(...stealthFunnel.map(x=>x.n),1);
            const totalWon=stealthFunnel.find(f=>f.s==="Won")?.n||0;
            return(
              <div style={{ ...CARD(), border:`1px solid ${C.purple}33` }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:10 }}>
                  <p style={{ ...SH(), color:C.purple, marginBottom:0 }}>Stealth Pipeline</p>
                  {totalWon>0&&<span style={{ ...mono, fontSize:12, color:C.gold }}>{totalWon}/{stealthList.length} Won · {Math.round(totalWon/stealthList.length*100)}% conv</span>}
                </div>
                {stealthFunnel.map(f=>(
                  <div key={f.s} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:5 }}>
                    <span style={{ ...mono, fontSize:11, color:f.c, flex:"0 0 120px", textAlign:"right" }}>{f.s}</span>
                    <div style={{ flex:1, height:16, background:"#060d1a", borderRadius:3, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${(f.n/maxSN)*100}%`, background:f.c, borderRadius:3, opacity:0.8, minWidth:f.n>0?4:0, transition:"width 0.3s" }}/>
                    </div>
                    <span style={{ ...mono, fontSize:12, fontWeight:600, color:f.n>0?f.c:"#374151", flex:"0 0 24px", textAlign:"right" }}>{f.n}</span>
                  </div>
                ))}
              </div>
            );
          })()}

        </div>
      )}

    </div>
  );
}

export default HomePage;
