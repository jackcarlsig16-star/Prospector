import { C, TS, mono } from '../constants/colors';
import { useState } from 'react';
import { isStale, isWarn } from './staleness';

const lastTouch = (acc) => acc.last;

const NEON  = '#39FF14';
const CYAN  = '#00F5FF';
const AMBER = '#FFB800';
const RED   = '#FF4444';
const MUTE  = '#555566';

export let BDR_LIST = [];
export const setBdrList = (list) => { BDR_LIST = list; };

export const URGENCY_OPTIONS = [
  { id:"hot",      emoji:"🔴", label:"Hot",       sub:"Reach out today",    color:RED,   frontierPriority:"Top",  taskPriority:"High",   dueDays:0  },
  { id:"warm",     emoji:"🟠", label:"Warm",      sub:"This week",          color:AMBER, frontierPriority:"Mid",  taskPriority:"High",   dueDays:3  },
  { id:"followup", emoji:"🟡", label:"Follow Up", sub:"Within 2 weeks",     color:CYAN,  frontierPriority:"Mid",  taskPriority:"Medium", dueDays:14 },
  { id:"low",      emoji:"⚪", label:"Low",        sub:"When you get to it", color:MUTE,  frontierPriority:"Low",  taskPriority:"Low",    dueDays:30 },
];

