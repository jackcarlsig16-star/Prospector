export const SCOUT_LAYERS = [
  { id: "active",      label: "Active",      default: true  },
  { id: "qualified",   label: "Qualified",   default: true  },
  { id: "closed_lost", label: "Closed Lost", default: false },
  { id: "closed_won",  label: "Closed Won",  default: false },
];

const LAYER_STAGES = {
  active:      ["Active Deal"],
  qualified:   ["Engaged", "Prospecting"],
  closed_lost: ["Closed Lost"],
  closed_won:  ["Closed Won"],
};

export function filterAccountsByLayers(accounts, activeLayers) {
  const stages = new Set(activeLayers.flatMap(id => LAYER_STAGES[id] || []));
  return accounts.filter(a => stages.has(a.stage));
}
