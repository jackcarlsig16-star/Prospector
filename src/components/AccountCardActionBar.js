import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import AccountCardExtract from './AccountCardExtract';
import { C, mono } from '../constants/colors';
import { T } from '../constants/tokens';
import { UCS_DATA } from '../constants/products';
import { getActiveVoice, getVoiceProfile } from '../constants/voice';
import { getActiveIntel } from '../utils/assay';
import { MEDPICC_FIELDS, GONG_RUBRIC, BEHAVIOR_RUBRIC, clientDebrief, clientDealReview, quickUpdateExtract } from '../utils/dealIntel';
import CallPrepModal from './CallPrepModal';
import CallPrepButton from './CallPrepButton';
import { extractIntelligenceFromCall } from '../utils/intelligenceEngine';
import { runPathToCloseUpdate } from '../utils/pathToClose';
import { fetchSentEmailsForAccount, buildNsPrompt } from '../utils/nsCopy';
import { getValidGmailToken } from '../utils/getValidGmailToken';
import AccountCardExpandedPanels from './AccountCardExpandedPanels';
import AccountCardComms from './AccountCardComms';
import DealTimeline from './DealTimeline';
import FollowUpEmailModal from './FollowUpEmailModal';
import EmailModal from './EmailModal';
import NextStepsPanel from './intel/NextStepsPanel';
import IntelPanel from './intel/IntelPanel';
import DebriefPanel from './debrief/DebriefPanel';
import { BDR_LIST, URGENCY_OPTIONS, AssignModal } from '../utils/assignHelper';
import { getCachedTopContact, getCachedAlternateContacts } from '../utils/hunter';
import { MODELS } from '../config/models';

const SF_BASE_AC = "https://your-org.lightning.force.com/lightning/r/Account/";
const toSfdcUrl = v => {
  if (!v || !v.trim()) return null;
  if (v.startsWith("http")) return v.trim();
  if (/^001[A-Za-z0-9]{12,15}$/.test(v.trim())) return `${SF_BASE_AC}${v.trim()}/view`;
  return null;
};
const hasPricingFor = id => { try { return !!JSON.parse(localStorage.getItem("prospector_pricing_files")||"{}")[id]; } catch { return false; } };
const hasRoiFor    = id => { try { return !!JSON.parse(localStorage.getItem("prospector_roi_files")||"{}")[id]; } catch { return false; } };

const isTranscript = (text) => {
  if (!text || text.length < 200) return false;
  const speakerPattern = /^[\w\s]+:\s/m.test(text);
  const timestampPattern = /\d{1,2}:\d{2}/g;
  const timestampCount = (text.match(timestampPattern) || []).length;
  const lineCount = text.split('\n').length;
  const shortLineRatio = text.split('\n').filter(l => l.length < 100).length / lineCount;
  return speakerPattern || timestampCount > 3 || (shortLineRatio > 0.6 && lineCount > 20);
};

// HUD button group accents
const GROUP_C = {
  call:  T.amber,
  intel: T.neon,
  deal:  T.cyan,
};
const groupBtn = (active, color) => ({
  ...mono,
  fontSize: 11,
  height: 26,
  padding: "0 11px",
  background: active ? `${color}14` : "transparent",
  border: `1px solid ${active ? color : "#333"}`,
  color: active ? color : `${color}88`,
  borderRadius: 4,
  cursor: "pointer",
  letterSpacing: "0.04em",
  textShadow: active ? `0 0 6px ${color}55` : "none",
  transition: "all 0.12s",
});
const groupSep = () => (
  <span style={{ width: 1, height: 14, background: "#333", flexShrink: 0, alignSelf: "center", margin: "0 4px" }} />
);