export function AssignModal({ acc, onAssign, onClose, initialBdrId, initialNote }) {
  const [urgency, setUrgency] = useState("warm");
  const [note, setNote] = useState(initialNote || "");
  const [bdrId, setBdrId] = useState(initialBdrId || BDR_LIST[0]?.id || "");

  const staleAcc = isStale(lastTouch(acc));
  const warnAcc  = isWarn(lastTouch(acc));
  const suggestedAction = (()=>{
    if(acc.tier==="Gold"&&(staleAcc||warnAcc))    return "Re-engage before account is claimable";
    if(acc.tier==="Gold"&&(acc.stage||"Prospecting")==="Prospecting") return "First touch — strong product fit";
    if(acc.tier==="Gold"&&acc.stage==="Engaged")  return "Drive forward — account is warm";
    if(acc.tier==="Silver"&&acc.stage==="Engaged")return "Follow up on previous conversation";
    if(acc.tier==="Silver"&&(acc.stage||"Prospecting")==="Prospecting") return "First touch — solid fit, good target";
    return "Outbound and qualify";
  })();

  const urg = URGENCY_OPTIONS.find(u=>u.id===urgency)||URGENCY_OPTIONS[1];
  const bdrName = BDR_LIST.find(b=>b.id===bdrId)?.name || "BDR";

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.72)", zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center", backdropFilter:"blur(2px)" }}>
      <div onClick={e=>e.stopPropagation()}
        style={{
          width: 460,
          background: "#050f05",
          border: "1px solid rgba(0,245,255,0.2)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6), 0 0 24px rgba(0,245,255,0.08)",
          borderRadius: 4,
          padding: "22px 24px",
          maxHeight: "90vh",
          overflowY: "auto",
        }}>

        {/* ── Header ── */}
        <div style={{ display:"flex", alignItems:"flex-start", gap:10, marginBottom:18 }}>
          <div style={{ flex:1, minWidth:0 }}>
            <p style={{ ...mono, margin:"0 0 6px", fontSize:10, color:CYAN, textTransform:"uppercase", letterSpacing:"0.16em", fontWeight:700, textShadow:`0 0 8px ${CYAN}55` }}>
              ASSIGN TO BDR
            </p>
            <p style={{ ...mono, margin:"0 0 4px", fontSize:18, fontWeight:500, color:"#f1f5f9", lineHeight:1.2 }}>{acc.name}</p>
            {acc.tier && (
              <span style={{ ...mono, fontSize:11, color:TS[acc.tier]?.c||C.dim, letterSpacing:"0.04em" }}>
                {TS[acc.tier]?.i} {acc.tier}{acc.vert?` · ${acc.vert}`:""}
              </span>
            )}
          </div>
          <button onClick={onClose}
            onMouseEnter={e=>e.currentTarget.style.color="#f1f5f9"}
            onMouseLeave={e=>e.currentTarget.style.color="#5a6a5a"}
            style={{ background:"transparent", border:"none", color:"#5a6a5a", fontSize:18, cursor:"pointer", padding:0, lineHeight:1, flexShrink:0, transition:"color 0.12s" }}>✕</button>
        </div>

        {/* ── BDR picker (when multiple) ── */}
        {BDR_LIST.length>1 && (
          <div style={{ marginBottom:16 }}>
            <p style={{ ...mono, margin:"0 0 8px", fontSize:10, color:CYAN, textTransform:"uppercase", letterSpacing:"0.12em", fontWeight:600 }}>ASSIGN TO</p>
            <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
              {BDR_LIST.map(b => {
                const active = bdrId === b.id;
                return (
                  <button key={b.id} onClick={()=>setBdrId(b.id)}
                    style={{ ...mono, fontSize:12, padding:"5px 12px", borderRadius:3, border:`1px solid ${active?CYAN:"#1a3a1a"}`, background:active?`${CYAN}14`:"transparent", color:active?CYAN:"#5a6a5a", cursor:"pointer", letterSpacing:"0.04em", boxShadow:active?`0 0 6px ${CYAN}33`:"none", transition:"all 0.12s" }}>
                    {b.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Urgency rows ── */}
        <div style={{ marginBottom:14 }}>
          <p style={{ ...mono, margin:"0 0 8px", fontSize:10, color:CYAN, textTransform:"uppercase", letterSpacing:"0.12em", fontWeight:600 }}>
            URGENCY <span style={{ color:RED }}>*</span>
          </p>
          <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
            {URGENCY_OPTIONS.map(u => {
              const active = urgency === u.id;
              return (
                <button key={u.id} onClick={()=>setUrgency(u.id)}
                  style={{
                    display:"flex", alignItems:"center", gap:12,
                    padding:"10px 14px",
                    borderRadius:3,
                    border:`1px solid ${active?u.color:"#1a3a1a"}`,
                    background:active?`${u.color}10`:"#0a0f0a",
                    cursor:"pointer",
                    textAlign:"left",
                    boxShadow: active ? `0 0 8px ${u.color}66` : "none",
                    transition:"all 0.12s",
                  }}>
                  <span style={{ fontSize:10, color:u.color, textShadow:active?`0 0 6px ${u.color}`:"none", lineHeight:1 }}>●</span>
                  <span style={{ ...mono, fontSize:13, fontWeight:active?600:500, color:active?u.color:"#f1f5f9", letterSpacing:"0.04em" }}>{u.label}</span>
                  <span style={{ ...mono, fontSize:11, color:"#5a6a5a", marginLeft:"auto", letterSpacing:"0.03em" }}>{u.sub}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Suggested context ── */}
        <div style={{ marginBottom:14, padding:"8px 12px", background:`${NEON}08`, border:`1px solid ${NEON}33`, borderRadius:3, display:"flex", gap:8, alignItems:"flex-start" }}>
          <span style={{ ...mono, fontSize:10, color:NEON, flexShrink:0, marginTop:1, letterSpacing:"0.06em", textShadow:`0 0 6px ${NEON}66` }}>SUGGESTED ›</span>
          <span style={{ ...mono, fontSize:12, color:"#cfe8d4", lineHeight:1.55 }}>{suggestedAction}</span>
        </div>

        {/* ── Context textarea ── */}
        <div style={{ marginBottom:18 }}>
          <p style={{ ...mono, margin:"0 0 6px", fontSize:10, color:CYAN, textTransform:"uppercase", letterSpacing:"0.12em", fontWeight:600 }}>
            CONTEXT FOR {bdrName.toUpperCase()} (OPTIONAL)
          </p>
          <textarea value={note} onChange={e=>setNote(e.target.value)}
            placeholder={`e.g. "Visited their docs yesterday — good timing" or "Met CEO at a conference"`}
            rows={2}
            style={{
              ...mono,
              width:"100%",
              fontSize:12,
              padding:"8px 11px",
              background:"#050f05",
              border:`1px solid #1a3a1a`,
              borderRadius:3,
              color:"#cfe8d4",
              outline:"none",
              resize:"none",
              lineHeight:1.6,
              boxSizing:"border-box",
              transition:"border-color 0.15s, box-shadow 0.15s",
              caretColor:CYAN,
            }}
            onFocus={e=>{ e.target.style.borderColor=`${CYAN}66`; e.target.style.boxShadow=`0 0 0 1px ${CYAN}22`; }}
            onBlur={e=>{ e.target.style.borderColor="#1a3a1a"; e.target.style.boxShadow="none"; }}
          />
        </div>

        {/* ── CTA — matches selected urgency color ── */}
        <button onClick={()=>{onAssign(acc,bdrId,note,urgency);onClose();}}
          onMouseEnter={e=>{ e.currentTarget.style.background = `${urg.color}26`; }}
          onMouseLeave={e=>{ e.currentTarget.style.background = `${urg.color}1A`; }}
          style={{
            ...mono,
            width:"100%",
            padding:"11px 0",
            background:`${urg.color}1A`,
            border:`1px solid ${urg.color}`,
            color:urg.color,
            borderRadius:3,
            cursor:"pointer",
            fontSize:13,
            fontWeight:600,
            letterSpacing:"0.06em",
            boxShadow:`0 0 12px ${urg.color}66`,
            textShadow:`0 0 6px ${urg.color}66`,
            transition:"background 0.12s",
          }}>
          ASSIGN TO {bdrName.toUpperCase()} — {urg.label.toUpperCase()} →
        </button>
      </div>
    </div>
  );
}
