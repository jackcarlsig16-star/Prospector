import { useState, useEffect } from 'react';
import { C, TS, mono } from '../constants/colors';
import { ROI_KEY } from '../utils/storageKeys';

const loadRoiFiles = () => { try { return JSON.parse(localStorage.getItem(ROI_KEY)||"{}"); } catch { return {}; } };
const saveRoiFiles = f => localStorage.setItem(ROI_KEY, JSON.stringify(f));

const PRICING_INTEL_KEY = "prospector_pricing_intel";
const loadPricingIntel = () => { try { return JSON.parse(localStorage.getItem(PRICING_INTEL_KEY)||"{}"); } catch { return {}; } };
const getPricingIntelForAcc = (id) => loadPricingIntel()[id]||null;

function parseAnnualValueStr(v) {
  if (!v) return 0;
  const r = v.match(/\u2192\s*\$\s*([\d,]+)\s*[\u2013\u2014\-]\s*\$?\s*([\d,]+)\s+annual/i);
  if (r) return Math.round((parseInt(r[1].replace(/,/g,""))+parseInt(r[2].replace(/,/g,"")))/2);
  const s = v.match(/\u2192\s*\$\s*([\d,]+)\s+annual/i);
  if (s) return parseInt(s[1].replace(/,/g,""));
  const d = v.match(/\$([\d,]+)\s+annual/i);
  if (d) return parseInt(d[1].replace(/,/g,""));
  const moR = v.match(/\$\s*([\d.]+)\s*[\u2013\u2014\-]\s*\$?\s*([\d.]+)\s*\/\s*mo/i);
  if (moR) return Math.round(((parseFloat(moR[1])+parseFloat(moR[2]))/2)*12);
  const moS = v.match(/\$\s*([\d.]+)\s*\/\s*mo/i);
  if (moS) return Math.round(parseFloat(moS[1])*12);
  return 0;
}

// Monthly platform fee — mirrors PricingPage dealPfAt(i)
// PF_TIERS amounts are per-month (base=$2k/mo, plus=$5k/mo, premium=$15k/mo)
const calcDealPf = (f, i) => {
  if (f.pfRamp) return f.pfRampSched?.[i] ?? 0;
  const TIERS = { base:2000, plus:5000, premium:15000 };
  const t = TIERS[f.pfTier] || 0;
  if (!f.pfDiscount?.enabled) return t;
  return f.pfDiscount.type === "pct" ? t*(1-f.pfDiscount.amount/100) : Math.max(0, t-f.pfDiscount.amount);
};

const calcPricingAnnual = (f) => {
  if (!f?.products || !f?.monthlyUsers) return null;
  try {
    const prods = f.products.filter(p=>p.included);
    let total = 0;
    for (let i=0;i<12;i++){
      const activeUsers = f.monthlyUsers[i]||0;
      const prevUsers   = i===0 ? 0 : (f.monthlyUsers[i-1]||0);
      const newUsers    = Math.max(0, activeUsers - prevUsers);
      const connAccts   = (i===0 ? activeUsers : newUsers) * (f.avgAccounts||2.5);
      const commitFloor = f.commitRamp ? (f.commitRampSched?.[i]??0) : (f.commitFee??0);
      const dealPf      = calcDealPf(f, i);
      let apiSpend = 0;
      for (const p of prods) {
        const rate = p.custom ?? p.rack;
        if (rate == null) continue;
        if (p.tiers?.length) {
          let cost = 0, rem = activeUsers * (f.avgAccounts||2.5);
          for (const tier of p.tiers) {
            if (rem <= 0) break;
            const inTier = tier.cap===null ? rem : Math.min(rem, tier.cap-(tier.floor||0));
            cost += inTier * (tier.rate||0);
            rem -= inTier;
          }
          if (p.discount?.enabled)
            cost = p.discount.type==="pct" ? cost*(1-p.discount.amount/100) : Math.max(0,cost-p.discount.amount);
          apiSpend += cost;
        } else {
          if (p.type==="S") apiSpend += rate * connAccts;
          else if (p.type==="R") apiSpend += rate * activeUsers * (f.avgAccounts || 2.5);
          else if (p.type==="T") apiSpend += rate * (f.onDemand||0) * activeUsers;
        }
      }
      total += (commitFloor > 0 ? Math.max(apiSpend, commitFloor) : apiSpend) + dealPf;
    }
    return Math.round(total);
  } catch { return null; }
};

// Single-month cost from a pricing session
const calcMonthCost = (f, idx) => {
  if (!f?.products || !f?.monthlyUsers) return 0;
  try {
    const prods = f.products.filter(p => p.included);
    const au = f.monthlyUsers[idx] || 0;
    const prev = idx === 0 ? 0 : (f.monthlyUsers[idx-1] || 0);
    const newU = Math.max(0, au - prev);
    const conn = (idx === 0 ? au : newU) * (f.avgAccounts || 2.5);
    const commitFloor = f.commitRamp ? (f.commitRampSched?.[idx]??0) : (f.commitFee??0);
    const dealPf = calcDealPf(f, idx);
    let apiSpend = 0;
    for (const p of prods) {
      const rate = p.custom ?? p.rack;
      if (rate == null) continue;
      if (p.type === "S") apiSpend += rate * conn;
      else if (p.type === "R") apiSpend += rate * au * (f.avgAccounts || 2.5);
      else if (p.type === "T") apiSpend += rate * (f.onDemand || 0) * au;
    }
    return Math.round((commitFloor > 0 ? Math.max(apiSpend, commitFloor) : apiSpend) + dealPf);
  } catch { return 0; }
};

