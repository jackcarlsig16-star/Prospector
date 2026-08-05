import React, { useState } from 'react';
import { C, mono } from '../constants/colors';
import { T } from '../constants/tokens';

function Row({ checked, onToggle, label, detail }) {
  return (
    <div onClick={onToggle}
      onMouseEnter={e=>e.currentTarget.style.background='rgba(57,255,20,0.04)'}
      onMouseLeave={e=>e.currentTarget.style.background='transparent'}
      style={{ display:'flex', alignItems:'flex-start', gap:8, padding:'6px 10px', cursor:'pointer', borderRadius:4, transition:'background 0.1s' }}>
      <div style={{ width:14, height:14, borderRadius:2, border:`1.5px solid ${checked?T.neon:C.brd}`, background:checked?`${T.neon}18`:'transparent', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', marginTop:1 }}>
        {checked && <span style={{ color:T.neon, fontSize:10, lineHeight:1, textShadow:`0 0 4px ${T.neon}` }}>✓</span>}
      </div>
      <p style={{ ...mono, margin:0, fontSize:11, color:checked?C.txt:C.dim, lineHeight:1.55, fontWeight:checked?500:400, flex:1, minWidth:0 }}>
        <span style={{ color:checked?T.neon:C.dim, marginRight:6, fontWeight:600, letterSpacing:'0.04em' }}>{label}:</span>
        {detail}
      </p>
    </div>
  );
}

function QuickUpdateDiff({ result, acc, generateFollowUp, onApply, onCancel }) {
  const tlInit = (result.timelineUpdates||[]).filter(x => x && (x.milestone || x.date));
  const teamNames = (() => {
    try { return JSON.parse(localStorage.getItem('prospector_team_users') || '[]').map(u => u.name?.toLowerCase()).filter(Boolean); }
    catch { return []; }
  })();
  const aeName = (() => {
    try { return JSON.parse(localStorage.getItem('prospector_user') || '{}').name?.toLowerCase() || ''; }
    catch { return ''; }
  })();
  const ctInit = (result.newContacts || [])
    .filter(c => c && c.name)
    .filter(c => c.company === 'prospect')
    .filter(c => !aeName || !c.name.toLowerCase().includes(aeName.split(' ')[0].toLowerCase()))
    .filter(c => !teamNames.some(t => c.name.toLowerCase().includes(t.split(' ')[0].toLowerCase())));
  const blInit = (result.blockers||[]).filter(b => typeof b === 'string' ? b.trim() : b?.text);
  const tkInit = (result.tasks||[]).filter(x => x && x.text);
  const noteInit = result.contextNote && String(result.contextNote).trim() ? String(result.contextNote).trim() : null;

  const [tl, setTl] = useState(()=>new Set(tlInit.map((_,i)=>i)));
  const [ct, setCt] = useState(()=>new Set(ctInit.map((_,i)=>i)));
  const [bl, setBl] = useState(()=>new Set(blInit.map((_,i)=>i)));
  const [tk, setTk] = useState(()=>new Set(tkInit.map((_,i)=>i)));
  const [noteOn, setNoteOn] = useState(!!noteInit);

  const toggle = (setter, set, i) => {
    const n = new Set(set);
    n.has(i) ? n.delete(i) : n.add(i);
    setter(n);
  };

  const total = tl.size + ct.size + bl.size + tk.size + (noteOn?1:0);
  const nothing = tlInit.length===0 && ctInit.length===0 && blInit.length===0 && tkInit.length===0 && !noteInit;

  if (nothing) {
    return (
      <div style={{ padding:'12px 14px', background:`${T.amber}08`, border:`1px solid ${T.amber}33`, borderRadius:6 }}>
        <p style={{ ...mono, margin:0, fontSize:11, color:T.amber }}>⚠ Nothing extractable — try a different note or use Call Debrief for transcripts.</p>
        <button onClick={onCancel} style={{ ...mono, marginTop:8, fontSize:10, padding:'3px 10px', background:'transparent', border:`1px solid ${C.brd}`, color:C.dim, borderRadius:3, cursor:'pointer' }}>Close</button>
      </div>
    );
  }

  return (
    <div style={{ padding:'12px 14px', background:`${T.cyan}06`, border:`1px solid ${T.cyan}33`, borderRadius:6 }}>
      <p style={{ ...mono, margin:'0 0 10px', fontSize:10, color:T.cyan, textTransform:'uppercase', letterSpacing:'0.08em', fontWeight:600 }}>⚡ Review extracted updates</p>
      <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
        {tlInit.map((u,i)=>(
          <Row key={`tl-${i}`} checked={tl.has(i)} onToggle={()=>toggle(setTl,tl,i)}
            label="Timeline"
            detail={`"${u.milestone||''}${u.date?` by ${u.date}`:''}" added`}/>
        ))}
        {tkInit.map((t,i)=>(
          <Row key={`tk-${i}`} checked={tk.has(i)} onToggle={()=>toggle(setTk,tk,i)}
            label="Task"
            detail={`${t.text} (${t.owner||'AE'}${t.dueDate?`, due ${t.dueDate}`:''})`}/>
        ))}
        {ctInit.map((c,i)=>(
          <Row key={`ct-${i}`} checked={ct.has(i)} onToggle={()=>toggle(setCt,ct,i)}
            label="Contact"
            detail={`${c.name}${c.title?`, ${c.title}`:''} — add to account?`}/>
        ))}
        {blInit.map((b,i)=>(
          <Row key={`bl-${i}`} checked={bl.has(i)} onToggle={()=>toggle(setBl,bl,i)}
            label="Blocker"
            detail={typeof b === 'string' ? b : (b?.text || '')}/>
        ))}
        {noteInit && (
          <Row checked={noteOn} onToggle={()=>setNoteOn(o=>!o)}
            label="Note"
            detail={`"${noteInit}"`}/>
        )}
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:12 }}>
        <button disabled={total===0} onClick={()=>{
          const payload = {
            timelineUpdates: tlInit.filter((_,i)=>tl.has(i)),
            newContacts: ctInit.filter((_,i)=>ct.has(i)),
            blockers: blInit.filter((_,i)=>bl.has(i)).map(b => typeof b === 'string' ? b : (b?.text || '')).filter(Boolean),
            tasks: tkInit.filter((_,i)=>tk.has(i)),
            contextNote: noteOn ? noteInit : null,
          };
          onApply(payload, generateFollowUp);
        }} style={{ ...mono, fontSize:11, padding:'6px 14px', background:total>0?`${T.neon}18`:'transparent', border:`1px solid ${total>0?T.neon:C.brd}`, color:total>0?T.neon:C.dim, borderRadius:4, cursor:total>0?'pointer':'default', letterSpacing:'0.06em', textShadow:total>0?`0 0 6px ${T.neon}55`:'none', fontWeight:600 }}>
          Apply Selected ({total}) →
        </button>
        <button onClick={onCancel} style={{ ...mono, fontSize:11, padding:'6px 12px', background:'transparent', border:`1px solid ${C.brd}`, color:C.dim, borderRadius:4, cursor:'pointer' }}>Cancel</button>
      </div>
    </div>
  );
}

export default QuickUpdateDiff;
