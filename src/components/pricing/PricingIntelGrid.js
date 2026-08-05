import React, { useState } from 'react';
import { C, mono } from '../../constants/colors';

// ── Persistence ───────────────────────────────────────────────────────────────
const INTEL_KEY = "prospector_pricing_intel";
const loadIntel = () => { try { return JSON.parse(localStorage.getItem(INTEL_KEY)||"{}"); } catch { return {}; } };
const saveIntel = (id, data) => { const a=loadIntel(); a[id]={...a[id],...data,savedAt:new Date().toISOString()}; localStorage.setItem(INTEL_KEY,JSON.stringify(a)); };

// ── Product aliases for scoring ───────────────────────────────────────────────
const ALIASES = {
  "Auth & Identity":       ["auth","identity","bank account verification","account linking","bav"],
  "Transactions":          ["transaction","transaction data","bank transactions","ledger"],
  "Signal":                ["signal","ach risk","nsf","fraud detection"],
  "Assets":                ["assets","bank balance","net worth","account balance"],
  "Income":                ["income","pay stub","payroll","income verification"],
  "Identity Verification": ["idv","kyc","identity verification","selfie","document check"],
  "Transfer":              ["transfer","ach","money movement","funds transfer"],
  "Layer":                 ["layer","hosted link","embedded onboarding"],
};

