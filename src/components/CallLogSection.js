import { useState, useEffect, useRef, useMemo } from 'react';
import { C, mono } from '../constants/colors';
import { getAccountsForBusiness } from '../utils/db';

const PLATFORM_LABEL = { manual: 'Manual', zoom: 'Zoom', google_meet: 'Google Meet' };
const PLATFORM_ICON = { manual: '✎', zoom: '◉', google_meet: '◈' };

const inp = { fontSize:13, padding:"8px 11px", background:C.bg, border:`1.5px solid ${C.brdM}`, borderRadius:6, color:C.txt, outline:"none", width:"100%", boxSizing:"border-box", ...mono };
const btn = { ...mono, fontSize:12, padding:"7px 18px", background:C.gold, border:`1px solid ${C.gold}`, borderRadius:6, color:C.bg, cursor:"pointer", fontWeight:700 };
const smallBtn = { ...mono, fontSize:11, padding:"5px 12px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:6, color:C.mut, cursor:"pointer" };
const select = { ...mono, fontSize:11, padding:"5px 8px", background:C.bg, border:`1px solid ${C.brdM}`, borderRadius:6, color:C.txt, outline:"none" };

const fmtDate = iso => { try { return new Date(iso).toLocaleString("en-US", { month:"short", day:"numeric", year:"numeric" }); } catch { return "—"; } };
const fmtDuration = secs => { if (!secs) return null; const m = Math.round(secs / 60); return `${m} min`; };

// Best-effort transcript-header participant parse (Phase 3). Looks for
// "Name <email@domain>" style pairs in the first chunk of text - real
// transcript export formats vary a lot, so this is a starting point the
// user edits before submit, not something depended on to be correct.
function parseParticipants(text) {
  const head = text.slice(0, 800);
  const matches = [...head.matchAll(/([A-Za-z][A-Za-z .'\-]{1,40}?)\s*<([^<>@\s]+@[^<>@\s]+)>/g)];
  const seen = new Set();
  const out = [];
  for (const m of matches) {
    const email = m[2].toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);
    out.push({ name: m[1].trim(), email });
  }
  return out;
}

function ParticipantEditor({ participants, setParticipants }) {
  const update = (i, field, value) => setParticipants(ps => ps.map((p, idx) => idx === i ? { ...p, [field]: value } : p));
  const remove = i => setParticipants(ps => ps.filter((_, idx) => idx !== i));
  const add = () => setParticipants(ps => [...ps, { name: '', email: '' }]);

  return (
    <div style={{ marginBottom:12 }}>
      <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>Participants (optional)</div>
      {participants.map((p, i) => (
        <div key={i} style={{ display:"flex", gap:6, marginBottom:6 }}>
          <input placeholder="Name" value={p.name} onChange={e=>update(i,'name',e.target.value)} style={{ ...inp, flex:1 }} />
          <input placeholder="email@company.com" value={p.email} onChange={e=>update(i,'email',e.target.value)} style={{ ...inp, flex:1 }} />
          <button onClick={()=>remove(i)} style={{ ...smallBtn, padding:"5px 10px" }}>✕</button>
        </div>
      ))}
      <button onClick={add} style={smallBtn}>+ Add participant</button>
    </div>
  );
}

function CallLogForm({ business, userEmail, onFiled }) {
  const [transcript, setTranscript] = useState('');
  const [platform, setPlatform] = useState('manual');
  const [callDate, setCallDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [durationMinutes, setDurationMinutes] = useState('');
  const [participants, setParticipants] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  const handleTranscriptChange = text => {
    setTranscript(text);
    if (participants.length === 0 && text.trim()) {
      const parsed = parseParticipants(text);
      if (parsed.length) setParticipants(parsed);
    }
  };

  const handleFile = file => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => handleTranscriptChange(String(e.target.result || ''));
    reader.readAsText(file);
  };

  const handleSubmit = async () => {
    if (!transcript.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch(`/api/businesses/${business.id}/call-log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: transcript.trim(),
          call_platform: platform,
          // Anchor to local noon before converting - new Date('YYYY-MM-DD')
          // parses as UTC midnight, which rolls back to the previous
          // calendar day once rendered in any timezone behind UTC (caught
          // live via browser test: picking "08/14" filed and displayed as
          // "Aug 13").
          call_date: callDate ? new Date(`${callDate}T12:00:00`).toISOString() : undefined,
          call_duration_seconds: durationMinutes ? Math.round(Number(durationMinutes) * 60) : undefined,
          call_participants: participants.filter(p => p.email.trim()),
          created_by: userEmail,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to log call');
      setResult(data);
      setTranscript('');
      setParticipants([]);
      setDurationMinutes('');
      onFiled();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ marginBottom:20 }}>
      <div style={{ display:"flex", gap:8, marginBottom:10 }}>
        <select value={platform} onChange={e=>setPlatform(e.target.value)} style={select}>
          {Object.entries(PLATFORM_LABEL).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input type="date" value={callDate} onChange={e=>setCallDate(e.target.value)} style={{ ...select, width:150 }} />
        <input type="number" min="0" placeholder="Duration (min)" value={durationMinutes} onChange={e=>setDurationMinutes(e.target.value)} style={{ ...select, width:130 }} />
        <button onClick={()=>fileRef.current?.click()} style={smallBtn}>Upload file</button>
        <input ref={fileRef} type="file" accept=".txt,.vtt,.srt,text/plain" style={{ display:"none" }} onChange={e=>handleFile(e.target.files[0])} />
      </div>

      <textarea
        placeholder="Paste call transcript…" value={transcript} onChange={e=>handleTranscriptChange(e.target.value)}
        rows={6} style={{ ...inp, resize:"vertical", marginBottom:12 }}
      />

      <ParticipantEditor participants={participants} setParticipants={setParticipants} />

      {error && <div style={{ ...mono, fontSize:11, color:C.red, marginBottom:8 }}>⚠ {error}</div>}
      {result && (
        <div style={{ ...mono, fontSize:11, color:C.green, marginBottom:8 }}>
          ✓ Logged — {result.matched ? `matched to ${result.accountName || 'account'}` : 'unmatched, held for confirmation below'}
        </div>
      )}
      <button onClick={handleSubmit} disabled={!transcript.trim()||submitting} style={{ ...btn, opacity:transcript.trim()?1:0.5 }}>
        {submitting ? "Logging…" : "Log Call"}
      </button>
    </div>
  );
}

function ReassignRow({ entry, accounts, projects, businessId, userEmail, onReassigned }) {
  const [saving, setSaving] = useState(false);

  const handleChange = async (field, value) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/businesses/${businessId}/call-log/${entry.id}/reassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: field === 'account_id' ? (value || null) : (entry.account_id || null),
          project_id: field === 'project_id' ? (value || null) : (entry.project_id || null),
          created_by: userEmail,
        }),
      });
      const data = await res.json();
      if (res.ok) onReassigned(data.entry);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display:"flex", gap:8, marginTop:8, opacity:saving?0.6:1 }}>
      <select value={entry.account_id || ''} onChange={e=>handleChange('account_id', e.target.value)} style={select} disabled={saving}>
        <option value="">— no account —</option>
        {accounts.map(a => <option key={a.id} value={a.id}>{a.name || '(unnamed)'}</option>)}
      </select>
      <select value={entry.project_id || ''} onChange={e=>handleChange('project_id', e.target.value)} style={select} disabled={saving}>
        <option value="">— no project —</option>
        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </div>
  );
}

function CallLogList({ entries, business, projects, userEmail, onReassigned }) {
  const [accounts, setAccounts] = useState([]);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => { getAccountsForBusiness(business.id).then(setAccounts); }, [business.id]);

  const accountName = useMemo(() => {
    const map = {};
    accounts.forEach(a => { map[a.id] = a.name || '(unnamed)'; });
    return map;
  }, [accounts]);
  const projectName = useMemo(() => {
    const map = {};
    projects.forEach(p => { map[p.id] = p.name; });
    return map;
  }, [projects]);

  if (entries.length === 0) {
    return <p style={{ ...mono, fontSize:12, color:C.dim, margin:0 }}>No calls logged yet.</p>;
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
      {entries.map(entry => {
        const matched = !!entry.account_id;
        const expanded = expandedId === entry.id;
        const summary = entry.content.length > 160 ? `${entry.content.slice(0, 160)}…` : entry.content;
        return (
          <div key={entry.id} style={{ padding:"10px 12px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:8 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6, flexWrap:"wrap" }}>
              <span style={{ ...mono, fontSize:9, padding:"2px 7px", borderRadius:9, background:`${C.purple}18`, border:`1px solid ${C.purple}44`, color:C.purple }}>
                {PLATFORM_ICON[entry.call_platform] || '☎'} {PLATFORM_LABEL[entry.call_platform] || entry.call_platform || 'Call'}
              </span>
              <span style={{ ...mono, fontSize:10, color:C.dim }}>{fmtDate(entry.call_date || entry.created_at)}</span>
              {fmtDuration(entry.call_duration_seconds) && <span style={{ ...mono, fontSize:10, color:C.dim }}>{fmtDuration(entry.call_duration_seconds)}</span>}
              <span style={{ ...mono, fontSize:9, padding:"2px 7px", borderRadius:9, background: matched ? `${C.green}18` : `${C.orange}18`, border:`1px solid ${matched ? C.green : C.orange}44`, color: matched ? C.green : C.orange }}>
                {matched ? (accountName[entry.account_id] || 'Matched') : 'Unmatched'}
              </span>
              {entry.project_id && projectName[entry.project_id] && (
                <span style={{ ...mono, fontSize:9, padding:"2px 7px", borderRadius:9, background:`${C.blue}18`, border:`1px solid ${C.blue}44`, color:C.blue }}>
                  {projectName[entry.project_id]}
                </span>
              )}
              {(entry.call_participants || []).length > 0 && (
                <span style={{ ...mono, fontSize:10, color:C.dim }}>{entry.call_participants.map(p=>p.name||p.email).join(', ')}</span>
              )}
            </div>
            <p style={{ ...mono, fontSize:12, color:C.txt, margin:0, whiteSpace:"pre-wrap", cursor:"pointer" }} onClick={()=>setExpandedId(expanded ? null : entry.id)}>
              {expanded ? entry.content : summary}
              {!expanded && entry.content.length > 160 && <span style={{ color:C.dim }}> (click to expand)</span>}
            </p>
            <ReassignRow entry={entry} accounts={accounts} projects={projects} businessId={business.id} userEmail={userEmail}
              onReassigned={updated => onReassigned(entry.id, updated)} />
          </div>
        );
      })}
    </div>
  );
}

export default function CallLogSection({ business, userEmail, intelEntries, projects=[], onReload }) {
  const [open, setOpen] = useState(false);
  const [localEntries, setLocalEntries] = useState(null);

  const callEntries = (localEntries || intelEntries)
    .filter(e => e.source_type === 'call')
    .sort((a, b) => new Date(b.call_date || b.created_at) - new Date(a.call_date || a.created_at));

  const handleReassigned = (entryId, updated) => {
    setLocalEntries((localEntries || intelEntries).map(e => e.id === entryId ? { ...e, ...updated } : e));
  };

  return (
    <div style={{ marginBottom:32 }}>
      <button onClick={()=>setOpen(o=>!o)} style={{ ...mono, fontSize:12, color:C.dim, background:"transparent", border:"none", cursor:"pointer", padding:0, marginBottom:10 }}>
        {open ? "▾" : "▸"} Call Log ({callEntries.length})
      </button>
      {open && (
        <div>
          <CallLogForm business={business} userEmail={userEmail} onFiled={()=>{ setLocalEntries(null); onReload(); }} />
          <CallLogList entries={callEntries} business={business} projects={projects} userEmail={userEmail} onReassigned={handleReassigned} />
        </div>
      )}
    </div>
  );
}
