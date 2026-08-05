import { useState, useRef, useEffect } from 'react';
import { C, mono, TS } from '../../constants/colors';
import { getCurrentQuarter } from '../../utils/ledgerEngine';

const QUARTER_MONTHS = { Q1:[0,1,2], Q2:[3,4,5], Q3:[6,7,8], Q4:[9,10,11] };

const fmtAcv = (v) => {
  if (v == null) return null;
  return "$" + Math.round(v).toLocaleString();
};

const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`;
};

const toInputDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toISOString().slice(0, 10);
};

function AcvCell({ value, onCommit }) {
  const [editing, setEditing]   = useState(false);
  const [draft,   setDraft]     = useState("");
  const [flashing, setFlashing] = useState(false);
  const inputRef = useRef(null);

  const startEdit = () => {
    setDraft(value != null ? String(value) : "");
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const commit = () => {
    const raw = draft.replace(/[$,\s]/g, "");
    const n   = parseFloat(raw);
    if (!isNaN(n)) {
      onCommit(n);
      setFlashing(true);
      setTimeout(() => setFlashing(false), 1000);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        style={{ ...mono, fontSize:11, width:90, padding:"2px 5px", background:"#111", border:"1px solid #22c55e55", color:"#22c55e", borderRadius:3, outline:"none" }}
      />
    );
  }

  const isNull = value == null;
  return (
    <span
      onClick={startEdit}
      title="Click to edit"
      style={{
        ...mono, fontSize:11,
        color:      isNull ? "#f59e0b" : flashing ? "#22c55e" : C.txt,
        background: isNull ? "#f59e0b08" : flashing ? "#22c55e12" : "transparent",
        borderBottom: `1px solid ${isNull ? "#f59e0b55" : "#f59e0b33"}`,
        padding:"1px 2px", cursor:"pointer",
        transition:"color 0.3s, background 0.3s",
        display:"inline-block",
      }}
    >
      {isNull ? "—" : fmtAcv(value)}
      {isNull && <span style={{ fontSize:9, color:"#f59e0b", marginLeft:4 }}>⚠ Set</span>}
    </span>
  );
}

function DateCell({ iso, onCommit }) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef(null);

  const startEdit = () => {
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const commit = (val) => {
    if (val) onCommit(new Date(val + "T12:00:00").toISOString());
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="date"
        defaultValue={toInputDate(iso)}
        onBlur={e => commit(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") commit(e.target.value); if (e.key === "Escape") setEditing(false); }}
        style={{ ...mono, fontSize:11, padding:"2px 5px", background:"#111", border:"1px solid #22c55e55", color:"#22c55e", borderRadius:3, outline:"none", colorScheme:"dark" }}
      />
    );
  }

  return (
    <span
      onClick={startEdit}
      title="Click to edit"
      style={{ ...mono, fontSize:11, color:C.txt, borderBottom:"1px solid transparent", padding:"1px 2px", cursor:"pointer", transition:"border-color 0.2s" }}
      onMouseEnter={e => { e.currentTarget.style.borderBottomColor = "#f59e0b55"; }}
      onMouseLeave={e => { e.currentTarget.style.borderBottomColor = "transparent"; }}
    >
      {fmtDate(iso)}
    </span>
  );
}

export default function ClosedWonAuditModal({ winsLog, setWinsLog, accounts = [], onClose }) {
  const currentQ = getCurrentQuarter();
  const [selectedQ,  setSelectedQ]  = useState(currentQ);
  const [addingRow,  setAddingRow]  = useState(false);
  const [newRow,     setNewRow]     = useState({ accountName:"", closedAt:"", acv:"" });
  const [acctSuggest, setAcctSuggest] = useState([]);

  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const filteredWins = winsLog
    .filter(w => {
      if (!w.closedAt) return selectedQ === currentQ;
      const month = new Date(w.closedAt).getMonth();
      return QUARTER_MONTHS[selectedQ].includes(month);
    })
    .sort((a, b) => {
      if (!a.closedAt) return 1;
      if (!b.closedAt) return -1;
      return new Date(b.closedAt) - new Date(a.closedAt);
    });

  const totalAcv   = filteredWins.reduce((s, w) => s + (w.acv || 0), 0);
  const missingAcv = filteredWins.filter(w => w.acv == null).length;

  const updateEntry = (id, patch) => {
    setWinsLog(log => log.map(w => w.id === id ? { ...w, ...patch } : w));
  };

  const handleAddRow = () => {
    const acv = parseFloat(newRow.acv.replace(/[$,\s]/g, ""));
    const matchAcct = accounts.find(a => a.name.toLowerCase() === newRow.accountName.toLowerCase());
    const entry = {
      id:          `win_manual_${Date.now()}`,
      accountId:   matchAcct?.id || null,
      accountName: newRow.accountName,
      tier:        matchAcct?.tier || null,
      closedAt:    newRow.closedAt ? new Date(newRow.closedAt + "T12:00:00").toISOString() : null,
      acv:         isNaN(acv) ? null : acv,
      claimJumper: false,
      source:      "manual",
    };
    setWinsLog(log => [entry, ...log]);
    setAddingRow(false);
    setNewRow({ accountName:"", closedAt:"", acv:"" });
  };

  const year = new Date().getFullYear();

  return (
    <div
      onClick={onClose}
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.78)", zIndex:1200, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width:"100%", maxWidth:760, background:"#0a0a0a", border:`1px solid ${C.brd}`, borderRadius:8, display:"flex", flexDirection:"column", maxHeight:"85vh", overflow:"hidden", boxShadow:"0 8px 40px rgba(0,0,0,0.6)" }}
      >
        {/* ── Header ── */}
        <div style={{ padding:"14px 18px 10px", borderBottom:"1px solid #1e1e1e", flexShrink:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
            <span style={{ ...mono, fontSize:13, color:C.txt, fontWeight:600 }}>
              Closed Won — {selectedQ} {year}
            </span>
            <span style={{ ...mono, fontSize:10, color:C.dim, flex:1 }}>
              {filteredWins.length} deal{filteredWins.length !== 1 ? "s" : ""} · {totalAcv > 0 ? "$"+Math.round(totalAcv).toLocaleString() : "$0"} total
            </span>
            <button
              onClick={onClose}
              style={{ background:"none", border:"none", color:C.dim, fontSize:16, cursor:"pointer", lineHeight:1, padding:0, flexShrink:0 }}
            >✕</button>
          </div>
          <div style={{ display:"flex", gap:6 }}>
            {["Q1","Q2","Q3","Q4"].map(q => (
              <button key={q} onClick={() => setSelectedQ(q)}
                style={{ ...mono, fontSize:10, padding:"3px 10px", borderRadius:4, cursor:"pointer", border:`1px solid ${selectedQ===q ? "#22c55e55" : C.brd}`, background: selectedQ===q ? "#22c55e12" : "transparent", color: selectedQ===q ? "#22c55e" : C.dim, transition:"all 0.15s" }}>
                {q}
              </button>
            ))}
          </div>
        </div>

        {/* ── Table ── */}
        <div style={{ overflowY:"auto", flex:1 }}>
          {/* Column headers */}
          <div style={{ display:"grid", gridTemplateColumns:"110px 1fr 62px 110px 48px 1fr", padding:"6px 14px", background:"#111", borderBottom:"0.5px solid #1e1e1e", position:"sticky", top:0, zIndex:2 }}>
            {["Date Closed","Account","Tier","ACV","SF","Notes"].map(h => (
              <span key={h} style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>{h}</span>
            ))}
          </div>

          {filteredWins.length === 0 && (
            <div style={{ padding:"28px 0", textAlign:"center", ...mono, fontSize:12, color:C.dim }}>
              No closed won deals for {selectedQ}
            </div>
          )}

          {filteredWins.map(w => {
            const ts       = TS[w.tier] || null;
            const noAcv    = w.acv == null;
            const sfdcUrl  = accounts.find(a => a.id === w.accountId)?.sfdc;
            return (
              <div
                key={w.id}
                style={{
                  display:"grid", gridTemplateColumns:"110px 1fr 62px 110px 48px 1fr",
                  padding:"7px 14px", borderBottom:"0.5px solid #161616",
                  background: noAcv ? "#f59e0b04" : "#0d0d0d",
                  borderLeft: `2px solid ${noAcv ? "#f59e0b44" : "transparent"}`,
                  alignItems:"center",
                }}
                onMouseEnter={e => { if (!noAcv) e.currentTarget.style.background="#111"; }}
                onMouseLeave={e => { e.currentTarget.style.background = noAcv ? "#f59e0b04" : "#0d0d0d"; }}
              >
                <DateCell iso={w.closedAt} onCommit={val => updateEntry(w.id, { closedAt: val })} />

                <span style={{ ...mono, fontSize:11, color:C.txt, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", paddingRight:8 }}>
                  {w.accountName}
                </span>

                <span>
                  {ts
                    ? <span style={{ ...mono, fontSize:9, padding:"1px 5px", background:`${ts.c}18`, border:`1px solid ${ts.b}`, borderRadius:3, color:ts.c }}>{w.tier}</span>
                    : <span style={{ ...mono, fontSize:9, color:C.dim }}>—</span>
                  }
                </span>

                <AcvCell value={w.acv} onCommit={val => updateEntry(w.id, { acv: val })} />

                <span>
                  {sfdcUrl
                    ? <a href={sfdcUrl} target="_blank" rel="noopener noreferrer" style={{ ...mono, fontSize:10, color:C.blue, textDecoration:"none" }}>SF ↗</a>
                    : <span style={{ ...mono, fontSize:10, color:C.dim }}>—</span>
                  }
                </span>

                <input
                  type="text"
                  defaultValue={w.notes || ""}
                  placeholder="notes..."
                  onBlur={e => { if (e.target.value !== (w.notes || "")) updateEntry(w.id, { notes: e.target.value }); }}
                  style={{ ...mono, fontSize:10, background:"transparent", border:"none", borderBottom:"1px solid transparent", color:C.mut, outline:"none", width:"100%", padding:"0 2px", transition:"border-color 0.2s" }}
                  onFocus={e  => { e.target.style.borderBottomColor = C.brd; }}
                  onBlurCapture={e => { e.target.style.borderBottomColor = "transparent"; }}
                />
              </div>
            );
          })}

          {/* Add row */}
          {addingRow ? (
            <div style={{ display:"grid", gridTemplateColumns:"110px 1fr 62px 110px 48px 1fr", padding:"8px 14px", borderTop:"0.5px solid #1e1e1e", background:"#0d0d0d", alignItems:"center", gap:4 }}>
              <input
                type="date"
                value={newRow.closedAt}
                onChange={e => setNewRow(r => ({ ...r, closedAt: e.target.value }))}
                style={{ ...mono, fontSize:10, background:"#111", border:`1px solid ${C.brd}`, color:C.txt, borderRadius:3, outline:"none", padding:"3px 4px", colorScheme:"dark", width:104 }}
              />
              <div style={{ position:"relative", paddingRight:8 }}>
                <input
                  type="text"
                  value={newRow.accountName}
                  onChange={e => {
                    const v = e.target.value;
                    setNewRow(r => ({ ...r, accountName: v }));
                    setAcctSuggest(v.length > 1 ? accounts.filter(a => a.name.toLowerCase().includes(v.toLowerCase())).slice(0, 5) : []);
                  }}
                  placeholder="Account name"
                  style={{ ...mono, fontSize:11, background:"#111", border:`1px solid ${C.brd}`, color:C.txt, borderRadius:3, outline:"none", padding:"3px 6px", width:"100%", boxSizing:"border-box" }}
                />
                {acctSuggest.length > 0 && (
                  <div style={{ position:"absolute", top:"100%", left:0, right:0, background:"#1a1a1a", border:`1px solid ${C.brd}`, borderRadius:4, zIndex:10 }}>
                    {acctSuggest.map(a => (
                      <div
                        key={a.id}
                        onClick={() => { setNewRow(r => ({ ...r, accountName: a.name })); setAcctSuggest([]); }}
                        style={{ ...mono, fontSize:11, padding:"5px 8px", color:C.txt, cursor:"pointer" }}
                        onMouseEnter={e => { e.currentTarget.style.background = "#252525"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                      >{a.name}</div>
                    ))}
                  </div>
                )}
              </div>
              <span />
              <input
                type="text"
                value={newRow.acv}
                onChange={e => setNewRow(r => ({ ...r, acv: e.target.value }))}
                placeholder="ACV"
                style={{ ...mono, fontSize:11, background:"#111", border:`1px solid ${C.brd}`, color:C.txt, borderRadius:3, outline:"none", padding:"3px 6px", width:90 }}
              />
              <button
                onClick={handleAddRow}
                style={{ ...mono, fontSize:10, padding:"3px 8px", background:"#22c55e18", border:"1px solid #22c55e44", color:"#22c55e", borderRadius:3, cursor:"pointer" }}
              >
                Save
              </button>
              <button
                onClick={() => { setAddingRow(false); setNewRow({ accountName:"", closedAt:"", acv:"" }); }}
                style={{ ...mono, fontSize:10, padding:"3px 8px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:3, cursor:"pointer" }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div style={{ padding:"9px 14px" }}>
              <button
                onClick={() => setAddingRow(true)}
                style={{ ...mono, fontSize:10, background:"transparent", border:"none", color:C.dim, cursor:"pointer", padding:0 }}
              >
                + Add closed deal
              </button>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div style={{ borderTop:"1px solid #1e1e1e", padding:"10px 18px", display:"flex", alignItems:"center", gap:14, flexShrink:0 }}>
          <span style={{ ...mono, fontSize:12, color:"#22c55e", fontWeight:600 }}>
            Total {selectedQ}: {totalAcv > 0 ? "$"+Math.round(totalAcv).toLocaleString() : "$0"}
          </span>
          {missingAcv > 0 && (
            <span style={{ ...mono, fontSize:10, color:"#f59e0b" }}>
              ⚠ {missingAcv} deal{missingAcv !== 1 ? "s" : ""} missing ACV — set them to improve forecast accuracy
            </span>
          )}
          <button
            onClick={onClose}
            style={{ ...mono, fontSize:11, padding:"5px 16px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:4, cursor:"pointer", marginLeft:"auto" }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
