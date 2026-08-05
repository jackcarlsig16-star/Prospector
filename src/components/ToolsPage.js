import { useState } from "react";
import { C, mono } from '../constants/colors';
import { getActiveIntel, getActiveExamples } from '../utils/assay';
import { PROD_COLOR } from '../constants/products';
import DealWorkspace from './DealWorkspace';
import EmailSystemPage from './EmailGenerator';
import BlueprintTool from './pricing/BlueprintTool';

// ─── Lookalike Finder ────────────────────────────────────────────────────────
function LookalikeTool({ accounts=[], pool=[] }) {
  const [query, setQuery] = useState("");
  const [ref, setRef] = useState(null);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(null);

  // Accounts eligible as reference: analyzed, non-Slag preferred
  const analyzed = accounts.filter(a => a.tier && a.score);
  const searchFiltered = query.trim()
    ? analyzed.filter(a => a.name.toLowerCase().includes(query.toLowerCase()))
    : analyzed.sort((a, b) => (a.score||9) - (b.score||9)).slice(0, 12);

  // Similarity scoring against existing territory + pool
  const scoreMatch = (candidate, r) => {
    let score = 0;
    if (candidate.vert && r.vert && candidate.vert.toLowerCase() === r.vert.toLowerCase()) score += 4;
    const refUcs = r.ucs || [];
    const candUcs = candidate.ucs || [];
    score += candUcs.filter(u => refUcs.includes(u)).length * 3;
    const refProds = r.prods || [];
    const candProds = candidate.prods || [];
    score += candProds.filter(p => refProds.includes(p)).length * 2;
    if (candidate.tier === r.tier) score += 2;
    else if ((candidate.score||9) <= (r.score||9) + 1) score += 1;
    return score;
  };

  const territoryMatches = ref
    ? accounts
        .filter(a => a.id !== ref.id && a.tier && a.score)
        .map(a => ({ ...a, _sim: scoreMatch(a, ref) }))
        .filter(a => a._sim >= 4)
        .sort((a, b) => b._sim - a._sim)
        .slice(0, 5)
    : [];

  const poolMatches = ref
    ? pool
        .filter(a => a.tier && a.score)
        .map(a => ({ ...a, _sim: scoreMatch(a, ref) }))
        .filter(a => a._sim >= 3)
        .sort((a, b) => b._sim - a._sim)
        .slice(0, 5)
    : [];

  const findLookalikes = async () => {
    if (!ref) return;
    setLoading(true); setSuggestions(null); setError(null);
    try {
      const res = await fetch("/api/lookalike", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: ref, customIntel: getActiveIntel(), exampleAccts: getActiveExamples() }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setError(data.error || "Failed"); return; }
      setSuggestions(data.suggestions || []);
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  const TS2 = { Gold: { c: C.gold, bg: C.goldBg, b: C.goldBdr }, Silver: { c: C.silver, bg: C.silverBg, b: C.silverBdr }, Tin: { c: C.tin, bg: C.tinBg, b: C.tinBdr }, Slag: { c: C.slag, bg: C.slagBg, b: C.slagBdr } };

  const SuggestionCard = ({ s, inTerritory, inPool, isNew }) => {
    const ts = TS2[s.tier] || TS2.Tin;
    return (
      <div style={{ padding:"10px 14px", background:C.card, border:`1px solid ${inTerritory||inPool?C.brd:ts.b+"66"}`, borderRadius:7, display:"flex", flexDirection:"column", gap:5 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontWeight:500, fontSize:14, color:C.txt, flex:1 }}>{s.name}</span>
          {s.tier&&<span style={{ ...mono, fontSize:10, color:ts.c, background:ts.bg, border:`1px solid ${ts.b}`, borderRadius:3, padding:"1px 6px" }}>{s.tier}</span>}
          {inTerritory&&<span style={{ ...mono, fontSize:10, color:C.green, background:`${C.green}14`, border:`1px solid ${C.green}44`, borderRadius:3, padding:"1px 6px" }}>In territory</span>}
          {inPool&&!inTerritory&&<span style={{ ...mono, fontSize:10, color:C.tin, background:C.tinBg, border:`1px solid ${C.tinBdr}`, borderRadius:3, padding:"1px 6px" }}>In pool</span>}
          {isNew&&<span style={{ ...mono, fontSize:10, color:C.purple, background:`${C.purple}14`, border:`1px solid ${C.purple}44`, borderRadius:3, padding:"1px 6px" }}>New prospect</span>}
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          {s.web&&<span style={{ ...mono, fontSize:11, color:C.dim }}>{s.web}</span>}
          {s.vert&&<span style={{ ...mono, fontSize:11, color:C.mut }}>{s.vert}</span>}
          {s.hq&&<span style={{ ...mono, fontSize:11, color:C.dim }}>{s.hq}</span>}
        </div>
        {s.why&&<p style={{ margin:0, fontSize:13, color:C.mut, lineHeight:1.5 }}>{s.why}</p>}
        {s.products?.length>0&&(
          <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
            {s.products.map(p=><span key={p} style={{ ...mono, fontSize:10, color:PROD_COLOR[p]||C.dim, background:C.bg, border:`1px solid ${C.brd}`, borderRadius:3, padding:"1px 5px" }}>{p}</span>)}
          </div>
        )}
        {isNew&&s.web&&(
          <div style={{ display:"flex", gap:6, marginTop:2 }}>
            <button onClick={()=>{const row=`${s.name},${s.web},,${s.vert||""},,`;navigator.clipboard.writeText(row).then(()=>{setCopied(s.name);setTimeout(()=>setCopied(null),1800);});}} style={{ ...mono, fontSize:11, padding:"2px 9px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:4, cursor:"pointer" }}>{copied===s.name?"✓ Copied":"Copy to add"}</button>
            {s.web&&<a href={`https://${s.web.replace(/^https?:\/\//,"")}`} target="_blank" rel="noreferrer" style={{ ...mono, fontSize:11, padding:"2px 9px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:4, cursor:"pointer", textDecoration:"none" }}>↗ Site</a>}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ maxWidth:900 }}>
      <div style={{ marginBottom:20 }}>
        <h3 style={{ margin:"0 0 4px", fontSize:17, fontWeight:600, color:C.txt }}>Account Lookalike</h3>
        <p style={{ margin:0, fontSize:13, color:C.mut }}>Pick a strong account and find 10 companies just like it — from your territory, the pool, and net-new prospects.</p>
      </div>

      {/* Reference picker */}
      <div style={{ marginBottom:20 }}>
        <p style={{ ...mono, margin:"0 0 8px", fontSize:11, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>Reference account</p>
        {ref ? (
          <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", background:C.goldBg, border:`1px solid ${C.goldBdr}`, borderRadius:8 }}>
            <div style={{ flex:1 }}>
              <p style={{ margin:"0 0 2px", fontWeight:600, fontSize:15, color:C.gold }}>{ref.name}</p>
              <p style={{ ...mono, margin:0, fontSize:11, color:C.dim }}>{ref.vert||"—"} · {ref.tier||"—"} · {ref.prods?.slice(0,3).join(", ")||"no products"}</p>
            </div>
            <button onClick={()=>{setRef(null);setSuggestions(null);setError(null);}} style={{ ...mono, fontSize:12, padding:"4px 10px", background:"transparent", border:`1px solid ${C.goldBdr}`, color:C.gold, borderRadius:5, cursor:"pointer" }}>Change</button>
            <button onClick={findLookalikes} disabled={loading} style={{ ...mono, fontSize:13, padding:"6px 18px", background:loading?"transparent":C.gold, border:`1px solid ${C.gold}`, color:loading?C.gold:C.bg, borderRadius:5, cursor:loading?"default":"pointer", fontWeight:700 }}>
              {loading ? "Finding…" : "◈ Find Lookalikes →"}
            </button>
          </div>
        ) : (
          <div>
            <input
              autoFocus
              placeholder="Search accounts… (e.g. Mighty)"
              value={query}
              onChange={e=>setQuery(e.target.value)}
              style={{ ...mono, width:"100%", boxSizing:"border-box", fontSize:13, padding:"8px 12px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:6, color:C.txt, outline:"none", marginBottom:8 }}
            />
            <div style={{ display:"flex", flexDirection:"column", gap:4, maxHeight:280, overflowY:"auto" }}>
              {searchFiltered.length===0&&<p style={{ ...mono, fontSize:12, color:C.dim, margin:0 }}>No analyzed accounts found. Run an assay first.</p>}
              {searchFiltered.map(a=>{
                const ts=TS2[a.tier]||TS2.Tin;
                return (
                  <div key={a.id} onClick={()=>{setRef(a);setQuery("");setSuggestions(null);setError(null);}} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:6, cursor:"pointer" }}
                    onMouseEnter={e=>e.currentTarget.style.borderColor=ts.b}
                    onMouseLeave={e=>e.currentTarget.style.borderColor=C.brd}>
                    <span style={{ ...mono, fontSize:10, color:ts.c, background:ts.bg, border:`1px solid ${ts.b}`, borderRadius:3, padding:"1px 6px", flexShrink:0 }}>{a.tier}</span>
                    <span style={{ fontSize:14, color:C.txt, fontWeight:500, flex:1 }}>{a.name}</span>
                    <span style={{ ...mono, fontSize:11, color:C.dim }}>{a.vert||"—"}</span>
                    <span style={{ ...mono, fontSize:11, color:C.dim }}>{a.prods?.slice(0,2).join(", ")||""}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {error&&<div style={{ ...mono, fontSize:12, color:C.red, padding:"8px 12px", background:"#1a0000", border:`1px solid ${C.red}44`, borderRadius:6, marginBottom:16 }}>✕ {error}</div>}

      {/* Results */}
      {ref&&(territoryMatches.length>0||poolMatches.length>0||suggestions)&&(
        <div style={{ display:"flex", flexDirection:"column", gap:20 }}>

          {/* Territory matches */}
          {territoryMatches.length>0&&(
            <div>
              <p style={{ ...mono, margin:"0 0 8px", fontSize:10, color:C.green, textTransform:"uppercase", letterSpacing:"0.08em" }}>● Already in your territory ({territoryMatches.length})</p>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {territoryMatches.map(a=><SuggestionCard key={a.id} s={{name:a.name,web:a.web,vert:a.vert,tier:a.tier,why:a.pf||a.bm,products:a.prods,hq:a.state}} inTerritory={true}/>)}
              </div>
            </div>
          )}

          {/* Pool matches */}
          {poolMatches.length>0&&(
            <div>
              <p style={{ ...mono, margin:"0 0 8px", fontSize:10, color:C.tin, textTransform:"uppercase", letterSpacing:"0.08em" }}>◎ Similar accounts in the pool ({poolMatches.length})</p>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {poolMatches.map(a=><SuggestionCard key={a.id} s={{name:a.name,web:a.web,vert:a.vert,tier:a.tier,why:a.pf||a.bm,products:a.prods,hq:a.state}} inPool={true}/>)}
              </div>
            </div>
          )}

          {/* AI suggestions */}
          {suggestions&&(
            <div>
              <p style={{ ...mono, margin:"0 0 8px", fontSize:10, color:C.purple, textTransform:"uppercase", letterSpacing:"0.08em" }}>◈ Net-new prospects ({suggestions.length})</p>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {suggestions.map((s,i)=>{
                  const inT=accounts.some(a=>a.name.toLowerCase()===s.name.toLowerCase());
                  const inP=pool.some(a=>a.name.toLowerCase()===s.name.toLowerCase());
                  return <SuggestionCard key={i} s={s} inTerritory={inT} inPool={inP&&!inT} isNew={!inT&&!inP}/>;
                })}
              </div>
            </div>
          )}

          {loading&&!suggestions&&(
            <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:120 }}>
              <span style={{ ...mono, fontSize:13, color:C.purple }}>◈ Analyzing {ref.name}'s profile and finding similar companies…</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Salesforce Tools Page ────────────────────────────────────────────────────
function SalesforceToolsPage() {
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const sfdcConnected = !!localStorage.getItem("sfdc_access_token");

  const handleRun = async () => {
    if(!prompt.trim()) return;
    setLoading(true);
    await new Promise(r=>setTimeout(r,600));
    setResult({ prompt, message:"Salesforce AI Tools are actively being wired — your prompt has been noted. This will execute real SFDC queries soon." });
    setLoading(false);
  };

  return (
    <div>
      <div style={{ marginBottom:16 }}>
        <p style={{ margin:"0 0 4px", fontSize:20, fontWeight:500, color:C.txt }}>☁ Salesforce Tools</p>
        <p style={{ ...mono, margin:0, fontSize:12, color:C.dim }}>AI-powered queries and actions on your connected Salesforce org</p>
      </div>

      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 12px", background:sfdcConnected?`${C.green}0a`:`${C.orange}0a`, border:`1px solid ${sfdcConnected?C.green:C.orange}33`, borderRadius:7, marginBottom:16, width:"fit-content" }}>
        <span style={{ width:6, height:6, borderRadius:"50%", background:sfdcConnected?C.green:C.orange, display:"inline-block", flexShrink:0 }}/>
        <span style={{ ...mono, fontSize:12, color:sfdcConnected?C.green:C.orange }}>{sfdcConnected?"Salesforce connected":"Not connected — link via Settings → Salesforce"}</span>
      </div>

      <div style={{ padding:"14px 16px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:8, marginBottom:12 }}>
        <p style={{ ...mono, margin:"0 0 8px", fontSize:11, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>Freeform prompt</p>
        <textarea value={prompt} onChange={e=>setPrompt(e.target.value)}
          placeholder={"Examples:\n• Show me all open opportunities over $50k in my territory\n• Which accounts haven't been touched in 30 days?\n• Create a follow-up task for Acme due Friday\n• Pull contact info for [Company]\n• Sync Prospector scores back to SFDC account fields"}
          style={{ width:"100%", height:140, fontSize:13, padding:"10px 12px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:6, color:C.txt, outline:"none", resize:"vertical", lineHeight:1.7, boxSizing:"border-box", fontFamily:"inherit" }}
        />
        <div style={{ display:"flex", gap:8, marginTop:8 }}>
          <button onClick={handleRun} disabled={!prompt.trim()||loading} style={{ padding:"8px 22px", background:loading?C.sur:C.goldBg, border:`1px solid ${loading?C.brd:C.goldBdr}`, color:loading?C.dim:C.gold, borderRadius:6, cursor:!prompt.trim()||loading?"not-allowed":"pointer", fontSize:13, fontWeight:500, opacity:!prompt.trim()?0.4:1 }}>
            {loading?"Running…":"▶ Run"}
          </button>
          {(prompt||result)&&<button onClick={()=>{setPrompt("");setResult(null);}} style={{ ...mono, fontSize:12, padding:"8px 12px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:6, cursor:"pointer" }}>Clear</button>}
        </div>
      </div>

      {result&&(
        <div style={{ padding:"12px 16px", background:`${C.blue}08`, border:`1px solid ${C.blue}22`, borderRadius:8, marginBottom:16 }}>
          <p style={{ ...mono, margin:"0 0 6px", fontSize:11, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>Result</p>
          <p style={{ margin:0, fontSize:14, color:C.txt }}>{result.message}</p>
        </div>
      )}

      <div style={{ marginTop:20 }}>
        <p style={{ ...mono, margin:"0 0 10px", fontSize:11, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>Ideas — coming soon</p>
        <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
          {["Query open opportunities and pipeline in your territory","Find accounts without a recent activity or touch","Create tasks and follow-up reminders","Pull contact details and org charts","Log call notes directly to Salesforce","Sync Prospector tier scores back to SFDC account fields","Surface accounts in Salesforce not yet in Prospector"].map(idea=>(
            <div key={idea} style={{ display:"flex", gap:8, alignItems:"center", padding:"6px 10px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:5 }}>
              <span style={{ color:C.dim, fontSize:11 }}>○</span>
              <span style={{ fontSize:13, color:C.mut }}>{idea}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Tools ────────────────────────────────────────────────────────────────────
function ToolsPage({ accounts=[], pool=[], launchAccountId=null, onLaunched, activeTool="deal", onToolSelect, onCreateTask }) {
  const TOOLS = [
    { id:"deal",       lb:"Deal Workspace",       ic:"$"  },
    { id:"lookalike",  lb:"Account Lookalike",    ic:"◈"  },
    { id:"email",      lb:"Email System",         ic:"✉"  },
    { id:"blueprints", lb:"Deck Blueprints",      ic:"📊" },
    { id:"sfdc",       lb:"Salesforce Tools",     ic:"☁"  },
  ];
  // Map legacy "pricing"/"roi" tool IDs to the new "deal" entry point
  const active = (activeTool==="pricing"||activeTool==="roi") ? "deal" : (activeTool || "deal");
  const setActive = t => { if(onToolSelect) onToolSelect(t); };
  return (
    <div style={{ padding:24, maxWidth:1440, margin:"0 auto" }}>
      {/* Tool tab bar */}
      <div style={{ display:"flex", gap:4, marginBottom:20, borderBottom:`1px solid ${C.brd}` }}>
        {TOOLS.map(t => (
          <button key={t.id} onClick={() => setActive(t.id)}
            style={{ ...mono, fontSize:13, padding:"7px 18px", background:"transparent", border:"none", borderBottom: active===t.id ? `2px solid ${C.gold}` : "2px solid transparent", color: active===t.id ? C.gold : C.mut, cursor:"pointer", marginBottom:-1 }}>
            {t.ic} {t.lb}
          </button>
        ))}
      </div>
      {active === "deal"       && <DealWorkspace accounts={accounts} onCreateTask={onCreateTask} launchAccountId={launchAccountId} onLaunched={onLaunched}/>}
      {active === "lookalike"  && <LookalikeTool accounts={accounts} pool={pool}/>}
      {active === "email"      && <EmailSystemPage accounts={accounts} pool={pool}/>}
      {active === "blueprints" && <BlueprintTool accounts={accounts}/>}
      {active === "sfdc"       && <SalesforceToolsPage/>}
    </div>
  );
}

export default ToolsPage;
