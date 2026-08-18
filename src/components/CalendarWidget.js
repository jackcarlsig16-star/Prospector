import { useState, useEffect } from "react";
import { C, TS, mono } from '../constants/colors';
import CallPrepModal from './CallPrepModal';
import CallPrepButton from './CallPrepButton';
import { COMPANY_EMAIL_DOMAIN } from '../constants/appConfig';
import { AddAccountModal } from './AccountsPage';
import { getStagedAccounts, setStagedAccount } from '../utils/storage';
import PreCallResearchPanel from './calendar/PreCallResearchPanel';
import { getHandoffIntels, saveHandoffIntel } from '../utils/db';
import { trackDailyStat } from '../utils/stats';

// ─── Sales Calendar Widget ───────────────────────────────────────────────────
const MEETING_LABELS = [
  { key:"customer", text:"Customer", c:"#FF4444", bg:"#1a0505",   bdr:"#FF4444" },
  { key:"handoff",  text:"Handoff",  c:"#A855F7", bg:"#16071c",   bdr:"#A855F7" },
  { key:"internal", text:"Internal", c:"#00F5FF", bg:"#04161a",   bdr:"#00F5FF" },
  { key:"reminder", text:"Reminder", c:"#FFB800", bg:"#1a1100",   bdr:"#FFB800" },
  { key:"other",    text:"Other",    c:"#555555", bg:"#141414",   bdr:"#2a2a2a" },
];

const PARTNER_PURPLE = "#A855F7";
const PARTNER_RE = /\bpartner(ship)?\b/i;

// ── Shared style tokens ─────────────────────────────────────────────────────
const CYN  = "#00b4d8";
const ACT_BTN = (border, color, hoverBg) => ({
  height: 28, padding: "0 12px", borderRadius: 4,
  border: `1px solid ${border}`, color, background: "transparent",
  cursor: "pointer", fontSize: 11, fontFamily: "'SF Mono',ui-monospace,monospace",
  display: "inline-flex", alignItems: "center", whiteSpace: "nowrap",
  transition: "background 0.12s",
  _hoverBg: hoverBg, // used by onMouseEnter/Leave
});
const TIER_PILL = {
  Gold:   { bg:"#1a1000", c:"#f59e0b", bdr:"#f59e0b" },
  Silver: { bg:"#111520", c:"#94a3b8", bdr:"#94a3b8" },
  Tin:    { bg:"#141414", c:"#666",    bdr:"#333" },
  Slag:   { bg:"#141414", c:"#555",    bdr:"#2a2a2a" },
};
const CHIP_STYLE = {
  fontSize: 11, fontFamily: "'SF Mono',ui-monospace,monospace",
  padding: "0 7px", height: 20, lineHeight: "20px",
  background: "#050f14", border: "0.5px solid #1e3a45",
  borderRadius: 3, color: "#4a9db5",
  display: "inline-flex", alignItems: "center",
};
const PILL_STYLE = (lbl, active) => ({
  fontSize: 10, fontFamily: "'SF Mono',ui-monospace,monospace",
  padding: "0 7px", height: 18, lineHeight: "18px",
  background: active ? lbl.bg : "transparent",
  border: `0.5px solid ${active ? lbl.bdr : "#2a2a2a"}`,
  borderRadius: 3, color: active ? lbl.c : "#555",
  cursor: "pointer", display: "inline-flex", alignItems: "center",
  transition: "all 0.12s",
});
const GHOST_BTN = (border, color, hoverBg) => ({
  height: 28, padding: "0 10px", borderRadius: 4,
  border: `0.5px solid ${border}`, color, background: "transparent",
  cursor: "pointer", fontSize: 11, fontFamily: "'SF Mono',ui-monospace,monospace",
  display: "inline-flex", alignItems: "center", whiteSpace: "nowrap",
  transition: "background 0.12s",
  _hoverBg: hoverBg,
});
const HANDOFF_RE = /\b(disco(very)?|coach(ing)?|intro\s*call|new\s*biz|bdr|hand.?off|pass.?off|referral|nba)\b/i;
const CAL_LABELS_KEY = "prospector_cal_labels";
const loadCalLabels = () => { try { return JSON.parse(localStorage.getItem(CAL_LABELS_KEY)||"{}"); } catch { return {}; } };
const CAL_LINKS_KEY = "prospector_cal_links";
const loadCalLinks = () => { try { return JSON.parse(localStorage.getItem(CAL_LINKS_KEY)||"{}"); } catch { return {}; } };

const fuzzyMatchAccount = (title, attendees=[], accounts=[]) => {
  const haystack = [title, ...attendees.map(a=>a.email||''), ...attendees.map(a=>a.displayName||'')].join(' ').toLowerCase();
  let best = null, bestScore = 0;
  for (const acc of accounts) {
    const name = acc.name.toLowerCase();
    const words = name.split(/\s+/).filter(w=>w.length>3);
    const score = words.filter(w=>haystack.includes(w)).length / Math.max(words.length,1);
    if (score > bestScore && score >= 0.5) { bestScore = score; best = acc; }
  }
  return best;
};

