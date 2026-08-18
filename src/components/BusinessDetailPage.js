import { useState, useEffect, useCallback, useRef } from 'react';
import { C, mono, PRESET_SWATCH_COLORS } from '../constants/colors';
import { createProject, createList, setProjectListId, getAccountsForBusiness, linkAccountToLists } from '../utils/db';
import BusinessAccountsTab from './BusinessAccountsTab';
import BusinessSearchTab from './BusinessSearchTab';
import BusinessGenerationTab from './BusinessGenerationTab';
import BusinessCommandCenterTab from './BusinessCommandCenterTab';
import MembersPermissionsTab from './MembersPermissionsTab';
import SmartIntakeBox from './SmartIntakeBox';
import CallLogSection from './CallLogSection';
import AssayCriteriaCard from './AssayCriteriaCard';
import OutreachRulesCard from './OutreachRulesCard';
import ProfileFieldBlock from './ProfileFieldBlock';
import ProjectGuidanceCard from './ProjectGuidanceCard';
import AccountPicker from './AccountPicker';
import BulkOutreachModal from './BulkOutreachModal';

const SOURCE_LABEL = { manual: 'Manual', research_site: 'Site research', research_web: 'Web research', call: 'Call log' };
const CONTENT_TYPE_LABEL = { strategy_doc: 'Strategy', marketing_asset: 'Marketing', pricing: 'Pricing', competitive: 'Competitive', other: 'Other' };

