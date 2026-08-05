import React, { useState, useEffect, useRef, useMemo } from 'react';
import { C, mono } from '../constants/colors';
import { getApprovalLevel, PRODUCT_NAME_MAP } from '../constants/approvalMatrix';
import { PF_TIERS, PRICING_PRODUCTS_DEFAULT } from '../constants/products';
import ApprovalBanner from './pricing/ApprovalBanner';
import { loadBlueprints, DEFAULT_BLUEPRINTS, BLUEPRINT_KEY } from './pricing/BlueprintTool';
import { generateBlueprintTSV } from '../utils/blueprintExport';
import SummaryTab from './pricing/SummaryTab';
import HistoryTab from './pricing/HistoryTab';
import CalcTab from './pricing/CalcTab';
import PricingIntelGrid from './pricing/PricingIntelGrid';
import PricingChatPanel from './pricing/PricingChatPanel';
import { FILES_KEY } from '../utils/storageKeys';
import { productMonthlyCost, productMonthlyRack } from '../utils/pricingMath';

// ── Pricing intel helpers ──
const hasPricingFor = id => { try { return !!JSON.parse(localStorage.getItem("prospector_pricing_files")||"{}")[id]; } catch { return false; } };
export const PRODUCTS_OVERRIDE_KEY = "prospector_product_overrides";
export const loadProductOverrides = () => { try { return JSON.parse(localStorage.getItem(PRODUCTS_OVERRIDE_KEY)||"{}"); } catch { return {}; } };

