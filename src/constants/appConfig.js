// App-level configuration: roles, permissions

// Own company's email domain — used to distinguish internal vs external
// meeting attendees, learn-voice filtering, etc. Set REACT_APP_COMPANY_DOMAIN
// at build time to your org's domain.
export const COMPANY_EMAIL_DOMAIN = (process.env.REACT_APP_COMPANY_DOMAIN || "example.com").toLowerCase();

// Role-based permissions — edit these when you build real auth
export const ROLE_PERMS = {
  AE:      { canUpload:true,  canStealth:true,  canReassay:true,  canRemove:true,  canEditStage:true,  canAdmin:false, canFlagRemoval:false, canClaim:true  },
  BDR:     { canUpload:false, canStealth:true,  canReassay:false, canRemove:false, canEditStage:true,  canAdmin:false, canFlagRemoval:true,  canClaim:false },
  Manager: { canUpload:false, canStealth:false, canReassay:false, canRemove:false, canEditStage:true,  canAdmin:false, canFlagRemoval:false, canClaim:false, canManagerView:true },
  Admin:   { canUpload:true,  canStealth:true,  canReassay:true,  canRemove:true,  canEditStage:true,  canAdmin:true,  canFlagRemoval:false, canClaim:true  },
  Owner:   { canUpload:true,  canStealth:true,  canReassay:true,  canRemove:true,  canEditStage:true,  canAdmin:true,  canFlagRemoval:false, canClaim:true,  canOwner:true },
};

// Returns true for any role with admin-level access or above
export const isAdmin = (user) => user?.role === 'Admin' || user?.role === 'Owner';

export const initials = n => (n||"?").split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);

