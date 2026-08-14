import { useState, useMemo } from 'react';
import { C, mono } from '../constants/colors';
import { parseCsv, nameSim } from '../utils/csv';
import { getListsForBusiness, getAccountsForBusiness, bulkCreateAccountsForBusiness } from '../utils/db';

const ACCOUNT_FIELDS = [
  { id: 'ignore', label: '— Ignore —' },
  { id: 'name', label: 'Company Name' },
  { id: 'web', label: 'Website' },
  { id: 'vert', label: 'Vertical / Industry' },
  { id: 'stage', label: 'Stage' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'sfdc', label: 'Salesforce ID' },
];

const DUPLICATE_THRESHOLD = 0.7; // matches UploadsPage.js's "Likely" tier
const PREVIEW_ROWS = 20;
const SAMPLE_ROWS_FOR_AI = 5;

const btn = { ...mono, fontSize:12, padding:"8px 18px", background:C.gold, border:`1px solid ${C.gold}`, borderRadius:6, color:C.bg, cursor:"pointer", fontWeight:700 };
const ghostBtn = { ...mono, fontSize:12, padding:"7px 14px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:6, color:C.dim, cursor:"pointer" };
const select = { ...mono, fontSize:11, padding:"4px 6px", background:C.bg, border:`1px solid ${C.brdM}`, borderRadius:4, color:C.txt, cursor:"pointer" };

export default function CsvImportModal({ business, userEmail, onClose, onImported }) {
  const [step, setStep] = useState('upload'); // upload | classifying | mapping | preview | committing | done
  const [fileName, setFileName] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [lists, setLists] = useState([]);
  const [existingAccounts, setExistingAccounts] = useState([]);
  const [fieldMapping, setFieldMapping] = useState({});
  const [ownershipColumn, setOwnershipColumn] = useState(null);
  const [valueListMap, setValueListMap] = useState({});
  const [singleListId, setSingleListId] = useState('');
  const [skipDecisions, setSkipDecisions] = useState({}); // rowIndex -> boolean (true = skip)
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const handleFile = async (f) => {
    if (!f || !f.name.endsWith('.csv')) return;
    setError('');
    setFileName(f.name);
    const text = await f.text();
    const { headers: hdrs, rows: parsedRows } = parseCsv(text);
    if (!hdrs.length || !parsedRows.length) { setError('Could not read any rows from this file.'); return; }
    setHeaders(hdrs);
    setRows(parsedRows);

    setStep('classifying');
    const [listRows, accountRows] = await Promise.all([
      getListsForBusiness(business.id),
      getAccountsForBusiness(business.id),
    ]);
    setLists(listRows);
    setExistingAccounts(accountRows);

    try {
      const res = await fetch(`/api/businesses/${business.id}/import/classify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headers: hdrs, sampleRows: parsedRows.slice(0, SAMPLE_ROWS_FOR_AI) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to classify CSV');
      const fm = {};
      hdrs.forEach(h => { fm[h] = data.fieldMapping?.[h] || 'ignore'; });
      setFieldMapping(fm);
      setOwnershipColumn(data.ownershipColumn || null);
      setValueListMap(data.valueToListId || {});
      setStep('mapping');
    } catch (e) {
      // AI mapping failed - fall back to a blank editable mapping rather than blocking the import entirely
      const fm = {};
      hdrs.forEach(h => { fm[h] = 'ignore'; });
      setFieldMapping(fm);
      setError(`Automatic mapping failed (${e.message}) — map columns manually below.`);
      setStep('mapping');
    }
  };

  const distinctOwnershipValues = useMemo(() => {
    if (!ownershipColumn) return [];
    return [...new Set(rows.map(r => r[ownershipColumn]).filter(Boolean))];
  }, [ownershipColumn, rows]);

  const resolveListId = (row) => ownershipColumn ? (valueListMap[row[ownershipColumn]] || null) : (singleListId || null);

  const resolveFields = (row) => {
    const out = {};
    Object.entries(fieldMapping).forEach(([header, field]) => {
      if (field && field !== 'ignore' && row[header]) out[field] = row[header];
    });
    return out;
  };

  const previewData = useMemo(() => {
    return rows.map((row, i) => {
      const fields = resolveFields(row);
      const listId = resolveListId(row);
      const best = fields.name ? existingAccounts.reduce((acc, ex) => {
        const sim = nameSim(fields.name, ex.name || '');
        return sim > acc.sim ? { sim, name: ex.name } : acc;
      }, { sim: 0, name: null }) : { sim: 0, name: null };
      const isDupe = best.sim >= DUPLICATE_THRESHOLD;
      return { i, row, fields, listId, isDupe, dupeMatch: best.name, dupeSim: best.sim };
    });
  }, [rows, fieldMapping, ownershipColumn, valueListMap, singleListId, existingAccounts]); // eslint-disable-line react-hooks/exhaustive-deps

  const willSkip = (p) => p.isDupe && skipDecisions[p.i] !== false;
  const toImportCount = previewData.filter(p => !willSkip(p)).length;
  const listName = (id) => lists.find(l => l.id === id)?.name || '—';

  const handleCommit = async () => {
    setStep('committing');
    setError('');
    const toCreate = previewData.filter(p => !willSkip(p)).map(p => ({
      id: `import_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: p.fields.name || 'Unnamed',
      web: p.fields.web || '',
      vert: p.fields.vert || '',
      stage: p.fields.stage || 'Prospecting',
      linkedin: p.fields.linkedin || '',
      sfdc: p.fields.sfdc || '',
      listId: p.listId,
      addedSource: 'csv_import',
      addedAt: new Date().toISOString(),
      analyzed: false, tier: null, score: null, bm: '', pf: '', sigs: [], ucs: [], prods: [], dis: null,
    }));
    const { inserted, error: err } = await bulkCreateAccountsForBusiness(business.id, userEmail, toCreate);
    if (err) { setError(err); setStep('preview'); return; }
    setResult({ inserted, skipped: previewData.length - toCreate.length });
    setStep('done');
    onImported?.();
  };

  return (
    <div onClick={e=>{if(e.target===e.currentTarget) onClose();}} style={{ position:"fixed", inset:0, zIndex:1000, background:"#00000099", display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div style={{ background:C.card, border:`1px solid ${C.brd}`, borderRadius:12, padding:"24px 26px", width:720, maxHeight:"85vh", overflowY:"auto", boxShadow:"0 20px 60px #000c" }}>
        <div style={{ display:"flex", alignItems:"center", marginBottom:18 }}>
          <span style={{ ...mono, fontSize:15, color:C.txt, fontWeight:700 }}>Import CSV — {business.name}</span>
          <button onClick={onClose} style={{ marginLeft:"auto", background:"transparent", border:"none", color:C.mut, fontSize:18, cursor:"pointer" }}>✕</button>
        </div>

        {error && <div style={{ ...mono, fontSize:11, color:C.red, marginBottom:14 }}>⚠ {error}</div>}

        {step === 'upload' && (
          <div onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();handleFile(e.dataTransfer.files[0]);}} onClick={()=>document.getElementById('csv-import-input').click()}
            style={{ border:`1.5px dashed ${C.brd}`, borderRadius:8, padding:"3rem", textAlign:"center", cursor:"pointer", background:C.sur }}>
            <p style={{ margin:"0 0 6px", fontSize:26, color:C.gold }}>↑</p>
            <p style={{ ...mono, margin:"0 0 4px", fontWeight:700, fontSize:14, color:C.txt }}>{fileName || "Drag & drop CSV here"}</p>
            <p style={{ ...mono, margin:0, fontSize:12, color:C.mut }}>Any columns — mapping is proposed automatically</p>
            <input id="csv-import-input" type="file" accept=".csv" style={{ display:"none" }} onChange={e=>handleFile(e.target.files[0])} />
          </div>
        )}

        {step === 'classifying' && <p style={{ ...mono, fontSize:13, color:C.dim }}>Reading columns…</p>}

        {step === 'mapping' && (
          <div>
            <p style={{ ...mono, fontSize:11, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", margin:"0 0 10px" }}>Column mapping — {rows.length} rows</p>
            <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:20 }}>
              {headers.map(h => (
                <div key={h} style={{ display:"flex", alignItems:"center", gap:10, padding:"6px 10px", background:C.bg, border:`1px solid ${C.brd}`, borderRadius:6 }}>
                  <span style={{ ...mono, fontSize:12, color:C.txt, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{h}</span>
                  <span style={{ ...mono, fontSize:11, color:C.dim }}>→</span>
                  <select value={fieldMapping[h] || 'ignore'} onChange={e=>setFieldMapping(prev=>({...prev, [h]: e.target.value}))} style={select}>
                    {ACCOUNT_FIELDS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                  </select>
                </div>
              ))}
            </div>

            <p style={{ ...mono, fontSize:11, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", margin:"0 0 10px" }}>List assignment</p>
            <div style={{ display:"flex", gap:8, marginBottom:14 }}>
              <button onClick={()=>setOwnershipColumn(null)} style={{ ...ghostBtn, background:!ownershipColumn?C.gold:"transparent", color:!ownershipColumn?C.bg:C.dim, borderColor:!ownershipColumn?C.gold:C.brd, fontWeight:!ownershipColumn?700:400 }}>Single list for all rows</button>
              <button onClick={()=>setOwnershipColumn(ownershipColumn || headers[0])} style={{ ...ghostBtn, background:ownershipColumn?C.gold:"transparent", color:ownershipColumn?C.bg:C.dim, borderColor:ownershipColumn?C.gold:C.brd, fontWeight:ownershipColumn?700:400 }}>Per-row, by column</button>
            </div>

            {!ownershipColumn ? (
              <select value={singleListId} onChange={e=>setSingleListId(e.target.value)} style={{ ...select, width:"100%", padding:"8px 10px", fontSize:12 }}>
                <option value="">— select a list —</option>
                {lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            ) : (
              <>
                <select value={ownershipColumn} onChange={e=>setOwnershipColumn(e.target.value)} style={{ ...select, marginBottom:10 }}>
                  {headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {distinctOwnershipValues.map(v => (
                    <div key={v} style={{ display:"flex", alignItems:"center", gap:10, padding:"6px 10px", background:C.bg, border:`1px solid ${valueListMap[v]?C.brd:C.orange+'55'}`, borderRadius:6 }}>
                      <span style={{ ...mono, fontSize:12, color:C.txt, flex:1 }}>{v}</span>
                      <span style={{ ...mono, fontSize:11, color:C.dim }}>→</span>
                      <select value={valueListMap[v] || ''} onChange={e=>setValueListMap(prev=>({...prev, [v]: e.target.value}))} style={select}>
                        <option value="">— unresolved —</option>
                        {lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div style={{ display:"flex", gap:8, marginTop:20 }}>
              <button onClick={()=>setStep('preview')} disabled={!Object.values(fieldMapping).includes('name')} style={btn}>Preview →</button>
              <button onClick={()=>{setStep('upload');setFileName(null);setRows([]);setHeaders([]);}} style={ghostBtn}>Start over</button>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div>
            <p style={{ ...mono, fontSize:12, color:C.txt, margin:"0 0 4px" }}>
              <span style={{ color:C.green, fontWeight:700 }}>{toImportCount}</span> of {rows.length} rows will be imported
              {!ownershipColumn && singleListId && <> to <span style={{ color:C.gold }}>{listName(singleListId)}</span></>}
            </p>
            {previewData.some(p => p.isDupe) && (
              <p style={{ ...mono, fontSize:11, color:C.orange, margin:"0 0 12px" }}>
                {previewData.filter(p=>p.isDupe).length} look like possible duplicates of existing accounts — defaulted to skip, toggle to import anyway.
              </p>
            )}
            <div style={{ border:`1px solid ${C.brd}`, borderRadius:8, overflow:"hidden", marginBottom:16 }}>
              <div style={{ display:"grid", gridTemplateColumns:"2fr 1.5fr 1fr 1fr 90px", gap:8, padding:"7px 12px", background:C.bg, borderBottom:`1px solid ${C.brd}` }}>
                {["Company","Website","List","Match",""].map(h => <span key={h} style={{ ...mono, fontSize:10, fontWeight:700, color:C.dim, textTransform:"uppercase" }}>{h}</span>)}
              </div>
              {previewData.slice(0, PREVIEW_ROWS).map(p => (
                <div key={p.i} style={{ display:"grid", gridTemplateColumns:"2fr 1.5fr 1fr 1fr 90px", gap:8, padding:"7px 12px", borderBottom:`1px solid ${C.brd}`, opacity:willSkip(p)?0.5:1 }}>
                  <span style={{ ...mono, fontSize:12, color:C.txt, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.fields.name || '—'}</span>
                  <span style={{ ...mono, fontSize:11, color:C.mut, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.fields.web || '—'}</span>
                  <span style={{ ...mono, fontSize:11, color:p.listId?C.txt:C.red }}>{p.listId ? listName(p.listId) : 'unassigned'}</span>
                  <span style={{ ...mono, fontSize:10, color:p.isDupe?C.orange:C.dim }}>{p.isDupe ? `${Math.round(p.dupeSim*100)}% "${p.dupeMatch}"` : '—'}</span>
                  {p.isDupe && (
                    <button onClick={()=>setSkipDecisions(prev=>({...prev, [p.i]: willSkip(p)?false:true}))} style={{ ...mono, fontSize:10, padding:"3px 8px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:4, cursor:"pointer" }}>
                    {willSkip(p) ? "Import anyway" : "Skip"}
                    </button>
                  )}
                </div>
              ))}
              {rows.length > PREVIEW_ROWS && <div style={{ padding:"8px 12px", ...mono, fontSize:11, color:C.dim }}>+ {rows.length - PREVIEW_ROWS} more rows</div>}
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={handleCommit} disabled={toImportCount===0} style={{ ...btn, opacity:toImportCount?1:0.5 }}>Import {toImportCount} accounts →</button>
              <button onClick={()=>setStep('mapping')} style={ghostBtn}>← Back to mapping</button>
            </div>
          </div>
        )}

        {step === 'committing' && <p style={{ ...mono, fontSize:13, color:C.dim }}>Importing…</p>}

        {step === 'done' && result && (
          <div>
            <p style={{ ...mono, fontSize:13, color:C.green, margin:"0 0 6px" }}>✓ Imported {result.inserted} accounts{result.skipped > 0 && ` — ${result.skipped} skipped as duplicates`}</p>
            <button onClick={onClose} style={btn}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}
