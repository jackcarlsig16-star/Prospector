import React, { useState, useMemo } from 'react';
import { C, TS, mono } from '../constants/colors';
import { clientAssay, getActiveIntel, getActiveExamples } from '../utils/assay';
import { UCS_DATA, PROD_COLOR } from '../constants/products';
import { getVoiceProfile } from '../constants/voice';
import { INDUSTRY_COLOR as VERT_C } from '../constants/industries';

// ── GTM segment helpers ───────────────────────────────────────────────────────
const GTM_SEGMENTS = ["SMB","Fintech","B&W","ENT"];
const GTM_SEG_C   = { SMB:"#42E890", Fintech:"#A878F0", "B&W":"#60A8F0", ENT:"#F5C842" };
const GTM_SEG_BG  = { SMB:"#041408", Fintech:"#0E0A18", "B&W":"#040E18", ENT:"#181408" };
const GTM_SEG_BDR = { SMB:"#0A2E18", Fintech:"#2A1848", "B&W":"#0A2040", ENT:"#38300A" };
const inferSegment = (vert) => {
  if (!vert) return null;
  const v = vert.toLowerCase();
  if (["banks","insurance","wealth"].some(k=>v.includes(k))) return "B&W";
  if (["pfm","consumer payments","crypto","lending","ewa","payroll","bfm","neobank","fintech","investment","investing"].some(k=>v.includes(k))) return "Fintech";
  return null;
};

// ── Geo helpers ───────────────────────────────────────────────────────────────
const EU_TOKENS = new Set(["uk","gb","de","fr","nl","se","no","dk","fi","ie","es","it","pt","be","ch","at","pl","cz","ro","hu","gr","europe","london","berlin","paris","amsterdam","stockholm","dublin","madrid","barcelona","zurich","warsaw"]);
const US_STATES = new Set(["al","ak","az","ar","ca","co","ct","de","fl","ga","hi","id","il","in","ia","ks","ky","la","me","md","ma","mi","mn","ms","mo","mt","ne","nv","nh","nj","nm","ny","nc","nd","oh","ok","or","pa","ri","sc","sd","tn","tx","ut","vt","va","wa","wv","wi","wy","dc"]);
const inferGeo = (state) => {
  if (!state) return "Unknown";
  const s = state.toLowerCase().trim();
  if (EU_TOKENS.has(s) || [...EU_TOKENS].some(t=>s.includes(t))) return "EU";
  if (US_STATES.has(s)) return "US";
  if (["canada","ontario","quebec","bc","ab","alberta","british columbia","manitoba","saskatchewan"].some(t=>s.includes(t))) return "Other";
  return "Other";
};

// ── Salesforce URL helper ─────────────────────────────────────────────────────
const SF_BASE = "https://your-org.lightning.force.com/lightning/r/Account/";
const toSfdcUrl = v => {
  if (!v || !v.trim()) return null;
  if (v.startsWith("http")) return v.trim();
  if (/^001[A-Za-z0-9]{12,15}$/.test(v.trim())) return `${SF_BASE}${v.trim()}/view`;
  return null;
};

// ── Dedupe helpers ────────────────────────────────────────────────────────────
const normName = n => (n||"").toLowerCase().trim()
  .replace(/[,.]?\s*(inc\.?|llc\.?|ltd\.?|corp\.?|co\.?|plc\.?|gmbh|s\.a\.?|bv|nv|ag)$/i,"")
  .replace(/\s+/g," ").trim();
