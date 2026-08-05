import { useState, useMemo, useEffect } from "react";
import { C, TS, mono } from '../constants/colors';
import { staleDays } from '../utils/staleness';
import { DEAL_STAGES } from './AccountCard';
import ManagerAnalytics from './ManagerAnalytics';

// Small pure helpers duplicated from App.js (defined there at module scope)
const lastTouch = (acc) => acc.last;
const initials = n => (n||"?").split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);

const STEALTH_STATUSES = ["Seeded","Outbounded","Replied","Meeting Booked","In Pipeline","Won"];
const STEALTH_STATUS_C = { "Seeded":C.dim, "Outbounded":C.blue, "Replied":C.tin, "Meeting Booked":C.green, "In Pipeline":C.purple, "Won":C.gold };

const VERT_C = {
  "Banks": "#60A8F0", "BFM": "#F5A050", "PFM": "#A878F0",
  "Wealth": "#F5C842", "Consumer Payments": "#42E890", "Technology": "#56C8E0",
  "Lending": "#F06060", "Insurance": "#E878C0", "Crypto": "#50C8A0",
  "Payroll": "#E8C870", "Real Estate": "#90C878", "Healthcare": "#78D0B0",
  "Commerce": "#E8A050", "Investment": "#F5C842", "Fintech": "#A878F0",
};

const GTM_SEG_C = { SMB:"#42E890", Fintech:"#A878F0", "B&W":"#60A8F0", ENT:"#F5C842" };

const inferSegment = (vert) => {
  if (!vert) return null;
  const v = vert.toLowerCase();
  if (["banks","insurance","wealth"].some(k=>v.includes(k))) return "B&W";
  if (["pfm","consumer payments","crypto","lending","ewa","payroll","bfm","neobank","fintech","investment","investing"].some(k=>v.includes(k))) return "Fintech";
  return null;
};

const ANALYTICS_QUOTES = [
  "Well butter my abacus, that graph's richer than a gold vein!",
  "I reckon them numbers slope steeper than a mule on payday.",
  "That chart's got more ups and downs than a boomtown saloon.",
  "Strike me logarithmic, that's a mighty fine curve!",
  "These figures don't lie… but they sure do wander like a drunk prospector.",
  "I ain't seen growth like that since the last gold rush!",
  "That trend line's headin' north faster than a panicked jackrabbit.",
  "Them data points are scattered wider than nuggets in a dry creek.",
  "Call me calibrated—this here estimate's pure gold.",
  "That projection's shakier than a prospector on his third bottle.",
  "By the beard of Euclid, we've struck statistical gold!",
  "This here histogram's got more bars than a frontier jail.",
  "That outlier sticks out like a gold tooth in a poker game.",
  "I plotted it myself—took three days and a questionable compass.",
  "Ain't no fool's gold in this dataset… just fool's averages.",
  "This curve's smoother than a river stone in a gambler's pocket.",
  "Them margins are tighter than a miser's coin purse.",
  "That variance is wilder than a coyote in a math lecture.",
  "I'd bet my last nugget that regression's fixin' to turn.",
  "This model's got more assumptions than a saloon rumor mill.",
  "Prospectin' for trends.",
  "Pannin' for data.",
  "Gold standard? More like bold standard deviation.",
  "Charts don't lie—just squint a little.",
  "Data richer than a strike at dawn.",
  "That chart's jumpier than a rattlesnake in a frying pan!",
  "These numbers got more bite than a cornered rattler.",
  "Careful now—that trend'll turn on ya faster than a coiled snake.",
  "This data's hissin' louder than a warning tail.",
  "That spike shot up like a startled rattlesnake!",
  "I wouldn't trust that forecast—shaky as a snake in cold weather.",
  "Them margins are thinner than a rattler's patience.",
  "This model's got a rattle to it… and I don't mean confidence.",
  "That outlier popped up like a snake in your bedroll.",
  "These fluctuations'll bite ya if you ain't watchin' close.",
  "By the coiled curve of calculus, that's a spicy dataset!",
  "This here graph's got more twists than a rattlesnake square dance.",
  "That variance is wrigglin' like a sack full of snakes.",
  "I plotted that line careful—didn't wanna spook the numbers.",
  "This dataset's alive… and it don't like strangers.",
  "That regression line's slitherin' where it pleases.",
  "Ain't no straight lines here—just snake trails and bad decisions.",
  "Handle data like a rattlesnake.",
  "Hear the rattle? That's volatility.",
  "Snake in the stats.",
  "Coiled trends ahead.",
  "Volatility with fangs.",
];

const AE_COLORS = [C.gold, C.blue, C.purple, C.green, C.orange, C.tin];

const p2c = (cx,cy,r,deg) => {
  const rad=(deg-90)*Math.PI/180;
  return {x:cx+r*Math.cos(rad), y:cy+r*Math.sin(rad)};
};

