import { useState, useEffect, useCallback } from "react";
import { C, mono, TIER_COLOR } from '../constants/colors';
import { staleDays } from '../utils/staleness';
import BriefItems from './BriefItems';
import { MODELS } from '../config/models';
import { COMPANY_EMAIL_DOMAIN } from '../constants/appConfig';
import { getValidGmailToken } from '../utils/getValidGmailToken';
import WeekAheadPanel from './WeekAheadPanel';
import { loadCachedWeekAhead, buildWeekAhead, clearCachedWeekAhead } from '../utils/weekAhead';

// ─── Daily Digest ──────────────────────────────────────────────────────────────

// Use LOCAL date for cache key — toISOString() is UTC and flips to tomorrow for US users after 5pm
const localDateStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
const DIGEST_KEY = () => `prospector_digest_${localDateStr()}`;
const BRIEF_KEY  = () => `prospector_morning_brief_${localDateStr()}`;

const LOADING_MSGS = [
  "Surveying the territory...",
  "Checking the claim...",
  "Sifting for gold...",
];

const DAYS   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtHeader() {
  const d = new Date();
  return `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function fmtTime(dt) {
  const d = new Date(dt);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2,"0");
  return `${h % 12 || 12}:${m}${h >= 12 ? "pm" : "am"}`;
}

function countdown(startDt, now) {
  const diff  = new Date(startDt) - now;
  const abs   = Math.abs(diff);
  const mins  = Math.floor(abs / 60000);
  const hrs   = Math.floor(mins / 60);
  const rem   = mins % 60;
  const label = hrs > 0 ? (rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`) : `${mins}m`;
  return diff < 0 ? `${label} ago` : `in ${label}`;
}

function Badge({ children, color }) {
  return (
    <span style={{ ...mono, fontSize: 8, color, background: `${color}22`,
      border: `1px solid ${color}44`, borderRadius: 3, padding: "0 5px", flexShrink: 0 }}>
      {children}
    </span>
  );
}

function SectionToggle({ open, onToggle, label, badges=[] }) {
  return (
    <button onClick={onToggle} style={{ ...mono, fontSize: 10, color: C.txt, background: "transparent",
      border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center",
      gap: 6, width: "100%", textAlign: "left" }}>
      <span style={{ fontSize: 9, color: C.dim, flexShrink: 0 }}>{open ? "▼" : "▶"}</span>
      <span>{label}</span>
      {badges.map((b, i) => <Badge key={i} color={b.color}>{b.text}</Badge>)}
    </button>
  );
}

// ── Gmail Brief helpers ─────────────────────────────────────────────────────

