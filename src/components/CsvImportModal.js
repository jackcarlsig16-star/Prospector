import { useState, useMemo } from 'react';
import { C, mono } from '../constants/colors';
import { parseCsv } from '../utils/csv';
import { normName, normDomain } from '../utils/normAccount';
import { getListsForBusiness, getAccountsForBusiness, bulkCreateAccountsForBusiness, linkAccountToLists, recordAccountActivity, updateAccountRelationshipType } from '../utils/db';
import ListCheckboxes from './ListCheckboxes';

const ACCOUNT_FIELDS = [
  { id: 'ignore', label: '— Ignore —' },
  { id: 'name', label: 'Company Name' },
  { id: 'web', label: 'Website' },
  { id: 'vert', label: 'Vertical / Industry' },
  { id: 'stage', label: 'Stage' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'sfdc', label: 'Salesforce ID' },
];

const PREVIEW_ROWS = 20;
const SAMPLE_ROWS_FOR_AI = 5;

const btn = { ...mono, fontSize:12, padding:"8px 18px", background:C.gold, border:`1px solid ${C.gold}`, borderRadius:6, color:C.bg, cursor:"pointer", fontWeight:700 };
const ghostBtn = { ...mono, fontSize:12, padding:"7px 14px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:6, color:C.dim, cursor:"pointer" };
const select = { ...mono, fontSize:11, padding:"4px 6px", background:C.bg, border:`1px solid ${C.brdM}`, borderRadius:4, color:C.txt, cursor:"pointer" };

// Same canonical exact-match-after-normalization dedup as the rest of the
// app (normAccount.js, backs App.js's merge pass and the manual DEDUPE
// button) - not a separate fuzzy heuristic. A business's whole account pool
// is checked regardless of list, since a list is a grouping lens, never a
// dedup boundary (accounts-lists-and-activity-model-v1).
function findExistingMatch(fields, existingAccounts) {
  if (!fields.name) return null;
  const na = normName(fields.name);
  const da = fields.web ? normDomain(fields.web) : null;
  return existingAccounts.find(ex => {
    const ne = normName(ex.name);
    if (na && ne && na === ne) return true;
    const de = ex.web ? normDomain(ex.web) : null;
    if (da && de && da === de) return true;
    return false;
  }) || null;
}

// Free-text intake that classifies and routes itself is a different feature
// (SmartIntakeBox) - this is the bulk CSV path. General for any business,
// not hardcoded to any one business's lists (csv-account-import-v1,
// extended by accounts-lists-and-activity-model-v1 for multi-list
// membership, canonical dedup-and-link, and activity recording).
export default function CsvImportModal({ business, userEmail, onClose, onImported }) {
  const [step, setStep] = useState('upload'); // upload | classifying | mapping | preview | committing | done
  const [fileName, setFileName] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [lists, setLists] = useState([]);
  const [existingAccounts, setExistingAccounts] = useState([]);
  const [fieldMapping, setFieldMapping] = useState({});
  const [directiveText, setDirectiveText] = useState('');
  const [directiveOverrides, setDirectiveOverrides] = useState({});
  const [directiveLoading, setDirectiveLoading] = useState(false);
  const [directiveError, setDirectiveError] = useState('');
  const [ownershipColumn, setOwnershipColumn] = useState(null);
  const [valueListMap, setValueListMap] = useState({}); // value -> [listId, ...]
  const [singleListIds, setSingleListIds] = useState([]);
  const [createAsNew, setCreateAsNew] = useState({}); // rowIndex -> true (override: don't link, make a new account)
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
      const vlm = {};
      Object.entries(data.valueToListId || {}).forEach(([v, id]) => { vlm[v] = [id]; });
      setValueListMap(vlm);
      setStep('mapping');
    } catch (e) {
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

  const resolveListIds = (row) => ownershipColumn ? (valueListMap[row[ownershipColumn]] || []) : singleListIds;

  // generation-engine-consolidation-v1 Stage 5 - directiveOverrides applied
  // last so an explicit human instruction wins over an inferred column
  // mapping, per the spec's explicit precedence call.
  const resolveFields = (row) => {
    const out = {};
    Object.entries(fieldMapping).forEach(([header, field]) => {
      if (field && field !== 'ignore' && row[header]) out[field] = row[header];
    });
    return { ...out, ...directiveOverrides };
  };

  const applyDirective = async () => {
    if (!directiveText.trim()) { setDirectiveOverrides({}); return; }
    setDirectiveLoading(true);
    setDirectiveError('');
    try {
      const res = await fetch(`/api/businesses/${business.id}/import/directive`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directive: directiveText.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to classify directive');
      setDirectiveOverrides(data.fieldOverrides || {});
      if (!Object.keys(data.fieldOverrides || {}).length) setDirectiveError("Didn't match a supported field (industry, relationship type, or stage) — nothing applied.");
    } catch (e) {
      setDirectiveError(e.message);
      setDirectiveOverrides({});
    }
    setDirectiveLoading(false);
  };

  const toggleListForValue = (value, listId) => setValueListMap(prev => {
    const cur = prev[value] || [];
    return { ...prev, [value]: cur.includes(listId) ? cur.filter(id=>id!==listId) : [...cur, listId] };
  });

  const previewData = useMemo(() => {
    return rows.map((row, i) => {
      const fields = resolveFields(row);
      const listIds = resolveListIds(row);
      const match = findExistingMatch(fields, existingAccounts);
      const willLink = !!match && !createAsNew[i];
      return { i, row, fields, listIds, match, willLink };
    });
  }, [rows, fieldMapping, ownershipColumn, valueListMap, singleListIds, existingAccounts, createAsNew, directiveOverrides]); // eslint-disable-line react-hooks/exhaustive-deps

  const listName = (id) => lists.find(l => l.id === id)?.name || '—';
  const linkCount = previewData.filter(p => p.willLink).length;
  const createCount = previewData.length - linkCount;

  const handleCommit = async () => {
    setStep('committing');
    setError('');

    const toCreate = previewData.filter(p => !p.willLink).map(p => ({
      id: `import_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: p.fields.name || 'Unnamed',
      web: p.fields.web || '',
      vert: p.fields.vert || '',
      stage: p.fields.stage || 'Prospecting',
      linkedin: p.fields.linkedin || '',
      sfdc: p.fields.sfdc || '',
      // generation-engine-consolidation-v1 Stage 5 - only ever set via a
      // directive override (no column ever maps here, relationship_type
      // isn't in ACCOUNT_FIELDS) - undefined otherwise, same DB default
      // ('Prospect/Lead') as every other creation path.
      relationshipType: p.fields.relationship_type || undefined,
      listIds: p.listIds,
      addedSource: 'csv_import',
      addedAt: new Date().toISOString(),
      analyzed: false, tier: null, score: null, bm: '', pf: '', sigs: [], ucs: [], prods: [], dis: null,
    }));
    const { inserted, error: createErr } = await bulkCreateAccountsForBusiness(business.id, userEmail, userEmail, toCreate);
    if (createErr) { setError(createErr); setStep('preview'); return; }

    const toLink = previewData.filter(p => p.willLink);
    for (const p of toLink) {
      if (p.listIds.length) await linkAccountToLists(p.match.id, p.listIds);
      // A directive is an explicit instruction - applies to matched/linked
      // existing accounts too, not just newly created rows. vert/stage
      // overrides deliberately do NOT extend to existing accounts here
      // (would silently overwrite real, already-set data outside this
      // import flow) - relationship_type is a narrower, safer, single-
      // column update via the same real function the manual editor uses.
      if (directiveOverrides.relationship_type) await updateAccountRelationshipType(p.match.id, directiveOverrides.relationship_type);
      await recordAccountActivity(p.match.id, userEmail, 'csv_import',
        `Re-imported via CSV${p.listIds.length ? `, linked to ${p.listIds.map(listName).join(', ')}` : ''}.`);
    }

    setResult({ created: inserted, linked: toLink.length });
    setStep('done');
    onImported?.();
  };

  const hasAnyListChosen = previewData.length > 0 && previewData.every(p => p.willLink || p.listIds.length > 0);

  return (
    <div onClick={e=>{if(e.target===e.currentTarget) onClose();}} style={{ position:"fixed", inset:0, zIndex:1000, background:"#00000099", display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div style={{ background:C.card, border:`1px solid ${C.brd}`, borderRadius:12, padding:"24px 26px", width:760, maxHeight:"85vh", overflowY:"auto", boxShadow:"0 20px 60px #000c" }}>
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

            <p style={{ ...mono, fontSize:11, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", margin:"0 0 10px" }}>Bulk directive — optional, applies to every row</p>
            <div style={{ display:"flex", gap:8, marginBottom:8 }}>
              <input value={directiveText} onChange={e=>setDirectiveText(e.target.value)}
                placeholder='e.g. "assign all these as Partners"'
                onKeyDown={e=>{ if (e.key === 'Enter') applyDirective(); }}
                style={{ ...mono, flex:1, fontSize:12, padding:"6px 10px", background:C.bg, border:`1px solid ${C.brd}`, borderRadius:6, color:C.txt, outline:"none" }} />
              <button onClick={applyDirective} disabled={directiveLoading} style={{ ...ghostBtn, cursor:directiveLoading?"default":"pointer" }}>{directiveLoading ? "…" : "Apply →"}</button>
            </div>
            {directiveError && <p style={{ ...mono, fontSize:11, color:C.orange, margin:"0 0 10px" }}>⚠ {directiveError}</p>}
            {!directiveError && Object.keys(directiveOverrides).length > 0 && (
              <p style={{ ...mono, fontSize:11, color:C.green, margin:"0 0 10px" }}>
                ✓ Every row will get: {Object.entries(directiveOverrides).map(([f,v])=>`${f} → ${v}`).join(', ')} — overrides any column mapping for that field.
              </p>
            )}

            <p style={{ ...mono, fontSize:11, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", margin:"0 0 10px" }}>List assignment — select one or more</p>
            <div style={{ display:"flex", gap:8, marginBottom:14 }}>
              <button onClick={()=>setOwnershipColumn(null)} style={{ ...ghostBtn, background:!ownershipColumn?C.gold:"transparent", color:!ownershipColumn?C.bg:C.dim, borderColor:!ownershipColumn?C.gold:C.brd, fontWeight:!ownershipColumn?700:400 }}>Same list(s) for all rows</button>
              <button onClick={()=>setOwnershipColumn(ownershipColumn || headers[0])} style={{ ...ghostBtn, background:ownershipColumn?C.gold:"transparent", color:ownershipColumn?C.bg:C.dim, borderColor:ownershipColumn?C.gold:C.brd, fontWeight:ownershipColumn?700:400 }}>Per-row, by column</button>
            </div>

            {!ownershipColumn ? (
              <ListCheckboxes lists={lists} selected={singleListIds} onToggle={id=>setSingleListIds(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id])}
                onCreated={{ businessId: business.id, add: l => setLists(prev=>[...prev, l]) }} />
            ) : (
              <>
                <select value={ownershipColumn} onChange={e=>setOwnershipColumn(e.target.value)} style={{ ...select, marginBottom:10 }}>
                  {headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  {distinctOwnershipValues.map(v => (
                    <div key={v} style={{ padding:"8px 10px", background:C.bg, border:`1px solid ${(valueListMap[v]||[]).length?C.brd:C.orange+'55'}`, borderRadius:6 }}>
                      <div style={{ ...mono, fontSize:12, color:C.txt, marginBottom:6 }}>{v}</div>
                      <ListCheckboxes lists={lists} selected={valueListMap[v]||[]} onToggle={id=>toggleListForValue(v, id)}
                        onCreated={{ businessId: business.id, add: l => setLists(prev=>[...prev, l]) }} />
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
              <span style={{ color:C.green, fontWeight:700 }}>{createCount}</span> new account{createCount!==1?'s':''}, <span style={{ color:C.blue, fontWeight:700 }}>{linkCount}</span> linked to existing
            </p>
            {!hasAnyListChosen && <p style={{ ...mono, fontSize:11, color:C.orange, margin:"0 0 10px" }}>⚠ Some rows have no list selected — they'll be created unlisted.</p>}
            {linkCount > 0 && (
              <p style={{ ...mono, fontSize:11, color:C.dim, margin:"0 0 12px" }}>
                {linkCount} row{linkCount!==1?'s':''} matched an existing account — linked to the chosen list(s) instead of creating a duplicate. Toggle to "Create as new" if that's wrong.
              </p>
            )}
            <div style={{ border:`1px solid ${C.brd}`, borderRadius:8, overflow:"hidden", marginBottom:16 }}>
              <div style={{ display:"grid", gridTemplateColumns:"2fr 1.5fr 1.5fr 1fr 110px", gap:8, padding:"7px 12px", background:C.bg, borderBottom:`1px solid ${C.brd}` }}>
                {["Company","Website","Lists","Match",""].map(h => <span key={h} style={{ ...mono, fontSize:10, fontWeight:700, color:C.dim, textTransform:"uppercase" }}>{h}</span>)}
              </div>
              {previewData.slice(0, PREVIEW_ROWS).map(p => (
                <div key={p.i} style={{ display:"grid", gridTemplateColumns:"2fr 1.5fr 1.5fr 1fr 110px", gap:8, padding:"7px 12px", borderBottom:`1px solid ${C.brd}` }}>
                  <span style={{ ...mono, fontSize:12, color:C.txt, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.fields.name || '—'}</span>
                  <span style={{ ...mono, fontSize:11, color:C.mut, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.fields.web || '—'}</span>
                  <span style={{ ...mono, fontSize:11, color:p.listIds.length?C.txt:C.red }}>{p.listIds.length ? p.listIds.map(listName).join(', ') : 'unlisted'}</span>
                  <span style={{ ...mono, fontSize:10, color:p.match?C.blue:C.dim }}>{p.match ? `"${p.match.name}"` : '—'}</span>
                  {p.match && (
                    <button onClick={()=>setCreateAsNew(prev=>({...prev, [p.i]: !prev[p.i]}))} style={{ ...mono, fontSize:10, padding:"3px 8px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:4, cursor:"pointer" }}>
                    {p.willLink ? "Create as new" : "Link instead"}
                    </button>
                  )}
                </div>
              ))}
              {rows.length > PREVIEW_ROWS && <div style={{ padding:"8px 12px", ...mono, fontSize:11, color:C.dim }}>+ {rows.length - PREVIEW_ROWS} more rows</div>}
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={handleCommit} style={btn}>Import {rows.length} rows →</button>
              <button onClick={()=>setStep('mapping')} style={ghostBtn}>← Back to mapping</button>
            </div>
          </div>
        )}

        {step === 'committing' && <p style={{ ...mono, fontSize:13, color:C.dim }}>Importing…</p>}

        {step === 'done' && result && (
          <div>
            <p style={{ ...mono, fontSize:13, color:C.green, margin:"0 0 6px" }}>
              ✓ {result.created} new account{result.created!==1?'s':''} created{result.linked > 0 && `, ${result.linked} linked to existing accounts`}
            </p>
            <button onClick={onClose} style={btn}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}
