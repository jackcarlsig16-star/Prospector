import { useState, useEffect, useRef } from 'react';
import { C, mono } from '../constants/colors';
import { getListsForBusiness, getAccountsForBusiness, createInfluencerAccount, findExistingInfluencerByHandle, linkAccountToLists } from '../utils/db';

const inp = { fontSize:13, padding:"10px 12px", background:C.bg, border:`1.5px solid ${C.brdM}`, borderRadius:6, color:C.txt, outline:"none", boxSizing:"border-box", width:"100%", ...mono };
const btn = { ...mono, fontSize:12, padding:"7px 16px", background:C.gold, border:`1px solid ${C.gold}`, borderRadius:6, color:C.bg, cursor:"pointer", fontWeight:700 };
const ghostBtn = { ...mono, fontSize:11, padding:"6px 12px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:6, color:C.dim, cursor:"pointer" };
const select = { ...mono, fontSize:11, padding:"5px 8px", background:C.bg, border:`1px solid ${C.brdM}`, borderRadius:4, color:C.txt };

// Every "Detected" case supports switching to any of the other three
// destinations via this dropdown, not just the type the classifier picked -
// "Change" per smart-intake-classification-confirm-v1, Phase 2. Discard
// (Cancel) always writes nothing regardless of which type is showing.
const DESTINATIONS = [
  { id: 'company_intel', label: 'Company intel' },
  { id: 'new_project', label: 'Project' },
  { id: 'new_account', label: 'New account(s)' },
  { id: 'existing_account', label: 'Existing account note' },
  { id: 'influencer', label: 'New influencer account' },
  { id: 'internal_meeting', label: 'Internal meeting' },
];

function DetectedHeader({ label, description }) {
  return (
    <p style={{ ...mono, fontSize:12, color:C.gold, margin:"0 0 10px", fontWeight:700 }}>
      Detected: {label} <span style={{ color:C.dim, fontWeight:400 }}>→ {description}</span>
    </p>
  );
}

function ChangeDestination({ value, onChange }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:12 }}>
      <span style={{ ...mono, fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em" }}>Change:</span>
      <select value={value} onChange={e=>onChange(e.target.value)} style={select}>
        {DESTINATIONS.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
      </select>
    </div>
  );
}

function NewProjectConfirm({ proposal, projects, submitting, onCreate, onRedirect }) {
  const [name, setName] = useState(proposal.inferredName || 'New Project');
  const [redirectId, setRedirectId] = useState('');
  return (
    <>
      <input value={name} onChange={e=>setName(e.target.value)} style={{ ...inp, marginBottom:10 }} disabled={submitting} />
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:8 }}>
        <button onClick={()=>onCreate(name)} disabled={!name.trim()||submitting} style={btn}>Create Project →</button>
      </div>
      {projects.length > 0 && (
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <select value={redirectId} onChange={e=>setRedirectId(e.target.value)} style={select}>
            <option value="">— or use an existing project —</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button onClick={()=>redirectId && onRedirect(redirectId)} disabled={!redirectId||submitting} style={ghostBtn}>Use this instead</button>
        </div>
      )}
    </>
  );
}

