import { useState, useEffect } from 'react';
import { C, mono } from '../constants/colors';
import { BASELINE_VOICE, voiceProfileKey, voiceDocsKey, getVoiceProfile } from '../constants/voice';
import { detectIntelCategory } from '../utils/assay';
import { SEED_INTEL_DOCS, UCS_DATA, PRODUCTS_DATA } from '../constants/products';
import { PRODUCT_IMPORT_SOURCES } from './AccountCard';
import { MODELS } from '../config/models';
import { saveVoiceProfile } from '../utils/db';


function IntelligencePage({ user, activeUser }) {
  const voiceUserName = activeUser?.name || user?.name || "";
  const voiceUserEmail = activeUser?.email || user?.email || "";
  const [tab,setTab]=useState("Use Cases");
  const [voiceProfile,setVoiceProfileState]=useState(()=>getVoiceProfile(voiceUserName));
  const [vpLoading,setVpLoading]=useState(false);
  const [vpError,setVpError]=useState(null);
  const [gmailConnected]=useState(()=>!!localStorage.getItem("gmail_access_token"));
  const [ucExp,setUcExp]=useState("onboarding");
  const [prodExp,setProdExp]=useState(null);

  // Intel Library
  const [docs,setDocs]=useState(()=>{
    try{
      const saved=localStorage.getItem("prospector_intel_docs");
      const existing=saved?JSON.parse(saved):[];
      const legacy=localStorage.getItem("prospector_intel");
      const legacyEntry=(!saved&&legacy)?[{id:"legacy",name:"My Intel",content:legacy,active:true,createdAt:new Date().toISOString()}]:[];
      const existingIds=new Set(existing.map(d=>d.id));
      const seedToAdd=SEED_INTEL_DOCS.filter(d=>!existingIds.has(d.id));
      return[...existing,...legacyEntry,...seedToAdd];
    }catch{return SEED_INTEL_DOCS;}
  });
  const [adding,setAdding]=useState(false);
  const [draft,setDraft]=useState("");
  const [draftName,setDraftName]=useState("");
  const [expandedDoc,setExpandedDoc]=useState(null);
  const [importing,setImporting]=useState(false);
  const [importProgress,setImportProgress]=useState(0);
  const [importDone,setImportDone]=useState(()=>!!localStorage.getItem("prospector_import_done"));
  const [importError,setImportError]=useState(null);

  const importProductDocs=async()=>{
    setImporting(true);
    setImportProgress(0);
    setImportError(null);
    const newDocs=[];
    for(let i=0;i<PRODUCT_IMPORT_SOURCES.length;i++){
      const src=PRODUCT_IMPORT_SOURCES[i];
      try{
        const res=await fetch(`https://r.jina.ai/${src.url}`);
        const text=await res.text();
        // trim to first 4000 chars of meaningful content, strip markdown noise
        const content=text.replace(/!\[.*?\]\(.*?\)/g,"").replace(/\[([^\]]+)\]\([^)]+\)/g,"$1").trim().slice(0,4000);
        newDocs.push({id:src.id,name:src.name,content,active:true,createdAt:new Date().toISOString(),source:"docs.example.com"});
      }catch(e){
        newDocs.push({id:src.id,name:src.name,content:`(Failed to fetch — ${e.message})`,active:false,createdAt:new Date().toISOString(),source:"docs.example.com"});
      }
      setImportProgress(i+1);
    }
    // Upsert: replace existing docs with same id, append new
    setDocs(prev=>{
      const importIds=new Set(newDocs.map(d=>d.id));
      return[...prev.filter(d=>!importIds.has(d.id)),...newDocs];
    });
    localStorage.setItem("prospector_import_done","1");
    setImportDone(true);
    setImporting(false);
  };

  useEffect(()=>{try{localStorage.setItem("prospector_intel_docs",JSON.stringify(docs));}catch{}},[docs]);

  const saveDoc=()=>{
    if(!draft.trim())return;
    const name=draftName.trim()||detectIntelCategory(draft);
    setDocs(prev=>[{id:`d${Date.now()}`,name,content:draft.trim(),active:true,createdAt:new Date().toISOString()},...prev]);
    setDraft("");setDraftName("");setAdding(false);
  };
  const toggleDoc=id=>setDocs(prev=>prev.map(d=>d.id===id?{...d,active:!d.active}:d));
  const deleteDoc=id=>setDocs(prev=>prev.filter(d=>d.id!==id));

  const activeCount=docs.filter(d=>d.active).length;
  const activeChars=docs.filter(d=>d.active).reduce((s,d)=>s+d.content.length,0);

  // Voice Library
  const [voiceDocs,setVoiceDocs]=useState(()=>{
    try{
      const key=voiceDocsKey(voiceUserName);
      const saved=localStorage.getItem(key)||localStorage.getItem("prospector_voice_docs");
      return saved?JSON.parse(saved):[...BASELINE_VOICE];
    }catch{return[...BASELINE_VOICE];}
  });
  const [vAdding,setVAdding]=useState(false);
  const [vDraft,setVDraft]=useState("");
  const [vDraftName,setVDraftName]=useState("");
  const [vExpanded,setVExpanded]=useState(null);

  useEffect(()=>{try{localStorage.setItem(voiceDocsKey(voiceUserName),JSON.stringify(voiceDocs));}catch{}},[voiceDocs,voiceUserName]);

  const saveVoiceDoc=()=>{
    if(!vDraft.trim())return;
    const name=vDraftName.trim()||"My Email Example";
    setVoiceDocs(prev=>[{id:`v${Date.now()}`,name,content:vDraft.trim(),active:true,createdAt:new Date().toISOString()},...prev]);
    setVDraft("");setVDraftName("");setVAdding(false);
  };
  const toggleVoiceDoc=id=>setVoiceDocs(prev=>prev.map(d=>d.id===id?{...d,active:!d.active}:d));
  const deleteVoiceDoc=id=>setVoiceDocs(prev=>prev.filter(d=>d.id!==id));

  const activeVoice=voiceDocs.filter(d=>d.active).length;

  // Example Accounts
  const [examples, setExamples] = useState(()=>{
    try{ const s=localStorage.getItem("prospector_example_accts"); return s?JSON.parse(s):[]; }catch{return[];}
  });
  const [exAdding, setExAdding] = useState(false);
  const [exDraft, setExDraft] = useState({ name:"", type:"gold", notes:"", why:"" });
  useEffect(()=>{ try{ localStorage.setItem("prospector_example_accts",JSON.stringify(examples)); }catch{} },[examples]);
  const saveExample = () => {
    if(!exDraft.name.trim()) return;
    setExamples(prev=>[{ id:`ex${Date.now()}`, ...exDraft, name:exDraft.name.trim(), active:true, createdAt:new Date().toISOString() }, ...prev]);
    setExDraft({ name:"", type:"gold", notes:"", why:"" });
    setExAdding(false);
  };
  const toggleExample = id => setExamples(prev=>prev.map(e=>e.id===id?{...e,active:!e.active}:e));
  const deleteExample = id => setExamples(prev=>prev.filter(e=>e.id!==id));
  const goldCount   = examples.filter(e=>e.active&&e.type==="gold").length;
  const missCount   = examples.filter(e=>e.active&&e.type==="nearmiss").length;

  const [pasteOpen,setPasteOpen]=useState(false);
  const [pasteText,setPasteText]=useState("");

  const learnVoice=async()=>{
    const token=localStorage.getItem("gmail_access_token");
    const refresh=localStorage.getItem("gmail_refresh_token");
    if(!token){window.location.href="/api/gmail/auth";return;}
    setVpLoading(true);setVpError(null);
    try{
      const r=await fetch("/api/learn-voice",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({accessToken:token,refreshToken:refresh,mode:"learn"})});
      const d=await r.json();
      if(d.error){setVpError(d.error);}
      else if(d.profile){
        localStorage.setItem(voiceProfileKey(voiceUserName),JSON.stringify(d.profile));
        saveVoiceProfile(voiceUserEmail,d.profile);
        if(d.newAccessToken)localStorage.setItem("gmail_access_token",d.newAccessToken);
        setVoiceProfileState(d.profile);
      }else{setVpError(d.message||"No profile returned");}
    }catch(e){setVpError(e.message);}
    setVpLoading(false);
  };

  const learnFromPaste=async()=>{
    if(!pasteText.trim())return;
    setVpLoading(true);setVpError(null);setPasteOpen(false);
    try{
      const r=await fetch("/proxy/anthropic/messages",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          model:MODELS.FAST,
          max_tokens:1200,
          messages:[{role:"user",content:`Analyze these sent emails and extract a precise voice profile for the sender. Look for consistent patterns across multiple emails.

${pasteText.slice(0,6000)}

Return ONLY a valid JSON object — no explanation, no markdown, just the JSON:
{
  "greeting": "the exact greeting pattern (e.g. 'Hey [First Name],' or 'Hi [First Name],')",
  "closing": "exact closing sign-off",
  "tone": "one word: casual | direct | warm | formal | conversational",
  "avgSentenceLength": "short | medium | long",
  "avgEmailLength": "brief (under 80 words) | moderate (80-150 words) | detailed (over 150 words)",
  "commonPhrases": ["up to 5 phrases the sender actually uses"],
  "avoidPhrases": ["phrases/words the sender never uses"],
  "signatureStyle": "description of how emails end",
  "formalityLevel": 2,
  "punctuationStyle": "brief description",
  "structureStyle": "brief description of paragraph patterns",
  "keyTraits": ["3-4 defining voice traits"],
  "sampleOpener": "copy an actual strong opener line from one email",
  "analyzedCount": "estimated number of emails in the paste"
}`}],
        }),
      });
      const data=await r.json();
      const text=data.content?.[0]?.text||"{}";
      const match=text.match(/\{[\s\S]+\}/);
      if(!match)throw new Error("Could not parse voice profile from response");
      const profile=JSON.parse(match[0]);
      profile.learnedAt=new Date().toISOString();
      profile.source="paste";
      profile.teachCount=0;
      localStorage.setItem(voiceProfileKey(voiceUserName),JSON.stringify(profile));
      saveVoiceProfile(voiceUserEmail,profile);
      setVoiceProfileState(profile);
      setPasteText("");
    }catch(e){setVpError(e.message);}
    setVpLoading(false);
  };

  // Auto-learn on first visit if no profile and Gmail connected
  useEffect(()=>{
    if(tab==="Voice Profile"&&!voiceProfile&&gmailConnected&&!vpLoading){
      learnVoice();
    }
  },[tab]);

  // Territory Trends
  const [trends,setTrends]=useState(null); // null | 'loading' | {trends, callCount, accountCount, generatedAt}
  const [trendsError,setTrendsError]=useState(null);
  const fetchTrends=async()=>{
    const aeName=(activeUser?.name||user?.name||"").trim();
    if(!aeName){setTrendsError("No AE name — set up your profile first");return;}
    setTrends('loading');setTrendsError(null);
    try{
      const r=await fetch('/api/databricks/gong-trends',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({aeName})});
      const d=await r.json();
      if(!r.ok){setTrendsError(d.error||'Failed');setTrends(null);return;}
      setTrends(d);
      try{localStorage.setItem('prospector_gong_trends',JSON.stringify(d));}catch{}
    }catch(e){setTrendsError(e.message);setTrends(null);}
  };

  // Hydrate from cache on mount
  useEffect(()=>{
    try{
      const cached=localStorage.getItem('prospector_gong_trends');
      if(cached&&!trends){setTrends(JSON.parse(cached));}
    }catch{}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  const TABS=["Use Cases","Products","Intel Library","Example Accounts","Voice Profile","Voice Library","Integrations","Territory Trends"];
  return(
    <div>
      <div style={{ display:"flex", gap:4, marginBottom:16, borderBottom:`1px solid ${C.brd}`, paddingBottom:10, flexWrap:"wrap" }}>
        {TABS.map(t=><button key={t} onClick={()=>setTab(t)} style={{ fontSize:13, padding:"5px 12px", borderRadius:5, border:`1px solid ${tab===t?C.goldBdr:C.brd}`, background:tab===t?C.goldBg:"transparent", color:tab===t?C.gold:C.mut, cursor:"pointer" }}>{t}</button>)}
      </div>

      {tab==="Use Cases"&&(
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {UCS_DATA.map(uc=>{
            const exp=ucExp===uc.id;
            return(
              <div key={uc.id} style={{ border:`1px solid ${exp?uc.b:C.brd}`, borderRadius:8, background:exp?uc.bg:C.card, overflow:"hidden" }}>
                <div onClick={()=>setUcExp(exp?null:uc.id)} style={{ padding:"12px 16px", cursor:"pointer", display:"flex", alignItems:"center", gap:12 }}>
                  <span style={{ width:10, height:10, borderRadius:"50%", background:uc.c, flexShrink:0 }}/>
                  <div style={{ flex:1 }}>
                    <p style={{ margin:"0 0 2px", fontWeight:600, fontSize:15, color:uc.c }}>{uc.lb}</p>
                    <p style={{ margin:0, fontSize:13, color:C.mut }}>{uc.outcome}</p>
                  </div>
                  <span style={{ fontSize:11, color:C.dim }}>{exp?"▲":"▼"}</span>
                </div>
                {exp&&(
                  <div style={{ borderTop:`1px solid ${uc.b}`, padding:"14px 16px" }}>
                    {uc.notes&&<p style={{ margin:"0 0 14px", fontSize:13, color:C.mut, lineHeight:1.7, background:C.bg, borderRadius:6, padding:"10px 12px", border:`1px solid ${C.brd}` }}>{uc.notes}</p>}
                    <div style={{ marginBottom:12 }}>
                      <p style={{ ...mono, margin:"0 0 8px", fontSize:11, fontWeight:500, color:C.mut, textTransform:"uppercase", letterSpacing:"0.08em" }}>Core products</p>
                      <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                        {uc.prods.map(p=>{
                          const pd=PRODUCTS_DATA.flatMap(c=>c.items).find(i=>i.name===p);
                          return(
                            <div key={p} style={{ background:C.bg, border:`1px solid ${uc.b}`, borderRadius:6, padding:"6px 12px", maxWidth:280 }}>
                              <p style={{ ...mono, margin:"0 0 3px", fontSize:13, fontWeight:500, color:uc.c }}>{p}</p>
                              {pd&&<p style={{ margin:0, fontSize:12, color:C.mut, lineHeight:1.5 }}>{pd.desc}</p>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    {uc.optional&&uc.optional.length>0&&(
                      <div>
                        <p style={{ ...mono, margin:"0 0 8px", fontSize:11, fontWeight:500, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>Also relevant</p>
                        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                          {uc.optional.map(p=><span key={p} style={{ ...mono, fontSize:12, color:C.dim, background:C.bg, border:`1px solid ${C.brd}`, borderRadius:5, padding:"4px 10px" }}>{p}</span>)}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab==="Products"&&(
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          {PRODUCTS_DATA.map(cat=>(
            <div key={cat.cat}>
              <p style={{ ...mono, margin:"0 0 8px", fontSize:11, fontWeight:600, color:cat.c, textTransform:"uppercase", letterSpacing:"0.09em" }}>{cat.cat}</p>
              <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                {cat.items.map(p=>{
                  const exp=prodExp===p.name;
                  return(
                    <div key={p.name} style={{ border:`1px solid ${exp?cat.c+"66":C.brd}`, borderRadius:8, background:exp?C.card:C.sur, overflow:"hidden" }}>
                      <div onClick={()=>setProdExp(exp?null:p.name)} style={{ padding:"10px 14px", cursor:"pointer", display:"flex", alignItems:"center", gap:10 }}>
                        <span style={{ width:8, height:8, borderRadius:"50%", background:cat.c, flexShrink:0 }}/>
                        <div style={{ flex:1, minWidth:0 }}>
                          <span style={{ fontWeight:600, fontSize:14, color:cat.c }}>{p.name}</span>
                          {!exp&&<span style={{ fontSize:12, color:C.dim, marginLeft:10 }}>{p.desc.slice(0,80)}{p.desc.length>80?"…":""}</span>}
                        </div>
                        <span style={{ fontSize:11, color:C.dim, flexShrink:0 }}>{exp?"▲":"▼"}</span>
                      </div>
                      {exp&&(
                        <div style={{ padding:"0 14px 16px", borderTop:`1px solid ${cat.c}22` }}>
                          {/* What it does */}
                          <p style={{ margin:"12px 0 10px", fontSize:13, color:C.txt, lineHeight:1.75 }}>{p.desc}</p>

                          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
                            {/* ICP */}
                            {p.icp&&(
                              <div style={{ padding:"10px 12px", background:`${cat.c}0C`, border:`1px solid ${cat.c}22`, borderRadius:6 }}>
                                <p style={{ ...mono, margin:"0 0 5px", fontSize:10, color:cat.c, textTransform:"uppercase", letterSpacing:"0.08em" }}>Ideal Customer</p>
                                <p style={{ margin:0, fontSize:12, color:C.mut, lineHeight:1.6 }}>{p.icp}</p>
                              </div>
                            )}
                            {/* Verticals */}
                            {p.verticals&&(
                              <div style={{ padding:"10px 12px", background:"rgba(255,255,255,0.03)", border:`1px solid ${C.brd}`, borderRadius:6 }}>
                                <p style={{ ...mono, margin:"0 0 6px", fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>Verticals</p>
                                <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                                  {p.verticals.map(v=>(
                                    <span key={v} style={{ ...mono, fontSize:10, padding:"2px 7px", background:`${cat.c}18`, border:`1px solid ${cat.c}33`, color:cat.c, borderRadius:3 }}>{v}</span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Signals */}
                          {p.signals&&(
                            <div style={{ padding:"10px 12px", background:"rgba(255,255,255,0.02)", border:`1px solid ${C.brd}`, borderRadius:6, marginBottom:10 }}>
                              <p style={{ ...mono, margin:"0 0 7px", fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>🔍 Signals to look for on their site</p>
                              <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                                {p.signals.map((s,i)=>(
                                  <div key={i} style={{ display:"flex", gap:7, alignItems:"flex-start" }}>
                                    <span style={{ color:cat.c, fontSize:11, flexShrink:0, marginTop:1 }}>›</span>
                                    <span style={{ fontSize:12, color:C.mut, lineHeight:1.55 }}>{s}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Combinations */}
                          {p.combos&&(
                            <div style={{ padding:"10px 12px", background:"rgba(255,255,255,0.02)", border:`1px solid ${C.brd}`, borderRadius:6 }}>
                              <p style={{ ...mono, margin:"0 0 7px", fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>⚙ Common combinations</p>
                              <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                                {p.combos.map((c,i)=>{
                                  const [prod,...rest]=c.split(" — ");
                                  return(
                                    <div key={i} style={{ display:"flex", gap:7, alignItems:"flex-start" }}>
                                      <span style={{ ...mono, fontSize:11, color:cat.c, flexShrink:0, background:`${cat.c}18`, border:`1px solid ${cat.c}33`, borderRadius:3, padding:"1px 6px", whiteSpace:"nowrap" }}>{prod}</span>
                                      {rest.length>0&&<span style={{ fontSize:12, color:C.dim, lineHeight:1.55 }}>{rest.join(" — ")}</span>}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab==="Intel Library"&&(
        <div>
          {/* Product Docs Import */}
          <div style={{ marginBottom:14, padding:"12px 14px", background:`${C.blue}0A`, border:`1px solid ${C.blue}28`, borderRadius:8, display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <p style={{ margin:"0 0 2px", fontSize:13, fontWeight:500, color:C.txt }}>
                {importing
                  ? `Importing ${importProgress} / ${PRODUCT_IMPORT_SOURCES.length}…`
                  : importDone
                    ? <span>Docs imported <span style={{ color:C.green }}>✓</span> — {PRODUCT_IMPORT_SOURCES.length} pages live in library</span>
                    : "Import your own product pages as intel docs"}
              </p>
              <p style={{ ...mono, margin:0, fontSize:11, color:C.dim }}>
                {importing
                  ? <span style={{ color:C.blue }}>Fetching via r.jina.ai — {PRODUCT_IMPORT_SOURCES[importProgress-1]?.name||"…"}</span>
                  : importDone
                    ? "Re-import replaces existing docs with the latest content from your product pages"
                    : `Fetches ${PRODUCT_IMPORT_SOURCES.length} product + use case pages and saves as active intel docs`}
              </p>
              {importing&&(
                <div style={{ marginTop:7, height:3, background:C.brd, borderRadius:2, overflow:"hidden" }}>
                  <div style={{ height:"100%", width:`${(importProgress/PRODUCT_IMPORT_SOURCES.length)*100}%`, background:C.blue, transition:"width 0.3s", borderRadius:2 }}/>
                </div>
              )}
            </div>
            <button
              onClick={importProductDocs}
              disabled={importing}
              style={{ ...mono, fontSize:12, padding:"7px 14px", borderRadius:6, border:`1px solid ${importing?C.brd:C.blue}`, background:importing?"transparent":`${C.blue}18`, color:importing?C.dim:C.blue, cursor:importing?"not-allowed":"pointer", fontWeight:500, whiteSpace:"nowrap", flexShrink:0 }}>
              {importing?`${importProgress}/${PRODUCT_IMPORT_SOURCES.length}…`:importDone?"↺ Re-import":"⬇ Import docs"}
            </button>
          </div>

          <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:12 }}>
            <div style={{ flex:1 }}>
              <p style={{ margin:"0 0 1px",fontSize:15,fontWeight:500,color:C.txt }}>Intel Library</p>
              <p style={{ ...mono,margin:0,fontSize:12,color:C.mut }}>
                {activeCount>0?<span style={{ color:C.green }}>{activeCount} active doc{activeCount>1?"s":""} · {activeChars.toLocaleString()} chars feeding assay</span>:"No active docs — add intel below"}
              </p>
            </div>
            {!adding&&<button onClick={()=>setAdding(true)} style={{ fontSize:13,padding:"6px 14px",background:C.goldBg,border:`1px solid ${C.goldBdr}`,color:C.gold,borderRadius:6,cursor:"pointer",fontWeight:500 }}>+ Add intel</button>}
          </div>

          {adding&&(
            <div style={{ background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:"14px",marginBottom:12 }}>
              <input
                placeholder="Name (auto-detected if blank)"
                value={draftName}
                onChange={e=>setDraftName(e.target.value)}
                style={{ width:"100%",fontSize:13,padding:"7px 10px",background:C.sur,border:`1px solid ${C.brd}`,borderRadius:5,color:C.txt,outline:"none",boxSizing:"border-box",marginBottom:8 }}
              />
              <textarea
                autoFocus
                value={draft}
                onChange={e=>{setDraft(e.target.value);if(!draftName)setDraftName(detectIntelCategory(e.target.value));}}
                placeholder="Paste docs, playbooks, battle cards, objection handling, talk tracks..."
                style={{ width:"100%",height:220,fontSize:13,padding:"10px 12px",background:C.sur,border:`1px solid ${C.brd}`,borderRadius:6,color:C.txt,outline:"none",resize:"vertical",lineHeight:1.7,boxSizing:"border-box",fontFamily:"inherit" }}
              />
              <div style={{ display:"flex",gap:8,marginTop:8 }}>
                <button onClick={saveDoc} disabled={!draft.trim()} style={{ fontSize:13,padding:"7px 16px",background:C.goldBg,border:`1px solid ${C.goldBdr}`,color:draft.trim()?C.gold:C.dim,borderRadius:6,cursor:draft.trim()?"pointer":"not-allowed",fontWeight:500 }}>Save →</button>
                <button onClick={()=>{setAdding(false);setDraft("");setDraftName("");}} style={{ fontSize:13,padding:"7px 12px",background:"transparent",border:`1px solid ${C.brd}`,color:C.mut,borderRadius:6,cursor:"pointer" }}>Cancel</button>
                {draft&&<span style={{ ...mono,fontSize:12,color:C.dim,alignSelf:"center" }}>→ {detectIntelCategory(draft)}</span>}
              </div>
            </div>
          )}

          {docs.length===0&&!adding&&(
            <div style={{ padding:"32px",textAlign:"center",color:C.dim,border:`1px dashed ${C.brd}`,borderRadius:8 }}>
              <p style={{ margin:"0 0 8px",fontSize:14 }}>No intel saved yet</p>
              <p style={{ margin:0,fontSize:13 }}>Add lending playbooks, payments docs, battle cards — the assay engine reads all active docs</p>
            </div>
          )}

          <div style={{ display:"flex",flexDirection:"column",gap:4 }}>
            {docs.map(d=>{
              const exp=expandedDoc===d.id;
              const preview=d.content.slice(0,120).replace(/\n/g," ");
              const date=new Date(d.createdAt).toLocaleDateString("en-US",{month:"short",day:"numeric"});
              return(
                <div key={d.id} style={{ border:`1px solid ${d.active?C.green+"44":C.brd}`,borderRadius:7,background:d.active?C.card:C.sur,overflow:"hidden" }}>
                  <div style={{ padding:"10px 14px",display:"flex",alignItems:"center",gap:10 }}>
                    <button onClick={()=>toggleDoc(d.id)} style={{ width:32,height:18,borderRadius:9,border:"none",background:d.active?C.green:C.brd,cursor:"pointer",position:"relative",flexShrink:0,padding:0 }}>
                      <span style={{ position:"absolute",top:2,left:d.active?14:2,width:14,height:14,borderRadius:"50%",background:"#fff",transition:"left 0.15s" }}/>
                    </button>
                    <div style={{ flex:1,minWidth:0,cursor:"pointer" }} onClick={()=>setExpandedDoc(exp?null:d.id)}>
                      <p style={{ margin:"0 0 1px",fontSize:14,fontWeight:500,color:d.active?C.txt:C.mut,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{d.name}</p>
                      {!exp&&<p style={{ ...mono,margin:0,fontSize:11,color:C.dim,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{preview}…</p>}
                    </div>
                    <span style={{ ...mono,fontSize:11,color:C.dim,flexShrink:0 }}>{date}</span>
                    <span onClick={()=>setExpandedDoc(exp?null:d.id)} style={{ fontSize:11,color:C.dim,cursor:"pointer",flexShrink:0 }}>{exp?"▲":"▼"}</span>
                    <button onClick={()=>deleteDoc(d.id)} style={{ background:"transparent",border:"none",color:C.dim,fontSize:14,cursor:"pointer",padding:"0 2px",flexShrink:0,lineHeight:1 }}>✕</button>
                  </div>
                  {exp&&(
                    <div style={{ borderTop:`1px solid ${C.brd}`,padding:"10px 14px" }}>
                      <p style={{ margin:0,fontSize:13,color:C.mut,lineHeight:1.7,whiteSpace:"pre-wrap" }}>{d.content}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab==="Example Accounts"&&(
        <div>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
            <div style={{ flex:1 }}>
              <p style={{ margin:"0 0 1px", fontSize:15, fontWeight:500, color:C.txt }}>Example Accounts</p>
              <p style={{ ...mono, margin:0, fontSize:12, color:C.mut }}>
                {goldCount+missCount>0
                  ? <span><span style={{ color:C.gold }}>{goldCount} gold</span><span style={{ color:C.dim }}> · </span><span style={{ color:C.slag }}>{missCount} near-miss</span><span style={{ color:C.dim }}> — shaping assay boundary</span></span>
                  : "No examples yet — the assay uses only hardcoded calibration"}
              </p>
            </div>
            {!exAdding&&<button onClick={()=>setExAdding(true)} style={{ fontSize:13, padding:"6px 14px", background:C.goldBg, border:`1px solid ${C.goldBdr}`, color:C.gold, borderRadius:6, cursor:"pointer", fontWeight:500 }}>+ Add example</button>}
          </div>

          {/* Explain the value */}
          <div style={{ background:`${C.blue}0a`, border:`1px solid ${C.blue}33`, borderRadius:7, padding:"10px 14px", marginBottom:12, fontSize:13, color:C.mut, lineHeight:1.6 }}>
            <span style={{ color:C.blue, fontWeight:600 }}>Why this matters: </span>
            The model already knows what a clear Gold looks like. What it needs are the <em>near-misses</em> — accounts that pattern-matched on surface signals but had no real product fit. That boundary definition is the highest-value training signal you can give it.
          </div>

          {exAdding&&(
            <div style={{ background:C.card, border:`1px solid ${C.brd}`, borderRadius:8, padding:"14px", marginBottom:12 }}>
              <input
                placeholder="Account name (e.g. 'Acme Lending')"
                value={exDraft.name}
                onChange={e=>setExDraft(d=>({...d,name:e.target.value}))}
                style={{ width:"100%", fontSize:13, padding:"7px 10px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:5, color:C.txt, outline:"none", boxSizing:"border-box", marginBottom:10 }}
              />
              {/* Type toggle */}
              <div style={{ display:"flex", gap:6, marginBottom:10 }}>
                {[["gold","Gold Example",C.gold],["nearmiss","Near-Miss",C.slag]].map(([val,lbl,col])=>(
                  <button key={val} onClick={()=>setExDraft(d=>({...d,type:val}))}
                    style={{ ...mono, fontSize:12, padding:"5px 14px", borderRadius:5, border:`1.5px solid ${exDraft.type===val?col:C.brd}`, background:exDraft.type===val?`${col}18`:"transparent", color:exDraft.type===val?col:C.dim, cursor:"pointer", fontWeight:exDraft.type===val?600:400 }}>
                    {val==="gold"?"★ ":"⚠ "}{lbl}
                  </button>
                ))}
              </div>
              {exDraft.type==="gold"&&(
                <textarea rows={2} placeholder="Optional: what makes this a strong fit? (e.g. 'ACH-native lending platform, bank data is their core product')"
                  value={exDraft.notes}
                  onChange={e=>setExDraft(d=>({...d,notes:e.target.value}))}
                  style={{ width:"100%", fontSize:13, padding:"8px 10px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:5, color:C.txt, outline:"none", resize:"vertical", lineHeight:1.6, boxSizing:"border-box", fontFamily:"inherit", marginBottom:8 }}
                />
              )}
              {exDraft.type==="nearmiss"&&(
                <textarea rows={2} placeholder="Why NOT a fit? (e.g. 'Looked like fintech but purely IT consulting with no payments/lending angle — fintech branding only')"
                  value={exDraft.why}
                  onChange={e=>setExDraft(d=>({...d,why:e.target.value}))}
                  style={{ width:"100%", fontSize:13, padding:"8px 10px", background:C.sur, border:`1.5px solid ${C.slag}55`, borderRadius:5, color:C.txt, outline:"none", resize:"vertical", lineHeight:1.6, boxSizing:"border-box", fontFamily:"inherit", marginBottom:8 }}
                />
              )}
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={saveExample} disabled={!exDraft.name.trim()||(exDraft.type==="nearmiss"&&!exDraft.why.trim())}
                  style={{ fontSize:13, padding:"7px 16px", background:C.goldBg, border:`1px solid ${C.goldBdr}`, color:exDraft.name.trim()?C.gold:C.dim, borderRadius:6, cursor:exDraft.name.trim()?"pointer":"not-allowed", fontWeight:500 }}>Save →</button>
                <button onClick={()=>{setExAdding(false);setExDraft({name:"",type:"gold",notes:"",why:""}); }} style={{ fontSize:13, padding:"7px 12px", background:"transparent", border:`1px solid ${C.brd}`, color:C.mut, borderRadius:6, cursor:"pointer" }}>Cancel</button>
              </div>
            </div>
          )}

          {examples.length===0&&!exAdding&&(
            <div style={{ padding:"32px", textAlign:"center", color:C.dim, border:`1px dashed ${C.brd}`, borderRadius:8 }}>
              <p style={{ margin:"0 0 8px", fontSize:14 }}>No examples saved yet</p>
              <p style={{ margin:0, fontSize:13 }}>Add real accounts from your territory — both confirmed wins and near-misses that fooled you</p>
            </div>
          )}

          {/* Gold examples */}
          {examples.filter(e=>e.type==="gold").length>0&&(
            <div style={{ marginBottom:14 }}>
              <p style={{ ...mono, margin:"0 0 6px", fontSize:10, color:C.gold, textTransform:"uppercase", letterSpacing:"0.08em" }}>★ Gold Examples</p>
              <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                {examples.filter(e=>e.type==="gold").map(e=>(
                  <div key={e.id} style={{ border:`1px solid ${e.active?C.gold+"44":C.brd}`, borderRadius:7, background:e.active?C.card:C.sur, padding:"10px 14px", display:"flex", alignItems:"flex-start", gap:10 }}>
                    <button onClick={()=>toggleExample(e.id)} style={{ width:32, height:18, borderRadius:9, border:"none", background:e.active?C.gold:C.brd, cursor:"pointer", position:"relative", flexShrink:0, padding:0, marginTop:2 }}>
                      <span style={{ position:"absolute", top:2, left:e.active?14:2, width:14, height:14, borderRadius:"50%", background:"#fff", transition:"left 0.15s" }}/>
                    </button>
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ margin:"0 0 2px", fontSize:14, fontWeight:500, color:e.active?C.gold:C.mut }}>{e.name}</p>
                      {e.notes&&<p style={{ ...mono, margin:0, fontSize:12, color:C.dim, lineHeight:1.5 }}>{e.notes}</p>}
                    </div>
                    <button onClick={()=>deleteExample(e.id)} style={{ background:"transparent", border:"none", color:C.dim, fontSize:14, cursor:"pointer", padding:"0 2px", lineHeight:1 }}>✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Near-miss examples */}
          {examples.filter(e=>e.type==="nearmiss").length>0&&(
            <div>
              <p style={{ ...mono, margin:"0 0 6px", fontSize:10, color:C.slag, textTransform:"uppercase", letterSpacing:"0.08em" }}>⚠ Near-Misses — looked promising, disqualified</p>
              <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                {examples.filter(e=>e.type==="nearmiss").map(e=>(
                  <div key={e.id} style={{ border:`1px solid ${e.active?C.slag+"44":C.brd}`, borderRadius:7, background:e.active?C.card:C.sur, padding:"10px 14px", display:"flex", alignItems:"flex-start", gap:10 }}>
                    <button onClick={()=>toggleExample(e.id)} style={{ width:32, height:18, borderRadius:9, border:"none", background:e.active?C.slag:C.brd, cursor:"pointer", position:"relative", flexShrink:0, padding:0, marginTop:2 }}>
                      <span style={{ position:"absolute", top:2, left:e.active?14:2, width:14, height:14, borderRadius:"50%", background:"#fff", transition:"left 0.15s" }}/>
                    </button>
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ margin:"0 0 3px", fontSize:14, fontWeight:500, color:e.active?C.txt:C.mut }}>{e.name}</p>
                      {e.why&&<p style={{ ...mono, margin:0, fontSize:12, color:C.dim, lineHeight:1.5 }}><span style={{ color:C.slag }}>Why not: </span>{e.why}</p>}
                    </div>
                    <button onClick={()=>deleteExample(e.id)} style={{ background:"transparent", border:"none", color:C.dim, fontSize:14, cursor:"pointer", padding:"0 2px", lineHeight:1 }}>✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab==="Voice Profile"&&(
        <div>
          {/* Header + connect/learn button */}
          <div style={{ display:"flex", alignItems:"flex-start", gap:12, marginBottom:16, padding:"14px 16px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:8 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <p style={{ margin:"0 0 3px", fontSize:15, fontWeight:500, color:C.txt }}>{(voiceUserName.split(' ')[0]||'Your')}'s Voice Profile</p>
              <p style={{ ...mono, margin:0, fontSize:12, color:C.dim }}>
                {vpLoading?"Analyzing your sent emails…"
                  :voiceProfile?`Learned from ${voiceProfile.emailCount||"?"} sent emails · Last updated ${new Date(voiceProfile.learnedAt).toLocaleDateString()}${voiceProfile.teachCount?" · Refined "+voiceProfile.teachCount+"×":""}`
                  :gmailConnected?"No profile yet — click Learn to analyze your sent emails"
                  :"Connect Gmail to learn your voice from sent emails"}
              </p>
            </div>
            <div style={{ display:"flex", gap:6, flexShrink:0, flexWrap:"wrap", justifyContent:"flex-end" }}>
              {!gmailConnected&&(
                <button onClick={()=>window.location.href="/api/gmail/auth"} style={{ fontSize:13, padding:"7px 14px", background:`${C.blue}18`, border:`1px solid ${C.blue}44`, color:C.blue, borderRadius:6, cursor:"pointer", fontWeight:500 }}>
                  Connect Gmail →
                </button>
              )}
              {gmailConnected&&(
                <button onClick={learnVoice} disabled={vpLoading} style={{ fontSize:13, padding:"7px 14px", background:vpLoading?"transparent":C.goldBg, border:`1px solid ${vpLoading?C.brd:C.goldBdr}`, color:vpLoading?C.dim:C.gold, borderRadius:6, cursor:vpLoading?"not-allowed":"pointer", fontWeight:500 }}>
                  {vpLoading?"Analyzing…":voiceProfile?"↺ Re-learn":"⟳ Learn from Gmail"}
                </button>
              )}
              {!vpLoading&&(
                <button onClick={()=>setPasteOpen(o=>!o)} style={{ fontSize:13, padding:"7px 14px", background:pasteOpen?`${C.purple}18`:`${C.purple}12`, border:`1px solid ${pasteOpen?C.purple:C.purple+"44"}`, color:C.purple, borderRadius:6, cursor:"pointer", fontWeight:500 }}>
                  {pasteOpen?"✕ Cancel":"✉ Paste emails"}
                </button>
              )}
            </div>
          </div>

          {pasteOpen&&(
            <div style={{ marginBottom:14, padding:"14px", background:C.card, border:`1px solid ${C.purple}44`, borderRadius:8 }}>
              <p style={{ margin:"0 0 6px", fontSize:13, fontWeight:500, color:C.txt }}>Paste your sent emails</p>
              <p style={{ ...mono, margin:"0 0 10px", fontSize:11, color:C.dim }}>Copy emails from Gmail (Sent folder) and paste them here. Include as many as you want — the more the better. Analyzed client-side via Claude.</p>
              <textarea
                value={pasteText}
                onChange={e=>setPasteText(e.target.value)}
                placeholder={"Paste your sent emails here...\n\nTip: In Gmail → Sent, open each email, select all text (Cmd+A), copy, paste here. Separate multiple emails with a blank line or ---"}
                rows={10}
                style={{ width:"100%", fontSize:12, lineHeight:1.7, padding:"10px 12px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:6, color:C.txt, outline:"none", resize:"vertical", boxSizing:"border-box", fontFamily:"inherit" }}
              />
              <div style={{ display:"flex", gap:8, marginTop:8, alignItems:"center" }}>
                <button
                  onClick={learnFromPaste}
                  disabled={!pasteText.trim()}
                  style={{ fontSize:13, padding:"7px 16px", background:pasteText.trim()?C.goldBg:"transparent", border:`1px solid ${pasteText.trim()?C.goldBdr:C.brd}`, color:pasteText.trim()?C.gold:C.dim, borderRadius:6, cursor:pasteText.trim()?"pointer":"not-allowed", fontWeight:500 }}>
                  Analyze voice →
                </button>
                <span style={{ ...mono, fontSize:11, color:C.dim }}>{pasteText.length>0?`${pasteText.split(/\n/).length} lines pasted`:""}</span>
              </div>
            </div>
          )}

          {vpError&&<div style={{ padding:"10px 14px", background:`${C.red}12`, border:`1px solid ${C.red}33`, borderRadius:6, marginBottom:12, ...mono, fontSize:12, color:C.red }}>{vpError}</div>}

          {vpLoading&&(
            <div style={{ padding:"40px", textAlign:"center", color:C.dim }}>
              <div style={{ fontSize:24, marginBottom:12 }}>✉</div>
              <p style={{ margin:"0 0 6px", fontSize:14, color:C.txt }}>Reading your sent emails…</p>
              <p style={{ ...mono, margin:0, fontSize:12 }}>Filtering to external emails · Analyzing patterns with Claude</p>
            </div>
          )}

          {!vpLoading&&voiceProfile&&(()=>{
            const vp=voiceProfile;
            const formalLabels=["","Very casual","Casual","Conversational","Semi-formal","Formal"];
            return(
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {/* Top trait badges */}
                <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
                  {(vp.keyTraits||[]).map(t=>(
                    <span key={t} style={{ fontSize:13, padding:"4px 12px", background:`${C.blue}18`, border:`1px solid ${C.blue}33`, color:C.blue, borderRadius:5, fontWeight:500 }}>{t}</span>
                  ))}
                  {vp.tone&&<span style={{ fontSize:13, padding:"4px 12px", background:`${C.purple}18`, border:`1px solid ${C.purple}33`, color:C.purple, borderRadius:5, fontWeight:500 }}>{vp.tone}</span>}
                  {vp.formalityLevel&&<span style={{ ...mono, fontSize:11, padding:"4px 10px", background:"rgba(255,255,255,0.04)", border:`1px solid ${C.brd}`, color:C.mut, borderRadius:5 }}>{formalLabels[vp.formalityLevel]||`${vp.formalityLevel}/5`}</span>}
                </div>

                {/* Two-column grid */}
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                  <div style={{ padding:"12px 14px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:7 }}>
                    <p style={{ ...mono, margin:"0 0 6px", fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>Greeting</p>
                    <p style={{ margin:"0 0 10px", fontSize:14, color:C.txt, fontStyle:"italic" }}>"{vp.greeting||"—"}"</p>
                    <p style={{ ...mono, margin:"0 0 4px", fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>Sign-off</p>
                    <p style={{ margin:0, fontSize:14, color:C.txt, fontStyle:"italic" }}>"{vp.closing||"—"}"</p>
                  </div>
                  <div style={{ padding:"12px 14px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:7 }}>
                    <p style={{ ...mono, margin:"0 0 6px", fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>Email length</p>
                    <p style={{ margin:"0 0 10px", fontSize:13, color:C.txt }}>{vp.avgEmailLength||"—"}</p>
                    <p style={{ ...mono, margin:"0 0 4px", fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>Sentence length</p>
                    <p style={{ margin:0, fontSize:13, color:C.txt }}>{vp.avgSentenceLength||"—"}</p>
                  </div>
                </div>

                {/* Phrases */}
                {vp.commonPhrases?.length>0&&(
                  <div style={{ padding:"12px 14px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:7 }}>
                    <p style={{ ...mono, margin:"0 0 8px", fontSize:10, color:C.green, textTransform:"uppercase", letterSpacing:"0.08em" }}>Phrases {(activeUser?.name||user?.name||"").split(" ")[0]||"AE"} uses</p>
                    <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                      {vp.commonPhrases.map(p=>(
                        <span key={p} style={{ fontSize:12, padding:"3px 10px", background:`${C.green}12`, border:`1px solid ${C.green}25`, color:C.green, borderRadius:4 }}>"{p}"</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Avoid */}
                {vp.avoidPhrases?.length>0&&(
                  <div style={{ padding:"12px 14px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:7 }}>
                    <p style={{ ...mono, margin:"0 0 8px", fontSize:10, color:C.red, textTransform:"uppercase", letterSpacing:"0.08em" }}>Phrases {(activeUser?.name||user?.name||"").split(" ")[0]||"AE"} avoids</p>
                    <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                      {vp.avoidPhrases.map(p=>(
                        <span key={p} style={{ fontSize:12, padding:"3px 10px", background:`${C.red}12`, border:`1px solid ${C.red}25`, color:C.red, borderRadius:4, textDecoration:"line-through", opacity:0.8 }}>"{p}"</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Structure + punctuation */}
                {(vp.structureStyle||vp.punctuationStyle||vp.sampleOpener)&&(
                  <div style={{ padding:"12px 14px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:7 }}>
                    <p style={{ ...mono, margin:"0 0 8px", fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>Style notes</p>
                    {vp.structureStyle&&<p style={{ margin:"0 0 4px", fontSize:12, color:C.mut }}>Structure: {vp.structureStyle}</p>}
                    {vp.punctuationStyle&&<p style={{ margin:"0 0 4px", fontSize:12, color:C.mut }}>Punctuation: {vp.punctuationStyle}</p>}
                    {vp.sampleOpener&&<p style={{ margin:"8px 0 0", fontSize:12, color:C.txt, fontStyle:"italic", borderTop:`1px solid ${C.brd}`, paddingTop:8 }}>Sample opener: "{vp.sampleOpener}"</p>}
                  </div>
                )}

                {/* Status bar */}
                <div style={{ display:"flex", gap:6, alignItems:"center", padding:"8px 12px", background:"rgba(255,255,255,0.02)", border:`1px solid ${C.brd}`, borderRadius:6, ...mono, fontSize:11, color:C.dim }}>
                  <span style={{ color:C.green }}>✓</span>
                  <span>Active — injected into every email generation</span>
                  <span style={{ marginLeft:"auto" }}>Analyzed {vp.emailCount||"?"} emails{vp.teachCount?" · Refined "+vp.teachCount+"×":""}</span>
                </div>
              </div>
            );
          })()}

          {!vpLoading&&!voiceProfile&&!vpError&&(
            <div style={{ padding:"40px", textAlign:"center", color:C.dim, border:`1px dashed ${C.brd}`, borderRadius:8 }}>
              <p style={{ margin:"0 0 6px", fontSize:14, color:C.txt }}>{gmailConnected?"No voice profile yet":"Gmail not connected"}</p>
              <p style={{ margin:"0 0 14px", fontSize:13 }}>{gmailConnected?"Click \"Learn from Gmail\" to analyze your sent emails":"Connect Gmail to learn from your actual sent emails"}</p>
              {!gmailConnected&&<button onClick={()=>window.location.href="/api/gmail/auth"} style={{ fontSize:13, padding:"8px 18px", background:`${C.blue}18`, border:`1px solid ${C.blue}44`, color:C.blue, borderRadius:6, cursor:"pointer", fontWeight:500 }}>Connect Gmail →</button>}
            </div>
          )}
        </div>
      )}

      {tab==="Voice Library"&&(
        <div>
          <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:10 }}>
            <div style={{ flex:1 }}>
              <p style={{ margin:"0 0 1px",fontSize:15,fontWeight:500,color:C.txt }}>Voice Library</p>
              <p style={{ ...mono,margin:0,fontSize:12,color:C.mut }}>
                {activeVoice>0
                  ? <span style={{ color:C.green }}>{activeVoice} active example{activeVoice>1?"s":""} shaping email tone</span>
                  : "No active examples — email generator uses default voice rules"}
              </p>
            </div>
            {!vAdding&&<button onClick={()=>setVAdding(true)} style={{ fontSize:13,padding:"6px 14px",background:C.goldBg,border:`1px solid ${C.goldBdr}`,color:C.gold,borderRadius:6,cursor:"pointer",fontWeight:500 }}>+ Add email</button>}
          </div>

          {/* Voice rules reminder */}
          <div style={{ background:C.goldBg,border:`1px solid ${C.goldBdr}`,borderRadius:7,padding:"10px 14px",marginBottom:12,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center" }}>
            <span style={{ ...mono,fontSize:11,color:"#9A7520",textTransform:"uppercase",letterSpacing:"0.08em",flexShrink:0 }}>{user?.name||"You"} · Voice rules</span>
            {[`"Hey [first name]" opener`,"Short punchy sentences","3 paragraphs","Never pushy",`"- ${user?.name?.split(" ")[0]||"AE"}" closer`].map(t=>(
              <span key={t} style={{ fontSize:12,color:C.gold,background:"transparent",border:`1px solid ${C.goldBdr}`,borderRadius:4,padding:"1px 8px" }}>{t}</span>
            ))}
          </div>

          {vAdding&&(
            <div style={{ background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:"14px",marginBottom:12 }}>
              <input
                placeholder="Label (e.g. 'Payments — worked great with Marcus')"
                value={vDraftName}
                onChange={e=>setVDraftName(e.target.value)}
                style={{ width:"100%",fontSize:13,padding:"7px 10px",background:C.sur,border:`1px solid ${C.brd}`,borderRadius:5,color:C.txt,outline:"none",boxSizing:"border-box",marginBottom:8 }}
              />
              <textarea
                autoFocus
                value={vDraft}
                onChange={e=>setVDraft(e.target.value)}
                placeholder={"Paste a successful email body here — opener, 3 paragraphs, sign-off. The generator will match this style."}
                style={{ width:"100%",height:220,fontSize:13,padding:"10px 12px",background:C.sur,border:`1px solid ${C.brd}`,borderRadius:6,color:C.txt,outline:"none",resize:"vertical",lineHeight:1.8,boxSizing:"border-box",fontFamily:"inherit" }}
              />
              <div style={{ display:"flex",gap:8,marginTop:8 }}>
                <button onClick={saveVoiceDoc} disabled={!vDraft.trim()} style={{ fontSize:13,padding:"7px 16px",background:C.goldBg,border:`1px solid ${C.goldBdr}`,color:vDraft.trim()?C.gold:C.dim,borderRadius:6,cursor:vDraft.trim()?"pointer":"not-allowed",fontWeight:500 }}>Save →</button>
                <button onClick={()=>{setVAdding(false);setVDraft("");setVDraftName("");}} style={{ fontSize:13,padding:"7px 12px",background:"transparent",border:`1px solid ${C.brd}`,color:C.mut,borderRadius:6,cursor:"pointer" }}>Cancel</button>
              </div>
            </div>
          )}

          <div style={{ display:"flex",flexDirection:"column",gap:4 }}>
            {voiceDocs.map(d=>{
              const exp=vExpanded===d.id;
              const preview=d.content.slice(0,100).replace(/\n/g," ");
              const date=new Date(d.createdAt).toLocaleDateString("en-US",{month:"short",day:"numeric"});
              return(
                <div key={d.id} style={{ border:`1px solid ${d.active?C.gold+"44":C.brd}`,borderRadius:7,background:d.active?C.goldBg:C.sur,overflow:"hidden" }}>
                  <div style={{ padding:"10px 14px",display:"flex",alignItems:"center",gap:10 }}>
                    <button onClick={()=>toggleVoiceDoc(d.id)} style={{ width:32,height:18,borderRadius:9,border:"none",background:d.active?C.gold:C.brd,cursor:"pointer",position:"relative",flexShrink:0,padding:0 }}>
                      <span style={{ position:"absolute",top:2,left:d.active?14:2,width:14,height:14,borderRadius:"50%",background:"#fff",transition:"left 0.15s" }}/>
                    </button>
                    <div style={{ flex:1,minWidth:0,cursor:"pointer" }} onClick={()=>setVExpanded(exp?null:d.id)}>
                      <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:1 }}>
                        <p style={{ margin:0,fontSize:14,fontWeight:500,color:d.active?C.gold:C.mut,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{d.name}</p>
                        {d.baseline&&<span style={{ ...mono,fontSize:10,color:C.dim,border:`1px solid ${C.brd}`,borderRadius:3,padding:"0px 4px",flexShrink:0 }}>baseline</span>}
                      </div>
                      {!exp&&<p style={{ ...mono,margin:0,fontSize:11,color:C.dim,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{preview}…</p>}
                    </div>
                    <span style={{ ...mono,fontSize:11,color:C.dim,flexShrink:0 }}>{date}</span>
                    <span onClick={()=>setVExpanded(exp?null:d.id)} style={{ fontSize:11,color:C.dim,cursor:"pointer",flexShrink:0 }}>{exp?"▲":"▼"}</span>
                    {!d.baseline&&<button onClick={()=>deleteVoiceDoc(d.id)} style={{ background:"transparent",border:"none",color:C.dim,fontSize:14,cursor:"pointer",padding:"0 2px",flexShrink:0,lineHeight:1 }}>✕</button>}
                    {d.baseline&&<span style={{ width:18,flexShrink:0 }}/>}
                  </div>
                  {exp&&(
                    <div style={{ borderTop:`1px solid ${C.goldBdr}22`,padding:"10px 14px" }}>
                      <pre style={{ margin:0,fontSize:13,color:C.txt,lineHeight:1.8,whiteSpace:"pre-wrap",fontFamily:"inherit" }}>{d.content}</pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab==="Integrations"&&(
        <div>
          <div style={{ marginBottom:16 }}>
            <p style={{ margin:"0 0 2px", fontSize:15, fontWeight:500, color:C.txt }}>Connected Tools</p>
            <p style={{ ...mono, margin:0, fontSize:12, color:C.mut }}>Third-party tools that can read and write Prospector account data</p>
          </div>

          {/* Handshake format note */}
          <div style={{ background:`${C.blue}0a`, border:`1px solid ${C.blue}33`, borderRadius:7, padding:"10px 14px", marginBottom:16, fontSize:13, color:C.mut, lineHeight:1.6 }}>
            <span style={{ color:C.blue, fontWeight:600 }}>Shared account format: </span>
            Tools exchange data as JSON with a standard schema — id, name, website, vertical, tier, score, useCases, products, productFit, businessModel, keySignals, stage, lastActivity. Use the <span style={{ ...mono, fontSize:12, color:C.txt }}>⬡ Export</span> button on any account card to copy this payload to clipboard.
          </div>

          {/* Disco Coach card */}
          <div style={{ background:C.card, border:`1px solid ${C.brd}`, borderRadius:10, overflow:"hidden" }}>
            <div style={{ padding:"14px 16px", display:"flex", alignItems:"flex-start", gap:14 }}>
              <div style={{ width:38, height:38, borderRadius:8, background:`${C.purple}18`, border:`1px solid ${C.purple}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>🔍</div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}>
                  <span style={{ fontSize:14, fontWeight:600, color:C.txt }}>Disco Coach</span>
                  <span style={{ ...mono, fontSize:10, color:C.dim }}>by [friend's name]</span>
                  <span style={{ ...mono, fontSize:10, padding:"1px 7px", background:`${C.brd}`, border:`1px solid ${C.brd}`, borderRadius:10, color:C.dim, marginLeft:"auto" }}>● Not connected</span>
                </div>
                <p style={{ margin:"0 0 12px", fontSize:13, color:C.mut, lineHeight:1.6 }}>
                  Syncs discovery call outcomes back to account records — confirmed use cases, products discussed, next steps, and buying signals automatically update account scores.
                </p>
                <button style={{ ...mono, fontSize:12, padding:"5px 14px", background:"transparent", border:`1px solid ${C.purple}55`, color:C.purple, borderRadius:5, cursor:"pointer" }}>
                  Request connection →
                </button>
              </div>
            </div>
          </div>

          <p style={{ ...mono, margin:"20px 0 0", fontSize:11, color:C.dim, textAlign:"center" }}>More integrations coming — paste an account JSON from any connected tool to pre-load it with full Prospector context.</p>
        </div>
      )}

      {tab==="Territory Trends"&&(
        <div>
          <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16 }}>
            <div style={{ flex:1 }}>
              <p style={{ margin:"0 0 3px", fontSize:15, fontWeight:600, color:C.txt }}>Territory Trends</p>
              <p style={{ ...mono, margin:0, fontSize:12, color:C.dim }}>Claude analysis of your Gong calls — pain points, objections, product signals, and territory health.</p>
            </div>
            <button onClick={fetchTrends} disabled={trends==='loading'} style={{ fontSize:13, padding:"7px 16px", background:trends==='loading'?"transparent":`${C.gold}14`, border:`1px solid ${trends==='loading'?C.brd:C.goldBdr}`, color:trends==='loading'?C.dim:C.gold, borderRadius:6, cursor:trends==='loading'?'default':'pointer', fontWeight:500 }}>
              {trends==='loading'?'Analyzing…':'Run Analysis →'}
            </button>
          </div>

          {trendsError&&<p style={{ ...mono, fontSize:12, color:"#e05555", margin:"0 0 12px" }}>✕ {trendsError}</p>}

          {trends==='loading'&&(
            <div style={{ padding:"40px 20px", textAlign:"center" }}>
              <p style={{ ...mono, fontSize:13, color:"#00B4D888" }}>⬡ Querying Databricks and running Claude analysis…</p>
              <p style={{ ...mono, fontSize:11, color:C.dim, marginTop:6 }}>This may take 20-30 seconds for large territories</p>
            </div>
          )}

          {trends&&trends!=='loading'&&(()=>{
            const { trends:t, callCount, accountCount, generatedAt } = trends;
            return(
              <div>
                <div style={{ ...mono, fontSize:10, color:C.dim, marginBottom:12 }}>
                  {callCount} calls across {accountCount} accounts · analyzed {generatedAt?new Date(generatedAt).toLocaleString():''}
                </div>

                {t?.summary&&(
                  <div style={{ padding:"12px 14px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:8, marginBottom:14 }}>
                    <p style={{ ...mono, margin:"0 0 4px", fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.07em" }}>Executive Summary</p>
                    <p style={{ margin:0, fontSize:13, color:C.txt, lineHeight:1.7 }}>{t.summary}</p>
                    {t.territoryHealth&&(
                      <span style={{ ...mono, marginTop:8, display:"inline-block", fontSize:10, padding:"2px 9px", borderRadius:10,
                        background: t.territoryHealth==='healthy'?`${C.green}18`:t.territoryHealth==='at-risk'?`#e0555518`:`${C.gold}14`,
                        border: `1px solid ${t.territoryHealth==='healthy'?C.green+"44":t.territoryHealth==='at-risk'?"#e0555544":C.gold+"44"}`,
                        color: t.territoryHealth==='healthy'?C.green:t.territoryHealth==='at-risk'?"#e05555":C.gold,
                      }}>{t.territoryHealth}</span>
                    )}
                  </div>
                )}

                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
                  {t?.topPainPoints?.length>0&&(
                    <div style={{ padding:"12px 14px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:8 }}>
                      <p style={{ ...mono, margin:"0 0 8px", fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.07em" }}>Top Pain Points</p>
                      {t.topPainPoints.slice(0,5).map((p,i)=>(
                        <div key={i} style={{ marginBottom:7 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                            <span style={{ ...mono, fontSize:11, color:C.txt, fontWeight:500 }}>{p.pain}</span>
                            {p.frequency>1&&<span style={{ ...mono, fontSize:9, color:C.dim }}>×{p.frequency}</span>}
                          </div>
                          {p.example&&<p style={{ ...mono, margin:"1px 0 0 0", fontSize:10, color:C.dim, lineHeight:1.4, fontStyle:"italic" }}>"{p.example}"</p>}
                        </div>
                      ))}
                    </div>
                  )}
                  {t?.topObjections?.length>0&&(
                    <div style={{ padding:"12px 14px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:8 }}>
                      <p style={{ ...mono, margin:"0 0 8px", fontSize:9, color:"#e05555", textTransform:"uppercase", letterSpacing:"0.07em" }}>Top Objections</p>
                      {t.topObjections.slice(0,5).map((o,i)=>(
                        <div key={i} style={{ marginBottom:7 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                            <span style={{ ...mono, fontSize:11, color:C.txt, fontWeight:500 }}>{o.objection}</span>
                            {o.frequency>1&&<span style={{ ...mono, fontSize:9, color:C.dim }}>×{o.frequency}</span>}
                          </div>
                          {o.stage&&<span style={{ ...mono, fontSize:9, color:C.dim }}>{o.stage}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
                  {t?.productSignals?.length>0&&(
                    <div style={{ padding:"12px 14px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:8 }}>
                      <p style={{ ...mono, margin:"0 0 8px", fontSize:9, color:C.gold, textTransform:"uppercase", letterSpacing:"0.07em" }}>Product Signals</p>
                      {t.productSignals.map((p,i)=>(
                        <div key={i} style={{ marginBottom:7 }}>
                          <span style={{ ...mono, fontSize:11, color:C.gold, fontWeight:500 }}>{p.product}</span>
                          <p style={{ ...mono, margin:"1px 0 0", fontSize:10, color:C.dim, lineHeight:1.4 }}>{p.context}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {t?.competitorMentions?.length>0&&(
                    <div style={{ padding:"12px 14px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:8 }}>
                      <p style={{ ...mono, margin:"0 0 8px", fontSize:9, color:C.orange, textTransform:"uppercase", letterSpacing:"0.07em" }}>Competitor Mentions</p>
                      {t.competitorMentions.map((c,i)=>(
                        <div key={i} style={{ marginBottom:7 }}>
                          <span style={{ ...mono, fontSize:11, color:C.orange, fontWeight:500 }}>{c.competitor}</span>
                          <p style={{ ...mono, margin:"1px 0 0", fontSize:10, color:C.dim, lineHeight:1.4 }}>{c.context}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {t?.keyThemes?.length>0&&(
                  <div style={{ padding:"12px 14px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:8, marginBottom:14 }}>
                    <p style={{ ...mono, margin:"0 0 8px", fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.07em" }}>Key Themes</p>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                      {t.keyThemes.map((theme,i)=>(
                        <span key={i} style={{ ...mono, fontSize:11, padding:"3px 10px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:12, color:C.txt }}>{theme}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {!trends&&!trendsError&&(
            <div style={{ padding:"40px 20px", textAlign:"center", border:`1px dashed ${C.brd}`, borderRadius:8 }}>
              <p style={{ ...mono, fontSize:12, color:C.dim, margin:"0 0 8px" }}>Requires Databricks credentials configured in your environment</p>
              <p style={{ ...mono, fontSize:11, color:C.dim, margin:0 }}>Run analysis to see pain point frequency, objections, product signals, and territory health across all your Gong calls</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default IntelligencePage;
