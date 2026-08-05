export const BASELINE_VOICE = [
  {
    id:"bv1", name:"Cold Outreach — Generic", baseline:true, active:true,
    createdAt:"2026-01-01T00:00:00.000Z",
    content:`Hey [First Name],

Noticed [Company] is scaling fast — thought our product might be a good fit for what you're building.

Worth 15 minutes to run through the details?

- [Your Name]`
  },
  {
    id:"bv2", name:"Follow-up — Generic", baseline:true, active:true,
    createdAt:"2026-01-01T00:00:00.000Z",
    content:`Hey [First Name],

Wanted to follow up on my last note — happy to walk through how this could fit into what you're building.

Open to a quick call this week?

- [Your Name]`
  },
];

export const voiceProfileKey = (userName) => `prospector_voice_profile_${(userName||"default").replace(/\s+/g,"_").toLowerCase()}`;
export const voiceDocsKey    = (userName) => `prospector_voice_docs_${(userName||"default").replace(/\s+/g,"_").toLowerCase()}`;

export const getActiveVoice = (userName) => {
  try {
    const key = voiceDocsKey(userName);
    // Only load the user's own docs — do not fall back to the global key (shared default docs)
    const saved = localStorage.getItem(key);
    const docs = saved ? JSON.parse(saved) : BASELINE_VOICE;
    const active = docs.filter(d => d.active);
    if (!active.length) return "";
    return active.map(d => `--- ${d.name} ---\n${d.content}`).join("\n\n");
  } catch { return ""; }
};

export const BDR_DEFAULT_VOICE = {
  greeting: "Hi [First Name],",
  closing: "Thanks,\n[Your Name]",
  tone: "warm",
  avgSentenceLength: "short",
  avgEmailLength: "brief (under 80 words)",
  commonPhrases: [
    "Worth a quick call to see if there's a fit?",
    "Happy to keep it brief",
    "Let me know if timing is better later",
  ],
  avoidPhrases: [
    "I hope this email finds you well","Circling back","Per my last email",
    "Synergies","solutions","leverage","excited to connect","touch base",
  ],
  signatureStyle: "[Your Name] | BDR",
  formalityLevel: 2,
  punctuationStyle: "minimal, conversational",
  structureStyle: "short paragraphs, direct ask, 4-6 sentences max",
  keyTraits: ["Warm", "Direct", "Low-pressure", "Curious"],
  sampleOpener: "Hi [First Name],",
  source: "bdr_default",
  learnedAt: new Date().toISOString(),
  teachCount: 0,
};

export const getVoiceProfile = (userName, fallback) => {
  try {
    const key = voiceProfileKey(userName);
    const stored = localStorage.getItem(key);
    if (stored) return JSON.parse(stored);
    // Do NOT fall back to the global key or a shared default voice profile.
    // New users should see a blank profile and train their own.
    return fallback || null;
  } catch { return fallback || null; }
};
