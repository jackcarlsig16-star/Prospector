import { getActiveIntel } from './assay';
import { MODELS } from '../config/models';
import { getCallContext } from './callContext';
import { scoreAccount } from './radarScoring';
import { ROI_KEY } from './storageKeys';

export const GONG_RUBRIC = [
  { key:"opening_agenda",   label:"Opening — Agenda Setting",      max:3,  cat:"opening" },
  { key:"opening_nba",      label:"Opening — NBA Notes Recap",     max:3,  cat:"opening" },
  { key:"pain",             label:"Current State & Pain",          max:5,  cat:"discovery" },
  { key:"technical",        label:"Technical Discovery",           max:5,  cat:"discovery" },
  { key:"volume",           label:"Volume or Projections",         max:5,  cat:"discovery" },
  { key:"commercial",       label:"Commercial Overview",           max:5,  cat:"commercial" },
  { key:"decision",         label:"Decision Process & Timeline",   max:10, cat:"commercial" },
  { key:"nextsteps_hw",     label:"Next Steps — Homework",         max:5,  cat:"nextsteps" },
  { key:"nextsteps_book",   label:"Next Steps — Book Next Call",   max:1,  cat:"nextsteps" },
  { key:"phone",            label:"Phone Number Obtained",         max:1,  cat:"nextsteps" },
];
export const GONG_MAX = GONG_RUBRIC.reduce((s,r)=>s+r.max,0); // 41

// Behavior rubric — scores AE behaviors during a call (not customer responses).
// Scale: 0 = no evidence, 1 = briefly touched, 2 = done but incomplete, 3 = done well.
export const BEHAVIOR_RUBRIC = [
  // Call Prep
  { key: 'prep_gong',       label: 'Listened to NBA call on Gong',                          skill: 'call_prep' },
  { key: 'prep_sfdc',       label: 'Checked SFDC + WW for account history and PayGo',       skill: 'call_prep' },
  { key: 'prep_hypothesis', label: 'Formed hypothesis on funnel position and deal strategy', skill: 'call_prep' },
  { key: 'prep_research',   label: 'Researched business and stakeholder LinkedIn',           skill: 'call_prep' },
  { key: 'prep_questions',  label: 'Prepared 2-3 tailored questions',                       skill: 'call_prep' },
  // Qualification
  { key: 'qual_business',   label: 'Explored customer business beyond immediate deal',       skill: 'qualification' },
  { key: 'qual_depth',      label: 'Asked level 2/3 questions throughout',                  skill: 'qualification' },
  { key: 'qual_metrics',    label: 'Asked for metrics tied to current state pain',           skill: 'qualification' },
  { key: 'qual_why_now',    label: 'Understood key drivers and timeline (why now)',          skill: 'qualification' },
  // Commercial
  { key: 'comm_volumes',    label: 'Asked for volumes before discussing pricing',            skill: 'commercial' },
  { key: 'comm_value',      label: 'Connected pricing to business case and expected value',  skill: 'commercial' },
  { key: 'comm_one_option', label: 'Presented one clear recommended commercial option',      skill: 'commercial' },
  { key: 'comm_objections', label: 'Anticipated and responded to pricing objections',        skill: 'commercial' },
  // Momentum
  { key: 'mom_process',     label: 'Understood decision process, approvals, and timeline',  skill: 'momentum' },
  { key: 'mom_asked',       label: 'Asked for the business when fit was established',        skill: 'momentum' },
  { key: 'mom_next_call',   label: 'Booked next call before ending',                        skill: 'momentum' },
];
export const BEHAVIOR_MAX = BEHAVIOR_RUBRIC.length * 3; // 48

export const MEDPICC_FIELDS = [
  { key:"metrics",           label:"Metrics",           hint:"Quantified business impact — what's the $ cost of not solving this?" },
  { key:"economic_buyer",    label:"Economic Buyer",    hint:"Who controls the budget? Have you spoken to them?" },
  { key:"decision_criteria", label:"Decision Criteria", hint:"How will they evaluate vendors? What does winning look like?" },
  { key:"decision_process",  label:"Decision Process",  hint:"Steps to get a signed contract. Legal, security, procurement?" },
  { key:"identify_pain",     label:"Identify Pain",     hint:"Confirmed, specific pain tied to our product. Champion can articulate it." },
  { key:"champion",          label:"Champion",          hint:"Who is selling internally for you? Do they have influence?" },
  { key:"competition",       label:"Competition",       hint:"Who else is in the deal? What is their status?" },
];


