import { useState, useEffect, useCallback, useRef } from 'react';
import { C, mono, PRESET_SWATCH_COLORS } from '../constants/colors';
import { createProject } from '../utils/db';
import BusinessAccountsTab from './BusinessAccountsTab';
import BusinessSearchTab from './BusinessSearchTab';
import BusinessGenerationTab from './BusinessGenerationTab';
import BusinessCommandCenterTab from './BusinessCommandCenterTab';
import MembersPermissionsTab from './MembersPermissionsTab';
import SmartIntakeBox from './SmartIntakeBox';

const SOURCE_LABEL = { manual: 'Manual', research_site: 'Site research', research_web: 'Web research' };

const fmtDate = iso => { try { return new Date(iso).toLocaleString("en-US", { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" }); } catch { return "—"; } };

const inp = { fontSize:13, padding:"8px 11px", background:C.bg, border:`1.5px solid ${C.brdM}`, borderRadius:6, color:C.txt, outline:"none", width:"100%", boxSizing:"border-box", ...mono };
const btn = { ...mono, fontSize:12, padding:"7px 18px", background:C.gold, border:`1px solid ${C.gold}`, borderRadius:6, color:C.bg, cursor:"pointer", fontWeight:700 };
const sectionLabel = { ...mono, fontSize:12, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 };

function ProfileBlock({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ marginBottom:16 }}>
      <div style={sectionLabel}>{label}</div>
      <p style={{ ...mono, fontSize:13, color:C.txt, margin:0, lineHeight:1.6 }}>{value}</p>
    </div>
  );
}

function CreateProjectModal({ businessId, userEmail, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(PRESET_SWATCH_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError('');
    const { project, error: err } = await createProject({ name: name.trim(), color, ownerEmail: userEmail, businessId });
    setSaving(false);
    if (err) { setError(err); return; }
    onCreated(project);
  };

  return (
    <div onClick={e=>{if(e.target===e.currentTarget) onClose();}} style={{ position:"fixed", inset:0, zIndex:1000, background:"#00000099", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ background:C.card, border:`1px solid ${C.brd}`, borderRadius:12, padding:"22px 26px", width:380, boxShadow:"0 20px 60px #000c" }}>
        <div style={{ display:"flex", alignItems:"center", marginBottom:20 }}>
          <span style={{ ...mono, fontSize:14, color:C.txt, fontWeight:700 }}>New project</span>
          <button onClick={onClose} style={{ marginLeft:"auto", background:"transparent", border:"none", color:C.mut, fontSize:18, cursor:"pointer" }}>✕</button>
        </div>
        <div style={{ marginBottom:16 }}>
          <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>Name</div>
          <input type="text" placeholder="Q3 outbound push" value={name} onChange={e=>setName(e.target.value)}
            onKeyDown={e=>e.key==="Enter" && name.trim() && handleCreate()} style={inp} />
        </div>
        <div style={{ marginBottom:22 }}>
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
        {error && <div style={{ ...mono, fontSize:11, color:C.red, marginBottom:12 }}>⚠ {error}</div>}
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
          <button onClick={onClose} style={{ ...mono, fontSize:12, padding:"7px 16px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:6, color:C.mut, cursor:"pointer" }}>Cancel</button>
          <button onClick={handleCreate} disabled={!name.trim()||saving}
            style={{ ...mono, fontSize:12, padding:"7px 20px", background:name.trim()?C.gold:"transparent", border:`1px solid ${name.trim()?C.gold:C.brd}`, borderRadius:6, color:name.trim()?C.bg:C.dim, cursor:name.trim()&&!saving?"pointer":"default", fontWeight:700 }}>
            {saving ? "Creating…" : "Create →"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProjectsSection({ business, userEmail, projects, onProjectCreated }) {
  const [open, setOpen] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div style={{ marginBottom:32 }}>
      <button onClick={()=>setOpen(o=>!o)} style={{ ...mono, fontSize:12, color:C.dim, background:"transparent", border:"none", cursor:"pointer", padding:0, marginBottom:10 }}>
        {open ? "▾" : "▸"} Projects ({projects.length})
      </button>
      {open && (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {projects.map(p => (
            <div key={p.id} style={{ padding:"9px 12px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:8 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <span style={{ width:10, height:10, borderRadius:"50%", background:p.color||C.gold, flexShrink:0 }} />
                <span style={{ ...mono, fontSize:13, color:C.txt, flex:1 }}>{p.name}</span>
                <span style={{ ...mono, fontSize:10, color:C.dim }}>{fmtDate(p.created_at)}</span>
              </div>
              <p style={{ ...mono, fontSize:11, color:p.strategy_synthesis?C.mut:C.dim, margin:"6px 0 0 20px", lineHeight:1.5, fontStyle:p.strategy_synthesis?"normal":"italic" }}>
                {p.strategy_synthesis || "No strategy yet — notes filed to this project will synthesize one automatically."}
              </p>
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
  const [entryError, setEntryError] = useState('');
  const [updatedFlash, setUpdatedFlash] = useState(false);

  const [notesOpen, setNotesOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [pollTimedOut, setPollTimedOut] = useState(false);

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
    setEntryError('');
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
      setSavingEntry(false);
    }
  };

  const wideView = view === 'accounts' || view === 'search' || view === 'generation' || view === 'command-center' || view === 'members';

  return (
    <div style={{ minHeight:"100vh", background:C.bg, padding:"48px 40px" }}>
      <div style={{ maxWidth: wideView ? 1100 : 700, margin:"0 auto" }}>
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
        {view === 'accounts' && <BusinessAccountsTab business={business} userEmail={userEmail} />}
        {view === 'search' && <BusinessSearchTab business={business} userEmail={userEmail} />}
        {view === 'generation' && <BusinessGenerationTab business={business} />}
        {view === 'projects' && (
          <ProjectsSection business={business} userEmail={userEmail} projects={projects} onProjectCreated={onProjectCreated} />
        )}
        {view === 'members' && <MembersPermissionsTab business={business} viewerEmail={userEmail} />}

        {view === 'overview' && (<>
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
              <ProfileBlock label="Vision" value={profile.vision} />
              <ProfileBlock label="Current Strategy" value={profile.gtm_strategy} />
              <ProfileBlock label="Recent Changes" value={profile.raw_synthesis} />
              {profile.generated_at && (
                <p style={{ ...mono, fontSize:10, color:C.dim, margin:"8px 0 0" }}>Last checked {fmtDate(profile.generated_at)}</p>
              )}
            </div>
          ) : (
            <div style={{ marginBottom:32 }}>
              <h2 style={{ ...mono, fontSize:13, color:C.txt, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", margin:"0 0 16px" }}>Profile</h2>
              <ProfileBlock label="Vision" value={profile.vision} />
              <ProfileBlock label="Positioning" value={profile.positioning} />
              <ProfileBlock label="ICP" value={profile.icp} />
              <ProfileBlock label="GTM Strategy" value={profile.gtm_strategy} />
              <ProfileBlock label="Competitors" value={profile.competitors} />

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

        <div style={{ marginBottom:32 }}>
          <textarea
            placeholder="Add intel…" value={newEntry} onChange={e=>setNewEntry(e.target.value)}
            rows={3} style={{ ...inp, resize:"vertical", marginBottom:8 }}
          />
          {entryError && <div style={{ ...mono, fontSize:11, color:C.red, marginBottom:8 }}>⚠ {entryError}</div>}
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <button onClick={handleAddEntry} disabled={!newEntry.trim()||savingEntry} style={{ ...btn, opacity:newEntry.trim()?1:0.5 }}>
              {savingEntry ? "Adding…" : "Add Intel"}
            </button>
            {updatedFlash && <span style={{ ...mono, fontSize:11, color:C.green }}>✓ Profile updated</span>}
          </div>
        </div>

        <div>
          <button onClick={()=>setLogOpen(o=>!o)} style={{ ...mono, fontSize:12, color:C.dim, background:"transparent", border:"none", cursor:"pointer", padding:0, marginBottom:10 }}>
            {logOpen ? "▾" : "▸"} Intel log ({intelEntries.length})
          </button>
          {logOpen && (
            loading ? (
              <p style={{ ...mono, fontSize:12, color:C.dim }}>Loading…</p>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {intelEntries.map(entry => (
                  <div key={entry.id} style={{ padding:"10px 12px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:8 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                      <span style={{ ...mono, fontSize:9, padding:"2px 7px", borderRadius:9, background:`${C.blue}18`, border:`1px solid ${C.blue}44`, color:C.blue }}>
                        {SOURCE_LABEL[entry.source] || entry.source}
                      </span>
                      <span style={{ ...mono, fontSize:10, color:C.dim }}>{fmtDate(entry.created_at)}</span>
                    </div>
                    <p style={{ ...mono, fontSize:12, color:C.txt, margin:0, whiteSpace:"pre-wrap" }}>{entry.content}</p>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
        </>)}
      </div>
    </div>
  );
}
