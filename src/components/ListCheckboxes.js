import { useState } from 'react';
import { C, mono } from '../constants/colors';
import { createList } from '../utils/db';

// Multi-select list picker + inline "+ Create new list" - shared by
// CsvImportModal and InfluencerAddModal (accounts-lists-and-activity-model-v1
// Phase 3, extracted for influencer-accounts-v1 rather than copy-pasted a
// second time, per modular-tools discipline).
export default function ListCheckboxes({ lists, selected, onToggle, onCreated }) {
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!newName.trim() || creating) return;
    setCreating(true);
    const { list } = await createList(onCreated.businessId, newName.trim());
    setCreating(false);
    if (list) { onCreated.add(list); setNewName(''); }
  };

  return (
    <div>
      <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:8 }}>
        {lists.map(l => (
          <label key={l.id} style={{ ...mono, fontSize:11, display:"flex", alignItems:"center", gap:5, padding:"4px 10px", background:selected.includes(l.id)?`${C.gold}18`:C.bg, border:`1px solid ${selected.includes(l.id)?C.gold:C.brdM}`, borderRadius:20, cursor:"pointer", color:selected.includes(l.id)?C.gold:C.txt }}>
            <input type="checkbox" checked={selected.includes(l.id)} onChange={()=>onToggle(l.id)} style={{ cursor:"pointer" }} />
            {l.name}
          </label>
        ))}
      </div>
      <div style={{ display:"flex", gap:6 }}>
        <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="+ Create new list"
          onKeyDown={e=>e.key==='Enter' && handleCreate()}
          style={{ ...mono, fontSize:11, padding:"4px 8px", background:C.bg, border:`1px solid ${C.brdM}`, borderRadius:4, color:C.txt, outline:"none" }} />
      </div>
    </div>
  );
}
