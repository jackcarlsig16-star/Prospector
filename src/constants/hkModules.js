// hkos-project-shell-v1 - the HumanKind Sales OS modules, read by GET /api/hk/:businessId/shell and the Settings >
// Modules screen. Read-only here: each module's own SPEC adds its businesses.features key and toggle, and until
// then its nav slots never render (hidden, never shown disabled).
export const HK_MODULES = [
  { key: 'email', label: 'Email outreach', on: true, locked: true },
  { key: 'creators', label: 'Creators / Instagram', on: false },
  { key: 'nonprofits_press', label: 'Non-profits, Press, Podcasts', on: false },
  { key: 'hk_u', label: 'HumanKind U', on: false },
  { key: 'sponsor_ops', label: 'Sponsor onboarding and reports', on: false },
  { key: 'campaigns_sourcing', label: 'Campaigns and Sourcing', on: false },
];
