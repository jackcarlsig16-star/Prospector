import React from 'react';
import { C, mono } from '../constants/colors';
import { getGleanPrompt } from '../utils/dealIntel';

function CommittedActionsQueue({
  pendingActions, editedActions, setEditedActions,
  selectedActionIdxs, setSelectedActionIdxs,
  actionsPushed, setActionsPushed,
  tasks, acc, activeUser, onCreateTask,
}) {
  if (!pendingActions.length) return null;
  return (
    <div style={{ flex:'0 0 360px', maxHeight:'85vh', overflowY:'auto', background:C.card, border:`1px solid ${C.goldBdr}`, borderRadius:12, padding:'20px 22px', boxShadow:'0 24px 64px rgba(0,0,0,0.6)' }}>
      <p style={{ ...mono, margin:'0 0 4px', fontSize:11, color:C.gold, textTransform:'uppercase', letterSpacing:'0.08em', fontWeight:600 }}>Committed Actions</p>
      <p style={{ ...mono, margin:'0 0 14px', fontSize:11, color:C.dim }}>Edit action text before adding to queue</p>
      <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:16 }}>
        {pendingActions.map((a,i)=>{
          const checked=selectedActionIdxs.has(i);const ownerC=a.owner==='AE'?C.red:C.blue;
          const currentTitle=editedActions[i]??(a.suggestedAction||a.action);
          const dupTask=tasks.find(t=>t.source==='committed_action'&&t.status!=='Done'&&t.status!=='Stale'&&t.accId===acc.id&&t.category===a.category&&(a.category!=='Freeform'||t.title===currentTitle));
          return(
            <div key={i} style={{ border:`1px solid ${checked?ownerC+'66':C.brd}`, borderRadius:8, background:checked?`${ownerC}08`:'transparent', transition:'all 0.15s' }}>
              <div onClick={()=>setSelectedActionIdxs(s=>{const n=new Set(s);n.has(i)?n.delete(i):n.add(i);return n;})} style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', cursor:'pointer' }}>
                <div style={{ width:15, height:15, borderRadius:3, border:`1.5px solid ${checked?ownerC:C.brd}`, background:checked?`${ownerC}22`:'transparent', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}>{checked&&<span style={{ color:ownerC, fontSize:10, lineHeight:1 }}>✓</span>}</div>
                {a.category&&a.category!=='Freeform'&&(<span style={{ ...mono, fontSize:9, padding:'1px 6px', background:`${ownerC}14`, border:`1px solid ${ownerC}33`, color:ownerC, borderRadius:3, flexShrink:0, textTransform:'uppercase', letterSpacing:'0.06em' }}>{a.category}</span>)}
                <span style={{ ...mono, fontSize:10, color:C.mut, marginLeft:'auto', flexShrink:0 }}>{a.owner==='AE'?'You committed':'They committed'}{a.dueDate?` · ${a.dueDate}`:''}</span>
              </div>
              <div style={{ padding:'0 12px 10px' }}>
                <input value={editedActions[i]??(a.suggestedAction||a.action)} onChange={e=>setEditedActions(prev=>{const n=[...prev];n[i]=e.target.value;return n;})} onClick={e=>e.stopPropagation()} style={{ width:'100%', fontSize:12, color:C.txt, background:C.sur, border:`1px solid ${C.brd}`, borderRadius:5, padding:'5px 8px', outline:'none', boxSizing:'border-box', fontFamily:'inherit' }}/>
                {a.action&&a.suggestedAction&&a.action!==a.suggestedAction&&(<p style={{ ...mono, margin:'4px 0 0', fontSize:10, color:C.dim, lineHeight:1.4 }}>Heard: "{a.action}"</p>)}
                {dupTask&&(<p style={{ ...mono, margin:'4px 0 0', fontSize:10, color:C.orange }}>⚠ Open {a.category} task from {dupTask.createdAt?.slice(0,10)||'earlier'} — mark it done first?</p>)}
              </div>
            </div>
          );
        })}
      </div>
      <button disabled={selectedActionIdxs.size===0||actionsPushed} onClick={()=>{
        const today=new Date().toISOString().split('T')[0];
        pendingActions.forEach((a,i)=>{
          if(!selectedActionIdxs.has(i))return;
          const due=a.dueDate||(()=>{const d=new Date();d.setDate(d.getDate()+2);return d.toISOString().split('T')[0];})();
          const title=(editedActions[i]??(a.suggestedAction||a.action))||a.action;
          onCreateTask&&onCreateTask({id:Date.now()+i,title,type:'Committed Action',priority:'High',accId:acc.id,accName:acc.name,accVert:acc.vert,accUcs:acc.ucs,accProds:acc.prods,accStage:acc.stage,assignee:a.owner==='AE'?(activeUser?.name||'AE'):acc.name,status:'Open',dueDate:due,createdAt:today,source:'committed_action',owner:a.owner,category:a.category||'Freeform',rawAction:a.action,gleanPrompt:getGleanPrompt(a.category,acc)});
        });
        setActionsPushed(true);
      }} style={{ width:'100%', padding:'10px 0', background:actionsPushed?`${C.green}18`:`${C.gold}18`, border:`1px solid ${actionsPushed?C.green:C.goldBdr}`, color:actionsPushed?C.green:C.gold, borderRadius:7, cursor:selectedActionIdxs.size===0||actionsPushed?'default':'pointer', fontSize:13, fontWeight:500, transition:'all 0.2s' }}>
        {actionsPushed?`✓ ${selectedActionIdxs.size} added to Task Queue`:`Add ${selectedActionIdxs.size} to Task Queue →`}
      </button>
    </div>
  );
}

export default CommittedActionsQueue;
