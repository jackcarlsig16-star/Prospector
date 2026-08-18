import React, { useState, useEffect, useRef, useCallback } from 'react';
import { C, mono, TIER_COLOR } from '../constants/colors';
import { T } from '../constants/tokens';
import { STANDARD_STEPS, PARTNER_STEPS, GAMING_STEPS, STEP_STATUSES, getAllCompliance, getCompliance, saveCompliance } from '../utils/storage';
import { syncComplianceFromSFDC } from '../utils/sfdcSync';
import { getAllComplianceFromDb, saveComplianceToDb } from '../utils/db';

const STATUS_C = {
  "Not Started": C.dim,
  "In Progress":  C.gold,
  "Submitted":    C.blue,
  "Approved":     C.green,
  "Blocked":      "#EF4444",
};
const STATUS_IC = {
  "Not Started": "○",
  "In Progress":  "◑",
  "Submitted":    "◉",
  "Approved":     "✓",
  "Blocked":      "⛔",
};

// Union of all steps in canonical display order
const UNION_STEPS = [
  { id: "prod_request", label: "Production Request",     short: "Prod. Req." },
  { id: "security_q",   label: "Security Questionnaire", short: "Sec. Q" },
  { id: "partner_q",    label: "Partner Questionnaire",  short: "Part. Q" },
  { id: "live",         label: "Live",                   short: "Live" },
];

// Which steps belong to each track
const STANDARD_IDS = new Set(STANDARD_STEPS.map(s => s.id));
const PARTNER_IDS  = new Set(PARTNER_STEPS.map(s => s.id));

// Weights for sort scoring — higher = more meaningful step
const STEP_WEIGHTS = { prod_request:8, security_q:4, partner_q:2, live:1 };
const STALE_MS = 7 * 24 * 60 * 60 * 1000;

// Set to your org's Salesforce Lightning instance base URL
const SF_BASE_AC = process.env.REACT_APP_SFDC_ACCOUNT_URL_BASE || "https://your-org.lightning.force.com/lightning/r/Account/";
const toSfdcUrl = v => {
  if (!v || !v.trim()) return null;
  if (v.startsWith("http")) return v.trim();
  if (/^001[A-Za-z0-9]{12,15}$/.test(v.trim())) return `${SF_BASE_AC}${v.trim()}/view`;
  return null;
};

const HINT_KEY       = "prospector_pr_hint_dismissed";
const SUMMARIES_KEY  = "prospector_pr_summaries";
const loadPRSummaries = () => { try { return JSON.parse(localStorage.getItem(SUMMARIES_KEY)||"{}"); } catch { return {}; } };

function daysSince(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

const fmtDate = iso => iso ? new Date(iso).toLocaleDateString([],{month:"short",day:"numeric"}) : null;

const isPRTask = (t, accId) =>
  t.accId === accId &&
  t.status !== "Done" &&
  (
    (t.title||"").toLowerCase().includes("production request") ||
    (t.title||"").toLowerCase().includes("security review") ||
    (t.title||"").toLowerCase().includes("security questionnaire") ||
    (t.title||"").toLowerCase().includes("partner questionnaire") ||
    (t.type||"").toLowerCase() === "salesforce"
  );

const isDoneTask = (t, accId) =>
  t.accId === accId &&
  t.status === "Done" &&
  (
    (t.title||"").toLowerCase().includes("production request") ||
    (t.title||"").toLowerCase().includes("security review") ||
    (t.title||"").toLowerCase().includes("security questionnaire") ||
    (t.title||"").toLowerCase().includes("partner questionnaire") ||
    (t.type||"").toLowerCase() === "salesforce"
  );

// Set to your org's Jira service desk ticket-creation URLs
const JIRA_PARTNER_URL = process.env.REACT_APP_JIRA_PARTNER_URL || "https://your-org.atlassian.net/servicedesk/customer/portal/PLACEHOLDER";
const JIRA_USCOMP_URL  = process.env.REACT_APP_JIRA_COMPLIANCE_URL || "https://your-org.atlassian.net/servicedesk/customer/portal/PLACEHOLDER";

function businessDaysSince(iso) {
  if (!iso) return null;
  const now = new Date();
  const d = new Date(iso);
  if (d > now) return 0;
  let count = 0;
  while (d < now) {
    d.setDate(d.getDate() + 1);
    if (d <= now) {
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) count++;
    }
  }
  return count;
}

const defaultSyncData = (acc) => {
  const steps = acc.partner ? PARTNER_STEPS : STANDARD_STEPS;
  return { type: acc.partner ? "partner" : "standard", steps: steps.map(s => ({ id:s.id, status:"Not Started", days:0, notes:"", startedAt:null, completedAt:null })) };
};

