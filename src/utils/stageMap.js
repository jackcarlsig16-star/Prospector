export const DEAL_STAGES = [
  { id: "qualify",            label: "Qualify",            sfdc: ["Qualify","Qualified lead","Lead","Open"] },
  { id: "discovery",          label: "Discovery",          sfdc: ["Discovery","Discovery / Scoping","Scoping","Initial Alignment"] },
  { id: "evaluation",         label: "Evaluation",         sfdc: ["Evaluation","Testing/Evaluation","Building","Testing","Building or Testing"] },
  { id: "mutual_alignment",   label: "Mutual Alignment",   sfdc: ["Mutual Alignment","Alignment / Contracting","Active","Passive"] },
  { id: "negotiation",        label: "Negotiation",        sfdc: ["Negotiation","Pricing","Negotiation/Review"] },
  { id: "contract_execution", label: "Contract Execution", sfdc: ["Contract Execution","Contracting","Contract Signed","Final Execution","Committed","Contractual Terms"] },
  { id: "closed_won",         label: "Closed Won",         sfdc: ["Closed Won","Closed Won - Locked","Closed Won \u2013 Locked"] },
];

export const SFDC_TO_STAGE = {};
DEAL_STAGES.forEach(stage => {
  stage.sfdc.forEach(sfdcLabel => {
    SFDC_TO_STAGE[sfdcLabel] = stage.id;
  });
});

export const mapSfdcStage = (sfdcStage) => {
  if (!sfdcStage) return null;
  return SFDC_TO_STAGE[sfdcStage] || null;
};

export const getDealStageLabel = (stageId) => {
  if (!stageId) return null;
  if (stageId === "closed_lost") return "Closed Lost";
  return DEAL_STAGES.find(s => s.id === stageId)?.label || null;
};
