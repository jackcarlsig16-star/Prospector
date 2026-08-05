import { useState, useEffect, useRef } from "react";
import { C } from '../constants/colors';
import { mono } from '../constants/colors';

// ─── Smart Task Panel ─────────────────────────────────────────────────────────
// Natural language task input — Claude parses everything silently.

const TYPE_IC = {
  "Follow up":    "📞",
  "Send pricing": "💰",
  "Schedule call":"📅",
  "Research":     "🔬",
  "Demo":         "🎯",
  "Salesforce":   "⚡",
  "Other":        "·",
};

const PERSONAL_KEY="prospector_personal_tasks";
const PERSONAL_CATS={
  "Health & Fitness":{ ic:"💪", c:C.green },
  "Finance":         { ic:"💰", c:C.gold  },
  "Family & Social": { ic:"👨‍👩‍👧", c:C.blue  },
  "Home":            { ic:"🏠", c:C.tin   },
  "Travel":          { ic:"✈️", c:C.purple },
  "Learning":        { ic:"📚", c:C.orange },
  "Admin":           { ic:"📋", c:C.mut   },
  "Other":           { ic:"📌", c:C.dim   },
};
const KEYWORD_CATS=[
  {cat:"Health & Fitness", kw:/\b(gym|workout|run|running|yoga|exercise|fitness|lift|swim|bike|hike|walk|steps|sleep|diet|meal prep)\b/i},
  {cat:"Finance",          kw:/\b(pay|bill|bank|invoice|budget|taxes|rent|insurance|credit|invest|savings|money)\b/i},
  {cat:"Family & Social",  kw:/\b(call|text|dinner|birthday|mom|dad|family|friend|party|wedding|lunch|coffee|visit)\b/i},
  {cat:"Travel",           kw:/\b(flight|hotel|trip|travel|book|airbnb|pack|visa|passport|airport|vacation)\b/i},
  {cat:"Learning",         kw:/\b(read|book|course|study|learn|podcast|class|practice|research)\b/i},
  {cat:"Home",             kw:/\b(clean|laundry|dry cleaning|groceries|cook|fix|repair|furniture|dishes|vacuum)\b/i},
  {cat:"Admin",            kw:/\b(email|schedule|meeting|appointment|form|document|submit|renew|register|sign)\b/i},
];
const HIGH_PRI_RE=/\b(urgent|asap|today|tonight|now|immediately|deadline|due today)\b/i;
const LOW_PRI_RE=/\b(someday|eventually|whenever|no rush|low priority)\b/i;

const loadManagerConfig = () => { try { return JSON.parse(localStorage.getItem("prospector_manager_config")||"null"); } catch { return null; } };

// Inject CSS keyframes once at module load (#2 pulse, #1/#9 fade)
if (typeof document !== "undefined" && !document.getElementById("tp-styles")) {
  const s = document.createElement("style");
  s.id = "tp-styles";
  s.textContent = `
    @keyframes tpPulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
    @keyframes tpFade  { from{opacity:1} to{opacity:0.35} }
  `;
  document.head.appendChild(s);
}

