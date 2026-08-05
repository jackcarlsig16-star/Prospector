import React from 'react';
import { C, mono } from '../../constants/colors';
import { APPROVAL_LEVELS } from '../../constants/approvalMatrix';
import { PF_TIERS } from '../../constants/products';

function CalcTab({
  // Growth curve
  growthSvgRef, draggingIdx, setDraggingIdx,
  gChartW, gChartH, gPadT, gPadB, gPadL, gPadR, gInnerH, gMax, gYScale, gXCenter, gSlot,
  monthlyUsers, setMonthlyUsers, startUsers, endUsers,
  avgAccounts, setAvgAccounts, onDemand, setOnDemand,
  lerp12,
  // Platform fee
  pfTier, setPfTier, pfDiscount, setPfDiscount, pfRamp, setPfRamp, pfRampSched, setPfRampSched,
  isPartner, setIsPartner, partnerFee, setPartnerFee,
  tierAmount, discountedTierAmount, activeTierObj,
  // Commitment
  commitFee, setCommitFee, commitRamp, setCommitRamp, commitRampSched, setCommitRampSched,
  billingStart, setBillingStart,
  upfrontEnabled, setUpfrontEnabled, upfrontAmount, setUpfrontAmount,
  // Tiers
  tieredPricing, setTieredPricing, tiers, setTiers,
  // Computed
  monthlyBreakdown, mo1, mo12,
  annualTotal, annualBase, annualSavings,
  annualSingleTotal, annualRecurringTotal, annualOnDemandTotal, annualPfTotal, annualPartnerFeeTotal,
  minimumAnnual, variableAnnual, annualBest, annualConservative,
  monthlyBest, monthlyConservative, confPct, confidence, setConfidence,
  activeDealPfLabel,
  // Chart helpers
  chartW, chartH, padT, padB, padL, padR, innerW, innerH, maxVal, barSlot, barW, yScale, xCenter, donutArc,
  // Products
  products, setProducts, filtered, search, setSearch, rateMode, setRateMode,
  selectedCount, showApprovals, hideForExport, calcApproval,
  toggleIncluded, setCustom, setAdoption, prodAnnualVolume,
  // Format helpers
  fmt, fmtK, fmtRate, TYPE_LABEL, TYPE_COLOR,
  PRICING_PRODUCTS_DEFAULT,
}) {
  const activeBundles = (products || []).filter(p => p.isBundle && p.included);
  const findExcludingBundle = (p) => {
    if (!p.slug || p.isBundle || !activeBundles.length) return null;
    return activeBundles.find(b => (b.mutuallyExclusiveWith || []).includes(p.slug)) || null;
  };
  return (
    <>
      {/* ── Growth curve ── */}
      <div style={{ background:C.sur, borderRadius:10, border:`1px solid ${C.brd}`, padding:"14px 16px 10px", marginBottom:12 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:8 }}>
          <span style={{ ...mono, fontSize:12, color:C.txt, fontWeight:700 }}>User Growth</span>
          <span style={{ ...mono, fontSize:11, color:C.mut }}>drag points to sculpt curve</span>
          <button onClick={()=>setMonthlyUsers(lerp12(startUsers,endUsers))} style={{ ...mono, fontSize:10, padding:"2px 8px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:4, color:C.dim, cursor:"pointer" }}>↺ linear</button>
          <span style={{ marginLeft:"auto", ...mono, fontSize:11, color:C.blue }}>Mo 1: {startUsers.toLocaleString()}</span>
          <span style={{ ...mono, fontSize:11, color:C.green }}>Mo 12: {endUsers.toLocaleString()}</span>
        </div>
        <svg ref={growthSvgRef} viewBox={`0 0 ${gChartW} ${gChartH}`} style={{ width:"100%", height:"auto", display:"block", cursor: draggingIdx!==null?"ns-resize":"default" }} onMouseLeave={()=>{ if(draggingIdx!==null) setDraggingIdx(null); }}>
          {[0,0.25,0.5,0.75,1].map(pct=>{
            const y=gYScale(gMax*pct);
            return <g key={pct}>
              <line x1={gPadL} x2={gChartW-gPadR} y1={y} y2={y} stroke={C.brd} strokeWidth={pct===0?1:0.5} opacity={0.5}/>
              <text x={gPadL-4} y={y+3.5} textAnchor="end" fontSize={8} fill={C.dim} fontFamily="ui-monospace,monospace">{(gMax*pct/1000).toFixed(0)}k</text>
            </g>;
          })}
          {/* Area fill */}
          <polygon
            points={[
              `${gPadL},${gChartH-gPadB}`,
              ...monthlyUsers.map((_,i)=>`${gXCenter(i)},${gYScale(monthlyUsers[i])}`),
              `${gXCenter(11)},${gChartH-gPadB}`,
            ].join(" ")}
            fill={`${C.blue}18`}
          />
          {/* Line */}
          <polyline
            points={monthlyUsers.map((_,i)=>`${gXCenter(i)},${gYScale(monthlyUsers[i])}`).join(" ")}
            fill="none" stroke={C.blue} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round"
          />
          {/* Month labels + delta + total */}
          {monthlyUsers.map((v,i)=>{
            const prev = monthlyUsers[i-1] ?? v;
            const delta = v - prev;
            const gK = n => n>=1000?(n/1000).toFixed(n>=10000?0:1)+"k":String(n);
            const base = gChartH - gPadB;
            return <g key={i}>
              <text x={gXCenter(i)} y={base+12} textAnchor="middle" fontSize={8} fill={C.dim} fontFamily="ui-monospace,monospace">
                {i===0?"Mo 1":i===11?"Mo 12":i+1}
              </text>
              <text x={gXCenter(i)} y={base+24} textAnchor="middle" fontSize={8.5} fill={C.blue} fontFamily="ui-monospace,monospace" fontWeight="600">
                {gK(v)}
              </text>
              <text x={gXCenter(i)} y={base+37} textAnchor="middle" fontSize={8} fill={i===0||delta===0?C.dim:delta>0?C.green:C.red} fontFamily="ui-monospace,monospace">
                {i===0?"—":delta===0?"±0":(delta>0?"+":"")+gK(delta)}
              </text>
            </g>;
          })}
          {/* Draggable handles */}
          {monthlyUsers.map((v,i)=>(
            <circle key={i} cx={gXCenter(i)} cy={gYScale(v)} r={draggingIdx===i?7:5}
              fill={draggingIdx===i?C.blue:`${C.blue}99`} stroke={C.bg} strokeWidth={1.5}
              style={{ cursor:"ns-resize" }}
              onMouseDown={e=>{ e.preventDefault(); setDraggingIdx(i); }}
              onTouchStart={e=>{ e.preventDefault(); setDraggingIdx(i); }}
            />
          ))}
        </svg>
        {/* Start/end anchor sliders */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:20, marginTop:12, paddingTop:12, borderTop:`1px solid ${C.brd}` }}>
          {[
            { label:"Start users", val:startUsers, set: v => setMonthlyUsers(prev=>lerp12(v, prev[11])), col:C.blue, cls:"blue" },
            { label:"End users",   val:endUsers,   set: v => setMonthlyUsers(prev=>lerp12(prev[0], v)),  col:C.green, cls:"green" },
            { label:"Avg accounts per user", val:avgAccounts, set:setAvgAccounts, col:C.blue, cls:"blue", isFloat:true, max:10, step:0.5 },
            { label:"On-demand calls per user/month", val:onDemand, set:setOnDemand, col:C.orange, cls:"orange", isFloat:true, isOnDemand:true, step:0.01, max:20 },
          ].map(row => {
            const isUser = row.label.includes("users");
            const maxVal = isUser ? Math.max(gMax, 100) : (row.max ?? Math.max(row.val*2, 10000));
            const stepVal = row.step ?? Math.max(1, Math.round(maxVal/200));
            const OD_PICKS = [
              { v:0.1,  lb:"1 in 10" },
              { v:0.25, lb:"1 in 4"  },
              { v:0.5,  lb:"1 in 2"  },
              { v:1,    lb:"monthly" },
              { v:2,    lb:"2x/mo"   },
              { v:4,    lb:"4x/mo"   },
              { v:10,   lb:"10x/mo"  },
            ];
            const odFreqLabel = v => {
              if (!v || v === 0) return "0 = no on-demand product calls";
              if (v < 1) return `${v} = 1 in ${Math.round(1/v)} active users call per month`;
              if (v === 1) return "1.0 = every active user calls once per month";
              return `${v} = every active user calls ${v}× per month`;
            };
            const avgUsers = Math.round(monthlyUsers.reduce((s,u)=>s+u,0)/12);
            const effectiveCalls = Math.round(avgUsers * (row.isOnDemand ? row.val : 0));
            return (
              <div key={row.label}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:2 }}>
                  <span style={{ ...mono, fontSize:11, color:row.col, fontWeight:600 }}>{row.label}</span>
                  <input type="number" min="0" step={stepVal} value={row.val}
                    onChange={e => row.set(row.isFloat ? (parseFloat(e.target.value) || 0) : (parseInt(e.target.value) || 0))}
                    style={{ ...mono, width:72, textAlign:"right", background:C.bg, border:`1.5px solid ${row.col}66`, borderRadius:4, color:C.txt, fontSize:12, padding:"2px 6px", outline:"none" }}
                  />
                </div>
                <div style={{ ...mono, fontSize:10, color:C.dim, marginBottom:row.isOnDemand?3:6 }}>
                  {row.label==="Start users"?"month 1 anchor (re-lerps)":row.label==="End users"?"month 12 anchor (re-lerps)":row.label==="Avg accounts per user"?"S & R-type — avg bank accounts per user":odFreqLabel(row.val)}
                </div>
                {row.isOnDemand && row.val > 0 && (
                  <div style={{ ...mono, fontSize:10, color:`${C.orange}99`, marginBottom:4 }}>
                    ≈ {effectiveCalls.toLocaleString()} calls/mo avg
                  </div>
                )}
                {row.isOnDemand && (
                  <div style={{ display:"flex", gap:3, flexWrap:"wrap", marginBottom:5 }}>
                    {OD_PICKS.map(p => (
                      <button key={p.v} onClick={()=>row.set(p.v)}
                        style={{ ...mono, fontSize:9, padding:"1px 5px", borderRadius:3,
                          border:`1px solid ${row.val===p.v?C.orange:C.brd}`,
                          background:row.val===p.v?`${C.orange}18`:"transparent",
                          color:row.val===p.v?C.orange:C.dim, cursor:"pointer" }}>
                        {p.v < 1 ? p.v : `${p.v}×`} <span style={{ opacity:0.6 }}>{p.lb}</span>
                      </button>
                    ))}
                  </div>
                )}
                <input type="range" min="0" max={maxVal} step={stepVal} value={row.val}
                  onChange={e => row.set(row.isFloat ? parseFloat(e.target.value) : parseInt(e.target.value))}
                  className={`pc-slider pc-slider-${row.cls}`}
                  style={{ background:"transparent" }}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Deal config: Platform Fee + API Commitment ── */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
        {/* Platform fee card */}
        <div style={{ background:C.sur, borderRadius:10, border:`1px solid ${C.brd}`, overflow:"hidden" }}>
          <div style={{ display:"flex", alignItems:"center", padding:"9px 14px", borderBottom:`1px solid ${C.brd}`, background:C.card, gap:12 }}>
            <span style={{ ...mono, fontSize:11, color:C.txt, fontWeight:700 }}>Platform Fee</span>
            <label style={{ ...mono, fontSize:11, color:isPartner?C.purple:C.mut, display:"flex", alignItems:"center", gap:6, marginLeft:"auto", cursor:"pointer" }}>
              <input type="checkbox" checked={isPartner} onChange={e=>setIsPartner(e.target.checked)} style={{ accentColor:C.purple }}/>
              Partner
            </label>
            {isPartner&&(
              <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                <span style={{ ...mono, fontSize:11, color:C.dim }}>$</span>
                <input type="number" min="0" step="100" value={partnerFee}
                  onChange={e=>setPartnerFee(parseFloat(e.target.value)||0)}
                  style={{ ...mono, width:72, background:C.bg, border:`1.5px solid ${C.purple}55`, borderRadius:4, color:C.purple, fontSize:12, padding:"3px 6px", outline:"none" }}/>
                <span style={{ ...mono, fontSize:11, color:C.dim }}>/mo</span>
              </div>
            )}
            <label style={{ ...mono, fontSize:11, color:pfRamp?C.gold:C.mut, display:"flex", alignItems:"center", gap:6, cursor:"pointer" }}>
              <input type="checkbox" checked={pfRamp} onChange={e=>setPfRamp(e.target.checked)} style={{ accentColor:C.gold }}/>
              Ramp
            </label>
          </div>
          <div style={{ padding:"8px 14px", display:"flex", gap:6 }}>
            {PF_TIERS.map(t=>{
              const active=pfTier===t.id;
              return (
                <div key={t.id} onClick={()=>setPfTier(active?null:t.id)}
                  style={{ cursor:"pointer", borderRadius:5, border:`1.5px solid ${active?C.gold:C.brd}`, background:active?`${C.gold}12`:C.card, padding:"5px 12px", transition:"border-color 0.15s, background 0.15s", display:"flex", alignItems:"center", gap:7 }}
                  onMouseEnter={e=>{ if(!active) e.currentTarget.style.borderColor=C.gold+"66"; }}
                  onMouseLeave={e=>{ if(!active) e.currentTarget.style.borderColor=C.brd; }}>
                  <span style={{ ...mono, fontSize:12, fontWeight:600, color:active?C.gold:C.txt }}>{t.label}</span>
                  <span style={{ ...mono, fontSize:11, color:active?C.gold:C.mut }}>{fmt(t.amount)}/mo</span>
                  {active&&<span style={{ ...mono, fontSize:9, color:C.gold }}>✓</span>}
                </div>
              );
            })}
          </div>
          {pfTier && !pfRamp && (
            <div style={{ padding:"6px 14px 10px", borderTop:`1px solid ${C.brd}22` }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <label style={{ ...mono, fontSize:11, color:pfDiscount.enabled?C.green:C.mut, display:"flex", alignItems:"center", gap:6, cursor:"pointer", flexShrink:0 }}>
                  <input type="checkbox" checked={pfDiscount.enabled} onChange={e=>setPfDiscount(d=>({...d,enabled:e.target.checked}))} style={{ accentColor:C.green }}/>
                  Discount
                </label>
                {pfDiscount.enabled && (
                  <>
                    <div style={{ display:"flex", borderRadius:4, border:`1px solid ${C.brd}`, overflow:"hidden", flexShrink:0 }}>
                      {["flat","pct"].map(typ=>(
                        <button key={typ} onClick={()=>setPfDiscount(d=>({...d,type:typ,amount:0}))}
                          style={{ ...mono, fontSize:10, padding:"2px 8px", background:pfDiscount.type===typ?`${C.green}22`:"transparent", border:"none", color:pfDiscount.type===typ?C.green:C.dim, cursor:"pointer" }}>
                          {typ==="flat"?"$":"% off"}
                        </button>
                      ))}
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:4, flex:1 }}>
                      {pfDiscount.type==="flat"&&<span style={{ ...mono, fontSize:11, color:C.dim }}>-$</span>}
                      <input type="number" min="0" step={pfDiscount.type==="pct"?1:100} max={pfDiscount.type==="pct"?100:undefined}
                        value={pfDiscount.amount} onChange={e=>setPfDiscount(d=>({...d,amount:parseFloat(e.target.value)||0}))}
                        style={{ ...mono, width:60, background:C.bg, border:`1.5px solid ${C.green}55`, borderRadius:4, color:C.txt, fontSize:12, padding:"3px 6px", outline:"none" }}/>
                      {pfDiscount.type==="pct"&&<span style={{ ...mono, fontSize:11, color:C.dim }}>% off</span>}
                    </div>
                    <span style={{ ...mono, fontSize:11, color:C.green, flexShrink:0 }}>→ {fmt(discountedTierAmount)}/mo</span>
                  </>
                )}
                {!pfDiscount.enabled && <span style={{ ...mono, fontSize:11, color:C.dim }}>{fmt(tierAmount)}/mo · {fmt(tierAmount*12)}/yr</span>}
              </div>
            </div>
          )}
          {pfRamp && (
            <div style={{ padding:"8px 14px 10px", background:`${C.gold}08`, borderTop:`1px solid ${C.brd}22` }}>
              <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6 }}>
                <span style={{ ...mono, fontSize:9, color:C.gold }}>MONTHLY SCHEDULE</span>
                <div style={{ display:"flex", gap:4, marginLeft:"auto" }}>
                  {PF_TIERS.map(t=>(
                    <button key={t.id} onClick={()=>{ const v=window.prompt(`Fill with ${t.label}?\nRange (e.g. 1-6) or blank for all:`,"")||""; const parts=v.trim().split("-").map(Number); const from=(parts[0]||1)-1; const to=(parts[1]||12)-1; setPfRampSched(s=>s.map((x,i)=>i>=from&&i<=to?t.amount:x)); }}
                      style={{ ...mono, fontSize:9, padding:"2px 6px", background:"transparent", border:`1px solid ${C.gold}44`, borderRadius:3, color:C.gold, cursor:"pointer" }}>{t.label}</button>
                  ))}
                </div>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:4 }}>
                {pfRampSched.map((v,i)=>{
                  const mt=PF_TIERS.find(t=>t.amount===v);
                  return (
                    <div key={i}>
                      <div style={{ ...mono, fontSize:8, color:mt?C.gold:C.dim, marginBottom:1 }}>M{i+1}{mt?` ${mt.label[0]}`:""}</div>
                      <input type="number" min="0" step="500" value={v}
                        onChange={e=>setPfRampSched(s=>{const n=[...s];n[i]=parseFloat(e.target.value)||0;return n;})}
                        style={{ ...mono, width:"100%", boxSizing:"border-box", background:C.bg, border:`1.5px solid ${mt?C.gold+"88":C.gold+"22"}`, borderRadius:3, color:mt?C.gold:C.txt, fontSize:10, padding:"2px 4px", outline:"none" }}/>
                    </div>
                  );
                })}
              </div>
              <div style={{ ...mono, fontSize:9, color:C.gold, marginTop:5, textAlign:"right" }}>Annual: {fmt(pfRampSched.reduce((s,v)=>s+v,0))}</div>
            </div>
          )}
        </div>

        {/* API commitment card */}
        <div style={{ background:C.sur, borderRadius:10, border:`1px solid ${C.brd}`, overflow:"hidden" }}>
          <div style={{ display:"flex", alignItems:"center", padding:"9px 14px", borderBottom:`1px solid ${C.brd}`, background:C.card }}>
            <span style={{ ...mono, fontSize:11, color:C.txt, fontWeight:700 }}>API Commitment / mo</span>
            <label style={{ ...mono, fontSize:11, color:commitRamp?C.orange:C.mut, display:"flex", alignItems:"center", gap:6, marginLeft:"auto", cursor:"pointer" }}>
              <input type="checkbox" checked={commitRamp} onChange={e=>setCommitRamp(e.target.checked)} style={{ accentColor:C.orange }}/>
              Ramp
            </label>
            {commitRamp && <span style={{ ...mono, fontSize:11, color:C.orange, marginLeft:8 }}>{fmt(commitRampSched.reduce((s,v)=>s+v,0))}/yr</span>}
          </div>
          <div style={{ padding:"10px 14px" }}>
            {!commitRamp && (
              <input type="number" min="0" step="100" value={commitFee}
                onChange={e=>setCommitFee(parseFloat(e.target.value)||0)}
                style={{ ...mono, width:"100%", boxSizing:"border-box", background:C.bg, border:`1.5px solid ${C.brdM}`, borderRadius:4, color:C.txt, fontSize:13, padding:"6px 10px", outline:"none" }}/>
            )}
            {/* Billing start */}
            <div style={{ marginTop:8, paddingTop:8, borderTop:`1px solid ${C.brd}22` }}>
              <div style={{ ...mono, fontSize:10, color:C.dim, marginBottom:4 }}>Billing start</div>
              <input
                type="text" placeholder="e.g. Q3 2025, Sep 2025"
                value={billingStart}
                onChange={e=>setBillingStart(e.target.value)}
                style={{ ...mono, width:"100%", boxSizing:"border-box", background:C.bg, border:`1.5px solid ${C.brdM}`, borderRadius:4, color:C.txt, fontSize:12, padding:"5px 10px", outline:"none" }}
              />
            </div>
            {/* Upfront cost */}
            <div style={{ marginTop:8, paddingTop:8, borderTop:`1px solid ${C.brd}22` }}>
              <label style={{ ...mono, fontSize:11, color:upfrontEnabled?C.gold:C.dim, display:"flex", alignItems:"center", gap:6, cursor:"pointer" }}>
                <input type="checkbox" checked={upfrontEnabled} onChange={e=>setUpfrontEnabled(e.target.checked)} style={{ accentColor:C.gold }}/>
                Upfront cost
                <span style={{ color:C.dim, fontWeight:400 }}>(large deals)</span>
              </label>
              {upfrontEnabled&&(
                <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:6 }}>
                  <span style={{ ...mono, fontSize:11, color:C.dim }}>$</span>
                  <input type="number" min="0" step="1000" value={upfrontAmount}
                    onChange={e=>setUpfrontAmount(parseFloat(e.target.value)||0)}
                    placeholder="0"
                    style={{ ...mono, flex:1, background:C.bg, border:`1.5px solid ${C.gold}55`, borderRadius:4, color:C.gold, fontSize:13, padding:"5px 10px", outline:"none" }}/>
                  <span style={{ ...mono, fontSize:11, color:C.dim }}>one-time</span>
                </div>
              )}
            </div>
            {commitRamp && (
              <div style={{ background:`${C.orange}08`, borderRadius:6, padding:"8px 10px" }}>
                <div style={{ ...mono, fontSize:9, color:C.orange, marginBottom:6 }}>MONTHLY COMMITMENT FLOOR</div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:4 }}>
                  {commitRampSched.map((v,i)=>(
                    <div key={i}>
                      <div style={{ ...mono, fontSize:8, color:C.dim, marginBottom:1 }}>M{i+1}</div>
                      <input type="number" min="0" step="100" value={v}
                        onChange={e=>setCommitRampSched(s=>{const n=[...s];n[i]=parseFloat(e.target.value)||0;return n;})}
                        style={{ ...mono, width:"100%", boxSizing:"border-box", background:C.bg, border:`1.5px solid ${C.orange}44`, borderRadius:3, color:C.txt, fontSize:10, padding:"2px 4px", outline:"none" }}/>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Charts ── */}
      {selectedCount > 0 && (<>
        {/* Cost chart + donut side by side */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 260px", gap:12, marginBottom:12 }}>
        {/* Cost chart */}
        <div style={{ background:C.sur, borderRadius:10, border:`1px solid ${C.brd}`, padding:"14px 16px 8px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:8, flexWrap:"wrap" }}>
            <span style={{ ...mono, fontSize:12, color:C.txt, fontWeight:700 }}>12-Month Cost Projection</span>
            <span style={{ ...mono, fontSize:11, color:C.mut }}>{startUsers.toLocaleString()} → {endUsers.toLocaleString()} users</span>
            <span style={{ marginLeft:"auto", ...mono, fontSize:11, color:C.dim }}>Mo 1: <span style={{color:C.txt}}>{fmt(mo1.total)}</span></span>
            <span style={{ ...mono, fontSize:11, color:C.dim }}>Mo 12: <span style={{color:C.txt}}>{fmt(mo12.total)}</span></span>
            <span style={{ ...mono, fontSize:12, color:C.gold, fontWeight:700 }}>Year: {fmt(annualTotal)}</span>
          </div>
          {/* Confidence selector */}
          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:8 }}>
            <span style={{ ...mono, fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em" }}>Confidence</span>
            {[["high","Client confirmed",C.green],["medium","Estimated",C.gold],["low","Pure guess",C.orange]].map(([id,label,col])=>(
              <button key={id} onClick={()=>setConfidence(id)}
                style={{ ...mono, fontSize:10, padding:"2px 9px", background:confidence===id?`${col}20`:"transparent", border:`1px solid ${confidence===id?col:C.brd}`, borderRadius:4, color:confidence===id?col:C.dim, cursor:"pointer" }}>
                {id==="high"?"±10%":id==="medium"?"±25%":"±40%"} · {label}
              </button>
            ))}
            <span style={{ ...mono, fontSize:10, color:C.dim, marginLeft:4 }}>
              Range: <span style={{color:C.green+"aa"}}>{fmt(annualConservative)}</span> – <span style={{color:C.gold}}>{fmt(annualTotal)}</span> – <span style={{color:C.orange+"aa"}}>{fmt(annualBest)}</span>
            </span>
          </div>
          <div style={{ display:"flex", gap:14, marginBottom:8, flexWrap:"wrap" }}>
            {[["Single",C.blue],["Recurring",C.purple],["On-demand",C.orange],["Base case",C.gold],["Rack total","#888"]].map(([l,c])=>(
              <span key={l} style={{ ...mono, fontSize:10, color:c }}><span style={{opacity:0.6}}>■ </span>{l}</span>
            ))}
            <span style={{ ...mono, fontSize:10, color:C.gold, opacity:0.6 }}>- - best / conservative</span>
            {(commitFee > 0 || commitRamp) && <span style={{ ...mono, fontSize:10, color:C.orange }}>- - commitment floor{commitRamp?" (ramp)":""}</span>}
          </div>
          <svg viewBox={`0 0 ${chartW} ${chartH}`} style={{ width:"100%", height:"auto", display:"block" }}>
            {[0,.25,.5,.75,1].map(pct => {
              const y = yScale(maxVal * pct);
              return <g key={pct}>
                <line x1={padL} x2={chartW-padR} y1={y} y2={y} stroke={C.brd} strokeWidth={pct===0?1:0.5} opacity={0.6}/>
                <text x={padL-4} y={y+3.5} textAnchor="end" fontSize={8.5} fill={C.dim} fontFamily="ui-monospace,monospace">{fmtK(maxVal*pct)}</text>
              </g>;
            })}
            {commitRamp
              ? <polyline points={monthlyBreakdown.map((_,i)=>`${xCenter(i)},${yScale(commitRampSched[i]??0)}`).join(" ")} fill="none" stroke={C.orange} strokeWidth={1} strokeDasharray="4 3" opacity={0.7}/>
              : commitFee > 0 && <line x1={padL} x2={chartW-padR} y1={yScale(commitFee)} y2={yScale(commitFee)} stroke={C.orange} strokeWidth={1} strokeDasharray="4 3" opacity={0.7}/>
            }
            {monthlyBreakdown.map((m, i) => {
              const base = padT + innerH;
              const oH = (m.onDemandCost / maxVal) * innerH;
              const rH = (m.recurringCost / maxVal) * innerH;
              const sH = (m.singleCost / maxVal) * innerH;
              const x = padL + i * barSlot + (barSlot - barW) / 2;
              return <g key={i}>
                <rect x={x} y={base-oH} width={barW} height={oH} fill={C.orange} opacity={0.75}/>
                <rect x={x} y={base-oH-rH} width={barW} height={rH} fill={C.purple} opacity={0.75}/>
                <rect x={x} y={base-oH-rH-sH} width={barW} height={sH} fill={C.blue} opacity={0.75}/>
                <text x={xCenter(i)} y={chartH-padB+14} textAnchor="middle" fontSize={8.5} fill={C.dim} fontFamily="ui-monospace,monospace">{i===0?"Mo 1":i===11?"Mo 12":i+1}</text>
              </g>;
            })}
            {/* Rack total line (grey dashed) */}
            <polyline points={monthlyBreakdown.map((_,i)=>`${xCenter(i)},${yScale(monthlyBreakdown[i].baseTotal)}`).join(" ")} fill="none" stroke="#666" strokeWidth={1.5} strokeDasharray="4 3" strokeLinejoin="round"/>
            {/* Confidence shaded band */}
            <polygon
              points={[
                ...monthlyBest.map((_,i)=>`${xCenter(i)},${yScale(monthlyBest[i])}`),
                ...[...monthlyConservative].reverse().map((_,i,arr)=>`${xCenter(arr.length-1-i)},${yScale(arr[i])}`),
              ].join(" ")}
              fill={C.gold} opacity={0.07}/>
            {/* Best case dashed line */}
            <polyline points={monthlyBest.map((_,i)=>`${xCenter(i)},${yScale(monthlyBest[i])}`).join(" ")} fill="none" stroke={C.gold} strokeWidth={1} strokeDasharray="5 3" strokeLinejoin="round" opacity={0.5}/>
            {/* Conservative dashed line */}
            <polyline points={monthlyConservative.map((_,i)=>`${xCenter(i)},${yScale(monthlyConservative[i])}`).join(" ")} fill="none" stroke={C.gold} strokeWidth={1} strokeDasharray="5 3" strokeLinejoin="round" opacity={0.5}/>
            {/* Deal total line (gold solid) */}
            <polyline points={monthlyBreakdown.map((_,i)=>`${xCenter(i)},${yScale(monthlyBreakdown[i].total)}`).join(" ")} fill="none" stroke={C.gold} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"/>
            {monthlyBreakdown.map((m,i) => (
              <circle key={i} cx={xCenter(i)} cy={yScale(m.total)} r={i===0||i===11?3.5:2} fill={C.gold} stroke={C.bg} strokeWidth={1}/>
            ))}
          </svg>
        </div>

        {/* Donut chart — annual spend breakdown */}
        {(() => {
          const donutW=260, donutH=260, cx=130, cy=118, R=90, ri=54;
          const slices = [
            { label:"Single",      val:annualSingleTotal,      col:C.blue   },
            { label:"Recurring",   val:annualRecurringTotal,   col:C.purple },
            { label:"On-demand",   val:annualOnDemandTotal,    col:C.orange },
            { label:"Plat. fee",   val:annualPfTotal,          col:C.mut    },
            { label:"Partner fee", val:annualPartnerFeeTotal,  col:"#a78bfa" },
          ].filter(s=>s.val>0);
          // Commit floor uplift: apiCharge can exceed apiSpend when floor is active
          const sliceSubtotal = slices.reduce((s,x)=>s+x.val,0);
          const floorUplift = Math.round(annualTotal - sliceSubtotal);
          if (floorUplift > 1) slices.push({ label:"Commit min.", val:floorUplift, col:C.gold });
          if (!slices.length) return (
            <div style={{ background:C.sur, borderRadius:10, border:`1px solid ${C.brd}`, display:"flex", alignItems:"center", justifyContent:"center", color:C.dim, ...mono, fontSize:11 }}>
              Select products to see breakdown
            </div>
          );
          const total = slices.reduce((s,x)=>s+x.val,0);
          let angle = 0;
          return (
            <div style={{ background:C.sur, borderRadius:10, border:`1px solid ${C.brd}`, padding:"14px 16px 10px", display:"flex", flexDirection:"column" }}>
              <span style={{ ...mono, fontSize:12, color:C.txt, fontWeight:700, marginBottom:10 }}>Annual Spend</span>
              <svg viewBox={`0 0 ${donutW} ${donutH}`} style={{ width:"100%", height:"auto", display:"block", flex:1 }}>
                {slices.map((s,i) => {
                  const sweep = (s.val/total)*360;
                  const a1=angle, a2=angle+sweep-0.5;
                  angle += sweep;
                  return <path key={i} d={donutArc(cx,cy,R,ri,a1,Math.min(a2,a1+sweep))} fill={s.col} opacity={0.85}/>;
                })}
                {/* Center label */}
                <text x={cx} y={cy-6}  textAnchor="middle" fontSize={10} fill={C.dim} fontFamily="ui-monospace,monospace">annual</text>
                <text x={cx} y={cy+11} textAnchor="middle" fontSize={14} fill={C.gold} fontFamily="ui-monospace,monospace" fontWeight="700">{fmtK(total)}</text>
                {/* Legend */}
                {slices.map((s,i)=>{
                  const lx=16, ly=donutH-20-(slices.length-1-i)*18;
                  return <g key={i}>
                    <rect x={lx} y={ly-8} width={10} height={10} rx={2} fill={s.col} opacity={0.85}/>
                    <text x={lx+14} y={ly+1} fontSize={9} fill={C.dim} fontFamily="ui-monospace,monospace">{s.label}</text>
                    <text x={donutW-10} y={ly+1} textAnchor="end" fontSize={9} fill={s.col} fontFamily="ui-monospace,monospace">{fmtK(s.val)}</text>
                  </g>;
                })}
              </svg>
            </div>
          );
        })()}
        </div>{/* end cost+donut grid */}

        {/* Savings chart — only when there are actual savings */}
        {annualSavings > 0 && (()=>{
          const savH=80, savPadT=8, savPadB=22, savPadL=52, savPadR=12;
          const savInnerH=savH-savPadT-savPadB;
          const maxSav=Math.max(...monthlyBreakdown.map(m=>m.savings),1);
          const savScale=v=>savPadT+savInnerH*(1-Math.max(0,v)/maxSav);
          return (
            <div style={{ background:C.sur, borderRadius:10, border:`1px solid ${C.brd}`, marginBottom:12, padding:"10px 16px 6px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:6 }}>
                <span style={{ ...mono, fontSize:12, color:C.txt, fontWeight:700 }}>Savings vs Rack</span>
                <span style={{ ...mono, fontSize:11, color:C.mut }}>{activeDealPfLabel}</span>
                <span style={{ marginLeft:"auto", ...mono, fontSize:12, color:C.green, fontWeight:700 }}>▲ {fmt(annualSavings)} / year</span>
              </div>
              <svg viewBox={`0 0 ${chartW} ${savH}`} style={{ width:"100%", height:"auto", display:"block" }}>
                {[0.5,1].map(pct=>(
                  <g key={pct}>
                    <line x1={savPadL} x2={chartW-savPadR} y1={savScale(maxSav*pct)} y2={savScale(maxSav*pct)} stroke={C.brd} strokeWidth={0.5} opacity={0.5}/>
                    <text x={savPadL-4} y={savScale(maxSav*pct)+3.5} textAnchor="end" fontSize={8} fill={C.dim} fontFamily="ui-monospace,monospace">{fmtK(maxSav*pct)}</text>
                  </g>
                ))}
                {monthlyBreakdown.map((m,i)=>{
                  const bh=Math.max(1,(m.savings/maxSav)*savInnerH);
                  const x=savPadL+i*barSlot+(barSlot-barW)/2;
                  return <g key={i}>
                    <rect x={x} y={savPadT+savInnerH-bh} width={barW} height={bh} fill={C.green} opacity={0.75}/>
                    <text x={xCenter(i)} y={savH-savPadB+12} textAnchor="middle" fontSize={8.5} fill={C.dim} fontFamily="ui-monospace,monospace">{i===0?"Mo 1":i===11?"Mo 12":i+1}</text>
                  </g>;
                })}
              </svg>
            </div>
          );
        })()}
      </>)}

      {/* ── Platform fees + product table + monthly breakdown ── */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 580px", gap:16, alignItems:"start" }}>
        {/* Left: product table */}
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {/* Product table */}
          <div style={{ background:C.sur, borderRadius:10, border:`1px solid ${C.brd}`, overflow:"hidden" }}>
          <div style={{ display:"grid", gridTemplateColumns:`24px 1fr 76px 84px 68px 84px 72px 20px${tieredPricing?tiers.map(()=>" 76px").join(""):""}`, padding:"8px 14px", borderBottom:`1px solid ${C.brd}`, background:C.card, alignItems:"center" }}>
            {["","PRODUCT","TYPE","RACK","ADOPT.",null,"CALLS/YR","•",...(tieredPricing?tiers.map((_,i)=>`T${i+1}`):[])].map((h,i) => {
              if (i === 5) return (
                <div key={i} style={{ display:"flex", justifyContent:"flex-end" }}>
                  <div style={{ display:"flex", borderRadius:3, border:`1px solid ${C.brd}`, overflow:"hidden" }}>
                    {[["rate","RATE"],["pct","% OFF"],["dollar","$ OFF"]].map(([mode,label])=>(
                      <button key={mode} onClick={()=>setRateMode(mode)}
                        style={{ ...mono, fontSize:9, padding:"2px 5px", background:rateMode===mode?`${C.purple}33`:"transparent", border:"none", color:rateMode===mode?C.purple:C.dim, cursor:"pointer", lineHeight:1.4 }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              );
              return <div key={i} style={{ ...mono, fontSize:10, color: i>7?C.gold:i===7?C.dim:i===6?C.green:i===4?C.orange:i>0?C.purple:C.dim, textAlign: i>=3?"right":"left" }}>{h}</div>;
            })}
          </div>
          <div style={{ padding:"6px 14px", borderBottom:`1px solid ${C.brd}22` }}>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Filter products…"
              style={{ ...mono, width:"100%", boxSizing:"border-box", background:C.bg, border:`1.5px solid ${C.brdM}`, borderRadius:4, color:C.txt, fontSize:12, padding:"4px 8px", outline:"none" }}
            />
          </div>
          <div style={{ maxHeight:480, overflowY:"scroll" }}>
            {filtered.map(p => {
              const adoptPct = p.adoptionPct ?? 100;
              const effectiveUsers = Math.round((monthlyUsers?.[0] ?? 0) * adoptPct / 100);
              const excludingBundle = findExcludingBundle(p);
              const isExcluded = !!excludingBundle;
              return (
                <div key={p.id} style={{ display:"grid", gridTemplateColumns:`24px 1fr 76px 84px 68px 84px 72px 20px${tieredPricing?tiers.map(()=>" 76px").join(""):""}`, padding:"4px 14px", borderBottom:`1px solid ${C.brd}14`, background: isExcluded ? `${C.brd}14` : (p.included ? `${C.green}06` : "transparent"), opacity: isExcluded ? 0.55 : 1, alignItems:"center" }}>
                  <button onClick={() => { if(!isExcluded) toggleIncluded(p.id); }} disabled={isExcluded}
                    style={{ width:15, height:15, borderRadius:3, border:`1px solid ${p.included?C.green:C.brd}`, background: p.included?C.green:"transparent", cursor: isExcluded?"not-allowed":"pointer", display:"flex", alignItems:"center", justifyContent:"center", padding:0, flexShrink:0 }}>
                    {p.included && <span style={{ color:C.bg, fontSize:9, fontWeight:900, lineHeight:1 }}>✓</span>}
                  </button>
                  <span style={{ ...mono, fontSize:11, color: p.included?C.txt:C.mut, paddingRight:6, textDecoration: isExcluded ? "line-through" : "none" }}>{p.name}</span>
                  <span style={{ ...mono, fontSize:10, color:TYPE_COLOR[p.type], background:`${TYPE_COLOR[p.type]}18`, borderRadius:3, padding:"1px 4px", whiteSpace:"nowrap", justifySelf:"start" }}>{TYPE_LABEL[p.type]}</span>
                  <div style={{ textAlign:"right" }}><span style={{ ...mono, fontSize:11, color:C.dim }}>{fmtRate(p.rack)}</span></div>
                  {/* Adoption % column */}
                  <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:2 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:2 }}>
                      <input
                        type="number" min="1" max="100" step="1"
                        value={adoptPct}
                        onFocus={e=>e.target.select()}
                        onChange={e=>{ const n=Math.max(1,Math.min(100,parseInt(e.target.value)||100)); setAdoption(p.id,n); }}
                        style={{ ...mono, width:42, textAlign:"right", background:C.bg, border:`1.5px solid ${adoptPct<100?C.orange+"88":C.brdM}`, borderRadius:3, color:adoptPct<100?C.orange:C.dim, fontSize:11, padding:"2px 3px", outline:"none" }}
                      />
                      <span style={{ ...mono, fontSize:10, color:C.dim }}>%</span>
                    </div>
                    {adoptPct < 100 ? (
                      <div style={{ display:"flex", gap:2, flexWrap:"wrap", justifyContent:"flex-end" }}>
                        {[10,25,50,100].map(v=>(
                          <button key={v} onClick={()=>setAdoption(p.id,v)}
                            style={{ ...mono, fontSize:8, padding:"1px 4px", background:adoptPct===v?`${C.orange}22`:"transparent", border:`1px solid ${adoptPct===v?C.orange:C.brd+"88"}`, color:adoptPct===v?C.orange:C.dim, borderRadius:2, cursor:"pointer", lineHeight:1.4 }}>
                            {v}%
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {adoptPct < 100 && (
                      <span style={{ ...mono, fontSize:9, color:C.orange, whiteSpace:"nowrap" }}>
                        ~{effectiveUsers.toLocaleString()} users
                      </span>
                    )}
                  </div>
                  <div style={{ textAlign:"right" }}>
                    {isExcluded ? (
                      <span style={{ ...mono, fontSize:10, color:C.gold, fontStyle:"italic", whiteSpace:"nowrap" }}>
                        in {excludingBundle.name}
                      </span>
                    ) : (() => {
                      const hasRack = p.rack != null;
                      const inputVal = rateMode==="rate"
                        ? (p.custom ?? "")
                        : rateMode==="pct"
                          ? (hasRack && p.custom!=null ? +((1 - p.custom/p.rack)*100).toFixed(2) : "")
                          : (hasRack && p.custom!=null ? +((p.rack - p.custom).toFixed(4)) : "");
                      const handleChange = e => {
                        const raw = e.target.value;
                        if (raw === "") { setCustom(p.id, null); return; }
                        const n = parseFloat(raw);
                        if (isNaN(n)) return;
                        if (rateMode==="rate") setCustom(p.id, n);
                        else if (rateMode==="pct") setCustom(p.id, hasRack ? +(p.rack*(1-n/100)).toFixed(6) : null);
                        else setCustom(p.id, hasRack ? +(p.rack-n).toFixed(6) : null);
                      };
                      const isOff = rateMode!=="rate" && p.custom!=null && p.rack!=null && p.custom < p.rack;
                      const borderCol = p.rack==null ? C.orange : isOff ? C.green : C.brdM;
                      const textCol   = p.rack==null ? C.orange : isOff ? C.green : C.txt;
                      const step = rateMode==="pct" ? 1 : rateMode==="dollar" ? 0.01 : 0.001;
                      return (
                        <div style={{ display:"flex", alignItems:"center", gap:2, justifyContent:"flex-end" }}>
                          {rateMode==="dollar" && p.custom!=null && <span style={{ ...mono, fontSize:10, color:C.dim }}>-$</span>}
                          <input type="number" step={step} min="0" max={rateMode==="pct"?100:undefined}
                            placeholder={p.rack==null?"enter":undefined} value={inputVal}
                            onChange={handleChange}
                            style={{ ...mono, width:rateMode==="rate"?70:58, textAlign:"right", background:C.bg, border:`1.5px solid ${borderCol}`, borderRadius:3, color:textCol, fontSize:11, padding:"2px 4px", outline:"none" }}
                          />
                          {rateMode==="pct" && <span style={{ ...mono, fontSize:10, color:C.dim }}>%</span>}
                        </div>
                      );
                    })()}
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <span style={{ ...mono, fontSize:10, color: p.included ? C.green : C.dim }}>
                      {p.included ? prodAnnualVolume(p).toLocaleString() : "—"}
                    </span>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"center" }}>
                    {showApprovals && !hideForExport ? (() => {
                      const prod = calcApproval.perProduct.find(x => x.p.id === p.id);
                      if (!prod || prod.discountPct <= 0 || prod.level === "L0") return null;
                      const pLvl = APPROVAL_LEVELS[prod.level] || APPROVAL_LEVELS["L0"];
                      return <span title={`${prod.level} — ${pLvl.desc}`} style={{ width:5, height:5, borderRadius:"50%", background:pLvl.dot||pLvl.color, display:"inline-block" }}/>;
                    })() : null}
                  </div>
                  {tieredPricing && tiers.map((t, i) => {
                    const base = p.custom ?? p.rack;
                    if (base == null) return <div key={i}/>;
                    const eff = base * (1 - t.discount);
                    const active = p.included && monthlyUsers.some((u, idx) => { const newU = idx===0?u:Math.max(0,u-(monthlyUsers[idx-1]??0)); return newU >= t.threshold; });
                    return <div key={i} style={{ textAlign:"right" }}><span style={{ ...mono, fontSize:11, color: active ? C.gold : C.dim }}>{fmtRate(eff)}</span></div>;
                  })}
                </div>
              );
            })}
          </div>
          <div style={{ display:"flex", gap:14, flexWrap:"wrap", padding:"7px 14px", borderTop:`1px solid ${C.brd}`, background:C.card }}>
            {Object.entries(TYPE_LABEL).map(([k,v]) => (
              <span key={k} style={{ ...mono, fontSize:10, color:TYPE_COLOR[k] }}>■ {v} — {k==="S"?"per connected acct":k==="R"?"per active user/mo":"per call"}</span>
            ))}
          </div>
          </div>{/* end product table */}
        </div>{/* end left column */}

        {/* Monthly breakdown table */}
        <div style={{ background:C.sur, borderRadius:10, border:`1px solid ${C.brd}`, overflow:"hidden" }}>
          <div style={{ padding:"8px 14px", borderBottom:`1px solid ${C.brd}`, background:C.card }}>
            <span style={{ ...mono, fontSize:11, color:C.txt, fontWeight:700 }}>Monthly breakdown</span>
          </div>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", ...mono, fontSize:11 }}>
              <thead>
                <tr style={{ background:C.card }}>
                  {["Mo","Users","Conn.\naccts","Single","Recur.","Plat. fee",...(isPartner?["Partner fee"]:[]),"Total","Savings",...(tieredPricing?["Tier"]:[])] .map((h,i) => (
                    <th key={i} style={{ padding:"5px 8px", textAlign: i===0?"center":"right", color:C.dim, fontWeight:500, borderBottom:`1px solid ${C.brd}44`, whiteSpace:"pre", lineHeight:1.3, fontSize:10 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {monthlyBreakdown.map((m, idx) => {
                  const isLast = idx === 11;
                  return (
                    <tr key={m.mo} style={{ background: idx%2===0?"transparent":`${C.brd}14` }}>
                      <td style={{ padding:"3px 8px", textAlign:"center", color:C.mut, borderBottom:isLast?"none":`1px solid ${C.brd}14` }}>Mo {m.mo}</td>
                      <td style={{ padding:"3px 8px", textAlign:"right", color:C.green, borderBottom:isLast?"none":`1px solid ${C.brd}14` }}>{m.activeUsersThisMo.toLocaleString()}</td>
                      <td style={{ padding:"3px 8px", textAlign:"right", color:C.blue, opacity:0.8, borderBottom:isLast?"none":`1px solid ${C.brd}14` }}>{m.newUsersThisMo>0?`+${Math.round(m.connectedAcctsThisMo).toLocaleString()}`:"—"}</td>
                      <td style={{ padding:"3px 8px", textAlign:"right", color:m.singleCost>0?C.blue:C.dim, borderBottom:isLast?"none":`1px solid ${C.brd}14` }}>{m.singleCost>0?fmt(m.singleCost):"—"}</td>
                      <td style={{ padding:"3px 8px", textAlign:"right", color:m.recurringCost>0?C.purple:C.dim, borderBottom:isLast?"none":`1px solid ${C.brd}14` }}>{m.recurringCost>0?fmt(m.recurringCost):"—"}</td>
                      <td style={{ padding:"3px 8px", textAlign:"right", color:m.dealPf>0?C.mut:C.dim, borderBottom:isLast?"none":`1px solid ${C.brd}14` }}>{m.dealPf>0?fmt(m.dealPf):"—"}</td>
                      {isPartner&&<td style={{ padding:"3px 8px", textAlign:"right", color:C.purple, borderBottom:isLast?"none":`1px solid ${C.brd}14` }}>{m.partnerFeeMo>0?fmt(m.partnerFeeMo):"—"}</td>}
                      <td style={{ padding:"3px 8px", textAlign:"right", color:idx===11?C.gold:C.txt, fontWeight:idx===11?700:400, borderBottom:isLast?"none":`1px solid ${C.brd}14` }}>{fmt(m.total)}</td>
                      <td style={{ padding:"3px 8px", textAlign:"right", color:m.savings>0?C.green:m.savings<0?C.red:C.dim, fontWeight: Math.abs(m.savings)>0?600:400, borderBottom:isLast?"none":`1px solid ${C.brd}14` }}>
                        {m.savings!==0?(m.savings>0?"▲ ":"▼ ")+fmt(Math.abs(m.savings)):"—"}
                      </td>
                      {tieredPricing && <td style={{ padding:"3px 8px", textAlign:"right", borderBottom:isLast?"none":`1px solid ${C.brd}14` }}>
                        {m.tierLbl ? <span style={{ ...mono, fontSize:9, color:C.gold, background:`${C.gold}22`, borderRadius:3, padding:"1px 5px" }}>{m.tierLbl} -{Math.round(m.tierDisc*100)}%</span> : <span style={{ color:C.dim }}>—</span>}
                      </td>}
                    </tr>
                  );
                })}
                <tr style={{ background:`${C.gold}0A`, borderTop:`1px solid ${C.gold}33` }}>
                  <td style={{ padding:"5px 8px", textAlign:"center", color:C.gold, fontWeight:700 }}>Year</td>
                  <td style={{ padding:"5px 8px", textAlign:"right", color:C.dim }}>—</td>
                  <td style={{ padding:"5px 8px", textAlign:"right", color:C.blue, opacity:0.8 }}>{(endUsers-startUsers)>0?`+${Math.round((endUsers-startUsers)*avgAccounts).toLocaleString()}`:"—"}</td>
                  <td style={{ padding:"5px 8px", textAlign:"right", color:C.blue }}>{fmt(monthlyBreakdown.reduce((s,m)=>s+m.singleCost,0))}</td>
                  <td style={{ padding:"5px 8px", textAlign:"right", color:C.purple }}>{fmt(monthlyBreakdown.reduce((s,m)=>s+m.recurringCost,0))}</td>
                  <td style={{ padding:"5px 8px", textAlign:"right", color:C.mut }}>{fmt(monthlyBreakdown.reduce((s,m)=>s+m.dealPf,0))}</td>
                  {isPartner&&<td style={{ padding:"5px 8px", textAlign:"right", color:C.purple, fontWeight:700 }}>{fmt(annualPartnerFeeTotal)}</td>}
                  <td style={{ padding:"5px 8px", textAlign:"right", color:C.gold, fontWeight:700 }}>{fmt(annualTotal)}</td>
                  <td style={{ padding:"5px 8px", textAlign:"right", color:annualSavings>=0?C.green:C.red, fontWeight:700 }}>
                    {annualSavings!==0?(annualSavings>0?"▲ ":"▼ ")+fmt(Math.abs(annualSavings)):"—"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

export default CalcTab;
