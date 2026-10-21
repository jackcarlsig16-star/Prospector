// sales-ia-v2 P5 - Pipeline > People shows Huddle's real prospect statuses
// under one label each. Closed rows (and snoozed Not now rows) hide behind
// "Show closed (n)". Shared by api/sales/huddleLive.js and the People table.
export const STATUS_LABEL = { new: 'Active', claimed: 'Active', contacted: 'Contacted', booked: 'Booked', not_now: 'Not now', dead: 'Not a fit' };
export const CLOSED_STATUSES = ['booked', 'not_now', 'dead'];
// Filter options: one per label (new + claimed share "Active").
export const STATUS_OPTIONS = [['active', 'Active'], ['contacted', 'Contacted'], ['booked', 'Booked'], ['not_now', 'Not now'], ['dead', 'Not a fit']];
export const statusKey = status => (status === 'new' || status === 'claimed' ? 'active' : status);