const fmtDate = iso => { try { return new Date(iso).toLocaleString("en-US", { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" }); } catch { return "—"; } };

const inp = { fontSize:13, padding:"8px 11px", background:C.bg, border:`1.5px solid ${C.brdM}`, borderRadius:6, color:C.txt, outline:"none", width:"100%", boxSizing:"border-box", ...mono };
const btn = { ...mono, fontSize:12, padding:"7px 18px", background:C.gold, border:`1px solid ${C.gold}`, borderRadius:6, color:C.bg, cursor:"pointer", fontWeight:700 };

function CreateProjectModal({ businessId, userEmail, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(PRESET_SWATCH_COLORS[0]);
  const [objective, setObjective] = useState('');
  const [targetType, setTargetType] = useState('');
  const [askType, setAskType] = useState('');
  const [projectHook, setProjectHook] = useState('');
  const [exclusions, setExclusions] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { getAccountsForBusiness(businessId).then(setAccounts); }, [businessId]);

  const canCreate = name.trim() && objective.trim() && !saving;

  const handleCreate = async () => {
    if (!canCreate) return;
    setSaving(true);
    setError('');
    const { list, error: listErr } = await createList(businessId, name.trim());
    if (listErr) { setSaving(false); setError(listErr); return; }
    const { project, error: err } = await createProject({
      name: name.trim(), color, ownerEmail: userEmail, businessId, listId: list.id,
      objective: objective.trim(), targetType: targetType.trim(), askType: askType.trim(),
      projectHook: projectHook.trim(), exclusions: exclusions.trim(),
    });
    if (err) { setSaving(false); setError(err); return; }
    for (const accountId of selectedAccountIds) await linkAccountToLists(accountId, [list.id]);
    setSaving(false);
    onCreated(project);
  };

  return (
    <div onClick={e=>{if(e.target===e.currentTarget) onClose();}} style={{ position:"fixed", inset:0, zIndex:1000, background:"#00000099", display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div style={{ background:C.card, border:`1px solid ${C.brd}`, borderRadius:12, padding:"22px 26px", width:420, maxHeight:"85vh", overflowY:"auto", boxShadow:"0 20px 60px #000c" }}>
        <div style={{ display:"flex", alignItems:"center", marginBottom:20 }}>
          <span style={{ ...mono, fontSize:14, color:C.txt, fontWeight:700 }}>New project</span>
          <button onClick={onClose} style={{ marginLeft:"auto", background:"transparent", border:"none", color:C.mut, fontSize:18, cursor:"pointer" }}>✕</button>
        </div>
        <div style={{ marginBottom:14 }}>
          <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>Name</div>
          <input type="text" placeholder="Q3 outbound push" value={name} onChange={e=>setName(e.target.value)} style={inp} />
        </div>
        <div style={{ marginBottom:14 }}>
          <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>Color</div>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            {PRESET_SWATCH_COLORS.map(c => (
              <button key={c} onClick={()=>setColor(c)} aria-label={c}
                style={{ width:28, height:28, borderRadius:"50%", background:c, cursor:"pointer", padding:0,
                  border: color===c ? `2px solid ${C.txt}` : "2px solid transparent",
                  boxShadow: color===c ? `0 0 0 2px ${C.card}` : "none" }} />
            ))}
          </div>
        </div>
        <div style={{ marginBottom:14 }}>
          <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>Objective *</div>
          <textarea rows={2} placeholder="What this campaign is trying to accomplish…" value={objective} onChange={e=>setObjective(e.target.value)} style={{ ...inp, resize:"vertical" }} />
        </div>
        <div style={{ marginBottom:14 }}>
          <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>Target type</div>
          <input type="text" placeholder="Who this project is reaching…" value={targetType} onChange={e=>setTargetType(e.target.value)} style={inp} />
        </div>
        <div style={{ marginBottom:14 }}>
          <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>Ask / offer / CTA</div>
          <input type="text" placeholder="What the outreach is asking for…" value={askType} onChange={e=>setAskType(e.target.value)} style={inp} />
        </div>
        <div style={{ marginBottom:14 }}>
          <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>Hook (optional)</div>
          <input type="text" placeholder="An opening angle specific to this project…" value={projectHook} onChange={e=>setProjectHook(e.target.value)} style={inp} />
        </div>
        <div style={{ marginBottom:14 }}>
          <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>Exclusions (optional)</div>
          <input type="text" placeholder="Anything outreach for this project should avoid…" value={exclusions} onChange={e=>setExclusions(e.target.value)} style={inp} />
        </div>
        <div style={{ marginBottom:20 }}>
          <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>Accounts (optional)</div>
          <AccountPicker accounts={accounts} selected={selectedAccountIds} onToggle={id=>setSelectedAccountIds(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id])} />
        </div>
        {error && <div style={{ ...mono, fontSize:11, color:C.red, marginBottom:12 }}>⚠ {error}</div>}
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
          <button onClick={onClose} style={{ ...mono, fontSize:12, padding:"7px 16px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:6, color:C.mut, cursor:"pointer" }}>Cancel</button>
          <button onClick={handleCreate} disabled={!canCreate}
            style={{ ...mono, fontSize:12, padding:"7px 20px", background:canCreate?C.gold:"transparent", border:`1px solid ${canCreate?C.gold:C.brd}`, borderRadius:6, color:canCreate?C.bg:C.dim, cursor:canCreate?"pointer":"default", fontWeight:700 }}>
            {saving ? "Creating…" : "Create →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// project-guidance-and-creation-flow-v1 — forward direction of two-way
// linking, the project's own "Add accounts" action. Reverse direction
// (account -> project) lives on the account card itself, see
// accountCard/LinkedProjects.js. Same underlying write either way.
function AddAccountsToProject({ project, businessId, onDone }) {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState([]);
  const [linking, setLinking] = useState(false);

  const toggleOpen = () => {
    if (!open) getAccountsForBusiness(businessId).then(setAccounts);
    setOpen(o => !o);
  };

  const confirm = async () => {
    setLinking(true);
    for (const accountId of selectedAccountIds) await linkAccountToLists(accountId, [project.list_id]);
    setLinking(false);
    setOpen(false);
    setSelectedAccountIds([]);
    onDone?.();
  };

  return (
    <div style={{ marginTop:10 }}>
      <button onClick={toggleOpen} style={{ ...mono, fontSize:11, padding:"6px 14px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:6, cursor:"pointer" }}>
        {open ? 'Cancel' : '+ Add accounts'}
      </button>
      {open && (
        <div style={{ marginTop:8 }}>
          <AccountPicker accounts={accounts} selected={selectedAccountIds} onToggle={id=>setSelectedAccountIds(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id])} />
          <button onClick={confirm} disabled={!selectedAccountIds.length || linking} style={{ ...mono, fontSize:11, padding:"6px 14px", background:C.gold, border:`1px solid ${C.gold}`, color:C.bg, fontWeight:700, borderRadius:6, cursor:"pointer", marginTop:8, opacity: selectedAccountIds.length?1:0.5 }}>
            {linking ? 'Adding…' : `Add ${selectedAccountIds.length || ''}`.trim()}
          </button>
        </div>
      )}
    </div>
  );
}

// project-list-linking-v1 — backfill for projects created before every
// project auto-got a list (CreateProjectModal). Same create-list-then-attach
// sequence as project creation, just run after the fact.
function BackfillProjectList({ project, businessId, onLinked }) {
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState('');

  const link = async () => {
    setLinking(true);
    setError('');
    const { list, error: listErr } = await createList(businessId, project.name);
    if (listErr) { setLinking(false); setError(listErr); return; }
    const { project: updated, error: err } = await setProjectListId(project.id, list.id);
    setLinking(false);
    if (err) { setError(err); return; }
    onLinked(updated);
  };

  return (
    <div style={{ marginTop:10 }}>
      <p style={{ ...mono, fontSize:10, color:C.dim, margin:"0 0 8px" }}>This project has no linked list yet — bulk outreach generation needs one.</p>
      {error && <div style={{ ...mono, fontSize:11, color:C.red, marginBottom:8 }}>⚠ {error}</div>}
      <button onClick={link} disabled={linking} style={{ ...mono, fontSize:11, padding:"6px 14px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:6, cursor:"pointer" }}>
        {linking ? 'Linking…' : 'Link a list to this project'}
      </button>
    </div>
  );
}

function ProjectsSection({ business, userEmail, activeUser, projects, outreachRules, onProjectCreated, onProjectUpdated }) {
  const [open, setOpen] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [outreachProject, setOutreachProject] = useState(null);

  return (
    <div style={{ marginBottom:32 }}>
      <button onClick={()=>setOpen(o=>!o)} style={{ ...mono, fontSize:12, color:C.dim, background:"transparent", border:"none", cursor:"pointer", padding:0, marginBottom:10 }}>
        {open ? "▾" : "▸"} Projects ({projects.length})
      </button>
      {open && (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {projects.map(p => (
            <div key={p.id} style={{ padding:"9px 12px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:8 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer" }} onClick={()=>setExpandedId(id=>id===p.id?null:p.id)}>
                <span style={{ width:10, height:10, borderRadius:"50%", background:p.color||C.gold, flexShrink:0 }} />
                <span style={{ ...mono, fontSize:13, color:C.txt, flex:1 }}>{p.name}</span>
                <span style={{ ...mono, fontSize:10, color:C.dim }}>{fmtDate(p.created_at)}</span>
              </div>
              <p style={{ ...mono, fontSize:11, color:p.strategy_synthesis?C.mut:C.dim, margin:"6px 0 0 20px", lineHeight:1.5, fontStyle:p.strategy_synthesis?"normal":"italic" }}>
                {p.strategy_synthesis || "No strategy yet — notes filed to this project will synthesize one automatically."}
              </p>
              {expandedId === p.id && (
                <>
                  <ProjectGuidanceCard project={p} businessName={business.name} userEmail={userEmail} outreachRules={outreachRules} onUpdated={updated => onProjectUpdated?.(updated)} />
                  {p.list_id ? (
                    <>
                      <AddAccountsToProject project={p} businessId={business.id} onDone={()=>{}} />
                      <button onClick={()=>setOutreachProject(p)} style={{ ...mono, fontSize:11, padding:"6px 14px", background:"transparent", border:`1px solid ${C.gold}66`, color:C.gold, borderRadius:6, cursor:"pointer", marginTop:10 }}>
                        Generate for {p.name}
                      </button>
                    </>
                  ) : (
                    <BackfillProjectList project={p} businessId={business.id} onLinked={updated => onProjectUpdated?.(updated)} />
                  )}
                </>
              )}
            </div>
          ))}
          {projects.length === 0 && (
            <p style={{ ...mono, fontSize:12, color:C.dim, margin:0 }}>No projects yet for {business.name}.</p>
          )}
          <button onClick={()=>setModalOpen(true)} style={{ ...mono, fontSize:12, color:C.dim, background:"transparent", border:`1.5px dashed ${C.brd}`, borderRadius:8, padding:"9px 12px", cursor:"pointer", textAlign:"left" }}>
            + New Project
          </button>
        </div>
      )}
      {modalOpen && (
        <CreateProjectModal
          businessId={business.id}
          userEmail={userEmail}
          onClose={()=>setModalOpen(false)}
          onCreated={project => { setModalOpen(false); onProjectCreated(project); }}
        />
      )}
      {outreachProject && (
        <BulkOutreachModal
          business={business}
          project={outreachProject}
          userEmail={userEmail}
          activeUser={activeUser}
          onClose={()=>setOutreachProject(null)}
        />
      )}
    </div>
  );
}

export default function BusinessDetailPage({ business: businessProp, userEmail, projects=[], view='command-center', onUpdated, onProjectCreated, onProjectUpdated, sharedAccounts, sharedTasks, setSharedTasks, dailyStats, activeUser, onNav, onUpdateAccount }) {
  const [business, setBusiness] = useState(businessProp);
  const [profile, setProfile] = useState(null);
  const [intelEntries, setIntelEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);

  const [newEntry, setNewEntry] = useState('');
  const [savingEntry, setSavingEntry] = useState(false);
  const [savingElapsed, setSavingElapsed] = useState(0);
  const savingTimerRef = useRef(null);
  // Full-depth profile synthesis can genuinely take 30-150s+ on a real
  // dense document - a static "Adding…" label gives an impatient user
  // nothing to go on. Cleared in every exit path (success, error, AND
  // unmount) - same discipline as the App.js infinite-loop fix earlier
  // today, this is exactly the kind of interval that leaks if you miss one.
  useEffect(() => () => { if (savingTimerRef.current) clearInterval(savingTimerRef.current); }, []);
  const [entryError, setEntryError] = useState('');
  const [updatedFlash, setUpdatedFlash] = useState(false);

  const [notesOpen, setNotesOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [highlightedEntryId, setHighlightedEntryId] = useState(null);

  const pollRef = useRef(null);
  const pollAttemptsRef = useRef(0);
  // Server-side, a research run is bounded by two 90s Anthropic timeouts plus a
  // 10s site fetch (~190s worst case). This caps polling well above that so a
  // stuck/hung server-side run can't leave the tab polling forever.
  const MAX_POLL_ATTEMPTS = 70; // 70 * 3s = 210s

  // Guards against a stale fetch from a previously-viewed business landing
  // after switching away (App.js keys this component by business.id, so a
  // switch unmounts this instance - without this guard, a slow in-flight
  // /api/businesses/:id response for the OLD business would still call
  // onUpdated() and stomp App.js's activeBusiness back to the wrong one).
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/businesses/${business.id}`);
    if (!mountedRef.current || !res.ok) return;
    const data = await res.json();
    if (!mountedRef.current) return;
    setBusiness(data.business);
    setProfile(data.profile);
    setIntelEntries(data.intelEntries);
    setLoading(false);
    onUpdated?.(data.business);
    return data.business;
  }, [business.id, onUpdated]);

  useEffect(() => { load(); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (business.research_status !== 'researching') {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      pollAttemptsRef.current = 0;
      return;
    }
    setPollTimedOut(false);
    pollAttemptsRef.current = 0;
    pollRef.current = setInterval(async () => {
      pollAttemptsRef.current += 1;
      if (pollAttemptsRef.current > MAX_POLL_ATTEMPTS) {
        clearInterval(pollRef.current);
        pollRef.current = null;
        setPollTimedOut(true);
        return;
      }
      const updated = await load();
      if (updated && updated.research_status !== 'researching') {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [business.research_status, load]);

  const handleRetry = async () => {
    setRetrying(true);
    setPollTimedOut(false);
    await fetch(`/api/businesses/${business.id}/retry-research`, { method: 'POST' });
    setRetrying(false);
    load();
  };

  const handleAddEntry = async () => {
    if (!newEntry.trim() || savingEntry) return;
    setSavingEntry(true);
    setSavingElapsed(0);
    setEntryError('');
    savingTimerRef.current = setInterval(() => setSavingElapsed(s => s + 1), 1000);
    try {
      const res = await fetch(`/api/businesses/${business.id}/intel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newEntry.trim(), created_by: userEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add intel');
      setProfile(data.profile);
      setNewEntry('');
      setUpdatedFlash(true);
      setTimeout(() => setUpdatedFlash(false), 2500);
      load();
    } catch (e) {
      setEntryError(e.message);
    } finally {
      clearInterval(savingTimerRef.current);
      savingTimerRef.current = null;
      setSavingEntry(false);
    }
  };

  // 'overview' added business-intel-smart-upload-v1 follow-up - it used to
  // be a short vision/positioning/gtm_strategy prose page (700 was fine),
  // but now renders 13 profile fields plus Assay Criteria/Outreach
  // Rules/Add Intel/the Intel log. Same 1100 the other dense views here
  // already use, not a new value.
  const wideView = view === 'accounts' || view === 'search' || view === 'generation' || view === 'command-center' || view === 'members' || view === 'overview';

  return (
    <div style={{ minHeight:"100vh", background:C.bg, padding:"48px 40px" }}>
      <div style={{ maxWidth: wideView ? 1100 : 700, margin:"0 auto" }}>
        {/* nav-active-state-v1 - the more prominent "which business am I in"
            signal for when you're looking at content, not the sidebar.
            Present on every sub-view, not just overview. */}
        <div style={{ height:3, borderRadius:2, marginBottom:24, background:`linear-gradient(90deg, ${business.color||C.gold}, ${business.color||C.gold}00)` }} />
        <div style={{ display:"flex", alignItems:"flex-start", gap:16, marginBottom:28 }}>
          <div style={{ width:56, height:56, borderRadius:10, background:business.color||C.gold, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
            <span style={{ ...mono, fontSize:22, color:C.bg, fontWeight:700 }}>{(business.name||'?')[0].toUpperCase()}</span>
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <h1 style={{ ...mono, fontSize:20, color:C.txt, fontWeight:700, margin:"0 0 4px" }}>{business.name}</h1>
            {business.tagline && <p style={{ ...mono, fontSize:12, color:C.dim, margin:"0 0 6px" }}>{business.tagline}</p>}
            <a href={business.website_url} target="_blank" rel="noreferrer" style={{ ...mono, fontSize:11, color:C.blue }}>
              {business.website_url}
            </a>
          </div>
        </div>

        {view === 'command-center' && (<>
          <SmartIntakeBox business={business} projects={projects} userEmail={userEmail}
            onProfileUpdated={setProfile} onProjectUpdated={onProjectUpdated} />
          <BusinessCommandCenterTab business={business} sharedAccounts={sharedAccounts} sharedTasks={sharedTasks} setSharedTasks={setSharedTasks} dailyStats={dailyStats} activeUser={activeUser} onNav={onNav} onUpdateAccount={onUpdateAccount} />
        </>)}
        {view === 'accounts' && <BusinessAccountsTab business={business} userEmail={userEmail} projects={projects} />}
        {view === 'search' && <BusinessSearchTab business={business} userEmail={userEmail} />}
        {view === 'generation' && <BusinessGenerationTab business={business} />}
        {view === 'projects' && (
          <ProjectsSection business={business} userEmail={userEmail} activeUser={activeUser} projects={projects} outreachRules={profile?.outreach_rules} onProjectCreated={onProjectCreated} onProjectUpdated={onProjectUpdated} />
        )}
        {view === 'members' && <MembersPermissionsTab business={business} viewerEmail={userEmail} />}

        {view === 'overview' && (<>
        <div style={{ marginBottom:32 }}>
          <textarea
            placeholder="Add intel…" value={newEntry} onChange={e=>setNewEntry(e.target.value)}
            rows={3} style={{ ...inp, resize:"vertical", marginBottom:8 }}
          />
          {entryError && <div style={{ ...mono, fontSize:11, color:C.red, marginBottom:8 }}>⚠ {entryError}</div>}
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <button onClick={handleAddEntry} disabled={!newEntry.trim()||savingEntry} style={{ ...btn, opacity:newEntry.trim()?1:0.5 }}>
              {savingEntry ? `Adding… ${savingElapsed}s` : "Add Intel"}
            </button>
            {updatedFlash && <span style={{ ...mono, fontSize:11, color:C.green }}>✓ Profile updated</span>}
          </div>
          {savingEntry && (
            <div style={{ marginTop:8, height:3, background:C.brd, borderRadius:2, overflow:"hidden", position:"relative" }}>
              <div style={{ position:"absolute", top:0, left:"-30%", height:"100%", width:"30%", background:C.gold, borderRadius:2, animation:"intelAddBarSlide 1.1s ease-in-out infinite" }} />
              <style>{`@keyframes intelAddBarSlide { 0% { left: -30%; } 100% { left: 100%; } }`}</style>
            </div>
          )}
        </div>

        {business.research_status === 'researching' && !pollTimedOut && (
          <div style={{ padding:"16px 18px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:8, marginBottom:32 }}>
            <p style={{ ...mono, fontSize:13, color:C.txt, margin:0 }}>Researching {business.name}…</p>
          </div>
        )}

        {business.research_status === 'researching' && pollTimedOut && (
          <div style={{ padding:"16px 18px", background:`${C.orange}10`, border:`1px solid ${C.orange}44`, borderRadius:8, marginBottom:32 }}>
            <p style={{ ...mono, fontSize:12, color:C.orange, margin:"0 0 10px" }}>
              This is taking longer than expected (over 3 minutes) — the automatic check-in has stopped so this tab doesn't poll forever.
            </p>
            <button onClick={load} style={btn}>Check again</button>
          </div>
        )}

        {business.research_status === 'error' && (
          <div style={{ padding:"16px 18px", background:`${C.red}10`, border:`1px solid ${C.red}44`, borderRadius:8, marginBottom:32 }}>
            <p style={{ ...mono, fontSize:12, color:C.red, margin:"0 0 10px" }}>⚠ {business.research_error || 'Research failed.'}</p>
            <button onClick={handleRetry} disabled={retrying} style={btn}>{retrying ? "Retrying…" : "Retry Research"}</button>
          </div>
        )}

        {business.research_status === 'ready' && profile && (
          business.research_depth === 'light' ? (
            <div style={{ marginBottom:32 }}>
              <h2 style={{ ...mono, fontSize:13, color:C.txt, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", margin:"0 0 16px" }}>Profile</h2>
              <ProfileFieldBlock field="vision" label="Vision" value={profile.vision} sources={profile.field_sources?.vision} entries={intelEntries} onHoverSource={setHighlightedEntryId} />
              <ProfileFieldBlock field="gtm_strategy" label="Current Strategy" value={profile.gtm_strategy} sources={profile.field_sources?.gtm_strategy} entries={intelEntries} onHoverSource={setHighlightedEntryId} />
              <ProfileFieldBlock field="raw_synthesis" label="Recent Changes" value={profile.raw_synthesis} sources={profile.field_sources?.raw_synthesis} entries={intelEntries} onHoverSource={setHighlightedEntryId} />
              <ProfileFieldBlock field="industry" label="Industry" value={profile.industry} sources={profile.field_sources?.industry} entries={intelEntries} onHoverSource={setHighlightedEntryId} businessId={business.id} editable editedManually={profile.industry_edited_manually} conflict={profile.field_conflicts?.industry} onSaved={setProfile} />
              <ProfileFieldBlock field="core_problem" label="Core Problem" value={profile.core_problem} sources={profile.field_sources?.core_problem} entries={intelEntries} onHoverSource={setHighlightedEntryId} businessId={business.id} editable editedManually={profile.core_problem_edited_manually} conflict={profile.field_conflicts?.core_problem} onSaved={setProfile} />
              <ProfileFieldBlock field="products" label="Products" value={profile.products} isArrayField sources={profile.field_sources?.products} entries={intelEntries} onHoverSource={setHighlightedEntryId} businessId={business.id} editable editedManually={profile.products_edited_manually} conflict={profile.field_conflicts?.products} onSaved={setProfile} />
              <ProfileFieldBlock field="value_props" label="Value Props" value={profile.value_props} isArrayField sources={profile.field_sources?.value_props} entries={intelEntries} onHoverSource={setHighlightedEntryId} businessId={business.id} editable editedManually={profile.value_props_edited_manually} conflict={profile.field_conflicts?.value_props} onSaved={setProfile} />
              <ProfileFieldBlock field="motto" label="Motto" value={profile.motto} sources={profile.field_sources?.motto} entries={intelEntries} onHoverSource={setHighlightedEntryId} businessId={business.id} editable editedManually={profile.motto_edited_manually} conflict={profile.field_conflicts?.motto} onSaved={setProfile} />
              {profile.generated_at && (
                <p style={{ ...mono, fontSize:10, color:C.dim, margin:"8px 0 0" }}>Last checked {fmtDate(profile.generated_at)}</p>
              )}
            </div>
          ) : (
            <div style={{ marginBottom:32 }}>
              <h2 style={{ ...mono, fontSize:13, color:C.txt, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", margin:"0 0 16px" }}>Profile</h2>
              <ProfileFieldBlock field="vision" label="Vision" value={profile.vision} sources={profile.field_sources?.vision} entries={intelEntries} onHoverSource={setHighlightedEntryId} />
              <ProfileFieldBlock field="positioning" label="Positioning" value={profile.positioning} sources={profile.field_sources?.positioning} entries={intelEntries} onHoverSource={setHighlightedEntryId} />
              <ProfileFieldBlock field="icp" label="ICP" value={profile.icp} sources={profile.field_sources?.icp} entries={intelEntries} onHoverSource={setHighlightedEntryId} />
              <ProfileFieldBlock field="gtm_strategy" label="GTM Strategy" value={profile.gtm_strategy} sources={profile.field_sources?.gtm_strategy} entries={intelEntries} onHoverSource={setHighlightedEntryId} />
              <ProfileFieldBlock field="competitors" label="Competitors" value={profile.competitors} sources={profile.field_sources?.competitors} entries={intelEntries} onHoverSource={setHighlightedEntryId} />
              <ProfileFieldBlock field="industry" label="Industry" value={profile.industry} sources={profile.field_sources?.industry} entries={intelEntries} onHoverSource={setHighlightedEntryId} businessId={business.id} editable editedManually={profile.industry_edited_manually} conflict={profile.field_conflicts?.industry} onSaved={setProfile} />
              <ProfileFieldBlock field="core_problem" label="Core Problem" value={profile.core_problem} sources={profile.field_sources?.core_problem} entries={intelEntries} onHoverSource={setHighlightedEntryId} businessId={business.id} editable editedManually={profile.core_problem_edited_manually} conflict={profile.field_conflicts?.core_problem} onSaved={setProfile} />
              <ProfileFieldBlock field="sub_issues" label="Sub-Issues" value={profile.sub_issues} isArrayField sources={profile.field_sources?.sub_issues} entries={intelEntries} onHoverSource={setHighlightedEntryId} businessId={business.id} editable editedManually={profile.sub_issues_edited_manually} conflict={profile.field_conflicts?.sub_issues} onSaved={setProfile} />
              <ProfileFieldBlock field="products" label="Products" value={profile.products} isArrayField sources={profile.field_sources?.products} entries={intelEntries} onHoverSource={setHighlightedEntryId} businessId={business.id} editable editedManually={profile.products_edited_manually} conflict={profile.field_conflicts?.products} onSaved={setProfile} />
              <ProfileFieldBlock field="value_props" label="Value Props" value={profile.value_props} isArrayField sources={profile.field_sources?.value_props} entries={intelEntries} onHoverSource={setHighlightedEntryId} businessId={business.id} editable editedManually={profile.value_props_edited_manually} conflict={profile.field_conflicts?.value_props} onSaved={setProfile} />
              <ProfileFieldBlock field="motto" label="Motto" value={profile.motto} sources={profile.field_sources?.motto} entries={intelEntries} onHoverSource={setHighlightedEntryId} businessId={business.id} editable editedManually={profile.motto_edited_manually} conflict={profile.field_conflicts?.motto} onSaved={setProfile} />
              <ProfileFieldBlock field="strategic_philosophy" label="Strategic Philosophy" value={profile.strategic_philosophy} sources={profile.field_sources?.strategic_philosophy} entries={intelEntries} onHoverSource={setHighlightedEntryId} businessId={business.id} editable editedManually={profile.strategic_philosophy_edited_manually} conflict={profile.field_conflicts?.strategic_philosophy} onSaved={setProfile} />

              {profile.raw_synthesis && (
                <div style={{ marginTop:16 }}>
                  <button onClick={()=>setNotesOpen(o=>!o)} style={{ ...mono, fontSize:11, color:C.dim, background:"transparent", border:"none", cursor:"pointer", padding:0 }}>
                    {notesOpen ? "▾" : "▸"} Full notes
                  </button>
                  {notesOpen && (
                    <p style={{ ...mono, fontSize:12, color:C.dim, whiteSpace:"pre-wrap", marginTop:8, lineHeight:1.6 }}>{profile.raw_synthesis}</p>
                  )}
                </div>
              )}
            </div>
          )
        )}

        {profile && (
          <AssayCriteriaCard
            businessId={business.id}
            criteria={profile.assay_criteria}
            updatedAt={profile.assay_criteria_updated_at}
            editedManually={profile.assay_criteria_edited_manually}
            onUpdated={patch => setProfile(p => ({ ...p, ...patch }))}
          />
        )}

        {profile && (
          <OutreachRulesCard
            businessId={business.id}
            rules={profile.outreach_rules}
            updatedAt={profile.outreach_rules_updated_at}
            editedManually={profile.outreach_rules_edited_manually}
            onUpdated={patch => setProfile(p => ({ ...p, ...patch }))}
          />
        )}

        <div>
          <button onClick={()=>setLogOpen(o=>!o)} style={{ ...mono, fontSize:12, color:C.dim, background:"transparent", border:"none", cursor:"pointer", padding:0, marginBottom:10 }}>
            {logOpen ? "▾" : "▸"} Intel log ({intelEntries.length})
          </button>
          {logOpen && (
            loading ? (
              <p style={{ ...mono, fontSize:12, color:C.dim }}>Loading…</p>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {intelEntries.map(entry => {
                  // Derived N fields — reverse-index over field_sources, so
                  // it's visible at a glance which entries actually
                  // contributed vs. which contributed nothing (e.g. a
                  // password-walled site scan) - business-intel-smart-upload-v1.
                  const derivedCount = Object.values(profile?.field_sources || {}).filter(ids => Array.isArray(ids) && ids.includes(entry.id)).length;
                  const highlighted = highlightedEntryId === entry.id;
                  return (
                    <div key={entry.id} style={{ padding:"10px 12px", background:highlighted ? `${C.blue}0F` : C.card, border:`1px solid ${highlighted ? C.blue : C.brd}`, borderRadius:8, transition:"background 0.15s, border-color 0.15s" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6, flexWrap:"wrap" }}>
                        <span style={{ ...mono, fontSize:9, padding:"2px 7px", borderRadius:9, background:`${C.blue}18`, border:`1px solid ${C.blue}44`, color:C.blue }}>
                          {SOURCE_LABEL[entry.source] || entry.source}
                        </span>
                        {entry.content_type && (
                          <span style={{ ...mono, fontSize:9, padding:"2px 7px", borderRadius:9, background:`${C.purple}18`, border:`1px solid ${C.purple}44`, color:C.purple }}>
                            {CONTENT_TYPE_LABEL[entry.content_type] || entry.content_type}
                          </span>
                        )}
                        <span style={{ ...mono, fontSize:10, color:C.dim }}>{fmtDate(entry.created_at)}</span>
                        <span style={{ ...mono, fontSize:10, color:derivedCount > 0 ? C.green : C.dim, marginLeft:"auto" }}>
                          {derivedCount > 0 ? `Derived ${derivedCount} field${derivedCount > 1 ? 's' : ''}` : 'Derived nothing'}
                        </span>
                      </div>
                      <p style={{ ...mono, fontSize:12, color:C.txt, margin:0, whiteSpace:"pre-wrap" }}>{entry.content}</p>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>

        <CallLogSection business={business} userEmail={userEmail} intelEntries={intelEntries} projects={projects} onReload={load} />
        </>)}
      </div>
    </div>
  );
}
