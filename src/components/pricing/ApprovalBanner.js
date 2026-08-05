import React from 'react';
import { mono } from '../../constants/colors';
import { APPROVAL_LEVELS } from '../../constants/approvalMatrix';

const PILL_IC = { L1:"🟡", L2:"🟠", L3:"🔴", L4:"◼", FINANCE:"⚠" };

function ApprovalBanner({ calcApproval, showApprovals, hideForExport, selectedCount, approvalOpen, setApprovalOpen }) {
  if (selectedCount === 0 || !showApprovals || hideForExport) return null;

  const { overallLevel, perProduct, apiCommit } = calcApproval;
  if (overallLevel === "L0") return null; // pre-approved — no noise

  const lvl = APPROVAL_LEVELS[overallLevel] || APPROVAL_LEVELS["L0"];
  const ic  = PILL_IC[overallLevel] || "";
  const commitStr = apiCommit > 0 ? `$${apiCommit.toLocaleString()}/mo commit` : "no commit";

  return (
    <div style={{ position:"relative", display:"inline-flex" }}>
      {/* ── Pill ── */}
      <button onClick={()=>setApprovalOpen(o=>!o)}
        style={{ ...mono, display:"inline-flex", alignItems:"center", gap:5,
          padding:"2px 8px 2px 6px", borderRadius:4,
          background:lvl.bg, border:`1px solid ${lvl.border}`,
          color:lvl.color, cursor:"pointer", fontSize:11, fontWeight:600,
          whiteSpace:"nowrap", lineHeight:"18px" }}>
        <span style={{ fontSize:10, lineHeight:1 }}>{ic}</span>
        {overallLevel}
        <span style={{ fontSize:9, opacity:0.6, marginLeft:1 }}>{approvalOpen?"▲":"▼"}</span>
      </button>

      {/* ── Dropdown ── */}
      {approvalOpen && (
        <div style={{ position:"absolute", top:"calc(100% + 5px)", left:0, zIndex:300,
          background:"#0F0F0F", border:`1px solid #1E2128`, borderRadius:7,
          minWidth:340, maxWidth:520, boxShadow:"0 8px 28px #000f", padding:"8px 0" }}>

          {/* Per-product rows */}
          {perProduct.map(({ p, discountPct, level }) => {
            const triggering = discountPct > 0 && level !== "L0";
            const pLvl = APPROVAL_LEVELS[level] || APPROVAL_LEVELS["L0"];
            return (
              <div key={p.id} style={{ display:"flex", alignItems:"center", gap:8,
                padding:"4px 14px", minWidth:0 }}>
                {triggering
                  ? <span style={{ width:5, height:5, borderRadius:"50%", background:pLvl.dot||pLvl.color, flexShrink:0 }}/>
                  : <span style={{ width:5, height:5, flexShrink:0 }}/>}
                <span style={{ ...mono, fontSize:11, flex:1, minWidth:0,
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                  color: triggering ? pLvl.color : "#A0A4AF" }}>{p.name}</span>
                {triggering
                  ? <span style={{ ...mono, fontSize:10, color:pLvl.color, flexShrink:0, opacity:0.85 }}>
                      {Math.round(discountPct*100)}% off · {commitStr} → {level}
                    </span>
                  : <span style={{ ...mono, fontSize:10, color:"#3D4048", flexShrink:0 }}>L0</span>}
              </div>
            );
          })}

          {/* Overall summary + hide */}
          <div style={{ borderTop:`1px solid #1E2128`, margin:"6px 0 0" }}/>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
            padding:"6px 14px 2px" }}>
            <span style={{ ...mono, fontSize:11, color:lvl.color, fontWeight:700 }}>
              Overall: {overallLevel} — {lvl.desc}
            </span>
            <button onClick={()=>setApprovalOpen(false)}
              style={{ ...mono, fontSize:10, background:"transparent", border:"none",
                color:"#3D4048", cursor:"pointer", padding:0 }}>
              hide ↑
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default ApprovalBanner;
