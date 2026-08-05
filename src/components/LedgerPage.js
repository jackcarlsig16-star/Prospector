import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { C, mono, TS } from '../constants/colors';
import { DndContext, useDraggable, useDroppable, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { getDealStageLabel, DEAL_STAGES } from '../utils/stageMap';
import { daysSinceIso } from '../utils/dates';
import { loadManagerConfig } from './ManagerCommandCenter';
import { getACV, getForecastSummary, defaultClosePct, projectedCloseDate, getCurrentQuarter, getQuarterStart, getQuarterEnd, isCurrentQuarter } from '../utils/ledgerEngine';
import { inferCloseProbability, inferDealStage, logScore } from '../utils/scoringEngine';
import { runPathToCloseUpdate } from '../utils/pathToClose';
import PacingChart from './ledger/PacingChart';
import ForecastGapChart from './ForecastGapChart';
import ClosedWonAuditModal from './ledger/ClosedWonAuditModal';
import ScoutModal from './ledger/ScoutModal';
import PipelineReviewModal from './PipelineReviewModal';
import DealTimeline from './DealTimeline';
import IntelligenceRadar from './IntelligenceRadar';
import { MODELS } from '../config/models';
import { fetchSentEmailsForAccount, buildNsPrompt } from '../utils/nsCopy';
import { FORECAST_CATS, getEffectiveForecastCat } from '../utils/forecastUtils';

const SF_BASE_AC = "https://your-org.lightning.force.com/lightning/r/Account/";
const toSfdcUrl = v => {
  if (!v || !v.trim()) return null;
  if (v.startsWith("http")) return v.trim();
  if (/^001[A-Za-z0-9]{12,15}$/.test(v.trim())) return `${SF_BASE_AC}${v.trim()}/view`;
  return null;
};

const FORECAST_C = { 'Commit': '#22c55e', 'Best Case': '#f59e0b', 'Pipeline': '#3b82f6', 'Omit': '#555' };

// ── Formatting helpers ────────────────────────────────────────────────────────
const fmtAcv = (v) => {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (isNaN(n)) return "—";
  return "$" + Math.round(n).toLocaleString();
};

const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
};

const nextQLabel = () => {
  const q = getCurrentQuarter();
  const n = parseInt(q[1]) % 4 + 1;
  const yr = String(n === 1 ? new Date().getFullYear() + 1 : new Date().getFullYear()).slice(2);
  return `Q${n} '${yr}`;
};

const fmtProjDate = (d) => {
  if (!d) return "—";
  const qEnd = getQuarterEnd(getCurrentQuarter());
  if (d > qEnd) return nextQLabel();
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[d.getMonth()]} ${d.getDate()}`;
};

const fmtProjMonth = (d) => {
  if (!d) return "—";
  const qEnd = getQuarterEnd(getCurrentQuarter());
  if (d > qEnd) return nextQLabel();
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const yr = String(d.getFullYear()).slice(2);
  return `~${months[d.getMonth()]} '${yr}`;
};

const getLastTouch = (acc) => {
  const callDate = acc.calls?.length ? acc.calls[acc.calls.length - 1]?.date : null;
  return callDate || acc.last || null;
};

const getDaysInStage = (acc) => daysSinceIso(acc.activeDealAt);

function getEstClose(acc) {
  const days = acc.dealTimeline?.predictions?.days_to_signature;
  if (days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  if (acc.dealTimeline?.estimatedCloseDateRange) return acc.dealTimeline.estimatedCloseDateRange;
  return null;
}

const getDealStageDisplay = (acc) => {
  if (acc.dealStage) {
    const lbl = getDealStageLabel(acc.dealStage);
    if (lbl) return lbl;
  }
  return acc.stage || "—";
};

const QUARTER_MONTHS = { Q1:[0,1,2], Q2:[3,4,5], Q3:[6,7,8], Q4:[9,10,11] };

const projDateColor = (d) => {
  if (!d) return C.dim;
  const now = new Date();
  const currentQ = getCurrentQuarter();
  const qMonths = QUARTER_MONTHS[currentQ];
  const nextQIdx = parseInt(currentQ[1]) % 4 + 1;
  const nextQMonths = QUARTER_MONTHS[`Q${nextQIdx}`] || QUARTER_MONTHS.Q1;
  const m = d.getMonth();
  const yr = d.getFullYear();
  const nowYr = now.getFullYear();
  if (yr === nowYr && qMonths.includes(m)) return "#22c55e";
  if ((yr === nowYr && nextQMonths.includes(m)) || (yr === nowYr + 1 && nextQMonths.includes(m))) return "#f59e0b";
  return "#ef4444";
};

const STAGE_COLORS = {
  qualify:            "#555",
  discovery:          "#4a6fa5",
  evaluation:         "#3b82f6",
  mutual_alignment:   "#8b5cf6",
  negotiation:        "#f59e0b",
  contract_execution: "#22c55e",
  closed_won:         "#4ade80",
};

const loadPrefs = () => { try { return JSON.parse(localStorage.getItem("prospector_prefs") || "{}"); } catch { return {}; } };

// ── Deal quality classifier ───────────────────────────────────────────────────
const MEDPICC_FIELDS = ['metrics','economic_buyer','decision_criteria','decision_process','identify_pain','champion','competition'];

function classifyDeal(acc) {
  const rawScore = inferCloseProbability(acc);
  const closePct = acc.closeProbability ?? rawScore?.probability ?? 25;
  const daysSinceTouch = daysSinceIso(acc.last) ?? 999;
  const daysInStage = daysSinceIso(acc.activeDealAt) ?? 0;
  const medpiccFilled = MEDPICC_FIELDS.filter(f => acc.medpicc?.[f]?.trim().length > 10).length;
  const callCount = acc.calls?.length || 0;
  const missingEB = !acc.medpicc?.economic_buyer || acc.medpicc.economic_buyer.trim().length < 10;
  const missingChampion = !acc.medpicc?.champion || acc.medpicc.champion.trim().length < 10;
  const isPyrite = callCount >= 3 && missingEB && missingChampion && closePct < 50;

  if (!isPyrite && closePct >= 50 && (daysSinceTouch <= 21 || medpiccFilled >= 3)) return 'green';
  if (isPyrite || closePct < 20 || daysSinceTouch > 45 || daysInStage > 90) return 'red';
  return 'yellow';
}

function calcHealthScore(acc, tasks) {
  let score = 10;
  const daysSinceTouch = daysSinceIso(acc.last) ?? 999;
  if (daysSinceTouch > 30) score -= 3;
  else if (daysSinceTouch > 14) score -= 1;
  const medpiccFilled = MEDPICC_FIELDS.filter(f => acc.medpicc?.[f]?.trim().length > 10).length;
  if (medpiccFilled < 3) score -= 2;
  else if (medpiccFilled < 5) score -= 1;
  const hasOverdue = tasks.some(t =>
    t.accId === acc.id && t.status === 'Open' &&
    t.dueDate && new Date(t.dueDate) < new Date()
  );
  if (hasOverdue) score -= 2;
  const daysInStage = daysSinceIso(acc.activeDealAt) ?? 0;
  if (daysInStage > 60) score -= 2;
  else if (daysInStage > 30) score -= 1;
  try {
    const allCompliance = JSON.parse(localStorage.getItem('prospector_compliance') || '{}');
    const comp = allCompliance[acc.id];
    const prStatus = comp?.steps?.find?.(s => s.id === 'prod_request')?.status || 'Not Started';
    if (prStatus === 'Not Started' && daysInStage > 14) score -= 1;
  } catch {}
  return Math.max(1, Math.min(10, score));
}

const QUALITY_COLORS = { green: '#4ade80', yellow: '#fbbf24', red: '#f87171' };
const QUALITY_LABELS = { green: 'Rich Vein', yellow: 'Mixed Ore', red: 'Dry Shaft' };

// ── Deal Quality Pie (pure SVG donut) ─────────────────────────────────────────
function DealQualityPie({ dealQuality, activeFilter, onFilter }) {
  const [hovered, setHovered] = useState(null);

  const data = [
    { key: 'green',  label: 'Rich Vein', value: dealQuality.green.length },
    { key: 'yellow', label: 'Mixed Ore', value: dealQuality.yellow.length },
    { key: 'red',    label: 'Dry Shaft', value: dealQuality.red.length },
  ].filter(d => d.value > 0);

  const total = data.reduce((s, d) => s + d.value, 0);

  const CX = 65, CY = 65, RO = 58, RI = 36;
  const GAP_DEG = 3;
  const toRad = deg => (deg * Math.PI) / 180;
  const polar = (cx, cy, r, deg) => ({ x: cx + r * Math.cos(toRad(deg)), y: cy + r * Math.sin(toRad(deg)) });

  let angle = -90;
  const segments = data.map(d => {
    const sweep = (d.value / total) * 360 - GAP_DEG;
    const seg = { ...d, start: angle, end: angle + sweep };
    angle += sweep + GAP_DEG;
    return seg;
  });

  const arc = (seg) => {
    const s1 = polar(CX, CY, RO, seg.start); const e1 = polar(CX, CY, RO, seg.end);
    const s2 = polar(CX, CY, RI, seg.end);   const e2 = polar(CX, CY, RI, seg.start);
    const lg = seg.end - seg.start > 180 ? 1 : 0;
    return `M${s1.x} ${s1.y} A${RO} ${RO} 0 ${lg} 1 ${e1.x} ${e1.y} L${s2.x} ${s2.y} A${RI} ${RI} 0 ${lg} 0 ${e2.x} ${e2.y}Z`;
  };

  const centreKey = hovered || activeFilter;
  const centreCount = centreKey ? dealQuality[centreKey].length : total;
  const centreLabel = centreKey ? QUALITY_LABELS[centreKey] : 'deals';

  if (total === 0) return <div style={{ ...mono, fontSize: 11, color: '#444', padding: '20px 8px' }}>No active deals</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width={130} height={130}>
        {segments.map(seg => (
          <path key={seg.key} d={arc(seg)}
            fill={QUALITY_COLORS[seg.key]}
            opacity={activeFilter && activeFilter !== seg.key ? 0.22 : 1}
            stroke={activeFilter === seg.key ? '#fff' : '#0a0a0a'}
            strokeWidth={activeFilter === seg.key ? 2 : 1}
            style={{ cursor: 'pointer', transition: 'opacity 0.15s' }}
            onClick={() => onFilter(activeFilter === seg.key ? null : seg.key)}
            onMouseEnter={() => setHovered(seg.key)}
            onMouseLeave={() => setHovered(null)}
          />
        ))}
        <text x={CX} y={CY - 5} textAnchor="middle" fill="#ccc" style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 600 }}>{centreCount}</text>
        <text x={CX} y={CY + 11} textAnchor="middle" fill="#555" style={{ fontFamily: 'monospace', fontSize: 9 }}>{centreLabel}</text>
      </svg>
      <div style={{ display: 'flex', gap: 8, marginTop: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
        {data.map(d => (
          <div key={d.key} onClick={() => onFilter(activeFilter === d.key ? null : d.key)}
            style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', opacity: activeFilter && activeFilter !== d.key ? 0.3 : 1, transition: 'opacity 0.15s' }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: QUALITY_COLORS[d.key], flexShrink: 0 }} />
            <span style={{ ...mono, fontSize: 10, color: '#aaa' }}>{d.label} ({d.value})</span>
          </div>
        ))}
      </div>
      {activeFilter && (
        <div style={{ marginTop: 5, ...mono, fontSize: 10, color: '#666' }}>
          {QUALITY_LABELS[activeFilter]} ·{' '}
          <span onClick={() => onFilter(null)} style={{ color: QUALITY_COLORS.green, cursor: 'pointer' }}>Clear</span>
        </div>
      )}
    </div>
  );
}
const savePrefs = (patch) => {
  try {
    const p = loadPrefs();
    localStorage.setItem("prospector_prefs", JSON.stringify({ ...p, ...patch }));
  } catch {}
};

