// The Priority a row shows (read-only since top-targets-v1: the pin is the one hand-set lift). Not a fit = a visitor
// on the skip list.
export const NOT_A_FIT = 'not_a_fit';
export const priorityValue = r => (r.not_a_fit ? NOT_A_FIT : r.priority == null ? '' : String(r.priority));
