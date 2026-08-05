import React from 'react';
import { C, mono } from '../../constants/colors';
import { FILES_KEY } from '../../utils/storageKeys';
import { productMonthlyCost, monthUsersAt } from '../../utils/pricingMath';

const SNAP_KEY  = "prospector_pricing_snapshots";

function HistoryTab({ accounts, products, linkedAccId, switchToAccount, setAccSearch, setPricingTab }) {
  let allFiles = {};
  try { allFiles = JSON.parse(localStorage.getItem(FILES_KEY)||"{}"); } catch {}
  let allSnaps = {};
  try { allSnaps = JSON.parse(localStorage.getItem(SNAP_KEY)||"{}"); } catch {}

  const fileAccIds = Object.keys(allFiles);
  const allAccIds = [...new Set([...fileAccIds, ...Object.keys(allSnaps)])];

  const rows = allAccIds.map(accId=>{
    const acc = accounts.find(a=>a.id===accId);
    const file = allFiles[accId];
    const snaps = allSnaps[accId]||[];
    const lastSaved = file?.savedAt || snaps[0]?.savedAt || null;
    return { accId, acc, file, snaps, lastSaved };
  }).sort((a,b)=>{
    if (!a.lastSaved && !b.lastSaved) return 0;
    if (!a.lastSaved) return 1;
    if (!b.lastSaved) return -1;
    return new Date(b.lastSaved) - new Date(a.lastSaved);
  });

  const fmt12 = d => { try { return new Date(d).toLocaleDateString("en-US",{month:"short",day:"numeric"}); } catch { return d||"—"; } };

  const fileAnnual = (f) => {
    if (!f?.products || !f?.monthlyUsers) return null;
    try {
      const prods = f.products.filter(p=>p.included);
      const sessionCtx = { avgAccounts: f.avgAccounts || 2.5, onDemand: f.onDemand || 0, tierMult: 1 };
      let total = 0;
      for (let i=0;i<12;i++){
        const monthCtx = monthUsersAt(f.monthlyUsers, i);
        prods.forEach(p => { total += productMonthlyCost(p, monthCtx, sessionCtx); });
      }
      return total;
    } catch { return null; }
  };

  if (rows.length === 0) return (
    <div style={{ textAlign:"center", padding:"40px 0", color:C.dim }}>
      <p style={{ ...mono, fontSize:13 }}>No pricing sessions saved yet.</p>
      <p style={{ ...mono, fontSize:11, marginTop:6 }}>Link an account and configure pricing — it saves automatically.</p>
    </div>
  );

  return (
    <div>
      <p style={{ ...mono, margin:"0 0 12px", fontSize:11, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>{rows.length} account{rows.length!==1?"s":""} with saved pricing</p>
      {rows.map(({accId, acc, file, snaps, lastSaved})=>{
        const annual = fileAnnual(file);
        const isActive = accId === linkedAccId;
        const fmt = n => n == null ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits:2, maximumFractionDigits:2 })}`;
        return (
          <div key={accId} style={{ marginBottom:8, background:isActive?`${C.gold}0a`:C.sur, border:`1px solid ${isActive?C.gold+"44":C.brd}`, borderRadius:8, overflow:"hidden" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 12px", cursor:"pointer" }}
              onClick={()=>{ switchToAccount(accId); setAccSearch(acc?.name||accId); setPricingTab("calc"); }}
              onMouseEnter={e=>{ if(!isActive) e.currentTarget.style.background=`${C.gold}08`; }}
              onMouseLeave={e=>{ e.currentTarget.style.background="transparent"; }}>
              <span style={{ ...mono, fontSize:13, color:isActive?C.gold:C.txt, fontWeight:isActive?700:400, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {acc?.name || <span style={{ color:C.dim, fontStyle:"italic" }}>Unknown account</span>}
              </span>
              {acc?.tier && <span style={{ ...mono, fontSize:10, color:C.blue, background:`${C.blue}14`, border:`1px solid ${C.blue}33`, borderRadius:3, padding:"1px 5px", flexShrink:0 }}>{acc.tier}</span>}
              {annual!=null && <span style={{ ...mono, fontSize:11, color:C.green, flexShrink:0 }}>${Math.round(annual/1000)}k yr1</span>}
              {lastSaved && <span style={{ ...mono, fontSize:10, color:C.dim, flexShrink:0 }}>{fmt12(lastSaved)}</span>}
              {snaps.length>0 && <span style={{ ...mono, fontSize:10, color:C.gold, background:`${C.gold}18`, borderRadius:3, padding:"1px 5px", flexShrink:0 }}>{snaps.length} snap{snaps.length!==1?"s":""}</span>}
              <span style={{ ...mono, fontSize:11, color:isActive?C.gold:C.mut, flexShrink:0 }}>{isActive?"✓ open":"→"}</span>
            </div>
            {snaps.length>0 && (
              <div style={{ borderTop:`1px solid ${C.brd}22`, paddingLeft:24 }}>
                {snaps.map((s,si)=>(
                  <div key={s.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"5px 12px 5px 0", borderBottom:si<snaps.length-1?`1px solid ${C.brd}18`:"none" }}>
                    <span style={{ ...mono, fontSize:10, color:C.dim, flexShrink:0 }}>└</span>
                    <span style={{ ...mono, fontSize:12, color:C.mut, flex:1 }}>{s.name}</span>
                    <span style={{ ...mono, fontSize:10, color:C.dim, flexShrink:0 }}>{s.savedAt||fmt12(s.id)}</span>
                    <button onClick={()=>{ switchToAccount(accId); setAccSearch(acc?.name||accId); setPricingTab("calc"); }}
                      style={{ ...mono, fontSize:10, padding:"2px 8px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:4, color:C.mut, cursor:"pointer", flexShrink:0 }}>open</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default HistoryTab;