// ── Drag handle ────────────────────────────────────────────────────────────────
function DragHandle({ id }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });
  return (
    <span
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ cursor: isDragging ? "grabbing" : "grab", color: C.dim, fontSize: 14, lineHeight: 1, padding: "0 4px", userSelect: "none", opacity: isDragging ? 0.4 : 0.6, flexShrink: 0 }}
    >⠿</span>
  );
}

function DropZone({ id, children }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} style={{ position: "relative" }}>
      {isOver && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "#f59e0b", borderRadius: 1, zIndex: 10 }} />}
      {children}
    </div>
  );
}

// ── Inline editable cell ──────────────────────────────────────────────────────
function EditCell({ value, onSave, format, placeholder = "—", style = {} }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const commit = () => {
    const v = draft.trim();
    onSave(v === "" ? null : Number(v.replace(/[$,%]/g, "")) || null);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        style={{ ...mono, fontSize: 12, width: "100%", maxWidth: 80, background: C.sur, border: `1px solid ${C.gold}66`, color: C.txt, outline: "none", borderRadius: 3, padding: "1px 4px", textAlign: "right" }}
      />
    );
  }

  return (
    <span
      onClick={() => { setDraft(value != null ? String(value) : ""); setEditing(true); }}
      title="Click to edit"
      style={{ cursor: "text", borderBottom: `1px dashed ${C.brd}`, paddingBottom: 1, ...style }}
    >
      {value != null ? format(value) : <span style={{ color: C.dim }}>{placeholder}</span>}
    </span>
  );
}

// ── Inline quota input ────────────────────────────────────────────────────────
function QuotaInput({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const commit = () => {
    const n = Number(String(draft).replace(/[$,]/g, ""));
    onSave(isNaN(n) || n <= 0 ? null : n);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        placeholder="e.g. 300000"
        style={{ ...mono, fontSize: 15, fontWeight: 600, width: 110, background: "transparent", border: `1px solid ${C.gold}55`, color: C.txt, outline: "none", borderRadius: 3, padding: "1px 6px" }}
      />
    );
  }

  return (
    <span
      onClick={() => { setDraft(value != null ? String(value) : ""); setEditing(true); }}
      style={{ ...mono, fontSize: 15, fontWeight: 600, color: C.txt, cursor: "text", borderBottom: `1px dashed ${C.brd}`, paddingBottom: 1 }}
    >
      {value != null ? fmtAcv(value) : <span style={{ color: C.dim }}>Set quota</span>}
    </span>
  );
}

