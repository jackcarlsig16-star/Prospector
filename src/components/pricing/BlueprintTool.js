import React, { useState, useMemo } from 'react';
import { C, mono } from '../../constants/colors';
import { generateBlueprintTSV } from '../../utils/blueprintExport';
import { PRICING_PRODUCTS_DEFAULT } from '../../constants/products';

export const BLUEPRINT_KEY = "prospector_deck_blueprints";
export const loadBlueprints = () => {
  try { return JSON.parse(localStorage.getItem(BLUEPRINT_KEY)||"[]"); } catch { return []; }
};
const saveBlueprints = (bps) => {
  try { localStorage.setItem(BLUEPRINT_KEY, JSON.stringify(bps)); } catch {}
};

const BLANK_BP = {
  name:"", description:"",
  sections:{ traffic:true, products:true, savings:true },
  config:{
    traffic:{ unitLabel:"New Verifications", notes:"" },
    savings:{ commitmentLabel:"$4,000/mo API Commitment" },
  },
};

export const DEFAULT_BLUEPRINTS = [
  {
    id:"bp_adam",
    name:"Adam's Pricing Deck",
    description:"IDV/AML deal — traffic projection, product table, savings comparison with $4k commit",
    createdBy:"AE",
    sections:{ traffic:true, products:true, savings:true },
    config:{
      traffic:{ unitLabel:"New Verifications", notes:"" },
      savings:{ commitmentLabel:"$4,000/mo API Commitment" },
    },
  },
];

// Load a pricing session from localStorage for a given account ID
function loadPricingSession(accId) {
  try {
    const files = JSON.parse(localStorage.getItem("prospector_pricing_files") || "{}");
    const src = accId ? (files[accId] || {}) : {};
    const s = src.startUsers ?? 500;
    const e = src.endUsers   ?? 5000;
    const monthlyUsers = src.monthlyUsers?.length === 12 ? src.monthlyUsers
      : Array.from({length:12}, (_,i) => Math.round(s + (e-s)*i/11));
    const base = src.products?.length ? src.products
      : PRICING_PRODUCTS_DEFAULT.map(p => ({ ...p, custom: p.rack }));
    return {
      products: base,
      monthlyUsers,
      avgAccounts:     src.avgAccounts  ?? 2.5,
      onDemand:        src.onDemand     ?? 0,
      commitFee:       src.commitFee    ?? 0,
      commitRamp:      src.commitRamp   ?? false,
      commitRampSched: src.commitRampSched ?? Array(12).fill(0),
    };
  } catch { return null; }
}

