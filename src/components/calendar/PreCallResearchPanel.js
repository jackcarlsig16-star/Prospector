import { useState, useRef, useEffect } from 'react';
import { C, mono } from '../../constants/colors';
import { MODELS } from '../../config/models';
import { INDUSTRIES as CAL_VERTS } from '../../constants/industries';

export default function PreCallResearchPanel({ ev, extAtt, existing, onSave, onClose }) {
  const [context,      setContext]      = useState(existing?.context || "");
  const [vertical,     setVertical]     = useState(existing?.vertical || "");
  const [subVertical,  setSubVertical]  = useState(existing?.subVertical || "");
  const [vertManually, setVertManually] = useState(false);
  const [detecting,    setDetecting]    = useState(false);
  const [autoDetected, setAutoDetected] = useState(!!existing?.vertical);
  const detectTimer = useRef(null);

  const primaryAtt = extAtt[0] || null;
  const startFmt   = ev.start?.dateTime
    ? new Date(ev.start.dateTime).toLocaleString([], { weekday:"short", month:"short", day:"numeric", hour:"numeric", minute:"2-digit" })
    : "";

  useEffect(() => {
    if (vertManually || context.length < 20) return;
    if (detectTimer.current) clearTimeout(detectTimer.current);
    detectTimer.current = setTimeout(async () => {
      setDetecting(true);
      try {
        const resp = await fetch("/proxy/anthropic/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: MODELS.STANDARD,
            max_tokens: 100,
            system: `You are a sales classifier. Given a brief company description or handoff note, return only a JSON object with two fields: vertical and subvertical. Vertical must be one of: ${CAL_VERTS.join(", ")}, Unknown. Subvertical is a short 2-4 word phrase. Return only valid JSON, no explanation.`,
            messages: [{ role: "user", content: context }],
          }),
        });
        if (!resp.ok) return;
        const data = await resp.json();
        const parsed = JSON.parse(data?.content?.[0]?.text?.trim());
        if (parsed?.vertical) {
          if (CAL_VERTS.includes(parsed.vertical)) setVertical(parsed.vertical);
          if (parsed.subvertical) setSubVertical(parsed.subvertical);
          setAutoDetected(true);
        }
      } catch { } finally { setDetecting(false); }
    }, 600);
    return () => clearTimeout(detectTimer.current);
  }, [context, vertManually]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = () => {
    onSave({
      evId:           String(ev.id),
      evTitle:        ev.summary || "",
      attendeeEmail:  primaryAtt?.email || "",
      attendeeName:   primaryAtt?.displayName || primaryAtt?.email?.split("@")[0] || "",
      attendeeDomain: primaryAtt?.email?.split("@")[1] || "",
      context, vertical, subVertical,
      detectedAt: new Date().toISOString(),
      promoted: false,
    });
  };

  return (
    <div style={{ borderTop:`1px solid ${C.gold}33`, padding:"10px 12px 12px", background:"#0a0a0a" }}
      onClick={e => e.stopPropagation()}>
      <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:8 }}>
        <span style={{ ...mono, fontSize:10, color:C.gold, textTransform:"uppercase", letterSpacing:"0.08em", fontWeight:600 }}>
          Pre-Call Research
        </span>
        <span style={{ ...mono, fontSize:10, color:C.dim, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1 }}>
          {primaryAtt?.email || ev.summary}{startFmt ? ` · ${startFmt}` : ""}
        </span>
        <button onClick={onClose}
          style={{ background:"none", border:"none", color:C.dim, fontSize:14, cursor:"pointer", lineHeight:1, padding:0, flexShrink:0 }}>✕</button>
      </div>

      <div style={{ marginBottom:8 }}>
        <span style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", display:"block", marginBottom:4 }}>
          Research + Context
          {detecting && <span style={{ marginLeft:6, fontWeight:400, textTransform:"none", letterSpacing:0, color:C.dim }}>detecting…</span>}
        </span>
        <textarea
          value={context}
          onChange={e => setContext(e.target.value)}
          placeholder="Paste research, LinkedIn notes, transcript snippets, anything relevant about this company or contact before the call..."
          rows={6}
          style={{ ...mono, fontSize:11, padding:"7px 9px", background:C.bg, border:`1px solid ${detecting ? C.goldBdr+"55" : C.brd}`, borderRadius:5, color:C.txt, width:"100%", boxSizing:"border-box", resize:"vertical", lineHeight:1.55, transition:"border-color 0.2s", fontFamily:"inherit" }}
        />
      </div>

      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:10, flexWrap:"wrap" }}>
        <span style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>Detected:</span>
        {vertical
          ? <span onClick={() => { setVertManually(true); setAutoDetected(false); setVertical(""); }}
              style={{ ...mono, fontSize:10, padding:"2px 8px", background:`${C.gold}18`, border:`1px solid ${C.goldBdr}`, borderRadius:4, color:C.gold, cursor:"pointer" }}>
              {vertical}
            </span>
          : <span style={{ ...mono, fontSize:10, color:C.dim }}>—</span>
        }
        {subVertical &&
          <span onClick={() => { setVertManually(true); setAutoDetected(false); setSubVertical(""); }}
            style={{ ...mono, fontSize:10, padding:"2px 8px", background:`${C.gold}12`, border:`1px solid ${C.goldBdr}55`, borderRadius:4, color:`${C.gold}cc`, cursor:"pointer" }}>
            {subVertical}
          </span>
        }
        {autoDetected && !vertManually &&
          <span style={{ ...mono, fontSize:9, color:C.gold, opacity:0.6 }}>✦ Auto-detected</span>
        }
      </div>

      <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
        <button onClick={onClose}
          style={{ ...mono, fontSize:11, padding:"5px 12px", background:"transparent", border:`1px solid ${C.brd}`, color:C.mut, borderRadius:5, cursor:"pointer" }}>
          Cancel
        </button>
        <button onClick={handleSave}
          style={{ ...mono, fontSize:11, padding:"5px 14px", background:`${C.gold}18`, border:`1px solid ${C.goldBdr}`, color:C.gold, borderRadius:5, cursor:"pointer", fontWeight:600 }}>
          Save Research
        </button>
      </div>
    </div>
  );
}
