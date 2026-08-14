// ─── Invite System ────────────────────────────────────────────────────────────

// Fallback list used only when Supabase is unavailable or approved_users table
// hasn't been seeded. Prefer getAutoApproveEmails() from utils/db.js.
export const WHITELISTED_EMAILS = [
  'admin@example.com',
];
const INVITES_KEY = "prospector_invites";
const PREFS_KEY   = "prospector_prefs";

const WORD_LIST  = ["GOLD","MINE","VEIN","ORE","LODE","PICK","PAN","DUST","CLAIM","RUSH"];
// No 0/O/1/I to avoid visual confusion
const SAFE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// ── Code generation ───────────────────────────────────────────────────────────

// generateCode(existingCodes, { prefix, suffixLen }) — both optional
// Backward-compatible: generateCode([...existingCodes]) still works.
export function generateCode(existingCodes = [], opts = {}) {
  const existing = new Set((existingCodes || []).map(c => c.toUpperCase()));
  const suffixLen = opts.suffixLen || 4;
  const fixedPrefix = (opts.prefix || '').toUpperCase() || null;
  const pickPrefix = () => fixedPrefix || WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
  for (let t = 0; t < 30; t++) {
    const word = pickPrefix();
    let suffix = "";
    for (let i = 0; i < suffixLen; i++) suffix += SAFE_CHARS[Math.floor(Math.random() * SAFE_CHARS.length)];
    const code = `${word}-${suffix}`;
    if (!existing.has(code)) return code;
  }
  // collision fallback (practically unreachable)
  let s = "";
  for (let i = 0; i < suffixLen; i++) s += SAFE_CHARS[Math.floor(Math.random() * SAFE_CHARS.length)];
  return `${fixedPrefix || 'LODE'}-${s}`;
}