// ── Notes tooltip ─────────────────────────────────────────────────────────────
function NotesIndicator({ acc }) {
  const [show, setShow] = useState(false);
  const ref = useRef(null);

  const snippet = (() => {
    if (acc.calls?.length) {
      const last = acc.calls[acc.calls.length - 1];
      const text = last.summary || last.notes || "";
      if (text) return text.slice(0, 100) + (text.length > 100 ? "…" : "");
    }
    if (acc.notes) return acc.notes.slice(0, 100) + (acc.notes.length > 100 ? "…" : "");
    return null;
  })();

  if (!snippet) return null;

  return (
    <span
      ref={ref}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      style={{ position: "relative", cursor: "default", fontSize: 12, opacity: 0.6, flexShrink: 0 }}
    >
      📝
      {show && (
        <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)", background: "#1a1a1a", border: "1px solid #333", borderRadius: 5, padding: "7px 10px", width: 220, zIndex: 200, pointerEvents: "none" }}>
          <p style={{ ...mono, fontSize: 11, color: "#ccc", margin: 0, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{snippet}</p>
        </div>
      )}
    </span>
  );
}

// ── Inline stage selector ─────────────────────────────────────────────────────
function StageCell({ stageId, inferred, onSave }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <span
        onClick={() => setOpen(o => !o)}
        title="Click to change stage"
        style={{
          ...mono, fontSize: 10, cursor: 'pointer',
          color: STAGE_COLORS[stageId] || '#555',
          background: `${STAGE_COLORS[stageId] || '#555'}18`,
          border: `1px solid ${STAGE_COLORS[stageId] || '#555'}44`,
          borderRadius: 3, padding: '1px 6px', whiteSpace: 'nowrap', flexShrink: 0,
          borderBottom: `1px dashed ${STAGE_COLORS[stageId] || C.brd}`,
        }}
      >
        {inferred ? '~' : ''}{getDealStageLabel(stageId) || stageId}
      </span>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 50, marginTop: 2, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 5, boxShadow: '0 4px 16px #00000044', minWidth: 160, overflow: 'hidden' }}>
          {DEAL_STAGES.map(s => (
            <div key={s.id}
              onClick={() => { onSave(s.id); setOpen(false); }}
              style={{ padding: '6px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, background: s.id === stageId ? `${STAGE_COLORS[s.id] || '#555'}18` : 'transparent' }}
              onMouseEnter={e => e.currentTarget.style.background = `${STAGE_COLORS[s.id] || '#555'}22`}
              onMouseLeave={e => e.currentTarget.style.background = s.id === stageId ? `${STAGE_COLORS[s.id] || '#555'}18` : 'transparent'}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: STAGE_COLORS[s.id] || '#555', flexShrink: 0 }}/>
              <span style={{ ...mono, fontSize: 11, color: s.id === stageId ? STAGE_COLORS[s.id] : C.txt }}>{s.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Sortable column header — module-level so React never remounts it ──────────
function Th({ col, children, style = {}, align = "left", baseColor = C.dim, sortCol, sortDir, onSort }) {
  const active = sortCol === col;
  const col_ = active ? (baseColor === C.dim ? C.txt : baseColor) : baseColor === C.dim ? C.dim : baseColor + '88';
  return (
    <span onClick={() => onSort(col)} style={{ ...mono, fontSize: 10, color: col_, textTransform: "uppercase", letterSpacing: "0.06em", cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", gap: 3, justifyContent: align === "right" ? "flex-end" : "flex-start", ...style }}>
      {children}
      <span style={{ fontSize: 9, color: active ? col_ : "#2a2a2a", lineHeight: 1, flexShrink: 0 }}>{active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function LedgerPage({ accounts, setAccounts, teamUsers = [], activeUser = {}, tasks = [], winsLog = [], setWinsLog, managerSelectedAeId = null }) {
  const isManager = activeUser?.role === "Manager";
  const managerConfig = useMemo(() => isManager ? loadManagerConfig() : null, [isManager]);
  const mgAeIds = useMemo(() => new Set((managerConfig?.aes || []).map(a => a.id)), [managerConfig]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [activeId,      setActiveId]      = useState(null);
  const [showProjClose, setShowProjClose] = useState(false);
  const [prefs,         setPrefsState]    = useState(loadPrefs);
  const [copied,        setCopied]        = useState(false);
  const [auditOpen,     setAuditOpen]     = useState(false);
  const [showPipelineReview, setShowPipelineReview] = useState(false);
  const [qFilter,       setQFilter]       = useState("All");
  const [qualityFilter, setQualityFilter] = useState(null);
  const [autoScores,    setAutoScores]    = useState({});
  const [hoverRecalc,   setHoverRecalc]   = useState(null);
  const [ptcUpdating,   setPtcUpdating]   = useState(false);
  const [copiedNsId,    setCopiedNsId]    = useState(null);
  const [nsLoadingId,   setNsLoadingId]   = useState(null);
  const [sortCol,       setSortCol]       = useState(null); // null = manual rank
  const [sortDir,       setSortDir]       = useState('asc');
  const [timelineDrawerAcc, setTimelineDrawerAcc] = useState(null);
  const [summaryLoading,    setSummaryLoading]    = useState(false);
  const [summaryCopied,     setSummaryCopied]     = useState(false);
  const [scoutOpen,         setScoutOpen]         = useState(false);

  // Auto-score on accounts change
  useEffect(() => {
    const scores = {};
    accounts.filter(a => a.stage === "Active Deal").forEach(a => { scores[a.id] = inferCloseProbability(a); });
    setAutoScores(scores);
  }, [accounts]);

  // Path to close — run once on mount with 2s delay
  useEffect(() => {
    const timer = setTimeout(() => {
      runPathToCloseUpdate(accounts, setAccounts);
    }, 2000);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-clear copy flags — cleanup prevents stale setState on unmount
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  useEffect(() => {
    if (!copiedNsId) return;
    const t = setTimeout(() => setCopiedNsId(null), 2000);
    return () => clearTimeout(t);
  }, [copiedNsId]);
  useEffect(() => {
    if (!summaryCopied) return;
    const t = setTimeout(() => setSummaryCopied(false), 2500);
    return () => clearTimeout(t);
  }, [summaryCopied]);

  const onSort = useCallback((col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  }, [sortCol]);

  const currentQ    = getCurrentQuarter();
  const quota       = (prefs.quota || {})[currentQ] || null;
  const qStart      = getQuarterStart(currentQ);
  const qEnd        = getQuarterEnd(currentQ);
  const qtdWinsLog  = winsLog.filter(w => isCurrentQuarter(w.closedAt));
  const activeDeals = useMemo(() => accounts.filter(a => a.stage === "Active Deal"), [accounts]);

  const dealQuality = useMemo(() => {
    const buckets = { green: [], yellow: [], red: [] };
    activeDeals.forEach(acc => buckets[classifyDeal(acc)].push(acc));
    return buckets;
  }, [activeDeals]);

  const saveQuota = (val) => {
    const newPrefs = { ...prefs, quota: { ...(prefs.quota || {}), [currentQ]: val } };
    setPrefsState(newPrefs);
    savePrefs({ quota: newPrefs.quota });
  };

  const handleRefreshInsights = async () => {
    localStorage.removeItem("prospector_ptc_last_run");
    setPtcUpdating(true);
    await runPathToCloseUpdate(accounts, setAccounts, true);
    setPtcUpdating(false);
  };

  const rows = useMemo(() => {
    let r = accounts.filter(a => a.stage === "Active Deal");
    if (isManager && mgAeIds.size > 0) r = r.filter(a => mgAeIds.has(a.aeId));
    if (managerSelectedAeId && managerSelectedAeId !== 'all') r = r.filter(a => a.aeId === managerSelectedAeId);

    r = [...r].sort((a, b) => {
      const aRank = a.ledgerRank ?? Infinity;
      const bRank = b.ledgerRank ?? Infinity;
      if (aRank !== bRank) return aRank - bRank;
      const aDate = a.activeDealAt ? new Date(a.activeDealAt).getTime() : 0;
      const bDate = b.activeDealAt ? new Date(b.activeDealAt).getTime() : 0;
      return bDate - aDate;
    });

    const total = r.length;
    return r.map((a, i) => {
      const rank = i + 1;
      const acv = getACV(a);
      const fromPricing = a.acvOverride == null && acv != null;
      const isManual = a.closeProbabilitySource === "manual" && a.closeProbability != null;
      const engineScore = autoScores[a.id];
      const isAutoProb = !isManual;
      const prob = isManual
        ? a.closeProbability
        : (engineScore?.probability ?? defaultClosePct(rank, total, a.dealStage));
      const weighted = acv != null ? acv * (prob / 100) : null;
      const projClose = projectedCloseDate(a);
      const displayStageId = a.dealStage || inferDealStage(a);
      const isInferredStage = !a.dealStage;
      const today = new Date().toISOString().split('T')[0];
      const nextAction = tasks
        .filter(t => t.accId === a.id && t.owner === 'AE' && t.status !== 'Done')
        .sort((x, y) => (x.dueDate || 'zzzz').localeCompare(y.dueDate || 'zzzz'))[0] || null;
      const effectiveForecastCat = getEffectiveForecastCat(prob, a.forecastCategory || null);
      return { acc: a, rank, acv, fromPricing, prob, isAutoProb, engineScore, weighted, projClose, displayStageId, isInferredStage, nextAction, effectiveForecastCat, today };
    });
  }, [accounts, isManager, mgAeIds, autoScores, managerSelectedAeId]);

  const qFilteredRows = qFilter === "All"
    ? rows
    : rows.filter(r => r.projClose && QUARTER_MONTHS[qFilter].includes(r.projClose.getMonth()));

  const qualityIds = qualityFilter ? new Set(dealQuality[qualityFilter].map(a => a.id)) : null;
  const filteredRows = qualityIds ? qFilteredRows.filter(r => qualityIds.has(r.acc.id)) : qFilteredRows;

  const sortedRows = useMemo(() => {
    if (!sortCol) return filteredRows;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filteredRows].sort((a, b) => {
      switch (sortCol) {
        case 'account':  return dir * (a.acc.name||'').localeCompare(b.acc.name||'');
        case 'forecast': return dir * (FORECAST_CATS.indexOf(a.effectiveForecastCat) - FORECAST_CATS.indexOf(b.effectiveForecastCat));
        case 'stage':    return dir * (a.displayStageId||'').localeCompare(b.displayStageId||'');
        case 'acv':      return dir * ((a.acv ?? -1) - (b.acv ?? -1));
        case 'prob':     return dir * ((a.prob ?? -1) - (b.prob ?? -1));
        case 'weighted': return dir * ((a.weighted ?? -1) - (b.weighted ?? -1));
        case 'touch': {
          const ta = getLastTouch(a.acc) || ''; const tb = getLastTouch(b.acc) || '';
          return dir * ta.localeCompare(tb);
        }
        case 'days': {
          const da = getDaysInStage(a.acc) ?? -1; const db = getDaysInStage(b.acc) ?? -1;
          return dir * (da - db);
        }
        case 'next': {
          const na = a.nextAction?.dueDate || 'zzzz'; const nb = b.nextAction?.dueDate || 'zzzz';
          return dir * na.localeCompare(nb);
        }
        default: return 0;
      }
    });
  }, [filteredRows, sortCol, sortDir]);

  const totalPipeline  = filteredRows.reduce((s, r) => r.acv != null ? s + r.acv : s, 0);
  const totalWeighted  = filteredRows.reduce((s, r) => r.weighted != null ? s + r.weighted : s, 0);
  const forecast       = getForecastSummary(accounts, winsLog, prefs);
  const closedWonQTD   = forecast.closedWonQTD;
  const gap            = forecast.gap;
  const commitTotal    = filteredRows.filter(r => r.effectiveForecastCat === 'Commit'    && r.acv != null).reduce((s, r) => s + r.acv, 0);
  const bestCaseTotal  = filteredRows.filter(r => r.effectiveForecastCat === 'Best Case' && r.acv != null).reduce((s, r) => s + r.acv, 0);
  const commitPlusClosed = closedWonQTD + commitTotal;
  const commitPct      = quota ? Math.round((commitPlusClosed / quota) * 100) : null;
  const bestCasePlusClosed = commitPlusClosed + bestCaseTotal;
  const bestCasePct    = quota ? Math.round((bestCasePlusClosed / quota) * 100) : null;

  const headerProjClose = (() => {
    const pairs = filteredRows.filter(r => r.weighted && r.projClose);
    const totalW = pairs.reduce((s, r) => s + r.weighted, 0);
    if (!totalW) return null;
    const ms = pairs.reduce((s, r) => s + r.projClose.getTime() * r.weighted, 0) / totalW;
    return new Date(ms);
  })();

  const quotaHit    = quota != null && closedWonQTD >= quota;
  const closedPct   = quota ? Math.min(100, (closedWonQTD / quota) * 100) : 0;
  const forecastPct = quota ? Math.min(100 - closedPct, (totalWeighted / quota) * 100) : 0;
  const closedColor = !quota ? C.dim : closedWonQTD >= quota * 0.5 ? "#22c55e" : closedWonQTD >= quota * 0.25 ? "#f59e0b" : "#ef4444";

  const updateAccount = (id, patch) => setAccounts(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a));

  const askRowNs = async (acc) => {
    const id = acc.id;
    setNsLoadingId(id); setCopiedNsId(null);
    const now = new Date();
    const todayFmt = `${now.getMonth()+1}/${now.getDate()}`;
    const todayISO = now.toISOString().split('T')[0];
    const twoWeeksOut = (()=>{ const d=new Date(now); d.setDate(d.getDate()+14); return `${d.getMonth()+1}/${d.getDate()}`; })();
    const [sentEmails] = await Promise.all([fetchSentEmailsForAccount(acc.name)]);
    const { aeInitials, prompt } = buildNsPrompt({ acc, tasks, activeUser, sentEmails, todayFmt, todayISO, twoWeeksOut });
    try {
      const r = await fetch('/proxy/anthropic/messages', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ model:MODELS.STANDARD, max_tokens:280, messages:[{role:'user',content:prompt}] }) });
      const d = await r.json();
      const text = (d.content?.[0]?.text||'').trim();
      if (text) { navigator.clipboard.writeText(text).catch(()=>{}); setCopiedNsId(id); }
    } catch(e) { console.error('Row NS copy error:',e); }
    setNsLoadingId(null);
  };

  const handleDragStart = ({ active }) => setActiveId(active.id);
  const handleDragEnd = ({ active, over }) => {
    setActiveId(null);
    if (!over || active.id === over.id) return;
    const fromIdx = rows.findIndex(r => r.acc.id === active.id);
    const toIdx   = rows.findIndex(r => r.acc.id === over.id);
    if (fromIdx === -1 || toIdx === -1) return;
    const reordered = [...rows.map(r => r.acc)];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    setAccounts(prev => {
      const next = [...prev];
      reordered.forEach((acc, i) => {
        const idx = next.findIndex(a => a.id === acc.id);
        if (idx >= 0) next[idx] = { ...next[idx], ledgerRank: i + 1 };
      });
      return next;
    });
  };

  const copyForecast = () => {
    const today = new Date();
    const dateStr = `${today.getMonth()+1}/${today.getDate()}`;
    const aeName = (activeUser?.name || "AE").split(" ").filter(Boolean).map(w=>w[0]).join("").toUpperCase().slice(0,2) || "AE";
    const yr = String(today.getFullYear()).slice(2);
    const divider = "─".repeat(38);

    const commitRows    = filteredRows.filter(r => r.effectiveForecastCat === 'Commit');
    const bestCaseRows  = filteredRows.filter(r => r.effectiveForecastCat === 'Best Case');
    const pipelineRows  = filteredRows.filter(r => r.effectiveForecastCat === 'Pipeline');

    const fmtRow = (r, i) =>
      `${i+1}. ${r.acc.name} (${fmtAcv(r.acv)}) — ${getDealStageDisplay(r.acc)} — close by ${fmtProjDate(r.projClose)}${r.acc.pathToClose ? `\n   ${r.acc.pathToClose}` : ""}`;

    const lines = [
      `${currentQ} '${yr} FORECAST — ${aeName} | As of ${dateStr}`,
      divider,
      `Quota:     ${fmtAcv(quota)}`,
      `Closed:    ${fmtAcv(closedWonQTD)}${quota ? ` (${Math.round((closedWonQTD/quota)*100)}%)` : ""}`,
      `Commit:    ${fmtAcv(commitTotal)} → total ${fmtAcv(commitPlusClosed)}${commitPct!=null?` (${commitPct}%)`:""} `,
      `Best Case: ${fmtAcv(bestCaseTotal)} → upside ${fmtAcv(bestCasePlusClosed)}${bestCasePct!=null?` (${bestCasePct}%)`:""}`,
      "",
    ];

    if (commitRows.length) {
      lines.push("COMMIT");
      commitRows.forEach((r, i) => lines.push(fmtRow(r, i)));
      lines.push("");
    }
    if (bestCaseRows.length) {
      lines.push("BEST CASE");
      bestCaseRows.forEach((r, i) => lines.push(fmtRow(r, i)));
      lines.push("");
    }
    if (pipelineRows.length) {
      lines.push("PIPELINE");
      pipelineRows.forEach((r, i) => lines.push(fmtRow(r, i)));
    }

    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopied(true);
    });
  };

  const handleForecastSummary = async () => {
    setSummaryLoading(true);
    const quotaVal = quota || 0;
    const commitDeals = filteredRows.filter(r => r.effectiveForecastCat === 'Commit');
    const bestCaseDeals = filteredRows.filter(r => r.effectiveForecastCat === 'Best Case');
    const pipelineTotal = filteredRows.filter(r => r.effectiveForecastCat === 'Pipeline' && r.acv != null).reduce((s,r)=>s+r.acv,0);
    const today = new Date().toISOString().split('T')[0];
    const stale = activeDeals.filter(a => { const d = getLastTouch(a); return d && Math.floor((Date.now()-new Date(d).getTime())/86400000) >= 14; }).map(a=>a.name);
    const overdue = activeDeals.filter(a => tasks.some(t=>t.accId===a.id&&t.status==='Open'&&t.dueDate&&t.dueDate<today)).map(a=>a.name);
    const context = `${currentQ} Quota: $${quotaVal.toLocaleString()}
Closed QTD: $${closedWonQTD.toLocaleString()}
Commit: $${commitTotal.toLocaleString()} (${commitDeals.length} deals — ${commitDeals.map(r=>r.acc.name).join(', ')||'none'})
Best Case: $${bestCaseTotal.toLocaleString()} (${bestCaseDeals.length} deals)
Pipeline: $${pipelineTotal.toLocaleString()}
Commit+Closed vs Quota: $${(closedWonQTD+commitTotal).toLocaleString()} / $${quotaVal.toLocaleString()}${quota?` (${Math.round(((closedWonQTD+commitTotal)/quota)*100)}%)`:''}
Stale deals (14+ days no touch): ${stale.join(', ')||'none'}
Overdue next steps: ${overdue.join(', ')||'none'}

Write a 3-4 sentence forecast summary for an AE to paste into a manager 1:1 or Slack. Include: quota attainment status, top commit deals, any at-risk items, one-line outlook. Be specific with numbers. No preamble.`;
    try {
      const res = await fetch('/proxy/anthropic/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODELS.FAST, max_tokens: 200, messages: [{ role: 'user', content: context }] }),
      });
      const data = await res.json();
      const text = data.content?.[0]?.text?.trim() || '';
      if (text) { await navigator.clipboard.writeText(text); setSummaryCopied(true); }
    } catch(e) { console.error('Forecast summary error:', e); }
    setSummaryLoading(false);
  };

  const HANDLE_W   = 24;
  const RANK_W     = 32;
  const HEALTH_W   = 32;
  const ACCOUNT_W  = 160;
  const FORECAST_W = 100;
  const STAGE_W    = 130;
  const ACV_W      = 80;
  const PROB_W     = 70;
  const WEIGHTED_W = 80;
  const TOUCH_W    = 90;
  const DAYS_W      = 55;
  const CLOSE_EST_W = 100;
  const PROJ_W      = 78;
  const ACTIONS_W  = 80;

  return (
    <div style={{ padding: "16px 20px", fontFamily: "monospace" }}>

      {/* ── Charts panel ── */}
      <div style={{ display: "flex", gap: 0, background: "#0a0a0a", border: "0.5px solid #1e1e1e", borderRadius: 6, marginBottom: 12, overflow: "hidden" }}>
        <div style={{ flex: "0 0 50%", borderRight: "0.5px solid #1e1e1e", padding: "10px 14px" }}>
          <PacingChart
            quota={quota}
            closedWonEvents={qtdWinsLog}
            quarterStart={qStart}
            quarterEnd={qEnd}
            today={new Date()}
          />
        </div>
        <div style={{ flex: "0 0 25%", borderRight: "0.5px solid #1e1e1e", padding: "10px 14px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <p style={{ ...mono, fontSize: 9, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 6px" }}>Deal Quality</p>
          <DealQualityPie dealQuality={dealQuality} activeFilter={qualityFilter} onFilter={setQualityFilter} />
        </div>
        <div style={{ flex: "0 0 25%", padding: "10px 14px" }}>
          <ForecastGapChart
            quota={quota || 0}
            closedWonQTD={closedWonQTD}
            commitTotal={commitTotal}
            bestCaseTotal={bestCaseTotal}
          />
        </div>
      </div>

      {/* ── Quota header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 20, marginBottom: 12, flexWrap: "wrap" }}>
        {/* Left: quota + closed + commit callout */}
        <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div>
            <p style={{ ...mono, margin: 0, fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600 }}>{currentQ} Quota</p>
            <QuotaInput value={quota} onSave={saveQuota} />
          </div>
          <div>
            <p style={{ ...mono, margin: 0, fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600 }}>Closed Won (QTD)</p>
            <p style={{ ...mono, margin: 0, fontSize: 15, fontWeight: 600, color: closedColor }}>{fmtAcv(closedWonQTD)}</p>
          </div>
          {/* Commit callout */}
          <div style={{ borderLeft: "1px solid #222", paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ ...mono, fontSize: 10, color: "#22c55e99", textTransform: "uppercase", letterSpacing: "0.08em" }}>Commit to quota</span>
              <span style={{ ...mono, fontSize: 14, fontWeight: 600, color: commitPlusClosed > 0 ? "#22c55e" : C.dim }}>
                {fmtAcv(commitPlusClosed)}{quota ? ` / ${fmtAcv(quota)}` : ""}
                {commitPct != null && <span style={{ fontSize: 11, fontWeight: 400, color: "#22c55e88", marginLeft: 5 }}>({commitPct}%)</span>}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ ...mono, fontSize: 10, color: "#f59e0b88", textTransform: "uppercase", letterSpacing: "0.08em" }}>Best case upside</span>
              <span style={{ ...mono, fontSize: 13, fontWeight: 500, color: bestCaseTotal > 0 ? "#f59e0b" : C.dim }}>
                {bestCaseTotal > 0 ? `+${fmtAcv(bestCaseTotal)}` : "—"}
                {bestCasePct != null && bestCaseTotal > 0 && <span style={{ fontSize: 11, fontWeight: 400, color: "#f59e0b66", marginLeft: 5 }}>→ {bestCasePct}%</span>}
              </span>
            </div>
          </div>
          {/* Bucket totals */}
          <div style={{ borderLeft: "1px solid #222", paddingLeft: 20, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            {FORECAST_CATS.filter(c => c !== 'Omit').map(cat => {
              const total = filteredRows.filter(r => r.effectiveForecastCat === cat && r.acv != null).reduce((s,r)=>s+r.acv,0);
              const count = filteredRows.filter(r => r.effectiveForecastCat === cat).length;
              const col = FORECAST_C[cat];
              return (
                <div key={cat}>
                  <p style={{ ...mono, margin: 0, fontSize: 9, color: col+'99', textTransform: "uppercase", letterSpacing: "0.08em" }}>{cat} ({count})</p>
                  <p style={{ ...mono, margin: 0, fontSize: 13, fontWeight: 600, color: total > 0 ? col : C.dim }}>{total > 0 ? fmtAcv(total) : "—"}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={copyForecast}
            style={{ ...mono, fontSize: 11, padding: "5px 12px", background: copied ? "#22c55e18" : "transparent", border: `1px solid ${copied ? "#22c55e55" : C.brd}`, color: copied ? "#22c55e" : C.dim, borderRadius: 4, cursor: "pointer", transition: "all 0.2s" }}
          >
            {copied ? "Copied ✓" : "Copy forecast"}
          </button>
          <button
            onClick={handleForecastSummary}
            disabled={summaryLoading}
            style={{ ...mono, fontSize: 11, padding: "5px 12px", background: summaryCopied ? "#2dd4bf18" : "transparent", border: `1px solid ${summaryCopied ? "#2dd4bf55" : C.brd}`, color: summaryCopied ? "#2dd4bf" : C.dim, borderRadius: 4, cursor: summaryLoading ? "default" : "pointer", transition: "all 0.2s", opacity: summaryLoading ? 0.6 : 1 }}
          >
            {summaryLoading ? "⟳" : summaryCopied ? "✓ Copied" : "📋 Brief"}
          </button>
          <button
            onClick={() => setShowPipelineReview(true)}
            style={{ ...mono, fontSize: 11, padding: "5px 12px", background: "transparent", border: `1px solid ${C.brd}`, color: C.dim, borderRadius: 4, cursor: "pointer" }}
          >
            📋 Pipeline Review
          </button>
          <button
            onClick={() => setAuditOpen(true)}
            style={{ ...mono, fontSize: 11, padding: "5px 12px", background: "transparent", border: "1px solid #22c55e55", color: "#22c55e", borderRadius: 4, cursor: "pointer" }}
          >
            Closed Won ✓
          </button>
        </div>
      </div>

      {/* ── Progress bar ── */}
      {quota != null && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ height: 6, background: "#1a1a1a", borderRadius: 3, overflow: "hidden", display: "flex" }}>
            {quotaHit ? (
              <div style={{ width: "100%", background: "#22c55e", transition: "width 0.4s" }} />
            ) : (
              <>
                <div style={{ width: `${closedPct}%`, background: "#22c55e", transition: "width 0.4s" }} />
                <div style={{ width: `${forecastPct}%`, background: "#f59e0b88", transition: "width 0.4s" }} />
              </>
            )}
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 5 }}>
            {quotaHit ? (
              <span style={{ ...mono, fontSize: 10, color: "#22c55e" }}>On track to hit quota ✦</span>
            ) : (
              <>
                <span style={{ ...mono, fontSize: 10, color: "#22c55e88" }}>{fmtAcv(closedWonQTD)} closed</span>
                <span style={{ ...mono, fontSize: 10, color: "#22c55e55" }}>+{fmtAcv(commitTotal)} commit → {fmtAcv(commitPlusClosed)}</span>
                <span style={{ ...mono, fontSize: 10, color: "#f59e0b55" }}>+{fmtAcv(bestCaseTotal)} best case</span>
                <span style={{ ...mono, fontSize: 10, color: C.dim }}>{fmtAcv(gap)} gap</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Scout search bar ── */}
      <div style={{ marginBottom: 10 }}>
        <input
          onFocus={() => setScoutOpen(true)}
          readOnly
          placeholder="Ask anything about your pipeline…"
          style={{ width: '100%', ...mono, fontSize: 13, background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: 6, color: C.dim, padding: '8px 14px', cursor: 'pointer', boxSizing: 'border-box' }}
        />
      </div>

      {/* ── Sub-header ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <p style={{ ...mono, margin: 0, fontSize: 11, color: C.dim }}>
          {qFilter === "All" ? rows.length : filteredRows.length} active deal{(qFilter === "All" ? rows.length : filteredRows.length) !== 1 ? "s" : ""}
        </p>
        {["All","Q1","Q2","Q3","Q4"].map(q => (
          <button key={q} onClick={() => setQFilter(q)}
            style={{ ...mono, fontSize: 10, padding: "2px 7px", borderRadius: 3, cursor: "pointer",
              border: `0.5px solid ${qFilter === q ? "#f59e0b" : C.brd}`,
              background: qFilter === q ? "#1a1200" : "transparent",
              color: qFilter === q ? "#f59e0b" : C.dim,
            }}>
            {q}
          </button>
        ))}
        <button
          onClick={() => setShowProjClose(s => !s)}
          style={{ ...mono, fontSize: 10, padding: "2px 8px", background: showProjClose ? "#f59e0b18" : "transparent", border: `1px solid ${showProjClose ? "#f59e0b55" : C.brd}`, color: showProjClose ? "#f59e0b" : C.dim, borderRadius: 3, cursor: "pointer" }}
        >
          {showProjClose ? "− Proj. Close" : "+ Proj. Close"}
        </button>
        <button
          onClick={handleRefreshInsights}
          disabled={ptcUpdating}
          style={{ ...mono, fontSize: 10, padding: "2px 8px", background: "transparent", border: `1px solid ${C.brd}`, color: ptcUpdating ? "#f59e0b" : C.dim, borderRadius: 3, cursor: ptcUpdating ? "default" : "pointer", marginLeft: "auto" }}
        >
          {ptcUpdating ? "Updating..." : "↻ Refresh insights"}
        </button>
      </div>

      {/* ── Table ── */}
      <div style={{ border: "0.5px solid #1e1e1e", borderRadius: 6, overflow: "hidden" }}>

        {/* Column headers */}
        <div style={{ display: "flex", alignItems: "center", background: "#111", borderBottom: "0.5px solid #1e1e1e", padding: "6px 8px" }}>
          <span style={{ width: HANDLE_W, flexShrink: 0 }} />
          <span onClick={() => { setSortCol(null); setSortDir('asc'); }} style={{ ...mono, fontSize: 10, color: sortCol ? C.dim : C.txt, width: RANK_W, flexShrink: 0, textTransform: "uppercase", letterSpacing: "0.06em", cursor: sortCol ? "pointer" : "default", userSelect: "none" }} title={sortCol ? "Reset to manual order" : undefined}>#</span>
          <span style={{ ...mono, fontSize: 10, color: C.dim, width: HEALTH_W, flexShrink: 0, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "center" }} title="Deal health score">H</span>
          <Th col="account"   style={{ flex: `0 0 ${ACCOUNT_W}px` }}                             sortCol={sortCol} sortDir={sortDir} onSort={onSort}>Account</Th>
          <Th col="forecast"  style={{ flex: `0 0 ${FORECAST_W}px` }} baseColor="#22c55e"        sortCol={sortCol} sortDir={sortDir} onSort={onSort}>Forecast</Th>
          <Th col="stage"     style={{ flex: `0 0 ${STAGE_W}px` }}                               sortCol={sortCol} sortDir={sortDir} onSort={onSort}>Stage</Th>
          <Th col="acv"       style={{ flex: `0 0 ${ACV_W}px` }}      align="right"              sortCol={sortCol} sortDir={sortDir} onSort={onSort}>ACV</Th>
          <Th col="prob"      style={{ flex: `0 0 ${PROB_W}px` }}      align="right"              sortCol={sortCol} sortDir={sortDir} onSort={onSort}>Close %</Th>
          <Th col="weighted"  style={{ flex: `0 0 ${WEIGHTED_W}px` }}  align="right" baseColor="#f59e0b" sortCol={sortCol} sortDir={sortDir} onSort={onSort}>Weighted</Th>
          <Th col="touch"     style={{ flex: `0 0 ${TOUCH_W}px` }}     align="right"              sortCol={sortCol} sortDir={sortDir} onSort={onSort}>Last Touch</Th>
          <Th col="days"      style={{ flex: `0 0 ${DAYS_W}px` }}      align="right"              sortCol={sortCol} sortDir={sortDir} onSort={onSort}>Days</Th>
          <Th col="close_est" style={{ flex: `0 0 ${CLOSE_EST_W}px` }} align="right" baseColor="#00C9A7" sortCol={sortCol} sortDir={sortDir} onSort={onSort}>Est. Close</Th>
          {showProjClose && <span style={{ ...mono, fontSize: 10, color: C.dim, flex: `0 0 ${PROJ_W}px`, textAlign: "right", textTransform: "uppercase", letterSpacing: "0.06em" }}>Proj.</span>}
          <Th col="next"      style={{ flex: 1, minWidth: 0, paddingLeft: 10 }}                   sortCol={sortCol} sortDir={sortDir} onSort={onSort}>Next Action</Th>
          <span style={{ ...mono, fontSize: 10, color: C.dim, flex: `0 0 ${ACTIONS_W}px`, textAlign: "right", textTransform: "uppercase", letterSpacing: "0.06em" }}>Actions</span>
        </div>

        {/* Rows */}
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          {filteredRows.length === 0 && (
            <div style={{ padding: "24px 16px", ...mono, fontSize: 12, color: C.dim, textAlign: "center" }}>
              {rows.length === 0 ? "No active deals. Move accounts to Active Deal stage to see them here." : `No deals projected to close in ${qFilter}.`}
            </div>
          )}
          {sortedRows.map(({ acc, rank, acv, fromPricing, prob, isAutoProb, weighted, projClose, displayStageId, isInferredStage, nextAction, effectiveForecastCat, today }) => {
            const isDragging = activeId === acc.id;
            const days = getDaysInStage(acc);
            const daysColor = days == null ? C.dim : days > 30 ? "#ef4444" : days >= 14 ? "#f59e0b" : "#22c55e";
            const ts = TS[acc.tier] || TS.Slag;
            const fcCol = FORECAST_C[effectiveForecastCat] || C.dim;
            const isManualFc = !!acc.forecastCategory;
            const nextActionOverdue = nextAction?.dueDate && nextAction.dueDate < today;
            const sfdcUrl = toSfdcUrl(acc.sfdc);
            const isNsCopied  = copiedNsId  === acc.id;
            const isNsLoading = nsLoadingId === acc.id;

            return (
              <DropZone key={acc.id} id={acc.id}>
                <div
                  style={{
                    display: "flex", alignItems: "center",
                    background: isDragging ? "#141414" : "#0d0d0d",
                    borderBottom: "0.5px solid #1e1e1e",
                    padding: "7px 8px",
                    opacity: isDragging ? 0.5 : 1,
                    boxShadow: isDragging ? `0 0 0 1px ${C.gold}55, 0 4px 16px rgba(0,0,0,0.5)` : undefined,
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={e => { if (!isDragging) e.currentTarget.style.background = "#111"; }}
                  onMouseLeave={e => { if (!isDragging) e.currentTarget.style.background = "#0d0d0d"; }}
                >
                  <span style={{ width: HANDLE_W, flexShrink: 0, display: "flex", alignItems: "center" }}>
                    <DragHandle id={acc.id} />
                  </span>

                  <span style={{ ...mono, fontSize: 12, color: C.dim, width: RANK_W, flexShrink: 0 }}>{rank}</span>

                  {/* Health score */}
                  {(() => { const h = calcHealthScore(acc, tasks); const hc = h >= 7 ? '#4ade80' : h >= 4 ? '#fbbf24' : '#f87171'; return <span style={{ ...mono, fontSize: 12, fontWeight: 600, color: hc, width: HEALTH_W, flexShrink: 0, textAlign: "center" }} title={`Health: ${h}/10`}>{h}</span>; })()}

                  {/* Account + tier + notes */}
                  <div style={{ flex: `0 0 ${ACCOUNT_W}px`, minWidth: 0, display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ fontSize: 13, color: C.txt, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", cursor: "pointer" }} title={acc.name}>
                      {acc.name}
                    </span>
                    {acc.tier && (
                      <span style={{ ...mono, fontSize: 10, color: ts.t, background: ts.bg, border: `1px solid ${ts.b}`, borderRadius: 3, padding: "1px 5px", flexShrink: 0 }}>
                        {ts.i} {acc.tier}
                      </span>
                    )}
                    <NotesIndicator acc={acc} />
                  </div>

                  {/* Forecast category pill — click to cycle */}
                  <div style={{ flex: `0 0 ${FORECAST_W}px`, display: "flex", alignItems: "center" }}>
                    <button
                      onClick={() => {
                        const current = acc.forecastCategory || null;
                        const idx = current ? FORECAST_CATS.indexOf(current) : -1;
                        const next = FORECAST_CATS[(idx + 1) % FORECAST_CATS.length];
                        updateAccount(acc.id, { forecastCategory: next });
                      }}
                      title={isManualFc ? "Manual override — click to change" : "Auto from close % — click to override"}
                      style={{ ...mono, fontSize: 10, padding: "1px 7px", background: `${fcCol}14`, border: `1px solid ${fcCol}44`, color: fcCol, borderRadius: 3, cursor: "pointer", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4 }}
                    >
                      {effectiveForecastCat}
                      {!isManualFc && <span style={{ fontSize: 8, opacity: 0.5 }}>auto</span>}
                    </button>
                  </div>

                  {/* Stage — inline edit */}
                  <div style={{ flex: `0 0 ${STAGE_W}px`, display: "flex", alignItems: "center" }}>
                    <StageCell stageId={displayStageId} inferred={isInferredStage} onSave={id => updateAccount(acc.id, { dealStage: id })} />
                  </div>

                  {/* ACV */}
                  <span style={{ flex: `0 0 ${ACV_W}px`, textAlign: "right", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                    {fromPricing && (
                      <span style={{ ...mono, fontSize: 9, color: "#f59e0b88", background: "#f59e0b0d", border: "1px solid #f59e0b22", borderRadius: 3, padding: "0 4px", flexShrink: 0 }}>pricing</span>
                    )}
                    <EditCell value={acc.acvOverride ?? (acv != null ? acv : null)} onSave={v => updateAccount(acc.id, { acvOverride: v })} format={fmtAcv} placeholder="—" style={{ ...mono, fontSize: 12, color: C.txt }} />
                  </span>

                  {/* Close % */}
                  <span style={{ flex: `0 0 ${PROB_W}px`, textAlign: "right", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}
                    onMouseEnter={() => setHoverRecalc(acc.id)} onMouseLeave={() => setHoverRecalc(null)}>
                    {isAutoProb && hoverRecalc === acc.id ? (
                      <button onClick={e => { e.stopPropagation(); setAutoScores(s => ({ ...s, [acc.id]: inferCloseProbability(acc) })); }}
                        style={{ ...mono, fontSize: 9, color: "#f59e0b88", background: "none", border: "none", cursor: "pointer", padding: 0, flexShrink: 0 }} title="Recalculate">↻</button>
                    ) : isAutoProb ? (
                      <span style={{ ...mono, fontSize: 9, color: "#f59e0b55", flexShrink: 0 }}>auto ✦</span>
                    ) : null}
                    <EditCell value={acc.closeProbability ?? null}
                      onSave={v => {
                        const clamped = v != null ? Math.min(100, Math.max(0, v)) : null;
                        if (clamped != null) { updateAccount(acc.id, { closeProbability: clamped, closeProbabilitySource: "manual" }); logScore(acc.id, { source: "ledger_manual" }, { probability: clamped }, clamped); }
                        else { const r = inferCloseProbability(acc); updateAccount(acc.id, { closeProbability: r.probability, closeProbabilitySignals: r.signals, closeProbabilitySource: "auto" }); setAutoScores(s => ({ ...s, [acc.id]: r })); }
                      }}
                      format={v => `${v}%`} placeholder={`${prob}%`} style={{ ...mono, fontSize: 12, color: isAutoProb ? "#f59e0b99" : C.txt }} />
                  </span>

                  {/* Weighted */}
                  <span style={{ ...mono, fontSize: 12, color: weighted != null ? "#f59e0b" : C.dim, flex: `0 0 ${WEIGHTED_W}px`, textAlign: "right" }}>
                    {weighted != null ? fmtAcv(weighted) : "—"}
                  </span>

                  {/* Last Touch */}
                  <span style={{ ...mono, fontSize: 11, color: C.dim, flex: `0 0 ${TOUCH_W}px`, textAlign: "right" }}>
                    {fmtDate(getLastTouch(acc))}
                  </span>

                  {/* Days in Stage */}
                  <span style={{ ...mono, fontSize: 12, fontWeight: 500, color: daysColor, flex: `0 0 ${DAYS_W}px`, textAlign: "right" }}>
                    {days != null ? `${days}d` : "—"}
                  </span>

                  {/* Est. Close — AI timeline estimate */}
                  <span onClick={() => setTimelineDrawerAcc(acc)} style={{ ...mono, fontSize: 11, color: getEstClose(acc) ? '#00C9A7' : '#2a2a2a', flex: `0 0 ${CLOSE_EST_W}px`, textAlign: "right", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }} title="Open deal timeline">
                    {getEstClose(acc) || "—"}
                    {acc.dealTimeline?.predictions?.close_confidence != null && getEstClose(acc) && (
                      <span style={{ ...mono, fontSize: 9, color: '#00C9A766', background: '#00C9A711', borderRadius: 3, padding: '0 3px', flexShrink: 0 }}>
                        {acc.dealTimeline.predictions.close_confidence}%
                      </span>
                    )}
                  </span>

                  {/* Proj. close (optional) */}
                  {showProjClose && (
                    <span style={{ ...mono, fontSize: 11, color: projDateColor(projClose), flex: `0 0 ${PROJ_W}px`, textAlign: "right" }}>
                      {fmtProjDate(projClose)}
                    </span>
                  )}

                  {/* Next Action — flexible width, fills remaining space, single line */}
                  <div style={{ flex: 1, minWidth: 0, paddingLeft: 10, overflow: "hidden" }}>
                    {nextAction ? (
                      <span style={{ ...mono, fontSize: 11, color: nextActionOverdue ? "#f97316" : "#888", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}
                        title={`${nextActionOverdue ? "⚠ " : ""}${nextAction.title}${nextAction.dueDate ? " · " + nextAction.dueDate : ""}`}>
                        {nextActionOverdue && <span style={{ color: '#f97316', marginRight: 3, fontSize: 8, lineHeight: 1 }}>●</span>}{nextAction.title}{nextAction.dueDate ? <span style={{ color: nextActionOverdue ? "#f9731688" : C.dim }}> · {nextAction.dueDate}</span> : ""}
                      </span>
                    ) : (
                      <span style={{ ...mono, fontSize: 11, color: "#333", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}
                        title={acc.pathToClose || ""}>
                        {ptcUpdating && !acc.pathToClose ? "..." : acc.pathToClose || "—"}
                      </span>
                    )}
                  </div>

                  {/* Per-row actions: SFDC link + Copy NS */}
                  <div style={{ flex: `0 0 ${ACTIONS_W}px`, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                    {sfdcUrl ? (
                      <a href={sfdcUrl} target="_blank" rel="noreferrer"
                        style={{ ...mono, fontSize: 10, padding: "2px 6px", background: "transparent", border: "0.5px solid #2a2a2a", color: "#c2410c", borderRadius: 3, textDecoration: "none", flexShrink: 0, whiteSpace: "nowrap" }}>
                        ⬡ SF
                      </a>
                    ) : (
                      <span style={{ ...mono, fontSize: 10, padding: "2px 6px", color: "#333", flexShrink: 0 }}>⬡ SF</span>
                    )}
                    <button onClick={() => { if (!isNsLoading) askRowNs(acc); }} disabled={isNsLoading}
                      style={{ ...mono, fontSize: 10, padding: "2px 6px", background: isNsCopied ? "#22c55e14" : "transparent", border: `0.5px solid ${isNsCopied ? "#22c55e55" : "#2a2a2a"}`, color: isNsCopied ? "#22c55e" : isNsLoading ? C.dim : "#aaa", borderRadius: 3, cursor: isNsLoading ? "default" : "pointer", flexShrink: 0, whiteSpace: "nowrap", transition: "all 0.15s" }}>
                      {isNsLoading ? "…" : isNsCopied ? "✓ NS" : "📋 NS"}
                    </button>
                  </div>
                </div>
              </DropZone>
            );
          })}
        </DndContext>
      </div>

      <p style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 10 }}>
        ACV from pricing · Stage "~" = inferred · Click ACV / Close % / Forecast to edit · Drag ⠿ to rerank · 📋 NS = copy SFDC next steps
      </p>

      {auditOpen && setWinsLog && (
        <ClosedWonAuditModal
          winsLog={winsLog}
          setWinsLog={setWinsLog}
          accounts={accounts}
          onClose={() => setAuditOpen(false)}
        />
      )}

      {showPipelineReview && (
        <PipelineReviewModal
          rows={sortedRows}
          tasks={tasks}
          onClose={() => setShowPipelineReview(false)}
        />
      )}

      {scoutOpen && (
        <ScoutModal
          onClose={() => setScoutOpen(false)}
          accounts={accounts}
          activeUser={activeUser}
        />
      )}

      {/* ── Deal Timeline drawer ── */}
      {timelineDrawerAcc && (
        <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 440, background: '#080808', borderLeft: '1px solid #1a1a1a', zIndex: 200, overflowY: 'auto', padding: '16px', boxShadow: '-8px 0 24px #00000088' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ ...mono, fontSize: 12, fontWeight: 600, color: '#00C9A7', letterSpacing: '0.04em' }}>{timelineDrawerAcc.name}</span>
            <button onClick={() => setTimelineDrawerAcc(null)} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: '#555', fontSize: 18, cursor: 'pointer', padding: 0, lineHeight: 1 }}>✕</button>
          </div>
          <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #1a1a1a' }}>
            <IntelligenceRadar acc={timelineDrawerAcc} size="compact" />
          </div>
          <DealTimeline
            acc={timelineDrawerAcc}
            onUpdate={updated => {
              updateAccount(updated.id, { dealTimeline: updated.dealTimeline });
              setTimelineDrawerAcc(updated);
            }}
          />
        </div>
      )}
    </div>
  );
}