function PricingPage({ accounts=[], launchAccountId=null, onLaunched, onCreateTask, hideAccountPicker=false, summaryMode=false, hideTabs=false, controlledTab=null, activeSnapshotId=null }) {
  const LEGACY_KEY = "prospector_pricing";

  // Per-account pricing sessions: { [accountId]: { products, startUsers, ... } }
  const loadFiles = () => { try { return JSON.parse(localStorage.getItem(FILES_KEY)||"{}"); } catch { return {}; } };
  const saveFiles = files => {
    try {
      localStorage.setItem(FILES_KEY, JSON.stringify(files));
    } catch (e) {
      if (e?.name === 'QuotaExceededError' || e?.code === 22) {
        // Free space by keeping only the newest half of sessions, then retry
        const entries = Object.entries(files).sort((a,b) => {
          const at = a[1]?.savedAt ? new Date(a[1].savedAt).getTime() : 0;
          const bt = b[1]?.savedAt ? new Date(b[1].savedAt).getTime() : 0;
          return bt - at;
        });
        const pruned = Object.fromEntries(entries.slice(0, Math.max(1, Math.floor(entries.length / 2))));
        try { localStorage.setItem(FILES_KEY, JSON.stringify(pruned)); } catch {}
      }
    }
  };

  // Which account is this session linked to (null = unlinked/scratch)
  const [linkedAccId, setLinkedAccId] = useState(null);
  // Account search typeahead
  const [accSearch, setAccSearch] = useState("");
  const [showAccDrop, setShowAccDrop] = useState(false);

  // Load session from per-account files or legacy key
  const loadSession = (accId) => {
    const files = loadFiles();
    const src = accId ? (files[accId] || {}) : (() => { try { return JSON.parse(localStorage.getItem(LEGACY_KEY)||"{}"); } catch { return {}; } })();
    const s = src.startUsers ?? 500;
    const e = src.endUsers   ?? 5000;
    const monthlyUsers = src.monthlyUsers?.length === 12 ? src.monthlyUsers
      : Array.from({length:12}, (_,i) => Math.round(s + (e-s)*i/11));
    const _ov = loadProductOverrides();
    const _base = src.products?.length ? src.products
      : PRICING_PRODUCTS_DEFAULT.map(p => { const r = _ov[p.id]?.rack ?? p.rack; return { ...p, rack: r, custom: r }; });
    return {
      products: _base.map(p => {
        const canonical = PRICING_PRODUCTS_DEFAULT.find(d => d.id === p.id);
        if (!canonical) return p;
        const ov = _ov[p.id] || {};
        return { ...p, type: ov.type ?? canonical.type, rack: ov.rack ?? canonical.rack, discountGroup: ov.discountGroup ?? canonical.discountGroup };
      }),
      monthlyUsers,
      avgAccounts:  src.avgAccounts ?? 2.5,
      onDemand:     src.onDemand    ?? 0,
      commitFee:      src.commitFee      ?? 0,
      commitRamp:     src.commitRamp     ?? false,
      commitRampSched:src.commitRampSched ?? Array(12).fill(0),
      upfrontEnabled: src.upfrontEnabled ?? false,
      upfrontAmount:  src.upfrontAmount  ?? 0,
      pfTier:       src.pfTier      ?? (src.pfBase?.amount>0 ? "base" : null),
      pfDiscount:   src.pfDiscount  ?? {enabled:false, type:"flat", amount:0},
      pfRamp:       src.pfRamp      ?? false,
      pfRampSched:  src.pfRampSched ?? Array(12).fill(0),
      isPartner:    src.isPartner   ?? false,
      partnerFee:   src.partnerFee  ?? 1000,
      tieredPricing: src.tieredPricing ?? false,
      tiers:        src.tiers ?? [{ threshold:10000, discount:0.10 }, { threshold:100000, discount:0.20 }],
      billingStart: src.billingStart ?? "",
    };
  };

  const initSession = loadSession(null);
  const [products,     setProducts]    = useState(initSession.products);
  const [monthlyUsers, setMonthlyUsers]= useState(initSession.monthlyUsers);
  const [avgAccounts,  setAvgAccounts] = useState(initSession.avgAccounts);
  const [onDemand,     setOnDemand]    = useState(initSession.onDemand);
  const [commitFee,       setCommitFee]       = useState(initSession.commitFee);
  const [commitRamp,      setCommitRamp]      = useState(initSession.commitRamp);
  const [commitRampSched, setCommitRampSched] = useState(initSession.commitRampSched);
  const [upfrontEnabled,  setUpfrontEnabled]  = useState(initSession.upfrontEnabled);
  const [upfrontAmount,   setUpfrontAmount]   = useState(initSession.upfrontAmount);
  const [pfTier,     setPfTier]     = useState(initSession.pfTier);
  const [pfDiscount, setPfDiscount] = useState(initSession.pfDiscount);
  const [pfRamp,     setPfRamp]     = useState(initSession.pfRamp);
  const [pfRampSched,setPfRampSched]= useState(initSession.pfRampSched);
  const [isPartner,  setIsPartner]  = useState(initSession.isPartner);
  const [partnerFee, setPartnerFee] = useState(initSession.partnerFee);
  const [tieredPricing, setTieredPricing] = useState(initSession.tieredPricing);
  const [tiers,         setTiers]         = useState(initSession.tiers);
  const [billingStart,  setBillingStart]  = useState(initSession.billingStart);
  // Confidence / error bars: "high"=±10%, "medium"=±25%, "low"=±40%
  const [confidence, setConfidence] = useState("medium");
  const CONF_RANGE = { high:0.10, medium:0.25, low:0.40 };
  const confPct = CONF_RANGE[confidence];
  const [search, setSearch] = useState("");
  const [rateMode, setRateMode] = useState("rate"); // "rate" | "pct" | "dollar"
  const [pricingTab, setPricingTab] = useState("calc");
  const activeTab = controlledTab ?? pricingTab; // DealWorkspace can override
  // Snapshots — named saved versions per account
  const SNAP_KEY = "prospector_pricing_snapshots";
  const [snapshots, setSnapshots] = useState([]);
  const [saveLabel, setSaveLabel] = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [snapDropOpen, setSnapDropOpen] = useState(false);
  const INTEL_GRID_KEY = "prospector_pricing_intel_open";
  const loadIntelOpen = (accId) => { try { return JSON.parse(localStorage.getItem(INTEL_GRID_KEY)||"{}")[accId] !== false; } catch { return false; } };
  const saveIntelOpen = (accId, val) => { try { const m=JSON.parse(localStorage.getItem(INTEL_GRID_KEY)||"{}"); m[accId]=val; localStorage.setItem(INTEL_GRID_KEY,JSON.stringify(m)); } catch {} };
  const [intelGridOpen, setIntelGridOpen] = useState(false);
  // Drag state for growth chart
  const growthSvgRef = useRef(null);
  const [draggingIdx, setDraggingIdx] = useState(null);
  // Snapshot export ref
  const summaryRef = useRef(null);

  // ── Export format system ────────────────────────────────────────────────────
  const FORMAT_KEY = "prospector_export_format";
  const loadFmtPref = () => { try { return JSON.parse(localStorage.getItem(FORMAT_KEY)||"null"); } catch { return null; } };
  const [exportFormat,      setExportFormatRaw]  = useState(() => loadFmtPref()?.active || "default");
  const [customTemplate,    setCustomTemplate]   = useState(() => loadFmtPref()?.customTemplate || "");
  const [savedPersonalFmts, setSavedPersonalFmts]= useState(() => loadFmtPref()?.savedFormats || []);
  const [customDropOpen,    setCustomDropOpen]   = useState(false);
  const [customFmtName,     setCustomFmtName]    = useState("");
  const customTextRef = useRef(null);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [showApprovals, setShowApprovals] = useState(() => localStorage.getItem("prospector_show_approvals") !== "false");
  const [hideForExport, setHideForExport] = useState(false);

  // ── Deck Blueprint system ───────────────────────────────────────────────────
  const [blueprints, setBlueprints] = useState(() => {
    const saved = loadBlueprints();
    if (!saved.length) {
      try { localStorage.setItem(BLUEPRINT_KEY, JSON.stringify(DEFAULT_BLUEPRINTS)); } catch {}
      return DEFAULT_BLUEPRINTS;
    }
    return saved;
  });
  const [selectedBpId, setSelectedBpId] = useState(null);
  const [bpCopied, setBpCopied] = useState(false);
  const toggleApprovals = (v) => { setShowApprovals(v); localStorage.setItem("prospector_show_approvals", String(v)); };
  const teamFormats = [];

  const persistFmt = (id, tpl, fmts) =>
    localStorage.setItem(FORMAT_KEY, JSON.stringify({ active:id, customTemplate:tpl, savedFormats:fmts }));
  const setExportFormat = (id) => { setExportFormatRaw(id); persistFmt(id, customTemplate, savedPersonalFmts); if(id!=="custom")setCustomDropOpen(false); };

  const applySession = (sess) => {
    setProducts(sess.products);
    setMonthlyUsers(sess.monthlyUsers);
    setAvgAccounts(sess.avgAccounts);
    setOnDemand(sess.onDemand);
    setCommitFee(sess.commitFee);
    setCommitRamp(sess.commitRamp);
    setCommitRampSched(sess.commitRampSched);
    setUpfrontEnabled(sess.upfrontEnabled??false);
    setUpfrontAmount(sess.upfrontAmount??0);
    setPfTier(sess.pfTier??null);
    setPfDiscount(sess.pfDiscount);
    setPfRamp(sess.pfRamp);
    setPfRampSched(sess.pfRampSched);
    setTieredPricing(sess.tieredPricing);
    setTiers(sess.tiers);
    setBillingStart(sess.billingStart ?? "");
  };

  // When launchAccountId arrives, switch to that account's session
  useEffect(() => {
    if (!launchAccountId) return;
    const sess = loadSession(launchAccountId);
    setLinkedAccId(launchAccountId);
    const acc = accounts.find(a=>a.id===launchAccountId);
    setAccSearch(acc?.name||"");
    applySession(sess);
    setIntelGridOpen(loadIntelOpen(launchAccountId));
    if (onLaunched) onLaunched();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launchAccountId]);

  // When linkedAccId changes (user picks an account), load that account's session
  const autoFillPendingRef = useRef(false);

  const switchToAccount = (accId) => {
    applySession(loadSession(accId));
    setLinkedAccId(accId);
    setIntelGridOpen(loadIntelOpen(accId));
    // If no pricing file saved yet, auto-trigger prefill from intel on next render
    if (!hasPricingFor(accId)) autoFillPendingRef.current = true;
  };

  const unlinkAccount = () => {
    setLinkedAccId(null);
    setAccSearch("");
    setSnapshots([]);
    setIntelGridOpen(false);
    applySession(loadSession(null));
  };

  // Load snapshots whenever linked account changes
  useEffect(() => {
    if (!linkedAccId) { setSnapshots([]); return; }
    try { setSnapshots((JSON.parse(localStorage.getItem(SNAP_KEY)||"{}")[linkedAccId])||[]); } catch { setSnapshots([]); }
  }, [linkedAccId]);

  // Auto-load snapshot when activeSnapshotId prop arrives (from DealWorkspace / AccountCard launch)
  const appliedSnapRef = useRef(null);
  useEffect(() => {
    if (activeSnapshotId == null) {
      // null = new blank model; only reset if we previously auto-loaded something
      if (appliedSnapRef.current != null) {
        appliedSnapRef.current = null;
        applySession(loadSession(linkedAccId));
      }
      return;
    }
    if (activeSnapshotId === appliedSnapRef.current) return;
    const snap = snapshots.find(s => s.id === activeSnapshotId);
    if (!snap?.session) return;
    appliedSnapRef.current = activeSnapshotId;
    applySession({ ...loadSession(linkedAccId), ...snap.session });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSnapshotId, snapshots]);

  const doSaveSnapshot = (name) => {
    if (!linkedAccId) return;
    const label = name.trim() || `Deal · ${new Date().toLocaleDateString("en-US",{month:"short",day:"numeric"})}`;
    const entry = {
      id: Date.now(),
      name: label,
      savedAt: new Date().toLocaleDateString("en-US",{month:"short",day:"numeric"}),
      // Full session data so we can restore it
      session: {
        products, monthlyUsers, avgAccounts, onDemand, commitFee, commitRamp, commitRampSched,
        upfrontEnabled, upfrontAmount, pfTier, pfDiscount, pfRamp, pfRampSched,
        isPartner, partnerFee, tieredPricing, tiers,
        approvalLevel: calcApproval.overallLevel,
        approvalTriggeredBy: calcApproval.perProduct
          .filter(x => x.discountPct > 0)
          .map(({ p, level }) => ({ productName: p.name, customRate: p.custom, level })),
        approvalStatus: null,
        approvalSubmittedAt: null,
        approvedBy: null,
        approvedAt: null,
      },
    };
    try {
      const all = JSON.parse(localStorage.getItem(SNAP_KEY)||"{}");
      all[linkedAccId] = [entry, ...(all[linkedAccId]||[])];
      localStorage.setItem(SNAP_KEY, JSON.stringify(all));
      setSnapshots(all[linkedAccId]);
    } catch {}
    setSaveLabel("");
    setShowSaveInput(false);
  };

  const loadSnapshot = (snap) => {
    if (!snap.session) return;
    applySession({ ...loadSession(linkedAccId), ...snap.session });
    setSnapDropOpen(false);
  };

  const deleteSnapshot = (snapId) => {
    try {
      const all = JSON.parse(localStorage.getItem(SNAP_KEY)||"{}");
      all[linkedAccId] = (all[linkedAccId]||[]).filter(s=>s.id!==snapId);
      localStorage.setItem(SNAP_KEY, JSON.stringify(all));
      setSnapshots(all[linkedAccId]);
    } catch {}
  };

  const doCreateTask = (snapName, snapId) => {
    if (!onCreateTask) return;
    const title = `Send pricing${linkedAcc?.name ? ` — ${linkedAcc.name}` : ""}${snapName ? ` · ${snapName}` : ""}`;
    onCreateTask({
      type: "Send pricing",
      title,
      accId: linkedAccId || null,
      accName: linkedAcc?.name || null,
      pricingFileId: snapId || null,
      pricingFileName: snapName || null,
      priority: "Medium",
      assignee: "AE",
      status: "Open",
      dueDate: "",
      notes: `${fmt(annualTotal)}/yr · ${selectedCount} product${selectedCount!==1?"s":""}`,
    });
  };

  // Persist whenever anything changes (per-account or legacy)
  useEffect(() => {
    // Preserve existing approval workflow state (status/approver) — only refresh level + triggers
    const existing = linkedAccId ? (loadFiles()[linkedAccId] || {}) : {};
    // Compute approval inline (calcApproval useMemo is declared later in component body)
    const _apiCommit = commitRamp ? (commitRampSched[11] ?? 0) : commitFee;
    const _lvlRank = { "L0":0, "L1":1, "L2":2, "L3":3, "L4":4, "FINANCE":5 };
    const _perProd = products.filter(p => p.included && p.rack != null && p.custom != null).map(p => ({
      productName: p.name, customRate: p.custom,
      level: getApprovalLevel(PRODUCT_NAME_MAP[p.name] || p.name, p.custom, _apiCommit),
    }));
    const _overallLevel = _perProd.reduce((best, x) =>
      (_lvlRank[x.level] || 0) > (_lvlRank[best] || 0) ? x.level : best, "L0");
    const data = {
      products, monthlyUsers, avgAccounts, onDemand, commitFee, commitRamp, commitRampSched,
      upfrontEnabled, upfrontAmount, pfTier, pfDiscount, pfRamp, pfRampSched,
      isPartner, partnerFee, tieredPricing, tiers, billingStart,
      savedAt: new Date().toISOString(),
      approvalLevel: _overallLevel,
      approvalTriggeredBy: _perProd.filter(x => x.level !== "L0"),
      approvalStatus: existing.approvalStatus ?? null,
      approvalSubmittedAt: existing.approvalSubmittedAt ?? null,
      approvedBy: existing.approvedBy ?? null,
      approvedAt: existing.approvedAt ?? null,
    };
    if (linkedAccId) {
      const files = loadFiles();
      files[linkedAccId] = data;
      saveFiles(files);
    } else {
      try { localStorage.setItem(LEGACY_KEY, JSON.stringify(data)); } catch {}
    }
  }, [products, monthlyUsers, avgAccounts, onDemand, commitFee, commitRamp, commitRampSched, pfTier, pfDiscount, pfRamp, pfRampSched, isPartner, partnerFee, tieredPricing, tiers, billingStart, linkedAccId]);

  // Growth chart drag handlers
  const gChartW=780, gChartH=145, gPadT=10, gPadB=63, gPadL=52, gPadR=12;
  const gInnerH = gChartH - gPadT - gPadB;
  const gInnerW = gChartW - gPadL - gPadR;
  const gSlot   = gInnerW / 12;
  const startUsers = monthlyUsers[0];
  const endUsers   = monthlyUsers[11];
  const gMax = Math.max(...monthlyUsers, 100) * 1.4;
  const gYScale = v => gPadT + gInnerH * (1 - Math.max(0, v) / gMax);
  const gXCenter = i => gPadL + i * gSlot + gSlot / 2;
  const lerp12 = (s, e) => Array.from({length:12}, (_,i) => Math.round(s + (e-s)*i/11));

  useEffect(() => {
    if (draggingIdx === null) return;
    const onMove = (e) => {
      const svg = growthSvgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const frac = Math.max(0, Math.min(1, 1 - (clientY - rect.top - gPadT * rect.height/gChartH) / (gInnerH * rect.height/gChartH)));
      const newVal = Math.round(frac * gMax);
      setMonthlyUsers(prev => prev.map((v, i) => i === draggingIdx ? newVal : v));
    };
    const onUp = () => setDraggingIdx(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    window.addEventListener("touchmove", onMove, {passive:false});
    window.addEventListener("touchend",  onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend",  onUp);
    };
  }, [draggingIdx, gMax, gChartH, gPadT, gInnerH]);

  const linkedAcc = linkedAccId ? accounts.find(a=>a.id===linkedAccId) : null;

  // Deal platform fee for a given month
  const tierAmount = PF_TIERS.find(t=>t.id===pfTier)?.amount || 0;
  const discountedTierAmount = pfDiscount.enabled && pfTier
    ? Math.max(0, pfDiscount.type==="pct" ? tierAmount*(1-pfDiscount.amount/100) : tierAmount-pfDiscount.amount)
    : tierAmount;
  const dealPfAt = i => pfRamp ? (pfRampSched[i]??0) : discountedTierAmount;
  const basePfAt = () => tierAmount;
  const commitFloorAt = i => commitRamp ? (commitRampSched[i] ?? 0) : commitFee;
  // Tier discount: based on new users added this month (not total active)
  const tierDiscountAt = i => {
    if (!tieredPricing || !tiers.length) return 0;
    const newUsers = i === 0 ? (monthlyUsers[0] ?? 0) : Math.max(0, (monthlyUsers[i]??0) - (monthlyUsers[i-1]??0));
    const sorted = [...tiers].sort((a,b) => b.threshold - a.threshold);
    return sorted.find(t => newUsers >= t.threshold)?.discount ?? 0;
  };
  const tierLabelAt = i => {
    if (!tieredPricing || !tiers.length) return null;
    const newUsers = i === 0 ? (monthlyUsers[0] ?? 0) : Math.max(0, (monthlyUsers[i]??0) - (monthlyUsers[i-1]??0));
    const sorted = [...tiers].sort((a,b) => b.threshold - a.threshold);
    const hit = sorted.findIndex(t => newUsers >= t.threshold);
    return hit >= 0 ? `T${tiers.length - hit}` : null;
  };

  const toggleIncluded = id => setProducts(ps => ps.map(p => p.id === id ? { ...p, included: !p.included } : p));
  const setCustom = (id, val) => setProducts(ps => ps.map(p => p.id === id ? { ...p, custom: val } : p));
  const setAdoption = (id, val) => setProducts(ps => ps.map(p => p.id === id ? { ...p, adoptionPct: val } : p));

  // Month 0-indexed: use custom monthly curve
  const usersAtMo = i => monthlyUsers[i] ?? 0;
  const newUsersAtMo = i => i === 0 ? monthlyUsers[0] : Math.max(0, (monthlyUsers[i]??0) - (monthlyUsers[i-1]??0));

  // calcCost uses month 1 (i=0) for the product table "mo. cost" column.
  // useCustom toggles between deal (custom) and rack rate for the savings row.
  const calcCost = (p, useCustom) => {
    if (!p.included) return 0;
    const monthCtx = { newUsers: newUsersAtMo(0), activeUsers: usersAtMo(0) };
    const sessionCtx = { avgAccounts, onDemand, tierMult: 1 };
    return useCustom
      ? productMonthlyCost(p, monthCtx, sessionCtx)
      : productMonthlyRack(p, monthCtx, sessionCtx);
  };

  // Annual call/unit volume per product across the 12-month projection
  const prodAnnualVolume = (p) => {
    const adopt = (p.adoptionPct ?? 100) / 100;
    return Math.round(monthlyBreakdown.reduce((s, m) => {
      if (p.type === "S") return s + m.connectedAcctsThisMo * adopt;
      if (p.type === "R") return s + m.activeUsersThisMo * (p.isBundle ? 1 : avgAccounts) * adopt;
      if (p.type === "T") return s + m.activeUsersThisMo * onDemand * adopt;
      return s;
    }, 0));
  };

  const selectedCount = products.filter(p => p.included).length;

  const fmt = n => n == null ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits:2, maximumFractionDigits:2 })}`;
  const fmtK = n => n >= 1000 ? `$${(n/1000).toFixed(1)}k` : fmt(n);
  const fmtRate = n => n == null ? "—" : `$${Number(n).toFixed(3)}`;

  const TYPE_LABEL = { S:"Single", R:"Recurring", T:"On-demand" };
  const TYPE_COLOR = { S:C.blue, R:C.purple, T:C.orange };
  const filtered = products.filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()));

  // 12-month projection: lerp start→end users, charge new onboardings at Single rate, all active at Recurring
  const monthlyBreakdown = useMemo(() => {
    const included = products.filter(p => p.included);
    return Array.from({ length: 12 }, (_, i) => {
      const mo = i + 1;
      const activeUsersThisMo = usersAtMo(i);
      const newUsersThisMo = newUsersAtMo(i);
      const connectedAcctsThisMo = newUsersThisMo * avgAccounts;
      // Tier discount multiplier for this month
      const tierDisc = tierDiscountAt(i);
      const tierMult = 1 - tierDisc;
      const tierLbl  = tierLabelAt(i);
      // Deal (custom) rates × tier multiplier × per-product adoption %
      const singleCost    = included.filter(p=>p.type==="S").reduce((s,p)=>{ const r=p.custom??p.rack; const a=(p.adoptionPct??100)/100; return r!=null?s+r*connectedAcctsThisMo*a:s; },0) * tierMult;
      const recurringCost = included.filter(p=>p.type==="R").reduce((s,p)=>{ const r=p.custom??p.rack; const a=(p.adoptionPct??100)/100; return r!=null?s+r*activeUsersThisMo*(p.isBundle?1:avgAccounts)*a:s; },0) * tierMult;
      const onDemandCost  = included.filter(p=>p.type==="T").reduce((s,p)=>{ const r=p.custom??p.rack; const a=(p.adoptionPct??100)/100; return r!=null?s+r*onDemand*activeUsersThisMo*a:s; },0) * tierMult;
      const apiSpend  = singleCost + recurringCost + onDemandCost;
      const floorThisMo = commitFloorAt(i);
      const apiCharge = floorThisMo > 0 ? Math.max(apiSpend, floorThisMo) : apiSpend;
      const dealPf       = dealPfAt(i);
      const partnerFeeMo = isPartner ? (partnerFee||0) : 0;
      const total        = apiCharge + dealPf + partnerFeeMo;
      // Base (rack) rates — for savings comparison (adoption applied consistently)
      const baseSingle    = included.filter(p=>p.type==="S").reduce((s,p)=>{ const a=(p.adoptionPct??100)/100; return p.rack!=null?s+p.rack*connectedAcctsThisMo*a:s; },0);
      const baseRecurring = included.filter(p=>p.type==="R").reduce((s,p)=>{ const a=(p.adoptionPct??100)/100; return p.rack!=null?s+p.rack*activeUsersThisMo*(p.isBundle?1:avgAccounts)*a:s; },0);
      const baseOnDemand  = included.filter(p=>p.type==="T").reduce((s,p)=>{ const a=(p.adoptionPct??100)/100; return p.rack!=null?s+p.rack*onDemand*activeUsersThisMo*a:s; },0);
      const baseApiSpend  = baseSingle + baseRecurring + baseOnDemand;
      const baseApiCharge = floorThisMo > 0 ? Math.max(baseApiSpend, floorThisMo) : baseApiSpend;
      const basePf        = basePfAt();
      const baseTotal     = baseApiCharge + basePf + partnerFeeMo;
      const savings       = baseTotal - total;
      return { mo, activeUsersThisMo, newUsersThisMo, connectedAcctsThisMo, singleCost, recurringCost, onDemandCost, apiSpend, apiCharge, floorThisMo, dealPf, partnerFeeMo, total, baseTotal, basePf, savings, tierDisc, tierLbl };
    });
  }, [products, monthlyUsers, avgAccounts, onDemand, commitFee, commitRamp, commitRampSched, pfTier, pfDiscount, pfRamp, pfRampSched, isPartner, partnerFee, tieredPricing, tiers]);

  // Product name map: PRICING_PRODUCTS_DEFAULT names → approvalMatrix keys

  const LEVEL_RANK = { "L0":0, "L1":1, "L2":2, "L3":3, "L4":4, "FINANCE":5 };

  const calcApproval = useMemo(() => {
    const apiCommit = commitRamp ? (commitRampSched[11] ?? 0) : commitFee;
    const zeroMin = apiCommit === 0;
    const perProduct = products.filter(p => p.included && p.rack != null && p.custom != null).map(p => {
      const discountPct = Math.max(0, (p.rack - p.custom) / p.rack);
      const matrixName = PRODUCT_NAME_MAP[p.name] || p.name;
      const level = getApprovalLevel(matrixName, p.custom, apiCommit);
      return { p, discountPct, level, matrixName };
    });
    const overallLevel = perProduct.reduce((best, x) =>
      (LEVEL_RANK[x.level] || 0) > (LEVEL_RANK[best] || 0) ? x.level : best, "L0");
    return { perProduct, overallLevel, apiCommit, zeroMin };
  }, [products, commitFee, commitRamp, commitRampSched]);

  const annualTotal     = monthlyBreakdown.reduce((s, m) => s + m.total, 0);
  const annualBase      = monthlyBreakdown.reduce((s, m) => s + m.baseTotal, 0);
  const annualSavings   = monthlyBreakdown.reduce((s, m) => s + m.savings, 0);
  const mo1 = monthlyBreakdown[0];
  const mo12 = monthlyBreakdown[11];
  const annualSingleTotal    = monthlyBreakdown.reduce((s,m)=>s+m.singleCost,    0);
  const annualRecurringTotal = monthlyBreakdown.reduce((s,m)=>s+m.recurringCost, 0);
  const annualOnDemandTotal  = monthlyBreakdown.reduce((s,m)=>s+m.onDemandCost,  0);
  const annualPfTotal        = monthlyBreakdown.reduce((s,m)=>s+m.dealPf,        0);
  // Minimum = what they owe with zero users: commitment floor + platform fee only
  const annualPartnerFeeTotal    = monthlyBreakdown.reduce((s,m)=>s+m.partnerFeeMo,  0);
  const minimumAnnual = Array.from({length:12}, (_,i) => commitFloorAt(i) + dealPfAt(i) + (isPartner ? (partnerFee||0) : 0)).reduce((s,v)=>s+v, 0);
  // Confidence range totals (scale user-driven variable cost only, not floor/platform fees)
  const annualBest         = Math.round(minimumAnnual + (annualTotal - minimumAnnual) * (1 + confPct));
  const annualConservative = Math.round(minimumAnnual + (annualTotal - minimumAnnual) * (1 - confPct));
  // Per-month best/conservative for chart lines
  const monthlyBest         = monthlyBreakdown.map(m => Math.round((m.floorThisMo>0?m.floorThisMo:0) + m.dealPf + m.partnerFeeMo + (m.apiSpend * (1 + confPct))));
  const monthlyConservative = monthlyBreakdown.map(m => Math.round((m.floorThisMo>0?m.floorThisMo:0) + m.dealPf + m.partnerFeeMo + (m.apiSpend * (1 - confPct))));
  const variableAnnual = annualTotal - minimumAnnual;

  const buildPricingContext = () => {
    const includedProducts = products.filter(p => p.included);
    const savPct = annualBase > 0 ? Math.round(Math.abs(annualSavings) / annualBase * 100) : 0;
    return `
