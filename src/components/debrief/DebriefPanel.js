import React from 'react';
import { C, mono } from '../../constants/colors';
import { T } from '../../constants/tokens';
import QuickUpdateDiff from '../QuickUpdateDiff';

export default function DebriefPanel({
  acc,
  debriefMode, setDebriefMode,
  debriefText, setDebriefText, debriefError, debriefLoading, logDebrief,
  gongSearch, gongDropOpen, setGongDropOpen, searchGongEmails, importGongEmail,
  quickUpdateText, setQuickUpdateText, quickUpdateError, quickUpdateLoading,
  quickUpdateResult, setQuickUpdateResult, quickUpdateFollowUp, setQuickUpdateFollowUp,
  runQuickUpdate, applyQuickUpdate,
  closeDebrief,
}) {
  const accent = debriefMode === 'quick' ? T.cyan : debriefMode === 'call' ? T.amber : C.blue;
  const headerLabel = debriefMode === 'call' ? '📞 Call Debrief' : debriefMode === 'quick' ? '⚡ Quick Update' : '📋 Log Update';
  return (
    <div style={{ marginBottom:12, background:`${accent}08`, border:`1px solid ${accent}33`, borderRadius:7, padding:"12px 14px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:!debriefMode?4:8 }}>
        <span style={{ ...mono, fontSize:11, fontWeight:500, color:accent, textTransform:"uppercase", letterSpacing:"0.08em" }}>{headerLabel}</span>
        {(debriefLoading||quickUpdateLoading)&&<span style={{ ...mono, fontSize:11, color:C.dim }}>{quickUpdateLoading?'Extracting…':'Extracting insights…'}</span>}
        {debriefMode&&!debriefLoading&&!quickUpdateLoading&&!quickUpdateResult&&(
          <button onClick={()=>{setDebriefMode(null);setQuickUpdateText('');}} style={{ ...mono, fontSize:10, padding:'2px 7px', background:'transparent', border:`1px solid ${C.brd}`, color:C.dim, borderRadius:3, cursor:'pointer' }}>← back</button>
        )}
        <button onClick={closeDebrief} style={{ marginLeft:"auto", background:"transparent", border:"none", color:C.dim, fontSize:14, cursor:"pointer", padding:0 }}>✕</button>
      </div>

      {/* Mode selector */}
      {!debriefMode&&(
        <div style={{ display:'flex', gap:8, marginTop:4 }}>
          <button onClick={()=>setDebriefMode('call')}
            style={{ ...mono, flex:1, fontSize:12, padding:'10px 14px', background:`${T.amber}10`, border:`1px solid ${T.amber}66`, color:T.amber, borderRadius:5, cursor:'pointer', letterSpacing:'0.04em', fontWeight:600, textShadow:`0 0 6px ${T.amber}44` }}>
            📞 Call Debrief
          </button>
          <button onClick={()=>setDebriefMode('quick')}
            style={{ ...mono, flex:1, fontSize:12, padding:'10px 14px', background:`${T.cyan}10`, border:`1px solid ${T.cyan}66`, color:T.cyan, borderRadius:5, cursor:'pointer', letterSpacing:'0.04em', fontWeight:600, textShadow:`0 0 6px ${T.cyan}44` }}>
            ⚡ Quick Update
          </button>
        </div>
      )}

      {/* Call Debrief mode */}
      {debriefMode==='call'&&(
        <>
          <p style={{ ...mono, margin:"0 0 8px", fontSize:11, color:C.dim }}>Paste a Gong transcript, call summary, or Gong score. Claude extracts pain points, next steps, MEDPICC updates, and Gong scores automatically.</p>
          {localStorage.getItem('gmail_access_token')&&(
            <div style={{ marginBottom:8, position:'relative' }}>
              <button onClick={searchGongEmails} style={{ ...mono, fontSize:11, padding:'3px 10px', background:'transparent', border:`1px solid ${C.brd}`, color:C.mut, borderRadius:4, cursor:'pointer' }}>{gongSearch==='loading'?'⟳ Searching…':'🔍 Find Gong email →'}</button>
              {gongDropOpen&&gongSearch!=='loading'&&(
                <div style={{ position:'absolute', top:'100%', left:0, zIndex:100, background:C.card, border:`1px solid ${C.brd}`, borderRadius:6, minWidth:320, marginTop:4, boxShadow:'0 8px 24px rgba(0,0,0,0.4)' }}>
                  {!gongSearch?.length?<div style={{ padding:'10px 14px', fontSize:12, color:C.dim }}>No Gong emails found for {acc.name}</div>:gongSearch.map(msg=>(<button key={msg.id} onClick={()=>importGongEmail(msg.id)} style={{ display:'block', width:'100%', textAlign:'left', padding:'8px 14px', background:'transparent', border:'none', borderBottom:`1px solid ${C.brd}`, color:C.txt, cursor:'pointer', fontSize:12 }}><span style={{ color:C.mut, ...mono, fontSize:10, display:'block' }}>{msg.date}</span>{msg.subject}</button>))}
                  <button onClick={()=>setGongDropOpen(false)} style={{ display:'block', width:'100%', padding:'6px 14px', background:'transparent', border:'none', color:C.dim, cursor:'pointer', fontSize:11, textAlign:'left' }}>Close</button>
                </div>
              )}
            </div>
          )}
          <textarea value={debriefText} onChange={e=>setDebriefText(e.target.value)} placeholder={"Paste Gong transcript, call notes, or summary here...\n\nOr paste your Gong scores like:\nOpening Agenda: 2/3\nPain: 4/5\nTechnical: 3/5\n..."} rows={8} style={{ width:"100%", fontSize:12, lineHeight:1.7, padding:"10px 12px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:6, color:C.txt, outline:"none", resize:"vertical", boxSizing:"border-box", fontFamily:"inherit" }}/>
          {debriefError&&<p style={{ ...mono, fontSize:12, color:C.red, margin:"6px 0 0" }}>✕ {debriefError}</p>}
          <div style={{ display:"flex", gap:8, marginTop:8 }}>
            <button onClick={logDebrief} disabled={debriefLoading||!debriefText.trim()} style={{ fontSize:13, padding:"7px 16px", background:debriefText.trim()&&!debriefLoading?`${T.amber}22`:"transparent", border:`1px solid ${debriefText.trim()&&!debriefLoading?T.amber:C.brd}`, color:debriefText.trim()&&!debriefLoading?T.amber:C.dim, borderRadius:6, cursor:debriefText.trim()&&!debriefLoading?"pointer":"not-allowed", fontWeight:500 }}>{debriefLoading?"⬡ Extracting…":"Extract & Save →"}</button>
            <span style={{ ...mono, fontSize:11, color:C.dim, alignSelf:"center" }}>{(acc.calls||[]).length} call{(acc.calls||[]).length!==1?"s":""} logged</span>
          </div>
        </>
      )}

      {/* Quick Update mode — input */}
      {debriefMode==='quick'&&!quickUpdateResult&&(
        <>
          <textarea value={quickUpdateText} onChange={e=>setQuickUpdateText(e.target.value)} placeholder="Paste an email, drop a note, or add context..." rows={5} style={{ width:"100%", fontSize:12, lineHeight:1.65, padding:"10px 12px", background:C.sur, border:`1px solid ${T.cyan}33`, borderRadius:6, color:C.txt, outline:"none", resize:"vertical", boxSizing:"border-box", fontFamily:"inherit" }}/>
          {quickUpdateError&&<p style={{ ...mono, fontSize:12, color:C.red, margin:"6px 0 0" }}>✕ {quickUpdateError}</p>}
          <div style={{ display:"flex", alignItems:'center', gap:10, marginTop:8, flexWrap:'wrap' }}>
            <button onClick={runQuickUpdate} disabled={quickUpdateLoading||!quickUpdateText.trim()}
              style={{ ...mono, fontSize:12, padding:"6px 14px", background:quickUpdateText.trim()&&!quickUpdateLoading?`${T.cyan}18`:"transparent", border:`1px solid ${quickUpdateText.trim()&&!quickUpdateLoading?T.cyan:C.brd}`, color:quickUpdateText.trim()&&!quickUpdateLoading?T.cyan:C.dim, borderRadius:4, cursor:quickUpdateText.trim()&&!quickUpdateLoading?"pointer":"default", letterSpacing:'0.04em', fontWeight:500, textShadow:quickUpdateText.trim()&&!quickUpdateLoading?`0 0 6px ${T.cyan}55`:'none' }}>
              {quickUpdateLoading?"⬡ Extracting…":"Extract →"}
            </button>
            <label style={{ ...mono, fontSize:11, color:C.dim, display:'inline-flex', alignItems:'center', gap:6, cursor:'pointer' }}>
              <input type="checkbox" checked={quickUpdateFollowUp} onChange={e=>setQuickUpdateFollowUp(e.target.checked)} style={{ accentColor:T.cyan, cursor:'pointer' }}/>
              Generate follow-up email
            </label>
          </div>
        </>
      )}

      {/* Quick Update mode — diff review */}
      {debriefMode==='quick'&&quickUpdateResult&&(
        <QuickUpdateDiff
          result={quickUpdateResult}
          acc={acc}
          generateFollowUp={quickUpdateFollowUp}
          onApply={applyQuickUpdate}
          onCancel={()=>{setQuickUpdateResult(null);}}
        />
      )}
    </div>
  );
}