function SalesCalendarWidget({ accounts=[], onNav, authError=null, tasks=[], onCreateTask, onAddAccount=()=>{}, onEventsLoaded, onUpdateAccount }) {
  const [events, setEvents] = useState(null); // null=loading, "noauth"|"scopeerror"|"error" = state, arr = loaded
  const [calError, setCalError] = useState(null);
  const [weekDays, setWeekDays] = useState([]); // [{date, events}]
  const [now, setNow] = useState(()=>new Date());
  const [prepPing, setPrepPing] = useState(null); // meeting starting soon
  const [labelOverrides, setLabelOverrides] = useState(()=>loadCalLabels());
  const [viewDate, setViewDate] = useState(()=>{ const d=new Date(); d.setHours(0,0,0,0); return d; });
  const [viewMode, setViewMode] = useState("today"); // "today" | "week"
  const [expandedEvId, setExpandedEvId] = useState(null);
  const [briefEv, setBriefEv] = useState(null); // event for CallPrepModal
  const [calLinks, setCalLinks] = useState(()=>loadCalLinks());
  const [linkingEvId, setLinkingEvId] = useState(null);
  const [linkSearch, setLinkSearch] = useState("");
  const [stagedAccounts, setStagedAccountsState] = useState(getStagedAccounts);
  const [researchPanelEv, setResearchPanelEv]   = useState(null); // {ev, extAtt, evKey}
  const [creatingFromStaged, setCreatingFromStaged] = useState(null);
  const [intelRecords, setIntelRecords] = useState([]);
  const [intelDrafts, setIntelDrafts] = useState({});
  const [acceptedIds, setAcceptedIds] = useState(()=>{
    try { return new Set(JSON.parse(localStorage.getItem('prospector_queue_accepted')||'[]')); } catch { return new Set(); }
  });

  // Live clock every 1s for precise countdowns
  useEffect(()=>{
    const t = setInterval(()=>setNow(new Date()), 1000);
    return ()=>clearInterval(t);
  }, []);

  const fetchEvents = async (tMin, tMax) => {
    const token = localStorage.getItem("gmail_access_token");
    if (!token) return "notoken";
    try {
      const res = await fetch(`/proxy/gcal/events?timeMin=${encodeURIComponent(tMin)}&timeMax=${encodeURIComponent(tMax)}`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.error) {
        const msg = data.error?.message || JSON.stringify(data.error);
        const code = data.error?.code || data.error?.status || "";
        const isNotEnabled = msg.includes("accessNotConfigured") || msg.includes("has not been used") || msg.includes("Calendar API");
        const isScope = msg.includes("scope") || msg.includes("PERMISSION_DENIED") || code === 403;
        console.warn("[GCal error]", code, msg);
        return isNotEnabled ? `notEnabled:${msg}` : isScope ? `scopeerror:${msg}` : `autherror:${msg}`;
      }
      return data.items || [];
    } catch(e) { console.warn("[GCal fetch]", e); return `error:${e.message}`; }
  };

  const loadDay = async (d) => {
    setEvents(null);
    setCalError(null);
    setExpandedEvId(null);
    const token = localStorage.getItem("gmail_access_token");
    if (!token) { setEvents("noauth"); return; }
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
    const dayEnd   = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59).toISOString();
    const result = await fetchEvents(dayStart, dayEnd);
    if (result === "notoken")                                            { setEvents("noauth"); return; }
    if (typeof result === "string" && result.startsWith("notEnabled:")) { setEvents("notEnabled"); setCalError(result.slice(11)); return; }
    if (typeof result === "string" && result.startsWith("scopeerror:")) { setEvents("scopeerror"); setCalError(result.slice(11)); return; }
    if (typeof result === "string" && result.startsWith("autherror:"))  { setEvents("autherror");  setCalError(result.slice(10)); return; }
    if (typeof result === "string" && result.startsWith("error:"))      { setEvents("error");      setCalError(result.slice(6));  return; }
    if (!Array.isArray(result))                                          { setEvents("error"); setCalError(String(result)); return; }
    const filtered = filterExternal(result);
    setEvents(filtered);
    onEventsLoaded?.(filtered);
  };

  const loadWeek = async () => {
    setWeekDays([]);
    const token = localStorage.getItem("gmail_access_token");
    if (!token) return;
    const today = new Date(); today.setHours(0,0,0,0);
    const dow = today.getDay(); // 0=Sun, 6=Sat
    const monday = new Date(today);
    if (dow === 0)      monday.setDate(today.getDate() + 1);
    else if (dow === 6) monday.setDate(today.getDate() + 2);
    else                monday.setDate(today.getDate() - (dow - 1));
    const friday = new Date(monday); friday.setDate(monday.getDate()+4); friday.setHours(23,59,59,999);
    const result = await fetchEvents(monday.toISOString(), friday.toISOString());
    if (!Array.isArray(result)) return;
    const filtered = result.filter(ev=>{
      if (!ev.start?.dateTime) return false;
      const attendees = ev.attendees || [];
      const hasExternal = attendees.some(a=>!a.email?.toLowerCase().endsWith('@' + COMPANY_EMAIL_DOMAIN)&&!a.self);
      if (hasExternal) return true;
      const title = (ev.summary||"").toLowerCase();
      return accounts.some(acc=>{
        const n = acc.name.toLowerCase();
        const words = n.split(/\s+/).filter(w=>w.length>3);
        return title.includes(n) || words.some(w=>title.includes(w));
      });
    });
    const days = [];
    for (let i=0; i<5; i++) {
      const d = new Date(monday); d.setDate(monday.getDate()+i);
      const ds = d.toISOString().slice(0,10);
      days.push({ date:d, evs:filtered.filter(ev=>(ev.start?.dateTime||"").startsWith(ds)) });
    }
    setWeekDays(days);
  };

  useEffect(()=>{ loadDay(viewDate); loadWeek(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{ getHandoffIntels().then(setIntelRecords); }, []);

  const navDay = (delta) => {
    const next = new Date(viewDate);
    next.setDate(next.getDate() + delta);
    setViewDate(next);
    loadDay(next);
  };

  // 30-min prep ping
  useEffect(()=>{
    if (!Array.isArray(events)) return;
    events.forEach(ev=>{
      const start = new Date(ev.start?.dateTime || ev.start?.date);
      const diffMin = (start - now) / 60000;
      if (diffMin > 0 && diffMin <= 30 && !prepPing) setPrepPing(ev);
    });

    // Detect meetings that just ended (within last 5 minutes, not already triggered)
    if (Array.isArray(events) && onCreateTask) {
      const triggered = new Set(JSON.parse(localStorage.getItem('prospector_debrief_triggered')||'[]'));
      const fiveMinAgo = Date.now() - 5 * 60 * 1000;
      events.forEach(ev => {
        const endMs = ev.end?.dateTime ? new Date(ev.end.dateTime).getTime() : 0;
        if (!endMs) return;
        if (endMs < now && endMs > fiveMinAgo && !triggered.has(ev.id)) {
          triggered.add(ev.id);
          localStorage.setItem('prospector_debrief_triggered', JSON.stringify([...triggered]));

          // Fuzzy match account
          const attendees = ev.attendees || [];
          const matched = fuzzyMatchAccount(ev.summary||'', attendees, accounts);
          const accName = matched?.name || ev.summary || 'Unknown';
          const accId   = matched?.id   || null;
          const tier    = matched?.tier || null;
          const today   = new Date().toISOString().split('T')[0];
          const endTime = new Date(endMs).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});

          // Create task
          onCreateTask({
            id: Date.now(),
            title: `Log debrief — ${accName}`,
            type: 'Research',
            accId,
            accName,
            priority: (tier==='Gold'||tier==='Silver') ? 'High' : 'Medium',
            assignee: 'AE',
            status: 'Open',
            dueDate: today,
            notes: `Meeting ended at ${endTime} — paste Gong transcript into account card`,
            createdAt: today,
            personal: false,
          });

          // Write debrief alert for the banner
          const alerts = JSON.parse(localStorage.getItem('prospector_debrief_alerts')||'[]');
          alerts.push({ id: ev.id, accId, accName, meetingTitle: ev.summary||accName, endedAt: new Date(endMs).toISOString(), dismissed: false });
          localStorage.setItem('prospector_debrief_alerts', JSON.stringify(alerts));
        }
      });
    }
  }, [now, events]); // eslint-disable-line react-hooks/exhaustive-deps

  const filterExternal = (items) => items.filter(ev=>{
    if (!ev.start?.dateTime) return false;
    const attendees = ev.attendees || [];
    if (!attendees.length) return false;
    return attendees.some(a => !a.email?.toLowerCase().endsWith('@' + COMPANY_EMAIL_DOMAIN) && !a.self);
  });

  const matchAccount = (ev) => {
    const linked = calLinks[String(ev.id)];
    if (linked) { const a = accounts.find(x => x.id === linked); if (a) return a; }
    const title = (ev.summary || "").toLowerCase();
    const extEmails = (ev.attendees || []).filter(a => !a.email?.endsWith('@' + COMPANY_EMAIL_DOMAIN) && !a.self);
    const extDomains = extEmails.map(a => (a.email?.split("@")[1] || "").replace(/\.(com|io|co|net|org)$/, "").toLowerCase());
    const extNames  = extEmails.map(a => (a.displayName || "").toLowerCase());
    return accounts.find(acc => {
      const n = acc.name.toLowerCase();
      const words = n.split(/\s+/).filter(w => w.length > 3);
      if (title.includes(n)) return true;
      if (words.some(w => title.includes(w))) return true;
      if (extDomains.some(d => d && (n.includes(d) || d.includes(n.split(" ")[0])))) return true;
      if (extNames.some(nm => nm && nm.includes(n.split(" ")[0]))) return true;
      return false;
    });
  };

  const meetingLabel = (ev) => {
    const override = labelOverrides[String(ev.id)];
    if (override) return MEETING_LABELS.find(l=>l.key===override) || MEETING_LABELS[4];
    const att = ev.attendees || [];
    if (!att.length || !ev.start?.dateTime) return MEETING_LABELS[3]; // Reminder
    const nonSelf = att.filter(a => !a.self);
    const title = ev.summary || "";

    // 1. All non-self attendees are on our company domain → Internal (highest priority)
    const hasAnyEmail = nonSelf.some(a => !!a.email);
    if (hasAnyEmail) {
      const allInternal = nonSelf.length > 0 && nonSelf.every(a => a.email?.toLowerCase().endsWith('@' + COMPANY_EMAIL_DOMAIN));
      if (allInternal) return MEETING_LABELS[2]; // Internal
    } else {
      // No attendee emails — fall back to organizer domain
      const orgEmail = ev.organizer?.email || '';
      if (orgEmail.toLowerCase().endsWith('@' + COMPANY_EMAIL_DOMAIN)) return MEETING_LABELS[2]; // Internal
    }

    const hasExternal = nonSelf.some(a => !a.email?.toLowerCase().endsWith('@' + COMPANY_EMAIL_DOMAIN));

    // 2. Handoff: external attendees AND title matches HANDOFF_RE (both required)
    if (hasExternal && HANDOFF_RE.test(title)) return MEETING_LABELS[1]; // Handoff

    // 3. Customer: external attendees + territory match
    if (hasExternal && matchAccount(ev)) return MEETING_LABELS[0]; // Customer

    // 4. External but no match
    if (hasExternal) return MEETING_LABELS[4]; // Other

    return MEETING_LABELS[2]; // Internal
  };

  const isHandoff = (ev) => meetingLabel(ev).key === "handoff";

  // ── Queue helpers ────────────────────────────────────────────────────────────
  const queueCompanyName = (ev) => {
    const ext = (ev.attendees||[]).filter(a=>!a.email?.toLowerCase().endsWith('@' + COMPANY_EMAIL_DOMAIN)&&!a.self);
    if (ext.length > 0) {
      const d = ext[0].email?.split('@')[1]||'';
      const base = d.replace(/\.(com|io|co|net|org|ai|app|xyz)$/,'');
      if (base) return base.charAt(0).toUpperCase()+base.slice(1);
    }
    return ev.summary||'Unknown';
  };
  const detectSource = (title) => {
    const t = (title||'').toLowerCase();
    if (t.includes('nba')||/disco(very)?/.test(t)||/new.?biz/.test(t)) return 'NBA';
    return 'BDR';
  };
  const matchIntelRecord = (ev) => {
    const evKey = String(ev.id);
    const exact = intelRecords.find(r=>r.event_id===evKey);
    if (exact) return exact;
    const evDate = ev.start?.dateTime?new Date(ev.start.dateTime).toISOString().slice(0,10):null;
    if (!evDate) return null;
    const co = queueCompanyName(ev).toLowerCase();
    return intelRecords.find(r=>{
      if ((r.meeting_date||'').slice(0,10)!==evDate) return false;
      const rc=(r.company||'').toLowerCase();
      return rc.length>=3&&(rc.includes(co.slice(0,4))||co.includes(rc.slice(0,4)));
    })||null;
  };
  const queueEvs = weekDays.flatMap(d=>d.evs||[]).filter(ev=>isHandoff(ev)&&!acceptedIds.has(String(ev.id)));

  const setLabel = (evId, key) => {
    const next = { ...loadCalLabels(), [String(evId)]: key };
    localStorage.setItem(CAL_LABELS_KEY, JSON.stringify(next));
    setLabelOverrides(next);
  };

  const clearLabel = (evId) => {
    const next = { ...loadCalLabels() };
    delete next[String(evId)];
    localStorage.setItem(CAL_LABELS_KEY, JSON.stringify(next));
    setLabelOverrides(next);
  };

  const saveLink = (evId, accId) => {
    const next = { ...calLinks, [String(evId)]: accId };
    setCalLinks(next);
    localStorage.setItem(CAL_LINKS_KEY, JSON.stringify(next));
    setLinkingEvId(null);
    setLinkSearch("");
  };
  const removeLink = (evId) => {
    const next = { ...calLinks };
    delete next[String(evId)];
    setCalLinks(next);
    localStorage.setItem(CAL_LINKS_KEY, JSON.stringify(next));
  };

  const countdown = (ev) => {
    const start = new Date(ev.start?.dateTime);
    const end   = new Date(ev.end?.dateTime);
    const diffMs = start - now;
    const endMs  = end - now;
    if (endMs < 0) return { label: "Done", c: C.dim, past: true };
    if (diffMs <= 0 && endMs > 0) return { label: "● Now", c: C.green, live: true };
    const totalSecs = Math.round(diffMs / 1000);
    if (totalSecs < 600) {
      const m = Math.floor(totalSecs/60), s = totalSecs%60;
      return { label: m>0?`in ${m}m ${s}s`:`in ${s}s`, c: C.red, imminent: true };
    }
    const mins = Math.round(diffMs / 60000);
    if (mins <= 30) return { label: `in ${mins}m`, c: C.red };
    if (mins <= 60) return { label: `in ${mins}m`, c: C.orange };
    const h = Math.floor(mins/60), m = mins%60;
    return { label: `in ${h}h${m>0?` ${m}m`:""}`, c: C.mut };
  };

  const fmtTime = (dt) => {
    const d = new Date(dt);
    const h = d.getHours() % 12 || 12, m = d.getMinutes();
    const ap = d.getHours() >= 12 ? "pm" : "am";
    return `${h}:${m.toString().padStart(2,"0")}${ap}`;
  };

  const dayLabel = (d=viewDate) => {
    const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`;
  };
  const isToday = viewDate.toDateString() === new Date().toDateString();

  const cardH = { background:"#050f05", border:"1px solid #1a3a1a", borderRadius:8, padding:"12px 14px", flex:1, display:"flex", flexDirection:"column", minHeight:280, minWidth:0, overflow:"hidden" };

  // ── Error / auth states ──────────────────────────────────────────────────
  if (events === "noauth" || events === "autherror" || events === "scopeerror" || events === "error" || events === "notEnabled") return (
    <div style={cardH}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
        <p style={{ ...mono, margin:0, fontSize:11, fontWeight:600, color:C.mut, textTransform:"uppercase", letterSpacing:"0.09em" }}>Calendar</p>
        <span style={{ ...mono, fontSize:11, color:C.dim }}>{dayLabel()}</span>
      </div>
      <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:8, textAlign:"center", padding:"0 8px" }}>
        {events === "scopeerror" ? <>
          <p style={{ ...mono, margin:0, fontSize:13, color:C.orange }}>Calendar access not granted</p>
          <p style={{ ...mono, margin:0, fontSize:11, color:C.dim+"88" }}>Token doesn't include Calendar scope — re-authorize.</p>
        </> : events === "notEnabled" ? <>
          <p style={{ ...mono, margin:0, fontSize:13, color:C.red }}>Calendar API not enabled</p>
          <p style={{ ...mono, margin:0, fontSize:11, color:C.dim+"88" }}>Enable Google Calendar API in GCP Console,<br/>then re-authorize.</p>
        </> : events === "autherror" ? <>
          <p style={{ ...mono, margin:0, fontSize:13, color:C.red }}>Auth error</p>
          <p style={{ ...mono, margin:0, fontSize:11, color:C.dim+"88" }}>Token may be expired — re-authorize to refresh.</p>
        </> : events === "error" ? <>
          <p style={{ ...mono, margin:0, fontSize:13, color:C.red }}>Couldn't reach Google Calendar</p>
          <p style={{ ...mono, margin:0, fontSize:11, color:C.dim+"88" }}>Check connection and try again.</p>
        </> : <>
          <p style={{ ...mono, margin:0, fontSize:13, color:C.dim }}>Connect Google Calendar</p>
          <p style={{ ...mono, margin:0, fontSize:11, color:C.dim+"88" }}>Grants read-only access to Gmail + Calendar</p>
        </>}
        {(calError || authError) && (
          <p style={{ ...mono, margin:0, fontSize:10, color:C.red+"99", fontStyle:"italic", maxWidth:260, wordBreak:"break-word" }}>
            {calError || authError}
          </p>
        )}
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", justifyContent:"center" }}>
          {events !== "noauth" && <button onClick={()=>loadDay(viewDate)} style={{ ...mono, fontSize:12, padding:"6px 14px", background:C.brd, border:`1px solid ${C.brd}`, color:C.dim, borderRadius:5, cursor:"pointer" }}>Retry</button>}
          <a href="/api/gmail/auth" onClick={()=>localStorage.removeItem("prospector_gmail_auth_error")} style={{ ...mono, fontSize:12, padding:"6px 16px", background:`${C.blue}18`, border:`1px solid ${C.blue}55`, color:C.blue, borderRadius:5, textDecoration:"none" }}>
            {events === "noauth" ? "Connect Calendar →" : "Re-authorize →"}
          </a>
        </div>
      </div>
    </div>
  );

  if (events === null) return (
    <div style={cardH}>
      <p style={{ ...mono, margin:"0 0 12px", fontSize:11, fontWeight:600, color:C.mut, textTransform:"uppercase", letterSpacing:"0.09em" }}>Calendar</p>
      <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center" }}>
        <p style={{ ...mono, fontSize:12, color:C.dim }}>Loading…</p>
      </div>
    </div>
  );

  const upcoming = events.filter(ev=>{ const cd=countdown(ev); return !cd.past; });
  const past     = events.filter(ev=>countdown(ev).past);
  const nextMtg = upcoming[0] || (()=>{
    const allWeekEvs = weekDays.flatMap(d=>d.evs||[]);
    const future = allWeekEvs.filter(ev=>new Date(ev.start?.dateTime)>now).sort((a,b)=>new Date(a.start.dateTime)-new Date(b.start.dateTime));
    return future[0]||null;
  })();

  const topGold = accounts
    .filter(a=>a.tier==="Gold"&&a.stage!=="Closed Won"&&a.stage!=="Closed Lost")
    .sort((a,b)=>(a.lastContacted||0)-(b.lastContacted||0))
    .slice(0,3);

  return (
    <>
    <div style={cardH}>
      {briefEv && <CallPrepModal ev={briefEv} acc={matchAccount(briefEv)} tasks={tasks} onUpdate={onUpdateAccount} onClose={()=>setBriefEv(null)} />}

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:10, flexShrink:0 }}>
        <div style={{ display:"flex", gap:2 }}>
          {[["today","Today"],["week","This Week"],["queue","Queue"]].map(([mode,label])=>(
            <button key={mode} onClick={()=>{ setViewMode(mode); if(mode==="week"||mode==="queue")loadWeek(); }}
              style={{ ...mono,fontSize:10,padding:"3px 8px",border:"none",background:"transparent",
                color:viewMode===mode?CYN:C.dim,cursor:"pointer",
                borderBottom:viewMode===mode?`2px solid ${CYN}`:"2px solid transparent",
                paddingBottom:2,transition:"all 0.12s",display:"inline-flex",alignItems:"center",gap:4 }}>
              {label}
              {mode==="queue"&&queueEvs.length>0&&(
                <span style={{ minWidth:14,height:14,borderRadius:7,background:"#EF4444",display:"inline-flex",alignItems:"center",justifyContent:"center",padding:"0 3px",boxSizing:"border-box" }}>
                  <span style={{ fontSize:8,color:"#fff",fontWeight:700,lineHeight:1 }}>{queueEvs.length}</span>
                </span>
              )}
            </button>
          ))}
        </div>
        {viewMode==="today" && <>
          <button onClick={()=>navDay(-1)} style={{ background:"transparent",border:`1px solid ${C.brd}`,color:C.dim,borderRadius:4,cursor:"pointer",fontSize:12,padding:"1px 6px",lineHeight:1.4 }}>‹</button>
          <span style={{ ...mono,fontSize:10,color:isToday?C.mut:C.blue,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{isToday?"Today":dayLabel()}</span>
          <button onClick={()=>navDay(1)} style={{ background:"transparent",border:`1px solid ${C.brd}`,color:C.dim,borderRadius:4,cursor:"pointer",fontSize:12,padding:"1px 6px",lineHeight:1.4 }}>›</button>
          {!isToday && <button onClick={()=>{ const t=new Date();t.setHours(0,0,0,0);setViewDate(t);loadDay(t); }} style={{ ...mono,fontSize:10,padding:"2px 6px",background:"transparent",border:`1px solid ${C.brd}`,color:C.dim,borderRadius:4,cursor:"pointer" }}>Today</button>}
          {isToday && nextMtg && (()=>{
            const cd=countdown(nextMtg);
            return <span style={{ ...mono,fontSize:10,color:`${CYN}99`,background:`${CYN}0a`,border:`1px solid ${CYN}22`,borderRadius:4,padding:"2px 6px",flexShrink:0 }}>Next {cd.label}</span>;
          })()}
        </>}
        {viewMode==="week" && <span style={{ ...mono,fontSize:10,color:C.mut,flex:1 }}>Mon–Fri</span>}
        <button onClick={()=>viewMode==="today"?loadDay(viewDate):loadWeek()} style={{ background:"transparent",border:`1px solid ${C.brd}`,color:C.dim,borderRadius:4,cursor:"pointer",fontSize:10,padding:"2px 6px",flexShrink:0 }}>↻</button>
      </div>

      {/* ── 30-min prep ping ───────────────────────────────────────────── */}
      {prepPing && (
        <div style={{ marginBottom:8,padding:"7px 10px",background:`${C.gold}12`,border:`1px solid ${C.gold}44`,borderRadius:6,display:"flex",alignItems:"center",gap:8,flexShrink:0 }}>
          <span style={{ fontSize:14 }}>⏰</span>
          <span style={{ ...mono,fontSize:11,color:C.gold,flex:1 }}>{prepPing.summary} in 30 min — prep ready?</span>
          <CallPrepButton size="sm" onClick={()=>{ setBriefEv(prepPing); trackDailyStat("meetings_prepped"); setPrepPing(null); }} />
          <button onClick={()=>setPrepPing(null)} style={{ background:"transparent",border:"none",color:C.dim,cursor:"pointer",fontSize:13,padding:0 }}>✕</button>
        </div>
      )}

      {/* ── Scoreboard countdown ───────────────────────────────────────── */}
      {viewMode==="today" && nextMtg && (()=>{
        const cd = countdown(nextMtg);
        const diffMs = Math.max(0, new Date(nextMtg.start?.dateTime) - now);
        const totalSecs = Math.floor(diffMs / 1000);
        const hh = Math.floor(totalSecs / 3600);
        const mm = Math.floor((totalSecs % 3600) / 60);
        const ss = totalSecs % 60;
        const pad = n => String(n).padStart(2,"0");
        const showHours = hh > 0;

        const digitBlock = (val, label) => (
          <div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:2 }}>
            <div style={{
              background:"#060e18",
              border:`1px solid ${CYN}33`,
              borderRadius:4,
              padding:"2px 6px",
              fontFamily:"'Courier New',Courier,monospace",
              fontSize:18,
              fontWeight:700,
              color:"#e8f4ff",
              letterSpacing:"0.06em",
              minWidth:34,
              textAlign:"center",
              textShadow:`0 0 10px ${CYN}66`,
              boxShadow:`0 0 8px ${CYN}22`,
              lineHeight:1.2,
            }}>{val}</div>
            <span style={{ fontFamily:"'SF Mono',ui-monospace,monospace",fontSize:7,color:`${CYN}66`,textTransform:"uppercase",letterSpacing:"0.12em" }}>{label}</span>
          </div>
        );

        const colon = (
          <div style={{ display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",paddingBottom:12,gap:3 }}>
            <div style={{ width:3,height:3,borderRadius:"50%",background: cd.live?"#42E890":totalSecs<600?"#F06060":totalSecs<3600?"#F5A050":"#2a2f3a" }} />
            <div style={{ width:3,height:3,borderRadius:"50%",background: cd.live?"#42E890":totalSecs<600?"#F06060":totalSecs<3600?"#F5A050":"#2a2f3a" }} />
          </div>
        );

        const accentC = cd.live ? "#42E890" : totalSecs < 600 ? "#F06060" : totalSecs < 3600 ? "#F5A050" : "#ffffff";

        return (
          <div style={{ flexShrink:0,marginBottom:8,padding:"7px 0 6px",borderBottom:`1px solid ${C.brd}22`,display:"flex",flexDirection:"column",alignItems:"center",gap:4 }}>
            <div style={{ display:"flex",alignItems:"flex-start",gap:6 }}>
              {showHours && <>{digitBlock(pad(hh),"hrs")}{colon}</>}
              {digitBlock(pad(mm),"min")}
              {colon}
              {digitBlock(pad(ss),"sec")}
            </div>
            <div style={{ display:"flex",alignItems:"center",gap:6 }}>
              {cd.live
                ? <span style={{ fontFamily:"'Courier New',monospace",fontSize:9,fontWeight:700,color:"#42E890",letterSpacing:"0.14em",textTransform:"uppercase" }}>● IN PROGRESS</span>
                : (()=>{
                    const mtgDate = new Date(nextMtg.start?.dateTime);
                    const isToday2 = mtgDate.toDateString()===new Date().toDateString();
                    const dayNames=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
                    const whenLabel = isToday2 ? "" : `${dayNames[mtgDate.getDay()]} · `;
                    return (
                      <span style={{ fontFamily:"'SF Mono',ui-monospace,monospace",fontSize:9,color:accentC,letterSpacing:"0.04em",opacity:0.8,textAlign:"center" }}>
                        {whenLabel}<span style={{ color:"#ffffff",fontWeight:600 }}>{nextMtg.summary||"next meeting"}</span>
                      </span>
                    );
                  })()
              }
            </div>
          </div>
        );
      })()}

      {/* ── Content ────────────────────────────────────────────────────── */}
      <div style={{ flex:1, overflowY:"auto", minHeight:0 }}>

        {/* ── WEEK VIEW ─────────────────────────────────────────────── */}
        {viewMode==="week" && (
          weekDays.length === 0
            ? <div style={{ display:"flex",alignItems:"center",justifyContent:"center",height:"100%" }}><p style={{ ...mono,fontSize:12,color:C.dim }}>Loading week…</p></div>
            : <div>
                {weekDays.map(({date,evs},i)=>{
                  const dayNames=["MON","TUE","WED","THU","FRI"];
                  const isThisToday = date.toDateString()===new Date().toDateString();
                  return (
                    <div key={i} style={{ marginBottom:10,paddingBottom:10,borderBottom:`1px solid #1a3a1a` }}>
                      <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:evs.length?5:0 }}>
                        <span style={{ ...mono,fontSize:10,fontWeight:700,color:isThisToday?"#39FF14":"#5a8a5a",letterSpacing:"0.16em",minWidth:32,textShadow:isThisToday?"0 0 6px #39FF1488":"none" }}>{dayNames[i]}</span>
                        <span style={{ flex:1,height:1,background:"#1a3a1a" }}/>
                        <span style={{ ...mono,fontSize:9,color:"#4a5a4a",letterSpacing:"0.08em",textTransform:"uppercase" }}>{evs.length===0?"no meetings":`${evs.length} mtg${evs.length!==1?"s":""}`}</span>
                      </div>
                      {evs.map(ev=>{
                        const a=matchAccount(ev); const ts=a?(TS[a.tier]||{i:"·",c:C.dim}):null;
                        const wLbl=meetingLabel(ev);
                        const dur=ev.start?.dateTime&&ev.end?.dateTime?Math.round((new Date(ev.end.dateTime)-new Date(ev.start.dateTime))/60000):null;
                        const evStart=new Date(ev.start.dateTime);
                        const evEnd=ev.end?.dateTime?new Date(ev.end.dateTime):null;
                        const isPastEv=evEnd&&evEnd<new Date();
                        const isLive=evStart<=new Date()&&evEnd&&evEnd>new Date();
                        const wAccent=isLive?C.green:isPastEv?C.dim:wLbl.c;
                        const wKey=String(ev.id);
                        const wExp=expandedEvId===wKey;
                        const meetLink=ev.hangoutLink||ev.conferenceData?.entryPoints?.find(e=>e.entryPointType==="video")?.uri||null;
                        const isPartner = PARTNER_RE.test(ev.summary||"") || wLbl.key === "handoff";
                        return (
                          <div key={wKey} style={{ marginBottom:3,marginLeft:28,borderRadius:5,border:`1px solid ${wExp?wLbl.c+"55":wLbl.c+"18"}`,background:wExp?"rgba(57,255,20,0.04)":"transparent",overflow:"hidden",opacity:isPastEv?0.45:1,borderLeft:`2px solid ${wExp?wLbl.c:wLbl.c+"55"}`,transition:"all 0.12s",minWidth:0 }}
                            onMouseEnter={e=>{if(!wExp){e.currentTarget.style.borderColor=`${wLbl.c}55`;e.currentTarget.style.background="rgba(57,255,20,0.03)";}}}
                            onMouseLeave={e=>{if(!wExp){e.currentTarget.style.borderColor=`${wLbl.c}18`;e.currentTarget.style.background="transparent";}}}>
                            {/* Collapsed header — click to toggle */}
                            <div style={{ display:"flex",alignItems:"center",gap:8,padding:"6px 10px",cursor:"pointer",minWidth:0 }}
                              onClick={()=>setExpandedEvId(wExp?null:wKey)}>
                              <span style={{ ...mono,fontSize:11,color:"#FFB800",flexShrink:0,width:80,letterSpacing:"0.02em" }}>{fmtTime(ev.start.dateTime)}</span>
                              {isPartner && <span style={{ color:PARTNER_PURPLE,fontSize:11,flexShrink:0,textShadow:`0 0 4px ${PARTNER_PURPLE}66` }}>●</span>}
                              <span style={{ ...mono,fontSize:12,color:"#f1f5f9",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1,minWidth:0,fontWeight:500,maxWidth:"100%" }}>{ev.summary||"Meeting"}</span>
                              {dur && <span style={{ ...mono,fontSize:9,color:"#555",padding:"0 5px",height:14,lineHeight:"14px",border:"0.5px solid #1e1e1e",borderRadius:2,flexShrink:0,letterSpacing:"0.04em" }}>{`·${dur}m`}</span>}
                              <span style={PILL_STYLE(wLbl,true)}>{wLbl.text}</span>
                              {a&&a.tier&&TIER_PILL[a.tier]&&<span style={{ fontSize:9,fontFamily:"'SF Mono',ui-monospace,monospace",padding:"0 4px",height:16,lineHeight:"16px",display:"inline-flex",alignItems:"center",background:TIER_PILL[a.tier].bg,border:`0.5px solid ${TIER_PILL[a.tier].bdr}`,borderRadius:3,color:TIER_PILL[a.tier].c,flexShrink:0 }}>{a.tier}</span>}
                            </div>
                            {wExp && (
                              <div style={{ borderTop:`1px solid ${CYN}22`,padding:"6px 8px 7px 8px",display:"flex",flexDirection:"column",gap:5 }}>
                                <div style={{ display:"flex",alignItems:"center",gap:4 }}>
                                  <span style={{ ...mono,fontSize:9,color:C.dim,marginRight:2 }}>Label:</span>
                                  {MEETING_LABELS.map(l=>{
                                    const active=wLbl.key===l.key;
                                    return <span key={l.key} onClick={e=>{e.stopPropagation(); active&&labelOverrides[wKey]?clearLabel(wKey):setLabel(wKey,l.key);}}
                                      style={PILL_STYLE(l,active)}>{l.text}</span>;
                                  })}
                                  {labelOverrides[wKey] && <span onClick={e=>{e.stopPropagation();clearLabel(wKey);}} style={{ ...mono,fontSize:9,color:C.dim,cursor:"pointer",marginLeft:2 }}>↺</span>}
                                </div>
                                {isHandoff(ev) && !labelOverrides[wKey] && (
                                  <div style={{ display:"flex",flexDirection:"column",gap:5,padding:"5px 9px",background:"#1a0a0a",border:"0.5px solid #5a1a1a",borderRadius:5 }}>
                                    <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                                      <span style={{ ...mono,fontSize:10,color:"#cc4444",flex:1 }}>⚠ Not in territory</span>
                                      <button onClick={e=>{e.stopPropagation();setLinkingEvId(linkingEvId===wKey?null:wKey);setLinkSearch("");}}
                                        style={GHOST_BTN("#666","#888","#1a1a1a")}
                                        onMouseEnter={e=>e.currentTarget.style.background="#1a1a1a"}
                                        onMouseLeave={e=>e.currentTarget.style.background="transparent"}>Link →</button>
                                      <button onClick={e=>{e.stopPropagation();const wExtAtt=(ev.attendees||[]).filter(a=>!a.email?.toLowerCase().endsWith('@' + COMPANY_EMAIL_DOMAIN)&&!a.self);setResearchPanelEv({ev,extAtt:wExtAtt,evKey:wKey});}}
                                        style={GHOST_BTN("#f59e0b","#f59e0b","#1a1100")}
                                        onMouseEnter={e=>e.currentTarget.style.background="#1a1100"}
                                        onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                                        {stagedAccounts[wKey]?"Edit Context":"+ Add Context"}</button>
                                      {stagedAccounts[wKey]&&!stagedAccounts[wKey].promoted&&(
                                        <button onClick={e=>{e.stopPropagation();setCreatingFromStaged(stagedAccounts[wKey]);}}
                                          style={GHOST_BTN("#22c55e","#22c55e","#0d2010")}
                                          onMouseEnter={e=>e.currentTarget.style.background="#0d2010"}
                                          onMouseLeave={e=>e.currentTarget.style.background="transparent"}>Create Account →</button>
                                      )}
                                    </div>
                                    {linkingEvId===wKey && (
                                      <div style={{ display:"flex",flexDirection:"column",gap:3 }} onClick={e=>e.stopPropagation()}>
                                        <input autoFocus value={linkSearch} onChange={e=>setLinkSearch(e.target.value)} placeholder="Search accounts…"
                                          style={{ ...mono,fontSize:11,padding:"4px 8px",background:C.bg,border:`1px solid ${C.brd}`,borderRadius:4,color:C.txt,width:"100%",boxSizing:"border-box" }} />
                                        <div style={{ maxHeight:110,overflowY:"auto",display:"flex",flexDirection:"column",gap:2 }}>
                                          {accounts.filter(x=>x.name.toLowerCase().includes(linkSearch.toLowerCase())).slice(0,8).map(x=>(
                                            <div key={x.id} onClick={()=>saveLink(wKey,x.id)}
                                              style={{ ...mono,fontSize:11,padding:"3px 8px",cursor:"pointer",borderRadius:3,color:C.txt,background:C.sur,border:`1px solid ${C.brd}` }}
                                              onMouseEnter={e=>e.currentTarget.style.background=`${C.blue}22`}
                                              onMouseLeave={e=>e.currentTarget.style.background=C.sur}>{x.name}</div>
                                          ))}
                                          {accounts.filter(x=>x.name.toLowerCase().includes(linkSearch.toLowerCase())).length===0 && (
                                            <span style={{ ...mono,fontSize:10,color:C.dim,padding:"3px 8px" }}>No matches</span>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                                {(ev.attendees||[]).filter(at=>!at.self).length>0 && (
                                  <div style={{ display:"flex",flexWrap:"wrap",gap:4 }}>
                                    {(ev.attendees||[]).filter(at=>!at.self).map((at,i)=>(
                                      <span key={i} style={CHIP_STYLE}>{at.displayName||at.email?.split("@")[0]||"?"}</span>
                                    ))}
                                  </div>
                                )}
                                <div style={{ display:"flex",gap:6,alignItems:"center" }}>
                                  {meetLink && (
                                    <a href={meetLink} target="_blank" rel="noopener noreferrer"
                                      style={{ ...ACT_BTN("#22c55e","#22c55e","#0d2010"),textDecoration:"none" }}
                                      onMouseEnter={e=>e.currentTarget.style.background="#0d2010"}
                                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>Join →</a>
                                  )}
                                  <CallPrepButton size="sm" onClick={e=>{e.stopPropagation();setBriefEv(ev);trackDailyStat("meetings_prepped");}} />
                                  {a && (
                                    <button onClick={e=>{e.stopPropagation();onNav("accounts",a.id);}}
                                      style={ACT_BTN("#f59e0b","#f59e0b","#1a1100")}
                                      onMouseEnter={e=>{e.currentTarget.style.background="#1a1100";}}
                                      onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}>
                                      Account →
                                    </button>
                                  )}
                                  {calLinks[wKey] && (
                                    <button onClick={e=>{e.stopPropagation();removeLink(wKey);}}
                                      style={ACT_BTN("#444","#666","#1a1a1a")}
                                      onMouseEnter={e=>e.currentTarget.style.background="#1a1a1a"}
                                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                                      title="Remove manual link">≠ Unlink</button>
                                  )}
                                </div>
                                <textarea
                                  placeholder="Add context about this meeting..."
                                  style={{ width:'100%', marginTop:8, padding:8, background:'transparent', border:'1px solid rgba(255,255,255,0.15)', borderRadius:6, color:'inherit', fontSize:12, resize:'vertical', minHeight:60 }}
                                  value={intelDrafts[String(ev.id)] || ''}
                                  onChange={e => setIntelDrafts(d => ({ ...d, [String(ev.id)]: e.target.value }))}
                                  onClick={e => e.stopPropagation()}
                                />

                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
        )}

        {/* ── QUEUE VIEW ────────────────────────────────────────────── */}
        {viewMode==="queue" && (
          queueEvs.length === 0
            ? <div style={{ display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",gap:6 }}>
                <p style={{ ...mono,margin:0,fontSize:13,color:C.dim }}>No handoffs in queue</p>
                <p style={{ ...mono,margin:0,fontSize:11,color:C.dim+"66" }}>Handoff events appear here automatically</p>
              </div>
            : <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
                {queueEvs.map(ev=>{
                  const evKey = String(ev.id);
                  const ext = (ev.attendees||[]).filter(a=>!a.email?.toLowerCase().endsWith('@' + COMPANY_EMAIL_DOMAIN)&&!a.self);
                  const cd = countdown(ev);
                  const dur = ev.start?.dateTime&&ev.end?.dateTime?Math.round((new Date(ev.end.dateTime)-new Date(ev.start.dateTime))/60000):null;
                  const src = detectSource(ev.summary);
                  const srcColor = src==='NBA'?C.purple:'#38b6ff';
                  const matched = matchIntelRecord(ev);
                  const company = queueCompanyName(ev);
                  const web = ext[0]?.email?.split('@')[1]||'';

                  // Seed intel from the matching account in prospector_accounts when no saved record exists.
                  const seedFromAccount = (() => {
                    let accounts = [];
                    try { accounts = JSON.parse(localStorage.getItem('prospector_accounts') || '[]'); } catch {}
                    if (!Array.isArray(accounts) || !accounts.length) return '';
                    const companyLower = (company || '').toLowerCase().trim();
                    const domain = (web || '').toLowerCase().trim();
                    const acct = accounts.find(a => {
                      if (!a) return false;
                      const accName = String(a.name || '').toLowerCase().trim();
                      if (accName && companyLower && (accName === companyLower || accName.includes(companyLower) || companyLower.includes(accName))) return true;
                      const accWeb = String(a.web || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
                      if (accWeb && domain && (accWeb === domain || accWeb.includes(domain) || domain.includes(accWeb))) return true;
                      return false;
                    });
                    if (!acct) return '';
                    const ctx = String(acct.handoffContext || '').trim();
                    if (ctx) return ctx;
                    const bm = String(acct.bm || '').trim();
                    const ucs = (acct.ucs || []).slice(0, 2).filter(Boolean);
                    const prods = (acct.prods || []).filter(Boolean);
                    if (!bm && !ucs.length && !prods.length) return '';
                    const parts = [];
                    if (bm) parts.push(bm);
                    if (ucs.length) parts.push(`Key use cases: ${ucs.join(', ')}.`);
                    if (prods.length) parts.push(`Products scoped: ${prods.join(', ')}.`);
                    return parts.join(' ');
                  })();

                  const intelVal = evKey in intelDrafts ? intelDrafts[evKey] : (matched?.intel || seedFromAccount || '');

                  return (
                    <div key={evKey} style={{ borderRadius:6,border:`1px solid ${C.brd}44`,background:C.card,overflow:"hidden" }}>
                      {/* Header row */}
                      <div style={{ padding:"9px 12px",borderBottom:`1px solid ${C.brd}22` }}>
                        <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:3 }}>
                          <span style={{ ...mono,fontSize:10,padding:"0 6px",height:16,lineHeight:"16px",background:srcColor+"18",border:`0.5px solid ${srcColor}55`,borderRadius:3,color:srcColor,flexShrink:0 }}>{src}</span>
                          <span style={{ fontSize:13,fontWeight:600,color:C.txt,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{company}</span>
                          <span style={{ ...mono,fontSize:10,color:cd.c,background:`${cd.c}12`,borderRadius:3,padding:"0 5px",fontWeight:cd.imminent||cd.live?600:400,flexShrink:0 }}>{cd.label}</span>
                        </div>
                        <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                          <span style={{ ...mono,fontSize:11,color:C.dim }}>
                            {ev.start?.dateTime?fmtTime(ev.start.dateTime):''}
                            {dur?` · ${dur}m`:''}
                          </span>
                          {ext.length>0&&(
                            <span style={{ ...mono,fontSize:11,color:"#4a9db5",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                              {ext.slice(0,2).map(a=>a.displayName||a.email?.split('@')[0]).join(', ')}
                              {ext.length>2?` +${ext.length-2}`:''}
                            </span>
                          )}
                        </div>
                      </div>
                      {/* Intel box */}
                      <div style={{ padding:"8px 12px 10px" }}>
                        <p style={{ ...mono,margin:"0 0 4px",fontSize:9,color:C.dim+"99",textTransform:"uppercase",letterSpacing:"0.09em" }}>Intel{matched&&matched.event_id?.startsWith('webhook_')?' · via webhook':''}</p>
                        <textarea
                          value={intelVal}
                          placeholder="Add context about this company — funding, use case, why they're a fit…"
                          onChange={e=>setIntelDrafts(d=>({...d,[evKey]:e.target.value}))}
                          onBlur={()=>{
                            const val = evKey in intelDrafts ? intelDrafts[evKey] : (matched?.intel || seedFromAccount || '');
                            saveHandoffIntel({ eventId:evKey, company, meetingDate:ev.start?.dateTime?.slice(0,10)||null, intel:val, source:src });
                            setIntelRecords(prev=>{
                              const without = prev.filter(r=>r.event_id!==evKey);
                              return [...without,{ event_id:evKey, company, intel:val, source:src, meeting_date:ev.start?.dateTime?.slice(0,10)||null }];
                            });
                          }}
                          style={{ ...mono,width:"100%",boxSizing:"border-box",fontSize:11,padding:"7px 9px",background:C.bg,border:`1px solid ${C.brd}`,borderRadius:5,color:C.txt,resize:"vertical",minHeight:56,outline:"none",lineHeight:1.5 }}
                        />
                        <div style={{ display:"flex",justifyContent:"flex-end",marginTop:7 }}>
                          <button
                            onClick={()=>{
                              setCreatingFromStaged({
                                evId:    evKey,
                                evTitle: company,
                                context: intelVal,
                                web,
                                vertical:    null,
                                subVertical: null,
                                fromQueue:   true,
                              });
                            }}
                            style={{ ...mono,fontSize:12,padding:"5px 14px",background:`${C.green}18`,border:`1px solid ${C.green}55`,color:C.green,borderRadius:5,cursor:"pointer",fontWeight:600 }}
                            onMouseEnter={e=>e.currentTarget.style.background=`${C.green}28`}
                            onMouseLeave={e=>e.currentTarget.style.background=`${C.green}18`}
                          >Accept — Add to Territory →</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
        )}

        {/* ── TODAY VIEW ────────────────────────────────────────────── */}
        {viewMode==="today" && (
          events.length===0 ? (
            <div style={{ display:"flex",flexDirection:"column",gap:10,padding:"10px 0" }}>
              <div style={{ textAlign:"center",padding:"6px 0 2px" }}>
                <p style={{ ...mono,margin:0,fontSize:13,color:C.dim }}>No meetings today</p>
                <p style={{ ...mono,margin:"4px 0 0",fontSize:11,color:C.dim+"66" }}>Good day to prospect 🪙</p>
              </div>
              {topGold.length>0 && (
                <div style={{ borderTop:`1px solid ${C.brd}22`,paddingTop:10 }}>
                  <p style={{ ...mono,margin:"0 0 6px",fontSize:10,color:C.gold+"88",textTransform:"uppercase",letterSpacing:"0.07em" }}>Top Gold to touch</p>
                  {topGold.map(a=>(
                    <div key={a.id} onClick={()=>onNav("accounts",a.id)} style={{ display:"flex",alignItems:"center",gap:8,marginBottom:4,padding:"5px 8px",background:`${C.gold}08`,border:`1px solid ${C.gold}22`,borderRadius:5,cursor:"pointer" }}>
                      <span style={{ ...mono,fontSize:10,color:C.gold }}>◆</span>
                      <span style={{ ...mono,fontSize:11,color:C.txt,flex:1 }}>{a.name}</span>
                      <span style={{ ...mono,fontSize:10,color:C.dim }}>{a.stage||"—"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            [...upcoming,...past].map(ev=>{
              const isPast=countdown(ev).past;
              const cd=countdown(ev);
              const acc=matchAccount(ev);
              const ts=acc?(TS[acc.tier]||{i:"·",c:C.dim}):null;
              const extAtt=(ev.attendees||[]).filter(a=>!a.email?.toLowerCase().endsWith('@' + COMPANY_EMAIL_DOMAIN)&&!a.self);
              const allAtt=(ev.attendees||[]).filter(a=>!a.self);
              const meetLink=ev.hangoutLink||ev.conferenceData?.entryPoints?.find(e=>e.entryPointType==="video")?.uri||null;
              const dur=ev.start?.dateTime&&ev.end?.dateTime?Math.round((new Date(ev.end.dateTime)-new Date(ev.start.dateTime))/60000):null;
              const evKey=String(ev.id);
              const isExp=expandedEvId===evKey;
              const lbl=meetingLabel(ev);
              const accentColor = cd.live ? C.green : isPast ? C.dim : lbl.c;
              const bdrColor = acc?.tier==="Gold" ? `${C.gold}50` : `${C.brd}44`;
              const bgColor  = acc?.tier==="Gold" ? `${C.gold}05` : `${C.sur}60`;

              const tierPillStyle = acc?.tier && TIER_PILL[acc.tier]
                ? { fontSize:9,fontFamily:"'SF Mono',ui-monospace,monospace",padding:"0 5px",height:16,lineHeight:"16px",display:"inline-flex",alignItems:"center",background:TIER_PILL[acc.tier].bg,border:`0.5px solid ${TIER_PILL[acc.tier].bdr}`,borderRadius:3,color:TIER_PILL[acc.tier].c,flexShrink:0 }
                : null;

              return (
                <div key={evKey} style={{ marginBottom:4,borderRadius:6,border:`1px solid ${isExp?lbl.c+"55":lbl.c+"18"}`,background:isExp?"#0a1a20":bgColor,overflow:"hidden",opacity:isPast?0.4:1,display:"flex",transition:"all 0.12s",borderLeft:`2px solid ${isExp?lbl.c:lbl.c+"55"}` }}
                  onMouseEnter={e=>{ if(!isExp){ e.currentTarget.style.borderColor=`${lbl.c}55`; e.currentTarget.style.background="#0a1a20"; } }}
                  onMouseLeave={e=>{ if(!isExp){ e.currentTarget.style.borderColor=`${lbl.c}18`; e.currentTarget.style.background=bgColor; } }}>
                  <div style={{ flex:1,minWidth:0 }}>
                    {cd.live && <div style={{ height:2,background:C.green,width:"100%" }} />}
                    {/* Collapsed header — click anywhere here to toggle */}
                    <div style={{ padding:"7px 10px 7px 8px",cursor:"pointer" }}
                      onClick={()=>setExpandedEvId(isExp?null:evKey)}>
                      <div style={{ display:"flex",alignItems:"center",gap:5,marginBottom:2 }}>
                        <span style={{ ...mono,fontSize:11,color:"#2dd4bf",flexShrink:0 }}>
                          {fmtTime(ev.start.dateTime)}{dur?` · ${dur}m`:""}
                        </span>
                        <span style={{ ...mono,fontSize:10,color:cd.c,background:`${cd.c}12`,borderRadius:3,padding:"0 5px",fontWeight:(cd.imminent||cd.live)?600:400,flexShrink:0 }}>
                          {cd.label}
                        </span>
                        <div style={{ flex:1 }} />
                        <span style={PILL_STYLE(lbl,true)}>{lbl.text}</span>
                        {acc && tierPillStyle && <span style={tierPillStyle}>{acc.tier}</span>}
                      </div>
                      <p style={{ margin:"0 0 2px",fontSize:13,fontWeight:500,color:isPast?"#555":"#e8e8e0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                        {ev.summary||"(No title)"}
                      </p>
                      {extAtt.length>0 && (
                        <p style={{ ...mono,margin:0,fontSize:11,color:"#4a9db5",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                          {extAtt.slice(0,2).map(a=>a.displayName||a.email?.split("@")[0]).join(", ")}
                          {extAtt.length>2?` +${extAtt.length-2}`:""}
                        </p>
                      )}
                      {!acc&&extAtt.length>0&&!isPast && (
                        <div style={{ display:"flex",alignItems:"center",gap:5,marginTop:3 }} onClick={e=>e.stopPropagation()}>
                          <span style={{ ...mono,fontSize:10,color:"#f59e0b" }}>⬡ Not in territory</span>
                          <button
                            onClick={e=>{e.stopPropagation();setResearchPanelEv({ev,extAtt,evKey});}}
                            style={{ ...mono,fontSize:10,padding:"1px 7px",background:"transparent",border:`1px solid ${C.goldBdr}`,color:C.gold,borderRadius:3,cursor:"pointer" }}>
                            {stagedAccounts[evKey]?"Edit Context":"+ Add Context"}
                          </button>
                          {stagedAccounts[evKey]&&!stagedAccounts[evKey].promoted&&(
                            <button
                              onClick={e=>{e.stopPropagation();setCreatingFromStaged(stagedAccounts[evKey]);}}
                              style={{ ...mono,fontSize:10,padding:"1px 7px",background:"transparent",border:"1px solid #22c55e",color:"#22c55e",borderRadius:3,cursor:"pointer" }}>
                              Create Account →
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    {isExp && (
                      <div style={{ borderTop:`1px solid ${CYN}22`,padding:"7px 10px 8px 8px",display:"flex",flexDirection:"column",gap:6 }}>
                        {/* Label selector */}
                        <div style={{ display:"flex",alignItems:"center",gap:4 }}>
                          <span style={{ ...mono,fontSize:9,color:C.dim,marginRight:2 }}>Label:</span>
                          {MEETING_LABELS.map(l=>{
                            const active=lbl.key===l.key;
                            return <span key={l.key} onClick={e=>{e.stopPropagation(); active&&labelOverrides[evKey]?clearLabel(evKey):setLabel(evKey,l.key);}}
                              style={PILL_STYLE(l,active)}>
                              {l.text}
                            </span>;
                          })}
                          {labelOverrides[evKey] && <span onClick={e=>{e.stopPropagation();clearLabel(evKey);}} style={{ ...mono,fontSize:9,color:C.dim,cursor:"pointer",marginLeft:2 }} title="Reset to auto">↺</span>}
                        </div>
                        {/* Handoff notice */}
                        {isHandoff(ev) && !labelOverrides[evKey] && (
                          <div style={{ display:"flex",flexDirection:"column",gap:5,padding:"5px 9px",background:"#1a0a0a",border:"0.5px solid #5a1a1a",borderRadius:5 }}>
                            <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                              <span style={{ ...mono,fontSize:10,color:"#cc4444",flex:1 }}>⚠ Not in territory — likely a handoff</span>
                              <button onClick={e=>{e.stopPropagation();setLinkingEvId(linkingEvId===evKey?null:evKey);setLinkSearch("");}}
                                style={GHOST_BTN("#666","#888","#1a1a1a")}
                                onMouseEnter={e=>e.currentTarget.style.background="#1a1a1a"}
                                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>Link →</button>
                              <button onClick={e=>{e.stopPropagation();setResearchPanelEv({ev,extAtt,evKey});}}
                                style={GHOST_BTN("#f59e0b","#f59e0b","#1a1100")}
                                onMouseEnter={e=>e.currentTarget.style.background="#1a1100"}
                                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                                {stagedAccounts[evKey]?"Edit Context":"+ Add Context"}</button>
                              {stagedAccounts[evKey]&&!stagedAccounts[evKey].promoted&&(
                                <button onClick={e=>{e.stopPropagation();setCreatingFromStaged(stagedAccounts[evKey]);}}
                                  style={GHOST_BTN("#22c55e","#22c55e","#0d2010")}
                                  onMouseEnter={e=>e.currentTarget.style.background="#0d2010"}
                                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>Create Account →</button>
                              )}
                            </div>
                            {linkingEvId===evKey && (
                              <div style={{ display:"flex",flexDirection:"column",gap:3 }} onClick={e=>e.stopPropagation()}>
                                <input autoFocus value={linkSearch} onChange={e=>setLinkSearch(e.target.value)} placeholder="Search accounts…"
                                  style={{ ...mono,fontSize:11,padding:"4px 8px",background:C.bg,border:`1px solid ${C.brd}`,borderRadius:4,color:C.txt,width:"100%",boxSizing:"border-box" }} />
                                <div style={{ maxHeight:110,overflowY:"auto",display:"flex",flexDirection:"column",gap:2 }}>
                                  {accounts.filter(x=>x.name.toLowerCase().includes(linkSearch.toLowerCase())).slice(0,8).map(x=>(
                                    <div key={x.id} onClick={()=>saveLink(evKey,x.id)}
                                      style={{ ...mono,fontSize:11,padding:"3px 8px",cursor:"pointer",borderRadius:3,color:C.txt,background:C.sur,border:`1px solid ${C.brd}` }}
                                      onMouseEnter={e=>e.currentTarget.style.background=`${C.blue}22`}
                                      onMouseLeave={e=>e.currentTarget.style.background=C.sur}>
                                      {x.name}
                                    </div>
                                  ))}
                                  {accounts.filter(x=>x.name.toLowerCase().includes(linkSearch.toLowerCase())).length===0 && (
                                    <span style={{ ...mono,fontSize:10,color:C.dim,padding:"3px 8px" }}>No matches</span>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        {/* Attendee chips */}
                        {allAtt.length>0 && (
                          <div style={{ display:"flex",flexWrap:"wrap",gap:4 }}>
                            {allAtt.map((a,i)=>(
                              <span key={i} style={CHIP_STYLE}>{a.displayName||a.email?.split("@")[0]||"?"}</span>
                            ))}
                          </div>
                        )}
                        {/* Action buttons */}
                        <div style={{ display:"flex",gap:6,alignItems:"center" }}>
                          {meetLink && (
                            <a href={meetLink} target="_blank" rel="noopener noreferrer"
                              style={{ ...ACT_BTN("#22c55e","#22c55e","#0d2010"),textDecoration:"none" }}
                              onMouseEnter={e=>e.currentTarget.style.background="#0d2010"}
                              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>Join →</a>
                          )}
                          <CallPrepButton size="sm" onClick={e=>{e.stopPropagation();setBriefEv(ev);trackDailyStat("meetings_prepped");}} />
                          {acc && (
                            <button onClick={e=>{e.stopPropagation();onNav("accounts",acc.id);}}
                              style={ACT_BTN("#f59e0b","#f59e0b","#1a1100")}
                              onMouseEnter={e=>{e.currentTarget.style.background="#1a1100";}}
                              onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}>
                              Account →
                            </button>
                          )}
                          {calLinks[evKey] && (
                            <button onClick={e=>{e.stopPropagation();removeLink(evKey);}}
                              style={ACT_BTN("#444","#666","#1a1a1a")}
                              onMouseEnter={e=>e.currentTarget.style.background="#1a1a1a"}
                              onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                              title="Remove manual account link">≠ Unlink</button>
                          )}
                        </div>
                        <div style={{padding:'8px 0'}}>
                          <textarea
                            placeholder="Add context..."
                            value={evKey in intelDrafts ? intelDrafts[evKey] : (matchIntelRecord(ev)?.intel || '')}
                            onChange={e=>setIntelDrafts(d=>({...d,[evKey]:e.target.value}))}
                            onBlur={e=>{
                              const val = e.target.value;
                              const meetingDate = ev.start?.dateTime?.slice(0,10)||null;
                              const company = queueCompanyName(ev);
                              saveHandoffIntel({ eventId:evKey, company, meetingDate, intel:val, source:'manual' });
                              setIntelRecords(prev=>{
                                const without = prev.filter(r=>r.event_id!==evKey);
                                return [...without,{ event_id:evKey, company, intel:val, source:'manual', meeting_date:meetingDate }];
                              });
                            }}
                            onClick={e=>e.stopPropagation()}
                            style={{width:'100%', padding:8, background:'transparent', border:'1px solid rgba(255,255,255,0.2)', borderRadius:6, color:'inherit', fontSize:12, minHeight:60, resize:'vertical'}}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )
        )}
      </div>
    </div>
    {researchPanelEv && (
      <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.65)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center" }}
        onClick={()=>setResearchPanelEv(null)}>
        <div style={{ maxWidth:520,width:"90%",borderRadius:8,border:`1px solid ${C.goldBdr}`,overflow:"hidden",boxShadow:"0 8px 32px rgba(0,0,0,0.6)" }}
          onClick={e=>e.stopPropagation()}>
          <PreCallResearchPanel
            ev={researchPanelEv.ev}
            extAtt={researchPanelEv.extAtt}
            existing={stagedAccounts[researchPanelEv.evKey]||null}
            onSave={data=>{setStagedAccount(researchPanelEv.evKey,data);setStagedAccountsState(getStagedAccounts());setResearchPanelEv(null);}}
            onClose={()=>setResearchPanelEv(null)}
          />
        </div>
      </div>
    )}
    {creatingFromStaged && (
      <AddAccountModal
        prefill={{
          name:        creatingFromStaged.evTitle,
          vertical:    creatingFromStaged.vertical,
          context:     creatingFromStaged.context,
          web:         creatingFromStaged.web,
        }}
        onAdd={acc => {
          onAddAccount(acc);
          setStagedAccount(creatingFromStaged.evId, { ...creatingFromStaged, promoted: true });
          setStagedAccountsState(getStagedAccounts());
          if (creatingFromStaged.fromQueue) {
            setAcceptedIds(prev => {
              const next = new Set(prev);
              next.add(creatingFromStaged.evId);
              try { localStorage.setItem('prospector_queue_accepted', JSON.stringify([...next])); } catch {}
              return next;
            });
          }
          setCreatingFromStaged(null);
        }}
        onClose={() => setCreatingFromStaged(null)}
      />
    )}
    </>
  );
}

export default SalesCalendarWidget;
