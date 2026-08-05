import React, { useState, useEffect, useMemo, Fragment } from 'react';
import { C, TS, mono } from '../constants/colors';

// ─── Email System Data ───────────────────────────────────────────────────────
const EMAIL_TEMPLATES = [
  // FIRST TOUCH
  { id:"ft_fit", category:"First Touch", name:"Cold — Product Fit",
    subject:"[Your Company] × [Company]",
    body:`Hi [First Name],

Came across [Company] and noticed you're building in [Use Case] — that's exactly what [Your Company] was built for.

We power [Use Case] for companies across fintech — [Product] is how teams at your stage connect to bank data without the compliance headache. One integration, bank-level infrastructure.

Worth a 15-minute call to see if there's a fit? [Calendar Link]

[Your Name]
Account Executive, [Your Company]
[Your Company].com` },

  { id:"ft_connection", category:"First Touch", name:"Cold — Mutual Connection",
    subject:"Intro via [Mutual Connection] — [Your Company] × [Company]",
    body:`Hi [First Name],

[Mutual Connection] suggested I reach out — spoke highly of what the [Company] team is building.

We power [Use Case] for fintechs at every stage, and [Product] tends to be where companies like yours start. Thought it was worth an intro.

Happy to do a quick call? [Calendar Link]

[Your Name]
Account Executive, [Your Company]` },

  { id:"ft_trigger", category:"First Touch", name:"Cold — Funding / News Trigger",
    subject:"Congrats on the raise — [Your Company] + [Company]",
    body:`Hi [First Name],

Congrats on the funding — exciting milestone for the [Company] team.

A lot of companies at your stage use this moment to lock in their financial data infrastructure. [Your Company] powers [Use Case] for hundreds of fintechs — [Product] is usually the first call.

Happy to connect and see where we fit into your roadmap. [Calendar Link]

[Your Name]
Account Executive, [Your Company]` },

  { id:"ft_intent", category:"First Touch", name:"Cold — 6sense / Intent Signal",
    subject:"Noticed [Company] researching [Your Company]",
    body:`Hi [First Name],

Noticed [Company] has been looking into financial data APIs — wanted to make sure you had a direct line.

We work with teams building [Use Case] — [Product] is the standard for bank-level connectivity at scale. Happy to walk you through what that looks like for your use case.

15 minutes? [Calendar Link]

[Your Name]
Account Executive, [Your Company]` },

  // FOLLOW UP
  { id:"fu_bump1", category:"Follow Up", name:"Bump #1 — Soft Check In",
    subject:"Re: [Your Company] × [Company]",
    body:`Hi [First Name],

Just bumping this up in case it got buried — totally understand if timing is off.

Still think there's a strong fit here. Happy to adjust to whenever works.

[Your Name]` },

  { id:"fu_bump2", category:"Follow Up", name:"Bump #2 — Add Value",
    subject:"Something relevant for [Company]",
    body:`Hi [First Name],

Wanted to share something — thought it was relevant to what you're building at [Company]: [Case Study Link]

TL;DR: a similar company used [Product] for [Use Case] and saw real lift. Worth five minutes.

Still up for a call? [Calendar Link]

[Your Name]` },

  { id:"fu_bump3", category:"Follow Up", name:"Bump #3 — Breakup",
    subject:"Closing the loop — [Company]",
    body:`Hi [First Name],

I'll keep this short. I've reached out a few times and haven't heard back, so I'll assume the timing isn't right.

If things change, I'm easy to find. Either way — good luck with everything at [Company].

[Your Name]
[Your Company]` },

  { id:"fu_noshow", category:"Follow Up", name:"Post No-Show — Reschedule",
    subject:"Missed you today — want to reschedule?",
    body:`Hi [First Name],

Looks like our call got away from us — no worries at all.

Happy to find another time. Here's my calendar: [Calendar Link]

[Your Name]` },

  { id:"fu_postmtg", category:"Follow Up", name:"Post Meeting — Recap + Next Steps",
    subject:"Great connecting — next steps for [Company] × [Your Company]",
    body:`Hi [First Name],

Really enjoyed the conversation. Quick recap:

• [Key Takeaway 1]
• [Key Takeaway 2]
• [Key Takeaway 3]

Next steps:
1. [Action Item 1]
2. [Action Item 2]

I'll follow up by [Follow-Up Date]. Let me know if you want to loop in anyone else from your team.

[Your Name]
Account Executive, [Your Company]
[Your Company].com` },

  // DEAL PROGRESSION
  { id:"dp_pricing", category:"Deal Progression", name:"Send Pricing",
    subject:"[Your Company] pricing scoped for [Company]",
    body:`Hi [First Name],

As promised — here's a look at how [Your Company] pricing is structured for [Company].

[Pricing Link]

Happy to walk through this together. A lot of the structure depends on volume and which products are in scope — worth a call to make sure the model reflects your plan.

[Your Name]
Account Executive, [Your Company]` },

  { id:"dp_roi", category:"Deal Progression", name:"Send ROI Model",
    subject:"ROI model for [Company] — [Your Company]",
    body:`Hi [First Name],

Wanted to share this before our next conversation.

[ROI Link]

Based on comparable deployments, [Company] could see meaningful return through [Use Case]. Happy to pressure-test the assumptions together.

[Your Name]` },

  { id:"dp_se", category:"Deal Progression", name:"Technical Intro — Loop in SE",
    subject:"Looping in our SE for [Company] — technical deep dive",
    body:`Hi [First Name],

Looping in [SE Name], our Solutions Engineer, to get into the technical details.

[SE Name] — [First Name] at [Company] is building [Use Case] and has questions around [Technical Topic]. Over to you.

[Your Name]
Account Executive, [Your Company]` },

  { id:"dp_legal", category:"Deal Progression", name:"Legal / Security — Start Procurement",
    subject:"Kicking off security review — [Company] × [Your Company]",
    body:`Hi [First Name],

Happy to start the security and legal review now — this part usually takes the longest so better to get ahead of it.

Looping in [Legal Contact] from [Your Company]. [Legal Contact] — [First Name] at [Company] is ready to begin.

Our security overview: [Security Overview Link]

[Your Name]` },

  { id:"dp_verbal", category:"Deal Progression", name:"Verbal Commit — Close Steps",
    subject:"Great news — [Company] × [Your Company] next steps",
    body:`Hi [First Name],

Thrilled to move forward. Here's how closing looks from here:

1. Legal sends MSA / order form → [Target Date]
2. [Company] returns signed → [Target Date]
3. Onboarding kickoff → target go-live [Go-Live Date]

I'll stay close throughout. Let me know if anything comes up on your end.

[Your Name]
Account Executive, [Your Company]
[Your Company].com` },

  // NURTURE
  { id:"nu_news", category:"Nurture", name:"Relevant News / Case Study",
    subject:"Thought of [Company] — [Topic]",
    body:`Hi [First Name],

Saw this and immediately thought of [Company]: [Case Study Link]

[One sentence on why it's relevant.]

No action needed — just wanted to stay on your radar.

[Your Name]
[Your Company]` },

  { id:"nu_product", category:"Nurture", name:"Product Update",
    subject:"New from [Your Company] — relevant for [Company]",
    body:`Hi [First Name],

Quick note — we just launched something I think is directly relevant to what you're building: [Blog Link]

The short version: [One-sentence description].

Happy to walk through it if helpful.

[Your Name]
Account Executive, [Your Company]` },

  { id:"nu_checkin", category:"Nurture", name:"Long-Term Nurture — Check In",
    subject:"Checking in — [Company]",
    body:`Hi [First Name],

It's been a while — hope things are going well at [Company].

A lot has changed on our end since we last connected — [Brief Update on Your Company]. Curious where things stand for you.

Worth reconnecting? [Calendar Link]

[Your Name]
Account Executive, [Your Company]` },

  { id:"nu_reengage", category:"Nurture", name:"Re-Engage — Account Went Cold",
    subject:"Still relevant for [Company]?",
    body:`Hi [First Name],

We spoke a while back about [Company] using [Product] for [Use Case] — wanted to check if that conversation is still relevant.

A few things have changed that might shift the calculus: [Relevant Updates].

Happy to pick up where we left off if timing is better now. [Calendar Link]

[Your Name]
[Your Company]` },
];