// ── ROI Calculator Page ───────────────────────────────────────────────────────
function RoiPage({ accounts=[], launchAccountId=null, onLaunched, hideAccountPicker=false }) {
  const [accSearch,    setAccSearch]    = useState("");
  const [linkedAccId,  setLinkedAccId]  = useState(null);
  const [showDrop,     setShowDrop]     = useState(false);
  const acc = accounts.find(a=>a.id===linkedAccId)||null;

  // Value type toggle (revenue vs gross profit — changes labels only, not math)
  const [useGrossProfit,  setUseGrossProfit]  = useState(false);

  // Core value input
  const [avgRevenuePerUser,   setAvgRevenuePerUser]   = useState(75);
  const [integrationCost,     setIntegrationCost]     = useState(20000);
  const [yearlyGrowthRate,    setYearlyGrowthRate]    = useState(20);

  // Manual-mode conv inputs
  const [monthlyAttempts, setMonthlyAttempts] = useState(1000);
  const [currentConvRate, setCurrentConvRate] = useState(65); // as %
  const [newConvRate,   setNewConvRate]   = useState(82); // as %
  const [manualCost, setManualCost] = useState(0);

  // Add-on: Operational Savings (collapsed by default)
  const [opsEnabled,         setOpsEnabled]         = useState(false);
  const [hoursSavedPerUser,  setHoursSavedPerUser]  = useState(0.4);
  const [costPerHour,        setCostPerHour]        = useState(75);

  // Add-on: Fraud Savings (only shown if Signal/Protect in pricing file)
  const [fraudEnabled,              setFraudEnabled]              = useState(false);
  const [baselineMonthlyFraudLoss,  setBaselineMonthlyFraudLoss]  = useState(0);
  const [fraudReductionPct,         setFraudReductionPct]         = useState(30);

  const [savedAt, setSavedAt] = useState(null);
  const [pricingIntelFills, setPricingIntelFills] = useState({}); // tracks which fields were auto-filled from pricing intel

  const [acctSnaps,      setAcctSnaps]      = useState([]);
  const [selectedSnapId, setSelectedSnapId] = useState(null);

  const getPricingFile = (id) => {
    try { return JSON.parse(localStorage.getItem("prospector_pricing_files")||"{}")[id]||null; } catch { return null; }
  };

  const getSnapshotsForAcc = (id) => {
    try { return JSON.parse(localStorage.getItem("prospector_pricing_snapshots")||"{}")[id]||[]; } catch { return []; }
  };

  // Unified model list: named snapshots + live session (if it exists)
  const getAllModels = (id) => {
    const snaps = getSnapshotsForAcc(id);
    const liveFile = getPricingFile(id);
    const models = [...snaps];
    if (liveFile) models.push({ id:"__live__", name:"Current session", savedAt: liveFile.savedAt||new Date(0).toISOString(), session: liveFile });
    return models.sort((a,b) => new Date(b.savedAt) - new Date(a.savedAt));
  };

  const loadFromAccount = (id) => {
    const f = loadRoiFiles()[id];
    const intel = getPricingIntelForAcc(id);
    // Resolve annual value per user from intel (number or re-parsed from raw string)
    const intelAnnual = (intel?.annualValuePerUser > 0) ? intel.annualValuePerUser
                      : parseAnnualValueStr(intel?._annualValueStr||"");
    if (f) {
      setUseGrossProfit(f.useGrossProfit??false);
      // If saved value is still the default (75), backfill from intel
      const savedRPU = f.avgRevenuePerUser??75;
      const intelFills = {};
      if (savedRPU === 75 && intelAnnual > 0) { setAvgRevenuePerUser(intelAnnual); intelFills.avgRevenuePerUser = true; }
      else setAvgRevenuePerUser(savedRPU);
      setIntegrationCost(f.integrationCost??20000);
      setYearlyGrowthRate(f.yearlyGrowthRate??20);
      setMonthlyAttempts(f.monthlyAttempts??1000);
      setCurrentConvRate(f.currentConvRate??65);
      setNewConvRate(f.newConvRate??82);
      setManualCost(f.manualCost??0);
      setOpsEnabled(f.opsEnabled??false);
      setHoursSavedPerUser(f.hoursSavedPerUser??0.4);
      setCostPerHour(f.costPerHour??75);
      setFraudEnabled(f.fraudEnabled??false);
      setBaselineMonthlyFraudLoss(f.baselineMonthlyFraudLoss??0);
      setFraudReductionPct(f.fraudReductionPct??30);
      setSavedAt(f.savedAt||null);
      setPricingIntelFills(intelFills);
    } else {
      // No saved ROI file — pre-populate from Pricing Intelligence Grid if available
      const fills = {};
      if (intelAnnual > 0) { setAvgRevenuePerUser(intelAnnual); fills.avgRevenuePerUser = true; }
      if (intel?.convRate > 0 && intel.convRate < 100) { setCurrentConvRate(intel.convRate); fills.currentConvRate = true; }
      if ((intel?.m12||0) > 0) { setMonthlyAttempts(intel.m12); fills.monthlyAttempts = true; }
      else if ((intel?.m1||0) > 0) { setMonthlyAttempts(intel.m1); fills.monthlyAttempts = true; }
      setPricingIntelFills(fills);
    }
  };

  useEffect(()=>{
    if (launchAccountId && accounts.length) {
      const a = accounts.find(x=>x.id===launchAccountId);
      if (a) { setLinkedAccId(launchAccountId); setAccSearch(a.name); loadFromAccount(launchAccountId); }
      const models = getAllModels(launchAccountId);
      setAcctSnaps(models);
      setSelectedSnapId(models.length > 0 ? models[0].id : null);
      if (onLaunched) onLaunched();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[launchAccountId, accounts.length]);

  const switchToAccount = (id) => {
    setLinkedAccId(id);
    const a = accounts.find(x=>x.id===id);
    if (a) setAccSearch(a.name);
    setShowDrop(false);
    const models = getAllModels(id);
    setAcctSnaps(models);
    setSelectedSnapId(models.length > 0 ? models[0].id : null);
    loadFromAccount(id);
  };

  const save = () => {
    if (!linkedAccId) return;
    const files = loadRoiFiles();
    files[linkedAccId] = { useGrossProfit, avgRevenuePerUser, integrationCost, yearlyGrowthRate, monthlyAttempts, currentConvRate, newConvRate, manualCost, opsEnabled, hoursSavedPerUser, costPerHour, fraudEnabled, baselineMonthlyFraudLoss, fraudReductionPct, savedAt:new Date().toISOString() };
    saveRoiFiles(files);
    setSavedAt(new Date().toISOString());
  };

  // ── Pricing file ─────────────────────────────────────────────────────────────
  // acctSnaps is the unified list (named snapshots + live session as "__live__")
  const pFile = (() => {
    if (!linkedAccId || !acctSnaps.length) return null;
    const snap = acctSnaps.find(s => s.id === selectedSnapId) || acctSnaps[0];
    return snap?.session || null;
  })();
  const selectedModel = acctSnaps.find(s => s.id === selectedSnapId) || acctSnaps[0] || null;
  const pricingLinked = !!pFile;
  const mu = pFile?.monthlyUsers || [];
  const avgAccPU = pFile?.avgAccounts || 2.5;
  const endUsers = mu[11] || 0;
  const newUsersAtMo = i => i===0 ? (mu[0]||0) : Math.max(0,(mu[i]||0)-(mu[i-1]||0));
  const annualCost = pFile ? (calcPricingAnnual(pFile)||0) : 0;

  // Derived values from selected model
  const avgMonthlyUsers = mu.length ? Math.round(mu.reduce((a,b)=>a+b,0)/mu.length) : 0;
  const monthlyMin = pFile ? (pFile.commitRamp ? (pFile.commitRampSched?.[11]??0) : (pFile.commitFee??0)) : 0;
  const mo1Cost  = pFile ? calcMonthCost(pFile, 0)  : 0;
  const mo12Cost = pFile ? calcMonthCost(pFile, 11) : 0;
  const avgCostPerUser = (annualCost > 0 && avgMonthlyUsers > 0)
    ? parseFloat((annualCost / (avgMonthlyUsers * 12)).toFixed(2)) : 0;

  // Fraud add-on only visible if Signal or Protect in pricing file (or no pricing file at all)
  const hasSignalOrProtect = pFile?.products?.some(p => p.included && (p.name?.toLowerCase().includes("signal")||p.name?.toLowerCase().includes("protect")));
  const showFraudSection = hasSignalOrProtect || !pricingLinked;

  // ── Base case calcs ──────────────────────────────────────────────────────────
  // Conversion fraction: how much of the connected volume is truly incremental
  // (new_conv - current_conv) / new_conv  → e.g. (85-65)/85 = 23.5% of users are net-new
  const convFraction = newConvRate > 0
    ? Math.max(0, Math.min(1, (newConvRate - currentConvRate) / newConvRate))
    : 0;

  const pMonthlyRevArr = mu.map(u => u * avgRevenuePerUser / 12);
  const pAnnualRevenue = pMonthlyRevArr.reduce((s,v)=>s+v,0);
  // Scale full pricing-file revenue down to the incremental fraction only
  const pMonthlyRevArrIncr = pMonthlyRevArr.map(v => v * convFraction);

  const mAddPerMo = monthlyAttempts*(newConvRate-currentConvRate)/100;
  const mAddPerYr = Math.max(0, Math.round(mAddPerMo*12));

  const incrementalUsers   = pricingLinked ? Math.round(endUsers * convFraction) : mAddPerYr;
  const incrementalRevenue = pricingLinked ? Math.round(pAnnualRevenue * convFraction) : Math.round(mAddPerYr * avgRevenuePerUser);
  const productCost          = pricingLinked ? annualCost : manualCost;
  const netValue           = incrementalRevenue - productCost;
  const roiPctBase         = productCost>0 ? Math.round((netValue/productCost)*100) : null;
  const paybackBase        = (productCost>0 && incrementalRevenue>0) ? Math.ceil(productCost/(incrementalRevenue/12)) : null;

  // ── Add-on calcs ─────────────────────────────────────────────────────────────
  const opsSavings   = opsEnabled   ? Math.round(incrementalUsers * hoursSavedPerUser * costPerHour) : 0;
  const fraudSavings = (fraudEnabled && showFraudSection) ? Math.round(baselineMonthlyFraudLoss*12*fraudReductionPct/100) : 0;
  const anyAddOns    = opsEnabled || (fraudEnabled && showFraudSection);
  const totalAddOns  = opsSavings + fraudSavings;
  const totalValue   = incrementalRevenue + totalAddOns;
  const netValueAdds = totalValue - productCost;
  const roiPctAdds   = (anyAddOns && productCost>0) ? Math.round((netValueAdds/productCost)*100) : null;
  const paybackAdds  = (anyAddOns && productCost>0 && totalValue>0) ? Math.ceil(productCost/(totalValue/12)) : null;

  // Hero values (prefer with-add-ons if available)
  const heroNet      = anyAddOns ? netValueAdds   : netValue;
  const heroRoiPct   = anyAddOns ? roiPctAdds     : roiPctBase;
  const heroPayback  = anyAddOns ? paybackAdds     : paybackBase;
  const heroRoiRatio = productCost>0 ? (heroNet/productCost).toFixed(1) : null;

  // ── Conv rate guardrails ─────────────────────────────────────────────────────
  const convWarning = (() => {
    const cD=currentConvRate/100, pD=newConvRate/100;
    if (pD < cD) return {type:"error",msg:"New conversion rate should be higher — did you mean to swap these?"};
    if (pD > 0.95) return {type:"warn",msg:"Unusually high — double check this assumption"};
    if (pD < cD*1.05 && pD >= cD) return {type:"nudge",msg:"Lift is below typical 10–25% range"};
    return null;
  })();

  // ── Sanity checks ────────────────────────────────────────────────────────────
  const isStrong = heroRoiPct!==null && heroRoiPct>=200 && heroPayback!==null && heroPayback<=12;
  const isWeak   = heroRoiPct!==null && (heroRoiPct<50 || (heroPayback!==null && heroPayback>24));

  // ── Chart data ───────────────────────────────────────────────────────────────
  const cumulativeData = Array.from({length:12},(_,i)=>{
    if (pricingLinked) {
      let cum=-integrationCost;
      for(let m=0;m<=i;m++){
        cum += pMonthlyRevArrIncr[m];
        if (opsEnabled) cum += newUsersAtMo(m)*hoursSavedPerUser*costPerHour;
        if (fraudEnabled&&showFraudSection) cum += baselineMonthlyFraudLoss*fraudReductionPct/100;
        cum -= annualCost/12;
      }
      return cum;
    } else {
      const mv = (incrementalRevenue+(opsEnabled?opsSavings:0)+(fraudEnabled&&showFraudSection?fraudSavings:0))/12;
      return (i+1)*mv-(i+1)*productCost/12-integrationCost;
    }
  });
  const minCum=Math.min(...cumulativeData,0), maxCum=Math.max(...cumulativeData,1);
  const chartW=760,chartH=100,padL=52,padR=12,padT=10,padB=24;
  const innerH=chartH-padT-padB, innerW=chartW-padL-padR;
  const barSlot=innerW/12, barW=Math.max(8,barSlot-6);
  const yScale=v=>padT+innerH*(1-(v-minCum)/(maxCum-minCum||1));
  const xC=i=>padL+i*barSlot+barSlot/2;
  const zeroY=yScale(0);
  const breakEven=(()=>{ for(let m=1;m<=12;m++){if(cumulativeData[m-1]>=0)return m;} return null; })();

  const gr=yearlyGrowthRate/100;
  const yr1V=totalValue||incrementalRevenue, yr2V=Math.round(yr1V*(1+gr)), yr3V=Math.round(yr2V*(1+gr));
  const yr1C=productCost;
  const yr2C = pricingLinked ? Math.round(annualCost*(1+gr)) : productCost;
  const yr3C = pricingLinked ? Math.round(yr2C*(1+gr)) : productCost;
  const threeYrValue=yr1V+yr2V+yr3V;
  const yrMax=Math.max(yr1V,yr2V,yr3V,yr1C,1);
  const y3W=760,y3H=80,y3PL=52,y3PR=12,y3PT=8,y3PB=18;
  const y3IH=y3H-y3PT-y3PB, y3IW=y3W-y3PL-y3PR, y3Slot=y3IW/3, y3BW=Math.max(18,y3Slot/3-4);
  const y3Y=v=>y3PT+y3IH*(1-v/yrMax), y3H2=v=>Math.max(1,y3IH*(v/yrMax)), y3X=i=>y3PL+i*y3Slot+y3Slot/2;

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const vWord    = useGrossProfit ? "gross profit" : "revenue";
  const vWordCap = useGrossProfit ? "Gross profit" : "Revenue";
  const fmt      = n => "$"+Math.round(n).toLocaleString();
  const inputSty = { ...mono, fontSize:13, padding:"6px 9px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:5, color:C.txt, outline:"none", width:"100%", boxSizing:"border-box" };
  const filteredAccs = accSearch ? accounts.filter(a=>a.name.toLowerCase().includes(accSearch.toLowerCase())).slice(0,8) : [];

  // ── Copy text (two versions) ─────────────────────────────────────────────────
  const copyText = [
    `${acc?.name||"Company"} ROI Analysis`,``,
    `BASE CASE`,
    `Incremental users (Year 1): ${incrementalUsers.toLocaleString()}`,
    `Incremental ${vWord} (Year 1): ${fmt(incrementalRevenue)}`,
    `Cost (Year 1): ${fmt(productCost)}`,
    `Net ROI (Year 1): ${fmt(netValue)}`,
    `ROI% (Year 1): ${roiPctBase!==null?roiPctBase+"%":"—"}`,
    `Payback: ${paybackBase?"Month "+paybackBase:"—"}`,
    ...(anyAddOns?[
      ``,`WITH ADD-ONS`,
      opsEnabled?`+ Operational savings (Year 1): ${fmt(opsSavings)}`:"",
      (fraudEnabled&&showFraudSection)?`+ Fraud savings (Year 1): ${fmt(fraudSavings)}`:"",
      `Total value (Year 1): ${fmt(totalValue)}`,
      `Net ROI with add-ons (Year 1): ${fmt(netValueAdds)}`,
      `ROI% with add-ons: ${roiPctAdds!==null?roiPctAdds+"%":"—"}`,
      `includes ${[opsEnabled?"operational":null,(fraudEnabled&&showFraudSection)?"fraud":null].filter(Boolean).join(" + ")} benefits`,
    ]:[]),
  ].filter(l=>l!=="").join("\n");

  return (
    <div>
      {/* Account search — hidden when DealWorkspace controls the account */}
      <div style={{ position:"relative", marginBottom:16, display: hideAccountPicker ? "none" : undefined }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ flex:1, position:"relative" }}>
            <input value={accSearch} onChange={e=>{setAccSearch(e.target.value);setShowDrop(true);}} onFocus={()=>setShowDrop(true)} onBlur={()=>setTimeout(()=>setShowDrop(false),150)}
              placeholder="Link to account (search by name)…" style={{ ...inputSty, fontSize:14, padding:"8px 12px" }}/>
            {showDrop&&filteredAccs.length>0&&(
              <div style={{ position:"absolute",top:"100%",left:0,right:0,background:C.card,border:`1px solid ${C.brd}`,borderRadius:7,zIndex:200,marginTop:3,boxShadow:"0 8px 24px #000a" }}>
                {filteredAccs.map(a=>(
                  <div key={a.id} onMouseDown={()=>switchToAccount(a.id)} style={{ padding:"8px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:8,borderBottom:`1px solid ${C.brd}22` }}
                    onMouseEnter={e=>e.currentTarget.style.background=C.sur} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <span style={{ flex:1,fontSize:13,color:C.txt }}>{a.name}</span>
                    {a.tier&&<span style={{ ...mono,fontSize:10,color:TS[a.tier]?.t||C.dim }}>{a.tier}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
          {linkedAccId&&<span style={{ ...mono,fontSize:11,color:C.green,whiteSpace:"nowrap" }}>● Linked{pricingLinked?" · pricing loaded":""}</span>}
          {savedAt&&<span style={{ ...mono,fontSize:11,color:C.dim,whiteSpace:"nowrap" }}>Saved {new Date(savedAt).toLocaleDateString()}</span>}
        </div>
      </div>

      {/* Pricing model selector */}
      {linkedAccId && acctSnaps.length > 0 && (
        <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:10,padding:"8px 12px",background:C.sur,border:`1px solid ${C.brd}`,borderRadius:8 }}>
          <span style={{ ...mono,fontSize:10,color:C.dim,whiteSpace:"nowrap",textTransform:"uppercase",letterSpacing:"0.07em" }}>Pricing model</span>
          <select value={selectedSnapId||""} onChange={e=>setSelectedSnapId(e.target.value||null)}
            style={{ ...mono,fontSize:12,flex:1,padding:"4px 8px",background:C.card,border:`1px solid ${C.brd}`,borderRadius:5,color:C.txt,cursor:"pointer" }}>
            {acctSnaps.map(s=>(
              <option key={s.id} value={s.id}>
                {s.id==="__live__"?"Current session":s.name||"Untitled"} — {new Date(s.savedAt).toLocaleDateString("en-US",{month:"short",day:"numeric"})}
              </option>
            ))}
          </select>
          {selectedModel && (
            <span style={{ ...mono,fontSize:10,color:C.gold,background:`${C.gold}14`,border:`1px solid ${C.gold}44`,borderRadius:3,padding:"2px 8px",whiteSpace:"nowrap" }}>
              Loaded: {selectedModel.id==="__live__"?"Current session":selectedModel.name||"Untitled"} ✓
            </span>
          )}
        </div>
      )}
      {linkedAccId && acctSnaps.length === 0 && (
        <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:10,padding:"8px 12px",background:`${C.orange}0d`,border:`1px solid ${C.orange}33`,borderRadius:8 }}>
          <span style={{ fontSize:13 }}>◈</span>
          <span style={{ ...mono,fontSize:12,color:C.orange }}>No pricing model found — build one in the Pricing Calculator first →</span>
        </div>
      )}

      {/* Pricing summary strip */}
      {pricingLinked&&(
        <div style={{ background:`${C.gold}07`,border:`1px solid ${C.gold}33`,borderRadius:10,padding:"12px 16px",marginBottom:12 }}>
          <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:10 }}>
            <span style={{ ...mono,fontSize:10,color:C.gold,textTransform:"uppercase",letterSpacing:"0.08em" }}>From pricing model</span>
            <span style={{ ...mono,fontSize:10,color:C.gold }}>↗</span>
            {hasSignalOrProtect&&<span style={{ ...mono,fontSize:10,color:C.purple,background:`${C.purple}14`,border:`1px solid ${C.purple}33`,borderRadius:3,padding:"2px 7px" }}>Signal/Protect detected</span>}
            <span style={{ marginLeft:"auto",...mono,fontSize:10,color:C.dim }}>edit in Pricing Calculator</span>
          </div>
          <div style={{ display:"flex",alignItems:"center",gap:24,flexWrap:"wrap" }}>
            {[
              ["Mo 1 users", (mu[0]||0).toLocaleString()],
              ["Mo 12 users", endUsers.toLocaleString()],
              ["Avg monthly users", avgMonthlyUsers.toLocaleString()],
              ["Avg accts / user", avgAccPU],
              ["Mo 1 cost", fmt(mo1Cost)],
              ["Mo 12 cost", fmt(mo12Cost)],
              ["Monthly min", monthlyMin > 0 ? fmt(monthlyMin) : "—"],
              ["Annual cost", fmt(annualCost)],
              ["Avg cost / user / mo", avgCostPerUser > 0 ? "$"+avgCostPerUser : "—"],
            ].map(([lbl,val])=>(
              <div key={lbl} style={{ display:"flex",flexDirection:"column",gap:2 }}>
                <span style={{ ...mono,fontSize:9,color:C.dim,textTransform:"uppercase",letterSpacing:"0.06em" }}>{lbl}</span>
                <span style={{ ...mono,fontSize:13,color:C.txt }}>{val}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {linkedAccId&&!pricingLinked&&(
        <div style={{ background:`${C.orange}0a`,border:`1px solid ${C.orange}33`,borderRadius:8,padding:"10px 14px",marginBottom:12,display:"flex",alignItems:"center",gap:10 }}>
          <span style={{ fontSize:14 }}>◈</span>
          <span style={{ ...mono,fontSize:12,color:C.orange }}>No pricing file found. Run the Pricing Calculator first for accurate cost and user numbers.</span>
        </div>
      )}

      {/* Revenue vs Gross Profit toggle */}
      <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:12 }}>
        <span style={{ ...mono,fontSize:10,color:C.dim }}>Reporting:</span>
        <div style={{ display:"inline-flex",borderRadius:4,overflow:"hidden",border:`1px solid ${C.brd}` }}>
          {[["revenue","Revenue"],[" grossprofit","Gross Profit"]].map(([v,l])=>{
            const active=(v==="revenue"&&!useGrossProfit)||(v===" grossprofit"&&useGrossProfit);
            return <button key={v} onClick={()=>setUseGrossProfit(v===" grossprofit")} style={{ ...mono,fontSize:9,padding:"3px 10px",background:active?`${C.blue}33`:"transparent",color:active?C.blue:C.dim,border:"none",cursor:"pointer" }}>{l}</button>;
          })}
        </div>
        {!useGrossProfit&&<span style={{ ...mono,fontSize:9,color:C.dim }}>note: using revenue overstates ROI vs gross profit</span>}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:16 }}>
        {/* ── LEFT: Inputs ── */}
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>

          {/* Conversion rate assumptions — always shown */}
          <div style={{ background:C.sur,border:`1px solid ${C.brd}`,borderRadius:10,padding:"14px 16px" }}>
            <p style={{ ...mono,margin:"0 0 12px",fontSize:10,color:C.dim,textTransform:"uppercase",letterSpacing:"0.08em" }}>Conversion Assumptions</p>
            <div style={{ display:"grid",gridTemplateColumns:pricingLinked?"1fr 1fr":"1fr 1fr 1fr",gap:10 }}>
              {!pricingLinked&&(
                <div>
                  <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:4 }}>
                    <span style={{ ...mono,fontSize:10,color:C.dim }}>Monthly sign-up attempts</span>
                    {pricingIntelFills.monthlyAttempts&&<span style={{ ...mono,fontSize:9,color:C.blue,background:`${C.blue}14`,border:`1px solid ${C.blue}33`,borderRadius:3,padding:"1px 6px" }} title="Auto-filled from Pricing Intelligence Grid">↗ pricing intel</span>}
                  </div>
                  <input type="number" min={1} step={100} value={monthlyAttempts} onChange={e=>{setMonthlyAttempts(parseFloat(e.target.value)||0);setPricingIntelFills(f=>({...f,monthlyAttempts:false}));}} style={{ ...inputSty }}/>
                </div>
              )}
              <div>
                <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:4 }}>
                  <span style={{ ...mono,fontSize:10,color:C.dim }}>Current conv rate (before)</span>
                  {pricingIntelFills.currentConvRate&&<span style={{ ...mono,fontSize:9,color:C.blue,background:`${C.blue}14`,border:`1px solid ${C.blue}33`,borderRadius:3,padding:"1px 6px" }} title="Auto-filled from Pricing Intelligence Grid">↗ pricing intel</span>}
                </div>
                <div style={{ display:"flex",alignItems:"center",gap:4 }}>
                  <input type="number" min={0} max={100} step={1} value={currentConvRate} onChange={e=>{setCurrentConvRate(parseFloat(e.target.value)||0);setPricingIntelFills(f=>({...f,currentConvRate:false}));}} style={{ ...inputSty,color:C.orange }} placeholder="60–70 typical"/>
                  <span style={{ ...mono,fontSize:12,color:C.dim }}>%</span>
                </div>
              </div>
              <div>
                <div style={{ ...mono,fontSize:10,color:C.dim,marginBottom:4 }}>Expected conv rate (after)</div>
                <div style={{ display:"flex",alignItems:"center",gap:4 }}>
                  <input type="number" min={0} max={100} step={1} value={newConvRate} onChange={e=>setNewConvRate(parseFloat(e.target.value)||0)} style={{ ...inputSty,color:convWarning?.type==="error"?C.red:C.green }} placeholder="prior × 1.10–1.25"/>
                  <span style={{ ...mono,fontSize:12,color:C.dim }}>%</span>
                </div>
              </div>
            </div>
            {/* Pricing-linked: show how conv rates translate to incremental users */}
            {pricingLinked&&(
              <div style={{ ...mono,fontSize:10,color:C.dim,marginTop:10,padding:"8px 10px",background:C.card,borderRadius:6 }}>
                {endUsers.toLocaleString()} total users × ({newConvRate}% − {currentConvRate}%) / {newConvRate}% = <span style={{ color:C.green,fontWeight:600 }}>{incrementalUsers.toLocaleString()} incremental users</span>
                {convFraction <= 0 && <span style={{ color:C.red,marginLeft:8 }}>— check your rates</span>}
              </div>
            )}
            {convWarning&&(
              <div style={{ ...mono,fontSize:10,marginTop:8,padding:"6px 10px",borderRadius:5,
                background:convWarning.type==="error"?`${C.red}12`:convWarning.type==="warn"?`${C.orange}12`:`${C.gold}12`,
                border:`1px solid ${convWarning.type==="error"?C.red:convWarning.type==="warn"?C.orange:C.gold}33`,
                color:convWarning.type==="error"?C.red:convWarning.type==="warn"?C.orange:C.gold }}>
                {convWarning.type==="error"?"✗":convWarning.type==="warn"?"⚠":"◦"} {convWarning.msg}
              </div>
            )}
          </div>

          {/* Core value input */}
          <div style={{ background:C.sur,border:`1px solid ${C.brd}`,borderRadius:10,padding:"14px 16px" }}>
            <p style={{ ...mono,margin:"0 0 12px",fontSize:10,color:C.dim,textTransform:"uppercase",letterSpacing:"0.08em" }}>Value per User</p>
            <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:5 }}>
              <span style={{ ...mono,fontSize:10,color:C.dim }}>Avg annual {vWord} per {pricingLinked?"active":""} user</span>
              {pricingIntelFills.avgRevenuePerUser&&<span style={{ ...mono,fontSize:9,color:C.blue,background:`${C.blue}14`,border:`1px solid ${C.blue}33`,borderRadius:3,padding:"1px 6px" }} title="Auto-filled from Pricing Intelligence Grid">↗ pricing intel</span>}
            </div>
            <div style={{ display:"flex",alignItems:"center",gap:4 }}>
              <span style={{ ...mono,fontSize:12,color:C.dim }}>$</span>
              <input type="number" min={0} step={25} value={avgRevenuePerUser} onChange={e=>{setAvgRevenuePerUser(parseFloat(e.target.value)||0);setPricingIntelFills(f=>({...f,avgRevenuePerUser:false}));}} style={{ ...inputSty,color:C.green }} placeholder="$75 default for consumer apps"/>
            </div>
            <div style={{ ...mono,fontSize:9,color:C.dim,marginTop:4 }}>Default $75 · range $50–150/user/yr</div>
          </div>

          {/* Add-on buckets */}
          <div style={{ background:C.sur,border:`1px solid ${C.brd}`,borderRadius:10,padding:"14px 16px" }}>
            <p style={{ ...mono,margin:"0 0 12px",fontSize:10,color:C.dim,textTransform:"uppercase",letterSpacing:"0.08em" }}>Add-on Buckets <span style={{ color:C.dim,fontWeight:400,textTransform:"none" }}>(optional)</span></p>

            {/* Ops add-on */}
            <div style={{ marginBottom:opsEnabled?12:0 }}>
              <div onClick={()=>setOpsEnabled(x=>!x)} style={{ display:"flex",alignItems:"center",gap:8,cursor:"pointer",userSelect:"none",marginBottom:opsEnabled?8:0 }}>
                <span style={{ ...mono,fontSize:11,color:opsEnabled?C.blue:C.dim }}>{opsEnabled?"▾":"▸"}</span>
                <span style={{ ...mono,fontSize:10,color:opsEnabled?C.blue:C.dim }}>Operational Savings</span>
                <span style={{ ...mono,fontSize:9,color:C.dim }}>IDV + Identity Match</span>
                {opsEnabled&&opsSavings>0&&<span style={{ marginLeft:"auto",...mono,fontSize:10,color:C.blue }}>{fmt(opsSavings)}/yr</span>}
              </div>
              {opsEnabled&&(
                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,paddingLeft:18 }}>
                  <div>
                    <div style={{ ...mono,fontSize:9,color:C.dim,marginBottom:3 }}>Hours saved per onboarded user</div>
                    <input type="number" min={0} step={0.1} value={hoursSavedPerUser} onChange={e=>setHoursSavedPerUser(parseFloat(e.target.value)||0)} style={{ ...inputSty,color:C.blue }} placeholder="0.3–0.5 typical"/>
                  </div>
                  <div>
                    <div style={{ ...mono,fontSize:9,color:C.dim,marginBottom:3 }}>Fully loaded cost/hour ($)</div>
                    <div style={{ display:"flex",alignItems:"center",gap:4 }}>
                      <span style={{ ...mono,fontSize:11,color:C.dim }}>$</span>
                      <input type="number" min={0} step={5} value={costPerHour} onChange={e=>setCostPerHour(parseFloat(e.target.value)||0)} style={{ ...inputSty,color:C.blue }}/>
                    </div>
                  </div>
                  <div style={{ gridColumn:"1/-1",...mono,fontSize:9,color:C.dim }}>
                    Calc: {incrementalUsers.toLocaleString()} users × {hoursSavedPerUser}h × ${costPerHour}/hr = <span style={{ color:C.blue }}>{fmt(opsSavings)}</span> · replacing manual verification
                  </div>
                </div>
              )}
            </div>

            {/* Fraud add-on (only if Signal/Protect in file, or no pricing file) */}
            {showFraudSection&&(
              <div style={{ paddingTop:opsEnabled?12:0,borderTop:opsEnabled?`1px solid ${C.brd}33`:"none" }}>
                <div onClick={()=>setFraudEnabled(x=>!x)} style={{ display:"flex",alignItems:"center",gap:8,cursor:"pointer",userSelect:"none",marginBottom:fraudEnabled?8:0 }}>
                  <span style={{ ...mono,fontSize:11,color:fraudEnabled?C.purple:C.dim }}>{fraudEnabled?"▾":"▸"}</span>
                  <span style={{ ...mono,fontSize:10,color:fraudEnabled?C.purple:C.dim }}>Fraud Savings</span>
                  <span style={{ ...mono,fontSize:9,color:C.dim }}>Signal + Protect</span>
                  {hasSignalOrProtect&&<span style={{ ...mono,fontSize:8,color:C.purple,background:`${C.purple}14`,border:`1px solid ${C.purple}33`,borderRadius:3,padding:"1px 4px" }}>in pricing</span>}
                  {fraudEnabled&&fraudSavings>0&&<span style={{ marginLeft:"auto",...mono,fontSize:10,color:C.purple }}>{fmt(fraudSavings)}/yr</span>}
                </div>
                {fraudEnabled&&(
                  <div style={{ display:"grid",gridTemplateColumns:"1fr auto",gap:8,alignItems:"end",paddingLeft:18 }}>
                    <div>
                      <div style={{ ...mono,fontSize:9,color:C.dim,marginBottom:3 }}>Baseline monthly fraud losses ($)</div>
                      <div style={{ display:"flex",alignItems:"center",gap:4 }}>
                        <span style={{ ...mono,fontSize:11,color:C.dim }}>$</span>
                        <input type="number" min={0} step={1000} value={baselineMonthlyFraudLoss} onChange={e=>setBaselineMonthlyFraudLoss(parseFloat(e.target.value)||0)} style={{ ...inputSty,color:C.purple }} placeholder="0.3% of monthly GMV"/>
                      </div>
                    </div>
                    <div>
                      <div style={{ ...mono,fontSize:9,color:C.dim,marginBottom:3 }}>This reduces by</div>
                      <div style={{ display:"flex",alignItems:"center",gap:4 }}>
                        <input type="number" min={20} max={40} step={5} value={fraudReductionPct} onChange={e=>setFraudReductionPct(parseFloat(e.target.value)||0)} style={{ ...inputSty,color:C.purple,width:55 }}/>
                        <span style={{ ...mono,fontSize:11,color:C.dim }}>%</span>
                      </div>
                    </div>
                    <div style={{ gridColumn:"1/-1",...mono,fontSize:9,color:C.dim }}>
                      {fmt(baselineMonthlyFraudLoss)} × 12 × {fraudReductionPct}% = <span style={{ color:C.purple }}>{fmt(fraudSavings)}</span> · default 30%, range 20–40%
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Costs + Growth */}
          <div style={{ background:C.sur,border:`1px solid ${C.brd}`,borderRadius:10,padding:"14px 16px" }}>
            <p style={{ ...mono,margin:"0 0 12px",fontSize:10,color:C.dim,textTransform:"uppercase",letterSpacing:"0.08em" }}>Costs & Projection</p>
            <div style={{ display:"grid",gridTemplateColumns:pricingLinked?"1fr 1fr":"1fr 1fr 1fr",gap:10 }}>
              <div>
                <div style={{ ...mono,fontSize:10,color:C.dim,marginBottom:4 }}>One-time integration cost</div>
                <div style={{ display:"flex",alignItems:"center",gap:4 }}>
                  <span style={{ ...mono,fontSize:12,color:C.dim }}>$</span>
                  <input type="number" min={0} step={1000} value={integrationCost} onChange={e=>setIntegrationCost(parseFloat(e.target.value)||0)} style={{ ...inputSty,color:C.orange }}/>
                </div>
              </div>
              {!pricingLinked&&(
                <div>
                  <div style={{ ...mono,fontSize:10,color:C.dim,marginBottom:4 }}>Annual cost (manual)</div>
                  <div style={{ display:"flex",alignItems:"center",gap:4 }}>
                    <span style={{ ...mono,fontSize:12,color:C.dim }}>$</span>
                    <input type="number" min={0} step={1000} value={manualCost} onChange={e=>setManualCost(parseFloat(e.target.value)||0)} style={{ ...inputSty,color:C.gold }}/>
                  </div>
                </div>
              )}
              <div>
                <div style={{ ...mono,fontSize:10,color:C.dim,marginBottom:4 }}>Yr 2/3 user growth</div>
                <div style={{ display:"flex",alignItems:"center",gap:4 }}>
                  <input type="number" min={0} max={200} step={5} value={yearlyGrowthRate} onChange={e=>setYearlyGrowthRate(parseFloat(e.target.value)||0)} style={{ ...inputSty,color:C.txt }}/>
                  <span style={{ ...mono,fontSize:12,color:C.dim }}>%</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── RIGHT: Results ── */}
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>

          {/* BASE CASE */}
          <div style={{ background:C.sur,border:`1px solid ${C.brd}`,borderRadius:10,padding:"14px 16px" }}>
            <p style={{ ...mono,margin:"0 0 10px",fontSize:10,color:C.dim,textTransform:"uppercase",letterSpacing:"0.08em" }}>Base Case</p>
            <div style={{ display:"flex",flexDirection:"column",gap:6 }}>
              {[
                ["Incremental users (Year 1)", incrementalUsers.toLocaleString(), C.txt],
                [`Incremental ${vWord} (Year 1)`, fmt(incrementalRevenue), C.green],
                ["Cost (Year 1)", fmt(productCost), C.orange],
                ["Net ROI (Year 1)", fmt(netValue), netValue>=0?C.green:C.red],
              ].map(([lbl,val,col])=>(
                <div key={lbl} style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"5px 0",borderBottom:`1px solid ${C.brd}22` }}>
                  <span style={{ ...mono,fontSize:11,color:C.dim }}>{lbl}</span>
                  <span style={{ ...mono,fontSize:13,fontWeight:600,color:col }}>{val}</span>
                </div>
              ))}
              <div style={{ display:"flex",gap:16,paddingTop:4 }}>
                <div style={{ ...mono,fontSize:11,color:C.dim }}>ROI% <span style={{ color:roiPctBase!==null?(roiPctBase>=200?C.green:roiPctBase>=50?C.txt:C.red):C.dim }}>{roiPctBase!==null?roiPctBase+"%":"—"}</span></div>
                <div style={{ ...mono,fontSize:11,color:C.dim }}>Payback <span style={{ color:C.txt }}>{paybackBase?"Month "+paybackBase:"—"}</span></div>
              </div>
            </div>
          </div>

          {/* WITH ADD-ONS (if any enabled) */}
          {anyAddOns&&(
            <div style={{ background:`${C.purple}08`,border:`1px solid ${C.purple}33`,borderRadius:10,padding:"14px 16px" }}>
              <p style={{ ...mono,margin:"0 0 10px",fontSize:10,color:C.purple,textTransform:"uppercase",letterSpacing:"0.08em" }}>With Add-ons</p>
              <div style={{ display:"flex",flexDirection:"column",gap:6 }}>
                {opsEnabled&&<div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"5px 0",borderBottom:`1px solid ${C.brd}22` }}>
                  <span style={{ ...mono,fontSize:11,color:C.dim }}>+ Operational savings (Year 1)</span>
                  <span style={{ ...mono,fontSize:13,fontWeight:600,color:C.blue }}>{fmt(opsSavings)}</span>
                </div>}
                {fraudEnabled&&showFraudSection&&<div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"5px 0",borderBottom:`1px solid ${C.brd}22` }}>
                  <span style={{ ...mono,fontSize:11,color:C.dim }}>+ Fraud savings (Year 1)</span>
                  <span style={{ ...mono,fontSize:13,fontWeight:600,color:C.purple }}>{fmt(fraudSavings)}</span>
                </div>}
                <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"5px 0",borderBottom:`1px solid ${C.brd}22` }}>
                  <span style={{ ...mono,fontSize:11,color:C.dim }}>Total value (Year 1)</span>
                  <span style={{ ...mono,fontSize:15,fontWeight:700,color:C.txt }}>{fmt(totalValue)}</span>
                </div>
                <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"5px 0",borderBottom:`1px solid ${C.brd}22` }}>
                  <span style={{ ...mono,fontSize:11,color:C.dim }}>Net ROI with add-ons (Year 1)</span>
                  <span style={{ ...mono,fontSize:13,fontWeight:600,color:netValueAdds>=0?C.green:C.red }}>{fmt(netValueAdds)}</span>
                </div>
                <div style={{ display:"flex",gap:16,paddingTop:4 }}>
                  <div style={{ ...mono,fontSize:11,color:C.dim }}>ROI% <span style={{ color:roiPctAdds!==null?(roiPctAdds>=200?C.green:roiPctAdds>=50?C.txt:C.red):C.dim }}>{roiPctAdds!==null?roiPctAdds+"%":"—"}</span></div>
                  <div style={{ ...mono,fontSize:11,color:C.dim }}>Payback <span style={{ color:C.txt }}>{paybackAdds?"Month "+paybackAdds:"—"}</span></div>
                </div>
                <div style={{ ...mono,fontSize:9,color:C.dim,marginTop:2 }}>includes {[opsEnabled?"operational":null,(fraudEnabled&&showFraudSection)?"fraud":null].filter(Boolean).join(" + ")} benefits</div>
              </div>
            </div>
          )}

          {/* Hero callout */}
          <div style={{ background:`${C.gold}0c`,border:`1px solid ${C.goldBdr}`,borderRadius:8,padding:"14px 16px" }}>
            {heroRoiRatio&&parseFloat(heroRoiRatio)>0
              ? <>
                  <div style={{ ...mono,fontSize:10,color:C.dim,marginBottom:3 }}>For every $1 spent,</div>
                  <div style={{ fontSize:20,fontWeight:700,color:C.gold }}>{acc?.name?.split(" ")[0]||"your customer"} generates <span style={{ fontSize:24 }}>${heroRoiRatio}</span></div>
                </>
              : <div style={{ ...mono,fontSize:12,color:C.dim }}>{pricingLinked?"Cost loaded from pricing":"Enter cost to compute ROI"}</div>
            }
            <div style={{ display:"flex",gap:14,marginTop:8,flexWrap:"wrap" }}>
              {heroPayback&&<div style={{ ...mono,fontSize:11,color:C.txt,fontWeight:600 }}>Pays for itself by Month {heroPayback}</div>}
              {heroRoiPct!==null&&<div style={{ ...mono,fontSize:11,color:C.dim }}>ROI% <span style={{ color:heroRoiPct>=200?C.green:heroRoiPct>=50?C.txt:C.red }}>{heroRoiPct}%</span></div>}
            </div>
            {isStrong&&<div style={{ ...mono,fontSize:10,color:C.green,marginTop:8,padding:"6px 10px",background:`${C.green}0f`,border:`1px solid ${C.green}33`,borderRadius:5 }}>✓ Strong story — payback ≤ 12 months, ROI ≥ 200%</div>}
            {isWeak&&<div style={{ ...mono,fontSize:10,color:C.orange,marginTop:8,padding:"6px 10px",background:`${C.orange}0f`,border:`1px solid ${C.orange}33`,borderRadius:5 }}>⚠ Revisit assumptions — aim for ≥ 200% ROI and payback within 24 months</div>}
          </div>

          {/* Save + Copy */}
          <div style={{ display:"grid",gridTemplateColumns:"1fr auto",gap:8 }}>
            <button onClick={save} disabled={!linkedAccId} style={{ ...mono,fontSize:13,padding:"10px",background:linkedAccId?`${C.gold}18`:"transparent",border:`1px solid ${linkedAccId?C.goldBdr:C.brd}`,color:linkedAccId?C.gold:C.dim,borderRadius:7,cursor:linkedAccId?"pointer":"not-allowed",fontWeight:600 }}>
              {linkedAccId?"Save ROI for "+acc?.name:"Link an account to save"}
            </button>
            <button onClick={e=>{ navigator.clipboard.writeText(copyText).catch(()=>{}); e.currentTarget.textContent="✓"; setTimeout(()=>{ if(e.currentTarget)e.currentTarget.textContent="Copy"; },2000); }}
              style={{ ...mono,fontSize:12,padding:"10px 14px",background:`${C.blue}14`,border:`1px solid ${C.blue}44`,color:C.blue,borderRadius:7,cursor:"pointer" }}>
              Copy
            </button>
          </div>
        </div>
      </div>

      {/* 12-month cumulative chart */}
      <div style={{ background:C.sur,border:`1px solid ${C.brd}`,borderRadius:10,padding:"14px 16px",marginBottom:12 }}>
        <div style={{ display:"flex",alignItems:"center",gap:16,marginBottom:8 }}>
          <span style={{ ...mono,fontSize:12,color:C.txt,fontWeight:700 }}>12-Month Cumulative Net ROI</span>
          {breakEven&&<span style={{ ...mono,fontSize:11,color:C.green }}>✓ Break-even Month {breakEven}</span>}
          <span style={{ marginLeft:"auto",...mono,fontSize:11,color:cumulativeData[11]>=0?C.green:C.red }}>Mo 12: {fmt(cumulativeData[11])}</span>
        </div>
        <svg viewBox={`0 0 ${chartW} ${chartH}`} style={{ width:"100%",height:"auto",display:"block" }}>
          {[0,0.25,0.5,0.75,1].map(pct=>{
            const val=minCum+(maxCum-minCum)*pct; const y=yScale(val);
            return <g key={pct}>
              <line x1={padL} x2={chartW-padR} y1={y} y2={y} stroke={C.brd} strokeWidth={0.5} opacity={0.6}/>
              <text x={padL-4} y={y+3.5} textAnchor="end" fontSize={8} fill={C.dim} fontFamily="ui-monospace,monospace">{val>=0?"$":"−$"}{Math.abs(Math.round(val/1000))}k</text>
            </g>;
          })}
          {minCum<0&&<line x1={padL} x2={chartW-padR} y1={zeroY} y2={zeroY} stroke={C.brd} strokeWidth={1} opacity={0.9}/>}
          {cumulativeData.map((v,i)=>{
            const bH=Math.abs(yScale(v)-zeroY); const y=v>=0?yScale(v):zeroY;
            return <g key={i}>
              <rect x={xC(i)-barW/2} y={y} width={barW} height={Math.max(1,bH)} fill={v>=0?C.green:C.red} opacity={0.75}/>
              <text x={xC(i)} y={chartH-padB+13} textAnchor="middle" fontSize={8} fill={C.dim} fontFamily="ui-monospace,monospace">{i===0?"Mo 1":i===11?"Mo 12":i+1}</text>
            </g>;
          })}
        </svg>
      </div>

      {/* 3-year projection chart */}
      <div style={{ background:C.sur,border:`1px solid ${C.brd}`,borderRadius:10,padding:"14px 16px" }}>
        <div style={{ display:"flex",alignItems:"center",gap:16,marginBottom:8 }}>
          <span style={{ ...mono,fontSize:12,color:C.txt,fontWeight:700 }}>3-Year Value vs Cost</span>
          <div style={{ display:"flex",gap:10 }}>
            <span style={{ ...mono,fontSize:10,color:C.green }}>▮ Value</span>
            <span style={{ ...mono,fontSize:10,color:C.orange }}>▮ Cost</span>
          </div>
          <span style={{ marginLeft:"auto",...mono,fontSize:11,color:C.dim }}>3yr total: <span style={{ color:C.green,fontWeight:600 }}>{fmt(threeYrValue)}</span></span>
        </div>
        <svg viewBox={`0 0 ${y3W} ${y3H}`} style={{ width:"100%",height:"auto",display:"block" }}>
          {[0,0.5,1].map(pct=>{
            const val=yrMax*pct; const y=y3Y(val);
            return <g key={pct}>
              <line x1={y3PL} x2={y3W-y3PR} y1={y} y2={y} stroke={C.brd} strokeWidth={0.5} opacity={0.6}/>
              <text x={y3PL-4} y={y+3} textAnchor="end" fontSize={8} fill={C.dim} fontFamily="ui-monospace,monospace">${Math.round(val/1000)}k</text>
            </g>;
          })}
          {[[yr1V,yr1C,0,"Year 1"],[yr2V,yr2C,1,"Year 2"],[yr3V,yr3C,2,"Year 3"]].map(([val,cost,i,lbl])=>(
            <g key={lbl}>
              <rect x={y3X(i)-y3BW-2} y={y3Y(val)} width={y3BW} height={y3H2(val)} fill={C.green} opacity={0.8}/>
              <rect x={y3X(i)+2} y={y3Y(cost)} width={y3BW} height={y3H2(cost)} fill={C.orange} opacity={0.8}/>
              <text x={y3X(i)} y={y3H-y3PB+12} textAnchor="middle" fontSize={9} fill={C.txt} fontFamily="ui-monospace,monospace">{lbl}</text>
              <text x={y3X(i)-y3BW/2-2} y={y3Y(val)-3} textAnchor="middle" fontSize={7} fill={C.green} fontFamily="ui-monospace,monospace">{fmt(val)}</text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

export default RoiPage;
