import { useState, useEffect, useRef } from 'react';
import { C, mono } from '../constants/colors';
import { getAccountsForProjectList, getVoiceProfileForEmail } from '../utils/db';
import { getActiveIntel } from '../utils/assay';

const PROGRESS_KEY_PREFIX = "prospector_outreach_gen_progress_";
const isRateLimit = err => /429|rate.?limit|too many/i.test(err?.message || err || "");

// outreach-intelligence-v1 Section 4 — bulk outreach generation, copying
// AccountsPage.js's reassayAll/assayOneWithRetry pattern directly (the
// audit found no concurrency-limited pattern anywhere in this codebase to
// reuse instead): strictly sequential, 1500ms delay, retry-once-with-
// backoff on rate-limit detection, resumable progress in localStorage.
// Review-first by design - one draft per account, copy-per-account/
// copy-all, no auto-send, no batch Gmail draft creation.
export default function BulkOutreachModal({ business, project, userEmail, activeUser, onClose }) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState([]);
  const [copiedId, setCopiedId] = useState(null);
  const [copiedAll, setCopiedAll] = useState(false);

  const [voiceProfile, setVoiceProfile] = useState(null);

  const stopRef = useRef(false);
  const pauseRef = useRef(false);
  const progressKey = `${PROGRESS_KEY_PREFIX}${project.id}`;

  useEffect(() => {
    getAccountsForProjectList(business.id, project.list_id).then(a => { setAccounts(a); setLoading(false); });
    getVoiceProfileForEmail(userEmail).then(setVoiceProfile);
  }, [business.id, project.list_id, userEmail]);

  const getSavedProgress = () => {
    try {
      const p = JSON.parse(localStorage.getItem(progressKey) || "null");
      if (!p) return null;
      if (Date.now() - p.savedAt > 86400000) { localStorage.removeItem(progressKey); return null; }
      return p;
    } catch { return null; }
  };
  const saveProgress = (completedIndex, total, resultsSoFar) =>
    localStorage.setItem(progressKey, JSON.stringify({ completedIndex, total, results: resultsSoFar, savedAt: Date.now() }));
  const clearProgress = () => localStorage.removeItem(progressKey);

  const generateOneWithRetry = async (acc, customIntel, onStatus) => {
    const run = () => fetch('/api/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: acc.name, businessModel: acc.bm || "", productFit: acc.pf || "",
        useCase: acc.useCase || "", products: acc.prods || [], signals: acc.sigs || [],
        customIntel, web: acc.web,
        businessId: business.id, projectId: project.id, runningUserEmail: userEmail,
        senderName: activeUser?.name || userEmail, messageType: 'cold_outreach', accountKind: acc.accountKind,
      }),
    }).then(async r => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Generation failed');
      return data.email;
    });
    try {
      return { email: await run(), error: null };
    } catch (e1) {
      const wait = isRateLimit(e1) ? 10000 : 3000;
      if (isRateLimit(e1)) onStatus?.("ratelimit");
      await new Promise(r => setTimeout(r, wait));
      onStatus?.("retry");
      try {
        return { email: await run(), error: null };
      } catch (e2) {
        return { email: null, error: e2.message || "unknown error" };
      }
    }
  };

  const runGeneration = async (resumeFrom = 0, resumeResults = []) => {
    setRunning(true);
    setPaused(false);
    stopRef.current = false;
    pauseRef.current = false;

    const customIntel = getActiveIntel();
    const total = accounts.length;
    let acc_results = [...resumeResults];

    for (let i = resumeFrom; i < accounts.length; i++) {
      if (stopRef.current) { clearProgress(); break; }
      if (pauseRef.current) {
        saveProgress(i, total, acc_results);
        setPaused(true);
        setRunning(false);
        setProgress(null);
        return;
      }

      const acc = accounts[i];
      setProgress({ done: i, total, name: acc.name, status: "running" });

      const { email, error } = await generateOneWithRetry(acc, customIntel, (status) => {
        setProgress(p => ({ ...p, status, name: acc.name }));
      });

      acc_results.push({ accountId: acc.id, name: acc.name, email, error });
      setResults([...acc_results]);
      saveProgress(i + 1, total, acc_results);

      if (i < accounts.length - 1) await new Promise(r => setTimeout(r, 1500));
    }

    clearProgress();
    setRunning(false);
    setProgress(null);
  };

  const resume = () => {
    const p = getSavedProgress();
    if (p) runGeneration(p.completedIndex, p.results);
    else runGeneration();
  };

  const pause = () => { pauseRef.current = true; };
  const stop = () => { stopRef.current = true; setRunning(false); setProgress(null); clearProgress(); };

  const copyOne = (r) => {
    navigator.clipboard.writeText(r.email || "");
    setCopiedId(r.accountId);
    setTimeout(() => setCopiedId(null), 1500);
  };
  const copyAll = () => {
    const text = results.filter(r => r.email).map(r => `${r.name}\n${'-'.repeat(r.name.length)}\n${r.email}`).join('\n\n\n');
    navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 1500);
  };

  const savedProgress = !running && !loading ? getSavedProgress() : null;
  const btn = { ...mono, fontSize:11, padding:"6px 14px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:6, color:C.mut, cursor:"pointer" };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }} onClick={onClose}>
      <div style={{ width:640, maxHeight:"80vh", overflowY:"auto", background:C.card, border:`1px solid ${C.brd}`, borderRadius:10, padding:20 }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
          <h2 style={{ ...mono, fontSize:14, color:C.txt, fontWeight:700, margin:0 }}>Generate Outreach — {project.name}</h2>
          <button onClick={onClose} style={{ ...mono, fontSize:16, color:C.dim, background:"transparent", border:"none", cursor:"pointer" }}>×</button>
        </div>

        {loading ? (
          <p style={{ ...mono, fontSize:12, color:C.dim }}>Loading project accounts…</p>
        ) : accounts.length === 0 ? (
          <p style={{ ...mono, fontSize:12, color:C.dim }}>No accounts linked to this project's list yet.</p>
        ) : (
          <>
            <p style={{ ...mono, fontSize:10, color:C.dim, marginBottom:6 }}>
              Project: {project.name} · Voice: {voiceProfile ? (voiceProfile.tone || 'learned') : 'default'}{project.ask_type ? ` · CTA: ${project.ask_type.slice(0, 60)}` : ''}
            </p>
            <p style={{ ...mono, fontSize:11, color:C.dim, marginBottom:14 }}>{accounts.length} account{accounts.length===1?"":"s"}. Review-first — nothing is sent automatically.</p>

            {!running && !results.length && !savedProgress && (
              <button onClick={()=>runGeneration()} style={{ ...btn, background:C.gold, border:`1px solid ${C.gold}`, color:C.bg, fontWeight:700 }}>Generate for all {accounts.length}</button>
            )}

            {savedProgress && !running && (
              <div style={{ marginBottom:14 }}>
                <p style={{ ...mono, fontSize:11, color:C.orange, marginBottom:8 }}>Paused at {savedProgress.completedIndex}/{savedProgress.total} — resume or start over.</p>
                <button onClick={resume} style={{ ...btn, background:C.gold, border:`1px solid ${C.gold}`, color:C.bg, fontWeight:700, marginRight:8 }}>Resume</button>
                <button onClick={()=>{ clearProgress(); setResults([]); runGeneration(); }} style={btn}>Start over</button>
              </div>
            )}

            {running && progress && (
              <div style={{ marginBottom:14 }}>
                <p style={{ ...mono, fontSize:11, color:C.txt, marginBottom:8 }}>
                  {progress.done}/{progress.total} — {progress.status === "ratelimit" ? `rate limited, backing off (${progress.name})` : progress.status === "retry" ? `retrying ${progress.name}…` : `generating for ${progress.name}…`}
                </p>
                <button onClick={pause} style={{ ...btn, marginRight:8 }}>Pause</button>
                <button onClick={stop} style={btn}>Stop</button>
              </div>
            )}

            {results.length > 0 && (
              <>
                <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:10 }}>
                  <button onClick={copyAll} style={btn}>{copiedAll ? "Copied all ✓" : "Copy all"}</button>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  {results.map(r => (
                    <div key={r.accountId} style={{ padding:"10px 12px", background:C.bg, border:`1px solid ${C.brd}`, borderRadius:8 }}>
                      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
                        <span style={{ ...mono, fontSize:12, color:C.txt, fontWeight:700 }}>{r.name}</span>
                        {r.email && <button onClick={()=>copyOne(r)} style={btn}>{copiedId===r.accountId ? "Copied ✓" : "Copy"}</button>}
                      </div>
                      {r.error
                        ? <p style={{ ...mono, fontSize:11, color:C.red, margin:0 }}>⚠ {r.error}</p>
                        : <p style={{ ...mono, fontSize:11, color:C.mut, margin:0, whiteSpace:"pre-wrap", lineHeight:1.5 }}>{r.email}</p>}
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
