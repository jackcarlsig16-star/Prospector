import { useState } from 'react';
import { C, mono, PRESET_SWATCH_COLORS } from '../constants/colors';
import { createProject } from '../utils/db';

function CreateProjectModal({ userEmail, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(PRESET_SWATCH_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError('');
    const { project, error: err } = await createProject({ name: name.trim(), color, ownerEmail: userEmail });
    setSaving(false);
    if (err) { setError(err); return; }
    onCreated(project);
  };

  const inp = { fontSize:13, padding:"8px 11px", background:C.bg, border:`1.5px solid ${C.brdM}`, borderRadius:6, color:C.txt, outline:"none", width:"100%", boxSizing:"border-box", ...mono };

  return (
    <div onClick={e=>{if(e.target===e.currentTarget) onClose();}} style={{ position:"fixed", inset:0, zIndex:1000, background:"#00000099", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ background:C.card, border:`1px solid ${C.brd}`, borderRadius:12, padding:"22px 26px", width:380, boxShadow:"0 20px 60px #000c" }}>
        <div style={{ display:"flex", alignItems:"center", marginBottom:20 }}>
          <span style={{ ...mono, fontSize:14, color:C.txt, fontWeight:700 }}>New project</span>
          <button onClick={onClose} style={{ marginLeft:"auto", background:"transparent", border:"none", color:C.mut, fontSize:18, cursor:"pointer" }}>✕</button>
        </div>

        <div style={{ marginBottom:16 }}>
          <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>Name</div>
          <input
            type="text" placeholder="Acme Co" value={name}
            onChange={e=>setName(e.target.value)}
            onKeyDown={e=>e.key==="Enter" && name.trim() && handleCreate()}
            style={inp}
          />
        </div>

        <div style={{ marginBottom:22 }}>
          <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>Color</div>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            {PRESET_SWATCH_COLORS.map(c => (
              <button key={c} onClick={()=>setColor(c)} aria-label={c}
                style={{
                  width:28, height:28, borderRadius:"50%", background:c, cursor:"pointer", padding:0,
                  border: color===c ? `2px solid ${C.txt}` : "2px solid transparent",
                  boxShadow: color===c ? `0 0 0 2px ${C.card}` : "none",
                }}
              />
            ))}
          </div>
        </div>

        {error && <div style={{ ...mono, fontSize:11, color:C.red, marginBottom:12 }}>⚠ {error}</div>}

        <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
          <button onClick={onClose} style={{ ...mono, fontSize:12, padding:"7px 16px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:6, color:C.mut, cursor:"pointer" }}>Cancel</button>
          <button onClick={handleCreate} disabled={!name.trim()||saving}
            style={{ ...mono, fontSize:12, padding:"7px 20px", background:name.trim()?C.gold:"transparent", border:`1px solid ${name.trim()?C.gold:C.brd}`, borderRadius:6, color:name.trim()?C.bg:C.dim, cursor:name.trim()&&!saving?"pointer":"default", fontWeight:700 }}>
            {saving ? "Creating…" : "Create →"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ProjectsHomePage({ projects, userEmail, onSelect, onCreated, onGoToBusinesses }) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div style={{ minHeight:"100vh", background:C.bg, padding:"48px 40px" }}>
      <div style={{ maxWidth:900, margin:"0 auto" }}>
        <div style={{ display:"flex", alignItems:"center", marginBottom:24 }}>
          <h1 style={{ ...mono, fontSize:20, color:C.txt, fontWeight:700, margin:0 }}>My Projects</h1>
          {onGoToBusinesses && (
            <button onClick={onGoToBusinesses} style={{ ...mono, marginLeft:"auto", fontSize:12, color:C.dim, background:"transparent", border:`1px solid ${C.brd}`, borderRadius:6, padding:"6px 14px", cursor:"pointer" }}>
              🏢 Businesses
            </button>
          )}
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(220px, 1fr))", gap:16 }}>
          {projects.map(p => (
            <button key={p.id} onClick={()=>onSelect(p)}
              style={{
                display:"flex", flexDirection:"column", justifyContent:"flex-end", height:140,
                borderRadius:10, border:`1px solid ${C.brd}`, borderLeft:`4px solid ${p.color||C.gold}`,
                background:`linear-gradient(160deg, ${p.color||C.gold}33, ${C.card})`,
                padding:16, cursor:"pointer", textAlign:"left",
              }}
            >
              <span style={{ ...mono, fontSize:14, color:C.txt, fontWeight:700 }}>{p.name}</span>
            </button>
          ))}

          <button onClick={()=>setModalOpen(true)}
            style={{ display:"flex", alignItems:"center", justifyContent:"center", height:140, borderRadius:10, border:`1.5px dashed ${C.brd}`, background:"transparent", cursor:"pointer" }}>
            <span style={{ ...mono, fontSize:13, color:C.dim, fontWeight:600 }}>+ New Project</span>
          </button>
        </div>
      </div>

      {modalOpen && (
        <CreateProjectModal
          userEmail={userEmail}
          onClose={()=>setModalOpen(false)}
          onCreated={project => { setModalOpen(false); onCreated(project); }}
        />
      )}
    </div>
  );
}
