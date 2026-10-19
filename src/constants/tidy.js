// call-notes-targets-v1 Stage 3 - the Tidy rule kinds, shared by
// api/sales/tidyRules.js and the Suggested list. 'enrich' is reserved for
// partner-add-research Stage 3 and is not a kind yet.
export const KIND_LABEL = { research_or_drop: 'Research', follow_up: 'Follow up', set_a_date: 'No date', duplicate: 'Duplicate', reply_task: 'Reply', check_co_owner: 'Ownership', flag_cold: 'Flag', nudge: 'Nudge' };
export const KINDS = Object.keys(KIND_LABEL);