function BlueprintTool({ accounts = [] }) {
  const [blueprints, setBlueprints] = useState(() => {
    const saved = loadBlueprints();
    if (!saved.length) { saveBlueprints(DEFAULT_BLUEPRINTS); return DEFAULT_BLUEPRINTS; }
    return saved;
  });
  const [editing, setEditing] = useState(null); // null = list view, {} = new, {id,...} = edit
  const [form, setForm] = useState(BLANK_BP);

  // ── Extract state ──────────────────────────────────────────────────────────
  const [selectedAccId,  setSelectedAccId]  = useState("");
  const [selectedBpId,   setSelectedBpId]   = useState("");
  const [accSearch,      setAccSearch]       = useState("");
  const [accDropOpen,    setAccDropOpen]     = useState(false);
  const [extracted,      setExtracted]       = useState(false);

  const filteredAccs = useMemo(() => {
    const q = accSearch.toLowerCase();
    return accounts.filter(a => !q || a.name.toLowerCase().includes(q)).slice(0, 12);
  }, [accounts, accSearch]);

  const selectedAcc = accounts.find(a => a.id === selectedAccId) || null;
  const selectedBp  = blueprints.find(b => b.id === selectedBpId) || null;

  const hasPricing = (accId) => {
    try { return !!JSON.parse(localStorage.getItem("prospector_pricing_files")||"{}")[accId]; } catch { return false; }
  };

  const handleExtract = () => {
    if (!selectedBp || !selectedAccId) return;
    const session = loadPricingSession(selectedAccId);
    if (!session) return;
    const tsv = generateBlueprintTSV(selectedBp, session);
    navigator.clipboard.writeText(tsv).then(() => {
      setExtracted(true);
      setTimeout(() => setExtracted(false), 3000);
    });
  };

  const upd = (path, val) => {
    setForm(f => {
      const next = JSON.parse(JSON.stringify(f));
      const keys = path.split(".");
      let cur = next;
      for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]];
      cur[keys[keys.length - 1]] = val;
      return next;
    });
  };

  const openNew = () => { setForm(JSON.parse(JSON.stringify(BLANK_BP))); setEditing({}); };
  const openEdit = (bp) => { setForm(JSON.parse(JSON.stringify(bp))); setEditing(bp); };

  const save = () => {
    if (!form.name.trim()) return;
    const bp = { ...form, name: form.name.trim(), id: editing?.id || `bp_${Date.now()}`, createdBy: editing?.createdBy || "AE" };
    const next = editing?.id ? blueprints.map(b => b.id === editing.id ? bp : b) : [...blueprints, bp];
    setBlueprints(next); saveBlueprints(next); setEditing(null);
  };

  const remove = (id) => {
    const next = blueprints.filter(b => b.id !== id);
    setBlueprints(next); saveBlueprints(next);
  };

  const INP = { fontSize:13, padding:"6px 10px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:5, color:C.txt, outline:"none", width:"100%", boxSizing:"border-box" };
  const LBL = { ...mono, fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4, display:"block" };
  const SEC_COLOR = { traffic:C.blue, products:C.gold, savings:C.green };

  if (editing !== null) {
    return (
      <div style={{ maxWidth:560 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:20 }}>
          <button onClick={()=>setEditing(null)}
            style={{ ...mono, fontSize:11, background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:4, padding:"3px 10px", cursor:"pointer" }}>← Back</button>
          <span style={{ ...mono, fontSize:13, color:C.txt }}>{editing?.id ? "Edit Blueprint" : "New Blueprint"}</span>
        </div>

        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          {/* Name + description */}
          <div>
            <span style={LBL}>Blueprint Name</span>
            <input value={form.name} onChange={e=>upd("name",e.target.value)} placeholder="e.g. Adam's Pricing Deck" style={INP}/>
          </div>
          <div>
            <span style={LBL}>Description</span>
            <input value={form.description} onChange={e=>upd("description",e.target.value)} placeholder="Short note on when to use this" style={INP}/>
          </div>

          {/* Section toggles */}
          <div>
            <span style={LBL}>Sections to include</span>
            <div style={{ display:"flex", gap:8 }}>
              {[
                { key:"traffic", label:"📈 Traffic / Volume" },
                { key:"products", label:"📋 Products Table" },
                { key:"savings", label:"💰 Savings Page" },
              ].map(({ key, label }) => {
                const on = form.sections[key];
                const col = SEC_COLOR[key];
                return (
                  <button key={key} onClick={()=>upd(`sections.${key}`,!on)}
                    style={{ ...mono, fontSize:11, padding:"5px 12px", background:on?`${col}18`:"transparent",
                      border:`1px solid ${on?col+"66":C.brd}`, color:on?col:C.mut, borderRadius:5, cursor:"pointer", fontWeight:on?600:400 }}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Traffic config */}
          {form.sections.traffic && (
            <div style={{ padding:"12px 14px", background:`${C.blue}08`, border:`1px solid ${C.blue}22`, borderRadius:6 }}>
              <span style={{ ...mono, fontSize:10, color:C.blue, textTransform:"uppercase", letterSpacing:"0.08em", display:"block", marginBottom:10 }}>Traffic Section Config</span>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                <div>
                  <span style={LBL}>Unit Label (what to call each row)</span>
                  <input value={form.config.traffic.unitLabel} onChange={e=>upd("config.traffic.unitLabel",e.target.value)} placeholder="New Verifications" style={INP}/>
                </div>
                <div>
                  <span style={LBL}>Pre-filled Notes</span>
                  <textarea value={form.config.traffic.notes} onChange={e=>upd("config.traffic.notes",e.target.value)} placeholder="Optional notes that appear at the bottom of the traffic section" rows={2}
                    style={{ ...INP, resize:"vertical", fontFamily:"inherit" }}/>
                </div>
              </div>
            </div>
          )}

          {/* Savings config */}
          {form.sections.savings && (
            <div style={{ padding:"12px 14px", background:`${C.green}08`, border:`1px solid ${C.green}22`, borderRadius:6 }}>
              <span style={{ ...mono, fontSize:10, color:C.green, textTransform:"uppercase", letterSpacing:"0.08em", display:"block", marginBottom:10 }}>Savings Section Config</span>
              <div>
                <span style={LBL}>Commitment Tier Label</span>
                <input value={form.config.savings.commitmentLabel} onChange={e=>upd("config.savings.commitmentLabel",e.target.value)} placeholder="$4,000/mo API Commitment" style={INP}/>
                <span style={{ ...mono, fontSize:10, color:C.dim, marginTop:4, display:"block" }}>This is the column header in the savings comparison table</span>
              </div>
            </div>
          )}

          <div style={{ display:"flex", gap:8, paddingTop:4 }}>
            <button onClick={save} disabled={!form.name.trim()}
              style={{ ...mono, fontSize:12, padding:"7px 20px", background:`${C.gold}18`, border:`1px solid ${C.gold}55`, color:C.gold, borderRadius:5, cursor:"pointer", fontWeight:600 }}>
              Save Blueprint
            </button>
            <button onClick={()=>setEditing(null)}
              style={{ ...mono, fontSize:12, padding:"7px 14px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:5, cursor:"pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  const canExtract = selectedAccId && selectedBpId;

  return (
    <div>
      {/* ── Extract panel ─────────────────────────────────────────────────── */}
      <div style={{ padding:"16px 20px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:10, marginBottom:24 }}>
        <p style={{ ...mono, margin:"0 0 14px", fontSize:11, color:C.gold, textTransform:"uppercase", letterSpacing:"0.1em", fontWeight:700 }}>📊 Extract to Spreadsheet</p>

        <div style={{ display:"flex", gap:12, alignItems:"flex-start", flexWrap:"wrap" }}>
          {/* Account selector */}
          <div style={{ flex:"1 1 220px", minWidth:0 }}>
            <span style={LBL}>Deal / Account</span>
            <div style={{ position:"relative" }}>
              <input
                value={accSearch || selectedAcc?.name || ""}
                onChange={e=>{ setAccSearch(e.target.value); setSelectedAccId(""); setAccDropOpen(true); }}
                onFocus={()=>setAccDropOpen(true)}
                onBlur={()=>setTimeout(()=>setAccDropOpen(false),160)}
                placeholder="Search accounts…"
                style={{ ...INP, paddingRight:28 }}
              />
              {selectedAcc && <span style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%)", ...mono, fontSize:9, color:hasPricing(selectedAccId)?C.gold:C.dim }}>{hasPricing(selectedAccId)?"● pricing":"○ no pricing"}</span>}
              {accDropOpen && filteredAccs.length > 0 && (
                <div style={{ position:"absolute", top:"calc(100% + 3px)", left:0, right:0, background:C.card, border:`1px solid ${C.brd}`, borderRadius:6, zIndex:200, maxHeight:200, overflowY:"auto" }}>
                  {filteredAccs.map(a=>(
                    <div key={a.id} onMouseDown={()=>{ setSelectedAccId(a.id); setAccSearch(""); setAccDropOpen(false); }}
                      style={{ padding:"7px 12px", cursor:"pointer", display:"flex", alignItems:"center", gap:8, background:"transparent" }}
                      onMouseEnter={e=>e.currentTarget.style.background=C.sur}
                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      <span style={{ fontSize:13, color:C.txt, flex:1 }}>{a.name}</span>
                      {hasPricing(a.id)&&<span style={{ ...mono, fontSize:9, color:C.gold }}>● pricing</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Blueprint selector */}
          <div style={{ flex:"1 1 200px", minWidth:0 }}>
            <span style={LBL}>Blueprint</span>
            <select value={selectedBpId} onChange={e=>setSelectedBpId(e.target.value)}
              style={{ ...INP, cursor:"pointer", color:selectedBpId?C.txt:C.dim }}>
              <option value="">Select blueprint…</option>
              {blueprints.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>

          {/* Extract button */}
          <div style={{ paddingTop:22 }}>
            <button onClick={handleExtract} disabled={!canExtract}
              style={{ ...mono, fontSize:13, padding:"8px 22px", fontWeight:600,
                background: extracted ? `${C.green}22` : canExtract ? `${C.gold}18` : "transparent",
                border: `1px solid ${extracted ? C.green : canExtract ? C.gold+"66" : C.brd}`,
                color: extracted ? C.green : canExtract ? C.gold : C.dim,
                borderRadius:6, cursor:canExtract?"pointer":"not-allowed", transition:"all 0.15s", whiteSpace:"nowrap" }}>
              {extracted ? "✓ Copied to clipboard" : "⬇ Extract TSV"}
            </button>
          </div>
        </div>

        {extracted && (
          <p style={{ ...mono, margin:"10px 0 0", fontSize:11, color:C.green }}>
            Paste into Google Sheets — sections are separated by blank rows for easy sheet splitting.
          </p>
        )}
        {selectedAccId && !hasPricing(selectedAccId) && (
          <p style={{ ...mono, margin:"10px 0 0", fontSize:11, color:C.orange }}>
            No pricing saved for {selectedAcc?.name} yet — open their pricing page first to configure and save a session.
          </p>
        )}
      </div>

      {/* ── Blueprint list ─────────────────────────────────────────────────── */}
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
        <span style={{ ...mono, fontSize:11, color:C.dim, flex:1 }}>Manage blueprints</span>
        <button onClick={openNew}
          style={{ ...mono, fontSize:12, padding:"5px 12px", background:`${C.gold}18`, border:`1px solid ${C.gold}55`, color:C.gold, borderRadius:5, cursor:"pointer", fontWeight:600 }}>
          + New Blueprint
        </button>
      </div>

      {blueprints.length === 0 && (
        <p style={{ ...mono, fontSize:13, color:C.dim }}>No blueprints yet.</p>
      )}

      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {blueprints.map(bp => (
          <div key={bp.id} style={{ padding:"12px 16px", background:C.card, border:`1px solid ${selectedBpId===bp.id?C.gold:C.brd}`, borderRadius:8, display:"flex", alignItems:"center", gap:12, cursor:"pointer" }}
            onClick={()=>setSelectedBpId(bp.id===selectedBpId?"":bp.id)}>
            <div style={{ flex:1, minWidth:0 }}>
              <p style={{ margin:"0 0 2px", fontSize:13, color:selectedBpId===bp.id?C.gold:C.txt, fontWeight:selectedBpId===bp.id?600:500 }}>{bp.name}</p>
              <p style={{ ...mono, margin:"0 0 6px", fontSize:11, color:C.mut }}>{bp.description||"—"}</p>
              <div style={{ display:"flex", gap:5 }}>
                {[
                  { key:"traffic", label:"📈 Traffic", col:C.blue },
                  { key:"products", label:"📋 Products", col:C.gold },
                  { key:"savings", label:"💰 Savings", col:C.green },
                ].filter(s=>bp.sections[s.key]).map(s=>(
                  <span key={s.key} style={{ ...mono, fontSize:9, padding:"1px 7px", background:`${s.col}14`, border:`1px solid ${s.col}44`, color:s.col, borderRadius:3 }}>{s.label}</span>
                ))}
              </div>
            </div>
            <button onClick={e=>{ e.stopPropagation(); openEdit(bp); }}
              style={{ ...mono, fontSize:11, padding:"4px 10px", background:"transparent", border:`1px solid ${C.brd}`, color:C.mut, borderRadius:4, cursor:"pointer" }}>Edit</button>
            <button onClick={e=>{ e.stopPropagation(); remove(bp.id); }}
              style={{ ...mono, fontSize:11, padding:"4px 10px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:4, cursor:"pointer" }}>Remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default BlueprintTool;
