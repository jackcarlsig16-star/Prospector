import { useState } from "react";
import { C, mono } from '../constants/colors';

export default function BugReporter({ page, reporterName }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);

  const submit = () => {
    if (!text.trim()) return;
    try {
      const prev = JSON.parse(localStorage.getItem("prospector_bug_reports") || "[]");
      prev.unshift({ id: Date.now(), text: text.trim(), page, reporter: reporterName || "AE", ts: new Date().toISOString() });
      localStorage.setItem("prospector_bug_reports", JSON.stringify(prev.slice(0, 100)));
    } catch {}
    setText(""); setSent(true); setTimeout(() => { setSent(false); setOpen(false); }, 1800);
  };

  return (
    <>
      <button onClick={() => setOpen(o => !o)} title="Report a bug"
        style={{ position:"fixed", bottom:18, right:18, zIndex:3000, background:"transparent", border:"none", fontSize:22, cursor:"pointer", opacity:0.5, lineHeight:1, padding:0, transition:"opacity 0.15s" }}
        onMouseEnter={e => e.currentTarget.style.opacity = "1"} onMouseLeave={e => e.currentTarget.style.opacity = "0.5"}>
        🐞
      </button>
      {open && (
        <div style={{ position:"fixed", bottom:52, right:18, zIndex:3000, background:C.card, border:`1px solid ${C.brd}`, borderRadius:10, padding:"14px 16px", width:284, boxShadow:"0 6px 24px #0009" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
            <span style={{ fontSize:15 }}>🐞</span>
            <span style={{ ...mono, fontSize:12, fontWeight:700, color:C.txt }}>Report a bug</span>
            <span style={{ ...mono, fontSize:10, color:C.dim, marginLeft:"auto" }}>page: {page}</span>
          </div>
          {sent
            ? <div style={{ ...mono, fontSize:13, color:C.green, padding:"8px 0" }}>✓ Logged — thanks!</div>
            : <>
                <textarea value={text} onChange={e => setText(e.target.value)} placeholder="What went wrong? What did you expect?"
                  style={{ ...mono, width:"100%", height:90, fontSize:12, lineHeight:1.5, background:C.sur, border:`1px solid ${C.brd}`, borderRadius:6, color:C.txt, padding:"8px 10px", resize:"none", outline:"none", boxSizing:"border-box" }}
                  onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}/>
                <div style={{ display:"flex", gap:8, marginTop:8 }}>
                  <button onClick={submit} disabled={!text.trim()}
                    style={{ ...mono, flex:1, fontSize:12, padding:"5px 0", background:text.trim()?`${C.red}18`:"transparent", border:`1px solid ${text.trim()?C.red+"66":C.brd}`, color:text.trim()?C.red:C.dim, borderRadius:5, cursor:text.trim()?"pointer":"default" }}>
                    Submit
                  </button>
                  <button onClick={() => setOpen(false)}
                    style={{ ...mono, fontSize:12, padding:"5px 10px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:5, cursor:"pointer" }}>
                    Cancel
                  </button>
                </div>
              </>
          }
        </div>
      )}
    </>
  );
}
