import React, { useState } from 'react';
import { C, TS, mono } from '../constants/colors';
import { T } from '../constants/tokens';
import { voiceDocsKey, voiceProfileKey } from '../constants/voice';
import { saveVoiceProfile } from '../utils/db';
import FrontierEmailPanel from './frontier/FrontierEmailPanel';
import IntentFeed from './intent/IntentFeed';
import OutboundCard from './OutboundCard';
import { migrateOutboundEntry, bucketFor } from '../utils/outbound';
import { STATUS_EMOJI } from '../constants/frontierStatus';
import { daysSinceIso } from '../utils/dates';
import { MODELS } from '../config/models';

// ─── Duplicated small helpers (from App.js top-level) ─────────────────────────
const SF_BASE = "https://your-org.lightning.force.com/lightning/r/Account/";

const toSfdcUrl = v => {
  if(!v) return null;
  if(v.startsWith("http")) return v;
  if(/^[a-zA-Z0-9]{15,18}$/.test(v.trim())) return `${SF_BASE}${v.trim()}/view`;
  return null;
};

const trackStat=(key,by=1)=>{
  try{
    const raw=localStorage.getItem("prospector_stats")||"{}";
    const s=JSON.parse(raw);
    s[key]=(s[key]||0)+by;
    localStorage.setItem("prospector_stats",JSON.stringify(s));
  }catch{}
};

// ─── Stealth-only constants (frontier statuses live in constants/frontierStatus.js) ────
const STEALTH_STATUSES = ["Seeded","Outbounded","Replied","Meeting Booked","In Pipeline","Won"];
const STEALTH_STATUS_C = { "Seeded":C.dim, "Outbounded":C.blue, "Replied":C.tin, "Meeting Booked":C.green, "In Pipeline":C.purple, "Won":C.gold };

// ─── HUD palette ────────────────────────────────────────────────────────────
const NEON       = T.neon;
const CYAN_NEON  = T.cyan;
const AMBER_NEON = T.amber;
const HUD = {
  pageBg:    T.bg.base,
  cardBg:    '#0a1810',
  cardBdr:   '#1a3a1a',
  rowBg:     '#0a1410',
  rowBgExp:  '#0c1a10',
  rowBdr:    '#142a16',
  rowBdrExp: '#2a4a2a',
  txt:       '#cfe8d4',
  mut:       '#5a6a5a',
  dim:       '#3a4a3a',
};
const TIER_BORDER = { Gold: T.tier.gold, Silver: T.tier.silver, Tin: T.tier.tin };

async function learnVoiceFromText(text, userName, userEmail) {
  if (!text || text.length < 50 || !userName) return;
  try {
    const key = voiceDocsKey(userName);
    const existing = JSON.parse(localStorage.getItem(key) || "[]").filter(d => !d.baseline);
    const newDoc = { id:`vd_${Date.now()}`, name:`Message ${new Date().toLocaleDateString()}`, active:true, createdAt:new Date().toISOString(), content:text };
    const updated = [...existing, newDoc].slice(-20);
    localStorage.setItem(key, JSON.stringify(updated));
    const corpus = updated.filter(d=>d.active).map(d=>d.content).join("\n\n---\n\n");
    const res = await fetch("/api/analyze-voice", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ emailText:corpus }) });
    const data = await res.json();
    if (data.profile) {
      localStorage.setItem(voiceProfileKey(userName), JSON.stringify(data.profile));
      saveVoiceProfile(userEmail, data.profile);
    }
  } catch {}
}

