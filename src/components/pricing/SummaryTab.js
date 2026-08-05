import React, { useState } from 'react';
import { C, mono } from '../../constants/colors';
import DealExportModal from '../DealExportModal';
import ProposalBuilderModal from './ProposalBuilderModal';
import { getEffectiveForecastCat } from '../../utils/forecastUtils';
import { productMonthlyCost } from '../../utils/pricingMath';
import { projectedCloseDate } from '../../utils/ledgerEngine';

function SummaryTab({
  // Account / snapshot state
  linkedAcc, snapshots, snapDropOpen, setSnapDropOpen, loadSnapshot, deleteSnapshot,
  showSaveInput, setShowSaveInput, saveLabel, setSaveLabel, doSaveSnapshot, onCreateTask,
  // Product / compute
  selectedCount, products, monthlyBreakdown, avgAccounts, onDemand,
  commitFee, commitRamp, commitRampSched,
  upfrontEnabled, upfrontAmount,
  pfTier, pfDiscount, pfRamp, pfRampSched,
  isPartner, partnerFee, tieredPricing, tiers, monthlyUsers,
  // Derived values
  annualTotal, annualBase, annualSavings,
  annualSingleTotal, annualRecurringTotal, annualOnDemandTotal, annualPfTotal, annualPartnerFeeTotal,
  minimumAnnual, variableAnnual,
  annualBest, annualConservative, confPct, confidence, setConfidence,
  mo1, mo12, startUsers, endUsers,
  activeDealPfLabel, activeTierObj, tierAmount, discountedTierAmount,
  // Formatting helpers
  fmt, fmtK, fmtRate, TYPE_LABEL, TYPE_COLOR,
  prodAnnualVolume,
  // Export
  summaryRef, renderFormatBar, doExportPDF, doScreenshot,
  billingStart,
}) {
  const [exportOpen, setExportOpen] = useState(false);
  const [sheetsCopied, setSheetsCopied] = useState(false);
  const [proposalOpen, setProposalOpen] = useState(false);
  // local helpers
  const doCreateTask = () => {
    if (!onCreateTask) return;
    const title = `Send pricing${linkedAcc?.name ? ` — ${linkedAcc.name}` : ""}`;
    onCreateTask({
      type: "Send pricing",
      title,
      accId: linkedAcc?.id || null,
      accName: linkedAcc?.name || null,
      pricingFileId: snapshots[0]?.id || null,
      pricingFileName: snapshots[0]?.name || null,
      priority: "Medium",
      assignee: "AE",
      status: "Open",
      dueDate: "",
      notes: `${fmt(annualTotal)}/yr · ${selectedCount} product${selectedCount!==1?"s":""}`,
    });
  };

  const selected = products.filter(p=>p.included);
  const annualFloorTotal = monthlyBreakdown.reduce((s, m) => s + (m.floorThisMo || 0), 0);

  const buildComprehensiveTsv = () => {
    const acc = linkedAcc || {};
    const topPersona = acc.personas?.[0];
    const lastCall = acc.calls?.[acc.calls.length - 1];
    const projClose = projectedCloseDate(acc);
    const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
    const effectiveForecastCat = getEffectiveForecastCat(acc.closeProbability, acc.forecastCategory);
    const n = (v) => Math.round(v || 0);
    // Use integrated monthly values — already ramp-aware via m.dealPf
    const pfAnnual = monthlyBreakdown.reduce((s, m) => s + (m.dealPf || 0), 0);

    const rows = [];
    // Section 0 — Deal Header
    rows.push(['Account', acc.name || '—']);
    rows.push(['Stage', acc.stage || '—']);
    rows.push(['Tier', acc.tier || '—']);
    rows.push(['Forecast', effectiveForecastCat || '—']);
    rows.push(['ACV (Projected)', n(annualTotal)]);
    rows.push(['Close Date', acc.closeDate || fmtDate(projClose) || '—']);
    rows.push(['Billing Start', billingStart || '—']);
    rows.push(['Go-Live', lastCall?.timeline?.split('\n')[0] || '—']);
    rows.push(['Primary Contact', topPersona ? `${topPersona.name || ''}, ${topPersona.title || ''}` : '—']);
    rows.push(['Products Targeting', acc.prods?.join(', ') || '—']);
    rows.push([]);

    // Section 1 — Products
    rows.push(['Product', 'Type', 'Rack Rate', 'Custom Rate', 'Discount %', 'Calls/Yr', 'Annual Value']);
    selected.forEach(p => {
      const rack = p.rack ?? 0;
      const custom = p.custom ?? rack;
      const discountPct = rack > 0 ? Math.round((1 - custom / rack) * 100) : 0;
      // Compute annual by summing canonical per-month cost across monthlyBreakdown.
      // tierMult:1 — TSV intentionally does not apply tier discounts (known divergence).
      const annualVal = monthlyBreakdown.reduce((s, m) =>
        s + productMonthlyCost(p,
          { newUsers: m.newUsersThisMo, activeUsers: m.activeUsersThisMo },
          { avgAccounts, onDemand, tierMult: 1 }),
        0);
      rows.push([p.name, p.type, rack, custom, discountPct, prodAnnualVolume(p), n(annualVal)]);
    });
    // Platform fee: use ramp-integrated total, show Mo1/Mo12 range as label
    const pfMo1 = monthlyBreakdown[0]?.dealPf ?? 0;
    const pfMo12 = monthlyBreakdown[11]?.dealPf ?? 0;
    const pfLabel = pfRamp ? `ramp · ${n(pfMo1)}/mo → ${n(pfMo12)}/mo` : `${n(pfMo12)}/mo`;
    rows.push(['Platform Fee', '', '', pfLabel, '', '', n(pfAnnual)]);
    rows.push([]);
    rows.push(['TOTAL ARR', '', '', '', '', '', n(annualTotal)]);
    rows.push([]);

    // API Commitment Ramp section — only emit when commitRamp is active
    if (commitRamp && commitRampSched && commitRampSched.length === 12) {
      const commitRampTotal = commitRampSched.reduce((s, v) => s + v, 0);
      rows.push([`API COMMITMENT RAMP — ${fmt(commitRampTotal)}/yr`]);
      rows.push(['', 'M1','M2','M3','M4','M5','M6','M7','M8','M9','M10','M11','M12']);
      rows.push(['Floor', ...commitRampSched.map(v => n(v))]);
      rows.push([]);
    }

    // Platform Fee Ramp section — only emit when pfRamp is active
    if (pfRamp && pfRampSched && pfRampSched.length === 12) {
      rows.push([`PLATFORM FEE RAMP — ${fmt(pfAnnual)}/yr`]);
      rows.push(['', 'M1','M2','M3','M4','M5','M6','M7','M8','M9','M10','M11','M12']);
      rows.push(['Plat.', ...pfRampSched.map(v => n(v))]);
      rows.push([]);
    }

    // Section 2 — Monthly Breakdown
    rows.push(['Mo', 'Active Users', 'New Users', 'Onboard (S)', 'Recurring (R)', 'On-Demand (T)', 'Floor', 'Platform', ...(isPartner ? ['Partner'] : []), 'Total']);
    monthlyBreakdown.forEach((m, i) => {
      rows.push([`Mo ${i + 1}`, m.activeUsersThisMo, m.newUsersThisMo, n(m.singleCost), n(m.recurringCost), n(m.onDemandCost), n(m.floorThisMo), n(m.dealPf), ...(isPartner ? [n(m.partnerFeeMo)] : []), n(m.total)]);
    });
    rows.push(['Total', '', '', n(annualSingleTotal), n(annualRecurringTotal), n(annualOnDemandTotal), n(annualFloorTotal), n(annualPfTotal), ...(isPartner ? [n(annualPartnerFeeTotal)] : []), n(annualTotal)]);
    rows.push([]);

    // Section 3 — Scenario Summary
    rows.push(['Scenario', 'Annual Value', 'Note']);
    rows.push(['Conservative', n(annualTotal * 0.75), '-25% volume']);
    rows.push(['Base Case', n(annualTotal), 'Projected volumes']);
    rows.push(['Best Case', n(annualTotal * 1.25), ' +25% volume']);
    rows.push([]);
    rows.push(['Minimum (0 users)', n(minimumAnnual), 'Commitment floor + platform fees only']);
    rows.push(['Variable (user-driven)', n(variableAnnual), 'API spend above floor']);
    rows.push(['Projected Total', n(annualTotal), `At ${endUsers.toLocaleString()} users Mo 12`]);

    return rows.map(r => r.join('\t')).join('\n');
  };

  const copySheetsTsv = () => {
    navigator.clipboard.writeText(buildComprehensiveTsv()).then(() => {
      setSheetsCopied(true);
      setTimeout(() => setSheetsCopied(false), 1500);
    });
  };

  return (
    <div style={{ background:C.sur, borderRadius:10, border:`1px solid ${C.brd}`, overflow:"hidden" }}>
      <div style={{ borderBottom:`1px solid ${C.brd}`, background:C.card }}>
        {/* Title row */}
        <div style={{ display:"flex", alignItems:"center", padding:"11px 16px", gap:10, flexWrap:"wrap" }}>
          {/* Client name — clickable to open snapshot dropdown */}
          <div style={{ position:"relative" }}>
            <button onClick={()=>setSnapDropOpen(o=>!o)}
              style={{ ...mono, fontSize:13, color:C.txt, fontWeight:700, background:"transparent", border:`1px solid ${snapDropOpen?C.gold:C.brd}`, borderRadius:6, padding:"4px 10px", cursor:linkedAcc?"pointer":"default", display:"flex", alignItems:"center", gap:6 }}>
              {linkedAcc ? linkedAcc.name : "Pricing Summary"}
              {linkedAcc && snapshots.length > 0 && <span style={{ fontSize:10, color:snapDropOpen?C.gold:C.dim }}>{snapDropOpen?"▲":"▼"} {snapshots.length}</span>}
            </button>
            {snapDropOpen && linkedAcc && snapshots.length > 0 && (
              <div onMouseLeave={()=>setSnapDropOpen(false)}
                style={{ position:"absolute", top:"calc(100% + 4px)", left:0, zIndex:300, background:C.card, border:`1px solid ${C.brd}`, borderRadius:8, minWidth:280, boxShadow:"0 8px 24px #000c", padding:"6px 0" }}>
                <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", padding:"4px 14px 6px" }}>Saved scenarios — click to load</div>
                {snapshots.map(s=>(
                  <div key={s.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 14px", borderTop:`1px solid ${C.brd}22` }}
                    onMouseEnter={e=>e.currentTarget.style.background=`${C.gold}0A`}
                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <div style={{ flex:1, minWidth:0, cursor:s.session?"pointer":"default" }} onClick={()=>s.session&&loadSnapshot(s)}>
                      <p style={{ ...mono, margin:0, fontSize:12, color:s.session?C.txt:C.dim, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.name}</p>
                      <p style={{ ...mono, margin:0, fontSize:10, color:C.dim }}>{s.savedAt}{!s.session&&" · legacy (no data)"}</p>
                    </div>
                    {s.session && (
                      <button onClick={()=>loadSnapshot(s)}
                        style={{ ...mono, fontSize:10, padding:"2px 8px", background:`${C.gold}18`, border:`1px solid ${C.gold}44`, color:C.gold, borderRadius:4, cursor:"pointer", flexShrink:0 }}>
                        Load
                      </button>
                    )}
                    <button onClick={()=>deleteSnapshot(s.id)}
                      style={{ ...mono, fontSize:10, padding:"2px 6px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:4, cursor:"pointer", flexShrink:0 }}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          {selectedCount === 0 && <span style={{ ...mono, fontSize:11, color:C.mut }}>select products in Configure tab</span>}
          {/* Export buttons — inline in header */}
          {selectedCount > 0 && (
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <button onClick={copySheetsTsv}
                style={{ ...mono, fontSize:11, padding:"5px 11px",
                  background: sheetsCopied ? `${C.green}22` : "transparent",
                  border: `1px solid ${sheetsCopied ? C.green : C.brd}`,
                  borderRadius:5, color: sheetsCopied ? C.green : C.mut,
                  cursor:"pointer", display:"flex", alignItems:"center", gap:5 }}>
                {sheetsCopied ? "✓ Copied!" : "⎘ Sheets"}
              </button>
              <button onClick={doExportPDF}
                style={{ ...mono, fontSize:11, padding:"5px 11px",
                  background:"transparent", border:`1px solid ${C.brd}`,
                  borderRadius:5, color:C.mut, cursor:"pointer",
                  display:"flex", alignItems:"center", gap:5 }}>
                🖨 PDF
              </button>
              <button onClick={doScreenshot}
                style={{ ...mono, fontSize:11, padding:"5px 11px",
                  background:"transparent", border:`1px solid ${C.brd}`,
                  borderRadius:5, color:C.mut, cursor:"pointer",
                  display:"flex", alignItems:"center", gap:5 }}>
                📸 Screenshot
              </button>
              <button
                onClick={() => { if (linkedAcc) setProposalOpen(true); }}
                disabled={!linkedAcc || selectedCount === 0}
                title={!linkedAcc ? "Link an account to generate a proposal" : undefined}
                style={{ ...mono, fontSize:11, padding:"5px 11px",
                  background: linkedAcc && selectedCount > 0 ? `${C.gold}18` : "transparent",
                  border: `1px solid ${linkedAcc && selectedCount > 0 ? C.goldBdr : C.brd}`,
                  borderRadius:5,
                  color: linkedAcc && selectedCount > 0 ? C.gold : C.dim,
                  fontWeight: linkedAcc && selectedCount > 0 ? 600 : 400,
                  cursor: linkedAcc && selectedCount > 0 ? "pointer" : "not-allowed",
                  opacity: linkedAcc && selectedCount > 0 ? 1 : 0.5,
                  display:"flex", alignItems:"center", gap:5 }}>
                ✦ Proposal
              </button>
              <div style={{ width:1, height:18, background:C.brd, margin:"0 2px" }} />
              <div style={{ position:"relative" }}
                onMouseEnter={e => e.currentTarget.querySelector('.slides-tooltip').style.display='block'}
                onMouseLeave={e => e.currentTarget.querySelector('.slides-tooltip').style.display='none'}>
                <button disabled
                  style={{ ...mono, fontSize:11, padding:"5px 11px",
                    background:"transparent", border:`1px solid ${C.brd}`,
                    borderRadius:5, color:C.dim, cursor:"not-allowed",
                    opacity:0.55, display:"flex", alignItems:"center", gap:5 }}>
                  🗂 Slides
                </button>
                <div className="slides-tooltip"
                  style={{ display:"none", position:"absolute", top:"calc(100% + 6px)",
                    left:"50%", transform:"translateX(-50%)",
                    background:C.card, border:`1px solid ${C.brd}`,
                    borderRadius:5, padding:"4px 10px", zIndex:400,
                    whiteSpace:"nowrap" }}>
                  <span style={{ ...mono, fontSize:10, color:C.dim }}>Coming soon</span>
                </div>
              </div>
            </div>
          )}
          <div style={{ marginLeft:"auto", display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
            {linkedAcc && selectedCount > 0 && !showSaveInput && (
              <button onClick={()=>{ setSaveLabel(`Deal · ${new Date().toLocaleDateString("en-US",{month:"short",day:"numeric"})}`); setShowSaveInput(true); }}
                style={{ ...mono, fontSize:11, padding:"5px 13px", background:"transparent", border:`1px solid ${C.blue}66`, borderRadius:5, color:C.blue, cursor:"pointer" }}>
                ↓ Save to account
              </button>
            )}
            {linkedAcc && selectedCount > 0 && onCreateTask && (
              <button onClick={doCreateTask}
                style={{ ...mono, fontSize:11, padding:"5px 13px", background:"transparent", border:`1px solid ${C.purple}66`, borderRadius:5, color:C.purple, cursor:"pointer" }}>
                ◎ Create task: Send pricing
              </button>
            )}
          </div>
        </div>
        {/* Inline save label input */}
        {showSaveInput && (
          <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 16px", borderTop:`1px solid ${C.brd}22`, background:`${C.blue}08` }}>
            <span style={{ ...mono, fontSize:11, color:C.blue, whiteSpace:"nowrap" }}>Save as:</span>
            <input autoFocus value={saveLabel} onChange={e=>setSaveLabel(e.target.value)}
              onKeyDown={e=>{ if(e.key==="Enter") doSaveSnapshot(saveLabel); if(e.key==="Escape") setShowSaveInput(false); }}
              style={{ ...mono, flex:1, fontSize:12, padding:"5px 10px", background:C.bg, border:`1.5px solid ${C.blue}66`, borderRadius:5, color:C.txt, outline:"none" }}
            />
            <button onClick={()=>doSaveSnapshot(saveLabel)} style={{ ...mono, fontSize:11, padding:"5px 13px", background:`${C.blue}22`, border:`1px solid ${C.blue}66`, borderRadius:5, color:C.blue, cursor:"pointer" }}>Save</button>
            <button onClick={()=>setShowSaveInput(false)} style={{ ...mono, fontSize:11, padding:"5px 10px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:5, color:C.mut, cursor:"pointer" }}>✕</button>
          </div>
        )}
      </div>
      {/* Format selector bar — summary surface */}
      {selectedCount > 0 && (
        <div style={{ padding:"10px 16px", borderBottom:`1px solid ${C.brd}22`, background:C.card }}>
          {renderFormatBar()}
        </div>
      )}
      {selectedCount > 0 && (
        <div ref={summaryRef} style={{ padding:"18px 20px", display:"flex", flexDirection:"column", gap:18 }}>
          {/* Growth */}
          <div style={{ display:"flex", gap:24, flexWrap:"wrap" }}>
            <div><div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>User Growth</div><span style={{ ...mono, fontSize:13, color:C.blue }}>{startUsers.toLocaleString()}</span><span style={{ ...mono, fontSize:11, color:C.mut }}> → </span><span style={{ ...mono, fontSize:13, color:C.green }}>{endUsers.toLocaleString()}</span></div>
            <div><div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>Avg Accts/User</div><span style={{ ...mono, fontSize:13, color:C.txt }}>{avgAccounts}</span></div>
            {onDemand > 0 && <div><div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>On-demand/mo</div><span style={{ ...mono, fontSize:13, color:C.orange }}>{onDemand}×</span><span style={{ ...mono, fontSize:10, color:C.mut }}> per user</span></div>}
            {(commitFee > 0 || commitRamp) && <div><div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>API Commitment</div><span style={{ ...mono, fontSize:13, color:C.orange }}>{commitRamp?`ramp · ${fmt(commitRampSched.reduce((s,v)=>s+v,0))}/yr`:`${fmt(commitFee)}/mo`}</span></div>}
            {upfrontEnabled && upfrontAmount > 0 && <div><div style={{ ...mono, fontSize:9, color:C.gold, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>Upfront</div><span style={{ ...mono, fontSize:13, color:C.gold }}>{fmt(upfrontAmount)}</span></div>}
            {tieredPricing && <div style={{ ...mono, fontSize:11, color:C.gold, background:`${C.gold}14`, border:`1px solid ${C.gold}44`, borderRadius:4, padding:"4px 10px", alignSelf:"center" }}>⊞ Tiered pricing</div>}
          </div>
          {/* Products table */}
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
              <span style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>Products ({selectedCount})</span>
            </div>
            <div style={{ border:`1px solid ${C.brd}`, borderRadius:7, overflow:"hidden" }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 80px 90px 80px 80px 90px", padding:"6px 12px", background:C.card, borderBottom:`1px solid ${C.brd}` }}>
                {["Product","Type","Calls/Yr","Rack","Custom","Annual"].map((h,i)=>(
                  <span key={i} style={{ ...mono, fontSize:9, color:i===2?C.green:C.dim, textAlign:i>1?"right":"left" }}>{h}</span>
                ))}
              </div>
              {selected.map((p,i,arr) => {
                const adoptPct = p.adoptionPct ?? 100;
                const adopt = (p.adoptionPct??100)/100;
                return (
                <div key={p.id} style={{ display:"grid", gridTemplateColumns:"1fr 80px 90px 80px 80px 90px", padding:"5px 12px", borderBottom:i<arr.length-1?`1px solid ${C.brd}22`:"none", background:i%2===0?"transparent":`${C.brd}0A` }}>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <span style={{ ...mono, fontSize:11, color:C.txt }}>{p.name}</span>
                    {adoptPct < 100 && <span style={{ ...mono, fontSize:9, color:C.orange, background:`${C.orange}14`, border:`1px solid ${C.orange}33`, borderRadius:3, padding:"0 4px" }}>{adoptPct}%</span>}
                  </div>
                  <span style={{ ...mono, fontSize:10, color:TYPE_COLOR[p.type] }}>{TYPE_LABEL[p.type]}</span>
                  <span style={{ ...mono, fontSize:11, color:C.green, textAlign:"right" }}>{prodAnnualVolume(p).toLocaleString()}</span>
                  <span style={{ ...mono, fontSize:11, color:C.dim, textAlign:"right" }}>{fmtRate(p.rack)}</span>
                  <span style={{ ...mono, fontSize:11, color: (p.custom??p.rack)!==p.rack?C.gold:C.txt, textAlign:"right" }}>{fmtRate(p.custom??p.rack)}</span>
                  <span style={{ ...mono, fontSize:11, color:C.green, textAlign:"right" }}>
                    {fmt(monthlyBreakdown.reduce((s,m)=>{
                      const r=p.custom??p.rack; if(r==null)return s;
                      if(p.type==="S") return s+r*m.connectedAcctsThisMo*adopt;
                      if(p.type==="R") return s+r*m.activeUsersThisMo*(p.isBundle?1:avgAccounts)*adopt;
                      if(p.type==="T") return s+r*onDemand*m.activeUsersThisMo*adopt;
                      return s;
                    },0))}
                  </span>
                </div>
                );
              })}
            </div>
          </div>
          {/* Tier effective rates table */}
          {tieredPricing && tiers.length > 0 && (() => {
            const sel = selected.filter(p=>(p.custom??p.rack)!=null);
            if (!sel.length) return null;
            return (
              <div>
                <div style={{ ...mono, fontSize:9, color:C.gold, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>⊞ Effective Rates After Tier Discounts</div>
                <div style={{ border:`1px solid ${C.gold}33`, borderRadius:7, overflow:"hidden" }}>
                  <div style={{ display:"grid", gridTemplateColumns:`1fr 70px${tiers.map(()=>" 90px").join("")}`, padding:"6px 12px", background:`${C.gold}0e`, borderBottom:`1px solid ${C.gold}22` }}>
                    <span style={{ ...mono, fontSize:9, color:C.dim }}>Product</span>
                    <span style={{ ...mono, fontSize:9, color:C.dim, textAlign:"right" }}>Custom</span>
                    {tiers.map((t,i) => (
                      <span key={i} style={{ ...mono, fontSize:9, color:C.gold, textAlign:"right" }}>
                        T{i+1} ≥{(t.threshold/1000).toFixed(0)}k -{Math.round(t.discount*100)}%
                      </span>
                    ))}
                  </div>
                  {sel.map((p, pi) => {
                    const base = p.custom ?? p.rack;
                    return (
                      <div key={p.id} style={{ display:"grid", gridTemplateColumns:`1fr 70px${tiers.map(()=>" 90px").join("")}`, padding:"5px 12px", borderBottom:pi<sel.length-1?`1px solid ${C.brd}22`:"none", background:pi%2===0?"transparent":`${C.brd}0a` }}>
                        <span style={{ ...mono, fontSize:11, color:C.txt }}>{p.name}</span>
                        <span style={{ ...mono, fontSize:11, color:C.dim, textAlign:"right" }}>{fmtRate(base)}</span>
                        {tiers.map((t, i) => {
                          const eff = base * (1 - t.discount);
                          const reached = monthlyUsers.some((u, idx) => { const newU = idx===0?u:Math.max(0,u-(monthlyUsers[idx-1]??0)); return newU >= t.threshold; });
                          return (
                            <span key={i} style={{ ...mono, fontSize:11, color: reached ? C.gold : C.dim, textAlign:"right", fontWeight: reached ? 600 : 400 }}>
                              {fmtRate(eff)}
                            </span>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
                <div style={{ ...mono, fontSize:9, color:C.dim, marginTop:5 }}>
                  Gold = tier reached by Mo 12 growth curve
                </div>
              </div>
            );
          })()}
          {/* Platform fee */}
          {(pfTier||pfRamp) && (
            <div>
              <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>Platform Fee — {activeDealPfLabel}</div>
              <div style={{ display:"flex", gap:20, flexWrap:"wrap" }}>
                {pfTier && <div style={{ ...mono, fontSize:11 }}><span style={{ color:C.gold }}>{activeTierObj?.label} </span><span style={{ color:C.txt }}>{fmt(tierAmount)}/mo</span><span style={{ color:C.dim }}> · {fmt(tierAmount*12)}/yr</span></div>}
                {pfDiscount.enabled&&pfTier && <div style={{ ...mono, fontSize:11 }}><span style={{ color:C.green }}>Discounted </span><span style={{ color:C.txt }}>{fmt(discountedTierAmount)}/mo</span><span style={{ color:C.dim }}> · {fmt(discountedTierAmount*12)}/yr</span></div>}
                {pfRamp && <div style={{ ...mono, fontSize:11, color:C.gold }}>Ramp · {fmt(pfRampSched.reduce((s,v)=>s+v,0))}/yr</div>}
              </div>
            </div>
          )}
          {/* Ramp schedules */}
          {(commitRamp || pfRamp) && (() => {
            const RampTable = ({ label, sched, col }) => (
              <div>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                  <span style={{ ...mono, fontSize:9, color:col, textTransform:"uppercase", letterSpacing:"0.08em" }}>{label} — {fmt(sched.reduce((s,v)=>s+v,0))}/yr</span>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(12,1fr)", gap:4 }}>
                  {sched.map((v,i) => (
                    <div key={i} style={{ background:C.card, border:`1px solid ${col}33`, borderRadius:4, padding:"4px 2px", textAlign:"center" }}>
                      <div style={{ ...mono, fontSize:8, color:C.dim, marginBottom:2 }}>M{i+1}</div>
                      <div style={{ ...mono, fontSize:10, color:col, fontWeight:600 }}>{v>0?fmtK(v):"—"}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
            return (
              <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                {commitRamp && <RampTable label="API Commitment Ramp" sched={commitRampSched} col={C.orange}/>}
                {pfRamp     && <RampTable label="Platform Fee Ramp"   sched={pfRampSched}     col={C.gold}/>}
              </div>
            );
          })()}
          {/* Totals */}
          <div style={{ background:C.card, borderRadius:8, border:`1px solid ${C.brd}`, padding:"14px 16px" }}>
            <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:12 }}>Annual Totals</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:16 }}>
              {[
                ["Single",     fmt(annualSingleTotal),    C.blue],
                ["Recurring",  fmt(annualRecurringTotal), C.purple],
                annualOnDemandTotal>0?["On-demand", fmt(annualOnDemandTotal), C.orange]:null,
                annualPfTotal>0      ?["Plat. fee", fmt(annualPfTotal),       C.mut]:null,
                annualPartnerFeeTotal>0?["Partner fee",fmt(annualPartnerFeeTotal),C.purple]:null,
              ].filter(Boolean).map(([l,v,col])=>(
                <div key={l}><div style={{ ...mono, fontSize:9, color:C.dim, marginBottom:3 }}>{l}</div><div style={{ ...mono, fontSize:13, color:col }}>{v}</div></div>
              ))}
            </div>
            <div style={{ marginTop:14, paddingTop:12, borderTop:`1px solid ${C.brd}`, display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:16 }}>
              <div><div style={{ ...mono, fontSize:9, color:C.dim, marginBottom:3 }}>Deal Total (projected)</div><div style={{ ...mono, fontSize:16, color:C.gold, fontWeight:700 }}>{fmt(annualTotal)}</div></div>
              <div><div style={{ ...mono, fontSize:9, color:C.dim, marginBottom:3 }}>Rack Total</div><div style={{ ...mono, fontSize:14, color:C.mut }}>{fmt(annualBase)}</div></div>
              {annualSavings!==0&&<div><div style={{ ...mono, fontSize:9, color:C.dim, marginBottom:3 }}>Savings vs Rack</div><div style={{ ...mono, fontSize:14, color:annualSavings>=0?C.green:C.red, fontWeight:700 }}>{annualSavings>=0?"▲":"▼"} {fmt(Math.abs(annualSavings))}</div></div>}
            </div>
            {/* Confidence range */}
            <div style={{ marginTop:12, paddingTop:12, borderTop:`1px solid ${C.gold}22`, background:`${C.gold}06`, borderRadius:6, padding:12 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
                <span style={{ ...mono, fontSize:9, color:C.gold, textTransform:"uppercase", letterSpacing:"0.08em" }}>Scenario Range</span>
                <span style={{ ...mono, fontSize:9, color:C.dim }}>({confidence==="high"?"±10% — client confirmed volumes":confidence==="medium"?"±25% — estimated volumes":"±40% — unconfirmed volumes"})</span>
                {[["high",C.green],["medium",C.gold],["low",C.orange]].map(([id,col])=>(
                  <button key={id} onClick={()=>setConfidence(id)} style={{ ...mono, fontSize:9, padding:"1px 7px", background:confidence===id?`${col}20`:"transparent", border:`1px solid ${confidence===id?col:C.brd}`, borderRadius:3, color:confidence===id?col:C.dim, cursor:"pointer" }}>{id}</button>
                ))}
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:16 }}>
                <div>
                  <div style={{ ...mono, fontSize:9, color:C.green+"aa", marginBottom:3 }}>Conservative case</div>
                  <div style={{ ...mono, fontSize:15, color:C.green, fontWeight:700 }}>{fmt(annualConservative)}/yr</div>
                  <div style={{ ...mono, fontSize:9, color:C.dim, marginTop:2 }}>−{Math.round(confPct*100)}% volume</div>
                </div>
                <div>
                  <div style={{ ...mono, fontSize:9, color:C.gold, marginBottom:3 }}>Base case</div>
                  <div style={{ ...mono, fontSize:15, color:C.gold, fontWeight:700 }}>{fmt(annualTotal)}/yr</div>
                  <div style={{ ...mono, fontSize:9, color:C.dim, marginTop:2 }}>projected volumes</div>
                </div>
                <div>
                  <div style={{ ...mono, fontSize:9, color:C.orange+"aa", marginBottom:3 }}>Best case</div>
                  <div style={{ ...mono, fontSize:15, color:C.orange, fontWeight:700 }}>{fmt(annualBest)}/yr</div>
                  <div style={{ ...mono, fontSize:9, color:C.dim, marginTop:2 }}>+{Math.round(confPct*100)}% volume</div>
                </div>
              </div>
            </div>
            {/* Minimum vs projected */}
            <div style={{ marginTop:12, paddingTop:12, borderTop:`1px solid ${C.brd}`, background:`${C.orange}08`, borderRadius:6, padding:12 }}>
              <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:10 }}>Lock-in vs Projected</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:16 }}>
                <div>
                  <div style={{ ...mono, fontSize:9, color:C.orange, marginBottom:3 }}>Minimum (0 users)</div>
                  <div style={{ ...mono, fontSize:15, color:C.orange, fontWeight:700 }}>{fmt(minimumAnnual)}</div>
                  <div style={{ ...mono, fontSize:9, color:C.dim, marginTop:2 }}>
                    {(commitFee>0||commitRamp)?`commitment floor + `:""}platform fees only
                  </div>
                </div>
                <div>
                  <div style={{ ...mono, fontSize:9, color:C.blue, marginBottom:3 }}>Variable (user-driven)</div>
                  <div style={{ ...mono, fontSize:15, color:C.blue, fontWeight:700 }}>{fmt(variableAnnual)}</div>
                  <div style={{ ...mono, fontSize:9, color:C.dim, marginTop:2 }}>API spend above floor</div>
                </div>
                <div>
                  <div style={{ ...mono, fontSize:9, color:C.gold, marginBottom:3 }}>Projected Total</div>
                  <div style={{ ...mono, fontSize:15, color:C.gold, fontWeight:700 }}>{fmt(annualTotal)}</div>
                  <div style={{ ...mono, fontSize:9, color:C.dim, marginTop:2 }}>at {endUsers.toLocaleString()} users Mo 12</div>
                </div>
              </div>
              {minimumAnnual > 0 && annualTotal > 0 && (
                <div style={{ marginTop:10, height:6, borderRadius:3, background:`${C.brd}44`, overflow:"hidden" }}>
                  <div style={{ height:"100%", width:`${Math.min(100,Math.round(minimumAnnual/annualTotal*100))}%`, background:C.orange, borderRadius:3 }}/>
                </div>
              )}
              {minimumAnnual > 0 && annualTotal > 0 && (
                <div style={{ ...mono, fontSize:9, color:C.dim, marginTop:4 }}>
                  {Math.round(minimumAnnual/annualTotal*100)}% locked in regardless of usage
                </div>
              )}
            </div>
            <div style={{ marginTop:12, display:"flex", gap:24 }}>
              <span style={{ ...mono, fontSize:11, color:C.dim }}>Mo 1: <span style={{color:C.txt}}>{fmt(mo1.total)}</span></span>
              <span style={{ ...mono, fontSize:11, color:C.dim }}>Mo 12: <span style={{color:C.txt}}>{fmt(mo12.total)}</span></span>
            </div>
          </div>
          {/* T-type zero-frequency warning */}
          {onDemand === 0 && products.some(p=>p.included && p.type==="T") && (
            <div style={{ marginTop:8, display:"flex", flexDirection:"column", gap:4 }}>
              {products.filter(p=>p.included && p.type==="T").map(p=>(
                <div key={p.id} style={{ ...mono, fontSize:11, color:C.orange, background:`${C.orange}0d`, border:`1px solid ${C.orange}44`, borderRadius:6, padding:"6px 12px" }}>
                  ⚠ {p.name} needs a call frequency — enter estimated calls per user/month in "On-demand calls per user/month"
                </div>
              ))}
            </div>
          )}
          {/* Monthly breakdown table */}
          <div style={{ marginTop:12 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
              <span style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>Monthly Breakdown</span>
            </div>
            <div style={{ border:`1px solid ${C.brd}`, borderRadius:8, overflow:"hidden" }}>
              {(() => {
                const cols = isPartner ? "50px 80px 70px 80px 80px 80px 70px 70px 70px 80px" : "50px 80px 70px 80px 80px 80px 70px 70px 80px";
                const hdrs = ["Mo","Active","New","Onbrd (S)","Recur (R)","OnDmd (T)","Floor","Plat.",...(isPartner?["Partner"]:[]),"Total"];
                return (
                  <>
                    <div style={{ display:"grid", gridTemplateColumns:cols, padding:"5px 10px", background:C.card, borderBottom:`1px solid ${C.brd}` }}>
                      {hdrs.map((h,i)=>(
                        <span key={h} style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", textAlign:i>0?"right":"left" }}>{h}</span>
                      ))}
                    </div>
                    {monthlyBreakdown.map((m,i)=>(
                      <div key={i} style={{ display:"grid", gridTemplateColumns:cols, padding:"4px 10px", borderBottom:i<11?`1px solid ${C.brd}18`:"none", background:i%2===0?"transparent":`${C.brd}08` }}>
                        <span style={{ ...mono, fontSize:10, color:C.dim }}>Mo {i+1}</span>
                        <span style={{ ...mono, fontSize:10, color:C.txt, textAlign:"right" }}>{m.activeUsersThisMo.toLocaleString()}</span>
                        <span style={{ ...mono, fontSize:10, color:C.dim, textAlign:"right" }}>{m.newUsersThisMo.toLocaleString()}</span>
                        <span style={{ ...mono, fontSize:10, color:C.blue, textAlign:"right" }}>{m.singleCost>0?fmt(Math.round(m.singleCost)):"—"}</span>
                        <span style={{ ...mono, fontSize:10, color:C.purple, textAlign:"right" }}>{m.recurringCost>0?fmt(Math.round(m.recurringCost)):"—"}</span>
                        <span style={{ ...mono, fontSize:10, color:C.orange, textAlign:"right" }}
                          title={onDemand>0?`~${Math.round(m.activeUsersThisMo*onDemand).toLocaleString()} calls`:undefined}>
                          {m.onDemandCost>0?fmt(Math.round(m.onDemandCost)):"—"}</span>
                        <span style={{ ...mono, fontSize:10, color:m.floorThisMo>0?C.orange:C.dim, textAlign:"right" }}>{m.floorThisMo>0?fmt(Math.round(m.floorThisMo)):"—"}</span>
                        <span style={{ ...mono, fontSize:10, color:m.dealPf>0?C.gold:C.dim, textAlign:"right" }}>{m.dealPf>0?fmt(Math.round(m.dealPf)):"—"}</span>
                        {isPartner && <span style={{ ...mono, fontSize:10, color:m.partnerFeeMo>0?C.purple:C.dim, textAlign:"right" }}>{m.partnerFeeMo>0?fmt(Math.round(m.partnerFeeMo)):"—"}</span>}
                        <span style={{ ...mono, fontSize:10, color:C.txt, fontWeight:600, textAlign:"right" }}>{fmt(Math.round(m.total))}</span>
                      </div>
                    ))}
                    <div style={{ display:"grid", gridTemplateColumns:cols, padding:"5px 10px", background:C.card, borderTop:`1px solid ${C.brd}` }}>
                      <span style={{ ...mono, fontSize:9, color:C.dim }}>Total</span>
                      <span style={{ ...mono, fontSize:9, color:C.dim, textAlign:"right" }}>—</span>
                      <span style={{ ...mono, fontSize:9, color:C.dim, textAlign:"right" }}>—</span>
                      <span style={{ ...mono, fontSize:9, color:C.blue, textAlign:"right" }}>{annualSingleTotal>0?fmt(Math.round(annualSingleTotal)):"—"}</span>
                      <span style={{ ...mono, fontSize:9, color:C.purple, textAlign:"right" }}>{annualRecurringTotal>0?fmt(Math.round(annualRecurringTotal)):"—"}</span>
                      <span style={{ ...mono, fontSize:9, color:C.orange, textAlign:"right" }}>{annualOnDemandTotal>0?fmt(Math.round(annualOnDemandTotal)):"—"}</span>
                      <span
                        title="Floor = scheduled minimum commitment — actual charge per month is max(apiSpend, floor), not additive"
                        style={{ ...mono, fontSize:9, color:annualFloorTotal>0?C.orange:C.dim, textAlign:"right", cursor:annualFloorTotal>0?"help":"default" }}>
                        {annualFloorTotal>0?fmt(Math.round(annualFloorTotal)):"—"}
                      </span>
                      <span style={{ ...mono, fontSize:9, color:C.gold, textAlign:"right" }}>{annualPfTotal>0?fmt(Math.round(annualPfTotal)):"—"}</span>
                      {isPartner && <span style={{ ...mono, fontSize:9, color:C.purple, fontWeight:700, textAlign:"right" }}>{annualPartnerFeeTotal>0?fmt(Math.round(annualPartnerFeeTotal)):"—"}</span>}
                      <span style={{ ...mono, fontSize:9, color:C.gold, fontWeight:700, textAlign:"right" }}>{fmt(Math.round(annualTotal))}</span>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ── Export panel ── */}
      {selectedCount > 0 && (
        <div style={{ marginTop:20, padding:"14px 20px", borderTop:`1px solid ${C.brd}` }}>
          {renderFormatBar()}
          <div style={{ display:"flex", alignItems:"center", gap:10, marginTop:8 }}>
            <button
              onClick={() => { if (linkedAcc) setExportOpen(true); }}
              disabled={!linkedAcc}
              title={!linkedAcc ? "Link an account to export" : undefined}
              style={{ ...mono, fontSize:12, padding:"0 16px", height:26, background:`${C.gold}18`, border:`1px solid ${C.goldBdr}`, color:C.gold, borderRadius:5, cursor:linkedAcc?"pointer":"not-allowed", fontWeight:600, opacity:linkedAcc?1:0.4 }}>
              ↑ Export →
            </button>
            {!linkedAcc && <span style={{ ...mono, fontSize:10, color:C.dim }}>Link an account above to enable export</span>}
          </div>
        </div>
      )}
      {exportOpen && linkedAcc && (
        <DealExportModal accId={linkedAcc.id} acc={linkedAcc} onClose={() => setExportOpen(false)} />
      )}
      {proposalOpen && linkedAcc && (
        <ProposalBuilderModal
          linkedAcc={linkedAcc}
          pricingState={{
            products, monthlyBreakdown, avgAccounts, onDemand,
            commitFee, pfTier, annualTotal, annualSavings, annualPfTotal,
            annualConservative, annualBest, minimumAnnual,
            commitRamp, commitRampSched, pfRamp, pfRampSched,
            annualBase, annualSingleTotal, annualRecurringTotal,
            annualOnDemandTotal, variableAnnual,
            tierAmount, discountedTierAmount, pfDiscount,
            isPartner, partnerFee,
            startUsers, endUsers, billingStart,
          }}
          onClose={() => setProposalOpen(false)}
        />
      )}
    </div>
  );
}

export default SummaryTab;