export function buildIntelExport(acc, user) {
  const aeName = user?.name || (() => {
    try { return JSON.parse(localStorage.getItem("prospector_user")||"{}").name||"AE"; }
    catch { return "AE"; }
  })();

  const lines = [];
  const sep = () => { lines.push(""); lines.push("---"); lines.push(""); };

  // ── Header ───────────────────────────────────────────────────────
  lines.push(`You are helping ${aeName}, an Account Executive, work a deal with ${acc.name}.`);
  lines.push(`Use everything below as ground truth about this prospect.`);
  lines.push(`When asked, prioritize: next best action, deal risks, missing MEDPICC gaps, and email drafting in ${aeName}'s voice.`);
  sep();

  // ── Section 1: Company ──────────────────────────────────────────
  lines.push("COMPANY");
  lines.push(`${acc.name} — ${acc.web || "no website"}`);
  if (acc.bm) lines.push(acc.bm);
  if (acc.pf) lines.push(acc.pf);
  lines.push(`Vertical: ${acc.vert || "not classified"}`);
  const daysSinceLast = acc.last ? Math.floor((Date.now() - new Date(acc.last).getTime()) / 86400000) : null;
  const lastLine = daysSinceLast != null ? `${acc.last} (${daysSinceLast} days ago)` : "never";
  lines.push(`Tier: ${acc.tier || "—"} | Stage: ${acc.stage || "Prospecting"} | Last touch: ${lastLine}`);

  // ── Section 2: Radar Intelligence ───────────────────────────────
  let frontierEntry = null;
  let threadCache = {};
  try {
    const frontier = JSON.parse(localStorage.getItem("prospector_frontier") || "[]");
    frontierEntry = frontier.find(f =>
      f?.outbound?.sourceAccountId === acc.id ||
      (f?.name && acc?.name && f.name.toLowerCase() === acc.name.toLowerCase())
    ) || null;
  } catch {}
  try { threadCache = JSON.parse(localStorage.getItem("prospector_threads_cache") || "{}"); } catch {}

  const { axes, overall } = scoreAccount(acc, frontierEntry, threadCache);
  const AXIS_ORDER = ["need","authority","budget","urgency","engagement","relationship"];
  const AXIS_LABEL = { need:"Need", authority:"Authority", budget:"Budget", urgency:"Urgency", engagement:"Engagement", relationship:"Relationship" };
  const AXIS_HINT = {
    authority:    "MEDPICC: Economic Buyer or Champion",
    budget:       "ACV, products attached, or MEDPICC Metrics",
    urgency:      "Stage, timeline, or MEDPICC Decision Process",
    need:         "MEDPICC Identify Pain or call painPoints",
    engagement:   "Recent touch, Gmail thread, or call activity",
    relationship: "Log calls, identify personas, or champion",
  };
  const allEmpty = AXIS_ORDER.every(k => (axes[k]?.confidence || "empty") === "empty");
  if (!allEmpty) {
    sep();
    lines.push("DEAL INTELLIGENCE");
    AXIS_ORDER.forEach(k => {
      const ax = axes[k];
      if (!ax) return;
      const sigs = ax.signals?.length ? ` — ${ax.signals.join(" · ")}` : "";
      lines.push(`${AXIS_LABEL[k]} ${ax.score}/100${sigs}`);
    });
    lines.push(`Overall: ${overall}/100`);
    const gaps = AXIS_ORDER.filter(k => axes[k]?.confidence === "empty");
    if (gaps.length) {
      lines.push("");
      lines.push(`Gaps: ${gaps.map(k => `${AXIS_LABEL[k]} (${AXIS_HINT[k]})`).join("; ")}`);
    }
  }

  // ── Section 3: MEDPICC ──────────────────────────────────────────
  sep();
  lines.push("MEDPICC");
  const med = acc.medpicc || {};
  const aeFirst = String(aeName || "").toLowerCase().split(/\s+/)[0];
  MEDPICC_FIELDS.forEach(f => {
    let val = med[f.key];
    if (f.key === "champion") {
      const championIsAE = val && aeFirst && String(val).toLowerCase().includes(aeFirst);
      if (!val || championIsAE) val = "not yet discovered — no internal advocate confirmed";
    } else if (!val || (typeof val === "string" && !val.trim())) {
      val = "not yet discovered";
    }
    lines.push(`${f.label}: ${val}`);
  });

  // ── Section 4: Contacts (excluding AE + team users) ─────────────
  const excludedNames = new Set();
  try {
    const me = JSON.parse(localStorage.getItem("prospector_user") || "{}");
    if (me?.name) excludedNames.add(String(me.name).toLowerCase());
  } catch {}
  try {
    const team = JSON.parse(localStorage.getItem("prospector_team_users") || "[]");
    (Array.isArray(team) ? team : []).forEach(u => {
      if (u?.name) excludedNames.add(String(u.name).toLowerCase());
    });
  } catch {}
  const personas = (acc.personas || []).filter(p =>
    p?.name && !excludedNames.has(String(p.name).toLowerCase())
  );
  if (personas.length > 0) {
    sep();
    lines.push("CONTACTS");
    personas.forEach(p => {
      const head = [p.name || "Unknown", p.title].filter(Boolean).join(" — ");
      const role = p.role ? ` (${p.role})` : "";
      lines.push(`${head}${role}`);
    });
  }

  // ── Section 5: Call History (most recent first) ─────────────────
  const calls = (acc.calls || []).slice().reverse();
  const qualityLabel = total => {
    if (total === 0)   return "Admin";
    if (total >= 30)   return "Strong";
    if (total >= 20)   return "Good";
    if (total >= 10)   return "Fair";
    return "Weak";
  };
  if (calls.length > 0) {
    sep();
    lines.push("CALLS");
    calls.forEach((c, i) => {
      const total = c.totalScore || 0;
      const behaviorPart = c.behaviorTotalScore != null
        ? ` · Behavior ${c.behaviorTotalScore}/${BEHAVIOR_MAX}`
        : "";
      lines.push("");
      lines.push(`${c.date || "unknown date"} — ${qualityLabel(total)} (Gong ${total}/${GONG_MAX}${behaviorPart})`);
      if (c.summary) lines.push(c.summary);

      const painTopics = (c.painPoints || [])
        .map(p => typeof p === "string" ? p : (p?.topic || ""))
        .filter(Boolean);
      if (painTopics.length) lines.push(`Pain confirmed: ${painTopics.join(" · ")}`);

      const prods = (c.productsDiscussed || []).filter(p => p?.interestLevel && p.interestLevel !== "None");
      if (prods.length) {
        lines.push(`Products: ${prods.map(p => `${p.product} (${String(p.interestLevel).toLowerCase()})`).join(" · ")}`);
      }

      if (c.timeline) lines.push(`Timeline: ${c.timeline}`);

      const ns = (c.nextSteps || []).map(s => typeof s === "string" ? s : (s?.text || "")).filter(Boolean);
      if (ns.length) {
        lines.push(`Next steps:`);
        ns.forEach(s => lines.push(`→ ${s}`));
      }

      const oq = (c.openQuestions || []).map(q => String(q || "").trim()).filter(Boolean);
      if (oq.length) {
        lines.push(`Open questions:`);
        oq.forEach(q => lines.push(`? ${q}`));
      }

      const bl = (c.blockers || []).map(b => typeof b === "string" ? b : (b?.text || "")).filter(Boolean);
      if (bl.length) {
        lines.push(`Blockers:`);
        bl.forEach(b => lines.push(`✕ ${b}`));
      }
    });
  }

  // ── Section 6: Open Items (deduplicated across all calls) ───────
  const seenNs = new Map();
  const seenBl = new Map();
  const seenOq = new Map();
  // calls iterates reverse-chronological → first-seen is most recent
  calls.forEach(c => {
    const callDate = c.date || "";
    (c.nextSteps || []).forEach(s => {
      const text = (typeof s === "string" ? s : s?.text || "").trim();
      if (!text) return;
      const k = text.toLowerCase();
      if (!seenNs.has(k)) seenNs.set(k, {
        text,
        owner: typeof s === "object" ? s?.owner : null,
        dueDate: typeof s === "object" ? s?.dueDate : null,
        callDate,
      });
    });
    (c.blockers || []).forEach(b => {
      const text = (typeof b === "string" ? b : b?.text || "").trim();
      if (!text) return;
      const k = text.toLowerCase();
      if (!seenBl.has(k)) seenBl.set(k, text);
    });
    (c.openQuestions || []).forEach(q => {
      const text = String(q || "").trim();
      if (!text) return;
      const k = text.toLowerCase();
      if (!seenOq.has(k)) seenOq.set(k, { text, callDate });
    });
  });

  // Drop next steps whose dueDate is older than 7 days; cap remaining at 5 most recent by call date.
  const sevenDaysAgo = Date.now() - 7 * 86400000;
  const nextStepsArr = [...seenNs.values()]
    .filter(({ dueDate }) => {
      if (!dueDate) return true;
      const t = new Date(dueDate).getTime();
      return Number.isNaN(t) || t >= sevenDaysAgo;
    })
    .sort((a, b) => String(b.callDate || "").localeCompare(String(a.callDate || "")))
    .slice(0, 5);

  const openQuestionsArr = [...seenOq.values()]
    .sort((a, b) => String(b.callDate || "").localeCompare(String(a.callDate || "")))
    .slice(0, 5);

  if (nextStepsArr.length + seenBl.size + openQuestionsArr.length > 0) {
    sep();
    lines.push("OPEN ITEMS");
    if (nextStepsArr.length) {
      lines.push("");
      lines.push("Next steps:");
      nextStepsArr.forEach(({ text, owner, dueDate }) => {
        const parts = [];
        if (owner) parts.push(owner);
        parts.push(dueDate ? `due ${dueDate}` : "no date");
        lines.push(`→ ${text} (${parts.join(", ")})`);
      });
    }
    if (seenBl.size) {
      lines.push("");
      lines.push("Blockers:");
      [...seenBl.values()].forEach(text => lines.push(`✕ ${text}`));
    }
    if (openQuestionsArr.length) {
      lines.push("");
      lines.push("Open questions:");
      openQuestionsArr.forEach(({ text }) => lines.push(`? ${text}`));
    }
  }

  // ── Section 7: Intel Docs (account-scoped only) ─────────────────
  let accountDocs = [];
  if (Array.isArray(acc.intelDocs) && acc.intelDocs.length) {
    accountDocs = acc.intelDocs.filter(d => d && (d.content || d.text));
  } else {
    try {
      const all = JSON.parse(localStorage.getItem("prospector_intel_docs") || "[]");
      accountDocs = (Array.isArray(all) ? all : []).filter(d =>
        d && d.active && (d.accId === acc.id || d.accountId === acc.id)
      );
    } catch {}
  }
  if (accountDocs.length > 0) {
    sep();
    lines.push("INTEL & CONTEXT NOTES");
    accountDocs.forEach((d, i) => {
      const title = d.title || d.name || "Untitled";
      const content = String(d.content || d.text || "");
      lines.push("");
      lines.push(title);
      if (content.length > 3000) {
        lines.push(`[Note: this document is long — focus on the most recent entries]`);
      }
      lines.push(content);
      if (i < accountDocs.length - 1) {
        lines.push("");
        lines.push("---");
      }
    });
  }

  // Trim trailing blank lines / separators
  while (lines.length && (lines[lines.length-1].trim() === "" || lines[lines.length-1].trim() === "---")) {
    lines.pop();
  }

  return lines.join("\n");
}

