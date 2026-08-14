import { useState, useEffect } from 'react';
import { C, mono } from '../constants/colors';
import { getListsForBusiness } from '../utils/db';

const inp = { fontSize:13, padding:"10px 12px", background:C.bg, border:`1.5px solid ${C.brdM}`, borderRadius:6, color:C.txt, outline:"none", boxSizing:"border-box", width:"100%", ...mono };
const btn = { ...mono, fontSize:12, padding:"7px 16px", background:C.gold, border:`1px solid ${C.gold}`, borderRadius:6, color:C.bg, cursor:"pointer", fontWeight:700 };
const ghostBtn = { ...mono, fontSize:11, padding:"6px 12px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:6, color:C.dim, cursor:"pointer" };

function NewProjectConfirm({ proposal, projects, submitting, onCreate, onRedirect, onFallback, onCancel }) {
  const [name, setName] = useState(proposal.inferredName);
  const [redirectId, setRedirectId] = useState('');
  return (
    <div style={{ marginTop:10, padding:"14px 16px", background:C.card, border:`1px solid ${C.gold}44`, borderRadius:8 }}>
      <p style={{ ...mono, fontSize:12, color:C.txt, margin:"0 0 10px" }}>This reads like a new project. Confirm, rename, or route it to an existing one instead.</p>
      <input value={name} onChange={e=>setName(e.target.value)} style={{ ...inp, marginBottom:10 }} disabled={submitting} />
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:8 }}>
        <button onClick={()=>onCreate(name)} disabled={!name.trim()||submitting} style={btn}>Create Project →</button>
        <button onClick={onFallback} disabled={submitting} style={ghostBtn}>File as company intel instead</button>
        <button onClick={onCancel} disabled={submitting} style={ghostBtn}>Cancel</button>
      </div>
      {projects.length > 0 && (
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <select value={redirectId} onChange={e=>setRedirectId(e.target.value)} style={{ ...mono, fontSize:11, padding:"5px 8px", background:C.bg, border:`1px solid ${C.brdM}`, borderRadius:4, color:C.txt }}>
            <option value="">— or use an existing project —</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button onClick={()=>redirectId && onRedirect(redirectId)} disabled={!redirectId||submitting} style={ghostBtn}>Use this instead</button>
        </div>
      )}
    </div>
  );
}

