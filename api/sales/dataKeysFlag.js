// actions-v2 R2 / R3 - has the data-keys-v1 Stage 1 migration run? That ONE file adds sales_targets.employer_id and
// widens two CHECKs (sales_week_goals.link_type admits 'todo', origin admits 'reply'). A CHECK can't be read through
// the API, so the column the same file adds is the probe. A yes is kept for the life of the process; a no is asked
// again after a minute.
const RECHECK_MS = 60000;
let ran = false, askedAt = 0;

export async function dataKeysRan(supabase, now = Date.now()) {
  if (ran || now - askedAt < RECHECK_MS) return ran;
  askedAt = now;
  const { error } = await supabase.from('sales_targets').select('employer_id').limit(1);
  ran = !error;
  return ran;
}
export const resetDataKeysFlag = () => { ran = false; askedAt = 0; };
