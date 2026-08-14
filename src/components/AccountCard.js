import React, { useState, useRef } from 'react';
import { C, TS, mono } from '../constants/colors';
import { T } from '../constants/tokens';
import { staleDays, isStale, isWarn } from '../utils/staleness';
import { STANDARD_STEPS, getCompliance, saveCompliance } from '../utils/storage';
import { ROI_KEY } from '../utils/storageKeys';
import { productMonthlyCost, monthUsersAt } from '../utils/pricingMath';
import { PROD_COLOR } from '../constants/products';
import { trackDailyStat } from '../utils/stats';
import { DealComplianceTracker, ComplianceMiniBar } from './AccountCardCompliance';
import DealStageBar from './AccountCardDealStage';
import GiftModal from './GiftModal';
import WinReasonPanel from './WinReasonPanel';
import { loadWinReason } from '../utils/winReasons';
import { SignalLegendButton } from './SignalLegend';
import AccountCardActionBar, { QuickAskBar } from './AccountCardActionBar';
import AccountCardCompetition from './AccountCardCompetition';
import AccountCardRawEdit from './AccountCardRawEdit';
import AccountActivityTimeline from './AccountActivityTimeline';
import EmailModal from './EmailModal';
import { updateInfluencerRelationship } from '../utils/db';

const trackStat=(key,by=1)=>{
  try{
    const s=JSON.parse(localStorage.getItem("prospector_stats")||"{}");
    s[key]=(s[key]||0)+by;
    localStorage.setItem("prospector_stats",JSON.stringify(s));
    window.dispatchEvent(new Event("prospector_stats_changed"));
  }catch{}
};

const lastTouch = (acc) => acc.last;
const BANK_CONNECT_RE = /connect.{0,6}(your\s+)?bank|link.{0,6}(your\s+)?bank|connect.{0,6}wallet|pay by bank|instant bank|open banking|bank account linking/i;
const hasBankConnect = (acc) => !!acc.bankConnectSignal || BANK_CONNECT_RE.test((acc.sigs||[]).join(" "));

const VERT_C = {
  "Banks": "#60A8F0", "BFM": "#F5A050", "PFM": "#A878F0",
  "Wealth": "#F5C842", "Consumer Payments": "#42E890", "Technology": "#56C8E0",
  "Lending": "#F06060", "Insurance": "#E878C0", "Crypto": "#50C8A0",
  "Payroll": "#E8C870", "Real Estate": "#90C878", "Healthcare": "#78D0B0",
  "Commerce": "#E8A050", "Investment": "#F5C842", "Fintech": "#A878F0",
};

const DEAL_STAGES = [
  { id: "Prospecting", c: C.mut },
  { id: "Engaged", c: C.blue },
  { id: "Needs Follow-up", c: C.orange },
  { id: "Active Deal", c: C.gold },
  { id: "Qualified", c: C.green },
  { id: "Closed Won", c: C.gold },
  { id: "Closed Lost", c: C.red },
];

const ACCOUNT_SOURCES = ["Cold","Inbound","Referral","Partner","6sense","SFDC"];
const SOURCE_C = { Cold:C.dim, Inbound:C.blue, Referral:C.green, Partner:C.purple, "6sense":"#0099DD", SFDC:C.orange };
const SOURCE_IC = { Cold:"○", Inbound:"↘", Referral:"🤝", Partner:"⬡", "6sense":"◎", SFDC:"☁" };

const BMP_META = {
  platform:   { ic:"📦", label:"Platform",    color:C.purple, desc:"Serves other businesses downstream" },
  b2b2c:      { ic:"🔗", label:"B2B2C",       color:C.blue,   desc:"Sells to businesses who serve consumers" },
  marketplace: { ic:"⇄", label:"Marketplace", color:C.tin,    desc:"Multi-sided market with money movement" },
  embedded:   { ic:"⬡",  label:"Embedded",    color:C.orange, desc:"Financial features inside a non-fin product" },
  direct:     { ic:"→",  label:"Direct",      color:C.dim,    desc:"Sells directly to end consumers" },
};

function Badge({ label, color, bg, border, size = 11 }) {
  return <span style={{ display:"inline-flex", alignItems:"center", background:bg, border:`1px solid ${border}`, borderRadius:4, padding:"2px 7px", fontSize:size, fontWeight:500, color, whiteSpace:"nowrap" }}>{label}</span>;
}

function Dot({ on }) {
  return <span style={{ display:"inline-block", width:6, height:6, borderRadius:"50%", background:on?C.green:C.red, flexShrink:0 }} />;
}

// account-card-unification-and-outreach-v1 — small kind pill next to the name,
// visually distinct for influencer accounts so lists stay scannable at a glance.
const INFLUENCER_ACCENT = "#c026d3";
function KindBadge({ isInfluencer }) {
  return isInfluencer
    ? <span style={{ ...mono, fontSize:9, fontWeight:700, letterSpacing:"0.06em", color:"#e879f9", background:`${INFLUENCER_ACCENT}1c`, border:`1px solid ${INFLUENCER_ACCENT}66`, borderRadius:3, padding:"1px 6px", flexShrink:0 }}>INFLUENCER</span>
    : <span style={{ ...mono, fontSize:9, fontWeight:600, letterSpacing:"0.06em", color:"#666", background:"transparent", border:"1px solid #333", borderRadius:3, padding:"1px 6px", flexShrink:0 }}>BUSINESS</span>;
}

function ZoneLabel({ children }) {
  return <p style={{ ...mono, fontSize:9, fontWeight:700, color:"#555", textTransform:"uppercase", letterSpacing:"0.14em", margin:"0 0 8px", paddingBottom:5, borderBottom:"0.5px solid #1e1e1e" }}>{children}</p>;
}

const loadRoiFiles = () => { try { return JSON.parse(localStorage.getItem(ROI_KEY)||"{}"); } catch { return {}; } };
const saveRoiFiles = f => localStorage.setItem(ROI_KEY, JSON.stringify(f));
const hasPricingFor = id => { try { return !!JSON.parse(localStorage.getItem("prospector_pricing_files")||"{}")[id]; } catch { return false; } };
const hasRoiFor = id => { try { return !!JSON.parse(localStorage.getItem(ROI_KEY)||"{}")[id]; } catch { return false; } };

const PRICING_INTEL_KEY = "prospector_pricing_intel";
const loadPricingIntel = () => { try { return JSON.parse(localStorage.getItem(PRICING_INTEL_KEY)||"{}"); } catch { return {}; } };
const savePricingIntelForAcc = (id, data) => { const a=loadPricingIntel(); a[id]={...data,savedAt:new Date().toISOString()}; localStorage.setItem(PRICING_INTEL_KEY,JSON.stringify(a)); };
const getPricingIntelForAcc = (id) => loadPricingIntel()[id]||null;

function parseAnnualValueStr(v) {
  if (!v) return 0;
  const r = v.match(/→\s*\$\s*([\d,]+)\s*[–—\-]\s*\$?\s*([\d,]+)\s+annual/i);
  if (r) return Math.round((parseInt(r[1].replace(/,/g,""))+parseInt(r[2].replace(/,/g,"")))/2);
  const s = v.match(/→\s*\$\s*([\d,]+)\s+annual/i);
  if (s) return parseInt(s[1].replace(/,/g,""));
  const d = v.match(/\$([\d,]+)\s+annual/i);
  if (d) return parseInt(d[1].replace(/,/g,""));
  const moR = v.match(/\$\s*([\d.]+)\s*[–—\-]\s*\$?\s*([\d.]+)\s*\/\s*mo/i);
  if (moR) return Math.round(((parseFloat(moR[1])+parseFloat(moR[2]))/2)*12);
  const moS = v.match(/\$\s*([\d.]+)\s*\/\s*mo/i);
  if (moS) return Math.round(parseFloat(moS[1])*12);
  return 0;
}