function NewAccountConfirm({ proposal, projects, lists, submitting, onCreate, onFallback, onCancel }) {
  const [namesText, setNamesText] = useState(proposal.names.join(', '));
  const relatedList = projects.find(p => p.id === proposal.relatedProjectId)?.list_id || '';
  const [listId, setListId] = useState(relatedList);
  const names = namesText.split(',').map(n => n.trim()).filter(Boolean);

  return (
    <div style={{ marginTop:10, padding:"14px 16px", background:C.card, border:`1px solid ${C.gold}44`, borderRadius:8 }}>
      <p style={{ ...mono, fontSize:12, color:C.txt, margin:"0 0 10px" }}>
        {proposal.names.length > 1 ? `${proposal.names.length} new accounts detected` : 'New account detected'} — confirm before creating.
      </p>
      <input value={namesText} onChange={e=>setNamesText(e.target.value)} placeholder="Comma-separated account names" style={{ ...inp, marginBottom:10 }} disabled={submitting} />
      <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
        <select value={listId} onChange={e=>setListId(e.target.value)} style={{ ...mono, fontSize:11, padding:"5px 8px", background:C.bg, border:`1px solid ${C.brdM}`, borderRadius:4, color:C.txt }} disabled={submitting}>
          <option value="">No list (unassigned)</option>
          {lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <button onClick={()=>onCreate(names, listId||null)} disabled={!names.length||submitting} style={btn}>
          Create {names.length > 1 ? `${names.length} Accounts` : "Account"} →
        </button>
        <button onClick={onFallback} disabled={submitting} style={ghostBtn}>File as company intel instead</button>
        <button onClick={onCancel} disabled={submitting} style={ghostBtn}>Cancel</button>
      </div>
    </div>
  );
}

// Free-text intake that classifies and routes itself - company intel, an
// existing/new project, or an existing/new account - instead of Jack having
// to decide where a note belongs (smart-intake-and-intelligence-v1).
export default function SmartIntakeBox({ business, projects, userEmail, onProfileUpdated, onProjectUpdated }) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState('');
  const [confirmState, setConfirmState] = useState(null);
  const [error, setError] = useState('');
  const [lists, setLists] = useState([]);

  useEffect(() => { getListsForBusiness(business.id).then(setLists); }, [business.id]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 4000); };

  const submit = async () => {
    if (!text.trim() || submitting) return;
    setSubmitting(true); setError('');
    try {
      const res = await fetch(`/api/businesses/${business.id}/intake`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim(), created_by: userEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to process intake');

      if (data.status === 'filed') {
        if (data.classification === 'company_intel') { onProfileUpdated?.(data.profile); showToast('Filed as company intel'); }
        else if (data.classification === 'existing_project') { onProjectUpdated?.(data.project); showToast(`Filed to project "${data.project.name}"`); }
        else if (data.classification === 'existing_account') { showToast(`Added notes to ${data.accountName || 'account'}`); }
        setText('');
      } else if (data.status === 'confirm') {
        setConfirmState({ classification: data.classification, proposal: data.proposal, text: text.trim() });
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const confirmAction = async (action) => {
    setSubmitting(true); setError('');
    try {
      const res = await fetch(`/api/businesses/${business.id}/intake/confirm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, text: confirmState.text, created_by: userEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to file');
      if (data.project) { onProjectUpdated?.(data.project); showToast(`Filed to project "${data.project.name}"`); }
      else if (data.accounts) { showToast(`Added ${data.accounts.length} new account${data.accounts.length > 1 ? 's' : ''}`); }
      else if (data.profile) { onProfileUpdated?.(data.profile); showToast('Filed as company intel'); }
      setConfirmState(null);
      setText('');
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ marginBottom:32 }}>
      <p style={{ ...mono, fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", margin:"0 0 8px" }}>Smart Intake</p>
      <textarea
        placeholder="Dump any context here — a project update, new accounts, anything. It'll be filed automatically."
        value={text} onChange={e=>setText(e.target.value)} rows={3}
        style={{ ...inp, resize:"vertical" }} disabled={submitting || !!confirmState}
      />
      {error && <div style={{ ...mono, fontSize:11, color:C.red, marginTop:8 }}>⚠ {error}</div>}
      {!confirmState && (
        <div style={{ display:"flex", alignItems:"center", gap:12, marginTop:8 }}>
          <button onClick={submit} disabled={!text.trim()||submitting} style={{ ...btn, opacity: text.trim()?1:0.5, cursor: text.trim()&&!submitting?"pointer":"default" }}>
            {submitting ? "Filing…" : "File →"}
          </button>
          {toast && <span style={{ ...mono, fontSize:11, color:C.green }}>✓ {toast}</span>}
        </div>
      )}
      {confirmState?.classification === 'new_project' && (
        <NewProjectConfirm proposal={confirmState.proposal} projects={projects} submitting={submitting}
          onCreate={name => confirmAction({ type:'new_project', name })}
          onRedirect={projectId => confirmAction({ type:'redirect_to_project', projectId })}
          onFallback={() => confirmAction({ type:'company_intel' })}
          onCancel={()=>setConfirmState(null)} />
      )}
      {confirmState?.classification === 'new_account' && (
        <NewAccountConfirm proposal={confirmState.proposal} projects={projects} lists={lists} submitting={submitting}
          onCreate={(names, listId) => confirmAction({ type:'new_accounts', names, listId })}
          onFallback={() => confirmAction({ type:'company_intel' })}
          onCancel={()=>setConfirmState(null)} />
      )}
    </div>
  );
}
