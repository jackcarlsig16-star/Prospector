import React, { useState } from 'react';
import { C, TS, mono } from '../constants/colors';
import { clientAssay, getActiveIntel, getActiveExamples } from '../utils/assay';
import { Badge, Dot } from './AccountCard';

const GTM_SEGMENTS = ["SMB","Fintech","B&W","ENT"];

const inferSegment = (vert) => {
  if (!vert) return null;
  const v = vert.toLowerCase();
  if (["banks","insurance","wealth"].some(k=>v.includes(k))) return "B&W";
  if (["pfm","consumer payments","crypto","lending","ewa","payroll","bfm","neobank","fintech","investment","investing"].some(k=>v.includes(k))) return "Fintech";
  return null;
};

const tc = accs => ({ total:accs.length, gold:accs.filter(a=>a.tier==="Gold").length, silver:accs.filter(a=>a.tier==="Silver").length, tin:accs.filter(a=>a.tier==="Tin").length, slag:accs.filter(a=>a.tier==="Slag").length });

const normName = n => n.toLowerCase().replace(/\b(inc|llc|ltd|corp|co|company|group|holdings|tech|technologies|solutions|services|global|international|the)\b/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
const nameSim = (a,b) => { const na=normName(a),nb=normName(b); if(na===nb)return 1; const ta=new Set(na.split(' ').filter(Boolean)),tb=new Set(nb.split(' ').filter(Boolean)); const inter=[...ta].filter(t=>tb.has(t)).length,union=new Set([...ta,...tb]).size; return union>0?inter/union:0; };

function UploadsPage({ accounts, onSave, onSaveBatch, onBatchUpdate, onSaveToPool, onEnrichLog }) {
  const [step,setStep]=useState("type");
  const [uploadType,setUploadType]=useState(null);
  const [rows,setRows]=useState([]);
  const [fileName,setFileName]=useState(null);
  const [running,setRunning]=useState(false);
  const [progress,setProgress]=useState({ws:0,assay:0,total:0});
  const [enrichResults,setEnrichResults]=useState([]); // [{name, status, patches}]
  const [preEnrichSnapshot,setPreEnrichSnapshot]=useState(null);
  const [enrichDupeRows,setEnrichDupeRows]=useState([]); // [{csvRow, match, sim, decision:"dupe"|"new"}]
  const [enrichNewRows,setEnrichNewRows]=useState([]); // rows confirmed as new (no good match)
  const [selectedNew,setSelectedNew]=useState(new Set()); // names selected for assay

  const TYPES=[
    {id:"my_accounts",icon:"+",label:"Initial — My Accounts",desc:"Owned accounts, full assay, added to territory.",color:C.green,bg:"#041408",bdr:"#0A2E18"},
    {id:"dormant",icon:"◎",label:"Dormant — Claim Jumper",desc:"Unowned accounts, added to shared pool.",color:C.tin,bg:C.tinBg,bdr:C.tinBdr},
    {id:"enrichment",icon:"↻",label:"Enrichment — Update Existing",desc:"Enrich existing accounts, duplicates skipped.",color:C.purple,bg:"#0E0A18",bdr:"#2A1848"},
  ];
  const ut=TYPES.find(t=>t.id===uploadType);

  const handleFile=f=>{
    if(!f||!f.name.endsWith(".csv"))return;
    setFileName(f.name);
    const r=new FileReader();
    r.onload=ev=>{
      const lines=ev.target.result.trim().split("\n").filter(l=>l.trim());
      if(lines.length<2)return;
      const parseCSVLine=line=>{const cols=[];let cur="",inQ=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(inQ&&line[i+1]==='"'){cur+='"';i++;}else{inQ=!inQ;}}else if(ch===','&&!inQ){cols.push(cur.trim());cur="";}else{cur+=ch;}}cols.push(cur.trim());return cols;};
      const hdrs=parseCSVLine(lines[0]).map(h=>h.replace(/^"|"$/g,"").toLowerCase());
      const fi=(...ks)=>hdrs.findIndex(h=>ks.some(k=>h.includes(k.toLowerCase())));
      const ni=fi("account name","name"),wi=fi("website","url"),si=fi("state"),vi=fi("vertical","industry"),ai=fi("activity","last modified","last activity"),sfi=fi("salesforce","sfdc","sf url","account url","instance url"),sidi=fi("account id","sf id","sfid","salesforce id","record id","sf account id"),segi=fi("segment","gtm","gtm segment"),cidi=fi("client id","client ids","client_id","client_ids","clientid","clientids");
      const parsed=lines.slice(1).filter(l=>l.trim()).map((line,i)=>{
        const cols=parseCSVLine(line);
        const sfdc=(sidi>=0?cols[sidi]:"")||(sfi>=0?cols[sfi]:"")||"";
        const rawVert=vi>=0?cols[vi]:"";
        const rawSeg=segi>=0?cols[segi]:"";
        const segment=GTM_SEGMENTS.find(s=>s.toLowerCase()===rawSeg.toLowerCase())||inferSegment(rawVert)||null;
        const rawClientIds=cidi>=0?(cols[cidi]||""):"";
        const clientIds=rawClientIds?rawClientIds.split(/[,;|]+/).map(s=>s.trim()).filter(Boolean):[];
        return{id:`u${Date.now()}${i}`,name:ni>=0?cols[ni]:`Account${i+1}`,web:wi>=0?cols[wi]:"",state:si>=0?cols[si]:"",vert:rawVert,last:ai>=0?cols[ai]:"",sfdc,segment,clientIds,score:null,tier:null,analyzing:false,analyzed:false,bm:"",pf:"",sigs:[],ucs:[],prods:[],dis:null,wsStatus:"pending",wsChecked:false,pool:uploadType==="dormant"};
      });
      setRows(parsed);setStep("preview");
    };
    r.readAsText(f);
  };

  const mergeFieldsOnly=()=>{
    setPreEnrichSnapshot(accounts); // snapshot for undo
    const before=tc(accounts);
    const PATCH_FIELDS=["sfdc","web","linkedin","state","vert","last"];
    const FIELD_LABELS={"sfdc":"Salesforce","web":"Website","linkedin":"LinkedIn","state":"State","vert":"Vertical","last":"Last Activity","clientIds":"Client IDs"};
    const results=[];
    const merged=accounts.map(existing=>{
      const match=rows.find(r=>r.name.toLowerCase()===existing.name.toLowerCase());
      if(!match){return existing;}
      const patch={};
      // CSV wins — overwrite existing values if CSV has a non-empty value
      PATCH_FIELDS.forEach(f=>{if(match[f]&&match[f].trim()&&existing[f]!==match[f].trim())patch[f]=match[f].trim();});
      if(match.clientIds&&match.clientIds.length>0){
        const existing_ids=new Set(existing.clientIds||[]);
        const merged_ids=[...(existing.clientIds||[]),...match.clientIds.filter(id=>!existing_ids.has(id))];
        if(merged_ids.length>(existing.clientIds||[]).length)patch.clientIds=merged_ids;
      }
      const patched=Object.keys(patch);
      results.push({name:existing.name,status:patched.length?"updated":"no_change",patches:patched.map(f=>FIELD_LABELS[f]||f)});
      return patched.length?{...existing,...patch}:existing;
    });
    // CSV rows with no match in territory
    rows.forEach(r=>{
      if(!accounts.some(a=>a.name.toLowerCase()===r.name.toLowerCase()))
        results.push({name:r.name,status:"no_match",patches:[]});
    });
    const updatedCount=results.filter(r=>r.status==="updated").length;
    onSave(merged);
    onEnrichLog&&onEnrichLog({event:"enrichment",label:`Enrichment: ${fileName}`,before,after:before,updatedCount,fileName});
    onSaveBatch({id:Date.now(),fileName,uploadType:"enrichment",date:new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}),total:rows.length,gold:0,silver:0,note:`Field merge — ${updatedCount} updated`});
    setEnrichResults(results);
    setStep("enrich_results");
  };

  const runBatch=async(rowsOverride)=>{
    setRunning(true);setStep("results");
    const source=rowsOverride||rows;
    const capped=source;
    const total=capped.length;setProgress({ws:0,assay:0,total});
    const list=[...capped];
    for(let i=0;i<list.length;i++){
      await new Promise(r=>setTimeout(r,5000));
      list[i]={...list[i],wsStatus:list[i].web?"active":"error",wsChecked:true};
      setRows([...list]);
      setProgress(p=>{const next={...p,ws:i+1};if(onBatchUpdate)onBatchUpdate({fileName,uploadType,ws:next.ws,assay:next.assay,total,gold:list.filter(a=>a.tier==="Gold").length,silver:list.filter(a=>a.tier==="Silver").length});return next;});
    }
    for(let i=0;i<list.length;i+=1){
      const batch=list.slice(i,Math.min(i+1,list.length));
      await Promise.all(batch.map(async(acc,bi)=>{
        const idx=i+bi;
        list[idx]={...list[idx],analyzing:true};setRows([...list]);
        try{
          const parsed=await clientAssay({name:acc.name,web:acc.web,vert:acc.vert,customIntel:getActiveIntel(),exampleAccts:getActiveExamples(),stage:acc.stage||"Prospecting"});
          list[idx]={...list[idx],...parsed,sigs:parsed.keySignals||[],ucs:parsed.useCases||[],prods:parsed.products||[],bm:parsed.businessModel||"",pf:parsed.productFit||"",dis:parsed.disqualifier||null,linkedin:parsed.linkedin||"",analyzing:false,analyzed:true};
        }catch(err){
          list[idx]={...list[idx],score:4,tier:"Slag",bm:`Failed: ${err.message}`,analyzing:false,analyzed:true};
        }
        setRows([...list]);
        setProgress(p=>{const next={...p,assay:p.assay+1};if(onBatchUpdate)onBatchUpdate({fileName,uploadType,ws:next.ws,assay:next.assay,total,gold:list.filter(a=>a.tier==="Gold").length,silver:list.filter(a=>a.tier==="Silver").length});return next;});
      }));
    }
    if(uploadType==="dormant"){
      onSaveToPool&&onSaveToPool(list.filter(a=>a.analyzed));
    }else{
      const before=tc(accounts);
      const merged=[...accounts];
      const tierChanges=[];
      list.filter(a=>a.analyzed).forEach(na=>{
        const idx=merged.findIndex(x=>x.name.toLowerCase()===na.name.toLowerCase());
        if(idx>=0){
          const prevTier=merged[idx].tier;
          const preserve={clientIds:merged[idx].clientIds, sfdc:merged[idx].sfdc};
          // Preserve original tier/score from first assay — never overwrite once set
          const origTier=merged[idx].originalTier||merged[idx].tier;
          const origScore=merged[idx].originalScore||merged[idx].score;
          Object.assign(merged[idx],na);
          if(!na.clientIds?.length && preserve.clientIds?.length) merged[idx].clientIds=preserve.clientIds;
          if(!na.sfdc && preserve.sfdc) merged[idx].sfdc=preserve.sfdc;
          if(origTier){merged[idx].originalTier=origTier;merged[idx].originalScore=origScore;}
          if(prevTier&&na.tier&&prevTier!==na.tier)tierChanges.push({name:na.name,from:prevTier,to:na.tier});
        } else {
          // New account — set original tier on first assay
          merged.push({...na,originalTier:na.tier,originalScore:na.score});
        }
      });
      const after=tc(merged);
      onSave(merged);
      onEnrichLog&&onEnrichLog({event:"reassay",label:`Reassay: ${fileName}`,before,after,tierChanges,fileName});
    }
    onSaveBatch({id:Date.now(),fileName,uploadType,date:new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}),total:list.length,gold:list.filter(a=>a.tier==="Gold").length,silver:list.filter(a=>a.tier==="Silver").length});
    setRunning(false);
  };

  const cnt2={Gold:0,Silver:0,Tin:0,Slag:0};
  rows.filter(r=>r.tier).forEach(r=>{if(cnt2[r.tier]!==undefined)cnt2[r.tier]++;});
  const done=progress.total>0&&progress.assay>=progress.total&&!running;
  const sorted=[...rows].sort((a,b)=>!a.score&&!b.score?0:!a.score?1:!b.score?-1:a.score-b.score);

  if(step==="type")return(
    <div>
      <p style={{ margin:"0 0 4px", fontSize:18, fontWeight:500, color:C.txt }}>Upload account list</p>
      <p style={{ margin:"0 0 16px", fontSize:15, color:C.mut }}>Choose type then drop your Salesforce CSV</p>
      <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:16 }}>
        {TYPES.map(t=>(
          <div key={t.id} onClick={()=>setUploadType(t.id)} style={{ padding:"12px 14px", borderRadius:8, cursor:"pointer", display:"flex", gap:12, border:`1px solid ${uploadType===t.id?t.bdr:C.brd}`, background:uploadType===t.id?t.bg:C.card }}>
            <span style={{ fontSize:18, color:t.color, fontFamily:"monospace", flexShrink:0 }}>{t.icon}</span>
            <div>
              <p style={{ margin:"0 0 2px", fontWeight:500, fontSize:15, color:t.color }}>{t.label}</p>
              <p style={{ margin:0, fontSize:14, color:C.mut }}>{t.desc}</p>
            </div>
          </div>
        ))}
      </div>
      {ut&&(
        <>
          {uploadType==="enrichment"&&(
            <div style={{ ...mono, fontSize:12, color:C.purple, background:"#0E0A18", border:"1px solid #2A1848", borderRadius:7, padding:"10px 14px", marginBottom:10, lineHeight:1.6 }}>
              <div style={{ fontWeight:600, marginBottom:4, fontSize:13 }}>↻ Enrichment — filling in missing fields</div>
              <div style={{ color:C.mut }}>Export your territory from SFDC with at least <span style={{ color:C.txt }}>Account Name</span> + one of these columns:</div>
              <div style={{ marginTop:4, color:C.txt }}>• <span style={{ color:C.purple }}>SFDC / Salesforce URL / Account URL</span> — fills in missing SFDC links</div>
              <div style={{ color:C.txt }}>• Website, State, Vertical, Last Activity — also patched if present</div>
              <div style={{ marginTop:6, color:C.dim }}>Matches by account name. Only fills <em>empty</em> fields — won't overwrite your existing scores or assay data. Use "Merge fields only" to skip re-scoring.</div>
            </div>
          )}
          <div onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();handleFile(e.dataTransfer.files[0]);}} onClick={()=>document.getElementById("csv-in").click()} style={{ border:`1.5px dashed ${C.brd}`, borderRadius:8, padding:"2.5rem", textAlign:"center", cursor:"pointer", background:C.sur }}>
            <p style={{ margin:"0 0 6px", fontSize:26, color:ut.color }}>↑</p>
            <p style={{ margin:"0 0 4px", fontWeight:500, fontSize:15, color:C.txt }}>{fileName||"Drag & drop CSV here"}</p>
            <p style={{ margin:0, fontSize:13, color:C.mut }}>Account Name, Website, State, Vertical, Last Activity</p>
            <input id="csv-in" type="file" accept=".csv" style={{ display:"none" }} onChange={e=>handleFile(e.target.files[0])}/>
          </div>
        </>
      )}
    </div>
  );

  if(step==="preview")return(
    <div>
      <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:16 }}>
        <button onClick={()=>{setStep("type");setRows([]);setFileName(null);}} style={{ fontSize:14, padding:"5px 10px", background:"transparent", border:`1px solid ${C.brd}`, color:C.mut, borderRadius:5, cursor:"pointer" }}>← Back</button>
        <div>
          <p style={{ margin:0, fontWeight:500, fontSize:17, color:C.txt }}>{fileName}</p>
          <p style={{ ...mono, margin:0, fontSize:13, color:C.mut }}>{rows.length} accounts</p>
        </div>
      </div>
      {(()=>{const nu=rows.filter(a=>accounts.some(x=>x.name.toLowerCase()===a.name.toLowerCase())).length,nn=rows.length-nu;return nu>0&&<p style={{ ...mono, margin:"0 0 10px", fontSize:13, color:C.mut }}><span style={{ color:C.orange }}>{nu} update</span>{nn>0&&<span> · <span style={{ color:C.green }}>{nn} new</span></span>}</p>;})()}
      <div style={{ background:C.card, border:`1px solid ${C.brd}`, borderRadius:8, overflow:"hidden", marginBottom:14 }}>
        <div style={{ display:"grid", gridTemplateColumns:"2fr 2fr 1fr 1fr 50px", gap:8, padding:"8px 14px", borderBottom:`1px solid ${C.brd}` }}>
          {["Company","Website","State","Vertical",""].map(h=><span key={h} style={{ ...mono, fontSize:11, fontWeight:500, color:C.dim, textTransform:"uppercase" }}>{h}</span>)}
        </div>
        {rows.slice(0,8).map(a=>{const exists=accounts.some(x=>x.name.toLowerCase()===a.name.toLowerCase());return(
          <div key={a.id} style={{ display:"grid", gridTemplateColumns:"2fr 2fr 1fr 1fr 50px", gap:8, padding:"8px 14px", borderBottom:`1px solid ${C.brd}` }}>
            <span style={{ fontSize:14, color:C.txt }}>{a.name}</span>
            <span style={{ ...mono, fontSize:13, color:a.web?C.tin:C.mut }}>{a.web||"—"}</span>
            <span style={{ fontSize:13, color:C.mut }}>{a.state||"—"}</span>
            <span style={{ fontSize:13, color:C.mut }}>{a.vert||"—"}</span>
            <span style={{ ...mono, fontSize:12, color:exists?C.orange:C.green }}>{exists?"update":"new"}</span>
          </div>
        );})}
        {rows.length>8&&<div style={{ padding:"8px 14px", fontSize:13, color:C.mut }}>+ {rows.length-8} more</div>}
      </div>
      {uploadType==="dormant"&&rows.length>50&&(
        <div style={{ ...mono, fontSize:13, color:C.orange, marginBottom:10, padding:"8px 12px", background:"#140C04", border:`1px solid #4A2C08`, borderRadius:6 }}>
          ⚠ {rows.length} accounts in CSV — only the first 50 will be analyzed per batch. Upload the rest in a separate batch.
        </div>
      )}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
        {uploadType==="enrichment"&&(
          <button onClick={mergeFieldsOnly} style={{ padding:"10px 20px", fontWeight:500, fontSize:15, background:"#0E0A18", border:"1px solid #2A1848", color:C.purple, borderRadius:6, cursor:"pointer" }}>↻ Merge fields only (no re-assay) →</button>
        )}
        {uploadType==="dormant"
          ? <button onClick={()=>runBatch()} style={{ padding:"10px 20px", fontWeight:500, fontSize:15, background:C.tinBg, border:`1px solid ${C.tinBdr}`, color:C.tin, borderRadius:6, cursor:"pointer" }}>⛏ Analyze & add {Math.min(rows.length,50)} to pool →</button>
          : <>
              <button onClick={()=>runBatch()} style={{ padding:"10px 20px", fontWeight:500, fontSize:15, background:ut?ut.bg:"transparent", border:`1px solid ${ut?ut.bdr:C.brd}`, color:ut?ut.color:C.mut, borderRadius:6, cursor:"pointer", opacity:uploadType==="enrichment"?0.5:1 }}>Run assay on {rows.length} accounts →</button>
              {(()=>{const newOnly=rows.filter(r=>!accounts.some(a=>a.name.toLowerCase()===r.name.toLowerCase()));return newOnly.length>0&&newOnly.length<rows.length?(<button onClick={()=>runBatch(newOnly)} style={{ padding:"10px 20px", fontWeight:500, fontSize:15, background:"#041408", border:`1px solid ${C.green}55`, color:C.green, borderRadius:6, cursor:"pointer" }}>✦ New only — assay {newOnly.length} →</button>):null;})()}
            </>
        }
      </div>
    </div>
  );

  if(step==="enrich_results"){
    const updated=enrichResults.filter(r=>r.status==="updated");
    const noChange=enrichResults.filter(r=>r.status==="no_change");
    const noMatch=enrichResults.filter(r=>r.status==="no_match");
    const unmatchedRows=rows.filter(r=>noMatch.some(nm=>nm.name.toLowerCase()===r.name.toLowerCase()));
    const launchNewFlow=()=>{
      const dupes=[],clearNew=[];
      unmatchedRows.forEach(r=>{
        let best=null,bestSim=0;
        accounts.forEach(a=>{ const s=nameSim(r.name,a.name); if(s>bestSim){bestSim=s;best=a;} });
        if(bestSim>=0.4) dupes.push({csvRow:r,match:best,sim:bestSim,decision:bestSim>=0.7?"dupe":"new"});
        else clearNew.push(r);
      });
      setEnrichDupeRows(dupes);
      setEnrichNewRows(clearNew);
      setSelectedNew(new Set(clearNew.map(r=>r.name)));
      setStep(dupes.length>0?"enrich_dupes":clearNew.length>0?"enrich_new":"enrich_results");
    };
    return(
      <div>
        <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:14 }}>
          <div style={{ flex:1 }}>
            <p style={{ margin:0, fontWeight:500, fontSize:17, color:C.txt }}>{fileName}</p>
            <p style={{ ...mono, margin:"2px 0 0", fontSize:13, color:C.green }}>✓ Fields merged — saved to territory</p>
          </div>
          {unmatchedRows.length>0&&<button onClick={launchNewFlow} style={{ fontSize:14, padding:"5px 12px", background:"transparent", border:`1px solid ${C.green}55`, color:C.green, borderRadius:5, cursor:"pointer" }}>Review {unmatchedRows.length} new accounts →</button>}
          {preEnrichSnapshot&&<button onClick={()=>{onSave(preEnrichSnapshot);setPreEnrichSnapshot(null);setStep("type");setRows([]);setFileName(null);setEnrichResults([]);}} style={{ fontSize:14, padding:"5px 12px", background:"transparent", border:`1px solid ${C.orange}55`, color:C.orange, borderRadius:5, cursor:"pointer" }}>↩ Undo enrich</button>}
          <button onClick={()=>{setStep("type");setRows([]);setFileName(null);setEnrichResults([]);}} style={{ fontSize:14, padding:"5px 12px", background:"transparent", border:`1px solid ${C.brd}`, color:C.mut, borderRadius:5, cursor:"pointer" }}>New upload</button>
        </div>
        {/* Summary pills */}
        <div style={{ display:"flex", gap:8, marginBottom:14 }}>
          {[["Updated",updated.length,C.green],["No change",noChange.length,C.dim],["Not in territory",noMatch.length,C.orange]].map(([l,v,c])=>(
            <div key={l} style={{ ...mono, fontSize:11, padding:"5px 12px", background:`${c}12`, border:`1px solid ${c}33`, borderRadius:5, color:c }}>
              <span style={{ fontWeight:700 }}>{v}</span> {l}
            </div>
          ))}
        </div>
        {/* Account list */}
        <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
          {enrichResults.map((r,i)=>{
            const sc=r.status==="updated"?C.green:r.status==="no_match"?C.orange:C.dim;
            const ic=r.status==="updated"?"✓":r.status==="no_match"?"⚠":"○";
            const lb=r.status==="updated"?"Updated":r.status==="no_match"?"Not in territory":"No new fields";
            return(
              <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px",
                background:r.status==="updated"?`${C.green}06`:C.card,
                border:`1px solid ${r.status==="updated"?`${C.green}22`:C.brd}`,
                borderLeft:`3px solid ${r.status==="updated"?C.green:r.status==="no_match"?C.orange:"transparent"}`,
                borderRadius:6 }}>
                <span style={{ ...mono, fontSize:13, color:sc, flexShrink:0 }}>{ic}</span>
                <span style={{ fontSize:14, color:r.status==="updated"?C.txt:C.mut, flex:1,
                  whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{r.name}</span>
                <span style={{ ...mono, fontSize:11, color:sc, flexShrink:0 }}>{lb}</span>
                {r.patches.length>0&&(
                  <span style={{ ...mono, fontSize:10, color:C.dim, flexShrink:0 }}>
                    {r.patches.join(" · ")}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if(step==="enrich_dupes"){
    const CONF_LABEL=s=>s>=0.85?"Very likely":s>=0.7?"Likely":s>=0.5?"Possible":"Weak";
    const CONF_COLOR=s=>s>=0.85?C.orange:s>=0.7?C.orange:s>=0.5?"#c4a000":C.dim;
    const allNew=enrichDupeRows.every(r=>r.decision==="new");
    const proceed=()=>{
      const confirmed=[...enrichNewRows,...enrichDupeRows.filter(r=>r.decision==="new").map(r=>r.csvRow)];
      setEnrichNewRows(confirmed);
      setSelectedNew(new Set(confirmed.map(r=>r.name)));
      setStep(confirmed.length>0?"enrich_new":"enrich_results");
    };
    return(
      <div>
        <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:4 }}>
          <div style={{ flex:1 }}>
            <p style={{ margin:0, fontWeight:500, fontSize:17, color:C.txt }}>{fileName}</p>
            <p style={{ ...mono, margin:"2px 0 0", fontSize:13, color:C.orange }}>Step 2 — Review possible duplicates</p>
          </div>
          <button onClick={proceed} style={{ fontSize:14, padding:"5px 14px", background:C.green, border:"none", color:"#000", borderRadius:5, cursor:"pointer", fontWeight:600 }}>Continue →</button>
        </div>
        <p style={{ ...mono, fontSize:12, color:C.dim, margin:"0 0 12px" }}>These CSV accounts are similar to ones already in your territory. Mark each as the same account (skip) or a different one (add as new).</p>
        <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:16 }}>
          {enrichDupeRows.map((d,i)=>(
            <div key={i} style={{ display:"grid", gridTemplateColumns:"1fr 1fr auto", gap:10, alignItems:"center", padding:"10px 14px", background:C.card, border:`1px solid ${d.decision==="dupe"?C.brd:`${C.green}44`}`, borderRadius:7 }}>
              <div>
                <div style={{ fontSize:13, color:C.txt, fontWeight:500 }}>{d.csvRow.name}</div>
                <div style={{ ...mono, fontSize:11, color:C.dim }}>from CSV</div>
              </div>
              <div>
                <div style={{ fontSize:13, color:d.decision==="dupe"?C.mut:C.txt }}>{d.match.name}</div>
                <div style={{ ...mono, fontSize:11, color:CONF_COLOR(d.sim) }}>{CONF_LABEL(d.sim)} match · {Math.round(d.sim*100)}%</div>
              </div>
              <div style={{ display:"flex", gap:6 }}>
                <button onClick={()=>setEnrichDupeRows(rs=>rs.map((r,j)=>j===i?{...r,decision:"dupe"}:r))} style={{ fontSize:12, padding:"4px 10px", background:d.decision==="dupe"?C.orange+"33":"transparent", border:`1px solid ${d.decision==="dupe"?C.orange:C.brd}`, color:d.decision==="dupe"?C.orange:C.mut, borderRadius:4, cursor:"pointer" }}>Same</button>
                <button onClick={()=>setEnrichDupeRows(rs=>rs.map((r,j)=>j===i?{...r,decision:"new"}:r))} style={{ fontSize:12, padding:"4px 10px", background:d.decision==="new"?C.green+"22":"transparent", border:`1px solid ${d.decision==="new"?C.green:C.brd}`, color:d.decision==="new"?C.green:C.mut, borderRadius:4, cursor:"pointer" }}>Add as new</button>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={()=>setEnrichDupeRows(rs=>rs.map(r=>({...r,decision:"dupe"})))} style={{ fontSize:12, padding:"4px 12px", background:"transparent", border:`1px solid ${C.brd}`, color:C.mut, borderRadius:4, cursor:"pointer" }}>Mark all same</button>
          <button onClick={()=>setEnrichDupeRows(rs=>rs.map(r=>({...r,decision:"new"})))} style={{ fontSize:12, padding:"4px 12px", background:"transparent", border:`1px solid ${C.brd}`, color:C.mut, borderRadius:4, cursor:"pointer" }}>Add all as new</button>
        </div>
      </div>
    );
  }

  if(step==="enrich_new"){
    const allSelected=enrichNewRows.every(r=>selectedNew.has(r.name));
    const toggleAll=()=>setSelectedNew(allSelected?new Set():new Set(enrichNewRows.map(r=>r.name)));
    const toggleOne=name=>setSelectedNew(s=>{const n=new Set(s);n.has(name)?n.delete(name):n.add(name);return n;});
    const toAssay=enrichNewRows.filter(r=>selectedNew.has(r.name));
    return(
      <div>
        <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:4 }}>
          <div style={{ flex:1 }}>
            <p style={{ margin:0, fontWeight:500, fontSize:17, color:C.txt }}>{fileName}</p>
            <p style={{ ...mono, margin:"2px 0 0", fontSize:13, color:C.green }}>Step 3 — Add new accounts to territory</p>
          </div>
          <button onClick={()=>setStep("enrich_results")} style={{ fontSize:13, padding:"4px 10px", background:"transparent", border:`1px solid ${C.brd}`, color:C.mut, borderRadius:4, cursor:"pointer" }}>Skip all</button>
          <button onClick={()=>{setRows(toAssay);setUploadType("my_accounts");setEnrichNewRows([]);setStep("preview");}} disabled={toAssay.length===0} style={{ fontSize:14, padding:"5px 14px", background:toAssay.length>0?C.green:"transparent", border:`1px solid ${toAssay.length>0?C.green:C.brd}`, color:toAssay.length>0?"#000":C.mut, borderRadius:5, cursor:toAssay.length>0?"pointer":"default", fontWeight:600 }}>Assay {toAssay.length} selected →</button>
        </div>
        <p style={{ ...mono, fontSize:12, color:C.dim, margin:"0 0 12px" }}>{enrichNewRows.length} accounts from the CSV are not in your territory. Select which ones to assay and add.</p>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
          <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ cursor:"pointer" }}/>
          <span style={{ fontSize:13, color:C.mut }}>Select all</span>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
          {enrichNewRows.map((r,i)=>(
            <div key={i} onClick={()=>toggleOne(r.name)} style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 12px", background:selectedNew.has(r.name)?`${C.green}08`:C.card, border:`1px solid ${selectedNew.has(r.name)?`${C.green}33`:C.brd}`, borderRadius:6, cursor:"pointer" }}>
              <input type="checkbox" checked={selectedNew.has(r.name)} onChange={()=>toggleOne(r.name)} onClick={e=>e.stopPropagation()} style={{ cursor:"pointer", flexShrink:0 }}/>
              <span style={{ fontSize:14, color:C.txt, flex:1 }}>{r.name}</span>
              {r.vert&&<span style={{ ...mono, fontSize:11, color:C.dim }}>{r.vert}</span>}
              {r.web&&<span style={{ ...mono, fontSize:11, color:C.dim }}>{r.web}</span>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return(
    <div>
      <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:12 }}>
        <div style={{ flex:1 }}>
          <p style={{ margin:0, fontWeight:500, fontSize:17, color:C.txt }}>{fileName}</p>
          <p style={{ ...mono, margin:0, fontSize:13, color:C.mut }}>{rows.length} accounts</p>
        </div>
        {done&&<button onClick={()=>{setStep("type");setRows([]);setFileName(null);setProgress({ws:0,assay:0,total:0});}} style={{ fontSize:14, padding:"5px 12px", background:"transparent", border:`1px solid ${C.brd}`, color:C.mut, borderRadius:5, cursor:"pointer" }}>New upload</button>}
      </div>
      <div style={{ background:C.card, border:`1px solid ${C.brd}`, borderRadius:8, padding:"12px 14px", marginBottom:12 }}>
        <p style={{ ...mono, margin:"0 0 10px", fontSize:12, fontWeight:500, color:C.mut, textTransform:"uppercase", letterSpacing:"0.08em" }}>Assay progress</p>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:8, marginBottom:8 }}>
          {[["Site",progress.ws,progress.total,C.blue],["Assayed",progress.assay,progress.total,C.purple],["Gold",cnt2.Gold,rows.length,C.gold],["Silver",cnt2.Silver,rows.length,C.silver],["Tin",cnt2.Tin,rows.length,C.tin],["Slag",cnt2.Slag,rows.length,C.slag]].map(([l,v,t,c])=>(
            <div key={l} style={{ background:C.sur, borderRadius:6, padding:"8px 10px" }}>
              <p style={{ ...mono, margin:"0 0 2px", fontSize:11, color:C.mut, textTransform:"uppercase" }}>{l}</p>
              <p style={{ ...mono, margin:0, fontSize:20, fontWeight:600, color:c, lineHeight:1 }}>{v||0}</p>
              {t>0&&<div style={{ height:2, background:C.bg, borderRadius:1, marginTop:4 }}><div style={{ height:"100%", width:`${Math.min(((v||0)/t)*100,100)}%`, background:c }}/></div>}
            </div>
          ))}
        </div>
        {running&&<span style={{ ...mono, fontSize:13, color:C.purple }}>⬡ Running... {progress.assay}/{progress.total}</span>}
        {done&&<span style={{ ...mono, fontSize:13, color:C.green }}>✓ Complete — saved to your territory</span>}
      </div>
      {sorted.map(a=>{
        const ts=a.tier?TS[a.tier]:null;
        const wc=a.wsStatus==="active"?{l:"Active",c:C.green}:a.wsStatus==="error"?{l:"No site",c:C.orange}:{l:"Checking",c:C.dim};
        return(
          <div key={a.id} style={{ border:`1px solid ${a.tier==="Gold"?C.goldBdr:C.brd}`, borderRadius:8, background:a.tier==="Gold"?C.goldBg:a.tier==="Slag"?C.slagBg:C.card, padding:"9px 14px", display:"flex", alignItems:"center", gap:10, marginBottom:3 }}>
            <Dot on={a.wsStatus==="active"}/>
            <div style={{ flex:"0 0 150px", minWidth:0 }}>
              <p style={{ margin:0, fontWeight:500, fontSize:14, color:a.tier==="Gold"?C.goldTxt:C.txt, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{a.name}</p>
              <p style={{ ...mono, margin:0, fontSize:12, color:C.mut }}>{a.web||"—"}</p>
            </div>
            <span style={{ ...mono, fontSize:13, color:wc.c, flex:"0 0 65px" }}>{wc.l}</span>
            <div style={{ flex:"0 0 80px" }}>{ts?<Badge label={`${ts.i} ${a.tier}`} color={ts.t} bg={ts.bg} border={ts.b}/>:<span style={{ ...mono, fontSize:13, color:C.dim }}>—</span>}</div>
            <span style={{ ...mono, fontSize:13, flex:1, color:a.analyzing?C.purple:a.analyzed?C.green:a.wsChecked?C.dim:C.blue }}>{a.analyzing?"⬡ Analyzing...":a.analyzed?"✓ Scored":a.wsChecked?"○ Queued":"↓ Checking"}</span>
          </div>
        );
      })}
    </div>
  );
}

export default UploadsPage;
