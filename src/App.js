import React, { useState, useEffect, useMemo, useRef, useCallback, Suspense } from "react";
import { C, mono } from './constants/colors';
import { staleDays } from './utils/staleness';
import { URGENCY_OPTIONS, setBdrList } from './components/AccountCard';
import ToolsPage from './components/ToolsPage';
import PersistentScout from './components/PersistentScout';
import { getManagerScopedAccounts, getAeMap } from './utils/managerScope';
import AssayBanner from './components/AssayBanner';
import { startBulkAssay, isBulkAssayRunning } from './utils/bulkAssay';
import StaleSfdcBanner from './components/StaleSfdcBanner';
import ProfilePanel, { BadgeToast, BADGES, getQuarterKey, calcTerritoryBreakdown, calcTerritoryScore } from './components/BadgesProfile';
import { TaskModal } from './components/TaskPanel';
import HomePage from './components/HomePage';
import Sidebar from './components/Sidebar';
import GoogleConnections from './components/GoogleConnections';
import MicrosoftConnection from './components/MicrosoftConnection';
import BugReporter from './components/BugReporter';
import DailyDigest from './components/DailyDigest';
import ManagerCommandCenter from './components/ManagerCommandCenter';
import HandoffsPage from './components/HandoffsPage';
import { ROLE_PERMS, isAdmin } from './constants/appConfig';
import { APP_LEVEL_VIEWS } from './constants/businessNav';
import useMediaQuery from './utils/useMediaQuery';
import { trackStat, trackDailyStat } from './utils/stats';
import { indexAccountThreads } from './utils/threadIndexer';
import { fetchRecentThreads, generateBrief } from './components/DailyDigest';
import { loadCachedWeekAhead, buildWeekAhead } from './utils/weekAhead';
import { hasGoogle } from './utils/google';
import { saveToIdb, restoreFromIdb } from './utils/idb';
import { dedupeAccounts } from './utils/normAccount';
import { resolveUserId } from './utils/userIdentity';
import { getDefaultOutbound } from './utils/outbound';
import { getAllCompliance } from './utils/storage';
import { getACV } from './utils/ledgerEngine';
import { getTeamUsers, saveTeamUsers, getFrontier, saveFrontier, getAccounts, saveComplianceToDb, getBdrAssignments, getProjects, getBusinesses, getCampaignsForProjects } from './utils/db';
import BusinessesHomePage from './components/BusinessesHomePage';
import BusinessDetailPage from './components/BusinessDetailPage';
import TaskDrawer from './components/salesAnalytics/tasks/TaskDrawer';
import { isSupabaseEnabled } from './utils/supabase';

// Stage-change debug logger — remove once root cause is confirmed
const logStageChange = (trigger, name, oldStage, newStage) => {
  if (oldStage !== newStage) {
    console.warn(`[STAGE CHANGE] ${trigger} | ${name} | ${oldStage} → ${newStage}`);
  }
};
const logStageBatch = (trigger, prev, next) => {
  const prevMap = Object.fromEntries((Array.isArray(prev) ? prev : []).map(a => [a.id, a.stage]));
  (Array.isArray(next) ? next : []).forEach(a => {
    if (prevMap[a.id] !== undefined && prevMap[a.id] !== a.stage) {
      console.warn(`[STAGE CHANGE] ${trigger} | ${a.name} | ${prevMap[a.id]} → ${a.stage}`);
    }
  });
};

// Route-level code splitting — heavy pages loaded on demand
const AccountsPage          = React.lazy(() => import('./components/AccountsPage'));
const ProductionRequestsPage = React.lazy(() => import('./components/ProductionRequestsPage'));
const IntelligencePage      = React.lazy(() => import('./components/IntelligencePage'));
const UiKitGallery          = React.lazy(() => import('./ui/UiKitGallery'));
const AnalyticsPage         = React.lazy(() => import('./components/AnalyticsPage'));
const UploadsPage           = React.lazy(() => import('./components/UploadsPage'));
const ClaimJumperPage       = React.lazy(() => import('./components/ClaimJumperPage'));
const OutboundPage          = React.lazy(() => import('./components/FrontierPage'));
const IdeasPage             = React.lazy(() => import('./components/IdeasPage'));
const AdminPage             = React.lazy(() => import('./components/AdminPage'));
const LedgerPage            = React.lazy(() => import('./components/LedgerPage'));

// Google tokens now live server-side (src/utils/google.js). Older builds kept
// a refresh token here in the browser - don't leave it lying around.
try{["gmail_access_token","gmail_refresh_token","gmail_token_expiry","gmail_email","prospector_gmail_auth_error"].forEach(k=>localStorage.removeItem(k));}catch{}

// nav-admin-cleanup-v1 - the only top-level pages reachable. Everything else
// (Portfolio, Territory/Prod Requests, Ledger, Outbound, Ideas-global,
// Handoffs, Analytics, Intelligence, Uploads, Claim Jumper) is hidden: its
// code stays, but any navigation to it lands on the workspace list.
const VISIBLE_PAGES = ["businesses-home","business-detail","admin","voice-profile","google-connections","microsoft-connection","ui-kit"];

// Live BDR list — updated at runtime via teamUsers state, but AccountCard needs a static fallback
let BDR_LIST = [];

// AuthGate's signed-in person is who you are. The old app role (AE/Admin/
// Owner) still drives menus and the territory views: someone who already had
// one in this browser keeps it, anyone new gets it from their workspace role.
// Nobody picks it.
function userFromSession(me) {
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem("prospector_user") || "null"); } catch {}
  if (stored?.email?.toLowerCase() !== me.email) stored = null;
  const workspaceAdmin = me.memberships.some(m => m.role === "owner" || m.role === "admin");
  const role = stored?.role || (me.profile.is_platform_owner ? "Owner" : workspaceAdmin ? "Admin" : "AE");
  const user = { ...stored, id: stored?.id || me.profile.id, name: me.profile.display_name, email: me.email, role };
  try { localStorage.setItem("prospector_user", JSON.stringify(user)); } catch {}
  return user;
}

