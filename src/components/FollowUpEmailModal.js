import React from 'react';
import { C, mono } from '../constants/colors';
import { trackDailyStat } from '../utils/stats';
import CommittedActionsQueue from './CommittedActionsQueue';

function FollowUpEmailModal({
  followUpEmail, setFollowUpEmail,
  followUpDraftUrl, setFollowUpDraftUrl,
  followUpCopied, setFollowUpCopied,
  followUpSkipped, setFollowUpSkipped,
  pendingActions, editedActions, setEditedActions,
  selectedActionIdxs, setSelectedActionIdxs,
  actionsPushed, setActionsPushed,
  tasks, acc, activeUser, onCreateTask,
}) {
  if (!followUpEmail) return null;
  return (
    <div onClick={()=>setFollowUpEmail(null)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:3000, display:'flex', alignItems:'center', justifyContent:'center', padding:'0 16px' }}>
      <div onClick={e=>e.stopPropagation()} style={{ display:'flex', gap:12, maxWidth:880, width:'100%', maxHeight:'85vh', alignItems:'flex-start' }}>
        <div style={{ flex:'0 0 480px', maxHeight:'85vh', overflowY:'auto', background:C.card, border:`1px solid ${C.brd}`, borderRadius:12, padding:'20px 24px', boxShadow:'0 24px 64px rgba(0,0,0,0.6)' }}>
          <div style={{ display:'flex', alignItems:'center', marginBottom:16 }}>
            <p style={{ ...mono, margin:0, fontSize:11, color:C.blue, textTransform:'uppercase', letterSpacing:'0.08em', fontWeight:600, flex:1 }}>Follow-up email ready</p>
            <button onClick={()=>setFollowUpEmail(null)} style={{ background:'transparent', border:'none', color:C.dim, fontSize:18, cursor:'pointer' }}>✕</button>
          </div>
          <p style={{ ...mono, margin:'0 0 4px', fontSize:11, color:C.mut }}>Subject</p>
          <p style={{ margin:'0 0 14px', fontSize:13, color:C.txt, fontWeight:500 }}>{followUpEmail.subject}</p>
          <p style={{ ...mono, margin:'0 0 4px', fontSize:11, color:C.mut }}>Body</p>
          <pre style={{ margin:'0 0 18px', fontSize:12, color:C.txt, whiteSpace:'pre-wrap', lineHeight:1.7, fontFamily:'inherit', background:C.sur, padding:'10px 14px', borderRadius:6, border:`1px solid ${C.brd}` }}>{followUpEmail.body}</pre>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={()=>{
              if(followUpDraftUrl){window.open(followUpDraftUrl,'_blank');}
              else{window.open(`https://mail.google.com/mail/?view=cm&su=${encodeURIComponent(followUpEmail.subject)}&body=${encodeURIComponent(followUpEmail.body)}`,'_blank');}
              trackDailyStat("emails_sent");trackDailyStat("accounts_touched");setFollowUpEmail(null);setFollowUpDraftUrl(null);
            }} style={{ flex:1, padding:'9px 0', background:`${C.blue}18`, border:`1px solid ${C.blue}44`, color:C.blue, borderRadius:7, cursor:'pointer', fontSize:13, fontWeight:500 }}>{followUpDraftUrl?'Open Draft in Gmail →':'Open in Gmail →'}</button>
            <button onClick={()=>{navigator.clipboard.writeText(`Subject: ${followUpEmail.subject}\n\n${followUpEmail.body}`).catch(()=>{});trackDailyStat("emails_sent");trackDailyStat("accounts_touched");setFollowUpCopied(true);setTimeout(()=>{setFollowUpCopied(false);setFollowUpEmail(null);},1400);}} style={{ padding:'9px 16px', background:followUpCopied?`${C.green}22`:'transparent', border:`1px solid ${followUpCopied?C.green:C.brd}`, color:followUpCopied?C.green:C.mut, borderRadius:7, cursor:'pointer', fontSize:13, transition:'all 0.15s', fontWeight:followUpCopied?600:400 }}>{followUpCopied?'✓ Copied':'Copy'}</button>
            <button onClick={()=>{setFollowUpSkipped(true);setTimeout(()=>{setFollowUpSkipped(false);setFollowUpEmail(null);},900);}} style={{ padding:'9px 16px', background:followUpSkipped?`${C.dim}18`:'transparent', border:`1px solid ${followUpSkipped?C.mut:C.brd}`, color:followUpSkipped?C.mut:C.dim, borderRadius:7, cursor:'pointer', fontSize:13, transition:'all 0.15s' }}>{followUpSkipped?'✓ Skipped':'Skip'}</button>
          </div>
        </div>
        <CommittedActionsQueue
          pendingActions={pendingActions}
          editedActions={editedActions}
          setEditedActions={setEditedActions}
          selectedActionIdxs={selectedActionIdxs}
          setSelectedActionIdxs={setSelectedActionIdxs}
          actionsPushed={actionsPushed}
          setActionsPushed={setActionsPushed}
          tasks={tasks}
          acc={acc}
          activeUser={activeUser}
          onCreateTask={onCreateTask}
        />
      </div>
    </div>
  );
}

export default FollowUpEmailModal;
