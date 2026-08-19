import { useState, useEffect, useRef } from 'react';
import { C, mono } from '../constants/colors';
import { getActiveIntel } from '../utils/assay';
import { getActiveVoice, getVoiceProfile, voiceProfileKey } from '../constants/voice';
import { UCS_DATA } from '../constants/products';
import { getListsForBusiness, linkAccountToLists, saveVoiceProfile, getListIdsForAccount, getBusinessProfileSummary, createList, setProjectListId } from '../utils/db';
import { buildAccountIntel } from '../utils/accountIntel';
import { ROLE, RADIUS } from './accountCard/tokens';
import AdvancedGenerationPanel from './accountCard/AdvancedGenerationPanel';

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

  // generation-modal-advanced-inputs-v1 — Project/Account Intel/Voice all
  // reuse data already resolved elsewhere in this component (no new fetch);
  // Company Intel is the one genuinely new read, and it's lazy - only fires
  // once Advanced is actually opened, so a person who never opens it gets
  // the exact same network behavior as before this SPEC.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [businessProfileSummary, setBusinessProfileSummary] = useState(null);
  const [loadingBusinessProfile, setLoadingBusinessProfile] = useState(false);

  useEffect(() => {
    if (!advancedOpen || !business?.id || businessProfileSummary) return;
    setLoadingBusinessProfile(true);
    getBusinessProfileSummary(business.id).then(data => { setBusinessProfileSummary(data || {}); setLoadingBusinessProfile(false); });
  }, [advancedOpen, business?.id, businessProfileSummary]);

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

  // generation-modal-project-promotion-and-visual-pass-v1 Bug 1/2 - real
  // one-off account-to-project assignment, promoted out of Advanced into
  // the default view. projectListOverrides tracks any project this
  // component itself just backfilled a list for, merged into the picker's
  // options so the UI reflects it immediately without needing the projects
  // prop to refresh from its App.js-level source.
  const [projectListOverrides, setProjectListOverrides] = useState({});
  const [assigningProject, setAssigningProject] = useState(false);
  const [projectAssignError, setProjectAssignError] = useState('');
  const allProjectsMerged = projects.map(p => projectListOverrides[p.id] ? { ...p, list_id: projectListOverrides[p.id] } : p);

  // Bug 1: shows ALL real projects, not just list-having ones (the bug -
  // LinkedProjects.js-style filtering excluded any project that predates
  // project-list-linking-v1 and was never backfilled). Selecting a
  // list-less project silently backfills one first, reusing
  // BusinessDetailPage.js's real BackfillProjectList logic
  // (createList -> setProjectListId) rather than a new mechanism - the
  // person never sees "list" language, it just works.
  // Bug 2: actually assigns the account (linkAccountToLists), the same
  // real write LinkedProjects.js uses - not just steering this one
  // generation. Confirmed via the flow audit this was the only real
  // account<->project write path in the app; reusing it here means this
  // modal's assignment shows up everywhere LinkedProjects.js's does too.
  const selectProject = async (projectId) => {
    if (!projectId) { setSelectedProjectId(null); setProjectAssignError(''); return; }
    const project = allProjectsMerged.find(p => p.id === projectId);
    if (!project || !business?.id) return;
    setProjectAssignError('');
    setAssigningProject(true);
    let listId = project.list_id;
    if (!listId) {
      const { list, error: listErr } = await createList(business.id, project.name);
      if (listErr) { setAssigningProject(false); setProjectAssignError("Couldn't assign this project — try again."); console.error('[EmailModal] project backfill (createList) failed:', listErr); return; }
      const { error: spErr } = await setProjectListId(project.id, list.id);
      if (spErr) { setAssigningProject(false); setProjectAssignError("Couldn't assign this project — try again."); console.error('[EmailModal] project backfill (setProjectListId) failed:', spErr); return; }
      listId = list.id;
      setProjectListOverrides(o => ({ ...o, [project.id]: listId }));
    }
    const { error: linkErr } = await linkAccountToLists(account.id, [listId]);
    setAssigningProject(false);
    if (linkErr) { setProjectAssignError("Couldn't assign this project — try again."); console.error('[EmailModal] linkAccountToLists failed:', linkErr); return; }
    setSelectedProjectId(projectId);
  };

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
  const activeProject = allProjectsMerged.find(p => p.id === selectedProjectId) || null;

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
        // generation-modal-advanced-inputs-v1 - voiceEnabled defaults true
        // and only has a UI to change it in the guided (!autoStart) Advanced
        // panel, so autoStart callers behave exactly as before this SPEC.
        voiceExamples: voiceEnabled ? getActiveVoice(voiceUserName) : "",
        voiceProfile: voiceEnabled ? getVoiceProfile(voiceUserName) : null,
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

  // generation-modal-project-promotion-and-visual-pass-v1 Change 2 - shared
  // warm label style, extending orange as the modal's ambient identity
  // (frame + section labels + the active Message Type state) rather than
  // leaving it living only on the Generate button. Real inputs (Directive,
  // Assign to List) stay neutral-bordered on purpose - this is about the
  // base identity/chrome, not painting every element orange, which would
  // read as harsh rather than "creamsicle."
  const sectionLabel = { ...mono, margin:"0 0 8px", fontSize:11, fontWeight:600, color:`${ROLE.generateAccent}cc`, textTransform:"uppercase", letterSpacing:"0.06em" };

  const guidedPanel = !started && (
    <div>
      <p style={sectionLabel}>Message type</p>
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:16 }}>
        {MESSAGE_TYPES.map(t => (
          <button key={t.id} onClick={()=>{ setMessageType(t.id); if (t.id === 'custom' || t.id === 'reply') contextRef.current?.focus(); }}
            style={{ ...mono, fontSize:12, padding:"7px 14px", borderRadius:6, cursor:"pointer",
              background: messageType===t.id ? `${ROLE.generateAccent}18` : "transparent",
              border: `1px solid ${messageType===t.id ? ROLE.generateAccent : C.brd}`,
              color: messageType===t.id ? ROLE.generateAccent : C.mut, fontWeight: messageType===t.id?600:400,
              textShadow: messageType===t.id ? `0 0 6px ${ROLE.generateAccent}55` : "none" }}>
            {t.label}
          </button>
        ))}
      </div>

      <p style={sectionLabel}>Directive <span style={{ fontWeight:400, textTransform:"none", letterSpacing:0, color:C.dim }}>(optional)</span></p>
      <textarea ref={contextRef} value={context} onChange={e=>setContext(e.target.value)} rows={3}
        placeholder={messageType === 'reply' ? "Paste the message you're replying to" : "e.g. mention their recent funding round, keep this one under 80 words"}
        style={{ width:"100%", fontSize:13, lineHeight:1.6, padding:"10px 12px", background:C.bg, border:`1px solid ${C.brd}`, borderRadius:6, color:C.txt, outline:"none", resize:"vertical", fontFamily:"inherit", boxSizing:"border-box", marginBottom:16 }}/>

      {/* Change 1 - promoted out of Advanced, core interaction not optional
          complexity. Kept in Project's own established red identity
          (ROLE.projectAccent), not orange - it's its own category, per
          Change 2's explicit "don't dilute the other two accents." */}
      {business?.id && (
        <div style={{ marginBottom:16 }}>
          <p style={{ ...mono, margin:"0 0 8px", fontSize:11, fontWeight:600, color:ROLE.projectAccent, textTransform:"uppercase", letterSpacing:"0.06em" }}>Project <span style={{ fontWeight:400, textTransform:"none", letterSpacing:0, color:C.dim }}>(optional)</span></p>
          <select value={selectedProjectId || ''} onChange={e=>selectProject(e.target.value || null)} disabled={assigningProject}
            style={{ ...mono, fontSize:13, padding:"7px 10px", background:C.bg, border:`1px solid ${ROLE.projectAccent}55`, borderRadius:6, color:C.txt, outline:"none", width:"100%", cursor:assigningProject?"default":"pointer" }}>
            <option value="">— none —</option>
            {allProjectsMerged.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {assigningProject && <p style={{ ...mono, fontSize:10, color:ROLE.projectAccent, margin:"6px 0 0" }}>Assigning…</p>}
          {!assigningProject && projectAssignError && <p style={{ ...mono, fontSize:10, color:C.red, margin:"6px 0 0" }}>⚠ {projectAssignError}</p>}
          {!assigningProject && !projectAssignError && activeProject?.objective && <p style={{ ...mono, fontSize:10, color:C.dim, margin:"6px 0 0", fontStyle:"italic" }}>{activeProject.objective}</p>}
        </div>
      )}

      {business?.id && (
        <>
          <p style={sectionLabel}>Assign to list <span style={{ fontWeight:400, textTransform:"none", letterSpacing:0, color:C.dim }}>(optional)</span></p>
          <select value={selectedListId} onChange={e=>setSelectedListId(e.target.value)}
            style={{ ...mono, fontSize:13, padding:"7px 10px", background:C.bg, border:`1px solid ${C.brd}`, borderRadius:6, color:C.txt, outline:"none", width:"100%", marginBottom:16, cursor:"pointer" }}>
            <option value="">— no change —</option>
            {lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </>
      )}

      {projectAmbiguous && <ProjectAmbiguityPicker matchedProjects={matchedProjects} onPick={setSelectedProjectId} />}

      {/* generation-modal-advanced-inputs-v1 - "off" now reads as genuinely
          off (explicit "off") instead of just omitting a clause. Project
          dropped from this line (generation-modal-project-promotion-and-
          visual-pass-v1 Change 1) - it has its own real section above now,
          repeating it here would just be redundant. */}
      {!projectAmbiguous && (
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8, marginBottom:12 }}>
          <p style={{ ...mono, fontSize:10, color:C.dim, margin:0 }}>
            Voice: {voiceEnabled ? (voiceUserName || 'default') : 'off'}
          </p>
          {/* generation-modal-project-picker-and-advanced-visibility-v1 -
              was plain C.dim/C.txt text, no border, no glow - invisible at
              a glance (confirmed live). Real third terminal accent now
              (ROLE.advancedAccent, cyan), same glow-not-fill grammar as the
              orange Generate button and red Project panel - always-cyan,
              not just when active, so it reads as clickable before you've
              ever clicked it. */}
          <button onClick={()=>setAdvancedOpen(o=>!o)} style={{
            ...mono, fontSize:11, fontWeight:600, padding:"3px 10px",
            background: advancedOpen ? `${ROLE.advancedAccent}18` : "transparent",
            border:`1px solid ${advancedOpen ? ROLE.advancedAccent : ROLE.advancedAccent+"66"}`,
            borderRadius:RADIUS.sm, color:ROLE.advancedAccent, cursor:"pointer",
            letterSpacing:"0.02em", textShadow:`0 0 6px ${ROLE.advancedAccent}55`,
            transition:"background 0.15s, border-color 0.15s",
          }}>
            {advancedOpen ? "▾ Advanced" : "▸ Advanced"}
          </button>
        </div>
      )}

      {/* account-card-cleanup-v1 Stage 1 follow-up - this is the button that
          actually triggers generation (the outer card trigger just opens
          this modal). Stage 1 only resized/recolored the outer trigger;
          this one was missed - same treatment applied here now, matching
          PrimaryAction.js exactly (size, ROLE.generateAccent, glow). */}
      <button onClick={generate} disabled={projectAmbiguous} style={{
        ...mono, fontSize:12, fontWeight:600, height:32, padding:"0 16px",
        display:"inline-flex", alignItems:"center", gap:6,
        background:`${ROLE.generateAccent}16`, border:`1px solid ${ROLE.generateAccent}`, color:ROLE.generateAccent,
        borderRadius:RADIUS.md, cursor:projectAmbiguous?"not-allowed":"pointer", letterSpacing:"0.02em",
        opacity:projectAmbiguous?0.5:1,
        boxShadow:projectAmbiguous?"none":`0 0 8px ${ROLE.generateAccent}55`,
        textShadow:projectAmbiguous?"none":`0 0 6px ${ROLE.generateAccent}66`,
        transition:"box-shadow 0.15s, text-shadow 0.15s",
      }}>
        ✦ Generate
      </button>
    </div>
  );

  // generation-modal-advanced-inputs-v1 - Advanced only ever shows during
  // the guided pre-generation phase (started/autoStart callers never had
  // this control to begin with), and stays hidden while project ambiguity
  // is unresolved so there aren't two different project pickers on screen
  // at once. A person who never opens it gets the exact same width/layout
  // as before this SPEC - the modal only widens when this is true.
  const showAdvancedPanel = advancedOpen && !started && !autoStart && !projectAmbiguous;

  return(
    <div onClick={onClose} style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000 }}>
      {/* Change 2 - orange as the modal's ambient/base identity: a warm
          outer border + soft ambient glow (not harsh/neon - creamsicle,
          matching the tone already established on the Generate button
          itself) instead of the prior plain neutral-gray frame. */}
      <div onClick={e=>e.stopPropagation()} style={{ width:showAdvancedPanel?920:580,maxWidth:"95vw",maxHeight:"85vh",background:C.sur,border:`1px solid ${ROLE.generateAccent}40`,borderRadius:12,display:"flex",flexDirection:"column",overflow:"hidden",transition:"width 0.15s",boxShadow:`0 0 60px -20px ${ROLE.generateAccent}33` }}>
        <div style={{ padding:"16px 20px",borderBottom:`1px solid ${ROLE.generateAccent}30`,display:"flex",alignItems:"flex-start",justifyContent:"space-between" }}>
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
        <div style={{ flex:1,overflowY:"auto",padding:"16px 20px",display:"flex",gap:20 }}>
          {!started
            ? (autoStart
                ? (projectAmbiguous
                    ? <ProjectAmbiguityPicker matchedProjects={matchedProjects} onPick={setSelectedProjectId} />
                    : <p style={{ ...mono,fontSize:13,color:C.purple }}>⬡ Generating email…</p>)
                : (
                  <>
                    <div style={{ flex:showAdvancedPanel?"0 0 auto":1, width:showAdvancedPanel?400:"100%", minWidth:0 }}>{guidedPanel}</div>
                    {showAdvancedPanel && (
                      <div style={{ borderLeft:`1px solid ${C.brd}`, paddingLeft:20 }}>
                        <AdvancedGenerationPanel
                          accountIntelText={buildAccountIntel(account)}
                          voiceProfile={getVoiceProfile(voiceUserName)}
                          voiceEnabled={voiceEnabled}
                          onToggleVoice={()=>setVoiceEnabled(v=>!v)}
                          businessProfileSummary={businessProfileSummary}
                          loadingBusinessProfile={loadingBusinessProfile}
                          businessName={business?.name}
                        />
                      </div>
                    )}
                  </>
                ))
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
