import React, { useState, useEffect } from 'react';
import { C, mono } from '../constants/colors';
import PricingPage from './PricingPage';
import RoiPage from './ROIPage';

const DEAL_KEY = "prospector_active_deal_account";
const SNAP_KEY = "prospector_pricing_snapshots";

const loadDealAcc = () => { try { return JSON.parse(localStorage.getItem(DEAL_KEY)||"null"); } catch { return null; } };
const saveDealAcc = d => d ? localStorage.setItem(DEAL_KEY, JSON.stringify(d)) : localStorage.removeItem(DEAL_KEY);
const loadSnapsForAcc = (accId) => { try { return (JSON.parse(localStorage.getItem(SNAP_KEY)||"{}")[accId])||[]; } catch { return []; } };
const fmtDate = iso => { try { return new Date(iso).toLocaleDateString("en-US",{month:"short",day:"numeric"}); } catch { return ""; } };

// Map DealWorkspace tab IDs → PricingPage internal tab IDs
const PRICING_TAB = { configure:"calc", summary:"summary", history:"history", chat:"chat" };

const TABS = [
  { id:"configure", label:"Configure",    requiresAcc: false },
  { id:"summary",   label:"Summary",      requiresAcc: false },
  { id:"roi",       label:"ROI",          requiresAcc: true  },
  { id:"history",   label:"History",      requiresAcc: true  },
  { id:"chat",      label:"✦ Ask Claude", requiresAcc: false },
];