const PILL = {
  confirmed: { bg:"#051a14", color:"#00C9A7", brd:"#00C9A7" },
  likely:    { bg:"#1a1200", color:"#f59e0b", brd:"#f59e0b" },
  possible:  { bg:"transparent", color:"#555",    brd:"#333"    },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildText(acc) {
  const med = acc.medpicc || {};
  const calls = acc.calls || [];
  return [
    acc.bm, acc.pf, acc.notes, acc.dis,
    ...(acc.sigs||[]), ...(acc.ucs||[]), ...(acc.tractionSignals||[]),
    acc.estimatedDownstreamUsers,
    Object.values(med).join(" "),
    ...calls.flatMap(c => [
      c.summary, c.decisionMaker, c.timeline,
      ...(c.painPoints||[]).map(p => typeof p==="string"?p:(p?.detail||p?.topic||"")),
      ...(c.nextSteps||[]).map(ns => typeof ns==="string"?ns:(ns?.text||"")),
      ...(c.openQuestions||[]),
      ...(c.productsDiscussed||[]).map(p => p.product||p),
    ]),
    ...(acc.personas||[]).flatMap(p => [p.name, p.title, p.angle]),
  ].filter(Boolean).join(" ").replace(/[\n\r]/g," ").toLowerCase();
}

function scoreProduct(prod, acc, text) {
  const name = prod.name.toLowerCase();
  const aliases = ALIASES[prod.name] || [];
  const hit = text.includes(name) || aliases.some(a => text.includes(a));
  const inProds = (acc.prods||[]).some(p => p.toLowerCase() === name);
  const medText = Object.values(acc.medpicc||{}).join(" ").toLowerCase();
  const inMed = medText.includes(name.split(" ")[0]) || aliases.some(a => medText.includes(a));
  if (hit && inProds) return "confirmed";
  if (hit || inProds) return "likely";
  if (inMed) return "possible";
  return "none";
}

function extractVolume(text) {
  const pN = s => parseInt((s||"").replace(/[,\s]/g,""), 10);
  const toN = raw => { const r=raw.toLowerCase(); return r.endsWith("k")?parseFloat(r)*1000:r.endsWith("m")?parseFloat(r)*1e6:pN(r); };

  const projPat = /month\s*(\d{1,2})\s*(?:projection|estimate|target)?[:\s-]{0,10}([\d,]+)\s*(?:users?|customers?|accounts?|people)?/gi;
  const projs = {};
  let m;
  while ((m = projPat.exec(text)) !== null) {
    const mo = parseInt(m[1], 10), n = pN(m[2]);
    if (mo >= 1 && mo <= 24 && n > 0) projs[mo] = n;
  }
  const m1p = projs[1]||projs[2], m12p = projs[12]||projs[11];
  if (m1p||m12p) return { m1:m1p||0, m12:m12p||0, isMonthly:false };

  const entityMonthlyPat = /(\d[\d,.]*[km]?)\s*(?:clients?|deals?|files?|applications?|loans?|users?|customers?)\s*(?:a|per)\s*month/i;
  const fuzzyMonthlyPat  = /(?:about|maybe|probably|roughly|around)\s+(\d[\d,.]*[km]?)\s*(?:a\s+month|monthly|per\s+month)/i;
  const monthlyPat       = /(\d[\d,.]*[km]?)\s*(?:a|per)\s*month\b/i;
  const entityPat        = /(\d[\d,.]*[km]?)\s*(?:users?|customers?|merchants?|members?|accounts?|clients?|deals?|applications?|loans?|files?)\b/i;
  const approxMonthlyPat = /about\s+(\d[\d,.]*[km]?)\s*(?:a\s+month\b)?/i;

  const emMatch = text.match(entityMonthlyPat);
  if (emMatch) { const n=toN(emMatch[1]); return { m1:Math.round(n), m12:Math.round(n*12), isMonthly:true }; }
  const fmMatch = text.match(fuzzyMonthlyPat);
  if (fmMatch) { const n=toN(fmMatch[1]); return { m1:Math.round(n), m12:Math.round(n*12), isMonthly:true }; }
  const moMatch = text.match(monthlyPat);
  if (moMatch) { const n=toN(moMatch[1]); return { m1:Math.round(n), m12:Math.round(n*12), isMonthly:true }; }
  const entityMatch = text.match(entityPat);
  if (entityMatch) { const n=toN(entityMatch[1]); return { m1:0, m12:Math.round(n), isMonthly:false }; }
  const amMatch = text.match(approxMonthlyPat);
  if (amMatch) { const n=toN(amMatch[1]); return { m1:Math.round(n), m12:Math.round(n*12), isMonthly:true }; }
  return { m1:0, m12:0, isMonthly:false };
}

function extractCells(text, acc, monthlyUsers, avgAccounts) {
  const med = acc.medpicc || {};
  const calls = acc.calls || [];
  const vol = extractVolume(text);
  const m12v = monthlyUsers[11] > 0 ? monthlyUsers[11] : vol.m12;
  const m12Label = monthlyUsers[11] > 0
    ? m12v.toLocaleString()
    : (vol.isMonthly && vol.m12 > 0)
      ? `~${vol.m12.toLocaleString()} est.`
      : m12v > 0 ? m12v.toLocaleString() : null;

  const tlMatch =
    text.match(/(?:q[1-4]\s*(?:20\d\d)?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s*(?:20\d\d)?)\s*(?:launch|go.live|prod|target|billing|start)/i) ||
    text.match(/(?:launch|go.live|billing|start)\s*(?:by|in|around)?\s*(?:q[1-4]|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*)/i);
  const tStr = (tlMatch?.[0]||med.timeline||calls.map(c=>c.timeline).filter(Boolean).slice(-1)[0]||"").trim().slice(0,50)||null;

  const conv = text.match(/(\d{1,3}(?:\.\d+)?)\s*%\s*(?:conversion|convert|complete|onboard|link)/i) ||
               text.match(/(?:conversion|onboard|link)\s+rate[^\d]{0,15}(\d{1,3}(?:\.\d+)?)\s*%/i) ||
               text.match(/(\d{1,3}(?:\.\d+)?)\s*%\s*(?:approval|approved|success|qualify)/i) ||
               text.match(/(\d{1,3})\s*(?:percent|%)\s*(?:approval|approved|conversion|qualify|get through|success)/i) ||
               text.match(/(?:we're at|probably|about|around)\s+(\d{1,3})\s*(?:percent|%)/i);
  const moR  = text.match(/\$\s*([\d.]+)\s*(?:to|-|–)\s*\$?\s*([\d.]+)\s*(?:\/\s*mo|per\s+mo|\/\s*month)/i);
  const moS  = text.match(/\$\s*([\d.]+)\s*(?:\/\s*mo|per\s+mo|\/\s*month|monthly)/i);
  const annV = text.match(/\$\s*([\d,.]+[km]?)\s*(?:per\s+(?:user|customer)|arpu)/i);
  const valStr = moR ? `$${moR[1]}–$${moR[2]}/mo` : moS ? `$${moS[1]}/mo` : annV ? `$${annV[1]}/yr per user` : null;

  return {
    mo12:       { v: m12Label,                                   s: m12v>0?(monthlyUsers[11]>0?"g":"a"):"r", q:"How many users in month 12?" },
    avgAccts:   { v: avgAccounts>0 ? String(avgAccounts) : null, s: avgAccounts>0?"g":"r",                   q:"How many bank accounts per user on average?" },
    billingStart:{ v: tStr,                                      s: tStr?"g":"r",                            q:"When does billing start?" },
    convRate:   { v: conv ? `${conv[1]}%` : null,                s: conv?"a":"r",                            q:"What % of signups complete onboarding today?" },
    valueUser:  { v: valStr,                                     s: valStr?"a":"r",                          q:"What's the average monthly subscription price per user?" },
    goLive:     { v: tStr,                                       s: tStr?"g":"r",                            q:"What's your target go-live date?" },
  };
}

function hockeyStick(m1, m12) {
  return Array.from({length:12}, (_,i) => {
    const t = i/11;
    return Math.round(m1 + (m12-m1) * Math.pow(t, 2.2));
  });
}

// ── Component ─────────────────────────────────────────────────────────────────
function PricingIntelGrid({
  linkedAcc, linkedAccId,
  intelGridOpen, setIntelGridOpen, saveIntelOpen,
  products, setProducts, monthlyUsers, setMonthlyUsers,
  avgAccounts, setAvgAccounts,
  autoFillPendingRef,
  PRICING_PRODUCTS_DEFAULT, lerp12,
}) {
  const [rampType,  setRampType]  = useState("linear");
  const [editCell,  setEditCell]  = useState(null);
  const [editVal,   setEditVal]   = useState("");

  if (!linkedAcc) return null;

  const acc  = linkedAcc;
  const text = buildText(acc);

  // Merge manually-saved intel over extracted values
  const savedIntel = loadIntel()[acc.id] || {};
  const cells = extractCells(text, acc, monthlyUsers, avgAccounts);
  if (savedIntel.convRate) {
    cells.convRate.v = `${savedIntel.convRate}%`;
    cells.convRate.s = "g";
  }

  const mo1  = monthlyUsers[0]  || 0;
  const mo12 = monthlyUsers[11] || 0;

  const allProds = PRICING_PRODUCTS_DEFAULT || products || [];
  const scoredProds = allProds
    .map(p => ({ ...p, conf: scoreProduct(p, acc, text) }))
    .filter(p => p.conf !== "none")
    .filter((p, i, arr) => arr.findIndex(x => x.name === p.name) === i);

  // Auto-populate on first link
  if (autoFillPendingRef?.current) {
    autoFillPendingRef.current = false;
    setTimeout(() => {
      setProducts(ps => ps.map(p => {
        const s = scoredProds.find(x => x.id === p.id);
        return (s?.conf === "confirmed" || s?.conf === "likely") ? { ...p, included: true } : p;
      }));
      const vol = extractVolume(text);
      if (monthlyUsers[11] === 0 && vol.m12 > 0) {
        setMonthlyUsers(lerp12(vol.m1 || Math.round(vol.m12*0.1), vol.m12));
      }
    }, 0);
  }

  const isIncluded = id => !!products.find(p => p.id === id)?.included;
  const toggleProd = p => setProducts(ps => ps.map(q => q.id===p.id ? {...q, included:!q.included} : q));

  const applyRamp = (type, s=mo1, e=mo12) => {
    setMonthlyUsers(type==="hockey" ? hockeyStick(s, e) : lerp12(s, e));
  };

  const startEdit = (key, currentVal) => {
    setEditCell(key);
    setEditVal(currentVal ? currentVal.replace(/[%$,a-zA-Z\s/–]/g, "").trim() : "");
  };

  const commitEdit = key => {
    const n = parseFloat(editVal.replace(/,/g,""));
    if (!isNaN(n) && n > 0) {
      if (key === "mo12")     applyRamp(rampType, undefined, Math.round(n));
      else if (key === "avgAccts")  setAvgAccounts(n);
      else if (key === "convRate") { if (n <= 100) saveIntel(acc.id, { convRate: n }); }
    }
    setEditCell(null);
  };

  const toggleGrid = () => {
    const next = !intelGridOpen;
    setIntelGridOpen(next);
    if (saveIntelOpen) saveIntelOpen(acc.id, next);
  };

  // Ramp SVG
  const SW=360, SH=110, PL=8, PR=8, PT=12, PB=20;
  const maxU = Math.max(...monthlyUsers, 1);
  const px = i => PL + (i/11)*(SW-PL-PR);
  const py = i => PT + (1 - monthlyUsers[i]/maxU) * (SH-PT-PB);
  const pts = monthlyUsers.map((_,i) => `${px(i)},${py(i)}`).join(" ");

  const STATUS = { g: C.green, a: C.gold, r: "#555" };

  const CELLS = [
    { key:"mo12",        label:"Mo.12 Users",      editable:true  },
    { key:"avgAccts",    label:"Avg Accts / User",  editable:true  },
    { key:"billingStart",label:"Billing Start",     editable:false },
    { key:"convRate",    label:"Conversion Rate",   editable:true  },
    { key:"valueUser",   label:"Value / User",      editable:false },
    { key:"goLive",      label:"Go-Live Target",    editable:false },
  ];

  return (
    <div style={{ marginBottom:16, background:"#080808", border:"0.5px solid #1e1e1e", borderRadius:6, overflow:"hidden" }}>

      {/* Header */}
      <div onClick={toggleGrid} style={{ display:"flex", alignItems:"center", padding:"10px 14px", cursor:"pointer", userSelect:"none" }}>
        <span style={{ ...mono, fontSize:12, color:C.gold, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.1em" }}>✦ Pricing Intelligence</span>
        <span style={{ ...mono, fontSize:11, color:C.dim, marginLeft:"auto" }}>{intelGridOpen ? "▲ collapse" : "▼ expand"}</span>
      </div>

      {intelGridOpen && (
        <div style={{ padding:"0 14px 14px" }}>

          {/* ── Zone 1: Product signals ── */}
          {scoredProds.length > 0 && (
            <div style={{ marginBottom:14 }}>
              <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:8 }}>
                {scoredProds.map(p => {
                  const sty = PILL[p.conf];
                  const on  = isIncluded(p.id);
                  return (
                    <button key={p.id} onClick={() => toggleProd(p)}
                      title={`${p.conf} — click to ${on ? "remove" : "add"}`}
                      style={{
                        ...mono, fontSize:13, padding:"4px 12px", borderRadius:14, cursor:"pointer",
                        background: on ? sty.bg : "transparent",
                        border: `1px solid ${on ? sty.brd : "#2a2a2a"}`,
                        color: on ? sty.color : "#555",
                        fontWeight: on ? 600 : 400,
                        transition: "all 0.1s",
                      }}>
                      {p.name}
                    </button>
                  );
                })}
              </div>
              <div style={{ display:"flex", gap:16 }}>
                {["confirmed","likely","possible"].map(lvl => (
                  <span key={lvl} style={{ ...mono, fontSize:12, color: PILL[lvl].color, display:"flex", alignItems:"center", gap:5 }}>
                    <span style={{ fontSize:10 }}>●</span>
                    <span style={{ color:"#666", textTransform:"lowercase" }}>{lvl}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ── Zone 2: Key stat boxes ── */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6, marginBottom:14 }}>
            {CELLS.map(({ key, label, editable }) => {
              const c      = cells[key];
              const col    = STATUS[c.s];
              const miss   = !c.v;
              const editing = editCell === key;

              return (
                <div key={key} style={{ background:"#0d0d0d", border:"0.5px solid #1e1e1e", borderRadius:5, padding:"10px 12px", minHeight:56 }}>
                  {editing ? (
                    <>
                      <input autoFocus value={editVal}
                        onChange={e => setEditVal(e.target.value)}
                        onBlur={() => commitEdit(key)}
                        onKeyDown={e => { if(e.key==="Enter") commitEdit(key); if(e.key==="Escape") setEditCell(null); }}
                        style={{ ...mono, fontSize:15, color:C.txt, background:"transparent", border:"none", borderBottom:`1px solid ${C.gold}`, outline:"none", width:"100%", padding:"0 0 2px", display:"block", marginBottom:4 }}
                      />
                      <div style={{ ...mono, fontSize:11, color:"#555", marginTop:4 }}>{label}</div>
                    </>
                  ) : miss ? (
                    <>
                      <button
                        onClick={() => editable ? startEdit(key, "") : undefined}
                        style={{ ...mono, fontSize:13, color:"#444", background:"transparent", border:"none", cursor: editable ? "pointer" : "default", padding:0, display:"flex", alignItems:"center", gap:5 }}>
                        Not set
                        {editable && <span style={{ fontSize:12, opacity:0.5 }}>✎</span>}
                      </button>
                      <div style={{ ...mono, fontSize:11, color:"#555", marginTop:5 }}>{label}</div>
                    </>
                  ) : (
                    <>
                      <div
                        onClick={() => editable ? startEdit(key, c.v) : undefined}
                        style={{ cursor: editable ? "pointer" : "default", display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
                        <span style={{ ...mono, fontSize:15, color:col, wordBreak:"break-word", lineHeight:1.3 }}>{c.v}</span>
                        {editable && <span style={{ ...mono, fontSize:10, color:"#2a2a2a" }}>✎</span>}
                      </div>
                      <div style={{ ...mono, fontSize:11, color:"#555" }}>{label}</div>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Zone 3: Ramp shape ── */}
          <div>
            <div style={{ display:"flex", gap:6, alignItems:"center", marginBottom:8 }}>
              <span style={{ ...mono, fontSize:12, color:"#555", marginRight:2 }}>Ramp shape</span>
              {["linear","hockey","custom"].map(t => (
                <button key={t} onClick={() => { setRampType(t); if(t !== "custom") applyRamp(t); }}
                  style={{
                    ...mono, fontSize:12, padding:"3px 10px", borderRadius:3, cursor:"pointer",
                    background: rampType===t ? `${C.gold}18` : "transparent",
                    border: `1px solid ${rampType===t ? C.goldBdr : "#222"}`,
                    color: rampType===t ? C.gold : "#555",
                  }}>
                  {t === "hockey" ? "hockey stick" : t}
                </button>
              ))}
            </div>

            <svg width={SW} height={SH} style={{ display:"block", marginBottom:8, overflow:"visible" }}>
              {/* Grid lines */}
              {[0,0.5,1].map(f => (
                <line key={f} x1={PL} x2={SW-PR} y1={PT+(1-f)*(SH-PT-PB)} y2={PT+(1-f)*(SH-PT-PB)} stroke="#1a1a1a" strokeWidth={1}/>
              ))}
              <polyline points={pts} fill="none" stroke={`${C.gold}66`} strokeWidth={2} strokeLinejoin="round"/>
              {/* Area fill */}
              <polyline points={`${px(0)},${SH-PB} ${pts} ${px(11)},${SH-PB}`} fill={`${C.gold}0a`} stroke="none"/>
              <circle cx={px(0)}  cy={py(0)}  r={4} fill={C.gold}/>
              <circle cx={px(5)}  cy={py(5)}  r={3} fill={`${C.gold}66`}/>
              <circle cx={px(11)} cy={py(11)} r={4} fill={C.green}/>
              <text x={px(0)+6}   y={Math.min(py(0)-5, SH-PB-4)} fill="#555" fontSize="10" fontFamily="monospace">Mo.1</text>
              <text x={px(5)-10}  y={SH-2}                         fill="#444" fontSize="10" fontFamily="monospace">Mo.6</text>
              <text x={px(11)-30} y={Math.min(py(11)-5, SH-PB-4)} fill="#555" fontSize="10" fontFamily="monospace">Mo.12</text>
            </svg>

            <div style={{ display:"flex", gap:16, alignItems:"center" }}>
              {[{lbl:"Mo.1", val:mo1, start:true}, {lbl:"Mo.12", val:mo12, start:false}].map(({lbl, val, start}) => (
                <div key={lbl} style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <span style={{ ...mono, fontSize:12, color:"#555" }}>{lbl}</span>
                  <input type="number" min="0" step="100" value={val}
                    onChange={e => {
                      const n = parseInt(e.target.value) || 0;
                      if (rampType === "custom") { const next=[...monthlyUsers]; next[start?0:11]=n; setMonthlyUsers(next); }
                      else applyRamp(rampType, start?n:undefined, start?undefined:n);
                    }}
                    style={{ ...mono, width:80, background:"transparent", border:"1px solid #222", borderRadius:3, color:C.txt, fontSize:13, padding:"4px 8px", outline:"none" }}
                  />
                </div>
              ))}
              <span style={{ ...mono, fontSize:12, color:"#444" }}>{mo1.toLocaleString()} → {mo12.toLocaleString()}</span>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}

export default PricingIntelGrid;
