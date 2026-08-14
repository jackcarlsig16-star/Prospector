import { useState, useMemo } from 'react';
import { C, mono } from '../constants/colors';

// Dumb multi-select over a business's existing accounts - parent owns
// selection state, same division of labor as ListCheckboxes. Shared by
// CreateProjectModal (pick accounts at creation time) and the project's
// "Add accounts" action (project-guidance-and-creation-flow-v1).
export default function AccountPicker({ accounts, selected, onToggle }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(a => (a.name || '').toLowerCase().includes(q));
  }, [accounts, query]);

  return (
    <div>
      <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search accounts…"
        style={{ ...mono, fontSize:12, padding:"6px 10px", background:C.bg, border:`1px solid ${C.brdM}`, borderRadius:6, color:C.txt, outline:"none", width:"100%", boxSizing:"border-box", marginBottom:8 }} />
      <div style={{ maxHeight:200, overflowY:"auto", border:`1px solid ${C.brdM}`, borderRadius:6 }}>
        {filtered.map(a => (
          <label key={a.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px", borderBottom:`1px solid ${C.brd}`, cursor:"pointer" }}>
            <input type="checkbox" checked={selected.includes(a.id)} onChange={()=>onToggle(a.id)} style={{ cursor:"pointer" }} />
            <span style={{ ...mono, fontSize:12, color:C.txt }}>{a.name}</span>
            <span style={{ ...mono, fontSize:9, color:C.dim, marginLeft:"auto", textTransform:"uppercase" }}>{a.accountKind || 'business'}</span>
          </label>
        ))}
        {filtered.length === 0 && <p style={{ ...mono, fontSize:11, color:C.dim, margin:0, padding:10 }}>No accounts match.</p>}
      </div>
      {selected.length > 0 && <p style={{ ...mono, fontSize:10, color:C.dim, margin:"6px 0 0" }}>{selected.length} selected</p>}
    </div>
  );
}
