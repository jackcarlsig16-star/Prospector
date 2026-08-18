import { useState, useRef, useCallback } from "react";
import { C, TIER_COLOR } from '../constants/colors';
import { mono } from '../constants/colors';
import { staleDays } from '../utils/staleness';

// ─── Rocky Card ──────────────────────────────────────────────────────────────
// Wraps any card with a jagged mountain-ridge top edge.
// Usage: <RockyCard style={{...}} variant={0|1|2|3}>...</RockyCard>
const ROCKY_RIDGES = [
  "0,14 10,9 18,12 25,5 33,10 40,3 48,8 55,12 62,4 70,9 78,2 85,7 92,11 100,4 108,8 116,12 123,5 130,2 138,9 145,13 152,5 160,10 168,2 175,8 182,12 190,4 198,9 205,6 212,11 220,3 228,8 235,13 242,5 250,10 258,2 265,7 272,11 280,4 288,9 295,12 300,14",
  "0,14 8,7 16,11 22,3 30,8 38,12 45,4 52,9 60,1 68,6 76,10 84,3 92,8 100,5 108,11 115,2 122,7 130,12 138,4 146,9 154,1 162,6 170,10 178,3 186,8 194,12 202,5 210,10 218,2 226,7 234,11 242,4 250,9 258,1 266,6 274,12 282,5 290,9 297,11 300,14",
  "0,14 12,6 20,10 28,2 36,8 44,13 50,5 58,9 66,1 74,7 82,11 90,3 98,8 106,12 114,4 122,9 130,2 138,6 146,11 154,4 162,8 170,1 178,6 186,12 194,5 202,10 210,3 218,7 226,12 234,4 242,9 250,2 258,7 266,11 274,4 282,9 290,6 298,11 300,14",
  "0,14 9,5 17,9 24,2 32,7 41,12 48,3 56,8 63,11 71,2 79,6 87,10 95,4 103,9 111,1 119,7 127,12 135,4 143,8 151,2 159,6 167,11 175,3 183,8 191,13 199,5 207,10 215,2 223,7 231,12 239,4 247,9 255,1 263,6 271,11 279,3 287,8 295,12 300,14",
];
function RockyCard({ children, style={}, variant=0, bgColor, borderColor }) {
  const bg  = bgColor     || C.card;
  const bdr = borderColor || C.brd;
  const pts = ROCKY_RIDGES[variant % ROCKY_RIDGES.length];
  return (
    <div style={{ position:"relative", marginTop:14, background:bg, border:`1px solid ${bdr}`, borderTop:"none", borderRadius:"0 0 8px 8px", ...style }}>
      <svg viewBox="0 0 300 14" preserveAspectRatio="none" style={{ position:"absolute", top:-14, left:-1, width:"calc(100% + 2px)", height:14, display:"block", pointerEvents:"none" }}>
        <polygon points={`${pts} 300,14 0,14`} fill={bg}/>
        <polyline points={pts} fill="none" stroke={bdr} strokeWidth="1"/>
      </svg>
      {children}
    </div>
  );
}

function MiniBar({ segments, height=6 }) {
  const total = segments.reduce((s,x)=>s+x.v,0);
  if(!total) return <div style={{ height, borderRadius:3, background:C.brd }}/>;
  return(
    <div style={{ height, borderRadius:3, overflow:"hidden", display:"flex", width:"100%" }}>
      {segments.filter(s=>s.v>0).map(s=>(
        <div key={s.label} style={{ width:`${(s.v/total)*100}%`, background:s.c, minWidth:s.v>0?2:0 }}/>
      ))}
    </div>
  );
}