function SmartTaskPanel({ tasks=[], setTasks, accounts=[], activeUser, firstName="", onAccountClick }) {
  const [tab,              setTab]              = useState("work");
  const [weekExpanded,     setWeekExpanded]     = useState(false);
  const [input,            setInput]            = useState("");
  const [pendingCandidates,setPendingCandidates]= useState([]);
  const [pendingText,      setPendingText]      = useState(null);
  const [undoTask,         setUndoTask]         = useState(null);
  const [editingId,        setEditingId]        = useState(null);
  const [editDraft,        setEditDraft]        = useState("");
  const [expandedId,       setExpandedId]       = useState(null);
  const [completing,       setCompleting]       = useState(new Set());
  const [hoverId,          setHoverId]          = useState(null);
  const [activeFilters,    setActiveFilters]    = useState(new Set());
  const [nowOverflow,      setNowOverflow]      = useState(false); // expand NOW past 8
  const [laterExpanded,    setLaterExpanded]    = useState(false); // show undated tasks
  const [expandedGroups,   setExpandedGroups]   = useState(new Set()); // grouped SF spam
  const inputRef = useRef(null);

  // Normalize: any task with SF keywords gets type "Salesforce"
  const SF_TITLE_RE = /production request|security questionnaire|partner questionnaire/i;
  useEffect(() => {
    setTasks(ts => {
      const needsFix = ts.some(t => !t.personal && SF_TITLE_RE.test(t.title) && t.type !== "Salesforce");
      if (!needsFix) return ts;
      return ts.map(t =>
        !t.personal && SF_TITLE_RE.test(t.title) && t.type !== "Salesforce"
          ? {...t, type: "Salesforce"}
          : t
      );
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Migrate old personal tasks into main tasks array once
  useEffect(() => {
    try {
      const old = JSON.parse(localStorage.getItem(PERSONAL_KEY)||"[]");
      if (!old.length) return;
      const today = new Date().toISOString().split("T")[0];
      const toAdd = old.filter(t=>!t.done).map(t=>({
        id: t.id||Date.now()+Math.random(),
        title: t.text||t.title||"",
        type:"Other", accId:null, accName:null, dueDate:"",
        priority:t.priority||"Medium", assignee:firstName||"AE",
        status:"Open", pricingFileId:null, pricingFileName:null, notes:"", createdAt:today,
      }));
      if (toAdd.length) setTasks(ts=>{
        const ids=new Set(ts.map(t=>String(t.id)));
        const fresh=toAdd.filter(t=>!ids.has(String(t.id)));
        return fresh.length?[...ts,...fresh]:ts;
      });
      localStorage.removeItem(PERSONAL_KEY);
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // #10 — "T" focuses the task input when no input is active
  useEffect(() => {
    const handler = e => {
      if (e.key !== "T" || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      e.preventDefault();
      setTab("work");
      setTimeout(() => inputRef.current?.focus(), 0);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []); // eslint-disable-line

  const myName = activeUser?.name || firstName || "AE";
  const myFirst = myName.split(" ")[0];

  // ── Parsers ──────────────────────────────────────────────────────────────────
  const todayStr = new Date().toISOString().split("T")[0];
  const tomorrowStr = (() => { const d=new Date(); d.setDate(d.getDate()+1); return d.toISOString().split("T")[0]; })();

  const parseDue = (text) => {
    const lo = text.toLowerCase();
    const fmt = d => d.toISOString().split("T")[0];
    const now = new Date();
    if (/\b(eod|today|tonight)\b/.test(lo)) return todayStr;
    if (/\btomorrow\b/.test(lo)) return tomorrowStr;
    const DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    for (let i=0;i<DAYS.length;i++) {
      if (lo.includes(DAYS[i])) { const d=new Date(now); const diff=(i-d.getDay()+7)%7||7; d.setDate(d.getDate()+diff); return fmt(d); }
    }
    if (/\bnext week\b/.test(lo)) { const d=new Date(now); d.setDate(d.getDate()+7); return fmt(d); }
    if (/\bthis week\b/.test(lo)) { const d=new Date(now); const fri=5-d.getDay(); d.setDate(d.getDate()+(fri>0?fri:fri+7)); return fmt(d); }
    return "";
  };

  const mgCfg = loadManagerConfig();
  const isManager = (activeUser?.role || "AE") === "Manager";

  const parseAssignee = (text) => {
    if (/\bcasey\b|\bhave casey\b|\btell casey\b|\bassign casey\b/i.test(text)) return "Casey";
    // Manager: "assign to [name]" or "for [AE name]"
    if (isManager && mgCfg?.aes?.length) {
      const assignMatch = text.match(/\b(?:assign(?:ed)? to|for)\s+([A-Z][a-z]+)/i);
      if (assignMatch) {
        const target = assignMatch[1].toLowerCase();
        const ae = mgCfg.aes.find(a => a.name.split(" ")[0].toLowerCase() === target);
        if (ae) return ae.name.split(" ")[0];
      }
    }
    return myFirst;
  };

  const parsePriority = (text, due) => {
    if (/\b(urgent|asap|immediately|eod|critical)\b/i.test(text)) return "High";
    if (due === todayStr) return "High";
    return "Medium";
  };

  const parseType = (text) => {
    // Compliance keywords → Salesforce
    if (/\b(production request|security (review|questionnaire)|partner questionnaire)\b/i.test(text)) return "Salesforce";
    // Pricing
    if (/\b(send pricing|pricing model|proposal|quote|price)\b/i.test(text)) return "Send pricing";
    // Meeting/call
    if (/\b(prep for|call with|meeting|schedule|book|demo)\b/i.test(text)) return "Schedule call";
    if (/\bdemo\b/i.test(text)) return "Demo";
    if (/\bresearch\b|\blook into\b/i.test(text)) return "Research";
    if (/\bsalesforce\b|\bsfdc\b/i.test(text)) return "Salesforce";
    // Default follow-up
    if (/\bfollow.?up\b|\bcheck.?in\b|\bping\b|\breach out\b|\btouch base\b/i.test(text)) return "Follow up";
    return "Follow up";
  };

  // Smart due date suggestion based on type (used as hint when no date parsed)
  const suggestDue = (type) => {
    const d = new Date();
    const fmt = n => { d.setDate(d.getDate()+n); return d.toISOString().split("T")[0]; };
    if (type==="Send pricing") return { date: todayStr, label:"today" };
    if (type==="Follow up")    return { date: tomorrowStr, label:"tomorrow" };
    if (type==="Schedule call"||type==="Research") { const s=fmt(7-new Date().getDay()||7); return { date:s, label:"this week" }; }
    return null;
  };

  const NOISE = /\b(today|tonight|eod|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|this week|urgent|asap|casey|jack|follow.?up|send pricing|pricing|quote|schedule|call|book|research|demo|reach out|check.?in|ping|with|for|to|the|a|an|and|or|about|on|at|by|get|set)\b/gi;

  const fuzzyAcc = (text) => {
    const stripped = text.toLowerCase().replace(NOISE,' ').replace(/\s+/g,' ').trim();
    if (!stripped || stripped.length < 2) return { match:null, candidates:[] };
    const words = stripped.split(/\s+/).filter(w=>w.length>=2);
    if (!words.length) return { match:null, candidates:[] };
    const scored = accounts.map(a=>{
      const name = a.name.toLowerCase();
      if (name===stripped) return { acc:a, s:1.0 };
      const nameW = name.split(/\s+/);
      const hits = words.filter(w=>nameW.some(nw=>nw.startsWith(w)||w.startsWith(nw)));
      if (!hits.length) return { acc:a, s:0 };
      return { acc:a, s: hits.length/Math.max(words.length,nameW.length) };
    }).filter(x=>x.s>0.3).sort((a,b)=>b.s-a.s);
    if (!scored.length) return { match:null, candidates:[] };
    if (scored[0].s>=0.7||scored.length===1) return { match:scored[0].acc, candidates:[] };
    return { match:null, candidates:scored.slice(0,4).map(x=>x.acc) };
  };

  const buildTask = (text, acc=null, isPersonal=false) => {
    const type = isPersonal ? "Other" : parseType(text);
    const explicitDue = parseDue(text);
    const suggestion = !explicitDue && !isPersonal ? suggestDue(type) : null;
    const due = explicitDue || suggestion?.date || "";
    const assignee = isPersonal ? myFirst : parseAssignee(text);
    const fromManager = isManager && assignee !== myFirst;
    return {
      id: Date.now(),
      title: text.trim(),
      type,
      accId: acc?.id||null, accName: acc?.name||null,
      dueDate: due,
      priority: parsePriority(text, due),
      assignee,
      status: "Open",
      personal: isPersonal,
      pricingFileId:null, pricingFileName:null, notes:"",
      createdAt: todayStr,
      ...(fromManager ? { fromManager: true } : {}),
    };
  };

  const submit = () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    if (tab === "personal") {
      setTasks(ts=>[buildTask(text, null, true), ...ts]);
      setTimeout(()=>inputRef.current?.focus(), 0);
      return;
    }
    const { match, candidates } = fuzzyAcc(text);
    if (!match && candidates.length > 1) {
      setPendingText(text);
      setPendingCandidates(candidates);
      return;
    }
    setTasks(ts=>[buildTask(text, match, false), ...ts]);
    setTimeout(()=>inputRef.current?.focus(), 0);
  };

  const resolveAcc = (acc) => {
    setTasks(ts=>[buildTask(pendingText, acc), ...ts]);
    setPendingCandidates([]); setPendingText(null);
    setTimeout(()=>inputRef.current?.focus(), 0);
  };

  const markDone = (t) => {
    setCompleting(s => { const n = new Set(s); n.add(t.id); return n; });
    if (undoTask) clearTimeout(undoTask.timer);
    const timer = setTimeout(() => {
      setTasks(ts => ts.filter(x => x.id !== t.id));
      setCompleting(s => { const n = new Set(s); n.delete(t.id); return n; });
      setUndoTask(null);
    }, 3000);
    setUndoTask({ task:t, timer });
  };

  const undoDone = () => {
    if (!undoTask) return;
    clearTimeout(undoTask.timer);
    setCompleting(s => { const n = new Set(s); n.delete(undoTask.task.id); return n; });
    setTasks(ts=>[undoTask.task,...ts]);
    setUndoTask(null);
  };

  const saveEdit = (t) => {
    if (editDraft.trim() && editDraft.trim()!==t.title) {
      setTasks(ts=>ts.map(x=>x.id===t.id?{...x,title:editDraft.trim()}:x));
    }
    setEditingId(null);
  };

  // ── List helpers ─────────────────────────────────────────────────────────────
  const PRI_DOT = { High:C.red, Medium:C.orange, Low:C.dim };

  const personalCount = tasks.filter(t=>t.personal&&t.status!=="Done"&&t.status!=="done").length;

  // Split by assignee — BDR sees their own tasks; AE sees theirs with optional Casey toggle
  const allWork   = tasks.filter(t => !t.personal && t.status!=="Done" && t.status!=="done");
  const isBDRViewer = (activeUser?.role || "AE") === "BDR";
  const showCasey = activeFilters.has("casey");
  const myWork = isBDRViewer
    // BDR: show tasks explicitly assigned to them (ID-first, name fallback)
    ? allWork.filter(t =>
        (t.assignedToId && t.assignedToId === activeUser?.id) ||
        (!t.assignedToId && t.assigneeId && t.assigneeId === activeUser?.id) ||
        (!t.assignedToId && !t.assigneeId && (t.assignee||"").toLowerCase() === (activeUser?.name||"").toLowerCase())
      )
    // AE: everything not assigned to Casey
    : allWork.filter(t => (t.assignee||"").toLowerCase() !== "casey");
  const caseyWork = isBDRViewer ? [] : allWork.filter(t => (t.assignee||"").toLowerCase() === "casey");
  const viewWork  = (!isBDRViewer && showCasey) ? caseyWork : myWork;

  // AND-filters (never include casey — that's a view toggle)
  const FILTER_DEFS = [
    { id:"today",   lb:"Today",      match: t => t.dueDate === todayStr },
    { id:"overdue", lb:"Overdue",    match: t => !!(t.dueDate && t.dueDate < todayStr) },
    { id:"high",    lb:"High",       match: t => t.priority === "High" },
    { id:"sf",      lb:"Salesforce", match: t => t.type === "Salesforce" || SF_TITLE_RE.test(t.title) },
  ];

  const applyFilters = arr => {
    const andFilters = FILTER_DEFS.filter(d => activeFilters.has(d.id));
    if (!andFilters.length) return arr;
    return arr.filter(t => andFilters.every(d => d.match(t)));
  };

  const weekEnd = (() => { const d=new Date(); d.setDate(d.getDate()+7); return d.toISOString().split("T")[0]; })();

  const sortWork = arr => [...arr].sort((a,b)=>{
    const rank = t => !t.dueDate?4:t.dueDate<todayStr?0:t.dueDate===todayStr?1:t.dueDate===tomorrowStr?2:3;
    const priRank = {High:0,Medium:1,Low:2};
    const r = rank(a)-rank(b); if (r!==0) return r;
    const pr = (priRank[a.priority]||1)-(priRank[b.priority]||1); if (pr!==0) return pr;
    return (a.dueDate||"9999").localeCompare(b.dueDate||"9999");
  });

  // Buckets — NOW = overdue + today only (undated moves to LATER)
  const NOW_MAX   = 8;
  const nowAll    = sortWork(applyFilters(viewWork.filter(t => t.dueDate && t.dueDate <= todayStr)));
  const nowShown  = nowOverflow ? nowAll : nowAll.slice(0, NOW_MAX);
  const nowHidden = nowAll.length - nowShown.length;
  const weekTasks = sortWork(applyFilters(viewWork.filter(t => t.dueDate && t.dueDate > todayStr && t.dueDate <= weekEnd)));
  const laterAll  = sortWork(applyFilters(viewWork.filter(t => !t.dueDate))); // undated

  const personalTasks = tasks.filter(t => t.personal && t.status!=="Done" && t.status!=="done");
  // Work tab badge = my urgent tasks (not Casey's)
  const urgentCount = myWork.filter(t => !completing.has(t.id) && t.dueDate && t.dueDate <= todayStr).length;
  // Casey pill count
  const caseyCount = caseyWork.filter(t => !completing.has(t.id)).length;

  // Group tasks that share the same base title (3+ = collapse into one entry)
  const normGroupKey = t => {
    if (isSfTask(t)) return t.title.toLowerCase().replace(/\s+(for|at|with|–|-)\s+.+$/i,'').replace(/[:\-–]\s*.+$/,'').trim();
    return null; // only SF-type tasks get grouped
  };
  const groupTasks = arr => {
    const groups = {};
    const singles = [];
    for (const t of arr) {
      const key = normGroupKey(t);
      if (key) { if (!groups[key]) groups[key]=[]; groups[key].push(t); }
      else singles.push({ isGroup:false, t });
    }
    const result = [...singles];
    for (const [key, ts] of Object.entries(groups)) {
      if (ts.length >= 3) result.push({ isGroup:true, key, tasks:ts, baseTitle: ts[0].title.replace(/\s+(for|at|with|–|-)\s+.+$/i,'').trim() });
      else ts.forEach(t => result.push({ isGroup:false, t }));
    }
    // re-sort: groups act as if their highest-priority task
    return result;
  };

  // SF quick-link
  const isSfTask = t => t.type === "Salesforce" || SF_TITLE_RE.test(t.title);
  const sfLink = t => {
    if (t.accId) {
      const acc = accounts.find(a => a.id === t.accId);
      if (acc?.sfdcUrl) return acc.sfdcUrl;
    }
    const term = t.accName || t.title;
    return `https://your-org.lightning.force.com/lightning/search?searchTerm=${encodeURIComponent(term)}`;
  };

  const leftBorder = t => {
    if (!t.dueDate) return `3px solid ${C.brd}33`;
    if (t.dueDate < todayStr) return `3px solid ${C.red}`;
    if (t.dueDate === todayStr) return `3px solid ${C.gold}`;
    return `3px solid ${C.brd}55`;
  };

  const fmtDate = d => {
    if (!d) return "";
    if (d===todayStr) return "today";
    if (d===tomorrowStr) return "tmrw";
    return new Date(d+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"});
  };

  const assigneeAvatar = name => {
    if (!name) return "—";
    const parts = name.split(" ");
    return parts.length>=2 ? parts[0][0]+parts[1][0] : name.slice(0,2).toUpperCase();
  };

  const shiftDue = (t, days) => {
    const base = t.dueDate || todayStr;
    const d = new Date(base+"T12:00:00"); d.setDate(d.getDate()+days);
    setTasks(ts=>ts.map(x=>x.id===t.id?{...x,dueDate:d.toISOString().split("T")[0]}:x));
  };

  const toggleAssignee = (t) => {
    const next = t.assignee==="Casey" ? myFirst : "Casey";
    setTasks(ts=>ts.map(x=>x.id===t.id?{...x,assignee:next}:x));
  };

  // ── Personal category guesser ────────────────────────────────────────────────
  const guessPersonalCat = title => {
    for (const {cat, kw} of KEYWORD_CATS) if (kw.test(title)) return cat;
    return "Other";
  };

  // ── Task card renderers ───────────────────────────────────────────────────────
  const renderWorkTask = t => {
    const isEditing    = editingId===t.id;
    const isExpanded   = expandedId===t.id;
    const isCompleting = completing.has(t.id);
    const isHovered    = hoverId===t.id;
    const overdue      = t.dueDate && t.dueDate < todayStr;
    const isToday      = t.dueDate === todayStr;
    const avatar       = assigneeAvatar(t.assignee);
    const avatarC      = t.assignee==="Casey" ? C.purple : C.blue;
    const truncTitle   = t.title.length > 50 ? t.title.slice(0,47)+"…" : t.title;
    const showSf       = isSfTask(t);
    return (
      <div key={t.id}
        style={{ borderLeft:leftBorder(t), paddingLeft:8, marginBottom:3,
          opacity: isCompleting ? 0.35 : 1,
          animation: isCompleting ? "tpFade 3s ease forwards" : undefined }}
        onMouseEnter={()=>setHoverId(t.id)}
        onMouseLeave={()=>setHoverId(null)}>
        <div style={{ display:"flex", alignItems:"center", gap:5, paddingTop:3, paddingBottom:3 }}>
          <div style={{ width:6, height:6, borderRadius:"50%", background:PRI_DOT[t.priority]||C.dim, flexShrink:0,
            ...(t.priority==="High"&&!isCompleting?{animation:"tpPulse 1.5s ease-in-out infinite"}:{}) }} title={t.priority}/>
          {isEditing
            ? <input autoFocus value={editDraft}
                onChange={e=>setEditDraft(e.target.value)}
                onBlur={()=>saveEdit(t)}
                onKeyDown={e=>{ if(e.key==="Enter")saveEdit(t); if(e.key==="Escape")setEditingId(null); }}
                style={{ ...mono, flex:1, fontSize:12, padding:"1px 5px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:4, color:C.txt, outline:"none" }}/>
            : <span onClick={()=>{setEditingId(t.id);setEditDraft(t.title);}}
                style={{ flex:1, fontSize:12, cursor:"text", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                  color:isCompleting?C.dim:overdue?C.red:isToday?C.gold:C.txt,
                  textDecoration:isCompleting?"line-through":undefined }}
                title={t.title}>{truncTitle}</span>
          }
          {t.accName&&(
            <span onClick={t.accId&&onAccountClick?()=>onAccountClick(t.accId):undefined}
              style={{ ...mono, fontSize:9, color:C.orange, background:`${C.orange}12`, border:`1px solid ${C.orange}30`, borderRadius:3, padding:"1px 5px", flexShrink:0, maxWidth:64, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                cursor:t.accId&&onAccountClick?"pointer":undefined }}>{t.accName}</span>
          )}
          {t.dueDate&&<span style={{ ...mono, fontSize:9, color:overdue?C.red:isToday?C.gold:C.dim, flexShrink:0 }}>{fmtDate(t.dueDate)}</span>}
          {/* Circular avatar */}
          <div style={{ width:20, height:20, borderRadius:"50%", background:`${avatarC}20`, border:`1px solid ${avatarC}44`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, fontSize:8, color:avatarC, fontWeight:700, ...mono }}>{avatar}</div>
          {showSf&&(
            <a href={sfLink(t)} target="_blank" rel="noopener noreferrer" title="Open in Salesforce"
              style={{ fontSize:10, lineHeight:1, flexShrink:0, textDecoration:"none", color:C.blue, opacity:0.75 }}>⚡</a>
          )}
          {t.fromManager&&(
            <span style={{ ...mono, fontSize:8, color:C.gold, background:`${C.gold}14`, border:`1px solid ${C.gold}33`, borderRadius:3, padding:"1px 5px", flexShrink:0, lineHeight:"14px" }}>mgr</span>
          )}
          {/* Hover controls: snooze + expand revealed on hover */}
          {isHovered&&!isEditing&&!isCompleting&&<>
            <button onClick={e=>{e.stopPropagation();shiftDue(t,1);}}
              style={{ ...mono, fontSize:8, padding:"1px 4px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:3, cursor:"pointer", flexShrink:0, lineHeight:1 }} title="Snooze 1 day">s</button>
            <button onClick={()=>setExpandedId(isExpanded?null:t.id)}
              style={{ background:"transparent", border:"none", color:C.dim+"88", fontSize:8, cursor:"pointer", padding:"0 1px", flexShrink:0, lineHeight:1 }}>{isExpanded?"▲":"▼"}</button>
          </>}
          <button onClick={()=>markDone(t)} disabled={isCompleting} style={{ background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, fontSize:10, cursor:"pointer", padding:"1px 5px", flexShrink:0, borderRadius:3, lineHeight:1 }}>✓</button>
        </div>
        {isExpanded&&(
          <div style={{ paddingLeft:11, paddingBottom:8 }}>
            <div style={{ display:"flex", gap:5, marginBottom:6, flexWrap:"wrap" }}>
              <button onClick={()=>shiftDue(t,1)} style={{ ...mono, fontSize:9, padding:"2px 7px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:4, cursor:"pointer" }}>+1d</button>
              <button onClick={()=>shiftDue(t,7)} style={{ ...mono, fontSize:9, padding:"2px 7px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:4, cursor:"pointer" }}>+1w</button>
              <button onClick={()=>toggleAssignee(t)} style={{ ...mono, fontSize:9, padding:"2px 7px", background:`${avatarC}12`, border:`1px solid ${avatarC}33`, color:avatarC, borderRadius:4, cursor:"pointer" }}>
                → {t.assignee==="Casey"?myFirst:"Casey"}
              </button>
              {!t.dueDate&&<input type="date"
                onChange={e=>setTasks(ts=>ts.map(x=>x.id===t.id?{...x,dueDate:e.target.value}:x))}
                style={{ ...mono, fontSize:9, padding:"1px 4px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:3, color:C.mut, outline:"none", cursor:"pointer" }}/>}
              {t.dueDate&&<input type="date" value={t.dueDate}
                onChange={e=>setTasks(ts=>ts.map(x=>x.id===t.id?{...x,dueDate:e.target.value}:x))}
                style={{ ...mono, fontSize:9, padding:"1px 4px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:3, color:C.mut, outline:"none", cursor:"pointer" }}/>}
            </div>
            <textarea value={t.notes||""}
              onChange={e=>setTasks(ts=>ts.map(x=>x.id===t.id?{...x,notes:e.target.value}:x))}
              placeholder="Notes…"
              style={{ ...mono, width:"100%", fontSize:11, padding:"4px 7px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:4, color:C.txt, outline:"none", resize:"vertical", minHeight:40, boxSizing:"border-box" }}
            />
            <div style={{ display:"flex", gap:5, marginTop:4, alignItems:"center" }}>
              <span style={{ ...mono, fontSize:9, color:C.dim, background:C.bg, border:`1px solid ${C.brd}`, borderRadius:3, padding:"1px 5px" }}>{t.type||"—"}</span>
              <button onClick={()=>setTasks(ts=>ts.filter(x=>x.id!==t.id))}
                style={{ ...mono, fontSize:9, padding:"1px 6px", background:"transparent", border:`1px solid ${C.red}44`, color:C.red, borderRadius:3, cursor:"pointer", marginLeft:"auto" }}>Delete</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Render a grouped entry (3+ tasks with same base title)
  const renderGroupEntry = ({ key, tasks: gTasks, baseTitle }) => {
    const isOpen = expandedGroups.has(key);
    const allDone = gTasks.every(t => completing.has(t.id));
    return (
      <div key={key} style={{ borderLeft:`3px solid ${C.brd}44`, paddingLeft:8, marginBottom:3, opacity:allDone?0.35:1 }}>
        <div style={{ display:"flex", alignItems:"center", gap:5, paddingTop:3, paddingBottom:3 }}>
          <div style={{ width:6, height:6, borderRadius:"50%", background:C.dim, flexShrink:0 }}/>
          <span style={{ flex:1, fontSize:12, color:C.mut, cursor:"pointer" }}
            onClick={()=>setExpandedGroups(s=>{ const n=new Set(s); n.has(key)?n.delete(key):n.add(key); return n; })}>
            📋 {baseTitle} <span style={{ color:C.dim }}>({gTasks.length} accounts)</span> {isOpen?"↑":"↓"}
          </span>
          <button onClick={()=>gTasks.forEach(t=>markDone(t))}
            style={{ ...mono, fontSize:9, padding:"1px 6px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:3, cursor:"pointer", flexShrink:0 }}>✓ all</button>
        </div>
        {isOpen && gTasks.map(t => (
          <div key={t.id} style={{ display:"flex", alignItems:"center", gap:5, paddingLeft:11, paddingTop:2, paddingBottom:2, opacity:completing.has(t.id)?0.35:1 }}>
            <span style={{ flex:1, fontSize:11, color:C.dim, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{t.accName||t.title}</span>
            {t.dueDate&&<span style={{ ...mono, fontSize:9, color:t.dueDate<todayStr?C.red:C.dim, flexShrink:0 }}>{fmtDate(t.dueDate)}</span>}
            <button onClick={()=>markDone(t)} disabled={completing.has(t.id)}
              style={{ background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, fontSize:10, cursor:"pointer", padding:"1px 4px", flexShrink:0, borderRadius:3, lineHeight:1 }}>✓</button>
          </div>
        ))}
      </div>
    );
  };

  const renderEntry = entry => entry.isGroup ? renderGroupEntry(entry) : renderWorkTask(entry.t);

  const renderPersonalTask = t => {
    const cat = guessPersonalCat(t.title||"");
    const { ic } = PERSONAL_CATS[cat] || PERSONAL_CATS["Other"];
    return (
      <div key={t.id} style={{ display:"flex", alignItems:"center", gap:7, paddingTop:4, paddingBottom:4, borderBottom:`1px solid ${C.brd}11` }}>
        <span style={{ fontSize:13, flexShrink:0, lineHeight:1 }}>{ic}</span>
        <span style={{ flex:1, fontSize:12, color:C.txt, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{t.title}</span>
        <button onClick={()=>markDone(t)} style={{ background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, fontSize:10, cursor:"pointer", padding:"1px 5px", flexShrink:0, borderRadius:3, lineHeight:1 }}>✓</button>
      </div>
    );
  };

  return (
    <div style={{ flex:1, background:C.card, border:`1px solid ${C.brd}`, borderRadius:8, padding:"10px 14px", display:"flex", flexDirection:"column" }}>
      {/* Tab toggle */}
      <div style={{ display:"flex", gap:0, background:C.sur, borderRadius:5, padding:2, marginBottom:7 }}>
        <button onClick={()=>{setTab("work");setInput("");setPendingCandidates([]);setPendingText(null);}}
          style={{ flex:1, ...mono, fontSize:10, padding:"3px 0", borderRadius:4, border:"none",
            background:tab==="work"?C.card:"transparent", color:tab==="work"?C.txt:C.dim,
            cursor:"pointer", fontWeight:tab==="work"?600:400, display:"flex", alignItems:"center", justifyContent:"center", gap:4 }}>
          ☑ Work
          {urgentCount>0&&<span style={{ fontSize:9, background:C.red, color:"#fff", borderRadius:8, padding:"0 4px", lineHeight:"14px" }}>{urgentCount}</span>}
        </button>
        <button onClick={()=>{setTab("personal");setInput("");setPendingCandidates([]);setPendingText(null);}}
          style={{ flex:1, ...mono, fontSize:10, padding:"3px 0", borderRadius:4, border:"none",
            background:tab==="personal"?C.card:"transparent", color:tab==="personal"?C.txt:C.dim,
            cursor:"pointer", fontWeight:tab==="personal"?600:400, display:"flex", alignItems:"center", justifyContent:"center", gap:4 }}>
          ✦ Personal
          {personalCount>0&&<span style={{ fontSize:9, background:C.purple, color:"#fff", borderRadius:8, padding:"0 4px", lineHeight:"14px" }}>{personalCount}</span>}
        </button>
      </div>

      {/* Input */}
      <input ref={inputRef} value={input}
        onChange={e=>{ setInput(e.target.value); if(pendingCandidates.length){setPendingCandidates([]);setPendingText(null);} }}
        onKeyDown={e=>{ if(e.key==="Enter")submit(); if(e.key==="Escape"){setInput("");setPendingCandidates([]);setPendingText(null);} }}
        placeholder={tab==="personal" ? "Grocery run, book dentist, anything…" : "What needs to happen?"}
        style={{ ...mono, width:"100%", fontSize:12, padding:"6px 10px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:5, color:C.txt, outline:"none", boxSizing:"border-box", marginBottom:5 }}
      />

      {/* Disambiguation */}
      {pendingCandidates.length>0&&(
        <div style={{ display:"flex", alignItems:"center", gap:5, flexWrap:"wrap", marginBottom:5 }}>
          <span style={{ ...mono, fontSize:11, color:C.dim }}>Which account?</span>
          {pendingCandidates.map(a=>(
            <button key={a.id} onClick={()=>resolveAcc(a)}
              style={{ ...mono, fontSize:11, padding:"2px 8px", background:`${C.blue}14`, border:`1px solid ${C.blue}44`, color:C.blue, borderRadius:4, cursor:"pointer" }}>{a.name}</button>
          ))}
          <button onClick={()=>resolveAcc(null)} style={{ ...mono, fontSize:11, padding:"2px 7px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:4, cursor:"pointer" }}>None</button>
        </div>
      )}

      {/* Undo toast */}
      {undoTask&&(
        <div style={{ display:"flex", alignItems:"center", gap:8, padding:"4px 8px", marginBottom:5, background:`${C.green}10`, border:`1px solid ${C.green}30`, borderRadius:5 }}>
          <span style={{ ...mono, fontSize:11, color:C.green, flex:1 }}>Task done</span>
          <button onClick={undoDone} style={{ ...mono, fontSize:11, padding:"1px 7px", background:"transparent", border:`1px solid ${C.green}55`, color:C.green, borderRadius:4, cursor:"pointer" }}>Undo</button>
        </div>
      )}

      {/* Filter bar — work tab only */}
      {tab==="work"&&(
        <div style={{ display:"flex", gap:4, marginBottom:6, flexWrap:"wrap", alignItems:"center" }}>
          {/* Casey toggle — view switcher, not AND-filter */}
          <button onClick={()=>setActiveFilters(s=>{ const n=new Set(s); n.has("casey")?n.delete("casey"):n.add("casey"); return n; })}
            style={{ ...mono, fontSize:10, padding:"2px 8px", borderRadius:4,
              border:`1px solid ${showCasey?C.purple:caseyCount?C.brd:C.brd+"33"}`,
              background:showCasey?`${C.purple}18`:"transparent",
              color:showCasey?C.purple:caseyCount?C.dim:C.dim+"44", cursor:"pointer" }}>
            Casey{caseyCount>0?` ${caseyCount}`:""}
          </button>
          <span style={{ color:C.brd, fontSize:10 }}>·</span>
          {/* AND-filters — apply within current view */}
          {FILTER_DEFS.map(f => {
            const count = viewWork.filter(t => !completing.has(t.id) && f.match(t)).length;
            const on = activeFilters.has(f.id);
            return (
              <button key={f.id} onClick={()=>setActiveFilters(s=>{ const n=new Set(s); n.has(f.id)?n.delete(f.id):n.add(f.id); return n; })}
                style={{ ...mono, fontSize:10, padding:"2px 8px", borderRadius:4,
                  border:`1px solid ${on?C.gold:count?C.brd:C.brd+"33"}`,
                  background:on?`${C.gold}14`:"transparent",
                  color:on?C.gold:count?C.dim:C.dim+"44", cursor:"pointer" }}>
                {f.lb}{count>0?` ${count}`:""}
              </button>
            );
          })}
          {activeFilters.size>0&&(
            <button onClick={()=>setActiveFilters(new Set())}
              style={{ ...mono, fontSize:10, padding:"2px 6px", borderRadius:4, border:`1px solid ${C.brd}`, background:"transparent", color:C.dim, cursor:"pointer", marginLeft:"auto" }}>✕</button>
          )}
        </div>
      )}

      {/* Work tab — NOW / THIS WEEK / LATER */}
      {tab==="work"&&(
        <div style={{ flex:1, overflowY:"auto", minHeight:0 }}>
          {/* Casey view header */}
          {showCasey&&(
            <div style={{ ...mono, fontSize:10, color:C.purple, marginBottom:6, display:"flex", alignItems:"center", gap:6 }}>
              <span style={{ background:`${C.purple}18`, border:`1px solid ${C.purple}33`, borderRadius:4, padding:"1px 8px" }}>Casey's Tasks</span>
              {caseyCount===0&&<span style={{ color:C.dim }}>nothing assigned</span>}
            </div>
          )}
          {/* Empty states */}
          {nowAll.length===0 && weekTasks.length===0 && laterAll.length===0 && (
            viewWork.length===0
              ? <p style={{ ...mono, fontSize:12, color:C.dim, margin:0 }}>
                  {showCasey ? "Nothing assigned to Casey." : "Territory's clear — go prospect 🪙"}
                </p>
              : <p style={{ ...mono, fontSize:12, color:C.dim, margin:0 }}>No tasks match — try removing a filter.</p>
          )}

          {/* ── NOW bucket ── */}
          {nowAll.length>0&&(
            <div style={{ marginBottom:6 }}>
              <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:3, display:"flex", alignItems:"center", gap:6 }}>
                <span style={{ color:nowAll.some(t=>t.dueDate<todayStr)?C.red:C.gold }}>
                  {nowAll.some(t=>t.dueDate<todayStr)?"Overdue":"Today"} · {nowAll.length}
                </span>
              </div>
              {groupTasks(nowShown).map(renderEntry)}
              {nowHidden>0&&(
                <button onClick={()=>setNowOverflow(true)}
                  style={{ ...mono, fontSize:10, color:C.dim, background:"transparent", border:"none", cursor:"pointer", padding:"2px 0", marginTop:2 }}>
                  …and {nowHidden} more ↓
                </button>
              )}
              {nowOverflow&&nowAll.length>NOW_MAX&&(
                <button onClick={()=>setNowOverflow(false)}
                  style={{ ...mono, fontSize:10, color:C.dim, background:"transparent", border:"none", cursor:"pointer", padding:"2px 0" }}>
                  ↑ collapse
                </button>
              )}
            </div>
          )}

          {/* ── THIS WEEK bucket ── */}
          {weekTasks.length>0&&(
            <div style={{ marginBottom:6 }}>
              <button onClick={()=>setWeekExpanded(e=>!e)}
                style={{ ...mono, fontSize:9, color:C.dim, background:"transparent", border:"none", cursor:"pointer", padding:"2px 0", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:weekExpanded?3:0 }}>
                {weekExpanded?"▲":"▼"} This week · {weekTasks.length}
              </button>
              {weekExpanded&&groupTasks(weekTasks).map(renderEntry)}
            </div>
          )}

          {/* ── LATER bucket (undated) ── */}
          {laterAll.length>0&&(
            <div>
              <button onClick={()=>setLaterExpanded(e=>!e)}
                style={{ ...mono, fontSize:9, color:C.dim, background:"transparent", border:"none", cursor:"pointer", padding:"2px 0", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:laterExpanded?3:0 }}>
                {laterExpanded?"▲":"▼"} Later · {laterAll.length}
              </button>
              {laterExpanded&&groupTasks(laterAll).map(renderEntry)}
            </div>
          )}

          {/* All-clear message when now=0 but week/later have tasks */}
          {nowAll.length===0 && (weekTasks.length>0||laterAll.length>0) && (
            <div style={{ ...mono, fontSize:11, color:C.green, marginBottom:4 }}>
              Nothing due today or overdue ✓
            </div>
          )}
        </div>
      )}

      {/* Personal tab — simple emoji + text + checkbox */}
      {tab==="personal"&&(
        <div style={{ flex:1, overflowY:"auto", minHeight:0 }}>
          {personalTasks.length===0&&<p style={{ ...mono, fontSize:12, color:C.dim, margin:0 }}>No personal tasks.</p>}
          {personalTasks.map(renderPersonalTask)}
        </div>
      )}
    </div>
  );
}

// ─── Task Modal ────────────────────────────────────────────────────────────────
const TASK_TYPES     = ["Follow up","Send pricing","Schedule call","Research","Demo","Salesforce","Other"];
const TASK_PRIORITY  = [{ val:"High", col:"#E05252" },{ val:"Medium", col:"#E09A52" },{ val:"Low", col:"#888" }];
const TASK_STATUSES  = ["Open","In progress","Done"];
const TASK_ASSIGNEES = ["AE","BDR"];

function TaskModal({ task={}, accounts=[], onSave, onClose }) {
  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({
    title:          task.title || "",
    accId:          task.accId || null,
    accName:        task.accName || "",
    type:           task.type || "Follow up",
    dueDate:        task.dueDate || "",
    priority:       task.priority || "Medium",
    assignee:       task.assignee || "AE",
    status:         task.status || "Open",
    pricingFileId:  task.pricingFileId || null,
    pricingFileName:task.pricingFileName || null,
    notes:          task.notes || "",
  });
  const upd = patch => setForm(f=>({...f,...patch}));
  const [accSearch, setAccSearch] = useState(task.accName||"");
  const [showAccDrop, setShowAccDrop] = useState(false);
  const [pricingSnaps, setPricingSnaps] = useState([]);

  useEffect(()=>{
    if(form.type==="Send pricing"&&form.accId){
      try{ setPricingSnaps((JSON.parse(localStorage.getItem("prospector_pricing_snapshots")||"{}")[form.accId])||[]); }catch{ setPricingSnaps([]); }
    } else setPricingSnaps([]);
  },[form.type,form.accId]);

  const accSuggestions = accSearch.trim()
    ? accounts.filter(a=>a.name.toLowerCase().includes(accSearch.toLowerCase())).slice(0,8)
    : accounts.slice(0,8);

  const save = () => {
    if(!form.title.trim()) return;
    onSave({ ...task, ...form, id: task.id||Date.now(), createdAt: task.createdAt||today });
  };

  const priCol = TASK_PRIORITY.find(p=>p.val===form.priority)?.col || "#888";

  return (
    <div onClick={e=>{if(e.target===e.currentTarget)onClose();}}
      style={{ position:"fixed", inset:0, zIndex:1000, background:"#00000099", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ background:C.card, border:`1px solid ${C.brd}`, borderRadius:12, padding:"22px 26px", width:480, maxHeight:"90vh", overflowY:"auto", boxShadow:"0 20px 60px #000c" }}>
        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", marginBottom:18 }}>
          <span style={{ ...mono, fontSize:14, color:C.txt, fontWeight:700 }}>{task.id?"Edit task":"New task"}</span>
          <button onClick={onClose} style={{ marginLeft:"auto", background:"transparent", border:"none", color:C.mut, fontSize:18, cursor:"pointer", lineHeight:1 }}>✕</button>
        </div>

        {/* Title */}
        <div style={{ marginBottom:14 }}>
          <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:5 }}>Title</div>
          <input autoFocus value={form.title} onChange={e=>upd({title:e.target.value})} onKeyDown={e=>e.key==="Enter"&&save()}
            placeholder="What needs to happen…"
            style={{ ...mono, width:"100%", boxSizing:"border-box", fontSize:13, padding:"8px 11px", background:C.bg, border:`1.5px solid ${C.brdM}`, borderRadius:6, color:C.txt, outline:"none" }}
          />
        </div>

        {/* Type */}
        <div style={{ marginBottom:14 }}>
          <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:5 }}>Type</div>
          <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
            {TASK_TYPES.map(t=>(
              <button key={t} onClick={()=>upd({type:t,pricingFileId:null,pricingFileName:null})}
                style={{ ...mono, fontSize:11, padding:"4px 10px", borderRadius:5, border:`1px solid ${form.type===t?C.gold:C.brd}`, background:form.type===t?`${C.gold}18`:"transparent", color:form.type===t?C.gold:C.mut, cursor:"pointer" }}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Account */}
        <div style={{ marginBottom:14 }}>
          <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:5 }}>Account</div>
          <div style={{ position:"relative" }}>
            <input value={accSearch} onChange={e=>{setAccSearch(e.target.value);upd({accId:null,accName:""});setShowAccDrop(true);}}
              onFocus={()=>setShowAccDrop(true)} onBlur={()=>setTimeout(()=>setShowAccDrop(false),150)}
              placeholder="Search accounts…"
              style={{ ...mono, width:"100%", boxSizing:"border-box", fontSize:12, padding:"7px 11px", background:C.bg, border:`1.5px solid ${form.accId?C.orange+"88":C.brdM}`, borderRadius:6, color:form.accId?C.orange:C.txt, outline:"none" }}
            />
            {showAccDrop && accSuggestions.length>0 && (
              <div style={{ position:"absolute", top:"calc(100%+3px)", left:0, right:0, zIndex:99, background:C.card, border:`1px solid ${C.brd}`, borderRadius:6, boxShadow:"0 6px 18px #0009", marginTop:2 }}>
                {accSuggestions.map(a=>(
                  <div key={a.id} onMouseDown={()=>{upd({accId:a.id,accName:a.name});setAccSearch(a.name);setShowAccDrop(false);}}
                    style={{ padding:"6px 11px", fontSize:12, cursor:"pointer", color:C.txt, borderBottom:`1px solid ${C.brd}22` }}
                    onMouseEnter={e=>e.currentTarget.style.background=`${C.gold}10`}
                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <span style={{ ...mono, fontWeight:600 }}>{a.name}</span>
                    {a.vert&&<span style={{ ...mono, fontSize:10, color:C.mut, marginLeft:8 }}>{a.vert}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Pricing file — only if type=Send pricing and account set */}
        {form.type==="Send pricing" && form.accId && (
          <div style={{ marginBottom:14 }}>
            <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:5 }}>Pricing file</div>
            {pricingSnaps.length===0
              ? <span style={{ ...mono, fontSize:11, color:C.dim }}>No saved pricing files for this account — save one from the Pricing Calculator</span>
              : <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                  {pricingSnaps.map(s=>(
                    <button key={s.id} onClick={()=>upd({pricingFileId:s.id,pricingFileName:s.name})}
                      style={{ ...mono, fontSize:11, padding:"4px 10px", borderRadius:5, border:`1px solid ${form.pricingFileId===s.id?C.gold:C.brd}`, background:form.pricingFileId===s.id?`${C.gold}18`:"transparent", color:form.pricingFileId===s.id?C.gold:C.mut, cursor:"pointer" }}>
                      {s.name} <span style={{ color:C.dim }}>· {s.savedAt}</span>
                    </button>
                  ))}
                </div>
            }
          </div>
        )}

        {/* Due date + Priority row */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:14 }}>
          <div>
            <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:5 }}>Due date</div>
            <input type="date" value={form.dueDate} min={today} onChange={e=>upd({dueDate:e.target.value})}
              style={{ ...mono, width:"100%", boxSizing:"border-box", fontSize:12, padding:"7px 10px", background:C.bg, border:`1.5px solid ${C.brdM}`, borderRadius:6, color:form.dueDate?C.txt:C.dim, outline:"none", colorScheme:"dark" }}
            />
          </div>
          <div>
            <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:5 }}>Priority</div>
            <div style={{ display:"flex", gap:5 }}>
              {TASK_PRIORITY.map(p=>(
                <button key={p.val} onClick={()=>upd({priority:p.val})}
                  style={{ ...mono, flex:1, fontSize:11, padding:"6px 4px", borderRadius:5, border:`1px solid ${form.priority===p.val?p.col:C.brd}`, background:form.priority===p.val?p.col+"22":"transparent", color:form.priority===p.val?p.col:C.dim, cursor:"pointer" }}>
                  {p.val}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Assignee + Status row */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:14 }}>
          <div>
            <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:5 }}>Assignee</div>
            <div style={{ display:"flex", gap:5 }}>
              {TASK_ASSIGNEES.map(a=>(
                <button key={a} onClick={()=>upd({assignee:a})}
                  style={{ ...mono, flex:1, fontSize:12, padding:"6px 4px", borderRadius:5, border:`1px solid ${form.assignee===a?C.blue:C.brd}`, background:form.assignee===a?`${C.blue}22`:"transparent", color:form.assignee===a?C.blue:C.dim, cursor:"pointer" }}>
                  {a}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:5 }}>Status</div>
            <div style={{ display:"flex", gap:5 }}>
              {TASK_STATUSES.map(s=>(
                <button key={s} onClick={()=>upd({status:s})}
                  style={{ ...mono, flex:1, fontSize:10, padding:"6px 2px", borderRadius:5, border:`1px solid ${form.status===s?C.green:C.brd}`, background:form.status===s?`${C.green}22`:"transparent", color:form.status===s?C.green:C.dim, cursor:"pointer" }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Notes */}
        <div style={{ marginBottom:18 }}>
          <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:5 }}>Notes (optional)</div>
          <textarea value={form.notes} onChange={e=>upd({notes:e.target.value})} rows={3} placeholder="Any context…"
            style={{ ...mono, width:"100%", boxSizing:"border-box", fontSize:12, padding:"7px 11px", background:C.bg, border:`1.5px solid ${C.brdM}`, borderRadius:6, color:C.txt, outline:"none", resize:"vertical", fontFamily:"inherit" }}
          />
        </div>

        {/* Footer */}
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
          <button onClick={onClose} style={{ ...mono, fontSize:12, padding:"7px 16px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:6, color:C.mut, cursor:"pointer" }}>Cancel</button>
          <button onClick={save} disabled={!form.title.trim()}
            style={{ ...mono, fontSize:12, padding:"7px 18px", background:form.title.trim()?C.gold:"transparent", border:`1px solid ${form.title.trim()?C.gold:C.brd}`, borderRadius:6, color:form.title.trim()?C.bg:C.dim, cursor:form.title.trim()?"pointer":"default", fontWeight:700 }}>
            {task.id?"Save changes":"Create task"}
          </button>
        </div>
      </div>
    </div>
  );
}

export { TYPE_IC, TaskModal, PERSONAL_KEY, PERSONAL_CATS, KEYWORD_CATS, HIGH_PRI_RE, LOW_PRI_RE };
export default SmartTaskPanel;