function DonutChart({ data=[], size=140, thickness=22, centerText="", centerSub="", showLegend=true }) {
  const [hovered,setHovered]=useState(null);
  const total=data.reduce((s,d)=>s+(d.n||0),0);
  const cx=size/2, cy=size/2;
  const outerR=(size-4)/2, innerR=outerR-thickness;
  if(!total) return(
    <div style={{ width:size,height:size,display:"flex",alignItems:"center",justifyContent:"center" }}>
      <span style={{ ...mono,fontSize:10,color:C.dim,textAlign:"center" }}>No data</span>
    </div>
  );
  const slices=[];
  let startAngle=0;
  data.forEach(d=>{
    if(!d.n)return;
    const pct=d.n/total;
    const endAngle=startAngle+pct*360;
    const sweep=endAngle-startAngle;
    const s=p2c(cx,cy,outerR,startAngle);
    const e=p2c(cx,cy,outerR,endAngle);
    const si=p2c(cx,cy,innerR,startAngle);
    const ei=p2c(cx,cy,innerR,endAngle);
    const large=sweep>180?1:0;
    const path=`M ${s.x} ${s.y} A ${outerR} ${outerR} 0 ${large} 1 ${e.x} ${e.y} L ${ei.x} ${ei.y} A ${innerR} ${innerR} 0 ${large} 0 ${si.x} ${si.y} Z`;
    slices.push({...d,path,pct,startAngle,endAngle});
    startAngle=endAngle;
  });
  const activeSlice=hovered!=null?slices[hovered]:null;
  const displayText=activeSlice?`${Math.round(activeSlice.pct*100)}%`:centerText;
  const displaySub=activeSlice?activeSlice.label:centerSub;
  return(
    <div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:8 }}>
      <svg width={size} height={size} style={{ overflow:"visible" }}>
        {slices.map((s,i)=>(
          <path key={i} d={s.path} fill={s.color}
            opacity={hovered===null?1:hovered===i?1:0.35}
            style={{ cursor:"pointer",transition:"opacity 0.15s" }}
            onMouseEnter={()=>setHovered(i)} onMouseLeave={()=>setHovered(null)}
          />
        ))}
        <text x={cx} y={cy-4} textAnchor="middle" style={{ fontSize:15,fontWeight:700,fill:activeSlice?activeSlice.color:C.txt,fontFamily:"monospace" }}>{displayText}</text>
        <text x={cx} y={cy+10} textAnchor="middle" style={{ fontSize:9,fill:C.dim,fontFamily:"monospace" }}>{displaySub}</text>
      </svg>
      {showLegend&&(
        <div style={{ display:"flex",flexWrap:"wrap",gap:"3px 10px",justifyContent:"center" }}>
          {slices.map((s,i)=>(
            <div key={i} style={{ display:"flex",alignItems:"center",gap:4,opacity:hovered===null||hovered===i?1:0.4,cursor:"pointer" }}
              onMouseEnter={()=>setHovered(i)} onMouseLeave={()=>setHovered(null)}>
              <div style={{ width:8,height:8,borderRadius:2,background:s.color,flexShrink:0 }}/>
              <span style={{ ...mono,fontSize:9,color:C.mut,whiteSpace:"nowrap" }}>{s.label} {s.n}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniLineChart({ points=[], color=C.gold, width=220, height=65, fill=false }) {
  if(points.length<2) return(
    <div style={{ width,height,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 8px" }}>
      <span style={{ ...mono,fontSize:10,color:C.dim,textAlign:"center" }}>Trend data builds over time as you upload and assay accounts</span>
    </div>
  );
  const pad={t:6,r:6,b:18,l:26};
  const w=width-pad.l-pad.r, h=height-pad.t-pad.b;
  const minV=Math.min(...points.map(p=>p.v));
  const maxV=Math.max(...points.map(p=>p.v));
  const range=Math.max(maxV-minV,1);
  const toX=i=>pad.l+(i/(points.length-1))*w;
  const toY=v=>pad.t+h-((v-minV)/range)*h;
  const poly=points.map((p,i)=>`${toX(i)},${toY(p.v)}`).join(" ");
  const fillD=`M ${toX(0)},${toY(points[0].v)} `+points.map((p,i)=>`L ${toX(i)},${toY(p.v)}`).join(" ")+` L ${toX(points.length-1)},${pad.t+h} L ${toX(0)},${pad.t+h} Z`;
  return(
    <svg width={width} height={height}>
      {fill&&<path d={fillD} fill={color} opacity={0.12}/>}
      <polyline points={poly} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round"/>
      {points.map((p,i)=><circle key={i} cx={toX(i)} cy={toY(p.v)} r={2} fill={color}/>)}
      <text x={pad.l} y={height-2} style={{ fontSize:8,fill:C.dim,fontFamily:"monospace" }}>{points[0]?.label||""}</text>
      <text x={width-pad.r} y={height-2} textAnchor="end" style={{ fontSize:8,fill:C.dim,fontFamily:"monospace" }}>{points[points.length-1]?.label||""}</text>
      <text x={pad.l-2} y={pad.t+8} textAnchor="end" style={{ fontSize:8,fill:C.dim,fontFamily:"monospace" }}>{Math.round(maxV)}</text>
      <text x={pad.l-2} y={pad.t+h} textAnchor="end" style={{ fontSize:8,fill:C.dim,fontFamily:"monospace" }}>{Math.round(minV)}</text>
    </svg>
  );
}

function AnalyticsPage({ accounts=[], tasks=[], stealthList=[], frontier=[], pool=[], teamUsers=[], currentUser, activeRole="AE" }) {
  // Quote cycling — new quote each page open
  const quote=useMemo(()=>{
    try{
      const idx=parseInt(localStorage.getItem("prospector_analytics_quote_idx")||"0")%ANALYTICS_QUOTES.length;
      localStorage.setItem("prospector_analytics_quote_idx",String((idx+1)%ANALYTICS_QUOTES.length));
      return ANALYTICS_QUOTES[idx];
    }catch{ return ANALYTICS_QUOTES[0]; }
  // eslint-disable-next-line
  },[]);

  // AE roster
  const aeRoster=useMemo(()=>{
    const me={id:"__me",name:currentUser?.name||"AE",role:currentUser?.role||"AE"};
    const others=teamUsers.filter(u=>(u.role==="AE"||u.role==="Admin"||u.role==="Owner")&&u.name!==me.name);
    return [me,...others];
  },[teamUsers,currentUser]);

  const [selectedAEs,setSelectedAEs]=useState(new Set(["__all"]));
  const [dropOpen,setDropOpen]=useState(false);
  const [heatHovered,setHeatHovered]=useState(null);

  const toggleAE=(id)=>{
    if(id==="__all"){setSelectedAEs(new Set(["__all"]));return;}
    setSelectedAEs(prev=>{
      const next=new Set(prev);
      next.delete("__all");
      next.has(id)?next.delete(id):next.add(id);
      if(next.size===0)next.add("__all");
      return next;
    });
  };

  const acctOwner=a=>a.claimedBy||a.uploadedBy||currentUser?.name||"AE";

  const filteredAccounts=useMemo(()=>{
    if(selectedAEs.has("__all"))return accounts;
    const names=new Set([...selectedAEs].map(id=>aeRoster.find(r=>r.id===id)?.name).filter(Boolean));
    return accounts.filter(a=>names.has(acctOwner(a)));
  },[accounts,selectedAEs,aeRoster]);

  const comparing=!selectedAEs.has("__all")&&selectedAEs.size>1;
  const todayStr=new Date().toISOString().split("T")[0];

  // Stat helpers
  const tierCounts=(accs)=>{
    const t={Gold:0,Silver:0,Tin:0,Slag:0};
    accs.forEach(a=>{if(t[a.tier]!==undefined)t[a.tier]++;});
    return t;
  };
  const freshnessOf=(accs)=>({
    fresh:   accs.filter(a=>staleDays(lastTouch(a))<30).length,
    warm:    accs.filter(a=>{const d=staleDays(lastTouch(a));return d>=30&&d<60;}).length,
    warning: accs.filter(a=>{const d=staleDays(lastTouch(a));return d>=60&&d<90;}).length,
    atRisk:  accs.filter(a=>staleDays(lastTouch(a))>=90).length,
  });
  const vertBreakdown=(accs,n=8)=>{
    const m={};
    accs.forEach(a=>{if(a.vert)m[a.vert]=(m[a.vert]||0)+1;});
    return Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,n);
  };
  const segBreakdown=(accs)=>{
    const m={};
    accs.forEach(a=>{const s=a.segment||inferSegment(a.vert)||"Unknown";m[s]=(m[s]||0)+1;});
    return Object.entries(m).sort((a,b)=>b[1]-a[1]);
  };

  // Capture daily snapshot for trend lines
  useEffect(()=>{
    if(!accounts.length)return;
    try{
      const snaps=JSON.parse(localStorage.getItem("prospector_analytics_snaps")||"[]");
      if(!snaps.find(s=>s.date===todayStr)){
        const tc=tierCounts(accounts);
        const fr=freshnessOf(accounts);
        const sl=JSON.parse(localStorage.getItem("prospector_stealth")||"[]");
        snaps.push({date:todayStr,total:accounts.length,gold:tc.Gold,silver:tc.Silver,atRisk:fr.atRisk,goldPct:accounts.length>0?tc.Gold/accounts.length*100:0,activePct:accounts.length>0?fr.fresh/accounts.length*100:0,stealth:sl.length});
        const cutoff=new Date(Date.now()-90*86400000).toISOString().split("T")[0];
        localStorage.setItem("prospector_analytics_snaps",JSON.stringify(snaps.filter(s=>s.date>=cutoff)));
      }
    }catch{}
  // eslint-disable-next-line
  },[accounts.length]);

  const analyticsSnaps=useMemo(()=>{try{return JSON.parse(localStorage.getItem("prospector_analytics_snaps")||"[]");}catch{return [];}},[]);

  const last30Days=useMemo(()=>{
    const days=[];
    for(let i=29;i>=0;i--){
      const d=new Date(Date.now()-i*86400000);
      days.push(d.toISOString().split("T")[0]);
    }
    return days;
  },[]);

  // Trend point builders
  const goldPctTrend=useMemo(()=>last30Days.map(date=>{
    const snap=analyticsSnaps.find(s=>s.date===date);
    return snap?{label:date.slice(5),v:snap.goldPct}:null;
  }).filter(Boolean),[last30Days,analyticsSnaps]);

  const atRiskTrendPts=useMemo(()=>last30Days.map(date=>{
    const snap=analyticsSnaps.find(s=>s.date===date);
    return snap?{label:date.slice(5),v:snap.atRisk}:null;
  }).filter(Boolean),[last30Days,analyticsSnaps]);

  const totalTrend=useMemo(()=>last30Days.map(date=>{
    const snap=analyticsSnaps.find(s=>s.date===date);
    return snap?{label:date.slice(5),v:snap.total}:null;
  }).filter(Boolean),[last30Days,analyticsSnaps]);

  const trendDir=(pts)=>{
    if(pts.length<2)return null;
    const recent=pts.slice(-7);
    if(recent.length<2)return null;
    const diff=recent[recent.length-1].v-recent[0].v;
    const pct=recent[0].v>0?(Math.abs(diff)/recent[0].v*100).toFixed(1):0;
    return {diff,pct,up:diff>=0};
  };
  const activePctTrend=useMemo(()=>last30Days.map(date=>{
    const snap=analyticsSnaps.find(s=>s.date===date);
    return snap?{label:date.slice(5),v:snap.activePct??null}:null;
  }).filter(x=>x&&x.v!==null),[last30Days,analyticsSnaps]);

  const stealthTrend=useMemo(()=>last30Days.map(date=>{
    const snap=analyticsSnaps.find(s=>s.date===date);
    return snap&&snap.stealth!=null?{label:date.slice(5),v:snap.stealth}:null;
  }).filter(Boolean),[last30Days,analyticsSnaps]);

  const goldTrend=trendDir(goldPctTrend);
  const atRiskTrend2=trendDir(atRiskTrendPts);
  const activeTrend=trendDir(activePctTrend);
  const stealthTrendDir=trendDir(stealthTrend);

  // Aggregate stats
  const total=filteredAccounts.length;
  const scored=filteredAccounts.filter(a=>a.score).length;
  const tiers=tierCounts(filteredAccounts);
  const fresh=freshnessOf(filteredAccounts);
  const stageCounts=DEAL_STAGES.map(s=>({...s,n:filteredAccounts.filter(a=>(a.stage||"Prospecting")===s.id).length}));
  const verts=vertBreakdown(filteredAccounts);
  const segs=segBreakdown(filteredAccounts);
  const vertMax=Math.max(...verts.map(v=>v[1]),1);
  const freshMax=Math.max(fresh.fresh,fresh.warm,fresh.warning,fresh.atRisk,1);

  const openTasks=tasks.filter(t=>t.status!=="Done");
  const overdue=openTasks.filter(t=>t.dueDate&&t.dueDate<todayStr).length;
  const doneTasks=tasks.filter(t=>t.status==="Done").length;
  const poolTiers={Gold:0,Silver:0,Tin:0,Slag:0,Unscored:0};
  pool.forEach(a=>{if(poolTiers[a.tier]!==undefined)poolTiers[a.tier]++;else poolTiers.Unscored++;});
  const stealthByStatus=STEALTH_STATUSES.map(s=>({s,n:stealthList.filter(x=>x.status===s).length}));

  // Momentum score
  const accsThisWeek=accounts.filter(a=>{const id=parseInt(a.id);return !isNaN(id)&&id>Date.now()-7*86400000;}).length;
  const goldPct=total>0?tiers.Gold/total*100:0;
  const freshPct=total>0?fresh.fresh/total*100:0;
  const riskPct=total>0?fresh.atRisk/total*100:0;
  const momentum=Math.min(100,Math.max(0,Math.round(goldPct*0.35+freshPct*0.25+Math.min(accsThisWeek*8,20)+Math.min(doneTasks*2,10)-riskPct*0.25)));
  const momColor=momentum>=60?C.green:momentum>=30?C.orange:C.red;
  const momLabel=momentum>=60?"↑ Gaining momentum":momentum>=30?"→ Holding steady":"↓ Losing momentum";

  // Activity heatmap — last 28 days
  const heatDays=useMemo(()=>{
    const days=[];
    for(let i=27;i>=0;i--){
      const d=new Date(Date.now()-i*86400000);
      const dateStr=d.toISOString().split("T")[0];
      const n=accounts.filter(a=>lastTouch(a)===dateStr).length;
      days.push({date:dateStr,n,label:`${d.toLocaleDateString("en-US",{month:"short",day:"numeric"})} — ${n} account${n!==1?"s":""} touched`});
    }
    return days;
  },[accounts]);
  const heatMax=Math.max(...heatDays.map(d=>d.n),1);

  // Use case distribution
  const ucCounts=useMemo(()=>{
    const UC_COLORS={onboarding:C.blue,credit:C.green,fraud:C.red,payments:C.gold,pfm:C.purple,openfinance:C.tin};
    const UC_LABELS={onboarding:"Onboarding",credit:"Credit",fraud:"Fraud",payments:"Payments",pfm:"Fin. Mgmt",openfinance:"Open Finance"};
    const m={};
    filteredAccounts.forEach(a=>(a.ucs||[]).forEach(uc=>{m[uc]=(m[uc]||0)+1;}));
    return Object.entries(m).map(([uc,n])=>({label:UC_LABELS[uc]||uc,n,color:UC_COLORS[uc]||C.dim})).sort((a,b)=>b.n-a.n);
  },[filteredAccounts]);

  // Product distribution
  const prodCounts=useMemo(()=>{
    const PC={Auth:C.gold,Link:C.blue,Signal:C.orange,IDV:C.purple,Transactions:C.green,Transfer:C.tin,Balance:C.silver,Monitor:C.red,Beacon:"#FF6B9D",Income:"#7DD4A5","Pay by Bank":C.gold};
    const m={};
    filteredAccounts.forEach(a=>(a.prods||[]).forEach(p=>{m[p]=(m[p]||0)+1;}));
    return Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,7).map(([p,n])=>({label:p,n,color:PC[p]||C.dim}));
  },[filteredAccounts]);

  // Confidence distribution
  const confCounts=useMemo(()=>[
    {label:"High",n:filteredAccounts.filter(a=>a.confidence==="High").length,color:C.green},
    {label:"Medium",n:filteredAccounts.filter(a=>a.confidence==="Medium").length,color:C.orange},
    {label:"Low",n:filteredAccounts.filter(a=>a.confidence==="Low").length,color:C.red},
  ],[filteredAccounts]);
  const highConfPct=scored>0?Math.round(confCounts[0].n/scored*100):0;

  // Per-AE data for comparison
  const aeData=useMemo(()=>{
    const selected=selectedAEs.has("__all")?aeRoster:aeRoster.filter(r=>selectedAEs.has(r.id));
    return selected.map((ae,i)=>{
      const accs=ae.id==="__all"?accounts:accounts.filter(a=>acctOwner(a)===ae.name);
      const t=tierCounts(accs);
      const f=freshnessOf(accs);
      const vts=vertBreakdown(accs,5);
      return {ae,accs,t,f,vts,color:AE_COLORS[i%AE_COLORS.length]};
    });
  },[accounts,selectedAEs,aeRoster]);

  const Stat=({label,value,sub,color=C.txt})=>(
    <div style={{ background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:"12px 16px" }}>
      <p style={{ ...mono,margin:"0 0 4px",fontSize:11,color:C.dim,textTransform:"uppercase",letterSpacing:"0.07em" }}>{label}</p>
      <p style={{ margin:"0 0 2px",fontSize:24,fontWeight:600,color,lineHeight:1 }}>{value}</p>
      {sub&&<p style={{ ...mono,margin:0,fontSize:11,color:C.dim }}>{sub}</p>}
    </div>
  );

  const Bar=({label,n,max,color,sub})=>(
    <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:6 }}>
      <span style={{ ...mono,fontSize:12,color:C.mut,width:110,flexShrink:0,textOverflow:"ellipsis",overflow:"hidden",whiteSpace:"nowrap" }}>{label}</span>
      <div style={{ flex:1,height:8,borderRadius:4,background:C.bg,overflow:"hidden" }}>
        <div style={{ width:`${(n/max)*100}%`,height:"100%",background:color,borderRadius:4,transition:"width 0.3s" }}/>
      </div>
      <span style={{ ...mono,fontSize:12,color,width:28,textAlign:"right",flexShrink:0 }}>{n}</span>
      {sub&&<span style={{ ...mono,fontSize:11,color:C.dim,flexShrink:0 }}>{sub}</span>}
    </div>
  );

  const dropLabel=selectedAEs.has("__all")?"All AEs":[...selectedAEs].map(id=>aeRoster.find(r=>r.id===id)?.name||id).join(", ");

  return(
    <div style={{ maxWidth:960 }}>
      {/* Manager Analytics — shown first when Manager role */}
      {activeRole==="Manager"&&<ManagerAnalytics accounts={accounts} tasks={tasks}/>}

      {/* Header + quote + AE selector */}
      <div style={{ display:"flex",alignItems:"flex-start",gap:16,marginBottom:20 }}>
        <div style={{ flex:1 }}>
          <h2 style={{ margin:"0 0 4px",fontSize:20,fontWeight:600,color:C.txt }}>Analytics</h2>
          <p style={{ ...mono,margin:0,fontSize:11,color:C.gold,fontStyle:"italic",maxWidth:580 }}>"{quote}"</p>
        </div>
        <div style={{ position:"relative",flexShrink:0 }}>
          <button onClick={()=>setDropOpen(o=>!o)}
            style={{ ...mono,fontSize:12,padding:"7px 14px",background:C.card,border:`1px solid ${dropOpen?C.gold:C.brd}`,color:C.txt,borderRadius:7,cursor:"pointer",display:"flex",alignItems:"center",gap:8,minWidth:160 }}>
            <span style={{ flex:1,textAlign:"left",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{dropLabel}</span>
            <span style={{ color:C.dim,fontSize:10 }}>{dropOpen?"▲":"▼"}</span>
          </button>
          {dropOpen&&(
            <div style={{ position:"absolute",top:"calc(100% + 4px)",right:0,zIndex:200,background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,minWidth:200,boxShadow:"0 8px 24px #000a",padding:"6px 0" }}
              onMouseLeave={()=>setDropOpen(false)}>
              <div onClick={()=>{toggleAE("__all");setDropOpen(false);}}
                style={{ display:"flex",alignItems:"center",gap:8,padding:"7px 14px",cursor:"pointer",background:selectedAEs.has("__all")?`${C.gold}14`:"transparent" }}
                onMouseEnter={e=>e.currentTarget.style.background=`${C.gold}0A`}
                onMouseLeave={e=>e.currentTarget.style.background=selectedAEs.has("__all")?`${C.gold}14`:"transparent"}>
                <span style={{ width:14,height:14,borderRadius:3,border:`1px solid ${selectedAEs.has("__all")?C.gold:C.brd}`,background:selectedAEs.has("__all")?C.gold:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>
                  {selectedAEs.has("__all")&&<span style={{ color:C.bg,fontSize:10,lineHeight:1 }}>✓</span>}
                </span>
                <span style={{ fontSize:13,color:selectedAEs.has("__all")?C.gold:C.txt }}>All AEs</span>
                <span style={{ ...mono,fontSize:11,color:C.dim,marginLeft:"auto" }}>{accounts.length}</span>
              </div>
              <div style={{ height:1,background:C.brd,margin:"4px 0" }}/>
              {aeRoster.map((ae,i)=>{
                const on=selectedAEs.has(ae.id);
                const col=AE_COLORS[i%AE_COLORS.length];
                const cnt=accounts.filter(a=>acctOwner(a)===ae.name).length;
                return(
                  <div key={ae.id} onClick={()=>toggleAE(ae.id)}
                    style={{ display:"flex",alignItems:"center",gap:8,padding:"7px 14px",cursor:"pointer",background:on?`${col}14`:"transparent" }}
                    onMouseEnter={e=>e.currentTarget.style.background=`${col}0A`}
                    onMouseLeave={e=>e.currentTarget.style.background=on?`${col}14`:"transparent"}>
                    <span style={{ width:14,height:14,borderRadius:3,border:`1px solid ${on?col:C.brd}`,background:on?col:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>
                      {on&&<span style={{ color:C.bg,fontSize:10,lineHeight:1 }}>✓</span>}
                    </span>
                    <div style={{ width:20,height:20,borderRadius:"50%",background:`${col}22`,border:`1px solid ${col}55`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:col,fontWeight:700,...mono,flexShrink:0 }}>{initials(ae.name)}</div>
                    <span style={{ fontSize:13,color:on?col:C.txt,flex:1 }}>{ae.name}</span>
                    <span style={{ ...mono,fontSize:11,color:C.dim }}>{cnt}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Comparison view */}
      {comparing&&(
        <div style={{ display:"grid",gridTemplateColumns:`repeat(${Math.min(aeData.length,3)},1fr)`,gap:10,marginBottom:16 }}>
          {aeData.map(({ae,accs,t,f,vts,color})=>(
            <div key={ae.id} style={{ background:C.card,border:`1px solid ${color}44`,borderRadius:10,padding:"14px 16px" }}>
              <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:12 }}>
                <div style={{ width:28,height:28,borderRadius:"50%",background:`${color}22`,border:`1px solid ${color}55`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color,fontWeight:700,...mono,flexShrink:0 }}>{initials(ae.name)}</div>
                <div>
                  <p style={{ margin:0,fontSize:13,fontWeight:600,color }}>{ae.name}</p>
                  <p style={{ ...mono,margin:0,fontSize:10,color:C.dim }}>{accs.length} accounts</p>
                </div>
                <span style={{ ...mono,fontSize:18,fontWeight:700,color,marginLeft:"auto" }}>{accs.length>0?Math.round(t.Gold/accs.length*100):0}<span style={{ fontSize:11,fontWeight:400 }}>% Gold</span></span>
              </div>
              <div style={{ height:5,borderRadius:3,display:"flex",overflow:"hidden",gap:1,marginBottom:8 }}>
                {["Gold","Silver","Tin","Slag"].map(tier=>(
                  <div key={tier} style={{ width:`${accs.length>0?(t[tier]/accs.length)*100:0}%`,background:TS[tier]?.c||C.dim }}/>
                ))}
              </div>
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,marginBottom:10 }}>
                {[["Gold",t.Gold,C.gold],["Silver",t.Silver,C.silver],["Active",f.fresh,C.green],["At Risk",f.atRisk,C.red]].map(([lb,n,c])=>(
                  <div key={lb} style={{ background:C.bg,borderRadius:5,padding:"5px 8px" }}>
                    <p style={{ ...mono,margin:"0 0 1px",fontSize:9,color:C.dim,textTransform:"uppercase" }}>{lb}</p>
                    <p style={{ margin:0,fontSize:16,fontWeight:600,color:c,lineHeight:1 }}>{n}</p>
                  </div>
                ))}
              </div>
              {vts.length>0&&(
                <div>
                  <p style={{ ...mono,margin:"0 0 5px",fontSize:9,color:C.dim,textTransform:"uppercase",letterSpacing:"0.07em" }}>Top verticals</p>
                  {vts.slice(0,4).map(([v,n])=>(
                    <div key={v} style={{ display:"flex",alignItems:"center",gap:6,marginBottom:3 }}>
                      <span style={{ ...mono,fontSize:10,color:VERT_C[v]||C.mut,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{v}</span>
                      <div style={{ width:40,height:4,borderRadius:2,background:C.sur,overflow:"hidden" }}>
                        <div style={{ width:`${(n/Math.max(...vts.map(x=>x[1]),1))*100}%`,height:"100%",background:VERT_C[v]||color }}/>
                      </div>
                      <span style={{ ...mono,fontSize:10,color:C.dim,width:14,textAlign:"right" }}>{n}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Stat cards — 5 wide */}
      <div style={{ display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:14 }}>
        <Stat label="Total accounts" value={total} sub={`${scored} scored`}/>
        <Stat label="Gold accounts"  value={tiers.Gold} sub={`${total>0?Math.round(tiers.Gold/total*100):0}% of book`} color={C.gold}/>
        <Stat label="Open tasks"     value={openTasks.length} sub={overdue>0?`${overdue} overdue`:`${doneTasks} done`} color={overdue>0?C.red:C.txt}/>
        <Stat label="Pool available" value={pool.length} sub={`${poolTiers.Gold} Gold`} color={C.tin}/>
        <div style={{ background:C.card,border:`1px solid ${momColor}44`,borderRadius:8,padding:"12px 16px" }}>
          <p style={{ ...mono,margin:"0 0 4px",fontSize:11,color:C.dim,textTransform:"uppercase",letterSpacing:"0.07em" }}>Momentum</p>
          <p style={{ margin:"0 0 2px",fontSize:24,fontWeight:600,color:momColor,lineHeight:1 }}>{momentum}</p>
          <p style={{ ...mono,margin:0,fontSize:11,color:momColor }}>{momLabel}</p>
        </div>
      </div>

      {/* Trend lines — row 1: 2 wide */}
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12 }}>
        {[
          {title:"Accounts Over Time",points:totalTrend,color:C.gold,fill:false,sub:`${total} total tracked`},
          {title:"Territory Gold %",points:goldPctTrend,color:C.gold,fill:true,sub:goldTrend?(goldTrend.up?`↑ +${goldTrend.pct}% this week`:`↓ -${goldTrend.pct}% this week`):null},
        ].map(({title,points,color,fill,sub})=>(
          <div key={title} style={{ background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:"14px 16px" }}>
            <p style={{ ...mono,margin:"0 0 8px",fontSize:11,fontWeight:500,color:C.mut,textTransform:"uppercase",letterSpacing:"0.07em" }}>{title}</p>
            <MiniLineChart points={points} color={color} width={360} height={72} fill={fill}/>
            {sub&&<p style={{ ...mono,margin:"4px 0 0",fontSize:10,color }}>{sub}</p>}
          </div>
        ))}
      </div>
      {/* Trend lines — row 2: 3 supporting */}
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:14 }}>
        {[
          {title:"At-Risk Count",points:atRiskTrendPts,color:C.red,fill:false,sub:atRiskTrend2?(atRiskTrend2.up===false?"↓ Good — at-risk decreasing":atRiskTrend2.diff===0?"→ Stable":"↑ At-risk accounts increasing"):null},
          {title:"Active Book %",points:activePctTrend,color:C.green,fill:true,sub:activeTrend?(activeTrend.up?`↑ +${activeTrend.pct}% — book warming up`:`↓ -${activeTrend.pct}% — going cold`):null},
          {title:"Stealth Pipeline",points:stealthTrend,color:C.purple,fill:false,sub:stealthTrendDir?(stealthTrendDir.up?`↑ +${stealthTrendDir.diff} this week`:`↓ ${Math.abs(stealthTrendDir.diff)} exited pipeline`):null},
        ].map(({title,points,color,fill,sub})=>(
          <div key={title} style={{ background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:"14px 16px" }}>
            <p style={{ ...mono,margin:"0 0 8px",fontSize:11,fontWeight:500,color:C.mut,textTransform:"uppercase",letterSpacing:"0.07em" }}>{title}</p>
            <MiniLineChart points={points} color={color} width={220} height={65} fill={fill}/>
            {sub&&<p style={{ ...mono,margin:"4px 0 0",fontSize:10,color }}>{sub}</p>}
          </div>
        ))}
      </div>

      {/* Tier + freshness donuts */}
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12 }}>
        <div style={{ background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:"14px 16px" }}>
          <p style={{ ...mono,margin:"0 0 12px",fontSize:11,fontWeight:500,color:C.mut,textTransform:"uppercase",letterSpacing:"0.07em" }}>Book by tier</p>
          <div style={{ display:"flex",gap:16,alignItems:"center" }}>
            <DonutChart
              data={["Gold","Silver","Tin","Slag"].map(t=>({label:t,n:tiers[t],color:TS[t]?.c||C.dim}))}
              centerText={total>0?`${Math.round(tiers.Gold/total*100)}%`:"—"} centerSub="Gold"
              size={130} thickness={22} showLegend={false}
            />
            <div style={{ flex:1 }}>
              {["Gold","Silver","Tin","Slag"].map(t=>(
                <Bar key={t} label={`${TS[t]?.i||""} ${t}`} n={tiers[t]} max={Math.max(...Object.values(tiers),1)} color={TS[t]?.c||C.dim} sub={total>0?`${Math.round(tiers[t]/total*100)}%`:""}/>
              ))}
            </div>
          </div>
        </div>
        <div style={{ background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:"14px 16px" }}>
          <p style={{ ...mono,margin:"0 0 12px",fontSize:11,fontWeight:500,color:C.mut,textTransform:"uppercase",letterSpacing:"0.07em" }}>Activity freshness</p>
          <div style={{ display:"flex",gap:16,alignItems:"center" }}>
            <DonutChart
              data={[{label:"Active <30d",n:fresh.fresh,color:C.green},{label:"Warm 30–60d",n:fresh.warm,color:C.blue},{label:"Warning 60–90d",n:fresh.warning,color:C.orange},{label:"At risk 90d+",n:fresh.atRisk,color:C.red}]}
              centerText={total>0?`${Math.round(fresh.fresh/total*100)}%`:"—"} centerSub="Active"
              size={130} thickness={22} showLegend={false}
            />
            <div style={{ flex:1 }}>
              <Bar label="Active  <30d"    n={fresh.fresh}   max={freshMax} color={C.green}/>
              <Bar label="Warm  30–60d"    n={fresh.warm}    max={freshMax} color={C.blue}/>
              <Bar label="Warning  60–90d" n={fresh.warning} max={freshMax} color={C.orange}/>
              <Bar label="At risk  90d+"   n={fresh.atRisk}  max={freshMax} color={C.red}/>
            </div>
          </div>
        </div>
      </div>

      {/* Use cases + products + confidence donuts */}
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:12 }}>
        <div style={{ background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:"14px 16px",display:"flex",flexDirection:"column",alignItems:"center" }}>
          <p style={{ ...mono,margin:"0 0 10px",fontSize:11,fontWeight:500,color:C.mut,textTransform:"uppercase",letterSpacing:"0.07em",alignSelf:"flex-start" }}>Use case distribution</p>
          <DonutChart data={ucCounts} centerText={`${ucCounts.reduce((s,d)=>s+d.n,0)}`} centerSub="use cases" size={140} thickness={22}/>
        </div>
        <div style={{ background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:"14px 16px",display:"flex",flexDirection:"column",alignItems:"center" }}>
          <p style={{ ...mono,margin:"0 0 10px",fontSize:11,fontWeight:500,color:C.mut,textTransform:"uppercase",letterSpacing:"0.07em",alignSelf:"flex-start" }}>Product distribution</p>
          <DonutChart data={prodCounts} centerText={`${prodCounts.reduce((s,d)=>s+d.n,0)}`} centerSub="identified" size={140} thickness={22}/>
        </div>
        <div style={{ background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:"14px 16px",display:"flex",flexDirection:"column",alignItems:"center" }}>
          <p style={{ ...mono,margin:"0 0 10px",fontSize:11,fontWeight:500,color:C.mut,textTransform:"uppercase",letterSpacing:"0.07em",alignSelf:"flex-start" }}>Assay confidence</p>
          <DonutChart data={confCounts} centerText={`${highConfPct}%`} centerSub="High conf." size={140} thickness={22}/>
        </div>
      </div>

      {/* Stage donut + verticals + segments donut */}
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:12 }}>
        <div style={{ background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:"14px 16px",display:"flex",flexDirection:"column",alignItems:"center" }}>
          <p style={{ ...mono,margin:"0 0 10px",fontSize:11,fontWeight:500,color:C.mut,textTransform:"uppercase",letterSpacing:"0.07em",alignSelf:"flex-start" }}>Pipeline stages</p>
          <DonutChart data={stageCounts.filter(s=>s.n>0).map(s=>({label:s.id,n:s.n,color:s.c||C.dim}))} centerText={`${total}`} centerSub="tracked" size={140} thickness={22}/>
        </div>
        <div style={{ background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:"14px 16px" }}>
          <p style={{ ...mono,margin:"0 0 10px",fontSize:11,fontWeight:500,color:C.mut,textTransform:"uppercase",letterSpacing:"0.07em" }}>Top verticals</p>
          {verts.map(([v,n])=>(
            <Bar key={v} label={v} n={n} max={vertMax} color={VERT_C[v]||C.mut}/>
          ))}
          {verts.length===0&&<p style={{ ...mono,fontSize:12,color:C.dim,margin:0 }}>No data</p>}
        </div>
        <div style={{ background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:"14px 16px",display:"flex",flexDirection:"column",alignItems:"center" }}>
          <p style={{ ...mono,margin:"0 0 10px",fontSize:11,fontWeight:500,color:C.mut,textTransform:"uppercase",letterSpacing:"0.07em",alignSelf:"flex-start" }}>GTM segments</p>
          <DonutChart data={segs.map(([s,n])=>({label:s,n,color:GTM_SEG_C[s]||C.mut}))} centerText={`${total}`} centerSub="accounts" size={140} thickness={22}/>
        </div>
      </div>

      {/* Activity heatmap */}
      <div style={{ background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:"14px 16px",marginBottom:12 }}>
        <p style={{ ...mono,margin:"0 0 6px",fontSize:11,fontWeight:500,color:C.mut,textTransform:"uppercase",letterSpacing:"0.07em" }}>Activity heatmap — last 28 days</p>
        <p style={{ ...mono,margin:"0 0 10px",fontSize:11,color:heatHovered?C.gold:C.dim }}>{heatHovered||"Hover a cell to see accounts touched that day"}</p>
        <div style={{ display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3,maxWidth:350 }}>
          {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d=>(
            <div key={d} style={{ ...mono,fontSize:9,color:C.dim,textAlign:"center",marginBottom:2 }}>{d}</div>
          ))}
          {heatDays.map((day,i)=>{
            const intensity=day.n>0?0.15+(day.n/heatMax)*0.85:0;
            const bg=day.n>0?`rgba(212,175,55,${intensity})`:C.sur;
            return(
              <div key={i}
                style={{ height:14,borderRadius:2,background:bg,border:`1px solid ${day.n>0?`${C.gold}44`:C.brd}`,cursor:day.n>0?"pointer":"default" }}
                onMouseEnter={()=>setHeatHovered(day.label)}
                onMouseLeave={()=>setHeatHovered(null)}
              />
            );
          })}
        </div>
        <div style={{ display:"flex",alignItems:"center",gap:5,marginTop:8 }}>
          <span style={{ ...mono,fontSize:9,color:C.dim }}>Less</span>
          {[0.1,0.3,0.5,0.7,0.95].map(v=>(
            <div key={v} style={{ width:10,height:10,borderRadius:2,background:`rgba(212,175,55,${v})` }}/>
          ))}
          <span style={{ ...mono,fontSize:9,color:C.dim }}>More</span>
        </div>
      </div>

      {/* Stealth + tasks */}
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
        {stealthList.length>0&&(
          <div style={{ background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:"14px 16px" }}>
            <p style={{ ...mono,margin:"0 0 10px",fontSize:11,fontWeight:500,color:C.mut,textTransform:"uppercase",letterSpacing:"0.07em" }}>Stealth pipeline — {stealthList.length}</p>
            {stealthByStatus.filter(x=>x.n>0).map(({s,n})=>(
              <Bar key={s} label={s} n={n} max={Math.max(...stealthByStatus.map(x=>x.n),1)} color={STEALTH_STATUS_C[s]||C.dim}/>
            ))}
          </div>
        )}
        {tasks.length>0&&(
          <div style={{ background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:"14px 16px" }}>
            <p style={{ ...mono,margin:"0 0 10px",fontSize:11,fontWeight:500,color:C.mut,textTransform:"uppercase",letterSpacing:"0.07em" }}>Tasks — {tasks.length}</p>
            {[["Open",openTasks.filter(t=>t.status==="Open").length,C.blue],
              ["In progress",openTasks.filter(t=>t.status==="In progress").length,C.orange],
              ["Done",doneTasks,C.green],
              ["Overdue",overdue,C.red]].map(([lb,n,col])=>(
              <Bar key={lb} label={lb} n={n} max={Math.max(tasks.length,1)} color={col}/>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default AnalyticsPage;