function StatRow({ label, value, max, color, sub }) {
  return(
    <div style={{ marginBottom:8 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
        <span style={{ fontSize:13, color:C.txt }}>{label}</span>
        <span style={{ ...mono, fontSize:13, color:color||C.mut }}>{value}{sub&&<span style={{ fontSize:11, color:C.dim }}> {sub}</span>}</span>
      </div>
      {max>0&&<div style={{ height:3, borderRadius:2, background:C.brd }}><div style={{ height:"100%", width:`${Math.min((value/max)*100,100)}%`, background:color||C.mut, borderRadius:2 }}/></div>}
    </div>
  );
}

const GRADE_THRESHOLDS = [
  { min:93, grade:"A+", c:C.green }, { min:90, grade:"A",  c:C.green }, { min:87, grade:"A-", c:C.green },
  { min:83, grade:"B+", c:C.blue  }, { min:80, grade:"B",  c:C.blue  }, { min:77, grade:"B-", c:C.blue  },
  { min:70, grade:"C+", c:C.orange}, { min:65, grade:"C",  c:C.orange}, { min:60, grade:"C-", c:C.orange},
  { min:50, grade:"D+", c:C.red   }, { min:40, grade:"D",  c:C.red   }, { min:0,  grade:"F",  c:C.red   },
];

const BADGES=[
  // Territory
  {id:"gold_rush",       emoji:"🥇", name:"Gold Rush",                   cat:"Territory",   desc:"Word spread fast—your claim's struck color.",
   metric:"≥20% of territory is Gold tier",
   check:({accounts})=>{const a=accounts.filter(x=>x.score);return a.length>0&&accounts.filter(x=>x.tier==="Gold").length/accounts.length>=0.20;}},
  {id:"goldmember",      emoji:"👑", name:"Goldmember",                   cat:"Territory",   desc:"I love goooooold. A quarter of your book is pure.",
   metric:"≥25% of analyzed accounts are Gold",
   check:({accounts})=>{const a=accounts.filter(x=>x.score);return a.length>0&&accounts.filter(x=>x.tier==="Gold").length/a.length>=0.25;}},
  {id:"greenhorn",       emoji:"⛏️", name:"Greenhorn Prospector",         cat:"Territory",   desc:"Picked up a pan and started sifting dirt.",
   metric:"100+ accounts analyzed",
   check:({accounts})=>accounts.filter(a=>a.analyzed||a.score).length>=100},
  {id:"strike_pay_dirt", emoji:"💎", name:"Strike Pay Dirt",              cat:"Territory",   desc:"Hit a vein and staked it before the vultures circled.",
   metric:"Claim 1 account from the pool",
   check:({stats})=>(stats.accounts_claimed||0)>=1},
  {id:"cartographer",    emoji:"🗺️", name:"Cartographer of the Frontier", cat:"Territory",   desc:"Every inch of your territory's charted and marked.",
   metric:"All 10+ accounts have use cases tagged",
   check:({accounts})=>accounts.length>=10&&accounts.every(a=>a.ucs&&a.ucs.length>0)},
  {id:"clean_sweep",     emoji:"🧹", name:"Clean Sweep",                  cat:"Territory",   desc:"Cleared the dead rock—now it's all shine.",
   metric:"Remove 25 Slag accounts",
   check:({stats})=>(stats.slag_removed||0)>=25},
  // Activity
  {id:"on_it",           emoji:"⚡", name:"On It Like Daybreak",          cat:"Activity",    desc:"You don't wait for trouble—you ride out to meet it.",
   metric:"10+ accounts, none stale ≥90 days",
   check:({accounts})=>accounts.length>=10&&accounts.filter(a=>staleDays(a.last)>=90).length===0},
  {id:"hot_streak",      emoji:"🔥", name:"Hot Streak",                   cat:"Activity",    desc:"That pan's running hot—nothing but color.",
   metric:"5+ Gold accounts in Engaged stage",
   check:({accounts})=>accounts.filter(a=>a.tier==="Gold"&&(a.stage||"")==="Engaged").length>=5},
  {id:"outpost_operator",emoji:"📬", name:"Outpost Operator",             cat:"Activity",    desc:"Messages flying out like supply runs to the frontier.",
   metric:"Send 10+ emails from Prospector",
   check:({stats})=>(stats.emails_sent||0)>=10},
  {id:"trail_boss",      emoji:"🤝", name:"Trail Boss",                   cat:"Activity",    desc:"Got your crew moving in the right direction.",
   metric:"Assign 5+ accounts to BDR",
   check:({stats})=>(stats.tasks_assigned_to_bdr||0)>=5},
  {id:"sharpshooter",    emoji:"🎯", name:"Sharpshooter",                 cat:"Activity",    desc:"Called your shot and struck true.",
   metric:"Trigger 1+ reassay upgrade",
   check:({stats})=>(stats.reassay_upgrades||0)>=1},
  // Deal
  {id:"first_nugget",    emoji:"💰", name:"First Nugget",                 cat:"Deal",        desc:"Your first piece of real gold—fits right in the palm.",
   metric:"Mark 1 account as Closed Won",
   check:({accounts,winsLog})=>accounts.some(a=>(a.stage||"")==="Closed Won")||(winsLog||[]).length>0},
  {id:"vein_runner",     emoji:"📈", name:"Vein Runner",                  cat:"Deal",        desc:"You found the vein and kept digging.",
   metric:"Territory grade improves 2+ steps in 30 days",
   check:({snapshots})=>{
     if(!snapshots||snapshots.length<2)return false;
     const order=["F","D","D+","C-","C","C+","B-","B","B+","A-","A","A+"];
     const monthAgo=Date.now()-30*86400000;
     const old=snapshots.find(s=>{try{return new Date(s.date).getTime()<=monthAgo;}catch{return false;}});
     const cur=snapshots[snapshots.length-1];
     if(!old||!cur)return false;
     return order.indexOf(cur.grade)-order.indexOf(old.grade)>=2;
   }},
  {id:"mother_lode",     emoji:"🏆", name:"Mother Lode",                  cat:"Deal",        desc:"Struck it big—this one'll be talked about in camp.",
   metric:"Close a Claim Jumper account as Won",
   check:({accounts,winsLog})=>accounts.some(a=>a.claimedFrom==="claimjumper"&&(a.stage||"")==="Closed Won")||(winsLog||[]).some(w=>w.claimJumper)},
  {id:"eagle_eye",       emoji:"👁️", name:"Eagle Eye",                   cat:"Deal",        desc:"Trusted your gut and proved the map wrong.",
   metric:"5+ manual tier overrides",
   check:({stats})=>(stats.manual_overrides||0)>=5},
  // Leaderboard (locked solo)
  {id:"baron",           emoji:"🌋", name:"Baron of the Claim",           cat:"Leaderboard", desc:"Runs the richest ground in camp.",           metric:"Leaderboard — unlocks with multi-user",      check:()=>false},
  {id:"master_assayer",  emoji:"⚗️", name:"Master Assayer",              cat:"Leaderboard", desc:"Knows gold from gravel at a glance.",         metric:"Leaderboard — unlocks with multi-user",      check:()=>false},
  {id:"frontier_scout",  emoji:"🚀", name:"Frontier Scout",               cat:"Leaderboard", desc:"Always first over the ridge, finding fresh ground.", metric:"Leaderboard — unlocks with multi-user", check:()=>false},
  // Product
  {id:"contributor",     emoji:"🏅", name:"Contributor",                  cat:"Product",     desc:"Your idea made it into the product. The camp is better for it.",
   metric:"Have a Golden Nugget shipped by Admin",
   check:({nuggets,activeUser})=>(nuggets||[]).some(n=>n.status==="shipped"&&(n.realName||n.submittedBy)===(activeUser?.name||""))},
];

// ─── Badge tooltip wrapper ────────────────────────────────────────────────────
function BadgeTip({ badge, earned, children }) {
  const [tipPos, setTipPos] = useState(null);
  const ref = useRef(null);
  const TIP_W = 200;
  const handleEnter = () => {
    if(!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    let x = Math.round(r.left + r.width / 2 - TIP_W / 2);
    // clamp to viewport
    x = Math.max(8, Math.min(x, window.innerWidth - TIP_W - 8));
    setTipPos({ x, y: Math.round(r.top) });
  };
  return (
    <div ref={ref} style={{ display:"inline-block" }}
      onMouseEnter={handleEnter} onMouseLeave={()=>setTipPos(null)}>
      {children}
      {tipPos&&(
        <div style={{ position:"fixed", left:tipPos.x, top:tipPos.y - 8, transform:"translateY(-100%)",
          width:TIP_W, background:C.card, border:`1px solid ${earned?C.gold+"66":C.brd}`, borderRadius:7,
          padding:"9px 12px", zIndex:9999, pointerEvents:"none", boxShadow:"0 4px 20px #000a" }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:5 }}>
            <span style={{ fontSize:18, lineHeight:1 }}>{badge.emoji}</span>
            <span style={{ ...mono, fontSize:11, fontWeight:600, color:earned?C.gold:C.dim }}>{badge.name}</span>
          </div>
          <p style={{ ...mono, margin:0, fontSize:10, color:C.mut, lineHeight:1.5, fontStyle:"italic" }}>{badge.desc}</p>
          {badge.metric&&<p style={{ ...mono, margin:"6px 0 0", fontSize:10, color:earned?C.green:C.txt, lineHeight:1.4, paddingTop:5, borderTop:`1px solid ${C.brd}` }}>🎯 {badge.metric}</p>}
        </div>
      )}
    </div>
  );
}

// ─── Badge toast ──────────────────────────────────────────────────────────────
function BadgeToast({ badge, onDismiss }) {
  if(!badge) return null;
  return (
    <div onClick={onDismiss} style={{ position:"fixed", bottom:24, right:24, zIndex:2000, cursor:"pointer",
      background:C.card, border:`1px solid ${C.gold}66`, borderRadius:10, padding:"12px 16px",
      boxShadow:"0 4px 24px #0008", display:"flex", alignItems:"flex-start", gap:12, maxWidth:340,
      animation:"badgeSlideIn 0.35s cubic-bezier(0.34,1.56,0.64,1)" }}>
      <style>{`@keyframes badgeSlideIn{from{transform:translateX(120%);opacity:0;}to{transform:translateX(0);opacity:1;}}`}</style>
      <span style={{ fontSize:26, lineHeight:1, flexShrink:0 }}>{badge.emoji}</span>
      <div>
        <p style={{ ...mono, margin:"0 0 3px", fontSize:12, fontWeight:600, color:C.gold }}>Badge earned: {badge.name}</p>
        <p style={{ ...mono, margin:0, fontSize:11, color:C.mut, lineHeight:1.5 }}>{badge.desc}</p>
      </div>
    </div>
  );
}

// ─── Diamond token helpers ────────────────────────────────────────────────────
const getQuarterKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-Q${Math.ceil((now.getMonth()+1)/3)}`;
};
const getQuarterEnd = () => {
  const now = new Date();
  const endMonth = Math.ceil((now.getMonth()+1)/3) * 3;
  return new Date(now.getFullYear(), endMonth, 0); // last day of quarter
};

// ─── Profile panel ────────────────────────────────────────────────────────────
function ProfilePanel({ user, accounts=[], tasks=[], snapshots=[], stats={}, earnedBadges=[], score=0, grade="—", gradeColor=C.dim, diamonds={quarter:getQuarterKey(),log:[]}, winsLog=[], onClose }) {
  const [sfUrl, setSfUrl]     = useState(()=>{ try{return localStorage.getItem("prospector_sfdc_report_url")||"";}catch{return "";} });
  const [sfEdit, setSfEdit]   = useState(false);
  const [sfInput, setSfInput] = useState("");
  const saveSf = () => { const v=sfInput.trim(); localStorage.setItem("prospector_sfdc_report_url",v); setSfUrl(v); setSfEdit(false); };

  const analyzed    = accounts.filter(a=>a.analyzed||a.score).length;
  const goldFound   = accounts.filter(a=>a.tier==="Gold").length;
  const tasksDone   = tasks.filter(t=>t.status==="Done").length;
  const claimed     = stats.accounts_claimed||0;
  const emailsSent  = stats.emails_sent||0;
  const slagRemoved = stats.slag_removed||0;
  const userInitials= (user?.name||"?").split(" ").filter(Boolean).map(w=>w[0]).join("").toUpperCase().slice(0,2) || "?";
  const cats        = ["Territory","Activity","Deal","Leaderboard"];

  // Collapse state
  const [openStats,    setOpenStats]    = useState(true);
  const [openDiamonds, setOpenDiamonds] = useState(true);
  const [openWins,     setOpenWins]     = useState(true);
  const [openBadges,   setOpenBadges]   = useState(true);

  // Display settings
  const [showSettings, setShowSettings] = useState(false);
  const [displayMode, setDisplayMode] = useState(()=>{
    try{return JSON.parse(localStorage.getItem("prospector_prefs")||"{}").displayMode||"terminal";}catch{return "terminal";}
  });
  const applyDisplayMode = (mode) => {
    setDisplayMode(mode);
    try{
      const prefs=JSON.parse(localStorage.getItem("prospector_prefs")||"{}");
      localStorage.setItem("prospector_prefs",JSON.stringify({...prefs,displayMode:mode}));
      if(mode==="straight_shooter") document.body.classList.add("mode-straight-shooter");
      else document.body.classList.remove("mode-straight-shooter");
    }catch{}
  };

  // Avatar + company logo
  const [avatarImage, setAvatarImage] = useState(()=>{ try{return localStorage.getItem("prospector_img_avatarImage")||JSON.parse(localStorage.getItem("prospector_prefs")||"{}").avatarImage||null;}catch{return null;} });
  const [companyLogo, setCompanyLogo] = useState(()=>{ try{return localStorage.getItem("prospector_img_companyLogo")||JSON.parse(localStorage.getItem("prospector_prefs")||"{}").companyLogo||null;}catch{return null;} });
  const avatarInputRef = useRef(null);
  const logoInputRef   = useRef(null);
  const saveImagePref = useCallback((key, base64) => {
    try{
      const storageKey = `prospector_img_${key}`;
      if (base64) {
        localStorage.setItem(storageKey, base64);
      } else {
        localStorage.removeItem(storageKey);
      }
      // Also clear any legacy copy from prospector_prefs to free space
      try{
        const prefs=JSON.parse(localStorage.getItem("prospector_prefs")||"{}");
        if (prefs[key] !== undefined) { delete prefs[key]; localStorage.setItem("prospector_prefs",JSON.stringify(prefs)); }
      }catch{}
      window.dispatchEvent(new CustomEvent('prospector_prefs_change'));
    }catch(e){ console.error("saveImagePref failed:", e.message); }
  }, []);
  const handleAvatarUpload = (e) => {
    const file = e.target.files?.[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { const b64=ev.target.result; setAvatarImage(b64); saveImagePref("avatarImage",b64); };
    reader.readAsDataURL(file);
    e.target.value="";
  };
  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { const b64=ev.target.result; setCompanyLogo(b64); saveImagePref("companyLogo",b64); };
    reader.readAsDataURL(file);
    e.target.value="";
  };

  // Diamond state (local to panel)
  const [commCheck, setCommCheck] = useState("");
  const [showDiamondLog, setShowDiamondLog] = useState(false);
  const diamondLog = diamonds.log || [];
  const totalDiamonds = diamondLog.reduce((s,e)=>s+e.amount,0);
  const DIAMOND_PCT_PER = 0.5; // 0.5% boost per diamond
  const boostPct = totalDiamonds * DIAMOND_PCT_PER;
  const commNum = parseFloat(commCheck.replace(/[^0-9.]/g,"")) || 0;
  const boostDollars = commNum * boostPct / 100;
  // Quarter countdown
  const quarterEnd = getQuarterEnd();
  const daysLeft = Math.max(0, Math.ceil((quarterEnd - new Date()) / 86400000));
  const qLabel = diamonds.quarter || getQuarterKey();

  return (
    <div style={{ position:"fixed", inset:0, zIndex:1000 }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ position:"absolute", left:0, top:0, bottom:0, width:360, background:C.bg, borderRight:`1px solid ${C.brd}`, overflowY:"auto", display:"flex", flexDirection:"column", boxShadow:"4px 0 32px #0008" }}>

        {/* Header */}
        <div style={{ padding:"20px 20px 16px", borderBottom:`1px solid ${C.brd}`, flexShrink:0 }}>
          {/* Company logo */}
          {companyLogo && (
            <div style={{ marginBottom:14, display:"flex", justifyContent:"center" }}>
              <img src={companyLogo} alt="Company" style={{ maxHeight:40, maxWidth:"100%", objectFit:"contain" }}/>
            </div>
          )}
          <div style={{ display:"flex", alignItems:"flex-start", gap:14, marginBottom:14 }}>
            {/* Avatar — click to upload */}
            <div style={{ position:"relative", flexShrink:0, cursor:"pointer" }} onClick={()=>avatarInputRef.current?.click()} title="Upload photo">
              <input ref={avatarInputRef} type="file" accept="image/*" style={{ display:"none" }} onChange={handleAvatarUpload}/>
              {avatarImage
                ? <img src={avatarImage} alt="" style={{ width:52, height:52, borderRadius:"50%", objectFit:"contain", border:`2px solid ${C.goldBdr}` }}/>
                : <div style={{ width:52, height:52, borderRadius:"50%", background:C.goldBg, border:`2px solid ${C.goldBdr}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, fontWeight:700, color:C.gold, ...mono }}>{userInitials}</div>
              }
              <div style={{ position:"absolute", inset:0, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", background:"#0006", opacity:0, transition:"opacity 0.15s" }}
                onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=0}>
                <span style={{ fontSize:14 }}>📷</span>
              </div>
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <p style={{ margin:"0 0 2px", fontSize:17, fontWeight:600, color:C.txt }}>{user?.name||"AE"}</p>
              <p style={{ ...mono, margin:"0 0 8px", fontSize:12, color:C.mut }}>{user?.role||"AE"} · {(user?.company||"Prospector").toUpperCase()}</p>
              {sfEdit
                ? <div style={{ display:"flex", gap:5 }}>
                    <input autoFocus value={sfInput} onChange={e=>setSfInput(e.target.value)}
                      onKeyDown={e=>{if(e.key==="Enter")saveSf();if(e.key==="Escape"){setSfEdit(false);setSfInput(sfUrl);}}}
                      placeholder="https://your-sfdc-report-url"
                      style={{ ...mono, fontSize:11, flex:1, padding:"4px 8px", background:C.sur, border:`1px solid ${C.blue}`, borderRadius:4, color:C.txt, outline:"none" }}/>
                    <button onClick={saveSf} style={{ ...mono, fontSize:11, padding:"4px 10px", background:`${C.blue}18`, border:`1px solid ${C.blue}44`, borderRadius:4, color:C.blue, cursor:"pointer" }}>Save</button>
                    <button onClick={()=>{setSfEdit(false);setSfInput(sfUrl);}} style={{ ...mono, fontSize:11, padding:"4px 8px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:4, color:C.dim, cursor:"pointer" }}>✕</button>
                  </div>
                : <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                    {sfUrl
                      ? <a href={sfUrl} target="_blank" rel="noopener noreferrer" style={{ ...mono, fontSize:11, color:C.blue, textDecoration:"none", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:210 }}>☁ SF Report ↗</a>
                      : <span style={{ ...mono, fontSize:11, color:C.dim }}>No SFDC report linked</span>
                    }
                    <button onClick={()=>{setSfInput(sfUrl);setSfEdit(true);}} style={{ ...mono, fontSize:10, padding:"2px 7px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:3, color:C.dim, cursor:"pointer" }}>edit</button>
                  </div>
              }
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:6, flexShrink:0 }}>
              <button onClick={onClose} style={{ background:"transparent", border:"none", color:C.dim, fontSize:16, cursor:"pointer", lineHeight:1, padding:0 }}>✕</button>
              <button onClick={()=>setShowSettings(s=>!s)} title="Display settings"
                style={{ background:showSettings?`${C.gold}18`:"transparent", border:showSettings?`1px solid ${C.gold}44`:"none",
                  color:showSettings?C.gold:C.dim, fontSize:14, cursor:"pointer", lineHeight:1, padding:"2px 3px", borderRadius:4 }}>⚙</button>
            </div>
          </div>
          {/* Display settings panel */}
          {showSettings && (
            <div style={{ marginBottom:12, padding:"12px 14px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:7 }}>
              {/* Display mode picker hidden — Terminal is the only supported mode.
                  applyDisplayMode + CSS class kept intact for any persisted prefs. */}
              {/* Company logo upload */}
              <p style={{ ...mono, margin:"0 0 8px", fontSize:11, color:C.mut, textTransform:"uppercase", letterSpacing:"0.07em" }}>Company logo</p>
              <input ref={logoInputRef} type="file" accept="image/*" style={{ display:"none" }} onChange={handleLogoUpload}/>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                {companyLogo
                  ? <img src={companyLogo} alt="Logo" style={{ height:28, maxWidth:100, objectFit:"contain", border:`1px solid ${C.brd}`, borderRadius:4, padding:3, background:C.sur }}/>
                  : <div style={{ height:28, width:80, border:`1px dashed ${C.brd}`, borderRadius:4, display:"flex", alignItems:"center", justifyContent:"center" }}>
                      <span style={{ fontSize:10, color:C.dim }}>none</span>
                    </div>
                }
                <button onClick={()=>logoInputRef.current?.click()}
                  style={{ ...mono, fontSize:11, padding:"4px 10px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:4, color:C.mut, cursor:"pointer" }}>
                  {companyLogo ? "Replace" : "Upload"}
                </button>
                {companyLogo && (
                  <button onClick={()=>{ setCompanyLogo(null); saveImagePref("companyLogo",null); }}
                    style={{ ...mono, fontSize:11, padding:"4px 8px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:4, color:C.dim, cursor:"pointer" }}>✕</button>
                )}
              </div>
            </div>
          )}
          {/* Grade */}
          <div style={{ display:"flex", alignItems:"center", gap:14, padding:"10px 14px", background:C.card, border:`1px solid ${gradeColor}33`, borderRadius:7 }}>
            <span style={{ ...mono, fontSize:34, fontWeight:700, color:gradeColor, lineHeight:1 }}>{grade}</span>
            <div>
              <p style={{ ...mono, margin:"0 0 1px", fontSize:10, color:C.mut, textTransform:"uppercase", letterSpacing:"0.07em" }}>Territory Grade</p>
              <p style={{ ...mono, margin:0, fontSize:12, color:gradeColor }}>{score}/100 pts</p>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div style={{ borderBottom:`1px solid ${C.brd}`, flexShrink:0 }}>
          <button onClick={()=>setOpenStats(o=>!o)} style={{ width:"100%", display:"flex", alignItems:"center", gap:6, padding:"12px 20px", background:"transparent", border:"none", cursor:"pointer", textAlign:"left" }}>
            <span style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.09em", flex:1 }}>Territory Stats</span>
            <span style={{ ...mono, fontSize:10, color:C.dim }}>{openStats?"▾":"▸"}</span>
          </button>
          {openStats && (
            <div style={{ padding:"0 20px 14px" }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:7 }}>
                {[["Analyzed",analyzed,C.blue],["Gold found",goldFound,C.gold],["Slag removed",slagRemoved,C.mut],["Tasks done",tasksDone,C.green],["Emails sent",emailsSent,C.purple],["Claimed",claimed,C.tin]].map(([lbl,val,c])=>(
                  <div key={lbl} style={{ background:C.sur, borderRadius:6, padding:"7px 9px" }}>
                    <p style={{ ...mono, margin:"0 0 2px", fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.05em", lineHeight:1.3 }}>{lbl}</p>
                    <p style={{ ...mono, margin:0, fontSize:20, fontWeight:600, color:c }}>{val}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Diamonds */}
        <div style={{ borderBottom:`1px solid ${C.brd}`, flexShrink:0 }}>
          <button onClick={()=>setOpenDiamonds(o=>!o)} style={{ width:"100%", display:"flex", alignItems:"center", gap:6, padding:"12px 20px", background:"transparent", border:"none", cursor:"pointer", textAlign:"left" }}>
            <span style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.09em", flex:1 }}>Diamonds</span>
            <span style={{ fontSize:15, lineHeight:1 }}>💎</span>
            <span style={{ ...mono, fontSize:13, color:"#5bc8f5", fontWeight:700 }}>{totalDiamonds}</span>
            <span style={{ ...mono, fontSize:10, color:C.dim, marginLeft:6 }}>{qLabel}</span>
            <span style={{ ...mono, fontSize:10, color:C.dim, marginLeft:8 }}>{openDiamonds?"▾":"▸"}</span>
          </button>
          {openDiamonds && (
            <div style={{ padding:"0 20px 14px" }}>
              {/* Quarter countdown */}
              <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:10, padding:"6px 10px", background:daysLeft<=14?`${C.red}10`:`${C.blue}08`, border:`1px solid ${daysLeft<=14?C.red+"33":C.brd}`, borderRadius:6 }}>
                <span style={{ ...mono, fontSize:10, color:daysLeft<=14?C.red:C.dim }}>
                  {daysLeft<=14?"⚠ ":""}{daysLeft} days until diamonds reset
                </span>
                {totalDiamonds > 0 && daysLeft <= 14 && (
                  <span style={{ ...mono, fontSize:10, color:C.red, marginLeft:"auto" }}>use them!</span>
                )}
              </div>

              {/* Commission calculator */}
              <div style={{ background:C.sur, borderRadius:7, padding:"10px 12px", marginBottom:8 }}>
                <p style={{ ...mono, margin:"0 0 8px", fontSize:10, color:"#5bc8f5", fontWeight:600 }}>💎 Diamond Value</p>
                <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6 }}>
                  <span style={{ ...mono, fontSize:11, color:C.dim }}>My commission check:</span>
                  <div style={{ display:"flex", alignItems:"center", flex:1, background:C.card, border:`1px solid ${C.brd}`, borderRadius:4, overflow:"hidden" }}>
                    <span style={{ ...mono, fontSize:11, color:C.dim, padding:"3px 6px", borderRight:`1px solid ${C.brd}` }}>$</span>
                    <input value={commCheck} onChange={e=>setCommCheck(e.target.value)} placeholder="0"
                      style={{ ...mono, fontSize:11, flex:1, padding:"3px 6px", background:"transparent", border:"none", color:C.txt, outline:"none", width:80 }}/>
                  </div>
                </div>
                {commNum > 0 ? (
                  <div style={{ padding:"8px 10px", background:`#5bc8f508`, border:`1px solid #5bc8f533`, borderRadius:5 }}>
                    <p style={{ ...mono, margin:"0 0 4px", fontSize:11, color:"#5bc8f5" }}>
                      Your {totalDiamonds} diamonds = <strong>{boostPct.toFixed(1)}% boost</strong> = <strong style={{ color:C.green }}>${boostDollars.toLocaleString("en-US",{maximumFractionDigits:0})} additional</strong>
                    </p>
                    <p style={{ ...mono, margin:0, fontSize:9, color:C.dim, fontStyle:"italic" }}>Pending comp team approval — talk to your manager</p>
                  </div>
                ) : (
                  <p style={{ ...mono, margin:0, fontSize:10, color:C.dim }}>Enter your commission check to see your diamond value</p>
                )}
              </div>

              {/* How diamonds are earned */}
              <div style={{ marginBottom:8 }}>
                <p style={{ ...mono, margin:"0 0 5px", fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>How to earn</p>
                {[
                  ["+1","Dormant batch upload with 3+ Gold accounts"],
                  ["+2","Territory grade reaches B"],
                  ["+5","Territory grade reaches A"],
                  ["+3","Close a Claim Jumper account as Won"],
                  ["+1","Golden Nugget idea shipped by admin"],
                  ["+1","Algorithm override confirmed (Slag→Gold)"],
                  ["+2","All Gold/Silver accounts touched in 90 days"],
                ].map(([amt,desc])=>(
                  <div key={desc} style={{ display:"flex", gap:8, alignItems:"baseline", marginBottom:2 }}>
                    <span style={{ ...mono, fontSize:10, color:"#5bc8f5", fontWeight:600, flexShrink:0, minWidth:22 }}>{amt}</span>
                    <span style={{ ...mono, fontSize:10, color:C.mut }}>{desc}</span>
                  </div>
                ))}
              </div>

              {/* Diamond log toggle */}
              {diamondLog.length > 0 && (
                <div>
                  <button onClick={()=>setShowDiamondLog(o=>!o)}
                    style={{ ...mono, fontSize:10, background:"transparent", border:`1px solid ${C.brd}`, borderRadius:4, padding:"3px 9px", color:C.dim, cursor:"pointer" }}>
                    {showDiamondLog?"▾ Hide":"▸ Show"} Diamond Log ({diamondLog.length} events)
                  </button>
                  {showDiamondLog && (
                    <div style={{ marginTop:8, maxHeight:200, overflowY:"auto" }}>
                      {diamondLog.map(e=>(
                        <div key={e.id} style={{ display:"flex", gap:8, alignItems:"baseline", padding:"4px 0", borderBottom:`1px solid ${C.brd}22` }}>
                          <span style={{ ...mono, fontSize:11, color:"#5bc8f5", fontWeight:700, flexShrink:0 }}>+{e.amount}💎</span>
                          <span style={{ ...mono, fontSize:10, color:C.txt, flex:1 }}>{e.reason}</span>
                          <span style={{ ...mono, fontSize:9, color:C.dim, flexShrink:0 }}>{new Date(e.earnedAt).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Closed Won History */}
        {winsLog.length > 0 && (
          <div style={{ borderBottom:`1px solid ${C.brd}`, flexShrink:0 }}>
            <button onClick={()=>setOpenWins(o=>!o)} style={{ width:"100%", display:"flex", alignItems:"center", gap:6, padding:"12px 20px", background:"transparent", border:"none", cursor:"pointer", textAlign:"left" }}>
              <span style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.09em", flex:1 }}>Closed Won History</span>
              <span style={{ ...mono, fontSize:10, color:C.gold, fontWeight:600 }}>{winsLog.length} win{winsLog.length!==1?"s":""}</span>
              <span style={{ ...mono, fontSize:10, color:C.dim, marginLeft:8 }}>{openWins?"▾":"▸"}</span>
            </button>
            {openWins && (
              <div style={{ padding:"0 20px 14px" }}>
                <p style={{ ...mono, margin:"0 0 8px", fontSize:9, color:C.dim+"99", fontStyle:"italic" }}>Logged at time of close — persists even after SF reassignment</p>
                <div style={{ display:"flex", flexDirection:"column", gap:4, maxHeight:180, overflowY:"auto" }}>
                  {winsLog.map(w=>(
                    <div key={w.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"5px 8px", background:C.sur, borderRadius:5 }}>
                      <span style={{ fontSize:13, lineHeight:1 }}>{w.claimJumper?"🎯":"🏅"}</span>
                      <span style={{ ...mono, fontSize:11, color:C.txt, flex:1 }}>{w.accountName}</span>
                      {w.tier&&<span style={{ ...mono, fontSize:9, padding:"1px 6px", background:`${TIER_COLOR[w.tier]||C.dim}22`, border:`1px solid ${TIER_COLOR[w.tier]||C.dim}44`, color:TIER_COLOR[w.tier]||C.mut, borderRadius:3 }}>{w.tier}</span>}
                      {w.closedAt&&<span style={{ ...mono, fontSize:9, color:C.dim, flexShrink:0 }}>{new Date(w.closedAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"2-digit"})}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Badges */}
        <div style={{ flex:1 }}>
          <button onClick={()=>setOpenBadges(o=>!o)} style={{ width:"100%", display:"flex", alignItems:"center", gap:6, padding:"12px 20px", background:"transparent", border:"none", cursor:"pointer", textAlign:"left" }}>
            <span style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.09em", flex:1 }}>Badges</span>
            <span style={{ ...mono, fontSize:10, color:C.gold, fontWeight:600 }}>{earnedBadges.length}/{BADGES.length} earned</span>
            <span style={{ ...mono, fontSize:10, color:C.dim, marginLeft:8 }}>{openBadges?"▾":"▸"}</span>
          </button>
          {openBadges && (
            <div style={{ padding:"0 20px 14px" }}>
              {/* Earned badges — always shown first, prominent */}
              {earnedBadges.length > 0 && (()=>{
                const earned = BADGES.filter(b=>earnedBadges.includes(b.id));
                return (
                  <div style={{ marginBottom:18, background:`${C.gold}0e`, border:`1px solid ${C.gold}33`, borderRadius:8, padding:"12px 12px 10px" }}>
                    <p style={{ ...mono, margin:"0 0 9px", fontSize:9, color:C.gold, textTransform:"uppercase", letterSpacing:"0.1em" }}>✓ Earned ({earned.length})</p>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                      {earned.map(b=>(
                        <BadgeTip key={b.id} badge={b} earned={true}>
                          <div style={{ width:62, textAlign:"center", padding:"8px 4px 6px", background:`${C.gold}22`, border:`1px solid ${C.gold}77`, borderRadius:7, cursor:"default" }}>
                            <div style={{ fontSize:24, lineHeight:1.2 }}>{b.emoji}</div>
                            <p style={{ ...mono, margin:"3px 0 0", fontSize:8, color:C.gold, lineHeight:1.3, wordBreak:"break-word", fontWeight:600 }}>{b.name.split(" ").slice(0,2).join(" ")}</p>
                          </div>
                        </BadgeTip>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Locked badges by category */}
              {cats.map(cat=>{
                const catBadges=BADGES.filter(b=>b.cat===cat&&!earnedBadges.includes(b.id));
                if(!catBadges.length) return null;
                return (
                  <div key={cat} style={{ marginBottom:14 }}>
                    <p style={{ ...mono, margin:"0 0 7px", fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.1em" }}>{cat}</p>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
                      {catBadges.map(b=>(
                        <BadgeTip key={b.id} badge={b} earned={false}>
                          <div style={{ width:58, textAlign:"center", padding:"8px 4px 6px", background:C.sur, border:`1px solid ${C.brd}44`, borderRadius:7, opacity:0.3, cursor:"default" }}>
                            <div style={{ fontSize:22, lineHeight:1.2 }}>{b.emoji}</div>
                            <p style={{ ...mono, margin:"3px 0 0", fontSize:8, color:C.dim, lineHeight:1.3, wordBreak:"break-word" }}>{b.name.split(" ").slice(0,2).join(" ")}</p>
                          </div>
                        </BadgeTip>
                      ))}
                    </div>
                  </div>
                );
              })}
              <p style={{ ...mono, fontSize:10, color:C.dim, marginTop:4 }}>Leaderboard badges unlock when multi-user is live.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Sparkline({ data, width=140, height=36, color }) {
  if(!data||data.length<2)return null;
  const scores=data.map(d=>d.score);
  const min=Math.max(0,Math.min(...scores)-5), max=Math.min(100,Math.max(...scores)+5);
  const range=max-min||1;
  const pts=scores.map((v,i)=>{
    const x=(i/(scores.length-1))*(width-6)+3;
    const y=height-3-((v-min)/range)*(height-8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const last=pts.split(" ").pop().split(",");
  return(
    <svg width={width} height={height} style={{ overflow:"visible" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" opacity={0.7}/>
      <circle cx={last[0]} cy={last[1]} r={3} fill={color}/>
    </svg>
  );
}

function DonutChartLegacy({ segments, size=130, thickness=24, center }) {
  const r = size/2 - thickness/2;
  const cx = size/2, cy = size/2;
  const circ = 2 * Math.PI * r;
  const total = segments.reduce((s,x)=>s+x.v,0);
  if(!total) return(
    <div style={{ width:size,height:size,display:"flex",alignItems:"center",justifyContent:"center" }}>
      <span style={{ ...mono,fontSize:11,color:C.dim }}>—</span>
    </div>
  );
  let cum=0;
  return(
    <div style={{ position:"relative",width:size,height:size,flexShrink:0 }}>
      <svg width={size} height={size} style={{ transform:"rotate(-90deg)" }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.brd} strokeWidth={thickness}/>
        {segments.filter(s=>s.v>0).map((s,i)=>{
          const pct=s.v/total;
          const dash=`${pct*circ} ${circ}`;
          const offset=-(cum*circ);
          cum+=pct;
          return <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.c} strokeWidth={thickness} strokeDasharray={dash} strokeDashoffset={offset}/>;
        })}
      </svg>
      {center&&(
        <div style={{ position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",pointerEvents:"none" }}>
          <span style={{ ...mono,fontSize:center.value>=100?16:20,fontWeight:700,color:C.txt,lineHeight:1 }}>{center.value}</span>
          {center.sub&&<span style={{ fontSize:10,color:C.dim,marginTop:2,textAlign:"center" }}>{center.sub}</span>}
        </div>
      )}
    </div>
  );
}

// ── Territory scoring (exported for App.js and shared use) ───────────────────
const _lastTouch = (acc) => acc.last;

export const calcTerritoryBreakdown = (accounts, snapshots=[]) => {
  const total = accounts.length;
  if (!total) return null;
  const ACTIVE_STAGES = new Set(["Engaged","Qualified","Closed Won"]);
  const analyzed = accounts.filter(a=>a.score);
  const gold   = analyzed.filter(a=>a.tier==="Gold").length;
  const silver = analyzed.filter(a=>a.tier==="Silver").length;
  const tin    = analyzed.filter(a=>a.tier==="Tin").length;
  const slag   = analyzed.filter(a=>a.tier==="Slag").length;
  const slagPenalized = analyzed.filter(a=>a.tier==="Slag"&&!ACTIVE_STAGES.has(a.stage||"Prospecting")).length;
  const goldPct   = gold/total;
  const silverPct = silver/total;
  const slagPct   = slagPenalized/total;
  const goldPts    = Math.min(20, Math.round((goldPct/0.20)*20));
  const silverPts  = Math.min(10, Math.round((silverPct/0.20)*10));
  const slagPenalty= Math.min(10, Math.round(Math.max(0,(slagPct-0.30)/0.30)*10));
  const qualityPts = Math.max(0, goldPts + silverPts - slagPenalty);
  const atRiskAccs  = accounts.filter(a=>staleDays(_lastTouch(a))>=90);
  const warnAccs    = accounts.filter(a=>{ const d=staleDays(_lastTouch(a)); return d>=60&&d<90; });
  const atRiskPenalty = Math.min(20, Math.round((atRiskAccs.length/total)*70));
  const warnPenalty   = Math.min(10, Math.round((warnAccs.length/total)*35));
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
    quality:  { pts:qualityPts,   max:40, goldPts, silverPts, slagPenalty, gold, silver, tin, slag, slagPenalized, total, goldPct, silverPct, slagPct },
    activity: { pts:activityPts,  max:35, atRiskPenalty, warnPenalty, atRisk:atRiskAccs.length, warn:warnAccs.length },
    pipeline: { pts:pipelinePts,  max:10, activePipe, qualified, closedWon, engaged, total },
    growth:   { pts:growthPts,    max:15, addedThisWeek, slagReduced },
  };
};

export const calcTerritoryScore = (accounts, snapshots) => {
  const bd = calcTerritoryBreakdown(accounts, snapshots);
  if (!bd) return { score:0, grade:"—", c:C.red };
  return { score:bd.score, grade:bd.grade, c:bd.c };
};

export { RockyCard, MiniBar, StatRow, Sparkline, DonutChartLegacy, BadgeTip, BadgeToast, BADGES, GRADE_THRESHOLDS, getQuarterKey, getQuarterEnd };
export default ProfilePanel;