export async function fetchRecentThreads(token) {
  const listRes = await fetch(
    `/proxy/gmail/messages?q=${encodeURIComponent("newer_than:2d in:inbox")}&maxResults=25`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (listRes.status === 401) { localStorage.removeItem("gmail_access_token"); return null; }
  const listData = await listRes.json();
  if (!listData.messages?.length) return [];
  const msgs = await Promise.all(
    listData.messages.slice(0, 20).map(async ({ id }) => {
      const r = await fetch(`/proxy/gmail/message/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      return r.json();
    })
  );
  return msgs.filter(m => m?.id);
}

function slimAccount(a) {
  return { id: a.id, name: a.name, tier: a.tier, stage: a.stage, web: a.web, vert: a.vert };
}

function matchMsgToAccount(msg, accounts) {
  const headers = msg.payload?.headers || [];
  const getH = name => (headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || "").toLowerCase();
  const subject    = getH("Subject");
  const from       = getH("From");
  const fromDomain = (from.match(/@([\w.-]+)/) || [])[1]?.split(".").slice(-2).join(".") || "";
  for (const acc of accounts) {
    const nameL = acc.name.toLowerCase();
    const words = nameL.split(/\s+/).filter(w => w.length > 3);
    if (nameL && (subject.includes(nameL) || from.includes(nameL))) return acc;
    if (words.some(w => subject.includes(w) || from.includes(w))) return acc;
    const webDomain = (acc.web || "").toLowerCase()
      .replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].split(".").slice(-2).join(".");
    if (webDomain && fromDomain && fromDomain === webDomain) return acc;
    if ((acc.gong_participants || []).some(p => from.includes(p.toLowerCase()))) return acc;
  }
  return null;
}

const CALENDAR_NOISE_PATTERNS = [
  /^accepted:/i, /^declined:/i, /^tentative:/i,
  /^updated invitation:/i, /^invitation:/i, /^cancelled:/i,
];

const GONG_PATTERNS = [
  /gong/i, /recording is ready/i, /call recording/i,
  /your call with/i, /notifications@gong\.io/i,
];

export async function generateBrief(msgs, accounts, tasks=[]) {
  const allThreads = msgs.map(msg => {
    const headers = msg.payload?.headers || [];
    const getH = name => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || "";
    const acc = matchMsgToAccount(msg, accounts);
    return {
      subject:    getH("Subject"),
      from:       getH("From"),
      date:       getH("Date"),
      snippet:    (msg.snippet || "").slice(0, 200),
      account:    acc ? acc.name : null,
      account_id: acc ? acc.id   : null,
    };
  }).filter(t => t.subject);

  // Fix 2 — strip calendar noise
  const actionable = allThreads.filter(t => !CALENDAR_NOISE_PATTERNS.some(p => p.test(t.subject)));

  // Fix 3 — separate Gong recordings
  const gongThreads    = actionable.filter(t => GONG_PATTERNS.some(p => p.test(t.subject) || p.test(t.from)));
  const nonGongThreads = actionable.filter(t => !GONG_PATTERNS.some(p => p.test(t.subject) || p.test(t.from)));

  const slim      = accounts.slice(0, 15).map(slimAccount);
  const openTasks = tasks.filter(t => t.status !== "Done" && t.status !== "Completed").slice(0, 15).map(t => ({ id: t.id, title: t.title, dueDate: t.dueDate }));

  const res = await fetch("/proxy/anthropic/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODELS.STANDARD,
      max_tokens: 1500,
      messages: [{
        role: "user",
        content: `You are helping an AE prepare their morning. Recent inbox threads:\n\n${JSON.stringify(nonGongThreads, null, 2)}\n\nTerritory accounts (use id field for account_id):\n${JSON.stringify(slim, null, 2)}\n\nOpen action items:\n${JSON.stringify(openTasks, null, 2)}\n\nIdentify the 3-6 most important threads. For each item return:\n- type: "reply_needed", "urgent", or "action"\n- account: matched account name or null\n- account_id: matched account id from the accounts list, or null\n- headline: 4-6 word action phrase (e.g. "Reply re: renewal pricing")\n- context: one sentence of context\n- owner: "AE", "Prospect", or "Internal"\n- priority: "immediate", "today", or "fyi"\n- resolves_task: exact title of an open action item this email resolves, or null\n- actions: array of 1-3 relevant actions from ["draft_email","request_se","request_credit","pre_call_brief","open_sfdc","view_account"]\n  Rules: upcoming call → pre_call_brief + request_se; reply needed → draft_email; contract/quote/sfdc action → open_sfdc + draft_email; general follow-up → draft_email + view_account; no account match → ["view_account"]\n\nRespond ONLY with valid JSON, no markdown fences: { "items": [...] }`,
      }],
    }),
  });
  const data = await res.json();
  const text = data.content?.[0]?.text || "";
  // Fix 1 — strip markdown fences before parsing
  const cleaned = text.replace(/```json\s*|```\s*/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON in brief response");
  let parsed;
  try { parsed = JSON.parse(match[0]); }
  catch (e) { throw new Error("Brief JSON parse failed: " + e.message); }
  return { ...parsed, gongThreads };
}

// ───────────────────────────────────────────────────────────────────────────


export default function DailyDigest({ accounts=[], tasks=[], firstName="AE", onNav, onUpdateTask, onCreateTask }) {
  const [open, setOpen]           = useState(false);
  const [loading, setLoading]     = useState(false);
  const [loadMsg, setLoadMsg]     = useState(LOADING_MSGS[0]);
  const [meetings, setMeetings]   = useState(null); // null=not fetched yet
  const [now, setNow]             = useState(new Date());
  const [showItems, setShowItems] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);
  const [showWins, setShowWins]   = useState(false);
  const [weekAhead, setWeekAhead]           = useState(() => loadCachedWeekAhead());
  const [weekAheadExpanded, setWeekAheadExpanded] = useState(false);
  const [weekAheadLoading, setWeekAheadLoading]   = useState(false);
  const [weekAheadError, setWeekAheadError]       = useState(null);
  const [brief, setBrief]             = useState(() => {
    try { return JSON.parse(localStorage.getItem(BRIEF_KEY()) || "null"); } catch { return null; }
  });
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError,   setBriefError]   = useState(null);

  // Refresh weekAhead state when cache changes (from another component or this one)
  useEffect(() => {
    const onUpdate = () => setWeekAhead(loadCachedWeekAhead());
    window.addEventListener('prospector_week_ahead_updated', onUpdate);
    return () => window.removeEventListener('prospector_week_ahead_updated', onUpdate);
  }, []);

  // External trigger: HomePage "View All" button dispatches this to open the digest
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('prospector_open_digest', onOpen);
    return () => window.removeEventListener('prospector_open_digest', onOpen);
  }, []);

  const handleRefreshWeekAhead = useCallback(async () => {
    setWeekAheadLoading(true);
    setWeekAheadError(null);
    try {
      clearCachedWeekAhead();
      await buildWeekAhead();
    } catch (e) {
      setWeekAheadError(e.message || 'Generate failed');
    }
    setWeekAheadLoading(false);
  }, []);

  // Tick every minute for live countdowns
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, [open]);

  // Derived data — use local date string, not UTC (toISOString flips to tomorrow after 5pm local)
  const todayISO = localDateStr();

  const overdueTasks = tasks.filter(t =>
    !t.personal && t.status !== "Done" && t.status !== "done" &&
    t.dueDate && t.dueDate < todayISO
  );
  const todayTasks = tasks.filter(t =>
    !t.personal && t.status !== "Done" && t.status !== "done" && t.dueDate === todayISO
  );

  const atRiskAccounts = accounts
    .filter(a => (a.tier === "Gold" || a.tier === "Silver") && staleDays(a.last) >= 90)
    .sort((a, b) => staleDays(b.last) - staleDays(a.last));

  const quickWins = accounts
    .filter(a => a.tier === "Gold" && staleDays(a.last) >= 30)
    .sort((a, b) => staleDays(b.last) - staleDays(a.last))
    .slice(0, 3);

  // ── Calendar fetch ──────────────────────────────────────────────────────────
  const fetchMeetings = useCallback(async (force = false) => {
    if (!force) {
      try {
        const cached = JSON.parse(localStorage.getItem(DIGEST_KEY()) || "null");
        if (cached?.meetings?.length) { setMeetings(cached.meetings); return; }
      } catch {}
    }

    const token = await getValidGmailToken();
    if (!token) { setMeetings([]); return; }

    setLoading(true);
    let msgIdx = 0;
    setLoadMsg(LOADING_MSGS[0]);
    const cycle = setInterval(() => {
      msgIdx = (msgIdx + 1) % LOADING_MSGS.length;
      setLoadMsg(LOADING_MSGS[msgIdx]);
    }, 1500);

    try {
      const d = new Date();
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
      const dayEnd   = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59).toISOString();
      const res = await fetch(
        `/proxy/gcal/events?timeMin=${encodeURIComponent(dayStart)}&timeMax=${encodeURIComponent(dayEnd)}`,
        { headers: { "Authorization": `Bearer ${token}` } }
      );
      const data = await res.json();
      if (res.status === 401 || data.error?.status === 401 || data.error?.code === 401) {
        localStorage.removeItem("gmail_access_token");
        setMeetings([]);
        return;
      }
      if (data.error || !Array.isArray(data.items)) { console.error("[DailyDigest] gcal error:", data.error || "items not array"); setMeetings([]); return; }

      // All timed events (skip all-day blocks)
      const ext = data.items.filter(ev => !!ev.start?.dateTime);

      // Enrich with matched territory account
      const enriched = ext.map(ev => {
        const title      = (ev.summary || "").toLowerCase();
        const extEmails  = (ev.attendees || []).filter(a => !a.email?.endsWith('@' + COMPANY_EMAIL_DOMAIN) && !a.self);
        const extDomains = extEmails.map(a => (a.email?.split("@")[1] || "").replace(/\.(com|io|co|net|org)$/, "").toLowerCase());
        const acc = accounts.find(a => {
          const n     = a.name.toLowerCase();
          const words = n.split(/\s+/).filter(w => w.length > 3);
          if (title.includes(n)) return true;
          if (words.some(w => title.includes(w))) return true;
          if (extDomains.some(d => d && (n.includes(d) || d.includes(n.split(" ")[0])))) return true;
          return false;
        });
        return { ...ev, _acc: acc || null };
      });

      setMeetings(enriched);
      try {
        localStorage.setItem(DIGEST_KEY(), JSON.stringify({ meetings: enriched, generatedAt: new Date().toISOString() }));
      } catch {}
    } catch(e) { console.error("[DailyDigest] fetch error:", e); setMeetings([]); }
    finally { clearInterval(cycle); setLoading(false); }
  }, [accounts]);

  useEffect(() => {
    if (open && meetings === null) {
      // Clear any stale empty cache from before the external-filter fix
      try {
        const cached = JSON.parse(localStorage.getItem(DIGEST_KEY()) || "null");
        if (cached && !cached.meetings?.length) localStorage.removeItem(DIGEST_KEY());
      } catch {}
      fetchMeetings();
    }
  }, [open, meetings, fetchMeetings]);

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const companyFromEvent = ev => {
    if (ev._acc) return ev._acc.name;
    const s = ev.summary || "";
    const m = s.match(/(?:with|@|—|:)\s*(.+)/i);
    return m ? m[1].trim() : s;
  };

  const labelColor = ev => {
    const att = ev.attendees || [];
    const hasExt = att.some(a => !a.email?.toLowerCase().endsWith('@' + COMPANY_EMAIL_DOMAIN) && !a.self);
    if (hasExt && ev._acc) return "#F06060";  // Customer
    if (hasExt)            return "#56A8F8";  // Handoff/new biz
    return C.gold;
  };

  const handleGetBrief = async () => {
    const token = await getValidGmailToken();
    if (!token) { setBriefError("Connect Google in Settings to enable Gmail Brief"); return; }
    setBriefLoading(true);
    setBriefError(null);
    try {
      const msgs = await fetchRecentThreads(token);
      if (msgs === null) { setBriefError("Gmail session expired — reconnect in Settings"); return; }
      if (!msgs.length)  { setBriefError("No recent inbox messages found"); return; }
      const result = { ...(await generateBrief(msgs, accounts, tasks)), generatedAt: Date.now() };
      setBrief(result);
      try { localStorage.setItem(BRIEF_KEY(), JSON.stringify(result)); } catch {}
    } catch(e) {
      setBriefError("Brief generation failed — try again");
      console.error("[DailyDigest] brief error:", e);
    } finally {
      setBriefLoading(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ☕ trigger button */}
      <button
        onClick={() => setOpen(o => !o)}
        title="Daily digest"
        style={{
          position: "fixed", bottom: 60, right: 18, zIndex: 3001,
          background: "transparent", border: "none", fontSize: 22,
          cursor: "pointer", opacity: open ? 1 : 0.75, lineHeight: 1,
          padding: 0, transition: "opacity 0.15s",
        }}
        onMouseEnter={e => e.currentTarget.style.opacity = "1"}
        onMouseLeave={e => e.currentTarget.style.opacity = open ? "1" : "0.75"}
      >☕</button>

      {/* Slide-up panel */}
      {open && (
        <div style={{
          position: "fixed", bottom: 100, right: 18, zIndex: 2999,
          width: 360, maxHeight: "72vh",
          background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12,
          boxShadow: "0 16px 48px #000d",
          display: "flex", flexDirection: "column",
          animation: "digestSlideUp 0.18s ease-out",
        }}>
          {/* ── Header ── */}
          <div style={{
            padding: "11px 14px 9px",
            borderBottom: `1px solid ${C.brd}`,
            background: `${C.gold}10`,
            borderRadius: "12px 12px 0 0",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <span style={{ fontSize: 16, flexShrink: 0 }}>☕</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...mono, fontSize: 11, color: C.gold, fontWeight: 700 }}>{fmtHeader()}</div>
              <div style={{ ...mono, fontSize: 10, color: C.dim }}>{greeting()}, {firstName}</div>
            </div>
            <button onClick={() => fetchMeetings(true)} title="Refresh"
              style={{ ...mono, fontSize: 11, color: C.dim, background: "transparent", border: "none", cursor: "pointer", padding: "2px 4px", flexShrink: 0 }}>
              ↺
            </button>
            <button onClick={() => setOpen(false)}
              style={{ fontSize: 14, color: C.dim, background: "transparent", border: "none", cursor: "pointer", lineHeight: 1, padding: 0, flexShrink: 0 }}>
              ✕
            </button>
          </div>

          {/* ── Body ── */}
          <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px 4px" }}>

            {/* Section -1 — Week Ahead (Mondays only, requires cached data) */}
            {new Date().getDay() === 1 && weekAhead && (
              <div style={{ marginBottom: 12, paddingBottom: 10, borderBottom: `1px solid ${C.brd}22` }}>
                <div onClick={() => setWeekAheadExpanded(o => !o)}
                  style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "2px 0" }}>
                  <span style={{ ...mono, fontSize: 10, color: "#2dd4bf", fontWeight: 600, letterSpacing: "0.08em" }}>◆ WEEK AHEAD</span>
                  <span style={{ ...mono, fontSize: 10, color: C.dim }}>
                    {(weekAhead.commitments?.length || 0)} commitment{(weekAhead.commitments?.length || 0) !== 1 ? "s" : ""} · {(weekAhead.upcomingMeetings?.length || 0)} meeting{(weekAhead.upcomingMeetings?.length || 0) !== 1 ? "s" : ""} · {(weekAhead.forecastDeadlines?.length || 0)} deadline{(weekAhead.forecastDeadlines?.length || 0) !== 1 ? "s" : ""}
                  </span>
                  <span style={{ marginLeft: "auto", ...mono, fontSize: 10, color: C.dim }}>{weekAheadExpanded ? "▴ collapse" : "▾ expand"}</span>
                </div>
                {weekAheadExpanded && (
                  <div style={{ marginTop: 8 }}>
                    <WeekAheadPanel
                      data={weekAhead}
                      accounts={accounts}
                      tasks={tasks}
                      onCreateTask={onCreateTask}
                      onNav={(pg, id) => { setOpen(false); onNav?.(pg, id); }}
                      onRefresh={handleRefreshWeekAhead}
                      loading={weekAheadLoading}
                      error={weekAheadError}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Section 0 — Gmail Brief */}
            <div style={{ marginBottom: 12, paddingBottom: 10, borderBottom: `1px solid ${C.brd}22` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <div style={{ ...mono, fontSize: 9, color: C.mut, textTransform: "uppercase", letterSpacing: "0.08em", flex: 1 }}>
                  ✉ Gmail Brief
                </div>
                {briefLoading
                  ? <span style={{ ...mono, fontSize: 10, color: C.dim, fontStyle: "italic" }}>Generating…</span>
                  : <button onClick={handleGetBrief}
                      style={{ ...mono, fontSize: 10, color: C.blue, background: "transparent",
                        border: `1px solid ${C.blue}44`, borderRadius: 4, padding: "2px 8px", cursor: "pointer" }}>
                      {brief ? "↺ Refresh" : "Get Brief"}
                    </button>
                }
              </div>
              {briefError && (
                <div style={{ ...mono, fontSize: 10, color: C.red }}>{briefError}</div>
              )}
              {!brief && !briefLoading && !briefError && (
                <div style={{ ...mono, fontSize: 10, color: C.dim, fontStyle: "italic" }}>
                  {localStorage.getItem("gmail_access_token")
                    ? "Click Get Brief to summarize your morning emails"
                    : "Connect Google in Settings to enable"}
                </div>
              )}
              <BriefItems
                items={brief?.items || []}
                gongThreads={brief?.gongThreads || []}
                generatedAt={brief?.generatedAt}
                accounts={accounts}
                tasks={tasks}
                onNav={onNav}
                onUpdateTask={onUpdateTask}
                onClose={() => setOpen(false)}
              />
            </div>

            {/* Section 1 — Today's Meetings (always open) */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ ...mono, fontSize: 9, color: C.gold, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 7 }}>
                📅 Today's meetings
              </div>

              {loading ? (
                <div style={{ ...mono, fontSize: 11, color: C.dim, fontStyle: "italic", padding: "6px 0" }}>
                  {loadMsg}
                </div>
              ) : (() => {
                // Filter to today's local date BEFORE the empty-state check —
                // prevents cached or timezone-shifted events from a different day showing up
                const todayMeetings = !meetings ? [] : meetings.filter(ev => {
                  if (!ev.start?.dateTime) return false;
                  const evDate = new Date(ev.start.dateTime);
                  return `${evDate.getFullYear()}-${String(evDate.getMonth()+1).padStart(2,"0")}-${String(evDate.getDate()).padStart(2,"0")}` === todayISO;
                });
                // Customer meetings only (red — external attendees matched to a territory account)
                const customerMeetings = todayMeetings.filter(ev => labelColor(ev) === "#F06060");
                if (!meetings) {
                  return <div style={{ ...mono, fontSize: 11, color: C.dim }}>Loading…</div>;
                }
                if (customerMeetings.length === 0) {
                  return (
                    <div style={{ ...mono, fontSize: 11, color: C.dim }}>
                      {!localStorage.getItem("gmail_access_token")
                        ? "Calendar session expired — reconnect Google in Settings"
                        : "No customer meetings today"}
                    </div>
                  );
                }
                return customerMeetings.map(ev => {
                  const color   = labelColor(ev);
                  const company = companyFromEvent(ev);
                  const cd      = countdown(ev.start.dateTime, now);
                  const acc     = ev._acc;
                  return (
                    <div key={ev.id} style={{
                      borderLeft: `3px solid ${color}`,
                      background: `${color}08`,
                      borderRadius: "0 5px 5px 0",
                      padding: "5px 8px",
                      marginBottom: 6,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ ...mono, fontSize: 10, color: C.dim, flexShrink: 0 }}>
                          {fmtTime(ev.start.dateTime)}
                        </span>
                        <span style={{ ...mono, fontSize: 11, fontWeight: 700, color: C.txt, flex: 1,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {company}
                        </span>
                        {acc?.tier && (
                          <Badge color={TIER_COLOR[acc.tier] || C.dim}>{acc.tier}</Badge>
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
                        <span style={{ ...mono, fontSize: 10, color }}>{cd}</span>
                        <span style={{ flex: 1 }}/>
                        {acc && (
                          <button
                            onClick={() => { onNav?.("accounts", acc.id); setOpen(false); }}
                            style={{ ...mono, fontSize: 10, color: C.gold, background: "transparent",
                              border: `1px solid ${C.gold}44`, borderRadius: 4, padding: "1px 7px", cursor: "pointer" }}>
                            Prep →
                          </button>
                        )}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            {/* Section 2 — Action Items */}
            <div style={{ marginBottom: 10, paddingBottom: 8, borderBottom: `1px solid ${C.brd}22` }}>
              <SectionToggle
                open={showItems}
                onToggle={() => setShowItems(e => !e)}
                label="Action items"
                badges={[
                  ...(overdueTasks.length > 0 ? [{ color: C.red,  text: `${overdueTasks.length} overdue` }] : []),
                  ...(todayTasks.length > 0   ? [{ color: C.gold, text: `${todayTasks.length} today` }]    : []),
                ]}
              />
              {showItems && (
                <div style={{ marginTop: 7, paddingLeft: 14 }}>
                  {overdueTasks.length === 0 && todayTasks.length === 0 ? (
                    <div style={{ ...mono, fontSize: 11, color: C.green }}>All clear ✓</div>
                  ) : (
                    [...overdueTasks.map(t => ({ ...t, _g: "o" })), ...todayTasks.map(t => ({ ...t, _g: "t" }))].map(t => (
                      <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                        <div style={{ width: 5, height: 5, borderRadius: "50%",
                          background: t._g === "o" ? C.red : C.gold, flexShrink: 0 }}/>
                        <span style={{ ...mono, fontSize: 11, color: t._g === "o" ? C.red : C.gold,
                          flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {t.title}
                        </span>
                        {t.accName && (
                          <span style={{ ...mono, fontSize: 9, color: C.orange, flexShrink: 0,
                            maxWidth: 70, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {t.accName}
                          </span>
                        )}
                      </div>
                    ))
                  )}
                  <button onClick={() => setOpen(false)}
                    style={{ ...mono, fontSize: 10, color: C.blue, background: "transparent",
                      border: "none", cursor: "pointer", padding: "2px 0", marginTop: 2 }}>
                    Open task panel →
                  </button>
                </div>
              )}
            </div>

            {/* Section 3 — Territory Alerts */}
            <div style={{ marginBottom: 10, paddingBottom: 8, borderBottom: `1px solid ${C.brd}22` }}>
              <SectionToggle
                open={showAlerts}
                onToggle={() => setShowAlerts(e => !e)}
                label="Territory alerts"
                badges={atRiskAccounts.length > 0 ? [{ color: C.red, text: `${atRiskAccounts.length} at risk` }] : []}
              />
              {showAlerts && (
                <div style={{ marginTop: 7, paddingLeft: 14 }}>
                  {atRiskAccounts.length === 0 ? (
                    <div style={{ ...mono, fontSize: 11, color: C.green }}>All Gold/Silver accounts touched recently ✓</div>
                  ) : (
                    <>
                      {atRiskAccounts.slice(0, 5).map(a => (
                        <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                          <Badge color={TIER_COLOR[a.tier] || C.dim}>{a.tier}</Badge>
                          <span style={{ ...mono, fontSize: 11, color: C.txt, flex: 1,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {a.name}
                          </span>
                          <span style={{ ...mono, fontSize: 9, color: C.red, flexShrink: 0 }}>
                            {staleDays(a.last)}d
                          </span>
                          <button onClick={() => { onNav?.("accounts", a.id); setOpen(false); }}
                            style={{ ...mono, fontSize: 9, color: C.dim, background: "transparent",
                              border: "none", cursor: "pointer", padding: 0, flexShrink: 0 }}>
                            View →
                          </button>
                        </div>
                      ))}
                      {atRiskAccounts.length > 5 && (
                        <button onClick={() => { onNav?.("accounts"); setOpen(false); }}
                          style={{ ...mono, fontSize: 10, color: C.blue, background: "transparent",
                            border: "none", cursor: "pointer", padding: "2px 0", marginTop: 2 }}>
                          View all {atRiskAccounts.length} →
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Section 4 — Quick Wins */}
            <div style={{ marginBottom: 10 }}>
              <SectionToggle
                open={showWins}
                onToggle={() => setShowWins(e => !e)}
                label="Quick wins"
                badges={quickWins.length > 0 ? [{ color: C.gold, text: `top ${quickWins.length}` }] : []}
              />
              {showWins && (
                <div style={{ marginTop: 7, paddingLeft: 14 }}>
                  {quickWins.length === 0 ? (
                    <div style={{ ...mono, fontSize: 11, color: C.dim }}>
                      No Gold accounts to touch — go add some 🪙
                    </div>
                  ) : (
                    quickWins.map(a => (
                      <div key={a.id} style={{ marginBottom: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ ...mono, fontSize: 11, fontWeight: 700, color: C.txt,
                            flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {a.name}
                          </span>
                          <span style={{ ...mono, fontSize: 9, color: C.dim, flexShrink: 0 }}>
                            {staleDays(a.last)}d ago
                          </span>
                          <button onClick={() => { onNav?.("accounts", a.id); setOpen(false); }}
                            style={{ ...mono, fontSize: 9, color: C.gold, background: "transparent",
                              border: `1px solid ${C.gold}44`, borderRadius: 4, padding: "1px 6px",
                              cursor: "pointer", flexShrink: 0 }}>
                            View →
                          </button>
                        </div>
                        <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 2 }}>
                          {a.bm || [a.vert, a.stage].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

          </div>

          {/* ── Footer ── */}
          <div style={{ padding: "8px 14px 12px", borderTop: `1px solid ${C.brd}` }}>
            <button onClick={() => { setOpen(false); onNav?.("team"); }}
              style={{ ...mono, width: "100%", fontSize: 11, fontWeight: 700, padding: "7px 0",
                background: `${C.gold}18`, border: `1px solid ${C.gold}55`, color: C.gold,
                borderRadius: 6, cursor: "pointer" }}>
              Start prospecting →
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes digestSlideUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  );
}
