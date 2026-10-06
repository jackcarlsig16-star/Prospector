import { useState } from 'react';
import { C, mono } from '../../constants/colors';

// Placeholder: the prompt box doesn't query Salesforce yet.
export default function SalesforceTools() {
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const sfdcConnected = !!localStorage.getItem("sfdc_access_token");

  const handleRun = async () => {
    if(!prompt.trim()) return;
    setLoading(true);
    await new Promise(r=>setTimeout(r,600));
    setResult({ prompt, message:"Salesforce AI Tools are actively being wired — your prompt has been noted. This will execute real SFDC queries soon." });
    setLoading(false);
  };

  return (
    <div>
      <div style={{ marginBottom:16 }}>
        <p style={{ margin:"0 0 4px", fontSize:20, fontWeight:500, color:C.txt }}>☁ Salesforce Tools</p>
        <p style={{ ...mono, margin:0, fontSize:12, color:C.dim }}>AI-powered queries and actions on your connected Salesforce org</p>
      </div>

      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 12px", background:sfdcConnected?`${C.green}0a`:`${C.orange}0a`, border:`1px solid ${sfdcConnected?C.green:C.orange}33`, borderRadius:7, marginBottom:16, width:"fit-content" }}>
        <span style={{ width:6, height:6, borderRadius:"50%", background:sfdcConnected?C.green:C.orange, display:"inline-block", flexShrink:0 }}/>
        <span style={{ ...mono, fontSize:12, color:sfdcConnected?C.green:C.orange }}>{sfdcConnected?"Salesforce connected":"Not connected — link via Settings → Salesforce"}</span>
      </div>

      <div style={{ padding:"14px 16px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:8, marginBottom:12 }}>
        <p style={{ ...mono, margin:"0 0 8px", fontSize:11, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>Freeform prompt</p>
        <textarea value={prompt} onChange={e=>setPrompt(e.target.value)}
          placeholder={"Examples:\n• Show me all open opportunities over $50k in my territory\n• Which accounts haven't been touched in 30 days?\n• Create a follow-up task for Acme due Friday\n• Pull contact info for [Company]\n• Sync Prospector scores back to SFDC account fields"}
          style={{ width:"100%", height:140, fontSize:13, padding:"10px 12px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:6, color:C.txt, outline:"none", resize:"vertical", lineHeight:1.7, boxSizing:"border-box", fontFamily:"inherit" }}
        />
        <div style={{ display:"flex", gap:8, marginTop:8 }}>
          <button onClick={handleRun} disabled={!prompt.trim()||loading} style={{ padding:"8px 22px", background:loading?C.sur:C.goldBg, border:`1px solid ${loading?C.brd:C.goldBdr}`, color:loading?C.dim:C.gold, borderRadius:6, cursor:!prompt.trim()||loading?"not-allowed":"pointer", fontSize:13, fontWeight:500, opacity:!prompt.trim()?0.4:1 }}>
            {loading?"Running…":"▶ Run"}
          </button>
          {(prompt||result)&&<button onClick={()=>{setPrompt("");setResult(null);}} style={{ ...mono, fontSize:12, padding:"8px 12px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:6, cursor:"pointer" }}>Clear</button>}
        </div>
      </div>

      {result&&(
        <div style={{ padding:"12px 16px", background:`${C.blue}08`, border:`1px solid ${C.blue}22`, borderRadius:8, marginBottom:16 }}>
          <p style={{ ...mono, margin:"0 0 6px", fontSize:11, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>Result</p>
          <p style={{ margin:0, fontSize:14, color:C.txt }}>{result.message}</p>
        </div>
      )}

      <div style={{ marginTop:20 }}>
        <p style={{ ...mono, margin:"0 0 10px", fontSize:11, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>Ideas — coming soon</p>
        <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
          {["Query open opportunities and pipeline in your territory","Find accounts without a recent activity or touch","Create tasks and follow-up reminders","Pull contact details and org charts","Log call notes directly to Salesforce","Sync Prospector tier scores back to SFDC account fields","Surface accounts in Salesforce not yet in Prospector"].map(idea=>(
            <div key={idea} style={{ display:"flex", gap:8, alignItems:"center", padding:"6px 10px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:5 }}>
              <span style={{ color:C.dim, fontSize:11 }}>○</span>
              <span style={{ fontSize:13, color:C.mut }}>{idea}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
