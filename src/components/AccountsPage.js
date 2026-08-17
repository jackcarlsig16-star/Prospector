import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { C, mono } from '../constants/colors';
import { isStale, isWarn } from '../utils/staleness';
import { getActiveIntel, getActiveExamples, clientAssay, mapAssayResultToBusinessDetails } from '../utils/assay';
import { upsertAccountBusinessDetails, updateAccountRow } from '../utils/db';
import { PROD_COLOR, ALL_PRODUCTS } from '../constants/products';
import AccountCard, { DEAL_STAGES } from './AccountCard';
import LinkParentModal from './LinkParentModal';
import { AddAccountModal, DedupeModal, SfdcImportModal } from './AccountsUploadModal';
export { AddAccountModal } from './AccountsUploadModal';
import { loadManagerConfig } from './ManagerCommandCenter';
import { SignalLegendButton } from './SignalLegend';
import ActionItemsTab from './ActionItemsTab';
import ConnectionDot from './ConnectionDot';
import { getValidGmailToken } from '../utils/getValidGmailToken';
import { T } from '../constants/tokens';

// HUD aliases — backed by tokens
const NEON  = T.neon;
const AMBER = T.amber;
const RED   = T.red;
const TIER_HEX = { Gold: T.tier.gold, Silver: T.tier.silver, Tin: T.tier.tin, Slag: T.tier.slag };
const BDR_SELECTED_AE_KEY = 'prospector_bdr_selected_ae';

const loadManagerNotes = () => { try { return JSON.parse(localStorage.getItem("prospector_manager_notes")||"{}"); } catch { return {}; } };
const saveManagerNotes = n => localStorage.setItem("prospector_manager_notes", JSON.stringify(n));

// Small pure helpers duplicated from App.js (defined there at module scope)
const lastTouch = (acc) => acc.last;

// Stat tracker — no-op stub; real impl lives in App.js
const trackStat = (key, by = 1) => {
  try {
    const k = "prospector_stats";
    const stats = JSON.parse(localStorage.getItem(k) || "{}");
    stats[key] = (stats[key] || 0) + by;
    localStorage.setItem(k, JSON.stringify(stats));
  } catch {}
};