export async function clientDebrief(transcript, acc, callDate, opts = {}) {

  const resp = await fetch("/proxy/anthropic/messages", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      model: opts.model || MODELS.FAST,
      max_tokens:5000,
      messages:[{role:"user",content:`Extract structured call intelligence from this transcript or call summary for ${acc.name}.

TRANSCRIPT/SUMMARY:
${transcript.slice(0,40000)}

ACCOUNT CONTEXT:
Stage: ${acc.stage||"Prospecting"} | Products: ${(acc.prods||[]).join(", ")||"unknown"} | Vertical: ${acc.vert||"unknown"} | Call date: ${callDate||"unknown"}

Return ONLY valid JSON (no markdown, no explanation):
{
  "summary": "2-3 sentence call summary",
  "callQuality": "Strong | Neutral | Weak",
  "painPoints": [{"topic": "short label e.g. Gaming Compliance", "detail": "1-sentence context from the call", "solution": "specific product or capability that addresses it"}],
  "productsDiscussed": [{"product":"Auth","interestLevel":"High|Medium|Low|None"}],
  "decisionMaker": "name and title if identified, null if not",
  "contacts": [{"name": "string", "title": "string or empty", "company": "prospect|us|unknown"}],
  "timeline": "ordered deal milestones and phases only — not task-level actions. Format as comma-separated events with timeframes. null if none mentioned.",
  "nextSteps": [{"text": "specific committed action item naming the deliverable — max 3, see rules below", "owner": "AE|prospect contact name", "dueDate": "YYYY-MM-DD"}],
  "blockers": [{"text": "one sentence stating what is missing or stuck — see rules below"}],
  "openQuestions": ["discovery gap to clarify on a future call — not already captured as a blocker or next step"],
  "suggestedStage": "Prospecting|Engaged|Qualified|Demo|Proposal|Negotiation|Closed Won|Closed Lost",
  "useCases": ["2-4 word use case label"],
  "keySignals": ["one signal per entry, max 4"],
  "gongScore": {
    "opening_agenda": null,
    "opening_nba": null,
    "pain": null,
    "technical": null,
    "volume": null,
    "commercial": null,
    "decision": null,
    "nextsteps_hw": null,
    "nextsteps_book": null,
    "phone": null
  },
  "behaviorScore": {
    "prep_gong": null,
    "prep_sfdc": null,
    "prep_hypothesis": null,
    "prep_research": null,
    "prep_questions": null,
    "qual_business": null,
    "qual_depth": null,
    "qual_metrics": null,
    "qual_why_now": null,
    "comm_volumes": null,
    "comm_value": null,
    "comm_one_option": null,
    "comm_objections": null,
    "mom_process": null,
    "mom_asked": null,
    "mom_next_call": null
  },
  "medpiccUpdates": {
    "metrics": null,
    "economic_buyer": null,
    "decision_criteria": null,
    "decision_process": null,
    "identify_pain": null,
    "champion": null,
    "competition": null
  },
  "committedActions": [{"owner": "AE|Prospect", "action": "exact commitment made verbatim", "dueDate": "YYYY-MM-DD or null", "category": "Production Request|Payment Partners|Pricing|Security Review|Partner Access|Follow-up Call|VC Recommendations|Technical Review|Freeform", "suggestedAction": "playbook default for that category, or raw action if Freeform"}]
}

Rules:
- painPoints: max 4. Group related issues under one topic. Do NOT include process issues (missing docs, stuck PRs) — those are blockers.
- nextSteps: Maximum 3 items. Deduplicate aggressively — if two items describe the same action keep only the most specific. Exclude: sending emails, generic follow-ups, "meeting scheduled" entries (those go in timeline), vague actions like "begin conversation". Each item must name a concrete deliverable or outcome. Apply strictly before returning: (1) Deduplicate — keep only the most specific if two overlap. (2) Exclude — no sending emails, follow-ups, generic check-ins, or any action implied by another item. (3) Milestone vs task — if an item describes a phase, goal, or scheduled meeting put it in timeline not nextSteps. (4) Specificity — must name a concrete deliverable. (5) Keep only the 3 that most directly unblock the deal. For dueDate: default to call date + 2 days unless a specific date or day is mentioned. If "Thursday" is mentioned compute the actual date relative to the call date provided in ACCOUNT CONTEXT. Format as YYYY-MM-DD. Bad examples (exclude): "Send follow-up email", "Begin commercials conversation", "Provide state of union on approval status". Good examples (include): "Open USCOMP ticket and attach legal opinion + AML policies", "Submit Gaming Questionnaire and Security Questionnaire", "Prepare commercial terms proposal".
- blockers: Extract maximum 4 blockers. A blocker is anything that is PREVENTING the deal from moving forward right now. Apply these rules: (1) Missing documents that have been requested but not received = blocker. (2) Incomplete questionnaires = blocker. (3) Stuck production requests or compliance holds = blocker. (4) Waiting on a third party (legal counsel, regulator, internal team) to act = blocker. (5) Commercial terms not yet discussed when deal is active = blocker. Do NOT put these in openQuestions. Do NOT put these in nextSteps. Blockers are things already known to be missing or stuck — not things to discover. Bad examples (not blockers): "What are the commercial terms?", "How will pricing be structured?". Good examples (blockers): "Legal opinion letter not yet received from prospect's counsel", "Security Questionnaire incomplete", "Three Production Requests stuck in NEW status", "Commercial terms not yet negotiated despite active deal". Return as: [{ text }] — one sentence per blocker stating what is missing or stuck.
- contacts: Extract every named person mentioned in the transcript with a role or title. For each, classify company as "prospect" if they work at the prospect company, "us" if they work at our company (look for our company name in their introduction, title, or self-description), or "unknown" if their employer is unclear. Skip people mentioned only in passing without context. Use first + last name when available, otherwise just first. Set title to empty string when not stated.
- openQuestions: max 4. Discovery gaps only — not already captured as blockers or next steps.
- timeline: Maximum 3 milestones. Phases and events only — not task-level actions. If a next step mentions a scheduled meeting or future call, put it here as a milestone not in nextSteps. Format as a single string with newline-separated entries (e.g. "Week of 5/1 — begin testing\nEOQ — contract target").
For gongScore: fill in scores (integers) ONLY if the transcript is detailed enough. Use null if insufficient data. Rubric: opening_agenda/3, opening_nba/3, pain/5, technical/5, volume/5, commercial/5, decision/10, nextsteps_hw/5, nextsteps_book/1, phone/1.
For behaviorScore: score each AE behavior 0-3 (0=no evidence, 1=briefly touched, 2=done but incomplete, 3=done well). Use null only if the transcript contains zero evidence either way. These score AE behaviors, not customer responses.
For medpiccUpdates: fill in ONLY fields with clear evidence from this call. Use null for unknowns.
useCases: the use cases this company would implement (e.g. "bank account verification", "income verification"). Extract from pain points, products discussed, or explicit mentions. Return 2-4 word labels only.
keySignals: the strongest positive indicators of product fit from this call. Max 4. Examples: "budget confirmed", "champion identified", "legal review started", "competitor named". Do not include generic observations.
- committedActions: Explicit verbal commitments from this call only. Rules: (1) Must be a stated commitment, not implied. (2) Exclude generic follow-ups ("send recap", "schedule next call") — those go in nextSteps. (3) No duplicates with nextSteps. (4) Only things explicitly committed to. (5) Max 5. Return [] if none. For "category": map each commitment to the closest entry from this fixed list — "Production Request" (PR process, production access), "Payment Partners" (payment processor recommendations), "Pricing" (pricing deck, model, quote), "Security Review" (security questionnaire, SE loop-in), "Partner Access" (portal access, partner setup), "Follow-up Call" (scheduling next meeting), "VC Recommendations" (investor introductions or lists), "Technical Review" (SE scoping, integration review). If nothing fits, use "Freeform". For "suggestedAction": use the playbook default for that category exactly as written — "Chatter team to assess, send PR link to prospect" / "Recommend three payment partners relevant to use case" / "Build deck and pricing model / quote" / "Send security questionnaire, loop in SE" / "Set up partner portal access" / "Schedule next call with agenda" / "Send curated VC list relevant to stage and vertical" / "Loop in solutions engineer for integration scoping". For Freeform use the raw action text. For dueDate: infer from context ("by Friday" → compute from callDate, "next week" → callDate + 7) or null.`}],
    }),
  });
  const raw = await resp.text();
  let data;
  try { data = JSON.parse(raw); } catch {
    throw new Error(`Server error (${resp.status}): ${raw.slice(0,120).replace(/<[^>]+>/g," ").trim()}`);
  }
  if (data.error) throw new Error(`API error: ${data.error}`);
  const text = data.content?.[0]?.text||"{}";
  const match = text.match(/\{[\s\S]+\}/);
  if (!match) throw new Error("Could not parse debrief response");
  try {
    return JSON.parse(match[0]);
  } catch {
    throw new Error('Response was too long to parse — try a shorter transcript or summarize key points first.');
  }
}

