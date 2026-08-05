import React from 'react';
import { C, mono } from '../../constants/colors';

const ownerColor = (owner) => owner === 'ae' ? C.gold : owner === 'prospect' ? C.blue : C.mut;

export default function NextStepsPanel({
  acc,
  nsOwner, setNsOwner,
  nsInput, setNsInput,
  addNextStep, removeNextStep, checkOffStep,
}) {
  const openSteps = (acc.nextSteps || []).filter(s => !s.done);
  if (openSteps.length === 0) return null;
  return (
    <div style={{ padding:'12px 16px', borderBottom:`1px solid ${C.brd}`, background:`${C.bg}88`, margin:'-12px -14px 12px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
        <span style={{ ...mono, fontSize:10, color:C.mut, textTransform:'uppercase', letterSpacing:'0.08em', fontWeight:600 }}>Next Steps</span>
        <span style={{ ...mono, fontSize:10, background:`${C.gold}22`, border:`1px solid ${C.gold}44`, color:C.gold, borderRadius:3, padding:'1px 5px' }}>{openSteps.length} open</span>
      </div>
      {openSteps.map(step => (
        <div key={step.id} style={{ display:'flex', alignItems:'flex-start', gap:8, marginBottom:5 }}>
          <input type="checkbox" onChange={() => checkOffStep(step.id)} style={{ marginTop:3, accentColor:ownerColor(step.owner), cursor:'pointer', flexShrink:0 }}/>
          <span style={{ flex:1, fontSize:12, color:ownerColor(step.owner), lineHeight:1.5 }}>{step.owner === 'ae' ? '○ AE: ' : step.owner === 'prospect' ? `○ ${acc.name.split(' ')[0]}: ` : '○ '}{step.text}</span>
          <button onClick={() => removeNextStep(step.id)} style={{ background:'transparent', border:'none', color:C.dim, fontSize:11, cursor:'pointer', padding:0, flexShrink:0 }}>✕</button>
        </div>
      ))}
      {(()=>{ try {
        const q = JSON.parse(localStorage.getItem('prospector_sfdc_queue') || '[]');
        const item = q.find(x => x.accountId === acc.id && !x.synced);
        if (!item) return null;
        return (
          <div style={{ marginTop:8, display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ ...mono, fontSize:10, color:C.orange }}>⬡ SFDC sync pending</span>
            <button onClick={() => {
              if (acc.sfdc) {
                const q2 = JSON.parse(localStorage.getItem('prospector_sfdc_queue') || '[]');
                localStorage.setItem('prospector_sfdc_queue', JSON.stringify(q2.map(x => x.id === item.id ? { ...x, synced:true } : x)));
                alert(`Next step synced to Salesforce:\n${item.nextStep}`);
              } else {
                alert('No Salesforce account linked. Paste the SF URL in the account card first.');
              }
            }} style={{ ...mono, fontSize:11, padding:'2px 9px', background:`${C.orange}18`, border:`1px solid ${C.orange}44`, color:C.orange, borderRadius:4, cursor:'pointer' }}>Sync to SF →</button>
          </div>
        );
      } catch { return null; } })()}
      <div style={{ display:'flex', gap:6, marginTop:6 }}>
        <select value={nsOwner} onChange={e => setNsOwner(e.target.value)} style={{ ...mono, fontSize:11, padding:'3px 6px', background:C.sur, border:`1px solid ${C.brd}`, borderRadius:4, color:C.txt, outline:'none', flexShrink:0 }}>
          <option value="ae">AE</option><option value="prospect">Prospect</option><option value="shared">Shared</option>
        </select>
        <input value={nsInput} onChange={e => setNsInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addNextStep()} placeholder="Add next step…" style={{ flex:1, fontSize:12, padding:'4px 8px', background:C.sur, border:`1px solid ${C.brd}`, borderRadius:4, color:C.txt, outline:'none' }}/>
        <button onClick={addNextStep} disabled={!nsInput.trim()} style={{ ...mono, fontSize:11, padding:'3px 10px', background:`${C.green}18`, border:`1px solid ${C.green}44`, color:C.green, borderRadius:4, cursor:'pointer' }}>Add</button>
      </div>
    </div>
  );
}
