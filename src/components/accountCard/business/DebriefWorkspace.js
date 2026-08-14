import { useState, forwardRef, useImperativeHandle } from 'react';
import { GONG_RUBRIC, BEHAVIOR_RUBRIC, clientDebrief, quickUpdateExtract } from '../../../utils/dealIntel';
import { extractIntelligenceFromCall } from '../../../utils/intelligenceEngine';
import { runPathToCloseUpdate } from '../../../utils/pathToClose';
import { getValidGmailToken } from '../../../utils/getValidGmailToken';
import { getVoiceProfile } from '../../../constants/voice';
import { MODELS } from '../../../config/models';
import DebriefPanel from '../../debrief/DebriefPanel';
import FollowUpEmailModal from '../../FollowUpEmailModal';

const isTranscript = (text) => {
  if (!text || text.length < 200) return false;
  const speakerPattern = /^[\w\s]+:\s/m.test(text);
  const timestampPattern = /\d{1,2}:\d{2}/g;
  const timestampCount = (text.match(timestampPattern) || []).length;
  const lineCount = text.split('\n').length;
  const shortLineRatio = text.split('\n').filter(l => l.length < 100).length / lineCount;
  return speakerPattern || timestampCount > 3 || (shortLineRatio > 0.6 && lineCount > 20);
};