const normName   = n   => (n||"").toLowerCase().replace(/[^a-z0-9]/g," ").replace(/\s+/g," ").trim();
const normDomain = web => (web||"").replace(/^https?:\/\//i,"").replace(/^www\./i,"").replace(/\/.*$/,"").toLowerCase().trim();


function AccountsPage({ accounts, onSave, onAddAccount, onRemoveAccount, perms={}, frontier=[], onAssignToBDR, onUnassignFromFrontier, onFlagRemoval, jumpToId=null, onJumped, onNav, onOpenDealSummary, onCreateTask, onUpdateTask, tasks=[], activeRole="AE", activeUser={}, teamUsers=[], sfdcOpps=[], onSyncSfdc, sfdcSyncing=false, onSfdcOppsImported, managerSelectedAeId=null, business=null, onInfluencerUpdated, projects=[], accountListMap={}, onAccountLinkedToProject }) {
  const isManager = activeRole === "Manager";
  const isBDR = activeRole === "BDR";
  const [pageTab, setPageTab] = useState("accounts"); // "accounts" | "action_items"

  // BDR multi-AE support
  const assignedAEIds = isBDR ? (activeUser?.assignedAEs || []) : [];
  const assignedAEs = assignedAEIds.map(id => teamUsers.find(u=>u.id===id)).filter(Boolean);
  const [selectedAEId, setSelectedAEIdRaw] = useState(() => {
    try {
      const stored = localStorage.getItem(BDR_SELECTED_AE_KEY);
      if (stored === 'all') return null;
      if (stored) return stored;
    } catch {}
    return assignedAEs[0]?.id || null;
  });
  const setSelectedAEId = (id) => {
    setSelectedAEIdRaw(id);
    try { localStorage.setItem(BDR_SELECTED_AE_KEY, id == null ? 'all' : id); } catch {}
  };
  // Keep selectedAEId valid when assignedAEs changes (e.g. removed AE)
  const validSelectedAEId = assignedAEs.find(a=>a.id===selectedAEId) ? selectedAEId : (assignedAEs[0]?.id || null);
  const selectedAE = assignedAEs.find(a=>a.id===validSelectedAEId) || null;
  const bdrAccounts = isBDR && assignedAEs.length > 0 && selectedAE
    ? accounts.filter(a => (a.byId && a.byId === selectedAE.id) || a.by === selectedAE.name)
    : isBDR && assignedAEs.length === 1
    ? accounts.filter(a => (a.byId && a.byId === assignedAEs[0].id) || a.by === assignedAEs[0].name)
    : accounts;
  const visibleAccounts = isBDR ? bdrAccounts : accounts;
  const [managerConfig]  = useState(loadManagerConfig);
  const [managerNotes, setManagerNotes] = useState(loadManagerNotes);
  const saveNotes = (notes) => { setManagerNotes(notes); saveManagerNotes(notes); };
  const [aeF, setAeF] = useState("all"); // "all" or ae.id
  const [editingNoteId, setEditingNoteId]   = useState(null);
  const [noteDraft,     setNoteDraft]       = useState("");
  const mgAes = managerConfig?.aes || [];
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDedupeModal, setShowDedupeModal] = useState(false);
  const [sfdcBannerDismissed, setSfdcBannerDismissed] = useState(false);
  const [showSfdcModal, setShowSfdcModal] = useState(false);
  const [sfdcConnected, setSfdcConnected] = useState(() => !!localStorage.getItem('sfdc_access_token'));
  const [gmailStatus, setGmailStatus] = useState(() => {
    const tok = localStorage.getItem('gmail_access_token');
    if (!tok) return 'disconnected';
    const exp = Number(localStorage.getItem('gmail_token_expiry') || 0);
    if (exp && exp - Date.now() < 30 * 60 * 1000) return 'expiring';
    return 'connected';
  });
  // Silent boot check — if token gone or refresh fails, flip to red
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tok = await getValidGmailToken();
      if (cancelled) return;
      if (!tok) { setGmailStatus(localStorage.getItem('gmail_refresh_token') ? 'expiring' : 'disconnected'); return; }
      const exp = Number(localStorage.getItem('gmail_token_expiry') || 0);
      setGmailStatus(exp && exp - Date.now() < 30 * 60 * 1000 ? 'expiring' : 'connected');
    })();
    return () => { cancelled = true; };
  }, []);
  // Flush prospector_sfdc_queue: drain unsynced entries through /api/sfdc/update-opp
  useEffect(() => {
    if (!sfdcConnected) return;
    let cancelled = false;
    (async () => {
      let queue;
      try { queue = JSON.parse(localStorage.getItem('prospector_sfdc_queue') || '[]'); } catch { return; }
      const pending = queue.filter(x => !x.synced && x.oppId && x.nextStep);
      if (!pending.length) return;
      const token = localStorage.getItem('sfdc_access_token');
      const instance = localStorage.getItem('sfdc_instance_url');
      if (!token || !instance) return;
      let flushed = 0, failed = 0;
      for (const entry of pending) {
        if (cancelled) return;
        try {
          const r = await fetch('/api/sfdc/update-opp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken: token, instanceUrl: instance, oppId: entry.oppId, fields: { NextStep: entry.nextStep } }),
          });
          if (r.ok) {
            flushed++;
            try {
              const current = JSON.parse(localStorage.getItem('prospector_sfdc_queue') || '[]');
              localStorage.setItem('prospector_sfdc_queue', JSON.stringify(current.map(x => x.id === entry.id ? { ...x, synced: true, syncedAt: new Date().toISOString() } : x)));
            } catch {}
          } else {
            failed++;
          }
        } catch {
          failed++;
        }
        await new Promise(res => setTimeout(res, 500));
      }
      console.log(`[prospector_sfdc_queue] flushed ${flushed}, failed ${failed} of ${pending.length} pending`);
    })();
    return () => { cancelled = true; };
  }, [sfdcConnected]);
  const sfdcStatus = sfdcConnected
    ? (localStorage.getItem('sfdc_needs_reconnect') ? 'expiring' : 'connected')
    : 'disconnected';
  const handleSfdcDisconnect = () => {
    ['sfdc_access_token','sfdc_instance_url','sfdc_synced_at','sfdc_user_id','sfdc_user_name','sfdc_needs_reconnect'].forEach(k => localStorage.removeItem(k));
    setSfdcConnected(false);
  };
  const handleSfdcReconnect = () => { window.location.href = '/api/sfdc/auth'; };
  const [dismissedSfdcIds, setDismissedSfdcIds] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('prospector_sfdc_dismissed')||'[]')); } catch { return new Set(); }
  });
  const dismissSfdcOpps = (opps) => {
    setDismissedSfdcIds(prev => {
      const ids = opps.flatMap(o => [o.sfdcOppId, o.sfdcAccountId]).filter(Boolean);
      const next = new Set([...prev, ...ids]);
      try { localStorage.setItem('prospector_sfdc_dismissed', JSON.stringify([...next])); } catch {}
      return next;
    });
  };
  const [assayPromptAccs, setAssayPromptAccs] = useState([]);
  const [expanded,setExpanded]=useState(null);
  useEffect(()=>{
    if(!jumpToId)return;
    if(jumpToId==="open_assay"){
      setShowAssayModal(true);
      onJumped?.();
      return;
    }
    setExpanded(jumpToId);
    onJumped?.();
    setTimeout(()=>{
      const el=document.getElementById(`acct-${jumpToId}`);
      if(el)el.scrollIntoView({behavior:"smooth",block:"center"});
    },80);
  },[jumpToId]);
  const [tierFilters,setTierFilters]=useState([]);
  const [productFilters,setProductFilters]=useState([]);
  const [riskF,setRiskF]=useState(false);
  const [search,setSearch]=useState("");
  const [stageFilters,setStageFilters]=useState([]);
  const toggleFilter=(setArr,v)=>setArr(prev=>prev.includes(v)?prev.filter(x=>x!==v):[...prev,v]);
  const [favF,setFavF]=useState(false);
  const [assignedBdrF,setAssignedBdrF]=useState(null);
  const [prodExpanded,setProdExpanded]=useState(false);
  const [searchFocus,setSearchFocus]=useState(false);
  const [searchGhostIdx,setSearchGhostIdx]=useState(0);
  useEffect(() => {
    if (searchFocus || search) return;
    const t = setInterval(() => setSearchGhostIdx(i => (i + 1) % 1), 4000); // single placeholder for now; keep loop for blink alignment
    return () => clearInterval(t);
  }, [searchFocus, search]);
  const [favorites,setFavorites]=useState(()=>{try{return new Set(JSON.parse(localStorage.getItem("prospector_favorites")||"[]"));}catch{return new Set();}});
  useEffect(()=>{try{localStorage.setItem("prospector_favorites",JSON.stringify([...favorites]));}catch{}},[favorites]);
  const toggleFav=useCallback(id=>setFavorites(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;}),[]);
  const handleAccountUpdate=useCallback((updated)=>{
    if(!onSave)return;
    onSave(accounts.map(x=>x.id===updated.id?updated:x));
  },[accounts,onSave]);

  const [linkModalAcc,setLinkModalAcc]=useState(null);

  const handleLink=useCallback((childId,parentId)=>{
    if(!onSave||childId===parentId)return;
    onSave(accounts.map(a=>{
      if(a.id===childId)return{...a,parentId};
      if(a.id===parentId){
        const ids=a.childIds||[];
        return ids.includes(childId)?a:{...a,childIds:[...ids,childId]};
      }
      return a;
    }));
  },[accounts,onSave]);

  const handleUnlink=useCallback((childId)=>{
    if(!onSave)return;
    const child=accounts.find(a=>a.id===childId);
    if(!child?.parentId)return;
    if(!window.confirm("Unlink from parent?"))return;
    const parentId=child.parentId;
    onSave(accounts.map(a=>{
      if(a.id===childId){const next={...a};delete next.parentId;return next;}
      if(a.id===parentId)return{...a,childIds:(a.childIds||[]).filter(id=>id!==childId)};
      return a;
    }));
  },[accounts,onSave]);
  const openPricing=useCallback(id=>onNav&&onNav("tools",id),[onNav]);
  const openRoi=useCallback(id=>onNav&&onNav("tools","roi:"+id),[onNav]);
  const [reassaying,setReassaying]=useState(null);
  const [bulkRunning,setBulkRunning]=useState(false);
  const [bulkProgress,setBulkProgress]=useState(null);
  const [bulkPaused,setBulkPaused]=useState(false);
  const [showAssayModal,setShowAssayModal]=useState(false);
  const stopRef        = useRef(false);
  const pauseRef       = useRef(false);
  const bulkStartTime  = useRef(null);

  const todayStr=()=>new Date().toISOString().split("T")[0];
  // account-business-details-v1 — constructed client-side from the same
  // mapping the actual DB write uses (mapAssayResultToBusinessDetails), so
  // the account card shows the fresh result instantly instead of waiting on
  // a reload to re-fetch from account_business_details. The real upsert
  // happens separately (fire-and-forget) right after each onSave call.
  const localBusinessDetail=(accId,parsed)=>({account_id:accId,assessment_status:'assessed',last_assayed_at:new Date().toISOString(),...mapAssayResultToBusinessDetails(parsed)});
  const applyResult=(accs,acc,parsed,bulk=false)=>accs.map(a=>a.id===acc.id?{
    ...a,...parsed,
    sigs:parsed.keySignals?.length?parsed.keySignals:(a.sigs||[]),
    ucs:parsed.useCases?.length?parsed.useCases:(a.ucs||[]),
    prods:[...new Set(parsed.products?.length?parsed.products:(a.prods||[]))],
    bm:parsed.businessModel||a.bm||"",
    pf:parsed.productFit||a.pf||"",
    dis:parsed.disqualifier!==undefined?parsed.disqualifier:a.dis,
    linkedin:parsed.linkedin||a.linkedin||"",
    analyzed:true,
    businessDetail:localBusinessDetail(acc.id,parsed),
    ...(bulk?{lastBulkAssayed:todayStr()}:{})
  }:a);

  const reassay=useCallback(async(acc)=>{
    setReassaying(acc.id);
    try{
      const parsed=await clientAssay({name:acc.name,web:acc.web,vert:acc.vert,customIntel:getActiveIntel(),exampleAccts:getActiveExamples(),stage:acc.stage||"Prospecting",businessId:business?.id});
      if(acc.tier==="Slag"&&parsed.tier==="Gold") trackStat("reassay_upgrades");
      // If web was overridden (site unreachable workaround), persist the new URL
      const webPatch=acc.web!==accounts.find(a=>a.id===acc.id)?.web?{web:acc.web}:{};
      let updatedAcc=null;
      onSave(accounts.map(a=>{
        if(a.id!==acc.id) return a;
        updatedAcc={...a,...webPatch,...parsed,sigs:parsed.keySignals?.length?parsed.keySignals:(a.sigs||[]),ucs:parsed.useCases?.length?parsed.useCases:(a.ucs||[]),prods:parsed.products?.length?parsed.products:(a.prods||[]),bm:parsed.businessModel||a.bm||"",pf:parsed.productFit||a.pf||"",dis:parsed.disqualifier!==undefined?parsed.disqualifier:a.dis,linkedin:parsed.linkedin||a.linkedin||"",analyzed:true,businessDetail:localBusinessDetail(acc.id,parsed)};
        return updatedAcc;
      }));
      // assay-safety-and-intel-visibility-v1 — targeted single-row write,
      // the real confirmed persistence for this result (updateAccountRow,
      // utils/db.js). The generic full-array autosave still fires too via
      // setAccounts/onSave above — left as-is, not narrowed (audited safe
      // today; see specs/assay-safety-and-intel-visibility-v1.md Part 1).
      // Both writes below are now awaited (were previously fire-and-forget
      // with errors swallowed) so a failed save surfaces to the user instead
      // of the UI silently showing a result that never persisted.
      const [rowResult,detailResult]=await Promise.all([
        updatedAcc?updateAccountRow(acc.id,updatedAcc):Promise.resolve({error:null}),
        upsertAccountBusinessDetails(acc.id,mapAssayResultToBusinessDetails(parsed)),
      ]);
      if(rowResult.error||detailResult.error){
        alert(`Re-assay for "${acc.name}" completed but failed to save: ${rowResult.error||detailResult.error}\n\nThe new result is showing on screen but was NOT persisted — it will revert on next reload.`);
      }
    }catch(e){console.error(e);}
    setReassaying(null);
  },[accounts,onSave]);

  const BULK_BATCH=10;
  const PROGRESS_KEY="prospector_assay_progress";
  const ERRORS_KEY="prospector_assay_errors";

  const getSavedProgress=()=>{
    try{
      const p=JSON.parse(localStorage.getItem(PROGRESS_KEY)||"null");
      if(!p)return null;
      // Only valid if started within last 24h
      if(Date.now()-p.savedAt>86400000){localStorage.removeItem(PROGRESS_KEY);return null;}
      return p;
    }catch{return null;}
  };
  const saveProgress=(completed,total,lastCompletedIndex,completedIds,failedIds)=>
    localStorage.setItem(PROGRESS_KEY,JSON.stringify({completed,total,lastCompletedIndex,completedIds:completedIds||[],failedIds:failedIds||[],savedAt:Date.now(),startedAt:localStorage.getItem(PROGRESS_KEY)?JSON.parse(localStorage.getItem(PROGRESS_KEY)||"{}").startedAt||Date.now():Date.now()}));
  const clearProgress=()=>localStorage.removeItem(PROGRESS_KEY);
  const logError=(acc,err)=>{
    try{
      const errs=JSON.parse(localStorage.getItem(ERRORS_KEY)||"[]");
      errs.push({id:acc.id,name:acc.name,error:err,at:new Date().toISOString()});
      localStorage.setItem(ERRORS_KEY,JSON.stringify(errs.slice(-100)));
    }catch{}
  };

  const isRateLimit=(err)=>/429|rate.?limit|too many/i.test(err?.message||err||"");

  const assayOneWithRetry=async(acc,customIntel,exampleAccts,onStatus)=>{
    const run=()=>clientAssay({name:acc.name,web:acc.web,vert:acc.vert,customIntel,exampleAccts,stage:acc.stage||"Prospecting",businessId:business?.id});
    try{
      return await run();
    }catch(e1){
      const wait=isRateLimit(e1)?10000:3000;
      if(isRateLimit(e1))onStatus?.("ratelimit");
      await new Promise(r=>setTimeout(r,wait));
      onStatus?.("retry");
      try{
        return await run();
      }catch(e2){
        logError(acc,e2.message||"unknown error");
        return null;
      }
    }
  };

  const reassayAll=async(resumeFrom=0,resumeCompletedIds=[],resumeFailedIds=[],targetIds=null)=>{
    setBulkRunning(true);
    setBulkPaused(false);
    setShowAssayModal(false);
    stopRef.current=false;
    pauseRef.current=false;
    bulkStartTime.current=Date.now();

    const customIntel=getActiveIntel();
    const exampleAccts=getActiveExamples();
    const queue=targetIds
      ? accounts.filter(a=>targetIds.has(a.id)&&!a.assay_failed)
      : accounts.filter(a=>!a.assay_failed);
    const total=queue.length;
    let current=[...accounts];
    let batchTimes=[];
    let completedIds=[...resumeCompletedIds];
    let failedIds=[...resumeFailedIds];
    let persistFailedNames=[];

    for(let i=resumeFrom;i<queue.length;i++){
      if(stopRef.current){clearProgress();break;}
      if(pauseRef.current){
        saveProgress(i,total,i,completedIds,failedIds);
        setBulkPaused(true);
        setBulkRunning(false);
        setBulkProgress(null);
        return;
      }

      const acc=queue[i];
      const batchStart=Date.now();
      const avgMs=batchTimes.length?batchTimes.reduce((a,b)=>a+b,0)/batchTimes.length:6000;
      const etaMins=Math.round((avgMs*(queue.length-i))/60000);
      const etaStr=etaMins>1?`~${etaMins}m remaining`:"almost done";

      setBulkProgress({done:i,total,name:acc.name,eta:etaStr,resumed:resumeFrom>0,status:"running"});

      const parsed=await assayOneWithRetry(acc,customIntel,exampleAccts,(status)=>{
        if(status==="ratelimit") setBulkProgress(p=>({...p,status:"ratelimit",name:acc.name}));
        if(status==="retry")     setBulkProgress(p=>({...p,status:"retry",name:acc.name}));
      });

      if(parsed){
        current=applyResult(current,acc,parsed,true);
        completedIds.push(acc.id);
        // assay-safety-and-intel-visibility-v1 — same targeted single-row
        // write as reassay() above, awaited so a failed persist is caught
        // instead of the UI just moving on. Accumulated silently per-account
        // (an alert per row in a bulk loop would be unusable) and reported
        // once as a summary after the run finishes.
        const updatedAcc=current.find(a=>a.id===acc.id);
        const [rowResult,detailResult]=await Promise.all([
          updatedAcc?updateAccountRow(acc.id,updatedAcc):Promise.resolve({error:null}),
          upsertAccountBusinessDetails(acc.id,mapAssayResultToBusinessDetails(parsed)),
        ]);
        if(rowResult.error||detailResult.error) persistFailedNames.push(acc.name);
      }else{
        current=current.map(a=>a.id===acc.id?{...a,assay_failed:true}:a);
        failedIds.push(acc.id);
      }

      batchTimes.push(Date.now()-batchStart);
      if(batchTimes.length>20)batchTimes=batchTimes.slice(-20);

      saveProgress(i+1,total,i+1,completedIds,failedIds);

      if((i+1)%BULK_BATCH===0||(i+1)===queue.length){
        onSave([...current]);
      }

      if((i+1)%50===0){
        try{localStorage.setItem("prospector_accounts_autosave",JSON.stringify(current));}catch{}
      }

      if(i<queue.length-1)await new Promise(r=>setTimeout(r,1500));
    }

    onSave([...current]);
    clearProgress();
    setBulkRunning(false);
    setBulkProgress(null);
    stopRef.current=false;
    if(persistFailedNames.length){
      alert(`${persistFailedNames.length} account(s) re-assayed but failed to save and will revert on next reload: ${persistFailedNames.join(", ")}`);
    }
  };
  const filtered=useMemo(()=>{
    let r=[...visibleAccounts];
    if(search){
      const q=search.toLowerCase();
      r=r.filter(a=>
        a.name?.toLowerCase().includes(q) ||
        a.web?.toLowerCase().includes(q) ||
        a.vert?.toLowerCase().includes(q) ||
        a.state?.toLowerCase().includes(q) ||
        a.prods?.some(p=>p.toLowerCase().includes(q)) ||
        a.personas?.some(p=>p.name?.toLowerCase().includes(q))
      );
    }
    if(tierFilters.length>0)r=r.filter(a=>tierFilters.includes(a.tier));
    if(productFilters.length>0)r=r.filter(a=>productFilters.some(p=>a.prods?.includes(p)));
    if(stageFilters.length>0)r=r.filter(a=>stageFilters.includes(a.stage||"Prospecting"));
    if(riskF)r=r.filter(a=>isStale(lastTouch(a))||isWarn(lastTouch(a)));
    if(favF)r=r.filter(a=>favorites.has(a.id));
    if(aeF!=="all")r=r.filter(a=>a.aeId===aeF);
    if(assignedBdrF)r=r.filter(a=>frontier.some(f=>f.name.toLowerCase()===a.name.toLowerCase()&&(f.assignedToId===assignedBdrF.id||f.assignedTo===assignedBdrF.name)));
    if(managerSelectedAeId&&managerSelectedAeId!=='all')r=r.filter(a=>a.aeId===managerSelectedAeId);
    return r.sort((a,b)=>(a.score||9)-(b.score||9));
  },[visibleAccounts,tierFilters,productFilters,riskF,stageFilters,favF,favorites,search,aeF,assignedBdrF,frontier,managerSelectedAeId]);

  const childIdSet=useMemo(()=>new Set(filtered.flatMap(a=>a.childIds||[])),[filtered]);
  const topLevel=useMemo(()=>filtered.filter(a=>!childIdSet.has(a.id)),[filtered,childIdSet]);
  const parentNameById=useMemo(()=>{
    const m={};
    accounts.forEach(a=>{ m[a.id]=a.name; });
    return m;
  },[accounts]);

  const unmatchedSfdcOpps = useMemo(() =>
    sfdcOpps.filter(opp => {
      if (opp.sfdcOppId && dismissedSfdcIds.has(opp.sfdcOppId)) return false;
      if (opp.sfdcAccountId && dismissedSfdcIds.has(opp.sfdcAccountId)) return false;
      if (opp.sfdcOppId && accounts.some(a => a.sfdcOppId === opp.sfdcOppId)) return false;
      if (opp.sfdcAccountId && accounts.some(a => a.sfdcAccountId === opp.sfdcAccountId)) return false;
      if (accounts.some(a => normName(a.name) === normName(opp.name))) return false;
      const d = normDomain(opp.web);
      if (d && accounts.some(a => normDomain(a.web) === d)) return false;
      return true;
    }),
  [sfdcOpps, accounts, dismissedSfdcIds]);

  const handleImportSfdc = (opps) => {
    const now = new Date().toISOString();
    const newAccs = opps.map(opp => ({
      id: `acc_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
      name: opp.name, web: opp.web, vert: opp.vert, state: opp.state, city: opp.city || null,
      stage: opp.stage, sfdc: opp.sfdc, clientIds: opp.clientIds || [],
      source: opp.isHandoff ? "Inbound" : opp.source,
      by: activeUser.name, byId: activeUser.id,
      analyzed: false, sfdcOppId: opp.sfdcOppId, sfdcAccountId: opp.sfdcAccountId,
      sfdcImportedAt: now, handoffContext: opp.nbaNotes || "",
      isHandoff: opp.isHandoff || false,
      last: now.slice(0,10), addedAt: now, addedSource: "sfdc_import",
    }));
    newAccs.forEach(acc => onAddAccount(acc));
    setShowSfdcModal(false);
    setSfdcBannerDismissed(true);
    dismissSfdcOpps(opps);
    if (newAccs.length) setAssayPromptAccs(newAccs);
    onSfdcOppsImported && onSfdcOppsImported(opps);
  };

  const atRiskCount=visibleAccounts.filter(a=>isStale(lastTouch(a))).length;
  const warnCount=visibleAccounts.filter(a=>isWarn(lastTouch(a))).length;
  const tot=visibleAccounts.length;
  const cnt={Gold:0,Silver:0,Tin:0,Slag:0};
  visibleAccounts.forEach(a=>{if(cnt[a.tier]!==undefined)cnt[a.tier]++;});
  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
        {/* Tab strip */}
        <div style={{ display:'flex', gap:2, background:'#0a0a0a', border:`1px solid ${C.brd}`, borderRadius:6, padding:2 }}>
          {[['accounts',`Accounts (${tot})`],['action_items',`Action Items${tasks.filter(t=>t.source==='committed_action'&&t.status!=='Done'&&t.status!=='Stale'&&t.owner==='AE').length>0?` (${tasks.filter(t=>t.source==='committed_action'&&t.status!=='Done'&&t.status!=='Stale'&&t.owner==='AE').length})`:''}` ]].map(([id,lb])=>(
            <button key={id} onClick={()=>setPageTab(id)} style={{ ...mono, fontSize:12, padding:'4px 12px', borderRadius:4, border:'none', background:pageTab===id?C.card:'transparent', color:pageTab===id?C.txt:C.dim, cursor:'pointer', fontWeight:pageTab===id?500:400, transition:'all 0.15s' }}>{lb}</button>
          ))}
        </div>
        <div style={{ flex:1 }}/>
        {/* Connection status dots — visible to AE and Admin */}
        {!isBDR && !isManager && (
          <>
            <ConnectionDot
              service="SF"
              status={sfdcStatus}
              tooltip={
                sfdcStatus === 'connected'
                  ? `Salesforce connected · ${localStorage.getItem('sfdc_user_name') || ''}`
                  : sfdcStatus === 'expiring'
                  ? 'Salesforce token expiring · Click to reconnect'
                  : 'Salesforce disconnected · Click to connect'
              }
              detail={localStorage.getItem('sfdc_user_name') || ''}
              lastSync={localStorage.getItem('sfdc_synced_at')}
              onClick={handleSfdcReconnect}
              onDisconnect={handleSfdcDisconnect}
            />
            <ConnectionDot
              service="Gmail"
              status={gmailStatus}
              tooltip={
                gmailStatus === 'connected'
                  ? `Gmail connected · ${localStorage.getItem('gmail_email') || ''}`
                  : gmailStatus === 'expiring'
                  ? 'Gmail token expiring · Click to reconnect'
                  : 'Gmail disconnected · Click to connect'
              }
              detail={localStorage.getItem('gmail_email') || ''}
              onClick={() => { window.location.href = '/api/gmail/auth'; }}
              onDisconnect={() => {
                ['gmail_access_token','gmail_refresh_token','gmail_token_expiry','gmail_email'].forEach(k => localStorage.removeItem(k));
                setGmailStatus('disconnected');
              }}
            />
            {sfdcConnected && onSyncSfdc && (
              <button onClick={onSyncSfdc} disabled={sfdcSyncing}
                style={{ ...mono, fontSize:11, padding:'4px 10px', background:'transparent', border:`1px solid ${sfdcSyncing?NEON:'#333'}`, color:sfdcSyncing?NEON:'#888', borderRadius:2, cursor:sfdcSyncing?'default':'pointer', letterSpacing:'0.04em' }}>
                {sfdcSyncing ? 'SYNCING…' : '↻ SYNC'}
              </button>
            )}
          </>
        )}
        {onAddAccount&&<button onClick={()=>setShowAddModal(true)} style={{ ...mono, fontSize:11, padding:'4px 10px', background:'transparent', border:'1px solid #333', color:'#888', borderRadius:2, cursor:'pointer', letterSpacing:'0.04em' }}>+ ADD ACCOUNT</button>}
        {onSave&&<button onClick={()=>setShowDedupeModal(true)} style={{ ...mono, fontSize:11, padding:'4px 10px', background:'transparent', border:'1px solid #333', color:'#888', borderRadius:2, cursor:'pointer', letterSpacing:'0.04em' }}>⊕ DEDUPE</button>}
        <SignalLegendButton />
        {perms.canReassay&&(bulkRunning
          ? <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
              <div style={{ display:"flex", flexDirection:"column", gap:1 }}>
                <span style={{ ...mono, fontSize:11, color:bulkProgress?.status==="ratelimit"?C.orange:C.purple, whiteSpace:"nowrap" }}>
                  {bulkProgress?.status==="ratelimit"?"⏳ Rate limited — waiting 10s…":bulkProgress?.status==="retry"?"↺ Retrying…":`⬡ Assaying ${bulkProgress?.done||0} of ${bulkProgress?.total||0}${bulkProgress?.resumed?" (resumed)":""}`}
                </span>
                <span style={{ ...mono, fontSize:10, color:C.dim, whiteSpace:"nowrap" }}>
                  {bulkProgress?.name||"..."} · {bulkProgress?.eta||"calculating…"}
                </span>
              </div>
              <div style={{ width:`${bulkProgress?.total?Math.round((bulkProgress.done/bulkProgress.total)*100):0}%`, minWidth:60, maxWidth:120, height:4, background:C.purple, borderRadius:2, transition:"width 0.3s" }}/>
              <button onClick={()=>{pauseRef.current=true;}} style={{ ...mono, fontSize:11, padding:"4px 10px", background:"transparent", border:`1px solid ${C.orange}`, color:C.orange, borderRadius:4, cursor:"pointer" }}>⏸ Pause</button>
              <button onClick={()=>{stopRef.current=true;}} style={{ ...mono, fontSize:11, padding:"4px 10px", background:"transparent", border:`1px solid ${C.red}`, color:C.red, borderRadius:4, cursor:"pointer" }}>✕ Stop</button>
            </div>
          : (()=>{
              const saved=getSavedProgress();
              return <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                {saved&&(
                  <button onClick={()=>{setBulkPaused(false);reassayAll(saved.lastCompletedIndex||0,saved.completedIds||[],saved.failedIds||[]);}} style={{ ...mono, fontSize:12, padding:"5px 12px", background:`${C.purple}18`, border:`1px solid ${C.purple}44`, color:C.purple, borderRadius:5, cursor:"pointer", fontWeight:500 }}>
                    ▶ Resume assay ({saved.completed}/{saved.total} complete)
                  </button>
                )}
                <button onClick={()=>setShowAssayModal(true)} style={{ ...mono, fontSize:12, padding:"5px 12px", background:C.sur, border:`1px solid ${C.brd}`, color:C.mut, borderRadius:5, cursor:"pointer" }}>⬡ Assay…</button>
              </div>;
            })()
        )}
      </div>
      {/* SFDC import banner */}
      {!sfdcBannerDismissed && unmatchedSfdcOpps.length > 0 && (
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10, padding:"8px 14px", background:`${C.gold}12`, border:`1px solid ${C.gold}44`, borderRadius:7, flexWrap:"wrap" }}>
          <span style={{ ...mono, fontSize:12, color:C.gold }}>⬇ {unmatchedSfdcOpps.length} new account{unmatchedSfdcOpps.length!==1?"s":""} found in Salesforce</span>
          <button onClick={()=>handleImportSfdc(unmatchedSfdcOpps)}
            style={{ ...mono, fontSize:12, padding:"3px 10px", background:`${C.gold}22`, border:`1px solid ${C.gold}55`, color:C.gold, borderRadius:4, cursor:"pointer" }}>
            Import all
          </button>
          <button onClick={()=>setShowSfdcModal(true)} style={{ ...mono, fontSize:12, padding:"3px 10px", background:"transparent", border:`1px solid ${C.brd}`, color:C.mut, borderRadius:4, cursor:"pointer" }}>Review</button>
          <button onClick={()=>{ setSfdcBannerDismissed(true); dismissSfdcOpps(unmatchedSfdcOpps); }} style={{ background:"none", border:"none", color:C.dim, fontSize:14, cursor:"pointer", marginLeft:"auto", lineHeight:1 }}>✕</button>
        </div>
      )}
      {/* Success banner after SFDC import */}
      {assayPromptAccs.length > 0 && (
        <div style={{ marginBottom:10, padding:"10px 14px", background:`${C.green}0d`, border:`1px solid ${C.green}33`, borderRadius:7 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
            <span style={{ ...mono, fontSize:12, color:C.green, fontWeight:600 }}>
              ✓ {assayPromptAccs.length === 1 ? assayPromptAccs[0].name : `${assayPromptAccs.length} accounts`} imported from Salesforce
            </span>
            {assayPromptAccs.length === 1 && (
              <button
                onClick={()=>{
                  const id = assayPromptAccs[0].id;
                  setExpanded(id);
                  setTimeout(()=>{ const el=document.getElementById(`acct-${id}`); if(el)el.scrollIntoView({behavior:"smooth",block:"center"}); }, 80);
                }}
                style={{ ...mono, fontSize:12, padding:"3px 10px", background:`${C.blue}18`, border:`1px solid ${C.blue}44`, color:C.blue, borderRadius:4, cursor:"pointer" }}>
                Open account →
              </button>
            )}
            <button onClick={()=>{clearProgress();reassayAll(0,[],[],new Set(assayPromptAccs.map(a=>a.id)));setAssayPromptAccs([]);}}
              style={{ ...mono, fontSize:12, padding:"3px 10px", background:`${C.green}18`, border:`1px solid ${C.green}44`, color:C.green, borderRadius:4, cursor:"pointer" }}>
              Run assay
            </button>
            <button onClick={()=>setAssayPromptAccs([])}
              style={{ ...mono, fontSize:12, padding:"3px 10px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:4, cursor:"pointer" }}>
              Dismiss
            </button>
          </div>
          {assayPromptAccs.length > 1 && (
            <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:7 }}>
              {assayPromptAccs.map(a=>(
                <button key={a.id}
                  onClick={()=>{
                    setExpanded(a.id);
                    setTimeout(()=>{ const el=document.getElementById(`acct-${a.id}`); if(el)el.scrollIntoView({behavior:"smooth",block:"center"}); }, 80);
                  }}
                  style={{ ...mono, fontSize:11, padding:"2px 9px", background:`${C.blue}10`, border:`1px solid ${C.blue}33`, color:C.blue, borderRadius:4, cursor:"pointer" }}>
                  {a.name} →
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Manager: AE filter bar */}
      {isManager && mgAes.length > 0 && (
        <div style={{ display:"flex", gap:6, alignItems:"center", marginBottom:10, flexWrap:"wrap" }}>
          <span style={{ ...mono, fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.07em", marginRight:2 }}>AE</span>
          {[{id:"all",name:"All AEs"},...mgAes].map(ae=>{
            const active=aeF===ae.id;
            const cnt=ae.id==="all"?accounts.length:accounts.filter(a=>a.aeId===ae.id).length;
            return(
              <button key={ae.id} onClick={()=>setAeF(ae.id)}
                style={{ ...mono, fontSize:12, padding:"4px 11px", borderRadius:20, border:`1px solid ${active?C.blue:C.brd}`, background:active?`${C.blue}18`:"transparent", color:active?C.blue:C.mut, cursor:"pointer", display:"flex", alignItems:"center", gap:5, transition:"all 0.1s" }}>
                {ae.name}{ae.id!=="all"&&<span style={{ fontSize:10, opacity:0.7 }}>{cnt}</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* BDR: assigned AE toggle strip */}
      {isBDR && assignedAEs.length === 0 && (
        <div style={{ padding:"18px 0", marginBottom:10, textAlign:"center" }}>
          <span style={{ ...mono, fontSize:13, color:C.mut }}>No AEs assigned — contact your admin.</span>
        </div>
      )}
      {isBDR && assignedAEs.length >= 2 && (
        <div style={{ display:"flex", gap:6, alignItems:"center", marginBottom:10, flexWrap:"wrap" }}>
          <span style={{ ...mono, fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.07em", marginRight:2 }}>AE</span>
          {assignedAEs.map(ae=>{
            const active = validSelectedAEId === ae.id;
            return (
              <button key={ae.id} onClick={()=>setSelectedAEId(ae.id)}
                style={{ ...mono, fontSize:12, padding:"4px 11px", borderRadius:20, border:`1px solid ${active?C.blue:C.brd}`, background:active?`${C.blue}18`:"transparent", color:active?C.blue:C.mut, cursor:"pointer", transition:"all 0.1s" }}>
                {ae.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Action Items tab */}
      {pageTab === 'action_items' && <ActionItemsTab tasks={tasks} accounts={accounts} onCreateTask={onCreateTask} onUpdateTask={onUpdateTask} activeUser={activeUser} account={accounts.find(a=>a.id===expanded)||null} />}


      {/* Tier distribution crown — 3px progress-bar style under header */}
      {pageTab === 'accounts' && (
        <div title={`Gold ${cnt.Gold||0} · Silver ${cnt.Silver||0} · Tin ${cnt.Tin||0} · Slag ${cnt.Slag||0}`}
          style={{ height:3, background:'#0a0f0a', display:"flex", overflow:"hidden", gap:0, marginBottom:12, borderRadius:1 }}>
          {["Gold","Silver","Tin","Slag"].map(t=>(
            <div key={t} style={{ width:`${tot>0?(cnt[t]/tot)*100:0}%`, background:TIER_HEX[t], transition:"width 0.3s" }}/>
          ))}
        </div>
      )}

      {pageTab === 'accounts' && <>
      <style>{`@keyframes apBlink{50%{opacity:0}}`}</style>

      {/* ── ROW 1 — Search + Tier + Favorites + At Risk ──────────────────── */}
      <div style={{ display:"flex", gap:6, marginBottom:8, flexWrap:"wrap", alignItems:"center" }}>
        {/* Terminal search */}
        <div style={{ display:'flex', alignItems:'center', gap:6, height:28 }}>
          <span style={{ ...mono, fontSize:10, color:`${NEON}66`, letterSpacing:'0.08em', flexShrink:0 }}>◆ SEARCH</span>
          <div style={{ position:'relative', width:200 }}>
            <input
              value={search}
              onChange={e=>setSearch(e.target.value)}
              onFocus={()=>setSearchFocus(true)}
              onBlur={()=>setSearchFocus(false)}
              style={{ ...mono, width:'100%', boxSizing:'border-box', height:28, fontSize:13, padding:'0 28px 0 10px', background:T.bg.base, border:`1px solid ${searchFocus?NEON:`${NEON}33`}`, borderRadius:2, color:'#fff', outline:'none', caretColor:NEON, transition:'border-color 0.15s' }}
            />
            {!search && !searchFocus && (
              <span aria-hidden="true" style={{ ...mono, position:'absolute', left:11, top:'50%', transform:'translateY(-50%)', fontSize:13, color:`${NEON}4D`, pointerEvents:'none', whiteSpace:'nowrap' }}>
                Search accounts...
                <span style={{ marginLeft:2, color:NEON, animation:'apBlink 1s steps(2) infinite' }} key={searchGhostIdx}>▊</span>
              </span>
            )}
            {search && (
              <button onClick={()=>setSearch('')} style={{ ...mono, position:'absolute', right:6, top:'50%', transform:'translateY(-50%)', background:'transparent', border:'none', color:NEON, fontSize:14, cursor:'pointer', padding:'0 4px', lineHeight:1 }}>×</button>
            )}
          </div>
        </div>

        {/* Tier pills — outline only */}
        {(()=>{
          const tierPills = [
            { t:'All' },
            { t:'Gold',   ic:'◆' },
            { t:'Silver', ic:'◇' },
            { t:'Tin',    ic:'○' },
            { t:'Slag',   ic:'×' },
          ];
          return tierPills.map(({ t, ic })=>{
            const isAll = t==='All';
            const active = isAll ? tierFilters.length===0 : tierFilters.includes(t);
            const color = isAll ? NEON : TIER_HEX[t];
            return (
              <button key={t} onClick={()=>isAll?setTierFilters([]):toggleFilter(setTierFilters,t)}
                style={{ ...mono, height:28, fontSize:11, padding:'0 12px', borderRadius:2, letterSpacing:'0.04em',
                  border:`1px solid ${active?color:'#222'}`,
                  background:active?`${color}14`:'transparent',
                  color:active?color:'#666',
                  cursor:'pointer', display:'inline-flex', alignItems:'center', gap:5,
                  textShadow:active?`0 0 6px ${color}55`:'none', transition:'all 0.12s' }}>
                {isAll ? 'All' : <><span>{ic}</span> {t}</>}
                {!isAll && <span style={{ fontSize:10, opacity:0.7 }}>{cnt[t]||0}</span>}
              </button>
            );
          });
        })()}

        <span style={{ width:1, height:16, background:'#222', margin:'0 4px' }}/>

        <button onClick={()=>setFavF(!favF)}
          style={{ ...mono, height:28, fontSize:11, padding:'0 12px', borderRadius:2, letterSpacing:'0.04em',
            border:`1px solid ${favF?T.tier.gold:'#222'}`,
            background:favF?`${T.tier.gold}14`:'transparent',
            color:favF?T.tier.gold:'#666',
            cursor:'pointer', display:'inline-flex', alignItems:'center', gap:5,
            textShadow:favF?`0 0 6px ${T.tier.gold}55`:'none' }}>
          <span>★</span> Favorites
          {favorites.size>0 && <span style={{ fontSize:10, opacity:0.7 }}>{favorites.size}</span>}
        </button>

        <button onClick={()=>setRiskF(!riskF)}
          style={{ ...mono, height:28, fontSize:11, padding:'0 12px', borderRadius:2, letterSpacing:'0.04em',
            border:`1px solid ${riskF?AMBER:'#222'}`,
            background:riskF?`${AMBER}14`:'transparent',
            color:riskF?AMBER:'#666',
            cursor:'pointer', display:'inline-flex', alignItems:'center', gap:5,
            textShadow:riskF?`0 0 6px ${AMBER}55`:'none' }}>
          <span>⚠</span> At Risk
          {(atRiskCount+warnCount)>0 && <span style={{ fontSize:10, opacity:0.7 }}>{atRiskCount+warnCount}</span>}
        </button>
      </div>

      {/* ── ROW 2 — Stage · Assigned · Product (inline with | dividers) ──── */}
      {(()=>{
        // AE-scoped: BDRs assigned to this AE only. BDR: not shown (they have AE toggle instead).
        const myId = activeUser?.id || null;
        const myName = activeUser?.name || null;
        const isMine = (bdr) => myId
          ? (Array.isArray(bdr.assignedAEs) && bdr.assignedAEs.includes(myId))
            || (bdr.aeId && bdr.aeId === myId)
            || (myName && bdr.aeName === myName)
          : false;
        const bdrUsers = isBDR ? [] : teamUsers.filter(u =>
          u.role === 'BDR' &&
          isMine(u) &&
          frontier.some(f => f.assignedToId === u.id || f.assignedTo === u.name)
        );
        const shownProds = prodExpanded ? ALL_PRODUCTS : ALL_PRODUCTS.slice(0, 6);
        const hiddenCount = ALL_PRODUCTS.length - 6;

        const Divider = () => <span style={{ width:1, height:14, background:'#222', margin:'0 6px', alignSelf:'center' }}/>;
        const Label = ({ children }) => <span style={{ ...mono, fontSize:10, color:'#555', textTransform:'uppercase', letterSpacing:'0.1em', marginRight:5 }}>{children}</span>;

        return (
          <div style={{ display:'flex', gap:4, marginBottom:8, flexWrap:'wrap', alignItems:'center' }}>
            {/* STAGE */}
            <Label>Stage</Label>
            {DEAL_STAGES.map(s=>{
              const active = stageFilters.includes(s.id);
              return (
                <button key={s.id} onClick={()=>toggleFilter(setStageFilters,s.id)}
                  style={{ ...mono, fontSize:11, padding:'3px 9px', borderRadius:2, letterSpacing:'0.04em',
                    border:`1px solid ${active?s.c:`${s.c}33`}`,
                    background:active?`${s.c}1E`:'transparent',
                    color:active?s.c:`${s.c}AA`,
                    cursor:'pointer' }}>
                  {s.id}
                </button>
              );
            })}

            {/* ASSIGNED — only when AE has assigned BDRs */}
            {bdrUsers.length > 0 && (
              <>
                <Divider/>
                <Label>Assigned</Label>
                {bdrUsers.map(bdr=>{
                  const active = assignedBdrF?.id === bdr.id;
                  const initials = (bdr.name||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
                  const bdrCnt = frontier.filter(f => f.assignedToId===bdr.id || f.assignedTo===bdr.name).length;
                  return (
                    <button key={bdr.id} onClick={()=>setAssignedBdrF(active?null:bdr)}
                      style={{ ...mono, fontSize:11, padding:'3px 9px', borderRadius:2, letterSpacing:'0.04em',
                        border:`1px solid ${active?T.cyan:'#222'}`,
                        background:active?`${T.cyan}14`:'transparent',
                        color:active?T.cyan:'#666',
                        cursor:'pointer', display:'inline-flex', alignItems:'center', gap:5 }}>
                      <span style={{ width:15, height:15, borderRadius:'50%', background:active?`${T.cyan}22`:'#0a1818', border:`1px solid ${active?T.cyan:'#1a3a3a'}`, display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:8, color:active?T.cyan:'#5a7a7a', fontWeight:600 }}>{initials}</span>
                      {bdr.name.split(' ')[0]}
                      <span style={{ fontSize:10, opacity:0.7 }}>{bdrCnt}</span>
                    </button>
                  );
                })}
              </>
            )}

            {/* PRODUCT */}
            <Divider/>
            <Label>Product</Label>
            {shownProds.map(p=>{
              const active = productFilters.includes(p);
              const pc = PROD_COLOR[p] || NEON;
              return (
                <button key={p} onClick={()=>toggleFilter(setProductFilters,p)}
                  style={{ ...mono, fontSize:11, padding:'3px 9px', borderRadius:2, letterSpacing:'0.04em',
                    border:`1px solid ${active?pc:'#222'}`,
                    background:active?`${pc}22`:'transparent',
                    color:active?pc:'#666',
                    cursor:'pointer' }}>
                  {p}
                </button>
              );
            })}
            {!prodExpanded && hiddenCount>0 && (
              <button onClick={()=>setProdExpanded(true)} style={{ ...mono, fontSize:11, padding:'3px 9px', borderRadius:2, border:'1px solid #222', background:'transparent', color:'#666', cursor:'pointer' }}>+{hiddenCount} more</button>
            )}
            {prodExpanded && (
              <button onClick={()=>setProdExpanded(false)} style={{ ...mono, fontSize:11, padding:'3px 9px', borderRadius:2, border:'1px solid #222', background:'transparent', color:'#666', cursor:'pointer' }}>Show less</button>
            )}
          </div>
        );
      })()}

      {/* BDR — "VIEWING:" indicator showing whose territory */}
      {isBDR && assignedAEs.length > 0 && selectedAE && (
        <div style={{ ...mono, fontSize:10, color:'#5a6a5a', marginBottom:8, letterSpacing:'0.06em' }}>
          VIEWING: <span style={{ color:T.cyan }}>{selectedAE.name}'s territory</span>
          {assignedAEs.length > 1 && <span style={{ color:'#555' }}> · click an AE pill above to switch</span>}
        </div>
      )}

      {/* Active filter summary — slim single line, only when filters active */}
      {(tierFilters.length>0||productFilters.length>0||stageFilters.length>0||riskF||favF||search||assignedBdrF)&&(()=>{
        const chip = (key, label, onRemove) => (
          <span key={key} style={{ ...mono, fontSize:10, padding:'2px 7px', border:`1px solid ${NEON}55`, borderRadius:2, color:NEON, display:'inline-flex', alignItems:'center', gap:5, letterSpacing:'0.04em' }}>
            {label}
            <button onClick={onRemove} style={{ background:'transparent', border:'none', color:NEON, fontSize:11, cursor:'pointer', padding:0, lineHeight:1 }}>×</button>
          </span>
        );
        return (
          <div style={{ display:'flex', gap:5, alignItems:'center', marginBottom:12, flexWrap:'wrap' }}>
            <span style={{ ...mono, fontSize:11, color:'#5a6a5a' }}>
              Showing <span style={{ color:'#cfe8d4', fontWeight:500 }}>{filtered.length}</span> of {tot}
            </span>
            <span style={{ color:'#222' }}>·</span>
            {search && chip('q', `"${search}"`, ()=>setSearch(''))}
            {tierFilters.map(t => chip(`t-${t}`, t, ()=>setTierFilters(prev=>prev.filter(x=>x!==t))))}
            {stageFilters.map(sId => chip(`s-${sId}`, sId, ()=>setStageFilters(prev=>prev.filter(x=>x!==sId))))}
            {productFilters.map(p => chip(`p-${p}`, p, ()=>setProductFilters(prev=>prev.filter(x=>x!==p))))}
            {riskF && chip('risk', '⚠ At Risk', ()=>setRiskF(false))}
            {favF && chip('fav', '★ Favorites', ()=>setFavF(false))}
            {assignedBdrF && chip('bdr', `👤 ${assignedBdrF.name.split(' ')[0]}`, ()=>setAssignedBdrF(null))}
            <button onClick={()=>{setTierFilters([]);setProductFilters([]);setStageFilters([]);setRiskF(false);setFavF(false);setSearch('');setAssignedBdrF(null);}} style={{ ...mono, fontSize:10, padding:'2px 7px', background:'transparent', border:`1px solid #333`, color:'#5a6a5a', borderRadius:2, cursor:'pointer' }}>Clear all ×</button>
          </div>
        );
      })()}
      {topLevel.flatMap(parent=>{
        const kids=(parent.childIds||[]).map(cid=>filtered.find(x=>x.id===cid)).filter(Boolean);
        return [{a:parent,isChild:false},...kids.map(c=>({a:c,isChild:true}))];
      }).map(({a,isChild})=>{
        const assignedEntry=frontier.find(f=>f.name.toLowerCase()===a.name.toLowerCase()&&f.assignedTo);
        const hasNote = !!managerNotes[a.id]?.text;
        const aeOwner = isManager && mgAes.find(ae=>ae.id===a.aeId);
        const isExpanded = expanded===a.id;
        const assignedBdrUser = assignedEntry ? (teamUsers.find(u=>u.id===assignedEntry.assignedToId||u.name===assignedEntry.assignedTo)||{name:assignedEntry.assignedTo}) : null;
        const resolvedParentName = a.parentId ? (parentNameById[a.parentId]||null) : null;
        return (
          <div key={a.id} id={`acct-outer-${a.id}`} style={{ position:"relative", marginLeft:isChild?28:undefined, paddingLeft:isChild?8:undefined, borderLeft:isChild?`2px solid ${T.border.subtle}`:(isManager&&hasNote?`3px solid ${C.gold}`:undefined), borderRadius:isManager&&hasNote?8:undefined, marginBottom:isChild?4:(isManager&&hasNote?4:undefined) }}>
            {/* BDR assignee badge — shown when Assigned filter is active or account is assigned */}
            {!isManager && assignedBdrUser && (assignedBdrF || assignedEntry) && (
              <div style={{ position:"absolute", top:10, right:10, zIndex:10, display:"flex", alignItems:"center", gap:4 }}>
                <span style={{ ...mono, fontSize:9, color:"#4A9AE8", background:"#4A9AE814", border:"1px solid #4A9AE833", borderRadius:3, padding:"1px 7px", display:"flex", alignItems:"center", gap:4 }}>
                  <span style={{ width:13, height:13, borderRadius:"50%", background:"#4A9AE822", border:"1px solid #4A9AE855", display:"inline-flex", alignItems:"center", justifyContent:"center", fontSize:7, color:"#4A9AE8", fontWeight:700 }}>
                    {(assignedBdrUser.name||"?").split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2)}
                  </span>
                  {(assignedBdrUser.name||"").split(" ")[0]}
                </span>
              </div>
            )}
            {/* AE attribution badge */}
            {isManager && aeOwner && (
              <div style={{ position:"absolute", top:10, right:10, zIndex:10, display:"flex", alignItems:"center", gap:4 }}>
                <span style={{ ...mono, fontSize:9, color:C.blue, background:`${C.blue}14`, border:`1px solid ${C.blue}33`, borderRadius:3, padding:"1px 7px" }}>AE: {aeOwner.name.split(" ")[0]}</span>
                {onSave && (
                  <select value={a.aeId||""} onChange={e=>{const v=e.target.value;onSave(accounts.map(x=>x.id===a.id?{...x,aeId:v||undefined}:x));}}
                    style={{ ...mono, fontSize:9, padding:"1px 4px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:3, color:C.dim, cursor:"pointer" }}>
                    <option value="">— reassign</option>
                    {mgAes.map(ae=><option key={ae.id} value={ae.id}>{ae.name.split(" ")[0]}</option>)}
                  </select>
                )}
              </div>
            )}
            {isManager && !aeOwner && mgAes.length>0 && onSave && (
              <div style={{ position:"absolute", top:10, right:10, zIndex:10 }}>
                <select value="" onChange={e=>{const v=e.target.value;if(v)onSave(accounts.map(x=>x.id===a.id?{...x,aeId:v}:x));}}
                  style={{ ...mono, fontSize:9, padding:"1px 5px", background:`${C.orange}0d`, border:`1px solid ${C.orange}33`, borderRadius:3, color:C.orange, cursor:"pointer" }}>
                  <option value="">+ Assign AE</option>
                  {mgAes.map(ae=><option key={ae.id} value={ae.id}>{ae.name.split(" ")[0]}</option>)}
                </select>
              </div>
            )}
            <AccountCard acc={a} business={business} expanded={isExpanded} onToggle={()=>setExpanded(isExpanded?null:a.id)} onReassay={perms.canReassay?reassay:undefined} reassaying={reassaying===a.id} onUpdate={onSave?handleAccountUpdate:undefined} isFav={favorites.has(a.id)} onToggleFav={toggleFav} onRemove={onRemoveAccount||undefined} assignedEntry={assignedEntry||null} onAssign={onAssignToBDR} onUnassign={onUnassignFromFrontier} onFlagRemoval={onFlagRemoval} onOpenPricing={onNav?openPricing:undefined} onOpenRoi={onNav?openRoi:undefined} onOpenDealSummary={onOpenDealSummary||undefined} onCreateTask={onCreateTask} onUpdateTask={onUpdateTask} tasks={tasks} activeUser={activeUser} parentName={resolvedParentName} onRequestLinkParent={onSave?()=>setLinkModalAcc(a):undefined} onUnlinkParent={onSave?()=>handleUnlink(a.id):undefined} userEmail={activeUser?.email} canEdit={!!onSave} onUpdated={onInfluencerUpdated} projects={business?projects:[]} accountListIds={accountListMap[a.id]||[]} onAccountLinkedToProject={onAccountLinkedToProject}/>
            {/* Manager notes section — only visible to Manager */}
            {isManager && isExpanded && (
              <div style={{ margin:"0 0 6px 0", padding:"10px 14px", background:`${C.gold}06`, border:`1px solid ${C.gold}22`, borderTop:"none", borderRadius:"0 0 8px 8px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                  <span style={{ ...mono, fontSize:10, color:C.gold, textTransform:"uppercase", letterSpacing:"0.08em" }}>Manager Notes</span>
                  {managerNotes[a.id]?.updatedAt && <span style={{ ...mono, fontSize:9, color:C.dim }}>Updated {new Date(managerNotes[a.id].updatedAt).toLocaleDateString()}</span>}
                </div>
                {editingNoteId===a.id ? (
                  <div style={{ display:"flex", gap:6 }}>
                    <textarea value={noteDraft} onChange={e=>setNoteDraft(e.target.value)} rows={3}
                      style={{ flex:1, ...mono, fontSize:12, padding:"6px 8px", background:C.sur, border:`1px solid ${C.gold}44`, borderRadius:5, color:C.txt, outline:"none", resize:"vertical", boxSizing:"border-box" }}
                      onKeyDown={e=>{ if(e.key==="Escape"){ setEditingNoteId(null); } }}/>
                    <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                      <button onClick={()=>{ const updated={...managerNotes,[a.id]:{text:noteDraft,updatedAt:new Date().toISOString(),updatedBy:"Manager"}}; saveNotes(updated); setEditingNoteId(null); }}
                        style={{ ...mono, fontSize:11, padding:"4px 10px", background:C.goldBg, border:`1px solid ${C.goldBdr}`, color:C.gold, borderRadius:4, cursor:"pointer" }}>Save</button>
                      <button onClick={()=>setEditingNoteId(null)}
                        style={{ ...mono, fontSize:11, padding:"4px 10px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:4, cursor:"pointer" }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div onClick={()=>{ setNoteDraft(managerNotes[a.id]?.text||""); setEditingNoteId(a.id); }}
                    style={{ ...mono, fontSize:12, color:managerNotes[a.id]?.text?C.txt:C.dim, fontStyle:managerNotes[a.id]?.text?"normal":"italic", cursor:"pointer", padding:"4px 0", minHeight:20 }}>
                    {managerNotes[a.id]?.text || "+ Add manager note…"}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      {!filtered.length&&<div style={{ padding:32, textAlign:"center", color:C.mut, fontSize:15 }}>No accounts match</div>}
      {linkModalAcc&&(
        <LinkParentModal
          acc={linkModalAcc}
          allAccounts={accounts}
          onPick={parentId=>{ handleLink(linkModalAcc.id,parentId); setLinkModalAcc(null); }}
          onClose={()=>setLinkModalAcc(null)}
        />
      )}
      </>}
      {showAddModal&&onAddAccount&&<AddAccountModal onAdd={acc=>{onAddAccount(acc);}} onClose={()=>setShowAddModal(false)} businessId={business?.id}/>}
      {showDedupeModal&&onSave&&<DedupeModal accounts={accounts} onMerge={(merged,removeId)=>{onSave(accounts.map(a=>a.id===merged.id?merged:a).filter(a=>a.id!==removeId));}} onClose={()=>setShowDedupeModal(false)}/>}
      {showSfdcModal&&<SfdcImportModal opps={unmatchedSfdcOpps} accounts={accounts} onImport={handleImportSfdc} onClose={()=>{ setShowSfdcModal(false); dismissSfdcOpps(unmatchedSfdcOpps); }}/>}
      {showAssayModal&&(()=>{
        // Assay's fit/disqualifier logic is entirely business-shaped (no
        // creator-specific fields exist in clientAssay's prompt) - influencer
        // accounts have their own real assessment (CreatorFitRelationship),
        // not a hidden/disabled copy of this one. Confirmed live 2026-08-14:
        // all 26 of HumanKind's influencer accounts had picked up a stray,
        // meaningless business-fit score via this modal before this filter
        // existed. Match the single-card gating (AccountCard.js's
        // businessActions/reassay are already !isInfluencer-only).
        const isBiz=a=>(a.accountKind||'business')!=='influencer';
        const unassayed=accounts.filter(a=>isBiz(a)&&!a.score&&!a.assay_failed);
        const currentView=filtered.filter(a=>isBiz(a)&&!a.assay_failed);
        const everything=accounts.filter(a=>isBiz(a)&&!a.assay_failed);
        const opts=[
          { id:"new", label:"New accounts only", desc:"Accounts that haven't been scored yet", count:unassayed.length, c:C.green, target:()=>new Set(unassayed.map(a=>a.id)) },
          { id:"view", label:"Current view", desc:"Only accounts matching your active filters", count:currentView.length, c:C.blue, target:()=>new Set(currentView.map(a=>a.id)) },
          { id:"all", label:"Everything", desc:"Re-score all accounts, including ones already assayed", count:everything.length, c:C.purple, target:()=>null },
        ];
        return(
          <div onClick={()=>setShowAssayModal(false)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.65)", zIndex:3000, display:"flex", alignItems:"center", justifyContent:"center" }}>
            <div onClick={e=>e.stopPropagation()} style={{ width:420, background:C.card, border:`1px solid ${C.brd}`, borderRadius:12, padding:"22px 24px", boxShadow:"0 24px 64px rgba(0,0,0,0.6)" }}>
              <div style={{ display:"flex", alignItems:"center", marginBottom:18 }}>
                <p style={{ ...mono, margin:0, fontSize:11, color:C.purple, textTransform:"uppercase", letterSpacing:"0.08em", fontWeight:600, flex:1 }}>⬡ Assay Options</p>
                <button onClick={()=>setShowAssayModal(false)} style={{ background:"transparent", border:"none", color:C.dim, fontSize:18, cursor:"pointer" }}>✕</button>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {opts.map(o=>(
                  <button key={o.id} onClick={()=>{clearProgress();reassayAll(0,[],[],o.target());}} disabled={o.count===0}
                    style={{ display:"flex", alignItems:"center", gap:14, padding:"13px 16px", background:"transparent", border:`1px solid ${o.count>0?o.c+"44":C.brd}`, borderRadius:8, cursor:o.count>0?"pointer":"default", textAlign:"left", opacity:o.count===0?0.4:1, transition:"background 0.15s" }}
                    onMouseEnter={e=>{if(o.count>0)e.currentTarget.style.background=`${o.c}0d`;}}
                    onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}>
                    <div style={{ textAlign:"center", minWidth:38 }}>
                      <p style={{ ...mono, margin:0, fontSize:22, fontWeight:700, color:o.count>0?o.c:C.dim, lineHeight:1 }}>{o.count}</p>
                      <p style={{ ...mono, margin:0, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em" }}>accts</p>
                    </div>
                    <div>
                      <p style={{ margin:"0 0 2px", fontSize:13, fontWeight:500, color:o.count>0?C.txt:C.dim }}>{o.label}</p>
                      <p style={{ ...mono, margin:0, fontSize:11, color:C.mut }}>{o.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export default AccountsPage;
