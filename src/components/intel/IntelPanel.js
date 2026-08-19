import React from 'react';
import { C, mono } from '../../constants/colors';
import { UCS_DATA, ALL_PRODUCTS, PROD_COLOR } from '../../constants/products';
import { GONG_RUBRIC, GONG_MAX, MEDPICC_FIELDS } from '../../utils/dealIntel';
import AccountCardCallHistory from '../AccountCardCallHistory';
import AccountCardDealDashboard from '../AccountCardDealDashboard';
import AccountCardDealReview from '../AccountCardDealReview';
import PersonasSection from '../AccountCardPersonas';

export default function IntelPanel({
  acc, business, projects=[], campaigns=[], tasks=[], activeUser, onUpdate,
  setIntelOpen,
  // Sub-tab open state
  callHistoryOpen, setCallHistoryOpen,
  callScoreOpen, setCallScoreOpen,
  askOpen, setAskOpen,
  personasTabOpen, setPersonasTabOpen,
  settingsTabOpen, setSettingsTabOpen,
  medpiccOpen, setMedpiccOpen,
  dealReviewOpen, setDealReviewOpen,
  // Gong
  gongCalls, gongCallsError, gongExpandedId, setGongExpandedId,
  fetchGongCalls, gongEnrich,
  // Call expansion / copy state
  expandedCallIds, setExpandedCallIds, copiedCallId, setCopiedCallId,
  // Score editing
  editingScore, setEditingScore, draftScore, setDraftScore,
  // MEDPICC expand / applied
  expandedMedpicc, setExpandedMedpicc,
  appliedMedpicc, setAppliedMedpicc,
  addedNextSteps, setAddedNextSteps,
  // Deal review
  dealReviewSections, dealReviewLoading, dealReviewError, dealReviewRegenKey,
  generateDealReview, updateDealReviewField,
  // Ask anything
  intelQuery, setIntelQuery, intelAnswer, intelLoading, askIntel,
  // Follow-up reply hook
  generateFollowUpEmail, setPendingActions, setEditedActions, setSelectedActionIdxs, setActionsPushed,
  // Relevant Links
  linksAddOpen, setLinksAddOpen, linkLabelDraft, setLinkLabelDraft, linkUrlDraft, setLinkUrlDraft,
  // Settings tab
  newlyDetectedProds,
}) {
  const gongLabel = gongCalls === 'loading' ? '⟳ Gong' : Array.isArray(gongCalls) ? `⬡ Gong (${gongCalls.length})` : '⬡ Gong';
  const gongActive = Array.isArray(gongCalls) && gongCalls.length > 0;
  const btns = [
    { id:"calls",    lbl:"📞 Calls"+(acc.calls?.length?` (${acc.calls.length})`:""), active:callHistoryOpen, set:setCallHistoryOpen, color:C.gold },
    { id:"score",    lbl:"Call Scores",                                              active:callScoreOpen,   set:setCallScoreOpen,   color:C.green },
    { id:"gong",     lbl:gongLabel,                                                  active:gongActive,      onClick:()=>{ if(!gongCalls||gongCalls==='loading') fetchGongCalls(); }, color:"#00B4D8" },
    { id:"ask",      lbl:"Ask Anything",                                             active:askOpen,         set:setAskOpen,         color:C.blue },
    { id:"personas", lbl:"Personas",                                                 active:personasTabOpen, set:setPersonasTabOpen, color:C.purple },
    { id:"settings", lbl:"Settings",                                                 active:settingsTabOpen, set:setSettingsTabOpen, color:"#555" },
  ];

  return (
    <div style={{ marginBottom:12, background:`${C.green}06`, border:`1px solid ${C.green}22`, borderRadius:7, padding:"12px 14px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
        <span style={{ ...mono, fontSize:11, fontWeight:500, color:C.green, textTransform:"uppercase", letterSpacing:"0.08em" }}>⬟ Account Intelligence — {acc.name}</span>
        <button onClick={()=>setIntelOpen(false)} style={{ marginLeft:"auto", background:"transparent", border:"none", color:C.dim, fontSize:14, cursor:"pointer", padding:0 }}>✕</button>
      </div>
      <AccountCardDealDashboard acc={acc} tasks={tasks} onUpdate={onUpdate} activeUser={activeUser}/>

      <div style={{ display:"flex", gap:6, marginBottom:12, borderBottom:`1px solid ${C.brd}`, paddingBottom:8, flexWrap:"wrap", alignItems:"center" }}>
        <div style={{ display:"flex", borderRadius:4, overflow:"hidden", border:`1px solid ${(medpiccOpen||dealReviewOpen)?C.purple+"88":C.brd}`, flexShrink:0 }}>
          <button onClick={()=>{setMedpiccOpen(o=>!o);if(!medpiccOpen)setDealReviewOpen(false);}} style={{ ...mono, fontSize:11, padding:"3px 10px", background:medpiccOpen?`${C.purple}18`:"transparent", borderRight:`1px solid ${C.brd}`, color:medpiccOpen?C.purple:C.mut, cursor:"pointer", border:"none", fontWeight:medpiccOpen?600:400 }}>MEDPICC</button>
          <button onClick={()=>{setDealReviewOpen(o=>!o);if(!dealReviewOpen){setMedpiccOpen(false);if(!dealReviewSections)generateDealReview();}}} style={{ ...mono, fontSize:11, padding:"3px 10px", background:dealReviewOpen?`${C.purple}18`:"transparent", color:dealReviewOpen?C.purple:C.mut, cursor:"pointer", border:"none", fontWeight:dealReviewOpen?600:400 }}>Deal Review</button>
        </div>
        {btns.map(b => (
          <button key={b.id} onClick={b.onClick || (() => b.set(o => !o))} style={{ ...mono, fontSize:11, padding:"3px 10px", background:b.active?`${b.color}18`:"transparent", border:`1px solid ${b.active?b.color+"88":C.brd}`, color:b.active?b.color:C.mut, borderRadius:4, cursor:"pointer", fontWeight:b.active?600:400, boxShadow:b.active?`0 0 8px ${b.color}33`:undefined, transition:"all 0.15s" }}>{b.lbl}</button>
        ))}
      </div>

      {callHistoryOpen && (
        <AccountCardCallHistory
          acc={acc} expandedCallIds={expandedCallIds} setExpandedCallIds={setExpandedCallIds}
          copiedCallId={copiedCallId} setCopiedCallId={setCopiedCallId}
          onUpdate={onUpdate} activeUser={activeUser}
          onRelaunchFollowUp={call => {
            const committed = call.committedActions || [];
            setPendingActions(committed);
            setEditedActions(committed.map(a => a.suggestedAction || a.action));
            setSelectedActionIdxs(new Set(committed.map((_, i) => i)));
            setActionsPushed(false);
            generateFollowUpEmail(call);
          }}/>
      )}

      {medpiccOpen && (
        <div style={{ marginBottom:12 }}>
          <p style={{ ...mono, margin:"0 0 8px", fontSize:11, fontWeight:500, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em" }}>MEDPICC</p>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {MEDPICC_FIELDS.map(f => {
              const val = (acc.medpicc || {})[f.key] || "";
              const isExp = expandedMedpicc.has(f.key);
              const TRUNC = 90;
              const needsTrunc = val.length > TRUNC;
              const toggleExp = () => setExpandedMedpicc(s => { const n = new Set(s); n.has(f.key) ? n.delete(f.key) : n.add(f.key); return n; });
              return (
                <div key={f.key} style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
                  <span style={{ ...mono, fontSize:11, color:C.purple, fontWeight:600, flexShrink:0, width:120 }}>{f.label}</span>
                  {onUpdate
                    ? <textarea value={val} onChange={e=>{const m={...(acc.medpicc||{}),[f.key]:e.target.value};onUpdate({...acc,medpicc:m});}} placeholder={f.hint} rows={isExp||val.length>60?3:1} onFocus={()=>setExpandedMedpicc(s=>{const n=new Set(s);n.add(f.key);return n;})} onBlur={()=>setExpandedMedpicc(s=>{const n=new Set(s);n.delete(f.key);return n;})} style={{ flex:1, fontSize:12, padding:"3px 8px", background:C.sur, border:`1px solid ${val?C.purple+"44":C.brd}`, borderRadius:4, color:C.txt, outline:"none", fontFamily:"inherit", resize:"none", lineHeight:1.5, transition:"height 0.15s" }}/>
                    : <span onClick={needsTrunc?toggleExp:undefined} style={{ fontSize:12, color:val?C.txt:C.dim, cursor:needsTrunc?"pointer":"default", lineHeight:1.5 }}>{needsTrunc&&!isExp?(val.slice(0,TRUNC)+"…"):val||"—"}{needsTrunc&&<span style={{ ...mono, fontSize:10, color:C.purple, marginLeft:5 }}>{isExp?"▲ less":"▼ more"}</span>}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {dealReviewOpen && (<AccountCardDealReview sections={dealReviewSections} loading={dealReviewLoading} regenKey={dealReviewRegenKey} error={dealReviewError} onRegenerate={generateDealReview} onUpdateField={updateDealReviewField}/>)}

      {callScoreOpen && (
        <div style={{ marginBottom:12 }}>
          <p style={{ ...mono, margin:"0 0 8px", fontSize:11, fontWeight:500, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em" }}>Gong Call Scores</p>
          {(acc.calls||[]).filter(c => c.totalScore != null || (c.gongScore && Object.values(c.gongScore).some(v => v != null))).length === 0 && (<p style={{ ...mono, fontSize:12, color:C.dim }}>No scored calls yet. Log a debrief with a transcript to auto-score, or fill in scores manually.</p>)}
          {[...(acc.calls||[])].filter(c=>c.gongScore).reverse().map(call=>{
            const isEditing = editingScore === call.id;
            const score = isEditing ? draftScore : call.gongScore;
            const total = GONG_RUBRIC.reduce((s,r)=>{const v=score[r.key];return s+(typeof v==="number"?v:0);},0);
            const pct = Math.round((total/GONG_MAX)*100);
            const pctColor = pct>=80?C.green:pct>=60?C.orange:C.red;
            return (
              <div key={call.id} style={{ padding:"10px 12px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:6, marginBottom:8 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                  <span style={{ ...mono, fontSize:11, color:C.dim }}>{call.date}</span>
                  <span style={{ ...mono, fontSize:14, fontWeight:600, color:pctColor }}>{total}/{GONG_MAX}</span>
                  <div style={{ flex:1, height:4, background:C.bg, borderRadius:2 }}><div style={{ width:`${pct}%`, height:"100%", background:pctColor, borderRadius:2, transition:"width 0.3s" }}/></div>
                  {!isEditing
                    ? <button onClick={()=>{setEditingScore(call.id);setDraftScore({...call.gongScore});}} style={{ ...mono, fontSize:11, padding:"2px 7px", background:"transparent", border:`1px solid ${C.brd}`, color:C.mut, borderRadius:3, cursor:"pointer" }}>Edit</button>
                    : <><button onClick={()=>{const updated=(acc.calls||[]).map(c=>c.id===call.id?{...c,gongScore:draftScore,totalScore:GONG_RUBRIC.reduce((s,r)=>{const v=draftScore[r.key];return s+(typeof v==="number"?v:0);},0)}:c);onUpdate&&onUpdate({...acc,calls:updated});setEditingScore(null);}} style={{ ...mono, fontSize:11, padding:"2px 7px", background:`${C.green}14`, border:`1px solid ${C.green}44`, color:C.green, borderRadius:3, cursor:"pointer" }}>Save</button><button onClick={()=>setEditingScore(null)} style={{ ...mono, fontSize:11, padding:"2px 7px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:3, cursor:"pointer" }}>Cancel</button></>
                  }
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"4px 12px" }}>
                  {GONG_RUBRIC.map(r => {
                    const v = score[r.key];
                    const filled = typeof v === "number";
                    return (
                      <div key={r.key} style={{ display:"flex", alignItems:"center", gap:6 }}>
                        <span style={{ ...mono, fontSize:11, color:C.dim, flex:1, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{r.label}</span>
                        {isEditing
                          ? <input type="number" min={0} max={r.max} value={v??""} onChange={e=>{const n=e.target.value===""?null:Math.min(r.max,Math.max(0,parseInt(e.target.value)||0));setDraftScore(s=>({...s,[r.key]:n}));}} style={{ ...mono, width:36, fontSize:11, padding:"1px 4px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:3, color:C.txt, outline:"none", textAlign:"center" }}/>
                          : <span style={{ ...mono, fontSize:11, color:filled?C.txt:C.dim, fontWeight:filled?500:400, minWidth:28, textAlign:"right" }}>{filled?`${v}/${r.max}`:`—/${r.max}`}</span>
                        }
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {editingScore === "new" && (
            <div style={{ padding:"10px 12px", background:C.card, border:`1px solid ${C.purple}44`, borderRadius:6, marginBottom:8 }}>
              <p style={{ ...mono, margin:"0 0 8px", fontSize:11, color:C.purple }}>New manual call score</p>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"6px 12px", marginBottom:8 }}>
                {GONG_RUBRIC.map(r => (
                  <div key={r.key} style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <span style={{ ...mono, fontSize:11, color:C.dim, flex:1 }}>{r.label} (/{r.max})</span>
                    <input type="number" min={0} max={r.max} value={draftScore[r.key] ?? ""} onChange={e=>{const n=e.target.value===""?null:Math.min(r.max,Math.max(0,parseInt(e.target.value)||0));setDraftScore(s=>({...s,[r.key]:n}));}} style={{ ...mono, width:36, fontSize:11, padding:"1px 4px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:3, color:C.txt, outline:"none", textAlign:"center" }}/>
                  </div>
                ))}
              </div>
              <div style={{ display:"flex", gap:6 }}>
                <button onClick={()=>{const gs=draftScore;const total=GONG_RUBRIC.reduce((s,r)=>{const v=gs[r.key];return s+(typeof v==="number"?v:0);},0);const newCall={id:Date.now(),date:new Date().toISOString().split("T")[0],summary:"Manual call score",callQuality:"Neutral",gongScore:gs,totalScore:total,painPoints:[],nextSteps:[],productsDiscussed:[]};onUpdate&&onUpdate({...acc,calls:[...(acc.calls||[]),newCall]});setEditingScore(null);setDraftScore({});}} style={{ fontSize:12, padding:"5px 12px", background:`${C.green}14`, border:`1px solid ${C.green}44`, color:C.green, borderRadius:5, cursor:"pointer" }}>Save Score</button>
                <button onClick={()=>{setEditingScore(null);setDraftScore({});}} style={{ fontSize:12, padding:"5px 10px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:5, cursor:"pointer" }}>Cancel</button>
              </div>
            </div>
          )}
          {editingScore !== "new" && <button onClick={()=>{setEditingScore("new");setDraftScore({});}} style={{ ...mono, fontSize:11, padding:"4px 12px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:4, cursor:"pointer" }}>+ Add manual score</button>}
        </div>
      )}

      {(Array.isArray(gongCalls) || gongCalls === 'loading' || gongCallsError) && (
        <div style={{ marginBottom:12, background:"#060e18", border:"1px solid #00B4D844", borderRadius:8, padding:"12px 14px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
            <span style={{ ...mono, fontSize:11, fontWeight:600, color:"#00B4D8" }}>⬡ Gong Briefings</span>
            {gongCalls === 'loading' && <span style={{ ...mono, fontSize:11, color:C.dim }}>loading…</span>}
            {Array.isArray(gongCalls) && <span style={{ ...mono, fontSize:10, color:C.dim }}>{gongCalls.length} calls</span>}
            <button onClick={fetchGongCalls} disabled={gongCalls==='loading'} style={{ ...mono, fontSize:10, padding:"2px 7px", background:"transparent", border:"1px solid #00B4D844", color:"#00B4D888", borderRadius:3, cursor:"pointer" }}>↻</button>
          </div>
          {gongCallsError && <p style={{ ...mono, fontSize:12, color:C.red, margin:0 }}>✕ {gongCallsError}</p>}
          {gongCalls === 'loading' && <div style={{ height:60, display:"flex", alignItems:"center", justifyContent:"center" }}><span style={{ ...mono, fontSize:12, color:"#00B4D888" }}>⬡ Querying Databricks…</span></div>}
          {Array.isArray(gongCalls) && gongCalls.length === 0 && <p style={{ ...mono, fontSize:12, color:C.dim, margin:0 }}>No Gong briefings found for this account.</p>}
          {Array.isArray(gongCalls) && gongCalls.length > 0 && (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {gongCalls.map(call => {
                const isOpen = gongExpandedId === call.id;
                const mins = call.durationSeconds ? Math.round(call.durationSeconds/60) : null;
                return (
                  <div key={call.id} style={{ background:C.sur, border:`1px solid ${C.brd}`, borderRadius:6, overflow:"hidden" }}>
                    <button onClick={()=>setGongExpandedId(isOpen?null:call.id)} style={{ width:"100%", display:"flex", alignItems:"center", gap:8, padding:"8px 10px", background:"transparent", border:"none", cursor:"pointer", textAlign:"left" }}>
                      <span style={{ ...mono, fontSize:10, color:"#00B4D8", flexShrink:0 }}>⬡</span>
                      <span style={{ ...mono, fontSize:12, color:C.txt, flex:1, fontWeight:500 }}>{call.subject || "Gong call"}</span>
                      {mins && <span style={{ ...mono, fontSize:10, color:C.dim, flexShrink:0 }}>{mins}m</span>}
                      <span style={{ ...mono, fontSize:10, color:C.dim, flexShrink:0 }}>{call.date}</span>
                      <span style={{ ...mono, fontSize:10, color:C.dim }}>{isOpen ? "▲" : "▼"}</span>
                    </button>
                    {isOpen && (
                      <div style={{ padding:"0 10px 10px", borderTop:`1px solid ${C.brd}` }}>
                        {call.summary && <p style={{ margin:"8px 0 0", fontSize:12, color:C.txt, lineHeight:1.65 }}>{call.summary}</p>}
                        {call.keyPoints?.length > 0 && (<div style={{ marginTop:8 }}><p style={{ ...mono, margin:"0 0 4px", fontSize:10, color:"#00B4D8", textTransform:"uppercase", letterSpacing:"0.07em" }}>Key Points</p>{call.keyPoints.map((pt,i)=><p key={i} style={{ ...mono, margin:"2px 0", fontSize:11, color:C.mut, lineHeight:1.5 }}>· {pt}</p>)}</div>)}
                        {call.nextSteps?.length > 0 && (<div style={{ marginTop:8 }}><p style={{ ...mono, margin:"0 0 4px", fontSize:10, color:C.gold, textTransform:"uppercase", letterSpacing:"0.07em" }}>Next Steps</p>{call.nextSteps.map((ns,i)=><p key={i} style={{ ...mono, margin:"2px 0", fontSize:11, color:C.mut, lineHeight:1.5 }}>→ {ns}</p>)}</div>)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {gongEnrich === 'loading' && (<div style={{ marginTop:10, padding:"8px 10px", background:"#0a1520", border:"1px solid #00B4D822", borderRadius:6 }}><span style={{ ...mono, fontSize:11, color:"#00B4D888" }}>⬡ Analyzing calls for MEDPICC signals…</span></div>)}
          {gongEnrich && gongEnrich !== 'loading' && (() => {
            const { medpiccSuggestions={}, unclosedNextSteps=[], signals=[], deduped=0 } = gongEnrich;
            const MLABELS = { metrics:'Metrics', economic_buyer:'Economic Buyer', decision_criteria:'Decision Criteria', decision_process:'Decision Process', identify_pain:'Identify Pain', champion:'Champion', competition:'Competition' };
            const hasSugg = Object.keys(medpiccSuggestions).length > 0;
            const hasNS = unclosedNextSteps.length > 0;
            const hasSig = signals.length > 0;
            if (!hasSugg && !hasNS && !hasSig) return null;
            return (
              <div style={{ marginTop:10, background:"#080f1a", border:"1px solid #00B4D833", borderRadius:6, padding:"10px 12px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:8 }}>
                  <span style={{ ...mono, fontSize:10, fontWeight:600, color:"#00B4D8", textTransform:"uppercase", letterSpacing:"0.07em" }}>⬡ AI Enrichment</span>
                  {deduped > 0 && <span style={{ ...mono, fontSize:9, color:C.dim }}>{deduped} matched manual debriefs</span>}
                </div>
                {hasSugg && (<div style={{ marginBottom:hasNS||hasSig?10:0 }}><p style={{ ...mono, margin:"0 0 5px", fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em" }}>MEDPICC Signals</p>{Object.entries(medpiccSuggestions).map(([field,val])=>{const applied=appliedMedpicc.has(field);return(<div key={field} style={{ display:"flex", gap:6, alignItems:"flex-start", marginBottom:5, padding:"5px 8px", background:applied?"#0a1a0a":"#0d1420", border:`1px solid ${applied?C.green+"33":"#00B4D822"}`, borderRadius:4 }}><div style={{ flex:1 }}><span style={{ ...mono, fontSize:9, color:"#00B4D8", textTransform:"uppercase", letterSpacing:"0.05em" }}>{MLABELS[field]||field}</span><p style={{ ...mono, margin:"2px 0 0", fontSize:11, color:applied?C.dim:C.txt, lineHeight:1.55 }}>{val}</p></div>{onUpdate&&!applied&&(<button onClick={()=>{onUpdate({...acc,medpicc:{...(acc.medpicc||{}),[field]:val}});setAppliedMedpicc(s=>new Set([...s,field]));}} style={{ ...mono, flexShrink:0, fontSize:9, padding:"2px 7px", marginTop:1, background:`${C.green}14`, border:`1px solid ${C.green}33`, color:C.green, borderRadius:3, cursor:"pointer" }}>Apply</button>)}{applied&&<span style={{ ...mono, flexShrink:0, fontSize:9, color:C.green, marginTop:3 }}>✓</span>}</div>);})}</div>)}
                {hasNS && (<div style={{ marginBottom:hasSig?10:0 }}><p style={{ ...mono, margin:"0 0 5px", fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em" }}>Unclosed Next Steps</p>{unclosedNextSteps.map((ns,i)=>{const added=addedNextSteps.has(ns);return(<div key={i} style={{ display:"flex", gap:6, alignItems:"flex-start", marginBottom:4, padding:"5px 8px", background:added?"#0a1a0a":"#141008", border:`1px solid ${added?C.green+"33":C.gold+"22"}`, borderRadius:4 }}><p style={{ ...mono, flex:1, margin:0, fontSize:11, color:added?C.dim:C.mut, lineHeight:1.5 }}>→ {ns}</p>{onUpdate&&!added&&(<button onClick={()=>{const step={id:`gong_${Date.now()}_${i}`,text:ns,done:false,source:'gong',createdAt:new Date().toISOString()};onUpdate({...acc,nextSteps:[...(acc.nextSteps||[]),step]});setAddedNextSteps(s=>new Set([...s,ns]));}} style={{ ...mono, flexShrink:0, fontSize:9, padding:"2px 7px", marginTop:1, background:`${C.gold}14`, border:`1px solid ${C.gold}33`, color:C.gold, borderRadius:3, cursor:"pointer" }}>Add</button>)}{added&&<span style={{ ...mono, flexShrink:0, fontSize:9, color:C.green, marginTop:3 }}>✓</span>}</div>);})}</div>)}
                {hasSig && (<div><p style={{ ...mono, margin:"0 0 5px", fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em" }}>Deal Signals</p>{signals.map((sig,i)=><p key={i} style={{ ...mono, margin:"2px 0", fontSize:11, color:C.mut, lineHeight:1.5 }}>· {sig}</p>)}</div>)}
              </div>
            );
          })()}
        </div>
      )}

      {askOpen && (
        <div style={{ borderTop:`1px solid ${C.brd}`, paddingTop:10, marginTop:4 }}>
          <div style={{ display:"flex", gap:6 }}>
            <input value={intelQuery} onChange={e=>setIntelQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&askIntel()} placeholder="e.g. What was the last pain point discussed? What's blocking this deal?" style={{ flex:1, fontSize:12, padding:"6px 10px", background:C.sur, border:`1px solid ${intelQuery?C.green+"55":C.brd}`, borderRadius:5, color:C.txt, outline:"none", fontFamily:"inherit" }}/>
            <button onClick={askIntel} disabled={intelLoading||!intelQuery.trim()} style={{ fontSize:12, padding:"6px 12px", background:intelQuery.trim()&&!intelLoading?`${C.green}14`:"transparent", border:`1px solid ${intelQuery.trim()&&!intelLoading?C.green+"44":C.brd}`, color:intelQuery.trim()&&!intelLoading?C.green:C.dim, borderRadius:5, cursor:intelQuery.trim()&&!intelLoading?"pointer":"not-allowed" }}>{intelLoading?"…":"Ask →"}</button>
          </div>
          {intelAnswer && <div style={{ marginTop:8, padding:"8px 10px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:5, fontSize:13, color:C.txt, lineHeight:1.7 }}>{intelAnswer}</div>}
        </div>
      )}

      {personasTabOpen && onUpdate && (<div style={{ marginTop:8 }}><PersonasSection acc={acc} business={business} projects={projects} campaigns={campaigns} onUpdate={onUpdate}/></div>)}

      {onUpdate && (
        <div style={{ borderTop:`1px solid ${C.brd}`, paddingTop:10, marginTop:4 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
            <span style={{ ...mono, fontSize:10, fontWeight:600, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>Relevant Links</span>
            {!linksAddOpen && <button onClick={()=>{setLinksAddOpen(true);setLinkLabelDraft('');setLinkUrlDraft('');}} style={{ ...mono, fontSize:10, padding:"1px 7px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:3, cursor:"pointer" }}>+ Add</button>}
          </div>
          {linksAddOpen && (
            <div style={{ display:"flex", gap:6, alignItems:"center", marginBottom:8, flexWrap:"wrap" }}>
              <input autoFocus value={linkLabelDraft} onChange={e=>setLinkLabelDraft(e.target.value)} placeholder="Label (e.g. Partner Request)" style={{ ...mono, fontSize:11, padding:"3px 8px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:4, color:C.txt, outline:"none", width:160 }}/>
              <input value={linkUrlDraft} onChange={e=>setLinkUrlDraft(e.target.value)} placeholder="URL" onKeyDown={e=>{if(e.key==="Enter"&&linkLabelDraft.trim()&&linkUrlDraft.trim()){const links=[...(acc.relevantLinks||[]),{label:linkLabelDraft.trim(),url:linkUrlDraft.trim()}];onUpdate({...acc,relevantLinks:links});setLinksAddOpen(false);}if(e.key==="Escape")setLinksAddOpen(false);}} style={{ ...mono, fontSize:11, padding:"3px 8px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:4, color:C.txt, outline:"none", width:220 }}/>
              <button onClick={()=>{if(linkLabelDraft.trim()&&linkUrlDraft.trim()){const links=[...(acc.relevantLinks||[]),{label:linkLabelDraft.trim(),url:linkUrlDraft.trim()}];onUpdate({...acc,relevantLinks:links});setLinksAddOpen(false);}}} style={{ ...mono, fontSize:10, padding:"3px 10px", background:`${C.green}14`, border:`1px solid ${C.green}44`, color:C.green, borderRadius:4, cursor:"pointer" }}>Add</button>
              <button onClick={()=>setLinksAddOpen(false)} style={{ ...mono, fontSize:10, padding:"3px 8px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:4, cursor:"pointer" }}>Cancel</button>
            </div>
          )}
          {(acc.relevantLinks || []).length > 0 && (<div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>{(acc.relevantLinks||[]).map((lnk,i)=>(<span key={i} style={{ display:"inline-flex", alignItems:"center", gap:4 }}><a href={lnk.url.startsWith("http")?lnk.url:`https://${lnk.url}`} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} style={{ ...mono, fontSize:10, height:24, display:"inline-flex", alignItems:"center", padding:"0 8px", background:"transparent", border:`0.5px solid ${C.brd}`, color:C.blue, borderRadius:4, textDecoration:"none", whiteSpace:"nowrap" }}>↗ {lnk.label}</a><button onClick={e=>{e.stopPropagation();const links=(acc.relevantLinks||[]).filter((_,j)=>j!==i);onUpdate({...acc,relevantLinks:links});}} style={{ ...mono, fontSize:9, padding:"0 4px", height:24, background:"transparent", border:"none", color:C.dim, cursor:"pointer", lineHeight:1 }} title="Remove">✕</button></span>))}</div>)}
          {(acc.relevantLinks || []).length === 0 && !linksAddOpen && <span style={{ ...mono, fontSize:11, color:C.dim }}>No links added yet.</span>}
        </div>
      )}

      {settingsTabOpen && onUpdate && (
        <div style={{ marginTop:8 }}>
          <p style={{ ...mono, margin:"0 0 8px", fontSize:11, fontWeight:500, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em" }}>Use Cases</p>
          <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:12 }}>
            {UCS_DATA.map(uc => { const on = (acc.ucs||[]).includes(uc.id); return <button key={uc.id} onClick={e=>{e.stopPropagation();const ucs=on?(acc.ucs||[]).filter(u=>u!==uc.id):[...(acc.ucs||[]),uc.id];onUpdate({...acc,ucs});}} style={{ fontSize:11, padding:"2px 8px", borderRadius:4, border:`0.5px solid ${on?uc.b:"#2a2a2a"}`, background:on?uc.bg:"transparent", color:on?uc.c:C.dim, cursor:"pointer" }}>{uc.lb}</button>; })}
          </div>
          <p style={{ ...mono, margin:"0 0 8px", fontSize:11, fontWeight:500, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em" }}>Products</p>
          <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
            {ALL_PRODUCTS.map(p => { const on = (acc.prods||[]).includes(p); const pc = PROD_COLOR[p]||C.mut; const isNew = newlyDetectedProds.has(p); return <button key={p} onClick={e=>{e.stopPropagation();const prods=on?(acc.prods||[]).filter(x=>x!==p):[...new Set([...(acc.prods||[]),p])];onUpdate({...acc,prods});}} style={{ ...mono, fontSize:10, padding:"2px 7px", borderRadius:4, border:`0.5px solid ${on?pc:"#2a2a2a"}`, background:on?C.card:"transparent", color:on?pc:C.dim, cursor:"pointer", position:"relative" }}>{p}{isNew&&<span style={{ marginLeft:4, fontSize:9, color:"#f59e0b", fontWeight:700 }}>✦ new</span>}</button>; })}
          </div>
        </div>
      )}
    </div>
  );
}
