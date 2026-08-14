// App-level configuration: navigation, roles, permissions, team seed data

// Own company's email domain — used to distinguish internal vs external
// meeting attendees, learn-voice filtering, etc. Set REACT_APP_COMPANY_DOMAIN
// at build time to your org's domain.
export const COMPANY_EMAIL_DOMAIN = (process.env.REACT_APP_COMPANY_DOMAIN || "example.com").toLowerCase();

// global-workspace-navigation-v1 — "home" relabeled Portfolio to stop
// colliding with the per-business "Command Center" label (BUSINESS_NAV);
// content/id/route unchanged, still the legacy Territory view. "calendar"
// is a new placeholder — real cross-business calendar aggregation is a
// future SPEC candidate, not built here; Sidebar.js renders `disabled`
// items dimmed and non-interactive, same treatment as DISABLED_BUSINESS_NAV.
export const NAV = [
  { id: "home",         ic: "⌂", lb: "Portfolio" },
  { id: "accounts",     ic: "◈", lb: "Accounts" },
  { id: "veinmap",      ic: "⛏", lb: "Vein Map" },
  { id: "ledger",       ic: "≡", lb: "Ledger" },
  { id: "outbound",     ic: "◎", lb: "Outbound" },
  { id: "ideas",        ic: "◆", lb: "Ideas" },
  { id: "handoffs",     ic: "🤝", lb: "Handoffs" },
  { id: "intelligence", ic: "⬟", lb: "Intelligence" },
  { id: "tools",        ic: "⚒", lb: "Tool Chest" },
  { id: "calendar",     ic: "📅", lb: "Calendar", disabled: true },
  { id: "admin",        ic: "⚙", lb: "Admin" },
];

// Role-based permissions — edit these when you build real auth
export const ROLE_PERMS = {
  AE:      { canUpload:true,  canStealth:true,  canReassay:true,  canRemove:true,  canEditStage:true,  canAdmin:false, canFlagRemoval:false, canClaim:true  },
  BDR:     { canUpload:false, canStealth:true,  canReassay:false, canRemove:false, canEditStage:true,  canAdmin:false, canFlagRemoval:true,  canClaim:false },
  Manager: { canUpload:false, canStealth:false, canReassay:false, canRemove:false, canEditStage:true,  canAdmin:false, canFlagRemoval:false, canClaim:false, canManagerView:true },
  Admin:   { canUpload:true,  canStealth:true,  canReassay:true,  canRemove:true,  canEditStage:true,  canAdmin:true,  canFlagRemoval:false, canClaim:true  },
  Owner:   { canUpload:true,  canStealth:true,  canReassay:true,  canRemove:true,  canEditStage:true,  canAdmin:true,  canFlagRemoval:false, canClaim:true,  canOwner:true },
};

export const NAV_ROLES = {
  home:         ["AE","BDR","Manager","Admin","Owner"],
  accounts:     ["AE","BDR","Manager","Admin","Owner"],
  veinmap:      ["AE","BDR","Manager","Admin","Owner"],
  ledger:       ["AE","Manager","Admin","Owner"],
  outbound:     ["AE","BDR","Manager","Admin","Owner"],
  ideas:        ["AE","BDR","Manager","Admin","Owner"],
  handoffs:     ["AE","Manager","Admin","Owner"],
  intelligence: ["AE","BDR","Manager","Admin","Owner"],
  tools:        ["AE","Manager","Admin","Owner"],
  calendar:     ["AE","BDR","Manager","Admin","Owner"],
  admin:        ["Admin","Owner"],
  // Hidden from nav but still routable (no NAV entry)
  claimjumper:  ["AE","BDR","Manager","Admin","Owner"],
  uploads:      ["AE","Admin","Owner"],
  analytics:    ["AE","BDR","Manager","Admin","Owner"],
};

// Returns true for any role with admin-level access or above
export const isAdmin = (user) => user?.role === 'Admin' || user?.role === 'Owner';

export const SMB_TEAM = [
  { id:"sample_manager", name:"Sam Rivera",   email:"srivera@example.com",  role:"Manager", company:"Prospector", status:"active",   reportsTo:null,           location:"USA", workerId:""       },
  { id:"owner_sample",   name:"Alex Owner",   email:"aowner@example.com",   role:"AE",      company:"Prospector", status:"approved", reportsTo:"sample_manager", location:"USA", workerId:""       },
  { id:"u_jordan",       name:"Jordan Lee",   email:"jlee@example.com",     role:"AE",      company:"Prospector", status:"pending",  reportsTo:"sample_manager", location:"USA", workerId:"100001" },
  { id:"u_taylor",       name:"Taylor Kim",   email:"tkim@example.com",     role:"AE",      company:"Prospector", status:"pending",  reportsTo:"sample_manager", location:"USA", workerId:"100002" },
];

export const SEED_TEAM_USERS = [
  { id:"casey", name:"Casey", email:"casey@example.com", role:"BDR", company:"Prospector", status:"active" },
];

export const initials = n => (n||"?").split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);

// Permanent owner accounts — role is forced to Owner regardless of stored value
export const OWNER_EMAILS = ["aowner@example.com"];

export const applyOwnerRole = (user) => {
  if (!user?.email) return user;
  if (OWNER_EMAILS.includes(user.email.toLowerCase())) return { ...user, role: "Owner" };
  return user;
};