ACCOUNT: ${linkedAcc?.name || "Unknown"}
Vertical: ${linkedAcc?.vert || "—"} | Stage: ${linkedAcc?.stage || "—"} | Tier: ${linkedAcc?.tier || "—"}
Business Model: ${(linkedAcc?.bm || "").slice(0, 300) || "—"}
Product Fit: ${(linkedAcc?.pf || "").slice(0, 200) || "—"}

PRICING SESSION:
Products: ${includedProducts.map(p => `${p.name} (${p.type}) rack $${p.rack} custom $${p.custom ?? p.rack}`).join(", ")}
Platform Fee: ${pfTier || "none"}${pfDiscount?.enabled ? " discounted" : ""}
Commitment Fee: $${commitFee}/yr
Monthly users: Mo.1 ${monthlyUsers[0]} → Mo.12 ${monthlyUsers[11]}
Avg accounts/user: ${avgAccounts}
Annual total (projected): $${Math.round(annualTotal).toLocaleString()}
Rack total: $${Math.round(annualBase).toLocaleString()}
Savings vs rack: $${Math.round(annualSavings).toLocaleString()} (${savPct}%)

MEDPICC (if available):
Metrics: ${(linkedAcc?.medpicc?.metrics || "").slice(0, 150) || "—"}
Economic Buyer: ${(linkedAcc?.medpicc?.economic_buyer || "").slice(0, 100) || "—"}
Champion: ${(linkedAcc?.medpicc?.champion || "").slice(0, 100) || "—"}

