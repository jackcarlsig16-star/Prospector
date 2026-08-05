import { useState } from 'react';
import { C } from '../constants/colors';
import EmailModal from './EmailModal';

const toSfdcUrl = v => {
  if (!v || !v.trim()) return null;
  if (v.startsWith("http")) return v.trim();
  if (/^001[A-Za-z0-9]{12,15}$/.test(v.trim())) return `https://your-org.lightning.force.com/lightning/r/Account/${v.trim()}/view`;
  return null;
};

export default function PersonasSection({ acc, onUpdate }) {
  const [loading,setLoading]=useState(false);
  const [emailModal,setEmailModal]=useState(null);
  const [manualForm,setManualForm]=useState({name:"",title:"",linkedinUrl:""});
  const [adding,setAdding]=useState(false);
  const personas=acc.personas||[];

  const addManual=()=>{
    if(!manualForm.name.trim())return;
    const p={name:manualForm.name.trim(),title:manualForm.title.trim(),linkedinUrl:manualForm.linkedinUrl.trim()||null,relevance:"Manually added"};
    onUpdate({...acc,personas:[p,...personas]});
    setManualForm({name:"",title:"",linkedinUrl:""});
    setAdding(false);
  };

  const removePersona=(i)=>{
    onUpdate({...acc,personas:personas.filter((_,idx)=>idx!==i)});
  };

  const findPersonas=async()=>{
    setLoading(true);
    try{
      const res=await fetch("/api/personas",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:acc.name,web:acc.web,linkedin:acc.linkedin,vert:acc.vert})});
      const data=await res.json();
      onUpdate({...acc,personas:data.personas||[]});
    }catch(e){console.error(e);}
    setLoading(false);
  };

  const saveEmail=(email)=>{
    const emails=[{...email},...(acc.emails||[])].slice(0,10);
    onUpdate({...acc,emails});
  };

  return(
    <div style={{ marginTop:12, borderLeft:"2px solid #0f6e56", paddingLeft:12, paddingTop:8, paddingBottom:8 }}>
      {emailModal&&<EmailModal account={acc} persona={emailModal} onClose={()=>setEmailModal(null)} onSaveEmail={saveEmail}/>}
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
        <span style={{ fontFamily:"monospace", fontSize:9, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.1em", color:"#0f6e56" }}>Personas {personas.length>0&&`(${personas.length})`}</span>
        <button onClick={e=>{e.stopPropagation();findPersonas();}} disabled={loading} style={{ fontFamily:"monospace", fontSize:10, padding:"2px 8px", background:"transparent", border:"0.5px solid #2a2a2a", color:loading?"#0f6e56":"#555", borderRadius:4, cursor:loading?"not-allowed":"pointer" }}>{loading?"⬡ Searching...":personas.length>0?"↻ Refresh":"Find personas"}</button>
        {toSfdcUrl(acc.sfdc)&&<span style={{ fontFamily:"monospace", fontSize:10, color:C.orange, border:"0.5px solid #2a2a2a", borderRadius:3, padding:"1px 6px" }}>⬡ In SFDC</span>}
        {acc.emails?.length>0&&<span style={{ fontFamily:"monospace", fontSize:10, color:"#0f6e56", border:"0.5px solid #0f6e5644", borderRadius:3, padding:"1px 6px" }}>{acc.emails.length} email{acc.emails.length>1?"s":""} sent</span>}
        {!adding&&<button onClick={e=>{e.stopPropagation();setAdding(true);}} style={{ fontFamily:"monospace", fontSize:10, padding:"2px 8px", background:"transparent", border:"0.5px solid #2a2a2a", color:"#555", borderRadius:4, cursor:"pointer", marginLeft:"auto" }}>+ Add manually</button>}
      </div>
      {personas.length>0&&(
        <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
          {personas.map((p,i)=>(
            <div key={i} style={{ background:"#0a0a0a", border:"0.5px solid #1e1e1e", borderRadius:5, padding:"7px 10px", display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ flex:1,minWidth:0 }}>
                <p style={{ margin:"0 0 1px", fontSize:12, fontWeight:500, color:"#c8c8c0" }}>{p.name}</p>
                <p style={{ fontFamily:"monospace", margin:"0 0 2px", fontSize:10, color:"#666" }}>{p.title}</p>
                <p style={{ margin:0, fontSize:11, color:"#444" }}>{p.relevance}</p>
              </div>
              <div style={{ display:"flex", gap:4, flexShrink:0 }}>
                {p.linkedinUrl&&<a href={p.linkedinUrl} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} style={{ fontFamily:"monospace", fontSize:10, padding:"2px 7px", background:"transparent", border:"0.5px solid #2a2a2a", color:"#4A9AE8", borderRadius:4, textDecoration:"none" }}>in</a>}
                <button onClick={e=>{e.stopPropagation();setEmailModal(p);}} style={{ fontFamily:"monospace", fontSize:10, padding:"2px 7px", background:C.tinBg, border:`1px solid ${C.tinBdr}`, color:C.tin, borderRadius:4, cursor:"pointer" }}>✉</button>
                <button onClick={e=>{e.stopPropagation();removePersona(i);}} style={{ background:"transparent", border:"none", color:"#555", fontSize:12, cursor:"pointer", padding:"0 2px", lineHeight:1 }}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {personas.length===0&&!loading&&!adding&&<p style={{ fontFamily:"monospace", fontSize:11, color:"#555", margin:"0 0 6px" }}>Click "Find personas" to search, or add manually.</p>}
      {adding&&(
        <div style={{ background:"#0a0a0a", border:"0.5px solid #1e1e1e", borderRadius:5, padding:"10px 12px", marginTop:6 }}>
          <div style={{ display:"flex", gap:6, marginBottom:6 }}>
            <input placeholder="Full name" value={manualForm.name} onChange={e=>setManualForm(f=>({...f,name:e.target.value}))} style={{ flex:1, fontSize:12, padding:"4px 7px", background:"#111", border:"0.5px solid #2a2a2a", borderRadius:4, color:"#c8c8c0", outline:"none" }}/>
            <input placeholder="Title" value={manualForm.title} onChange={e=>setManualForm(f=>({...f,title:e.target.value}))} style={{ flex:1, fontSize:12, padding:"4px 7px", background:"#111", border:"0.5px solid #2a2a2a", borderRadius:4, color:"#c8c8c0", outline:"none" }}/>
          </div>
          <input placeholder="LinkedIn URL (optional)" value={manualForm.linkedinUrl} onChange={e=>setManualForm(f=>({...f,linkedinUrl:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&addManual()} style={{ width:"100%", fontSize:12, padding:"4px 7px", background:"#111", border:"0.5px solid #2a2a2a", borderRadius:4, color:"#c8c8c0", outline:"none", boxSizing:"border-box", marginBottom:6 }}/>
          <div style={{ display:"flex", gap:6 }}>
            <button onClick={addManual} style={{ fontFamily:"monospace", fontSize:11, padding:"3px 12px", background:"#0f6e5618", border:"0.5px solid #0f6e5655", color:"#0f6e56", borderRadius:4, cursor:"pointer" }}>Add</button>
            <button onClick={()=>{setAdding(false);setManualForm({name:"",title:"",linkedinUrl:""});}} style={{ fontFamily:"monospace", fontSize:11, padding:"3px 10px", background:"transparent", border:"0.5px solid #2a2a2a", color:"#555", borderRadius:4, cursor:"pointer" }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
