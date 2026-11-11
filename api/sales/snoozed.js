// scout-v3 ruling R6: a person snoozed until a date (sales_prospect_state.snooze_until) is hidden from the people
// reads - Pipeline › People, Scout, the company window - until that LA day, behind a "Snoozed (n)" chip. One rule.
export const isSnoozed = (row, today) => !!row?.snooze_until && String(row.snooze_until).slice(0, 10) > today;
export function splitSnoozed(rows, today) {
  const shown = [], snoozed = [];
  for (const r of rows) (isSnoozed(r, today) ? snoozed : shown).push(r);
  return { shown, snoozed };
}