// Owns Debrief + Quick Update + the auto-generated follow-up email that
// fires after either — relocated verbatim from the old AccountCardActionBar.js
// (account-card-unification-and-outreach-v1 / -full-redesign-v2). Business-only.
const DebriefWorkspace = forwardRef(function DebriefWorkspace({ acc, onUpdate, tasks, activeUser, onCreateTask, setIntelFlash, onNewlyDetectedProds, open, onClose }, ref) {
  const [debriefMode, setDebriefMode] = useState(null); // null | 'call' | 'quick'
  const [debriefText, setDebriefText] = useState("");
  const [debriefLoading, setDebriefLoading] = useState(false);
  const [debriefError, setDebriefError] = useState(null);
  const [gongSearch, setGongSearch] = useState(null);
  const [gongDropOpen, setGongDropOpen] = useState(false);
  const [quickUpdateText, setQuickUpdateText] = useState("");
  const [quickUpdateLoading, setQuickUpdateLoading] = useState(false);
  const [quickUpdateResult, setQuickUpdateResult] = useState(null);
  const [quickUpdateError, setQuickUpdateError] = useState(null);
  const [quickUpdateFollowUp, setQuickUpdateFollowUp] = useState(false);
  const [pendingActions, setPendingActions] = useState([]);
  const [editedActions, setEditedActions] = useState([]);
  const [selectedActionIdxs, setSelectedActionIdxs] = useState(new Set());
  const [actionsPushed, setActionsPushed] = useState(false);
  const [followUpEmail, setFollowUpEmail] = useState(null);
  const [followUpDraftUrl, setFollowUpDraftUrl] = useState(null);
  const [followUpCopied, setFollowUpCopied] = useState(false);
  const [followUpSkipped, setFollowUpSkipped] = useState(false);

  const topPersona = (acc.personas || [])[0] || null;

  const searchGongEmails = async () => {
    const token = await getValidGmailToken(); if (!token) return;
    setGongSearch('loading'); setGongDropOpen(true);
    try {
      const q = `from:gong.io ${acc.name}`;
      const r = await fetch(`/proxy/gmail/messages?q=${encodeURIComponent(q)}&maxResults=8`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await r.json();
      if (!data.messages?.length) { setGongSearch([]); return; }
      const details = await Promise.all(data.messages.map(m => fetch(`/proxy/gmail/message/${m.id}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json())));
      setGongSearch(details.map(msg => ({ id: msg.id, subject: (msg.payload?.headers || []).find(h => h.name === 'Subject')?.value || '(no subject)', date: (msg.payload?.headers || []).find(h => h.name === 'Date')?.value || '' })));
    } catch { setGongSearch([]); }
  };

  const importGongEmail = async (msgId) => {
    const token = await getValidGmailToken(); if (!token) return;
    setGongDropOpen(false);
    try {
      const r = await fetch(`/proxy/gmail/message/${msgId}/body`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await r.json();
      if (data.text) setDebriefText(data.text);
    } catch {}
  };

  const generateFollowUpEmail = async (callRecord) => {
    const voiceUserName = (() => { try { return JSON.parse(localStorage.getItem('prospector_user') || '{}').name || 'AE'; } catch { return 'AE'; } })();
    const voiceProfile = getVoiceProfile ? getVoiceProfile(voiceUserName) : null;
    const voiceNote = voiceProfile?.summary ? `\n\nVoice guidance: ${voiceProfile.summary}` : '';
    const nextStepsList = (callRecord.nextSteps || []).map(ns => typeof ns === 'string' ? ns : (ns?.text || '')).join('\n');
    const painList = (callRecord.painPoints || []).map(p => typeof p === 'string' ? p : (p?.topic || '')).join(', ');
    const productsList = (callRecord.productsDiscussed || []).map(p => `${p.product} (${p.interestLevel})`).join(', ');
    const prompt = `Write a brief post-meeting follow-up email in the following person's voice.${voiceNote}\n\nMeeting with: ${acc.name}\nPain points discussed: ${painList || 'N/A'}\nProducts discussed: ${productsList || 'N/A'}\nNext steps: ${nextStepsList || 'N/A'}\nDecision maker: ${callRecord.decisionMaker || 'N/A'}\n\nRequirements:\n- Friendly but professional\n- One-line thank you opener\n- 2-3 bullet summary of what was discussed\n- Clear next steps section\n- Short closing with a clear ask\n- NO generic filler phrases like "I hope this email finds you well"\n- Keep it under 200 words\n\nRespond with JSON: {"subject":"...","body":"..."}`;
    try {
      const res = await fetch('/proxy/anthropic/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODELS.FAST, max_tokens: 600, messages: [{ role: 'user', content: prompt }] }) });
      const d = await res.json();
      const raw = d.content?.[0]?.text || '';
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        setFollowUpEmail(parsed); setFollowUpCopied(false); setFollowUpSkipped(false); setFollowUpDraftUrl(null);
        const gtoken = await getValidGmailToken();
        if (gtoken) {
          try {
            const to = (acc?.personas || [])[0]?.email || '';
            const r = await fetch('/api/gmail/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken: gtoken, to, subject: parsed.subject || '', body: parsed.body || '' }) });
            if (r.ok) { const j = await r.json(); if (j.draftUrl) setFollowUpDraftUrl(j.draftUrl); }
          } catch {}
        }
      }
    } catch {}
  };

  const logDebrief = async () => {
    if (!debriefText.trim()) return;
    setDebriefLoading(true); setDebriefError(null);
    try {
      const callDate = new Date().toISOString().split("T")[0];
      const result = await clientDebrief(debriefText, acc, callDate);
      const gongScoreObj = result.gongScore || null;
      const behaviorScoreObj = result.behaviorScore || null;
      const totalScore = gongScoreObj ? GONG_RUBRIC.reduce((sum, f) => sum + (typeof gongScoreObj[f.key] === 'number' ? gongScoreObj[f.key] : 0), 0) : null;
      const behaviorTotalScore = behaviorScoreObj ? BEHAVIOR_RUBRIC.reduce((sum, f) => sum + (typeof behaviorScoreObj[f.key] === 'number' ? behaviorScoreObj[f.key] : 0), 0) : null;
      const inputIsTranscript = isTranscript(debriefText);
      const topPersonaNow = (acc.personas || [])[0] || null;
      const callRecord = {
        id: Date.now(), date: callDate,
        summary: result.summary || "", callQuality: result.callQuality || "Neutral",
        painPoints: result.painPoints || [], productsDiscussed: result.productsDiscussed || [],
        nextSteps: (result.nextSteps || []).map(ns => ({ id: Date.now() + Math.random(), text: typeof ns === 'string' ? ns : (ns?.text || ns?.action || ''), owner: 'ae', done: false, dueDate: ns?.dueDate || null, createdAt: callDate })).filter(s => s.text),
        committedActions: result.committedActions || [],
        blockers: result.blockers || [], openQuestions: result.openQuestions || [],
        useCases: result.useCases || [], keySignals: result.keySignals || [],
        decisionMaker: result.decisionMaker || null,
        suggestedStage: result.suggestedStage || null,
        gongScore: gongScoreObj, totalScore, behaviorScore: behaviorScoreObj, behaviorTotalScore,
        timeline: result.timeline || null,
        contact: { name: topPersonaNow?.name || "", title: topPersonaNow?.title || "" },
        ...(inputIsTranscript ? { rawTranscript: debriefText } : { structuredNotes: debriefText }),
      };
      const intel = extractIntelligenceFromCall(result, acc);
      const updatedMedpicc = { ...(acc.medpicc || {}) };
      if (result.medpiccUpdates) { Object.entries(result.medpiccUpdates).forEach(([k, v]) => { if (v && (!updatedMedpicc[k] || updatedMedpicc[k].length < v.length)) updatedMedpicc[k] = v; }); }
      const compactCall = (call) => {
        const compactedRaw = call.rawTranscript && call.rawTranscript.length > 500 ? (call.summary || call.rawTranscript.slice(0, 500) + '… [compacted]') : call.rawTranscript;
        const compactedNotes = call.structuredNotes && call.structuredNotes.length > 500 ? (call.summary || call.structuredNotes.slice(0, 500) + '… [compacted]') : call.structuredNotes;
        if (compactedRaw === call.rawTranscript && compactedNotes === call.structuredNotes) return call;
        return { ...call, ...(call.rawTranscript ? { rawTranscript: compactedRaw } : {}), ...(call.structuredNotes ? { structuredNotes: compactedNotes } : {}) };
      };
      const calls = [...(acc.calls || []), callRecord].map((call, i, arr) => { const isRecent = i >= arr.length - 3; return isRecent ? call : compactCall(call); });
      const update = {
        ...acc, calls, medpicc: updatedMedpicc, last: callDate, lastIntelAt: new Date().toISOString(),
        ...(intel.mergedProds ? { prods: intel.mergedProds } : {}),
        ...(intel.mergedUcs ? { ucs: intel.mergedUcs } : {}),
        ...(intel.mergedSigs ? { sigs: intel.mergedSigs } : {}),
        ...(intel.mergedPersonas ? { personas: intel.mergedPersonas } : {}),
      };
      onUpdate && onUpdate(update);
      if (onUpdate) {
        runPathToCloseUpdate([update], (updatedAccounts) => {
          const ptc = updatedAccounts[0];
          if (ptc?.pathToClose) onUpdate({ ...update, pathToClose: ptc.pathToClose, pathToCloseAt: ptc.pathToCloseAt });
        }, true);
      }
      if (intel.newlyDetectedProds.length) onNewlyDetectedProds && onNewlyDetectedProds(new Set(intel.newlyDetectedProds));
      const committed = result.committedActions || [];
      setPendingActions(committed); setEditedActions(committed.map(a => a.suggestedAction || a.action));
      setSelectedActionIdxs(new Set(committed.map((_, i) => i))); setActionsPushed(false);
      generateFollowUpEmail(callRecord);

      const sfdcPayload = { id: Date.now(), accountId: acc.id, sfdcId: acc.sfdc || null, oppId: acc.sfdcOppId || acc.sfdc || null, accName: acc.name, nextStep: (callRecord.nextSteps || []).slice(0, 3).map(ns => typeof ns === 'string' ? ns : ns?.text || '').join(' | ').slice(0, 255), stageSuggestion: result.suggestedStage || null, lastActivityDate: callDate, medpicc: result.medpiccUpdates || {}, createdAt: new Date().toISOString(), synced: false };
      try { const q = JSON.parse(localStorage.getItem('prospector_sfdc_queue') || '[]'); const updated = q.filter(x => x.accountId !== acc.id); updated.push(sfdcPayload); localStorage.setItem('prospector_sfdc_queue', JSON.stringify(updated)); } catch {}

      const sfdcToken = localStorage.getItem('sfdc_access_token');
      const sfdcInstance = localStorage.getItem('sfdc_instance_url');
      let flashMsg = '✦ Intel updated';
      if (sfdcToken && sfdcInstance && sfdcPayload.oppId && sfdcPayload.nextStep) {
        try {
          const r = await fetch('/api/sfdc/update-opp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken: sfdcToken, instanceUrl: sfdcInstance, oppId: sfdcPayload.oppId, fields: { NextStep: sfdcPayload.nextStep } }) });
          if (r.ok) {
            try { const q2 = JSON.parse(localStorage.getItem('prospector_sfdc_queue') || '[]'); const upd = q2.map(x => x.id === sfdcPayload.id ? { ...x, synced: true, syncedAt: new Date().toISOString() } : x); localStorage.setItem('prospector_sfdc_queue', JSON.stringify(upd)); } catch {}
            flashMsg = '✓ Synced to Salesforce';
          } else { flashMsg = '⚠ Queued for SFDC sync'; }
        } catch { flashMsg = '⚠ Queued for SFDC sync'; }
      } else if (sfdcPayload.nextStep && !sfdcToken) { flashMsg = '⚠ Queued for SFDC sync'; }
      setIntelFlash && setIntelFlash(flashMsg);
      setTimeout(() => setIntelFlash && setIntelFlash(null), 3500);

      setDebriefText(""); onClose();
    } catch (e) { setDebriefError(e.message); }
    setDebriefLoading(false);
  };

  const closeDebrief = () => {
    setDebriefMode(null); setQuickUpdateText(''); setQuickUpdateResult(null); setQuickUpdateError(null); setQuickUpdateFollowUp(false);
    onClose();
  };

  const runQuickUpdate = async () => {
    if (!quickUpdateText.trim()) return;
    setQuickUpdateLoading(true); setQuickUpdateError(null); setQuickUpdateResult(null);
    try { setQuickUpdateResult(await quickUpdateExtract(quickUpdateText, acc)); }
    catch (e) { setQuickUpdateError(e.message); }
    setQuickUpdateLoading(false);
  };

  const applyQuickUpdate = (payload, withFollowUp) => {
    const today = new Date().toISOString().split('T')[0];
    const updated = { ...acc };
    let dirty = false;
    if (payload.timelineUpdates.length) {
      const newLines = payload.timelineUpdates.map(u => `${u.milestone || ''}${u.date ? ` — ${u.date}` : ''}`).filter(s => s.trim());
      updated.timeline = [updated.timeline || '', ...newLines].filter(Boolean).join('\n');
      dirty = true;
    }
    if (payload.newContacts.length) {
      const existing = updated.personas || [];
      const existingNames = existing.map(p => p.name?.toLowerCase());
      const dedupedNew = payload.newContacts.filter(c => !existingNames.includes(c.name?.toLowerCase()));
      if (dedupedNew.length) { updated.personas = [...existing, ...dedupedNew]; dirty = true; }
    }
    if (payload.blockers.length) { updated.blockers = [...(updated.blockers || []), ...payload.blockers.map(b => ({ text: b, addedAt: today, source: 'quick_update' }))]; dirty = true; }
    if (payload.contextNote) { updated.quickUpdates = [...(updated.quickUpdates || []), { text: payload.contextNote, date: today }]; dirty = true; }
    if (dirty) { updated.last = today; updated.lastIntelAt = new Date().toISOString(); onUpdate && onUpdate(updated); }
    (payload.tasks || []).forEach((t, i) => {
      if (!onCreateTask) return;
      const due = t.dueDate || (() => { const d = new Date(); d.setDate(d.getDate() + 2); return d.toISOString().split('T')[0]; })();
      onCreateTask({ id: Date.now() + i, title: t.text, type: 'Follow up', accId: acc.id, accName: acc.name, accVert: acc.vert, accUcs: acc.ucs, accProds: acc.prods, accStage: acc.stage, assignee: t.owner === 'AE' ? (activeUser?.name || 'AE') : (acc.name || 'Prospect'), status: 'Open', priority: 'Medium', dueDate: due, createdAt: today, source: 'quick_update', owner: t.owner });
    });
    if (withFollowUp) {
      generateFollowUpEmail({ id: Date.now(), date: today, summary: payload.contextNote || '', painPoints: (payload.blockers || []).map(b => ({ topic: b, detail: '', solution: '' })), productsDiscussed: [], nextSteps: (payload.tasks || []).map(t => ({ text: t.text, owner: t.owner === 'AE' ? 'ae' : 'prospect' })), decisionMaker: null });
    }
    setIntelFlash && setIntelFlash('✦ Quick update applied');
    setTimeout(() => setIntelFlash && setIntelFlash(null), 3500);
    closeDebrief();
  };

  useImperativeHandle(ref, () => ({
    generateFollowUpEmail, setPendingActions, setEditedActions, setSelectedActionIdxs, setActionsPushed,
  }));

  return (
    <>
      {open && <DebriefPanel
        acc={acc}
        debriefMode={debriefMode} setDebriefMode={setDebriefMode}
        debriefText={debriefText} setDebriefText={setDebriefText} debriefError={debriefError} debriefLoading={debriefLoading} logDebrief={logDebrief}
        gongSearch={gongSearch} gongDropOpen={gongDropOpen} setGongDropOpen={setGongDropOpen} searchGongEmails={searchGongEmails} importGongEmail={importGongEmail}
        quickUpdateText={quickUpdateText} setQuickUpdateText={setQuickUpdateText} quickUpdateError={quickUpdateError} quickUpdateLoading={quickUpdateLoading}
        quickUpdateResult={quickUpdateResult} setQuickUpdateResult={setQuickUpdateResult} quickUpdateFollowUp={quickUpdateFollowUp} setQuickUpdateFollowUp={setQuickUpdateFollowUp}
        runQuickUpdate={runQuickUpdate} applyQuickUpdate={applyQuickUpdate}
        closeDebrief={closeDebrief}
      />}
      <FollowUpEmailModal
        followUpEmail={followUpEmail} setFollowUpEmail={setFollowUpEmail}
        followUpDraftUrl={followUpDraftUrl} setFollowUpDraftUrl={setFollowUpDraftUrl}
        followUpCopied={followUpCopied} setFollowUpCopied={setFollowUpCopied}
        followUpSkipped={followUpSkipped} setFollowUpSkipped={setFollowUpSkipped}
        pendingActions={pendingActions}
        editedActions={editedActions} setEditedActions={setEditedActions}
        selectedActionIdxs={selectedActionIdxs} setSelectedActionIdxs={setSelectedActionIdxs}
        actionsPushed={actionsPushed} setActionsPushed={setActionsPushed}
        tasks={tasks} acc={acc} activeUser={activeUser} onCreateTask={onCreateTask}
      />
    </>
  );
});

export default DebriefWorkspace;
export { isTranscript };