function NewAccountConfirm({ proposal, lists, submitting, onCreate }) {
  const [namesText, setNamesText] = useState(proposal.names.join(', '));
  const [listId, setListId] = useState('');
  const names = namesText.split(',').map(n => n.trim()).filter(Boolean);
  return (
    <>
      <input value={namesText} onChange={e=>setNamesText(e.target.value)} placeholder="Comma-separated account names" style={{ ...inp, marginBottom:10 }} disabled={submitting} />
      <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
        <select value={listId} onChange={e=>setListId(e.target.value)} style={select} disabled={submitting}>
          <option value="">No list (unassigned)</option>
          {lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <button onClick={()=>onCreate(names, listId||null)} disabled={!names.length||submitting} style={btn}>
          Create {names.length > 1 ? `${names.length} Accounts` : "Account"} →
        </button>
      </div>
    </>
  );
}

function ExistingAccountConfirm({ accounts, submitting, onFile }) {
  const [accountId, setAccountId] = useState('');
  return (
    <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
      <select value={accountId} onChange={e=>setAccountId(e.target.value)} style={{ ...select, flex:1 }} disabled={submitting}>
        <option value="">— pick the account —</option>
        {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <button onClick={()=>accountId && onFile(accountId)} disabled={!accountId||submitting} style={btn}>Add note →</button>
    </div>
  );
}

function InfluencerConfirm({ proposal, lists, submitting, onCreate }) {
  const [handle, setHandle] = useState(proposal.handle || '');
  const [followerCount, setFollowerCount] = useState('');
  const [listId, setListId] = useState('');
  return (
    <>
      <div style={{ marginBottom:8 }}>
        <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Instagram handle</div>
        <input value={handle} onChange={e=>setHandle(e.target.value)} placeholder="@handle" style={inp} disabled={submitting} />
      </div>
      <div style={{ marginBottom:10 }}>
        <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Follower count (optional)</div>
        <input type="number" value={followerCount} onChange={e=>setFollowerCount(e.target.value)} placeholder="e.g. 2000" style={inp} disabled={submitting} />
      </div>
      <p style={{ ...mono, fontSize:10, color:C.dim, margin:"0 0 10px" }}>The full pasted text will be used as the bio for assessment.</p>
      <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
        <select value={listId} onChange={e=>setListId(e.target.value)} style={select} disabled={submitting}>
          <option value="">No list (unassigned)</option>
          {lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <button onClick={()=>handle.trim() && onCreate(handle.trim(), followerCount ? Number(followerCount) : null, listId||null)} disabled={!handle.trim()||submitting} style={btn}>
          Create Influencer Account →
        </button>
      </div>
    </>
  );
}

// smart-intake-internal-meeting-v1 - the one real multi-target case in this
// box. When the classifier found a related project, both destinations are
// independently checkable (company intel, checked by default since it's
// always a valid place for internal notes; the matched project, also
// checked by default since a real match was found). No match found (the
// normal case for general/company-level internal discussion) collapses to
// exactly the same single-button shape as company_intel - deliberately not
// showing a disabled/empty second option, per smart-intake-internal-
// meeting-v1's explicit requirement.
function InternalMeetingConfirm({ proposal, projects, submitting, onCreate }) {
  const relatedProject = proposal.relatedProjectId ? projects.find(p => p.id === proposal.relatedProjectId) : null;
  const [confirmCompanyIntel, setConfirmCompanyIntel] = useState(true);
  const [confirmProject, setConfirmProject] = useState(true);

  if (!relatedProject) {
    return <button onClick={()=>onCreate(true, null)} disabled={submitting} style={btn}>File as company intel →</button>;
  }

  return (
    <>
      <label style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8, cursor:"pointer" }}>
        <input type="checkbox" checked={confirmCompanyIntel} onChange={e=>setConfirmCompanyIntel(e.target.checked)} disabled={submitting} />
        <span style={{ ...mono, fontSize:12, color:C.txt }}>Company intel</span>
      </label>
      <label style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10, cursor:"pointer" }}>
        <input type="checkbox" checked={confirmProject} onChange={e=>setConfirmProject(e.target.checked)} disabled={submitting} />
        <span style={{ ...mono, fontSize:12, color:C.txt }}>Project — {relatedProject.name}</span>
      </label>
      <button onClick={()=>onCreate(confirmCompanyIntel, confirmProject ? relatedProject.id : null)} disabled={submitting || (!confirmCompanyIntel && !confirmProject)} style={{ ...btn, opacity: (!confirmCompanyIntel && !confirmProject) ? 0.5 : 1 }}>
        File →
      </button>
    </>
  );
}

const DESCRIBE = {
  company_intel: 'file under this business',
  new_project: 'create a new project',
  new_account: p => (p?.names?.length ? `create account${p.names.length > 1 ? 's' : ''} ${p.names.join(', ')}` : 'create new account(s)'),
  existing_account: 'add a note to an existing account',
  influencer: p => `create influencer account @${p?.handle || '?'}`,
  internal_meeting: p => (p?.relatedProjectId ? 'file to company intel and/or the matched project' : 'file under this business'),
  ambiguous: 'unclear — pick a destination',
};