export async function quickUpdateExtract(text, acc) {
  const content = `You are extracting deal updates from a short note or email. Be terse. Return JSON only, no preamble.

Account: ${acc.name}
Stage: ${acc.stage || "Prospecting"}
Current timeline: ${acc.timeline || "none"}

Text:
${(text || "").slice(0, 8000)}

Extract only what's clearly stated. Return JSON:
{
  "timelineUpdates": [{ "milestone": "", "date": "" }],
  "newContacts": [{ "name": "", "title": "string or empty", "company": "prospect | us | unknown" }],
  "blockers": [""],
  "tasks": [{ "text": "", "owner": "AE|Prospect", "dueDate": "" }],
  "contextNote": "",
  "suggestedStage": ""
}

Rules:
- timelineUpdates: max 2, only if dates clearly mentioned
- newContacts: only if new people clearly named with a title. Classify company as "prospect" if they work at the prospect company, "us" if they work at our company (look for our company name in their introduction, title, or context), or "unknown" if their employer is unclear. When in doubt, use unknown.
- blockers: only new blockers not already known
- tasks: max 3, only concrete next actions with an owner
- contextNote: 1 sentence summary of what this adds, or null
- suggestedStage: only if stage change is clearly implied, else null
- If a field has nothing, return [] or null. Do not invent.`;

  const resp = await fetch("/proxy/anthropic/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODELS.FAST,
      max_tokens: 400,
      messages: [{ role: "user", content }]
    })
  });
  const raw = await resp.text();
  let data;
  try { data = JSON.parse(raw); } catch {
    throw new Error(`Server error (${resp.status}): ${raw.slice(0,120).replace(/<[^>]+>/g," ").trim()}`);
  }
  if (data.error) throw new Error(`API error: ${data.error}`);
  const textOut = data.content?.[0]?.text || "{}";
  const match = textOut.match(/\{[\s\S]+\}/);
  if (!match) throw new Error("Could not parse Quick Update response");
  try {
    return JSON.parse(match[0]);
  } catch {
    throw new Error('Response was too long to parse — try a shorter transcript or summarize key points first.');
  }
}

