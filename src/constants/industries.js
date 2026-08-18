// account-taxonomy-and-creation-upgrade-v1 Stage 0 — the single source for
// the account industry/vertical list. Previously duplicated verbatim across
// AccountsUploadModal.js, HomePage.js, ClaimJumperPage.js, AnalyticsPage.js,
// and PreCallResearchPanel.js (as CAL_VERTS) — five independent copies with
// real drift risk. Content here is still the pre-existing fintech-era list
// (Stage 0 = consolidation only, no content change, behaviorally invisible);
// Stage 1 swaps the VALUES in this one file to the new universal taxonomy.
export const INDUSTRY_COLOR = {
  "Banks": "#60A8F0", "BFM": "#F5A050", "PFM": "#A878F0",
  "Wealth": "#F5C842", "Consumer Payments": "#42E890", "Technology": "#56C8E0",
  "Lending": "#F06060", "Insurance": "#E878C0", "Crypto": "#50C8A0",
  "Payroll": "#E8C870", "Real Estate": "#90C878", "Healthcare": "#78D0B0",
  "Commerce": "#E8A050", "Investment": "#F5C842", "Fintech": "#A878F0",
};

export const INDUSTRIES = Object.keys(INDUSTRY_COLOR);
