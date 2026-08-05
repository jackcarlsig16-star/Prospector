import { useState, useEffect } from "react";
import { C, mono } from '../constants/colors';
import AdminInvites from './admin/AdminInvites';
import AdminOrgChart from './admin/AdminOrgChart';
import { PRODUCTS_OVERRIDE_KEY, loadProductOverrides } from './PricingPage';
import { PRICING_PRODUCTS_DEFAULT } from '../constants/products';
import {
  getInvites, createInvite, buildInviteEmail,
  getMasterCodeHash, generateMasterCode, setMasterCode,
  generateCode,
} from '../utils/invites';
import { saveTeamUsers, saveFrontier, approveUser, patchUser } from '../utils/db';
import { isSupabaseEnabled } from '../utils/supabase';
import { mapSfdcStage } from '../utils/stageMap';

// Small pure helpers duplicated from App.js (defined there at module scope)
const initials = n => (n||"?").split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);

// Duplicated from App.js — also used in AdminPanel there; kept in sync
const INTEGRATION_DEFS = [
  { id:"hunter", name:"Hunter.io", color:"#F06A35", desc:"Find and verify professional email addresses for outbound prospecting.", keyLabel:"API Key", storageKey:null },
  { id:"resend", name:"Resend", color:"#7C3AED", desc:"Email delivery for BDR notifications and campaign triggers.", keyLabel:"API Key", storageKey:null },
  { id:"zoominfo", name:"ZoomInfo", color:"#0066CC", desc:"B2B contact intelligence — firmographics, org charts, intent signals.", keyLabel:"API Key", storageKey:null },
  { id:"clearbit", name:"Clearbit", color:"#4945FF", desc:"Company enrichment — funding, headcount, tech stack, industry classification.", keyLabel:"API Key", storageKey:null },
];

// ─── Admin Page ───────────────────────────────────────────────────────────────
const ROLES_LIST = ["AE","BDR","Manager","Admin","Owner"];

const ROLE_COLORS = { AE:C.gold, BDR:C.purple, Manager:C.blue, Admin:C.red, Owner:"#E040FB" };

const PERM_META = [
  { key:"canEditStage",   label:"Edit deal stage",       desc:"Move accounts through pipeline stages",                    roles:["AE","BDR","Manager"] },
  { key:"canUpload",      label:"Upload & import",        desc:"Upload CSVs and add accounts in bulk",                     roles:["AE"] },
  { key:"canStealth",     label:"Stealth research",       desc:"Run founder / stealth LinkedIn scans",                     roles:["AE"] },
  { key:"canReassay",     label:"Re-run assay",           desc:"Re-score accounts with the assay engine",                  roles:["AE"] },
  { key:"canClaim",       label:"Claim Jumper",           desc:"Claim accounts from the shared pool",                      roles:["AE"] },
  { key:"canRemove",      label:"Remove accounts",        desc:"Delete accounts from the book",                            roles:["AE"] },
  { key:"canFlagRemoval", label:"Flag for removal",       desc:"Flag accounts for the AE to review and drop",              roles:["BDR"] },
  { key:"canAdmin",       label:"Admin access",           desc:"Access the Admin panel and manage settings",               roles:["Admin","Owner"] },
];

const ROLE_DESC = {
  Owner:   { headline:"Owner",               body:"Builder of this tool. Full access above Admin — cannot be modified, cannot be demoted." },
  Admin:   { headline:"Admin / Sales Ops",   body:"Full unrestricted access. Manages users, roles, and permissions. Cannot be modified." },
  AE:      { headline:"Account Executive",   body:"Territory owner. Runs research, scores accounts, owns the full pipeline. Core permissions locked — this is you." },
  Manager: { headline:"Manager",             body:"Read-across view of all AE territories. Can edit stages to keep pipeline hygiene. No write access to accounts or research tools." },
  BDR:     { headline:"Deputy AE",           body:"Works within the AE's territory. Can edit stages, flag removals, and action the SF queue. Customize what they can touch below." },
};