export function generateMasterCode(opts = {}) {
  const suffixLen = opts.suffixLen || 4;
  const prefix = (opts.prefix || '').toUpperCase() || WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
  let suffix = "";
  for (let i = 0; i < suffixLen; i++) suffix += SAFE_CHARS[Math.floor(Math.random() * SAFE_CHARS.length)];
  return `${prefix}-${suffix}`;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function getInvites() {
  try { return JSON.parse(localStorage.getItem(INVITES_KEY) || "[]"); } catch { return []; }
}

function saveInvites(list) {
  try { localStorage.setItem(INVITES_KEY, JSON.stringify(list)); } catch {}
}

export function createInvite({ name, email, role, createdBy = "" }) {
  const list   = getInvites();
  const code   = generateCode(list.map(i => i.code));
  const invite = {
    id:        `inv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    code,
    name:      name.trim(),
    email:     email.trim(),
    role,
    createdAt: new Date().toISOString(),
    createdBy,
    usedAt:    null,
    usedBy:    null,
    status:    "pending",
  };
  saveInvites([...list, invite]);
  return invite;
}

export function redeemInvite(code, userName) {
  const list  = getInvites();
  const upper = code.toUpperCase();
  const idx   = list.findIndex(i => i.code.toUpperCase() === upper && i.status === "pending");
  if (idx === -1) return null;
  const updated = { ...list[idx], usedAt: new Date().toISOString(), usedBy: userName || "", status: "used" };
  saveInvites(list.map((inv, n) => n === idx ? updated : inv));
  return updated;
}

export function revokeInvite(id) {
  saveInvites(getInvites().map(i => i.id === id ? { ...i, status: "revoked" } : i));
}

export function isValidCode(code) {
  if (!code) return null;
  const upper = code.toUpperCase();
  return getInvites().find(i => i.code.toUpperCase() === upper && i.status === "pending") || null;
}

// ── Master code ───────────────────────────────────────────────────────────────

export function getMasterCodeHash() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}").masterCode || null; } catch { return null; }
}

export function setMasterCode(plainCode) {
  try {
    const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    prefs.masterCode = btoa(plainCode.toUpperCase());
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

export function checkMasterCode(input) {
  const hash = getMasterCodeHash();
  if (!hash) return false;
  try { return atob(hash).toUpperCase() === input.toUpperCase(); } catch { return false; }
}

// ── Role normalization ────────────────────────────────────────────────────────
// invite.role is lowercase ("ae"/"bdr"/"manager"/"admin")
// onboarding form.role is title-case ("AE"/"BDR"/"Manager"/"Admin")

export function normalizeRoleForForm(r) {
  const map = { ae:"AE", bdr:"BDR", manager:"Manager", admin:"Admin" };
  return map[(r||"").toLowerCase()] || "AE";
}

// ── Email templates ───────────────────────────────────────────────────────────

const ROLE_EMAIL_CONTENT = {
  ae: {
    subtitle:  "Account Executive",
    desc:      "Full territory intelligence for AEs — accounts, assay engine, pricing, compliance, and frontier.",
    features: [
      "Full territory view — score and tier every account with the assay engine",
      "Pricing & ROI Calculator — build per-account deal models with approval level guidance",
      "Deal compliance tracker — production request and partner steps, live hard-block warnings",
      "Frontier outbound — track early-stage prospects and AI-generate cold emails",
      "Meeting prep briefs — AI-generated before every customer call",
      "Claim Jumper — pick up dormant accounts from the shared pool",
    ],
    limits: ["Cannot manage other users or team settings (contact your admin)"],
  },
  bdr: {
    subtitle:  "Business Development Rep",
    desc:      "Your AE's territory queue — accounts, tasks, and outbound tools.",
    features: [
      "Account queue — research any account in the territory, read call history and MEDPICC",
      "Task panel — prioritized Salesforce follow-up queue, organized by due date and tier",
      "Frontier — track early-stage prospects and outbound sequences",
      "Meeting context — view briefs and account intel before outreach",
    ],
    limits: [
      "Read-only on accounts — your AE controls stage, scoring, and pricing",
      "No CSV uploads, no assay engine, no pricing tools (those are AE-only)",
    ],
  },
  manager: {
    subtitle:  "Manager",
    desc:      "Team-wide visibility across all AE territories.",
    features: [
      "Manager command center — territory health and pipeline across all AEs",
      "Leaderboard and per-rep analytics",
      "Pipeline stage editing for hygiene",
      "Task assignment across the team",
    ],
    limits: ["No write access to individual accounts, research tools, or pricing"],
  },
  admin: {
    subtitle:  "Admin",
    desc:      "Full access including team management, invites, and settings.",
    features: [
      "All AE features — full territory, pricing, frontier, compliance",
      "Team management — add, edit, and remove users",
      "Invite system — generate and track per-role invite codes",
      "API keys, permissions, territories, and platform settings",
    ],
    limits: [],
  },
};

export function buildInviteEmail({ name, code, role, appUrl }) {
  const first = (name || "").split(" ")[0] || name;
  const rd    = ROLE_EMAIL_CONTENT[(role || "ae").toLowerCase()] || ROLE_EMAIL_CONTENT.ae;
  const feats = rd.features.map(f => `  • ${f}`).join("\n");
  const limits = rd.limits.length
    ? `\nWhat you can't do (by design):\n${rd.limits.map(l => `  • ${l}`).join("\n")}\n`
    : "";

  return `PROSPECTOR — ${rd.subtitle}

Hi ${first},

You've been invited to Prospector. ${rd.desc}

────────────────────
YOUR INVITE CODE

  ${code}

────────────────────

To get started:
  1. Open ${appUrl}
  2. Enter your code on the access screen
  3. Complete a quick 2-minute setup (name, email, confirm role)
  4. Your workspace is ready immediately — no install required

What you'll have access to:
${feats}
${limits}
Open Prospector →  ${appUrl}

────────────────────
Built by Prospector
Reply to this email with any questions.`;
}
