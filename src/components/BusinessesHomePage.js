import { useState, useEffect } from 'react';
import { C, mono, PRESET_SWATCH_COLORS } from '../constants/colors';
import { getAccountsForBusiness } from '../utils/db';
import { isStale } from '../utils/staleness';

const STATUS_PILL = {
  researching: { label: 'Researching…', color: C.orange },
  error: { label: 'Error', color: C.red },
};

function CreateBusinessModal({ userEmail, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [tagline, setTagline] = useState('');
  const [color, setColor] = useState(PRESET_SWATCH_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const canSubmit = name.trim() && websiteUrl.trim();

  const handleCreate = async () => {
    if (!canSubmit || saving) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/businesses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          website_url: websiteUrl.trim(),
          tagline: tagline.trim(),
          color,
          owner_email: userEmail,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create business');
      onCreated(data.business);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const inp = { fontSize:13, padding:"8px 11px", background:C.bg, border:`1.5px solid ${C.brdM}`, borderRadius:6, color:C.txt, outline:"none", width:"100%", boxSizing:"border-box", ...mono };
  const label = { ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 };

  return (
    <div onClick={e=>{if(e.target===e.currentTarget) onClose();}} style={{ position:"fixed", inset:0, zIndex:1000, background:"#00000099", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ background:C.card, border:`1px solid ${C.brd}`, borderRadius:12, padding:"22px 26px", width:380, boxShadow:"0 20px 60px #000c" }}>
        <div style={{ display:"flex", alignItems:"center", marginBottom:20 }}>
          <span style={{ ...mono, fontSize:14, color:C.txt, fontWeight:700 }}>New business</span>
          <button onClick={onClose} style={{ marginLeft:"auto", background:"transparent", border:"none", color:C.mut, fontSize:18, cursor:"pointer" }}>✕</button>
        </div>

        <div style={{ marginBottom:16 }}>
          <div style={label}>Name</div>
          <input type="text" placeholder="Acme Co" value={name} onChange={e=>setName(e.target.value)} style={inp} />
        </div>

        <div style={{ marginBottom:16 }}>
          <div style={label}>Website *</div>
          <input
            type="text" placeholder="https://example.com" value={websiteUrl}
            onChange={e=>setWebsiteUrl(e.target.value)}
            onKeyDown={e=>e.key==="Enter" && canSubmit && handleCreate()}
            style={inp}
          />
        </div>

        <div style={{ marginBottom:16 }}>
          <div style={label}>Tagline (optional)</div>
          <input type="text" placeholder="What this business is" value={tagline} onChange={e=>setTagline(e.target.value)} style={inp} />
        </div>

        <div style={{ marginBottom:22 }}>
          <div style={{ ...label, marginBottom:8 }}>Color</div>
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
          <button onClick={handleCreate} disabled={!canSubmit||saving}
            style={{ ...mono, fontSize:12, padding:"7px 20px", background:canSubmit?C.gold:"transparent", border:`1px solid ${canSubmit?C.gold:C.brd}`, borderRadius:6, color:canSubmit?C.bg:C.dim, cursor:canSubmit&&!saving?"pointer":"default", fontWeight:700 }}>
            {saving ? "Creating…" : "Create →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// global-workspace-navigation-v1 Section 5 — cross-business rollup built
// only from real queries (getAccountsForBusiness, already used elsewhere
// for the per-business Accounts tab) rather than fabricated metrics.
// "At risk" reuses the same isStale threshold (90d since last touch) the
// account card itself uses, so the number means the same thing here as
// it does inside a workspace.
function StatTile({ label, value, color }) {
  return (
    <div style={{ padding:"10px 16px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:8, minWidth:100 }}>
      <div style={{ ...mono, fontSize:20, fontWeight:700, color: color || C.txt }}>{value}</div>
      <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", marginTop:2 }}>{label}</div>
    </div>
  );
}

export default function BusinessesHomePage({ businesses, loading, projects=[], userEmail, onSelect, onCreated }) {
  const [modalOpen, setModalOpen] = useState(false);
  const unassignedProjects = projects.filter(p => !p.business_id);
  const [rollup, setRollup] = useState(null);
  const businessIdsKey = businesses.map(b=>b.id).join(',');

  useEffect(() => {
    if (!businesses.length) { setRollup(null); return; }
    let cancelled = false;
    Promise.all(businesses.map(b => getAccountsForBusiness(b.id).then(accs => ({ id: b.id, accs }))))
      .then(results => {
        if (cancelled) return;
        let total = 0, atRisk = 0;
        const perBusiness = {};
        results.forEach(({ id, accs }) => {
          const risk = accs.filter(a => isStale(a.lastTouchedAt)).length;
          total += accs.length;
          atRisk += risk;
          perBusiness[id] = { total: accs.length, atRisk: risk };
        });
        setRollup({ total, atRisk, perBusiness });
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessIdsKey]);

  const researchingCount = businesses.filter(b=>b.research_status==='researching').length;

  return (
    <div style={{ minHeight:"100vh", background:C.bg, padding:"48px 40px" }}>
      <div style={{ maxWidth:900, margin:"0 auto" }}>
        <h1 style={{ ...mono, fontSize:20, color:C.txt, fontWeight:700, margin:"0 0 24px" }}>Businesses</h1>

        {rollup && (
          <div style={{ display:"flex", gap:12, marginBottom:24, flexWrap:"wrap" }}>
            <StatTile label="Total Accounts" value={rollup.total} />
            <StatTile label="Accounts At Risk" value={rollup.atRisk} color={rollup.atRisk>0?C.red:C.green} />
            {researchingCount > 0 && <StatTile label="Still Researching" value={researchingCount} color={C.orange} />}
          </div>
        )}

        {loading ? (
          <p style={{ ...mono, fontSize:13, color:C.dim, margin:"0 0 20px" }}>Loading…</p>
        ) : businesses.length === 0 && (
          <p style={{ ...mono, fontSize:13, color:C.dim, margin:"0 0 20px" }}>
            No businesses yet. Add your first one below.
          </p>
        )}

        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(220px, 1fr))", gap:16 }}>
          {businesses.map(b => {
            const pill = STATUS_PILL[b.research_status];
            const atRisk = rollup?.perBusiness?.[b.id]?.atRisk || 0;
            return (
              <button key={b.id} onClick={()=>onSelect(b)}
                style={{
                  display:"flex", flexDirection:"column", justifyContent:"flex-end", height:140,
                  borderRadius:10, border:`1px solid ${C.brd}`, borderLeft:`4px solid ${b.color||C.gold}`,
                  background:`linear-gradient(160deg, ${b.color||C.gold}33, ${C.card})`,
                  padding:16, cursor:"pointer", textAlign:"left", position:"relative",
                }}
              >
                <div style={{ position:"absolute", top:16, right:16, width:32, height:32, borderRadius:6, background:b.color||C.gold, display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <span style={{ ...mono, fontSize:14, color:C.bg, fontWeight:700 }}>{(b.name||'?')[0].toUpperCase()}</span>
                </div>
                {atRisk > 0 && (
                  <span title={`${atRisk} account${atRisk===1?'':'s'} not touched in 90+ days`} style={{ ...mono, position:"absolute", top:16, right:56, fontSize:9, padding:"2px 6px", borderRadius:9, background:`${C.red}18`, border:`1px solid ${C.red}44`, color:C.red }}>
                    ⚠ {atRisk}
                  </span>
                )}
                {pill && (
                  <span style={{ ...mono, fontSize:9, padding:"2px 7px", borderRadius:9, background:`${pill.color}18`, border:`1px solid ${pill.color}44`, color:pill.color, alignSelf:"flex-start", marginBottom:6 }}>
                    {pill.label}
                  </span>
                )}
                <span style={{ ...mono, fontSize:14, color:C.txt, fontWeight:700 }}>{b.name}</span>
                {b.tagline && (
                  <span style={{ ...mono, fontSize:11, color:C.dim, marginTop:4, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{b.tagline}</span>
                )}
              </button>
            );
          })}

          <button onClick={()=>setModalOpen(true)}
            style={{ display:"flex", alignItems:"center", justifyContent:"center", height:140, borderRadius:10, border:`1.5px dashed ${C.brd}`, background:"transparent", cursor:"pointer" }}>
            <span style={{ ...mono, fontSize:13, color:C.dim, fontWeight:600 }}>+ New Business</span>
          </button>
        </div>

        {unassignedProjects.length > 0 && (
          <div style={{ marginTop:32 }}>
            <h2 style={{ ...mono, fontSize:13, color:C.dim, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", margin:"0 0 12px" }}>Unassigned Projects</h2>
            <p style={{ ...mono, fontSize:11, color:C.dim, margin:"0 0 12px" }}>
              These projects predate business-level tracking and aren't linked to a business yet.
            </p>
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {unassignedProjects.map(p => (
                <div key={p.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 12px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:8 }}>
                  <span style={{ width:10, height:10, borderRadius:"50%", background:p.color||C.gold, flexShrink:0 }} />
                  <span style={{ ...mono, fontSize:13, color:C.txt, flex:1 }}>{p.name}</span>
                  <span style={{ ...mono, fontSize:9, padding:"2px 7px", borderRadius:9, background:`${C.dim}18`, border:`1px solid ${C.dim}44`, color:C.dim }}>Unassigned</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {modalOpen && (
        <CreateBusinessModal
          userEmail={userEmail}
          onClose={()=>setModalOpen(false)}
          onCreated={business => { setModalOpen(false); onCreated(business); }}
        />
      )}
    </div>
  );
}
