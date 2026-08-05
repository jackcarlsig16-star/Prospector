import React, { useState } from 'react';
import { C, TS, mono } from '../constants/colors';
import { calcPricingAnnual } from './AccountCard';
import DealExportModal from './DealExportModal';
import { ROI_KEY } from '../utils/storageKeys';
import { productMonthlyCost, monthUsersAt } from '../utils/pricingMath';

// ── Deal Summary Modal ────────────────────────────────────────────────────────
export default function DealSummaryModal({ accId, accounts=[], onClose }) {
  const [exportOpen, setExportOpen] = useState(false);
  const acc = accounts.find(a=>a.id===accId)||{};
  const pFile = (() => { try { return JSON.parse(localStorage.getItem("prospector_pricing_files")||"{}")[accId]||null; } catch { return null; } })();
  const rFile = (() => { try { return JSON.parse(localStorage.getItem(ROI_KEY)||"{}")[accId]||null; } catch { return null; } })();
  const hasBoth = !!(pFile && rFile);

  // Compute per-month cost array from pricing file
  const calcMonthlyCosts = (f) => {
    if (!f?.products || !f?.monthlyUsers) return Array(12).fill(0);
    try {
      const prods = f.products.filter(p=>p.included);
      const pfAmt = (() => {
        const TIERS = {base:2000,plus:5000,premium:15000};
        const t = TIERS[f.pfTier]||0;
        if (!f.pfDiscount?.enabled) return t;
        return f.pfDiscount.type==="pct" ? t*(1-f.pfDiscount.amount/100) : Math.max(0,t-f.pfDiscount.amount);
      })();
      const sessionCtx = { avgAccounts: f.avgAccounts || 2.5, onDemand: f.onDemand || 0, tierMult: 1 };
      return Array.from({length:12},(_,i)=>{
        const monthCtx = monthUsersAt(f.monthlyUsers, i);
        let apiSpend = 0;
        prods.forEach(p => { apiSpend += productMonthlyCost(p, monthCtx, sessionCtx); });
        const floorThisMo = f.commitRamp ? (f.commitRampSched?.[i]||0) : (f.commitFee||0);
        const apiCharge = floorThisMo > 0 ? Math.max(apiSpend, floorThisMo) : apiSpend;
        const mo = apiCharge + (f.pfRamp ? (f.pfRampSched?.[i]||0) : pfAmt) + (f.isPartner ? (f.partnerFee||0) : 0);
        return Math.round(mo);
      });
    } catch { return Array(12).fill(0); }
  };

  // Pricing-mode calcs (when both files exist)
  const mu = pFile?.monthlyUsers || [];
  const newUsersAtMo = i => i===0 ? (mu[0]||0) : Math.max(0,(mu[i]||0)-(mu[i-1]||0));
  const avgRPU = rFile?.avgRevenuePerUser || 0;
  const costSPU = rFile?.manualCostSavingPerUser || 0;
  const integrationCost = rFile?.integrationCost || 0;
  const monthlyRevArr  = mu.map(u => u * avgRPU / 12);
  const monthlySavArr  = mu.map((_, i) => newUsersAtMo(i) * costSPU);
  const monthlyCostArr = hasBoth ? calcMonthlyCosts(pFile) : Array(12).fill(0);
  const monthlyGainArr = monthlyRevArr.map((v, i) => v + monthlySavArr[i]);

  // Annual totals
  const annualRevenue  = monthlyRevArr.reduce((s,v)=>s+v,0);
  const totalSavings   = monthlySavArr.reduce((s,v)=>s+v,0);
  const annualGainP    = annualRevenue + totalSavings;
  const annualCostP   = monthlyCostArr.reduce((s,v)=>s+v,0);

  // Manual-mode calcs (fallback)
  const r = rFile || {};
  const ma=r.monthlyAttempts||0, cr=r.currentConvRate||0, pr=r.newConvRate||0;
  const addPerMo  = ma*(pr-cr)/100;
  const addPerYr  = Math.round(addPerMo*12);
  const revUplift = Math.round(addPerYr*(r.avgAnnualRevenue||avgRPU||0));
  const costSavM  = Math.round(ma*12*(r.manualCostPerAttempt||costSPU||0)*(pr-cr)/100);
  const annualGainM = revUplift + costSavM;
  const productCostM  = r.manualCost || (pFile ? calcPricingAnnual(pFile)||0 : 0);

  // Choose mode
  const annualGain = hasBoth ? annualGainP : annualGainM;
  const productCost  = hasBoth ? annualCostP : productCostM;
  const netRoi     = annualGain - productCost;
  const roiRatio   = productCost > 0 ? (annualGain/productCost).toFixed(1) : null;

  // Cumulative data
  const cumulativeData = hasBoth
    ? Array.from({length:12},(_,i)=>{
        let cum = -integrationCost;
        for (let m=0;m<=i;m++) cum += monthlyGainArr[m] - monthlyCostArr[m];
        return cum;
      })
    : Array.from({length:12},(_,i) => (i+1)*annualGain/12 - (i+1)*productCost/12 - integrationCost);

  const breakEven = (() => {
    for (let m=0;m<cumulativeData.length;m++) { if(cumulativeData[m]>=0) return m+1; }
    return null;
  })();

  const fmt = n => n==null?"—":"$"+Math.round(n).toLocaleString();
  const fmtK = n => { const v=Math.round(n); return (v>=0?"$":"−$")+Math.abs(Math.round(v/1000))+"k"; };
  const name = acc.name||"This company";
  const ts = TS[acc.tier]||TS.Tin;

  // Chart helpers
  const cW=680, cH=90, cPL=42, cPR=10, cPT=8, cPB=22;
  const cInH=cH-cPT-cPB, cInW=cW-cPL-cPR;
  const slot=cInW/12, bW=Math.max(6,slot/2-3);

  // Chart 1: monthly gain vs cost grouped bars
  const maxGC = Math.max(...monthlyGainArr, ...monthlyCostArr, 1);
  const gcY = v => cPT + cInH*(1 - v/maxGC);
  const gcX = i => cPL + i*slot + slot/2;

  // Chart 2: cumulative ROI
  const minC = Math.min(...cumulativeData, 0);
  const maxC = Math.max(...cumulativeData, 1);
  const cuY = v => cPT + cInH*(1-(v-minC)/(maxC-minC||1));
  const cuX = i => cPL + i*slot + slot/2;
  const zeroY = cuY(0);

  const pfLabel = {base:"Base",plus:"Plus",premium:"Premium"};
  const pfActual = (() => {
    if (!pFile?.pfTier) return null;
    const TIERS = {base:2000,plus:5000,premium:15000};
    const t = TIERS[pFile.pfTier]||0;
    if (!pFile.pfDiscount?.enabled) return t;
    return pFile.pfDiscount.type==="pct" ? t*(1-pFile.pfDiscount.amount/100) : Math.max(0,t-pFile.pfDiscount.amount);
  })();
  const summaryText = [
    `Deal Summary — ${name}`,
    ``,
    `COST  Annual spend: ${fmt(productCost)}`,
    `GAIN  Revenue: ${fmt(annualRevenue||revUplift)}  ·  Savings: ${fmt(totalSavings||costSavM)}  ·  Total: ${fmt(annualGain)}`,
    `NET   ${roiRatio?`For every $1 spent, ${name} generates $${roiRatio}`:"Net ROI: "+fmt(netRoi)}`,
    breakEven?`      Pays for itself by Month ${breakEven}`:"",
    ``,
    `ASSUMPTIONS`,
    hasBoth && mu.length
      ? `  Users: ${(mu[0]||0).toLocaleString()} (Mo1) → ${(mu[11]||mu[mu.length-1]||0).toLocaleString()} (Mo12)` + (pFile?.avgAccounts ? `  ·  Avg accounts/user: ${pFile.avgAccounts}` : "")
      : (ma ? `  Monthly link attempts: ${ma.toLocaleString()}` : ""),
    (cr||pr) ? `  Conversion: ${cr}% current → ${pr}% with new` : "",
    (avgRPU||r.avgAnnualRevenue) ? `  Revenue/linked user: ${fmt(avgRPU||r.avgAnnualRevenue)}/yr` : "",
    costSPU ? `  Cost savings/user: ${fmt(costSPU)}` : "",
    pFile && (pFile.commitFee||pFile.commitRamp) ? `  API commitment: ${pFile.commitRamp?"ramp schedule":fmt(pFile.commitFee)+"/mo"}` : "",
    pfActual!=null ? `  Platform fee: ${pfLabel[pFile.pfTier]||pFile.pfTier} — ${fmt(pfActual)}/mo${pFile.pfDiscount?.enabled?" (discounted)":""}` : "",
    integrationCost ? `  Integration cost: ${fmt(integrationCost)}` : "",
    ``,
    pFile?.products?.filter(p=>p.included).length ? `Products: ${pFile.products.filter(p=>p.included).map(p=>p.name).join(", ")}` : "",
  ].filter(l=>l!=="").join("\n");

  return (
    <>
    <div onClick={e=>{if(e.target===e.currentTarget)onClose();}} style={{ position:"fixed",inset:0,zIndex:1100,background:"#00000099",display:"flex",alignItems:"center",justifyContent:"center",padding:20 }}>
      <div style={{ background:C.card,border:`1px solid ${C.goldBdr}`,borderRadius:14,padding:"26px 28px",width:hasBoth?740:480,boxShadow:"0 24px 64px #000e",maxHeight:"90vh",overflowY:"auto" }}>
        {/* Header */}
        <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:20 }}>
          <div style={{ flex:1 }}>
            <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:2 }}>
              <span style={{ fontSize:17,fontWeight:700,color:C.txt }}>{name}</span>
              {acc.tier&&<span style={{ ...mono,fontSize:11,padding:"1px 7px",background:ts.bg,border:`1px solid ${ts.b}`,color:ts.t,borderRadius:4 }}>{ts.i} {acc.tier}</span>}
              {hasBoth&&<span style={{ ...mono,fontSize:10,color:C.gold,background:`${C.gold}14`,border:`1px solid ${C.gold}33`,borderRadius:3,padding:"1px 6px" }}>pricing + ROI</span>}
            </div>
            <span style={{ ...mono,fontSize:11,color:C.dim }}>Deal Summary</span>
          </div>
          <button onClick={onClose} style={{ background:"transparent",border:"none",color:C.mut,fontSize:20,cursor:"pointer",lineHeight:1 }}>✕</button>
        </div>

        {/* Three metric rows */}
        <div style={{ display:"flex",flexDirection:"column",gap:10,marginBottom:hasBoth?18:20 }}>
          <div style={{ display:"grid",gridTemplateColumns:hasBoth?"1fr 1fr 1fr":"1fr",gap:10 }}>
            {/* Cost */}
            <div style={{ background:C.sur,border:`1px solid ${C.brd}`,borderRadius:8,padding:"12px 16px" }}>
              <div style={{ ...mono,fontSize:10,color:C.orange,textTransform:"uppercase",marginBottom:4 }}>Cost</div>
              <div style={{ fontSize:hasBoth?16:18,fontWeight:700,color:C.orange }}>{fmt(productCost)}<span style={{ fontSize:11,fontWeight:400,color:C.mut }}> / yr</span></div>
              <div style={{ ...mono,fontSize:10,color:C.dim,marginTop:2 }}>Annual spend</div>
            </div>
            {/* Gain */}
            <div style={{ background:C.sur,border:`1px solid ${C.brd}`,borderRadius:8,padding:"12px 16px" }}>
              <div style={{ ...mono,fontSize:10,color:C.green,textTransform:"uppercase",marginBottom:4 }}>Gain</div>
              <div style={{ fontSize:hasBoth?16:18,fontWeight:700,color:C.green }}>{fmt(annualGain)}<span style={{ fontSize:11,fontWeight:400,color:C.mut }}> / yr</span></div>
              <div style={{ ...mono,fontSize:10,color:C.dim,marginTop:2 }}>
                {hasBoth
                  ? `Rev ${fmt(annualRevenue)}  ·  Savings ${fmt(totalSavings)}`
                  : `${revUplift>0?`Rev ${fmt(revUplift)}`:""}${revUplift>0&&costSavM>0?"  ·  ":""}${costSavM>0?`Savings ${fmt(costSavM)}`:""}`
                }
              </div>
            </div>
            {/* Net ROI */}
            <div style={{ background:`${C.gold}0c`,border:`1px solid ${C.goldBdr}`,borderRadius:8,padding:"12px 16px" }}>
              <div style={{ ...mono,fontSize:10,color:C.gold,textTransform:"uppercase",marginBottom:4 }}>Net ROI</div>
              <div style={{ fontSize:hasBoth?16:18,fontWeight:700,color:C.gold }}>{roiRatio?`$${roiRatio} per $1`:`${fmt(netRoi)}`}</div>
              <div style={{ ...mono,fontSize:10,color:C.dim,marginTop:2 }}>
                {breakEven?`Break-even Month ${breakEven}`:`Net gain ${fmt(netRoi)}`}
              </div>
            </div>
          </div>
        </div>

        {/* Charts — only when both files exist */}
        {hasBoth && (
          <div style={{ display:"flex",flexDirection:"column",gap:12,marginBottom:18 }}>
            {/* Chart 1: Monthly Gain vs Cost */}
            <div style={{ background:C.sur,border:`1px solid ${C.brd}`,borderRadius:10,padding:"12px 14px" }}>
              <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:8 }}>
                <span style={{ ...mono,fontSize:11,color:C.txt,fontWeight:700 }}>Monthly Gain vs Cost</span>
                <div style={{ display:"flex",gap:10,marginLeft:"auto" }}>
                  <span style={{ ...mono,fontSize:10,color:C.green }}>▮ Gain</span>
                  <span style={{ ...mono,fontSize:10,color:C.orange }}>▮ Cost</span>
                </div>
              </div>
              <svg viewBox={`0 0 ${cW} ${cH}`} style={{ width:"100%",height:"auto",display:"block" }}>
                {[0,0.5,1].map(pct=>{
                  const val=maxGC*pct;
                  const y=gcY(val);
                  return <g key={pct}>
                    <line x1={cPL} x2={cW-cPR} y1={y} y2={y} stroke={C.brd} strokeWidth={0.5} opacity={0.6}/>
                    <text x={cPL-4} y={y+3} textAnchor="end" fontSize={7} fill={C.dim} fontFamily="ui-monospace,monospace">{fmtK(val)}</text>
                  </g>;
                })}
                {monthlyGainArr.map((g,i)=>{
                  const pc = monthlyCostArr[i]||0;
                  const gH = Math.max(1, cPT+cInH - gcY(g));
                  const pH = Math.max(1, cPT+cInH - gcY(pc));
                  return <g key={i}>
                    <rect x={gcX(i)-bW-1} y={gcY(g)} width={bW} height={gH} fill={C.green} opacity={0.8}/>
                    <rect x={gcX(i)+1}    y={gcY(pc)} width={bW} height={pH} fill={C.orange} opacity={0.8}/>
                    <text x={gcX(i)} y={cH-cPB+11} textAnchor="middle" fontSize={7} fill={C.dim} fontFamily="ui-monospace,monospace">{i===0?"Mo 1":i===11?"Mo 12":i+1}</text>
                  </g>;
                })}
              </svg>
            </div>

            {/* Chart 2: Cumulative ROI */}
            <div style={{ background:C.sur,border:`1px solid ${C.brd}`,borderRadius:10,padding:"12px 14px" }}>
              <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:8 }}>
                <span style={{ ...mono,fontSize:11,color:C.txt,fontWeight:700 }}>Cumulative Net ROI</span>
                {breakEven&&<span style={{ ...mono,fontSize:10,color:C.green }}>✓ Break-even Month {breakEven}</span>}
                <span style={{ marginLeft:"auto",...mono,fontSize:10,color:cumulativeData[11]>=0?C.green:C.red }}>Mo 12: {fmt(cumulativeData[11])}</span>
              </div>
              <svg viewBox={`0 0 ${cW} ${cH}`} style={{ width:"100%",height:"auto",display:"block" }}>
                {[0,0.5,1].map(pct=>{
                  const val=minC+(maxC-minC)*pct;
                  const y=cuY(val);
                  return <g key={pct}>
                    <line x1={cPL} x2={cW-cPR} y1={y} y2={y} stroke={C.brd} strokeWidth={0.5} opacity={0.6}/>
                    <text x={cPL-4} y={y+3} textAnchor="end" fontSize={7} fill={C.dim} fontFamily="ui-monospace,monospace">{val>=0?"$":"−$"}{Math.abs(Math.round(val/1000))}k</text>
                  </g>;
                })}
                {minC<0&&<line x1={cPL} x2={cW-cPR} y1={zeroY} y2={zeroY} stroke={C.brd} strokeWidth={1} opacity={0.9}/>}
                {cumulativeData.map((v,i)=>{
                  const bH=Math.abs(cuY(v)-zeroY);
                  const y=v>=0?cuY(v):zeroY;
                  return <g key={i}>
                    <rect x={cuX(i)-bW} y={y} width={bW*2} height={Math.max(1,bH)} fill={v>=0?C.green:C.red} opacity={0.75}/>
                    <text x={cuX(i)} y={cH-cPB+11} textAnchor="middle" fontSize={7} fill={C.dim} fontFamily="ui-monospace,monospace">{i===0?"Mo 1":i===11?"Mo 12":i+1}</text>
                  </g>;
                })}
              </svg>
            </div>
          </div>
        )}

        {/* Products */}
        {pFile?.products?.filter(p=>p.included).length>0&&(
          <div style={{ marginBottom:16 }}>
            <div style={{ ...mono,fontSize:10,color:C.dim,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6 }}>Selected products</div>
            <div style={{ display:"flex",flexWrap:"wrap",gap:5 }}>
              {pFile.products.filter(p=>p.included).map(p=>(
                <span key={p.id} style={{ ...mono,fontSize:11,color:C.purple,background:`${C.purple}14`,border:`1px solid ${C.purple}33`,borderRadius:4,padding:"2px 8px" }}>{p.name}</span>
              ))}
            </div>
          </div>
        )}

        {/* Export button */}
        <button onClick={()=>setExportOpen(true)}
          style={{ width:"100%",...mono,fontSize:13,padding:"0 10px",height:26,background:`${C.gold}18`,border:`1px solid ${C.goldBdr}`,color:C.gold,borderRadius:7,cursor:"pointer",fontWeight:600 }}>
          ↑ Export →
        </button>
      </div>
    </div>
    {exportOpen&&<DealExportModal accId={accId} acc={acc} onClose={()=>setExportOpen(false)}/>}
    </>
  );
}
