import { useState } from 'react';
import { C, mono } from '../constants/colors';
import { createInfluencerAccount, findExistingInfluencerByHandle, linkAccountToLists } from '../utils/db';
import ListCheckboxes from './ListCheckboxes';

const inp = { fontSize:13, padding:"8px 11px", background:C.bg, border:`1.5px solid ${C.brdM}`, borderRadius:6, color:C.txt, outline:"none", width:"100%", boxSizing:"border-box", ...mono };
const btn = { ...mono, fontSize:12, padding:"8px 18px", background:C.gold, border:`1px solid ${C.gold}`, borderRadius:6, color:C.bg, cursor:"pointer", fontWeight:700 };
const ghostBtn = { ...mono, fontSize:12, padding:"7px 14px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:6, color:C.dim, cursor:"pointer" };

// Quick-add (single handle, optional bio -> assesses immediately) and bulk
// add (line-separated handles, no bio - created 'pending', assessed later
// per-account) both create account_kind='influencer' accounts. Dedup keys
// on Instagram handle: a match links the existing account to the chosen
// list(s) instead of creating a duplicate, same "adding via a list either
// creates or links" pattern as CSV import (influencer-accounts-v1).
export default function InfluencerAddModal({ business, userEmail, lists: initialLists, onClose, onAdded }) {
  const [mode, setMode] = useState('single'); // single | bulk
  const [lists, setLists] = useState(initialLists);
  const [selectedListIds, setSelectedListIds] = useState([]);
  const [handle, setHandle] = useState('');
  const [bio, setBio] = useState('');
  const [followerCount, setFollowerCount] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const addOrLink = async (rawHandle) => {
    const existing = await findExistingInfluencerByHandle(business.id, rawHandle);
    if (existing) {
      if (selectedListIds.length) await linkAccountToLists(existing.id, selectedListIds);
      return { linked: true, id: existing.id };
    }
    const { account, error: err } = await createInfluencerAccount(business.id, userEmail, rawHandle, selectedListIds);
    if (err) throw new Error(err);
    return { linked: false, id: account.id };
  };

  const handleSingleSubmit = async () => {
    if (!handle.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const { linked, id } = await addOrLink(handle.trim());
      if (!linked && bio.trim()) {
        await fetch(`/api/businesses/${business.id}/influencer/assess`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId: id, bioText: bio.trim(), followerCount: followerCount ? Number(followerCount) : null }),
        });
      }
      setResult({ mode: 'single', linked, created: linked ? 0 : 1 });
      onAdded?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleBulkSubmit = async () => {
    const rawLines = bulkText.split('\n').map(l => l.trim()).filter(Boolean);
    if (!rawLines.length || busy) return;
    setBusy(true);
    setError('');
    try {
      let created = 0, linked = 0;
      for (const line of rawLines) {
        const { linked: wasLinked } = await addOrLink(line);
        if (wasLinked) linked++; else created++;
      }
      setResult({ mode: 'bulk', created, linked });
      onAdded?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div onClick={e=>{if(e.target===e.currentTarget) onClose();}} style={{ position:"fixed", inset:0, zIndex:1000, background:"#00000099", display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div style={{ background:C.card, border:`1px solid ${C.brd}`, borderRadius:12, padding:"24px 26px", width:480, maxHeight:"85vh", overflowY:"auto", boxShadow:"0 20px 60px #000c" }}>
        <div style={{ display:"flex", alignItems:"center", marginBottom:18 }}>
          <span style={{ ...mono, fontSize:15, color:C.txt, fontWeight:700 }}>Add Influencer(s)</span>
          <button onClick={onClose} style={{ marginLeft:"auto", background:"transparent", border:"none", color:C.mut, fontSize:18, cursor:"pointer" }}>✕</button>
        </div>

        {!result && (
          <div style={{ display:"flex", gap:8, marginBottom:18 }}>
            <button onClick={()=>setMode('single')} style={{ ...ghostBtn, background:mode==='single'?C.gold:"transparent", color:mode==='single'?C.bg:C.dim, borderColor:mode==='single'?C.gold:C.brd, fontWeight:mode==='single'?700:400 }}>Single</button>
            <button onClick={()=>setMode('bulk')} style={{ ...ghostBtn, background:mode==='bulk'?C.gold:"transparent", color:mode==='bulk'?C.bg:C.dim, borderColor:mode==='bulk'?C.gold:C.brd, fontWeight:mode==='bulk'?700:400 }}>Bulk</button>
          </div>
        )}

        {error && <div style={{ ...mono, fontSize:11, color:C.red, marginBottom:14 }}>⚠ {error}</div>}

        {!result && mode === 'single' && (
          <>
            <div style={{ marginBottom:14 }}>
              <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>Instagram handle or URL</div>
              <input value={handle} onChange={e=>setHandle(e.target.value)} placeholder="@handle or instagram.com/handle" style={inp} disabled={busy} />
            </div>
            <div style={{ marginBottom:14 }}>
              <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>Bio (optional — paste to assess now)</div>
              <textarea value={bio} onChange={e=>setBio(e.target.value)} rows={3} placeholder="Paste their bio text — Instagram can't be auto-fetched (confirmed blocked), so this is how the AI gets real content to work from." style={{ ...inp, resize:"vertical" }} disabled={busy} />
            </div>
            <div style={{ marginBottom:14 }}>
              <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>Follower count (optional)</div>
              <input type="number" value={followerCount} onChange={e=>setFollowerCount(e.target.value)} placeholder="e.g. 42000" style={inp} disabled={busy} />
            </div>
            <div style={{ marginBottom:20 }}>
              <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>Lists</div>
              <ListCheckboxes lists={lists} selected={selectedListIds} onToggle={id=>setSelectedListIds(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id])}
                onCreated={{ businessId: business.id, add: l => setLists(prev=>[...prev, l]) }} />
            </div>
            <button onClick={handleSingleSubmit} disabled={!handle.trim()||busy} style={{ ...btn, opacity: handle.trim()?1:0.5 }}>{busy ? "Adding…" : "Add →"}</button>
          </>
        )}

        {!result && mode === 'bulk' && (
          <>
            <div style={{ marginBottom:14 }}>
              <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>One handle or URL per line</div>
              <textarea value={bulkText} onChange={e=>setBulkText(e.target.value)} rows={8} placeholder={"@handle1\n@handle2\ninstagram.com/handle3"} style={{ ...inp, resize:"vertical", fontFamily:"monospace" }} disabled={busy} />
              <p style={{ ...mono, fontSize:10, color:C.dim, margin:"6px 0 0" }}>Created without a bio — add one per account afterward to run the assessment.</p>
            </div>
            <div style={{ marginBottom:20 }}>
              <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>Lists (applied to all)</div>
              <ListCheckboxes lists={lists} selected={selectedListIds} onToggle={id=>setSelectedListIds(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id])}
                onCreated={{ businessId: business.id, add: l => setLists(prev=>[...prev, l]) }} />
            </div>
            <button onClick={handleBulkSubmit} disabled={!bulkText.trim()||busy} style={{ ...btn, opacity: bulkText.trim()?1:0.5 }}>{busy ? "Adding…" : "Add all →"}</button>
          </>
        )}

        {result && (
          <div>
            {result.mode === 'single' ? (
              <p style={{ ...mono, fontSize:13, color:C.green, margin:"0 0 14px" }}>
                {result.linked ? "✓ Linked to the existing account for this handle." : "✓ Influencer account created."}
              </p>
            ) : (
              <p style={{ ...mono, fontSize:13, color:C.green, margin:"0 0 14px" }}>
                ✓ {result.created} new account{result.created!==1?'s':''} created{result.linked > 0 && `, ${result.linked} linked to existing`}
              </p>
            )}
            <button onClick={onClose} style={btn}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}