function DealWorkspace({ accounts=[], onCreateTask, launchAccountId=null, onLaunched }) {
  const [activeAcc,       setActiveAcc]       = useState(loadDealAcc);
  const [tab,             setTab]             = useState("configure");
  const [accSearch,       setAccSearch]       = useState("");
  const [showDrop,        setShowDrop]        = useState(false);
  const [activeSnapshotId,setActiveSnapshotId]= useState(null);
  const [snapshots,       setSnapshots]       = useState([]);
  const [snapDropOpen,    setSnapDropOpen]    = useState(false);
  const [loadedBadge,     setLoadedBadge]     = useState(null); // { name, date }

  // Sync account name if accounts list resolves after mount
  useEffect(() => {
    if (!activeAcc) return;
    const found = accounts.find(a => a.id === activeAcc.accountId);
    if (found && found.name !== activeAcc.accountName) {
      const updated = { ...activeAcc, accountName: found.name };
      setActiveAcc(updated);
      saveDealAcc(updated);
    }
  }, [accounts]); // eslint-disable-line

  // When ToolsPage passes launchAccountId (from AccountCard $ Pricing click)
  useEffect(() => {
    if (!launchAccountId) return;
    const ctx = loadDealAcc();
    const acc = accounts.find(a => a.id === launchAccountId);
    if (!acc) return;
    const data = { accountId: acc.id, accountName: acc.name, sfAccountId: acc.sf || acc.sfdc || "" };
    saveDealAcc(data);
    setActiveAcc(data);
    setAccSearch("");
    setShowDrop(false);
    // Read activePricingFileId written by AccountCard
    const snapId = ctx?.activePricingFileId ?? null;
    setActiveSnapshotId(snapId);
    const snaps = loadSnapsForAcc(acc.id);
    setSnapshots(snaps);
    if (snapId) {
      const snap = snaps.find(s => s.id === snapId);
      if (snap) setLoadedBadge({ name: snap.name, date: snap.savedAt });
    } else {
      setLoadedBadge(null);
    }
    if (onLaunched) onLaunched();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launchAccountId]);

  // Reload snapshots when active account changes
  useEffect(() => {
    const accId = activeAcc?.accountId;
    if (!accId) { setSnapshots([]); return; }
    setSnapshots(loadSnapsForAcc(accId));
  }, [activeAcc]);

  const selectAccount = acc => {
    const data = { accountId: acc.id, accountName: acc.name, sfAccountId: acc.sf || "" };
    saveDealAcc(data);
    setActiveAcc(data);
    setActiveSnapshotId(null);
    setLoadedBadge(null);
    setAccSearch("");
    setShowDrop(false);
  };

  const clearAccount = () => {
    saveDealAcc(null);
    setActiveAcc(null);
    setActiveSnapshotId(null);
    setLoadedBadge(null);
    setAccSearch("");
    if (TABS.find(t => t.id === tab)?.requiresAcc) setTab("configure");
  };

  const selectSnapshot = (snap) => {
    setActiveSnapshotId(snap.id);
    setLoadedBadge({ name: snap.name, date: snap.savedAt });
    setSnapDropOpen(false);
  };

  const newModel = () => {
    setActiveSnapshotId(null);
    setLoadedBadge(null);
    setSnapDropOpen(false);
  };

  const dropList = accSearch.trim()
    ? accounts.filter(a => a.name.toLowerCase().includes(accSearch.toLowerCase())).slice(0, 10)
    : [];

  const accId = activeAcc?.accountId ?? null;

  return (
    <div>
      {/* ── Account bar — compact, always visible ── */}
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14, minHeight:32, flexWrap:"wrap" }}>
        {activeAcc ? (
          <>
            <span style={{ ...mono, fontSize:11, color:C.dim, flexShrink:0 }}>Working on</span>
            <span style={{ ...mono, fontSize:13, fontWeight:700, color:C.gold }}>{activeAcc.accountName}</span>
            <button onClick={clearAccount}
              style={{ ...mono, fontSize:11, padding:"2px 8px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:4, cursor:"pointer", flexShrink:0 }}>
              × switch
            </button>
            {/* Model selector */}
            {snapshots.length > 0 && (
              <div style={{ position:"relative", marginLeft:8 }}>
                <button onClick={() => setSnapDropOpen(o=>!o)}
                  style={{ ...mono, fontSize:11, padding:"3px 10px", background:C.sur, border:`1px solid ${C.brd}`, color:activeSnapshotId?C.gold:C.mut, borderRadius:4, cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
                  {activeSnapshotId ? (snapshots.find(s=>s.id===activeSnapshotId)?.name || "Model") : "No model loaded"}
                  <span style={{ color:C.dim }}>▾</span>
                </button>
                {snapDropOpen && (
                  <div style={{ position:"absolute", top:"calc(100% + 3px)", left:0, zIndex:300, minWidth:220, background:C.card, border:`1px solid ${C.brd}`, borderRadius:6, boxShadow:"0 6px 20px #0009", overflow:"hidden" }}>
                    {snapshots.map((s,i) => (
                      <div key={s.id} onMouseDown={() => selectSnapshot(s)}
                        style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 12px", cursor:"pointer", borderBottom: i<snapshots.length-1?`1px solid ${C.brd}22`:"none",
                          background: s.id===activeSnapshotId ? `${C.gold}12` : "transparent" }}
                        onMouseEnter={e => e.currentTarget.style.background = C.sur}
                        onMouseLeave={e => e.currentTarget.style.background = s.id===activeSnapshotId?`${C.gold}12`:"transparent"}>
                        <span style={{ ...mono, fontSize:12, color:C.txt, flex:1 }}>{s.name}</span>
                        <span style={{ ...mono, fontSize:10, color:C.dim }}>{s.savedAt}</span>
                      </div>
                    ))}
                    <div onMouseDown={newModel}
                      style={{ padding:"7px 12px", cursor:"pointer", borderTop:`1px solid ${C.brd}`, color:C.blue }}
                      onMouseEnter={e => e.currentTarget.style.background = C.sur}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <span style={{ ...mono, fontSize:12 }}>+ New Model</span>
                    </div>
                  </div>
                )}
              </div>
            )}
            {loadedBadge && (
              <span style={{ ...mono, fontSize:10, color:C.green, background:`${C.green}14`, borderRadius:3, padding:"2px 7px", flexShrink:0 }}>
                Loaded: {loadedBadge.name} — {loadedBadge.date}
              </span>
            )}
          </>
        ) : (
          <div style={{ position:"relative", width:300 }}>
            <input
              value={accSearch}
              onChange={e => { setAccSearch(e.target.value); setShowDrop(true); }}
              onFocus={() => setShowDrop(true)}
              onBlur={() => setTimeout(() => setShowDrop(false), 150)}
              placeholder="Link an account (optional)…"
              style={{ ...mono, width:"100%", boxSizing:"border-box", fontSize:12, padding:"5px 10px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:6, color:C.txt, outline:"none" }}
            />
            {showDrop && dropList.length > 0 && (
              <div style={{ position:"absolute", top:"calc(100% + 3px)", left:0, right:0, zIndex:200, background:C.card, border:`1px solid ${C.brd}`, borderRadius:6, boxShadow:"0 6px 20px #0009", overflow:"hidden" }}>
                {dropList.map((a, i) => (
                  <div key={a.id} onMouseDown={() => selectAccount(a)}
                    style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 12px", cursor:"pointer", borderBottom: i < dropList.length-1 ? `1px solid ${C.brd}22` : "none" }}
                    onMouseEnter={e => e.currentTarget.style.background = C.sur}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <span style={{ fontSize:13, color:C.txt, flex:1 }}>{a.name}</span>
                    {a.vert  && <span style={{ ...mono, fontSize:10, color:C.dim }}>{a.vert}</span>}
                    {a.tier  && <span style={{ ...mono, fontSize:10, color:C.blue, background:`${C.blue}14`, borderRadius:3, padding:"1px 5px" }}>{a.tier}</span>}
                    {a.score != null && <span style={{ ...mono, fontSize:10, color:C.green }}>▲{a.score}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Tab bar — always visible ── */}
      <div style={{ display:"flex", gap:0, marginBottom:20, borderBottom:`1px solid ${C.brd}` }}>
        {TABS.map(t => {
          const locked = t.requiresAcc && !activeAcc;
          return (
            <button key={t.id} onClick={() => !locked && setTab(t.id)}
              style={{ ...mono, fontSize:13, padding:"7px 20px", background:"transparent", border:"none",
                borderBottom: tab===t.id ? `2px solid ${C.gold}` : "2px solid transparent",
                color: locked ? C.brd : tab===t.id ? C.gold : C.mut,
                cursor: locked ? "default" : "pointer", marginBottom:-1 }}>
              {t.label}{locked ? " 🔒" : ""}
            </button>
          );
        })}
      </div>

      {/* ── Content ── */}
      {/* PricingPage: always mounted, covers configure/summary/history tabs */}
      <div style={{ display: tab!=="roi" ? "block" : "none" }}>
        <PricingPage
          key={accId || "freeform"}
          accounts={accounts}
          launchAccountId={accId}
          onLaunched={() => {}}
          onCreateTask={onCreateTask}
          hideAccountPicker={true}
          hideTabs={true}
          controlledTab={PRICING_TAB[tab] ?? "calc"}
          activeSnapshotId={activeSnapshotId}
        />
      </div>

      {/* ROIPage: only mounted when account is linked */}
      {activeAcc && (
        <div style={{ display: tab==="roi" ? "block" : "none" }}>
          <RoiPage
            key={accId}
            accounts={accounts}
            launchAccountId={accId}
            onLaunched={() => {}}
            hideAccountPicker={true}
          />
        </div>
      )}
    </div>
  );
}

export default DealWorkspace;
