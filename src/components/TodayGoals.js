import { useState } from 'react';
import { C, mono } from '../constants/colors';
import { staleDays } from '../utils/staleness';
import { RockyCard } from './BadgesProfile';

const DEFAULT_DAILY_TARGETS = { calls_logged:2, emails_sent:3, accounts_touched:5, action_items_closed:3, meetings_prepped:1 };

const GOALS = [
  { key:"calls_logged",        label:"Calls logged",     ic:"◎", c:C.blue   },
  { key:"emails_sent",         label:"Emails sent",      ic:"✉", c:C.purple },
  { key:"accounts_touched",    label:"Accts touched",    ic:"◆", c:C.gold   },
  { key:"action_items_closed", label:"Actions closed",   ic:"✓", c:C.green  },
  { key:"meetings_prepped",    label:"Meetings prepped", ic:"▶", c:C.blue   },
];

export default function TodayGoals({ dailyStats={}, accounts=[], tasks=[] }) {
  const [dailyTargets, setDailyTargets] = useState(() => {
    try { return { ...DEFAULT_DAILY_TARGETS, ...JSON.parse(localStorage.getItem("prospector_daily_targets")||"{}") }; }
    catch { return DEFAULT_DAILY_TARGETS; }
  });
  const [editingTarget, setEditingTarget] = useState(null);
  const [targetDraft,   setTargetDraft]   = useState("");

  const allDone = GOALS.every(g => (dailyStats[g.key]||0) >= (dailyTargets[g.key]||DEFAULT_DAILY_TARGETS[g.key]));

  const todayStr = new Date().toISOString().slice(0,10);
  const stale14  = accounts.filter(a => staleDays(a.last) >= 14).length;
  const overdueItems = (tasks||[]).filter(t => t.status!=="Done" && t.status!=="Closed" && t.dueDate && t.dueDate < todayStr).length;
  const scoutNudge = (() => {
    if (overdueItems >= 3) return `${overdueItems} action items are overdue — clear the backlog first`;
    if (stale14 >= 5)      return `${stale14} accounts haven't been touched in 14+ days`;
    if (overdueItems > 0)  return `${overdueItems} overdue action item${overdueItems>1?"s":""} — quick wins`;
    if (stale14 > 0)       return `${stale14} account${stale14>1?"s":""} going stale — worth a ping`;
    return null;
  })();

  return (
    <RockyCard variant={2} style={{ padding:"12px 16px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:scoutNudge?6:10 }}>
        <p style={{ ...mono, margin:0, fontSize:11, fontWeight:600, color:C.mut, textTransform:"uppercase", letterSpacing:"0.09em" }}>Today's Goals</p>
        <span style={{ ...mono, fontSize:10, color:C.dim }}>· resets at midnight</span>
        {allDone && <span style={{ ...mono, fontSize:11, color:C.gold, marginLeft:"auto" }}>⬟ All done, partner</span>}
      </div>
      {scoutNudge && (
        <div style={{ ...mono, fontSize:11, color:C.orange, marginBottom:10, paddingLeft:2 }}>⚑ Scout: {scoutNudge}</div>
      )}
      <div style={{ display:"flex", gap:8 }}>
        {GOALS.map((g, i) => {
          const tgt = dailyTargets[g.key] || DEFAULT_DAILY_TARGETS[g.key];
          const done = dailyStats[g.key] || 0;
          const pct  = Math.min(done / tgt * 100, 100);
          const complete = done >= tgt;
          const isEditing = editingTarget === g.key;
          return (
            <RockyCard key={g.key} variant={i} bgColor={complete?`${g.c}18`:C.sur} borderColor={complete?g.c:C.brd} style={{ flex:1, padding:"8px 10px", cursor:"pointer", marginTop:10 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5 }}>
                <span style={{ ...mono, fontSize:10, color:complete?g.c:C.mut }}>{g.ic} {g.label}</span>
                <div style={{ display:"flex", alignItems:"center", gap:4 }} onClick={e => e.stopPropagation()}>
                  {isEditing ? (
                    <input autoFocus value={targetDraft} onChange={e => setTargetDraft(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") {
                          const n = parseInt(targetDraft, 10);
                          if (n > 0) { const next = { ...dailyTargets, [g.key]:n }; setDailyTargets(next); localStorage.setItem("prospector_daily_targets", JSON.stringify(next)); }
                          setEditingTarget(null);
                        }
                        if (e.key === "Escape") setEditingTarget(null);
                      }}
                      onBlur={() => setEditingTarget(null)}
                      style={{ ...mono, width:28, fontSize:11, textAlign:"center", background:C.bg, border:`1px solid ${g.c}`, color:g.c, borderRadius:3, padding:"1px 2px" }}/>
                  ) : (
                    <>
                      <span style={{ ...mono, fontSize:13, fontWeight:700, color:complete?g.c:C.txt }}>{done}<span style={{ fontSize:10, fontWeight:400, color:C.dim }}>/{tgt}</span></span>
                      <span onClick={() => { setEditingTarget(g.key); setTargetDraft(String(tgt)); }} style={{ fontSize:9, color:C.dim, cursor:"pointer", opacity:0.6 }}>✎</span>
                    </>
                  )}
                </div>
              </div>
              <div style={{ height:3, borderRadius:2, background:C.bg, overflow:"hidden" }}>
                <div style={{ height:"100%", width:`${pct}%`, background:g.c, borderRadius:2, transition:"width 0.4s" }}/>
              </div>
              {complete && <div style={{ ...mono, fontSize:9, color:g.c, marginTop:3 }}>✓ Done!</div>}
            </RockyCard>
          );
        })}
      </div>
    </RockyCard>
  );
}
