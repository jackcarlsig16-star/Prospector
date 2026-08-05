import { MODELS } from '../config/models';
import { getCallContext } from './callContext';

async function generatePathToClose(acc) {
  const medpicc = acc.medpicc || {};
  const recentCall = acc.calls?.[acc.calls.length - 1];
  let complianceStatus = "none";
  try {
    const compliance = JSON.parse(localStorage.getItem("prospector_compliance") || "{}")[acc.id];
    if (compliance?.steps?.length) {
      complianceStatus = compliance.steps.map(s => `${s.id}: ${s.status}`).join(", ");
    }
  } catch {}

  const response = await fetch("/proxy/anthropic/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODELS.FAST,
      max_tokens: 30,
      messages: [{
        role: "user",
        content: `Summarize this B2B sales deal in one phrase (max 8 words). Be specific. No fluff.

Account: ${acc.name}
Stage: ${acc.dealStage || acc.stage}
Products: ${(acc.prods || []).join(", ") || "unknown"}
MEDPICC gaps: ${Object.entries(medpicc).filter(([, v]) => !v || v.length < 10).map(([k]) => k).join(", ") || "none"}
Blockers: ${recentCall?.blockers?.map(b => b.text || b).join("; ") || "none"}
Compliance: ${complianceStatus}
Last call: ${getCallContext(recentCall, 2000) || "no calls logged"}

Return ONLY a single phrase max 8 words. Examples: "Gaming approval pending — compliance hold", "Pricing aligned, paper in review", "No economic buyer identified yet". No explanation.`,
      }],
    }),
  });

  const data = await response.json();
  return data.content?.[0]?.text?.trim() || null;
}

export async function runPathToCloseUpdate(accounts, setAccounts, force = false) {
  const today = new Date().toDateString();
  if (!force) {
    const lastRun = localStorage.getItem("prospector_ptc_last_run");
    if (lastRun === today) return;
  }

  const activeDeals = accounts.filter(a => a.stage === "Active Deal");
  if (!activeDeals.length) return;

  const updated = [...accounts];

  for (const acc of activeDeals) {
    try {
      const ptc = await generatePathToClose(acc);
      if (ptc) {
        const idx = updated.findIndex(a => a.id === acc.id);
        if (idx >= 0) updated[idx] = { ...updated[idx], pathToClose: ptc, pathToCloseAt: new Date().toISOString() };
      }
      await new Promise(r => setTimeout(r, 300));
    } catch { /* silent */ }
  }

  setAccounts(updated);
  localStorage.setItem("prospector_ptc_last_run", today);
}
