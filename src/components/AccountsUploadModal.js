import React, { useState, useMemo, useRef, useEffect } from 'react';
import { C, mono } from '../constants/colors';
import { getActiveIntel, getActiveExamples, clientAssay } from '../utils/assay';
import { DEAL_STAGES } from './AccountCard';
import { MODELS } from '../config/models';
import { normName as normAccountName, normDomain as normAccountDomain, contextScore as scoreAccountContext } from '../utils/normAccount';

const VERT_C = {
  "Banks": "#60A8F0", "BFM": "#F5A050", "PFM": "#A878F0",
  "Wealth": "#F5C842", "Consumer Payments": "#42E890", "Technology": "#56C8E0",
  "Lending": "#F06060", "Insurance": "#E878C0", "Crypto": "#50C8A0",
  "Payroll": "#E8C870", "Real Estate": "#90C878", "Healthcare": "#78D0B0",
  "Commerce": "#E8A050", "Investment": "#F5C842", "Fintech": "#A878F0",
};

const normName   = n   => (n||"").toLowerCase().replace(/[^a-z0-9]/g," ").replace(/\s+/g," ").trim();
const normDomain = web => (web||"").replace(/^https?:\/\//i,"").replace(/^www\./i,"").replace(/\/.*$/,"").toLowerCase().trim();

export function AddAccountModal({ onAdd, onClose, prefill = {} }) {
  const hasPrefill = !!(prefill.name || prefill.vertical || prefill.context);
  const [name,   setName]   = useState(prefill.name || "");
  const [web,    setWeb]    = useState(prefill.web || "");
  const [vert,   setVert]   = useState(prefill.vertical || "");
  const [sub,    setSub]    = useState(prefill.subVertical || "");
  const [stage,  setStage]  = useState("Prospecting");
  const [ctx,    setCtx]    = useState(prefill.context || "");
  const [sfdc,   setSfdc]   = useState("");
  const [scoring,setScoring]= useState(false);
  const [err,    setErr]    = useState(null);
  const [detecting,        setDetecting]        = useState(false);
  const [autoDetected,     setAutoDetected]     = useState(!!prefill.vertical);
  const [vertManuallySet,  setVertManuallySet]  = useState(false);
  const detectTimer = useRef(null);

  const VERTS = Object.keys(VERT_C);

  useEffect(() => {
    if (vertManuallySet || ctx.length < 20) return;
    if (detectTimer.current) clearTimeout(detectTimer.current);
    detectTimer.current = setTimeout(async () => {
      setDetecting(true);
      try {
        const resp = await fetch("/proxy/anthropic/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: MODELS.FAST,
            max_tokens: 100,
            system: `You are a sales classifier. Given a brief company description or handoff note, return only a JSON object with two fields: vertical and subvertical. Vertical must be one of: ${VERTS.join(", ")}, Unknown. Subvertical is a short 2-4 word phrase describing the specific niche (e.g. 'BNPL', 'HOA management', 'EWA payroll', 'B2B payments'). Return only valid JSON, no explanation.`,
            messages: [{ role: "user", content: ctx }],
          }),
        });
        if (!resp.ok) return;
        const data = await resp.json();
        const raw = data?.content?.[0]?.text?.trim();
        const parsed = JSON.parse(raw);
        if (parsed?.vertical && parsed?.subvertical) {
          if (VERTS.includes(parsed.vertical)) setVert(parsed.vertical);
          setSub(parsed.subvertical);
          setAutoDetected(true);
        }
      } catch {
        // silently ignore
      } finally {
        setDetecting(false);
      }
    }, 600);
    return () => clearTimeout(detectTimer.current);
  }, [ctx, vertManuallySet]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleVertChange = (e) => { setVert(e.target.value); setVertManuallySet(true); setAutoDetected(false); };
  const handleSubChange  = (e) => { setSub(e.target.value);  setVertManuallySet(true); setAutoDetected(false); };

  const submit = async () => {
    if (!name.trim()) { setErr("Name is required"); return; }
    setScoring(true); setErr(null);
    try {
      const combinedIntel = [ctx.trim(), getActiveIntel()].filter(Boolean).join("\n\n---\n\n");
      const parsed = await clientAssay({ name: name.trim(), web: web.trim(), vert, sub, customIntel: combinedIntel, exampleAccts: getActiveExamples(), stage });
      onAdd({
        id: Date.now(), name: name.trim(), web: web.trim(), vert, stage,
        tier: parsed.tier || null, score: parsed.score || null,
        bm: parsed.businessModel || "", pf: parsed.productFit || "",
        sigs: parsed.keySignals || [], ucs: parsed.useCases || [],
        prods: parsed.products || [], dis: parsed.disqualifier || null,
        linkedin: parsed.linkedin || "", analyzed: true, sfdc: sfdc.trim() || "",
        handoffNotes: ctx.trim() || null, last: new Date().toISOString().slice(0, 10),
        addedAt: new Date().toISOString(), addedSource: "manual",
      });
      onClose();
    } catch(e) {
      setErr("Scoring failed — account saved unscored");
      onAdd({ id:Date.now(), name:name.trim(), web:web.trim(), vert, stage, sfdc:sfdc.trim()||"", analyzed:false, handoffNotes:ctx.trim()||null, last:new Date().toISOString().slice(0,10), addedAt:new Date().toISOString(), addedSource:"manual" });
      onClose();
    }
  };

  const inp = { fontSize:13, padding:"6px 10px", background:C.bg, border:`1px solid ${C.brdM}`, borderRadius:5, color:C.txt, outline:"none", width:"100%", boxSizing:"border-box" };
  const lbl = { ...mono, margin:"0 0 4px", fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", display:"block" };

  return (
    <div style={{ position:"fixed", inset:0, background:"#000000AA", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{ width:480, background:C.sur, border:`1px solid ${C.brd}`, borderRadius:12, padding:"24px 28px", boxShadow:"0 24px 64px #000000AA" }}>
        <div style={{ display:"flex", alignItems:"center", marginBottom:20 }}>
          <p style={{ margin:0, fontSize:16, fontWeight:500, color:C.txt }}>Add Account</p>
          <button onClick={onClose} style={{ marginLeft:"auto", background:"none", border:"none", color:C.dim, fontSize:18, cursor:"pointer", lineHeight:1 }}>✕</button>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:13 }}>
          {hasPrefill && (
            <div style={{ ...mono, fontSize:11, color:C.gold, background:`${C.gold}10`, border:`1px solid ${C.goldBdr}44`, borderRadius:5, padding:"7px 10px" }}>
              ✦ Pre-filled from your research notes — add SF link and website to complete
            </div>
          )}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <div>
              <span style={lbl}>Company name *</span>
              <input value={name} onChange={e=>setName(e.target.value)} placeholder="Acme Corp" style={inp} autoFocus/>
            </div>
            <div>
              <span style={lbl}>Website</span>
              <input value={web} onChange={e=>setWeb(e.target.value)} placeholder="acme.com" style={inp}/>
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12 }}>
            <div>
              <span style={lbl}>
                Vertical
                {detecting && <span style={{ marginLeft:5, color:C.dim, fontSize:9, fontWeight:400, textTransform:"none", letterSpacing:0 }}>detecting…</span>}
                {autoDetected && !vertManuallySet && !detecting && <span style={{ marginLeft:5, color:C.gold, opacity:0.65, fontSize:9, fontWeight:400, textTransform:"none", letterSpacing:0 }}>✦ Auto-detected</span>}
              </span>
              <select value={vert} onChange={handleVertChange}
                style={{ ...inp, cursor:"pointer", borderColor: detecting ? `${C.goldBdr}55` : C.brdM, transition:"border-color 0.2s" }}>
                <option value="">Unknown</option>
                {VERTS.map(v=><option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <span style={lbl}>Subvertical</span>
              <input value={sub} onChange={handleSubChange} placeholder="e.g. HOA mgmt"
                style={{ ...inp, borderColor: detecting ? `${C.goldBdr}55` : C.brdM, transition:"border-color 0.2s" }}/>
            </div>
            <div>
              <span style={lbl}>Stage</span>
              <select value={stage} onChange={e=>setStage(e.target.value)} style={{ ...inp, cursor:"pointer" }}>
                {DEAL_STAGES.map(s=><option key={s.id} value={s.id}>{s.id}</option>)}
              </select>
            </div>
          </div>
          <div>
            <span style={lbl}>Salesforce URL</span>
            <input value={sfdc} onChange={e=>setSfdc(e.target.value)} placeholder="https://your-org.lightning.force.com/lightning/r/Account/..." style={inp}/>
          </div>
          <div>
            <span style={lbl}>Handoff context — why is this qualified? what did they say?</span>
            <textarea
              value={ctx} onChange={e=>setCtx(e.target.value)}
              placeholder={"e.g. HOA management platform — collects dues via ACH, wants to reduce NSF fees and speed up bank verification at sign-up. Already qualified by NB rep, budget confirmed."}
              rows={4}
              style={{ ...inp, resize:"vertical", lineHeight:1.55, fontFamily:"inherit", fontSize:12 }}
            />
            <p style={{ ...mono, margin:"4px 0 0", fontSize:10, color:C.dim }}>This is sent directly to the scoring model — more context = better score</p>
          </div>
          {err && <p style={{ ...mono, margin:0, fontSize:11, color:C.red }}>{err}</p>}
          <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:4 }}>
            <button onClick={onClose} style={{ ...mono, fontSize:12, padding:"7px 16px", background:"transparent", border:`1px solid ${C.brd}`, color:C.mut, borderRadius:6, cursor:"pointer" }}>Cancel</button>
            <button onClick={submit} disabled={scoring||!name.trim()} style={{ ...mono, fontSize:12, padding:"7px 20px", background:scoring?C.sur:C.goldBg, border:`1px solid ${scoring?C.brd:C.goldBdr}`, color:scoring?C.dim:C.gold, borderRadius:6, cursor:scoring||!name.trim()?"not-allowed":"pointer", fontWeight:500 }}>
              {scoring ? "⬟ Scoring…" : "⬟ Score & Add"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DedupeModal({ accounts, onMerge, onClose }) {
  const pairs = useMemo(() => {
    const found = [];
    const seen = new Set();
    for (let i=0;i<accounts.length;i++) {
      for (let j=i+1;j<accounts.length;j++) {
        const a=accounts[i], b=accounts[j];
        const key=`${a.id}-${b.id}`;
        if (seen.has(key)) continue;
        const na = normAccountName(a.name);
        const nameMatch = na && na===normAccountName(b.name);
        const domA = a.web?normAccountDomain(a.web):null;
        const domB = b.web?normAccountDomain(b.web):null;
        const domMatch = domA && domB && domA===domB;
        if (nameMatch||domMatch) { found.push({a,b,reason:nameMatch?"name":"domain"}); seen.add(key); }
      }
    }
    return found;
  }, [accounts]); // eslint-disable-line react-hooks/exhaustive-deps

  const [resolving, setResolving] = useState(null);
  const TS_local = {Gold:{c:C.gold,bg:C.goldBg,b:C.goldBdr,i:"⭑"},Silver:{c:C.silver||"#94A3B8",bg:"#0A0C10",b:"#2A3040",i:"◈"},Tin:{c:C.tin,bg:C.sur,b:C.brd,i:"◇"},Slag:{c:C.dim,bg:C.bg,b:C.brd,i:"✕"}};
  const contextScore = scoreAccountContext;

  const AccCard = ({acc, onKeep, isRecommended}) => {
    const ts = TS_local[acc.tier]||{};
    const score = contextScore(acc);
    const checks = [
      [acc.analyzed,       "Scored by assay"],
      [acc.tier,           `Tier: ${acc.tier}`],
      [acc.pf,             "product fit written"],
      [acc.handoffNotes,   "Handoff notes"],
      [acc.sfdc,           "SFDC link"],
      [acc.web,            "Website"],
      [acc.prods?.length,  `${acc.prods?.length||0} products`],
      [acc.sigs?.length,   `${acc.sigs?.length||0} signals`],
    ].filter(([v])=>v);
    return (
      <div style={{flex:1,background:isRecommended?`${C.green}08`:C.bg,border:`1.5px solid ${isRecommended?C.green:C.brd}`,borderRadius:8,padding:"12px 14px",display:"flex",flexDirection:"column",gap:6}}>
        {isRecommended&&<div style={{...mono,fontSize:9,color:C.green,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:2}}>★ Recommended — more context</div>}
        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
          {acc.tier&&<span style={{...mono,fontSize:10,padding:"1px 6px",border:`1px solid ${ts.b||C.brd}`,borderRadius:3,color:ts.c,background:ts.bg}}>{ts.i} {acc.tier}</span>}
          <span style={{fontSize:13,fontWeight:500,color:C.txt}}>{acc.name}</span>
          <span style={{...mono,fontSize:9,color:isRecommended?C.green:C.dim,marginLeft:"auto"}}>{score}pts</span>
        </div>
        {acc.web&&<span style={{...mono,fontSize:11,color:C.blue}}>{acc.web}</span>}
        {acc.vert&&<span style={{...mono,fontSize:11,color:C.mut}}>{acc.vert}{acc.stage?` · ${acc.stage}`:""}</span>}
        {acc.pf&&<p style={{...mono,fontSize:10,color:C.dim,margin:0,lineHeight:1.5}}>{acc.pf.slice(0,100)}{acc.pf.length>100?"…":""}</p>}
        {acc.handoffNotes&&<p style={{...mono,fontSize:10,color:C.orange,margin:0}}>Notes: {acc.handoffNotes.slice(0,80)}{acc.handoffNotes.length>80?"…":""}</p>}
        <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:2}}>
          {checks.map(([,lb])=><span key={lb} style={{...mono,fontSize:9,padding:"1px 6px",background:C.card,border:`1px solid ${C.brd}`,borderRadius:3,color:C.dim}}>✓ {lb}</span>)}
        </div>
        <div style={{marginTop:"auto",paddingTop:8}}>
          <button onClick={onKeep} style={{...mono,fontSize:11,padding:"5px 14px",background:isRecommended?`${C.green}18`:C.goldBg,border:`1px solid ${isRecommended?C.green:C.goldBdr}`,color:isRecommended?C.green:C.gold,borderRadius:5,cursor:"pointer",width:"100%",fontWeight:500}}>
            {isRecommended?"★ Keep this one →":"Keep this one →"}
          </button>
        </div>
      </div>
    );
  };

  const doMerge = (keep, remove) => {
    const merged = {
      ...keep,
      web:          keep.web      || remove.web      || "",
      sfdc:         keep.sfdc     || remove.sfdc     || "",
      linkedin:     keep.linkedin || remove.linkedin || "",
      vert:         keep.vert     || remove.vert     || "",
      stage:        keep.stage    || remove.stage    || "Prospecting",
      tier:         keep.tier     || remove.tier     || null,
      score:        keep.score    || remove.score    || null,
      bm:           keep.bm       || remove.bm       || "",
      pf:           keep.pf       || remove.pf       || "",
      sigs:         (keep.sigs?.length ? keep.sigs : remove.sigs) || [],
      ucs:          (keep.ucs?.length  ? keep.ucs  : remove.ucs)  || [],
      prods:        (keep.prods?.length? keep.prods: remove.prods)|| [],
      analyzed:     keep.analyzed || remove.analyzed || false,
      handoffNotes: [keep.handoffNotes, remove.handoffNotes].filter(Boolean).join("\n\n---\n\n") || null,
    };
    onMerge(merged, remove.id);
    setResolving(null);
  };

  if (!pairs.length) return (
    <div style={{position:"fixed",inset:0,background:"#000000AA",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{width:380,background:C.sur,border:`1px solid ${C.brd}`,borderRadius:12,padding:"28px 32px",textAlign:"center"}}>
        <p style={{fontSize:22,marginBottom:8}}>✓</p>
        <p style={{fontSize:15,color:C.txt,marginBottom:6}}>No duplicates found</p>
        <p style={{...mono,fontSize:11,color:C.dim,marginBottom:20}}>Checked by name and website domain</p>
        <button onClick={onClose} style={{...mono,fontSize:12,padding:"7px 20px",background:C.card,border:`1px solid ${C.brd}`,color:C.mut,borderRadius:6,cursor:"pointer"}}>Close</button>
      </div>
    </div>
  );

  const cur = resolving || pairs[0];
  return (
    <div style={{position:"fixed",inset:0,background:"#000000AA",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{width:620,background:C.sur,border:`1px solid ${C.brd}`,borderRadius:12,padding:"24px 28px",boxShadow:"0 24px 64px #000000AA"}}>
        <div style={{display:"flex",alignItems:"center",marginBottom:16}}>
          <div>
            <p style={{margin:0,fontSize:15,fontWeight:500,color:C.txt}}>Merge Duplicates</p>
            <p style={{...mono,margin:"2px 0 0",fontSize:11,color:C.dim}}>{pairs.length} pair{pairs.length!==1?"s":""} found — matched by {cur.reason}</p>
          </div>
          <button onClick={onClose} style={{marginLeft:"auto",background:"none",border:"none",color:C.dim,fontSize:18,cursor:"pointer"}}>✕</button>
        </div>
        {pairs.length>1&&(
          <div style={{display:"flex",gap:5,marginBottom:14,flexWrap:"wrap"}}>
            {pairs.map((p,i)=>(
              <button key={i} onClick={()=>setResolving(p)}
                style={{...mono,fontSize:11,padding:"3px 10px",borderRadius:4,border:`1px solid ${resolving===p||(i===0&&!resolving)?C.blue:C.brd}`,background:"transparent",color:resolving===p||(i===0&&!resolving)?C.blue:C.dim,cursor:"pointer"}}>
                {p.a.name.slice(0,16)} / {p.b.name.slice(0,16)}
              </button>
            ))}
          </div>
        )}
        <p style={{...mono,fontSize:11,color:C.mut,marginBottom:10}}>Pick which to keep — missing fields from the removed one are automatically merged in.</p>
        {(()=>{
          const sA=contextScore(cur.a), sB=contextScore(cur.b);
          const rec = sA>sB?cur.a:sB>sA?cur.b:null;
          return rec?(
            <div style={{...mono,fontSize:11,color:C.green,padding:"6px 10px",background:`${C.green}0C`,border:`1px solid ${C.green}33`,borderRadius:6,marginBottom:10}}>
              ★ Suggesting <strong>{rec.name}</strong> — {Math.abs(sA-sB)} more context points ({rec===cur.a?sA:sB} vs {rec===cur.a?sB:sA})
            </div>
          ):null;
        })()}
        <div style={{display:"flex",gap:10,marginBottom:16}}>
          <AccCard acc={cur.a} isRecommended={contextScore(cur.a)>contextScore(cur.b)} onKeep={()=>doMerge(cur.a, cur.b)}/>
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",color:C.dim,fontSize:12,flexShrink:0}}>vs</div>
          <AccCard acc={cur.b} isRecommended={contextScore(cur.b)>contextScore(cur.a)} onKeep={()=>doMerge(cur.b, cur.a)}/>
        </div>
        <div style={{display:"flex",justifyContent:"flex-end"}}>
          <button onClick={onClose} style={{...mono,fontSize:12,padding:"6px 16px",background:"transparent",border:`1px solid ${C.brd}`,color:C.mut,borderRadius:6,cursor:"pointer"}}>Done</button>
        </div>
      </div>
    </div>
  );
}

export function SfdcImportModal({ opps, accounts, onImport, onClose }) {
  const [selected, setSelected] = useState(() => new Set(opps.map(o => o.sfdcOppId)));

  const statuses = useMemo(() => {
    const m = {};
    opps.forEach(o => {
      const nameMatch = accounts.some(a => normName(a.name) === normName(o.name));
      if (nameMatch) { m[o.sfdcOppId] = "exists"; return; }
      const d = normDomain(o.web);
      const domainMatch = d && accounts.some(a => normDomain(a.web) === d);
      m[o.sfdcOppId] = domainMatch ? "possible_dup" : "new";
    });
    return m;
  }, [opps, accounts]);

  const displayOpps = opps.filter(o => statuses[o.sfdcOppId] !== "exists");
  const selectedCount = [...selected].filter(id => displayOpps.some(o => o.sfdcOppId === id)).length;

  return (
    <div style={{ position:"fixed", inset:0, background:"#000000BB", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{ width:720, maxHeight:"80vh", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:12, padding:"24px 28px", boxShadow:"0 24px 64px #000c", display:"flex", flexDirection:"column" }}>
        <div style={{ display:"flex", alignItems:"center", marginBottom:16, flexShrink:0 }}>
          <p style={{ margin:0, fontSize:16, fontWeight:500, color:C.txt }}>Import from Salesforce</p>
          <span style={{ ...mono, fontSize:12, color:C.dim, marginLeft:8 }}>{displayOpps.length} open opportunit{displayOpps.length!==1?"ies":"y"}</span>
          <button onClick={onClose} style={{ marginLeft:"auto", background:"none", border:"none", color:C.dim, fontSize:18, cursor:"pointer", lineHeight:1 }}>✕</button>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"28px 1fr 110px 90px 110px 36px 40px", gap:8, padding:"5px 0", borderBottom:`1px solid ${C.brd}`, marginBottom:4, flexShrink:0 }}>
          {["","Account","SFDC Stage","Source","Website","IDs",""].map((h,i) => (
            <span key={i} style={{ ...mono, fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.07em" }}>{h}</span>
          ))}
        </div>
        <div style={{ overflowY:"auto", flex:1 }}>
          {displayOpps.map(opp => {
            const isDup = statuses[opp.sfdcOppId] === "possible_dup";
            const isChecked = selected.has(opp.sfdcOppId);
            return (
              <div key={opp.sfdcOppId} style={{ display:"grid", gridTemplateColumns:"28px 1fr 110px 90px 110px 36px 40px", gap:8, padding:"7px 0", borderBottom:`0.5px solid ${C.brd}22`, alignItems:"center" }}>
                <input type="checkbox" checked={isChecked} onChange={e=>{const n=new Set(selected);e.target.checked?n.add(opp.sfdcOppId):n.delete(opp.sfdcOppId);setSelected(n);}} style={{ cursor:"pointer" }}/>
                <div style={{ minWidth:0 }}>
                  <span style={{ ...mono, fontSize:13, color:C.txt, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", display:"block" }}>{opp.name}</span>
                  {isDup && <span style={{ ...mono, fontSize:9, color:C.orange }}>⚠ possible dup</span>}
                </div>
                <span style={{ ...mono, fontSize:11, color:C.dim }}>{opp.sfdcStage}</span>
                <span style={{ ...mono, fontSize:11, color:C.blue }}>{opp.source}</span>
                <span style={{ ...mono, fontSize:11, color:C.dim, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{opp.web||"—"}</span>
                <span style={{ ...mono, fontSize:11, color:C.dim, textAlign:"center" }}>{opp.clientIds?.length||0}</span>
                <div style={{ display:"flex", gap:3, flexWrap:"wrap" }}>
                  {opp.isHandoff&&<span style={{ ...mono, fontSize:9, color:C.gold, background:`${C.gold}14`, border:`1px solid ${C.gold}33`, borderRadius:3, padding:"1px 5px" }}>NBA</span>}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginTop:16, flexShrink:0 }}>
          <button onClick={()=>setSelected(new Set(displayOpps.map(o=>o.sfdcOppId)))} style={{ ...mono, fontSize:11, color:C.dim, background:"none", border:"none", cursor:"pointer", padding:0 }}>Select all</button>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={onClose} style={{ ...mono, fontSize:12, padding:"6px 14px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:5, cursor:"pointer" }}>Cancel</button>
            <button disabled={selectedCount===0} onClick={()=>onImport(displayOpps.filter(o=>selected.has(o.sfdcOppId)))}
              style={{ ...mono, fontSize:12, padding:"6px 14px", background:selectedCount>0?C.goldBg:"transparent", border:`1px solid ${selectedCount>0?C.goldBdr:C.brd}`, color:selectedCount>0?C.gold:C.dim, borderRadius:5, cursor:selectedCount>0?"pointer":"default" }}>
              Import {selectedCount} selected →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