// Free-text intake that classifies and routes itself. High-confidence cases
// (existing project/account, company intel) still auto-file with zero
// friction; new project, new account, influencer detections, and ambiguous
// text all show a "Detected: X -> Y" confirm step first - auto-filing an
// unreviewed guess is exactly how a scraped Instagram profile got silently
// misfiled as company intel before this existed
// (smart-intake-and-intelligence-v1, smart-intake-classification-confirm-v1).
export default function SmartIntakeBox({ business, projects, userEmail, onProfileUpdated, onProjectUpdated }) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submittingElapsed, setSubmittingElapsed] = useState(0);
  const submittingTimerRef = useRef(null);
  const [toast, setToast] = useState('');
  const [confirmState, setConfirmState] = useState(null); // { classification, proposal, text, overrideType }
  const [error, setError] = useState('');
  const [lists, setLists] = useState([]);
  const [accounts, setAccounts] = useState([]);

  useEffect(() => {
    getListsForBusiness(business.id).then(setLists);
    getAccountsForBusiness(business.id).then(setAccounts);
  }, [business.id]);

  // Auto-filing as company_intel runs the full profile resynthesis
  // server-side before this ever resolves, which can genuinely take
  // 30-150s+ on a real document - cleared in every exit path, same
  // discipline as the App.js infinite-loop fix (business-intel-smart-upload-v1).
  useEffect(() => () => { if (submittingTimerRef.current) clearInterval(submittingTimerRef.current); }, []);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 4000); };

  const submit = async () => {
    if (!text.trim() || submitting) return;
    setSubmitting(true); setSubmittingElapsed(0); setError('');
    submittingTimerRef.current = setInterval(() => setSubmittingElapsed(s => s + 1), 1000);
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
        setConfirmState({ classification: data.classification, proposal: data.proposal, text: text.trim(), overrideType: data.classification === 'ambiguous' ? 'company_intel' : data.classification });
      }
    } catch (e) {
      setError(e.message);
    } finally {
      clearInterval(submittingTimerRef.current);
      submittingTimerRef.current = null;
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
      // smart-intake-internal-meeting-v1 - the one action that can return
      // both `project` and `profile` together (dual-confirm). Checked first
      // and combined into one toast; every pre-existing single-result shape
      // below is untouched, so no other action type's copy changes.
      if (data.project && data.profile) {
        onProjectUpdated?.(data.project); onProfileUpdated?.(data.profile);
        showToast(`Filed to project "${data.project.name}" and company intel`);
      }
      else if (data.project) { onProjectUpdated?.(data.project); showToast(`Filed to project "${data.project.name}"`); }
      else if (data.accounts) { showToast(`Added ${data.accounts.length} new account${data.accounts.length > 1 ? 's' : ''}`); }
      else if (data.accountName) { showToast(`Added notes to ${data.accountName}`); }
      else if (data.profile) { onProfileUpdated?.(data.profile); showToast('Filed as company intel'); }
      setConfirmState(null);
      setText('');
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Influencer creation reuses createInfluencerAccount directly
  // (influencer-accounts-v1's own primitive, client-side/anon-key) rather
  // than a server round-trip that would just reimplement the same insert -
  // then kicks off the same assessment endpoint InfluencerAddModal uses.
  // Dedups on handle first, same as InfluencerAddModal - a repeat paste
  // links to the chosen list instead of creating a duplicate account.
  const confirmInfluencer = async (handle, followerCount, listId) => {
    setSubmitting(true); setError('');
    try {
      const existing = await findExistingInfluencerByHandle(business.id, handle);
      let accountId;
      if (existing) {
        if (listId) await linkAccountToLists(existing.id, [listId]);
        accountId = existing.id;
      } else {
        const { account, error: err } = await createInfluencerAccount(business.id, userEmail, handle, listId ? [listId] : []);
        if (err) throw new Error(err);
        accountId = account.id;
      }
      if (confirmState.text) {
        await fetch(`/api/businesses/${business.id}/influencer/assess`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId, bioText: confirmState.text, followerCount }),
        });
      }
      showToast(existing ? `Linked to existing @${handle.replace(/^@/, '')}` : `Created influencer account @${handle.replace(/^@/, '')}`);
      setConfirmState(null);
      setText('');
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const describe = confirmState ? (typeof DESCRIBE[confirmState.overrideType] === 'function' ? DESCRIBE[confirmState.overrideType](confirmState.proposal) : DESCRIBE[confirmState.overrideType]) : '';

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
        <div style={{ marginTop:8 }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <button onClick={submit} disabled={!text.trim()||submitting} style={{ ...btn, opacity: text.trim()?1:0.5, cursor: text.trim()&&!submitting?"pointer":"default" }}>
              {submitting ? `Filing… ${submittingElapsed}s` : "File →"}
            </button>
            {toast && <span style={{ ...mono, fontSize:11, color:C.green }}>✓ {toast}</span>}
          </div>
          {submitting && (
            <div style={{ marginTop:8, height:3, background:C.brd, borderRadius:2, overflow:"hidden", position:"relative" }}>
              <div style={{ position:"absolute", top:0, left:"-30%", height:"100%", width:"30%", background:C.gold, borderRadius:2, animation:"intelFileBarSlide 1.1s ease-in-out infinite" }} />
              <style>{`@keyframes intelFileBarSlide { 0% { left: -30%; } 100% { left: 100%; } }`}</style>
            </div>
          )}
        </div>
      )}

      {confirmState && (
        <div style={{ marginTop:10, padding:"14px 16px", background:C.card, border:`1px solid ${C.gold}44`, borderRadius:8 }}>
          <DetectedHeader label={DESTINATIONS.find(d=>d.id===confirmState.overrideType)?.label || confirmState.classification} description={describe} />

          {confirmState.overrideType === 'new_project' && (
            <NewProjectConfirm proposal={confirmState.proposal.inferredName ? confirmState.proposal : {}} projects={projects} submitting={submitting}
              onCreate={name => confirmAction({ type:'new_project', name })}
              onRedirect={projectId => confirmAction({ type:'redirect_to_project', projectId })} />
          )}
          {confirmState.overrideType === 'new_account' && (
            <NewAccountConfirm proposal={confirmState.proposal.names ? confirmState.proposal : { names: [] }} lists={lists} submitting={submitting}
              onCreate={(names, listId) => confirmAction({ type:'new_accounts', names, listId })} />
          )}
          {confirmState.overrideType === 'existing_account' && (
            <ExistingAccountConfirm accounts={accounts} submitting={submitting}
              onFile={accountId => confirmAction({ type:'existing_account', accountId })} />
          )}
          {confirmState.overrideType === 'influencer' && (
            <InfluencerConfirm proposal={confirmState.proposal.handle ? confirmState.proposal : {}} lists={lists} submitting={submitting}
              onCreate={confirmInfluencer} />
          )}
          {confirmState.overrideType === 'company_intel' && (
            <button onClick={()=>confirmAction({ type:'company_intel' })} disabled={submitting} style={btn}>File as company intel →</button>
          )}
          {confirmState.overrideType === 'internal_meeting' && (
            <InternalMeetingConfirm proposal={confirmState.proposal.relatedProjectId !== undefined ? confirmState.proposal : {}} projects={projects} submitting={submitting}
              onCreate={(confirmCompanyIntel, projectId) => confirmAction({ type:'internal_meeting', confirmCompanyIntel, projectId })} />
          )}

          <ChangeDestination value={confirmState.overrideType} onChange={t=>setConfirmState(prev=>({ ...prev, overrideType: t }))} />
          <div style={{ marginTop:10 }}>
            <button onClick={()=>setConfirmState(null)} disabled={submitting} style={ghostBtn}>Discard</button>
          </div>
        </div>
      )}
    </div>
  );
}
