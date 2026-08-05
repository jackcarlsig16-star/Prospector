import React from 'react';
import { C, mono } from '../constants/colors';

export default function AccountCardDealReview({ sections, loading, regenKey, error, onGenerate, onUpdateField }) {
  const DR_SECTIONS=[
    { key:"overview",       label:"Overview",         placeholder:"What they do, why us, where the deal stands" },
    { key:"technicalWins",  label:"Technical Wins",   placeholder:"• ..." },
    { key:"commercialWins", label:"Commercial Wins",  placeholder:"• ..." },
    { key:"legal",         label:"Legal / Security",  placeholder:"Where are we in security review, DPA, etc." },
    { key:"decisionMakers",label:"Decision Makers",   placeholder:"Economic buyer, champion, influencers" },
    { key:"nextSteps",     label:"Next Steps",        placeholder:"→ ..." },
  ];
  const sec = sections||{};
  const hasSec = DR_SECTIONS.some(s=>sec[s.key]);
  const taStyle={ width:"100%", boxSizing:"border-box", resize:"vertical", minHeight:48,
    background:"#0a0a0f", border:`1px solid #1e2030`, borderRadius:4,
    color:"#c8cdd8", fontSize:12, lineHeight:1.6, padding:"6px 8px",
    fontFamily:"ui-monospace,'SF Mono',Menlo,monospace", outline:"none" };
  return(
  <div style={{ marginBottom:12 }}>
    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
      <span style={{ ...mono, fontSize:10, fontWeight:700, color:C.purple, textTransform:"uppercase", letterSpacing:"0.08em" }}>Deal Review</span>
      {loading&&!regenKey&&<span style={{ ...mono, fontSize:10, color:C.dim }}>generating…</span>}
      <button onClick={()=>onGenerate()} disabled={loading}
        style={{ ...mono, fontSize:9, padding:"2px 7px", background:"transparent", border:`1px solid ${C.purple}44`, color:`${C.purple}88`, borderRadius:3, cursor:"pointer" }}>↺ all</button>
    </div>
    {error&&<p style={{ ...mono, fontSize:11, color:C.red, margin:"0 0 8px" }}>✕ {error}</p>}
    {loading&&!regenKey&&!hasSec&&(
      <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:60 }}>
        <span style={{ ...mono, fontSize:12, color:`${C.purple}88` }}>generating deal review…</span>
      </div>
    )}
    {!loading&&!hasSec&&(
      <p style={{ ...mono, fontSize:11, color:C.dim, margin:0 }}>Nothing yet — <button onClick={()=>onGenerate()} style={{ ...mono, fontSize:11, background:"none", border:"none", color:`${C.purple}cc`, cursor:"pointer", padding:0, textDecoration:"underline" }}>generate with AI</button></p>
    )}
    {hasSec&&(
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {DR_SECTIONS.map(({key,label,placeholder})=>(
          <div key={key}>
            <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:3 }}>
              <span style={{ ...mono, fontSize:9, fontWeight:700, color:C.purple, textTransform:"uppercase", letterSpacing:"0.07em" }}>{label}</span>
              <button onClick={()=>onGenerate(key)} disabled={loading}
                style={{ ...mono, fontSize:8, padding:"1px 4px", background:"transparent", border:`1px solid ${C.purple}33`, color:`${C.purple}66`, borderRadius:3, cursor:"pointer" }}>
                {regenKey===key?"…":"↺"}
              </button>
            </div>
            <textarea value={sec[key]||""} placeholder={placeholder}
              onChange={e=>onUpdateField(key, e.target.value)}
              style={taStyle} rows={key==="overview"?3:2}/>
          </div>
        ))}
      </div>
    )}
  </div>
  );
}