export default function App({ me }) {
  // Guard: skip Supabase sync effects until initial async load completes
  const supabaseReady = useRef(false);
  // True when the most recent account load fetched multiple owner_emails
  // (Manager/Admin/Owner team views) OR when impersonating any user. Drives
  // the read-only save guard: such loads must never autosave back, or the
  // owner_email partitions collapse. Set at load time, read by autosave.
  const loadedAsUnion = useRef(false);

  // viewAs declared HERE (not next to other UI state at ~1150) because the
  // accounts load effect below references viewAs in both its body and dep
  // array. Declaring it later in the component triggers a TDZ error on
  // render ("Cannot access 'viewAs' before initialization"). Keep this
  // declaration above the load effect; other UI state can stay below.
  const [viewAs,setViewAs]=useState(null); // null = self, or a user object from teamUsers

  // On mount: restore from IndexedDB if localStorage was cleared (cache wipe)
  useEffect(()=>{ restoreFromIdb().then(restored=>{ if(restored) window.location.reload(); }); },[]);
  // On mount: apply display mode preference
  useEffect(()=>{
    try{
      const prefs=JSON.parse(localStorage.getItem("prospector_prefs")||"{}");
      if(prefs.displayMode==="straight_shooter") document.body.classList.add("mode-straight-shooter");
      else document.body.classList.remove("mode-straight-shooter");
    }catch{}
  },[]);

  const [user,setUser]=useState(()=>userFromSession(me));
  const [page,setPage]=useState("businesses-home");
  const [accounts,setAccounts]=useState(()=>{
    try{
      const bl=JSON.parse(localStorage.getItem("prospector_removed_accounts")||"[]");
      const raw=JSON.parse(localStorage.getItem("prospector_accounts")||"null");
      const list=raw||[];
      if(!bl.length)return list;
      return list.filter(a=>!bl.some(x=>x.id===a.id||(a.sfdc&&x.sfdc&&x.sfdc===a.sfdc)||x.name.toLowerCase()===a.name.toLowerCase()));
    }catch{return [];}
  });
  const [accsLoaded,setAccsLoaded]=useState(false);
  useEffect(()=>{
    // ── SAFETY LAYERS — always run, never gated ────────────────────────
    // Both writes here back up PRIOR state or mirror existing localStorage;
    // neither writes the new in-memory `accounts` to a partition, so neither
    // can corrupt anything. They MUST live above the guard — gating them
    // (as b370e92 unintentionally did) silently disables the entire
    // disaster-recovery layer for Admin/Manager/impersonated sessions.
    const priorRaw = localStorage.getItem("prospector_accounts");
    if (priorRaw) {
      try { localStorage.setItem("prospector_accounts_autosave", priorRaw); } catch {}
    }
    saveToIdb();

    // ── GUARD — blocks only the destructive writes below ──────────────
    // Trips when the most recent load was a multi-email union (Manager/
    // Admin team view) OR when impersonating any user via viewAs. Either
    // case must NOT write back: saving the loaded union under user.email
    // would re-stamp foreign accounts and collapse owner_email partitions.
    if (loadedAsUnion.current) return;

    // ── DESTRUCTIVE writes — partition-touching, correctly gated ───────
    try{
      // Safety brake — if this write would shrink accounts by >50% AND prev was
      // non-trivial, refuse the new write. Prior state already preserved above.
      const prior = priorRaw ? JSON.parse(priorRaw) : null;
      if (Array.isArray(prior) && prior.length >= 20 && accounts.length < prior.length * 0.5) {
        console.warn(`[safety brake] refused account write: prior=${prior.length} → new=${accounts.length}. Prior preserved in prospector_accounts_autosave.`);
        return;
      }
      localStorage.setItem("prospector_accounts", JSON.stringify(accounts));
    } catch {}
    // Personal territory is retired (nav-admin-cleanup-v1): it stays in this
    // browser only. It used to mirror to Supabase with delete-not-in-set,
    // which sent a DELETE on every load for anyone with no personal accounts.
  },[accounts]);

  const [snapshots,setSnapshots]=useState(()=>{try{return JSON.parse(localStorage.getItem("prospector_snapshots")||"[]");}catch{return [];}});
  useEffect(()=>{
    if(!accounts.length)return;
    const todayKey=new Date().toISOString().slice(0,10);
    const { score, grade }=calcTerritoryScore(accounts);
    const analyzed=accounts.filter(a=>a.score).length;
    const snap={ date:todayKey, score, grade, analyzed, total:accounts.length,
      gold:accounts.filter(a=>a.tier==="Gold").length,
      silver:accounts.filter(a=>a.tier==="Silver").length,
      tin:accounts.filter(a=>a.tier==="Tin").length,
      slag:accounts.filter(a=>a.tier==="Slag").length };
    const next=[...snapshots.filter(s=>s.date!==todayKey),snap]
      .sort((a,b)=>a.date.localeCompare(b.date)).slice(-90);
    setSnapshots(next);
    try{localStorage.setItem("prospector_snapshots",JSON.stringify(next));}catch{}
  },[accounts]);

  // Territory event log — enrichment/reassay events with before/after tier counts
  const [territoryEvents,setTerritoryEvents]=useState(()=>{try{return JSON.parse(localStorage.getItem("prospector_territory_events")||"[]");}catch{return [];}});
  useEffect(()=>{try{localStorage.setItem("prospector_territory_events",JSON.stringify(territoryEvents));}catch{}},[territoryEvents]);
  // Baseline entry on first run
  useEffect(()=>{
    if(accounts.length&&!territoryEvents.length){
      const accs=accounts;
      setTerritoryEvents([{id:Date.now(),date:new Date().toISOString(),event:"baseline",label:"Territory baseline",total:accs.length,gold:accs.filter(a=>a.tier==="Gold").length,silver:accs.filter(a=>a.tier==="Silver").length,tin:accs.filter(a=>a.tier==="Tin").length,slag:accs.filter(a=>a.tier==="Slag").length}]);
    }
  // eslint-disable-next-line
  },[]);
  const logTerritoryEvent=(ev)=>setTerritoryEvents(evs=>[...evs,{id:Date.now(),date:new Date().toISOString(),...ev}].slice(-500));

  const [activeBatch,setActiveBatch]=useState(null);
  const saveBatch=batch=>{
    setActiveBatch(null);
    // Diamond: dormant batch with 3+ Gold accounts
    if(batch&&batch.uploadType==="dormant"&&(batch.gold||0)>=3)
      awardDiamond(1,`Dormant batch with ${batch.gold} Gold accounts: ${batch.fileName||"upload"}`,`dormant_gold_${batch.id}`);
  };

  const [stealthList,setStealthList]=useState(()=>{try{return JSON.parse(localStorage.getItem("prospector_stealth")||"[]");}catch{return [];}});
  useEffect(()=>{try{localStorage.setItem("prospector_stealth",JSON.stringify(stealthList));}catch{}},[ stealthList]);

  const [frontier,setFrontier]=useState(()=>{try{const s=localStorage.getItem("prospector_frontier");return s?JSON.parse(s):[];}catch{return [];}});
  useEffect(()=>{ if(!supabaseReady.current)return; saveFrontier(frontier.filter(f=>!f.isDemo)); },[frontier]);

  // Outbound enrichment listener — when an account is sent to Frontier via the
  // Outbound → button, merge a fresh outbound namespace (top contact + cadence
  // shell) into the matching frontier entry. Matching prefers the source
  // account id, falls back to name (legacy entries created without an id).
  useEffect(()=>{
    const handler = e => {
      const { accountId, accountName, web, topContact, alternateContacts } = e.detail || {};
      if (!accountId && !accountName) return;
      setFrontier(fl => fl.map(f => {
        const matches = (accountId && f.outbound?.sourceAccountId === accountId)
          || (accountName && f.name.toLowerCase() === accountName.toLowerCase());
        if (!matches) return f;
        if (f.outbound) return f;
        const base = getDefaultOutbound({ id: accountId, web });
        return { ...f, outbound: { ...base, topContact: topContact || base.topContact, alternateContacts: alternateContacts && alternateContacts.length ? alternateContacts : base.alternateContacts, sourceAccountId: accountId || base.sourceAccountId } };
      }));
    };
    window.addEventListener('prospector_outbound_enrich', handler);
    return () => window.removeEventListener('prospector_outbound_enrich', handler);
  },[]);

  // Salesforce OAuth callback — pick up token from URL after redirect
  useEffect(()=>{
    // OAuth success params arrive in the fragment (server.js callbacks); errors in the query.
    const params=new URLSearchParams(window.location.hash.slice(1)||window.location.search);
    const token=params.get("sfdc_token");
    const instance=params.get("sfdc_instance");
    const uid=params.get("sfdc_uid");
    const name=params.get("sfdc_name");
    const email=params.get("sfdc_email");
    const company=params.get("sfdc_company");
    const sfdcState=params.get("sfdc_state");
    const sfdcError=params.get("sfdc_error");
    if(token&&instance){
      localStorage.setItem("sfdc_access_token",token);
      localStorage.setItem("sfdc_instance_url",instance);
      localStorage.setItem("sfdc_synced_at",new Date().toISOString());
      try { localStorage.removeItem('sfdc_needs_reconnect'); } catch {}
      if(uid)localStorage.setItem("sfdc_user_id",uid);
      if(name)localStorage.setItem("sfdc_user_name",name);
      if(email)localStorage.setItem("sfdc_user_email",email);
      if(company)localStorage.setItem("sfdc_company",company);
      window.history.replaceState({},"","/");
      navTo("admin");
    }else if(sfdcError){
      window.history.replaceState({},"","/");
    }
  },[]);

  // Google connect result (api/google/callback.js) arrives as a query param.
  useEffect(()=>{
    const url=new URL(window.location.href);
    const err=url.searchParams.get("google_error");
    if(!err&&!url.searchParams.has("google_connected"))return;
    // prospector_google_auth_error: last failed Google connect, shown by the calendar widget until the next success.
    if(err)localStorage.setItem("prospector_google_auth_error",err);
    else localStorage.removeItem("prospector_google_auth_error");
    url.searchParams.delete("google_error");url.searchParams.delete("google_connected");
    window.history.replaceState({},"",url.pathname+url.search+url.hash);
  },[]);

  // Microsoft connect result (api/microsoft/callback.js) arrives as a query param; the callback returns to the page that started it.
  const [microsoftResult,setMicrosoftResult]=useState(null);
  useEffect(()=>{
    const url=new URL(window.location.href);
    const err=url.searchParams.get("microsoft_error");
    if(!err&&!url.searchParams.has("microsoft_connected"))return;
    setMicrosoftResult(err?{ok:false,text:err}:{ok:true,text:"Microsoft connected"});
    setPage("microsoft-connection");
    url.searchParams.delete("microsoft_error");url.searchParams.delete("microsoft_connected");
    window.history.replaceState({},"",url.pathname+url.search+url.hash);
  },[]);

  const [claimJumper,setClaimJumper]=useState(()=>{try{const s=localStorage.getItem("prospector_claimjumper");if(!s)return [];const parsed=JSON.parse(s);const clean=parsed.filter(a=>!a.id?.toString().startsWith("cj"));if(clean.length!==parsed.length)localStorage.setItem("prospector_claimjumper",JSON.stringify(clean));return clean;}catch{return [];}});
  useEffect(()=>{try{localStorage.setItem("prospector_claimjumper",JSON.stringify(claimJumper));}catch{}},[claimJumper]);

  const [nuggets,setNuggets]=useState(()=>{try{return JSON.parse(localStorage.getItem("prospector_golden_nuggets")||"[]");}catch{return [];}});
  useEffect(()=>{try{localStorage.setItem("prospector_golden_nuggets",JSON.stringify(nuggets));}catch{}},[nuggets]);

  const [sfdcOpps,setSfdcOpps]=useState([]);
  const [sfdcSyncing,setSfdcSyncing]=useState(false);

  const [tasks,setTasks]=useState(()=>{
    try{
      const STALE_MS=30*24*60*60*1000;
      const now=Date.now();
      const sweep=raw=>raw.map(t=>{
        const task=t.source?t:{...t,source:'manual'};
        if(task.status==='Open'&&task.dueDate&&(now-new Date(task.dueDate).getTime())>STALE_MS)
          return{...task,status:'Stale',archivedAt:new Date().toISOString()};
        return task;
      });
      const saved=JSON.parse(localStorage.getItem("prospector_tasks")||"null");
      if(saved) return sweep(saved);
      const old=JSON.parse(localStorage.getItem("prospector_todos")||"[]");
      return sweep(old.map(t=>({id:t.id,title:t.text,accId:t.accId||null,accName:t.accName||null,type:"Follow up",dueDate:"",priority:"Medium",assignee:"AE",status:t.done?"Done":"Open",pricingFileId:null,pricingFileName:null,notes:"",createdAt:t.createdAt||""})));
    }catch{return [];}
  });
  useEffect(()=>{try{localStorage.setItem("prospector_tasks",JSON.stringify(tasks));}catch{} saveToIdb();},[tasks]);
  const [taskModal,setTaskModal]=useState(null);
  const handleSaveTask=(task)=>{
    setTasks(ts=>{
      const prev=ts.find(t=>t.id===task.id);
      if(task.status==="Done"&&prev&&prev.status!=="Done") trackDailyStat("action_items_closed");
      const finalTask=task.status==="Done"&&!task.completedAt?{...task,completedAt:new Date().toISOString()}:task;
      return prev?ts.map(t=>t.id===task.id?finalTask:t):[...ts,finalTask];
    });
    setTaskModal(null);
  };

  const handleUpdateTask=(id,patch)=>{
    setTasks(ts=>{
      const prev=ts.find(t=>t.id===id);
      const isDoneTransition=patch.status==="Done"&&prev&&prev.status!=="Done";
      if(isDoneTransition) trackDailyStat("action_items_closed");
      const finalPatch=isDoneTransition?{...patch,completedAt:new Date().toISOString()}:patch;
      return ts.map(t=>t.id===id?{...t,...finalPatch}:t);
    });
  };

  const [winsLog,setWinsLog]=useState(()=>{
    try{
      const existing=JSON.parse(localStorage.getItem("prospector_wins_log")||"[]");
      // Backfill any Closed Won accounts not yet in the log
      const rawAccs=JSON.parse(localStorage.getItem("prospector_accounts")||"null")||[];
      const accMap=Object.fromEntries(rawAccs.map(a=>[a.id,a]));
      const existingIds=new Set(existing.map(w=>w.accountId));

      // Patch existing entries that have closedAt:null or acv:null using account proxy data
      const patched=existing.map(w=>{
        const needsDate=!w.closedAt;
        const needsAcv=w.acv==null;
        if(!needsDate&&!needsAcv) return w;
        const a=accMap[w.accountId];
        if(!a) return w;
        return {
          ...w,
          ...(needsDate ? {closedAt:a.activeDealAt||a.last||null} : {}),
          ...(needsAcv  ? {acv:getACV(a)}                         : {}),
        };
      });

      const backfill=rawAccs
        .filter(a=>(a.stage||"")==="Closed Won"&&!existingIds.has(a.id))
        .map(a=>({id:`win_bf_${a.id}`,accountId:a.id,accountName:a.name,tier:a.tier||null,closedAt:a.activeDealAt||a.last||null,acv:getACV(a),claimJumper:!!(a.claimedFrom==="claimjumper"||a.pool)}));

      if(backfill.length||patched.some((w,i)=>w!==existing[i])){
        const next=[...backfill,...patched];
        localStorage.setItem("prospector_wins_log",JSON.stringify(next));
        return next;
      }
      return existing;
    }catch{return [];}
  });
  useEffect(()=>{try{localStorage.setItem("prospector_wins_log",JSON.stringify(winsLog));}catch{}},[winsLog]);
  const prevAccountsRef=useRef(accounts);
  useEffect(()=>{
    const prev=prevAccountsRef.current;
    accounts.forEach(a=>{
      if((a.stage||"")==="Closed Won"){
        const old=prev.find(x=>x.id===a.id);
        if(!old||old.stage!=="Closed Won"){
          setWinsLog(log=>{
            if(log.some(w=>w.accountId===a.id))return log;
            const entry={id:`win_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,accountId:a.id,accountName:a.name,tier:a.tier||null,closedAt:new Date().toISOString(),acv:getACV(a),claimJumper:!!(a.claimedFrom==="claimjumper"||a.pool)};
            return [entry,...log];
          });
        }
      }
    });
    prevAccountsRef.current=accounts;
  },[accounts]);

  const [stats,setStats]=useState(()=>{try{return JSON.parse(localStorage.getItem("prospector_stats")||"{}");}catch{return {};}});
  const [earnedBadges,setEarnedBadges]=useState(()=>{try{return JSON.parse(localStorage.getItem("prospector_earned_badges")||"[]");}catch{return [];}});
  const [viewedBadges,setViewedBadges]=useState(()=>{try{return JSON.parse(localStorage.getItem("prospector_viewed_badges")||"[]");}catch{return [];}});
  const [badgeToast,setBadgeToast]=useState(null);
  const [profileOpen,setProfileOpen]=useState(false);
  const earnedBadgesRef=useRef(earnedBadges);
  earnedBadgesRef.current=earnedBadges;

  const [diamonds,setDiamonds]=useState(()=>{
    try{
      const s=JSON.parse(localStorage.getItem("prospector_diamonds")||"{}");
      const qk=getQuarterKey();
      if(s.quarter!==qk) return {quarter:qk,log:[]};
      return s;
    }catch{return {quarter:getQuarterKey(),log:[]};}
  });
  const [diamondTriggers,setDiamondTriggers]=useState(()=>{
    try{
      const s=JSON.parse(localStorage.getItem("prospector_diamond_triggers")||"{}");
      const qk=getQuarterKey();
      if(s.quarter!==qk) return {quarter:qk,fired:[]};
      return s;
    }catch{return {quarter:getQuarterKey(),fired:[]};}
  });
  const diamondTriggersRef=useRef(diamondTriggers);
  diamondTriggersRef.current=diamondTriggers;

  const awardDiamond=(amount,reason,triggerKey=null)=>{
    if(localStorage.getItem("prospector_diamonds_enabled")==="false") return;
    if(triggerKey&&diamondTriggersRef.current.fired.includes(triggerKey)) return;
    const entry={id:`d_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,amount,reason,earnedAt:new Date().toISOString()};
    setDiamonds(prev=>{
      const next={...prev,log:[entry,...prev.log]};
      localStorage.setItem("prospector_diamonds",JSON.stringify(next));
      return next;
    });
    if(triggerKey){
      setDiamondTriggers(prev=>{
        const next={...prev,fired:[...prev.fired,triggerKey]};
        localStorage.setItem("prospector_diamond_triggers",JSON.stringify(next));
        return next;
      });
      diamondTriggersRef.current={...diamondTriggersRef.current,fired:[...diamondTriggersRef.current.fired,triggerKey]};
    }
  };

  // Sync stats from child components that call trackStat() directly
  useEffect(()=>{
    const handler=()=>{try{setStats(JSON.parse(localStorage.getItem("prospector_stats")||"{}"));}catch{}};
    window.addEventListener("prospector_stats_changed",handler);
    return ()=>window.removeEventListener("prospector_stats_changed",handler);
  },[]);

  const [dailyStats,setDailyStats]=useState(()=>{try{const t=new Date().toISOString().slice(0,10);return JSON.parse(localStorage.getItem(`prospector_daily_${t}`)||"{}");}catch{return {};}});
  useEffect(()=>{
    const handler=()=>{try{const t=new Date().toISOString().slice(0,10);setDailyStats(JSON.parse(localStorage.getItem(`prospector_daily_${t}`)||"{}"));}catch{}};
    window.addEventListener("prospector_daily_changed",handler);
    return ()=>window.removeEventListener("prospector_daily_changed",handler);
  },[]);

  // Badge unlock check
  useEffect(()=>{
    const ctx={accounts,stats,tasks,stealthList,claimJumper,snapshots,nuggets,activeUser,winsLog};
    let toastShown=false;
    BADGES.forEach(badge=>{
      if(!earnedBadgesRef.current.includes(badge.id)&&badge.check(ctx)){
        setEarnedBadges(e=>{
          const next=[...e,badge.id];
          localStorage.setItem("prospector_earned_badges",JSON.stringify(next));
          return next;
        });
        if(!toastShown){setBadgeToast(badge);setTimeout(()=>setBadgeToast(null),4000);toastShown=true;}
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[accounts,stats,tasks,stealthList,nuggets]);

  const hasUnviewedBadges=earnedBadges.some(id=>!viewedBadges.includes(id));
  const appBreakdown=calcTerritoryBreakdown(accounts,snapshots);

  // Diamond trigger effects — grade-based
  useEffect(()=>{
    const grade=appBreakdown?.grade;
    if(!grade) return;
    const order=["F","D","D+","C-","C","C+","B-","B","B+","A-","A","A+"];
    const idx=order.indexOf(grade);
    if(idx>=order.indexOf("A"))     awardDiamond(5,"Territory grade reached A","grade_A");
    else if(idx>=order.indexOf("B"))awardDiamond(2,"Territory grade reached B","grade_B");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[appBreakdown?.grade]);

  // Closed Won from Claim Jumper — check both current accounts and persistent wins log
  useEffect(()=>{
    accounts.filter(a=>(a.claimedFrom==="claimjumper"||a.pool)&&(a.stage||"")==="Closed Won")
      .forEach(a=>awardDiamond(3,`Closed Won: ${a.name} (Claim Jumper)`,`cw_cj_${a.id}`));
    winsLog.filter(w=>w.claimJumper)
      .forEach(w=>awardDiamond(3,`Closed Won: ${w.accountName} (Claim Jumper)`,`cw_cj_${w.accountId}`));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[accounts,winsLog]);

  // Nugget shipped (for current user)
  useEffect(()=>{
    (nuggets||[]).filter(n=>n.status==="shipped"&&(n.realName||n.submittedBy)===(user?.name||""))
      .forEach(n=>awardDiamond(1,`Golden Nugget shipped: "${(n.summary||n.text||"").slice(0,60)}"`,`nugget_${n.id}`));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[nuggets]);

  // Algorithm override (Slag→Gold) — each upgrade earns +1
  useEffect(()=>{
    const count=stats.reassay_upgrades||0;
    for(let i=1;i<=count;i++) awardDiamond(1,"Algorithm override confirmed: Slag→Gold upgrade",`reassay_${i}`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[stats.reassay_upgrades]);

  // All Gold/Silver accounts touched within 90 days
  useEffect(()=>{
    const gs=accounts.filter(a=>a.tier==="Gold"||a.tier==="Silver");
    if(gs.length>=3&&gs.every(a=>staleDays(a.last)<90))
      awardDiamond(2,"All Gold/Silver accounts touched within 90 days","all_gs_90");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[accounts]);
  const openProfile=()=>{
    setProfileOpen(true);
    setViewedBadges(earnedBadges);
    localStorage.setItem("prospector_viewed_badges",JSON.stringify(earnedBadges));
  };

  const updatePoolEntry=(id,patch)=>setClaimJumper(p=>p.map(x=>x.id===id?{...x,...patch}:x));

  const claimAccount=(poolId,claimedBy)=>{
    const entry=claimJumper.find(x=>x.id===poolId);
    if(!entry)return;
    if(!window.confirm(`Claim "${entry.name}" from the pool? This removes it from Claim Jumper and adds it to your accounts.`))return;
    setAccounts(a=>[...a,{...entry,id:Date.now(),pool:false,claimedFrom:"claimjumper",claimedBy,claimedAt:new Date().toISOString(),stage:"Prospecting",last:new Date().toISOString().slice(0,10)}]);
    setClaimJumper(p=>p.filter(x=>x.id!==poolId));
    trackStat("accounts_claimed");
  };
  const claimMultiple=(poolIds,claimedBy)=>{
    const entries=claimJumper.filter(x=>poolIds.includes(x.id));
    if(!entries.length)return;
    if(!window.confirm(`Claim ${entries.length} account${entries.length===1?"":"s"} from the pool? This removes them from Claim Jumper and adds them to your accounts.`))return;
    setAccounts(a=>[...a,...entries.map((e,i)=>({...e,id:Date.now()+i,pool:false,claimedFrom:"claimjumper",claimedBy,claimedAt:new Date().toISOString(),stage:"Prospecting",last:new Date().toISOString().slice(0,10)}))]);
    setClaimJumper(p=>p.filter(x=>!poolIds.includes(x.id)));
    trackStat("accounts_claimed",poolIds.length);
  };
  const poolKey=a=>{
    // Normalize to SF account ID if available (strip full URL down to ID), otherwise fall back to lowercase name
    const sfdc=a.sfdc&&a.sfdc.trim();
    if(sfdc){
      const m=sfdc.match(/001[A-Za-z0-9]{12,15}/);
      if(m)return m[0];
      if(!sfdc.startsWith("http"))return sfdc;
    }
    return a.name.toLowerCase().trim();
  };
  const addToPool=(newAccounts,uploadedBy)=>setClaimJumper(p=>{
    const existingKeys=new Set(p.map(poolKey));
    const deduped=newAccounts.filter(a=>!existingKeys.has(poolKey(a)));
    if(deduped.length>0) console.log(`[addToPool] ${deduped.length} new entries added`);
    const tag={pool:true,uploadedBy:uploadedBy||user?.name||"AE",uploadedAt:new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}),poolAddedAt:new Date().toISOString()};
    if(deduped.length<newAccounts.length)console.log(`[Claim Jumper] Deduped ${newAccounts.length-deduped.length} duplicate(s) from batch`);
    return [...p,...deduped.map(a=>({...a,...tag}))];
  });

  // Assign an account to a BDR — creates/updates a frontier entry + auto-creates a task
  const assignToBDR=(acc, bdrId, note="", urgencyId="warm")=>{
    const bdr=teamUsers.find(u=>u.id===bdrId)||{id:bdrId,name:bdrId}; // fallback for legacy string calls
    const bdrName=bdr.name;
    const owner=activeUser||user;
    const urg=URGENCY_OPTIONS.find(u=>u.id===urgencyId)||URGENCY_OPTIONS[1];
    const dueDate=(()=>{const d=new Date();d.setDate(d.getDate()+urg.dueDays);return d.toISOString().slice(0,10);})();
    setFrontier(fl=>{
      const existing=fl.find(f=>f.name.toLowerCase()===acc.name.toLowerCase());
      if(!existing) trackStat("tasks_assigned_to_bdr");
      if(existing){
        return fl.map(f=>f.name.toLowerCase()===acc.name.toLowerCase()
          ?{...f, assignedTo:bdrName, assignedToId:bdr.id, by:owner.name, byId:owner.id, note:note||f.note, tier:acc.tier||f.tier, products:acc.prods||f.products, signals:acc.sigs||f.signals, web:acc.web||f.web, linkedin:acc.linkedin||f.linkedin, assignedAt:new Date().toISOString(), urgency:urgencyId, priority:urg.frontierPriority}
          :f);
      }
      const newEntry={
        id:`f${Date.now()}`, name:acc.name, by:owner.name, byId:owner.id, assignedTo:bdrName, assignedToId:bdr.id,
        status:"Have not touched yet", priority:urg.frontierPriority, useCase:(acc.ucs||[])[0]||"",
        sfdc:acc.sfdc||"", note, tier:acc.tier||null, products:acc.prods||[],
        signals:acc.sigs||[], web:acc.web||"", linkedin:acc.linkedin||"",
        assignedAt:new Date().toISOString(), urgency:urgencyId,
      };
      return [...fl, newEntry];
    });
    // Auto-create task
    const taskTitle=`${bdrName}: ${urg.emoji} ${urg.label} — ${acc.name}`;
    const newTask={
      id:Date.now(), title:taskTitle, accId:acc.id||null, accName:acc.name,
      type:"Follow up", dueDate, priority:urg.taskPriority,
      assignee:bdrName, assigneeId:bdr.id, assignedTo:bdrName, assignedToId:bdr.id,
      byId:owner.id, by:owner.name,
      status:"Open", pricingFileId:null, pricingFileName:null,
      notes:note||"", createdAt:new Date().toISOString(),
    };
    setTasks(ts=>[...ts, newTask]);
  };

  const unassignFromFrontier=(accName)=>setFrontier(fl=>fl.map(f=>f.name.toLowerCase()===accName.toLowerCase()?{...f,assignedTo:null,note:""}:f));
  const setFrontierStatus=(id,status)=>setFrontier(fl=>fl.map(f=>f.id===id?{...f,status}:f));

  const promoteToAccount=(entry)=>{
    const already=accounts.find(a=>a.stealthId===entry.id||a.name.toLowerCase()===entry.companyName.toLowerCase());
    if(already)return;
    const newAcc={ id:Date.now(), name:entry.companyName, web:entry.website||"", linkedin:entry.linkedinUrl||"", stealthOrigin:true, stealthId:entry.id, stage:"Prospecting", last:new Date().toISOString().slice(0,10) };
    setAccounts(a=>[...a,newAcc]);
    setStealthList(sl=>sl.map(x=>x.id===entry.id?{...x,status:"In Pipeline",promoted:true}:x));
  };

  const setSfStatus=(entryId,newSfStatus)=>{
    setStealthList(sl=>{
      const entry=sl.find(x=>x.id===entryId);
      if(!entry) return sl;
      if(newSfStatus==="in_sf"){
        // BDR marked it added — create a claim task for the AE
        const today=new Date().toISOString().split("T")[0];
        const name=entry.companyName||(entry.founderName?`${entry.founderName}'s startup`:"Unknown");
        setTasks(ts=>{
          if(ts.find(t=>t.stealthId===entryId&&t.type==="Salesforce"&&t.status!=="Done")) return ts;
          return [...ts,{id:Date.now(),title:`Claim ${name} in Salesforce`,type:"Salesforce",accId:null,accName:name,stealthId:entryId,priority:"High",assignee:"AE",status:"Open",dueDate:today,pricingFileId:null,pricingFileName:null,notes:"",createdAt:today}];
        });
      }
      return sl.map(x=>x.id===entryId?{...x,sfStatus:newSfStatus,sfFlaggedAt:newSfStatus==="missing"?new Date().toISOString():x.sfFlaggedAt}:x);
    });
  };

  const [removalQueue,setRemovalQueue]=useState(()=>{try{return JSON.parse(localStorage.getItem("prospector_removal_queue")||"[]");}catch{return [];}});
  useEffect(()=>{try{localStorage.setItem("prospector_removal_queue",JSON.stringify(removalQueue));}catch{}},[removalQueue]);

  // Permanently blocked accounts — restored only via Admin → Removed Accounts
  const [removedBlocklist,setRemovedBlocklist]=useState(()=>{
    try{return JSON.parse(localStorage.getItem("prospector_removed_accounts")||"[]");}catch{return [];}
  });
  useEffect(()=>{
    try{localStorage.setItem("prospector_removed_accounts",JSON.stringify(removedBlocklist));}catch{}
  },[removedBlocklist]);

  const addToBlocklist=(acc)=>setRemovedBlocklist(bl=>{
    if(bl.find(x=>x.id===acc.id))return bl;
    return [...bl,{id:acc.id,name:acc.name,sfdc:acc.sfdc||null,web:acc.web||null,tier:acc.tier||null,removedAt:new Date().toISOString()}];
  });
  const isBlocklisted=(acc,bl)=>bl.some(x=>
    x.id===acc.id||
    (acc.sfdc&&x.sfdc&&x.sfdc===acc.sfdc)||
    x.name.toLowerCase()===acc.name.toLowerCase()
  );
  // Use this instead of setAccounts when merging external data (uploads, SFDC sync)
  const saveAccounts=(next)=>setAccounts(prev=>{
    const bl=JSON.parse(localStorage.getItem("prospector_removed_accounts")||"[]");
    const list=typeof next==="function"?next(prev):next;
    return list.filter(a=>!isBlocklisted(a,bl));
  });

  const flagForRemoval=(acc,reason,flaggedBy)=>setRemovalQueue(q=>{
    if(q.find(x=>x.accId===acc.id))return q; // already flagged
    return [...q,{id:`rq${Date.now()}`,accId:acc.id,accName:acc.name,accWeb:acc.web||"",accTier:acc.tier||null,reason:reason||"No reason given",flaggedBy:flaggedBy||"BDR",flaggedAt:new Date().toISOString()}];
  });
  const dismissRemoval=(id)=>setRemovalQueue(q=>q.filter(x=>x.id!==id));
  const confirmRemoval=(item)=>{
    const acc=accounts.find(x=>x.id===item.accId);
    if(acc)addToBlocklist(acc);
    setAccounts(a=>a.filter(x=>x.id!==item.accId));
    setRemovalQueue(q=>q.filter(x=>x.id!==item.id));
  };

  const [teamUsers,setTeamUsers]=useState(getTeamUsers);
  useEffect(()=>{ if(!supabaseReady.current)return; saveTeamUsers(teamUsers); saveToIdb(); },[teamUsers]);
  useEffect(()=>{ BDR_LIST=teamUsers.filter(u=>u.role==="BDR"); setBdrList(BDR_LIST); },[teamUsers]);

  // On mount: load from Supabase if enabled, then unlock sync effects
  useEffect(()=>{
    const init=async()=>{
      if(isSupabaseEnabled()){
        const [users,items]=await Promise.all([getTeamUsers(),getFrontier()]);
        if(users.length>0){
          // AE/Admin: auto-assign BDRs that have no assignedAEs, then persist the roster.
          // The standalone auto-assign effect runs before supabaseReady, so it never
          // saves. Doing it here ensures the assignment is durable.
          let resolved=users;
          if(user?.id&&(user.role==="AE"||isAdmin(user))){
            const needsAssign=resolved.some(u=>u.role==="BDR"&&(!u.assignedAEs||u.assignedAEs.length===0));
            if(needsAssign){
              resolved=resolved.map(u=>u.role==="BDR"&&(!u.assignedAEs||u.assignedAEs.length===0)?{...u,assignedAEs:[user.id]}:u);
              saveTeamUsers(resolved);
            }
          }
          setTeamUsers(resolved);
          // BDR: sync assignedAEs from the roster entry back to local user object.
          if(user?.role==="BDR"){
            const myEntry=resolved.find(u=>u.id===user.id||(u.email&&u.email.toLowerCase()===user.email?.toLowerCase()));
            if(myEntry?.assignedAEs?.length&&!(user.assignedAEs?.length)){
              const patched={...user,assignedAEs:myEntry.assignedAEs};
              setUser(patched);
              try{localStorage.setItem("prospector_user",JSON.stringify(patched));}catch{}
            } else if(!myEntry?.assignedAEs?.length && user.email) {
              // Fallback: roster entry has no assignedAEs — check bdr_assignments table by email
              const aeEmails = await getBdrAssignments(user.email);
              if(aeEmails.length){
                const aeUsers = resolved.filter(u => aeEmails.map(e=>e.toLowerCase()).includes(u.email?.toLowerCase()));
                // If AE isn't in teamUsers yet, store their email directly — loadEmail handles it
                const aeIds = aeUsers.length ? aeUsers.map(u=>u.id) : aeEmails.map(e=>e.toLowerCase());
                if(aeIds.length){
                  const patched = {...user, assignedAEs: aeIds};
                  setUser(patched);
                  try{localStorage.setItem("prospector_user",JSON.stringify(patched));}catch{}
                  // Write back into the roster so future loads find it
                  const nextTeam = resolved.map(u=>
                    (u.id===user.id||(u.email&&u.email.toLowerCase()===user.email?.toLowerCase()))
                      ? {...u, assignedAEs: aeIds}
                      : u
                  );
                  setTeamUsers(nextTeam);
                  saveTeamUsers(nextTeam);
                }
              }
            }
          }
        }
        if(items.length>0) setFrontier(prev=>{
          const demo=prev.find(f=>f.isDemo);
          const real=items.filter(f=>!f.isDemo);
          return demo?[demo,...real]:real;
        });
      }
      supabaseReady.current=true;

      // One-time migration: push existing localStorage compliance to Supabase
      if(isSupabaseEnabled() && !localStorage.getItem('prospector_compliance_migrated')) {
        try {
          const local = JSON.parse(localStorage.getItem('prospector_compliance')||'{}');
          const accsRaw = JSON.parse(localStorage.getItem('prospector_accounts')||'null')||[];
          const entries = Object.entries(local);
          if(entries.length) {
            await Promise.all(entries.map(([accId, data]) => {
              const acc = accsRaw.find(a => String(a.id) === String(accId));
              return saveComplianceToDb(accId, data, acc?.name);
            }));
            localStorage.setItem('prospector_compliance_migrated','true');
            console.log(`[MIGRATION] Migrated ${entries.length} compliance records to Supabase`);
          }
        } catch(e) { console.warn('[MIGRATION] Compliance migration failed:', e.message); }
      }
    };
    init();
  },[]);

  // Real-time subscriptions removed — caused infinite read/write loop.
  // Supabase saves on explicit user actions; pull-to-sync via manual refresh or page load.

  // Accounts: load follows the ACTIVE VIEW (viewAs || user). Impersonating
  // re-fires the load so what you see matches what that person sees. The
  // save side is guarded by loadedAsUnion (set at load time) — multi-email
  // or impersonated loads are read-only; the owner_email partitions stay
  // untouched.
  //   AE / BDR (own or impersonated) → single-email load
  //   Manager (own or impersonated)  → [self + direct reports]  (union)
  //   Owner (no impersonation)       → [own email]  (own scope, editable)
  //   Admin (no impersonation)       → [self + all teammates]    (union, RO)
  //   Owner/Admin impersonating      → falls through to impersonated role
  useEffect(()=>{
    if(!user?.email){ setAccsLoaded(true); return; }
    if(!isSupabaseEnabled()){ setAccsLoaded(true); return; }
    const bl=JSON.parse(localStorage.getItem("prospector_removed_accounts")||"[]");
    const active = viewAs || user;
    const isBDR = active.role === "BDR";
    const isMgr = active.role === "Manager";
    const admin = isAdmin(active);
    const team = teamUsers.length
      ? teamUsers
      : (() => { try { return JSON.parse(localStorage.getItem("prospector_team_users")||"[]"); } catch { return []; } })();

    const loadEmails = (() => {
      if (isBDR) {
        const aids = active.assignedAEs || [];
        if (!aids.length) return [active.email];
        const ae = team.find(u => u.id === aids[0] || u.email?.toLowerCase() === aids[0]?.toLowerCase());
        return [ae?.email || (aids[0]?.includes('@') ? aids[0] : active.email)];
      }
      if (isMgr) {
        // Manager (own or impersonated): self + direct reports
        const reports = team.filter(u => u.reportsTo === active.id).map(u => u.email).filter(Boolean);
        return Array.from(new Set([active.email, ...reports]));
      }
      if (admin) {
        // Owner default = own scope (editable); Admin default = all-team (RO).
        // Reach team scope from Owner by explicitly picking a Manager/Admin via viewAs.
        if (!viewAs && active.role === 'Owner') return [active.email];
        const all = team.map(u => u.email).filter(Boolean);
        return Array.from(new Set([active.email, ...all]));
      }
      // AE (own or impersonated): just their own territory
      return [active.email];
    })();

    // Read-only if the load fetches multiple emails OR any impersonation is
    // active. Editable only when: not impersonating AND single-email load.
    loadedAsUnion.current = loadEmails.length > 1 || !!viewAs;

    getAccounts(loadEmails).then(accs=>{
      const list = accs || [];
      const filtered=list.filter(a=>!bl.some(x=>x.id===a.id||(a.sfdc&&x.sfdc&&x.sfdc===a.sfdc)||x.name?.toLowerCase()===a.name?.toLowerCase()));
      setAccounts(prev => {
        // Merge: strictly additive on protected fields. If local has data for a
        // protected field, NEVER let an empty/missing Supabase value overwrite it.
        // For all other fields, DB still wins (stage moves forward, SFDC linkage updates, etc).
        const PROTECTED = ['tier','score','analyzed','headline','blurb','assayedAt','disqualifier','confidence','fit','signals','sigs','bm','pf','ucs','prods','byId','aeId','city','state','ledgerRank'];
        const hasValue = v => {
          if (v === null || v === undefined) return false;
          if (typeof v === 'string') return v.trim() !== '';
          if (Array.isArray(v)) return v.length > 0;
          return true;
        };
        const localById = Object.fromEntries(prev.map(a => [String(a.id), a]));
        const merged = filtered.map(incoming => {
          const local = localById[String(incoming.id)];
          if (!local) return incoming;
          const result = { ...incoming };
          PROTECTED.forEach(f => {
            if (hasValue(local[f])) result[f] = local[f];
          });
          return result;
        });
        // Union: local-only accounts (no matching id in Supabase) must survive the merge.
        // The previous filtered.map alone dropped them, which is why 474 collapsed to 68.
        const dbIds = new Set(filtered.map(d => String(d.id)));
        prev.forEach(local => {
          if (!dbIds.has(String(local.id))) merged.push(local);
        });
        // Step 4 — in-memory dedup pass: collapse same-business duplicates
        // (sfdcOppId → sfdcAccountId → normalized name → normalized domain),
        // keeping the higher contextScore. Memory only — no Supabase deletion.
        const deduped = dedupeAccounts(merged);
        logStageBatch('Supabase load', prev, deduped);
        return deduped;
      });
      setAccsLoaded(true);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[user?.email, user?.id, user?.role,
     viewAs?.id, viewAs?.role, viewAs?.email,
     teamUsers.length, user?.assignedAEs?.length]);

  // Real-time accounts subscription removed — same infinite loop risk.

  // One-time migration: stamp a stable id on prospector_user.
  // v2 re-runs the resolver so Owners whose user.id was previously
  // populated with a gate-generated UUID get re-stamped with their
  // deterministic slug (owner_{local}).
  useEffect(() => {
    if (!user) return;
    if (localStorage.getItem("prospector_migrated_user_id") === "v2") return;
    const id = resolveUserId(user);
    if (!id) return;
    if (id !== user.id) {
      setUser(prev => {
        const next = { ...prev, id };
        try { localStorage.setItem("prospector_user", JSON.stringify(next)); } catch {}
        return next;
      });
    }
    localStorage.setItem("prospector_migrated_user_id", "v2");
  }, [user?.email]);

  // One-time migration: backfill byId + aeId. v4 reads directly from
  // localStorage and writes the patched array directly back BEFORE calling
  // setAccounts — bypassing React's render-cycle batching that caused
  // v2/v3 to silently get overwritten by the async Supabase fetch's
  // setAccounts when both queued in the same tick. localStorage is the
  // source of truth; setAccounts just syncs React state so the in-memory
  // accounts match.
  useEffect(() => {
    if (!user) return;
    if (localStorage.getItem("prospector_migrated_account_attribution") === "v4") return;
    const targetId = resolveUserId(user);
    if (!targetId) return;

    let current;
    try { current = JSON.parse(localStorage.getItem("prospector_accounts") || "[]"); } catch { return; }
    if (!Array.isArray(current)) return;

    let changed = false;
    const next = current.map(a => {
      const patch = {};
      if (!a.byId) { patch.byId = targetId; changed = true; }
      const effectiveById = patch.byId || a.byId;
      if (!a.aeId) { patch.aeId = effectiveById || targetId; changed = true; }
      return Object.keys(patch).length ? { ...a, ...patch } : a;
    });

    if (changed) {
      try {
        // Rolling autosave (safety brake's pattern) before overwriting.
        const prior = localStorage.getItem("prospector_accounts");
        if (prior) localStorage.setItem("prospector_accounts_autosave", prior);
        localStorage.setItem("prospector_accounts", JSON.stringify(next));
      } catch {}
      setAccounts(next);
      console.log(`[migration v4] Repaired byId/aeId on ${next.filter((a,i) => a.byId !== current[i].byId || a.aeId !== current[i].aeId).length} of ${current.length} accounts → ${targetId}`);
    }
    localStorage.setItem("prospector_migrated_account_attribution", "v4");
  }, [user?.email]);


  // One-time migration: add byId/assignedToId to accounts and frontier using name→id lookup.
  // v2: also stamps by/byId on accounts that have neither (assigns to current logged-in user).
  useEffect(()=>{
    if(!teamUsers.length||!user) return;
    if(localStorage.getItem("prospector_migrated_ids")==="v2") return;
    const byName={}; teamUsers.forEach(u=>{if(u.name)byName[u.name.toLowerCase()]=u.id;});
    setAccounts(prev=>{
      const next=prev.map(a=>{
        // Already has both — nothing to do
        if(a.byId&&a.by) return a;
        // Has by but no byId — look up id
        if(a.by&&!a.byId) return {...a, byId:byName[a.by.toLowerCase()]||null};
        // Has byId but no by — leave as-is
        if(a.byId&&!a.by) return a;
        // Has neither — stamp with current logged-in user
        return {...a, by:user.name, byId:user.id};
      });
      try{localStorage.setItem("prospector_accounts",JSON.stringify(next));}catch{}
      return next;
    });
    setFrontier(prev=>{
      const next=prev.map(f=>({...f,
        byId:f.byId||(f.by?byName[f.by.toLowerCase()]||null:null),
        assignedToId:f.assignedToId||(f.assignedTo?byName[f.assignedTo.toLowerCase()]||null:null),
      }));
      try{localStorage.setItem("prospector_frontier",JSON.stringify(next));}catch{}
      return next;
    });
    localStorage.setItem("prospector_migrated_ids","v2");
  },[teamUsers.length, user?.id]);

  // Auto-assign unassigned BDRs to current user (AE/Admin) on first load
  useEffect(()=>{
    if(!user?.id) return;
    if(user.role!=="AE"&&!isAdmin(user)) return;
    const needsUpdate=teamUsers.some(u=>u.role==="BDR"&&(!u.assignedAEs||u.assignedAEs.length===0));
    if(!needsUpdate) return;
    setTeamUsers(prev=>{
      const next=prev.map(u=>u.role==="BDR"&&(!u.assignedAEs||u.assignedAEs.length===0)?{...u,assignedAEs:[user.id]}:u);
      try{localStorage.setItem("prospector_team_users",JSON.stringify(next));}catch{}
      return next;
    });
  },[user?.id]);

  // ── Projects ──
  // Projects now nest under a business (business_id) rather than gating the
  // whole app - see navigation-restructure-v1. myProjects stays loaded here
  // (same prop-drilled-from-App.js pattern as myBusinesses) so BusinessDetailPage
  // can filter to its own projects and BusinessesHomePage can surface any
  // legacy rows that predate business_id as "Unassigned".
  const [myProjects, setMyProjects] = useState([]);
  useEffect(() => {
    if (!user?.email) { return; }
    let cancelled = false;
    getProjects().then(projects => {
      if (cancelled) return;
      setMyProjects(projects);
    });
    return () => { cancelled = true; };
  }, [user?.email]);

  // campaign-layer-v1 — same prop-drilled-from-App.js pattern as myProjects
  // above. Campaigns have no owner_email of their own (nested under a
  // Project, which already carries ownership), so they're fetched by the
  // already-loaded myProjects' ids rather than a second owner-scoped query.
  const [myCampaigns, setMyCampaigns] = useState([]);
  useEffect(() => {
    if (!myProjects.length) { setMyCampaigns([]); return; }
    let cancelled = false;
    getCampaignsForProjects(myProjects.map(p => p.id)).then(campaigns => {
      if (cancelled) return;
      setMyCampaigns(campaigns);
    });
    return () => { cancelled = true; };
  }, [myProjects]);

  // ── Businesses (standalone from projects - separate tree, same
  // real-supabase-auth-v1-not-finished caveat as above) ──────────────────
  const [myBusinesses, setMyBusinesses] = useState([]);
  const [activeBusiness, setActiveBusiness] = useState(null);
  // Stable identity (empty deps - setActiveBusiness/setMyBusinesses are
  // React state setters, always stable regardless of render) - passing an
  // inline closure here instead was a real, live infinite-fetch loop:
  // BusinessDetailPage's load() useCallback depends on this prop, an
  // unstable identity on every App.js render made load() re-identify every
  // render too, its useEffect([load]) re-fired every render, load() called
  // this same handler again -> setActiveBusiness -> another App.js render,
  // forever, gated only by network round-trip time (~230ms observed live).
  // Confirmed via a real network capture: ~4-5 req/s to /api/businesses/:id
  // on a completely idle business-detail page, for as long as it stayed
  // open, on any business, unrelated to any single feature.
  const onBusinessUpdated = useCallback(b => {
    setActiveBusiness(b);
    setMyBusinesses(prev => prev.map(x => x.id === b.id ? b : x));
  }, []);
  // Sub-nav for a selected business's own workspace (business-nav-architecture-v1),
  // same pattern as accountsSubPage/toolsActiveTool - lifted here so both Sidebar
  // (renders the nav) and BusinessDetailPage (renders the matching view) read it.
  const [businessPage, setBusinessPage] = useState('command-center');
  const compact = useMediaQuery('(max-width: 899px)');
  const [digestOpen, setDigestOpen] = useState(false);
  const [bugOpen, setBugOpen] = useState(false);
  const [businessesLoading, setBusinessesLoading] = useState(true);
  useEffect(() => {
    if (!user?.email) { setBusinessesLoading(false); return; }
    let cancelled = false;
    setBusinessesLoading(true);
    getBusinesses().then(businesses => {
      if (cancelled) return;
      setMyBusinesses(businesses);
      setBusinessesLoading(false);
      // An accepted invite lands here as /?business=<id> (auth/InvitePage.js).
      const landId = new URLSearchParams(window.location.search).get('business');
      if (landId) {
        const landing = businesses.find(b => b.id === landId);
        if (landing) { setActiveBusiness(landing); setBusinessPage('command-center'); setPage('business-detail'); }
        window.history.replaceState({}, '', '/');
      }
    });
    return () => { cancelled = true; };
  }, [user?.email]);

  // ── Gmail thread indexer — background, fire-and-forget ────────────────────
  const threadIndexerRan = useRef(false);
  useEffect(() => {
    if (threadIndexerRan.current) return;
    if (!accsLoaded) return;
    threadIndexerRan.current = true;
    const activeAccounts = accounts.filter(a => a.stage === 'Active Deal');
    indexAccountThreads(activeAccounts);
  }, [accsLoaded, accounts]);

  // ── Auto bulk assay — fires when >10 unscored accounts load, gated by a
  // 24h localStorage cooldown so it can't refire on every page refresh.
  const autoAssayRan = useRef(false);
  useEffect(() => {
    if (autoAssayRan.current) return;
    if (!accsLoaded) return;
    if (localStorage.getItem('prospector_auto_assay_disabled') === '1') return;
    const lastRun = parseInt(localStorage.getItem('prospector_auto_assay_last') || '0', 10);
    if (Date.now() - lastRun < 24 * 60 * 60 * 1000) return;
    const unscored = accounts.filter(a => !a.score && !a.assay_failed && a.web).length;
    if (unscored <= 10) return;
    if (isBulkAssayRunning()) return;
    autoAssayRan.current = true;
    try { localStorage.setItem('prospector_auto_assay_last', String(Date.now())); } catch {}
    startBulkAssay({ accounts, onSaveAccounts: setAccounts });
  }, [accsLoaded, accounts]);

  // ── Eager Brief + WeekAhead — once per session after auth + accounts load ──
  const briefEagerRan = useRef(false);
  useEffect(() => {
    if (briefEagerRan.current) return;
    if (!accsLoaded) return;
    briefEagerRan.current = true;
    (async () => {
      if (!(await hasGoogle('gmail'))) return;
      const d = new Date();
      const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      // Brief — only if no valid today cache
      let cachedBrief = null;
      try { cachedBrief = JSON.parse(localStorage.getItem(`prospector_morning_brief_${ds}`) || 'null'); } catch {}
      if (!cachedBrief) {
        fetchRecentThreads()
          .then(msgs => (msgs && msgs.length) ? generateBrief(msgs, accounts, tasks) : null)
          .then(result => {
            if (!result) return;
            const stamped = { ...result, generatedAt: Date.now() };
            try { localStorage.setItem(`prospector_morning_brief_${ds}`, JSON.stringify(stamped)); } catch {}
            window.dispatchEvent(new CustomEvent('prospector_brief_updated'));
          })
          .catch(e => console.warn('[brief eager] failed', e));
      }
      // Week Ahead — only on Monday, only if no cache for this week
      if (d.getDay() === 1 && !loadCachedWeekAhead()) {
        buildWeekAhead().catch(e => console.warn('[weekAhead eager] failed', e));
      }
    })();
  }, [accsLoaded, accounts, tasks]);

  // ── Ideas (Golden Nuggets) unread badge ───────────────────────────────────
  const [ideasLastViewed, setIdeasLastViewed] = useState(() => parseInt(localStorage.getItem('prospector_ideas_last_viewed') || '0', 10));
  const newNuggetCount = nuggets.filter(n => n.submittedAt && new Date(n.submittedAt).getTime() > ideasLastViewed).length;
  const onViewIdeas = () => {
    const now = Date.now();
    localStorage.setItem('prospector_ideas_last_viewed', String(now));
    setIdeasLastViewed(now);
  };

  // Admin join notifications — track which active team members the admin has already seen
  const SEEN_JOINERS_KEY = "prospector_seen_joiners";
  const [seenJoiners,setSeenJoiners]=useState(()=>{try{return new Set(JSON.parse(localStorage.getItem(SEEN_JOINERS_KEY)||"[]"));}catch{return new Set();}});
  const newJoiners = teamUsers.filter(u=>u.status==="active" && u.id !== user?.id && !seenJoiners.has(u.id));
  const newJoinCount = isAdmin(user) ? newJoiners.length : 0;
  const dismissJoinNotifs = () => {
    const next = new Set([...seenJoiners, ...newJoiners.map(u=>u.id)]);
    setSeenJoiners(next);
    try{localStorage.setItem(SEEN_JOINERS_KEY,JSON.stringify([...next]));}catch{}
  };

  const [accountsSubPage, setAccountsSubPage] = useState("territory");

  const [rolePerms,setRolePerms]=useState(()=>{try{const s=localStorage.getItem("prospector_role_perms");return s?{...ROLE_PERMS,...JSON.parse(s)}:ROLE_PERMS;}catch{return ROLE_PERMS;}});
  useEffect(()=>{try{localStorage.setItem("prospector_role_perms",JSON.stringify(rolePerms));}catch{}},[rolePerms]);

  // viewAs moved up to ~L80 — see comment there. Do NOT re-declare here.
  const [selectedAeId,setSelectedAeId]=useState('all'); // Manager-only scope filter
  const [accountsJumpId,setAccountsJumpId]=useState(null);
  const [toolsLaunchId,setToolsLaunchId]=useState(null);  // account ID to pre-fill in tools
  const [toolsActiveTool,setToolsActiveTool]=useState("deal");
  const activeUser = viewAs || user;
  const activeRole = activeUser?.role || "AE";
  const perms = rolePerms[activeRole] || rolePerms.AE || ROLE_PERMS.AE;

  // Reset Manager AE scope to 'all' whenever identity flips so a previous
  // Manager session's pick doesn't carry into a new viewAs.
  useEffect(() => { setSelectedAeId('all'); }, [viewAs?.id]);

  const managerTeamAEs = useMemo(() =>
    activeRole === 'Manager' && activeUser?.id
      ? teamUsers.filter(u => u.role === 'AE' && u.reportsTo === activeUser.id)
      : [],
    [teamUsers, activeUser, activeRole]
  );

  const managerScopedAeId = activeRole === 'Manager' ? selectedAeId : null;

  // scout-global-persistent-v1 — the persistent Scout mount's "Territory"
  // scope (non-business pages): same accounts a Manager already sees
  // elsewhere (team + optional single-AE filter via the pill row above),
  // otherwise the plain territory list unchanged from before consolidation.
  const scoutTerritoryAccounts = useMemo(
    () => activeRole === 'Manager' ? getManagerScopedAccounts(accounts, managerTeamAEs, selectedAeId) : accounts,
    [activeRole, accounts, managerTeamAEs, selectedAeId]
  );
  const scoutAeMap = useMemo(
    () => activeRole === 'Manager' ? getAeMap(managerTeamAEs) : {},
    [activeRole, managerTeamAEs]
  );
  const scoutAllBusinessesConfirmed = !!teamUsers.find(u => u.id === activeUser?.id)?.scoutAllBusinessesConfirmed;

  const updateTeamUser = useCallback((id, patch) => {
    setTeamUsers(prev => {
      const next = prev.map(u => u.id === id ? { ...u, ...patch } : u);
      try { localStorage.setItem("prospector_team_users", JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const syncSfdc = async () => {
    const tok  = localStorage.getItem("sfdc_access_token");
    const inst = localStorage.getItem("sfdc_instance_url");
    if (!tok || !inst) return;
    setSfdcSyncing(true);
    try {
      const res = await fetch("/api/sfdc/my-accounts", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          sfdcToken: tok,
          sfdcInstance: inst,
          sfdcUserId: localStorage.getItem("sfdc_user_id") || null,
          ownerName: activeUser?.name || "AE",
        }),
      });
      const data = await res.json();
      if (data.accounts) {
        try { localStorage.setItem("sfdc_synced_at", new Date().toISOString()); } catch {}
        setSfdcOpps(data.accounts);
        // Patch existing accounts with fresh clientIds / SFDC IDs from the sync
        setAccounts(prev => {
          let changed = false;
          const next = prev.map(acc => {
            const match = data.accounts.find(sf =>
              (sf.sfdcOppId && sf.sfdcOppId === acc.sfdcOppId) ||
              (sf.sfdcAccountId && sf.sfdcAccountId === acc.sfdcAccountId) ||
              sf.name?.toLowerCase() === acc.name?.toLowerCase()
            );
            if (!match) return acc;
            const patch = {};
            if (match.clientIds?.length && JSON.stringify(match.clientIds) !== JSON.stringify(acc.clientIds)) {
              patch.clientIds = match.clientIds;
              patch.clientIdDetails = match.clientIdDetails || [];
            }
            if (match.sfdcOppId && match.sfdcOppId !== acc.sfdcOppId) patch.sfdcOppId = match.sfdcOppId;
            if (match.sfdcAccountId && match.sfdcAccountId !== acc.sfdcAccountId) patch.sfdcAccountId = match.sfdcAccountId;
            if (match.state && match.state !== acc.state) patch.state = match.state;
            if (match.city && match.city !== acc.city) patch.city = match.city;
            if (!Object.keys(patch).length) return acc;
            changed = true;
            return { ...acc, ...patch };
          });
          return changed ? next : prev;
        });
      }
    } catch(e) { console.warn("SFDC sync failed:", e); }
    finally { setSfdcSyncing(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{ const t=setTimeout(syncSfdc,3000); return ()=>clearTimeout(t); },[activeUser?.id]);

  useEffect(()=>{
    if(!accounts?.length)return;
    const last=localStorage.getItem("prospector_pr_summary_last");
    if(last&&Date.now()-new Date(last).getTime()<24*60*60*1000)return;
    const compRaw=localStorage.getItem("prospector_compliance");
    if(!compRaw)return;
    let complianceMap;
    try{complianceMap=JSON.parse(compRaw);}catch{return;}
    if(!complianceMap||!Object.keys(complianceMap).length)return;
    try{localStorage.setItem("prospector_pr_summary_last",new Date().toISOString());}catch{}
    import('./utils/prSummary').then(({generatePRSummaries})=>{
      generatePRSummaries(accounts,complianceMap);
    }).catch(e=>console.warn("[prSummary] import failed",e));
  },[accounts]);

  const [staleDismissed,  setStaleDismissed]  = useState(false);

  // Must be above all early returns — hooks can't be conditional, navTo used in OAuth callbacks
  // Admin follows real roles (business_members), not the old AE/Admin app role.
  const showAdmin=!!me.profile.is_platform_owner||me.memberships.some(m=>m.role==="owner"||m.role==="admin");
  const showUiKit=!!me.profile.is_platform_owner||me.memberships.some(m=>m.role==="owner");
  const onBusinessFeaturesChanged=useCallback((id,features)=>{
    setMyBusinesses(prev=>prev.map(b=>b.id===id?{...b,features}:b));
    setActiveBusiness(b=>b?.id===id?{...b,features}:b);
  },[]);
  useEffect(()=>{
    if(!VISIBLE_PAGES.includes(page)||(page==="admin"&&!showAdmin)||(page==="ui-kit"&&!showUiKit)||(page==="business-detail"&&!activeBusiness)) setPage("businesses-home");
  },[page,showAdmin,showUiKit,activeBusiness]);
  const navTo=(pg,tab)=>{
    if(pg==="accounts"||APP_LEVEL_VIEWS.includes(pg)){
      if(activeBusiness){ setBusinessPage(pg); setPage("business-detail"); }
      else setPage("businesses-home");
    } else setPage(VISIBLE_PAGES.includes(pg)?pg:"businesses-home");
    const tabStr=tab!=null?String(tab):null;
    if(pg==="tools"&&tabStr&&tabStr.startsWith("roi:")){setToolsLaunchId(tab.slice(4));setToolsActiveTool("deal");}
    else if(pg==="tools"&&tabStr==="roi"){setToolsActiveTool("deal");}
    else if(pg==="tools"&&tabStr==="pricing"){setToolsActiveTool("deal");}
    else if(pg==="tools"&&tabStr){setToolsLaunchId(tabStr);setToolsActiveTool("deal");}
  };
  // Selecting a business always lands on its Command Center, whether coming
  // from the sidebar list, the businesses gallery, or creating a new one.
  const selectBusiness=(b)=>{
    setActiveBusiness(b);
    setBusinessPage('command-center');
    navTo('business-detail');
  };

  const isAE = (user?.role||"AE") === "AE";
  const sfdcConnected   = !!localStorage.getItem("sfdc_access_token");
  const sfdcSyncedAt    = localStorage.getItem("sfdc_synced_at");
  // Stale: token >7 days old OR server-side Supabase token is confirmed missing
  const sfdcNeedsReconnect = !!localStorage.getItem('sfdc_needs_reconnect');
  const showStaleBanner = isAE && sfdcConnected && (sfdcNeedsReconnect || (!!sfdcSyncedAt && staleDays(sfdcSyncedAt) >= 7));

  const activeInitials=activeUser.initials||(activeUser.name||"?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
  const firstName=activeUser.name.split(" ")[0];
  const showTasks=page==="business-detail"&&!!activeBusiness?.features?.goals_sales;

  return(
    <div style={{ display:"flex", flexDirection:compact?"column":"row", background:C.bg, minHeight:"100vh", width:"100%" }}>
      <Sidebar compact={compact} page={page} setPage={p=>{setPage(p);if(p==="admin"){dismissJoinNotifs();}}} showAdmin={showAdmin} showUiKit={showUiKit} toolsActiveTool={toolsActiveTool} setToolsActiveTool={setToolsActiveTool} viewAs={viewAs} setViewAs={setViewAs} activeInitials={activeInitials} hasUnviewedBadges={hasUnviewedBadges} onOpenProfile={()=>{dismissJoinNotifs();openProfile();}} diamonds={diamonds} activeUser={activeUser} teamUsers={teamUsers} newJoinCount={newJoinCount} newNuggetCount={newNuggetCount} businesses={myBusinesses} onSelectBusiness={selectBusiness} onGoToBusinesses={()=>navTo('businesses-home')} activeBusiness={activeBusiness} businessPage={businessPage} setBusinessPage={setBusinessPage} onOpenDigest={()=>setDigestOpen(true)} onOpenBugReport={()=>setBugOpen(true)} tasksButton={showTasks} />
      <div id="main-content" style={{ flex:1, padding:compact?"12px 12px":"18px 20px", overflowY:"auto", minWidth:0 }}>
        <PersistentScout
          isBusinessContext={page==="business-detail"&&!!activeBusiness}
          activeBusiness={activeBusiness}
          businesses={myBusinesses}
          territoryAccounts={scoutTerritoryAccounts}
          activeUser={activeUser}
          aeMap={scoutAeMap}
          allBusinessesConfirmed={scoutAllBusinessesConfirmed}
          onConfirmAllBusinesses={()=>updateTeamUser(activeUser.id,{scoutAllBusinessesConfirmed:true})}
          onNav={navTo}
          onCreateTask={task=>setTasks(ts=>[...ts,task])}
        />
        <AssayBanner/>
        {showStaleBanner && !staleDismissed && <StaleSfdcBanner onDismiss={()=>setStaleDismissed(true)} />}
        {viewAs&&(
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:activeRole==='Manager'&&managerTeamAEs.length>0?8:14, padding:"8px 14px", background:`${C.purple}14`, border:`1px solid ${C.purple}44`, borderRadius:7 }}>
            <span style={{ ...mono, fontSize:12, color:C.purple }}>◎ Viewing as {viewAs.name} · {viewAs.role}</span>
            <span style={{ fontSize:12, color:C.mut, flex:1 }}>— read-only · data scope follows {viewAs.name.split(' ')[0]}'s view</span>
            <button onClick={()=>setViewAs(null)} style={{ ...mono, fontSize:11, padding:"3px 9px", background:"transparent", border:`1px solid ${C.purple}55`, color:C.purple, borderRadius:4, cursor:"pointer" }}>Exit view →</button>
          </div>
        )}
        {activeRole==='Manager'&&managerTeamAEs.length>0&&(
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14, padding:"6px 12px", background:`${C.purple}0a`, border:`1px solid ${C.purple}33`, borderRadius:7, flexWrap:"wrap" }}>
            <span style={{ ...mono, fontSize:10, color:C.purple, textTransform:"uppercase", letterSpacing:"0.08em", marginRight:4 }}>SCOPE</span>
            {[{ id:'all', name:'All team' }, ...managerTeamAEs].map(ae => {
              const on = selectedAeId === ae.id;
              return (
                <button key={ae.id} onClick={()=>setSelectedAeId(ae.id)} title={ae.name}
                  style={{ ...mono, fontSize:11, padding:"3px 10px", borderRadius:4,
                    border:`1px solid ${on?C.purple:C.brd}`,
                    background:on?`${C.purple}22`:"transparent",
                    color:on?C.purple:C.mut, cursor:"pointer", fontWeight:on?600:400 }}>
                  {ae.id==='all' ? ae.name : ae.name.split(' ')[0]}
                </button>
              );
            })}
          </div>
        )}
        {page==="home"&&(activeRole==="Manager"?<ManagerCommandCenter accounts={accounts} tasks={tasks} onNav={navTo} activeUser={activeUser} teamUsers={teamUsers} selectedAeId={selectedAeId} setSelectedAeId={setSelectedAeId} teamAEs={managerTeamAEs}/>:<HomePage accounts={accounts} onNav={navTo} activeBatch={activeBatch} firstName={firstName} snapshots={snapshots} stealthList={stealthList} onSfStatus={setSfStatus} perms={perms} frontier={frontier} activeUser={activeUser} removalQueue={removalQueue} onConfirmRemoval={confirmRemoval} onDismissRemoval={dismissRemoval} tasks={tasks} setTasks={setTasks} onOpenTaskModal={setTaskModal} dailyStats={dailyStats} onRemoveAccount={perms.canRemove?id=>{const rem=accounts.find(x=>x.id===id);if(rem){addToBlocklist(rem);if(rem.tier==="Slag")trackStat("slag_removed");}setAccounts(as=>as.filter(x=>x.id!==id).map(a=>{let next=a;if(a.parentId===id){next={...next};delete next.parentId;}if(a.childIds?.includes(id))next={...next,childIds:a.childIds.filter(cid=>cid!==id)};return next;}));}:undefined} onKeepAccount={perms.canEditStage?id=>setAccounts(as=>as.map(a=>a.id===id?{...a,keepOverride:true,last:new Date().toISOString().slice(0,10)}:a)):undefined} onFlagForBDR={perms.canEditStage?acc=>assignToBDR(acc,BDR_LIST[0]?.id||""):undefined} pool={claimJumper.filter(a=>!accounts.some(x=>poolKey(x)===poolKey(a)))} onClaimAccount={perms.canClaim?(id=>claimAccount(id,activeUser?.name||firstName)):undefined} onSkipPoolAccount={perms.canClaim?id=>setClaimJumper(p=>p.map(x=>x.id===id?{...x,poolSkip:true}:x)):undefined} onUpdateAccount={perms.canEditStage?(id,patch)=>setAccounts(as=>as.map(a=>a.id===id?{...a,...patch}:a)):undefined} nuggets={nuggets} activeRole={activeRole} teamUsers={teamUsers} compliance={getAllCompliance()}/>)}
        <Suspense fallback={<div style={{padding:'2rem',color:'#555',fontFamily:'monospace'}}>Loading...</div>}>
        {page==="accounts"&&accountsSubPage==="territory"&&<AccountsPage managerSelectedAeId={managerScopedAeId} accounts={accounts} onSave={perms.canEditStage?setAccounts:undefined} onAddAccount={acc=>{setAccounts(a=>[acc,...a]);trackStat("accounts_added");trackDailyStat("accounts_added");}} onRemoveAccount={perms.canRemove?id=>{const rem=accounts.find(x=>x.id===id);if(rem){addToBlocklist(rem);if(rem.tier==="Slag")trackStat("slag_removed");}setAccounts(as=>as.filter(x=>x.id!==id).map(a=>{let next=a;if(a.parentId===id){next={...next};delete next.parentId;}if(a.childIds?.includes(id))next={...next,childIds:a.childIds.filter(cid=>cid!==id)};return next;}));}:undefined} perms={perms} frontier={frontier} onAssignToBDR={perms.canEditStage?assignToBDR:undefined} onUnassignFromFrontier={perms.canEditStage?unassignFromFrontier:undefined} onFlagRemoval={perms.canFlagRemoval?(acc,reason)=>flagForRemoval(acc,reason,activeUser?.name||"BDR"):undefined} jumpToId={accountsJumpId} onJumped={()=>setAccountsJumpId(null)} onNav={navTo} onCreateTask={task=>setTasks(ts=>[...ts,task])} onUpdateTask={handleUpdateTask} tasks={tasks} activeRole={activeRole} activeUser={activeUser} teamUsers={teamUsers} sfdcOpps={sfdcOpps} onSyncSfdc={syncSfdc} sfdcSyncing={sfdcSyncing} onSfdcOppsImported={imported=>setSfdcOpps(prev=>prev.filter(o=>!imported.some(i=>i.name===o.name)))}/>}
        {page==="accounts"&&accountsSubPage==="prod_requests"&&<ProductionRequestsPage managerSelectedAeId={managerScopedAeId} accounts={accounts} setAccounts={setAccounts} tasks={tasks} setTasks={setTasks} onNav={(pg,id)=>{setAccountsSubPage("territory");navTo(pg,id);}} onGoHome={()=>navTo("home")} activeUser={activeUser}/>}
        {page==="claimjumper"&&<ClaimJumperPage pool={claimJumper.filter(a=>!accounts.some(x=>poolKey(x)===poolKey(a)))} accounts={accounts} onClaim={perms.canClaim?claimAccount:undefined} onClaimMultiple={perms.canClaim?claimMultiple:undefined} onRemoveFromPool={perms.canClaim?id=>setClaimJumper(p=>p.filter(x=>x.id!==id)):undefined} onUpdatePoolEntry={updatePoolEntry} onRemoveAccount={perms.canRemove?id=>{const rem=accounts.find(x=>x.id===id);if(rem)addToBlocklist(rem);setAccounts(a=>a.filter(x=>x.id!==id));}:undefined} perms={perms} activeUser={activeUser}/>}
        {page==="uploads"&&<UploadsPage accounts={accounts} onSave={saveAccounts} onSaveBatch={saveBatch} onBatchUpdate={setActiveBatch} onSaveToPool={(accs)=>addToPool(accs,activeUser?.name)} activeUser={activeUser} onEnrichLog={logTerritoryEvent}/>}
        {page==="analytics"&&<AnalyticsPage accounts={accounts} tasks={tasks} stealthList={stealthList} frontier={frontier} pool={claimJumper.filter(a=>!accounts.some(x=>poolKey(x)===poolKey(a)))} teamUsers={teamUsers} currentUser={user} activeRole={activeRole}/>}
        {page==="intelligence"&&<IntelligencePage user={user} activeUser={activeUser} outlookVoice={myBusinesses.some(b=>b.features?.outlook_voice)}/>}
        {page==="voice-profile"&&<IntelligencePage only="Voice Profile" user={user} activeUser={activeUser} outlookVoice={myBusinesses.some(b=>b.features?.outlook_voice)}/>}
        {page==="google-connections"&&<div style={{ maxWidth:700 }}><h2 style={{ margin:"0 0 14px", fontSize:20, fontWeight:600, color:C.txt }}>Google connections</h2><GoogleConnections/></div>}
        {page==="microsoft-connection"&&<div style={{ maxWidth:700 }}><h2 style={{ margin:"0 0 14px", fontSize:20, fontWeight:600, color:C.txt }}>Microsoft connection</h2>{microsoftResult&&<p role="status" style={{ fontSize:13, color:microsoftResult.ok?C.green:C.red, margin:"0 0 12px" }}>{microsoftResult.text}</p>}<MicrosoftConnection/></div>}
        {(page==="outbound"||page==="team")&&<OutboundPage accounts={accounts} onNav={navTo} user={user} activeUser={activeUser} perms={perms} stealthList={stealthList} onSaveStealthList={setStealthList} onPromoteToAccount={promoteToAccount} onSfStatus={setSfStatus} frontier={frontier} onSaveFrontier={setFrontier} onAssignToBDR={assignToBDR} onUnassignFromFrontier={unassignFromFrontier} onSetFrontierStatus={setFrontierStatus} onRemoveDemoAccount={()=>setFrontier(fl=>fl.filter(f=>!f.isDemo))} onHandoff={f=>{setAccounts(as=>as.map(a=>{if(a.name.toLowerCase()!==f.name.toLowerCase())return a;logStageChange('onHandoff (OutboundPage)',a.name,a.stage,'Engaged');return {...a,stage:"Engaged",last:new Date().toISOString().slice(0,10)};}));setFrontier(fl=>fl.filter(x=>x.id!==f.id));trackStat("tasks_assigned_to_bdr");}} teamUsers={teamUsers} setAccounts={setAccounts} onCreateTask={task=>setTasks(ts=>[...ts,task])}/>}
        {page==="business-detail"&&businessPage==="ideas"&&<IdeasPage nuggets={nuggets} onSaveNuggets={setNuggets} activeUser={activeUser} onViewIdeas={onViewIdeas}/>}
        {page==="ledger"&&<LedgerPage accounts={accounts} setAccounts={setAccounts} teamUsers={teamUsers} activeUser={activeUser} tasks={tasks} winsLog={winsLog} setWinsLog={setWinsLog} managerSelectedAeId={managerScopedAeId}/>}
        {page==="business-detail"&&businessPage==="tools"&&<ToolsPage accounts={accounts} pool={claimJumper.filter(a=>!accounts.some(x=>poolKey(x)===poolKey(a)))} launchAccountId={toolsLaunchId} onLaunched={()=>setToolsLaunchId(null)} activeTool={toolsActiveTool} onToolSelect={setToolsActiveTool} onCreateTask={(prefill)=>setTaskModal(prefill||{})}/>}
        {page==="ui-kit"&&showUiKit&&<UiKitGallery/>}
        {page==="admin"&&showAdmin&&<AdminPage isPlatformOwner={!!me.profile.is_platform_owner} businesses={myBusinesses} onBusinessFeaturesChanged={onBusinessFeaturesChanged} teamUsers={teamUsers} onSaveUsers={setTeamUsers} currentUser={user} onUpdateCurrentUser={patch=>{setUser(u=>{const next={...u,...patch};localStorage.setItem("prospector_user",JSON.stringify(next));return next;});}} rolePerms={rolePerms} onSaveRolePerms={setRolePerms} onSave={saveAccounts} onSaveToPool={(accs)=>addToPool(accs,activeUser?.name)} onSaveBatch={saveBatch} accounts={accounts}/>}
        {page==="businesses-home"&&<BusinessesHomePage businesses={myBusinesses} loading={businessesLoading} projects={myProjects} onSelect={selectBusiness} onCreated={b=>{setMyBusinesses(prev=>[b,...prev]);selectBusiness(b);}}/>}
        {page==="business-detail"&&activeBusiness&&!APP_LEVEL_VIEWS.includes(businessPage)&&<BusinessDetailPage key={activeBusiness.id} business={activeBusiness} userEmail={user.email} fullListAccess={!!me.profile.is_platform_owner||me.memberships.some(m=>m.business_id===activeBusiness.id&&(m.role==="owner"||m.role==="admin"))} projects={myProjects.filter(p=>p.business_id===activeBusiness.id)} campaigns={myCampaigns.filter(c=>c.business_id===activeBusiness.id)} view={businessPage} onUpdated={onBusinessUpdated} onProjectCreated={p=>setMyProjects(prev=>[p,...prev])} onProjectUpdated={p=>setMyProjects(prev=>prev.map(x=>x.id===p.id?p:x))} onCampaignCreated={c=>setMyCampaigns(prev=>[c,...prev])} onCampaignUpdated={c=>setMyCampaigns(prev=>prev.map(x=>x.id===c.id?c:x))} sharedAccounts={accounts} sharedTasks={tasks} setSharedTasks={setTasks} dailyStats={dailyStats} activeUser={activeUser} onNav={navTo} onUpdateAccount={perms.canEditStage?(id,patch)=>setAccounts(as=>as.map(a=>a.id===id?{...a,...patch}:a)):undefined}/>}
        {page==="handoffs"&&<HandoffsPage accounts={accounts} onAddAccount={acc=>{setAccounts(a=>[acc,...a]);trackStat("accounts_added");trackDailyStat("accounts_added");}} activeUser={activeUser} activeRole={activeRole} teamUsers={teamUsers}/>}
        </Suspense>
      </div>
      {showTasks&&<TaskDrawer key={activeBusiness.id} businessId={activeBusiness.id} compact={compact} onOpenGoals={()=>setBusinessPage('sales-analytics')}/>}
      {taskModal!==null&&<TaskModal task={taskModal} accounts={accounts} onSave={handleSaveTask} onClose={()=>setTaskModal(null)}/>}
      {profileOpen&&<ProfilePanel user={user} accounts={accounts} tasks={tasks} snapshots={snapshots} stats={stats} earnedBadges={earnedBadges} score={appBreakdown?.score||0} grade={appBreakdown?.grade||"—"} gradeColor={appBreakdown?.c||C.dim} diamonds={diamonds} winsLog={winsLog} onClose={()=>setProfileOpen(false)}/>}
      <BadgeToast badge={badgeToast} onDismiss={()=>setBadgeToast(null)}/>

      <DailyDigest open={digestOpen} setOpen={setDigestOpen} hideTrigger={compact} accounts={accounts} tasks={tasks} firstName={firstName} onNav={navTo} onUpdateTask={handleUpdateTask} onCreateTask={task=>setTasks(ts=>[task,...ts])}/>
      <BugReporter open={bugOpen} setOpen={setBugOpen} hideTrigger={compact} page={page} reporterName={user?.name||"AE"}/>
    </div>
  );
}