const timeAgo = (d) => {
  if (!d) return '';
  const secs = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs/60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs/3600)}h ago`;
  return `${Math.floor(secs/86400)}d ago`;
};

export default function ProductionRequestsPage({ accounts=[], setAccounts, onNav, onGoHome, tasks=[], setTasks, activeUser={}, managerSelectedAeId=null }) {
  const [filter, setFilter] = useState("all");
  const [sort,   setSort]   = useState("least_complete");
  const [copiedId,    setCopiedId]    = useState(null);
  const [copiedInfo,  setCopiedInfo]  = useState(null); // accId of last copy-info action
  const [openIdDropdown, setOpenIdDropdown] = useState(null);
  const [openStepDropdown,   setOpenStepDropdown]   = useState(null); // {accId, stepId} | null
  const [openGamingDropdown, setOpenGamingDropdown] = useState(null); // {accId, stepId} | null
  const [hintDismissed, setHintDismissed] = useState(() => !!localStorage.getItem(HINT_KEY));
  const [taskToast, setTaskToast] = useState(null);
  const [allCompliance, setAllCompliance] = useState(() => getAllCompliance());
  const [syncAllState, setSyncAllState] = useState({ running: false, done: 0, total: 0, errors: [] });
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [syncToast, setSyncToast] = useState(null);
  const [prNotes] = useState({});
  const [prSummaries, setPrSummaries] = useState(loadPRSummaries);
  const stepDropRef = useRef(null);

  useEffect(() => {
    const refresh = () => setPrSummaries(loadPRSummaries());
    window.addEventListener('prospector:pr_summaries_updated', refresh);
    return () => window.removeEventListener('prospector:pr_summaries_updated', refresh);
  }, []);

  const loadCompliance = useCallback(async () => {
    const localMap = getAllCompliance();
    const dbMap = await getAllComplianceFromDb();
    if (dbMap) {
      // DB wins on conflicts; preserve any local-only entries DB doesn't have
      const merged = { ...localMap, ...dbMap };
      setAllCompliance(merged);
      try { localStorage.setItem('prospector_compliance', JSON.stringify(merged)); } catch {}
    } else {
      setAllCompliance(localMap);
    }
  }, []);

  useEffect(() => { loadCompliance(); }, [loadCompliance]);

  // Close step/gaming dropdowns on outside click
  useEffect(() => {
    if (!openStepDropdown && !openGamingDropdown) return;
    const handler = e => {
      if (stepDropRef.current && !stepDropRef.current.contains(e.target)) {
        setOpenStepDropdown(null);
        setOpenGamingDropdown(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openStepDropdown, openGamingDropdown]);

  const dismissHint = () => { localStorage.setItem(HINT_KEY,"1"); setHintDismissed(true); };

  const copyId = id => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2800);
  };

  const copyPartnerInfo = acc => {
    const text = [
      `Partner Type: Reseller Partner`,
      `Data Flow: Data Pass Partner`,
      `Products: ${(acc.prods||[]).join(", ")}`,
      `Entity Scope: LLM`,
      `Onboarding Type: US Reseller Partner`,
      `Client ID: ${(acc.clientIds||[])[0]||""}`,
      `SFDC Opportunity Link: ${acc.sfdc||""}`,
      `Opportunity Owner: ${activeUser.name||""}`,
      `Security Level: INTL Customer Onboarding`,
    ].join("\n");
    navigator.clipboard.writeText(text);
    setCopiedInfo(acc.id);
    setTimeout(() => setCopiedInfo(null), 2800);
  };

  const openLink = url => { dismissHint(); window.open(url, "_blank", "noopener,noreferrer"); };

  const showTaskToast = msg => { setTaskToast(msg); setTimeout(() => setTaskToast(null), 2500); };

  // Update a compliance step and fire side effects
  const updateStep = (accId, stepId, newStatus) => {
    const existing = getCompliance(accId) || { type: "standard", steps: [] };
    const now = new Date().toISOString();
    const steps = existing.steps || [];
    const idx = steps.findIndex(s => s.id === stepId);
    const prev = idx >= 0 ? steps[idx] : { id: stepId, status: "Not Started" };
    const updated = {
      ...prev,
      status: newStatus,
      ...(newStatus === "In Progress" && !prev.startedAt ? { startedAt: now } : {}),
      ...(newStatus === "Approved" ? { approvedAt: now } : {}),
    };
    const newSteps = idx >= 0
      ? steps.map((s, i) => i === idx ? updated : s)
      : [...steps, updated];
    const nextCompliance = { ...existing, steps: newSteps };
    saveCompliance(accId, nextCompliance);
    setAllCompliance(getAllCompliance());
    const thisAcc = accounts.find(a => a.id === accId);
    saveComplianceToDb(accId, nextCompliance, thisAcc?.name).catch(() => {});

    // Auto-close linked PR tasks on Approved
    if (newStatus === "Approved" && setTasks) {
      setTasks(ts => ts.map(t =>
        t.accId === accId &&
        t.status !== "Done" &&
        (
          (t.title||"").toLowerCase().includes("production request") ||
          (t.title||"").toLowerCase().includes("security review") ||
          (t.title||"").toLowerCase().includes("security questionnaire") ||
          (t.title||"").toLowerCase().includes("partner questionnaire") ||
          (t.type||"").toLowerCase() === "salesforce"
        )
          ? { ...t, status: "Done", completedAt: now }
          : t
      ));
    }
    setOpenStepDropdown(null);
  };

  // Update a gaming compliance step
  const updateGamingStep = (accId, stepId, newStatus) => {
    const existing = getCompliance(accId) || { type: "standard", steps: [] };
    const now = new Date().toISOString();
    const gamingSteps = existing.gaming?.steps || [];
    const idx = gamingSteps.findIndex(s => s.id === stepId);
    const prev = idx >= 0 ? gamingSteps[idx] : { id: stepId, status: "Not Started" };
    const updated = {
      ...prev,
      status: newStatus,
      ...(newStatus === "In Progress" && !prev.startedAt ? { startedAt: now } : {}),
      ...(newStatus === "Approved" ? { approvedAt: now } : {}),
    };
    const newGamingSteps = idx >= 0
      ? gamingSteps.map((s, i) => i === idx ? updated : s)
      : [...gamingSteps, updated];
    const updatedGaming = { ...existing, gaming: { ...(existing.gaming || {}), steps: newGamingSteps } };
    saveCompliance(accId, updatedGaming);
    setAllCompliance(getAllCompliance());
    const thisAcc = accounts.find(a => a.id === accId);
    saveComplianceToDb(accId, updatedGaming, thisAcc?.name).catch(() => {});
    setOpenGamingDropdown(null);
  };

  // Switch track — never clears existing step data
  const switchTrack = (acc, newType) => {
    const existing = getCompliance(acc.id) || { steps: [] };
    const existingSteps = existing.steps || [];
    let newSteps = existingSteps;
    if (newType === "partner") {
      // Add partner_q with Not Started only if it doesn't already exist
      if (!existingSteps.some(s => s.id === "partner_q")) {
        newSteps = [...existingSteps, { id: "partner_q", status: "Not Started" }];
      }
    }
    // Standard: partner_q data stays in storage (segment just hidden in render)
    saveCompliance(acc.id, { ...existing, type: newType, steps: newSteps });
    setAllCompliance(getAllCompliance());
    // Update account.partner flag
    if (setAccounts) {
      setAccounts(prev => prev.map(a => a.id === acc.id ? { ...a, partner: newType === "partner" } : a));
    }
  };

  const createTask = acc => {
    if (!setTasks) return;
    setTasks(ts => [{
      id: Date.now(),
      title: `Check production request status for ${acc.name}`,
      type: "Salesforce", accId: acc.id, accName: acc.name,
      dueDate: new Date().toISOString().slice(0,10), priority: "High",
      assignee: "AE", status: "Open", personal: false, notes: "",
      createdAt: new Date().toISOString().slice(0,10), completedAt: null,
    }, ...ts]);
    showTaskToast("created");
  };

  const recreateTask = acc => {
    if (!setTasks) return;
    setTasks(ts => [{
      id: Date.now(),
      title: `Check production request status for ${acc.name}`,
      type: "Salesforce", accId: acc.id, accName: acc.name,
      dueDate: new Date().toISOString().slice(0,10), priority: "High",
      assignee: "AE", status: "Open", personal: false, notes: "",
      createdAt: new Date().toISOString().slice(0,10), completedAt: null,
    }, ...ts]);
    showTaskToast("recreated");
  };

  const rows = accounts
    .filter(a => a.stage === "Active Deal")
    .filter(a => !managerSelectedAeId || managerSelectedAeId === 'all' || a.aeId === managerSelectedAeId)
    .map(a => {
      const comp = allCompliance[a.id];
      const steps = comp?.type === "partner" ? PARTNER_STEPS : STANDARD_STEPS;
      const stepData = comp?.steps || steps.map(s => ({ id:s.id, status:"Not Started" }));
      const isBlocked = stepData.some(s => s.status === "Blocked");
      const allApproved = steps.every(s => (stepData.find(d=>d.id===s.id)||{}).status === "Approved");
      const currentStep = steps.find(s => (stepData.find(d=>d.id===s.id)||{}).status !== "Approved");
      const currentStepData = currentStep ? stepData.find(d=>d.id===currentStep.id)||{} : null;
      const daysInStep = currentStepData?.startedAt ? daysSince(currentStepData.startedAt) : null;
      const linkedTask = tasks.find(t => isPRTask(t, a.id)) || null;
      const doneTask   = !linkedTask ? (tasks.find(t => isDoneTask(t, a.id)) || null) : null;
      const trackIds      = comp?.type === "partner" ? PARTNER_IDS : STANDARD_IDS;
      const approvedWeight = stepData.filter(sd=>sd.status==="Approved").reduce((s,sd)=>s+(STEP_WEIGHTS[sd.id]||0),0);
      const allNotStarted  = stepData.every(sd=>sd.status==="Not Started");
      const isStale        = allNotStarted && (!a.activeDealAt || Date.now()-new Date(a.activeDealAt).getTime()>=STALE_MS);
      const gamingStepData = comp?.gaming?.steps || [];
      const gamingPrereqsMet = !a.isGaming || (gamingStepData.find(d=>d.id==="gaming_approved")||{}).status==="Approved";
      return { acc:a, comp, steps, stepData, isBlocked, allApproved, currentStep, daysInStep, linkedTask, doneTask, trackIds, approvedWeight, isStale, gamingStepData, gamingPrereqsMet };
    })
    .filter(r => {
      if (filter === "blocked")     return r.isBlocked;
      if (filter === "in_progress") return !r.allApproved && !r.isBlocked;
      if (filter === "pending")     return !r.comp;
      return true;
    })
    .sort((a,b) => {
      if (sort === "most_complete")  return b.approvedWeight - a.approvedWeight;
      // least_complete: zero progress first, then ascending weight
      return a.approvedWeight - b.approvedWeight;
    });

  const handleServerSync = async () => {
    setSyncing(true);
    setSyncToast(null);
    try {
      const clientToken    = localStorage.getItem('sfdc_access_token') || '';
      const clientInstance = localStorage.getItem('sfdc_instance_url') || '';
      const res = await fetch('/api/sfdc/sync-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientToken, clientInstance }),
      });
      const data = await res.json();
      setLastSync(new Date());
      await loadCompliance();
      if (data.error === 'No SFDC token') {
        try { localStorage.setItem('sfdc_needs_reconnect', '1'); } catch {}
      } else {
        try { localStorage.removeItem('sfdc_needs_reconnect'); } catch {}
      }
      setSyncToast(data.error
        ? `⚠ ${data.error}`
        : `✓ Synced ${data.synced ?? 0}${data.total != null ? `/${data.total}` : ''} accounts`);
    } catch {
      setSyncToast('Sync failed — check server logs');
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncToast(null), 4000);
    }
  };

  const handleSyncAll = async () => {
    const toSync = rows.filter(r => (r.acc.clientIds || []).length > 0);
    if (!toSync.length) return;
    setSyncAllState({ running: true, done: 0, total: toSync.length, errors: [] });
    const errors = [];
    for (let i = 0; i < toSync.length; i++) {
      const { acc } = toSync[i];
      const data = getCompliance(acc.id) || defaultSyncData(acc);
      const updateAndSave = (next) => { saveCompliance(acc.id, next); setAllCompliance(getAllCompliance()); };
      const result = await syncComplianceFromSFDC(acc, data, updateAndSave);
      if (result.status !== "ok" && result.status !== "not_found") {
        errors.push({ name: acc.name, msg: result.message || result.status });
      }
      setSyncAllState(s => ({ ...s, done: i + 1, errors }));
      if (i < toSync.length - 1) await new Promise(r => setTimeout(r, 300));
    }
    setSyncAllState(s => ({ ...s, running: false }));
  };

  const blockedCount  = rows.filter(r=>r.isBlocked).length;
  const approvedCount = rows.filter(r=>r.allApproved).length;
  const pendingCount  = rows.filter(r=>!r.comp).length;

  const TOOL_BTN = {
    ...mono, fontSize:13, padding:"4px 11px", borderRadius:5, cursor:"pointer",
    background:"transparent", border:`1px solid ${C.brd}`, color:C.mut,
    display:"inline-flex", alignItems:"center", gap:4, whiteSpace:"nowrap",
  };

  // 220px account | 130px client ID | 72px track | 1fr segmented bar | 48px days | 28px task | 114px partner actions | 28px notes
  const COL = "220px 130px 72px 1fr 48px 28px 114px 28px";

  return (
    <div>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:6 }}>
        <div>
          <h2 style={{ ...mono, margin:0, fontSize:17, color:C.gold, fontWeight:700 }}>Production Requests</h2>
          <p style={{ ...mono, margin:"2px 0 0", fontSize:13, color:C.dim }}>
            All active deals · {rows.length} account{rows.length!==1?"s":""}
          </p>
        </div>
        <div style={{ marginLeft:"auto", display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
          {[
            { id:"all",         lb:"All",     count: accounts.filter(a=>a.stage==="Active Deal").length },
            { id:"blocked",     lb:"Blocked", count: blockedCount,  c:"#EF4444" },
            { id:"in_progress", lb:"Active",  count: rows.filter(r=>!r.allApproved&&!r.isBlocked&&r.comp).length },
            { id:"pending",     lb:"Pending", count: pendingCount,  c:C.dim },
          ].map(f=>(
            <button key={f.id} onClick={()=>setFilter(f.id)}
              style={{ ...mono, fontSize:12, padding:"3px 10px",
                background: filter===f.id?`${f.c||C.gold}22`:"transparent",
                border:`1px solid ${filter===f.id?(f.c||C.gold):C.brd}`,
                color: filter===f.id?(f.c||C.gold):C.dim, borderRadius:5, cursor:"pointer" }}>
              {f.lb}{f.count>0?` · ${f.count}`:""}
            </button>
          ))}
          <div style={{ width:1, height:20, background:C.brd, flexShrink:0, margin:"0 2px" }}/>
          {[{id:"least_complete",lb:"↑ Least"},{id:"most_complete",lb:"↓ Most"}].map(s=>(
            <button key={s.id} onClick={()=>setSort(s.id)}
              style={{ ...mono, fontSize:12, padding:"3px 10px",
                background:sort===s.id?`${C.blue}22`:"transparent",
                border:`1px solid ${sort===s.id?C.blue:C.brd}`,
                color:sort===s.id?C.blue:C.dim, borderRadius:5, cursor:"pointer" }}>
              {s.lb}
            </button>
          ))}
          <div style={{ width:1, height:20, background:C.brd, flexShrink:0, margin:"0 2px" }}/>
          <button title="Check production request status" onClick={()=>openLink(process.env.REACT_APP_PROD_REQUEST_TRACKER_URL || "https://your-internal-tool.example.com/")}
            style={TOOL_BTN}
            onMouseEnter={e=>{e.currentTarget.style.borderColor=C.gold;e.currentTarget.style.color=C.gold;}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor=C.brd;e.currentTarget.style.color=C.mut;}}>
            Prod Tracker ↗
          </button>
          <button title="View client dashboard" onClick={()=>openLink(process.env.REACT_APP_CLIENT_DASHBOARD_URL || "https://dashboard.example.com")}
            style={TOOL_BTN}
            onMouseEnter={e=>{e.currentTarget.style.borderColor=C.blue;e.currentTarget.style.color=C.blue;}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor=C.brd;e.currentTarget.style.color=C.mut;}}>
            Dash Impersonation ↗
          </button>
          <div style={{ width:1, height:20, background:C.brd, flexShrink:0, margin:"0 2px" }}/>
          <button
            onClick={handleServerSync}
            disabled={syncing}
            style={{ ...TOOL_BTN, ...(syncing?{borderColor:C.blue,color:C.blue}:{}) }}
            onMouseEnter={e=>{if(!syncing){e.currentTarget.style.borderColor="#5bc8f5";e.currentTarget.style.color="#5bc8f5";}}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor=syncing?C.blue:C.brd;e.currentTarget.style.color=syncing?C.blue:C.mut;}}>
            {syncing ? "Syncing…" : `↻ Sync SF${lastSync ? ` · ${timeAgo(lastSync)}` : ""}`}
          </button>
        </div>
      </div>

      {/* Workflow hint */}
      {!hintDismissed && (
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
          <span style={{ ...mono, fontSize:12, color:C.dim, fontStyle:"italic" }}>
            Copy a Client ID → open Wadsworth or Dash Impersonation to check status
          </span>
          <button onClick={dismissHint} style={{ background:"transparent", border:"none", color:C.dim,
            fontSize:13, cursor:"pointer", padding:0, lineHeight:1 }}>✕</button>
        </div>
      )}

      {/* Summary pills */}
      <div style={{ display:"flex", gap:8, marginBottom:12, marginTop:hintDismissed?10:0 }}>
        {[
          { label:"Active deals", val:accounts.filter(a=>a.stage==="Active Deal").length, c:C.gold },
          { label:"Blocked",      val:blockedCount,  c:"#EF4444" },
          { label:"Live",         val:approvedCount, c:C.green },
          { label:"No tracker",   val:pendingCount,  c:C.dim },
        ].map(p=>(
          <div key={p.label} style={{ ...mono, fontSize:12, padding:"4px 12px",
            background:`${p.c}12`, border:`1px solid ${p.c}33`, borderRadius:5, color:p.c }}>
            <span style={{ fontWeight:700 }}>{p.val}</span> {p.label}
          </div>
        ))}
      </div>

      {/* Toasts */}
      {copiedId && (
        <div style={{ ...mono, fontSize:13, color:"#5bc8f5", background:`${"#5bc8f5"}0d`,
          border:`1px solid ${"#5bc8f5"}33`, borderRadius:5, padding:"6px 12px", marginBottom:10 }}>
          <span style={{ fontWeight:600 }}>{copiedId}</span>
          <span style={{ color:C.dim }}> copied — open Wadsworth or Dash to check status ✓</span>
        </div>
      )}
      {taskToast && (
        <div style={{ ...mono, fontSize:13, color:C.green, background:`${C.green}0d`,
          border:`1px solid ${C.green}33`, borderRadius:5, padding:"6px 12px", marginBottom:10 }}>
          {taskToast==="created" ? "Task created ✓" : "Task recreated ✓"}
          {onGoHome && <button onClick={onGoHome} style={{ ...mono, fontSize:12, marginLeft:10,
            background:"transparent", border:`1px solid ${C.green}55`, color:C.green,
            borderRadius:3, cursor:"pointer", padding:"1px 7px" }}>View →</button>}
        </div>
      )}
      {syncToast && (
        <div style={{ ...mono, fontSize:13, color:syncToast.startsWith("⚠")||syncToast.startsWith("Sync failed")?C.orange:C.green, background:`${syncToast.startsWith("⚠")||syncToast.startsWith("Sync failed")?C.orange:C.green}0d`, border:`1px solid ${syncToast.startsWith("⚠")||syncToast.startsWith("Sync failed")?C.orange:C.green}33`, borderRadius:5, padding:"6px 12px", marginBottom:10 }}>
          {syncToast}
        </div>
      )}
      {!syncAllState.running && syncAllState.total > 0 && (
        <div style={{ ...mono, fontSize:13, color:syncAllState.errors.length?C.orange:C.green, background:`${syncAllState.errors.length?C.orange:C.green}0d`, border:`1px solid ${syncAllState.errors.length?C.orange:C.green}33`, borderRadius:5, padding:"6px 12px", marginBottom:10 }}>
          {syncAllState.errors.length
            ? `⚠ Synced ${syncAllState.done - syncAllState.errors.length}/${syncAllState.total} — ${syncAllState.errors.length} error${syncAllState.errors.length>1?"s":""}`
            : `✓ Synced ${syncAllState.done} account${syncAllState.done!==1?"s":""} from Salesforce`}
        </div>
      )}

      {/* Table */}
      {rows.length === 0 ? (
        <div style={{ ...mono, fontSize:14, color:C.dim, padding:"24px 0" }}>
          {filter==="all" ? "No accounts in Active Deal stage." : "No accounts match this filter."}
        </div>
      ) : (
        <div style={{ background:C.sur, borderRadius:10, border:`1px solid ${C.brd}`, overflow:"visible" }}>
          {/* Col headers */}
          <div style={{ display:"grid", gridTemplateColumns:COL, padding:"7px 14px",
            borderBottom:`1px solid ${C.brd}`, background:C.card, gap:8, alignItems:"end",
            borderRadius:"10px 10px 0 0" }}>
            {["ACCOUNT","CLIENT ID","TRACK","PROGRESS","DAYS","","",""].map((h,i)=>(
              <span key={i} style={{ ...mono, fontSize:11, color:C.dim,
                textAlign: i===4?"right":"left",
                textTransform:"uppercase", letterSpacing:"0.07em" }}>
                {h}
              </span>
            ))}
          </div>

          {rows.map(({ acc, comp, steps, stepData, isBlocked, allApproved, currentStep, daysInStep, linkedTask, doneTask, trackIds, isStale, gamingStepData, gamingPrereqsMet }) => {
            const tier = acc.tier;
            const tc = TIER_COLOR[tier] || C.dim;
            const ids = acc.clientIds || [];
            const isIdDropOpen = openIdDropdown === acc.id;
            const sfUrl = toSfdcUrl(acc.sfdc);
            const hasNote = !!(prNotes[acc.id]||"").trim();
            const summary = prSummaries[acc.id]?.text || "";
            const hasSummary = !!summary;
            const showSummaryRow = hasSummary || hasNote;

            let taskIcon, taskTitle, taskAction;
            if (linkedTask) {
              taskIcon = "☐";
              taskTitle = `Task: ${linkedTask.title}${linkedTask.dueDate ? ` — Due ${fmtDate(linkedTask.dueDate)}` : ""}`;
              taskAction = onGoHome;
            } else if (doneTask) {
              taskIcon = "☑";
              taskTitle = `Completed ${fmtDate(doneTask.completedAt||doneTask.createdAt)} — recreate?`;
              taskAction = () => recreateTask(acc);
            } else {
              taskIcon = "+";
              taskTitle = "Create task for this";
              taskAction = () => createTask(acc);
            }
            const taskColor = linkedTask ? C.blue : doneTask ? C.green : C.dim;

            return (
              <React.Fragment key={acc.id}>
              <div
                style={{ display:"grid", gridTemplateColumns:COL,
                  padding:"8px 14px", gap:8, alignItems:"center",
                  borderBottom: showSummaryRow ? "none" : `1px solid ${C.brd}22`,
                  borderLeft: isBlocked?`3px solid #EF4444`: allApproved?`3px solid ${C.green}`:`3px solid transparent`,
                  background: isBlocked?"#EF444408": allApproved?`${C.green}06`:"transparent",
                  position:"relative" }}
                onMouseEnter={e=>e.currentTarget.style.background=isBlocked?"#EF444414":`${C.gold}08`}
                onMouseLeave={e=>e.currentTarget.style.background=isBlocked?"#EF444408":allApproved?`${C.green}06`:"transparent"}>

                {/* Account column: name anchor left, tier badge right */}
                <div style={{ minWidth:0, overflow:"hidden", cursor:"pointer" }} onClick={()=>onNav?.("accounts", acc.id)}>
                  <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                    <span style={{ ...mono, fontSize:13, color:C.txt, overflow:"hidden",
                      textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1 }}>{acc.name}</span>
                    {tier && (
                      <span style={{ ...mono, fontSize:10, height:16, lineHeight:"16px",
                        display:"inline-flex", alignItems:"center", padding:"0 5px",
                        borderRadius:3, flexShrink:0,
                        color:tc, background:`${tc}18`, border:`1px solid ${tc}33` }}>{tier}</span>
                    )}
                  </div>
                  {acc.products?.length > 0 && (
                    <span style={{ ...mono, fontSize:11, color:"#666", overflow:"hidden",
                      textOverflow:"ellipsis", whiteSpace:"nowrap", display:"block", marginTop:1 }}>
                      {acc.products.slice(0,3).join(", ")}
                    </span>
                  )}
                </div>

                {/* Client ID + SF link */}
                <div style={{ position:"relative", display:"flex", alignItems:"center", gap:4 }} onClick={e=>e.stopPropagation()}>
                  {sfUrl && (
                    <a href={sfUrl} target="_blank" rel="noreferrer" title="Open in Salesforce"
                      style={{ ...mono, fontSize:11, color:C.orange, background:`${C.orange}14`,
                        border:`1px solid ${C.orange}33`, borderRadius:3, padding:"0 4px",
                        textDecoration:"none", flexShrink:0, lineHeight:"18px" }}>
                      SF ↗
                    </a>
                  )}
                  {ids.length === 0 ? (
                    <button onClick={()=>onNav?.("accounts", acc.id)} title="No Client ID — click to add"
                      style={{ ...mono, fontSize:12, padding:"2px 6px", background:"transparent",
                        border:`1px solid #EF444444`, color:"#EF4444aa",
                        borderRadius:4, cursor:"pointer", whiteSpace:"nowrap" }}>
                      ⚠ No ID
                    </button>
                  ) : ids.length === 1 ? (<>
                    <span style={{ ...mono, fontSize:12, color:"#5bc8f5", overflow:"hidden",
                      textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:70 }} title={ids[0]}>{ids[0]}</span>
                    <button onClick={()=>copyId(ids[0])} title={`Copy ${ids[0]}`}
                      style={{ ...mono, fontSize:12, padding:"1px 5px", background:"transparent",
                        border:`1px solid ${"#5bc8f5"}44`, color:copiedId===ids[0]?C.green:"#5bc8f5",
                        borderRadius:3, cursor:"pointer", flexShrink:0 }}>
                      {copiedId===ids[0]?"✓":"📋"}
                    </button>
                  </>) : (
                    <div style={{ position:"relative" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                        <button onClick={()=>setOpenIdDropdown(isIdDropOpen?null:acc.id)}
                          style={{ ...mono, fontSize:12, padding:"2px 6px",
                            background:`${"#5bc8f5"}0d`, border:`1px solid ${"#5bc8f5"}33`,
                            color:"#5bc8f5", borderRadius:4, cursor:"pointer", whiteSpace:"nowrap" }}>
                          {ids.length} IDs {isIdDropOpen?"▾":"▸"}
                        </button>
                        <button onClick={()=>copyId(ids[0])} title={`Copy first ID: ${ids[0]}`}
                          style={{ ...mono, fontSize:12, padding:"1px 5px", background:"transparent",
                            border:`1px solid ${"#5bc8f5"}44`, color:copiedId===ids[0]?C.green:"#5bc8f5",
                            borderRadius:3, cursor:"pointer", flexShrink:0 }}>
                          {copiedId===ids[0]?"✓":"📋"}
                        </button>
                      </div>
                      {isIdDropOpen && (
                        <div style={{ position:"absolute", top:"100%", left:0, zIndex:200,
                          background:C.card, border:`1px solid ${C.brd}`, borderRadius:6,
                          boxShadow:"0 8px 24px #000a", padding:"4px 0", minWidth:160, marginTop:2 }}>
                          {ids.map(id=>(
                            <div key={id} style={{ display:"flex", alignItems:"center", gap:6,
                              padding:"5px 10px", borderBottom:`1px solid ${C.brd}22` }}>
                              <span style={{ ...mono, fontSize:12, color:"#5bc8f5", flex:1 }}>{id}</span>
                              <button onClick={()=>{copyId(id);setOpenIdDropdown(null);}}
                                style={{ ...mono, fontSize:11, padding:"1px 7px", background:"transparent",
                                  border:`1px solid ${"#5bc8f5"}44`, color:copiedId===id?C.green:"#5bc8f5",
                                  borderRadius:3, cursor:"pointer" }}>
                                {copiedId===id?"✓":"📋"}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Track toggle */}
                <button
                  onClick={e => { e.stopPropagation(); switchTrack(acc, comp?.type === "partner" ? "standard" : "partner"); }}
                  title={`Switch to ${comp?.type === "partner" ? "Standard" : "Partner"} track`}
                  style={{ ...mono, fontSize:11,
                    color: comp?.type==="partner" ? C.purple : C.blue,
                    background: comp?.type==="partner" ? `${C.purple}14` : `${C.blue}0d`,
                    border: `1px solid ${comp?.type==="partner" ? C.purple : C.blue}44`,
                    borderRadius: 10, padding: "2px 8px",
                    cursor: "pointer", justifySelf: "start",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.opacity = "0.75"; }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}>
                  {comp?.type==="partner" ? "Partner" : "Standard"}
                </button>

                {/* Segmented progress bar */}
                <div style={{ display:"flex", gap:3, alignItems:"stretch", width:"100%" }}>
                  {isStale && (
                    <div style={{ width:7, height:7, borderRadius:"50%", background:"#EF4444", flexShrink:0, alignSelf:"center", marginRight:1 }}/>
                  )}
                  {UNION_STEPS.map((unionStep, colIdx) => {
                    const isPartnerQ = unionStep.id === "partner_q";
                    const hasStep = trackIds.has(unionStep.id);

                    // Part. Q is always rendered at fixed 60px.
                    // Standard accounts get a gray placeholder (non-interactive).
                    if (isPartnerQ && !hasStep) {
                      return (
                        <div key={unionStep.id} style={{ width:60, flexShrink:0, display:"flex", flexDirection:"column", gap:3 }}>
                          <span style={{ ...mono, fontSize:10, color:C.brd, whiteSpace:"nowrap" }}>{unionStep.short}</span>
                          <div style={{ height:12, background:C.brd, borderRadius:3, opacity:0.18 }}/>
                        </div>
                      );
                    }

                    // Non-partner_q steps not in this track: skip (remaining flex:1 steps fill)
                    if (!hasStep) return null;

                    const sd = stepData.find(d=>d.id===unionStep.id) || { status:"Not Started" };
                    const sc = STATUS_C[sd.status] || C.dim;
                    const isOpen = openStepDropdown?.accId===acc.id && openStepDropdown?.stepId===unionStep.id;
                    // Live hard-block: all prereqs must be Approved
                    const isLive = unionStep.id === "live";
                    const prereqIds = trackIds.has("partner_q")
                      ? ["prod_request","security_q","partner_q"]
                      : ["prod_request","security_q"];
                    const standardPrereqsOk = prereqIds.every(id=>(stepData.find(d=>d.id===id)||{}).status==="Approved");
                    const prereqsMet = !isLive || (standardPrereqsOk && gamingPrereqsMet);
                    const isDisabled = isLive && !prereqsMet;
                    // Dropdown: right-align for last 2 segments
                    const dropAlign = colIdx >= 2 ? { right:0, left:"auto" } : { left:0 };
                    // Part. Q fixed width; all others share remaining space equally
                    const segStyle = isPartnerQ
                      ? { width:60, flexShrink:0 }
                      : { flex:1 };

                    return (
                      <div key={unionStep.id} style={{ ...segStyle, display:"flex", flexDirection:"column", gap:3, position:"relative" }}
                        ref={isOpen ? stepDropRef : null}>
                        <span style={{ ...mono, fontSize:10, color:isDisabled?C.brd:sc,
                          whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}
                          title={unionStep.label}>{unionStep.short}</span>
                        <button
                          disabled={isDisabled}
                          title={isDisabled?`${unionStep.label}: complete previous steps first`:`${unionStep.label}: ${sd.status} — click to update`}
                          onClick={e=>{e.stopPropagation();if(!isDisabled)setOpenStepDropdown(isOpen?null:{accId:acc.id,stepId:unionStep.id});}}
                          style={{ height:12, background:sc, borderRadius:3, border:"none",
                            cursor:isDisabled?"not-allowed":"pointer",
                            opacity:isDisabled?0.2:1, padding:0, width:"100%",
                            boxShadow:sd.status==="Blocked"?`0 0 6px #EF4444`:undefined }}>
                        </button>
                        {isOpen && (
                          <div style={{ position:"absolute", top:"calc(100% + 6px)", zIndex:300,
                            background:C.card, border:`1px solid ${C.brd}`, borderRadius:7,
                            boxShadow:"0 8px 28px #000c", padding:"4px 0", minWidth:150, ...dropAlign }}>
                            <div style={{ ...mono, fontSize:11, color:C.dim, padding:"4px 12px 6px",
                              borderBottom:`1px solid ${C.brd}44` }}>
                              {unionStep.label}
                            </div>
                            {STEP_STATUSES.map(status=>(
                              <button key={status}
                                onClick={e=>{e.stopPropagation();updateStep(acc.id,unionStep.id,status);}}
                                style={{ display:"flex", alignItems:"center", gap:8, width:"100%",
                                  padding:"6px 12px", background:sd.status===status?`${STATUS_C[status]}18`:"transparent",
                                  border:"none", cursor:"pointer", textAlign:"left",
                                  borderLeft:sd.status===status?`2px solid ${STATUS_C[status]}`:"2px solid transparent" }}>
                                <span style={{ ...mono, fontSize:13, color:STATUS_C[status] }}>{STATUS_IC[status]}</span>
                                <span style={{ ...mono, fontSize:13, color:sd.status===status?STATUS_C[status]:C.txt }}>{status}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Days */}
                <div style={{ textAlign:"right", cursor:"pointer" }} onClick={()=>onNav?.("accounts", acc.id)}>
                  {daysInStep!=null
                    ? <span style={{ ...mono, fontSize:12, color:daysInStep>14?"#EF4444":daysInStep>7?C.orange:C.dim }}>{daysInStep}d</span>
                    : <span style={{ ...mono, fontSize:12, color:C.dim }}>—</span>}
                </div>

                {/* Task indicator */}
                <button
                  onClick={e=>{e.stopPropagation();taskAction&&taskAction();}}
                  title={taskTitle}
                  style={{ background:"transparent", border:"none", cursor:"pointer", padding:0,
                    fontSize:16, color:taskColor, opacity:0.6, lineHeight:1, justifySelf:"center",
                    transition:"opacity 0.12s" }}
                  onMouseEnter={e=>e.currentTarget.style.opacity="1"}
                  onMouseLeave={e=>e.currentTarget.style.opacity="0.6"}>
                  {taskIcon}
                </button>

                {/* Partner Jira + Copy Info */}
                {comp?.type === "partner" ? (
                  <div style={{ display:"flex", gap:4, alignItems:"center" }} onClick={e=>e.stopPropagation()}>
                    <button
                      title="Open Partner Jira ticket"
                      onClick={()=>window.open(JIRA_PARTNER_URL,"_blank","noopener,noreferrer")}
                      style={{ ...mono, fontSize:13, width:26, height:26, display:"flex", alignItems:"center",
                        justifyContent:"center", background:`${C.blue}18`, border:`1px solid ${C.blue}44`,
                        borderRadius:4, color:C.blue, cursor:"pointer", flexShrink:0, padding:0 }}>
                      →
                    </button>
                    <button
                      title="Copy partner info to clipboard"
                      onClick={()=>copyPartnerInfo(acc)}
                      style={{ ...mono, fontSize:11, padding:"3px 7px", background:copiedInfo===acc.id?`${C.green}18`:`${C.blue}0d`,
                        border:`1px solid ${copiedInfo===acc.id?C.green:C.blue}44`,
                        borderRadius:4, color:copiedInfo===acc.id?C.green:C.blue,
                        cursor:"pointer", whiteSpace:"nowrap" }}>
                      {copiedInfo===acc.id ? "✓ Copied" : "Copy Info"}
                    </button>
                  </div>
                ) : (
                  <div/>
                )}

                {/* Notes column intentionally empty — auto-summary lives below the row */}
                <div/>
              </div>

              {/* Gaming track sub-row */}
              {acc.isGaming && (() => {
                const uscompStep = gamingStepData.find(d => d.id === "uscomp_ticket");
                const bdays = businessDaysSince(uscompStep?.startedAt);
                const slaColor = bdays === null ? C.dim : bdays >= 10 ? "#EF4444" : bdays >= 5 ? C.orange : C.dim;
                const slaLabel = bdays === null ? null : bdays >= 10 ? `${bdays}bd overdue` : bdays >= 5 ? `${bdays}bd due` : `${bdays}bd`;
                return (
                  <div style={{ display:"grid", gridTemplateColumns:COL, padding:"4px 14px 6px",
                    gap:8, alignItems:"center", borderBottom:`1px solid ${C.brd}22`,
                    background:"#F59E0B06", borderLeft:"3px solid #F59E0B" }}>
                    {/* Account col */}
                    <div style={{ display:"flex", alignItems:"center", gap:4, overflow:"hidden" }}>
                      <span style={{ ...mono, fontSize:11, color:"#F59E0B", whiteSpace:"nowrap" }}>🎲 Gaming Track</span>
                    </div>
                    {/* Client ID col: SLA badge */}
                    <div>
                      {slaLabel && (
                        <span style={{ ...mono, fontSize:11, color:slaColor }}>{slaLabel}</span>
                      )}
                    </div>
                    {/* Track col: empty */}
                    <div/>
                    {/* Gaming progress bar */}
                    <div style={{ display:"flex", gap:3, alignItems:"stretch", width:"100%" }}>
                      {GAMING_STEPS.map((gs, colIdx) => {
                        const sd = gamingStepData.find(d => d.id === gs.id) || { status: "Not Started" };
                        const sc = STATUS_C[sd.status] || C.dim;
                        const isOpen = openGamingDropdown?.accId === acc.id && openGamingDropdown?.stepId === gs.id;
                        const dropAlign = colIdx >= 1 ? { right:0, left:"auto" } : { left:0 };
                        return (
                          <div key={gs.id} style={{ flex:1, display:"flex", flexDirection:"column", gap:3, position:"relative" }}
                            ref={isOpen ? stepDropRef : null}>
                            <span style={{ ...mono, fontSize:10, color:sc, whiteSpace:"nowrap" }}>{gs.short}</span>
                            <button
                              title={`${gs.label}: ${sd.status} — click to update`}
                              onClick={e => { e.stopPropagation(); setOpenGamingDropdown(isOpen ? null : { accId:acc.id, stepId:gs.id }); }}
                              style={{ height:12, background:sc, borderRadius:3, border:"none",
                                cursor:"pointer", padding:0, width:"100%",
                                boxShadow:sd.status==="Blocked"?"0 0 6px #EF4444":undefined }}>
                            </button>
                            {isOpen && (
                              <div style={{ position:"absolute", top:"calc(100% + 6px)", zIndex:300,
                                background:C.card, border:`1px solid ${C.brd}`, borderRadius:7,
                                boxShadow:"0 8px 28px #000c", padding:"4px 0", minWidth:150, ...dropAlign }}>
                                <div style={{ ...mono, fontSize:11, color:C.dim, padding:"4px 12px 6px",
                                  borderBottom:`1px solid ${C.brd}44` }}>{gs.label}</div>
                                {STEP_STATUSES.map(status => (
                                  <button key={status}
                                    onClick={e => { e.stopPropagation(); updateGamingStep(acc.id, gs.id, status); }}
                                    style={{ display:"flex", alignItems:"center", gap:8, width:"100%",
                                      padding:"6px 12px", background:sd.status===status?`${STATUS_C[status]}18`:"transparent",
                                      border:"none", cursor:"pointer", textAlign:"left",
                                      borderLeft:sd.status===status?`2px solid ${STATUS_C[status]}`:"2px solid transparent" }}>
                                    <span style={{ ...mono, fontSize:13, color:STATUS_C[status] }}>{STATUS_IC[status]}</span>
                                    <span style={{ ...mono, fontSize:13, color:sd.status===status?STATUS_C[status]:C.txt }}>{status}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {/* Days col: empty */}
                    <div/>
                    {/* Task col: empty */}
                    <div/>
                    {/* USCOMP button */}
                    <div style={{ display:"flex", gap:4, alignItems:"center" }} onClick={e => e.stopPropagation()}>
                      <button
                        title="Open USCO Compliance Jira ticket"
                        onClick={() => window.open(JIRA_USCOMP_URL, "_blank", "noopener,noreferrer")}
                        style={{ ...mono, fontSize:11, padding:"3px 7px", background:"#F59E0B18",
                          border:"1px solid #F59E0B44", borderRadius:4, color:"#F59E0B",
                          cursor:"pointer", whiteSpace:"nowrap" }}>
                        USCO ↗
                      </button>
                    </div>
                    {/* Notes col: empty */}
                    <div/>
                  </div>
                );
              })()}

              {/* Auto-summary row (always visible when summary or legacy note exists) */}
              {showSummaryRow && (
                <div style={{ padding:"6px 14px 8px", paddingLeft:236, borderBottom:`1px solid ${C.brd}22`,
                  borderLeft: isBlocked?`3px solid #EF4444`: allApproved?`3px solid ${C.green}`:`3px solid transparent`,
                  background:C.sur }}>
                  {hasSummary && (
                    <div style={{ ...mono, fontSize:11, color:T.text.dim, display:"flex", alignItems:"flex-start", gap:6, lineHeight:1.5 }}>
                      <span style={{ color:T.amber, flexShrink:0 }}>◆</span>
                      <span>{summary}</span>
                    </div>
                  )}
                  {hasNote && (
                    <div style={{ ...mono, fontSize:10, color:T.text.muted, paddingLeft:16, marginTop:hasSummary?3:0, lineHeight:1.5 }}>
                      {prNotes[acc.id]}
                    </div>
                  )}
                </div>
              )}
              </React.Fragment>
            );
          })}
        </div>
      )}

      {/* Legend */}
      <div style={{ display:"flex", gap:14, marginTop:10, flexWrap:"wrap" }}>
        {Object.entries(STATUS_C).map(([s,c])=>(
          <span key={s} style={{ ...mono, fontSize:11, color:c }}>{STATUS_IC[s]} {s}</span>
        ))}
        <span style={{ ...mono, fontSize:11, color:C.dim, marginLeft:"auto" }}>
          ☐ open task · ☑ done · + create task · SF ↗ Salesforce · click dot to update status
        </span>
      </div>
    </div>
  );
}