function AccessLogTab() {
  const [entries, setEntries] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const load = () => {
    setLoading(true);
    fetch('/api/access-log')
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); setLoading(false); return; }
        setEntries(d.entries || []);
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  };
  useEffect(() => { load(); }, []);

  const fmtTime = ts => {
    if (!ts) return '-';
    const d = new Date(ts);
    return d.toLocaleDateString('en-US', { month:'short', day:'numeric' }) + ' ' +
           d.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', hour12:true });
  };
  const fmtUA = ua => {
    if (!ua) return '-';
    if (/iPhone|iPad/.test(ua))                          return 'iOS';
    if (/Android/.test(ua))                              return 'Android';
    if (/Mac/.test(ua) && /Chrome/.test(ua))             return 'Chrome / Mac';
    if (/Mac/.test(ua) && /Safari/.test(ua))             return 'Safari / Mac';
    if (/Windows/.test(ua) && /Chrome/.test(ua))         return 'Chrome / Win';
    if (/Firefox/.test(ua))                              return 'Firefox';
    return ua.slice(0, 40);
  };

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
        <div>
          <p style={{ ...mono, margin:'0 0 2px', fontSize:13, fontWeight:600, color:C.txt }}>Access Log</p>
          <p style={{ ...mono, margin:0, fontSize:11, color:C.dim }}>Last 50 gate events - successful logins and unauthenticated hits</p>
        </div>
        <button onClick={load} style={{ ...mono, fontSize:11, padding:'5px 12px', background:'transparent', border:`1px solid ${C.brd}`, borderRadius:5, color:C.mut, cursor:'pointer' }}>Refresh</button>
      </div>
      {loading && <p style={{ ...mono, fontSize:12, color:C.dim, padding:'20px 0' }}>Loading...</p>}
      {error   && <p style={{ ...mono, fontSize:12, color:C.red }}>{error}</p>}
      {!loading && !error && entries && (
        <div style={{ border:`1px solid ${C.brd}`, borderRadius:8, overflow:'hidden' }}>
          <div style={{ display:'grid', gridTemplateColumns:'110px 70px 110px 1fr', padding:'6px 12px', background:C.card, borderBottom:`1px solid ${C.brd}` }}>
            {['Time','Event','Code','User Agent'].map((h,i) => (
              <span key={i} style={{ ...mono, fontSize:9, color:C.dim, textTransform:'uppercase', letterSpacing:'0.08em' }}>{h}</span>
            ))}
          </div>
          {entries.length === 0 && <p style={{ ...mono, fontSize:12, color:C.dim, padding:'16px 12px', margin:0 }}>No entries yet.</p>}
          {entries.map((e, i) => (
            <div key={e.id} style={{ display:'grid', gridTemplateColumns:'110px 70px 110px 1fr', padding:'6px 12px', borderBottom:i<entries.length-1?`1px solid ${C.brd}22`:'none', background:i%2===0?'transparent':`${C.brd}0A`, alignItems:'center' }}>
              <span style={{ ...mono, fontSize:10, color:C.mut }}>{fmtTime(e.created_at)}</span>
              <span style={{ ...mono, fontSize:10, fontWeight:600, color:e.event==='success'?C.green:e.event==='session'?'#2dd4bf':C.orange }}>{e.event==='success'?'✓ LOGIN':e.event==='session'?'↩ SESSION':'? HIT'}</span>
              <span style={{ ...mono, fontSize:10, color:e.code_partial?C.gold:C.dim }}>{e.code_partial||'-'}</span>
              <span style={{ ...mono, fontSize:10, color:C.mut }}>{fmtUA(e.user_agent)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Onboarding Tab ───────────────────────────────────────────────────────────
function OnboardingTab({ users = [], setUsers, onSaveUsers, invites = [], setInvites }) {
  const NEON = '#39FF14';
  const AMB  = '#FFB800';
  const CYN  = '#00F5FF';
  const RED  = '#FF4444';
  const [copied, setCopied] = useState(null);
  const [reset, setReset] = useState(false);

  const pending = users.filter(u => (u.status || '').toLowerCase() === 'pending');

  const setStatus = async (id, status) => {
    const next = users.map(u => u.id === id ? { ...u, status } : u);
    setUsers(next);
    onSaveUsers && onSaveUsers(next);
    try { await patchUser(id, { status }); } catch {}
    if (status === 'approved') {
      const u = next.find(x => x.id === id);
      if (u) {
        try {
          await fetch('/api/notify-approved', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: u.name, email: u.email, role: u.role }),
          });
        } catch {}
      }
    }
  };

  const copyCode = (code) => {
    navigator.clipboard.writeText(code).catch(()=>{});
    setCopied(code);
    setTimeout(()=>setCopied(null), 1800);
  };

  const genCode = (prefix) => {
    const existing = (invites || []).map(i => i.code);
    const code = generateCode(existing, { prefix, suffixLen: 4 });
    const next = [...(invites || []), {
      id: `inv_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
      code, name: '', email: '', role: prefix === 'ADMIN' ? 'admin' : 'ae',
      createdAt: new Date().toISOString(), createdBy: 'admin-onboarding-panel',
      usedAt: null, usedBy: null, status: 'pending',
    }];
    try { localStorage.setItem('prospector_invites', JSON.stringify(next)); } catch {}
    setInvites && setInvites(next);
    copyCode(code);
    return code;
  };

  const resetMyOnboarding = () => {
    [
      'prospector_onboarding_state',
      'prospector_wizard_step',
      'prospector_admin_pinged',
      'prospector_pending_role',
      'prospector_gate_unlocked',
      'sfdc_company',
      'sfdc_user_email',
      'prospector_user',
    ].forEach(k => { try { localStorage.removeItem(k); } catch {} });
    setReset(true);
    setTimeout(() => { window.location.reload(); }, 800);
  };

  const SH = { ...mono, fontSize:10, color:CYN, textTransform:'uppercase', letterSpacing:'0.14em', fontWeight:600, textShadow:`0 0 6px ${CYN}55`, margin:'0 0 12px' };
  const card = { background:'#050f05', border:`1px solid ${CYN}22`, borderRadius:8, padding:'16px 18px', marginBottom:16 };

  return (
    <div>
      <p style={{ ...mono, margin:'0 0 16px', fontSize:11, color:'#5a6a5a', letterSpacing:'0.06em' }}>
        ⛏ ONBOARDING TESTER — generate invites, approve users, reset your onboarding to re-run the flow.
      </p>

      {/* Pending Users */}
      <div style={card}>
        <p style={SH}>Pending Users ({pending.length})</p>
        {pending.length === 0 ? (
          <p style={{ ...mono, fontSize:12, color:'#5a6a5a', fontStyle:'italic' }}>No pending approvals.</p>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {pending.map(u => (
              <div key={u.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 10px', background:'#0a1a0a', border:`1px solid ${AMB}33`, borderRadius:5 }}>
                <span style={{ ...mono, fontSize:9, color:AMB, padding:'1px 6px', border:`1px solid ${AMB}55`, borderRadius:3 }}>PENDING</span>
                <span style={{ ...mono, fontSize:13, color:'#cfe8d4', fontWeight:500 }}>{u.name || '—'}</span>
                <span style={{ ...mono, fontSize:11, color:'#8a9a8a', flex:1 }}>{u.email || '—'} · {u.role || 'AE'}</span>
                <button onClick={()=>setStatus(u.id, 'approved')}
                  style={{ ...mono, fontSize:10, padding:'3px 10px', background:`${NEON}14`, border:`1px solid ${NEON}66`, color:NEON, borderRadius:4, cursor:'pointer', textShadow:`0 0 6px ${NEON}66` }}>
                  ✓ Approve
                </button>
                <button onClick={()=>setStatus(u.id, 'rejected')}
                  style={{ ...mono, fontSize:10, padding:'3px 10px', background:`${RED}14`, border:`1px solid ${RED}55`, color:RED, borderRadius:4, cursor:'pointer' }}>
                  ✕ Reject
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Code generators */}
      <div style={card}>
        <p style={SH}>Generate Codes</p>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <button onClick={()=>genCode('GOLD')}
            style={{ ...mono, fontSize:11, padding:'6px 14px', background:`${NEON}14`, border:`1px solid ${NEON}55`, color:NEON, borderRadius:5, cursor:'pointer', letterSpacing:'0.06em' }}>
            ⛏ GENERATE INVITE CODE (GOLD-XXXX)
          </button>
          <button onClick={()=>genCode('ADMIN')}
            style={{ ...mono, fontSize:11, padding:'6px 14px', background:`${AMB}14`, border:`1px solid ${AMB}55`, color:AMB, borderRadius:5, cursor:'pointer', letterSpacing:'0.06em' }}>
            ⚠ GENERATE ADMIN CODE (ADMIN-XXXX)
          </button>
        </div>
        {copied && (
          <p style={{ ...mono, margin:'10px 0 0', fontSize:11, color:NEON }}>✓ Copied: {copied}</p>
        )}
        <p style={{ ...mono, margin:'10px 0 0', fontSize:10, color:'#5a6a5a' }}>
          Generated codes are saved to prospector_invites and immediately redeemable from the welcome gate.
        </p>
      </div>

      {/* Reset onboarding */}
      <div style={card}>
        <p style={SH}>Reset My Onboarding</p>
        <p style={{ ...mono, margin:'0 0 12px', fontSize:11, color:'#8a9a8a', lineHeight:1.6 }}>
          Clears your local user record, gate state, onboarding markers, and SFDC pre-fill so you can run the full welcome flow again. Reloads the page after a brief beat.
        </p>
        {!reset ? (
          <button onClick={resetMyOnboarding}
            style={{ ...mono, fontSize:11, padding:'6px 14px', background:`${RED}14`, border:`1px solid ${RED}55`, color:RED, borderRadius:5, cursor:'pointer', letterSpacing:'0.06em' }}>
            ⚠ RESET MY ONBOARDING
          </button>
        ) : (
          <p style={{ ...mono, fontSize:11, color:NEON }}>✓ Reset — reloading…</p>
        )}
      </div>
    </div>
  );
}

function AdminPage({ teamUsers=[], onSaveUsers, currentUser, onUpdateCurrentUser, rolePerms={}, onSaveRolePerms, onSave, onSaveToPool, onSaveBatch, accounts=[], removedBlocklist=[], onRestoreAccount, nuggets=[], onSaveNuggets, seedTeam=[] }) {
  const [tab, setTab] = useState("users");
  const [users, setUsers] = useState(teamUsers);
  useEffect(() => { setUsers(teamUsers); }, [teamUsers]);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ name:"", email:"", role:"BDR", company:"Prospector", assignedAEs:[] });
  const upd = p => setForm(f=>({...f,...p}));

  // live perms state (editable copy)
  const [permsEdit, setPermsEdit] = useState(rolePerms);
  const [permsSaved, setPermsSaved] = useState(false);

  // Territories
  const [territories, setTerritories] = useState(()=>{try{return JSON.parse(localStorage.getItem("prospector_territories")||"[]");}catch{return [];}});
  const [terrForm, setTerrForm] = useState({name:"",region:""});
  useEffect(()=>{try{localStorage.setItem("prospector_territories",JSON.stringify(territories));}catch{}},[territories]);
  const addTerritory = () => { if(!terrForm.name.trim())return; setTerritories(prev=>[...prev,{id:`t${Date.now()}`,name:terrForm.name.trim(),region:terrForm.region.trim()}]); setTerrForm({name:"",region:""}); };

  // API key integrations
  const [integrations, setIntegrations] = useState(()=>{try{return JSON.parse(localStorage.getItem("prospector_integrations")||"{}");}catch{return {};}});
  const [keyInputs, setKeyInputs] = useState({});

  // Hunter.io quota + connection test
  const [hunterAccount, setHunterAccount] = useState(null);
  const [hunterTesting, setHunterTesting] = useState(false);
  const [hunterTestError, setHunterTestError] = useState(null);
  const testHunterConnection = async () => {
    setHunterTesting(true); setHunterTestError(null);
    try {
      const r = await fetch('/api/hunter/account');
      const data = await r.json();
      if (!r.ok) { setHunterTestError(data.error || `Error ${r.status}`); setHunterAccount(null); }
      else { setHunterAccount(data); }
    } catch (e) { setHunterTestError(e.message); }
    setHunterTesting(false);
  };
  useEffect(()=>{try{localStorage.setItem("prospector_integrations",JSON.stringify(integrations));}catch{}},[integrations]);
  const getKeyValue = def => def.storageKey ? (localStorage.getItem(def.storageKey)||"") : (integrations[def.id]||"");
  const isConnected = def => !!getKeyValue(def);
  const connectIntegration = (id, storageKey) => { const val=keyInputs[id]||""; if(!val.trim())return; if(storageKey)localStorage.setItem(storageKey,val.trim()); setIntegrations(prev=>({...prev,[id]:val.trim()})); setKeyInputs(prev=>({...prev,[id]:""})); };
  const disconnectIntegration = (id, storageKey) => { if(storageKey)localStorage.removeItem(storageKey); setIntegrations(prev=>{const n={...prev};delete n[id];return n;}); };

  // Salesforce OAuth state
  const [sfdcToken, setSfdcToken] = useState(()=>localStorage.getItem("sfdc_access_token")||"");
  const [sfdcInstance, setSfdcInstance] = useState(()=>localStorage.getItem("sfdc_instance_url")||"");
  const [sfdcUserId, setSfdcUserId] = useState(()=>localStorage.getItem("sfdc_user_id")||"");
  const [sfdcUserName, setSfdcUserName] = useState(()=>localStorage.getItem("sfdc_user_name")||"");
  const sfdcConnected = !!sfdcToken && !!sfdcInstance;
  const [sfdcSyncing, setSfdcSyncing] = useState(null);
  const [sfdcResult, setSfdcResult] = useState(null);
  const [sfdcManual, setSfdcManual] = useState(false);
  const [sfdcManualInputs, setSfdcManualInputs] = useState({token:"", instance:"", userId:""});

  const connectSfdcManual = () => {
    const t = sfdcManualInputs.token.trim();
    const i = sfdcManualInputs.instance.trim().replace(/\/$/, "");
    const u = sfdcManualInputs.userId.trim();
    if(!t || !i) return;
    localStorage.setItem("sfdc_access_token", t);
    localStorage.setItem("sfdc_instance_url", i);
    if(u) localStorage.setItem("sfdc_user_id", u);
    localStorage.setItem("sfdc_user_name", "Manual token");
    setSfdcToken(t); setSfdcInstance(i); setSfdcUserId(u); setSfdcUserName("Manual token");
    setSfdcManual(false); setSfdcManualInputs({token:"", instance:"", userId:""});
  };

  const disconnectSfdc = () => {
    ["sfdc_access_token","sfdc_instance_url","sfdc_user_id","sfdc_user_name"].forEach(k=>localStorage.removeItem(k));
    setSfdcToken(""); setSfdcInstance(""); setSfdcUserId(""); setSfdcUserName("");
    setSfdcResult(null); setSfdcManual(false);
  };

  const syncFromSfdc = async (mode) => {
    if(!sfdcConnected) return;
    setSfdcSyncing(mode); setSfdcResult(null);
    try {
      const res = await fetch("/api/sfdc/accounts", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ access_token:sfdcToken, instance_url:sfdcInstance, user_id:sfdcUserId, mode }),
      });
      const data = await res.json();
      if(!res.ok || data.error) { setSfdcResult({error:data.error||"Sync failed",mode}); return; }
      const incoming = data.accounts || [];
      if(mode==="dormant"){
        onSaveToPool&&onSaveToPool(incoming);
      } else {
        if(onSave){
          const merged=[...accounts];
          incoming.forEach(na=>{
            const idx=merged.findIndex(x=>x.name.toLowerCase()===na.name.toLowerCase()||x.sfdc===na.sfdc);
            const target = idx>=0 ? merged[idx] : null;
            const mappedStage = mapSfdcStage(na.sfdcStageName);
            const dealStageUpdate = mappedStage && target?.dealStageSource !== "manual"
              ? { dealStage: mappedStage, dealStageSource: "sfdc", dealStageUpdatedAt: new Date().toISOString() }
              : {};
            if(idx>=0) Object.assign(merged[idx], na, dealStageUpdate);
            else merged.push({...na, stage:"Prospecting", by:currentUser?.name||"AE", ...dealStageUpdate});
          });
          onSave(merged);
        }
      }
      onSaveBatch&&onSaveBatch({id:Date.now(),fileName:`SFDC ${mode==="dormant"?"Dormant":"My Accounts"}`,uploadType:mode,date:new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}),total:incoming.length,gold:0,silver:0,note:`Pulled from Salesforce`});
      setSfdcResult({count:incoming.length,mode});
    } catch(err){
      setSfdcResult({error:err.message,mode});
    } finally {
      setSfdcSyncing(null);
    }
  };

  // Org chart drag state
  const [dragId,  setDragId]  = useState(null);
  const [dragOver,setDragOver]= useState(null);
  const [invitedIds, setInvitedIds] = useState(new Set());

  // Invite tab state
  const [invites,         setInvites]         = useState(getInvites);
  const [newUserCode,     setNewUserCode]     = useState(null); // { name, code, role } shown after Add user
  const [inviteModal,     setInviteModal]     = useState(false);
  const [inviteForm,      setInviteForm]      = useState({ name:"", email:"", role:"bdr" });
  const [inviteConfirm,   setInviteConfirm]   = useState(null); // { code, email }
  const [copiedInvCode,   setCopiedInvCode]   = useState(null);
  const [invitePage,      setInvitePage]      = useState(0);
  // Master code modal state (lives here so it persists across tab switches)
  const [masterCodeModal, setMasterCodeModal] = useState(null); // null | { code }
  const [masterCopied,    setMasterCopied]    = useState(false);
  const [supabaseSyncing, setSupabaseSyncing] = useState(false);
  const [supabaseSeeded,  setSupabaseSeeded]  = useState(()=>localStorage.getItem('prospector_supabase_seeded')==='true');

  const openNew = () => { setForm({ name:"", email:"", role:"BDR", company:"Prospector", assignedAEs: currentUser?.id ? [currentUser.id] : [] }); setModal({}); };
  const openEdit = u => { setForm({ name:u.name, email:u.email, role:u.role, company:u.company||"Prospector", assignedAEs:u.assignedAEs||[] }); setModal(u); };

  const saveUser = () => {
    if(!form.name.trim()) return;
    const isNew = !modal.id;
    // Email is source of truth: find existing entry by id OR email
    const emailLower = form.email.trim().toLowerCase();
    const existingById = modal.id ? users.find(u=>u.id===modal.id) : null;
    const existingByEmail = !modal.id && emailLower ? users.find(u=>u.email?.toLowerCase()===emailLower) : null;
    const existing = existingById || existingByEmail;
    const id = existing?.id || `u_${Date.now()}`;
    const entry = { ...(existing||{}), id, name:form.name.trim(), email:form.email.trim(), role:form.role, company:form.company.trim()||"Prospector", status: existing?.status || "pending",
      ...(form.role === "BDR" ? { assignedAEs: form.assignedAEs||[] } : {}) };
    const next = existing
      ? users.map(u=>u.id===existing.id?entry:u)
      : [...users, entry];
    setUsers(next); onSaveUsers(next); setModal(null);
    // For new users, auto-generate an invite code and show it
    if (isNew) {
      const roleForInvite = form.role.toLowerCase();
      const invite = createInvite({ name:form.name.trim(), email:form.email.trim(), role:roleForInvite, createdBy:currentUser?.name||"" });
      setInvites(getInvites());
      setNewUserCode({ name:form.name.trim(), code:invite.code, role:form.role, email:form.email.trim() });
    }
  };

  const activateUser = id => {
    const next = users.map(u => u.id===id ? { ...u, status:"active" } : u);
    setUsers(next); onSaveUsers(next);
    approveUser(id);
  };

  const importSeedTeam = () => {
    let tombstoned = new Set();
    try { tombstoned = new Set(JSON.parse(localStorage.getItem('prospector_removed_user_ids') || '[]')); } catch {}
    const existingEmails = new Set(users.map(u=>u.email?.toLowerCase()));
    const toAdd = seedTeam.filter(u =>
      !existingEmails.has(u.email?.toLowerCase()) && !tombstoned.has(u.id)
    );
    if(!toAdd.length) return;
    const next = [...users, ...toAdd];
    setUsers(next); onSaveUsers(next);
  };

  const removeUser = id => {
    try {
      const removed = JSON.parse(localStorage.getItem('prospector_removed_user_ids') || '[]');
      if (!removed.includes(id)) {
        removed.push(id);
        localStorage.setItem('prospector_removed_user_ids', JSON.stringify(removed));
      }
    } catch {}
    const next = users.filter(u=>u.id!==id)
      .map(u => u.assignedAEs?.includes(id) ? { ...u, assignedAEs: u.assignedAEs.filter(x=>x!==id) } : u);
    setUsers(next); onSaveUsers(next);
  };

  const togglePerm = (role, key) => {
    setPermsEdit(p=>({ ...p, [role]:{ ...p[role], [key]:!p[role][key] } }));
    setPermsSaved(false);
  };
  const resetRole = role => { setPermsEdit(p=>({ ...p, [role]:rolePerms[role] })); setPermsSaved(false); };
  const savePerms = () => { onSaveRolePerms(permsEdit); setPermsSaved(true); setTimeout(()=>setPermsSaved(false), 2000); };

  const LOCKED_ROLES = new Set(["Admin","Owner"]); // Admin/Owner always full-access, no edits

  // Pricing tab state (must live at component level — can't be inside a conditional)
  const [pricingOverrides, setPricingOverrides] = useState(()=>loadProductOverrides());
  const [pricingSearch, setPricingSearch] = useState("");

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom:18 }}>
        <h2 style={{ margin:"0 0 3px", fontSize:20, fontWeight:600, color:C.txt }}>Admin</h2>
        <p style={{ ...mono, margin:0, fontSize:12, color:C.dim }}>Users, roles, territories, and API keys</p>
      </div>

      {/* Tab bar — grouped */}
      {(()=>{
        const pendingNuggets = nuggets.filter(n=>n.status==="pending").length;
        const pendingApprovalsCount = users.filter(u => u.status === 'pending').length;
        const TAB_GROUPS = [
          { label:"TEAM", tabs:[
            ["users",       "👥 Users"],
            ["orgchart",    "🌳 Org Chart"],
            ["permissions", "🔐 Permissions"],
            ["territories", "🗺 Territories"],
          ]},
          { label:"PLATFORM", tabs:[
            ["apikeys",    "🔑 API Keys"],
            ["pricing",    "💰 Pricing"],
            ["access",     "⛏ Invites"],
            ["accesslog",  "📋 Access Log"],
            ["onboarding", `⛏ Onboarding${pendingApprovalsCount>0?` (${pendingApprovalsCount})`:""}`],
          ]},
          { label:"DATA", tabs:[
            ["nuggets",  `🪙 Nuggets${pendingNuggets>0?` (${pendingNuggets})`:""}`],
            ["removed",  `🗑 Removed${removedBlocklist.length>0?` (${removedBlocklist.length})`:""}`],
            ["settings", "⚙️ Settings"],
          ]},
        ];
        const tabColor = (id) => {
          if (tab===id) return C.gold;
          if (id==="nuggets" && pendingNuggets>0) return C.gold;
          if (id==="removed" && removedBlocklist.length>0) return C.orange;
          return C.mut;
        };
        return (
          <div style={{ display:"flex", alignItems:"flex-end", gap:0, marginBottom:22, borderBottom:`1px solid ${C.brd}`, paddingBottom:0, flexWrap:"wrap" }}>
            {TAB_GROUPS.map((grp, gi) => (
              <div key={grp.label} style={{ display:"flex", alignItems:"flex-end", gap:0 }}>
                {/* Vertical divider between groups */}
                {gi>0 && <div style={{ width:1, height:28, background:C.brd, margin:"0 8px 1px", flexShrink:0 }}/>}
                <div style={{ display:"flex", flexDirection:"column", gap:0 }}>
                  {/* Group label */}
                  <span style={{ ...mono, fontSize:9, color:`${C.gold}66`, letterSpacing:"0.12em", textTransform:"uppercase", paddingLeft:12, marginBottom:4 }}>{grp.label}</span>
                  {/* Tabs in group */}
                  <div style={{ display:"flex", gap:0 }}>
                    {grp.tabs.map(([id,lb])=>(
                      <button key={id} onClick={()=>setTab(id)} style={{ ...mono, fontSize:12, padding:"6px 14px", background:"transparent", border:"none", borderBottom:`2px solid ${tab===id?C.gold:"transparent"}`, color:tabColor(id), cursor:"pointer", marginBottom:-1, whiteSpace:"nowrap" }}>{lb}</button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* ── USERS TAB ── */}
      {tab==="users"&&(<>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14, flexWrap:"wrap" }}>
          <p style={{ ...mono, margin:0, fontSize:11, color:C.dim, flex:1 }}>Manage who can access Prospector and what role they have</p>
          {seedTeam.length>0&&(()=>{
            let tombstoned = new Set();
            try { tombstoned = new Set(JSON.parse(localStorage.getItem('prospector_removed_user_ids') || '[]')); } catch {}
            const existingEmails = new Set(users.map(u=>u.email?.toLowerCase()));
            const newCount = seedTeam.filter(u =>
              !existingEmails.has(u.email?.toLowerCase()) && !tombstoned.has(u.id)
            ).length;
            if(!newCount) return null;
            return <button onClick={importSeedTeam} style={{ ...mono, fontSize:12, padding:"6px 14px", background:`${C.blue}14`, border:`1px solid ${C.blue}44`, color:C.blue, borderRadius:6, cursor:"pointer" }}>↓ Import team ({newCount})</button>;
          })()}
          <button onClick={openNew} style={{ ...mono, fontSize:12, padding:"6px 14px", background:`${C.gold}18`, border:`1px solid ${C.gold}55`, color:C.gold, borderRadius:6, cursor:"pointer", fontWeight:600 }}>+ Add user</button>
        </div>

        {/* You */}
        <p style={{ ...mono, fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", margin:"0 0 6px" }}>You</p>
        <div style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 14px", background:C.card, border:`1px solid ${C.goldBdr}`, borderRadius:8, marginBottom:16 }}>
          <div style={{ width:32, height:32, borderRadius:"50%", background:C.goldBg, border:`1px solid ${C.goldBdr}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, color:C.gold, fontWeight:700, ...mono, flexShrink:0 }}>{initials(currentUser?.name)}</div>
          <div style={{ flex:1 }}>
            <p style={{ margin:"0 0 2px", fontSize:14, color:C.txt, fontWeight:500 }}>{currentUser?.name}</p>
            <p style={{ ...mono, margin:0, fontSize:11, color:C.mut }}>{currentUser?.email||"—"}</p>
          </div>
          <span style={{ ...mono, fontSize:11, padding:"3px 10px", background:`${C.gold}18`, border:`1px solid ${C.gold}44`, color:C.gold, borderRadius:4 }}>{currentUser?.role||"AE"}</span>
          <span style={{ ...mono, fontSize:10, color:C.dim }}>owner</span>
        </div>

        {/* Team */}
        <p style={{ ...mono, fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", margin:"0 0 6px" }}>Team ({users.length})</p>
        {users.length===0&&<p style={{ ...mono, fontSize:13, color:C.dim, marginBottom:0 }}>No team members yet.</p>}
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {users.map(u=>{
            const rc=ROLE_COLORS[u.role]||C.purple;
            const isPending = u.status==="pending" || !u.status;
            // Only treat as "truly pending" if they don't have active status
            const isActive = u.status==="active";
            return(
              <div key={u.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", background:isPending?`${C.sur}88`:C.card, border:`1px solid ${isPending?C.brd+"88":C.brd}`, borderRadius:8, opacity:isPending?0.85:1 }}>
                <div style={{ position:"relative", flexShrink:0 }}>
                  <div style={{ width:32, height:32, borderRadius:"50%", background:`${rc}18`, border:`1px solid ${rc}55`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, color:rc, fontWeight:700, ...mono }}>{initials(u.name)}</div>
                  {isPending&&<div style={{ position:"absolute", bottom:-2, right:-2, width:10, height:10, borderRadius:"50%", background:C.orange, border:`2px solid ${C.bg}` }} title="Pending"/>}
                  {isActive&&<div style={{ position:"absolute", bottom:-2, right:-2, width:10, height:10, borderRadius:"50%", background:C.green, border:`2px solid ${C.bg}` }} title="Active"/>}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <p style={{ margin:0, fontSize:14, color:isPending?C.mut:C.txt, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{u.name}{u.onLeave&&<span style={{ ...mono, fontSize:9, color:C.dim, marginLeft:6 }}>on leave</span>}</p>
                    {isPending&&<span style={{ ...mono, fontSize:9, padding:"1px 5px", background:`${C.orange}18`, border:`1px solid ${C.orange}44`, color:C.orange, borderRadius:3, flexShrink:0 }}>pending</span>}
                  </div>
                  <p style={{ ...mono, margin:0, fontSize:11, color:C.dim }}>{u.email||"—"}{u.location&&<span style={{ marginLeft:8, opacity:0.6 }}>{u.location}</span>}</p>
                </div>
                <span style={{ ...mono, fontSize:11, padding:"3px 10px", background:`${rc}18`, border:`1px solid ${rc}44`, color:rc, borderRadius:4, flexShrink:0 }}>{u.role}</span>
                {isPending&&(
                  <button onClick={()=>activateUser(u.id)} style={{ ...mono, fontSize:11, padding:"3px 9px", background:`${C.green}14`, border:`1px solid ${C.green}44`, color:C.green, borderRadius:4, cursor:"pointer", flexShrink:0 }}>✓ Activate</button>
                )}
                <button
                  onClick={()=>{ const next=users.map(x=>x.id===u.id?{...x,role:x.role==="Admin"?(x._prevRole||"BDR"):x.role,_prevRole:x.role==="Admin"?undefined:x.role,_wasAdmin:x.role==="Admin"?undefined:true}:x); const toggled=next.map(x=>x.id===u.id?{...x,role:u.role==="Admin"?(u._prevRole||"BDR"):"Admin"}:x); setUsers(toggled); onSaveUsers(toggled); }}
                  title={u.role==="Admin"?"Remove admin":"Make admin"}
                  style={{ background:u.role==="Admin"?`${C.red}18`:"transparent", border:`1px solid ${u.role==="Admin"?C.red:C.brd}`, color:u.role==="Admin"?C.red:C.dim, fontSize:11, borderRadius:4, padding:"3px 9px", cursor:"pointer", ...mono, flexShrink:0 }}>
                  {u.role==="Admin"?"⚙ Admin":"⚙"}
                </button>
                <button onClick={()=>openEdit(u)} style={{ background:"transparent", border:`1px solid ${C.brd}`, color:C.mut, fontSize:11, borderRadius:4, padding:"3px 9px", cursor:"pointer", ...mono, flexShrink:0 }}>Edit</button>
                <button onClick={()=>removeUser(u.id)} style={{ background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, fontSize:11, borderRadius:4, padding:"3px 9px", cursor:"pointer", ...mono, flexShrink:0 }}>Remove</button>
              </div>
            );
          })}
        </div>
      </>)}

      {/* ── ORG CHART TAB ── */}
      {tab==="orgchart" && (
        <AdminOrgChart
          users={users}
          setUsers={setUsers}
          invitedIds={invitedIds}
          setInvitedIds={setInvitedIds}
          currentUser={currentUser}
          onSaveUsers={onSaveUsers}
          onUpdateCurrentUser={onUpdateCurrentUser}
          seedTeam={seedTeam}
          importSeedTeam={importSeedTeam}
        />
      )}
      {/* ── PERMISSIONS TAB ── */}
      {tab==="permissions"&&(<>
        <div style={{ display:"flex", alignItems:"center", marginBottom:18 }}>
          <p style={{ ...mono, margin:0, fontSize:11, color:C.dim }}>Toggle what each role can do — Admin and Owner are always full access and cannot be changed</p>
          <button onClick={savePerms} style={{ marginLeft:"auto", ...mono, fontSize:12, padding:"6px 14px", background:permsSaved?`${C.green}22`:`${C.gold}18`, border:`1px solid ${permsSaved?C.green:C.gold}55`, color:permsSaved?C.green:C.gold, borderRadius:6, cursor:"pointer", fontWeight:600 }}>
            {permsSaved?"✓ Saved":"Save changes"}
          </button>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {ROLES_LIST.map(role=>{
            const rc = ROLE_COLORS[role]||C.gold;
            const locked = LOCKED_ROLES.has(role);
            const desc = ROLE_DESC[role];
            const rp = permsEdit[role]||{};
            return(
              <div key={role} style={{ background:C.card, border:`1px solid ${locked?rc+"44":C.brd}`, borderRadius:10, overflow:"hidden" }}>
                <div style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 16px", borderBottom:`1px solid ${C.brd}`, background:locked?`${rc}08`:"transparent" }}>
                  <div style={{ width:34, height:34, borderRadius:"50%", background:`${rc}18`, border:`1px solid ${rc}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, color:rc, fontWeight:700, ...mono, flexShrink:0 }}>{role.slice(0,2).toUpperCase()}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
                      <span style={{ fontSize:14, fontWeight:600, color:rc }}>{role}</span>
                      <span style={{ ...mono, fontSize:11, color:C.mut }}>{desc?.headline}</span>
                      {locked&&<span style={{ ...mono, fontSize:9, padding:"1px 6px", background:`${rc}18`, border:`1px solid ${rc}44`, color:rc, borderRadius:3 }}>LOCKED</span>}
                    </div>
                    <p style={{ ...mono, margin:"2px 0 0", fontSize:11, color:C.dim }}>{desc?.body}</p>
                  </div>
                  {!locked&&<button onClick={()=>resetRole(role)} style={{ ...mono, fontSize:10, padding:"2px 8px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:4, cursor:"pointer", flexShrink:0 }}>Reset</button>}
                </div>
                <div style={{ padding:"8px 0" }}>
                  {PERM_META.map(p=>{
                    const on = locked ? true : (rp[p.key]||false);
                    const defaultOn = (rolePerms[role]||{})[p.key]||false;
                    const changed = !locked && on !== defaultOn;
                    return(
                      <div key={p.key} style={{ display:"flex", alignItems:"center", gap:12, padding:"7px 16px", opacity:locked?0.6:1 }}>
                        <div style={{ flex:1 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                            <span style={{ fontSize:13, color:on?C.txt:C.dim, fontWeight:on?500:400 }}>{p.label}</span>
                            {changed&&<span style={{ ...mono, fontSize:9, padding:"1px 5px", background:`${C.orange}18`, border:`1px solid ${C.orange}44`, color:C.orange, borderRadius:3 }}>modified</span>}
                          </div>
                          <p style={{ ...mono, margin:"1px 0 0", fontSize:11, color:C.dim }}>{p.desc}</p>
                        </div>
                        <button
                          disabled={locked}
                          onClick={()=>togglePerm(role, p.key)}
                          style={{ flexShrink:0, width:40, height:22, borderRadius:11, background:on?rc:"transparent", border:`1px solid ${on?rc:C.brdM}`, cursor:locked?"default":"pointer", position:"relative", transition:"background 0.15s" }}>
                          <span style={{ position:"absolute", top:2, left:on?20:2, width:16, height:16, borderRadius:"50%", background:on?"#fff":C.dim, transition:"left 0.15s" }}/>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </>)}

      {/* ── API KEYS TAB ── */}
      {tab==="apikeys"&&(
        <div>
          <p style={{ margin:"0 0 4px", fontSize:15, fontWeight:500, color:C.txt }}>API Keys</p>
          <p style={{ ...mono, margin:"0 0 14px", fontSize:12, color:C.mut }}>Stored locally in your browser only — never sent to any server other than the named service.</p>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>

            {/* ── Google ── */}
            <div style={{ background:C.card, border:`1px solid ${localStorage.getItem("gmail_access_token")?"#4ade8044":C.brd}`, borderRadius:8, padding:"14px 16px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}>
                <p style={{ margin:0, fontSize:15, fontWeight:500, color:localStorage.getItem("gmail_access_token")?"#4ade80":C.txt }}>Google</p>
                <span style={{ ...mono, fontSize:11, color:localStorage.getItem("gmail_access_token")?C.green:C.dim, marginLeft:"auto" }}>{localStorage.getItem("gmail_access_token")?"● Connected":"○ Disconnected"}</span>
              </div>
              <div style={{ ...mono, fontSize:10, color:"#555", marginBottom:8 }}>GMAIL + GOOGLE CALENDAR + GOOGLE SLIDES</div>
              {localStorage.getItem("gmail_access_token") ? (
                <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                  <span style={{ ...mono, fontSize:12, color:C.green }}>✓ Connected</span>
                  <button onClick={()=>{ window.location.href="/api/gmail/auth"; }}
                    style={{ ...mono, fontSize:12, padding:"5px 14px", background:`${C.gold}14`, border:`1px solid ${C.gold}44`, color:C.gold, borderRadius:5, cursor:"pointer" }}>
                    ↻ Reconnect Google →
                  </button>
                  <span style={{ ...mono, fontSize:10, color:"#555" }}>Authorizes Gmail, Google Calendar, and Google Slides</span>
                </div>
              ) : (
                <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                  <button onClick={()=>{ window.location.href="/api/gmail/auth"; }}
                    style={{ ...mono, fontSize:13, padding:"7px 18px", background:`${C.gold}14`, border:`1px solid ${C.gold}44`, color:C.gold, borderRadius:5, cursor:"pointer", fontWeight:600 }}>
                    Connect Google →
                  </button>
                  <span style={{ ...mono, fontSize:10, color:"#555" }}>Authorizes Gmail, Google Calendar, and Google Slides</span>
                </div>
              )}
            </div>

            {INTEGRATION_DEFS.map(def=>{
              const connected=isConnected(def);
              const maskedKey=connected?`${getKeyValue(def).slice(0,8)}${"•".repeat(16)}`:"";
              return(
                <div key={def.id} style={{ background:C.card, border:`1px solid ${connected?def.color+"44":C.brd}`, borderRadius:8, padding:"14px 16px" }}>
                  <div style={{ display:"flex", alignItems:"flex-start", gap:12 }}>
                    <div style={{ flex:1 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}>
                        <p style={{ margin:0, fontSize:15, fontWeight:500, color:connected?def.color:C.txt }}>{def.name}</p>
                        {def.required&&<span style={{ ...mono, fontSize:10, color:C.orange, border:`1px solid ${C.orange}44`, borderRadius:3, padding:"0 5px" }}>required</span>}
                        <span style={{ ...mono, fontSize:11, color:connected?C.green:C.dim, marginLeft:"auto" }}>{connected?"● Connected":"○ Disconnected"}</span>
                      </div>
                      <p style={{ margin:"0 0 10px", fontSize:13, color:C.mut, lineHeight:1.5 }}>{def.desc}</p>
                      {connected
                        ? <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                            <span style={{ ...mono, fontSize:12, color:C.dim, background:C.bg, border:`1px solid ${C.brd}`, borderRadius:4, padding:"4px 10px" }}>{maskedKey}</span>
                            <button onClick={()=>disconnectIntegration(def.id,def.storageKey)} style={{ fontSize:12, padding:"4px 12px", background:"transparent", border:`1px solid ${C.red}44`, color:C.red, borderRadius:5, cursor:"pointer" }}>Disconnect</button>
                          </div>
                        : <div style={{ display:"flex", gap:8 }}>
                            <input type="password" placeholder={`Paste ${def.keyLabel}`} value={keyInputs[def.id]||""} onChange={e=>setKeyInputs(p=>({...p,[def.id]:e.target.value}))} style={{ ...mono, fontSize:13, padding:"7px 10px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:5, color:C.txt, outline:"none", width:280, boxSizing:"border-box" }}/>
                            <button onClick={()=>connectIntegration(def.id,def.storageKey)} style={{ fontSize:13, padding:"7px 14px", background:C.sur, border:`1px solid ${def.color}66`, color:def.color, borderRadius:5, cursor:"pointer", fontWeight:500 }}>Connect →</button>
                          </div>
                      }

                      {/* Hunter.io: live connection test + quota display + key-handling warning */}
                      {def.id === 'hunter' && (
                        <div style={{ marginTop:10, paddingTop:10, borderTop:`1px solid ${C.brd}` }}>
                          <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                            <button onClick={testHunterConnection} disabled={hunterTesting}
                              style={{ ...mono, fontSize:11, padding:"4px 12px", background:`${def.color}14`, border:`1px solid ${def.color}66`, color:def.color, borderRadius:4, cursor:hunterTesting?'default':'pointer' }}>
                              {hunterTesting ? "Testing…" : "✓ Test connection"}
                            </button>
                            {hunterAccount && (
                              <span style={{ ...mono, fontSize:11, color:C.dim }}>
                                {hunterAccount.plan && <span style={{ color:def.color, marginRight:8 }}>{hunterAccount.plan}</span>}
                                {hunterAccount.searches && <span>searches {hunterAccount.searches.used}/{hunterAccount.searches.available}</span>}
                                {hunterAccount.verifications && <span style={{ marginLeft:8 }}>verifications {hunterAccount.verifications.used}/{hunterAccount.verifications.available}</span>}
                              </span>
                            )}
                            {hunterTestError && (
                              <span style={{ ...mono, fontSize:11, color:C.red }}>⚠ {hunterTestError}</span>
                            )}
                          </div>
                          <p style={{ ...mono, margin:"8px 0 0", fontSize:10, color:C.orange, opacity:0.8 }}>
                            ⚠ Key stored locally — move to server env (HUNTER_API_KEY) for production
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            <div style={{ background:C.card, border:`1px solid #0088CC44`, borderRadius:8, padding:"14px 16px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}>
                <p style={{ margin:0, fontSize:15, fontWeight:500, color:"#0099DD" }}>6sense</p>
                <span style={{ ...mono, fontSize:10, color:C.orange, border:`1px solid ${C.orange}44`, borderRadius:3, padding:"0 5px" }}>required</span>
                <span style={{ ...mono, fontSize:11, color:C.blue, marginLeft:"auto" }}>● CSV Upload</span>
              </div>
              <p style={{ margin:"0 0 10px", fontSize:13, color:C.mut, lineHeight:1.5 }}>Intent data and account enrichment via CSV export. No API key — upload enrichment files directly through the Uploads flow.</p>
              <button style={{ fontSize:13, padding:"6px 14px", background:"#001828", border:"1px solid #0088CC44", color:"#0099DD", borderRadius:5, cursor:"pointer", fontWeight:500 }}>Go to Uploads →</button>
            </div>

            {/* ── Salesforce ── */}
            <div style={{ background:C.card, border:`1px solid ${sfdcConnected?"#00A1E044":C.brd}`, borderRadius:8, padding:"14px 16px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}>
                <p style={{ margin:0, fontSize:15, fontWeight:500, color:sfdcConnected?"#00A1E0":C.txt }}>Salesforce</p>
                <span style={{ ...mono, fontSize:11, color:sfdcConnected?C.green:C.dim, marginLeft:"auto" }}>{sfdcConnected?"● Connected":"○ Disconnected"}</span>
              </div>
              <p style={{ margin:"0 0 10px", fontSize:13, color:C.mut, lineHeight:1.5 }}>
                Connect via OAuth to pull My Accounts and Dormant accounts directly from SFDC — no CSV needed.{sfdcConnected&&sfdcUserName&&<span style={{ color:C.dim }}> Signed in as <span style={{ color:C.txt }}>{sfdcUserName}</span>.</span>}
              </p>
              {sfdcConnected ? (
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                    <button onClick={()=>syncFromSfdc("my_accounts")} disabled={!!sfdcSyncing}
                      style={{ fontSize:13, padding:"7px 16px", background:sfdcSyncing==="my_accounts"?"#001408":"#041408", border:`1px solid ${C.green}55`, color:C.green, borderRadius:5, cursor:sfdcSyncing?"default":"pointer", fontWeight:500, opacity:sfdcSyncing&&sfdcSyncing!=="my_accounts"?0.5:1 }}>
                      {sfdcSyncing==="my_accounts"?"Pulling…":"⊕ My Accounts"}
                    </button>
                    <button onClick={()=>syncFromSfdc("dormant")} disabled={!!sfdcSyncing}
                      style={{ fontSize:13, padding:"7px 16px", background:sfdcSyncing==="dormant"?"#0C0C00":"#1A1A00", border:`1px solid ${C.tin}55`, color:C.tin, borderRadius:5, cursor:sfdcSyncing?"default":"pointer", fontWeight:500, opacity:sfdcSyncing&&sfdcSyncing!=="dormant"?0.5:1 }}>
                      {sfdcSyncing==="dormant"?"Pulling…":"◎ Dormant → Pool"}
                    </button>
                    <button onClick={disconnectSfdc}
                      style={{ fontSize:12, padding:"7px 14px", background:"transparent", border:`1px solid ${C.red}44`, color:C.red, borderRadius:5, cursor:"pointer", marginLeft:"auto" }}>
                      Disconnect
                    </button>
                  </div>
                  {sfdcResult&&(
                    <div style={{ ...mono, fontSize:12, padding:"7px 12px", borderRadius:5, background:sfdcResult.error?"#1A0000":"#001408", border:`1px solid ${sfdcResult.error?C.red:C.green}44`, color:sfdcResult.error?C.red:C.green }}>
                      {sfdcResult.error ? `✕ ${sfdcResult.error}` : `✓ ${sfdcResult.count} account${sfdcResult.count!==1?"s":""} pulled from ${sfdcResult.mode==="dormant"?"Dormant → Claim Jumper pool":"My Accounts → territory"}. Run assay to score.`}
                    </div>
                  )}
                  <p style={{ ...mono, margin:0, fontSize:11, color:C.dim, lineHeight:1.5 }}>Pulls: Account Name, Website, Owner, Billing State, Vertical, Subvertical, Last Activity Date, Account ID. Accounts are added without scores — run a batch assay from Uploads to analyze them.</p>
                </div>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                    <button onClick={()=>{ window.location.href="/api/sfdc/auth"; }}
                      style={{ fontSize:13, padding:"7px 18px", background:"#001828", border:"1px solid #00A1E066", color:"#00A1E0", borderRadius:5, cursor:"pointer", fontWeight:600 }}>
                      Connect via OAuth →
                    </button>
                    <button onClick={()=>setSfdcManual(m=>!m)}
                      style={{ fontSize:12, padding:"7px 14px", background:"transparent", border:`1px solid ${C.brd}`, color:C.mut, borderRadius:5, cursor:"pointer" }}>
                      {sfdcManual?"Cancel":"Paste token manually"}
                    </button>
                  </div>
                  {sfdcManual&&(
                    <div style={{ display:"flex", flexDirection:"column", gap:7, padding:"12px 14px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:7 }}>
                      <p style={{ ...mono, margin:"0 0 4px", fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>From: <code style={{ color:C.txt }}>sf org display --verbose</code></p>
                      {[["Access Token","token","eyJ0eXAiOiJKV1QiLCJh…"],["Instance URL","instance","https://your-org.my.salesforce.com"],["User ID (optional)","userId","0055g000000xxxABC"]].map(([label,key,ph])=>(
                        <div key={key}>
                          <div style={{ ...mono, fontSize:10, color:C.dim, marginBottom:3 }}>{label}</div>
                          <input type={key==="token"?"password":"text"} value={sfdcManualInputs[key]} onChange={e=>setSfdcManualInputs(p=>({...p,[key]:e.target.value}))} placeholder={ph}
                            style={{ ...mono, width:"100%", boxSizing:"border-box", fontSize:12, padding:"6px 10px", background:C.bg, border:`1px solid ${C.brd}`, borderRadius:5, color:C.txt, outline:"none" }}/>
                        </div>
                      ))}
                      <button onClick={connectSfdcManual} disabled={!sfdcManualInputs.token.trim()||!sfdcManualInputs.instance.trim()}
                        style={{ fontSize:13, padding:"7px 14px", background:sfdcManualInputs.token&&sfdcManualInputs.instance?"#001828":"transparent", border:`1px solid ${sfdcManualInputs.token&&sfdcManualInputs.instance?"#00A1E066":C.brd}`, color:sfdcManualInputs.token&&sfdcManualInputs.instance?"#00A1E0":C.dim, borderRadius:5, cursor:sfdcManualInputs.token&&sfdcManualInputs.instance?"pointer":"default", fontWeight:600, alignSelf:"flex-start" }}>
                        Connect →
                      </button>
                    </div>
                  )}
                  <p style={{ ...mono, margin:0, fontSize:11, color:C.dim }}>OAuth requires a Connected App. Manual token works with the Salesforce CLI.</p>
                </div>
              )}
            </div>

          </div>
        </div>
      )}

      {/* ── PRICING TAB ── */}
      {tab==="pricing"&&(()=>{
        const TYPE_OPTS = [
          { value:"S", label:"S — Per new user (single/onboarding)" },
          { value:"R", label:"R — Per active user (recurring)" },
          { value:"T", label:"T — On-demand (per call)" },
        ];
        const GROUP_OPTS = ["Standard","Moderate","Flexible","Limited"];
        const overrides = pricingOverrides;
        const save = (id, patch) => {
          const next = { ...overrides, [id]: { ...(overrides[id]||{}), ...patch } };
          setPricingOverrides(next);
          localStorage.setItem(PRODUCTS_OVERRIDE_KEY, JSON.stringify(next));
        };
        const reset = (id) => {
          const next = { ...overrides };
          delete next[id];
          setPricingOverrides(next);
          localStorage.setItem(PRODUCTS_OVERRIDE_KEY, JSON.stringify(next));
        };
        const filteredProducts = PRICING_PRODUCTS_DEFAULT.filter(p =>
          !pricingSearch.trim() || p.name.toLowerCase().includes(pricingSearch.toLowerCase())
        );
        const overrideCount = Object.keys(overrides).length;
        return (
          <div>
            <div style={{ display:"flex", alignItems:"flex-start", gap:12, marginBottom:16 }}>
              <div style={{ flex:1 }}>
                <p style={{ ...mono, margin:"0 0 4px", fontSize:13, color:C.txt, fontWeight:600 }}>Product Defaults</p>
                <p style={{ ...mono, margin:0, fontSize:11, color:C.dim }}>Override rack rates, billing type, and discount groups. Changes apply to all new and existing pricing sessions. Custom rates on saved deals are preserved.</p>
              </div>
              {overrideCount > 0 && <span style={{ ...mono, fontSize:11, color:C.gold, background:`${C.gold}14`, border:`1px solid ${C.gold}44`, borderRadius:4, padding:"3px 10px", flexShrink:0 }}>{overrideCount} override{overrideCount!==1?"s":""}</span>}
            </div>
            <input value={pricingSearch} onChange={e=>setPricingSearch(e.target.value)} placeholder="Filter products…"
              style={{ ...mono, fontSize:12, padding:"7px 11px", background:C.bg, border:`1px solid ${C.brd}`, borderRadius:6, color:C.txt, outline:"none", width:"100%", boxSizing:"border-box", marginBottom:10 }}/>
            <div style={{ border:`1px solid ${C.brd}`, borderRadius:8, overflow:"hidden" }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 90px 220px 130px 60px", padding:"6px 12px", background:C.card, borderBottom:`1px solid ${C.brd}` }}>
                {["Product","Rack ($)","Type","Discount Group",""].map((h,i)=>(
                  <span key={i} style={{ ...mono, fontSize:9, color:C.dim, textAlign:i===1?"right":"left", textTransform:"uppercase", letterSpacing:"0.07em" }}>{h}</span>
                ))}
              </div>
              <div style={{ maxHeight:520, overflowY:"auto" }}>
                {filteredProducts.map((p, i) => {
                  const ov = overrides[p.id] || {};
                  const changed = !!overrides[p.id];
                  const rack = ov.rack ?? p.rack;
                  const type = ov.type ?? p.type;
                  const dg   = ov.discountGroup ?? p.discountGroup;
                  return (
                    <div key={p.id} style={{ display:"grid", gridTemplateColumns:"1fr 90px 220px 130px 60px", alignItems:"center", padding:"5px 12px", borderBottom:i<filteredProducts.length-1?`1px solid ${C.brd}22`:"none", background:changed?`${C.gold}07`:"transparent" }}>
                      <span style={{ ...mono, fontSize:11, color:changed?C.gold:C.txt, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", paddingRight:8 }} title={p.name}>{p.name}</span>
                      <input type="number" step="0.001" min="0" value={rack ?? ""}
                        onChange={e => { const v = parseFloat(e.target.value); save(p.id, { rack: isNaN(v) ? null : v }); }}
                        style={{ ...mono, fontSize:11, padding:"3px 6px", background:C.bg, border:`1px solid ${(ov.rack!=null)?C.gold+"66":C.brd}`, borderRadius:4, color:C.txt, textAlign:"right", width:"100%", boxSizing:"border-box" }}
                      />
                      <select value={type} onChange={e=>save(p.id,{type:e.target.value})}
                        style={{ ...mono, fontSize:11, padding:"3px 6px", background:C.bg, border:`1px solid ${ov.type?C.gold+"66":C.brd}`, borderRadius:4, color:ov.type?C.gold:C.txt, cursor:"pointer" }}>
                        {TYPE_OPTS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <select value={dg} onChange={e=>save(p.id,{discountGroup:e.target.value})}
                        style={{ ...mono, fontSize:11, padding:"3px 6px", background:C.bg, border:`1px solid ${ov.discountGroup?C.gold+"66":C.brd}`, borderRadius:4, color:ov.discountGroup?C.gold:C.txt, cursor:"pointer" }}>
                        {GROUP_OPTS.map(o=><option key={o} value={o}>{o}</option>)}
                      </select>
                      <div style={{ textAlign:"center" }}>
                        {changed && <button onClick={()=>reset(p.id)} style={{ ...mono, fontSize:10, padding:"2px 7px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:4, color:C.dim, cursor:"pointer" }} title="Reset to default">↺</button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── INVITES TAB ── */}
      {tab==="access" && (
        <AdminInvites
          invites={invites}
          setInvites={setInvites}
          inviteModal={inviteModal}
          setInviteModal={setInviteModal}
          inviteForm={inviteForm}
          setInviteForm={setInviteForm}
          inviteConfirm={inviteConfirm}
          setInviteConfirm={setInviteConfirm}
          copiedInvCode={copiedInvCode}
          setCopiedInvCode={setCopiedInvCode}
          invitePage={invitePage}
          setInvitePage={setInvitePage}
          onSaveUsers={onSaveUsers}
          currentUser={currentUser}
        />
      )}

      {/* ── ACCESS LOG TAB ── */}
      {tab==="accesslog"&&<AccessLogTab/>}

      {/* ── ONBOARDING TAB ── */}
      {tab==="onboarding"&&<OnboardingTab users={users} setUsers={setUsers} onSaveUsers={onSaveUsers} invites={invites} setInvites={setInvites}/>}

      {/* ── SETTINGS TAB ── */}
      {tab==="settings"&&(()=>{
        const diamondsOn=localStorage.getItem("prospector_diamonds_enabled")!=="false";
        const toggle=()=>{ localStorage.setItem("prospector_diamonds_enabled",diamondsOn?"false":"true"); setTab(""); setTimeout(()=>setTab("settings"),0); };

        const exportData = () => {
          const data = {};
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith("prospector_")) data[key] = localStorage.getItem(key);
          }
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `prospector-backup-${new Date().toISOString().slice(0,10)}.json`;
          a.click();
          URL.revokeObjectURL(url);
        };

        const importData = (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (ev) => {
            try {
              const data = JSON.parse(ev.target.result);
              let count = 0;
              Object.entries(data).forEach(([k, v]) => {
                if (k.startsWith("prospector_")) { localStorage.setItem(k, v); count++; }
              });
              alert(`✓ Imported ${count} keys. Reloading…`);
              window.location.reload();
            } catch { alert("Invalid backup file."); }
          };
          reader.readAsText(file);
          e.target.value = "";
        };

        return (
          <div>
            <p style={{ ...mono, margin:"0 0 18px", fontSize:11, color:C.dim }}>Feature flags and system toggles</p>

            {/* Export / Import */}
            <div style={{ background:C.card, border:`1px solid ${C.brd}`, borderRadius:8, padding:"16px 18px", marginBottom:16 }}>
              <p style={{ margin:"0 0 4px", fontSize:14, color:C.txt, fontWeight:500 }}>📦 Data Backup & Restore</p>
              <p style={{ ...mono, margin:"0 0 14px", fontSize:11, color:C.dim }}>Export all your accounts, pricing, tasks, and settings to a file. Import on any device or after a fresh deploy to Render.</p>
              <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                <button onClick={exportData} style={{ ...mono, fontSize:12, padding:"8px 20px", background:`${C.gold}18`, border:`1px solid ${C.gold}55`, color:C.gold, borderRadius:6, cursor:"pointer", fontWeight:600 }}>
                  ↓ Export all data
                </button>
                <label style={{ ...mono, fontSize:12, padding:"8px 20px", background:`${C.blue}14`, border:`1px solid ${C.blue}44`, color:C.blue, borderRadius:6, cursor:"pointer", fontWeight:600 }}>
                  ↑ Import backup
                  <input type="file" accept=".json" onChange={importData} style={{ display:"none" }} />
                </label>
              </div>
            </div>

            {/* Master Code */}
            <div style={{ background:C.card, border:`1px solid ${C.brd}`, borderRadius:8, padding:"16px 18px", marginBottom:16 }}>
              <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:16, flexWrap:"wrap" }}>
                <div style={{ flex:1, minWidth:200 }}>
                  <p style={{ margin:"0 0 3px", fontSize:14, color:C.txt, fontWeight:500 }}>⛏ Master Code</p>
                  <p style={{ ...mono, margin:"0 0 8px", fontSize:11, color:C.dim }}>Permanent admin access code. Bypasses invite codes — keep it private. Never expires.</p>
                  <p style={{ ...mono, margin:0, fontSize:12, color:getMasterCodeHash()?C.green:C.orange }}>
                    {getMasterCodeHash() ? "● Set and active" : "○ Not set — generate one now"}
                  </p>
                </div>
                <button
                  onClick={()=>{ const c=generateMasterCode(); setMasterCodeModal({code:c}); }}
                  style={{ ...mono, fontSize:12, padding:"7px 18px", background:`${C.gold}14`, border:`1px solid ${C.gold}44`, color:C.gold, borderRadius:6, cursor:"pointer", flexShrink:0 }}>
                  {getMasterCodeHash() ? "Regenerate" : "Generate"}
                </button>
              </div>
            </div>

            {/* Supabase sync */}
            {isSupabaseEnabled() && !supabaseSeeded && (
              <div style={{ background:C.card, border:`1px solid ${C.brd}`, borderRadius:8, padding:"16px 18px", marginBottom:16 }}>
                <p style={{ margin:"0 0 3px", fontSize:14, color:C.txt, fontWeight:500 }}>☁ Sync to Supabase</p>
                <p style={{ ...mono, margin:"0 0 14px", fontSize:11, color:C.dim }}>One-time seed — pushes current team roster and frontier to Supabase so all users share live data. Only needs to run once.</p>
                <button
                  onClick={async()=>{
                    setSupabaseSyncing(true);
                    try{
                      const tu=JSON.parse(localStorage.getItem('prospector_team_users')||'[]');
                      const fr=JSON.parse(localStorage.getItem('prospector_frontier')||'[]');
                      await saveTeamUsers(tu);
                      await saveFrontier(fr.filter(f=>!f.isDemo));
                      localStorage.setItem('prospector_supabase_seeded','true');
                      setSupabaseSeeded(true);
                    }catch(e){ alert('Sync failed: '+e.message); }
                    setSupabaseSyncing(false);
                  }}
                  disabled={supabaseSyncing}
                  style={{ ...mono, fontSize:12, padding:"8px 20px", background:`${C.blue}14`, border:`1px solid ${C.blue}44`, color:C.blue, borderRadius:6, cursor:supabaseSyncing?'default':'pointer', fontWeight:600, opacity:supabaseSyncing?0.6:1 }}>
                  {supabaseSyncing ? 'Syncing…' : '↑ Sync to Supabase'}
                </button>
              </div>
            )}
            {isSupabaseEnabled() && supabaseSeeded && (
              <div style={{ background:C.card, border:`1px solid ${C.brd}`, borderRadius:8, padding:"16px 18px", marginBottom:16, display:"flex", alignItems:"center", gap:12 }}>
                <span style={{ ...mono, fontSize:13, color:C.green }}>● Supabase live</span>
                <span style={{ ...mono, fontSize:11, color:C.dim, flex:1 }}>Team and frontier syncing in real-time across all sessions.</span>
                <button onClick={()=>{ localStorage.removeItem('prospector_supabase_seeded'); setSupabaseSeeded(false); }}
                  style={{ ...mono, fontSize:10, padding:"3px 8px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:4, cursor:"pointer" }}>
                  Re-sync
                </button>
              </div>
            )}

            {/* Diamonds toggle */}
            <div style={{ background:C.card, border:`1px solid ${C.brd}`, borderRadius:8, padding:"16px 18px", display:"flex", alignItems:"center", gap:16 }}>
              <div style={{ flex:1 }}>
                <p style={{ margin:"0 0 3px", fontSize:14, color:C.txt, fontWeight:500 }}>💎 Diamond Token System</p>
                <p style={{ ...mono, margin:0, fontSize:11, color:C.dim }}>Tracks diamonds earned for territory activity. Shows in profile panel with commission calculator.</p>
              </div>
              <button onClick={toggle}
                style={{ ...mono, fontSize:12, padding:"7px 18px", borderRadius:6, cursor:"pointer", fontWeight:600, flexShrink:0,
                  background: diamondsOn?`${C.green}18`:`${C.red}12`,
                  border: `1px solid ${diamondsOn?C.green+"55":C.red+"44"}`,
                  color: diamondsOn?C.green:C.red }}>
                {diamondsOn?"● Diamonds ON":"○ Diamonds OFF"}
              </button>
            </div>
          </div>
        );
      })()}

      {/* Master code modal */}
      {masterCodeModal && (
        <div onClick={e=>{if(e.target===e.currentTarget){setMasterCodeModal(null);setMasterCopied(false);}}} style={{ position:"fixed", inset:0, zIndex:1001, background:"#00000099", display:"flex", alignItems:"center", justifyContent:"center" }}>
          <div style={{ background:C.card, border:`1px solid ${C.goldBdr}`, borderRadius:12, padding:"28px 32px", width:360, boxShadow:"0 20px 60px #000c", textAlign:"center" }}>
            <div style={{ fontSize:28, marginBottom:12 }}>⛏</div>
            <p style={{ ...mono, margin:"0 0 6px", fontSize:11, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>Your New Master Code</p>
            <div style={{ background:"#050505", border:`1px solid ${C.goldBdr}55`, borderRadius:8, padding:"14px 20px", margin:"12px 0 8px" }}>
              <span style={{ ...mono, fontSize:22, fontWeight:700, color:C.gold, letterSpacing:"0.22em" }}>{masterCodeModal.code}</span>
            </div>
            <p style={{ ...mono, margin:"0 0 20px", fontSize:11, color:C.orange }}>
              ⚠ Save this somewhere safe — it won't be shown again.
            </p>
            {getMasterCodeHash() && (
              <p style={{ ...mono, margin:"0 0 16px", fontSize:11, color:`${C.red}aa` }}>
                This will replace your existing master code immediately.
              </p>
            )}
            <div style={{ display:"flex", gap:8, justifyContent:"center" }}>
              <button
                onClick={()=>{ navigator.clipboard.writeText(masterCodeModal.code).catch(()=>{}); setMasterCopied(true); }}
                style={{ ...mono, fontSize:12, padding:"8px 20px", background:`${C.gold}14`, border:`1px solid ${C.gold}44`, color:masterCopied?C.green:C.gold, borderRadius:6, cursor:"pointer" }}>
                {masterCopied ? "Copied ✓" : "Copy code"}
              </button>
              <button
                onClick={()=>{ setMasterCode(masterCodeModal.code); setMasterCodeModal(null); setMasterCopied(false); setTab("settings"); /* force re-render to show Set status */ setTimeout(()=>{}, 0); }}
                style={{ ...mono, fontSize:12, padding:"8px 20px", background:C.gold, border:`1px solid ${C.gold}`, color:C.bg, borderRadius:6, cursor:"pointer", fontWeight:700 }}>
                I've saved it →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New user invite code banner */}
      {newUserCode && (
        <div onClick={e=>e.target===e.currentTarget&&setNewUserCode(null)} style={{ position:"fixed", inset:0, zIndex:1001, background:"#00000099", display:"flex", alignItems:"center", justifyContent:"center" }}>
          <div style={{ background:C.card, border:`1px solid ${C.goldBdr}`, borderRadius:12, padding:"26px 30px", width:380, boxShadow:"0 20px 60px #000c" }}>
            <div style={{ display:"flex", alignItems:"center", marginBottom:16 }}>
              <span style={{ ...mono, fontSize:14, color:C.gold, fontWeight:700 }}>✓ {newUserCode.name} added</span>
              <button onClick={()=>setNewUserCode(null)} style={{ marginLeft:"auto", background:"transparent", border:"none", color:C.mut, fontSize:18, cursor:"pointer" }}>✕</button>
            </div>
            <p style={{ ...mono, fontSize:11, color:C.dim, margin:"0 0 14px" }}>
              They're pending until they sign in. Share this invite code so they can access Prospector:
            </p>
            <div style={{ background:C.bg, border:`1px solid ${C.goldBdr}`, borderRadius:8, padding:"14px 18px", display:"flex", alignItems:"center", gap:12, marginBottom:16 }}>
              <span style={{ ...mono, fontSize:20, color:C.gold, fontWeight:700, letterSpacing:"0.12em", flex:1 }}>{newUserCode.code}</span>
              <button
                onClick={()=>{ navigator.clipboard.writeText(newUserCode.code); }}
                style={{ ...mono, fontSize:11, padding:"5px 12px", background:`${C.gold}18`, border:`1px solid ${C.goldBdr}`, color:C.gold, borderRadius:5, cursor:"pointer" }}>
                Copy
              </button>
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button
                onClick={()=>{
                  const appUrl = window.location.origin;
                  const body = buildInviteEmail({ name:newUserCode.name, code:newUserCode.code, role:newUserCode.role.toLowerCase(), appUrl });
                  window.open(`mailto:${newUserCode.email}?subject=${encodeURIComponent("You're invited to Prospector")}&body=${encodeURIComponent(body)}`);
                }}
                style={{ ...mono, flex:1, fontSize:12, padding:"8px", background:`${C.gold}18`, border:`1px solid ${C.goldBdr}`, color:C.gold, borderRadius:6, cursor:"pointer" }}>
                ✉ Send invite email
              </button>
              <button onClick={()=>setNewUserCode(null)} style={{ ...mono, fontSize:12, padding:"8px 16px", background:"transparent", border:`1px solid ${C.brd}`, color:C.mut, borderRadius:6, cursor:"pointer" }}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User modal */}
      {modal!==null&&(
        <div onClick={e=>{if(e.target===e.currentTarget)setModal(null);}} style={{ position:"fixed", inset:0, zIndex:1000, background:"#00000099", display:"flex", alignItems:"center", justifyContent:"center" }}>
          <div style={{ background:C.card, border:`1px solid ${C.brd}`, borderRadius:12, padding:"22px 26px", width:400, boxShadow:"0 20px 60px #000c" }}>
            <div style={{ display:"flex", alignItems:"center", marginBottom:18 }}>
              <span style={{ ...mono, fontSize:14, color:C.txt, fontWeight:700 }}>{modal.id?"Edit user":"Add user"}</span>
              <button onClick={()=>setModal(null)} style={{ marginLeft:"auto", background:"transparent", border:"none", color:C.mut, fontSize:18, cursor:"pointer" }}>✕</button>
            </div>
            {[["Name","name","text","Full name…"],["Email","email","email","name@example.com"],["Company","company","text","Prospector"]].map(([lb,k,type,ph])=>(
              <div key={k} style={{ marginBottom:12 }}>
                <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>{lb}</div>
                <input type={type} value={form[k]} onChange={e=>upd({[k]:e.target.value})} placeholder={ph}
                  style={{ ...mono, width:"100%", boxSizing:"border-box", fontSize:13, padding:"8px 11px", background:C.bg, border:`1.5px solid ${C.brdM}`, borderRadius:6, color:C.txt, outline:"none" }}/>
              </div>
            ))}
            <div style={{ marginBottom:18 }}>
              <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>Role</div>
              <div style={{ display:"flex", gap:6 }}>
                {ROLES_LIST.map(r=>{
                  const rc=ROLE_COLORS[r]||C.gold;
                  return(
                  <button key={r} onClick={()=>upd({role:r})}
                    style={{ ...mono, flex:1, fontSize:11, padding:"6px 4px", borderRadius:5, border:`1px solid ${form.role===r?rc:C.brd}`, background:form.role===r?`${rc}18`:"transparent", color:form.role===r?rc:C.dim, cursor:"pointer" }}>
                    {r}
                  </button>
                )})}
              </div>
            </div>
            {form.role === "BDR" && (()=>{
              const aeList = [
                ...(currentUser && (currentUser.role==="AE"||currentUser.role==="Admin"||currentUser.role==="Owner") && !users.find(u=>u.id===currentUser.id) ? [currentUser] : []),
                ...users.filter(u => u.role==="AE"),
              ];
              if (!aeList.length) return null;
              return (
                <div style={{ marginBottom:16 }}>
                  <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:7 }}>Assigned AEs</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                    {aeList.map(ae=>{
                      const checked = (form.assignedAEs||[]).includes(ae.id);
                      return (
                        <label key={ae.id} onClick={()=>upd({ assignedAEs: checked ? (form.assignedAEs||[]).filter(x=>x!==ae.id) : [...(form.assignedAEs||[]), ae.id] })}
                          style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer" }}>
                          <div style={{ width:16, height:16, borderRadius:3, border:`1.5px solid ${checked?C.gold:C.brd}`, background:checked?C.goldBg:"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                            {checked && <span style={{ fontSize:10, color:C.gold }}>✓</span>}
                          </div>
                          <span style={{ fontSize:13, color:checked?C.txt:C.mut }}>{ae.name}</span>
                          <span style={{ ...mono, fontSize:11, color:C.dim }}>({ae.role})</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
              <button onClick={()=>setModal(null)} style={{ ...mono, fontSize:12, padding:"7px 16px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:6, color:C.mut, cursor:"pointer" }}>Cancel</button>
              <button onClick={saveUser} disabled={!form.name.trim()} style={{ ...mono, fontSize:12, padding:"7px 18px", background:form.name.trim()?C.gold:"transparent", border:`1px solid ${form.name.trim()?C.gold:C.brd}`, borderRadius:6, color:form.name.trim()?C.bg:C.dim, cursor:form.name.trim()?"pointer":"default", fontWeight:700 }}>
                {modal.id?"Save changes":"Add user"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminPage;