const NOTES_EXAMPLES_KEY = 'prospector_notes_examples';

export function saveNotesExample(accName, transcribed, extracted) {
  try {
    const prev = JSON.parse(localStorage.getItem(NOTES_EXAMPLES_KEY) || '[]');
    const next = [{ accName, transcribed, extracted }, ...prev].slice(0, 3);
    localStorage.setItem(NOTES_EXAMPLES_KEY, JSON.stringify(next));
  } catch {}
}

function loadNotesExamples() {
  try { return JSON.parse(localStorage.getItem(NOTES_EXAMPLES_KEY) || '[]'); } catch { return []; }
}

export async function extractFromHandwrittenNotes(imageBase64, mimeType, knownAccounts = []) {
  const examples = loadNotesExamples();
  const examplesText = examples.length
    ? `\n\nPrior examples showing how this AE formats notes:\n` +
      examples.map((e, i) => `Example ${i+1}:\nTranscribed: "${e.transcribed}"\nExtracted: ${JSON.stringify(e.extracted)}`).join('\n\n')
    : '';
  const accountList = knownAccounts.length
    ? `\nKnown accounts (match written names to this list — use exact casing from the list):\n${knownAccounts.map(a => a.name).join(', ')}`
    : '';

  const prompt = `You are reading handwritten sales notes from an AE.

The AE's note format is: [] Account Name -- task description
- [] = checkbox / task marker
- The text immediately after [] is the account name
- After -- is the task to do
- Multiple tasks for the same account may appear grouped together
- Sometimes there is no --, the entire line after the account name is the task
${accountList}${examplesText}

First transcribe the handwriting exactly as written. Then extract every task line, detecting the account name from the notes themselves.

For each task, map to the nearest playbook category:
"Production Request", "Payment Partners", "Pricing", "Security Review", "Partner Access", "Follow-up Call", "VC Recommendations", "Technical Review", or "Freeform"

Playbook default actions:
- Production Request → "Chatter team to assess, send PR link to prospect"
- Payment Partners → "Recommend three payment partners relevant to use case"
- Pricing → "Build deck and pricing model / quote"
- Security Review → "Send security questionnaire, loop in SE"
- Partner Access → "Set up partner portal access"
- Follow-up Call → "Schedule next call with agenda"
- VC Recommendations → "Send curated VC list relevant to stage and vertical"
- Technical Review → "Loop in solutions engineer for integration scoping"

Return ONLY valid JSON:
{
  "transcribed": "exact handwriting transcription",
  "items": [
    {
      "accName": "account name exactly as written (match to known accounts list if possible)",
      "owner": "AE or Prospect",
      "action": "raw task text from notes",
      "suggestedAction": "playbook default for the category, or raw action if Freeform",
      "category": "category name",
      "dueDate": "YYYY-MM-DD or null"
    }
  ]
}

Rules:
- accName: read from the notes — do not invent. If a known account name is a close match, use that exact name.
- owner: AE for things the AE needs to do, Prospect for things the prospect committed to. Default to AE if unclear.
- dueDate: infer from context ("Friday", "EOW", "next week") or null. Today's date context: use current calendar.
- max 15 items total across all accounts
- if handwriting is unclear, transcribe your best guess and still extract`;

  const res = await fetch('/proxy/anthropic/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELS.STANDARD,
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  });
  const d = await res.json();
  if (!res.ok || d.error) throw new Error(d.error?.message || `API error ${res.status}`);
  const raw = d.content?.[0]?.text || '{}';
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Could not parse response');
  const parsed = JSON.parse(match[0]);
  if (parsed.transcribed && parsed.items?.length) {
    saveNotesExample('notes', parsed.transcribed, parsed.items);
  }
  return parsed;
}

