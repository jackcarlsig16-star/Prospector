import { useState } from 'react';
import { C, mono } from '../../constants/colors';
import { MODELS } from '../../config/models';

export const NUGGET_WORKFLOWS = ["Territory management","Account research","Meeting prep","Stealth pipeline","Analytics","Bulk assay","Task tracking","Email/outreach","Admin/settings","Other"];
export const NUGGET_STATUS_COLORS = {"pending":C.mut,"reviewing":C.purple,"planned":C.blue||"#4A9EFF","shipped":C.green,"rejected":C.red};
export const NUGGET_PRIORITY_COLORS = {"High":C.red,"Medium":C.orange,"Low":C.mut};

export default function GoldenNuggetsTab({ nuggets=[], onSaveNuggets, activeUser, isAdmin=false }) {
  const [text,setText]           = useState("");
  const [workflow,setWorkflow]   = useState("");
  const [anonymous,setAnonymous] = useState(false);
  const [submitting,setSubmitting] = useState(false);
  const [submitErr,setSubmitErr] = useState(null);
  const [submitOk,setSubmitOk]   = useState(false);
  const [sortBy,setSortBy]       = useState("votes");
  const [filterCat,setFilterCat] = useState(null);
  const myName = activeUser?.name || "AE";

  const handleSubmit = async () => {
    if(!text.trim()) return;
    setSubmitting(true); setSubmitErr(null);
    let category="Feature Request", priority="Medium", summary=text.trim().slice(0,120);
    try {
      const r = await fetch("/proxy/anthropic/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        model:MODELS.FAST, max_tokens:120,
        messages:[{role:"user",content:`Categorize this product feedback in JSON only (no markdown):\n"${text.trim().slice(0,600)}"\n\nReturn: {"category":"Bug|Feature Request|UX|Performance|Data|Other","priority":"High|Medium|Low","summary":"one sentence under 100 chars"}`}]
      })});
      const d = await r.json();
      const raw = d.content?.[0]?.text || "{}";
      const m = raw.match(/\{[\s\S]+\}/);
      if(m){const parsed=JSON.parse(m[0]);category=parsed.category||category;priority=parsed.priority||priority;summary=parsed.summary||summary;}
    } catch {} // silently fall back to defaults
    const nugget = {
      id:`ng_${Date.now()}`,
      text:text.trim(), workflow:workflow||null,
      category, priority, summary,
      submittedBy: anonymous ? "Anonymous" : myName,
      realName: myName,
      anonymous,
      submittedAt: new Date().toISOString(),
      upvotes:[myName], downvotes:[],
      status:"pending", adminNotes:"", releaseTag:"", shippedAt:null,
    };
    onSaveNuggets(ns=>[nugget,...ns]);
    setText(""); setWorkflow(""); setAnonymous(false);
    setSubmitOk(true); setTimeout(()=>setSubmitOk(false),3000);
    setSubmitting(false);
  };

  const toggleVote = (id, dir) => {
    onSaveNuggets(ns=>ns.map(n=>{
      if(n.id!==id) return n;
      const ups=n.upvotes||[], downs=n.downvotes||[];
      if(dir==="up"){
        const voted=ups.includes(myName);
        return {...n, upvotes:voted?ups.filter(x=>x!==myName):[...ups,myName], downvotes:downs.filter(x=>x!==myName)};
      } else {
        const voted=downs.includes(myName);
        return {...n, downvotes:voted?downs.filter(x=>x!==myName):[...downs,myName], upvotes:ups.filter(x=>x!==myName)};
      }
    }));
  };

  const netScore = n => (n.upvotes?.length||0) - (n.downvotes?.length||0);
  const sorted = [...nuggets].sort((a,b)=>{
    if(sortBy==="votes") return netScore(b)-netScore(a);
    if(sortBy==="newest") return new Date(b.submittedAt)-new Date(a.submittedAt);
    const order=["reviewing","planned","pending","shipped","rejected"];
    return order.indexOf(a.status)-order.indexOf(b.status);
  }).filter(n=>!filterCat||n.category===filterCat);

  const myCats = [...new Set(nuggets.map(n=>n.category))];

  return (
    <div>
      {/* Submit form */}
      <div style={{ background:"#1A160E", border:`1px solid ${C.goldBdr}`, borderRadius:10, padding:"16px 18px", marginBottom:20 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
          <span style={{ fontSize:18 }}>🪙</span>
          <p style={{ ...mono, margin:0, fontSize:13, fontWeight:600, color:C.gold }}>Drop a Golden Nugget</p>
          <span style={{ ...mono, fontSize:11, color:C.dim }}>— ideas, pain points, feature requests</span>
        </div>
        <textarea
          value={text} onChange={e=>setText(e.target.value)} placeholder="What would make Prospector better? Be specific — good ideas get built."
          style={{ width:"100%", minHeight:80, background:C.bg, border:`1px solid ${C.brd}`, borderRadius:6, padding:"10px 12px", color:C.txt, fontSize:14, fontFamily:"inherit", resize:"vertical", boxSizing:"border-box", outline:"none" }}
          onKeyDown={e=>{if(e.key==="Enter"&&(e.metaKey||e.ctrlKey))handleSubmit();}}
        />
        <div style={{ display:"flex", gap:10, marginTop:10, alignItems:"center", flexWrap:"wrap" }}>
          <select value={workflow} onChange={e=>setWorkflow(e.target.value)}
            style={{ ...mono, fontSize:12, background:C.card, border:`1px solid ${C.brd}`, borderRadius:5, padding:"5px 10px", color:workflow?C.txt:C.dim, cursor:"pointer", flex:1, minWidth:160 }}>
            <option value="">Workflow (optional)</option>
            {NUGGET_WORKFLOWS.map(w=><option key={w} value={w}>{w}</option>)}
          </select>
          <label style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer", userSelect:"none" }}>
            <div onClick={()=>setAnonymous(a=>!a)} style={{ width:28, height:16, borderRadius:8, background:anonymous?C.purple:C.brd, position:"relative", transition:"background 0.2s", flexShrink:0 }}>
              <div style={{ position:"absolute", top:2, left:anonymous?12:2, width:12, height:12, borderRadius:"50%", background:"#fff", transition:"left 0.2s" }}/>
            </div>
            <span style={{ ...mono, fontSize:11, color:anonymous?C.purple:C.dim }}>Anonymous</span>
            {anonymous&&<span style={{ ...mono, fontSize:10, color:C.dim }}>— you still get the badge if it ships</span>}
          </label>
          <span style={{ ...mono, fontSize:11, color:C.dim }}>⌘↵</span>
          <button onClick={handleSubmit} disabled={submitting||!text.trim()}
            style={{ ...mono, fontSize:12, padding:"6px 16px", background:submitting||!text.trim()?`${C.gold}18`:`${C.gold}33`, border:`1px solid ${C.gold}55`, color:submitting||!text.trim()?C.dim:C.gold, borderRadius:6, cursor:submitting||!text.trim()?"default":"pointer", fontWeight:600 }}>
            {submitting?"⬡ Categorizing…":submitOk?"✓ Submitted!":"Submit nugget"}
          </button>
        </div>
        {submitErr&&<p style={{ ...mono, margin:"8px 0 0", fontSize:11, color:C.red }}>{submitErr}</p>}
      </div>

      {/* Controls */}
      {nuggets.length>0 && (
        <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap", alignItems:"center" }}>
          <span style={{ ...mono, fontSize:11, color:C.dim }}>Sort:</span>
          {[["votes","Top voted"],["newest","Newest"],["status","By status"]].map(([v,l])=>(
            <button key={v} onClick={()=>setSortBy(v)} style={{ ...mono, fontSize:11, padding:"3px 10px", borderRadius:4, border:`1px solid ${sortBy===v?C.goldBdr:C.brd}`, background:sortBy===v?C.goldBg:"transparent", color:sortBy===v?C.gold:C.mut, cursor:"pointer" }}>{l}</button>
          ))}
          <span style={{ ...mono, fontSize:11, color:C.dim, marginLeft:8 }}>Filter:</span>
          <button onClick={()=>setFilterCat(null)} style={{ ...mono, fontSize:11, padding:"3px 10px", borderRadius:4, border:`1px solid ${!filterCat?C.goldBdr:C.brd}`, background:!filterCat?C.goldBg:"transparent", color:!filterCat?C.gold:C.mut, cursor:"pointer" }}>All</button>
          {myCats.map(c=>(
            <button key={c} onClick={()=>setFilterCat(fc=>fc===c?null:c)} style={{ ...mono, fontSize:11, padding:"3px 10px", borderRadius:4, border:`1px solid ${filterCat===c?C.purple+"88":C.brd}`, background:filterCat===c?`${C.purple}18`:"transparent", color:filterCat===c?C.purple:C.mut, cursor:"pointer" }}>{c}</button>
          ))}
          <span style={{ ...mono, fontSize:11, color:C.dim, marginLeft:"auto" }}>{sorted.length} idea{sorted.length!==1?"s":""}</span>
        </div>
      )}

      {/* Ideas feed */}
      {sorted.length===0 && (
        <div style={{ textAlign:"center", padding:"40px 0", color:C.dim }}>
          <div style={{ fontSize:32, marginBottom:8 }}>🪙</div>
          <p style={{ ...mono, fontSize:13 }}>No nuggets yet. Drop the first one above.</p>
        </div>
      )}
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {sorted.map(n=>{
          const upvoted   = n.upvotes?.includes(myName);
          const downvoted = (n.downvotes||[]).includes(myName);
          const net = netScore(n);
          const sc  = NUGGET_STATUS_COLORS[n.status] || C.mut;
          const pc  = NUGGET_PRIORITY_COLORS[n.priority] || C.mut;
          const isShipped = n.status==="shipped";
          const displayName = n.anonymous && !isAdmin ? "Anonymous" : (n.anonymous && isAdmin ? `${n.submittedBy} (anon)` : n.submittedBy);
          return (
            <div key={n.id} style={{ background:C.card, border:`1px solid ${isShipped?C.green+"44":C.brd}`, borderRadius:8, padding:"12px 14px", display:"flex", gap:12, alignItems:"flex-start" }}>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:1, flexShrink:0 }}>
                <button onClick={()=>toggleVote(n.id,"up")} title="Upvote"
                  style={{ background:upvoted?`${C.gold}22`:"transparent", border:`1px solid ${upvoted?C.gold+"55":C.brd}`, borderRadius:"5px 5px 0 0", padding:"4px 10px", cursor:"pointer", lineHeight:1 }}>
                  <span style={{ fontSize:13, color:upvoted?C.gold:C.dim }}>{upvoted?"▲":"△"}</span>
                </button>
                <span style={{ ...mono, fontSize:12, fontWeight:700, color:net>0?C.gold:net<0?C.red:C.dim, padding:"2px 0", minWidth:28, textAlign:"center" }}>{net>0?"+":""}{net}</span>
                <button onClick={()=>toggleVote(n.id,"down")} title="Downvote"
                  style={{ background:downvoted?`${C.red}18`:"transparent", border:`1px solid ${downvoted?C.red+"55":C.brd}`, borderRadius:"0 0 5px 5px", padding:"4px 10px", cursor:"pointer", lineHeight:1 }}>
                  <span style={{ fontSize:13, color:downvoted?C.red:C.dim }}>{downvoted?"▼":"▽"}</span>
                </button>
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center", marginBottom:5 }}>
                  <span style={{ ...mono, fontSize:10, padding:"2px 7px", borderRadius:3, background:`${C.purple}18`, border:`1px solid ${C.purple}44`, color:C.purple }}>{n.category}</span>
                  <span style={{ ...mono, fontSize:10, padding:"2px 7px", borderRadius:3, background:`${pc}18`, border:`1px solid ${pc}44`, color:pc }}>{n.priority}</span>
                  <span style={{ ...mono, fontSize:10, padding:"2px 7px", borderRadius:3, background:`${sc}18`, border:`1px solid ${sc}44`, color:sc }}>{n.status==="shipped"?"✓ Shipped":n.status.charAt(0).toUpperCase()+n.status.slice(1)}</span>
                  {n.releaseTag&&<span style={{ ...mono, fontSize:10, color:C.dim }}>· {n.releaseTag}</span>}
                </div>
                {n.summary&&<p style={{ margin:"0 0 4px", fontSize:14, color:C.txt, fontWeight:500 }}>{n.summary}</p>}
                <p style={{ ...mono, margin:"0 0 5px", fontSize:12, color:C.mut, lineHeight:1.5 }}>{n.text}</p>
                <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                  {n.workflow&&<span style={{ ...mono, fontSize:10, color:C.dim }}>📂 {n.workflow}</span>}
                  <span style={{ ...mono, fontSize:10, color:C.dim }}>
                    {n.anonymous?<span style={{ color:C.purple+"aa" }}>👤 Anonymous</span>:displayName}
                    {isAdmin&&n.anonymous&&<span style={{ color:C.dim }}> ({n.realName||n.submittedBy})</span>}
                    {" · "}{new Date(n.submittedAt).toLocaleDateString()}
                  </span>
                  {n.adminNotes&&<span style={{ ...mono, fontSize:10, color:C.green }}>💬 {n.adminNotes}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
