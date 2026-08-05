import React from 'react';
import { C, mono } from '../constants/colors';
import { trackStat } from '../utils/stats';

export default function AccountCardExpandedPanels({
  // Email
  emailOpen, setEmailOpen, emailBody, setEmailBody, emailLoading, emailCopied, setEmailCopied, generateEmail, topPersona,
  // Glean
  gleanOpen, setGleanOpen, gleanLoading, gleanResults, gleanError, searchGlean,
  // Common
  acc,
}) {
  return (
    <>
      {emailOpen&&(
        <div style={{ marginBottom:12,background:C.bg,border:`1px solid ${C.tinBdr}`,borderRadius:7,padding:"12px 14px" }}>
          <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:8 }}>
            <span style={{ ...mono,fontSize:11,fontWeight:500,color:C.tin,textTransform:"uppercase",letterSpacing:"0.08em" }}>
              Email draft{topPersona?` → ${topPersona.name} · ${topPersona.title}`:" → [First Name]"}
            </span>
            {emailLoading&&<span style={{ ...mono,fontSize:11,color:C.purple }}>⬡ generating…</span>}
            <button onClick={()=>setEmailOpen(false)} style={{ marginLeft:"auto",background:"transparent",border:"none",color:C.dim,fontSize:14,cursor:"pointer",padding:0,lineHeight:1 }}>✕</button>
          </div>
          {!emailLoading&&<textarea value={emailBody} onChange={e=>setEmailBody(e.target.value)} style={{ width:"100%",height:240,fontSize:13,lineHeight:1.9,background:C.sur,border:`1px solid ${C.brd}`,borderRadius:5,color:C.txt,padding:"10px 12px",resize:"vertical",outline:"none",fontFamily:"inherit",boxSizing:"border-box" }}/>}
          {emailLoading&&<div style={{ height:120,display:"flex",alignItems:"center",justifyContent:"center" }}><span style={{ ...mono,fontSize:13,color:C.purple }}>⬡ Generating…</span></div>}
          <div style={{ display:"flex",gap:7,marginTop:8 }}>
            <button onClick={()=>{navigator.clipboard.writeText(emailBody);setEmailCopied(true);setTimeout(()=>setEmailCopied(false),2000);trackStat("emails_sent");}} disabled={emailLoading||!emailBody} style={{ fontSize:12,padding:"5px 14px",background:C.goldBg,border:`1px solid ${C.goldBdr}`,color:emailLoading?C.dim:C.gold,borderRadius:5,cursor:emailLoading?"not-allowed":"pointer",fontWeight:500 }}>{emailCopied?"✓ Copied":"Copy"}</button>
            <button onClick={generateEmail} disabled={emailLoading} style={{ fontSize:12,padding:"5px 12px",background:"transparent",border:`1px solid ${C.brd}`,color:C.mut,borderRadius:5,cursor:emailLoading?"not-allowed":"pointer" }}>↻ Regenerate</button>
          </div>
        </div>
      )}
      {/* ── Glean search panel ── */}
      {gleanOpen&&(
        <div style={{ marginBottom:12, background:"#060e18", border:"1px solid #4A9AE844", borderRadius:7, padding:"12px 14px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
            <span style={{ ...mono, fontSize:11, fontWeight:500, color:"#4A9AE8", textTransform:"uppercase", letterSpacing:"0.08em" }}>⬡ Glean — {acc.name}</span>
            {gleanLoading&&<span style={{ ...mono, fontSize:11, color:C.dim }}>searching…</span>}
            <button onClick={()=>searchGlean()} disabled={gleanLoading} style={{ ...mono, fontSize:11, padding:"2px 8px", background:"transparent", border:`1px solid ${"#4A9AE855"}`, color:"#4A9AE8aa", borderRadius:4, cursor:"pointer" }}>↻</button>
            <button onClick={()=>setGleanOpen(false)} style={{ marginLeft:"auto", background:"transparent", border:"none", color:C.dim, fontSize:14, cursor:"pointer", padding:0 }}>✕</button>
          </div>
          {gleanError&&<p style={{ ...mono, fontSize:12, color:C.red, margin:0 }}>✕ {gleanError}</p>}
          {!gleanLoading&&gleanResults&&gleanResults.length===0&&<p style={{ ...mono, fontSize:12, color:C.dim, margin:0 }}>No results found in Glean.</p>}
          {gleanResults&&gleanResults.length>0&&(
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {gleanResults.map((r,i)=>(
                <div key={i} style={{ padding:"8px 10px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:6 }}>
                  <div style={{ display:"flex", alignItems:"flex-start", gap:8, marginBottom:3 }}>
                    <span style={{ ...mono, fontSize:10, color:C.dim, background:C.bg, border:`1px solid ${C.brd}`, borderRadius:3, padding:"1px 5px", flexShrink:0, marginTop:1 }}>{r.source}</span>
                    {r.url
                      ? <a href={r.url} target="_blank" rel="noreferrer" style={{ fontSize:13, fontWeight:500, color:"#4A9AE8", textDecoration:"none", lineHeight:1.4, flex:1 }}>{r.title}</a>
                      : <span style={{ fontSize:13, fontWeight:500, color:C.txt, lineHeight:1.4, flex:1 }}>{r.title}</span>
                    }
                  </div>
                  {r.snippet&&<p style={{ margin:0, fontSize:12, color:C.mut, lineHeight:1.6 }}>{r.snippet}</p>}
                </div>
              ))}
            </div>
          )}
          {gleanLoading&&<div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:80 }}><span style={{ ...mono, fontSize:13, color:"#4A9AE8aa" }}>⬡ Searching Glean…</span></div>}
        </div>
      )}
    </>
  );
}