CALL INTEL (${(linkedAcc?.calls || []).length} calls logged):
${(linkedAcc?.calls || []).length === 0 ? "No calls logged." : (linkedAcc.calls.map((c, i) => {
  const pains = (c.painPoints || []).map(p => typeof p === "string" ? p : (p?.topic || "")).filter(Boolean);
  const steps = (c.nextSteps || []).map(ns => typeof ns === "string" ? ns : (ns?.text || "")).filter(Boolean);
  const blockers = (c.blockers || []).filter(Boolean);
  const questions = (c.openQuestions || []).filter(Boolean);
  return [
    `Call ${i + 1} (${c.date}${c.callQuality ? " · " + c.callQuality : ""}):`,
    c.summary       ? "  Summary: " + c.summary.slice(0, 400)                       : null,
    c.decisionMaker ? "  Decision maker: " + c.decisionMaker                        : null,
    c.timeline      ? "  Timeline: " + c.timeline                                   : null,
    pains.length    ? "  Pain points: " + pains.join("; ")                          : null,
    (c.productsDiscussed||[]).length ? "  Products discussed: " + c.productsDiscussed.join(", ") : null,
    steps.length    ? "  Next steps: " + steps.join("; ")                           : null,
    blockers.length ? "  Blockers: " + blockers.join("; ")                          : null,
    questions.length? "  Open questions: " + questions.join("; ")                   : null,
  ].filter(Boolean).join("\n");
}).join("\n\n"))}
    `.trim();
  };

  const activeTierObj = PF_TIERS.find(t=>t.id===pfTier)||null;
  const activeDealPfLabel = pfRamp ? "Ramp schedule" : !pfTier ? "None" : pfDiscount.enabled ? `${activeTierObj?.label} (discounted)` : activeTierObj?.label||"None";

  // SVG donut arc path helper
  const donutArc = (cx, cy, R, r, a1, a2) => {
    const rad = d => (d - 90) * Math.PI / 180;
    const x1=cx+R*Math.cos(rad(a1)), y1=cy+R*Math.sin(rad(a1));
    const x2=cx+R*Math.cos(rad(a2)), y2=cy+R*Math.sin(rad(a2));
    const ix1=cx+r*Math.cos(rad(a2)), iy1=cy+r*Math.sin(rad(a2));
    const ix2=cx+r*Math.cos(rad(a1)), iy2=cy+r*Math.sin(rad(a1));
    const lg = (a2-a1)>180?1:0;
    return `M ${x1} ${y1} A ${R} ${R} 0 ${lg} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${r} ${r} 0 ${lg} 0 ${ix2} ${iy2} Z`;
  };

  // ── Format helpers ───────────────────────────────────────────────────────────
  const PLACEHOLDERS = [
    { key:"company",      label:"company" },
    { key:"products",     label:"products" },
    { key:"annual_cost",  label:"annual_cost" },
    { key:"monthly_cost", label:"monthly_cost" },
    { key:"rack_total",   label:"rack_total" },
    { key:"savings",      label:"savings" },
    { key:"platform_fee", label:"platform_fee" },
    { key:"roi_percent",  label:"roi_percent" },
    { key:"mo1_cost",     label:"mo1_cost" },
    { key:"mo12_cost",    label:"mo12_cost" },
    { key:"growth_curve", label:"growth_curve" },
  ];

  const fmtPlaceholders = () => {
    const selected = products.filter(p=>p.included);
    const savPct = annualBase > 0 ? Math.round(Math.abs(annualSavings)/annualBase*100) : 0;
    return {
      company:      linkedAcc?.name || "Company",
      products:     selected.map(p=>p.name).join(", ") || "—",
      annual_cost:  fmt(Math.round(annualTotal)),
      monthly_cost: fmt(Math.round(annualTotal/12)),
      rack_total:   fmt(Math.round(annualBase)),
      savings:      annualSavings > 0 ? `${fmt(Math.round(annualSavings))} (${savPct}% off)` : "—",
      platform_fee: annualPfTotal > 0 ? `${fmt(Math.round(annualPfTotal))}/yr` : "None",
      roi_percent:  "—",
      mo1_cost:     fmt(Math.round(mo1?.total||0)),
      mo12_cost:    fmt(Math.round(mo12?.total||0)),
      growth_curve: `Mo 1: ${startUsers.toLocaleString()} → Mo 12: ${endUsers.toLocaleString()} users`,
    };
  };

  const getSimpleText = () => {
    const selected = products.filter(p=>p.included);
    if (!selected.length) return "No products selected.";
    const maxName = Math.max(...selected.map(p=>p.name.length), 7);
    const pad = (s,n) => s+" ".repeat(Math.max(0,n-s.length));
    const prodAnnualCost = p => {
      const c = p.custom ?? p.rack ?? 0;
      return monthlyBreakdown.reduce((s,m) => {
        if(p.type==="S") return s+c*m.newUsersThisMo*avgAccounts;
        if(p.type==="R") return s+c*m.activeUsersThisMo;
        if(p.type==="T") return s+c*onDemand*m.activeUsersThisMo;
        return s;
      }, 0);
    };
    return [
      linkedAcc ? `${linkedAcc.name} — Pricing Summary` : "Pricing Summary",
      "─".repeat(52),
      `${pad("Product", maxName+2)}  Rate        Annual`,
      "─".repeat(52),
      ...selected.map(p => `${pad(p.name, maxName+2)}  ${pad(fmtRate(p.custom??p.rack??0),12)}  ${fmt(Math.round(prodAnnualCost(p)))}`),
      "─".repeat(52),
      `${pad("TOTAL", maxName+2)}               ${fmt(Math.round(annualTotal))}`,
    ].join("\n");
  };

  const getExecText = () => {
    const selected = products.filter(p=>p.included);
    const savPct = annualBase > 0 ? Math.round(Math.abs(annualSavings)/annualBase*100) : 0;
    return [
      linkedAcc ? `${linkedAcc.name} — Pricing` : "Pricing",
      "",
      `Annual investment:  ${fmt(Math.round(annualTotal))}`,
      `Key products:             ${selected.map(p=>p.name).join(", ")||"—"}`,
      annualSavings > 0 ? `vs rack rate:             save ${fmt(Math.round(annualSavings))} (${savPct}% off)` : null,
      annualPfTotal > 0 ? `Platform fee:             ${fmt(Math.round(annualPfTotal))}/yr` : null,
      `Monthly range:            ${fmt(Math.round(mo1?.total||0))} (Mo 1)  →  ${fmt(Math.round(mo12?.total||0))} (Mo 12)`,
    ].filter(Boolean).join("\n");
  };

  const applyCustomTemplate = (tpl) => {
    const vals = fmtPlaceholders();
    return tpl.replace(/\[(\w+)\]/g, (m,key) => vals[key] !== undefined ? vals[key] : m);
  };

  const getSummaryText = () => {
    const selected = products.filter(p=>p.included);
    const maxName = Math.max(...selected.map(p=>p.name.length), 10);
    const pad = (s, n) => s + " ".repeat(Math.max(0, n-s.length));
    const lines = [
      linkedAcc ? `PRICING SUMMARY — ${linkedAcc.name}` : `PRICING SUMMARY`,
      `${"─".repeat(60)}`,
      ``,
      `User growth:  Mo 1: ${startUsers.toLocaleString()}  →  Mo 12: ${endUsers.toLocaleString()}`,
      `Avg connected accounts/user: ${avgAccounts}`,
      onDemand > 0 ? `On-demand calls/user/mo: ${onDemand.toLocaleString()}` : null,
      commitRamp ? `API commitment: ramp schedule (${fmt(commitRampSched.reduce((s,v)=>s+v,0))}/yr)` : commitFee > 0 ? `API commitment floor: ${fmt(commitFee)}/mo` : null,
      tieredPricing ? `Pricing model: Tiered` : null,
      ...(tieredPricing ? tiers.map((t,i)=>`  Tier ${i+1}: ≥ ${t.threshold.toLocaleString()} users → ${Math.round(t.discount*100)}% off`) : []),
      ...(tieredPricing && selected.length ? [
        ``,
        `EFFECTIVE RATES AFTER TIER DISCOUNTS`,
        `${"─".repeat(60)}`,
        `${pad("Product", maxName+2)}${pad("Custom",10)}${tiers.map((_,i)=>pad(`Tier ${i+1}`,10)).join("")}`,
        ...selected.filter(p=>(p.custom??p.rack)!=null).map(p => {
          const base = p.custom??p.rack;
          return `${pad(p.name,maxName+2)}${pad(fmtRate(base),10)}${tiers.map(t=>pad(fmtRate(base*(1-t.discount)),10)).join("")}`;
        }),
      ] : []),
      ``,
      `PRODUCTS (${selected.length})`,
      `${"─".repeat(60)}`,
      ...selected.map(p=>`${pad(p.name, maxName+2)}${pad(TYPE_LABEL[p.type],12)}rack ${fmtRate(p.rack)}   custom ${fmtRate(p.custom??p.rack)}`),
      ``,
      `PLATFORM FEE: ${activeDealPfLabel}`,
      pfTier ? `  Tier: ${activeTierObj?.label} ${fmt(tierAmount)}/mo  (${fmt(tierAmount*12)}/yr)` : null,
      pfDiscount.enabled&&pfTier ? `  Client discount: ${pfDiscount.type==="pct"?`${pfDiscount.amount}% off`:`-${fmt(pfDiscount.amount)}/mo`} → ${fmt(discountedTierAmount)}/mo` : null,
      ``,
      `ANNUAL TOTALS`,
      `${"─".repeat(60)}`,
      `  Single (onboarding)  ${fmt(annualSingleTotal)}`,
      `  Recurring (monthly)  ${fmt(annualRecurringTotal)}`,
      annualOnDemandTotal > 0 ? `  On-demand            ${fmt(annualOnDemandTotal)}` : null,
      annualPfTotal > 0       ? `  Platform fee         ${fmt(annualPfTotal)}` : null,
      `  ${"─".repeat(36)}`,
      `  DEAL TOTAL           ${fmt(annualTotal)}`,
      `  Rack total           ${fmt(annualBase)}`,
      annualSavings !== 0 ? `  Savings vs rack      ${annualSavings>=0?"▲":"▼"} ${fmt(Math.abs(annualSavings))} (${annualBase>0?Math.round(Math.abs(annualSavings)/annualBase*100):0}%)` : null,
      ``,
      `  Minimum (lock-in)    ${fmt(minimumAnnual)}   ← zero-user floor`,
      `  Variable (user-driven) ${fmt(variableAnnual)}`,
      `  Projected total      ${fmt(annualTotal)}`,
      ``,
      `  Mo 1: ${fmt(mo1.total)}  /  Mo 12: ${fmt(mo12.total)}`,
    ].filter(l => l !== null);
    return lines.join("\n");
  };

  const getFormattedText = (fmtId) => {
    const id = fmtId || exportFormat;
    if (id === "simple")  return getSimpleText();
    if (id === "exec")    return getExecText();
    if (id === "custom")  return applyCustomTemplate(customTemplate);
    const pf = savedPersonalFmts.find(f=>f.id===id);
    if (pf) return applyCustomTemplate(pf.template);
    const tf = teamFormats.find(f=>f.id===id);
    if (tf) return applyCustomTemplate(tf.template);
    return getSummaryText();
  };

  const doExportPDF = () => {
    if (!summaryRef.current) return;
    const isDefault = exportFormat === "default";
    const html = isDefault ? summaryRef.current.innerHTML : `<pre style="font-family:ui-monospace,monospace;font-size:13px;line-height:1.7;white-space:pre-wrap;word-break:break-word;">${getFormattedText().replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</pre>`;
    const win = window.open("", "_blank");
    if (!win) return;
    const title = linkedAcc ? `${linkedAcc.name} — Pricing Summary` : "Pricing Summary";
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>
      *{box-sizing:border-box;margin:0;padding:0;}
      body{background:#fff;color:#111;font-family:ui-monospace,"Courier New",monospace;padding:32px;max-width:980px;margin:0 auto;}
      /* Force all text to dark */
      *{color:#111!important;}
      span[style],div[style],p[style]{color:#111!important;}
      /* Exceptions — keep colour hints for key numbers */
      [data-col="gold"]{color:#b8860b!important;}
      /* Borders to light grey */
      *{border-color:#ddd!important;background-color:transparent!important;}
      /* SVG overrides */
      svg text{fill:#333!important;}
      svg line,svg polyline{stroke:#999!important;}
      svg rect,svg circle,svg path{opacity:0.85!important;}
      /* Input fields — hide in print */
      input,button{display:none!important;}
      /* Sliders */
      input[type=range]{display:none!important;}
      img{max-width:100%;}
      table{border-collapse:collapse;width:100%;}
      td,th{border:1px solid #ddd;padding:4px 8px;}
      @media print{body{padding:16px;}}
    </style></head><body>
    <h2 style="font-family:ui-monospace,monospace;font-size:16px;margin-bottom:4px;border-bottom:2px solid #ccc;padding-bottom:8px;color:#111!important;">${title}</h2>
    <p style="font-size:10px;color:#666!important;margin-bottom:20px;">Generated ${new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}</p>
    ${html}
    </body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 400);
  };

  const doScreenshot = () => {
    if (!summaryRef.current) return;
    // Hide approval UI before capturing — must never appear in customer-facing exports
    setHideForExport(true);
    setTimeout(() => {
      const el = summaryRef.current;
      const capture = () => {
        window.html2canvas(el, { backgroundColor: "#0d0d0d", scale: 2, useCORS: true, logging: false }).then(canvas => {
          const link = document.createElement("a");
          const name = linkedAcc ? `${linkedAcc.name.replace(/\s+/g,"-")}-pricing.png` : "pricing-snapshot.png";
          link.download = name;
          link.href = canvas.toDataURL("image/png");
          link.click();
          setHideForExport(false);
        });
      };
      if (window.html2canvas) {
        capture();
      } else {
        const s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
        s.onload = capture;
        document.head.appendChild(s);
      }
    }, 50);
  };

  const copyBlueprintTSV = () => {
    const bp = blueprints.find(b => b.id === selectedBpId);
    if (!bp) return;
    const session = { products, monthlyUsers, avgAccounts, onDemand, commitFee, commitRamp, commitRampSched };
    const tsv = generateBlueprintTSV(bp, session);
    navigator.clipboard.writeText(tsv).then(() => { setBpCopied(true); setTimeout(() => setBpCopied(false), 3000); });
  };

  // gMax (used for growth chart y-axis) also drives user slider maxes

  // ── Format Selector Bar (rendered in both export surfaces) ──────────────────
  const renderFormatBar = () => {
    const allFmts = [
      { id:"default", label:"Default" },
      { id:"simple",  label:"Simple"  },
      { id:"exec",    label:"Exec"    },
      ...savedPersonalFmts.map(f=>({ id:f.id, label:f.name })),
      ...teamFormats.map(f=>({ id:f.id, label:`⊞ ${f.name}` })),
      { id:"custom",  label:"Custom ▾" },
    ];

    const saveCustomFmt = () => {
      if (!customFmtName.trim()) return;
      const newFmt = { id: Date.now().toString(), name: customFmtName.trim(), template: customTemplate };
      const updated = [...savedPersonalFmts, newFmt];
      setSavedPersonalFmts(updated);
      setExportFormatRaw(newFmt.id);
      persistFmt(newFmt.id, customTemplate, updated);
      setCustomFmtName("");
      setCustomDropOpen(false);
    };

    const deletePersonalFmt = (id) => {
      const updated = savedPersonalFmts.filter(f=>f.id!==id);
      setSavedPersonalFmts(updated);
      if (exportFormat===id) setExportFormatRaw("default");
      persistFmt(exportFormat===id?"default":exportFormat, customTemplate, updated);
    };

    const insertPlaceholder = (key) => {
      const el = customTextRef.current;
      if (!el) { setCustomTemplate(t=>t+`[${key}]`); return; }
      const start = el.selectionStart, end = el.selectionEnd;
      const ins = `[${key}]`;
      const next = customTemplate.slice(0,start)+ins+customTemplate.slice(end);
      setCustomTemplate(next);
      persistFmt(exportFormat, next, savedPersonalFmts);
      requestAnimationFrame(()=>{ el.setSelectionRange(start+ins.length, start+ins.length); el.focus(); });
    };

    const previewText = exportFormat === "custom" ? applyCustomTemplate(customTemplate) : getFormattedText();

    return (
      <div style={{ borderBottom:`1px solid ${C.brd}22`, paddingBottom:10, marginBottom:10 }}>
        {/* Pills row */}
        <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
          <span style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginRight:2, flexShrink:0 }}>Format</span>
          {allFmts.map(f => {
            const isActive = exportFormat === f.id;
            const isTeam   = teamFormats.some(t=>t.id===f.id);
            const isSaved  = savedPersonalFmts.some(p=>p.id===f.id);
            const color    = isTeam ? C.purple : f.id==="exec" ? C.gold : f.id==="simple" ? C.blue : f.id==="custom" ? C.orange : C.txt;
            return (
              <div key={f.id} style={{ display:"flex", alignItems:"center", gap:0 }}>
                <button
                  onClick={() => { if(f.id==="custom"){ setCustomDropOpen(o=>!o); setExportFormatRaw("custom"); persistFmt("custom",customTemplate,savedPersonalFmts); } else { setExportFormat(f.id); } }}
                  style={{ ...mono, fontSize:11, padding:"3px 10px", borderRadius:isSaved||isTeam?"12px 0 0 12px":"12px", border:`1px solid ${isActive?(isTeam?C.purple:isActive?color:C.brd):C.brd}`, background:isActive?`${color}1A`:"transparent", color:isActive?color:C.dim, cursor:"pointer", transition:"all 0.1s", fontWeight:isActive?600:400 }}>
                  {f.label}
                </button>
                {(isSaved) && (
                  <button onClick={()=>deletePersonalFmt(f.id)}
                    style={{ ...mono, fontSize:9, padding:"3px 6px", borderRadius:"0 12px 12px 0", border:`1px solid ${isActive?color:C.brd}`, borderLeft:"none", background:isActive?`${color}1A`:"transparent", color:C.dim, cursor:"pointer", lineHeight:1 }}>✕</button>
                )}
              </div>
            );
          })}
          {exportFormat !== "default" && (
            <span style={{ ...mono, fontSize:10, color:C.dim, marginLeft:2 }}>
              {exportFormat==="simple"?"Minimal: product / rate / cost only":
               exportFormat==="exec"?"Executive: headline numbers only":
               exportFormat==="custom"?"Custom template":"Saved format"}
            </span>
          )}
        </div>

        {/* Custom dropdown */}
        {customDropOpen && (
          <div style={{ marginTop:10, padding:"12px 14px", background:C.card, border:`1px solid ${C.orange}33`, borderRadius:8 }}>
            {/* Placeholder chips */}
            <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:8 }}>
              <span style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", alignSelf:"center", marginRight:4 }}>Insert</span>
              {PLACEHOLDERS.map(p => (
                <button key={p.key} onClick={()=>insertPlaceholder(p.key)}
                  style={{ ...mono, fontSize:10, padding:"2px 8px", background:`${C.orange}0d`, border:`1px solid ${C.orange}33`, borderRadius:12, color:C.orange, cursor:"pointer" }}>
                  [{p.label}]
                </button>
              ))}
            </div>
            {/* Template textarea */}
            <textarea
              ref={customTextRef}
              value={customTemplate}
              onChange={e=>{ setCustomTemplate(e.target.value); persistFmt("custom",e.target.value,savedPersonalFmts); }}
              placeholder={"[company] Pricing\n\nAnnual cost: [annual_cost]\nProducts: [products]\nSavings vs rack: [savings]"}
              rows={5}
              style={{ ...mono, fontSize:12, width:"100%", padding:"8px 10px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:6, color:C.txt, outline:"none", resize:"vertical", boxSizing:"border-box", lineHeight:1.6 }}/>
            {/* Live preview */}
            {customTemplate && (
              <div style={{ marginTop:8 }}>
                <span style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", display:"block", marginBottom:4 }}>Preview</span>
                <pre style={{ ...mono, fontSize:11, color:C.mut, background:C.sur, border:`1px solid ${C.brd}33`, borderRadius:5, padding:"8px 10px", margin:0, whiteSpace:"pre-wrap", wordBreak:"break-word", maxHeight:120, overflowY:"auto" }}>{previewText}</pre>
              </div>
            )}
            {/* Save row */}
            <div style={{ display:"flex", gap:8, alignItems:"center", marginTop:10 }}>
              <input value={customFmtName} onChange={e=>setCustomFmtName(e.target.value)} placeholder="Format name…"
                style={{ ...mono, fontSize:12, flex:1, padding:"5px 8px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:5, color:C.txt, outline:"none" }}
                onKeyDown={e=>e.key==="Enter"&&saveCustomFmt()}/>
              <button onClick={saveCustomFmt} disabled={!customFmtName.trim()||!customTemplate.trim()}
                style={{ ...mono, fontSize:11, padding:"5px 12px", background:customFmtName.trim()&&customTemplate.trim()?C.goldBg:"transparent", border:`1px solid ${customFmtName.trim()&&customTemplate.trim()?C.goldBdr:C.brd}`, color:customFmtName.trim()&&customTemplate.trim()?C.gold:C.dim, borderRadius:5, cursor:customFmtName.trim()&&customTemplate.trim()?"pointer":"not-allowed" }}>
                Save as pill
              </button>
              <button onClick={()=>setCustomDropOpen(false)} style={{ ...mono, fontSize:11, padding:"5px 10px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:5, cursor:"pointer" }}>Done</button>
            </div>
            {/* Team formats */}
            {teamFormats.length > 0 && (
              <div style={{ marginTop:10, paddingTop:8, borderTop:`1px solid ${C.brd}22` }}>
                <span style={{ ...mono, fontSize:9, color:C.purple, textTransform:"uppercase", letterSpacing:"0.06em", display:"block", marginBottom:6 }}>Team formats</span>
                <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                  {teamFormats.map(f=>(
                    <button key={f.id} onClick={()=>{ setExportFormat(f.id); setCustomDropOpen(false); }}
                      style={{ ...mono, fontSize:11, padding:"3px 10px", borderRadius:12, border:`1px solid ${C.purple}44`, background:`${C.purple}0d`, color:C.purple, cursor:"pointer" }}>
                      {f.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // SVG chart helpers
  const chartW = 780, chartH = 160, padT = 12, padB = 36, padL = 56, padR = 12;
  const innerW = chartW - padL - padR;
  const innerH = chartH - padT - padB;
  const maxVal = Math.max(...monthlyBreakdown.map(m => Math.max(m.total, m.baseTotal)), ...monthlyBest, commitFee, 1);
  const barSlot = innerW / 12;
  const barW = barSlot * 0.6;
  const yScale = v => padT + innerH * (1 - v / maxVal);
  const xCenter = i => padL + i * barSlot + barSlot / 2;

  return (
    <div>
      <style>{`
        .pc-slider { -webkit-appearance:none; appearance:none; width:100%; height:4px; border-radius:2px; outline:none; cursor:pointer; }
        .pc-slider::-webkit-slider-thumb { -webkit-appearance:none; width:16px; height:16px; border-radius:50%; cursor:pointer; margin-top:-6px; }
        .pc-slider::-webkit-slider-runnable-track { height:4px; border-radius:2px; }
        .pc-slider-blue::-webkit-slider-runnable-track { background:${C.blue}44; }
        .pc-slider-blue::-webkit-slider-thumb { background:${C.blue}; }
        .pc-slider-green::-webkit-slider-runnable-track { background:${C.green}44; }
        .pc-slider-green::-webkit-slider-thumb { background:${C.green}; }
        .pc-slider-orange::-webkit-slider-runnable-track { background:${C.orange}44; }
        .pc-slider-orange::-webkit-slider-thumb { background:${C.orange}; }
      `}</style>

      {/* Account search — hidden when DealWorkspace controls the account */}
      {!hideAccountPicker && (() => {
        const pricingFiles = loadFiles();
        const dropList = accounts.length === 0 ? [] :
          accSearch.trim() ? accounts.filter(a=>a.name.toLowerCase().includes(accSearch.toLowerCase())).slice(0,12)
          : accounts.slice(0,20);
        return (
          <div style={{ marginBottom:14 }}>
            <div style={{ position:"relative" }}>
              <div style={{ display:"flex", alignItems:"center", background:C.sur, border:`1px solid ${linkedAcc ? C.gold+"66" : C.brd}`, borderRadius:8, overflow:"hidden" }}>
                <span style={{ ...mono, fontSize:13, color:C.dim, padding:"0 10px 0 14px", flexShrink:0 }}>⌕</span>
                <input
                  value={accSearch}
                  onChange={e=>{setAccSearch(e.target.value);setShowAccDrop(true);}}
                  onFocus={()=>setShowAccDrop(true)}
                  onBlur={()=>setTimeout(()=>{setShowAccDrop(false);if(linkedAcc&&!accSearch.trim())setAccSearch(linkedAcc.name);},150)}
                  placeholder={accounts.length ? "Search accounts to link pricing…" : "No accounts yet — add some in Accounts"}
                  style={{ ...mono, fontSize:13, flex:1, padding:"10px 4px", background:"transparent", border:"none", color:C.txt, outline:"none" }}
                />
                {linkedAcc && (
                  <div style={{ display:"flex", alignItems:"center", gap:6, padding:"0 10px", flexShrink:0 }}>
                    {linkedAcc.vert && <span style={{ ...mono, fontSize:10, color:C.mut, background:C.card, border:`1px solid ${C.brd}`, borderRadius:3, padding:"1px 6px" }}>{linkedAcc.vert}</span>}
                    {linkedAcc.tier && <span style={{ ...mono, fontSize:10, color:C.blue, background:`${C.blue}14`, border:`1px solid ${C.blue}33`, borderRadius:3, padding:"1px 6px" }}>{linkedAcc.tier}</span>}
                    {linkedAcc.score != null && <span style={{ ...mono, fontSize:10, color:C.green }}>▲{linkedAcc.score}</span>}
                    <button onMouseDown={e=>{e.preventDefault();unlinkAccount();}}
                      style={{ ...mono, fontSize:11, padding:"2px 8px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:4, color:C.mut, cursor:"pointer", marginLeft:4 }}>✕</button>
                  </div>
                )}
              </div>
              {showAccDrop && dropList.length > 0 && (
                <div style={{ position:"absolute", top:"calc(100% + 4px)", left:0, right:0, zIndex:99, background:C.card, border:`1px solid ${C.brd}`, borderRadius:8, boxShadow:"0 6px 20px #0009", overflow:"hidden" }}>
                  {accSearch.trim() === "" && <div style={{ ...mono, fontSize:9, color:C.dim, padding:"7px 12px 4px", textTransform:"uppercase", letterSpacing:"0.08em" }}>All accounts</div>}
                  {dropList.map((a,i)=>{
                    const hasFile = !!pricingFiles[a.id];
                    const isLinked = a.id === linkedAccId;
                    return (
                      <div key={a.id} onMouseDown={()=>{switchToAccount(a.id);setAccSearch(a.name);setShowAccDrop(false);}}
                        style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 12px", cursor:"pointer", background:isLinked?`${C.gold}0e`:"transparent", borderBottom:i<dropList.length-1?`1px solid ${C.brd}22`:"none" }}
                        onMouseEnter={e=>{ if(!isLinked) e.currentTarget.style.background=`${C.gold}10`; }}
                        onMouseLeave={e=>{ e.currentTarget.style.background=isLinked?`${C.gold}0e`:"transparent"; }}>
                        <span style={{ ...mono, fontSize:11, color:isLinked?C.gold:C.txt, fontWeight:isLinked?700:400, flex:1 }}>{a.name}</span>
                        {a.vert && <span style={{ ...mono, fontSize:10, color:C.dim }}>{a.vert}</span>}
                        {a.tier && <span style={{ ...mono, fontSize:10, color:C.blue, background:`${C.blue}14`, borderRadius:3, padding:"1px 5px" }}>{a.tier}</span>}
                        {a.score != null && <span style={{ ...mono, fontSize:10, color:C.green }}>▲{a.score}</span>}
                        {hasFile && <span style={{ ...mono, fontSize:9, color:C.gold, background:`${C.gold}18`, borderRadius:3, padding:"1px 5px" }}>$ saved</span>}
                        {isLinked && <span style={{ ...mono, fontSize:9, color:C.gold }}>✓</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Pricing Intelligence Grid ── */}
      <PricingIntelGrid
        linkedAcc={linkedAcc}
        linkedAccId={linkedAccId}
        intelGridOpen={intelGridOpen}
        setIntelGridOpen={setIntelGridOpen}
        saveIntelOpen={saveIntelOpen}
        products={products}
        setProducts={setProducts}
        monthlyUsers={monthlyUsers}
        setMonthlyUsers={setMonthlyUsers}
        avgAccounts={avgAccounts}
        setAvgAccounts={setAvgAccounts}
        onDemand={onDemand}
        setOnDemand={setOnDemand}
        autoFillPendingRef={autoFillPendingRef}
        PRICING_PRODUCTS_DEFAULT={PRICING_PRODUCTS_DEFAULT}
        lerp12={lerp12}
      />

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12, flexWrap:"wrap" }}>
        <span style={{ ...mono, fontSize:22, color:C.gold, fontWeight:700 }}>$</span>
        <span style={{ ...mono, fontSize:18, color:C.txt, fontWeight:700 }}>Pricing Calculator</span>
        <span style={{ ...mono, fontSize:12, color:C.mut, marginLeft:4 }}>
          {selectedCount > 0 ? `${selectedCount} product${selectedCount!==1?"s":""} selected` : "select products to begin"}
        </span>
        <ApprovalBanner
          calcApproval={calcApproval}
          showApprovals={showApprovals}
          hideForExport={hideForExport}
          selectedCount={selectedCount}
          approvalOpen={approvalOpen}
          setApprovalOpen={setApprovalOpen}
        />
        {/* Tiered pricing toggle */}
        <button onClick={()=>setTieredPricing(t=>!t)}
          style={{ ...mono, fontSize:11, padding:"4px 11px", background: tieredPricing ? `${C.gold}22` : "transparent", border:`1px solid ${tieredPricing ? C.gold : C.brd}`, borderRadius:5, color: tieredPricing ? C.gold : C.mut, cursor:"pointer" }}>
          ⊞ {tieredPricing ? "Tiered ON" : "Tiered"}
        </button>
        {/* ── Deck Blueprint export ── */}
        <div style={{ display:"flex", alignItems:"center", gap:4, marginLeft:"auto", borderLeft:`1px solid ${C.brd}`, paddingLeft:8 }}>
          <select value={selectedBpId||""} onChange={e=>{ setSelectedBpId(e.target.value||null); setBpCopied(false); }}
            style={{ ...mono, fontSize:11, padding:"4px 7px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:4, color:selectedBpId?C.gold:C.dim, cursor:"pointer", outline:"none", maxWidth:180 }}>
            <option value="">📊 Blueprint…</option>
            {blueprints.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          {selectedBpId && (
            <button onClick={copyBlueprintTSV}
              style={{ ...mono, padding:"4px 11px", background:bpCopied?`${C.gold}22`:"transparent", border:`1px solid ${bpCopied?C.gold:C.gold+"55"}`, borderRadius:4, color:bpCopied?C.gold:C.gold+"aa", cursor:"pointer", fontSize:11, whiteSpace:"nowrap" }}>
              {bpCopied ? "✓ TSV Copied" : "⎘ Copy TSV"}
            </button>
          )}
        </div>
        <button onClick={() => { setProducts(PRICING_PRODUCTS_DEFAULT.map(p=>({...p,custom:p.rack}))); setMonthlyUsers(lerp12(500,5000)); setAvgAccounts(2.5); setOnDemand(0); setCommitFee(0); setPfTier(null); setPfDiscount({enabled:false,type:"flat",amount:0}); setPfRamp(false); setPfRampSched(Array(12).fill(0)); }}
          style={{ ...mono, padding:"5px 11px", background:"transparent", border:`1px solid ${C.brd}44`, borderRadius:5, color:C.dim, cursor:"pointer", fontSize:11 }}>
          ↺ Reset
        </button>
        {/* Snapshot / pricing model switcher — always visible when account linked */}
        {linkedAcc && snapshots.length > 0 && (
          <div style={{ position:"relative" }}>
            <button onClick={()=>setSnapDropOpen(o=>!o)}
              style={{ ...mono, fontSize:11, padding:"5px 11px", background:snapDropOpen?`${C.gold}18`:"transparent", border:`1px solid ${snapDropOpen?C.gold:C.brd}44`, borderRadius:5, color:snapDropOpen?C.gold:C.dim, cursor:"pointer", display:"flex", alignItems:"center", gap:5 }}>
              ⊟ Models <span style={{ color:snapDropOpen?C.gold:C.dim }}>{snapDropOpen?"▲":"▼"}</span> <span style={{ color:C.gold }}>{snapshots.length}</span>
            </button>
            {snapDropOpen && (
              <div onMouseLeave={()=>setSnapDropOpen(false)}
                style={{ position:"absolute", top:"calc(100% + 4px)", right:0, zIndex:300, background:C.card, border:`1px solid ${C.brd}`, borderRadius:8, minWidth:260, boxShadow:"0 8px 24px #000c", padding:"6px 0" }}>
                <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", padding:"4px 14px 6px" }}>Saved scenarios — click to load</div>
                {snapshots.map(s=>(
                  <div key={s.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 14px", borderTop:`1px solid ${C.brd}22` }}
                    onMouseEnter={e=>e.currentTarget.style.background=`${C.gold}0A`}
                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <div style={{ flex:1, minWidth:0, cursor:s.session?"pointer":"default" }} onClick={()=>{ if(s.session){ loadSnapshot(s); setSnapDropOpen(false); } }}>
                      <p style={{ ...mono, margin:0, fontSize:12, color:s.session?C.txt:C.dim, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.name}</p>
                      <p style={{ ...mono, margin:0, fontSize:10, color:C.dim }}>{s.savedAt}</p>
                    </div>
                    {s.session && (
                      <button onClick={()=>{ loadSnapshot(s); setSnapDropOpen(false); }}
                        style={{ ...mono, fontSize:10, padding:"2px 8px", background:`${C.gold}18`, border:`1px solid ${C.gold}44`, color:C.gold, borderRadius:4, cursor:"pointer", flexShrink:0 }}>
                        Load
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {/* Tab strip — hidden when DealWorkspace controls the tab */}
      <div style={{ display: hideTabs ? "none" : "flex", gap:0, marginBottom:16, borderBottom:`1px solid ${C.brd}`, alignItems:"center" }}>
        {[{id:"calc",lb:"Configure"},{id:"summary",lb:"Summary"},{id:"history",lb:"History"},{id:"chat",lb:"✦ Ask Claude"}].map(t=>(
          <button key={t.id} onClick={()=>setPricingTab(t.id)}
            style={{ ...mono, fontSize:12, padding:"6px 18px", background:"transparent", border:"none", borderBottom:`2px solid ${activeTab===t.id?C.gold:"transparent"}`, color:activeTab===t.id?C.gold:C.mut, cursor:"pointer", marginBottom:-1 }}>
            {t.lb}{t.id==="summary"&&selectedCount>0?` (${selectedCount})`:""}
          </button>
        ))}
        <div style={{ marginLeft:"auto", marginBottom:0, display:"flex", alignItems:"center", gap:6, paddingBottom:4 }}>
          <span style={{ ...mono, fontSize:10, color:C.dim }}>Approvals</span>
          <div onClick={()=>toggleApprovals(!showApprovals)}
            style={{ width:32, height:16, borderRadius:8, background:showApprovals?`${C.green}66`:C.brd, position:"relative", cursor:"pointer", transition:"background 0.2s", flexShrink:0 }}>
            <div style={{ position:"absolute", top:2, left:showApprovals?16:2, width:12, height:12, borderRadius:"50%", background:showApprovals?C.green:C.dim, transition:"left 0.2s" }}/>
          </div>
        </div>
      </div>

      {/* ── Tier config panel ── */}
      {tieredPricing && (
        <div style={{ background:`${C.gold}0a`, border:`1px solid ${C.gold}44`, borderRadius:10, padding:"14px 18px", marginBottom:14 }}>
          <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14 }}>
            <span style={{ ...mono, fontSize:12, color:C.gold, fontWeight:700 }}>⊞ Volume Tier Discounts</span>
            <span style={{ ...mono, fontSize:11, color:C.mut }}>additional % off custom rates when new users/mo cross each threshold</span>
            <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ ...mono, fontSize:11, color:C.dim }}>Tiers:</span>
              <button onClick={()=>setTiers(t=>t.length>1?t.slice(0,-1):t)}
                disabled={tiers.length<=1}
                style={{ ...mono, fontSize:13, width:24, height:24, borderRadius:4, border:`1px solid ${tiers.length>1?C.brd:C.brd+"44"}`, background:"transparent", color:tiers.length>1?C.mut:C.dim, cursor:tiers.length>1?"pointer":"default", display:"flex", alignItems:"center", justifyContent:"center" }}>−</button>
              <span style={{ ...mono, fontSize:12, color:C.gold, fontWeight:700, minWidth:16, textAlign:"center" }}>{tiers.length}</span>
              <button onClick={()=>setTiers(t=>[...t,{threshold:(t[t.length-1]?.threshold??1000)*10,discount:0.05}])}
                style={{ ...mono, fontSize:13, width:24, height:24, borderRadius:4, border:`1px solid ${C.gold}66`, background:"transparent", color:C.gold, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>+</button>
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(280px,1fr))", gap:10 }}>
            {tiers.map((tier, i) => {
              const usersInTier = monthlyUsers.filter((u, idx) => {
                const newU = idx === 0 ? u : Math.max(0, u - (monthlyUsers[idx-1]??0));
                return newU >= tier.threshold;
              }).length;
              return (
                <div key={i} style={{ background:C.card, border:`1px solid ${C.gold}33`, borderRadius:8, padding:"12px 14px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
                    <span style={{ ...mono, fontSize:11, color:C.gold, fontWeight:700, background:`${C.gold}22`, borderRadius:4, padding:"2px 8px" }}>Tier {i+1}</span>
                    {usersInTier > 0
                      ? <span style={{ ...mono, fontSize:10, color:C.green }}>✓ active {usersInTier} mo</span>
                      : <span style={{ ...mono, fontSize:10, color:C.dim }}>not reached</span>}
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                    <div>
                      <div style={{ ...mono, fontSize:9, color:C.dim, marginBottom:4 }}>THRESHOLD (new users/mo)</div>
                      <input type="number" min="1" step="1000" value={tier.threshold}
                        onChange={e=>setTiers(ts=>ts.map((t,j)=>j===i?{...t,threshold:parseInt(e.target.value)||0}:t))}
                        style={{ ...mono, width:"100%", boxSizing:"border-box", background:C.bg, border:`1.5px solid ${C.gold}55`, borderRadius:5, color:C.txt, fontSize:13, padding:"5px 8px", outline:"none" }}
                      />
                      <div style={{ ...mono, fontSize:9, color:C.dim, marginTop:3 }}>≥ {(tier.threshold||0).toLocaleString()} users</div>
                    </div>
                    <div>
                      <div style={{ ...mono, fontSize:9, color:C.dim, marginBottom:4 }}>ADDITIONAL DISCOUNT</div>
                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                        <input type="number" min="0" max="100" step="1" value={Math.round((tier.discount||0)*100)}
                          onChange={e=>setTiers(ts=>ts.map((t,j)=>j===i?{...t,discount:(parseFloat(e.target.value)||0)/100}:t))}
                          style={{ ...mono, width:"100%", boxSizing:"border-box", background:C.bg, border:`1.5px solid ${C.gold}55`, borderRadius:5, color:C.gold, fontSize:13, padding:"5px 8px", outline:"none" }}
                        />
                        <span style={{ ...mono, fontSize:13, color:C.gold, flexShrink:0 }}>%</span>
                      </div>
                      <div style={{ ...mono, fontSize:9, color:C.gold, marginTop:3 }}>
                        {tier.discount > 0 ? `×${(1-tier.discount).toFixed(2)} multiplier` : "no discount yet"}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Live tier status across months */}
          <div style={{ marginTop:12, display:"flex", gap:4, flexWrap:"wrap" }}>
            {monthlyBreakdown.map((m,i)=>(
              <div key={i} style={{ ...mono, fontSize:9, textAlign:"center", minWidth:36 }}>
                <div style={{ color: m.tierLbl ? C.gold : C.dim }}>{m.tierLbl ?? "—"}</div>
                <div style={{ color:C.dim }}>Mo{i+1}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "summary" && (
        <SummaryTab
          linkedAcc={linkedAcc}
          snapshots={snapshots}
          snapDropOpen={snapDropOpen}
          setSnapDropOpen={setSnapDropOpen}
          loadSnapshot={loadSnapshot}
          deleteSnapshot={deleteSnapshot}
          showSaveInput={showSaveInput}
          setShowSaveInput={setShowSaveInput}
          saveLabel={saveLabel}
          setSaveLabel={setSaveLabel}
          doSaveSnapshot={doSaveSnapshot}
          onCreateTask={onCreateTask}
          selectedCount={selectedCount}
          products={products}
          monthlyBreakdown={monthlyBreakdown}
          avgAccounts={avgAccounts}
          onDemand={onDemand}
          commitFee={commitFee}
          commitRamp={commitRamp}
          commitRampSched={commitRampSched}
          upfrontEnabled={upfrontEnabled}
          upfrontAmount={upfrontAmount}
          pfTier={pfTier}
          pfDiscount={pfDiscount}
          pfRamp={pfRamp}
          pfRampSched={pfRampSched}
          isPartner={isPartner}
          partnerFee={partnerFee}
          tieredPricing={tieredPricing}
          tiers={tiers}
          monthlyUsers={monthlyUsers}
          annualTotal={annualTotal}
          annualBase={annualBase}
          annualSavings={annualSavings}
          annualSingleTotal={annualSingleTotal}
          annualRecurringTotal={annualRecurringTotal}
          annualOnDemandTotal={annualOnDemandTotal}
          annualPfTotal={annualPfTotal}
          annualPartnerFeeTotal={annualPartnerFeeTotal}
          minimumAnnual={minimumAnnual}
          variableAnnual={variableAnnual}
          annualBest={annualBest}
          annualConservative={annualConservative}
          confPct={confPct}
          confidence={confidence}
          setConfidence={setConfidence}
          mo1={mo1}
          mo12={mo12}
          startUsers={startUsers}
          endUsers={endUsers}
          activeDealPfLabel={activeDealPfLabel}
          activeTierObj={activeTierObj}
          tierAmount={tierAmount}
          discountedTierAmount={discountedTierAmount}
          fmt={fmt}
          fmtK={fmtK}
          fmtRate={fmtRate}
          TYPE_LABEL={TYPE_LABEL}
          TYPE_COLOR={TYPE_COLOR}
          prodAnnualVolume={prodAnnualVolume}
          summaryRef={summaryRef}
          renderFormatBar={renderFormatBar}
          getFormattedText={getFormattedText}
          doExportPDF={doExportPDF}
          doScreenshot={doScreenshot}
          exportFormat={exportFormat}
          billingStart={billingStart}
        />
      )}

      {activeTab === "calc" && (
        <CalcTab
          growthSvgRef={growthSvgRef}
          draggingIdx={draggingIdx}
          setDraggingIdx={setDraggingIdx}
          gChartW={gChartW}
          gChartH={gChartH}
          gPadT={gPadT}
          gPadB={gPadB}
          gPadL={gPadL}
          gPadR={gPadR}
          gInnerH={gInnerH}
          gMax={gMax}
          gYScale={gYScale}
          gXCenter={gXCenter}
          gSlot={gSlot}
          monthlyUsers={monthlyUsers}
          setMonthlyUsers={setMonthlyUsers}
          startUsers={startUsers}
          endUsers={endUsers}
          avgAccounts={avgAccounts}
          setAvgAccounts={setAvgAccounts}
          onDemand={onDemand}
          setOnDemand={setOnDemand}
          lerp12={lerp12}
          pfTier={pfTier}
          setPfTier={setPfTier}
          pfDiscount={pfDiscount}
          setPfDiscount={setPfDiscount}
          pfRamp={pfRamp}
          setPfRamp={setPfRamp}
          pfRampSched={pfRampSched}
          setPfRampSched={setPfRampSched}
          isPartner={isPartner}
          setIsPartner={setIsPartner}
          partnerFee={partnerFee}
          setPartnerFee={setPartnerFee}
          tierAmount={tierAmount}
          discountedTierAmount={discountedTierAmount}
          activeTierObj={activeTierObj}
          commitFee={commitFee}
          setCommitFee={setCommitFee}
          commitRamp={commitRamp}
          setCommitRamp={setCommitRamp}
          billingStart={billingStart}
          setBillingStart={setBillingStart}
          commitRampSched={commitRampSched}
          setCommitRampSched={setCommitRampSched}
          upfrontEnabled={upfrontEnabled}
          setUpfrontEnabled={setUpfrontEnabled}
          upfrontAmount={upfrontAmount}
          setUpfrontAmount={setUpfrontAmount}
          tieredPricing={tieredPricing}
          setTieredPricing={setTieredPricing}
          tiers={tiers}
          setTiers={setTiers}
          monthlyBreakdown={monthlyBreakdown}
          mo1={mo1}
          mo12={mo12}
          annualTotal={annualTotal}
          annualBase={annualBase}
          annualSavings={annualSavings}
          annualSingleTotal={annualSingleTotal}
          annualRecurringTotal={annualRecurringTotal}
          annualOnDemandTotal={annualOnDemandTotal}
          annualPfTotal={annualPfTotal}
          annualPartnerFeeTotal={annualPartnerFeeTotal}
          minimumAnnual={minimumAnnual}
          variableAnnual={variableAnnual}
          annualBest={annualBest}
          annualConservative={annualConservative}
          monthlyBest={monthlyBest}
          monthlyConservative={monthlyConservative}
          confPct={confPct}
          confidence={confidence}
          setConfidence={setConfidence}
          activeDealPfLabel={activeDealPfLabel}
          chartW={chartW}
          chartH={chartH}
          padT={padT}
          padB={padB}
          padL={padL}
          padR={padR}
          innerW={innerW}
          innerH={innerH}
          maxVal={maxVal}
          barSlot={barSlot}
          barW={barW}
          yScale={yScale}
          xCenter={xCenter}
          donutArc={donutArc}
          products={products}
          setProducts={setProducts}
          filtered={filtered}
          search={search}
          setSearch={setSearch}
          rateMode={rateMode}
          setRateMode={setRateMode}
          selectedCount={selectedCount}
          showApprovals={showApprovals}
          hideForExport={hideForExport}
          calcApproval={calcApproval}
          toggleIncluded={toggleIncluded}
          setCustom={setCustom}
          setAdoption={setAdoption}
          prodAnnualVolume={prodAnnualVolume}
          fmt={fmt}
          fmtK={fmtK}
          fmtRate={fmtRate}
          TYPE_LABEL={TYPE_LABEL}
          TYPE_COLOR={TYPE_COLOR}
          PRICING_PRODUCTS_DEFAULT={PRICING_PRODUCTS_DEFAULT}
        />
      )}

      {activeTab === "history" && (
        <HistoryTab
          accounts={accounts}
          products={products}
          linkedAccId={linkedAccId}
          switchToAccount={switchToAccount}
          setAccSearch={setAccSearch}
          setPricingTab={setPricingTab}
        />
      )}

      {activeTab === "chat" && (
        <PricingChatPanel
          buildContext={buildPricingContext}
          accName={linkedAcc?.name || null}
          annualTotal={annualTotal}
        />
      )}
    </div>
  );
}

export default PricingPage;
