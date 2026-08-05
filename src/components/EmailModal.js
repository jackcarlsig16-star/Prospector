import { useState, useEffect } from 'react';
import { C, mono } from '../constants/colors';
import { getActiveIntel } from '../utils/assay';
import { getActiveVoice, getVoiceProfile, voiceProfileKey } from '../constants/voice';
import { UCS_DATA } from '../constants/products';

export default function EmailModal({ account, persona, onClose, onSaveEmail }) {
  const [email,setEmail]=useState("");
  const [loading,setLoading]=useState(true);
  const [copied,setCopied]=useState(false);
  const [originalEmail,setOriginalEmail]=useState("");
  const [teaching,setTeaching]=useState(false);
  const [taught,setTaught]=useState(false);
  const voiceUserName=(()=>{try{return JSON.parse(localStorage.getItem("prospector_user")||"{}").name||"";}catch{return "";}})();

  useEffect(()=>{
    const customIntel=getActiveIntel();
    const user=JSON.parse(localStorage.getItem("prospector_user")||"{}");
    fetch("/api/email",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        name:account.name,
        businessModel:account.bm||"",
        productFit:account.pf||"",
        useCase:account.useCase||(account.ucs?.[0]?UCS_DATA.find(u=>u.id===account.ucs[0])?.lb:"")||"",
        products:account.prods||[],
        personaName:persona?.name||"",
        personaTitle:persona?.title||"",
        customIntel,
        senderName:user.name||"",
        voiceExamples:getActiveVoice(voiceUserName),
        voiceProfile:getVoiceProfile(voiceUserName),
      })
    })
    .then(r=>r.json())
    .then(d=>{
      const body=d.email||d.error||"Failed to generate.";
      setEmail(body);
      setOriginalEmail(body);
      setLoading(false);
      if(d.email&&onSaveEmail){
        onSaveEmail({date:new Date().toLocaleDateString(),persona:persona?`${persona.name} · ${persona.title}`:"No persona",body:d.email});
      }
    })
    .catch(e=>{setEmail("Error: "+e.message);setLoading(false);});
  },[]);// eslint-disable-line react-hooks/exhaustive-deps

  const copy=()=>{navigator.clipboard.writeText(email);setCopied(true);setTimeout(()=>setCopied(false),2000);};

  return(
    <div onClick={onClose} style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000 }}>
      <div onClick={e=>e.stopPropagation()} style={{ width:580,maxHeight:"85vh",background:C.sur,border:`1px solid ${C.brd}`,borderRadius:12,display:"flex",flexDirection:"column",overflow:"hidden" }}>
        <div style={{ padding:"16px 20px",borderBottom:`1px solid ${C.brd}`,display:"flex",alignItems:"flex-start",justifyContent:"space-between" }}>
          <div>
            <p style={{ margin:"0 0 4px",fontSize:15,fontWeight:500,color:C.txt }}>{account.name}</p>
            <div style={{ display:"flex",gap:8,flexWrap:"wrap",alignItems:"center" }}>
              {persona&&<span style={{ fontSize:12,color:C.green,fontWeight:500 }}>→ {persona.name} · {persona.title}</span>}
              {!persona&&<span style={{ fontSize:12,color:C.dim }}>No persona selected — using [First Name]</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background:"transparent",border:"none",color:C.mut,fontSize:18,cursor:"pointer",padding:"0 4px",lineHeight:1 }}>✕</button>
        </div>
        <div style={{ flex:1,overflowY:"auto",padding:"16px 20px" }}>
          {loading
            ? <p style={{ ...mono,fontSize:13,color:C.purple }}>⬡ Generating email…</p>
            : <textarea value={email} onChange={e=>setEmail(e.target.value)} style={{ width:"100%",height:300,fontSize:13,lineHeight:1.9,background:C.bg,border:`1px solid ${C.brd}`,borderRadius:6,color:C.txt,padding:"12px 14px",resize:"vertical",outline:"none",fontFamily:"inherit",boxSizing:"border-box" }}/>
          }
        </div>
        <div style={{ padding:"12px 20px",borderTop:`1px solid ${C.brd}`,display:"flex",flexDirection:"column",gap:8 }}>
          <div style={{ display:"flex",gap:8 }}>
            <button onClick={copy} disabled={loading} style={{ fontSize:13,padding:"7px 16px",background:C.goldBg,border:`1px solid ${C.goldBdr}`,color:C.gold,borderRadius:6,cursor:loading?"not-allowed":"pointer",fontWeight:500 }}>
              {copied?"✓ Copied":"Copy to clipboard"}
            </button>
            <button onClick={onClose} style={{ fontSize:13,padding:"7px 14px",background:"transparent",border:`1px solid ${C.brd}`,color:C.mut,borderRadius:6,cursor:"pointer" }}>Close</button>
          </div>
          {!loading&&email&&!email.startsWith("Error")&&(()=>{
            const vp=getVoiceProfile(voiceUserName);
            return(
              <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:8, flexWrap:"wrap" }}>
                {vp&&(
                  <span style={{ ...mono, fontSize:11, color:C.green, background:`${C.green}12`, border:`1px solid ${C.green}30`, borderRadius:4, padding:"2px 8px", display:"flex", alignItems:"center", gap:4 }}>
                    ✓ Written in your voice
                    <span style={{ color:C.dim }}>·</span>
                    <span style={{ color:C.dim }}>{(vp.keyTraits||[]).slice(0,2).join(", ")||vp.tone||"direct"}</span>
                  </span>
                )}
                {vp&&email!==originalEmail&&!taught&&(
                  <button onClick={async()=>{
                    setTeaching(true);
                    try{
                      const r=await fetch("/api/learn-voice",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
                        accessToken:localStorage.getItem("gmail_access_token")||"",
                        mode:"teach", original:originalEmail, edited:email,
                        existingProfile:getVoiceProfile(voiceUserName),
                      })});
                      const d=await r.json();
                      if(d.profile){localStorage.setItem(voiceProfileKey(voiceUserName),JSON.stringify(d.profile));setTaught(true);}
                    }catch{}
                    setTeaching(false);
                  }} style={{ ...mono, fontSize:11, padding:"2px 8px", background:`${C.blue}12`, border:`1px solid ${C.blue}30`, color:C.blue, borderRadius:4, cursor:"pointer" }}>
                    {teaching?"Teaching…":"Teach from my edits ↺"}
                  </button>
                )}
                {taught&&<span style={{ ...mono, fontSize:11, color:C.green }}>✓ Voice updated</span>}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