function extractPricingIntelNumbers(evaluated) {
  const result = {};
  const parseK = s => { const raw=(s||"").replace(/,/g,""); const n=parseFloat(raw); if(/k$/i.test(s.trim()))return Math.round(n*1000); if(/m$/i.test(s.trim()))return Math.round(n*1000000); return Math.round(n)||0; };
  const volRow = evaluated.find(r=>r.label==="Expected Users / Volume"&&r.status==="known");
  if (volRow?.value) {
    const m1m=volRow.value.match(/M1:\s*([\d,]+)/i), m12m=volRow.value.match(/M12:\s*([\d,]+)/i);
    if (m1m) result.m1=parseInt(m1m[1].replace(/,/g,""));
    if (m12m) result.m12=parseInt(m12m[1].replace(/,/g,""));
    if (!result.m12&&!result.m1) {
      const anyM=volRow.value.match(/([\d,]+[km]?)\s*users?/i)||volRow.value.match(/\b([\d,]+[km]?)\b/);
      if (anyM) { const n=parseK(anyM[1]); if(n>0) result.m12=n; }
    }
  }
  const convRow = evaluated.find(r=>r.label==="Current Conversion Rate"&&r.status==="known");
  if (convRow?.value) { const pctM=convRow.value.match(/^([\d.]+)%/); if(pctM) result.convRate=parseFloat(pctM[1]); }
  const valRow = evaluated.find(r=>r.label==="Annual Value Per User"&&r.status==="known");
  if (valRow?.value) {
    const v = valRow.value;
    const arrowRange = v.match(/→\s*\$\s*([\d,]+)\s*[–—\-]\s*\$?\s*([\d,]+)\s+annual/i);
    if (arrowRange) {
      const lo=parseInt(arrowRange[1].replace(/,/g,"")), hi=parseInt(arrowRange[2].replace(/,/g,""));
      result.annualValuePerUser = Math.round((lo+hi)/2);
    } else {
      const arrowSingle = v.match(/→\s*\$\s*([\d,]+)\s+annual/i);
      if (arrowSingle) { result.annualValuePerUser = parseInt(arrowSingle[1].replace(/,/g,"")); }
      else { const dM = v.match(/\$([\d,]+)\s+annual/i); if (dM) { result.annualValuePerUser = parseInt(dM[1].replace(/,/g,"")); } }
    }
    if (!result.annualValuePerUser) {
      const moRange = v.match(/\$\s*([\d.]+)\s*[–—\-]\s*\$?\s*([\d.]+)\s*\/\s*mo/i);
      if (moRange) { result.annualValuePerUser = Math.round(((parseFloat(moRange[1])+parseFloat(moRange[2]))/2)*12); }
      else { const moSingle = v.match(/\$\s*([\d.]+)\s*\/\s*mo/i); if (moSingle) { result.annualValuePerUser = Math.round(parseFloat(moSingle[1])*12); } }
    }
  }
  return result;
}

const calcPricingAnnual = (f) => {
  if (!f?.products || !f?.monthlyUsers) return null;
  try {
    const prods = f.products.filter(p=>p.included);
    let total = 0;
    const pfAmt = (() => {
      const TIERS = {base:2000,plus:5000,premium:15000};
      const t = TIERS[f.pfTier]||0;
      if (!f.pfDiscount?.enabled) return t;
      return f.pfDiscount.type==="pct" ? t*(1-f.pfDiscount.amount/100) : Math.max(0,t-f.pfDiscount.amount);
    })();
    const sessionCtx = { avgAccounts: f.avgAccounts || 2.5, onDemand: f.onDemand || 0, tierMult: 1 };
    for (let i=0;i<12;i++){
      const monthCtx = monthUsersAt(f.monthlyUsers, i);
      let apiSpend = 0;
      prods.forEach(p => { apiSpend += productMonthlyCost(p, monthCtx, sessionCtx); });
      const floorThisMo = f.commitRamp ? (f.commitRampSched?.[i]||0) : (f.commitFee||0);
      total += floorThisMo > 0 ? Math.max(apiSpend, floorThisMo) : apiSpend;
      total += f.pfRamp ? (f.pfRampSched?.[i]||0) : pfAmt;
      if (f.isPartner) total += (f.partnerFee||0);
    }
    return Math.round(total);
  } catch { return null; }
};

const PRODUCT_IMPORT_SOURCES = [
  { url:"https://docs.example.com/products/core-verify/",      name:"Core Verify",             id:"live_core_verify"  },
  { url:"https://docs.example.com/products/core-verify-plus/", name:"Core Verify Plus",        id:"live_core_verify_plus" },
  { url:"https://docs.example.com/products/balance-insights/", name:"Balance Insights",        id:"live_balance_insights" },
];

// ── Influencer-side helpers + sub-components (relocated from InfluencerCard.js, unchanged) ──

const STAGE_OPTIONS = ['not_contacted','contacted','replied','interested','negotiating','partnered','declined','do_not_contact'];
const STAGE_COLOR = {
  not_contacted: C.dim, contacted: C.blue, replied: C.blue, interested: C.gold,
  negotiating: C.orange, partnered: C.green, declined: C.red, do_not_contact: C.red,
};
const TEMP_OPTIONS = ['warm','familiar','cold'];
const TEMP_COLOR = { warm: C.orange, familiar: C.gold, cold: C.blue };
const PRIORITY_OPTIONS = ['low','medium','high'];
const PRIORITY_COLOR = { low: C.dim, medium: C.gold, high: C.red };

const fitColor = (score) => score == null ? C.dim : score >= 70 ? C.green : score >= 40 ? C.gold : C.red;

const infLabel = s => (s || '').replace(/_/g, ' ');

const infPill = (color) => ({ ...mono, fontSize:10, padding:"2px 8px", borderRadius:20, background:`${color}18`, border:`1px solid ${color}55`, color, whiteSpace:"nowrap" });
const infSelect = { ...mono, fontSize:11, padding:"4px 8px", background:C.bg, border:`1px solid ${C.brdM}`, borderRadius:5, color:C.txt, outline:"none", cursor:"pointer" };
const infInput = { ...mono, fontSize:12, padding:"7px 10px", background:C.bg, border:`1.5px solid ${C.brdM}`, borderRadius:6, color:C.txt, outline:"none", boxSizing:"border-box", width:"100%" };