const DEAL_FLOW_STAGES = [
  { id:"not_contacted",  label:"Not Contacted",         color:"#5A5A6A", bg:"#0E0E12" },
  { id:"first_touch",    label:"First Touch Sent",       color:"#4A8FD4", bg:"#070D14" },
  { id:"bump1",          label:"Bump 1",                 color:"#4AAFB4", bg:"#070E0E" },
  { id:"bump2",          label:"Bump 2",                 color:"#5AB4C4", bg:"#060E10" },
  { id:"responded",      label:"Responded ✓",            color:"#5AC45A", bg:"#060E06" },
  { id:"meeting_booked", label:"Meeting Booked 📅",      color:"#F5C842", bg:"#120E04" },
  { id:"post_meeting",   label:"Post-Meeting Follow Up", color:"#D4884A", bg:"#120A04" },
  { id:"in_deal_flow",   label:"In Deal Flow 🟣",         color:"#A855F7", bg:"#0D0714" },
];

// ─── Email System Page ────────────────────────────────────────────────────────
function EmailSystemPage({ accounts=[], pool=[] }) {
  const allAccounts = useMemo(()=>[...accounts,...pool],[accounts,pool]);
  const CAT_COLOR = { "First Touch":C.blue, "Follow Up":C.green, "Deal Progression":C.gold, "Nurture":C.purple };
  const STAGE_MAP_BY_TPL = { ft_fit:"first_touch",ft_connection:"first_touch",ft_trigger:"first_touch",ft_intent:"first_touch",fu_bump1:"bump1",fu_bump2:"bump2",fu_bump3:"bump2",fu_noshow:"first_touch",fu_postmtg:"post_meeting",dp_pricing:"in_deal_flow",dp_roi:"in_deal_flow",dp_se:"in_deal_flow",dp_legal:"in_deal_flow",dp_verbal:"in_deal_flow",nu_news:"first_touch",nu_product:"first_touch",nu_checkin:"first_touch",nu_reengage:"first_touch" };

  // ── Tab ──────────────────────────────────────────────────────────────────────
  const [emailTab, setEmailTab] = useState("templates");

  // ── Templates tab state ──────────────────────────────────────────────────────
  const [catFilter, setCatFilter]   = useState("All");
  const [selectedTplId, setSelectedTplId] = useState(null);
  const [linkedAcctId, setLinkedAcctId]   = useState("");
  const [editMode, setEditMode]     = useState(false);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody]       = useState("");
  const [manualFirst, setManualFirst] = useState("");
  const [manualCal, setManualCal]     = useState("");
  const [copied, setCopied]     = useState(false);
  const [subCopied, setSubCopied] = useState(false);

  // ── Sequences ────────────────────────────────────────────────────────────────
  const [sequences, setSequences] = useState(()=>{try{return JSON.parse(localStorage.getItem("prospector_sequences")||"[]");}catch{return [];}});
  useEffect(()=>{try{localStorage.setItem("prospector_sequences",JSON.stringify(sequences));}catch{}},[sequences]);
  const [buildingSeq, setBuildingSeq] = useState(false);
  const [seqName, setSeqName]     = useState("");
  const [seqSteps, setSeqSteps]   = useState([{templateId:"",daysAfter:0}]);

  // ── Email Log ────────────────────────────────────────────────────────────────
  const [emailLog, setEmailLog] = useState(()=>{try{return JSON.parse(localStorage.getItem("prospector_email_log")||"[]");}catch{return [];}});
  useEffect(()=>{try{localStorage.setItem("prospector_email_log",JSON.stringify(emailLog));}catch{}},[emailLog]);

  // ── Deal Flow ────────────────────────────────────────────────────────────────
  const [dealFlow, setDealFlow] = useState(()=>{try{return JSON.parse(localStorage.getItem("prospector_deal_flow")||"{}");}catch{return {};}});
  useEffect(()=>{try{localStorage.setItem("prospector_deal_flow",JSON.stringify(dealFlow));}catch{}},[dealFlow]);
  const [dragAcct, setDragAcct] = useState(null);
  const [dragOver, setDragOver] = useState(null);

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const currentUser = (()=>{try{const u=JSON.parse(localStorage.getItem("prospector_user")||"{}");return u.firstName||u.name||"[Your Name]";}catch{return "[Your Name]";}})();
  const categories = ["All","First Touch","Follow Up","Deal Progression","Nurture"];
  const filteredTpls = catFilter==="All"?EMAIL_TEMPLATES:EMAIL_TEMPLATES.filter(t=>t.category===catFilter);
  const selectedTpl = EMAIL_TEMPLATES.find(t=>t.id===selectedTplId)||null;
  const linkedAcct  = allAccounts.find(a=>a.id?.toString()===linkedAcctId)||null;

  const vars = {
    firstName: manualFirst||linkedAcct?.personaName||"[First Name]",
    company:   linkedAcct?.name||"[Company]",
    product:   linkedAcct?.prods?.[0]||"[Product]",
    useCase:   linkedAcct?.ucs?.[0]||"[Use Case]",
    yourName:  currentUser,
    calendarLink: manualCal||"[Calendar Link]",
  };
  const fill = txt => txt
    .replace(/\[First Name\]/g, vars.firstName)
    .replace(/\[Company\]/g,    vars.company)
    .replace(/\[Product\]/g,    vars.product)
    .replace(/\[Use Case\]/g,   vars.useCase)
    .replace(/\[Your Name\]/g,  vars.yourName)
    .replace(/\[Calendar Link\]/g, vars.calendarLink);

  const previewSubject = selectedTpl ? fill(editMode?editSubject:selectedTpl.subject) : "";
  const previewBody    = selectedTpl ? fill(editMode?editBody:selectedTpl.body)       : "";

  const selectTemplate = tpl => {
    setSelectedTplId(tpl.id);
    setEditSubject(tpl.subject);
    setEditBody(tpl.body);
    setEditMode(false);
    setCopied(false);
  };

  const logSend = (tpl, subj, bod) => {
    const entry = { id:Date.now(), accountId:linkedAcct?.id||null, accountName:linkedAcct?.name||"Unknown", templateId:tpl.id, templateName:tpl.name, sentAt:new Date().toISOString(), subject:subj, body:bod, replied:false };
    setEmailLog(l=>[entry,...l]);
    if(linkedAcct) {
      const stage = STAGE_MAP_BY_TPL[tpl.id]||"first_touch";
      setDealFlow(df=>({...df,[linkedAcct.id]:{...(df[linkedAcct.id]||{}),stage,stageChangedAt:new Date().toISOString()}}));
    }
  };

  const copyEmail = () => {
    navigator.clipboard.writeText(`Subject: ${previewSubject}\n\n${previewBody}`).catch(()=>{});
    setCopied(true); setTimeout(()=>setCopied(false),2000);
    if(selectedTpl) logSend(selectedTpl,previewSubject,previewBody);
  };
  const openGmail = () => {
    const to = encodeURIComponent(linkedAcct?.email||"");
    const su = encodeURIComponent(previewSubject);
    const bd = encodeURIComponent(previewBody);
    window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${to}&su=${su}&body=${bd}`,"_blank");
    if(selectedTpl) logSend(selectedTpl,previewSubject,previewBody);
  };

  // Sequences helpers
  const addSeqStep = () => setSeqSteps(s=>[...s,{templateId:"",daysAfter:(s[s.length-1]?.daysAfter||0)+3}]);
  const removeSeqStep = i => setSeqSteps(s=>s.filter((_,idx)=>idx!==i));
  const saveSequence = () => {
    if(!seqName.trim()||seqSteps.some(s=>!s.templateId)) return;
    setSequences(ss=>[...ss,{id:Date.now(),name:seqName.trim(),steps:seqSteps,createdAt:new Date().toISOString()}]);
    setSeqName(""); setSeqSteps([{templateId:"",daysAfter:0}]); setBuildingSeq(false);
  };

  // Deal Flow helpers
  const moveToDealStage = (acctId,stageId) => setDealFlow(df=>({...df,[acctId]:{...(df[acctId]||{}),stage:stageId,stageChangedAt:new Date().toISOString()}}));

  // Analytics
  const nowMs = Date.now();
  const weekMs = 7*24*60*60*1000;
  const thisWeek = emailLog.filter(e=>nowMs-new Date(e.sentAt).getTime()<weekMs);
  const repliedCount = emailLog.filter(e=>e.replied).length;
  const responseRate = emailLog.length>0?Math.round(repliedCount/emailLog.length*100):0;
  const tplCounts = {};
  emailLog.forEach(e=>{tplCounts[e.templateName]=(tplCounts[e.templateName]||0)+1;});
  const topTpl = Object.entries(tplCounts).sort(([,a],[,b])=>b-a)[0]?.[0]||"—";
  const uniqueAccts = new Set(emailLog.map(e=>e.accountId).filter(Boolean)).size;

  const TABS = [["templates","✉ Templates"],["sequences","⛓ Sequences"],["dealflow","◩ Deal Flow"],["analytics","▲ Analytics"]];

  return (
    <div>
      {/* Sub-tab bar */}
      <div style={{ display:"flex", gap:0, marginBottom:18, borderBottom:`1px solid ${C.brd}` }}>
        {TABS.map(([id,lb])=>(
          <button key={id} onClick={()=>setEmailTab(id)} style={{ ...mono, fontSize:12, padding:"7px 18px", background:"transparent", border:"none", borderBottom:`2px solid ${emailTab===id?C.gold:"transparent"}`, color:emailTab===id?C.gold:C.dim, cursor:"pointer", marginBottom:-1 }}>{lb}</button>
        ))}
      </div>

      {/* ── TEMPLATES TAB ─────────────────────────────────────────────────────── */}
      {emailTab==="templates"&&(
        <div style={{ display:"grid", gridTemplateColumns:"260px 1fr", gap:14, minHeight:540 }}>
          {/* Left column */}
          <div style={{ display:"flex", flexDirection:"column", gap:6, overflowY:"auto" }}>
            {categories.map(cat=>(
              <button key={cat} onClick={()=>setCatFilter(cat)} style={{ ...mono, fontSize:12, padding:"5px 10px", borderRadius:5, border:`1px solid ${catFilter===cat?(CAT_COLOR[cat]||C.gold):C.brd}`, background:catFilter===cat?`${CAT_COLOR[cat]||C.gold}18`:"transparent", color:catFilter===cat?(CAT_COLOR[cat]||C.gold):C.dim, cursor:"pointer", textAlign:"left", fontWeight:catFilter===cat?600:400 }}>
                {cat==="All"?"All Templates":cat}
                <span style={{ float:"right",opacity:0.6 }}>{cat==="All"?EMAIL_TEMPLATES.length:EMAIL_TEMPLATES.filter(t=>t.category===cat).length}</span>
              </button>
            ))}
            <div style={{ width:"100%", height:1, background:C.brd, margin:"4px 0" }}/>
            {filteredTpls.map(tpl=>(
              <div key={tpl.id} onClick={()=>selectTemplate(tpl)} style={{ padding:"8px 11px", background:selectedTplId===tpl.id?`${CAT_COLOR[tpl.category]||C.gold}18`:C.card, border:`1px solid ${selectedTplId===tpl.id?(CAT_COLOR[tpl.category]||C.gold):C.brd}`, borderRadius:6, cursor:"pointer" }}>
                <div style={{ ...mono, fontSize:10, color:CAT_COLOR[tpl.category]||C.mut, marginBottom:2 }}>{tpl.category}</div>
                <div style={{ fontSize:13, color:C.txt, fontWeight:500 }}>{tpl.name}</div>
                <div style={{ ...mono, fontSize:11, color:C.dim, marginTop:1, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{tpl.subject}</div>
              </div>
            ))}
          </div>

          {/* Right column */}
          {selectedTpl ? (
            <div style={{ display:"flex", flexDirection:"column", gap:10, overflowY:"auto" }}>
              {/* Personalization bar */}
              <div style={{ padding:"10px 14px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:8, display:"flex", flexWrap:"wrap", gap:8, alignItems:"center" }}>
                <span style={{ ...mono, fontSize:11, color:C.dim }}>Account</span>
                <select value={linkedAcctId} onChange={e=>{setLinkedAcctId(e.target.value);}} style={{ ...mono, fontSize:12, padding:"3px 8px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:4, color:linkedAcct?C.gold:C.dim, outline:"none", cursor:"pointer" }}>
                  <option value="">— none —</option>
                  {accounts.map(a=><option key={a.id} value={a.id?.toString()}>{a.name}</option>)}
                  {pool.length>0&&<optgroup label="Pool">{pool.slice(0,60).map(a=><option key={a.id} value={a.id?.toString()}>{a.name}</option>)}</optgroup>}
                </select>
                {linkedAcct&&(
                  <>
                    {linkedAcct.prods?.[0]&&<span style={{ ...mono, fontSize:10, color:C.gold, background:C.goldBg, border:`1px solid ${C.goldBdr}`, borderRadius:3, padding:"1px 6px" }}>{linkedAcct.prods[0]}</span>}
                    {linkedAcct.ucs?.[0]&&<span style={{ ...mono, fontSize:10, color:C.blue, background:`${C.blue}18`, border:`1px solid ${C.blue}33`, borderRadius:3, padding:"1px 6px" }}>{linkedAcct.ucs[0]}</span>}
                  </>
                )}
                <span style={{ ...mono, fontSize:11, color:C.dim }}>First name</span>
                <input value={manualFirst} onChange={e=>setManualFirst(e.target.value)} placeholder="override" style={{ ...mono, fontSize:12, padding:"3px 7px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:4, color:C.txt, width:90, outline:"none" }}/>
                <span style={{ ...mono, fontSize:11, color:C.dim }}>Cal link</span>
                <input value={manualCal} onChange={e=>setManualCal(e.target.value)} placeholder="https://cal.com/..." style={{ ...mono, fontSize:12, padding:"3px 7px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:4, color:C.txt, width:150, outline:"none" }}/>
              </div>

              {/* Subject */}
              <div style={{ padding:"8px 14px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:7 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
                  <span style={{ ...mono, fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>Subject</span>
                  <button onClick={()=>{navigator.clipboard.writeText(previewSubject).catch(()=>{});setSubCopied(true);setTimeout(()=>setSubCopied(false),1500);}} style={{ ...mono, fontSize:10, padding:"1px 6px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:3, color:C.dim, cursor:"pointer", marginLeft:"auto" }}>{subCopied?"✓":"copy"}</button>
                </div>
                {editMode
                  ? <input value={editSubject} onChange={e=>setEditSubject(e.target.value)} style={{ width:"100%", fontSize:14, padding:"4px 6px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:4, color:C.txt, outline:"none", boxSizing:"border-box" }}/>
                  : <div style={{ fontSize:14, color:C.txt, fontWeight:500 }}>{previewSubject}</div>
                }
              </div>

              {/* Body */}
              <div style={{ padding:"10px 14px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:7, flex:1 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                  <span style={{ ...mono, fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>Body</span>
                  <button onClick={()=>setEditMode(m=>!m)} style={{ ...mono, fontSize:10, padding:"2px 8px", background:editMode?`${C.purple}18`:"transparent", border:`1px solid ${editMode?C.purple:C.brd}`, borderRadius:3, color:editMode?C.purple:C.dim, cursor:"pointer" }}>{editMode?"✓ Editing":"✏ Edit"}</button>
                  {editMode&&<button onClick={()=>{setEditSubject(selectedTpl.subject);setEditBody(selectedTpl.body);}} style={{ ...mono, fontSize:10, padding:"2px 8px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:3, color:C.dim, cursor:"pointer" }}>↺ Reset</button>}
                </div>
                {editMode
                  ? <textarea value={editBody} onChange={e=>setEditBody(e.target.value)} style={{ width:"100%", minHeight:260, fontSize:13, padding:"8px 10px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:5, color:C.txt, outline:"none", resize:"vertical", lineHeight:1.8, boxSizing:"border-box", fontFamily:"inherit" }}/>
                  : <pre style={{ margin:0, fontSize:13, color:C.txt, lineHeight:1.8, whiteSpace:"pre-wrap", fontFamily:"inherit" }}>{previewBody}</pre>
                }
              </div>

              {/* Actions */}
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                <button onClick={copyEmail} style={{ padding:"9px 20px", background:copied?`${C.green}22`:C.goldBg, border:`1px solid ${copied?C.green:C.goldBdr}`, color:copied?C.green:C.gold, borderRadius:7, cursor:"pointer", fontSize:14, fontWeight:500 }}>
                  {copied?"✓ Copied!":"📋 Copy full email"}
                </button>
                <button onClick={openGmail} style={{ padding:"9px 20px", background:"#070D18", border:`1px solid ${C.blue}44`, color:C.blue, borderRadius:7, cursor:"pointer", fontSize:14, fontWeight:500 }}>
                  ✉ Send via Gmail →
                </button>
                {linkedAcct&&(
                  <button onClick={()=>selectedTpl&&logSend(selectedTpl,previewSubject,previewBody)} style={{ ...mono, padding:"9px 14px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:7, cursor:"pointer", fontSize:12 }}>
                    📝 Log send
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div style={{ display:"flex", alignItems:"center", justifyContent:"center", color:C.dim, fontSize:14, fontStyle:"italic" }}>
              ← Select a template to preview
            </div>
          )}
        </div>
      )}

      {/* ── SEQUENCES TAB ─────────────────────────────────────────────────────── */}
      {emailTab==="sequences"&&(
        <div>
          <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:14, flexWrap:"wrap", gap:8 }}>
            <div>
              <p style={{ margin:"0 0 2px", fontSize:18, fontWeight:500, color:C.txt }}>Email Sequences</p>
              <p style={{ ...mono, margin:0, fontSize:12, color:C.dim }}>Chain templates into multi-touch cadences — Day 0 → Day 3 → Day 7 → Day 14</p>
            </div>
            {!buildingSeq&&<button onClick={()=>setBuildingSeq(true)} style={{ padding:"8px 16px", background:C.goldBg, border:`1px solid ${C.goldBdr}`, color:C.gold, borderRadius:7, cursor:"pointer", fontSize:13, fontWeight:500 }}>+ New sequence</button>}
          </div>

          {buildingSeq&&(
            <div style={{ padding:"14px 16px", background:C.card, border:`1px solid ${C.gold}44`, borderRadius:8, marginBottom:14 }}>
              <input value={seqName} onChange={e=>setSeqName(e.target.value)} placeholder="Sequence name — e.g. New logo outbound" style={{ width:"100%", fontSize:14, padding:"7px 10px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:5, color:C.txt, outline:"none", boxSizing:"border-box", marginBottom:10 }}/>
              <div style={{ display:"flex", flexDirection:"column", gap:7, marginBottom:10 }}>
                {seqSteps.map((step,i)=>(
                  <div key={i} style={{ display:"flex", gap:8, alignItems:"center" }}>
                    <span style={{ ...mono, fontSize:11, color:C.dim, width:16, textAlign:"right" }}>{i+1}.</span>
                    {i===0
                      ? <span style={{ ...mono, fontSize:11, color:C.dim, width:54, flexShrink:0 }}>Day 0</span>
                      : <div style={{ display:"flex", alignItems:"center", gap:4, flexShrink:0 }}>
                          <span style={{ ...mono, fontSize:11, color:C.dim }}>Day</span>
                          <input type="number" min={1} value={step.daysAfter} onChange={e=>setSeqSteps(ss=>ss.map((s,idx)=>idx===i?{...s,daysAfter:+e.target.value}:s))} style={{ ...mono, fontSize:12, width:46, padding:"2px 5px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:3, color:C.txt, outline:"none" }}/>
                        </div>
                    }
                    <select value={step.templateId} onChange={e=>setSeqSteps(ss=>ss.map((s,idx)=>idx===i?{...s,templateId:e.target.value}:s))} style={{ flex:1, ...mono, fontSize:12, padding:"4px 8px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:4, color:step.templateId?C.txt:C.dim, outline:"none" }}>
                      <option value="">— select template —</option>
                      {["First Touch","Follow Up","Deal Progression","Nurture"].map(cat=>(
                        <optgroup key={cat} label={cat}>
                          {EMAIL_TEMPLATES.filter(t=>t.category===cat).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
                        </optgroup>
                      ))}
                    </select>
                    {seqSteps.length>1&&<button onClick={()=>removeSeqStep(i)} style={{ ...mono, fontSize:11, padding:"2px 7px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:3, cursor:"pointer" }}>✕</button>}
                  </div>
                ))}
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={addSeqStep} style={{ ...mono, fontSize:12, padding:"5px 12px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:5, cursor:"pointer" }}>+ Add step</button>
                <button onClick={saveSequence} disabled={!seqName.trim()||seqSteps.some(s=>!s.templateId)} style={{ padding:"5px 16px", background:C.goldBg, border:`1px solid ${C.goldBdr}`, color:C.gold, borderRadius:5, cursor:"pointer", fontSize:13, fontWeight:500, opacity:(!seqName.trim()||seqSteps.some(s=>!s.templateId))?0.4:1 }}>Save</button>
                <button onClick={()=>{setBuildingSeq(false);setSeqName("");setSeqSteps([{templateId:"",daysAfter:0}]);}} style={{ ...mono, fontSize:12, padding:"5px 10px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:5, cursor:"pointer" }}>Cancel</button>
              </div>
            </div>
          )}

          {sequences.length===0&&!buildingSeq&&(
            <div style={{ textAlign:"center", padding:48, color:C.dim, fontSize:13 }}>No sequences yet — build one above to chain emails into a multi-touch cadence</div>
          )}
          {sequences.map(seq=>{
            const catClr = seq.steps[0]&&EMAIL_TEMPLATES.find(t=>t.id===seq.steps[0].templateId) ? CAT_COLOR[EMAIL_TEMPLATES.find(t=>t.id===seq.steps[0].templateId)?.category]||C.gold : C.gold;
            return(
              <div key={seq.id} style={{ padding:"12px 16px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:8, marginBottom:8 }}>
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
                  <p style={{ margin:0, fontSize:15, fontWeight:500, color:C.txt }}>{seq.name}</p>
                  <span style={{ ...mono, fontSize:10, color:C.dim }}>{seq.steps.length} steps · {seq.steps[seq.steps.length-1]?.daysAfter||0} day cadence</span>
                  <button onClick={()=>setSequences(ss=>ss.filter(s=>s.id!==seq.id))} style={{ ...mono, fontSize:10, padding:"2px 7px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:3, cursor:"pointer", marginLeft:"auto" }}>✕</button>
                </div>
                <div style={{ display:"flex", gap:5, flexWrap:"wrap", alignItems:"center" }}>
                  {seq.steps.map((step,i)=>{
                    const tpl=EMAIL_TEMPLATES.find(t=>t.id===step.templateId);
                    const clr=tpl?CAT_COLOR[tpl.category]||C.gold:C.dim;
                    return(
                      <Fragment key={i}>
                        {i>0&&<span style={{ ...mono, fontSize:10, color:C.dim }}>→ D+{step.daysAfter}</span>}
                        <span style={{ ...mono, fontSize:11, color:clr, background:`${clr}18`, border:`1px solid ${clr}33`, borderRadius:3, padding:"2px 7px" }}>{tpl?tpl.name:"?"}</span>
                      </Fragment>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── DEAL FLOW TAB ──────────────────────────────────────────────────────── */}
      {emailTab==="dealflow"&&(
        <div>
          <div style={{ marginBottom:12 }}>
            <p style={{ margin:"0 0 2px", fontSize:18, fontWeight:500, color:C.txt }}>Deal Flow Tracker</p>
            <p style={{ ...mono, margin:0, fontSize:12, color:C.dim }}>Drag accounts between stages · auto-updates on email send</p>
          </div>
          <div style={{ display:"flex", gap:10, overflowX:"auto", paddingBottom:10, alignItems:"flex-start" }}>
            {DEAL_FLOW_STAGES.map(stage=>{
              const stageAccts = accounts.filter(a=>(dealFlow[a.id]?.stage||"not_contacted")===stage.id);
              const isDragTarget = dragOver===stage.id;
              return(
                <div key={stage.id}
                  onDragOver={e=>{e.preventDefault();setDragOver(stage.id);}}
                  onDragLeave={()=>setDragOver(null)}
                  onDrop={e=>{e.preventDefault();const id=e.dataTransfer.getData("text/plain");if(id)moveToDealStage(id,stage.id);setDragOver(null);setDragAcct(null);}}
                  style={{ minWidth:190, background:isDragTarget?`${stage.color}18`:stage.bg, border:`1px solid ${isDragTarget?stage.color:C.brd}`, borderRadius:8, padding:"10px 10px", flexShrink:0, transition:"all 0.12s" }}>
                  <div style={{ ...mono, fontSize:10, color:stage.color, fontWeight:600, marginBottom:2, textTransform:"uppercase", letterSpacing:"0.07em" }}>{stage.label}</div>
                  <div style={{ ...mono, fontSize:10, color:C.dim, marginBottom:8 }}>{stageAccts.length} acct{stageAccts.length!==1?"s":""}</div>
                  {stageAccts.map(a=>{
                    const ts=TS[a.tier]||{c:C.dim,i:"○"};
                    const df=dealFlow[a.id];
                    const daysInStage = df?.stageChangedAt?Math.floor((Date.now()-new Date(df.stageChangedAt).getTime())/86400000):null;
                    return(
                      <div key={a.id} draggable
                        onDragStart={e=>{e.dataTransfer.setData("text/plain",a.id?.toString());setDragAcct(a.id);}}
                        onDragEnd={()=>{setDragAcct(null);setDragOver(null);}}
                        style={{ padding:"7px 9px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:6, marginBottom:5, cursor:"grab", opacity:dragAcct===a.id?0.45:1, userSelect:"none" }}>
                        <div style={{ fontSize:12, color:C.txt, fontWeight:500, marginBottom:2, lineHeight:1.2 }}>{a.name}</div>
                        <div style={{ display:"flex", gap:5, alignItems:"center" }}>
                          <span style={{ ...mono, fontSize:10, color:ts.c }}>{ts.i} {a.tier||"?"}</span>
                          {daysInStage!==null&&<span style={{ ...mono, fontSize:10, color:C.dim, marginLeft:"auto" }}>{daysInStage}d</span>}
                        </div>
                      </div>
                    );
                  })}
                  {isDragTarget&&<div style={{ padding:"5px 7px", border:`1px dashed ${stage.color}77`, borderRadius:5, textAlign:"center", ...mono, fontSize:10, color:stage.color, marginTop:2 }}>Drop</div>}
                </div>
              );
            })}
          </div>
          {accounts.length===0&&<div style={{ textAlign:"center", padding:40, color:C.dim, fontSize:13 }}>No accounts yet — add accounts to track their deal flow stage</div>}
        </div>
      )}

      {/* ── ANALYTICS TAB ─────────────────────────────────────────────────────── */}
      {emailTab==="analytics"&&(
        <div>
          <p style={{ margin:"0 0 14px", fontSize:18, fontWeight:500, color:C.txt }}>Email Analytics</p>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(170px,1fr))", gap:10, marginBottom:18 }}>
            {[
              {label:"Sent this week",       value:thisWeek.length,  color:C.gold},
              {label:"Accounts contacted",   value:uniqueAccts,      color:C.blue},
              {label:"Response rate",        value:`${responseRate}%`,color:C.green},
              {label:"Total sent",           value:emailLog.length,  color:C.tin},
              {label:"Most used template",   value:topTpl,           color:C.purple, small:true},
            ].map(s=>(
              <div key={s.label} style={{ padding:"12px 14px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:8 }}>
                <div style={{ ...mono, fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:6 }}>{s.label}</div>
                <div style={{ fontSize:s.small?12:22, fontWeight:500, color:s.color, lineHeight:1.2, wordBreak:"break-word" }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Outpost Operator progress */}
          <div style={{ padding:"10px 14px", background:`${C.gold}08`, border:`1px solid ${C.gold}22`, borderRadius:8, marginBottom:16 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
              <span>📬</span>
              <span style={{ fontSize:13, fontWeight:500, color:C.txt }}>Outpost Operator</span>
              <span style={{ ...mono, fontSize:11, color:C.dim }}>Send 10+ emails this week</span>
              <span style={{ ...mono, fontSize:12, color:thisWeek.length>=10?C.green:C.gold, marginLeft:"auto" }}>{Math.min(thisWeek.length,10)}/10</span>
            </div>
            <div style={{ height:4, background:C.bg, borderRadius:2, overflow:"hidden" }}>
              <div style={{ height:"100%", width:`${Math.min(thisWeek.length/10,1)*100}%`, background:thisWeek.length>=10?C.green:C.gold, borderRadius:2, transition:"width 0.3s" }}/>
            </div>
          </div>

          {/* Log */}
          <p style={{ ...mono, fontSize:11, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>Recent sends</p>
          {emailLog.length===0&&<div style={{ textAlign:"center", padding:32, color:C.dim, fontSize:13 }}>No emails logged yet — copy or send a template to start tracking</div>}
          {emailLog.slice(0,25).map(entry=>(
            <div key={entry.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 10px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:6, marginBottom:5 }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, color:C.txt, fontWeight:500 }}>{entry.accountName}</div>
                <div style={{ ...mono, fontSize:11, color:C.dim, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{entry.templateName} · {entry.subject}</div>
              </div>
              <div style={{ ...mono, fontSize:11, color:C.dim, flexShrink:0 }}>{new Date(entry.sentAt).toLocaleDateString()}</div>
              <button onClick={()=>setEmailLog(l=>l.map(e=>e.id===entry.id?{...e,replied:!e.replied}:e))} style={{ ...mono, fontSize:11, padding:"2px 8px", background:entry.replied?`${C.green}18`:"transparent", border:`1px solid ${entry.replied?C.green:C.brd}`, color:entry.replied?C.green:C.dim, borderRadius:3, cursor:"pointer", flexShrink:0 }}>
                {entry.replied?"✓ Replied":"Mark replied"}
              </button>
              <button onClick={()=>setEmailLog(l=>l.filter(e=>e.id!==entry.id))} style={{ ...mono, fontSize:10, padding:"2px 6px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:3, cursor:"pointer", flexShrink:0 }}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default EmailSystemPage;
