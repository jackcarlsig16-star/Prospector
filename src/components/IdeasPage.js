import { useEffect } from 'react';
import { mono } from '../constants/colors';
import GoldenNuggetsTab from './frontier/GoldenNuggetsTab';

export default function IdeasPage({ nuggets=[], onSaveNuggets, activeUser, onViewIdeas }) {
  useEffect(() => { onViewIdeas?.(); }, [onViewIdeas]);

  return (
    <div style={{ background:"#1A1712", borderRadius:10, padding:"10px" }}>
      <div style={{ background:"#1A160E", borderRadius:10, padding:"16px 18px", border:"1px solid #3A3020" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
          <span style={{ ...mono, fontSize:14, color:"#D4A96A" }}>◆</span>
          <p style={{ ...mono, margin:0, fontSize:15, fontWeight:500, color:"#D4A96A", letterSpacing:"0.08em", textTransform:"uppercase" }}>Ideas</p>
          <span style={{ ...mono, fontSize:11, color:"#8C7A5A" }}>· {nuggets.length} idea{nuggets.length!==1?"s":""}</span>
        </div>
        <GoldenNuggetsTab nuggets={nuggets} onSaveNuggets={onSaveNuggets} activeUser={activeUser} isAdmin={false}/>
      </div>
    </div>
  );
}