export function getGleanPrompt(category, acc) {
  const vert  = acc?.vert  || 'their vertical';
  const uc    = (acc?.ucs||[])[0] || 'their use case';
  const stage = acc?.stage || 'early stage';
  const prods = (acc?.prods||[]).join(', ') || 'our products';
  const name  = acc?.name  || 'this account';
  switch (category) {
    case 'Production Request':   return `What is our current production request process for ${vert} accounts?`;
    case 'Payment Partners':     return `Which payment partners do we work with that are relevant for ${uc} in ${vert}?`;
    case 'Pricing':              return `What pricing models and benchmarks are typical for ${vert} deals at ${stage}?`;
    case 'Security Review':      return `What is our security review process and what documents are required for ${vert} prospects?`;
    case 'Partner Access':       return `What is our partner portal access setup process and who do I engage to get ${name} access?`;
    case 'Follow-up Call':       return `What are the most important discovery questions still open for ${name} at ${stage}?`;
    case 'VC Recommendations':   return `Which VCs are active in ${vert} at ${stage} that we have relationships with?`;
    case 'Technical Review':     return `What are the typical technical integration requirements for ${prods} in ${vert}?`;
    default:                     return `What context do we have on ${name} that would help me prepare for this next step?`;
  }
}

export async function clientDealReview(acc) {

  const callHistory = (acc.calls||[]).slice(-6).map((c,i)=>{
    const score = c.totalScore!=null ? ` [Gong: ${c.totalScore}/${GONG_MAX}]` : "";
    return `Call ${i+1} (${c.date||"unknown"})${score}: ${getCallContext(c, 1200) || "No summary."}`;
  }).join("\n") || "No call history.";

  const medpiccCtx = acc.medpicc ? MEDPICC_FIELDS.map(f=>
    acc.medpicc[f.key] ? `${f.label}: ${acc.medpicc[f.key]}` : null
  ).filter(Boolean).join("\n") : "Not populated.";

  const resp = await fetch("/proxy/anthropic/messages", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      model:MODELS.STANDARD,
      max_tokens:900,
      messages:[{role:"user",content:`You are an AE preparing a 2-minute deal review synopsis for a weekly team meeting. Be specific, concise, no fluff.

ACCOUNT: ${acc.name} | Stage: ${acc.stage||"unknown"} | Tier: ${acc.tier||"—"} | Vertical: ${acc.vert||"unknown"}
Products: ${(acc.prods||[]).join(", ")||"unknown"}
Business model: ${acc.bm||"unknown"}
product fit: ${acc.pf||"unknown"}

CALL HISTORY:
${callHistory}

MEDPICC:
${medpiccCtx}

Return ONLY a JSON object with exactly these 6 string fields. No markdown wrapper.

{
  "overview": "2-3 sentences: what they do, why they need our product, where the deal stands",
  "technicalWins": "What's been validated technically. If nothing yet, say so. Bullet each point with •",
  "commercialWins": "Pricing discussions, budget confirmed, commercial momentum. Bullet each point with •",
  "legal": "Legal/security/compliance status. If not started, say so.",
  "decisionMakers": "Known economic buyer, champion, influencers. Each on its own line.",
  "nextSteps": "Top 1-3 next steps with owner. Each on its own line starting with →"
}`}],
    }),
  });
  const data = await resp.json();
  const text = data.content?.[0]?.text;
  if (!text) throw new Error("No response from Claude");
  const clean = text.replace(/^```(?:json)?\n?/,"").replace(/\n?```$/,"").trim();
  try {
    return JSON.parse(clean);
  } catch {
    return { overview: clean, technicalWins:"", commercialWins:"", legal:"", decisionMakers:"", nextSteps:"" };
  }
}
