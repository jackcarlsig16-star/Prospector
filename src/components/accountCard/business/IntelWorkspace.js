import { useState, forwardRef, useImperativeHandle } from 'react';
import { MEDPICC_FIELDS, clientDealReview } from '../../../utils/dealIntel';
import { MODELS } from '../../../config/models';
import IntelPanel from '../../intel/IntelPanel';

// Owns Intel drawer state (MEDPICC, Deal Review, Call Scores, Gong
// briefings, Ask Anything, Personas, Settings) — relocated verbatim from
// the old AccountCardActionBar.js. Business-only. `onRelaunchFollowUp`
// comes from DebriefWorkspace's ref so the two stay wired without either
// one owning the other's state.
const IntelWorkspace = forwardRef(function IntelWorkspace({ acc, onUpdate, tasks, activeUser, open, onClose, newlyDetectedProds, debriefHandle }, ref) {
  const [callHistoryOpen, setCallHistoryOpen] = useState(false);
  const [callScoreOpen, setCallScoreOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [personasTabOpen, setPersonasTabOpen] = useState(false);
  const [settingsTabOpen, setSettingsTabOpen] = useState(false);
  const [medpiccOpen, setMedpiccOpen] = useState(false);
  const [dealReviewOpen, setDealReviewOpen] = useState(false);
  const [gongCalls, setGongCalls] = useState(null);
  const [gongCallsError, setGongCallsError] = useState(null);
  const [gongExpandedId, setGongExpandedId] = useState(null);
  const [gongEnrich, setGongEnrich] = useState(null);
  const [expandedCallIds, setExpandedCallIds] = useState(() => new Set());
  const [copiedCallId, setCopiedCallId] = useState(null);
  const [editingScore, setEditingScore] = useState(null);
  const [draftScore, setDraftScore] = useState({});
  const [expandedMedpicc, setExpandedMedpicc] = useState(new Set());
  const [appliedMedpicc, setAppliedMedpicc] = useState(new Set());
  const [addedNextSteps, setAddedNextSteps] = useState(new Set());
  const [dealReviewSections, setDealReviewSections] = useState(() => {
    try { const s = localStorage.getItem(`prospector_deal_review_${acc.id}`); if (s) return JSON.parse(s); } catch {}
    return acc.dealReviewData || null;
  });
  const [dealReviewLoading, setDealReviewLoading] = useState(false);
  const [dealReviewError, setDealReviewError] = useState(null);
  const [dealReviewRegenKey, setDealReviewRegenKey] = useState(null);
  const [intelQuery, setIntelQuery] = useState("");
  const [intelAnswer, setIntelAnswer] = useState(null);
  const [intelLoading, setIntelLoading] = useState(false);
  const [linksAddOpen, setLinksAddOpen] = useState(false);
  const [linkLabelDraft, setLinkLabelDraft] = useState('');
  const [linkUrlDraft, setLinkUrlDraft] = useState('');

  const fetchGongCalls = async () => {
    const sfdcId = acc.sfdc || acc.sf;
    if (!sfdcId) { setGongCallsError('No SFDC account ID on this account'); return; }
    setGongCalls('loading'); setGongCallsError(null); setGongEnrich(null);
    try {
      const r = await fetch('/api/databricks/gong-calls', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sfdcId }) });
      const d = await r.json();
      if (!r.ok) { setGongCallsError(d.error || 'Failed'); setGongCalls(null); return; }
      const calls = d.calls || []; setGongCalls(calls);
      if (calls.length) fetchGongEnrich(calls);
    } catch (e) { setGongCallsError(e.message); setGongCalls(null); }
  };

  const fetchGongEnrich = async (calls) => {
    setGongEnrich('loading');
    const manualDates = (acc.calls || []).map(c => c.date).filter(Boolean);
    const newCalls = calls.filter(gc => { if (!gc.date) return true; return !manualDates.some(md => Math.abs(new Date(gc.date) - new Date(md)) < 86400000 * 1.5); });
    if (!newCalls.length) { setGongEnrich({ medpiccSuggestions: {}, unclosedNextSteps: [], signals: [], deduped: calls.length }); return; }
    try {
      const r = await fetch('/api/databricks/gong-enrich', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ calls: newCalls, currentMedpicc: acc.medpicc || {}, existingNextSteps: (acc.nextSteps || []).map(s => s.text || s) }) });
      const d = await r.json();
      if (!r.ok) { setGongEnrich(null); return; }
      setGongEnrich({ ...d, deduped: calls.length - newCalls.length, newCallCount: newCalls.length });
    } catch { setGongEnrich(null); }
  };

  const saveDealReview = (sections) => {
    setDealReviewSections(sections);
    try { localStorage.setItem(`prospector_deal_review_${acc.id}`, JSON.stringify(sections)); } catch {}
    onUpdate && onUpdate({ ...acc, dealReviewData: sections });
  };
  const updateDealReviewField = (key, val) => saveDealReview({ ...(dealReviewSections || {}), [key]: val });
  const generateDealReview = async (regenKey = null) => {
    setDealReviewOpen(true); setDealReviewLoading(true); setDealReviewError(null);
    if (regenKey) setDealReviewRegenKey(regenKey); else setDealReviewRegenKey(null);
    try {
      const sections = await clientDealReview(acc);
      if (regenKey) saveDealReview({ ...(dealReviewSections || {}), [regenKey]: sections[regenKey] || "" });
      else saveDealReview(sections);
    } catch (e) { setDealReviewError(e.message); }
    setDealReviewLoading(false); setDealReviewRegenKey(null);
  };

  const askIntel = async () => {
    if (!intelQuery.trim()) return;
    setIntelLoading(true); setIntelAnswer(null);
    const callSummaries = (acc.calls || []).map((c, i) => `Call ${i + 1} (${c.date}): ${c.summary}${c.painPoints?.length ? "\nPain: " + c.painPoints.map(p => typeof p === 'string' ? p : (p?.topic || '')).join("; ") : ""}${c.nextSteps?.length ? "\nNext steps: " + c.nextSteps.map(ns => typeof ns === 'string' ? ns : ns?.text || '').join("; ") : ""}`).join("\n\n");
    const medpiccStr = acc.medpicc ? MEDPICC_FIELDS.map(f => acc.medpicc[f.key] ? `${f.label}: ${acc.medpicc[f.key]}` : null).filter(Boolean).join("\n") : "";
    try {
      const r = await fetch("/proxy/anthropic/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: MODELS.STANDARD, max_tokens: 600, messages: [{ role: "user", content: `Account: ${acc.name} | Stage: ${acc.stage} | Tier: ${acc.tier} | Products: ${(acc.prods || []).join(", ")}\n\nBusiness model: ${acc.bm || "unknown"}\nproduct fit: ${acc.pf || "unknown"}\n\nCall history:\n${callSummaries || "None"}\n\nMEDPICC:\n${medpiccStr || "Not populated"}\n\nQuestion: ${intelQuery}\n\nAnswer concisely and specifically based on the data above.` }] }) });
      const d = await r.json(); setIntelAnswer(d.content?.[0]?.text || "No answer.");
    } catch (e) { setIntelAnswer("Error: " + e.message); }
    setIntelLoading(false);
  };

  useImperativeHandle(ref, () => ({
    openSettings() { setSettingsTabOpen(true); },
  }));

  if (!open) return null;

  return (
    <IntelPanel
      acc={acc} tasks={tasks} activeUser={activeUser} onUpdate={onUpdate}
      setIntelOpen={v => { if (!v) onClose(); }}
      callHistoryOpen={callHistoryOpen} setCallHistoryOpen={setCallHistoryOpen}
      callScoreOpen={callScoreOpen} setCallScoreOpen={setCallScoreOpen}
      askOpen={askOpen} setAskOpen={setAskOpen}
      personasTabOpen={personasTabOpen} setPersonasTabOpen={setPersonasTabOpen}
      settingsTabOpen={settingsTabOpen} setSettingsTabOpen={setSettingsTabOpen}
      medpiccOpen={medpiccOpen} setMedpiccOpen={setMedpiccOpen}
      dealReviewOpen={dealReviewOpen} setDealReviewOpen={setDealReviewOpen}
      gongCalls={gongCalls} gongCallsError={gongCallsError}
      gongExpandedId={gongExpandedId} setGongExpandedId={setGongExpandedId}
      fetchGongCalls={fetchGongCalls} gongEnrich={gongEnrich}
      expandedCallIds={expandedCallIds} setExpandedCallIds={setExpandedCallIds}
      copiedCallId={copiedCallId} setCopiedCallId={setCopiedCallId}
      editingScore={editingScore} setEditingScore={setEditingScore}
      draftScore={draftScore} setDraftScore={setDraftScore}
      expandedMedpicc={expandedMedpicc} setExpandedMedpicc={setExpandedMedpicc}
      appliedMedpicc={appliedMedpicc} setAppliedMedpicc={setAppliedMedpicc}
      addedNextSteps={addedNextSteps} setAddedNextSteps={setAddedNextSteps}
      dealReviewSections={dealReviewSections} dealReviewLoading={dealReviewLoading}
      dealReviewError={dealReviewError} dealReviewRegenKey={dealReviewRegenKey}
      generateDealReview={generateDealReview} updateDealReviewField={updateDealReviewField}
      intelQuery={intelQuery} setIntelQuery={setIntelQuery}
      intelAnswer={intelAnswer} intelLoading={intelLoading} askIntel={askIntel}
      generateFollowUpEmail={debriefHandle?.generateFollowUpEmail}
      setPendingActions={debriefHandle?.setPendingActions}
      setEditedActions={debriefHandle?.setEditedActions}
      setSelectedActionIdxs={debriefHandle?.setSelectedActionIdxs}
      setActionsPushed={debriefHandle?.setActionsPushed}
      linksAddOpen={linksAddOpen} setLinksAddOpen={setLinksAddOpen}
      linkLabelDraft={linkLabelDraft} setLinkLabelDraft={setLinkLabelDraft}
      linkUrlDraft={linkUrlDraft} setLinkUrlDraft={setLinkUrlDraft}
      newlyDetectedProds={newlyDetectedProds}
    />
  );
});

export default IntelWorkspace;
