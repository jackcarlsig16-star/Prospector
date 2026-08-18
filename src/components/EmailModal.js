import { useState, useEffect, useRef } from 'react';
import { C, mono } from '../constants/colors';
import { getActiveIntel } from '../utils/assay';
import { getActiveVoice, getVoiceProfile, voiceProfileKey } from '../constants/voice';
import { UCS_DATA } from '../constants/products';
import { getListsForBusiness, linkAccountToLists, saveVoiceProfile, getListIdsForAccount } from '../utils/db';
import { buildAccountIntel } from '../utils/accountIntel';

// account-card-color-fix-and-guided-generate-v1 Part B
// generation-engine-consolidation-v1 Stage 1 - 'reply' added, real new
// messageType (a reply to a specific inbound message, not a proactive
// follow-up) rather than force-fitting AccountCardComms.js's old "reply"
// case onto follow_up.
const MESSAGE_TYPES = [
  { id: 'cold_outreach', label: 'Cold Outreach' },
  { id: 'follow_up', label: 'Follow-up' },
  { id: 'reply', label: 'Reply' },
  { id: 'warm_intro', label: 'Warm Intro' },
  { id: 'custom', label: 'Custom' },
];

// project-guidance-and-creation-flow-v1 — shared by the guided panel and
// the autoStart minimal gate below, same picker either way.
function ProjectAmbiguityPicker({ matchedProjects, onPick }) {
  return (
    <div style={{ marginBottom:16, padding:"10px 12px", background:`${C.orange||"#f5a623"}0f`, border:`1px solid ${C.orange||"#f5a623"}40`, borderRadius:6 }}>
      <p style={{ ...mono, margin:"0 0 8px", fontSize:11, color:C.mut }}>This account belongs to more than one project — pick which one's guidance applies:</p>
      <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
        {matchedProjects.map(p => (
          <button key={p.id} onClick={()=>onPick(p.id)} style={{ ...mono, fontSize:12, padding:"6px 12px", borderRadius:6, cursor:"pointer", background:"transparent", border:`1px solid ${C.brd}`, color:C.txt }}>
            {p.name}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function EmailModal({ account, persona, onClose, onSaveEmail, accountKind, business, autoStart = true, projects = [], initialMessageType = 'cold_outreach' }) {
  const [email,setEmail]=useState("");
  const [copied,setCopied]=useState(false);
  const [originalEmail,setOriginalEmail]=useState("");
  const [teaching,setTeaching]=useState(false);
  const [taught,setTaught]=useState(false);
  const voiceUserName=(()=>{try{return JSON.parse(localStorage.getItem("prospector_user")||"{}").name||"";}catch{return "";}})();
  const voiceUserEmail=(()=>{try{return JSON.parse(localStorage.getItem("prospector_user")||"{}").email||"";}catch{return "";}})();
  const kind = accountKind || account.accountKind || 'business';
  const isInfluencer = kind === 'influencer';
  const influencerDetail = account.influencerDetail || null;

  // ── Guided pre-generation panel (Part B) ──────────────────────────────
  // started/loading no longer default straight from autoStart - an
  // autoStart caller still needs project resolution to run first (below)
  // so an ambiguous account doesn't silently fire against the wrong
  // project's guidance. The effect after the resolution one flips these
  // once it's safe to actually generate.
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [messageType, setMessageType] = useState(initialMessageType);
  const [context, setContext] = useState('');
  const [lists, setLists] = useState([]);
  const [selectedListId, setSelectedListId] = useState('');
  const contextRef = useRef(null);

  // project-guidance-and-creation-flow-v1 — project-selector-on-ambiguity.
  // account_lists is many-to-many, so an account can sit in more than one
  // project's list. Runs regardless of autoStart - an instant-generate
  // entry point (persona click) still needs this resolved before firing,
  // not just the guided panel. Exactly one match auto-selects silently;
  // more than one requires an explicit pick before generation proceeds.
  const [matchedProjects, setMatchedProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [projectResolutionDone, setProjectResolutionDone] = useState(false);
  const projectsWithLists = projects.filter(p => p.list_id);

  useEffect(() => {
    if (!business?.id || !projectsWithLists.length) { setProjectResolutionDone(true); return; }
    getListIdsForAccount(account.id).then(accountListIds => {
      const matches = projectsWithLists.filter(p => accountListIds.includes(p.list_id));
      setMatchedProjects(matches);
      if (matches.length === 1) setSelectedProjectId(matches[0].id);
      setProjectResolutionDone(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id, account.id]);

  useEffect(() => {
    if (autoStart || !business?.id) return;
    getListsForBusiness(business.id).then(setLists);
  }, [autoStart, business?.id]);

  const projectAmbiguous = matchedProjects.length > 1 && !selectedProjectId;
  const activeProject = projects.find(p => p.id === selectedProjectId) || null;

  // autoStart callers fire automatically once resolution clears and there's
  // no ambiguity to block on - same "instant" behavior as before for the
  // common (0 or 1 project) case, just no longer racing the resolution.
  useEffect(() => {
    if (!autoStart || started || !projectResolutionDone || projectAmbiguous) return;
    setLoading(true);
    setStarted(true);
  }, [autoStart, started, projectResolutionDone, projectAmbiguous]);

  useEffect(()=>{
    if (!started) return;
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
        accountKind:kind,
        businessId:business?.id,
        projectId: selectedProjectId || undefined,
        messageType: !autoStart ? messageType : undefined,
        directive: !autoStart && context.trim() ? context.trim() : undefined,
        accountIntel: buildAccountIntel(account),
        ...(isInfluencer ? {
          fitRationale:influencerDetail?.fit_rationale||"",
          fitSignals:influencerDetail?.fit_signals||[],
          nicheAssessment:influencerDetail?.niche_assessment||null,
          bioSnapshot:influencerDetail?.bio_snapshot||"",
        } : {}),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[started]);

  const copy=()=>{navigator.clipboard.writeText(email);setCopied(true);setTimeout(()=>setCopied(false),2000);};

  const generate = async () => {
    if (projectAmbiguous) return;
    if (selectedListId) {
      try { await linkAccountToLists(account.id, [selectedListId]); } catch {}
    }
    setLoading(true);
    setStarted(true);
  };

  const guidedPanel = !started && (
    <div>
      <p style={{ ...mono, margin:"0 0 8px", fontSize:11, fontWeight:600, color:C.mut, textTransform:"uppercase", letterSpacing:"0.06em" }}>Message type</p>
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:16 }}>
        {MESSAGE_TYPES.map(t => (
          <button key={t.id} onClick={()=>{ setMessageType(t.id); if (t.id === 'custom' || t.id === 'reply') contextRef.current?.focus(); }}
            style={{ ...mono, fontSize:12, padding:"7px 14px", borderRadius:6, cursor:"pointer",
              background: messageType===t.id ? `${C.gold}18` : "transparent",
              border: `1px solid ${messageType===t.id ? C.gold : C.brd}`,
              color: messageType===t.id ? C.gold : C.mut, fontWeight: messageType===t.id?600:400 }}>
            {t.label}
          </button>
        ))}
      </div>

      <p style={{ ...mono, margin:"0 0 8px", fontSize:11, fontWeight:600, color:C.mut, textTransform:"uppercase", letterSpacing:"0.06em" }}>Directive <span style={{ fontWeight:400, textTransform:"none", letterSpacing:0, color:C.dim }}>(optional)</span></p>
      <textarea ref={contextRef} value={context} onChange={e=>setContext(e.target.value)} rows={3}
        placeholder={messageType === 'reply' ? "Paste the message you're replying to" : "e.g. mention their recent funding round, keep this one under 80 words"}
        style={{ width:"100%", fontSize:13, lineHeight:1.6, padding:"10px 12px", background:C.bg, border:`1px solid ${C.brd}`, borderRadius:6, color:C.txt, outline:"none", resize:"vertical", fontFamily:"inherit", boxSizing:"border-box", marginBottom:16 }}/>

      {business?.id && (
        <>
          <p style={{ ...mono, margin:"0 0 8px", fontSize:11, fontWeight:600, color:C.mut, textTransform:"uppercase", letterSpacing:"0.06em" }}>Assign to list <span style={{ fontWeight:400, textTransform:"none", letterSpacing:0, color:C.dim }}>(optional)</span></p>
          <select value={selectedListId} onChange={e=>setSelectedListId(e.target.value)}
            style={{ ...mono, fontSize:13, padding:"7px 10px", background:C.bg, border:`1px solid ${C.brd}`, borderRadius:6, color:C.txt, outline:"none", width:"100%", marginBottom:16, cursor:"pointer" }}>
            <option value="">— no change —</option>
            {lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </>
      )}

      {projectAmbiguous && <ProjectAmbiguityPicker matchedProjects={matchedProjects} onPick={setSelectedProjectId} />}

      {!projectAmbiguous && (
        <p style={{ ...mono, fontSize:10, color:C.dim, marginBottom:12 }}>
          {activeProject ? `Project: ${activeProject.name} · ` : ''}Voice: {voiceUserName || 'default'}{activeProject?.ask_type ? ` · CTA: ${activeProject.ask_type.slice(0, 60)}` : ''}
        </p>
      )}

      <button onClick={generate} disabled={projectAmbiguous} style={{ ...mono, width:"100%", fontSize:13, fontWeight:600, padding:"10px 14px", background:C.goldBg, border:`1px solid ${C.goldBdr}`, color:C.gold, borderRadius:6, cursor:projectAmbiguous?"not-allowed":"pointer", opacity:projectAmbiguous?0.5:1 }}>
        ✦ Generate
      </button>
    </div>
  );

  return(
    <div onClick={onClose} style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000 }}>
      <div onClick={e=>e.stopPropagation()} style={{ width:580,maxHeight:"85vh",background:C.sur,border:`1px solid ${C.brd}`,borderRadius:12,display:"flex",flexDirection:"column",overflow:"hidden" }}>
        <div style={{ padding:"16px 20px",borderBottom:`1px solid ${C.brd}`,display:"flex",alignItems:"flex-start",justifyContent:"space-between" }}>
          <div>
            <p style={{ margin:"0 0 4px",fontSize:15,fontWeight:500,color:C.txt }}>{account.name}</p>
            <div style={{ display:"flex",gap:8,flexWrap:"wrap",alignItems:"center" }}>
              {persona&&<span style={{ fontSize:12,color:C.green,fontWeight:500 }}>→ {persona.name} · {persona.title}</span>}
              {!persona&&isInfluencer&&<span style={{ fontSize:12,color:C.dim }}>Generating directly for this creator</span>}
              {!persona&&!isInfluencer&&<span style={{ fontSize:12,color:C.dim }}>No persona selected — using [First Name]</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background:"transparent",border:"none",color:C.mut,fontSize:18,cursor:"pointer",padding:"0 4px",lineHeight:1 }}>✕</button>
        </div>
        <div style={{ flex:1,overflowY:"auto",padding:"16px 20px" }}>
          {!started
            ? (autoStart
                ? (projectAmbiguous
                    ? <ProjectAmbiguityPicker matchedProjects={matchedProjects} onPick={setSelectedProjectId} />
                    : <p style={{ ...mono,fontSize:13,color:C.purple }}>⬡ Generating email…</p>)
                : guidedPanel)
            : (loading
                ? <p style={{ ...mono,fontSize:13,color:C.purple }}>⬡ Generating email…</p>
                : <textarea value={email} onChange={e=>setEmail(e.target.value)} style={{ width:"100%",height:300,fontSize:13,lineHeight:1.9,background:C.bg,border:`1px solid ${C.brd}`,borderRadius:6,color:C.txt,padding:"12px 14px",resize:"vertical",outline:"none",fontFamily:"inherit",boxSizing:"border-box" }}/>
              )
          }
        </div>
        {started && (
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
                        if(d.profile){localStorage.setItem(voiceProfileKey(voiceUserName),JSON.stringify(d.profile));saveVoiceProfile(voiceUserEmail,d.profile);setTaught(true);}
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
        )}
      </div>
    </div>
  );
}