// Shared primitive (account-card-unification-and-outreach-v1) — used by both
// the business ActionBar below and directly by the unified AccountCard.js for
// influencer accounts, which never render the rest of this file. Context is
// branched on account_kind; the LLM call and MODELS.FAST usage are untouched.
export function QuickAskBar({ acc }) {
  const [quickQuery,setQuickQuery]=useState("");
  const [quickAnswer,setQuickAnswer]=useState(null);
  const [quickLoading,setQuickLoading]=useState(false);
  const [quickFocus,setQuickFocus]=useState(false);
  const [quickGhostIdx,setQuickGhostIdx]=useState(0);
  const [quickCopied,setQuickCopied]=useState(false);
  const isInfluencer = acc.accountKind === 'influencer';
  const QUICK_GHOSTS = React.useMemo(() => isInfluencer ? [
    `Ask anything about ${acc.name}…`,
    `Draft an outreach angle…`,
    `What's their fit rationale?`,
    `Summarize their niche…`,
  ] : [
    `Ask anything about ${acc.name}…`,
    `Draft a follow-up email…`,
    `What's blocking this deal?`,
    `Summarize last call…`,
  ], [acc.name, isInfluencer]);
  useEffect(() => {
    if (quickFocus || quickQuery) return;
    const t = setInterval(() => setQuickGhostIdx(i => (i + 1) % QUICK_GHOSTS.length), 4000);
    return () => clearInterval(t);
  }, [quickFocus, quickQuery, QUICK_GHOSTS.length]);

  const askQuick=async()=>{
    if(!quickQuery.trim())return;
    setQuickLoading(true);setQuickAnswer(null);
    let contextBlock;
    if (isInfluencer) {
      const d = acc.influencerDetail || {};
      contextBlock = `Creator: ${acc.name} | Relationship stage: ${d.relationship_stage||"not_contacted"} | Fit score: ${d.fit_score ?? "?"}\nBio: ${d.bio_snapshot||"unknown"}\nNiche: ${d.niche_assessment?.category||"unknown"} | Content type: ${d.niche_assessment?.content_type||"unknown"}\nFit rationale: ${d.fit_rationale||"none"}\nFit signals: ${(d.fit_signals||[]).map(s=>`${s.axis}: ${s.note}`).join("; ")||"none"}`;
    } else {
      const callSummaries=(acc.calls||[]).slice(-3).map((c,i)=>`Call ${i+1} (${c.date}): ${c.summary}`).join("\n");
      contextBlock = `Account: ${acc.name} | Stage: ${acc.stage||"Prospecting"} | Tier: ${acc.tier||"?"} | Vertical: ${acc.vert||"?"}\nBusiness model: ${acc.bm||"unknown"} | product fit: ${acc.pf||"unknown"}\nProducts: ${(acc.prods||[]).join(", ")||"none"} | Use cases: ${(acc.ucs||[]).join(", ")||"none"}\nCall history:\n${callSummaries||"None"}`;
    }
    try{
      const r=await fetch("/proxy/anthropic/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:MODELS.FAST,max_tokens:400,messages:[{role:"user",content:`${contextBlock}\n\nQ: ${quickQuery}\n\nAnswer in 2-3 sentences max, specific to this account.`}]})});
      const d=await r.json();setQuickAnswer(d.content?.[0]?.text||"No answer.");
    }catch(e){setQuickAnswer("Error: "+e.message);}
    setQuickLoading(false);
  };

  return (
    <>
      <style>{`@keyframes prospectorBlink{50%{opacity:0}} @keyframes prospectorPulse{0%,100%{opacity:.35}50%{opacity:1}}`}</style>
      <div style={{ padding:'12px 16px', borderBottom:`1px solid #1a3a1a`, background:'#050f05', margin:'-12px -14px 12px' }}>
        <div style={{ display:'flex', gap:6, alignItems:'center', position:'relative' }}>
          <span style={{ ...mono, fontSize:12, color:T.neon, flexShrink:0, opacity:0.7 }}>▸</span>
          <div style={{ flex:1, position:'relative' }}>
            <input
              value={quickQuery}
              onChange={e=>setQuickQuery(e.target.value)}
              onFocus={()=>setQuickFocus(true)}
              onBlur={()=>setQuickFocus(false)}
              onKeyDown={e=>e.key==='Enter'&&askQuick()}
              placeholder=""
              style={{ ...mono, width:'100%', boxSizing:'border-box', fontSize:12, padding:'6px 10px', background:T.bg.base, border:`1px solid ${quickFocus?T.neon:`${T.neon}33`}`, borderRadius:4, color:'#cfe8d4', outline:'none', transition:'border-color 0.15s', caretColor:T.neon }}
            />
            {!quickQuery && !quickFocus && (
              <span style={{ ...mono, position:'absolute', left:11, top:'50%', transform:'translateY(-50%)', fontSize:12, color:`${T.neon}66`, pointerEvents:'none', whiteSpace:'nowrap' }}>
                {QUICK_GHOSTS[quickGhostIdx]}
                <span style={{ marginLeft:2, color:T.neon, animation:'prospectorBlink 1s steps(2) infinite' }}>▊</span>
              </span>
            )}
          </div>
          <button onClick={askQuick} disabled={!quickQuery.trim()||quickLoading}
            style={{ ...mono, fontSize:11, height:28, padding:'0 14px', background:quickQuery.trim()?`${T.neon}14`:'transparent', border:`1px solid ${quickQuery.trim()?T.neon:'#1a3a1a'}`, color:quickQuery.trim()?T.neon:'#5a6a5a', borderRadius:4, cursor:quickQuery.trim()&&!quickLoading?'pointer':'default', letterSpacing:'0.08em', textShadow:quickQuery.trim()?`0 0 6px ${T.neon}55`:'none', flexShrink:0 }}>
            {quickLoading?'⬡':'ASK →'}
          </button>
          {quickAnswer&&<button onClick={()=>{setQuickAnswer(null);setQuickQuery('');setQuickCopied(false);}} style={{ background:'transparent', border:'none', color:'#5a6a5a', fontSize:14, cursor:'pointer', padding:'0 2px' }}>✕</button>}
        </div>
        {quickLoading && !quickAnswer && (
          <div style={{ ...mono, marginTop:8, padding:'8px 12px', background:T.bg.surface, border:`1px solid ${T.neon}33`, borderRadius:4, color:T.neon, fontSize:14, letterSpacing:'0.4em' }}>
            <span style={{ animation:'prospectorPulse 1.2s ease-in-out infinite' }}>·</span>
            <span style={{ animation:'prospectorPulse 1.2s ease-in-out infinite', animationDelay:'.2s' }}> ·</span>
            <span style={{ animation:'prospectorPulse 1.2s ease-in-out infinite', animationDelay:'.4s' }}> ·</span>
          </div>
        )}
        {quickAnswer && (
          <div style={{ marginTop:8, padding:'10px 12px', background:T.bg.surface, border:`1px solid ${T.neon}44`, borderRadius:4, position:'relative' }}>
            <p style={{ ...mono, margin:0, fontSize:11, color:'#cfe8d4', lineHeight:1.7, whiteSpace:'pre-wrap', paddingRight:60 }}>{quickAnswer}</p>
            <button
              onClick={()=>{navigator.clipboard.writeText(quickAnswer);setQuickCopied(true);setTimeout(()=>setQuickCopied(false),1500);}}
              style={{ ...mono, position:'absolute', top:6, right:6, fontSize:10, padding:'2px 8px', background:quickCopied?`${T.neon}18`:'transparent', border:`1px solid ${quickCopied?`${T.neon}66`:`${T.neon}33`}`, color:quickCopied?T.neon:'#5a6a5a', borderRadius:3, cursor:'pointer' }}>
              {quickCopied?'✓':'⎘ COPY'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

const AccountCardActionBar = forwardRef(function AccountCardActionBar({
  acc, onUpdate, tasks=[], activeUser={}, isFav, onToggleFav,
  assignedEntry, onAssign, onUnassign,
  onOpenPricing, onOpenRoi, onOpenDealSummary,
  onCreateTask, onUpdateTask,
  onReassay, reassaying,
  setIntelFlash, openGiftModal,
}, ref) {

  // ── panel open state ────────────────────────────────────────────────────────
  const [emailOpen,setEmailOpen]=useState(false);
  const [emailBody,setEmailBody]=useState("");
  const [emailLoading,setEmailLoading]=useState(false);
  const [emailCopied,setEmailCopied]=useState(false);
  const [assignModalOpen,setAssignModalOpen]=useState(false);
  const [assignModalBdrId,setAssignModalBdrId]=useState(null);
  const [assignModalNote,setAssignModalNote]=useState('');
  const [outboundPickerOpen,setOutboundPickerOpen]=useState(false);
  const [assignConfirmed,setAssignConfirmed]=useState(null);
  const [sfdcEdit,setSfdcEdit]=useState(false);
  const [sfdcInput,setSfdcInput]=useState("");
  const [clientIdsEdit,setClientIdsEdit]=useState(false);
  const [clientIdsInput,setClientIdsInput]=useState("");
  const [gleanOpen,setGleanOpen]=useState(false);
  const [gleanLoading,setGleanLoading]=useState(false);
  const [gleanResults,setGleanResults]=useState(null);
  const [gleanError,setGleanError]=useState(null);
  const [callPrepOpen,setCallPrepOpen]=useState(false);
  // One-time migration: legacy prospector_meeting_prep_<id> localStorage key
  // → acc.meetingPrepData. CallPrepModal reads acc.meetingPrepData directly.
  useEffect(()=>{
    if (acc.meetingPrepData) return;
    try {
      const s = localStorage.getItem(`prospector_meeting_prep_${acc.id}`);
      if (!s) return;
      const p = JSON.parse(s);
      if (p.nextStep !== undefined && p.leaveWith === undefined) { p.leaveWith = p.nextStep; delete p.nextStep; }
      onUpdate && onUpdate({ ...acc, meetingPrepData: p });
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acc.id]);
  const [debriefOpen,setDebriefOpen]=useState(false);
  const [debriefMode,setDebriefMode]=useState(null); // null | 'call' | 'quick'
  const [debriefText,setDebriefText]=useState("");
  const [debriefLoading,setDebriefLoading]=useState(false);
  const [debriefError,setDebriefError]=useState(null);
  const [quickUpdateText,setQuickUpdateText]=useState("");
  const [quickUpdateLoading,setQuickUpdateLoading]=useState(false);
  const [quickUpdateResult,setQuickUpdateResult]=useState(null);
  const [quickUpdateError,setQuickUpdateError]=useState(null);
  const [quickUpdateFollowUp,setQuickUpdateFollowUp]=useState(false);
  const [callScoreOpen,setCallScoreOpen]=useState(false);
  const [callHistoryOpen,setCallHistoryOpen]=useState(false);
  const [medpiccOpen,setMedpiccOpen]=useState(false);
  const [dealReviewOpen,setDealReviewOpen]=useState(false);
  const [dealReviewSections,setDealReviewSections]=useState(()=>{
    try{const s=localStorage.getItem(`prospector_deal_review_${acc.id}`);if(s)return JSON.parse(s);}catch{}
    return acc.dealReviewData||null;
  });
  const [dealReviewLoading,setDealReviewLoading]=useState(false);
  const [dealReviewError,setDealReviewError]=useState(null);
  const [dealReviewRegenKey,setDealReviewRegenKey]=useState(null);
  const [askOpen,setAskOpen]=useState(false);
  const [expandedMedpicc,setExpandedMedpicc]=useState(new Set());
  const [timelineOpen,setTimelineOpen]=useState(false);
  const [intelOpen,setIntelOpen]=useState(false);
  const [intelQuery,setIntelQuery]=useState("");
  const [intelAnswer,setIntelAnswer]=useState(null);
  const [intelLoading,setIntelLoading]=useState(false);
  const [editingScore,setEditingScore]=useState(null);
  const [draftScore,setDraftScore]=useState({});
  const [gongSearch,setGongSearch]=useState(null);
  const [gongDropOpen,setGongDropOpen]=useState(false);
  const [gongCalls,setGongCalls]=useState(null);
  const [gongCallsError,setGongCallsError]=useState(null);
  const [gongExpandedId,setGongExpandedId]=useState(null);
  const [gongEnrich,setGongEnrich]=useState(null);
  const [appliedMedpicc,setAppliedMedpicc]=useState(new Set());
  const [addedNextSteps,setAddedNextSteps]=useState(new Set());
  const [followUpEmail,setFollowUpEmail]=useState(null);
  const [followUpDraftUrl,setFollowUpDraftUrl]=useState(null); // Gmail draft deep-link when API succeeds
  const [followUpCopied,setFollowUpCopied]=useState(false);
  const [followUpSkipped,setFollowUpSkipped]=useState(false);
  const [pendingActions,setPendingActions]=useState([]);
  const [editedActions,setEditedActions]=useState([]);
  const [selectedActionIdxs,setSelectedActionIdxs]=useState(new Set());
  const [actionsPushed,setActionsPushed]=useState(false);
  const [copiedCallId,setCopiedCallId]=useState(null);
  const [linksEdit,setLinksEdit]=useState(false);
  const [linksAddOpen,setLinksAddOpen]=useState(false);
  const [linkLabelDraft,setLinkLabelDraft]=useState('');
  const [linkUrlDraft,setLinkUrlDraft]=useState('');
  const [linksDraft,setLinksDraft]=useState({web:'',sfdc:'',linkedin:''});
  const [sfdcLoading,setSfdcLoading]=useState(false);
  const [sfdcCopied,setSfdcCopied]=useState(false);
  const [sfdcText,setSfdcText]=useState('');
  const [expandedCallIds,setExpandedCallIds]=useState(()=>new Set());
  const [nsInput,setNsInput]=useState('');
  const [nsOwner,setNsOwner]=useState('ae');
  const [overridesOpen,setOverridesOpen]=useState(false);
  const [personasTabOpen,setPersonasTabOpen]=useState(false);
  const [settingsTabOpen,setSettingsTabOpen]=useState(false);
  const [commsOpen,setCommsOpen]=useState(false);
  const [extractOpen,setExtractOpen]=useState(false);
  const [outreachOpen,setOutreachOpen]=useState(false);
  const [newlyDetectedProds,setNewlyDetectedProds]=useState(new Set());

  useImperativeHandle(ref, () => ({
    openPanel(panel, tab) {
      if (panel === 'intel') {
        setIntelOpen(true);
        if (tab === 'settings') setSettingsTabOpen(true);
      }
    }
  }));

  // Defensive: force-show the mode picker on every fresh open of the Debrief panel.
  // Guards against any state path that flips debriefOpen=true while debriefMode is stale.
  const prevDebriefOpenRef = useRef(false);
  useEffect(() => {
    if (debriefOpen && !prevDebriefOpenRef.current) {
      setDebriefMode(null);
      setQuickUpdateResult(null);
      setQuickUpdateError(null);
    }
    prevDebriefOpenRef.current = debriefOpen;
  }, [debriefOpen]);

  const topPersona = (acc.personas||[])[0]||null;
  const webUrl = acc.web ? (acc.web.startsWith("http") ? acc.web : `https://${acc.web}`) : null;
  const liUrl = acc.linkedin || `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(acc.name)}`;

  // ── functions ────────────────────────────────────────────────────────────────
  const generateEmail=async()=>{
    setEmailLoading(true);setEmailBody("");
    const user=JSON.parse(localStorage.getItem("prospector_user")||"{}");
    try{
      const res=await fetch("/api/email",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        name:acc.name,businessModel:acc.bm||"",productFit:acc.pf||"",
        useCase:acc.ucs?.[0]?UCS_DATA.find(u=>u.id===acc.ucs[0])?.lb||acc.ucs[0]:"",
        products:acc.prods||[],personaName:topPersona?.name||"",personaTitle:topPersona?.title||"",
        customIntel:getActiveIntel(),senderName:user.name||"AE",voiceExamples:getActiveVoice(user.name),voiceProfile:getVoiceProfile(user.name),
      })});
      const d=await res.json();
      setEmailBody(d.email||d.error||"Failed to generate.");
    }catch(e){setEmailBody("Error: "+e.message);}
    setEmailLoading(false);
  };

  const openEmail=()=>{
    const contact=acc.personas?.[0]?.email||"";
    const subject=encodeURIComponent(`${acc.name} intro`);
    window.open(`https://mail.google.com/mail/?view=cm&to=${contact}&su=${subject}`,"_blank");
  };

  const searchGlean=async()=>{
    setGleanOpen(true);setGleanLoading(true);setGleanError(null);
    try{
      const res=await fetch("/api/glean",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({accountName:acc.name})});
      const data=await res.json();
      if(!res.ok||data.error){setGleanError(data.error||"Search failed");setGleanResults(null);}
      else{setGleanResults(data.results||[]);}
    }catch(e){setGleanError(e.message);}
    setGleanLoading(false);
  };

  const saveDealReview=(sections)=>{
    setDealReviewSections(sections);
    try{localStorage.setItem(`prospector_deal_review_${acc.id}`,JSON.stringify(sections));}catch{}
    onUpdate&&onUpdate({...acc,dealReviewData:sections});
  };
  const updateDealReviewField=(key,val)=>saveDealReview({...(dealReviewSections||{}),[key]:val});
  const generateDealReview=async(regenKey=null)=>{
    setDealReviewOpen(true);setDealReviewLoading(true);setDealReviewError(null);
    if(regenKey)setDealReviewRegenKey(regenKey);else setDealReviewRegenKey(null);
    try{
      const sections=await clientDealReview(acc);
      if(regenKey){saveDealReview({...(dealReviewSections||{}),[regenKey]:sections[regenKey]||""});}
      else{saveDealReview(sections);}
    }catch(e){setDealReviewError(e.message);}
    setDealReviewLoading(false);setDealReviewRegenKey(null);
  };

  const addNextStep=()=>{
    const text=nsInput.trim();if(!text)return;
    const step={id:Date.now(),text,owner:nsOwner,done:false,createdAt:new Date().toISOString().split('T')[0]};
    onUpdate({...acc,nextSteps:[...(acc.nextSteps||[]),step]});
    setNsInput('');
  };
  const checkOffStep=(stepId)=>{
    const step=(acc.nextSteps||[]).find(s=>s.id===stepId);if(!step)return;
    if(onCreateTask){const today=new Date().toISOString().split('T')[0];onCreateTask({id:Date.now(),title:step.text,type:'Follow up',accId:acc.id,accName:acc.name,priority:'Medium',assignee:step.owner==='ae'?'AE':'AE',status:'Done',dueDate:today,notes:'',createdAt:today,personal:false});}
    onUpdate({...acc,nextSteps:(acc.nextSteps||[]).filter(s=>s.id!==stepId)});
  };
  const removeNextStep=(stepId)=>onUpdate({...acc,nextSteps:(acc.nextSteps||[]).filter(s=>s.id!==stepId)});

  const fetchGongCalls=async()=>{
    const sfdcId=acc.sfdc||acc.sf;
    if(!sfdcId){setGongCallsError('No SFDC account ID on this account');return;}
    setGongCalls('loading');setGongCallsError(null);setGongEnrich(null);
    try{
      const r=await fetch('/api/databricks/gong-calls',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sfdcId})});
      const d=await r.json();
      if(!r.ok){setGongCallsError(d.error||'Failed');setGongCalls(null);return;}
      const calls=d.calls||[];setGongCalls(calls);
      if(calls.length)fetchGongEnrich(calls);
    }catch(e){setGongCallsError(e.message);setGongCalls(null);}
  };

  const fetchGongEnrich=async(calls)=>{
    setGongEnrich('loading');
    const manualDates=(acc.calls||[]).map(c=>c.date).filter(Boolean);
    const newCalls=calls.filter(gc=>{if(!gc.date)return true;return!manualDates.some(md=>Math.abs(new Date(gc.date)-new Date(md))<86400000*1.5);});
    if(!newCalls.length){setGongEnrich({medpiccSuggestions:{},unclosedNextSteps:[],signals:[],deduped:calls.length});return;}
    try{
      const r=await fetch('/api/databricks/gong-enrich',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({calls:newCalls,currentMedpicc:acc.medpicc||{},existingNextSteps:(acc.nextSteps||[]).map(s=>s.text||s)})});
      const d=await r.json();
      if(!r.ok){setGongEnrich(null);return;}
      setGongEnrich({...d,deduped:calls.length-newCalls.length,newCallCount:newCalls.length});
    }catch{setGongEnrich(null);}
  };

  const searchGongEmails=async()=>{
    const token=await getValidGmailToken();if(!token)return;
    setGongSearch('loading');setGongDropOpen(true);
    try{
      const q=`from:gong.io ${acc.name}`;
      const r=await fetch(`/proxy/gmail/messages?q=${encodeURIComponent(q)}&maxResults=8`,{headers:{Authorization:`Bearer ${token}`}});
      const data=await r.json();
      if(!data.messages?.length){setGongSearch([]);return;}
      const details=await Promise.all(data.messages.map(m=>fetch(`/proxy/gmail/message/${m.id}`,{headers:{Authorization:`Bearer ${token}`}}).then(r=>r.json())));
      setGongSearch(details.map(msg=>({id:msg.id,subject:(msg.payload?.headers||[]).find(h=>h.name==='Subject')?.value||'(no subject)',date:(msg.payload?.headers||[]).find(h=>h.name==='Date')?.value||''})));
    }catch{setGongSearch([]);}
  };

  const importGongEmail=async(msgId)=>{
    const token=await getValidGmailToken();if(!token)return;
    setGongDropOpen(false);
    try{
      const r=await fetch(`/proxy/gmail/message/${msgId}/body`,{headers:{Authorization:`Bearer ${token}`}});
      const data=await r.json();
      if(data.text)setDebriefText(data.text);
    }catch{}
  };

  const generateFollowUpEmail=async(callRecord)=>{
    const voiceUserName=(()=>{try{return JSON.parse(localStorage.getItem('prospector_user')||'{}').name||'AE';}catch{return 'AE';}})();
    const voiceProfile=getVoiceProfile?getVoiceProfile(voiceUserName):null;
    const voiceNote=voiceProfile?.summary?`\n\nVoice guidance: ${voiceProfile.summary}`:'';
    const nextStepsList=(callRecord.nextSteps||[]).map(ns=>typeof ns==='string'?ns:(ns?.text||'')).join('\n');
    const painList=(callRecord.painPoints||[]).map(p=>typeof p==='string'?p:(p?.topic||'')).join(', ');
    const productsList=(callRecord.productsDiscussed||[]).map(p=>`${p.product} (${p.interestLevel})`).join(', ');
    const prompt=`Write a brief post-meeting follow-up email in the following person's voice.${voiceNote}\n\nMeeting with: ${acc.name}\nPain points discussed: ${painList||'N/A'}\nProducts discussed: ${productsList||'N/A'}\nNext steps: ${nextStepsList||'N/A'}\nDecision maker: ${callRecord.decisionMaker||'N/A'}\n\nRequirements:\n- Friendly but professional\n- One-line thank you opener\n- 2-3 bullet summary of what was discussed\n- Clear next steps section\n- Short closing with a clear ask\n- NO generic filler phrases like "I hope this email finds you well"\n- Keep it under 200 words\n\nRespond with JSON: {"subject":"...","body":"..."}`;
    try{
      const res=await fetch('/proxy/anthropic/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:MODELS.FAST,max_tokens:600,messages:[{role:'user',content:prompt}]})});
      const d=await res.json();
      const raw=d.content?.[0]?.text||'';
      const match=raw.match(/\{[\s\S]*\}/);
      if(match){
        const parsed=JSON.parse(match[0]);
        setFollowUpEmail(parsed);setFollowUpCopied(false);setFollowUpSkipped(false);setFollowUpDraftUrl(null);
        // Create real Gmail draft via API — silent mailto fallback on failure
        const gtoken=await getValidGmailToken();
        if(gtoken){
          try{
            const to=(acc?.personas||[])[0]?.email||'';
            const r=await fetch('/api/gmail/draft',{
              method:'POST',
              headers:{'Content-Type':'application/json'},
              body:JSON.stringify({accessToken:gtoken,to,subject:parsed.subject||'',body:parsed.body||''}),
            });
            if(r.ok){
              const j=await r.json();
              if(j.draftUrl)setFollowUpDraftUrl(j.draftUrl);
            }
          }catch{}
        }
      }
    }catch{}
  };

  const logDebrief=async()=>{
    if(!debriefText.trim())return;
    setDebriefLoading(true);setDebriefError(null);
    try{
      const callDate=new Date().toISOString().split("T")[0];
      const result=await clientDebrief(debriefText,acc,callDate);
      const gongScoreObj = result.gongScore || null;
      const behaviorScoreObj = result.behaviorScore || null;
      const totalScore = gongScoreObj
        ? GONG_RUBRIC.reduce((sum, f) => sum + (typeof gongScoreObj[f.key] === 'number' ? gongScoreObj[f.key] : 0), 0)
        : null;
      const behaviorTotalScore = behaviorScoreObj
        ? BEHAVIOR_RUBRIC.reduce((sum, f) => sum + (typeof behaviorScoreObj[f.key] === 'number' ? behaviorScoreObj[f.key] : 0), 0)
        : null;
      const inputIsTranscript = isTranscript(debriefText);
      const callRecord={
        id:Date.now(),date:callDate,
        summary:result.summary||"",callQuality:result.callQuality||"Neutral",
        painPoints:result.painPoints||[],productsDiscussed:result.productsDiscussed||[],
        nextSteps:(result.nextSteps||[]).map(ns=>({id:Date.now()+Math.random(),text:typeof ns==='string'?ns:(ns?.text||ns?.action||''),owner:'ae',done:false,dueDate:ns?.dueDate||null,createdAt:callDate})).filter(s=>s.text),
        committedActions:result.committedActions||[],
        blockers:result.blockers||[],openQuestions:result.openQuestions||[],
        useCases:result.useCases||[],keySignals:result.keySignals||[],
        decisionMaker:result.decisionMaker||null,
        suggestedStage:result.suggestedStage||null,
        gongScore: gongScoreObj,
        totalScore,
        behaviorScore: behaviorScoreObj,
        behaviorTotalScore,
        timeline:result.timeline||null,
        contact:{name:topPersona?.name||"",title:topPersona?.title||""},
        ...(inputIsTranscript ? { rawTranscript: debriefText } : { structuredNotes: debriefText }),
      };
      const intel=extractIntelligenceFromCall(result,acc);
      const updatedMedpicc={...(acc.medpicc||{})};
      if(result.medpiccUpdates){Object.entries(result.medpiccUpdates).forEach(([k,v])=>{if(v&&(!updatedMedpicc[k]||updatedMedpicc[k].length<v.length))updatedMedpicc[k]=v;});}
      const compactCall = (call) => {
        const compactedRaw = call.rawTranscript && call.rawTranscript.length > 500
          ? (call.summary || call.rawTranscript.slice(0, 500) + '… [compacted]')
          : call.rawTranscript;
        const compactedNotes = call.structuredNotes && call.structuredNotes.length > 500
          ? (call.summary || call.structuredNotes.slice(0, 500) + '… [compacted]')
          : call.structuredNotes;
        if (compactedRaw === call.rawTranscript && compactedNotes === call.structuredNotes) return call;
        return { ...call, ...(call.rawTranscript ? { rawTranscript: compactedRaw } : {}), ...(call.structuredNotes ? { structuredNotes: compactedNotes } : {}) };
      };
      const calls = [...(acc.calls||[]),callRecord].map((call, i, arr) => {
        const isRecent = i >= arr.length - 3;
        return isRecent ? call : compactCall(call);
      });
      const update={
        ...acc,
        calls,
        medpicc:updatedMedpicc,
        last:callDate,
        lastIntelAt:new Date().toISOString(),
        ...(intel.mergedProds?{prods:intel.mergedProds}:{}),
        ...(intel.mergedUcs?{ucs:intel.mergedUcs}:{}),
        ...(intel.mergedSigs?{sigs:intel.mergedSigs}:{}),
        ...(intel.mergedPersonas?{personas:intel.mergedPersonas}:{}),
      };
      onUpdate&&onUpdate(update);
      if(onUpdate){
        runPathToCloseUpdate([update],(updatedAccounts)=>{
          const ptc=updatedAccounts[0];
          if(ptc?.pathToClose)onUpdate({...update,pathToClose:ptc.pathToClose,pathToCloseAt:ptc.pathToCloseAt});
        },true);
      }
      if(intel.newlyDetectedProds.length){setNewlyDetectedProds(new Set(intel.newlyDetectedProds));}
      const committed=result.committedActions||[];
      setPendingActions(committed);setEditedActions(committed.map(a=>a.suggestedAction||a.action));
      setSelectedActionIdxs(new Set(committed.map((_,i)=>i)));setActionsPushed(false);
      generateFollowUpEmail(callRecord);

      // SFDC queue stub
      const sfdcPayload={id:Date.now(),accountId:acc.id,sfdcId:acc.sfdc||null,oppId:acc.sfdcOppId||acc.sfdc||null,accName:acc.name,nextStep:(callRecord.nextSteps||[]).slice(0,3).map(ns=>typeof ns==='string'?ns:ns?.text||'').join(' | ').slice(0,255),stageSuggestion:result.suggestedStage||null,lastActivityDate:callDate,medpicc:result.medpiccUpdates||{},createdAt:new Date().toISOString(),synced:false};
      try{const q=JSON.parse(localStorage.getItem('prospector_sfdc_queue')||'[]');const updated=q.filter(x=>x.accountId!==acc.id);updated.push(sfdcPayload);localStorage.setItem('prospector_sfdc_queue',JSON.stringify(updated));}catch{}

      // Auto-flush this account's stub to SFDC if connected
      const sfdcToken=localStorage.getItem('sfdc_access_token');
      const sfdcInstance=localStorage.getItem('sfdc_instance_url');
      let flashMsg='✦ Intel updated';
      if(sfdcToken&&sfdcInstance&&sfdcPayload.oppId&&sfdcPayload.nextStep){
        try{
          const r=await fetch('/api/sfdc/update-opp',{
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({accessToken:sfdcToken,instanceUrl:sfdcInstance,oppId:sfdcPayload.oppId,fields:{NextStep:sfdcPayload.nextStep}}),
          });
          if(r.ok){
            // Mark stub synced
            try{const q2=JSON.parse(localStorage.getItem('prospector_sfdc_queue')||'[]');const upd=q2.map(x=>x.id===sfdcPayload.id?{...x,synced:true,syncedAt:new Date().toISOString()}:x);localStorage.setItem('prospector_sfdc_queue',JSON.stringify(upd));}catch{}
            flashMsg='✓ Synced to Salesforce';
          }else{
            flashMsg='⚠ Queued for SFDC sync';
          }
        }catch{
          flashMsg='⚠ Queued for SFDC sync';
        }
      }else if(sfdcPayload.nextStep&&!sfdcToken){
        flashMsg='⚠ Queued for SFDC sync';
      }
      setIntelFlash&&setIntelFlash(flashMsg);
      setTimeout(()=>setIntelFlash&&setIntelFlash(null),3500);

      setDebriefText("");setDebriefOpen(false);setDebriefMode(null);setCallHistoryOpen(true);
    }catch(e){setDebriefError(e.message);}
    setDebriefLoading(false);
  };

  const closeDebrief=()=>{
    setDebriefOpen(false);
    setDebriefMode(null);
    setQuickUpdateText('');
    setQuickUpdateResult(null);
    setQuickUpdateError(null);
    setQuickUpdateFollowUp(false);
  };

  const runQuickUpdate=async()=>{
    if(!quickUpdateText.trim())return;
    setQuickUpdateLoading(true);setQuickUpdateError(null);setQuickUpdateResult(null);
    try{
      const result=await quickUpdateExtract(quickUpdateText,acc);
      setQuickUpdateResult(result);
    }catch(e){setQuickUpdateError(e.message);}
    setQuickUpdateLoading(false);
  };

  const applyQuickUpdate=(payload,withFollowUp)=>{
    const today=new Date().toISOString().split('T')[0];
    const updated={...acc};
    let dirty=false;
    if(payload.timelineUpdates.length){
      const newLines=payload.timelineUpdates.map(u=>`${u.milestone||''}${u.date?` — ${u.date}`:''}`).filter(s=>s.trim());
      updated.timeline=[updated.timeline||'',...newLines].filter(Boolean).join('\n');
      dirty=true;
    }
    if (payload.newContacts.length) {
      const existing = updated.personas || [];
      const existingNames = existing.map(p => p.name?.toLowerCase());
      const dedupedNew = payload.newContacts.filter(
        c => !existingNames.includes(c.name?.toLowerCase())
      );
      if (dedupedNew.length) {
        updated.personas = [...existing, ...dedupedNew];
        dirty = true;
      }
    }
    if(payload.blockers.length){
      updated.blockers=[...(updated.blockers||[]),...payload.blockers.map(b=>({text:b,addedAt:today,source:'quick_update'}))];
      dirty=true;
    }
    if(payload.contextNote){
      updated.quickUpdates=[...(updated.quickUpdates||[]),{text:payload.contextNote,date:today}];
      dirty=true;
    }
    if(dirty){
      updated.last=today;
      updated.lastIntelAt=new Date().toISOString();
      onUpdate&&onUpdate(updated);
    }
    (payload.tasks||[]).forEach((t,i)=>{
      if(!onCreateTask)return;
      const due=t.dueDate||(()=>{const d=new Date();d.setDate(d.getDate()+2);return d.toISOString().split('T')[0];})();
      onCreateTask({
        id:Date.now()+i,
        title:t.text,
        type:'Follow up',
        accId:acc.id,accName:acc.name,
        accVert:acc.vert,accUcs:acc.ucs,accProds:acc.prods,accStage:acc.stage,
        assignee:t.owner==='AE'?(activeUser?.name||'AE'):(acc.name||'Prospect'),
        status:'Open',
        priority:'Medium',
        dueDate:due,
        createdAt:today,
        source:'quick_update',
        owner:t.owner,
      });
    });
    if(withFollowUp){
      const callRecord={
        id:Date.now(),
        date:today,
        summary:payload.contextNote||'',
        painPoints:(payload.blockers||[]).map(b=>({topic:b,detail:'',solution:''})),
        productsDiscussed:[],
        nextSteps:(payload.tasks||[]).map(t=>({text:t.text,owner:t.owner==='AE'?'ae':'prospect'})),
        decisionMaker:null,
      };
      generateFollowUpEmail(callRecord);
    }
    setIntelFlash&&setIntelFlash('✦ Quick update applied');
    setTimeout(()=>setIntelFlash&&setIntelFlash(null),3500);
    closeDebrief();
  };

  const askIntel=async()=>{
    if(!intelQuery.trim())return;
    setIntelLoading(true);setIntelAnswer(null);
    const callSummaries=(acc.calls||[]).map((c,i)=>`Call ${i+1} (${c.date}): ${c.summary}${c.painPoints?.length?"\nPain: "+c.painPoints.map(p=>typeof p==='string'?p:(p?.topic||'')).join("; "):""}${c.nextSteps?.length?"\nNext steps: "+c.nextSteps.map(ns=>typeof ns==='string'?ns:ns?.text||'').join("; "):""}`).join("\n\n");
    const medpiccStr=acc.medpicc?MEDPICC_FIELDS.map(f=>acc.medpicc[f.key]?`${f.label}: ${acc.medpicc[f.key]}`:null).filter(Boolean).join("\n"):"";
    try{
      const r=await fetch("/proxy/anthropic/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:MODELS.STANDARD,max_tokens:600,messages:[{role:"user",content:`Account: ${acc.name} | Stage: ${acc.stage} | Tier: ${acc.tier} | Products: ${(acc.prods||[]).join(", ")}\n\nBusiness model: ${acc.bm||"unknown"}\nproduct fit: ${acc.pf||"unknown"}\n\nCall history:\n${callSummaries||"None"}\n\nMEDPICC:\n${medpiccStr||"Not populated"}\n\nQuestion: ${intelQuery}\n\nAnswer concisely and specifically based on the data above.`}]})});
      const d=await r.json();setIntelAnswer(d.content?.[0]?.text||"No answer.");
    }catch(e){setIntelAnswer("Error: "+e.message);}
    setIntelLoading(false);
  };

  const askSfdc=async()=>{
    setSfdcLoading(true);setSfdcCopied(false);setSfdcText('');
    const now=new Date();
    const todayFmt=`${now.getMonth()+1}/${now.getDate()}`;
    const todayISO=now.toISOString().split('T')[0];
    const twoWeeksOut=(()=>{const d=new Date(now);d.setDate(d.getDate()+14);return`${d.getMonth()+1}/${d.getDate()}`;})();
    const sentEmails=await fetchSentEmailsForAccount(acc.name);
    const {aeInitials,prompt}=buildNsPrompt({acc,tasks,activeUser,sentEmails,todayFmt,todayISO,twoWeeksOut});
    try{
      const r=await fetch('/proxy/anthropic/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:MODELS.STANDARD,max_tokens:280,messages:[{role:'user',content:prompt}]})});
      const d=await r.json();const text=d.content?.[0]?.text?.trim()||'';
      setSfdcText(text);navigator.clipboard.writeText(text).catch(()=>{});setSfdcCopied(true);setTimeout(()=>setSfdcCopied(false),2000);
    }catch(e){console.error('SFDC copy error:',e);}
    setSfdcLoading(false);
  };

  // ── render ───────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Quick Ask — now a shared primitive, see QuickAskBar below ── */}
      <QuickAskBar acc={acc} />

      {/* ── SFDC copy — business-only, split out of the Quick Ask row so QuickAskBar can be reused by influencer accounts too ── */}
      <div style={{ padding:'0 16px 12px', margin:'-12px -14px 12px', background:'#050f05' }}>
        <div style={{ display:'flex', gap:6, alignItems:'center' }}>
          <button onClick={askSfdc} disabled={sfdcLoading}
            style={{ ...mono, fontSize:10, height:28, padding:'0 10px', background:sfdcCopied?`${T.cyan}14`:'transparent', border:`1px solid ${sfdcCopied?T.cyan:`${T.cyan}44`}`, color:sfdcCopied?T.cyan:`${T.cyan}AA`, borderRadius:4, cursor:sfdcLoading?'default':'pointer', letterSpacing:'0.06em', display:'flex', alignItems:'center', gap:4, flexShrink:0, transition:'all 0.15s' }}
            title={sfdcLoading?'Generating…':sfdcCopied?'Copied to clipboard':'Copy SFDC Update'}>
            {sfdcLoading?<><span style={{ display:'inline-block', width:7, height:7, borderRadius:'50%', border:`1.5px solid currentColor`, borderTopColor:'transparent', animation:'spin 0.7s linear infinite' }}></span></>:sfdcCopied?'✓ SFDC':'⎘ SFDC'}
          </button>
        </div>
        {sfdcText&&sfdcCopied===false&&(<div style={{ marginTop:8, padding:'7px 10px', background:T.bg.surface, border:`1px solid ${T.cyan}33`, borderRadius:4 }}><p style={{ ...mono, margin:0, fontSize:11, color:'#cfe8d4', lineHeight:1.7, whiteSpace:'pre-wrap' }}>{sfdcText}</p></div>)}
      </div>

      <NextStepsPanel
        acc={acc}
        nsOwner={nsOwner} setNsOwner={setNsOwner}
        nsInput={nsInput} setNsInput={setNsInput}
        addNextStep={addNextStep} removeNextStep={removeNextStep} checkOffStep={checkOffStep}/>

      {/* ── Button rows ── */}
      <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:12 }}>
        {/* Row 1 — external links */}
        <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap", marginBottom:6 }}>
          {linksEdit
            ?<span style={{ display:"inline-flex", gap:4, alignItems:"center", flexWrap:"wrap" }} onClick={e=>e.stopPropagation()}>
                <input autoFocus value={linksDraft.web} onChange={e=>setLinksDraft(d=>({...d,web:e.target.value}))} placeholder="Website URL" style={{ ...mono, fontSize:11, padding:"2px 7px", background:C.sur, border:`1px solid ${C.tin}44`, borderRadius:4, color:C.txt, outline:"none", width:130 }}/>
                <input value={linksDraft.linkedin} onChange={e=>setLinksDraft(d=>({...d,linkedin:e.target.value}))} placeholder="LinkedIn URL" style={{ ...mono, fontSize:11, padding:"2px 7px", background:C.sur, border:"1px solid #4A9AE844", borderRadius:4, color:C.txt, outline:"none", width:130 }}/>
                <input value={linksDraft.sfdc} onChange={e=>setLinksDraft(d=>({...d,sfdc:e.target.value}))} placeholder="SFDC URL or ID" style={{ ...mono, fontSize:11, padding:"2px 7px", background:C.sur, border:`1px solid ${C.orange}44`, borderRadius:4, color:C.txt, outline:"none", width:130 }}/>
                <button onClick={e=>{e.stopPropagation();onUpdate&&onUpdate({...acc,web:linksDraft.web,sfdc:linksDraft.sfdc,linkedin:linksDraft.linkedin});setLinksEdit(false);}} style={{ ...mono, fontSize:10, height:26, padding:"0 10px", background:"transparent", border:`0.5px solid ${C.green}66`, color:C.green, borderRadius:4, cursor:"pointer" }}>Save</button>
                <button onClick={e=>{e.stopPropagation();setLinksEdit(false);}} style={{ ...mono, fontSize:10, height:26, padding:"0 10px", background:"transparent", border:"0.5px solid #2a2a2a", color:C.dim, borderRadius:4, cursor:"pointer" }}>Cancel</button>
              </span>
            :<>
                {webUrl&&<a href={webUrl} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} style={{ ...mono, fontSize:10, height:26, display:"inline-flex", alignItems:"center", padding:"0 10px", background:"transparent", border:"0.5px solid #2a2a2a", color:C.tin, borderRadius:4, textDecoration:"none", whiteSpace:"nowrap" }}>↗ Website</a>}
                <a href={liUrl} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} style={{ ...mono, fontSize:10, height:26, display:"inline-flex", alignItems:"center", padding:"0 10px", background:"transparent", border:"0.5px solid #2a2a2a", color:"#4A9AE8", borderRadius:4, textDecoration:"none", whiteSpace:"nowrap" }}>in LinkedIn</a>
                {toSfdcUrl(acc.sfdc)?<a href={toSfdcUrl(acc.sfdc)} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} style={{ ...mono, fontSize:10, height:26, display:"inline-flex", alignItems:"center", padding:"0 10px", background:"transparent", border:"0.5px solid #2a2a2a", color:C.orange, borderRadius:4, textDecoration:"none", whiteSpace:"nowrap" }}>⬡ Salesforce</a>:<button onClick={e=>{e.stopPropagation();if(onUpdate){setLinksDraft({web:acc.web||'',sfdc:acc.sfdc||'',linkedin:acc.linkedin||''});setLinksEdit(true);}}} style={{ ...mono, fontSize:10, height:26, padding:"0 10px", background:"transparent", border:"0.5px solid #2a2a2a", color:C.dim, borderRadius:4, cursor:"pointer" }}>⬡ SF</button>}
                {onUpdate&&<button onClick={e=>{e.stopPropagation();setLinksDraft({web:acc.web||'',sfdc:acc.sfdc||'',linkedin:acc.linkedin||''});setLinksEdit(true);}} style={{ ...mono, fontSize:10, height:26, padding:"0 8px", background:"transparent", border:"0.5px solid #2a2a2a", color:C.dim, borderRadius:4, cursor:"pointer" }} title="Edit links">✏</button>}
              </>
          }
          {clientIdsEdit
            ?<span style={{ display:"inline-flex", gap:3, alignItems:"center", flexShrink:0 }} onClick={e=>e.stopPropagation()}>
                <input autoFocus value={clientIdsInput} onChange={e=>setClientIdsInput(e.target.value)} placeholder="a_xxx, a_yyy…" onKeyDown={e=>{if(e.key==="Enter"&&clientIdsInput.trim()){const ids=clientIdsInput.split(",").map(s=>s.trim()).filter(Boolean);onUpdate&&onUpdate({...acc,clientIds:ids});setClientIdsEdit(false);setClientIdsInput("");}if(e.key==="Escape"){setClientIdsEdit(false);setClientIdsInput("");}}} style={{ ...mono, fontSize:11, padding:"2px 7px", background:C.sur, border:"1px solid #5bc8f566", borderRadius:4, color:C.txt, outline:"none", width:130 }}/>
                <button onClick={e=>{e.stopPropagation();const ids=clientIdsInput.split(",").map(s=>s.trim()).filter(Boolean);if(ids.length){onUpdate&&onUpdate({...acc,clientIds:ids});setClientIdsEdit(false);setClientIdsInput("");}}} style={{ ...mono, fontSize:10, height:26, padding:"0 8px", background:"transparent", border:"0.5px solid #2a2a2a", color:"#5bc8f5", borderRadius:4, cursor:"pointer" }}>✓</button>
                <button onClick={e=>{e.stopPropagation();setClientIdsEdit(false);setClientIdsInput("");}} style={{ ...mono, fontSize:10, height:26, padding:"0 8px", background:"transparent", border:"0.5px solid #2a2a2a", color:C.dim, borderRadius:4, cursor:"pointer" }}>✕</button>
              </span>
            :(acc.clientIds||[]).length>0
              ?<button onClick={e=>{e.stopPropagation();if(onUpdate){setClientIdsInput((acc.clientIds||[]).join(", "));setClientIdsEdit(true);}}} style={{ ...mono, fontSize:10, height:26, padding:"0 10px", background:"#5bc8f508", border:"0.5px solid #2a2a2a", color:"#5bc8f5", borderRadius:4, cursor:"pointer", whiteSpace:"nowrap" }} title={(acc.clientIds||[]).join(", ")}>🪪 {(acc.clientIds||[]).length===1?acc.clientIds[0]:`${(acc.clientIds||[]).length} IDs`}</button>
              :<button onClick={e=>{e.stopPropagation();if(onUpdate){setClientIdsEdit(true);setClientIdsInput("");}}} style={{ ...mono, fontSize:10, height:26, padding:"0 10px", background:"transparent", border:"0.5px solid #2a2a2a", color:C.dim, borderRadius:4, cursor:"pointer" }}>🪪 Client ID</button>
          }
          <button onClick={e=>{e.stopPropagation();openEmail();}} style={{ ...mono, fontSize:10, height:26, padding:"0 10px", background:emailOpen?C.tinBg:"transparent", border:"0.5px solid #2a2a2a", color:emailOpen?C.tin:C.mut, borderRadius:4, cursor:"pointer", boxShadow:emailOpen?`0 0 7px ${C.tin}33`:undefined }}>✉ Email</button>
          {/* Glean hidden — re-enable when ready */}
        </div>

        {/* Row 2 — action button clusters (Call · Intel · Deal) */}
        <div style={{ display:"flex", gap:5, alignItems:"center", flexWrap:"wrap" }}>
          {/* Generate Outreach — account-card-unification-and-outreach-v1, reuses EmailModal/api/email.js */}
          <button onClick={e=>{e.stopPropagation();setOutreachOpen(true);}}
            onMouseEnter={e=>{e.currentTarget.style.boxShadow='0 0 8px #c026d344';}}
            onMouseLeave={e=>{e.currentTarget.style.boxShadow='none';}}
            style={{ ...mono, fontSize:11, height:26, padding:'0 11px', background:'#c026d314', border:'1px solid #c026d3', color:'#e879f9', borderRadius:4, cursor:'pointer', letterSpacing:'0.04em', fontWeight:600, transition:'box-shadow 0.12s' }}>✦ Generate Outreach</button>

          {groupSep()}

          {/* GROUP 1 — Call prep & logging (amber) */}
          <CallPrepButton size="sm" onClick={e=>{e.stopPropagation();setCallPrepOpen(true);}} />
          <button onClick={e=>{e.stopPropagation();if(debriefOpen){closeDebrief();}else{setDebriefOpen(true);setDebriefMode(null);}}}
            style={groupBtn(debriefOpen, GROUP_C.call)}>📋 Debrief{(acc.calls||[]).length>0?` (${acc.calls.length})`:""}</button>

          {groupSep()}

          {/* GROUP 2 — Intelligence (neon green) */}
          <button onClick={e=>{e.stopPropagation();setIntelOpen(o=>!o);if(!intelOpen){setCommsOpen(false);setTimelineOpen(false);}}}
            style={groupBtn(intelOpen, GROUP_C.intel)}>◆ Intel</button>
          <button onClick={e=>{e.stopPropagation();setCommsOpen(o=>!o);if(!commsOpen){setIntelOpen(false);setTimelineOpen(false);}}}
            style={groupBtn(commsOpen, GROUP_C.intel)}>💬 Comms</button>
          <button onClick={e=>{e.stopPropagation();setExtractOpen(o=>!o);}}
            style={groupBtn(extractOpen, GROUP_C.intel)}>⬇ Extract</button>

          {groupSep()}

          {/* GROUP 3 — Deal mechanics (cyan) */}
          <button onClick={e=>{e.stopPropagation();setTimelineOpen(o=>!o);if(!timelineOpen){setIntelOpen(false);setCommsOpen(false);}}}
            style={groupBtn(timelineOpen, GROUP_C.deal)}>📅 Timeline</button>
          {onOpenPricing&&<button onClick={e=>{e.stopPropagation();try{const snaps=JSON.parse(localStorage.getItem("prospector_pricing_snapshots")||"{}")[acc.id]||[];const mostRecent=snaps.length>0?snaps.reduce((a,b)=>(a.id||0)>(b.id||0)?a:b):null;localStorage.setItem("prospector_active_deal_account",JSON.stringify({accountId:acc.id,accountName:acc.name,sfAccountId:acc.sf||acc.sfdc||"",activePricingFileId:mostRecent?.id||null,source:"account_card"}));}catch{}onOpenPricing(acc.id);}}
            onMouseEnter={e=>{e.currentTarget.style.boxShadow=`0 0 8px ${T.tier.gold}44`;}}
            onMouseLeave={e=>{e.currentTarget.style.boxShadow='none';}}
            style={{ ...mono, fontSize:11, height:26, padding:'0 11px', background:'transparent', border:`1px solid ${T.tier.gold}`, color:T.tier.gold, borderRadius:4, cursor:'pointer', letterSpacing:'0.04em', transition:'box-shadow 0.12s' }}>$ Pricing</button>}
          {onOpenRoi&&<button onClick={e=>{e.stopPropagation();onOpenRoi(acc.id);}}
            onMouseEnter={e=>{e.currentTarget.style.boxShadow=`0 0 8px ${T.neon}44`;}}
            onMouseLeave={e=>{e.currentTarget.style.boxShadow='none';}}
            style={{ ...mono, fontSize:11, height:26, padding:'0 11px', background:'transparent', border:`1px solid ${T.neon}`, color:T.neon, borderRadius:4, cursor:'pointer', letterSpacing:'0.04em', transition:'box-shadow 0.12s' }}>📈 ROI</button>}

          <span style={{ width:"0.5px", height:16, background:"#2a2a2a", flexShrink:0, alignSelf:"center" }}/>
          <button onClick={e=>{e.stopPropagation();onToggleFav&&onToggleFav(acc.id);}} style={{ ...mono, fontSize:10, height:26, padding:"0 10px", background:isFav?C.goldBg:"transparent", border:`0.5px solid ${isFav?C.goldBdr:"#3a3020"}`, color:isFav?C.gold:C.mut, borderRadius:4, cursor:"pointer", boxShadow:isFav?`0 0 7px ${C.gold}33`:undefined }}>{isFav?"★ Favorited":"☆ Favorite"}</button>
          {assignedEntry
            ?(()=>{const urg=URGENCY_OPTIONS.find(u=>u.id===assignedEntry.urgency)||null;const uc=urg?.color||C.purple;return(<span style={{ ...mono, fontSize:10, height:26, padding:"0 10px", background:`${uc}18`, border:`0.5px solid ${uc}44`, color:uc, cursor:onUnassign?"pointer":"default", display:"inline-flex", alignItems:"center", gap:4, borderRadius:4 }} onClick={e=>{e.stopPropagation();onUnassign&&onUnassign(acc.name);}} title={onUnassign?`Click to unassign · ${assignedEntry.assignedTo} · ${urg?.label||''}`:undefined}>◎{urg?` ${urg.label}`:""}{onUnassign&&" ✕"}</span>);})()
            :onAssign&&(
              <div style={{ position:"relative" }} onClick={e=>e.stopPropagation()}>
                <button onClick={()=>setOutboundPickerOpen(o=>!o)}
                  style={{ ...mono, fontSize:10, height:26, padding:"0 10px", background:outboundPickerOpen?`${T.cyan}18`:"transparent", border:`0.5px solid ${outboundPickerOpen?T.cyan:`${T.cyan}55`}`, color:outboundPickerOpen?T.cyan:`${T.cyan}AA`, borderRadius:4, cursor:"pointer", letterSpacing:"0.06em", textShadow:outboundPickerOpen?`0 0 6px ${T.cyan}66`:"none", boxShadow:outboundPickerOpen?`0 0 8px ${T.cyan}33`:undefined }}>
                  Outbound →
                </button>
                {outboundPickerOpen && (()=>{
                  const me = activeUser ? { id: activeUser.id, name: 'Me', display: activeUser.name } : null;
                  const bdrs = BDR_LIST || [];
                  const handle = (assignees, label) => {
                    if (!onAssign || !assignees.length) { setOutboundPickerOpen(false); return; }
                    const bdrAssignee = assignees.find(a => bdrs.some(b => b.id === a.id)) || assignees[0];
                    const note = assignees.length > 1 ? `Co-assigned with ${assignees.map(a => a.display || a.name).join(' + ')}` : '';
                    onAssign(acc, bdrAssignee.id, note, 'warm');
                    // Hand off Hunter-cached contacts to the listener in App.js so
                    // the new frontier entry gets a populated outbound namespace.
                    queueMicrotask(() => {
                      window.dispatchEvent(new CustomEvent('prospector_outbound_enrich', {
                        detail: {
                          accountId: acc.id,
                          accountName: acc.name,
                          web: acc.web,
                          topContact: getCachedTopContact(acc.web),
                          alternateContacts: getCachedAlternateContacts(acc.web),
                        },
                      }));
                    });
                    setOutboundPickerOpen(false);
                    setIntelFlash && setIntelFlash(`✓ Added to Frontier — ${label}`);
                    setTimeout(()=>setIntelFlash && setIntelFlash(null), 3500);
                  };
                  const btn = (key, label, onClick) => (
                    <button key={key} onClick={onClick}
                      style={{ ...mono, fontSize:11, padding:"5px 12px", background:`${T.cyan}10`, border:`1px solid ${T.cyan}44`, color:T.cyan, borderRadius:3, cursor:"pointer", letterSpacing:"0.04em", whiteSpace:"nowrap" }}
                      onMouseEnter={e=>{ e.currentTarget.style.background=`${T.cyan}22`; e.currentTarget.style.borderColor=T.cyan; }}
                      onMouseLeave={e=>{ e.currentTarget.style.background=`${T.cyan}10`; e.currentTarget.style.borderColor=`${T.cyan}44`; }}>
                      {label}
                    </button>
                  );
                  const openModalForBdr = (bdrId, note = '') => {
                    setAssignModalBdrId(bdrId);
                    setAssignModalNote(note);
                    setOutboundPickerOpen(false);
                    setAssignModalOpen(true);
                  };
                  return (
                    <div style={{ position:"absolute", top:"calc(100% + 4px)", right:0, zIndex:200, background:"#050f05", border:`1px solid ${T.cyan}55`, borderRadius:4, padding:"8px 10px", boxShadow:`0 8px 24px rgba(0,0,0,0.6), 0 0 16px ${T.cyan}22`, display:"flex", gap:6, flexWrap:"nowrap" }}>
                      {me && btn('me', 'Me', ()=>handle([me], 'Me'))}
                      {bdrs.map(b => btn(b.id, b.name.split(' ')[0], ()=>openModalForBdr(b.id)))}
                      {me && bdrs.length === 1 && btn('both', 'Both', ()=>openModalForBdr(bdrs[0].id, `Co-assigned with ${me.display}`))}
                      {me && bdrs.length > 1 && btn('all', 'All', ()=>handle([me, ...bdrs.map(b=>({id:b.id,name:b.name,display:b.name}))], 'All'))}
                      <button onClick={()=>setOutboundPickerOpen(false)} style={{ ...mono, fontSize:13, color:`${T.cyan}66`, background:"transparent", border:"none", cursor:"pointer", padding:"0 4px", lineHeight:1 }}>✕</button>
                    </div>
                  );
                })()}
              </div>
            )
          }
          {(onOpenDealSummary||acc.isGaming)&&<span style={{ width:"0.5px", height:16, background:"#2a2a2a", flexShrink:0, alignSelf:"center" }}/>}
          {acc.isGaming&&<button onClick={e=>{e.stopPropagation();window.open(process.env.REACT_APP_JIRA_COMPLIANCE_URL || "https://your-org.atlassian.net/servicedesk/customer/portal/PLACEHOLDER","_blank","noopener,noreferrer");}} style={{ ...mono, fontSize:10, height:26, padding:"0 10px", background:"#F59E0B18", border:"0.5px solid #F59E0B55", color:"#F59E0B", borderRadius:4, cursor:"pointer" }}>🎲 Gaming Q ↗</button>}
          {onOpenDealSummary&&hasPricingFor(acc.id)&&hasRoiFor(acc.id)&&<button onClick={e=>{e.stopPropagation();onOpenDealSummary(acc.id);}} style={{ ...mono, fontSize:10, height:26, padding:"0 10px", background:`${C.gold}14`, border:`0.5px solid ${C.gold}66`, color:C.gold, borderRadius:4, cursor:"pointer", fontWeight:600 }}>★ Deal Summary</button>}
          {acc.stage==="Closed Won"&&onUpdate&&(()=>{const gs=acc.gift;const isSent=gs?.status==="sent";const isPending=gs?.status==="pending";return<button onClick={e=>{e.stopPropagation();openGiftModal&&openGiftModal();}} style={{ ...mono, fontSize:10, height:26, padding:"0 10px", background:isSent?`${C.green}14`:isPending?`${C.gold}14`:"transparent", border:`0.5px solid ${isSent?C.green:isPending?C.gold:C.gold+"55"}`, color:isSent?C.green:C.gold, borderRadius:4, cursor:"pointer" }} title={isSent?`Gift sent${gs.sentAt?' '+new Date(gs.sentAt).toLocaleDateString():''}`:isPending?"Gift pending — click to review":"Send a gift"}>🎁{isSent?" Sent":isPending?" Pending":""}</button>;})()}
          <span style={{ width:"0.5px", height:16, background:"#2a2a2a", flexShrink:0, alignSelf:"center", marginLeft:"auto" }}/>
          <button onClick={e=>{e.stopPropagation();onReassay&&onReassay(acc);}} disabled={reassaying}
            style={{ ...mono, fontSize:10, height:26, padding:"0 11px", background:"transparent", border:`1px solid ${reassaying?GROUP_C.intel:"#333"}`, color:reassaying?GROUP_C.intel:"#888", borderRadius:4, cursor:reassaying?"not-allowed":"pointer", letterSpacing:"0.08em" }}>
            {reassaying?"⬡ ANALYZING…":"[ ↻ RE-ASSAY ]"}
          </button>
        </div>
      </div>

      {/* Assign confirmed banner */}
      {assignConfirmed&&(<div style={{ marginBottom:10, padding:"6px 12px", background:`${C.green}12`, border:`1px solid ${C.green}33`, borderRadius:5, ...mono, fontSize:12, color:C.green }}>✓ Assigned to {assignConfirmed.bdr} — {assignConfirmed.label} · Task created</div>)}

      {/* Modals */}
      {assignModalOpen&&onAssign&&!assignedEntry&&(
        <AssignModal acc={acc} initialBdrId={assignModalBdrId} initialNote={assignModalNote} onClose={()=>{setAssignModalOpen(false);setAssignModalBdrId(null);setAssignModalNote('');}} onAssign={(a,bdrId,note,urgency)=>{
          const urg=URGENCY_OPTIONS.find(u=>u.id===urgency)||URGENCY_OPTIONS[1];
          const bdrName=BDR_LIST.find(b=>b.id===bdrId)?.name||bdrId;
          onAssign(a,bdrId,note,urgency);
          setAssignConfirmed({bdr:bdrName,emoji:urg.emoji,label:urg.label});
          setTimeout(()=>setAssignConfirmed(null),4000);
          queueMicrotask(() => {
            window.dispatchEvent(new CustomEvent('prospector_outbound_enrich', {
              detail: {
                accountId: acc.id,
                accountName: acc.name,
                web: acc.web,
                topContact: getCachedTopContact(acc.web),
                alternateContacts: getCachedAlternateContacts(acc.web),
              },
            }));
          });
        }}/>
      )}

      {/* Email + Glean inline panels (Pre-Call now opens CallPrepModal below) */}
      <AccountCardExpandedPanels
        emailOpen={emailOpen} setEmailOpen={setEmailOpen}
        emailBody={emailBody} setEmailBody={setEmailBody}
        emailLoading={emailLoading} emailCopied={emailCopied} setEmailCopied={setEmailCopied}
        generateEmail={generateEmail} topPersona={topPersona}
        gleanOpen={gleanOpen} setGleanOpen={setGleanOpen}
        gleanLoading={gleanLoading} gleanResults={gleanResults} gleanError={gleanError} searchGlean={searchGlean}
        acc={acc}
      />

      {callPrepOpen && (
        <CallPrepModal
          acc={acc}
          tasks={tasks||[]}
          onUpdate={onUpdate}
          onClose={()=>setCallPrepOpen(false)}
        />
      )}

      {debriefOpen && (
        <DebriefPanel
          acc={acc}
          debriefMode={debriefMode} setDebriefMode={setDebriefMode}
          debriefText={debriefText} setDebriefText={setDebriefText}
          debriefError={debriefError} debriefLoading={debriefLoading} logDebrief={logDebrief}
          gongSearch={gongSearch} gongDropOpen={gongDropOpen} setGongDropOpen={setGongDropOpen}
          searchGongEmails={searchGongEmails} importGongEmail={importGongEmail}
          quickUpdateText={quickUpdateText} setQuickUpdateText={setQuickUpdateText}
          quickUpdateError={quickUpdateError} quickUpdateLoading={quickUpdateLoading}
          quickUpdateResult={quickUpdateResult} setQuickUpdateResult={setQuickUpdateResult}
          quickUpdateFollowUp={quickUpdateFollowUp} setQuickUpdateFollowUp={setQuickUpdateFollowUp}
          runQuickUpdate={runQuickUpdate} applyQuickUpdate={applyQuickUpdate}
          closeDebrief={closeDebrief}/>
      )}


      {intelOpen && (
        <IntelPanel
          acc={acc} tasks={tasks} activeUser={activeUser} onUpdate={onUpdate}
          setIntelOpen={setIntelOpen}
          callHistoryOpen={callHistoryOpen} setCallHistoryOpen={setCallHistoryOpen}
          callScoreOpen={callScoreOpen} setCallScoreOpen={setCallScoreOpen}
          askOpen={askOpen} setAskOpen={setAskOpen}
          personasTabOpen={personasTabOpen} setPersonasTabOpen={setPersonasTabOpen}
          settingsTabOpen={settingsTabOpen} setSettingsTabOpen={setSettingsTabOpen}
          medpiccOpen={medpiccOpen} setMedpiccOpen={setMedpiccOpen}
          dealReviewOpen={dealReviewOpen} setDealReviewOpen={setDealReviewOpen}
          gongCalls={gongCalls} gongCallsError={gongCallsError}
          gongExpandedId={gongExpandedId} setGongExpandedId={setGongExpandedId}
          fetchGongCalls={fetchGongCalls} gongEnrich={gongEnrich}
          expandedCallIds={expandedCallIds} setExpandedCallIds={setExpandedCallIds}
          copiedCallId={copiedCallId} setCopiedCallId={setCopiedCallId}
          editingScore={editingScore} setEditingScore={setEditingScore}
          draftScore={draftScore} setDraftScore={setDraftScore}
          expandedMedpicc={expandedMedpicc} setExpandedMedpicc={setExpandedMedpicc}
          appliedMedpicc={appliedMedpicc} setAppliedMedpicc={setAppliedMedpicc}
          addedNextSteps={addedNextSteps} setAddedNextSteps={setAddedNextSteps}
          dealReviewSections={dealReviewSections} dealReviewLoading={dealReviewLoading}
          dealReviewError={dealReviewError} dealReviewRegenKey={dealReviewRegenKey}
          generateDealReview={generateDealReview} updateDealReviewField={updateDealReviewField}
          intelQuery={intelQuery} setIntelQuery={setIntelQuery}
          intelAnswer={intelAnswer} intelLoading={intelLoading} askIntel={askIntel}
          generateFollowUpEmail={generateFollowUpEmail}
          setPendingActions={setPendingActions} setEditedActions={setEditedActions}
          setSelectedActionIdxs={setSelectedActionIdxs} setActionsPushed={setActionsPushed}
          linksAddOpen={linksAddOpen} setLinksAddOpen={setLinksAddOpen}
          linkLabelDraft={linkLabelDraft} setLinkLabelDraft={setLinkLabelDraft}
          linkUrlDraft={linkUrlDraft} setLinkUrlDraft={setLinkUrlDraft}
          newlyDetectedProds={newlyDetectedProds}/>
      )}

      {/* ── Comms panel ── */}
      {commsOpen&&(
        <div style={{ marginBottom:12, background:"#f59e0b06", border:"1px solid #f59e0b22", borderRadius:7, padding:"12px 14px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
            <span style={{ ...mono, fontSize:11, fontWeight:500, color:"#f59e0b", textTransform:"uppercase", letterSpacing:"0.08em" }}>✉ Comms — {acc.name}</span>
            <button onClick={()=>setCommsOpen(false)} style={{ marginLeft:"auto", background:"transparent", border:"none", color:C.dim, fontSize:14, cursor:"pointer", padding:0 }}>✕</button>
          </div>
          <AccountCardComms acc={acc} tasks={tasks} activeUser={activeUser} onUpdate={onUpdate}/>
        </div>
      )}

      {/* ── Extract panel ── */}
      {extractOpen&&(
        <AccountCardExtract acc={acc} tasks={tasks} activeUser={activeUser} onClose={()=>setExtractOpen(false)}/>
      )}

      {/* ── Deal Timeline panel ── */}
      {timelineOpen&&(<div style={{ marginBottom:12 }}><DealTimeline acc={acc} onUpdate={onUpdate}/></div>)}

      {/* ── Generate Outreach — reuses EmailModal, business accounts keep persona selection ── */}
      {outreachOpen && (
        <EmailModal account={acc} persona={topPersona} accountKind="business" onClose={()=>setOutreachOpen(false)} />
      )}

      <FollowUpEmailModal
        followUpEmail={followUpEmail} setFollowUpEmail={setFollowUpEmail}
        followUpDraftUrl={followUpDraftUrl} setFollowUpDraftUrl={setFollowUpDraftUrl}
        followUpCopied={followUpCopied} setFollowUpCopied={setFollowUpCopied}
        followUpSkipped={followUpSkipped} setFollowUpSkipped={setFollowUpSkipped}
        pendingActions={pendingActions}
        editedActions={editedActions} setEditedActions={setEditedActions}
        selectedActionIdxs={selectedActionIdxs} setSelectedActionIdxs={setSelectedActionIdxs}
        actionsPushed={actionsPushed} setActionsPushed={setActionsPushed}
        tasks={tasks} acc={acc} activeUser={activeUser} onCreateTask={onCreateTask}
      />
    </>
  );
});

export default AccountCardActionBar;