function FitBlock({ detail }) {
  const fit = detail?.fit_score;
  const signals = detail?.fit_signals;
  if (detail?.assessment_status !== 'ready') {
    return <p style={{ ...mono, fontSize:11, color:C.dim, margin:0 }}>No fit assessment yet — add a bio below and run assessment.</p>;
  }
  return (
    <>
      <div style={{ display:"flex", alignItems:"baseline", gap:10, marginBottom:8 }}>
        <span style={{ ...mono, fontSize:24, fontWeight:700, color:fitColor(fit) }}>{fit ?? '—'}</span>
        <span style={{ ...mono, fontSize:10, color:C.dim }}>/ 100 fit</span>
      </div>
      {detail.fit_rationale && <p style={{ ...mono, fontSize:12, color:C.txt, lineHeight:1.6, margin:"0 0 10px" }}>{detail.fit_rationale}</p>}
      {Array.isArray(signals) && signals.length > 0 && (
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {signals.map((s, i) => (
            <div key={i} style={{ display:"flex", gap:8, alignItems:"baseline" }}>
              <span style={{ ...mono, fontSize:10, color:C.gold, textTransform:"uppercase", letterSpacing:"0.04em", flexShrink:0 }}>{s.axis}</span>
              <span style={{ ...mono, fontSize:11, color:C.mut, lineHeight:1.5 }}>{s.note}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function AssessBioForm({ business, acc, detail, onAssessed }) {
  const [bio, setBio] = useState(detail?.bio_snapshot || '');
  const [followerCount, setFollowerCount] = useState(detail?.follower_count || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    if (!bio.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const res = await fetch(`/api/businesses/${business.id}/influencer/assess`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: acc.id, bioText: bio.trim(), followerCount: followerCount ? Number(followerCount) : null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Assessment failed');
      onAssessed(data.detail);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop:10 }}>
      <textarea value={bio} onChange={e=>setBio(e.target.value)} rows={3} placeholder="Paste their bio to assess (or re-assess with an updated bio)"
        style={{ ...infInput, resize:"vertical", marginBottom:8 }} disabled={busy} />
      <div style={{ display:"flex", gap:8, alignItems:"center" }}>
        <input type="number" value={followerCount} onChange={e=>setFollowerCount(e.target.value)} placeholder="followers (optional)" style={{ ...infInput, width:160 }} disabled={busy} />
        <button onClick={run} disabled={!bio.trim()||busy} style={{ ...mono, fontSize:11, padding:"7px 14px", background:C.gold, border:`1px solid ${C.gold}`, borderRadius:6, color:C.bg, cursor:"pointer", fontWeight:700, opacity:bio.trim()?1:0.5 }}>
          {busy ? "Assessing…" : detail?.assessment_status === 'ready' ? "Re-run assessment →" : "Run assessment →"}
        </button>
      </div>
      {error && <p style={{ ...mono, fontSize:11, color:C.red, margin:"8px 0 0" }}>⚠ {error}</p>}
    </div>
  );
}

function RelationshipBlock({ acc, detail, userEmail, canEdit, onUpdated }) {
  const [saving, setSaving] = useState(false);
  const [nextAction, setNextAction] = useState(detail?.next_action || '');
  const [declineReason, setDeclineReason] = useState(detail?.decline_reason || '');
  const [tagInput, setTagInput] = useState('');
  const tags = Array.isArray(detail?.tags) ? detail.tags : [];

  const apply = async (patch) => {
    setSaving(true);
    const { detail: updated, error } = await updateInfluencerRelationship(acc.id, userEmail, patch);
    setSaving(false);
    if (!error) onUpdated(updated);
  };

  return (
    <>
      <div style={{ display:"flex", gap:16, flexWrap:"wrap", marginBottom:12 }}>
        <div>
          <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Stage</div>
          {canEdit ? (
            <select value={detail?.relationship_stage || 'not_contacted'} disabled={saving} onChange={e=>apply({ relationship_stage: e.target.value })} style={{ ...infSelect, color:STAGE_COLOR[detail?.relationship_stage]||C.txt }}>
              {STAGE_OPTIONS.map(s => <option key={s} value={s}>{infLabel(s)}</option>)}
            </select>
          ) : <span style={infPill(STAGE_COLOR[detail?.relationship_stage]||C.dim)}>{infLabel(detail?.relationship_stage||'not_contacted')}</span>}
        </div>
        <div>
          <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Temperature</div>
          {canEdit ? (
            <select value={detail?.relationship_temperature || ''} disabled={saving} onChange={e=>apply({ relationship_temperature: e.target.value || null })} style={infSelect}>
              <option value="">—</option>
              {TEMP_OPTIONS.map(t => <option key={t} value={t}>{infLabel(t)}</option>)}
            </select>
          ) : <span style={infPill(TEMP_COLOR[detail?.relationship_temperature]||C.dim)}>{infLabel(detail?.relationship_temperature||'—')}</span>}
        </div>
        <div>
          <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Priority</div>
          {canEdit ? (
            <select value={detail?.priority || ''} disabled={saving} onChange={e=>apply({ priority: e.target.value || null })} style={infSelect}>
              <option value="">—</option>
              {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{infLabel(p)}</option>)}
            </select>
          ) : <span style={infPill(PRIORITY_COLOR[detail?.priority]||C.dim)}>{infLabel(detail?.priority||'—')}</span>}
        </div>
      </div>

      <div style={{ marginBottom:10 }}>
        <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Next action</div>
        {canEdit ? (
          <div style={{ display:"flex", gap:6 }}>
            <input value={nextAction} onChange={e=>setNextAction(e.target.value)} placeholder="e.g. Send outreach DM" style={infInput} disabled={saving} />
            <button onClick={()=>apply({ next_action: nextAction.trim() || null })} disabled={saving} style={{ ...mono, fontSize:11, padding:"0 12px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:6, color:C.dim, cursor:"pointer" }}>Save</button>
          </div>
        ) : <p style={{ ...mono, fontSize:12, color:C.txt, margin:0 }}>{detail?.next_action || '—'}</p>}
      </div>

      {(detail?.relationship_stage === 'declined' || detail?.relationship_stage === 'do_not_contact') && (
        <div style={{ marginBottom:10 }}>
          <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Decline reason</div>
          {canEdit ? (
            <div style={{ display:"flex", gap:6 }}>
              <input value={declineReason} onChange={e=>setDeclineReason(e.target.value)} placeholder="Why this didn't work out" style={infInput} disabled={saving} />
              <button onClick={()=>apply({ decline_reason: declineReason.trim() || null })} disabled={saving} style={{ ...mono, fontSize:11, padding:"0 12px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:6, color:C.dim, cursor:"pointer" }}>Save</button>
            </div>
          ) : <p style={{ ...mono, fontSize:12, color:C.txt, margin:0 }}>{detail?.decline_reason || '—'}</p>}
        </div>
      )}

      <div>
        <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>Tags</div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
          {tags.map(t => (
            <span key={t} style={infPill(C.purple)}>
              {t}
              {canEdit && <button onClick={()=>apply({ tags: tags.filter(x=>x!==t) })} disabled={saving} style={{ background:"transparent", border:"none", color:C.purple, cursor:"pointer", marginLeft:6, padding:0, fontSize:11 }}>✕</button>}
            </span>
          ))}
          {canEdit && (
            <input value={tagInput} onChange={e=>setTagInput(e.target.value)}
              onKeyDown={e=>{ if(e.key==='Enter' && tagInput.trim()){ apply({ tags:[...tags, tagInput.trim()] }); setTagInput(''); } }}
              placeholder="+ tag" style={{ ...infInput, width:100, padding:"3px 8px", fontSize:11 }} disabled={saving} />
          )}
          {!tags.length && !canEdit && <span style={{ ...mono, fontSize:11, color:C.dim }}>—</span>}
        </div>
      </div>
    </>
  );
}

// ── Unified component (account-card-unification-and-outreach-v1) ──────────────
// Business (legacy Assay/Gold-Silver-Tin) and influencer accounts now share one
// two-zone shell (ActionsZone -> IntelZone). Business internals reused unchanged
// via AccountCardActionBar + its existing sub-panels; influencer internals reused
// unchanged via AssessBioForm/FitBlock/RelationshipBlock above (relocated from
// the now-deleted InfluencerCard.js, not rewritten).
function AccountCard({ acc, business=null, expanded, onToggle, onReassay, reassaying, onUpdate, isFav, onToggleFav, onRemove, assignedEntry, onAssign, onUnassign, onFlagRemoval, onOpenPricing, onOpenRoi, onOpenDealSummary, onCreateTask, onUpdateTask, tasks=[], activeUser={}, parentName=null, onRequestLinkParent, onUnlinkParent, userEmail, canEdit, onUpdated }) {
  const isInfluencer = acc.accountKind === 'influencer';

  // ── business-only state (unchanged) ──
  const [confirmRemove,setConfirmRemove]=useState(false);
  const [giftModalOpen,setGiftModalOpen]=useState(false);
  const [webOverride,setWebOverride]=useState("");
  const [bmExpanded,setBmExpanded]=useState(false);
  const [intelFlash,setIntelFlash]=useState(null); // string message or null
  const [winReasonOpen,setWinReasonOpen]=useState(false);
  const [winReasonModal,setWinReasonModal]=useState(false);
  const [winReason,setWinReason]=useState(()=>loadWinReason(acc.id));
  const isClosedWon = (acc.stage||"") === "Closed Won";
  const actionBarRef = useRef(null);

  // ── influencer-only state ──
  const [detail, setDetail] = useState(acc.influencerDetail || null);
  // Same pattern InfluencerCard.js used: update this card's own view immediately,
  // then trigger a silent reload upstream so last_touched_by/at doesn't go stale
  // in BusinessAccountsTab's cached account list.
  const applyDetailUpdate = (updated) => { setDetail(updated); onUpdated?.(); };

  // ── shared: Generate Outreach (account-card-unification-and-outreach-v1) ──
  const [outreachOpen, setOutreachOpen] = useState(false);

  const ts = TS[acc.tier] || TS.Slag;
  const gold = acc.score === 1, silver = acc.tier === "Silver", tin = acc.tier === "Tin", slag = acc.score === 4;
  const stale = isStale(lastTouch(acc)), warn = isWarn(lastTouch(acc));
  const days = staleDays(lastTouch(acc));
  const missingData = !acc.score || !acc.linkedin || !acc.prods || acc.prods.length === 0;
  const isActiveDealEarly = acc.stage === "Active Deal";
  const tierColor = gold ? T.tier.gold : silver ? T.tier.silver : tin ? T.tier.tin : slag ? T.tier.slag : "#444";
  const cardBg = isActiveDealEarly
    ? (expanded ? T.bg.cardExpanded : `${T.neon}08`)
    : (expanded ? T.bg.cardExpanded : T.bg.card);
  const cardBorder = isActiveDealEarly ? `${T.neon}40` : T.border.dim;
  const cardGlow = isActiveDealEarly
    ? `0 0 0 1px ${T.neon}18, 0 2px 12px rgba(0,0,0,0.4)`
    : expanded
      ? `0 2px 14px rgba(0,0,0,0.55)`
      : `0 2px 12px rgba(0,0,0,0.35)`;
  const restingTierBorder = `${tierColor}99`;
  const restingBg = isActiveDealEarly ? `${T.neon}08` : T.bg.card;
  const vertColor = VERT_C[acc.vert] || T.text.primary;
  const isActiveDeal = isActiveDealEarly;
  const bdrInitials = (assignedEntry?.assignedTo || '').split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
  const Divider = () => <span style={{ width:1, height:20, background:T.border.subtle, flexShrink:0, margin:"0 2px" }} />;
  const SEC = {
    amber:     { borderLeft: "2px solid #f59e0b", paddingLeft: 12 },
    softAmber: { borderLeft: "2px solid #c8922a", paddingLeft: 12 },
    teal:      { borderLeft: "2px solid #0f6e56", paddingLeft: 12 },
    gray:      { borderLeft: "2px solid #333",    paddingLeft: 12 },
    red:       { borderLeft: "2px solid #7a2020", paddingLeft: 12 },
    cyan:      { borderLeft: "2px solid #00b4d8", paddingLeft: 12 },
  };
  const SH = { ...mono, fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "#555" };

  // ── influencer header display fields ──
  const handle = detail?.instagram_handle || (acc.name || '').replace(/^@/, '');

  const outerStyle = isInfluencer
    ? { border:`1px solid ${C.brd}`, borderLeft:`4px solid ${INFLUENCER_ACCENT}88`, borderRadius:6, background:C.card, marginBottom:6, overflow:"hidden" }
    : { border:`1px solid ${cardBorder}`, borderLeft:`4px solid ${expanded?tierColor:restingTierBorder}`, borderRadius:6, background:cardBg, marginBottom:6, overflow:"hidden", boxShadow:cardGlow, position:"relative", transition:"background 0.15s, border-color 0.15s, box-shadow 0.15s" };

  return (
    <div id={`acct-${acc.id}`} style={outerStyle}
      onMouseEnter={isInfluencer ? undefined : e=>{ if(!expanded){ e.currentTarget.style.background=isActiveDealEarly?`${T.neon}10`:T.bg.cardExpanded; e.currentTarget.style.borderLeftColor=tierColor; }}}
      onMouseLeave={isInfluencer ? undefined : e=>{ if(!expanded){ e.currentTarget.style.background=restingBg; e.currentTarget.style.borderLeftColor=restingTierBorder; }}}>
      {!isInfluencer && intelFlash&&<div style={{ position:"absolute", top:8, right:12, zIndex:10, pointerEvents:"none", ...mono, fontSize:10, color:intelFlash.startsWith('⚠')?T.amber:T.neon, fontWeight:500, opacity:1, transition:"opacity 0.3s" }}>{intelFlash===true?'✦ Intel updated':intelFlash}</div>}

      {/* ── Header row ── */}
      {isInfluencer ? (
        <div onClick={onToggle} style={{ padding:"10px 14px", cursor:"pointer", display:"flex", alignItems:"center", gap:14 }}>
          <Dot on={true} />
          <div style={{ flex:"0 0 200px", minWidth:0 }}>
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <p style={{ margin:0, fontWeight:500, fontSize:14, color:C.txt, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>@{handle}</p>
              <KindBadge isInfluencer />
            </div>
            <p style={{ ...mono, margin:0, fontSize:10, color:C.dim }}>
              {detail?.follower_count != null ? `${detail.follower_count.toLocaleString()} followers` : '—'}
              {detail?.niche_assessment?.category ? ` · ${detail.niche_assessment.category}` : ''}
            </p>
          </div>
          <div style={{ flex:"0 0 auto" }}>
            {detail?.assessment_status === 'ready' ? (
              <span style={{ ...mono, fontSize:16, fontWeight:700, color:fitColor(detail.fit_score) }}>{detail.fit_score ?? '—'}<span style={{ fontSize:9, color:C.dim, fontWeight:400 }}> fit</span></span>
            ) : (
              <span style={{ ...mono, fontSize:10, color:C.dim }}>
                {detail?.assessment_status === 'assessing' ? 'assessing…' : detail?.assessment_status === 'error' ? 'assessment failed' : 'no bio yet'}
              </span>
            )}
          </div>
          {detail?.priority && <span style={infPill(PRIORITY_COLOR[detail.priority])}>{infLabel(detail.priority)} priority</span>}
          <span style={infPill(STAGE_COLOR[detail?.relationship_stage]||C.dim)}>{infLabel(detail?.relationship_stage||'not_contacted')}</span>
          {detail?.instagram_url && <a href={detail.instagram_url} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} style={{ ...mono, fontSize:10, color:C.tin, textDecoration:"none" }}>↗ profile</a>}
          <span style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:8 }}>
            <button onClick={e=>{e.stopPropagation();onToggleFav&&onToggleFav(acc.id);}} style={{ background:"transparent",border:"none",fontSize:14,color:isFav?C.gold:T.border.muted,cursor:"pointer",padding:"0 2px",lineHeight:1,flexShrink:0 }}>★</button>
            <span style={{ ...mono, fontSize:10, color:C.dim }}>{expanded?"▲":"▼"}</span>
          </span>
        </div>
      ) : (
        <div onClick={onToggle} style={{ padding:T.spacing.row, cursor:"pointer", display:"flex", alignItems:"center", gap:T.spacing.gap.md, ...(expanded?{borderBottom:`1px solid ${tierColor}33`}:{}) }}>
          <Dot on={true} />
          <div style={{ flex:"0 0 150px", minWidth:0 }}>
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <p style={{ margin:0, fontWeight:500, fontSize:15, color:gold?C.goldTxt:slag?C.slag:T.text.primary, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{acc.name}</p>
              <KindBadge isInfluencer={false} />
            </div>
            <p style={{ ...mono, margin:0, fontSize:11, color:T.text.muted }}>{[acc.web, [acc.city, acc.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || "—"}</p>
          </div>
          <Divider />
          <div style={{ display:"flex", alignItems:"center", gap:T.spacing.gap.md, flex:"0 0 auto" }}>
            <div style={{ height:24, display:"flex", alignItems:"center" }}>{acc.tier?<Badge label={`${ts.i} ${acc.tier}`} color={ts.t} bg={ts.bg} border={ts.b} size={12}/>:<span style={{ fontSize:12, color:T.text.dim }}>—</span>}</div>
            <Divider />
            <div style={{ height:24, display:"flex", alignItems:"center" }} onClick={e=>e.stopPropagation()}>
              {onUpdate
                ? <select value={acc.stage||"Prospecting"} onChange={e=>{
                    const newStage=e.target.value;
                    const stageNow=new Date().toISOString();
                    console.warn(`[STAGE CHANGE] manual dropdown | ${acc.name} | ${acc.stage||'Prospecting'} → ${newStage}`);
                    onUpdate({...acc,stage:newStage,...(newStage==="Active Deal"&&acc.stage!=="Active Deal"?{activeDealAt:stageNow}:{})});
                    trackDailyStat("accounts_touched");
                    if(newStage==="Active Deal"&&acc.stage!=="Active Deal"){
                      if(!getCompliance(acc.id)){
                        saveCompliance(acc.id,{type:"standard",steps:STANDARD_STEPS.map(s=>({id:s.id,status:"Not Started",days:0,notes:"",startedAt:null,completedAt:null}))});
                      }
                      if(onCreateTask){
                        const today=new Date().toISOString().split("T")[0];
                        onCreateTask({id:Date.now(),title:`Check production request status for ${acc.name}`,type:"Follow up",accId:acc.id,accName:acc.name,priority:"High",assignee:"AE",status:"Open",dueDate:today,pricingFileId:null,pricingFileName:null,notes:"",createdAt:today});
                      }
                    }
                    if(newStage==="Closed Won"){
                      setGiftModalOpen(true);
                      if(onCreateTask){
                        const now=new Date().toISOString();
                        const existing=tasks||[];
                        const CLOSED_WON_TASKS=[
                          {title:"Account Manager Intro",type:"Other"},
                          {title:"Turn on Production",type:"Salesforce"},
                        ];
                        CLOSED_WON_TASKS.forEach((tmpl,i)=>{
                          const dupe=existing.some(t=>t.title===tmpl.title&&t.accId===acc.id);
                          if(!dupe) onCreateTask({id:Date.now()+i,title:tmpl.title,type:tmpl.type,accId:acc.id,accName:acc.name,priority:"High",status:"Open",dueDate:null,createdAt:now});
                        });
                      }
                    }
                  }} style={{ fontSize:12,padding:"0 5px",background:C.bg,border:`1px solid ${C.brd}`,borderRadius:4,color:DEAL_STAGES.find(d=>d.id===(acc.stage||"Prospecting"))?.c||T.text.muted,outline:"none",cursor:"pointer",height:24 }}>
                    {DEAL_STAGES.map(s=><option key={s.id} value={s.id}>{s.id}</option>)}
                  </select>
                : <span style={{ fontSize:12,color:DEAL_STAGES.find(d=>d.id===acc.stage)?.c||T.text.muted }}>{acc.stage||"Prospecting"}</span>
              }
            </div>
            <Divider />
            <div style={{ height:24, display:"flex", alignItems:"center" }}><span style={{ fontSize:12, color:vertColor }}>{acc.vert||"—"}</span></div>
          </div>
          <Divider />
          <div style={{ flex:1, display:"flex", gap:T.spacing.gap.sm, flexWrap:"wrap", alignItems:"center", minWidth:0 }}>
            {acc.prods&&acc.prods.slice(0,3).map(p=><span key={p} style={{ fontSize:11, color:PROD_COLOR[p]||T.text.muted, background:C.bg, border:`1px solid ${C.brd}`, borderRadius:3, padding:T.spacing.pill }}>{p}</span>)}
            {acc.stage==="Active Deal"&&!expanded&&<ComplianceMiniBar accId={acc.id}/>}
          </div>
          <Divider />
          <div style={{ display:"flex", alignItems:"center", gap:T.spacing.gap.md, flexShrink:0 }}>
            {assignedEntry&&<span title={`In Frontier — ${assignedEntry.assignedTo||''}`} style={{ fontSize:11, color:T.cyan, background:`${T.cyan}14`, border:`1px solid ${T.cyan}55`, borderRadius:3, padding:T.spacing.pill, letterSpacing:"0.06em", textShadow:`0 0 6px ${T.cyan}55` }}>◆ OUTBOUND</span>}
            {stale&&<span style={{ fontSize:11, color:T.red }}>⚠ {days}d at risk</span>}
            {warn&&!stale&&<span style={{ fontSize:11, color:T.amber }}>{days}d warn</span>}
            {acc.lastTouchedBy && <span title={acc.lastTouchedAt ? new Date(acc.lastTouchedAt).toLocaleString() : undefined} style={{ fontSize:11, color:T.text.muted }}>Last contact: {acc.lastTouchedBy} · {staleDays(acc.lastTouchedAt)===0?"today":`${staleDays(acc.lastTouchedAt)}d ago`}</span>}
            {hasBankConnect(acc)&&<span title="Bank connect signal" style={{ fontSize:13, lineHeight:1 }}>🐷</span>}
            {acc.distributionMultiplier&&<span title={`Distribution multiplier — ${acc.estimatedDownstreamUsers||"downstream reach detected"}`} style={{ fontSize:13, lineHeight:1 }}>📦</span>}
            {acc.isEstablished&&!acc.distributionMultiplier&&<span title={`Established — ${(acc.tractionSignals||[]).slice(0,2).join(", ")||"active customer base"}`} style={{ fontSize:13, lineHeight:1 }}>✅</span>}
            {acc.isHandoff&&<span title="NBA handoff — notes pre-loaded" style={{ fontSize:11, color:C.gold, background:`${C.gold}18`, border:`1px solid ${C.gold}44`, borderRadius:3, padding:T.spacing.pill }}>NBA</span>}
            {(assignedEntry||stale||warn||acc.isHandoff||hasBankConnect(acc)||acc.distributionMultiplier||acc.isEstablished)&&<Divider />}
            {acc.stealthOrigin&&<span title="Stealth origin" style={{ fontSize:13, color:C.purple, lineHeight:1, cursor:"default", opacity:0.75 }}>⬟</span>}
            {isActiveDeal&&onUpdate&&<button onClick={e=>{e.stopPropagation();onUpdate({...acc,isGaming:!acc.isGaming});}} title={acc.isGaming?"Remove gaming track":"Add gaming track"} style={{ background:"transparent",border:"none",fontSize:13,color:acc.isGaming?T.amber2:T.border.muted,cursor:"pointer",padding:"0 2px",lineHeight:1,flexShrink:0,transition:"color 0.1s",opacity:acc.isGaming?1:0.45 }}>🎲</button>}
            {hasPricingFor(acc.id)&&<span title="Pricing sheet saved" style={{ fontSize:13, color:C.gold, lineHeight:1, cursor:"default" }}>$</span>}
            {acc.source&&acc.source!=="Cold"&&<span title={`Source: ${acc.source}`} style={{ fontSize:11, color:SOURCE_C[acc.source]||T.text.dim, cursor:"default" }}>{SOURCE_IC[acc.source]||"·"}</span>}
            {missingData&&!expanded&&<span title="Missing data" style={{ fontSize:11, color:C.orange }}>◌</span>}
            {assignedEntry&&bdrInitials&&<span title={`BDR — ${assignedEntry.assignedTo}`} style={{ width:18, height:18, borderRadius:"50%", background:`${T.cyan}18`, border:`1px solid ${T.cyan}44`, color:T.cyan, fontSize:9, fontWeight:500, display:"inline-flex", alignItems:"center", justifyContent:"center", flexShrink:0, letterSpacing:"0.02em" }}>{bdrInitials}</span>}
            <button onClick={e=>{e.stopPropagation();onToggleFav&&onToggleFav(acc.id);}} style={{ background:"transparent",border:"none",fontSize:14,color:isFav?C.gold:T.border.muted,cursor:"pointer",padding:"0 2px",lineHeight:1,flexShrink:0,transition:"color 0.1s" }}>★</button>
            <span onClick={e=>e.stopPropagation()}><SignalLegendButton style={{ fontSize:9, padding:"1px 5px", opacity:0.55, border:"none" }} /></span>
            {acc.parentId&&parentName&&<span title="Click to unlink from parent" onClick={e=>{e.stopPropagation();onUnlinkParent&&onUnlinkParent();}} style={{ ...mono, fontSize:10, padding:"1px 6px", background:T.bg.surface, border:`1px solid ${T.border.subtle}`, color:T.text.muted, borderRadius:3, cursor:onUnlinkParent?"pointer":"default", flexShrink:0 }}>↑ {parentName}</span>}
            {acc.childIds&&acc.childIds.length>0&&<span title={`${acc.childIds.length} child account${acc.childIds.length===1?"":"s"}`} style={{ ...mono, fontSize:10, padding:"1px 6px", background:T.bg.surface, border:`1px solid ${T.border.subtle}`, color:T.text.muted, borderRadius:3, flexShrink:0, cursor:"default" }}>↓ {acc.childIds.length} linked</span>}
            <span style={{ fontSize:10, color:T.text.dim }}>{expanded?"▲":"▼"}</span>
          </div>
        </div>
      )}

      {expanded && isInfluencer && (
        <div style={{ borderTop:`1px solid ${C.brd}`, padding:"14px 16px", display:"flex", flexDirection:"column", gap:16 }}>

          <div>
            <ZoneLabel>Actions</ZoneLabel>
            <QuickAskBar acc={acc} />
            <button onClick={()=>setOutreachOpen(true)}
              style={{ ...mono, fontSize:11, height:28, padding:'0 14px', background:`${INFLUENCER_ACCENT}14`, border:`1px solid ${INFLUENCER_ACCENT}`, color:'#e879f9', borderRadius:4, cursor:'pointer', fontWeight:600, letterSpacing:'0.04em' }}>✦ Generate Outreach</button>
            {outreachOpen && (
              <EmailModal account={acc} persona={null} accountKind="influencer" onClose={()=>setOutreachOpen(false)} />
            )}
          </div>

          <div>
            <ZoneLabel>Intel</ZoneLabel>
            <div>
              <p style={SH}>Creator</p>
              <p style={{ ...mono, fontSize:12, color:C.txt, lineHeight:1.6, margin:"0 0 6px" }}>{detail?.niche_assessment?.audience_read || '—'}</p>
              <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
                <span style={{ ...mono, fontSize:11, color:C.mut }}><b style={{ color:C.dim }}>Category:</b> {detail?.niche_assessment?.category || '—'}</span>
                <span style={{ ...mono, fontSize:11, color:C.mut }}><b style={{ color:C.dim }}>Content:</b> {detail?.niche_assessment?.content_type || '—'}</span>
              </div>
              <AssessBioForm business={business} acc={acc} detail={detail} onAssessed={applyDetailUpdate} />
            </div>

            <div style={{ marginTop:16 }}>
              <p style={SH}>Fit</p>
              <FitBlock detail={detail} />
            </div>

            <div style={{ marginTop:16 }}>
              <p style={SH}>Relationship</p>
              <RelationshipBlock acc={acc} detail={detail} userEmail={userEmail} canEdit={canEdit} onUpdated={applyDetailUpdate} />
            </div>

            <div style={{ marginTop:16 }}>
              <p style={SH}>Activity</p>
              <AccountActivityTimeline acc={acc} />
            </div>
          </div>

          {onRemove && (
            <div style={{ paddingTop:8, borderTop:`0.5px solid ${C.brd}` }}>
              {confirmRemove ? (
                <span style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ ...mono, fontSize:10, color:C.red }}>Remove?</span>
                  <button onClick={()=>onRemove(acc.id)} style={{ ...mono, fontSize:10, padding:"4px 9px", background:"#1a0a0a", border:`1px solid ${C.red}`, color:C.red, borderRadius:4, cursor:"pointer" }}>Confirm</button>
                  <button onClick={()=>setConfirmRemove(false)} style={{ ...mono, fontSize:10, padding:"4px 8px", background:"transparent", border:"0.5px solid #2a2a2a", color:C.dim, borderRadius:4, cursor:"pointer" }}>Cancel</button>
                </span>
              ) : (
                <button onClick={()=>setConfirmRemove(true)} style={{ ...mono, fontSize:10, padding:"4px 9px", background:`${C.red}12`, border:`1px solid ${C.red}55`, color:C.red, borderRadius:4, cursor:"pointer" }}>✕ Remove</button>
              )}
            </div>
          )}
        </div>
      )}

      {expanded && !isInfluencer && (
        <div style={{ borderTop:`1px solid ${C.brd}`, padding:"12px 14px" }}>

          <ZoneLabel>Actions</ZoneLabel>

          {/* ── Action bar: Quick Ask, Next Steps, buttons, all panels ── */}
          <AccountCardActionBar
            ref={actionBarRef}
            acc={acc}
            onUpdate={onUpdate}
            tasks={tasks}
            activeUser={activeUser}
            isFav={isFav}
            onToggleFav={onToggleFav}
            assignedEntry={assignedEntry}
            onAssign={onAssign}
            onUnassign={onUnassign}
            onOpenPricing={onOpenPricing}
            onOpenRoi={onOpenRoi}
            onOpenDealSummary={onOpenDealSummary}
            onCreateTask={onCreateTask}
            onUpdateTask={onUpdateTask}
            onReassay={onReassay}
            reassaying={reassaying}
            setIntelFlash={setIntelFlash}
            openGiftModal={()=>setGiftModalOpen(true)}
          />

          {giftModalOpen&&onUpdate&&(
            <GiftModal acc={acc} onClose={()=>setGiftModalOpen(false)} onUpdate={onUpdate} userName={(()=>{try{return JSON.parse(localStorage.getItem("prospector_user")||"{}").name||"AE";}catch{return "AE";}})()}/>
          )}

          <ZoneLabel>Intel</ZoneLabel>

          {/* ── Intelligence section ── */}
          <div style={{ marginTop:0, ...SEC.softAmber, paddingTop:8, paddingBottom:8 }}>
            <p style={{ ...SH, color:"#c8922a", margin:"0 0 8px" }}>Intelligence</p>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 0.5px 1fr", gap:0, marginBottom:8 }}>
              {[["Business Model",acc.bm||"Not yet analyzed"],["Product Fit",acc.pf||"Run assay to analyze"]].map(([l,v],idx)=>{
                const truncated = v.length > 200 && !bmExpanded;
                return (
                  <React.Fragment key={l}>
                    {idx===1&&<div style={{ background:"#1e1e1e", margin:"0 14px" }}/>}
                    <div style={{ paddingLeft: idx===1 ? 14 : 0 }}>
                      <p style={{ ...SH, margin:"0 0 4px" }}>{l}</p>
                      <p style={{ margin:0, fontSize:12, color:"#c8c8c0", lineHeight:1.6 }}>{truncated ? v.slice(0,200)+"…" : v}</p>
                      {v.length > 200 && <button onClick={e=>{e.stopPropagation();setBmExpanded(o=>!o);}} style={{ ...mono, fontSize:10, color:C.dim, background:"transparent", border:"none", cursor:"pointer", padding:"2px 0", marginTop:2 }}>{bmExpanded?"▲ less":"▼ more"}</button>}
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
            {acc.prods&&acc.prods.length>0&&(
              <div style={{ marginBottom:8 }}>
                <p style={{ ...SH, margin:"0 0 5px" }}>Products</p>
                <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                  {acc.prods.map(p=><span key={p} style={{ ...mono, fontSize:12, color:PROD_COLOR[p]||C.mut, background:C.bg, border:`1px solid ${C.brd}`, borderRadius:4, padding:"2px 7px" }}>{p}</span>)}
                </div>
              </div>
            )}
            {(()=>{
              const pills=[];
              (acc.sigs||[]).forEach(s=>pills.push({label:s,color:"#c8922a",bg:"#140e00",border:"0.5px solid #3a2a00"}));
              if(acc.signalBreakdown){
                const sb=acc.signalBreakdown;
                ['paymentSignals','onboardingSignals','creditSignals','scaleSignals','platformSignals'].forEach(k=>{
                  if(sb[k])sb[k].forEach(s=>pills.push({label:s,color:C.mut,bg:C.sur,border:`1px solid ${C.brd}`}));
                });
                if(sb.slagSignals?.length)sb.slagSignals.forEach(s=>pills.push({label:s,color:C.red,bg:`${C.red}0a`,border:`1px solid ${C.red}22`}));
                if(sb.competitorSignals?.length)sb.competitorSignals.forEach(s=>pills.push({label:s,color:C.orange,bg:`${C.orange}14`,border:`1px solid ${C.orange}33`}));
              }
              if(acc.isEstablished&&acc.tractionSignals?.length)acc.tractionSignals.forEach(s=>pills.push({label:s,color:C.green,bg:`${C.green}0a`,border:`1px solid ${C.green}22`}));
              if(acc.distributionMultiplier)pills.push({label:"📦 Distribution play",color:C.purple,bg:`${C.purple}14`,border:`1px solid ${C.purple}33`});
              else if(acc.businessModelPattern&&acc.businessModelPattern!=="unknown"&&BMP_META[acc.businessModelPattern]){
                const m=BMP_META[acc.businessModelPattern];
                pills.push({label:`${m.ic} ${m.label}`,color:m.color,bg:`${m.color}14`,border:`1px solid ${m.color}33`});
              }
              if(!pills.length)return null;
              const show=pills.slice(0,5);
              const extra=pills.length-5;
              return(
                <div style={{ display:"flex", gap:4, flexWrap:"wrap", alignItems:"center", marginTop:4 }}>
                  {show.map((p,i)=><span key={i} style={{ ...mono, fontSize:11, color:p.color, background:p.bg, border:p.border, borderRadius:4, padding:"2px 8px" }}>{p.label}</span>)}
                  {extra>0&&<span style={{ ...mono, fontSize:10, color:C.dim }}>+{extra} more</span>}
                </div>
              );
            })()}
          </div>

          {onUpdate&&(
            <button onClick={e=>{e.stopPropagation();actionBarRef.current?.openPanel('intel','settings');}} style={{ ...mono, fontSize:9, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.1em", color:"#555", background:"transparent", border:"none", cursor:"pointer", display:"flex", alignItems:"center", gap:6, padding:"6px 0 2px", width:"100%" }}>
              <span>Overrides</span>
              <span style={{ fontSize:10, color:"#444", fontWeight:400, textTransform:"none", letterSpacing:0 }}>
                {[(acc.ucs||[]).length>0?`${(acc.ucs||[]).length} use case${(acc.ucs||[]).length!==1?"s":""}`:"",
                  (acc.prods||[]).length>0?`${(acc.prods||[]).length} product${(acc.prods||[]).length!==1?"s":""}`:""]
                  .filter(Boolean).join(" · ")||"none set"}
              </span>
              <span style={{ fontSize:9, color:"#444", marginLeft:"auto" }}>▾</span>
            </button>
          )}

          {acc.dis&&(
            <div style={{ marginTop:12, ...SEC.red, paddingTop:8, paddingBottom:8 }}>
              <p style={{ ...SH, color:"#f87171", margin:"0 0 4px" }}>Disqualifier</p>
              <p style={{ margin:0, fontSize:12, color:"#fca5a5", lineHeight:1.6 }}>{acc.dis}</p>
            </div>
          )}

          {acc.analyzed && !acc.signalBreakdown && onReassay && (
            <div style={{ marginTop:10, padding:"10px 13px", background:`${C.orange}08`, border:`1px solid ${C.orange}33`, borderRadius:7 }}>
              <p style={{ ...mono, margin:"0 0 7px", fontSize:11, fontWeight:500, color:C.orange }}>⚠ Site unreachable — no signal evidence collected</p>
              <p style={{ ...mono, margin:"0 0 8px", fontSize:10, color:C.dim }}>Enter an alternate URL (e.g. LinkedIn, app store, press page) to re-analyze with site content:</p>
              <div style={{ display:"flex", gap:6 }}>
                <input value={webOverride} onChange={e=>setWebOverride(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&webOverride.trim())onReassay({...acc,web:webOverride.trim()});}} placeholder={acc.web||"https://..."} onClick={e=>e.stopPropagation()} style={{ ...mono, flex:1, fontSize:11, padding:"5px 9px", background:C.bg, border:`1px solid ${C.brd}`, borderRadius:4, color:C.txt, outline:"none" }}/>
                <button disabled={reassaying||!webOverride.trim()} onClick={e=>{e.stopPropagation();onReassay({...acc,web:webOverride.trim()});}} style={{ ...mono, fontSize:11, padding:"5px 12px", background:webOverride.trim()?`${C.orange}22`:"transparent", border:`1px solid ${webOverride.trim()?C.orange:C.brd}`, color:webOverride.trim()?C.orange:C.dim, borderRadius:4, cursor:webOverride.trim()?"pointer":"default", whiteSpace:"nowrap" }}>{reassaying?"Analyzing…":"Re-analyze →"}</button>
              </div>
            </div>
          )}

          {(acc.dealStage||acc.stage==="Active Deal")&&(
            <div style={{ marginTop:12, ...SEC.amber, paddingTop:8, paddingBottom:8 }}>
              <p style={{ ...SH, color:"#f59e0b", margin:"0 0 6px" }}>Deal Stage</p>
              <DealStageBar acc={acc} onUpdate={onUpdate}/>
              {acc.stage==="Active Deal"&&<DealComplianceTracker accId={acc.id} accName={acc.name} acc={acc} tasks={tasks} onUpdateTask={onUpdateTask} onUpdateAcc={onUpdate}/>}
            </div>
          )}

          {onUpdate && (
            <AccountCardCompetition acc={acc} onUpdate={patch=>onUpdate({...acc,...patch})} />
          )}

          {onUpdate && (
            <AccountCardRawEdit
              acc={acc}
              onUpdate={patch=>onUpdate({...acc,...patch})}
              onDelete={onRemove?()=>onRemove(acc.id):undefined}
            />
          )}

          {/* ── Win Reason dropdown — Closed Won only ── */}
          {isClosedWon && (
            <div style={{ marginTop:12, padding:"10px 12px", background:C.sur, border:`1px solid ${winReason?C.gold+"44":C.orange+"55"}`, borderRadius:7 }}>
              {!winReason ? (
                <button onClick={e=>{e.stopPropagation();setWinReasonModal(true);}}
                  style={{ ...mono, fontSize:12, padding:"4px 0", background:"transparent", border:"none", color:C.orange, cursor:"pointer", fontWeight:600, letterSpacing:"0.04em" }}>
                  ◆ Add win reason
                </button>
              ) : (
                <>
                  <div onClick={e=>{e.stopPropagation();setWinReasonOpen(o=>!o);}} style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer" }}>
                    <span style={{ ...mono, fontSize:10, color:C.gold, textTransform:"uppercase", letterSpacing:"0.08em", fontWeight:600 }}>◆ Win Reason</span>
                    <span style={{ ...mono, fontSize:11, color:C.txt, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {winReason.top3?.[0] || '—'}
                      {winReason.top3?.length > 1 && <span style={{ color:C.dim }}> · + {winReason.top3.length-1} other{winReason.top3.length-1!==1?'s':''}</span>}
                    </span>
                    <span style={{ ...mono, fontSize:10, color:C.dim }}>{winReasonOpen?"▲":"▼"}</span>
                  </div>
                  {winReasonOpen && (
                    <div style={{ marginTop:8, paddingTop:8, borderTop:`1px solid ${C.brd}` }} onClick={e=>e.stopPropagation()}>
                      {(winReason.top3||[]).map((r,i)=>(
                        <p key={i} style={{ ...mono, margin:"2px 0", fontSize:12, color:C.txt }}>
                          <span style={{ color:C.gold }}>·</span> {r}{r==="Other"&&winReason.otherDetail?`: ${winReason.otherDetail}`:""}
                        </p>
                      ))}
                      {winReason.detail && (
                        <p style={{ margin:"8px 0 0", fontSize:12, color:C.mut, lineHeight:1.6 }}>{winReason.detail}</p>
                      )}
                      <button onClick={()=>setWinReasonModal(true)}
                        style={{ ...mono, marginTop:8, fontSize:11, padding:"3px 10px", background:"transparent", border:`1px solid ${C.brd}`, color:C.mut, borderRadius:4, cursor:"pointer" }}>
                        Edit
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Activity — parity win, previously influencer-only (account-card-unification-and-outreach-v1) ── */}
          <div style={{ marginTop:12 }}>
            <p style={SH}>Activity</p>
            <AccountActivityTimeline acc={acc} />
          </div>

          {/* ── Bottom utility row ── */}
          <div style={{ marginTop:10, paddingTop:8, borderTop:"0.5px solid #1e1e1e", display:"flex", alignItems:"center", gap:6 }}>
            {onFlagRemoval&&<button onClick={e=>{e.stopPropagation();onFlagRemoval(acc,"");}} style={{ ...mono, fontSize:10, height:24, padding:"0 9px", background:"transparent", border:`1px solid ${C.orange}44`, color:C.orange+"99", borderRadius:4, cursor:"pointer" }}>🚩 Flag</button>}
            {onRemove&&(confirmRemove
              ? <><span style={{ ...mono, fontSize:10, color:C.red }}>Remove?</span>
                  <button onClick={e=>{e.stopPropagation();onRemove(acc.id);}} style={{ ...mono, fontSize:10, height:24, padding:"0 9px", background:"#1a0a0a", border:`1px solid ${C.red}`, color:C.red, borderRadius:4, cursor:"pointer" }}>Confirm</button>
                  <button onClick={e=>{e.stopPropagation();setConfirmRemove(false);}} style={{ ...mono, fontSize:10, height:24, padding:"0 8px", background:"transparent", border:"0.5px solid #2a2a2a", color:C.dim, borderRadius:4, cursor:"pointer" }}>Cancel</button></>
              : <button onClick={e=>{e.stopPropagation();setConfirmRemove(true);}} style={{ ...mono, fontSize:10, height:24, padding:"0 9px", background:`${C.red}12`, border:`1px solid ${C.red}55`, color:C.red+"bb", borderRadius:4, cursor:"pointer" }}>✕ Remove</button>
            )}
            {onUpdate&&<div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:5 }}>
              <span style={{ ...mono, fontSize:10, color:"#666" }}>Source</span>
              <select value={acc.source||"Cold"} onChange={e=>onUpdate({...acc,source:e.target.value})} onClick={e=>e.stopPropagation()} style={{ ...mono, fontSize:10, height:24, padding:"0 5px", background:C.sur, border:"0.5px solid #2a2a2a", borderRadius:4, color:SOURCE_C[acc.source||"Cold"]||C.dim, outline:"none", cursor:"pointer" }}>
                {ACCOUNT_SOURCES.map(s=><option key={s} value={s}>{SOURCE_IC[s]} {s}</option>)}
              </select>
            </div>}
          </div>

          {(onRequestLinkParent||onUnlinkParent)&&(
            <div style={{ marginTop:10, display:"flex", alignItems:"center", gap:6 }}>
              {!acc.parentId&&!(acc.childIds&&acc.childIds.length>0)&&onRequestLinkParent&&(
                <button onClick={e=>{e.stopPropagation();onRequestLinkParent();}} style={{ ...mono, fontSize:10, padding:"3px 9px", background:"transparent", border:`1px solid ${T.border.muted}`, color:T.text.muted, borderRadius:3, cursor:"pointer" }}>⊕ Link parent</button>
              )}
              {acc.parentId&&parentName&&onUnlinkParent&&(
                <button onClick={e=>{e.stopPropagation();onUnlinkParent();}} style={{ ...mono, fontSize:10, padding:"3px 9px", background:"transparent", border:`1px solid ${T.border.muted}`, color:T.text.muted, borderRadius:3, cursor:"pointer" }}>⊖ Unlink from parent</button>
              )}
              {acc.childIds&&acc.childIds.length>0&&!acc.parentId&&(
                <span style={{ ...mono, fontSize:10, color:T.text.dim }}>This account has {acc.childIds.length} child{acc.childIds.length===1?"":"ren"} — cannot itself become a child</span>
              )}
            </div>
          )}

        </div>
      )}

      {/* Standalone win-reason modal (business only) */}
      {!isInfluencer && winReasonModal && (
        <div onClick={()=>setWinReasonModal(false)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.76)", zIndex:3000, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
          <div onClick={e=>e.stopPropagation()} style={{ width:560, maxHeight:"90vh", overflowY:"auto", background:C.card, border:`1px solid ${C.gold}55`, borderRadius:12, padding:"22px 24px", boxShadow:"0 24px 64px rgba(0,0,0,0.6)" }}>
            <div style={{ display:"flex", alignItems:"center", marginBottom:14 }}>
              <p style={{ ...mono, margin:0, fontSize:11, color:C.gold, textTransform:"uppercase", letterSpacing:"0.08em", fontWeight:600, flex:1 }}>◆ Win Reason — {acc.name}</p>
              <button onClick={()=>setWinReasonModal(false)} style={{ background:"transparent", border:"none", color:C.dim, fontSize:18, cursor:"pointer", padding:0 }}>✕</button>
            </div>
            <WinReasonPanel acc={acc} initial={winReason} onSaved={data=>{setWinReason({...data,savedAt:new Date().toISOString()});setWinReasonModal(false);}}/>
          </div>
        </div>
      )}
    </div>
  );
}

export { setBdrList, URGENCY_OPTIONS } from '../utils/assignHelper';
export { DEAL_STAGES, PRODUCT_IMPORT_SOURCES, calcPricingAnnual,
         hasPricingFor, hasRoiFor, ROI_KEY, loadRoiFiles, saveRoiFiles,
         PRICING_INTEL_KEY, loadPricingIntel, savePricingIntelForAcc, getPricingIntelForAcc,
         parseAnnualValueStr, extractPricingIntelNumbers,
         ACCOUNT_SOURCES, SOURCE_C, SOURCE_IC, BMP_META,
         Badge, Dot };

const MemoAccountCard = React.memo(AccountCard, (prev, next) => {
  if (prev.acc !== next.acc) return false;
  if (prev.expanded !== next.expanded) return false;
  if (prev.isFav !== next.isFav) return false;
  if (prev.reassaying !== next.reassaying) return false;
  if (prev.assignedEntry !== next.assignedEntry) return false;
  if (prev.tasks !== next.tasks) return false;
  if (prev.activeUser !== next.activeUser) return false;
  if (prev.parentName !== next.parentName) return false;
  return true;
});

export default MemoAccountCard;