const rootDomain = url => {
  if(!url) return "";
  try {
    const h = url.replace(/^https?:\/\//i,"").replace(/^www\./i,"").split("/")[0].split("?")[0].toLowerCase();
    // strip common TLD-only noise
    if(!h||h.length<4) return "";
    return h;
  } catch { return ""; }
};
// Returns Set of IDs that are duplicates (keeping first occurrence per key)
const findDupeIds = (pool) => {
  const seenName = new Map(); // normName → first id
  const seenDomain = new Map(); // domain → first id
  const dupes = new Set();
  for(const a of pool) {
    const nn = normName(a.name);
    const rd = rootDomain(a.web);
    const byName = nn ? seenName.get(nn) : undefined;
    const byDomain = rd ? seenDomain.get(rd) : undefined;
    if(byName !== undefined || byDomain !== undefined) {
      dupes.add(a.id);
    } else {
      if(nn) seenName.set(nn, a.id);
      if(rd) seenDomain.set(rd, a.id);
    }
  }
  return dupes;
};

// ── Stat tracker ──────────────────────────────────────────────────────────────
const trackStat=(key,by=1)=>{
  try{
    const s=JSON.parse(localStorage.getItem("prospector_stats")||"{}");
    s[key]=(s[key]||0)+by;
    localStorage.setItem("prospector_stats",JSON.stringify(s));
    window.dispatchEvent(new Event("prospector_stats_changed"));
  }catch{}
};

function ClaimJumperPage({ pool=[], accounts=[], onClaim, onClaimMultiple, onRemoveFromPool, onUpdatePoolEntry, onRemoveAccount, perms={}, activeUser }) {
  const [tierF,setTierF]=useState("All");
  const [segF,setSegF]=useState("All");
  const [geoF,setGeoF]=useState("All");
  const [vertF,setVertF]=useState("All");
  const [ucF,setUcF]=useState(null);
  const [activeF,setActiveF]=useState("active"); // "all" | "active" | "inactive"
  const [sortBy,setSortBy]=useState("score"); // "score" | "date_desc" | "date_asc"
  const [dateFilter,setDateFilter]=useState(""); // ISO date string e.g. "2025-04-01"
  const [dateMode,setDateMode]=useState("after"); // "before" | "after"
  const [search,setSearch]=useState("");
  const [selected,setSelected]=useState(new Set());
  const [justClaimed,setJustClaimed]=useState(new Set());
  const [expanded,setExpanded]=useState(null);
  const [assaying,setAssaying]=useState(null);
  const [emailLoading,setEmailLoading]=useState(null);
  const [emailOpen,setEmailOpen]=useState(null);
  const [emailBody,setEmailBody]=useState("");
  const [emailCopied,setEmailCopied]=useState(false);
  const [bulkScoring,setBulkScoring]=useState(null); // null | {done,total}
  const [pendingRemove,setPendingRemove]=useState(null);
  const [noteDraft,setNoteDraft]=useState({}); // {[id]: string}
  const [flagReviewOpen,setFlagReviewOpen]=useState(false);
  const [cjTab,setCjTab]=useState("pool");

  const VOTE_THRESHOLD = 3;
  const TIER_PROMOTE = { Slag:"Tin", Tin:"Silver", Silver:"Gold", Gold:"Gold" };
  const TIER_DEMOTE  = { Gold:"Silver", Silver:"Tin", Tin:"Slag", Slag:"Slag" };
  const SCORE_MAP    = { Gold:1, Silver:2, Tin:3, Slag:4 };
  const voter = activeUser?.name || "AE";

  const handleVote = (a, dir) => {
    if(!onUpdatePoolEntry) return;
    const votes = a.votes || { up:[], down:[] };
    const upVoters   = votes.up   || [];
    const downVoters = votes.down || [];
    // Toggle off if already voted same dir
    const alreadyUp   = upVoters.includes(voter);
    const alreadyDown = downVoters.includes(voter);
    let newUp   = alreadyUp   && dir==="up"   ? upVoters.filter(v=>v!==voter)   : dir==="up"   ? [...upVoters.filter(v=>v!==voter), voter] : upVoters.filter(v=>v!==voter);
    let newDown = alreadyDown && dir==="down" ? downVoters.filter(v=>v!==voter) : dir==="down" ? [...downVoters.filter(v=>v!==voter), voter] : downVoters.filter(v=>v!==voter);
    const patch = { votes:{ up:newUp, down:newDown } };
    // Threshold effects — promote/demote tier + update confidence
    if(newUp.length >= VOTE_THRESHOLD && a.tier) {
      const newTier = TIER_PROMOTE[a.tier] || a.tier;
      if(newTier !== a.tier) {
        patch.tier = newTier;
        patch.score = SCORE_MAP[newTier];
        patch.confidence = "High";
        patch.votes = { up:[], down:[] }; // reset after tier change
      }
    } else if(newDown.length >= VOTE_THRESHOLD && a.tier) {
      const newTier = TIER_DEMOTE[a.tier] || a.tier;
      if(newTier !== a.tier) {
        patch.tier = newTier;
        patch.score = SCORE_MAP[newTier];
        patch.confidence = "Low";
        patch.votes = { up:[], down:[] };
      }
    } else {
      // Feed confidence without tier change
      const net = newUp.length - newDown.length;
      if(net >= 2) patch.confidence = "High";
      else if(net <= -2) patch.confidence = "Low";
    }
    onUpdatePoolEntry(a.id, patch);
  };

  const daysInPool = a => {
    const d = a.poolAddedAt || a.uploadedAt;
    if(!d) return null;
    const ms = Date.now() - new Date(d).getTime();
    if(isNaN(ms)||ms<0) return null;
    return Math.floor(ms/86400000);
  };
  const poolAgeColor = d => d===null?C.dim:d<7?C.green:d<30?C.mut:d<60?C.orange:C.red;
  const poolAgeLabel = d => d===null?"—":d===0?"today":d===1?"1d":`${d}d`;

  const runAssay=async(a)=>{
    if(assaying)return;
    setAssaying(a.id);
    try{
      const parsed=await clientAssay({name:a.name,web:a.web,vert:a.vert,customIntel:getActiveIntel(),exampleAccts:getActiveExamples(),stage:a.stage||"Prospecting"});
      onUpdatePoolEntry&&onUpdatePoolEntry(a.id,{...parsed,sigs:parsed.keySignals||[],ucs:parsed.useCases||[],prods:parsed.products||[],bm:parsed.businessModel||"",pf:parsed.productFit||"",dis:parsed.disqualifier||null,linkedin:parsed.linkedin||a.linkedin||"",analyzed:true,siteInactive:parsed.isActive===false});
    }catch(e){console.error(e);}
    setAssaying(null);
  };

  const generateEmail=async(a)=>{
    setEmailLoading(a.id);setEmailOpen(a.id);setEmailBody("");
    try{
      const res=await fetch("/api/email",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({account:{name:a.name,web:a.web,vert:a.vert,bm:a.bm,pf:a.pf,sigs:a.sigs,ucs:a.ucs,prods:a.prods},senderName:activeUser?.name||"AE",voiceProfile:getVoiceProfile(activeUser?.name)})});
      const d=await res.json();
      setEmailBody(d.email||d.body||"");
    }catch(e){setEmailBody("Error generating email.");}
    setEmailLoading(null);
  };

  const filtered=useMemo(()=>{
    let r=[...pool];
    if(search)r=r.filter(a=>a.name.toLowerCase().includes(search.toLowerCase())||a.vert?.toLowerCase().includes(search.toLowerCase()));
    if(tierF!=="All")r=r.filter(a=>a.tier===tierF);
    if(segF!=="All")r=r.filter(a=>(a.segment||inferSegment(a.vert)||"Unknown")===segF);
    if(geoF!=="All")r=r.filter(a=>inferGeo(a.state)===geoF);
    if(vertF!=="All")r=r.filter(a=>a.vert===vertF);
    if(ucF)r=r.filter(a=>a.ucs&&a.ucs.includes(ucF));
    if(activeF==="active")r=r.filter(a=>!a.siteInactive);
    if(activeF==="inactive")r=r.filter(a=>!!a.siteInactive);
    if(dateFilter){
      const cutoff=new Date(dateFilter).getTime();
      r=r.filter(a=>{
        const d=a.poolAddedAt?new Date(a.poolAddedAt).getTime():(a.uploadedAt?new Date(a.uploadedAt).getTime():null);
        if(!d)return dateMode==="after"; // no date: only include in "after" view
        return dateMode==="after"?d>=cutoff:d<=cutoff;
      });
    }
    if(sortBy==="date_desc")r=r.sort((a,b)=>{const da=a.poolAddedAt||a.uploadedAt||"";const db=b.poolAddedAt||b.uploadedAt||"";return db.localeCompare(da);});
    else if(sortBy==="date_asc")r=r.sort((a,b)=>{const da=a.poolAddedAt||a.uploadedAt||"";const db=b.poolAddedAt||b.uploadedAt||"";return da.localeCompare(db);});
    else r=r.sort((a,b)=>(a.score||9)-(b.score||9));
    return r;
  },[pool,tierF,segF,geoF,vertF,ucF,activeF,search,sortBy,dateFilter,dateMode]);

  const dupeIds = useMemo(() => findDupeIds(pool), [pool]);

  const cnt={Gold:0,Silver:0,Tin:0,Slag:0};
  pool.forEach(a=>{if(cnt[a.tier]!==undefined)cnt[a.tier]++;});
  const canClaim=!!onClaim;
  const claimedBy=activeUser?.name||"AE";

  const handleClaim=(id)=>{
    onClaim(id,claimedBy);
    setJustClaimed(s=>{const n=new Set(s);n.add(id);return n;});
    setSelected(s=>{const n=new Set(s);n.delete(id);return n;});
  };
  const handleClaimMultiple=()=>{
    const ids=[...selected];
    onClaimMultiple&&onClaimMultiple(ids,claimedBy);
    setSelected(new Set());
  };
  const toggleSelect=(id)=>setSelected(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n;});
  const toggleAll=()=>{
    if(selected.size===filtered.length){setSelected(new Set());}
    else{setSelected(new Set(filtered.map(a=>a.id)));}
  };

  return(
    <div>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"flex-start", gap:12, marginBottom:14, flexWrap:"wrap" }}>
        <div style={{ flex:1 }}>
          <p style={{ margin:"0 0 2px", fontSize:22, fontWeight:500, color:C.txt }}>⛏ Claim Jumper</p>
          <p style={{ ...mono, margin:0, fontSize:13, color:C.mut }}>{pool.length} accounts in pool · {pool.filter(a=>!a.tier).length>0&&<span style={{ color:C.orange }}>{pool.filter(a=>!a.tier).length} unscored · </span>}{dupeIds.size>0&&<span style={{ color:C.orange }}>⚑ {dupeIds.size} dupe{dupeIds.size!==1?"s":""} · </span>}add to your Prospector book</p>
        </div>
        {selected.size>0&&canClaim&&(
          <div style={{ display:"flex", gap:8 }}>
            <button disabled={!!bulkScoring} onClick={async()=>{
              const ids=[...selected].filter(id=>pool.find(x=>x.id===id));
              if(!ids.length)return;
              setBulkScoring({done:0,total:ids.length});
              for(let i=0;i<ids.length;i++){
                const a=pool.find(x=>x.id===ids[i]);
                if(!a)continue;
                try{
                  const parsed=await clientAssay({name:a.name,web:a.web,vert:a.vert,customIntel:getActiveIntel(),exampleAccts:getActiveExamples(),stage:a.stage||"Prospecting"});
                  onUpdatePoolEntry&&onUpdatePoolEntry(ids[i],{...parsed,sigs:parsed.keySignals||[],ucs:parsed.useCases||[],prods:parsed.products||[],bm:parsed.businessModel||"",pf:parsed.productFit||"",dis:parsed.disqualifier||null,linkedin:parsed.linkedin||a.linkedin||"",analyzed:true,siteInactive:parsed.isActive===false});
                }catch(e){}
                setBulkScoring({done:i+1,total:ids.length});
                if(i<ids.length-1)await new Promise(r=>setTimeout(r,1200));
              }
              setBulkScoring(null);
            }} style={{ padding:"8px 18px", background:C.tinBg, border:`1px solid ${C.tinBdr}`, color:bulkScoring?C.dim:C.tin, borderRadius:7, cursor:bulkScoring?"not-allowed":"pointer", fontSize:14, fontWeight:500, minWidth:180, textAlign:"center" }}>
              {bulkScoring?`⬟ Scoring ${bulkScoring.done}/${bulkScoring.total}…`:`⬟ Score ${selected.size} selected →`}
            </button>
            <button onClick={handleClaimMultiple} style={{ padding:"8px 18px", background:C.goldBg, border:`1px solid ${C.goldBdr}`, color:C.gold, borderRadius:7, cursor:"pointer", fontSize:14, fontWeight:500 }}>
              ⚡ Claim {selected.size} selected →
            </button>
          </div>
        )}
        {!canClaim&&(
          <div style={{ ...mono, fontSize:12, padding:"6px 12px", background:`${C.purple}14`, border:`1px solid ${C.purple}44`, borderRadius:6, color:C.purple }}>
            View only — AE claims on your behalf
          </div>
        )}
      </div>

      {/* Tab bar — reassay permission */}
      {perms.canReassay&&(
        <div style={{ display:"flex", gap:0, marginBottom:16, borderBottom:`1px solid ${C.brd}` }}>
          {[["pool","Pool"],["batch","⬟ Batch Manager"]].map(([id,lb])=>(
            <button key={id} onClick={()=>setCjTab(id)} style={{ ...mono, fontSize:12, padding:"7px 16px", background:"transparent", border:"none", borderBottom:`2px solid ${cjTab===id?C.blue:"transparent"}`, color:cjTab===id?C.blue:C.dim, cursor:"pointer", fontWeight:cjTab===id?600:400, marginBottom:-1 }}>{lb}</button>
          ))}
        </div>
      )}

      {cjTab==="pool"&&<>
      {/* Flagged for review panel */}
      {(()=>{
        const flagged=pool.filter(a=>a.flaggedForReview||a.siteInactive);
        if(!flagged.length)return null;
        return(
          <div style={{ marginBottom:12, background:"#0C0808", border:`1px solid ${C.orange}55`, borderRadius:8, overflow:"hidden" }}>
            <div onClick={()=>setFlagReviewOpen(o=>!o)} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 14px", cursor:"pointer" }}>
              <span style={{ ...mono, fontSize:11, fontWeight:500, color:C.orange, textTransform:"uppercase", letterSpacing:"0.08em" }}>⚑ Flagged for review — {flagged.length}</span>
              <span style={{ ...mono, fontSize:10, color:C.dim, flex:1 }}>dupes, inactive sites — clear weekly</span>
              <span style={{ ...mono, fontSize:11, color:C.dim }}>{flagReviewOpen?"▲":"▼"}</span>
            </div>
            {flagReviewOpen&&(
              <div style={{ borderTop:`1px solid ${C.orange}33`, padding:"6px 14px 10px" }}>
                {flagged.map(a=>(
                  <div key={a.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"5px 0", borderBottom:`1px solid ${C.brd}22` }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <span style={{ fontSize:13, color:C.txt }}>{a.name}</span>
                      <span style={{ ...mono, fontSize:10, color:C.dim, marginLeft:8 }}>{a.vert||""}</span>
                    </div>
                    {a.flaggedForReview&&<span style={{ ...mono, fontSize:10, padding:"1px 6px", background:`${C.orange}18`, border:`1px solid ${C.orange}44`, color:C.orange, borderRadius:3 }}>⚑ {a.flagReason||"Dupe"}</span>}
                    {a.siteInactive&&<span style={{ ...mono, fontSize:10, padding:"1px 6px", background:`${C.dim}18`, border:`1px solid ${C.dim}44`, color:C.dim, borderRadius:3 }}>site inactive</span>}
                    {a.flaggedBy&&<span style={{ ...mono, fontSize:10, color:C.dim }}>by {a.flaggedBy}</span>}
                    <button onClick={()=>onUpdatePoolEntry&&onUpdatePoolEntry(a.id,{flaggedForReview:false,flagReason:null,flaggedBy:null,siteInactive:false})} style={{ ...mono, fontSize:10, padding:"2px 7px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:3, cursor:"pointer" }}>Clear</button>
                    <button onClick={()=>onRemoveFromPool&&onRemoveFromPool(a.id)} style={{ ...mono, fontSize:10, padding:"2px 7px", background:`${C.red}18`, border:`1px solid ${C.red}44`, color:C.red, borderRadius:3, cursor:"pointer" }}>Remove</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}


      {/* Geo filter */}
      <div style={{ display:"flex", gap:6, marginBottom:6, alignItems:"center", flexWrap:"wrap" }}>
        <span style={{ ...mono, fontSize:11, color:C.dim, textTransform:"uppercase", letterSpacing:"0.07em", marginRight:4 }}>Geo</span>
        {["All","US","EU","Other"].map(g=>{
          const active=geoF===g;
          const cnt=g==="All"?pool.length:pool.filter(a=>inferGeo(a.state)===g).length;
          return <button key={g} onClick={()=>setGeoF(g)} style={{ ...mono, fontSize:12, padding:"3px 12px", borderRadius:5, border:`1px solid ${active?C.blue:C.brd}`, background:active?"#040E18":"transparent", color:active?C.blue:C.dim, cursor:"pointer", fontWeight:active?600:400 }}>{g} <span style={{ fontSize:11, opacity:0.7 }}>{cnt}</span></button>;
        })}
      </div>

      {/* GTM segment filter */}
      <div style={{ display:"flex", gap:6, marginBottom:8, alignItems:"center", flexWrap:"wrap" }}>
        <span style={{ ...mono, fontSize:11, color:C.dim, textTransform:"uppercase", letterSpacing:"0.07em", marginRight:4 }}>Segment</span>
        {["All",...GTM_SEGMENTS].map(s=>{
          const active=segF===s;
          const c=GTM_SEG_C[s]||C.mut;
          const bg=GTM_SEG_BG[s]||"transparent";
          const bdr=GTM_SEG_BDR[s]||C.brd;
          const cnt=s==="All"?pool.length:pool.filter(a=>(a.segment||inferSegment(a.vert)||"Unknown")===s).length;
          return(
            <button key={s} onClick={()=>setSegF(s)} style={{ ...mono, fontSize:12, padding:"3px 12px", borderRadius:5, border:`1px solid ${active?bdr:C.brd}`, background:active?bg:"transparent", color:active?c:C.dim, cursor:"pointer", fontWeight:active?600:400 }}>
              {s} <span style={{ fontSize:11, opacity:0.7 }}>{cnt}</span>
            </button>
          );
        })}
      </div>

      {/* Vertical filter */}
      {(() => {
        const verts = ["All", ...Array.from(new Set(pool.map(a=>a.vert).filter(Boolean))).sort()];
        if(verts.length <= 2) return null;
        return (
          <div style={{ display:"flex", gap:6, marginBottom:8, alignItems:"center", flexWrap:"wrap" }}>
            <span style={{ ...mono, fontSize:11, color:C.dim, textTransform:"uppercase", letterSpacing:"0.07em", marginRight:4 }}>Vertical</span>
            {verts.map(v=>{
              const active=vertF===v;
              const cnt=v==="All"?pool.length:pool.filter(a=>a.vert===v).length;
              return <button key={v} onClick={()=>setVertF(v)} style={{ ...mono, fontSize:12, padding:"3px 10px", borderRadius:5, border:`1px solid ${active?C.purple:C.brd}`, background:active?"#0E0A18":"transparent", color:active?C.purple:C.dim, cursor:"pointer", fontWeight:active?600:400 }}>{v} <span style={{ fontSize:11, opacity:0.7 }}>{cnt}</span></button>;
            })}
          </div>
        );
      })()}

      {/* Tier bar */}
      <div style={{ background:C.card, border:`1px solid ${C.brd}`, borderRadius:8, padding:"10px 14px", marginBottom:10 }}>
        <div style={{ height:4, borderRadius:2, background:C.bg, display:"flex", overflow:"hidden", gap:1, marginBottom:6 }}>
          {["Gold","Silver","Tin","Slag"].map(t=><div key={t} style={{ width:`${pool.length>0?(cnt[t]/pool.length)*100:0}%`, background:TS[t]?.c||C.dim }}/>)}
        </div>
        <div style={{ display:"flex", gap:14, flexWrap:"wrap" }}>
          {["All","Gold","Silver","Tin","Slag"].map(t=>(
            <button key={t} onClick={()=>setTierF(t)} style={{ ...mono, fontSize:12, padding:"2px 8px", borderRadius:4, border:`1px solid ${tierF===t?(TS[t]?TS[t].b:C.gold):C.brd}`, background:tierF===t?(TS[t]?TS[t].bg:C.goldBg):"transparent", color:tierF===t?(TS[t]?TS[t].c:C.gold):C.mut, cursor:"pointer" }}>
              {t!=="All"&&TS[t]?`${TS[t].i} `:""}${t}{t!=="All"?` ${cnt[t]}`:`  ${pool.length}`}
            </button>
          ))}
        </div>
      </div>

      {/* Search + UC filter */}
      <div style={{ display:"flex", gap:6, marginBottom:10, flexWrap:"wrap", alignItems:"center" }}>
        <input placeholder="Search accounts..." value={search} onChange={e=>setSearch(e.target.value)} style={{ fontSize:13, padding:"5px 10px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:5, color:C.txt, width:160, outline:"none" }}/>
        {[["all","All"],["active","Active"],["inactive","Inactive"]].map(([val,lb])=>(
          <button key={val} onClick={()=>setActiveF(val)} style={{ ...mono, fontSize:12, padding:"3px 10px", borderRadius:4, border:`1px solid ${activeF===val?C.green:C.brd}`, background:activeF===val?`${C.green}14`:"transparent", color:activeF===val?C.green:C.dim, cursor:"pointer" }}>{lb}</button>
        ))}
        <span style={{ ...mono, fontSize:10, color:C.dim, padding:"0 2px" }}>·</span>
        {UCS_DATA.map(uc=>(
          <button key={uc.id} onClick={()=>setUcF(ucF===uc.id?null:uc.id)} style={{ fontSize:12, padding:"3px 9px", borderRadius:4, border:`1px solid ${ucF===uc.id?uc.b:C.brd}`, background:ucF===uc.id?uc.bg:"transparent", color:ucF===uc.id?uc.c:C.dim, cursor:"pointer" }}>{uc.lb}</button>
        ))}
        {(ucF||search)&&<button onClick={()=>{setUcF(null);setSearch("");}} style={{ fontSize:12, padding:"3px 8px", borderRadius:4, border:`1px solid ${C.brd}`, background:"transparent", color:C.mut, cursor:"pointer" }}>✕ clear</button>}
        <div style={{ display:"flex", gap:5, marginLeft:"auto", alignItems:"center" }}>
          {dupeIds.size>0&&(
            <button onClick={()=>{
              const unflagged=[...dupeIds].filter(id=>{const a=pool.find(x=>x.id===id);return a&&!a.flaggedForReview;});
              unflagged.forEach(id=>onUpdatePoolEntry&&onUpdatePoolEntry(id,{flaggedForReview:true,flagReason:"Dupe",flaggedBy:activeUser?.name||"AE",flaggedAt:new Date().toISOString()}));
            }} style={{ ...mono, fontSize:11, padding:"3px 9px", borderRadius:4, border:`1px solid ${C.orange}55`, background:`${C.orange}0A`, color:C.orange, cursor:"pointer" }}>
              ⚑ Flag {dupeIds.size} dupe{dupeIds.size!==1?"s":""}
            </button>
          )}
          {canClaim&&filtered.length>0&&<>
            <button onClick={()=>setSelected(new Set(filtered.map(a=>a.id)))} style={{ ...mono, fontSize:11, padding:"3px 9px", borderRadius:4, border:`1px solid ${C.brd}`, background:"transparent", color:C.dim, cursor:"pointer" }}>Select all</button>
            <button onClick={()=>setSelected(new Set())} style={{ ...mono, fontSize:11, padding:"3px 9px", borderRadius:4, border:`1px solid ${C.brd}`, background:"transparent", color:C.dim, cursor:"pointer" }}>Deselect all</button>
          </>}
        </div>
      </div>

      {/* Sort + Date filter */}
      <div style={{ display:"flex", gap:6, marginBottom:10, flexWrap:"wrap", alignItems:"center" }}>
        <span style={{ ...mono, fontSize:11, color:C.dim, textTransform:"uppercase", letterSpacing:"0.07em", marginRight:2 }}>Sort</span>
        {[["score","⬟ Score"],["date_desc","📅 Newest"],["date_asc","📅 Oldest"]].map(([val,lb])=>(
          <button key={val} onClick={()=>setSortBy(val)} style={{ ...mono, fontSize:12, padding:"3px 10px", borderRadius:4, border:`1px solid ${sortBy===val?C.blue:C.brd}`, background:sortBy===val?"#040E18":"transparent", color:sortBy===val?C.blue:C.dim, cursor:"pointer", fontWeight:sortBy===val?600:400 }}>{lb}</button>
        ))}
        <span style={{ ...mono, fontSize:10, color:C.dim, padding:"0 4px" }}>·</span>
        <span style={{ ...mono, fontSize:11, color:C.dim, textTransform:"uppercase", letterSpacing:"0.07em" }}>Date</span>
        {["after","before"].map(m=>(
          <button key={m} onClick={()=>setDateMode(m)} style={{ ...mono, fontSize:12, padding:"3px 9px", borderRadius:4, border:`1px solid ${dateMode===m&&dateFilter?C.gold:C.brd}`, background:dateMode===m&&dateFilter?C.goldBg:"transparent", color:dateMode===m&&dateFilter?C.gold:C.dim, cursor:"pointer" }}>{m==="after"?"↑ After":"↓ Before"}</button>
        ))}
        <input type="date" value={dateFilter} onChange={e=>setDateFilter(e.target.value)}
          style={{ ...mono, fontSize:12, padding:"3px 8px", background:C.sur, border:`1px solid ${dateFilter?C.gold:C.brd}`, borderRadius:4, color:dateFilter?C.gold:C.dim, outline:"none", cursor:"pointer", colorScheme:"dark" }}/>
        {dateFilter&&<button onClick={()=>setDateFilter("")} style={{ ...mono, fontSize:11, padding:"3px 7px", borderRadius:4, border:`1px solid ${C.brd}`, background:"transparent", color:C.dim, cursor:"pointer" }}>✕</button>}
      </div>

      {/* Column headers */}
      <div style={{ display:"grid", gridTemplateColumns:canClaim?"28px 2.2fr 1fr 1.6fr 2fr 80px 44px 28px":"2.2fr 1fr 1.6fr 2fr 28px", gap:8, padding:"4px 10px", marginBottom:4 }}>
        {(canClaim?["","Account","Vertical","Products","Why Us","",""]:[" Account","Vertical","Products","Why Us"]).map((h,i)=>(
          <span key={i} style={{ ...mono, fontSize:10, fontWeight:500, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>{h}</span>
        ))}
      </div>

      {filtered.length===0&&(
        <div style={{ padding:"40px 0", textAlign:"center" }}>
          <p style={{ fontSize:15, color:C.mut }}>{pool.length===0?"Pool is empty — upload a Dormant CSV to populate it.":"No accounts match this filter."}</p>
        </div>
      )}

      {filtered.map(a=>{
        const isExp=expanded===a.id;
        const ts=TS[a.tier]||{};
        const isGold=a.tier==="Gold";
        const isSilver=a.tier==="Silver";
        const isTin=a.tier==="Tin";
        const isSlag=a.tier==="Slag";
        const isSel=selected.has(a.id);
        const webUrl=a.web?(a.web.startsWith("http")?a.web:`https://${a.web}`):null;
        const isInactive=!!a.siteInactive;
        const isFlagged=!!a.flaggedForReview;
        const isDupe=dupeIds.has(a.id)&&!isFlagged;
        const age=daysInPool(a);
        const cardBg=isInactive?C.bg:isSel?`${C.gold}0A`:isGold?C.goldBg:isSilver?C.silverBg:isTin?C.tinBg:isSlag?C.slagBg:C.card;
        const cardBdr=isFlagged?`${C.orange}55`:isInactive?C.brd:isSel?C.goldBdr:isGold?C.goldBdr:isSilver?C.silverBdr:isTin?C.tinBdr:C.brd;
        const cardGlow=isGold&&!isInactive?`0 0 18px ${C.gold}22, inset 0 1px 0 ${C.gold}18`:isSilver&&!isInactive?`0 0 12px ${C.silver}18, inset 0 1px 0 ${C.silver}14`:undefined;
        return(
          <div key={a.id} style={{ marginBottom:3, border:`1px solid ${cardBdr}`, borderRadius:7, overflow:"hidden", boxShadow:cardGlow }}>
            {/* Collapsed row */}
            <div onClick={()=>setExpanded(isExp?null:a.id)} style={{ display:"grid", gridTemplateColumns:canClaim?"28px 2.2fr 1fr 1.6fr 2fr 80px 44px 28px":"2.2fr 1fr 1.6fr 2fr 28px", gap:8, padding:"6px 10px", background:cardBg, alignItems:"center", cursor:"pointer", transition:"background 0.1s" }}>
              {canClaim&&<input type="checkbox" checked={isSel} onChange={e=>{e.stopPropagation();toggleSelect(a.id);}} onClick={e=>e.stopPropagation()} style={{ width:14, height:14, cursor:"pointer", accentColor:C.gold }}/>}
              <div style={{ minWidth:0 }}>
                <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:2 }}>
                  {isGold&&!isInactive&&<span style={{ fontSize:13 }}>⚡</span>}
                  {isInactive&&<span style={{ ...mono, fontSize:10, padding:"1px 5px", border:`1px solid ${C.dim}`, borderRadius:3, color:C.dim, flexShrink:0 }}>inactive</span>}
                  {isFlagged&&<span style={{ ...mono, fontSize:10, padding:"1px 5px", border:`1px solid ${C.orange}55`, borderRadius:3, color:C.orange, flexShrink:0 }}>⚑ review</span>}
                  {isDupe&&<span style={{ ...mono, fontSize:10, padding:"1px 5px", border:`1px solid ${C.orange}33`, borderRadius:3, color:C.orange, opacity:0.75, flexShrink:0 }}>⚑ dupe</span>}
                  {!isInactive&&(a.tier?<span style={{ ...mono, fontSize:11, padding:"1px 5px", border:`1px solid ${ts.b||C.brd}`, borderRadius:3, color:ts.c, background:ts.bg, flexShrink:0 }}>{ts.i} {a.tier}</span>:<span style={{ ...mono, fontSize:11, padding:"1px 5px", border:`1px solid ${C.brd}`, borderRadius:3, color:C.dim, flexShrink:0 }}>unscored</span>)}
                  {(()=>{const seg=a.segment||inferSegment(a.vert);return seg?<span style={{ ...mono, fontSize:10, padding:"1px 5px", border:`1px solid ${GTM_SEG_BDR[seg]||C.brd}`, borderRadius:3, color:GTM_SEG_C[seg]||C.dim, background:GTM_SEG_BG[seg]||"transparent", flexShrink:0 }}>{seg}</span>:null;})()}
                  <span style={{ fontSize:14, fontWeight:500, color:isInactive?C.dim:isGold?C.goldTxt:C.txt, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{a.name}</span>
                  {age!==null&&<span style={{ ...mono, fontSize:9, color:poolAgeColor(age), flexShrink:0, marginLeft:2 }}>{poolAgeLabel(age)}</span>}
                </div>
                <p style={{ ...mono, margin:0, fontSize:11, color:C.dim }}>{a.bm?.slice(0,80)}{a.bm?.length>80?"…":""}</p>
              </div>
              <span style={{ fontSize:13, color:VERT_C[a.vert]||C.mut, fontWeight:500 }}>{a.vert||"—"}</span>
              <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                {(a.prods||[]).slice(0,3).map(p=><span key={p} style={{ ...mono, fontSize:10, color:PROD_COLOR[p]||C.mut, border:`1px solid ${C.brd}`, borderRadius:3, padding:"1px 5px", background:C.bg }}>{p}</span>)}
              </div>
              <span style={{ fontSize:12, color:C.mut, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>{a.pf||"—"}</span>
              {canClaim&&(
                <button onClick={e=>{e.stopPropagation();handleClaim(a.id);}} style={{ ...mono, fontSize:11, padding:"4px 8px", background:isGold?C.goldBg:C.sur, border:`1px solid ${isGold?C.goldBdr:C.brd}`, color:isGold?C.gold:C.mut, borderRadius:4, cursor:"pointer", fontWeight:isGold?600:400, whiteSpace:"nowrap" }}>{isGold?"⚡ Claim":"Claim"}</button>
              )}
              {canClaim&&<div style={{ display:"flex", flexDirection:"column", gap:1, alignItems:"center" }}>
                <span style={{ ...mono, fontSize:10, color:C.dim }}>{a.state||"—"}</span>
                {a.uploadedBy&&<span style={{ ...mono, fontSize:9, color:C.dim, opacity:0.6 }}>↑ {a.uploadedBy}</span>}
              </div>}
              {/* Vote buttons */}
              {(()=>{
                const votes = a.votes || { up:[], down:[] };
                const upCount   = (votes.up   ||[]).length;
                const downCount = (votes.down ||[]).length;
                const myUp   = (votes.up  ||[]).includes(voter);
                const myDown = (votes.down||[]).includes(voter);
                return(
                  <div style={{ display:"flex", flexDirection:"column", gap:2, alignItems:"center" }} onClick={e=>e.stopPropagation()}>
                    <button onClick={e=>{e.stopPropagation();handleVote(a,"up");}}
                      style={{ ...mono, fontSize:11, padding:"1px 7px", background:myUp?`${C.green}28`:"transparent", border:`1px solid ${myUp?C.green:C.brd}`, color:myUp?C.green:C.dim, borderRadius:3, cursor:"pointer", lineHeight:1.4 }}>
                      ↑ {upCount||""}
                    </button>
                    <button onClick={e=>{e.stopPropagation();handleVote(a,"down");}}
                      style={{ ...mono, fontSize:11, padding:"1px 7px", background:myDown?`${C.red}22`:"transparent", border:`1px solid ${myDown?C.red:C.brd}`, color:myDown?C.red:C.dim, borderRadius:3, cursor:"pointer", lineHeight:1.4 }}>
                      ↓ {downCount||""}
                    </button>
                  </div>
                );
              })()}
              {(()=>{
                const isPending=pendingRemove===a.id;
                return isPending
                  ? <div style={{ display:"flex", flexDirection:"column", gap:2, alignItems:"center" }} onClick={e=>e.stopPropagation()}>
                      <button onClick={e=>{e.stopPropagation();onRemoveFromPool&&onRemoveFromPool(a.id);setPendingRemove(null);}} style={{ ...mono, fontSize:9, padding:"2px 6px", background:`${C.red}22`, border:`1px solid ${C.red}55`, color:C.red, borderRadius:3, cursor:"pointer", whiteSpace:"nowrap" }}>Remove</button>
                      <button onClick={e=>{e.stopPropagation();setPendingRemove(null);}} style={{ ...mono, fontSize:9, padding:"2px 6px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:3, cursor:"pointer" }}>Cancel</button>
                    </div>
                  : <button onClick={e=>{e.stopPropagation();setPendingRemove(a.id);}} style={{ background:"transparent", border:"none", color:C.dim, fontSize:14, cursor:"pointer", padding:0, lineHeight:1, opacity:0.5 }} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=0.5}>✕</button>;
              })()}
            </div>

            {/* Expanded panel */}
            {isExp&&(
              <div style={{ borderTop:`1px solid ${C.brd}`, padding:"12px 14px", background:C.sur }}>
                {/* Action buttons */}
                <div style={{ display:"flex", gap:6, marginBottom:12, flexWrap:"wrap" }}>
                  {webUrl&&<a href={webUrl} target="_blank" rel="noreferrer" style={{ ...mono, fontSize:12, padding:"4px 10px", background:"transparent", border:`1px solid ${C.brd}`, color:C.tin, borderRadius:4, textDecoration:"none" }}>↗ Website</a>}
                  <a href={a.linkedin||`https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(a.name)}`} target="_blank" rel="noreferrer" style={{ ...mono, fontSize:12, padding:"4px 10px", background:"transparent", border:`1px solid ${C.brd}`, color:"#4A9AE8", borderRadius:4, textDecoration:"none" }}>in LinkedIn</a>
                  {toSfdcUrl(a.sfdc)&&<a href={toSfdcUrl(a.sfdc)} target="_blank" rel="noreferrer" style={{ ...mono, fontSize:12, padding:"4px 10px", background:"transparent", border:`1px solid ${C.brd}`, color:C.orange, borderRadius:4, textDecoration:"none" }}>⬡ Salesforce</a>}
                  <button onClick={()=>runAssay(a)} disabled={!!assaying} style={{ ...mono, fontSize:12, padding:"4px 10px", background:C.tinBg, border:`1px solid ${C.tinBdr}`, color:assaying===a.id?C.dim:C.tin, borderRadius:4, cursor:assaying?"not-allowed":"pointer" }}>{assaying===a.id?"Scoring…":"⬟ Run assay"}</button>
                  <button onClick={()=>generateEmail(a)} style={{ ...mono, fontSize:12, padding:"4px 10px", background:"transparent", border:`1px solid ${C.brd}`, color:C.mut, borderRadius:4, cursor:"pointer" }}>{emailLoading===a.id?"Generating…":"✉ Draft email"}</button>
                  <button
                    onClick={()=>onUpdatePoolEntry&&onUpdatePoolEntry(a.id,{siteInactive:!a.siteInactive})}
                    style={{ ...mono, fontSize:12, padding:"4px 10px", background:a.siteInactive?`${C.dim}22`:"transparent", border:`1px solid ${a.siteInactive?C.dim:C.brd}`, color:a.siteInactive?C.dim:C.mut, borderRadius:4, cursor:"pointer" }}>
                    {a.siteInactive?"↺ Mark active":"⊘ Site inactive"}
                  </button>
                  <button
                    onClick={()=>onUpdatePoolEntry&&onUpdatePoolEntry(a.id,{flaggedForReview:!a.flaggedForReview,flagReason:a.flaggedForReview?null:"Dupe",flaggedBy:a.flaggedForReview?null:(activeUser?.name||"AE"),flaggedAt:a.flaggedForReview?null:new Date().toISOString()})}
                    style={{ ...mono, fontSize:12, padding:"4px 10px", background:a.flaggedForReview?`${C.orange}18`:"transparent", border:`1px solid ${a.flaggedForReview?C.orange:C.brd}`, color:a.flaggedForReview?C.orange:C.mut, borderRadius:4, cursor:"pointer" }}>
                    {a.flaggedForReview?"⚑ Flagged":"⚑ Flag dupe"}
                  </button>
                </div>
                {/* Analysis */}
                {a.bm&&<p style={{ margin:"0 0 6px", fontSize:13, color:C.txt }}><span style={{ color:C.mut, fontSize:11 }}>Business model · </span>{a.bm}</p>}
                {a.pf&&<p style={{ margin:"0 0 6px", fontSize:13, color:C.txt }}><span style={{ color:C.mut, fontSize:11 }}>product fit · </span>{a.pf}</p>}
                {a.sigs?.length>0&&<div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:6 }}>{a.sigs.map(s=><span key={s} style={{ ...mono, fontSize:11, padding:"2px 7px", background:C.bg, border:`1px solid ${C.brd}`, borderRadius:3, color:C.mut }}>{s}</span>)}</div>}
                {!a.bm&&!a.pf&&<p style={{ ...mono, fontSize:12, color:C.dim, margin:"0 0 8px" }}>Not yet scored — run assay to analyze</p>}
                {/* Research notes */}
                <div style={{ marginTop:8 }}>
                  <p style={{ ...mono, margin:"0 0 4px", fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.07em" }}>Research notes</p>
                  <textarea
                    value={noteDraft[a.id]??a.notes??""}
                    onChange={e=>setNoteDraft(d=>({...d,[a.id]:e.target.value}))}
                    onBlur={e=>{const v=e.target.value;onUpdatePoolEntry&&onUpdatePoolEntry(a.id,{notes:v});}}
                    placeholder="Add context — site status, manual research, conversations…"
                    rows={3}
                    style={{ ...mono, width:"100%", boxSizing:"border-box", fontSize:12, padding:"7px 10px", background:C.bg, border:`1px solid ${C.brdM}`, borderRadius:5, color:C.txt, outline:"none", resize:"vertical" }}
                  />
                </div>
                {/* Email */}
                {emailOpen===a.id&&(
                  <div style={{ marginTop:10, background:C.bg, border:`1px solid ${C.brd}`, borderRadius:6, padding:"10px 12px" }}>
                    {emailLoading===a.id?<p style={{ ...mono, fontSize:12, color:C.dim, margin:0 }}>Generating…</p>:(
                      <>
                        <textarea value={emailBody} onChange={e=>setEmailBody(e.target.value)} style={{ width:"100%", fontSize:13, lineHeight:1.6, background:"transparent", border:"none", color:C.txt, outline:"none", resize:"vertical", minHeight:120, boxSizing:"border-box" }}/>
                        <div style={{ display:"flex", gap:6, marginTop:6 }}>
                          <button onClick={()=>{navigator.clipboard.writeText(emailBody);setEmailCopied(true);setTimeout(()=>setEmailCopied(false),2000);trackStat("emails_sent");}} style={{ ...mono, fontSize:11, padding:"3px 10px", background:"transparent", border:`1px solid ${C.brd}`, color:emailCopied?C.green:C.mut, borderRadius:4, cursor:"pointer" }}>{emailCopied?"Copied!":"Copy"}</button>
                          <button onClick={()=>setEmailOpen(null)} style={{ ...mono, fontSize:11, padding:"3px 8px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:4, cursor:"pointer" }}>Close</button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {pool.length>0&&filtered.length>0&&(
        <p style={{ ...mono, fontSize:11, color:C.dim, marginTop:10, textAlign:"center" }}>{filtered.length} of {pool.length} accounts shown</p>
      )}
      </>}

      {/* Batch Manager tab */}
      {cjTab==="batch"&&perms.canReassay&&(()=>{
        const unscored=pool.filter(a=>!a.analyzed);
        const scored=pool.filter(a=>a.analyzed);
        const sortedPool=[...pool].sort((a,b)=>{
          if(a.siteInactive&&!b.siteInactive)return 1;
          if(!a.siteInactive&&b.siteInactive)return -1;
          if(!a.analyzed&&b.analyzed)return -1;
          if(a.analyzed&&!b.analyzed)return 1;
          return(a.score||9)-(b.score||9);
        });
        return(
          <div>
            {/* Stats row */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:8, marginBottom:16 }}>
              {[
                ["Total",pool.length,C.txt],
                ["Scored",scored.length,C.green],
                ["Unscored",unscored.length,C.orange],
                ["Gold",cnt.Gold,C.gold],
                ["Silver",cnt.Silver,C.silver],
                ["Tin/Slag",cnt.Tin+cnt.Slag,C.dim],
              ].map(([lb,val,cl])=>(
                <div key={lb} style={{ background:C.card, border:`1px solid ${C.brd}`, borderRadius:6, padding:"10px 12px", textAlign:"center" }}>
                  <div style={{ fontSize:22, fontWeight:600, color:cl }}>{val}</div>
                  <div style={{ ...mono, fontSize:10, color:C.dim, marginTop:2, textTransform:"uppercase", letterSpacing:"0.06em" }}>{lb}</div>
                </div>
              ))}
            </div>

            {/* Batch controls */}
            <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:10 }}>
              <button disabled={!!bulkScoring||!unscored.length} onClick={async()=>{
                if(!unscored.length)return;
                setBulkScoring({done:0,total:unscored.length});
                for(let i=0;i<unscored.length;i++){
                  const a=unscored[i];
                  try{
                    const parsed=await clientAssay({name:a.name,web:a.web,vert:a.vert,customIntel:getActiveIntel(),exampleAccts:getActiveExamples(),stage:a.stage||"Prospecting"});
                    onUpdatePoolEntry&&onUpdatePoolEntry(a.id,{...parsed,sigs:parsed.keySignals||[],ucs:parsed.useCases||[],prods:parsed.products||[],bm:parsed.businessModel||"",pf:parsed.productFit||"",dis:parsed.disqualifier||null,linkedin:parsed.linkedin||a.linkedin||"",analyzed:true});
                  }catch(e){}
                  setBulkScoring({done:i+1,total:unscored.length});
                  if(i<unscored.length-1)await new Promise(r=>setTimeout(r,1200));
                }
                setBulkScoring(null);
              }} style={{ padding:"8px 20px", background:unscored.length?C.tinBg:C.sur, border:`1px solid ${unscored.length?C.tinBdr:C.brd}`, color:bulkScoring||!unscored.length?C.dim:C.tin, borderRadius:7, cursor:bulkScoring||!unscored.length?"not-allowed":"pointer", fontSize:14, fontWeight:500, minWidth:240 }}>
                {bulkScoring?`⬟ Scoring ${bulkScoring.done} / ${bulkScoring.total}…`:`⬟ Score all unscored (${unscored.length})`}
              </button>
              {bulkScoring&&(
                <span style={{ ...mono, fontSize:11, color:C.dim }}>
                  ~{Math.max(1,Math.round(((bulkScoring.total-bulkScoring.done)*1.2)/60))}m remaining
                </span>
              )}
              {!bulkScoring&&!unscored.length&&scored.length>0&&(
                <span style={{ ...mono, fontSize:11, color:C.green }}>✓ All accounts scored</span>
              )}
            </div>

            {/* Progress bar */}
            {bulkScoring&&(
              <div style={{ height:3, background:C.brd, borderRadius:2, marginBottom:14, overflow:"hidden" }}>
                <div style={{ height:"100%", width:`${Math.round((bulkScoring.done/bulkScoring.total)*100)}%`, background:C.tin, transition:"width 0.5s ease", borderRadius:2 }}/>
              </div>
            )}

            {/* Account table */}
            <div style={{ border:`1px solid ${C.brd}`, borderRadius:8, overflow:"hidden" }}>
              <div style={{ display:"grid", gridTemplateColumns:"2.5fr 1fr 1.2fr 100px", gap:8, padding:"7px 12px", background:C.card, borderBottom:`1px solid ${C.brd}` }}>
                {["Account","Vertical","Status",""].map((h,i)=>(
                  <span key={i} style={{ ...mono, fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>{h}</span>
                ))}
              </div>
              {sortedPool.map(a=>{
                const ts=TS[a.tier]||{};
                const isRunning=assaying===a.id;
                const isBusy=!!assaying||!!bulkScoring;
                return(
                  <div key={a.id} style={{ display:"grid", gridTemplateColumns:"2.5fr 1fr 1.2fr 100px", gap:8, padding:"8px 12px", borderBottom:`1px solid ${C.brd}22`, alignItems:"center", background:a.analyzed?C.bg:C.sur }}>
                    <div style={{ minWidth:0 }}>
                      <span style={{ fontSize:13, color:C.txt, display:"block", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{a.name}</span>
                      {a.bm&&<span style={{ ...mono, fontSize:10, color:C.dim, display:"block", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{a.bm.slice(0,70)}{a.bm.length>70?"…":""}</span>}
                    </div>
                    <span style={{ fontSize:12, color:VERT_C[a.vert]||C.mut }}>{a.vert||"—"}</span>
                    <div>
                      {isRunning
                        ? <span style={{ ...mono, fontSize:11, color:C.tin }}>● scoring…</span>
                        : a.analyzed
                          ? <span style={{ ...mono, fontSize:11, padding:"2px 7px", border:`1px solid ${ts.b||C.brd}`, borderRadius:3, color:ts.c||C.dim, background:ts.bg||"transparent" }}>{ts.i?`${ts.i} `:""}{ a.tier}</span>
                          : <span style={{ ...mono, fontSize:11, color:C.orange }}>● unscored</span>
                      }
                    </div>
                    <button onClick={()=>runAssay(a)} disabled={isBusy} style={{ ...mono, fontSize:11, padding:"3px 10px", background:C.tinBg, border:`1px solid ${C.tinBdr}`, color:isBusy?C.dim:C.tin, borderRadius:4, cursor:isBusy?"not-allowed":"pointer", textAlign:"center" }}>
                      {isRunning?"…":a.analyzed?"↺ Re-score":"⬟ Score"}
                    </button>
                  </div>
                );
              })}
            </div>

            {pool.length>0&&(
              <p style={{ ...mono, fontSize:11, color:C.dim, marginTop:10, textAlign:"center" }}>{scored.length} of {pool.length} scored</p>
            )}
          </div>
        );
      })()}
    </div>
  );
}

export default ClaimJumperPage;