// ─── StealthTab ───────────────────────────────────────────────────────────────
function StealthTab({ user, list=[], onSaveList, accounts=[], onPromoteToAccount, onSfStatus }) {
  const [url,setUrl]=useState("");
  const [manualCtx,setManualCtx]=useState("");
  const [loading,setLoading]=useState(false);
  const [result,setResult]=useState(null);
  const [email,setEmail]=useState("");
  const [err,setErr]=useState(null);
  const [copied,setCopied]=useState(false);

  // Auto-show context box for /in/ URLs (individual profiles — always auth-walled)
  const isProfileUrl = url.toLowerCase().includes("/in/");
  const [emailOpenId,setEmailOpenId]=useState(null);
  const [signalsOpenId,setSignalsOpenId]=useState(null);
  const [rowEmailDraft,setRowEmailDraft]=useState({});
  const [rowCopied,setRowCopied]=useState(null);
  const [rowEmailGenerating,setRowEmailGenerating]=useState(null);

  const generateStealthEmail=async(s)=>{
    setRowEmailGenerating(s.id);
    const ctx=[
      s.founderName?`Founder: ${s.founderName}`:"",
      s.founderTitle?`Title: ${s.founderTitle}`:"",
      s.founderBackground?.length?`Background: ${s.founderBackground.join(", ")}`:"",
      s.companyName?`Company: ${s.companyName}`:"",
      s.whatTheyBuild?`What they build: ${s.whatTheyBuild}`:"",
      s.companyStage&&s.companyStage!=="unknown"?`Stage: ${s.companyStage}`:"",
      s.fintechRelevance&&s.fintechRelevance!=="none"?`Fintech relevance: ${s.fintechRelevance}`:"",
      s.website?`Website: ${s.website}`:"",
      s.signals?.length?`Signals: ${s.signals.join("; ")}`:"",
    ].filter(Boolean).join("\n");
    try{
      const res=await fetch("/proxy/anthropic/messages",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          model:MODELS.FAST,
          max_tokens:400,
          messages:[{role:"user",content:`You are an SMB AE named ${user?.name||"AE"}. Write a concise, warm cold outreach email to this early-stage founder. The goal is to plant a seed — not pitch hard. Reference something specific about what they're building. Mention our product naturally only if it's a clear fit. Keep it under 120 words. No subject line. No placeholders.

FOUNDER INFO:
${ctx}

Write only the email body.`}]
        })
      });
      const d=await res.json();
      const text=(d.content?.[0]?.text||"").trim();
      if(text){
        setRowEmailDraft(draft=>({...draft,[s.id]:text}));
        onSaveList(sl=>sl.map(x=>x.id===s.id?{...x,email:text}:x));
      }
    }catch(e){console.error(e);}
    setRowEmailGenerating(null);
  };

  const run=async()=>{
    if(!url.trim())return;
    setLoading(true);setResult(null);setErr(null);setEmail("");
    try{
      const r=await fetch("/api/stealth",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({linkedinUrl:url.trim(),senderName:user?.name?.split(" ")[0]||"AE",manualContext:manualCtx.trim()||null})
      });
      const d=await r.json();
      if(d.error){setErr(d.error);}
      else{setResult(d);setEmail(d.email||"");}
    }catch(e){setErr(e.message);}
    setLoading(false);
  };

  const copy=()=>{navigator.clipboard.writeText(email).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),1500);trackStat("emails_sent");});};

  const saveToList=()=>{
    if(!result)return;
    const displayName=result.companyName||(result.isPlaceholder?null:"Unknown");
    const entry={
      id:Date.now(),
      date:new Date().toISOString().slice(0,10),
      status:"Seeded",
      isPlaceholder:result.isPlaceholder||false,
      linkedinCompany:result.linkedinCompany||"",
      companyName:displayName,
      founderName:result.founderName||"",
      founderTitle:result.founderTitle||"",
      founderBackground:result.founderBackground||[],
      companyStage:result.stage||"unknown",
      fintechRelevance:result.fintechRelevance||"unknown",
      whatTheyBuild:result.whatTheyBuild||"",
      signals:result.signals||[],
      website:result.website||null,
      linkedinUrl:url.trim(),
      email,
      promoted:false,
    };
    onSaveList(sl=>[entry,...sl.filter(x=>x.linkedinUrl!==entry.linkedinUrl)]);
  };

  const updateStatus=(id,status)=>onSaveList(sl=>sl.map(x=>x.id===id?{...x,status}:x));
  const removeFromList=(id)=>onSaveList(sl=>sl.filter(x=>x.id!==id));

  const resolvedName=(entry)=>entry.companyName||(entry.isPlaceholder?"Unknown (stealth)":"Unknown");
  const isPromoted=(entry)=>entry.promoted||accounts.some(a=>a.stealthId===entry.id||(a.stealthOrigin&&entry.companyName&&a.name.toLowerCase()===entry.companyName.toLowerCase()));
  const getAccountStage=(entry)=>{
    const a=accounts.find(acc=>acc.stealthId===entry.id||(acc.stealthOrigin&&entry.companyName&&acc.name.toLowerCase()===entry.companyName.toLowerCase()));
    return a?.stage||null;
  };

  const stageC={ stealth:C.purple, "pre-seed":C.purple, early:C.blue, seed:C.green, "series-a":C.gold, unknown:C.dim };
  const relC={ high:C.green, medium:C.blue, low:C.tin, none:C.dim, unknown:C.dim };
  const inp={fontSize:14,padding:"9px 12px",background:C.sur,border:`1px solid ${C.brd}`,borderRadius:6,color:C.txt,outline:"none",flex:1};
  const btn=(bg,bd,c)=>({fontSize:13,padding:"7px 14px",background:bg,border:`1px solid ${bd}`,color:c,borderRadius:5,cursor:"pointer",...mono});
  const pill=(c)=>({...mono,fontSize:11,padding:"2px 7px",borderRadius:9,background:`${c}22`,border:`1px solid ${c}44`,color:c});

  const funnelCounts = STEALTH_STATUSES.map(s=>({ s, n:list.filter(x=>{
    if(s==="Won") return x.status==="Won"||(x.promoted&&getAccountStage(x)==="Closed Won");
    return x.status===s;
  }).length }));

  return(
    <div>
      <div style={{ display:"flex",alignItems:"baseline",gap:12,marginBottom:4 }}>
        <p style={{ margin:0, fontSize:17, fontWeight:500, color:C.txt }}>Stealth Mode</p>
        {list.length>0&&(
          <div style={{ display:"flex",gap:10,alignItems:"center" }}>
            {funnelCounts.filter(f=>f.n>0).map(f=>(
              <span key={f.s} style={{ ...mono,fontSize:11,color:STEALTH_STATUS_C[f.s]||C.dim }}>{f.s} <strong>{f.n}</strong></span>
            ))}
          </div>
        )}
      </div>
      <p style={{ ...mono, margin:"0 0 14px", fontSize:13, color:C.mut }}>Early-stage founders — stealth, pre-seed, seed, or recently launched. Get on their radar before they choose vendors.</p>

      {/* Input */}
      <div style={{ display:"flex",flexDirection:"column",gap:8,marginBottom:16 }}>
        <div style={{ display:"flex",gap:8 }}>
          <input
            style={inp}
            placeholder="https://www.linkedin.com/in/founder/ or /company/real-startup/"
            value={url}
            onChange={e=>{ setUrl(e.target.value); setResult(null); setErr(null); }}
            onKeyDown={e=>e.key==="Enter"&&!isProfileUrl&&run()}
          />
          <button onClick={run} disabled={loading||!url.trim()||(isProfileUrl&&!manualCtx.trim())} style={{ ...btn(loading?"transparent":C.goldBg,loading?C.brd:C.goldBdr,loading?C.dim:C.gold), opacity:(loading||(isProfileUrl&&!manualCtx.trim()))?0.5:1, flexShrink:0 }}>
            {loading?"Scanning…":"Run →"}
          </button>
        </div>

        {/* Profile URL → always show context paste (LinkedIn blocks /in/ scraping) */}
        {isProfileUrl&&(
          <div style={{ background:C.sur,border:`1px solid ${C.orange}44`,borderRadius:7,padding:"10px 12px" }}>
            <p style={{ ...mono,margin:"0 0 6px",fontSize:11,color:C.orange }}>
              ⚠ LinkedIn blocks profile scraping — paste a few lines from their profile below (headline, About, recent post, or any context you can see)
            </p>
            <textarea
              value={manualCtx}
              onChange={e=>setManualCtx(e.target.value)}
              placeholder={`e.g. "Co-founder at Stealth Startup. Ex-Stripe PM. Building the next layer of ACH infrastructure for embedded finance. Posted about real-time payments last week."`}
              style={{ width:"100%",boxSizing:"border-box",minHeight:90,fontSize:13,lineHeight:1.5,padding:"8px 10px",background:C.card,border:`1px solid ${C.brd}`,borderRadius:5,color:C.txt,outline:"none",resize:"vertical",fontFamily:"inherit" }}
            />
          </div>
        )}

        {/* Company URL → auto-scrapes, but offer extra context */}
        {!isProfileUrl&&url.trim()&&(
          <div>
            <button
              onClick={()=>setManualCtx(manualCtx||" ")}
              style={{ ...mono,fontSize:11,padding:"3px 8px",background:"transparent",border:`1px solid ${C.brd}`,color:C.dim,borderRadius:4,cursor:"pointer" }}
            >+ add context</button>
            {manualCtx.trim()&&(
              <textarea
                value={manualCtx}
                onChange={e=>setManualCtx(e.target.value)}
                placeholder="Optional: paste extra context about this founder (LinkedIn posts, AngelList bio, hiring posts…)"
                style={{ marginTop:6,width:"100%",boxSizing:"border-box",minHeight:70,fontSize:13,lineHeight:1.5,padding:"8px 10px",background:C.sur,border:`1px solid ${C.brd}`,borderRadius:5,color:C.txt,outline:"none",resize:"vertical",fontFamily:"inherit" }}
              />
            )}
          </div>
        )}
      </div>

      {/* Error */}
      {err&&<div style={{ padding:"10px 14px",background:"#1A0808",border:`1px solid ${C.red}44`,borderRadius:7,marginBottom:14 }}><p style={{ ...mono,margin:0,fontSize:13,color:C.red }}>{err}</p></div>}

      {/* Results */}
      {result&&(
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:20 }}>
          {/* Signals card — founder-first */}
          <div style={{ background:C.card,border:`1px solid ${result.isPlaceholder?C.orange+"55":C.brd}`,borderRadius:8,padding:"14px 16px" }}>
            {result.isPlaceholder&&(
              <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:10,padding:"5px 9px",background:"#1A0C00",border:`1px solid ${C.orange}44`,borderRadius:5 }}>
                <span style={{ fontSize:13 }}>⚠</span>
                <span style={{ ...mono,fontSize:11,color:C.orange }}>Shared placeholder — "<strong>{result.linkedinCompany||"Stealth Startup"}</strong>" is not a real company</span>
              </div>
            )}
            <p style={{ ...mono,margin:"0 0 10px",fontSize:11,fontWeight:500,color:C.mut,textTransform:"uppercase",letterSpacing:"0.09em" }}>Founder signals</p>
            {/* Founder (primary) */}
            <div style={{ marginBottom:8 }}>
              <p style={{ margin:"0 0 2px",fontSize:16,fontWeight:600,color:C.txt }}>{result.founderName||"Unknown founder"}</p>
              {result.founderTitle&&<p style={{ ...mono,margin:"0 0 4px",fontSize:12,color:C.mut }}>{result.founderTitle}</p>}
              {result.founderBackground?.length>0&&(
                <div style={{ display:"flex",gap:4,flexWrap:"wrap",marginTop:4 }}>
                  {result.founderBackground.map((b,i)=><span key={i} style={{ ...mono,fontSize:11,padding:"1px 6px",borderRadius:8,background:C.sur,border:`1px solid ${C.brd}`,color:C.tin }}>{b}</span>)}
                </div>
              )}
            </div>
            {/* Real company (secondary) */}
            <div style={{ marginBottom:8,paddingTop:8,borderTop:`1px solid ${C.brd}` }}>
              <p style={{ ...mono,margin:"0 0 3px",fontSize:10,color:C.dim,textTransform:"uppercase",letterSpacing:"0.08em" }}>Real company</p>
              <p style={{ margin:0,fontSize:14,fontWeight:500,color:result.companyName?C.txt:C.dim,fontStyle:result.companyName?"normal":"italic" }}>
                {result.companyName||"Unknown — still in stealth"}
              </p>
            </div>
            {result.whatTheyBuild&&<p style={{ margin:"0 0 10px",fontSize:13,color:C.silver,lineHeight:1.5 }}>{result.whatTheyBuild}</p>}
            <div style={{ display:"flex",gap:5,flexWrap:"wrap",marginBottom:10 }}>
              {result.stage&&<span style={pill(stageC[result.stage]||C.dim)}>{result.stage}</span>}
              {result.fintechRelevance&&result.fintechRelevance!=="none"&&<span style={pill(relC[result.fintechRelevance]||C.dim)}>fintech: {result.fintechRelevance}</span>}
              {result.scraped&&<span style={pill(C.dim)}>scraped</span>}
              {result.website&&<a href={result.website} target="_blank" rel="noreferrer" style={{ ...pill(C.tin),textDecoration:"none" }}>↗ site</a>}
            </div>
            {result.signals?.length>0&&(
              <div>
                <p style={{ ...mono,margin:"0 0 5px",fontSize:10,color:C.dim,textTransform:"uppercase",letterSpacing:"0.08em" }}>signals</p>
                {result.signals.map((s,i)=><p key={i} style={{ ...mono,margin:"0 0 3px",fontSize:12,color:C.mut }}>· {s}</p>)}
              </div>
            )}
          </div>

          {/* Email card */}
          <div style={{ background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:"14px 16px",display:"flex",flexDirection:"column",gap:10 }}>
            <p style={{ ...mono,margin:0,fontSize:11,fontWeight:500,color:C.mut,textTransform:"uppercase",letterSpacing:"0.09em" }}>Relationship seed email</p>
            <textarea
              value={email}
              onChange={e=>setEmail(e.target.value)}
              style={{ flex:1,minHeight:160,fontSize:14,lineHeight:1.55,padding:"10px 12px",background:C.sur,border:`1px solid ${C.brd}`,borderRadius:6,color:C.txt,outline:"none",resize:"vertical",fontFamily:"inherit" }}
            />
            <div style={{ display:"flex",gap:7 }}>
              <button onClick={copy} disabled={!email} style={{ ...btn(C.sur,C.brd,copied?C.green:C.mut), opacity:email?1:0.4 }}>{copied?"Copied ✓":"Copy"}</button>
              <button onClick={saveToList} style={{ ...btn(C.goldBg,C.goldBdr,C.gold) }}>Save to list</button>
            </div>
          </div>
        </div>
      )}

      {/* Saved stealth list */}
      {list.length>0&&(
        <div>
          <p style={{ ...mono,margin:"0 0 8px",fontSize:11,fontWeight:500,color:C.mut,textTransform:"uppercase",letterSpacing:"0.09em" }}>Pipeline — {list.length} seeded</p>
          <div style={{ display:"grid",gridTemplateColumns:"2fr 1.6fr 1.4fr 1fr 54px 36px 80px 36px",gap:8,padding:"4px 10px",marginBottom:4 }}>
            {["Founder · Company","Background","Building","Status","SF","","",""].map((h,i)=><span key={i} style={{ ...mono,fontSize:11,fontWeight:500,color:C.dim,textTransform:"uppercase" }}>{h}</span>)}
          </div>
          {list.map(s=>{
            const promoted=isPromoted(s);
            const acctStage=getAccountStage(s);
            const isWon=s.status==="Won"||(promoted&&acctStage==="Closed Won");
            const sc=STEALTH_STATUS_C[s.status]||C.dim;
            const sigOpen=signalsOpenId===s.id;
            const draft=rowEmailDraft[s.id]!==undefined?rowEmailDraft[s.id]:s.email||"";
            const isCopied=rowCopied===s.id;
            const copyRow=()=>{ navigator.clipboard.writeText(draft).then(()=>{ setRowCopied(s.id); setTimeout(()=>setRowCopied(null),1500); }); };
            const saveDraft=()=>{ onSaveList(sl=>sl.map(x=>x.id===s.id?{...x,email:draft}:x)); };
            const rName=resolvedName(s);
            const rowBorder=isWon?C.goldBdr:sigOpen?C.purple+"66":s.isPlaceholder?C.orange+"33":C.brd;
            // Only use website if it's a real non-LinkedIn URL
            const safeWeb=s.website&&!s.website.toLowerCase().includes("linkedin")&&s.website.startsWith("http")?s.website:null;
            return(
              <div key={s.id} style={{ marginBottom:3 }}>
                <div style={{ display:"grid",gridTemplateColumns:"2fr 1.6fr 1.4fr 1fr 54px 36px 80px 36px",gap:8,padding:"9px 10px",background:isWon?"#1A1200":C.card,border:`1px solid ${rowBorder}`,borderRadius:sigOpen?"7px 7px 0 0":7,alignItems:"start" }}>
                  <div style={{ minWidth:0 }}>
                    <p style={{ margin:"0 0 1px",fontSize:14,fontWeight:600,color:isWon?C.gold:C.txt,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>
                      {s.founderName||"Unknown founder"}
                    </p>
                    <div style={{ display:"flex",alignItems:"center",gap:4 }}>
                      {s.isPlaceholder&&<span style={{ ...mono,fontSize:10,color:C.orange }}>⚠</span>}
                      {safeWeb
                        ?<a href={safeWeb} target="_blank" rel="noreferrer" style={{ ...mono,fontSize:11,color:s.companyName?C.tin:C.dim,fontStyle:s.companyName?"normal":"italic",textDecoration:"none",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }} onMouseOver={e=>e.target.style.color=C.txt} onMouseOut={e=>e.target.style.color=s.companyName?C.tin:C.dim}>{rName}</a>
                        :<span style={{ ...mono,fontSize:11,color:s.companyName?C.mut:C.dim,fontStyle:s.companyName?"normal":"italic" }}>{rName}</span>
                      }
                      {promoted&&acctStage&&<span style={{ ...mono,fontSize:10,color:C.purple }}> · {acctStage}</span>}
                    </div>
                    <p style={{ ...mono,margin:"1px 0 0",fontSize:10,color:C.dim }}>{s.date}</p>
                  </div>
                  <div style={{ display:"flex",gap:3,flexWrap:"wrap",alignItems:"flex-start",paddingTop:2 }}>
                    {s.founderBackground?.length>0
                      ?s.founderBackground.slice(0,3).map((b,i)=><span key={i} style={{ ...mono,fontSize:10,padding:"1px 5px",borderRadius:7,background:C.sur,border:`1px solid ${C.brd}`,color:C.tin,whiteSpace:"nowrap" }}>{b}</span>)
                      :<span style={{ fontSize:12,color:C.dim }}>—</span>
                    }
                  </div>
                  {/* Building — wraps */}
                  <span style={{ fontSize:12,color:C.dim,lineHeight:1.4 }}>{s.whatTheyBuild||"—"}</span>
                  <select
                    value={isWon?"Won":s.status}
                    onChange={e=>updateStatus(s.id,e.target.value)}
                    style={{ fontSize:12,padding:"3px 6px",background:C.bg,border:`1px solid ${sc}55`,borderRadius:4,color:sc,outline:"none",cursor:"pointer",width:"100%" }}
                  >
                    {STEALTH_STATUSES.map(st=><option key={st} value={st}>{st}</option>)}
                  </select>
                  {/* SF status toggle */}
                  {(()=>{
                    const sf=s.sfStatus;
                    const sfC=sf==="in_sf"?C.green:sf==="missing"?C.orange:C.dim;
                    const sfLbl=sf==="in_sf"?"☁ ✓":sf==="missing"?"☁ ✗":"☁ ?";
                    const sfTitle=sf==="in_sf"?"In Salesforce — click to clear":sf==="missing"?"Not in SF — BDR to create (click to mark done)":"Not checked — click to flag as missing";
                    const nextSf=sf==="missing"?"in_sf":sf==="in_sf"?null:"missing";
                    return(
                      <button onClick={()=>onSfStatus&&onSfStatus(s.id,nextSf)} title={sfTitle}
                        style={{ ...mono,fontSize:11,padding:"3px 7px",background:sf?`${sfC}18`:"transparent",border:`1px solid ${sfC}55`,color:sfC,borderRadius:4,cursor:"pointer",whiteSpace:"nowrap" }}
                      >{sfLbl}</button>
                    );
                  })()}
                  {/* Expand card — ◈ only, ✉ removed (redundant) */}
                  <button onClick={()=>setSignalsOpenId(sigOpen?null:s.id)} title="View founder card + email"
                    style={{ ...btn(sigOpen?"#160A2A":C.sur,sigOpen?C.purple+"66":C.brd,sigOpen?C.purple:C.dim), padding:"4px 7px", fontSize:12 }}
                  >◈</button>
                  <button
                    onClick={()=>!promoted&&onPromoteToAccount&&onPromoteToAccount(s)}
                    disabled={promoted}
                    title={promoted?"Already in pipeline":"Promote to Accounts"}
                    style={{ ...btn(promoted?"transparent":C.sur,promoted?C.brd:C.purple,promoted?C.dim:C.purple), padding:"4px 8px", fontSize:11, opacity:promoted?0.5:1, cursor:promoted?"default":"pointer" }}
                  >{promoted?"In pipeline":"→ Accts"}</button>
                  <button onClick={()=>removeFromList(s.id)} style={{ fontSize:12,padding:"3px 6px",background:"transparent",border:`1px solid ${C.brd}`,color:C.dim,borderRadius:4,cursor:"pointer" }}>✕</button>
                </div>

                {/* Signals panel — full card layout */}
                {sigOpen&&(
                  <div style={{ border:`1px solid ${C.purple}44`,borderTop:"none",borderRadius:"0 0 7px 7px",overflow:"hidden" }}>
                    <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:0 }}>
                      {/* Left — founder signals */}
                      <div style={{ background:"#0E0818",padding:"14px 16px",borderRight:`1px solid ${C.purple}22` }}>
                        {s.isPlaceholder&&(
                          <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:10,padding:"5px 9px",background:"#1A0C00",border:`1px solid ${C.orange}44`,borderRadius:5 }}>
                            <span style={{ fontSize:13 }}>⚠</span>
                            <span style={{ ...mono,fontSize:11,color:C.orange }}>Shared placeholder — "<strong>{s.linkedinCompany||"Stealth Startup"}</strong>" is not a real company</span>
                          </div>
                        )}
                        <p style={{ ...mono,margin:"0 0 10px",fontSize:10,fontWeight:500,color:C.mut,textTransform:"uppercase",letterSpacing:"0.09em" }}>Founder signals</p>
                        <div style={{ marginBottom:8 }}>
                          <p style={{ margin:"0 0 2px",fontSize:15,fontWeight:600,color:C.txt }}>{s.founderName||"Unknown founder"}</p>
                          {s.founderTitle&&<p style={{ ...mono,margin:"0 0 4px",fontSize:12,color:C.mut }}>{s.founderTitle}</p>}
                          {s.founderBackground?.length>0&&(
                            <div style={{ display:"flex",gap:4,flexWrap:"wrap",marginTop:4 }}>
                              {s.founderBackground.map((b,i)=><span key={i} style={{ ...mono,fontSize:11,padding:"1px 6px",borderRadius:8,background:C.sur,border:`1px solid ${C.brd}`,color:C.tin }}>{b}</span>)}
                            </div>
                          )}
                        </div>
                        <div style={{ marginBottom:8,paddingTop:8,borderTop:`1px solid ${C.brd}` }}>
                          <p style={{ ...mono,margin:"0 0 3px",fontSize:10,color:C.dim,textTransform:"uppercase",letterSpacing:"0.08em" }}>Real company</p>
                          {s.website
                            ?<a href={s.website} target="_blank" rel="noreferrer" style={{ margin:0,fontSize:14,fontWeight:500,color:s.companyName?C.tin:C.dim,fontStyle:s.companyName?"normal":"italic",textDecoration:"none" }}>{s.companyName||"Unknown — still in stealth"}</a>
                            :<p style={{ margin:0,fontSize:14,fontWeight:500,color:s.companyName?C.txt:C.dim,fontStyle:s.companyName?"normal":"italic" }}>{s.companyName||"Unknown — still in stealth"}</p>
                          }
                        </div>
                        {s.whatTheyBuild&&<p style={{ margin:"0 0 10px",fontSize:13,color:C.silver,lineHeight:1.5 }}>{s.whatTheyBuild}</p>}
                        <div style={{ display:"flex",gap:5,flexWrap:"wrap",marginBottom:10 }}>
                          {s.companyStage&&s.companyStage!=="unknown"&&<span style={{ ...pill(stageC[s.companyStage]||C.dim) }}>{s.companyStage}</span>}
                          {s.fintechRelevance&&s.fintechRelevance!=="none"&&s.fintechRelevance!=="unknown"&&<span style={{ ...pill(relC[s.fintechRelevance]||C.dim) }}>fintech: {s.fintechRelevance}</span>}
                          {s.linkedinUrl&&<a href={s.linkedinUrl} target="_blank" rel="noreferrer" style={{ ...pill(C.tin),textDecoration:"none" }}>↗ LinkedIn</a>}
                          {s.website&&<a href={s.website} target="_blank" rel="noreferrer" style={{ ...pill(C.tin),textDecoration:"none" }}>↗ site</a>}
                        </div>
                        {s.signals?.length>0&&(
                          <div style={{ marginBottom:12 }}>
                            <p style={{ ...mono,margin:"0 0 5px",fontSize:10,color:C.dim,textTransform:"uppercase",letterSpacing:"0.08em" }}>signals</p>
                            {s.signals.map((sig,i)=><p key={i} style={{ ...mono,margin:"0 0 3px",fontSize:12,color:C.mut }}>· {sig}</p>)}
                          </div>
                        )}
                      </div>
                      {/* Right — email */}
                      <div style={{ background:"#0A0A10",padding:"14px 16px",display:"flex",flexDirection:"column",gap:10 }}>
                        <p style={{ ...mono,margin:0,fontSize:10,fontWeight:500,color:C.mut,textTransform:"uppercase",letterSpacing:"0.09em" }}>Relationship seed email</p>
                        <textarea
                          value={draft}
                          onChange={e=>setRowEmailDraft(d=>({...d,[s.id]:e.target.value}))}
                          style={{ flex:1,minHeight:200,fontSize:13,lineHeight:1.55,padding:"9px 11px",background:C.sur,border:`1px solid ${C.brd}`,borderRadius:5,color:C.txt,outline:"none",resize:"vertical",fontFamily:"inherit" }}
                        />
                        <div style={{ display:"flex",gap:7,flexWrap:"wrap" }}>
                          <button
                            onClick={()=>generateStealthEmail(s)}
                            disabled={!!rowEmailGenerating}
                            style={{ ...btn(`${C.purple}18`,`${C.purple}55`,rowEmailGenerating===s.id?C.dim:C.purple), fontWeight:500 }}
                          >{rowEmailGenerating===s.id?"⬡ Writing…":"✦ Generate"}</button>
                          <button onClick={copyRow} style={{ ...btn(C.sur,C.brd,isCopied?C.green:C.mut) }}>{isCopied?"Copied ✓":"Copy"}</button>
                          <button onClick={saveDraft} style={{ ...btn(C.sur,C.brd,C.tin) }}>Save edits</button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Frontier helpers ─────────────────────────────────────────────────────────
const CactusIcon = ({ color="#5A9A5A", size=20 }) => (
  <svg width={size} height={Math.round(size*1.2)} viewBox="0 0 20 24" fill={color} xmlns="http://www.w3.org/2000/svg">
    <rect x="8" y="0" width="4" height="20" rx="2"/>
    <rect x="2" y="8" width="7" height="3" rx="1.5"/>
    <rect x="2" y="5" width="3" height="8" rx="1.5"/>
    <rect x="11" y="11" width="7" height="3" rx="1.5"/>
    <rect x="15" y="8" width="3" height="8" rx="1.5"/>
    <rect x="7" y="20" width="6" height="4" rx="1"/>
  </svg>
);

const getLastTouch = f => {
  const tps = f.touchpoints || [];
  if (!tps.length) return null;
  return tps.reduce((latest, tp) => !latest || tp.date > latest ? tp.date : latest, null);
};
const isStaleFrontier = f => {
  const last = getLastTouch(f);
  return !last || daysSinceIso(last) >= 14;
};

function OutboundPage({ accounts, onNav, user, activeUser, perms={}, stealthList, onSaveStealthList, onPromoteToAccount, onSfStatus, frontier=[], onSaveFrontier, onAssignToBDR, onUnassignFromFrontier, onSetFrontierStatus, onRemoveDemoAccount, onHandoff, teamUsers=[], setAccounts, onCreateTask }) {
  const isBDR = activeUser?.role === 'BDR';
  const [intentExpanded,setIntentExpanded]=useState(false);
  const [stealthExpanded,setStealthExpanded]=useState(false);
  const [expandedId,setExpandedId]=useState(null);
  const [researchCopiedId,setResearchCopiedId]=useState(null);
  const [showColdSection,setShowColdSection]=useState(false);
  const [showBookedSection,setShowBookedSection]=useState(false);
  // Read once per render — kept lightweight so card-level trigger derivation
  // doesn't repeatedly parse localStorage.
  const intentHistory = (()=>{ try { return JSON.parse(localStorage.getItem('prospector_intent_history')||'[]'); } catch { return []; } })();
  const threadCache = (()=>{ try { return JSON.parse(localStorage.getItem('prospector_threads_cache')||'{}'); } catch { return {}; } })();
  // AE filter: "all" | "mine" | "bdr"
  const [ownerFilter,setOwnerFilter]=useState("all");
  // BDR sub-tab: "queue" | "territory"
  const [bdrTab,setBdrTab]=useState("queue");
  // Filter pills
  const [statusFilter,setStatusFilter]=useState(null);   // null = all
  const [priorityFilter,setPriorityFilter]=useState(null);
  const [tierFilter,setTierFilter]=useState(null);
  const [needsAttention,setNeedsAttention]=useState(false);
  const [loggedConfirmId,setLoggedConfirmId]=useState(null);

  // BDR multi-AE: compute assigned AEs and selected AE state
  const assignedAEIds = isBDR ? (activeUser?.assignedAEs || []) : [];
  const assignedAEs = assignedAEIds.map(id=>teamUsers.find(u=>u.id===id)).filter(Boolean);
  // null = "All AEs"; a specific id = filter to that AE's assignments
  const [selectedBDRAEId, setSelectedBDRAEId] = useState(null);
  const validBDRAEId = (selectedBDRAEId && assignedAEs.find(a=>a.id===selectedBDRAEId)) ? selectedBDRAEId : null;
  const selectedBDRAE = validBDRAEId ? assignedAEs.find(a=>a.id===validBDRAEId) : null;

  const updateFrontierEntry=(id,patch)=>onSaveFrontier(fl=>fl.map(f=>f.id===id?{...f,...patch}:f));
  const toggleExpand=(id)=>setExpandedId(x=>x===id?null:id);

  const buildResearchPrompt=(entry)=>{
    const me=activeUser||user;
    const role=me?.role||"BDR";
    const name=me?.name||"me";
    const company=me?.company||"Prospector";
    const context=role==="BDR"
      ? `I'm ${name}, a BDR at ${company}. I'm doing first-touch outreach for ${entry.name}.`
      : `I'm ${name}, an AE at ${company}. I'm working a deal with ${entry.name}.`;
    const lines=[
      context,
      entry.useCase            ? `Use case: ${entry.useCase}` : null,
      entry.products?.length   ? `Products: ${entry.products.join(", ")}` : null,
      entry.signals?.length    ? `Signals: ${entry.signals.join(", ")}` : null,
      entry.note               ? `Notes: ${entry.note}` : null,
      entry.web                ? `Website: ${entry.web}` : null,
      "",
      "Please help me research this account and provide relevant context",
      "for my outreach — industry trends, recent news, potential pain",
      "points, and how our products might fit their use case.",
    ].filter(l=>l!==null);
    return lines.join("\n");
  };
  const copyResearch=(entry)=>{
    try{
      navigator.clipboard.writeText(buildResearchPrompt(entry));
      setResearchCopiedId(entry.id);
      setTimeout(()=>setResearchCopiedId(x=>x===entry.id?null:x),1500);
    }catch{}
  };

  const logTouchpoint = (id, text) => {
    if (!text.trim()) return;
    const today = new Date().toISOString();
    const tp = { text: text.trim(), date: today };
    onSaveFrontier(fl => fl.map(f => f.id === id
      ? { ...f, touchpoints: [...(f.touchpoints||[]), tp], lastTouch: today }
      : f
    ));
    setLoggedConfirmId(id);
    setTimeout(() => setLoggedConfirmId(c => c===id ? null : c), 2000);
    const bdrName = isBDR ? myName : null;
    if (bdrName) learnVoiceFromText(text, bdrName, myEmail);
  };

  // Frontier rows visible to this role
  const myName  = activeUser?.name  || user?.name  || "AE";
  const myEmail = activeUser?.email || user?.email || "";
  const myId    = activeUser?.id    || user?.id    || null;
  const ownerFiltered = isBDR
    ? (()=>{
        // BDR sees items assigned to them — match by ID, always fall back to name
        const bdrItems = frontier.filter(f=>
          (f.assignedToId && f.assignedToId === myId) ||
          (f.assignedTo && f.assignedTo === myName)
        );
        // Multi-AE: filter down to selected AE's territory when one is chosen
        if (selectedBDRAE) {
          return bdrItems.filter(f=>(f.byId && f.byId===selectedBDRAE.id)||f.by===selectedBDRAE.name);
        }
        return bdrItems;
      })()
    : (()=>{
        // AE sees only their own frontier items
        const aeItems = frontier.filter(f=>(f.byId && f.byId===myId)||f.by===myName);
        if (ownerFilter==="mine") return aeItems.filter(f=>!f.assignedToId && !f.assignedTo);
        if (ownerFilter==="bdr")  return aeItems.filter(f=>f.assignedToId||f.assignedTo);
        return aeItems;
      })();
  const staleCount = frontier.filter(isStaleFrontier).length;
  const frontierRows = ownerFiltered
    .filter(f=>!needsAttention || isStaleFrontier(f))
    .filter(f=>!statusFilter   || f.status===statusFilter)
    .filter(f=>!priorityFilter || (f.priority||"")=== priorityFilter)
    .filter(f=>!tierFilter     || (f.tier||"")=== tierFilter);

  const handoffs=frontierRows.filter(f=>f.status==="Handoff complete");
  const pendingHandoffs=handoffs.filter(f=>{const acct=accounts.find(a=>a.name.toLowerCase()===f.name.toLowerCase());return !acct||acct.stage!=="Qualified";});

  // Accounts not yet in frontier (for BDR territory browse)
  const inFrontierNames=new Set(frontier.map(f=>f.name.toLowerCase()));
  const unassignedAccounts=accounts.filter(a=>!inFrontierNames.has(a.name.toLowerCase()));

  return(
    <div style={{ background:HUD.pageBg, borderRadius:10, padding:"10px" }}>
      {/* ── SECTION 1 — INTENT ─────────────────────────────────────────────── */}
      {(() => {
        const territoryDomains = new Set(accounts.map(a => {
          if(!a.web) return null;
          try { return new URL(a.web.startsWith('http')?a.web:`https://${a.web}`).hostname.replace(/^www\./,''); } catch { return null; }
        }).filter(Boolean));
        let hist=[]; try { hist=JSON.parse(localStorage.getItem('prospector_intent_history')||'[]'); } catch {}
        const inTerritory = hist.filter(e => territoryDomains.has(e.domain));
        const hotCount    = inTerritory.filter(e => ['Purchase','Decision'].includes(e.buyingStage)).length;
        const intentDot   = hotCount > 0;
        const summary     = `${inTerritory.length} account${inTerritory.length!==1?"s":""} showing intent · ${hotCount} HOT`;
        return (
          <div style={{ background:HUD.cardBg, borderRadius:10, padding:"14px 18px", border:`1px solid ${HUD.cardBdr}`, marginBottom:10 }}>
            <div onClick={()=>setIntentExpanded(e=>!e)} style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer", userSelect:"none" }}>
              <span style={{ ...mono, fontSize:14, color:NEON, textShadow:`0 0 8px ${NEON}66` }}>◆</span>
              <p style={{ ...mono, margin:0, fontSize:14, fontWeight:600, color:NEON, letterSpacing:"0.12em", textTransform:"uppercase", textShadow:`0 0 8px ${NEON}44` }}>Intent Radar</p>
              {intentDot && <span title="HOT account in territory" style={{ display:"inline-block", width:8, height:8, borderRadius:"50%", background:AMBER_NEON, boxShadow:`0 0 6px ${AMBER_NEON}` }}/>}
              <span style={{ ...mono, fontSize:11, color:HUD.mut }}>{summary}</span>
              <span style={{ marginLeft:"auto", ...mono, fontSize:11, color:NEON, letterSpacing:"0.06em", border:`1px solid ${NEON}44`, padding:"2px 8px", borderRadius:3 }}>[ {intentExpanded?"COLLAPSE":"EXPAND"} ]</span>
            </div>
            {intentExpanded && (
              <div style={{ marginTop:14 }}>
                <IntentFeed accounts={accounts} activeUser={activeUser} user={user} teamUsers={teamUsers}/>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── SECTION 2 — THE FRONTIER ───────────────────────────────────────── */}
      <div style={{ background:HUD.cardBg, borderRadius:10, border:`1px solid ${HUD.cardBdr}`, padding:"16px 18px", minHeight:400, position:"relative", overflow:"hidden", marginBottom:10 }}>
          {/* Tumbleweed watermark */}
          <div style={{ position:"absolute", top:8, right:16, opacity:0.08, pointerEvents:"none", userSelect:"none" }}>
            <CactusIcon color={NEON} size={80}/>
          </div>

          {/* Header */}
          <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14, flexWrap:"wrap" }}>
            <div>
              <p style={{ ...mono, margin:"0 0 2px", fontSize:14, fontWeight:600, color:NEON, letterSpacing:"0.12em", textTransform:"uppercase", textShadow:`0 0 8px ${NEON}44`, display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ textShadow:`0 0 8px ${NEON}66` }}>◆</span>
                The Frontier
              </p>
              <p style={{ ...mono, margin:0, fontSize:12, color:HUD.mut }}>
                {isBDR
                  ? (()=>{
                      const from = selectedBDRAE
                        ? `from ${selectedBDRAE.name.split(" ")[0]}`
                        : assignedAEs.length > 1
                        ? `across ${assignedAEs.length} AEs`
                        : assignedAEs[0] ? `from ${assignedAEs[0].name.split(" ")[0]}` : "";
                      return `${frontierRows.length} item${frontierRows.length!==1?"s":""} in your queue${from?" · "+from:""}`;
                    })()
                  : `${ownerFiltered.length} accounts · ${ownerFiltered.filter(f=>f.assignedToId||f.assignedTo).length} assigned to BDR`}
              </p>
              {isBDR&&(()=>{
                const handoffCount=frontier.filter(f=>f.assignedTo===myName&&f.status==="Handoff complete").length;
                const totalAssigned=frontier.filter(f=>f.assignedTo===myName).length+handoffCount;
                return handoffCount>0?(
                  <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:4 }}>
                    <span style={{ ...mono, fontSize:11, color:"#5A9A5A", fontWeight:500 }}>🤝 {handoffCount} handoff{handoffCount!==1?"s":""} completed</span>
                    <span style={{ ...mono, fontSize:10, color:HUD.mut }}>· passed to AE for qualification</span>
                  </div>
                ):null;
              })()}
            </div>
            {/* AE ownership filter + Needs Attention */}
            {!isBDR&&(
              <div style={{ marginLeft:"auto", display:"flex", gap:6, flexWrap:"wrap" }}>
                {[["all","All",NEON],["mine","My Outbound",NEON],["bdr","BDR Queue",CYAN_NEON]].map(([v,lb,c])=>{
                  const on = ownerFilter===v && !needsAttention;
                  return (
                    <button key={v} onClick={()=>{setOwnerFilter(v);setNeedsAttention(false);}}
                      style={{ ...mono, fontSize:11, padding:"4px 11px", borderRadius:4, letterSpacing:"0.06em",
                        border:`1px solid ${on?c:HUD.cardBdr}`,
                        background:on?`${c}14`:"transparent",
                        color:on?c:HUD.mut,
                        cursor:"pointer",
                        textShadow:on?`0 0 6px ${c}55`:"none" }}>{lb}</button>
                  );
                })}
                <button onClick={()=>setNeedsAttention(n=>!n)}
                  style={{ ...mono, fontSize:11, padding:"4px 11px", borderRadius:4, letterSpacing:"0.06em",
                    border:`1px solid ${needsAttention?AMBER_NEON:HUD.cardBdr}`,
                    background:needsAttention?`${AMBER_NEON}14`:"transparent",
                    color:needsAttention?AMBER_NEON:HUD.mut,
                    cursor:"pointer",
                    textShadow:needsAttention?`0 0 6px ${AMBER_NEON}55`:"none" }}>⚠ Needs Attention</button>
              </div>
            )}
            {/* BDR sub-tabs */}
            {isBDR&&(
              <div style={{ marginLeft:"auto", display:"flex", flexDirection:"column", alignItems:"flex-end", gap:6 }}>
                <div style={{ display:"flex", gap:5 }}>
                  {[["queue","Frontier"],["territory","Territory Browse"]].map(([v,lb])=>{
                    const on = bdrTab===v;
                    return (
                      <button key={v} onClick={()=>setBdrTab(v)}
                        style={{ ...mono, fontSize:11, padding:"3px 10px", borderRadius:4, letterSpacing:"0.06em",
                          border:`1px solid ${on?NEON:HUD.cardBdr}`,
                          background:on?`${NEON}14`:"transparent",
                          color:on?NEON:HUD.mut,
                          cursor:"pointer",
                          textShadow:on?`0 0 6px ${NEON}55`:"none" }}>{lb}</button>
                    );
                  })}
                </div>
                {/* BDR AE toggle strip — "All AEs" default + one per AE */}
                {assignedAEs.length >= 1 && (
                  <div style={{ display:"flex", gap:5, alignItems:"center" }}>
                    <span style={{ ...mono, fontSize:10, color:HUD.mut, textTransform:"uppercase", letterSpacing:"0.07em" }}>AE</span>
                    <button onClick={()=>setSelectedBDRAEId(null)}
                      style={{ ...mono, fontSize:11, padding:"3px 10px", borderRadius:4, letterSpacing:"0.06em",
                        border:`1px solid ${validBDRAEId===null?CYAN_NEON:HUD.cardBdr}`,
                        background:validBDRAEId===null?`${CYAN_NEON}14`:"transparent",
                        color:validBDRAEId===null?CYAN_NEON:HUD.mut,
                        cursor:"pointer",
                        textShadow:validBDRAEId===null?`0 0 6px ${CYAN_NEON}55`:"none" }}>
                      All
                    </button>
                    {assignedAEs.map(ae=>{
                      const active = validBDRAEId === ae.id;
                      return (
                        <button key={ae.id} onClick={()=>setSelectedBDRAEId(ae.id)}
                          style={{ ...mono, fontSize:11, padding:"3px 10px", borderRadius:4, letterSpacing:"0.06em",
                            border:`1px solid ${active?CYAN_NEON:HUD.cardBdr}`,
                            background:active?`${CYAN_NEON}14`:"transparent",
                            color:active?CYAN_NEON:HUD.mut,
                            cursor:"pointer",
                            textShadow:active?`0 0 6px ${CYAN_NEON}55`:"none" }}>
                          {ae.name.split(" ")[0]}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Stats bar */}
          {!isBDR&&(
            <div style={{ display:"flex", gap:0, marginBottom:14, padding:"12px 18px", background:"#081208", border:`1px solid ${HUD.cardBdr}`, borderRadius:7, flexWrap:"wrap", alignItems:"center" }}>
              {[
                { label:"Total",           val:frontier.length,                                                       c:"#FFFFFF", ic:"👤", glow:false },
                { label:"Assigned to BDR", val:frontier.filter(f=>f.assignedTo&&f.assignedTo!==myName).length,        c:CYAN_NEON, ic:"🎯", glow:true  },
                { label:"Meetings Booked", val:frontier.filter(f=>f.status==="Meeting Booked").length,                c:NEON,      ic:"📅", glow:true  },
                { label:"Stale >14d",      val:staleCount,                                                            c:AMBER_NEON, ic:"⚠️", glow:staleCount>0 },
              ].map((s,i,arr)=>(
                <React.Fragment key={s.label}>
                  <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
                    <span style={{ ...mono, fontSize:26, fontWeight:700, color:s.c, lineHeight:1, textShadow:s.glow?`0 0 10px ${s.c}55`:"none" }}>{s.val}</span>
                    <span style={{ ...mono, fontSize:10, color:s.c, opacity:0.75, textTransform:"uppercase", letterSpacing:"0.1em", whiteSpace:"nowrap" }}>{s.ic} {s.label}</span>
                  </div>
                  {i<arr.length-1&&<span style={{ ...mono, fontSize:16, color:HUD.dim, margin:"0 22px" }}>·</span>}
                </React.Fragment>
              ))}
            </div>
          )}

          {/* Handoff bridge — AE view */}
          {!isBDR&&pendingHandoffs.length>0&&(
            <div style={{ background:"#061208", border:`1px solid ${C.green}44`, borderRadius:7, padding:"9px 12px", marginBottom:12 }}>
              <p style={{ ...mono, margin:"0 0 6px", fontSize:11, fontWeight:500, color:C.green, textTransform:"uppercase", letterSpacing:"0.08em" }}>🤝 Handoff bridge — {pendingHandoffs.length} ready to qualify</p>
              {pendingHandoffs.map(f=>(
                <div key={f.id} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:3 }}>
                  <span style={{ fontSize:13, color:C.txt, flex:1 }}>{f.name}</span>
                  <span style={{ ...mono, fontSize:11, color:C.mut }}>BDR handoff complete → move to Qualified in Accounts</span>
                </div>
              ))}
            </div>
          )}

          {/* BDR: Territory Browse */}
          {isBDR&&bdrTab==="territory"&&(
            <div>
              <p style={{ ...mono, margin:"0 0 10px", fontSize:11, color:HUD.mut, textTransform:"uppercase", letterSpacing:"0.08em" }}>{unassignedAccounts.length} accounts available to claim</p>
              {unassignedAccounts.length===0&&<p style={{ fontSize:14, color:HUD.mut }}>All accounts are already in the Frontier.</p>}
              {unassignedAccounts.map(a=>{
                const ts=TS[a.tier]||{};
                const webUrl=a.web?(a.web.startsWith("http")?a.web:`https://${a.web}`):null;
                return(
                  <div key={a.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 12px", background:HUD.rowBg, border:`1px solid ${HUD.cardBdr}`, borderRadius:6, marginBottom:4 }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:2 }}>
                        {webUrl?<a href={webUrl} target="_blank" rel="noreferrer" style={{ fontSize:14, fontWeight:500, color:NEON, textDecoration:"none" }}>{a.name}</a>:<span style={{ fontSize:14, fontWeight:500, color:NEON }}>{a.name}</span>}
                        {a.tier&&<span style={{ ...mono, fontSize:10, color:ts.c, border:`1px solid ${ts.b||"#333"}`, borderRadius:3, padding:"1px 5px" }}>{ts.i} {a.tier}</span>}
                      </div>
                      <p style={{ ...mono, margin:0, fontSize:11, color:HUD.mut }}>
                        {a.vert||"—"}{a.prods?.length?` · ${a.prods.slice(0,3).join(", ")}`:""}{a.pf?` · ${a.pf.slice(0,60)}...`:""}
                      </p>
                    </div>
                    {a.linkedin&&<a href={a.linkedin.startsWith("http")?a.linkedin:`https://${a.linkedin}`} target="_blank" rel="noreferrer" style={{ ...mono, fontSize:11, color:"#4A9AE8", textDecoration:"none" }}>in</a>}
                    <button onClick={()=>onAssignToBDR&&onAssignToBDR(a,myId||myName,"")} style={{ ...mono, fontSize:12, padding:"5px 12px", background:HUD.rowBg, border:`1px solid ${NEON}66`, color:NEON, borderRadius:5, cursor:"pointer", whiteSpace:"nowrap" }}>
                      ◎ Claim →
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Main frontier table — AE view or BDR My Queue */}
          {(!isBDR||(isBDR&&bdrTab==="queue"))&&(
            <div>
              {/* Filter pills */}
              {(()=>{
                const activePills = [statusFilter,priorityFilter,tierFilter].filter(Boolean).length;
                const usedStatuses=[...new Set(ownerFiltered.map(f=>f.status).filter(Boolean))];
                const usedPriorities=[...new Set(ownerFiltered.map(f=>f.priority).filter(Boolean))];
                const usedTiers=[...new Set(ownerFiltered.map(f=>f.tier).filter(Boolean))];
                // CSS vars can't be concatenated with hex alpha — resolve to hex for pill colors
                const pill=(label,active,onClick)=>(
                  <button key={label} onClick={onClick}
                    style={{ ...mono, fontSize:11, lineHeight:"1.2", padding:"4px 11px", borderRadius:12, letterSpacing:"0.04em",
                      border:`1px solid ${active?NEON:HUD.cardBdr}`,
                      background:active?`${NEON}14`:"transparent",
                      color:active?NEON:HUD.mut,
                      cursor:"pointer", whiteSpace:"nowrap", fontWeight:400,
                      textShadow:active?`0 0 6px ${NEON}55`:"none" }}>{label}</button>
                );
                return(
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:10, alignItems:"center" }}>
                    {activePills>0&&<button onClick={()=>{setStatusFilter(null);setPriorityFilter(null);setTierFilter(null);}} style={{ ...mono, fontSize:11, lineHeight:"1.2", padding:"4px 11px", borderRadius:12, border:`1px solid ${C.red}55`, background:`${C.red}18`, color:C.red, cursor:"pointer", whiteSpace:"nowrap", fontWeight:400 }}>✕ Clear</button>}
                    {usedStatuses.map(s=>pill(STATUS_EMOJI[s]?`${STATUS_EMOJI[s]} ${s}`:s, statusFilter===s, ()=>setStatusFilter(f=>f===s?null:s)))}
                    {usedPriorities.length>0&&<span style={{ ...mono, fontSize:11, color:HUD.dim, padding:"0 2px" }}>·</span>}
                    {usedPriorities.map(p=>pill(p, priorityFilter===p, ()=>setPriorityFilter(f=>f===p?null:p)))}
                    {usedTiers.length>0&&<span style={{ ...mono, fontSize:11, color:HUD.dim, padding:"0 2px" }}>·</span>}
                    {usedTiers.map(t=>pill(t, tierFilter===t, ()=>setTierFilter(f=>f===t?null:t)))}
                    <span style={{ ...mono, fontSize:11, color:HUD.mut, marginLeft:"auto" }}>
                      {frontierRows.length !== ownerFiltered.length ? `${frontierRows.length} / ${ownerFiltered.length}` : `${frontierRows.length}`}
                    </span>
                  </div>
                );
              })()}
              {frontierRows.length===0&&(
                <div style={{ padding:"32px 0", textAlign:"center" }}>
                  <p style={{ fontSize:14, color:HUD.mut }}>{isBDR?"No accounts assigned to you yet.":"No accounts match this filter."}</p>
                </div>
              )}

              {/* ── Bucketed OutboundCard stacks ─────────────────────────── */}
              {frontierRows.length>0&&(()=>{
                const migrated = frontierRows.map(migrateOutboundEntry);
                const groups = { reply:[], today:[], sequence:[], cold:[], booked:[] };
                migrated.forEach(e=>{ groups[bucketFor(e)].push(e); });
                const sectionHeader = (label, count, color) => (
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:14, marginBottom:8 }}>
                    <span style={{ ...mono, fontSize:10, fontWeight:600, color, letterSpacing:"0.12em", textTransform:"uppercase", textShadow:`0 0 6px ${color}55` }}>
                      {label} <span style={{ color:HUD.mut, marginLeft:4 }}>({count})</span>
                    </span>
                    <div style={{ flex:1, height:1, background:`linear-gradient(to right, ${color}33, transparent)` }}/>
                  </div>
                );

                const renderCard = e => (
                  <React.Fragment key={e.id}>
                    <OutboundCard
                      entry={e}
                      accounts={accounts}
                      setAccounts={setAccounts}
                      setFrontier={onSaveFrontier}
                      onCreateTask={onCreateTask}
                      activeUser={activeUser}
                      intentHistory={intentHistory}
                      threadCache={threadCache}
                      isExpanded={expandedId===e.id}
                      onToggleExpand={id=>setExpandedId(x=>x===id?null:id)}
                      onOpenCompose={f=>setExpandedId(f.id)}
                      onUnassign={isBDR?undefined:onUnassignFromFrontier}
                    />
                    {expandedId===e.id && (
                      <div style={{ marginTop:6, padding:"8px 0", borderTop:`1px solid ${T.border.subtle}` }}>
                        <div style={{ display:"flex", justifyContent:"flex-start", marginBottom:6 }}>
                          <button
                            onClick={()=>copyResearch(e)}
                            style={{ ...mono, fontSize:11, padding:"3px 10px", background:"transparent",
                              border:`1px solid ${researchCopiedId===e.id?T.neon:T.border.muted}`,
                              color:researchCopiedId===e.id?T.neon:T.text.muted, borderRadius:4, cursor:"pointer" }}>
                            {researchCopiedId===e.id ? "✓ Copied" : "🔍 Research"}
                          </button>
                        </div>
                        <FrontierEmailPanel
                          entry={e}
                          activeUser={activeUser||user}
                          onClose={()=>setExpandedId(null)}
                          onLogSent={body=>{ logTouchpoint(e.id, body); setExpandedId(null); }}
                        />
                      </div>
                    )}
                  </React.Fragment>
                );

                return (
                  <>
                    {groups.reply.length>0&&(<>
                      {sectionHeader('🔴 Needs reply', groups.reply.length, AMBER_NEON)}
                      {groups.reply.map(renderCard)}
                    </>)}
                    {groups.today.length>0&&(<>
                      {sectionHeader('🟢 Touch today', groups.today.length, NEON)}
                      {groups.today.map(renderCard)}
                    </>)}
                    {groups.sequence.length>0&&(<>
                      {sectionHeader('🔵 In sequence', groups.sequence.length, CYAN_NEON)}
                      {groups.sequence.map(renderCard)}
                    </>)}
                    {groups.cold.length>0&&(<>
                      {!showColdSection
                        ?<button onClick={()=>setShowColdSection(true)} style={{ ...mono, fontSize:11, padding:"6px 14px", marginTop:14, background:"transparent", border:`1px dashed ${HUD.cardBdr}`, color:HUD.mut, borderRadius:4, cursor:"pointer", letterSpacing:"0.06em" }}>
                            Show {groups.cold.length} cold prospect{groups.cold.length!==1?"s":""}
                          </button>
                        :(<>
                            {sectionHeader('· Cold', groups.cold.length, HUD.mut)}
                            {groups.cold.map(renderCard)}
                            <button onClick={()=>setShowColdSection(false)} style={{ ...mono, fontSize:10, padding:"3px 9px", marginTop:6, background:"transparent", border:"none", color:HUD.dim, cursor:"pointer" }}>collapse</button>
                          </>)
                      }
                    </>)}
                    {groups.booked.length>0&&(
                      <div style={{ marginTop:14, display:"flex", alignItems:"center", gap:8 }}>
                        <button onClick={()=>setShowBookedSection(s=>!s)}
                          style={{ ...mono, fontSize:11, padding:"4px 11px", background:showBookedSection?`${NEON}14`:"transparent", border:`1px solid ${NEON}55`, color:NEON, borderRadius:12, cursor:"pointer", letterSpacing:"0.06em" }}>
                          {showBookedSection?"▼":"▶"} View booked ({groups.booked.length})
                        </button>
                      </div>
                    )}
                    {showBookedSection&&groups.booked.length>0&&(
                      <div style={{ marginTop:8 }}>
                        {groups.booked.map(renderCard)}
                      </div>
                    )}
                  </>
                );
              })()}

              {/* Remove demo link */}
              {onRemoveDemoAccount&&frontierRows.some(f=>f.isDemo)&&(
                <div style={{ textAlign:"right", marginTop:8 }}>
                  <button onClick={onRemoveDemoAccount} style={{ ...mono, fontSize:10, background:"transparent", border:"none", color:"#4A3A20", cursor:"pointer", textDecoration:"underline" }}>Remove demo account</button>
                </div>
              )}
            </div>
          )}
        </div>

      {/* ── SECTION 3 — STEALTH ────────────────────────────────────────────── */}
      <div style={{ background:HUD.cardBg, borderRadius:10, padding:"14px 18px", border:`1px solid ${HUD.cardBdr}` }}>
        <div onClick={()=>setStealthExpanded(e=>!e)} style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer", userSelect:"none" }}>
          <span style={{ ...mono, fontSize:14, color:NEON, textShadow:`0 0 8px ${NEON}66` }}>◆</span>
          <p style={{ ...mono, margin:0, fontSize:14, fontWeight:600, color:NEON, letterSpacing:"0.12em", textTransform:"uppercase", textShadow:`0 0 8px ${NEON}44` }}>Stealth</p>
          <span style={{ ...mono, fontSize:11, color:HUD.mut }}>
            {(stealthList||[]).length} account{(stealthList||[]).length!==1?"s":""} with LinkedIn enrichment
          </span>
          <span style={{ marginLeft:"auto", ...mono, fontSize:11, color:NEON, letterSpacing:"0.06em", border:`1px solid ${NEON}44`, padding:"2px 8px", borderRadius:3 }}>[ {stealthExpanded?"COLLAPSE":"EXPAND"} ]</span>
        </div>
        {stealthExpanded && (
          <div style={{ marginTop:14 }}>
            <StealthTab user={user} list={stealthList} onSaveList={onSaveStealthList} accounts={accounts} onPromoteToAccount={onPromoteToAccount} onSfStatus={onSfStatus}/>
          </div>
        )}
      </div>
    </div>
  );
}

export default OutboundPage;
