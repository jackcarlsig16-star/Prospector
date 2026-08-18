import { useState } from 'react';
import { C, mono } from '../../constants/colors';
import { getActiveVoice, getVoiceProfile, BDR_DEFAULT_VOICE } from '../../constants/voice';
import { getActiveIntel } from '../../utils/assay';
import { searchDomain, findEmail, extractHunterDomain } from '../../utils/hunter';

const DEMO_EMAIL_SUBJECT = "Bank connectivity for Prospect Co.";
const DEMO_EMAIL_BODY = `Hey Alex,

Saw you're building out your B2B payments platform — the embedded bank account verification piece is exactly where we see teams like yours run into friction at scale.

Our product can handle instant account verification and ACH risk scoring in one integration. A few of your peers in the B2B payments space have cut onboarding drop-off significantly after switching.

Worth a 20-minute call to see if it's a fit?

- [Your Name]`;

const DEMO_LI_MSG = `Hi Alex — saw Prospect Co. is building out B2B payments. We work with teams in this space on embedded bank verification (Auth + ACH risk scoring). Worth connecting?`;

export default function FrontierEmailPanel({ entry, onClose, activeUser, onLogSent }) {
  const isDemo = !!entry?.isDemo;
  const [mode, setMode]       = useState("email");
  const [subject, setSubject] = useState(isDemo ? DEMO_EMAIL_SUBJECT : `Intro + ${entry?.name||""}`);
  const [body, setBody]       = useState(isDemo ? DEMO_EMAIL_BODY : "");
  const [liMsg, setLiMsg]     = useState(isDemo ? DEMO_LI_MSG : "");
  const [loading, setLoading] = useState(false);
  const [liLoading, setLiLoading] = useState(false);
  const [copied, setCopied]   = useState(false);
  const [toast, setToast]     = useState("");

  const toName    = entry?.contactName  || "First Name";
  const toTitle   = entry?.contactTitle || "";
  const toDisplay = toName + (toTitle ? ` — ${toTitle}` : "") + `, ${entry?.name||""}`;

  // ── Hunter.io contact finder ────────────────────────────────────────────
  const [hunterContact, setHunterContact] = useState(null); // { email, firstName, lastName, position, score? }
  const [hunterOpen, setHunterOpen]       = useState(false);
  const [hunterLoading, setHunterLoading] = useState(false);
  const [hunterContacts, setHunterContacts] = useState([]);
  const [hunterError, setHunterError]     = useState("");
  const [hunterManual, setHunterManual]   = useState(false);
  const [manualFirst, setManualFirst]     = useState("");
  const [manualLast,  setManualLast]      = useState("");
  const hunterDomain = extractHunterDomain(entry?.web || entry?.website || "");

  const runDomainSearch = async () => {
    if (!hunterDomain) { setHunterError("No website on this account"); setHunterOpen(true); return; }
    setHunterLoading(true); setHunterError(""); setHunterContacts([]); setHunterManual(false); setHunterOpen(true);
    const res = await searchDomain({ domain: hunterDomain, department: 'sales,executive,management', limit: 5 });
    if (res.error) setHunterError(res.error);
    const contacts = res.contacts || [];
    setHunterContacts(contacts);
    if (!contacts.length && !res.error) setHunterManual(true);
    setHunterLoading(false);
  };

  const runManualFind = async () => {
    if (!hunterDomain || !manualFirst.trim() || !manualLast.trim()) return;
    setHunterLoading(true); setHunterError("");
    const res = await findEmail({ domain: hunterDomain, firstName: manualFirst, lastName: manualLast });
    setHunterLoading(false);
    if (res.error || !res.email) { setHunterError(res.error || "No match found"); return; }
    pickContact({
      email: res.email, firstName: res.firstName || manualFirst, lastName: res.lastName || manualLast,
      position: res.position || "", confidence: res.score ?? null,
    });
  };

  const pickContact = (c) => {
    setHunterContact(c); setHunterOpen(false);
    // Swap the greeting first name in the body if it opens with Hi/Hey/Hello + a word
    if (c.firstName) {
      setBody(prev => prev.replace(/^(\s*(?:Hi|Hey|Hello|Dear)\s+)([A-Za-z][A-Za-z\-']*)(,|\s)/, `$1${c.firstName}$3`));
    }
  };

  const showToast = (msg) => { setToast(msg); setTimeout(()=>setToast(""),2500); };

  const senderName = activeUser?.name || JSON.parse(localStorage.getItem("prospector_user")||"{}").name || "AE";
  const isBDR = activeUser?.role === "BDR";

  const generate = () => {
    if(isDemo){ setBody(DEMO_EMAIL_BODY); setSubject(DEMO_EMAIL_SUBJECT); return; }
    setLoading(true); setBody("");
    fetch("/api/email",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      name:entry.name, businessModel:entry.bm||"", productFit:entry.pf||"",
      useCase:entry.useCase||"", products:entry.products||[],
      personaName:entry.contactName||"", personaTitle:entry.contactTitle||"",
      customIntel:getActiveIntel(), senderName, voiceExamples:getActiveVoice(senderName), voiceProfile:getVoiceProfile(senderName, isBDR ? BDR_DEFAULT_VOICE : undefined),
      signals:entry.signals||[], directive:entry.note||"", web:entry.web||entry.website||"",
    })}).then(r=>r.json()).then(d=>{
      const raw = d.email || d.error || "Failed.";
      const m = raw.match(/^\s*Subject:\s*(.+?)\r?\n\r?\n([\s\S]*)$/);
      if (m) { setSubject(m[1].trim()); setBody(m[2].trim()); }
      else   { setBody(raw); }
      setLoading(false);
    }).catch(e=>{setBody("Error: "+e.message);setLoading(false);});
  };

  const generateLi = () => {
    if(isDemo){ setLiMsg(DEMO_LI_MSG); return; }
    setLiLoading(true); setLiMsg("");
    fetch("/api/email",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      name:entry.name, businessModel:entry.bm||"", productFit:entry.pf||"",
      useCase:entry.useCase||"", products:entry.products||[],
      personaName:entry.contactName||"", personaTitle:entry.contactTitle||"",
      customIntel:getActiveIntel(), senderName, voiceExamples:getActiveVoice(senderName), voiceProfile:getVoiceProfile(senderName, isBDR ? BDR_DEFAULT_VOICE : undefined),
      signals:entry.signals||[], directive:entry.note||"", web:entry.web||entry.website||"",
      format:"linkedin_note",
    })}).then(r=>r.json()).then(d=>{
      const raw = d.email || "";
      const cleaned = raw.split("\n").filter(l => !/^\s*Subject:/i.test(l)).join("\n").trim();
      setLiMsg(cleaned.slice(0, 300));
      setLiLoading(false);
    }).catch(e=>{setLiMsg("Error: "+e.message);setLiLoading(false);});
  };

  const copy = () => {
    const txt = mode==="linkedin" ? liMsg : `Subject: ${subject}\n\n${body}`;
    navigator.clipboard.writeText(txt); setCopied(true); setTimeout(()=>setCopied(false),2000);
  };

  const G="#D4A96A"; const GB="#1E1A10"; const DIM="#8C7A5A"; const BRD="#3A3020";
  const LI="#4A9AE8";
  return (
    <div style={{ background:"#0E0C08", border:`1px solid ${G}44`, borderRadius:8, padding:"14px 16px", marginTop:8 }}>
      {toast&&<div style={{ position:"fixed", bottom:24, right:24, background:"#1A1D22", border:`1px solid ${G}66`, borderRadius:8, padding:"10px 16px", zIndex:3000, color:G, fontSize:13, fontFamily:"monospace" }}>{toast}</div>}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
        <div style={{ display:"flex", gap:6 }}>
          {[["email","✉ Email"],["linkedin","in LinkedIn"]].map(([m,lb])=>(
            <button key={m} onClick={()=>{ setMode(m); if(m==="linkedin"&&!liMsg&&!liLoading) generateLi(); }}
              style={{ ...mono, fontSize:11, padding:"4px 11px", background:mode===m?(m==="linkedin"?"#0D1A2A":GB):"transparent", border:`1px solid ${mode===m?(m==="linkedin"?LI:G):BRD}`, color:mode===m?(m==="linkedin"?LI:G):DIM, borderRadius:4, cursor:"pointer" }}>{lb}</button>
          ))}
        </div>
        <button onClick={onClose} style={{ background:"transparent", border:"none", color:DIM, fontSize:16, cursor:"pointer", lineHeight:1 }}>✕</button>
      </div>

      {mode==="email"&&(<>
        <div style={{ display:"flex", gap:8, marginBottom:8, alignItems:"center", position:"relative" }}>
          <span style={{ ...mono, fontSize:10, color:DIM, flexShrink:0, width:48 }}>TO</span>
          <span style={{ ...mono, fontSize:11, color: hunterContact ? "#7EC87E" : "#C8B890", flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {hunterContact
              ? `${hunterContact.firstName||""} ${hunterContact.lastName||""}`.trim() + (hunterContact.position ? ` · ${hunterContact.position}` : "") + ` · ${hunterContact.email}`
              : toDisplay}
          </span>
          <button onClick={runDomainSearch}
            style={{ ...mono, fontSize:10, padding:"3px 9px", background:"transparent", border:`1px solid ${G}55`, color:G, borderRadius:4, cursor:"pointer", flexShrink:0 }}>
            🔍 Find contact
          </button>
        </div>

        {hunterOpen && (
          <div style={{ marginBottom:10, background:"#0A0A0A", border:`1px solid ${G}44`, borderRadius:6, padding:"10px 12px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
              <span style={{ ...mono, fontSize:9, color:G, letterSpacing:"0.08em", textTransform:"uppercase", flex:1 }}>
                ⛏ Hunter · {hunterDomain || "no domain"}
              </span>
              <button onClick={()=>setHunterOpen(false)} style={{ background:"transparent", border:"none", color:DIM, fontSize:13, cursor:"pointer", lineHeight:1 }}>✕</button>
            </div>
            {hunterLoading && <p style={{ ...mono, margin:0, fontSize:11, color:DIM }}>Searching…</p>}
            {!hunterLoading && hunterError && <p style={{ ...mono, margin:0, fontSize:11, color:"#F06060" }}>⚠ {hunterError}</p>}
            {!hunterLoading && !hunterError && hunterContacts.length > 0 && (
              <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                {hunterContacts.map((c,i) => (
                  <button key={i} onClick={()=>pickContact(c)}
                    style={{ ...mono, fontSize:11, padding:"7px 10px", background:"#1A1608", border:`1px solid ${BRD}`, borderRadius:5, color:"#E8D9BC", cursor:"pointer", textAlign:"left", display:"flex", alignItems:"center", gap:10 }}
                    onMouseEnter={e=>e.currentTarget.style.borderColor = G}
                    onMouseLeave={e=>e.currentTarget.style.borderColor = BRD}>
                    <span style={{ fontWeight:600, color:"#F5EDD6", minWidth:120, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {`${c.firstName||""} ${c.lastName||""}`.trim() || "(no name)"}
                    </span>
                    <span style={{ color:DIM, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{c.position || "—"}</span>
                    <span style={{ color:G, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{c.email}</span>
                    {c.confidence != null && <span style={{ color:c.confidence >= 80 ? "#7EC87E" : c.confidence >= 50 ? "#F5A623" : "#F06060", fontSize:10, flexShrink:0 }}>{c.confidence}%</span>}
                  </button>
                ))}
              </div>
            )}
            {!hunterLoading && hunterManual && (
              <div style={{ marginTop:8 }}>
                <p style={{ ...mono, margin:"0 0 8px", fontSize:10, color:DIM }}>No contacts found for this domain. Try a specific name:</p>
                <div style={{ display:"flex", gap:6 }}>
                  <input value={manualFirst} onChange={e=>setManualFirst(e.target.value)} placeholder="First name"
                    style={{ ...mono, flex:1, fontSize:11, padding:"5px 9px", background:"#1A1608", border:`1px solid ${BRD}`, borderRadius:4, color:"#E8D9BC", outline:"none" }}/>
                  <input value={manualLast} onChange={e=>setManualLast(e.target.value)} placeholder="Last name"
                    onKeyDown={e=>{ if (e.key === 'Enter') runManualFind(); }}
                    style={{ ...mono, flex:1, fontSize:11, padding:"5px 9px", background:"#1A1608", border:`1px solid ${BRD}`, borderRadius:4, color:"#E8D9BC", outline:"none" }}/>
                  <button onClick={runManualFind} disabled={!manualFirst.trim() || !manualLast.trim() || hunterLoading}
                    style={{ ...mono, fontSize:11, padding:"5px 12px", background:`${G}18`, border:`1px solid ${G}55`, color:G, borderRadius:4, cursor:"pointer" }}>
                    Find →
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ display:"flex", gap:8, marginBottom:8, alignItems:"center" }}>
          <span style={{ ...mono, fontSize:10, color:DIM, flexShrink:0, width:48 }}>SUBJ</span>
          <input value={subject} onChange={e=>setSubject(e.target.value)}
            style={{ ...mono, flex:1, fontSize:11, padding:"3px 8px", background:"#1A1608", border:`1px solid ${BRD}`, borderRadius:4, color:"#E8D9BC", outline:"none" }}/>
        </div>
        {loading
          ? <p style={{ ...mono, fontSize:12, color:"#6A5A3A", padding:"16px 0" }}>⬡ Generating with website context…</p>
          : <textarea value={body} onChange={e=>setBody(e.target.value)} rows={9}
              style={{ width:"100%", fontSize:12, lineHeight:1.8, background:"#1A1608", border:`1px solid ${BRD}`, borderRadius:5, color:"#E8D9BC", padding:"10px 12px", resize:"vertical", outline:"none", fontFamily:"inherit", boxSizing:"border-box" }}/>
        }
        <div style={{ display:"flex", gap:7, marginTop:10, flexWrap:"wrap" }}>
          <button onClick={generate} disabled={loading} style={{ ...mono, fontSize:11, padding:"5px 12px", background:body?GB:`${G}18`, border:`1px solid ${body?BRD:`${G}88`}`, color:body?DIM:G, borderRadius:5, cursor:"pointer", fontWeight:body?400:600 }}>{body ? "↺ Regenerate" : "✦ Generate email"}</button>
          <button onClick={copy} disabled={loading} style={{ ...mono, fontSize:11, padding:"5px 12px", background:GB, border:`1px solid ${BRD}`, color:copied?"#7EC87E":DIM, borderRadius:5, cursor:"pointer" }}>{copied?"✓ Copied":"Copy"}</button>
          {onLogSent&&<button onClick={()=>{ if(body.trim()) onLogSent(`Subject: ${subject}\n\n${body}`); }} disabled={loading||!body.trim()} style={{ ...mono, fontSize:11, padding:"5px 14px", background:`${G}18`, border:`1px solid ${G}88`, color:G, borderRadius:5, cursor:"pointer", fontWeight:600 }}>✓ Log as Sent</button>}
          <div style={{ flex:1 }}/>
          <button onClick={()=>{
            const to=hunterContact?.email||"";
            const su=encodeURIComponent(subject);
            const bd=encodeURIComponent(body);
            const url=`https://mail.google.com/mail/?view=cm&fs=1${to?`&to=${encodeURIComponent(to)}`:""}&su=${su}&body=${bd}`;
            window.open(url,"_blank");
          }} style={{ ...mono, fontSize:11, padding:"5px 14px", background:"#0D1A2A", border:"1px solid #1E4A7A", color:LI, borderRadius:5, cursor:"pointer", fontWeight:500 }}>Send via Gmail →</button>
        </div>
      </>)}

      {mode==="linkedin"&&(<>
        <div style={{ display:"flex", gap:8, marginBottom:8, alignItems:"center" }}>
          <span style={{ ...mono, fontSize:10, color:DIM, flexShrink:0, width:48 }}>TO</span>
          <span style={{ ...mono, fontSize:11, color:"#C8B890" }}>{toName}{toTitle?`, ${toTitle}`:""}</span>
        </div>
        <p style={{ ...mono, margin:"0 0 6px", fontSize:10, color:DIM }}>LinkedIn connection note (max ~300 chars)</p>
        {liLoading
          ? <p style={{ ...mono, fontSize:12, color:"#6A5A3A", padding:"16px 0" }}>⬡ Generating with website context…</p>
          : <textarea value={liMsg} onChange={e=>setLiMsg(e.target.value)} rows={5}
              style={{ width:"100%", fontSize:12, lineHeight:1.7, background:"#0D1A2A", border:`1px solid #1E3A5A`, borderRadius:5, color:"#C8D8F0", padding:"10px 12px", resize:"vertical", outline:"none", fontFamily:"inherit", boxSizing:"border-box" }}/>
        }
        <div style={{ display:"flex", gap:4, marginTop:4, marginBottom:8 }}>
          <span style={{ ...mono, fontSize:10, color:liMsg.length>300?C.red:DIM }}>{liMsg.length}/300</span>
        </div>
        <div style={{ display:"flex", gap:7, flexWrap:"wrap" }}>
          <button onClick={generateLi} disabled={liLoading} style={{ ...mono, fontSize:11, padding:"5px 12px", background:liMsg?"#0D1A2A":`${LI}18`, border:`1px solid ${liMsg?"#1E3A5A":`${LI}88`}`, color:liMsg?DIM:LI, borderRadius:5, cursor:"pointer", fontWeight:liMsg?400:600 }}>{liMsg ? "↺ Regenerate" : "✦ Generate message"}</button>
          <button onClick={copy} disabled={liLoading} style={{ ...mono, fontSize:11, padding:"5px 12px", background:"#0D1A2A", border:`1px solid #1E3A5A`, color:copied?"#7EC87E":DIM, borderRadius:5, cursor:"pointer" }}>{copied?"✓ Copied":"Copy"}</button>
          <div style={{ flex:1 }}/>
          <button onClick={()=>{
            const keywords=encodeURIComponent(`${entry.contactName||""} ${entry.name||""}`.trim());
            window.open(`https://www.linkedin.com/search/results/people/?keywords=${keywords}`,"_blank");
          }} style={{ ...mono, fontSize:11, padding:"5px 14px", background:"#0D1A2A", border:`1px solid ${LI}66`, color:LI, borderRadius:5, cursor:"pointer", fontWeight:500 }}>Send via LinkedIn →</button>
        </div>
      </>)}
    </div>
  );
}
